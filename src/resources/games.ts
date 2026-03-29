import { z } from "zod";

import type { JsonObject, ResourceTypeDefinition } from "../core/types.js";
import { resolvePublicUrl } from "../core/utils.js";

const HttpsUrl = z.string().min(8).max(256).startsWith("https://");
const PublicUrl = z.union([HttpsUrl, z.string().min(1).max(256).startsWith("/")]);

const GameSchema = z.object({
  type: z.literal("SoftwareApplication"),
  name: z.string().min(1).max(256),
  description: z.string().min(1).max(256),
  genre: z.string().min(1).max(64),
  publisher: z.string().min(3).max(256),
  url: PublicUrl,
  image: PublicUrl.optional(),
  tags: z.array(z.string().min(1).max(64)).min(1).max(8).optional(),
});

const GameFileSchema = z.object({
  name: z.string().min(1).max(128),
  path: z.string().min(3).max(256),
  encodingFormat: z.string().min(1).max(128),
  license: HttpsUrl,
  operatingSystem: z.string().min(1).max(64).optional(),
});

const GameVersionSchema = z.object({
  type: z.literal("SoftwareSourceCode"),
  version: z.string().min(1).max(64),
  datePublished: z.string().min(1).max(64),
  releaseNotes: z.string().min(1).max(256),
  files: z.array(GameFileSchema).min(1).max(16),
});

const GameOutputSchema = z.object({
  "@context": z.string(),
  "@type": z.literal("SoftwareApplication"),
  "@id": z.string().url(),
  name: z.string(),
  description: z.string(),
  applicationCategory: z.string(),
  keywords: z.array(z.string()),
  publisher: z.object({
    "@id": z.string().url(),
    "@type": z.literal("Organization"),
  }),
  url: z.string().url(),
  image: z.string().url().nullable(),
  versions: z.array(
    z.object({
      "@id": z.string().url(),
      "@type": z.literal("SoftwareSourceCode"),
    }),
  ),
  latestVersion: z
    .object({
      "@id": z.string().url(),
      "@type": z.literal("SoftwareSourceCode"),
    })
    .nullable(),
});

const GameVersionOutputSchema = z.object({
  "@context": z.string(),
  "@type": z.literal("SoftwareSourceCode"),
  "@id": z.string().url(),
  name: z.string(),
  version: z.string(),
  datePublished: z.string(),
  releaseNotes: z.string(),
  isPartOf: z.object({
    "@id": z.string().url(),
    "@type": z.literal("SoftwareApplication"),
  }),
  distribution: z.array(
    z.object({
      "@type": z.literal("DataDownload"),
      name: z.string(),
      contentUrl: z.string().url(),
      encodingFormat: z.string(),
      license: z.string().url(),
      operatingSystem: z.string().optional(),
    }),
  ),
});

export const gamesResourceType: ResourceTypeDefinition = {
  resourceSchema: GameSchema,
  versionSchema: GameVersionSchema,
  resourceJsonLdType: "SoftwareApplication",
  versionJsonLdType: "SoftwareSourceCode",
  allowedResourceTypes: ["SoftwareApplication"],
  allowedVersionTypes: ["SoftwareSourceCode"],
  resourceOutputSchema: GameOutputSchema,
  versionOutputSchema: GameVersionOutputSchema,
  compileResource({ resource, helper }) {
    const latestVersion = helper.latestVersionReference();

    return helper.makeJsonLdDocument("SoftwareApplication", {
      name: resource.data.name as string,
      description: resource.data.description as string,
      applicationCategory: resource.data.genre as string,
      keywords: (resource.data.tags as string[] | undefined) ?? [],
      publisher: helper.resolveInternalReference(resource.data.publisher as string),
      url: resolvePublicUrl(helper.rootDomain(), resource.data.url as string),
      image: resource.data.image ? resolvePublicUrl(helper.rootDomain(), resource.data.image as string) : null,
      versions: helper.versionReferences(),
      latestVersion: latestVersion ?? null,
    });
  },
  compileVersion({ resource, version, helper }) {
    return helper.makeJsonLdDocumentAt(helper.versionUrl(version.versionId), "SoftwareSourceCode", {
      name: `${resource.data.name as string} ${version.data.version as string}`,
      version: version.data.version as string,
      datePublished: version.data.datePublished as string,
      releaseNotes: version.data.releaseNotes as string,
      isPartOf: helper.toReferenceObject(helper.resourceUrl(), "SoftwareApplication"),
      distribution: (version.data.files as Array<Record<string, string | undefined>>).map((file) => ({
        "@type": "DataDownload",
        name: file.name as string,
        ...(helper.copyAsset(
          {
            path: file.path as string,
            encodingFormat: file.encodingFormat as string,
            license: file.license as string,
            ...(file.operatingSystem ? { operatingSystem: file.operatingSystem } : {}),
          },
          {
            resourceType: version.resourceType,
            resourceId: version.resourceId,
            versionId: version.versionId,
          },
        ) as JsonObject),
      })),
    });
  },
};
