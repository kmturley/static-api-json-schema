import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import type { ProjectConfig } from "../src/core/types.js";

export async function makeFixture(files: Record<string, string>): Promise<string> {
  const cwd = await fs.mkdtemp(path.join(os.tmpdir(), "static-api-json-schema-"));
  for (const [relativePath, content] of Object.entries(files)) {
    const fullPath = path.join(cwd, relativePath);
    await fs.mkdir(path.dirname(fullPath), { recursive: true });
    await fs.writeFile(fullPath, content, "utf8");
  }
  return cwd;
}

export function makeTestConfig(resourceTypes: ProjectConfig["resourceTypes"] = {
  games: {
    searchAttributes: ["genre"],
  },
  publishers: {},
}): ProjectConfig {
  return {
    apiName: "Example API",
    apiVersion: "1.0.0",
    rootDomain: "https://example.com",
    resourcesRoot: "resources",
    resourceTypes,
  };
}
