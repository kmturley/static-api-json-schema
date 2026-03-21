import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";

import { z } from "zod";

import { runBuild } from "../src/core/engine.js";
import type { JsonObject, ProjectConfig, SchemaRegistry } from "../src/core/types.js";

const registry: SchemaRegistry = {
  games: {
    resourceSchema: z.object({
      type: z.literal("SoftwareApplication"),
      name: z.string(),
      genre: z.string().optional(),
      publisher: z.string().optional(),
    }),
    versionSchema: z.object({
      type: z.literal("SoftwareSourceCode"),
      version: z.string(),
      datePublished: z.string(),
    }),
    resourceJsonLdType: "SoftwareApplication",
    versionJsonLdType: "SoftwareSourceCode",
    allowedResourceTypes: ["SoftwareApplication"],
    allowedVersionTypes: ["SoftwareSourceCode"],
    compileResource({ resource, helper }) {
      const fields: JsonObject = {
        name: resource.data.name as string,
        versions: helper.versionReferences(),
      };
      if (resource.data.genre) {
        fields.genre = resource.data.genre as string;
      }
      if (resource.data.publisher) {
        fields.publisher = helper.resolveInternalReference(resource.data.publisher as string);
      }
      const latest = helper.latestVersionReference();
      if (latest) {
        fields.latestVersion = latest;
      }
      return helper.makeJsonLdDocument("SoftwareApplication", fields);
    },
    compileVersion({ version, helper }) {
      return helper.makeJsonLdDocumentAt(helper.versionUrl(version.versionId), "SoftwareSourceCode", {
        version: version.data.version as string,
        datePublished: version.data.datePublished as string,
      });
    },
  },
  publishers: {
    resourceSchema: z.object({
      type: z.literal("Organization"),
      name: z.string(),
    }),
    resourceJsonLdType: "Organization",
    allowedResourceTypes: ["Organization"],
    compileResource({ resource, helper }) {
      return helper.makeJsonLdDocument("Organization", {
        name: resource.data.name as string,
      });
    },
  },
};

test("builds resources, versions, latest alias, and search indexes", async () => {
  const cwd = await makeFixture({
    "resources/publishers/acme/index.yaml": "type: Organization\nname: Acme Games\n",
    "resources/games/test/index.yaml": "type: SoftwareApplication\nname: Test Game\ngenre: Action\npublisher: /publishers/acme\n",
    "resources/games/test/versions/1.2.0.yaml": "type: SoftwareSourceCode\nversion: 1.2.0\ndatePublished: 2024-01-01\n",
    "resources/games/test/versions/1.1.0.yaml": "type: SoftwareSourceCode\nversion: 1.1.0\ndatePublished: 2023-01-01\n",
  });

  const result = await runBuild({ cwd, write: true, config: makeTestConfig(), mode: "development" }, registry);

  assert.ok(result.documents.some((document) => document.outputPath === "games/test/versions/latest/index.json"));
  assert.ok(result.documents.some((document) => document.outputPath === "games/search/genre/action/index.json"));

  const latest = JSON.parse(
    await fs.readFile(path.join(cwd, "out/games/test/versions/latest/index.json"), "utf8"),
  );
  assert.equal(latest["@id"], "https://example.com/games/test/versions/latest");

  const rootIndex = JSON.parse(await fs.readFile(path.join(cwd, "out/index.json"), "utf8"));
  assert.equal(rootIndex.name, "Example API");
});

test("writes formatted JSON in development mode and minified JSON in production mode", async () => {
  const cwd = await makeFixture({
    "resources/publishers/acme/index.yaml": "type: Organization\nname: Acme Games\n",
  });

  await runBuild({ cwd, write: true, config: makeTestConfig({ publishers: {} }), mode: "development" }, registry);
  const developmentJson = await fs.readFile(path.join(cwd, "out/publishers/acme/index.json"), "utf8");
  assert.match(developmentJson, /\n  "@context":/);

  await runBuild({ cwd, write: true, config: makeTestConfig({ publishers: {} }), mode: "production" }, registry);
  const productionJson = await fs.readFile(path.join(cwd, "out/publishers/acme/index.json"), "utf8");
  assert.doesNotMatch(productionJson, /\n  "@context":/);
  assert.ok(!productionJson.includes("\n"));
});

test("fails on duplicate YAML keys", async () => {
  const cwd = await makeFixture({
    "resources/publishers/acme/index.yaml": "type: Organization\nname: Acme\nname: Duplicate\n",
  });

  await assert.rejects(() => runBuild({ cwd, write: false, config: makeTestConfig({ publishers: {} }) }, registry));
});

async function makeFixture(files: Record<string, string>): Promise<string> {
  const cwd = await fs.mkdtemp(path.join(os.tmpdir(), "static-api-json-schema-"));
  for (const [relativePath, content] of Object.entries(files)) {
    const fullPath = path.join(cwd, relativePath);
    await fs.mkdir(path.dirname(fullPath), { recursive: true });
    await fs.writeFile(fullPath, content, "utf8");
  }
  return cwd;
}

function makeTestConfig(resourceTypes: ProjectConfig["resourceTypes"] = {
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
