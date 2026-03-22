import type { z } from "zod";

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonObject | JsonValue[];
export type JsonObject = { [key: string]: JsonValue };

export interface ResourceTypeConfig {
  searchAttributes?: string[];
}

export interface ProjectConfig {
  apiName: string;
  apiVersion: string;
  rootDomain: string;
  resourcesRoot: string;
  resourceTypes: Record<string, ResourceTypeConfig>;
}

export type BuildMode = "development" | "production";

export interface ResourceSource {
  kind: "resource";
  filePath: string;
  resourceType: string;
  resourceId: string;
}

export interface VersionSource {
  kind: "version";
  filePath: string;
  resourceType: string;
  resourceId: string;
  versionId: string;
}

export interface LoadedResourceSource extends ResourceSource {
  data: JsonObject;
}

export interface LoadedVersionSource extends VersionSource {
  data: JsonObject;
}

export interface ResourceInstance {
  resource: LoadedResourceSource;
  versions: LoadedVersionSource[];
}

export interface ReferenceObject extends JsonObject {
  "@id": string;
  "@type": string;
}

export interface AssetInput {
  path: string;
  [key: string]: JsonValue;
}

export interface GeneratedDocument {
  outputPath: string;
  urlPath: string;
  document: JsonObject;
}

export interface GeneratedAsset {
  sourcePath: string;
  outputPath: string;
  urlPath: string;
}

export interface ResourceBuildArtifacts {
  resourceDocument: GeneratedDocument;
  versionDocuments: GeneratedDocument[];
  versionIndexDocument?: GeneratedDocument;
  latestDocument?: GeneratedDocument;
  assets: GeneratedAsset[];
}

export interface ReferenceTarget {
  canonicalUrl: string;
  jsonLdType: string;
  kind: "resource" | "version";
}

export interface CompileHelpers {
  makeJsonLdDocument(documentType: string, fields: JsonObject): JsonObject;
  makeJsonLdDocumentAt(url: string, documentType: string, fields: JsonObject): JsonObject;
  resolveInternalReference(referencePath: string): ReferenceObject;
  resolveInternalReferences(referencePaths: string[]): ReferenceObject[];
  copyAsset(
    asset: string | AssetInput,
    owner:
      | { resourceType: string; resourceId: string }
      | { resourceType: string; resourceId: string; versionId: string },
  ): string | JsonObject;
  toReferenceObject(url: string, jsonLdType: string): ReferenceObject;
  resourceUrl(): string;
  versionUrl(versionId: string): string;
  latestVersionReference(): ReferenceObject | undefined;
  versionReferences(): ReferenceObject[];
  versionIndexUrl(): string | undefined;
}

export interface CompileContext<R extends JsonObject, V extends JsonObject> {
  resource: LoadedResourceSource & { data: R };
  versions: Array<LoadedVersionSource & { data: V }>;
  helper: CompileHelpers;
}

export interface ResourceTypeDefinition<R extends JsonObject = JsonObject, V extends JsonObject = JsonObject> {
  resourceSchema: z.ZodType<R>;
  versionSchema?: z.ZodType<V>;
  resourceJsonLdType: string | ((resource: R) => string);
  versionJsonLdType?: string | ((version: V) => string);
  allowedResourceTypes?: string[];
  allowedVersionTypes?: string[];
  resourceOutputSchema?: z.ZodType<JsonObject>;
  versionOutputSchema?: z.ZodType<JsonObject>;
  compileResource(context: CompileContext<R, V>): JsonObject;
  compileVersion?(context: {
    resource: LoadedResourceSource & { data: R };
    version: LoadedVersionSource & { data: V };
    helper: CompileHelpers;
  }): JsonObject;
}

export type SchemaRegistry = Record<string, ResourceTypeDefinition>;
