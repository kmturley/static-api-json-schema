import { z } from "zod";

import type { JsonObject, ResourceTypeDefinition } from "../core/types.js";

const HttpsUrl = z.string().min(8).max(256).startsWith("https://");

const GameSchema = z.object({
  type: z.literal("SoftwareApplication"),
  name: z.string().min(1).max(256),
  description: z.string().min(1).max(256),
  genre: z.string().min(1).max(64),
  publisher: z.string().min(3).max(256),
  url: HttpsUrl,
  image: HttpsUrl.optional(),
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

export const gamesResourceType: ResourceTypeDefinition = {
  resourceSchema: GameSchema,
  versionSchema: GameVersionSchema,
  resourceJsonLdType: "SoftwareApplication",
  versionJsonLdType: "SoftwareSourceCode",
  allowedResourceTypes: ["SoftwareApplication"],
  allowedVersionTypes: ["SoftwareSourceCode"],
  compileResource({ resource, helper }) {
    const latestVersion = helper.latestVersionReference();

    return helper.makeJsonLdDocument("SoftwareApplication", {
      name: resource.data.name as string,
      description: resource.data.description as string,
      applicationCategory: resource.data.genre as string,
      keywords: (resource.data.tags as string[] | undefined) ?? [],
      publisher: helper.resolveInternalReference(resource.data.publisher as string),
      url: resource.data.url as string,
      image: (resource.data.image as string | undefined) ?? null,
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
