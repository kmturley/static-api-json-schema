import { z } from "zod";

import { projectDefinition } from "../project.js";
import { BuildError } from "./errors.js";
import type { ProjectConfig } from "./types.js";
import { normalizeRootDomain } from "./utils.js";

const ConfigSchema = z.object({
  apiName: z.string().min(1).max(256),
  apiVersion: z.string().min(1).max(64),
  rootDomain: z.url().transform(normalizeRootDomain),
  resourcesRoot: z.string().min(1).default("resources"),
  resourceTypes: z
    .record(
      z.string().regex(/^[a-z0-9-]+$/),
      z.object({
        searchAttributes: z.array(z.string().min(1)).optional(),
      }),
    )
    .default({}),
});

export async function loadProjectConfig(): Promise<ProjectConfig> {
  const result = ConfigSchema.safeParse(projectDefinition.config);
  if (!result.success) {
    const issue = result.error.issues[0];
    if (!issue) {
      throw new BuildError("Invalid project config", {
        code: "INVALID_CONFIG",
        filePath: "src/project.ts",
      });
    }
    throw new BuildError(`Invalid project config: ${issue.message}`, {
      code: "INVALID_CONFIG",
      filePath: "src/project.ts",
      fieldPath: issue.path.join("."),
    });
  }

  return result.data;
}
