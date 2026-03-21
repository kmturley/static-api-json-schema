import { z } from "zod";

import type { ResourceTypeDefinition } from "../core/types.js";

const HttpsUrl = z.string().min(8).max(256).startsWith("https://");

const PublisherSchema = z.object({
  type: z.literal("Organization"),
  name: z.string().min(1).max(256),
  description: z.string().min(1).max(256),
  url: HttpsUrl,
});

export const publishersResourceType: ResourceTypeDefinition = {
  resourceSchema: PublisherSchema,
  resourceJsonLdType: "Organization",
  allowedResourceTypes: ["Organization"],
  compileResource({ resource, helper }) {
    return helper.makeJsonLdDocument("Organization", {
      name: resource.data.name as string,
      description: resource.data.description as string,
      url: resource.data.url as string,
    });
  },
};
