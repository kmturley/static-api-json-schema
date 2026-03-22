import fs from "node:fs/promises";
import { existsSync, statSync } from "node:fs";
import path from "node:path";

import { z } from "zod";

import { loadProjectConfig } from "./load-config.js";
import { discoverSources } from "./discovery.js";
import { BuildError } from "./errors.js";
import type {
  AssetInput,
  BuildMode,
  CompileHelpers,
  GeneratedAsset,
  GeneratedDocument,
  JsonObject,
  JsonValue,
  LoadedResourceSource,
  LoadedVersionSource,
  ProjectConfig,
  ReferenceObject,
  ReferenceTarget,
  ResourceBuildArtifacts,
  ResourceInstance,
  SchemaRegistry,
} from "./types.js";
import { loadYamlFile } from "./yaml.js";
import {
  compareSemverDesc,
  ensureInsideRoot,
  maybeString,
  normalizeRootDomain,
  pathToPosix,
  toRegularCharacterSort,
  toSearchSlug,
} from "./utils.js";

const ReferenceObjectSchema = z.object({
  "@id": z.url(),
  "@type": z.string().min(1),
  name: z.string().min(1).optional(),
});

const IndexDocumentSchema = z.object({
  "@context": z.string().min(1),
  "@type": z.string().min(1),
  "@id": z.url(),
});

const CollectionPageSchema = IndexDocumentSchema.extend({
  name: z.string().min(1),
  hasPart: z.array(ReferenceObjectSchema).optional(),
  about: z.array(ReferenceObjectSchema).optional(),
  value: z.union([z.string(), z.number(), z.boolean()]).optional(),
  version: z.string().min(1).optional(),
});

const CollectionPageReferenceSchema = ReferenceObjectSchema.extend({
  "@type": z.literal("CollectionPage"),
});

const RootIndexSchema = CollectionPageSchema.extend({
  hasPart: z.array(CollectionPageReferenceSchema),
  about: z.array(CollectionPageReferenceSchema),
  version: z.string().min(1),
});

const ResourceCollectionSchema = CollectionPageSchema.extend({
  hasPart: z.array(ReferenceObjectSchema),
  about: z.array(CollectionPageReferenceSchema),
});

const SearchManifestSchema = CollectionPageSchema.extend({
  hasPart: z.array(CollectionPageReferenceSchema),
  about: z.array(CollectionPageReferenceSchema).length(1),
});

const SearchValueIndexSchema = CollectionPageSchema.extend({
  hasPart: z.array(ReferenceObjectSchema),
  about: z.array(CollectionPageReferenceSchema).length(1),
  value: z.string().min(1),
});

const VersionIndexSchema = CollectionPageSchema.extend({
  hasPart: z.array(ReferenceObjectSchema),
  about: z.array(ReferenceObjectSchema).length(1),
});

export interface BuildOptions {
  cwd: string;
  write: boolean;
  config?: ProjectConfig;
  mode?: BuildMode;
}

export interface BuildResult {
  config: ProjectConfig;
  mode: BuildMode;
  documents: GeneratedDocument[];
  assets: GeneratedAsset[];
}

export async function runBuild(options: BuildOptions, registry: SchemaRegistry): Promise<BuildResult> {
  const config = options.config ?? await loadProjectConfig();
  const mode = options.mode ?? "development";
  const instances = await discoverSources(options.cwd, config);
  const loadedInstances = await loadAndValidateInstances(instances, registry);

  const result = await generateArtifacts(options.cwd, config, loadedInstances, registry);
  result.mode = mode;

  if (options.write) {
    await cleanOutDir(options.cwd);
    await writeArtifacts(options.cwd, result.documents, result.assets, result.config, mode);
  }

  return result;
}

export async function cleanOutDir(cwd: string): Promise<void> {
  await fs.rm(path.join(cwd, "out"), { recursive: true, force: true });
}

async function loadAndValidateInstances(
  instances: ResourceInstance[],
  registry: SchemaRegistry,
): Promise<ResourceInstance[]> {
  const loadedInstances: ResourceInstance[] = [];

  for (const instance of instances) {
    const definition = registry[instance.resource.resourceType];
    if (!definition) {
      throw new BuildError("No runtime schema definition exists for this resource type", {
        code: "UNKNOWN_RESOURCE_TYPE",
        filePath: instance.resource.filePath,
        resourceType: instance.resource.resourceType,
        resourceId: instance.resource.resourceId,
      });
    }

    const resourceData = await loadYamlFile(instance.resource.filePath);
    const parsedResource = definition.resourceSchema.safeParse(resourceData);
    if (!parsedResource.success) {
      throw zodIssueToBuildError(parsedResource.error.issues[0], instance.resource.filePath, {
        resourceType: instance.resource.resourceType,
        resourceId: instance.resource.resourceId,
      });
    }

    validateDeclaredType(
      parsedResource.data,
      definition.allowedResourceTypes,
      instance.resource.filePath,
      "resource",
    );

    const versions: LoadedVersionSource[] = [];
    for (const version of instance.versions) {
      if (!definition.versionSchema) {
        throw new BuildError("This resource type does not support version documents", {
          code: "UNSUPPORTED_VERSION_SCHEMA",
          filePath: version.filePath,
          resourceType: version.resourceType,
          resourceId: version.resourceId,
          versionId: version.versionId,
        });
      }

      const versionData = await loadYamlFile(version.filePath);
      const parsedVersion = definition.versionSchema.safeParse(versionData);
      if (!parsedVersion.success) {
        throw zodIssueToBuildError(parsedVersion.error.issues[0], version.filePath, {
          resourceType: version.resourceType,
          resourceId: version.resourceId,
          versionId: version.versionId,
        });
      }

      validateDeclaredType(
        parsedVersion.data,
        definition.allowedVersionTypes,
        version.filePath,
        "version",
      );

      versions.push({ ...version, data: parsedVersion.data });
    }

    versions.sort((a, b) => compareSemverDesc(a.versionId, b.versionId));

    loadedInstances.push({
      resource: { ...instance.resource, data: parsedResource.data },
      versions,
    });
  }

  return loadedInstances;
}

function validateDeclaredType(
  data: JsonObject,
  allowedTypes: string[] | undefined,
  filePath: string,
  documentKind: "resource" | "version",
): void {
  if (!allowedTypes || allowedTypes.length === 0) {
    return;
  }

  const declaredType = data.type ?? data["@type"];
  if (typeof declaredType !== "string") {
    return;
  }

  if (!allowedTypes.includes(declaredType)) {
    throw new BuildError(`Declared ${documentKind} type is incompatible with its resource type directory`, {
      code: "INCOMPATIBLE_DECLARED_TYPE",
      filePath,
      fieldPath: typeof data.type === "string" ? "type" : "@type",
    });
  }
}

function zodIssueToBuildError(
  issue: z.ZodIssue | undefined,
  filePath: string,
  details: {
    resourceType?: string;
    resourceId?: string;
    versionId?: string;
  },
): BuildError {
  return new BuildError(issue?.message ?? "Validation failed", {
    code: "VALIDATION_ERROR",
    filePath,
    fieldPath: issue?.path.join("."),
    resourceType: details.resourceType,
    resourceId: details.resourceId,
    versionId: details.versionId,
  });
}

async function generateArtifacts(
  cwd: string,
  config: ProjectConfig,
  instances: ResourceInstance[],
  registry: SchemaRegistry,
): Promise<BuildResult> {
  const normalizedDomain = normalizeRootDomain(config.rootDomain);
  const resourcesRoot = path.resolve(cwd, config.resourcesRoot);
  const claims = new Map<string, string>();
  const assets: GeneratedAsset[] = [];
  const documents: GeneratedDocument[] = [];
  const referenceTargets = new Map<string, ReferenceTarget>();

  for (const instance of instances) {
    const definition = registry[instance.resource.resourceType];
    if (!definition) {
      throw new BuildError("No runtime schema definition exists for this resource type", {
        code: "UNKNOWN_RESOURCE_TYPE",
        filePath: instance.resource.filePath,
        resourceType: instance.resource.resourceType,
        resourceId: instance.resource.resourceId,
      });
    }
    const resourceUrlPath = `/${instance.resource.resourceType}/${instance.resource.resourceId}`;
    const resourceCanonical = `${normalizedDomain}${resourceUrlPath}`;
    referenceTargets.set(resourceUrlPath, {
      canonicalUrl: resourceCanonical,
      jsonLdType: resolveJsonLdType(definition.resourceJsonLdType, instance.resource.data),
      kind: "resource",
    });

    for (const version of instance.versions) {
      const versionUrlPath = `/${version.resourceType}/${version.resourceId}/versions/${version.versionId}`;
      referenceTargets.set(versionUrlPath, {
        canonicalUrl: `${normalizedDomain}${versionUrlPath}`,
        jsonLdType: resolveJsonLdType(definition.versionJsonLdType ?? definition.resourceJsonLdType, version.data),
        kind: "version",
      });
    }
  }

  for (const instance of instances) {
    const definition = registry[instance.resource.resourceType];
    if (!definition) {
      throw new BuildError("No runtime schema definition exists for this resource type", {
        code: "UNKNOWN_RESOURCE_TYPE",
        filePath: instance.resource.filePath,
        resourceType: instance.resource.resourceType,
        resourceId: instance.resource.resourceId,
      });
    }
    const artifact = compileResourceArtifacts(
      cwd,
      config,
      resourcesRoot,
      instance,
      definition,
      referenceTargets,
      claims,
      assets,
    );
    documents.push(artifact.resourceDocument, ...artifact.versionDocuments);
    if (artifact.versionIndexDocument) {
      documents.push(artifact.versionIndexDocument);
    }
    if (artifact.latestDocument) {
      documents.push(artifact.latestDocument);
    }
  }

  const rootDocument = buildRootIndex(config, instances, normalizedDomain);
  claimOutputPath(claims, rootDocument.outputPath, "root-index");
  validateGeneratedDocument(rootDocument.document, "root-index", RootIndexSchema);
  documents.push(rootDocument);

  for (const [resourceType, instanceGroup] of groupByResourceType(instances)) {
    const collection = buildCollectionIndex(config, resourceType, instanceGroup, normalizedDomain);
    claimOutputPath(claims, collection.outputPath, `collection:${resourceType}`);
    validateGeneratedDocument(collection.document, `collection:${resourceType}`, ResourceCollectionSchema);
    documents.push(collection);

    const searchDocuments = buildSearchIndexes(config, resourceType, instanceGroup, normalizedDomain, claims);
    for (const document of searchDocuments) {
      validateGeneratedDocument(
        document.document,
        `search:${resourceType}`,
        resolveSearchDocumentSchema(document.outputPath),
      );
      documents.push(document);
    }
  }

  const docsHtml = buildDocsHtml(config, instances, normalizedDomain);
  claimOutputPath(claims, "docs/index.html", "docs");
  documents.push({
    outputPath: "docs/index.html",
    urlPath: "/docs/",
    document: {
      "@context": "https://schema.org",
      "@type": "CreativeWork",
      "@id": `${normalizedDomain}/docs/`,
      html: docsHtml,
    },
  });

  return { config, mode: "development", documents, assets };
}

function compileResourceArtifacts(
  cwd: string,
  config: ProjectConfig,
  resourcesRoot: string,
  instance: ResourceInstance,
  definition: SchemaRegistry[string],
  referenceTargets: Map<string, ReferenceTarget>,
  claims: Map<string, string>,
  assets: GeneratedAsset[],
): ResourceBuildArtifacts {
  const normalizedDomain = normalizeRootDomain(config.rootDomain);
  const resourceUrlPath = `/${instance.resource.resourceType}/${instance.resource.resourceId}`;
  const resourceOutputPath = `${instance.resource.resourceType}/${instance.resource.resourceId}/index.json`;
  claimOutputPath(claims, resourceOutputPath, instance.resource.filePath);

  const versionRefs = instance.versions.map((version) =>
    makeReferenceObject(
      `${normalizedDomain}/${version.resourceType}/${version.resourceId}/versions/${version.versionId}`,
      resolveJsonLdType(definition.versionJsonLdType ?? definition.resourceJsonLdType, version.data),
    ),
  );
  const latestVersion = instance.versions[0];

  const makeJsonLdDocumentAt = (url: string, documentType: string, fields: JsonObject): JsonObject => ({
    "@context": "https://schema.org",
    "@type": documentType,
    "@id": url,
    ...fields,
  });

  const helper: CompileHelpers = {
    makeJsonLdDocument(documentType, fields) {
      return makeJsonLdDocumentAt(`${normalizedDomain}${resourceUrlPath}`, documentType, fields);
    },
    makeJsonLdDocumentAt(url, documentType, fields) {
      return makeJsonLdDocumentAt(url, documentType, fields);
    },
    resolveInternalReference(referencePath) {
      return resolveReference(referencePath, referenceTargets, instance.resource.filePath);
    },
    resolveInternalReferences(referencePaths) {
      return referencePaths.map((referencePath) =>
        resolveReference(referencePath, referenceTargets, instance.resource.filePath),
      );
    },
    copyAsset(asset, owner) {
      return copyAsset(cwd, resourcesRoot, config, claims, assets, asset, owner, instance.resource.filePath);
    },
    toReferenceObject: makeReferenceObject,
    resourceUrl() {
      return `${normalizedDomain}${resourceUrlPath}`;
    },
    versionUrl(versionId) {
      return `${normalizedDomain}/${instance.resource.resourceType}/${instance.resource.resourceId}/versions/${versionId}`;
    },
    latestVersionReference() {
      return latestVersion ? makeReferenceObject(
        `${normalizedDomain}/${latestVersion.resourceType}/${latestVersion.resourceId}/versions/${latestVersion.versionId}`,
        resolveJsonLdType(definition.versionJsonLdType ?? definition.resourceJsonLdType, latestVersion.data),
      ) : undefined;
    },
    versionReferences() {
      return versionRefs;
    },
    versionIndexUrl() {
      return instance.versions.length > 0
        ? `${normalizedDomain}/${instance.resource.resourceType}/${instance.resource.resourceId}/versions`
        : undefined;
    },
  };

  const resourceDocument = definition.compileResource({
    resource: instance.resource as LoadedResourceSource,
    versions: instance.versions as LoadedVersionSource[],
    helper,
  });

  validateGeneratedDocument(resourceDocument, instance.resource.filePath, definition.resourceOutputSchema);

  const generatedResource: GeneratedDocument = {
    outputPath: resourceOutputPath,
    urlPath: resourceUrlPath,
    document: resourceDocument,
  };

  const versionDocuments: GeneratedDocument[] = [];
  for (const version of instance.versions) {
    const versionOutputPath = `${version.resourceType}/${version.resourceId}/versions/${version.versionId}/index.json`;
    claimOutputPath(claims, versionOutputPath, version.filePath);

    const versionDocument = definition.compileVersion
      ? definition.compileVersion({
          resource: instance.resource as LoadedResourceSource,
          version: version as LoadedVersionSource,
          helper,
        })
      : {
          "@context": "https://schema.org",
          "@type": resolveJsonLdType(definition.versionJsonLdType ?? definition.resourceJsonLdType, version.data),
          "@id": `${normalizedDomain}/${version.resourceType}/${version.resourceId}/versions/${version.versionId}`,
          ...version.data,
        };

    validateGeneratedDocument(versionDocument, version.filePath, definition.versionOutputSchema);

    versionDocuments.push({
      outputPath: versionOutputPath,
      urlPath: `/${version.resourceType}/${version.resourceId}/versions/${version.versionId}`,
      document: versionDocument,
    });
  }

  let versionIndexDocument: GeneratedDocument | undefined;
  let latestDocument: GeneratedDocument | undefined;

  if (instance.versions.length > 0) {
    const versionIndexOutputPath = `${instance.resource.resourceType}/${instance.resource.resourceId}/versions/index.json`;
    claimOutputPath(claims, versionIndexOutputPath, `${instance.resource.filePath}:versions-index`);
    versionIndexDocument = {
      outputPath: versionIndexOutputPath,
      urlPath: `/${instance.resource.resourceType}/${instance.resource.resourceId}/versions`,
      document: {
        "@context": "https://schema.org",
        "@type": "CollectionPage",
        "@id": `${normalizedDomain}/${instance.resource.resourceType}/${instance.resource.resourceId}/versions`,
        name: `${instance.resource.resourceId} versions`,
        about: [
          {
            "@id": `${normalizedDomain}${resourceUrlPath}`,
            "@type": resolveJsonLdType(definition.resourceJsonLdType, instance.resource.data),
            name: getResourceReferenceName(instance),
          },
        ],
        hasPart: versionRefs,
      },
    };
    validateGeneratedDocument(versionIndexDocument.document, versionIndexOutputPath, VersionIndexSchema);

    const latest = instance.versions[0];
    if (!latest) {
      throw new BuildError("Missing latest version after version sorting", {
        code: "MISSING_LATEST_VERSION",
        filePath: instance.resource.filePath,
        resourceType: instance.resource.resourceType,
        resourceId: instance.resource.resourceId,
      });
    }
    const latestOutputPath = `${latest.resourceType}/${latest.resourceId}/versions/latest/index.json`;
    claimOutputPath(claims, latestOutputPath, `${latest.filePath}:latest`);
    const latestSource = versionDocuments.find((document) => document.urlPath.endsWith(`/${latest.versionId}`));
    latestDocument = {
      outputPath: latestOutputPath,
      urlPath: `/${latest.resourceType}/${latest.resourceId}/versions/latest`,
      document: {
        ...structuredCloneJson(latestSource?.document ?? {}),
        "@id": `${normalizedDomain}/${latest.resourceType}/${latest.resourceId}/versions/latest`,
      },
    };
    validateGeneratedDocument(latestDocument.document, latestOutputPath, definition.versionOutputSchema);
  }

  return {
    resourceDocument: generatedResource,
    versionDocuments,
    versionIndexDocument,
    latestDocument,
    assets,
  };
}

function resolveJsonLdType(typeOrResolver: string | ((value: JsonObject) => string), value: JsonObject): string {
  return typeof typeOrResolver === "function" ? typeOrResolver(value) : typeOrResolver;
}

function resolveReference(
  referencePath: string,
  referenceTargets: Map<string, ReferenceTarget>,
  filePath: string,
): ReferenceObject {
  const target = referenceTargets.get(referencePath);
  if (!target) {
    throw new BuildError("Referenced internal resource or version does not exist", {
      code: "MISSING_INTERNAL_REFERENCE",
      filePath,
      referencePath,
    });
  }
  return makeReferenceObject(target.canonicalUrl, target.jsonLdType);
}

function makeReferenceObject(url: string, jsonLdType: string): ReferenceObject {
  return {
    "@id": url,
    "@type": jsonLdType,
  };
}

function copyAsset(
  cwd: string,
  resourcesRoot: string,
  config: ProjectConfig,
  claims: Map<string, string>,
  assets: GeneratedAsset[],
  asset: string | AssetInput,
  owner:
    | { resourceType: string; resourceId: string }
    | { resourceType: string; resourceId: string; versionId: string },
  filePath: string,
): string | JsonObject {
  const assetObject = typeof asset === "string" ? { path: asset } : asset;
  const rawPath = assetObject.path;

  const sourcePath = ensureInsideRoot(
    resourcesRoot,
    path.join(resourcesRoot, rawPath.startsWith("/") ? rawPath.slice(1) : rawPath),
    filePath,
    "path",
  );

  if (!existsSync(sourcePath)) {
    throw new BuildError("Referenced local asset does not exist", {
      code: "MISSING_LOCAL_ASSET",
      filePath,
      fieldPath: "path",
    });
  }

  if (!statSync(sourcePath).isFile()) {
    throw new BuildError("Referenced local asset must be a file", {
      code: "INVALID_LOCAL_ASSET",
      filePath,
      fieldPath: "path",
    });
  }

  const assetFileName = path.basename(sourcePath);
  const outputPath = "versionId" in owner
    ? `${owner.resourceType}/${owner.resourceId}/versions/${owner.versionId}/assets/${assetFileName}`
    : `${owner.resourceType}/${owner.resourceId}/assets/${assetFileName}`;

  claimOutputPath(claims, outputPath, sourcePath);

  assets.push({
    sourcePath,
    outputPath,
    urlPath: `/${outputPath}`,
  });

  const contentUrl = `${normalizeRootDomain(config.rootDomain)}/${outputPath}`;
  if (typeof asset === "string") {
    return contentUrl;
  }

  const metadata: JsonObject = {};
  for (const [key, value] of Object.entries(assetObject)) {
    if (key === "path") {
      continue;
    }
    metadata[key] = value;
  }

  return {
    ...metadata,
    contentUrl,
  };
}

function claimOutputPath(claims: Map<string, string>, outputPath: string, source: string): void {
  const existing = claims.get(outputPath);
  if (existing && existing !== source) {
    throw new BuildError("Generated output path collision detected", {
      code: "OUTPUT_PATH_COLLISION",
      filePath: outputPath,
      generatedPath: outputPath,
      conflictingSource: existing,
      originalValue: source,
    });
  }
  claims.set(outputPath, source);
}

function buildRootIndex(
  config: ProjectConfig,
  instances: ResourceInstance[],
  rootDomain: string,
): GeneratedDocument {
  const resourceTypes = groupByResourceType(instances);
  const searchManifestLinks = [...resourceTypes.keys()]
    .filter((resourceType) => (config.resourceTypes[resourceType]?.searchAttributes ?? []).length > 0)
    .map((resourceType) => ({
      "@id": `${rootDomain}/${resourceType}/search`,
      "@type": "CollectionPage",
      name: `${resourceType} search`,
    }));

  return {
    outputPath: "index.json",
    urlPath: "/",
    document: {
      "@context": "https://schema.org",
      "@type": "CollectionPage",
      "@id": `${rootDomain}/`,
      name: config.apiName,
      version: config.apiVersion,
      hasPart: [...resourceTypes.keys()].map((resourceType) => ({
        "@id": `${rootDomain}/${resourceType}`,
        "@type": "CollectionPage",
        name: resourceType,
      })),
      about: searchManifestLinks,
    },
  };
}

function groupByResourceType(instances: ResourceInstance[]): Map<string, ResourceInstance[]> {
  const grouped = new Map<string, ResourceInstance[]>();
  for (const instance of instances) {
    const list = grouped.get(instance.resource.resourceType) ?? [];
    list.push(instance);
    grouped.set(instance.resource.resourceType, list);
  }
  return grouped;
}

function buildCollectionIndex(
  config: ProjectConfig,
  resourceType: string,
  instances: ResourceInstance[],
  rootDomain: string,
): GeneratedDocument {
  const sorted = [...instances].sort((a, b) =>
    a.resource.resourceId < b.resource.resourceId ? -1 : a.resource.resourceId > b.resource.resourceId ? 1 : 0,
  );

  const searchManifestLinks = (config.resourceTypes[resourceType]?.searchAttributes ?? []).length > 0
    ? [
        {
          "@id": `${rootDomain}/${resourceType}/search`,
          "@type": "CollectionPage",
          name: `${resourceType} search`,
        },
      ]
    : [];

  return {
    outputPath: `${resourceType}/index.json`,
    urlPath: `/${resourceType}`,
    document: {
      "@context": "https://schema.org",
      "@type": "CollectionPage",
      "@id": `${rootDomain}/${resourceType}`,
      name: `${resourceType} collection`,
      hasPart: sorted.map((instance) => ({
        "@id": `${rootDomain}/${instance.resource.resourceType}/${instance.resource.resourceId}`,
        "@type": getResourceReferenceType(instance),
        name: getResourceReferenceName(instance),
      })),
      about: searchManifestLinks,
    },
  };
}

function buildSearchIndexes(
  config: ProjectConfig,
  resourceType: string,
  instances: ResourceInstance[],
  rootDomain: string,
  claims: Map<string, string>,
): GeneratedDocument[] {
  const attributes = config.resourceTypes[resourceType]?.searchAttributes ?? [];
  if (attributes.length === 0) {
    return [];
  }

  const documents: GeneratedDocument[] = [];
  const manifest: JsonObject = {
    "@context": "https://schema.org",
    "@type": "CollectionPage",
    "@id": `${rootDomain}/${resourceType}/search`,
    name: `${resourceType} search`,
    about: [
      {
        "@id": `${rootDomain}/${resourceType}`,
        "@type": "CollectionPage",
        name: `${resourceType} collection`,
      },
    ],
    hasPart: [],
  };

  const attributeDocuments: JsonObject[] = [];

  for (const attribute of attributes) {
    const valuesToResources = new Map<
      string,
      { originalValue: string; resources: Array<{ resourceId: string; jsonLdType: string; name: string }> }
    >();

    for (const instance of instances) {
      const value = getPathValue(instance.resource.data, attribute);
      const primitives = collectPrimitiveIndexValues(value);
      for (const primitive of primitives) {
        const originalValue = String(primitive);
        const slug = toSearchSlug(originalValue);
        const existing = valuesToResources.get(slug);
        if (existing && existing.originalValue !== originalValue) {
          throw new BuildError("Search value normalization collision detected", {
            code: "SEARCH_COLLISION",
            fieldPath: attribute,
            resourceType,
            originalValue,
            normalizedValue: slug,
            conflictingSource: existing.originalValue,
          });
        }
        const entry = existing ?? { originalValue, resources: [] };
        entry.resources.push({
          resourceId: instance.resource.resourceId,
          jsonLdType: getResourceReferenceType(instance),
          name: getResourceReferenceName(instance),
        });
        valuesToResources.set(slug, entry);
      }
    }

    const attributeId = `${rootDomain}/${resourceType}/search/${attribute}`;
    const attributeDocument: JsonObject = {
      "@context": "https://schema.org",
      "@type": "CollectionPage",
      "@id": attributeId,
      name: `${resourceType} search by ${attribute}`,
      about: [
        {
          "@id": `${rootDomain}/${resourceType}`,
          "@type": "CollectionPage",
          name: `${resourceType} collection`,
        },
      ],
      hasPart: [],
    };

    for (const [slug, entry] of valuesToResources) {
      entry.resources = entry.resources.sort((a, b) =>
        a.resourceId < b.resourceId ? -1 : a.resourceId > b.resourceId ? 1 : 0,
      );
      const searchDoc: GeneratedDocument = {
        outputPath: `${resourceType}/search/${attribute}/${slug}/index.json`,
        urlPath: `/${resourceType}/search/${attribute}/${slug}`,
        document: {
          "@context": "https://schema.org",
          "@type": "CollectionPage",
          "@id": `${rootDomain}/${resourceType}/search/${attribute}/${slug}`,
          name: `${resourceType} ${attribute} ${entry.originalValue}`,
          about: [
            {
              "@id": `${rootDomain}/${resourceType}`,
              "@type": "CollectionPage",
              name: `${resourceType} collection`,
            },
          ],
          value: entry.originalValue,
          hasPart: entry.resources.map((resource) => ({
            "@id": `${rootDomain}/${resourceType}/${resource.resourceId}`,
            "@type": resource.jsonLdType,
            name: resource.name,
          })),
        },
      };
      claimOutputPath(claims, searchDoc.outputPath, searchDoc.urlPath);
      documents.push(searchDoc);

      (attributeDocument.hasPart as JsonValue[]).push({
        "@id": searchDoc.document["@id"] as string,
        "@type": "CollectionPage",
        name: entry.originalValue,
      });
    }

    const attributeGeneratedDoc: GeneratedDocument = {
      outputPath: `${resourceType}/search/${attribute}/index.json`,
      urlPath: `/${resourceType}/search/${attribute}`,
      document: attributeDocument,
    };
    claimOutputPath(claims, attributeGeneratedDoc.outputPath, attributeGeneratedDoc.urlPath);
    documents.push(attributeGeneratedDoc);

    attributeDocuments.push({
      "@id": attributeId,
      "@type": "CollectionPage",
      name: attribute,
    });
  }

  const manifestDoc: GeneratedDocument = {
    outputPath: `${resourceType}/search/index.json`,
    urlPath: `/${resourceType}/search`,
    document: {
      ...manifest,
      hasPart: attributeDocuments,
    },
  };
  claimOutputPath(claims, manifestDoc.outputPath, manifestDoc.urlPath);
  documents.push(manifestDoc);

  return documents;
}

function getPathValue(input: JsonValue | undefined, pathExpression: string): JsonValue | undefined {
  if (input === undefined) {
    return undefined;
  }

  const segments = pathExpression.split(".");
  let current: JsonValue | undefined = input;

  for (const segment of segments) {
    if (!current || typeof current !== "object" || Array.isArray(current)) {
      return undefined;
    }
    current = (current as JsonObject)[segment];
  }

  return current;
}

function getResourceReferenceType(instance: ResourceInstance): string {
  const declaredType = instance.resource.data.type ?? instance.resource.data["@type"];
  return typeof declaredType === "string" ? declaredType : "CreativeWork";
}

function getResourceReferenceName(instance: ResourceInstance): string {
  const name = instance.resource.data.name;
  return typeof name === "string" && name.length > 0 ? name : instance.resource.resourceId;
}

function collectPrimitiveIndexValues(value: JsonValue | undefined): Array<string | number | boolean> {
  if (typeof value === "string") {
    return value.length > 0 ? [value] : [];
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return [value];
  }
  if (Array.isArray(value)) {
    if (!value.every((item) => typeof item === "string" || typeof item === "number" || typeof item === "boolean")) {
      return [];
    }
    return value.filter((item): item is string | number | boolean =>
      (typeof item === "string" && item.length > 0) || typeof item === "number" || typeof item === "boolean",
    );
  }
  return [];
}

function buildDocsHtml(config: ProjectConfig, instances: ResourceInstance[], rootDomain: string): string {
  const grouped = [...groupByResourceType(instances).entries()].sort(([left], [right]) => left.localeCompare(right));
  const collectionLinks = grouped
    .map(([resourceType]) => `<li><code>${escapeHtml(rootDomain)}/${escapeHtml(resourceType)}</code></li>`)
    .join("");
  const examples = grouped.map(([resourceType, resourceInstances]) =>
    buildDocsSection(config, rootDomain, resourceType, resourceInstances)
  ).join("");

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>${escapeHtml(config.apiName)} Docs</title>
  </head>
  <body>
    <h1>${escapeHtml(config.apiName)}</h1>
    <p>Version ${escapeHtml(config.apiVersion)}</p>
    <h2>Root Index</h2>
    <p><code>${escapeHtml(rootDomain)}/</code></p>
    <h3>Example Response</h3>
    <pre><code>${escapeHtml(JSON.stringify(buildRootDocsExample(config, rootDomain, grouped.map(([resourceType]) => resourceType)), null, 2))}</code></pre>
    <h2>Collections</h2>
    <ul>${collectionLinks}</ul>
    ${examples}
  </body>
</html>`;
}

function buildDocsSection(
  config: ProjectConfig,
  rootDomain: string,
  resourceType: string,
  instances: ResourceInstance[],
): string {
  const firstInstance = instances[0];
  const resourceUrl = `${rootDomain}/${resourceType}${firstInstance ? `/${firstInstance.resource.resourceId}` : ""}`;
  const collectionUrl = `${rootDomain}/${resourceType}`;
  const searchManifestUrl = `${rootDomain}/${resourceType}/search`;
  const searchAttributes = config.resourceTypes[resourceType]?.searchAttributes ?? [];
  const sampleSearchAttribute = searchAttributes[0];
  const sampleSearchValue = firstInstance && sampleSearchAttribute
    ? firstSearchValue(getPathValue(firstInstance.resource.data, sampleSearchAttribute))
    : undefined;
  const searchValueUrl = sampleSearchAttribute && sampleSearchValue
    ? `${rootDomain}/${resourceType}/search/${sampleSearchAttribute}/${toSearchSlug(sampleSearchValue)}`
    : undefined;
  const versionUrl = firstInstance?.versions[0]
    ? `${rootDomain}/${resourceType}/${firstInstance.resource.resourceId}/versions/${firstInstance.versions[0].versionId}`
    : undefined;

  const sections = [
    renderDocsExample("Collection Index", collectionUrl, buildCollectionDocsExample(rootDomain, resourceType, instances)),
    renderDocsExample(
      "Resource Document",
      resourceUrl,
      firstInstance ? firstInstance.resource.data : { note: "No resource example available" },
    ),
    versionUrl
      ? renderDocsExample(
          "Version Document",
          versionUrl,
          {
            "@context": "https://schema.org",
            "@type": getVersionReferenceType(firstInstance),
            "@id": versionUrl,
            version: firstInstance?.versions[0]?.versionId ?? "",
          },
        )
      : "",
    searchAttributes.length > 0
      ? renderDocsExample(
          "Search Manifest",
          searchManifestUrl,
          buildSearchManifestDocsExample(rootDomain, resourceType, searchAttributes),
        )
      : "",
    searchValueUrl && sampleSearchAttribute && sampleSearchValue && firstInstance
      ? renderDocsExample(
          "Search Value Index",
          searchValueUrl,
          buildSearchValueDocsExample(rootDomain, resourceType, sampleSearchAttribute, sampleSearchValue, firstInstance),
        )
      : "",
  ].filter(Boolean).join("");

  return `
    <h2>${escapeHtml(resourceType)}</h2>
    <p>This section describes collection indexes, resource documents, version documents, and search indexes for <code>${escapeHtml(resourceType)}</code>.</p>
    ${sections}`;
}

function renderDocsExample(title: string, url: string, response: JsonObject): string {
  return `
    <h3>${escapeHtml(title)}</h3>
    <p>Example Request: <code>${escapeHtml(url)}</code></p>
    <p>Example Response:</p>
    <pre><code>${escapeHtml(JSON.stringify(response, null, 2))}</code></pre>`;
}

function buildRootDocsExample(config: ProjectConfig, rootDomain: string, resourceTypes: string[]): JsonObject {
  return {
    "@context": "https://schema.org",
    "@type": "CollectionPage",
    "@id": `${rootDomain}/`,
    name: config.apiName,
    version: config.apiVersion,
    hasPart: resourceTypes.map((resourceType) => ({
      "@id": `${rootDomain}/${resourceType}`,
      "@type": "CollectionPage",
      name: resourceType,
    })),
  };
}

function buildCollectionDocsExample(rootDomain: string, resourceType: string, instances: ResourceInstance[]): JsonObject {
  return {
    "@context": "https://schema.org",
    "@type": "CollectionPage",
    "@id": `${rootDomain}/${resourceType}`,
    name: `${resourceType} collection`,
    hasPart: instances.map((instance) => ({
      "@id": `${rootDomain}/${resourceType}/${instance.resource.resourceId}`,
      "@type": getResourceReferenceType(instance),
      name: getResourceReferenceName(instance),
    })),
  };
}

function buildSearchManifestDocsExample(rootDomain: string, resourceType: string, attributes: string[]): JsonObject {
  return {
    "@context": "https://schema.org",
    "@type": "CollectionPage",
    "@id": `${rootDomain}/${resourceType}/search`,
    name: `${resourceType} search`,
    about: [
      {
        "@id": `${rootDomain}/${resourceType}`,
        "@type": "CollectionPage",
        name: `${resourceType} collection`,
      },
    ],
    hasPart: attributes.map((attribute) => ({
      "@id": `${rootDomain}/${resourceType}/search/${attribute}`,
      "@type": "CollectionPage",
      name: attribute,
    })),
  };
}

function buildSearchValueDocsExample(
  rootDomain: string,
  resourceType: string,
  attribute: string,
  value: string,
  instance: ResourceInstance,
): JsonObject {
  return {
    "@context": "https://schema.org",
    "@type": "CollectionPage",
    "@id": `${rootDomain}/${resourceType}/search/${attribute}/${toSearchSlug(value)}`,
    name: `${resourceType} ${attribute} ${value}`,
    about: [
      {
        "@id": `${rootDomain}/${resourceType}`,
        "@type": "CollectionPage",
        name: `${resourceType} collection`,
      },
    ],
    value,
    hasPart: [
      {
        "@id": `${rootDomain}/${resourceType}/${instance.resource.resourceId}`,
        "@type": getResourceReferenceType(instance),
        name: getResourceReferenceName(instance),
      },
    ],
  };
}

function getVersionReferenceType(instance: ResourceInstance | undefined): string {
  const version = instance?.versions[0];
  if (!version) {
    return "CreativeWork";
  }
  const declaredType = version.data.type ?? version.data["@type"];
  return typeof declaredType === "string" ? declaredType : "CreativeWork";
}

function firstSearchValue(value: JsonValue | undefined): string | undefined {
  const primitives = collectPrimitiveIndexValues(value);
  if (primitives.length === 0) {
    return undefined;
  }
  return String(primitives[0]);
}

function resolveSearchDocumentSchema(outputPath: string): z.ZodType<JsonObject> {
  if (outputPath.endsWith("/search/index.json")) {
    return SearchManifestSchema;
  }
  const segments = outputPath.split("/");
  if (segments.includes("search")) {
    return segments.length === 5 ? SearchValueIndexSchema : SearchManifestSchema;
  }
  return SearchManifestSchema;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function validateGeneratedDocument(
  document: JsonObject,
  source: string,
  schema?: z.ZodType<JsonObject>,
): void {
  const baseResult = IndexDocumentSchema.safeParse(document);
  if (!baseResult.success) {
    throw zodIssueToBuildError(baseResult.error.issues[0], source, {});
  }

  if (schema) {
    const result = schema.safeParse(document);
    if (!result.success) {
      throw zodIssueToBuildError(result.error.issues[0], source, {});
    }
  }
}

async function writeArtifacts(
  cwd: string,
  documents: GeneratedDocument[],
  assets: GeneratedAsset[],
  config: ProjectConfig,
  mode: BuildMode,
): Promise<void> {
  const outRoot = path.join(cwd, "out");
  await fs.mkdir(outRoot, { recursive: true });

  for (const document of documents) {
    const targetPath = path.join(outRoot, document.outputPath);
    await fs.mkdir(path.dirname(targetPath), { recursive: true });

    if (document.outputPath.endsWith(".html")) {
      const html = document.document.html;
      if (!maybeString(html)) {
        throw new BuildError("Documentation HTML payload is invalid", {
          code: "INVALID_DOCS_HTML",
          filePath: targetPath,
        });
      }
      await fs.writeFile(targetPath, html, "utf8");
      continue;
    }

    const spacing = mode === "production" ? undefined : 2;
    await fs.writeFile(targetPath, JSON.stringify(document.document, null, spacing), "utf8");
  }

  for (const asset of assets) {
    const targetPath = path.join(outRoot, asset.outputPath);
    await fs.mkdir(path.dirname(targetPath), { recursive: true });
    await fs.copyFile(asset.sourcePath, targetPath);
  }
}

function structuredCloneJson<T extends JsonValue>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}
