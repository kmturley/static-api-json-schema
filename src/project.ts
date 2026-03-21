import type { ProjectConfig, SchemaRegistry } from "./core/types.js";

import { gamesResourceType } from "./resources/games.js";
import { publishersResourceType } from "./resources/publishers.js";

export interface ProjectDefinition {
  config: ProjectConfig;
  schemaRegistry: SchemaRegistry;
}

export const projectDefinition: ProjectDefinition = {
  config: {
    apiName: "Static API JSON Schema",
    apiVersion: "0.1.0",
    rootDomain: "https://example.com",
    resourcesRoot: "resources",
    resourceTypes: {
      games: {
        searchAttributes: ["genre", "tags"],
      },
      publishers: {},
    },
  },
  schemaRegistry: {
    games: gamesResourceType,
    publishers: publishersResourceType,
  },
};
