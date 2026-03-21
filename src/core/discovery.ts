import fs from "node:fs/promises";
import path from "node:path";

import { BuildError } from "./errors.js";
import type { ProjectConfig, ResourceInstance, ResourceSource, VersionSource } from "./types.js";
import { assertSafeResourceSegment, assertSafeVersionSegment, assertSemver } from "./utils.js";

export async function discoverSources(cwd: string, config: ProjectConfig): Promise<ResourceInstance[]> {
  const resourcesRoot = path.resolve(cwd, config.resourcesRoot);

  let rootEntries;
  try {
    rootEntries = await fs.readdir(resourcesRoot, { withFileTypes: true });
  } catch {
    throw new BuildError("Required source directory cannot be read", {
      code: "UNREADABLE_DIRECTORY",
      filePath: resourcesRoot,
    });
  }

  const discoveredYaml = new Set<string>();
  const resources: ResourceSource[] = [];
  const versions: VersionSource[] = [];

  for (const resourceTypeEntry of rootEntries) {
    if (!resourceTypeEntry.isDirectory()) {
      continue;
    }

    const resourceType = resourceTypeEntry.name;
    const resourceTypePath = path.join(resourcesRoot, resourceType);
    assertSafeResourceSegment(resourceType, "Resource type", resourceTypePath);

    const resourceEntries = await fs.readdir(resourceTypePath, { withFileTypes: true });

    for (const resourceEntry of resourceEntries) {
      if (!resourceEntry.isDirectory()) {
        continue;
      }

      const resourceId = resourceEntry.name;
      const resourceRoot = path.join(resourceTypePath, resourceId);
      assertSafeResourceSegment(resourceId, "Resource identifier", resourceRoot);

      const indexYamlPath = path.join(resourceRoot, "index.yaml");
      const indexStat = await statIfExists(indexYamlPath);
      if (!indexStat?.isFile()) {
        throw new BuildError("Resource root must contain index.yaml", {
          code: "MISSING_PRIMARY_YAML",
          filePath: resourceRoot,
          resourceType,
          resourceId,
        });
      }

      resources.push({
        kind: "resource",
        filePath: indexYamlPath,
        resourceType,
        resourceId,
      });
      discoveredYaml.add(indexYamlPath);

      const versionsDir = path.join(resourceRoot, "versions");
      const versionsStat = await statIfExists(versionsDir);
      if (versionsStat?.isDirectory()) {
        const versionEntries = await fs.readdir(versionsDir, { withFileTypes: true });
        for (const versionEntry of versionEntries) {
          if (!versionEntry.isFile() || path.extname(versionEntry.name) !== ".yaml") {
            continue;
          }

          const versionId = path.basename(versionEntry.name, ".yaml");
          const versionFilePath = path.join(versionsDir, versionEntry.name);
          assertSafeVersionSegment(versionId, versionFilePath);
          assertSemver(versionId, versionFilePath);

          versions.push({
            kind: "version",
            filePath: versionFilePath,
            resourceType,
            resourceId,
            versionId,
          });
          discoveredYaml.add(versionFilePath);
        }
      }
    }
  }

  const allYamlFiles = await walkYamlFiles(resourcesRoot);
  for (const yamlPath of allYamlFiles) {
    if (!discoveredYaml.has(yamlPath)) {
      throw new BuildError("YAML file is outside the recognized resource layout", {
        code: "UNRECOGNIZED_LAYOUT",
        filePath: yamlPath,
      });
    }
  }

  const byResource = new Map<string, ResourceInstance>();

  for (const resource of resources) {
    const key = `${resource.resourceType}/${resource.resourceId}`;
    byResource.set(key, { resource: { ...resource, data: {} }, versions: [] });
  }

  for (const version of versions) {
    const key = `${version.resourceType}/${version.resourceId}`;
    const instance = byResource.get(key);
    if (!instance) {
      throw new BuildError("Version file was discovered without a matching primary resource", {
        code: "ORPHAN_VERSION",
        filePath: version.filePath,
        resourceType: version.resourceType,
        resourceId: version.resourceId,
        versionId: version.versionId,
      });
    }
    instance.versions.push({ ...version, data: {} });
  }

  return [...byResource.values()];
}

async function statIfExists(filePath: string) {
  try {
    return await fs.stat(filePath);
  } catch {
    return undefined;
  }
}

async function walkYamlFiles(rootPath: string): Promise<string[]> {
  const result: string[] = [];
  const stack = [rootPath];

  while (stack.length > 0) {
    const current = stack.pop();
    if (!current) {
      break;
    }

    const entries = await fs.readdir(current, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(fullPath);
      } else if (entry.isFile() && path.extname(entry.name) === ".yaml") {
        result.push(fullPath);
      }
    }
  }

  return result;
}
