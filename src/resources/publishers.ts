import { z } from "zod";

import type { ResourceTypeDefinition } from "../core/types.js";
import { resolvePublicUrl } from "../core/utils.js";

const HttpsUrl = z.string().min(8).max(256).startsWith("https://");
const PublicUrl = z.union([HttpsUrl, z.string().min(1).max(256).startsWith("/")]);

const PublisherSchema = z.object({
  type: z.literal("Organization"),
  name: z.string().min(1).max(256),
  description: z.string().min(1).max(256),
  url: PublicUrl,
});

const PublisherOutputSchema = z.object({
  "@context": z.string(),
  "@type": z.literal("Organization"),
  "@id": z.string().url(),
  name: z.string(),
  description: z.string(),
  url: z.string().url(),
});

export const publishersResourceType: ResourceTypeDefinition = {
  resourceSchema: PublisherSchema,
  resourceJsonLdType: "Organization",
  allowedResourceTypes: ["Organization"],
  resourceOutputSchema: PublisherOutputSchema,
  compileResource({ resource, helper }) {
    return helper.makeJsonLdDocument("Organization", {
      name: resource.data.name as string,
      description: resource.data.description as string,
      url: resolvePublicUrl(helper.rootDomain(), resource.data.url as string),
    });
  },
};
