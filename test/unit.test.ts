import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";

import { z } from "zod";

import { discoverSources } from "../src/core/discovery.js";
import { __test as engineTestHelpers, runBuild, syncBuildResult } from "../src/core/engine.js";
import { assertSafeResourceSegment, compareSemverDesc, ensureInsideRoot, toSearchSlug } from "../src/core/utils.js";
import type { GeneratedAsset, ProjectConfig, SchemaRegistry } from "../src/core/types.js";
import { loadYamlFile } from "../src/core/yaml.js";
import { makeFixture, makeTestConfig } from "./helpers.js";
import { projectDefinition } from "../src/project.js";

test("rejects multi-document YAML files", async () => {
  const cwd = await makeFixture({
    "resources/publishers/acme/index.yaml": "type: Organization\nname: First\n---\ntype: Organization\nname: Second\n",
  });

  await assert.rejects(
    () => loadYamlFile(path.join(cwd, "resources/publishers/acme/index.yaml")),
    (error: unknown) => error instanceof Error && error.message.includes("exactly one YAML document"),
  );
});

test("rejects YAML aliases and anchors", async () => {
  const cwd = await makeFixture({
    "resources/publishers/acme/index.yaml": [
      "type: Organization",
      "defaults: &base",
      "  name: Acme Games",
      "name: *base",
      "",
    ].join("\n"),
  });

  await assert.rejects(
    () => loadYamlFile(path.join(cwd, "resources/publishers/acme/index.yaml")),
    (error: unknown) => error instanceof Error && error.message.includes("anchors and aliases"),
  );
});

test("rejects invalid semantic version filenames during discovery", async () => {
  const cwd = await makeFixture({
    "resources/games/test/index.yaml": "type: SoftwareApplication\nname: Test Game\n",
    "resources/games/test/versions/one.yaml": "type: SoftwareSourceCode\nversion: one\n",
  });

  await assert.rejects(
    () => discoverSources(cwd, makeTestConfig({ games: {} })),
    (error: unknown) => error instanceof Error && error.message.includes("semantic versioning"),
  );
});

test("rejects invalid path casing during discovery", async () => {
  const cwd = await makeFixture({
    "resources/Games/test/index.yaml": "type: SoftwareApplication\nname: Test Game\n",
  });

  await assert.rejects(
    () => discoverSources(cwd, makeTestConfig({ games: {} })),
    (error: unknown) => error instanceof Error && error.message.includes("lowercase ASCII letters"),
  );
});

test("normalizes and bounds asset paths to the resources root", () => {
  const root = path.resolve("/tmp/example/resources");
  const inside = ensureInsideRoot(root, path.join(root, "games/test/file.zip"), "fixture.yaml", "path");
  assert.equal(inside, path.join(root, "games/test/file.zip"));

  assert.throws(
    () => ensureInsideRoot(root, path.join(root, "../outside.zip"), "fixture.yaml", "path"),
    /Path escapes the resources root/,
  );
});

test("rejects reserved resource path segments", () => {
  assert.throws(
    () => assertSafeResourceSegment("search", "Resource identifier", "resources/games/search"),
    /reserved generated path segment/,
  );
});

test("orders semantic versions descending", () => {
  const versions = ["1.0.0-beta.1", "1.0.0", "2.0.0", "1.2.0", "1.0.0-beta.2"];
  const sorted = [...versions].sort(compareSemverDesc);
  assert.deepEqual(sorted, ["2.0.0", "1.2.0", "1.0.0", "1.0.0-beta.2", "1.0.0-beta.1"]);
});

test("normalizes search values consistently", () => {
  assert.equal(toSearchSlug("Action RPG"), "action-rpg");
  assert.equal(toSearchSlug("C++"), "c");
});

test("detects output path collisions with detailed metadata", () => {
  const claims = new Map<string, string>();
  engineTestHelpers.claimOutputPath(claims, "games/test/index.json", "resources/games/test/index.yaml");

  assert.throws(
    () => engineTestHelpers.claimOutputPath(claims, "games/test/index.json", "resources/games/other/index.yaml"),
    (error: unknown) =>
      error instanceof Error && "generatedPath" in error && "conflictingSource" in error && "originalValue" in error,
  );
});

test("detects search normalization collisions with detailed metadata", () => {
  const claims = new Map<string, { originalValue: string; resources: string[] }>();
  const first = engineTestHelpers.claimSearchValueNormalization(claims, {
    attribute: "genre",
    resourceType: "games",
    originalValue: "C",
    normalizedValue: "c",
  });
  assert.equal(first.originalValue, "C");

  assert.throws(
    () =>
      engineTestHelpers.claimSearchValueNormalization(claims, {
        attribute: "genre",
        resourceType: "games",
        originalValue: "C++",
        normalizedValue: "c",
      }),
    (error: unknown) => error instanceof Error && "normalizedValue" in error && "conflictingSource" in error,
  );
});

test("resolves internal references to JSON-LD reference objects", () => {
  const target = engineTestHelpers.resolveReference(
    "/publishers/acme",
    new Map([
      [
        "/publishers/acme",
        {
          canonicalUrl: "https://example.com/publishers/acme",
          jsonLdType: "Organization",
          kind: "resource",
        },
      ],
    ]),
    "resources/games/test/index.yaml",
  );

  assert.deepEqual(target, {
    "@id": "https://example.com/publishers/acme",
    "@type": "Organization",
  });
});

test("builds asset output paths and metadata for version-owned assets", async () => {
  const cwd = await makeFixture({
    "resources/games/test/assets/test.zip": "zip payload",
  });

  const claims = new Map<string, string>();
  const assets: GeneratedAsset[] = [];
  const config: ProjectConfig = makeTestConfig({ games: {} });
  const resourcesRoot = path.join(cwd, "resources");

  const result = engineTestHelpers.copyAsset(
    cwd,
    resourcesRoot,
    config,
    claims,
    assets,
    {
      path: "/games/test/assets/test.zip",
      encodingFormat: "application/zip",
    },
    {
      resourceType: "games",
      resourceId: "test",
      versionId: "1.0.0",
    },
    "resources/games/test/versions/1.0.0.yaml",
  );

  assert.deepEqual(result, {
    encodingFormat: "application/zip",
    contentUrl: "https://example.com/games/test/versions/1.0.0/assets/test.zip",
  });
  assert.deepEqual(assets, [
    {
      sourcePath: path.join(cwd, "resources/games/test/assets/test.zip"),
      outputPath: "games/test/versions/1.0.0/assets/test.zip",
      urlPath: "/games/test/versions/1.0.0/assets/test.zip",
    },
  ]);
});

test("collects recognized YAML files and versions from the canonical layout", async () => {
  const cwd = await makeFixture({
    "resources/games/test/index.yaml": "type: SoftwareApplication\nname: Test Game\n",
    "resources/games/test/versions/1.0.0.yaml": "type: SoftwareSourceCode\nversion: 1.0.0\n",
  });

  const instances = await discoverSources(cwd, makeTestConfig({ games: {} }));
  assert.equal(instances.length, 1);
  assert.equal(instances[0]?.resource.resourceType, "games");
  assert.equal(instances[0]?.versions[0]?.versionId, "1.0.0");
});

test("delete and modify rebuild flows update generated output", async () => {
  const registry: SchemaRegistry = {
    games: {
      resourceSchema: z.object({
        type: z.literal("SoftwareApplication"),
        name: z.string(),
      }),
      resourceJsonLdType: "SoftwareApplication",
      allowedResourceTypes: ["SoftwareApplication"],
      compileResource({ resource, helper }) {
        return helper.makeJsonLdDocument("SoftwareApplication", {
          name: resource.data.name as string,
        });
      },
    },
  };

  const cwd = await makeFixture({
    "resources/games/alpha/index.yaml": "type: SoftwareApplication\nname: Alpha\n",
    "resources/games/beta/index.yaml": "type: SoftwareApplication\nname: Beta\n",
  });

  await runBuild({ cwd, write: true, config: makeTestConfig({ games: {} }), mode: "development" }, registry);
  let collection = JSON.parse(await fs.readFile(path.join(cwd, "out/games/index.json"), "utf8"));
  assert.equal(collection.hasPart.length, 2);

  await fs.writeFile(
    path.join(cwd, "resources/games/alpha/index.yaml"),
    "type: SoftwareApplication\nname: Alpha Prime\n",
    "utf8",
  );
  await runBuild({ cwd, write: true, config: makeTestConfig({ games: {} }), mode: "development" }, registry);

  const alpha = JSON.parse(await fs.readFile(path.join(cwd, "out/games/alpha/index.json"), "utf8"));
  assert.equal(alpha.name, "Alpha Prime");

  await fs.rm(path.join(cwd, "resources/games/beta"), { recursive: true, force: true });
  await runBuild({ cwd, write: true, config: makeTestConfig({ games: {} }), mode: "development" }, registry);

  collection = JSON.parse(await fs.readFile(path.join(cwd, "out/games/index.json"), "utf8"));
  assert.equal(collection.hasPart.length, 1);
  await assert.rejects(() => fs.readFile(path.join(cwd, "out/games/beta/index.json"), "utf8"));
});

test("incremental sync rewrites only changed outputs and removes deleted outputs", async () => {
  const registry: SchemaRegistry = {
    games: {
      resourceSchema: z.object({
        type: z.literal("SoftwareApplication"),
        name: z.string(),
      }),
      resourceJsonLdType: "SoftwareApplication",
      allowedResourceTypes: ["SoftwareApplication"],
      compileResource({ resource, helper }) {
        return helper.makeJsonLdDocument("SoftwareApplication", {
          name: resource.data.name as string,
        });
      },
    },
  };

  const cwd = await makeFixture({
    "resources/games/alpha/index.yaml": "type: SoftwareApplication\nname: Alpha\n",
    "resources/games/beta/index.yaml": "type: SoftwareApplication\nname: Beta\n",
  });

  const initial = await runBuild(
    { cwd, write: true, config: makeTestConfig({ games: {} }), mode: "development" },
    registry,
  );

  const alphaOut = path.join(cwd, "out/games/alpha/index.json");
  const betaOut = path.join(cwd, "out/games/beta/index.json");
  const beforeAlpha = await fs.stat(alphaOut);
  const beforeBeta = await fs.stat(betaOut);

  await new Promise((resolve) => setTimeout(resolve, 20));
  await fs.writeFile(
    path.join(cwd, "resources/games/alpha/index.yaml"),
    "type: SoftwareApplication\nname: Alpha Prime\n",
    "utf8",
  );

  const modified = await runBuild(
    { cwd, write: false, config: makeTestConfig({ games: {} }), mode: "development" },
    registry,
  );
  await syncBuildResult(cwd, initial, modified);

  const afterAlpha = await fs.stat(alphaOut);
  const afterBeta = await fs.stat(betaOut);
  assert.ok(afterAlpha.mtimeMs > beforeAlpha.mtimeMs);
  assert.equal(afterBeta.mtimeMs, beforeBeta.mtimeMs);

  await new Promise((resolve) => setTimeout(resolve, 20));
  await fs.rm(path.join(cwd, "resources/games/beta"), { recursive: true, force: true });

  const deleted = await runBuild(
    { cwd, write: false, config: makeTestConfig({ games: {} }), mode: "development" },
    registry,
  );
  await syncBuildResult(cwd, modified, deleted);

  await assert.rejects(() => fs.readFile(betaOut, "utf8"));
  const alphaContent = JSON.parse(await fs.readFile(alphaOut, "utf8"));
  assert.equal(alphaContent.name, "Alpha Prime");
});

// Schema Evolution Tests
test("backwards compatibility: old game resource without optional fields parses with new schema", () => {
  const oldGameData = {
    type: "SoftwareApplication",
    name: "Legacy Game",
    description: "A game from the past",
    genre: "Adventure",
    publisher: "/publishers/acme",
    url: "https://example.com/legacy",
  };

  const registry = projectDefinition.schemaRegistry;
  assert(registry.games, "games registry must be defined");
  const result = registry.games.resourceSchema.safeParse(oldGameData);
  assert.equal(result.success, true);
  assert.equal(result.data.name, "Legacy Game");
});

test("backwards compatibility: old game version without optional fields parses with new schema", () => {
  const oldVersionData = {
    type: "SoftwareSourceCode",
    version: "1.0.0",
    datePublished: "2023-01-01",
    releaseNotes: "Initial release",
    files: [
      {
        name: "legacy-1.0.0-macos.dmg",
        path: "legacy-1.0.0-macos.dmg",
        encodingFormat: "application/x-apple-diskimage",
        license: "https://example.com/license",
      },
    ],
  };

  const registry = projectDefinition.schemaRegistry;
  assert(registry.games, "games registry must be defined");
  assert(registry.games.versionSchema, "games versionSchema must be defined");
  const result = registry.games.versionSchema.safeParse(oldVersionData);
  assert.equal(result.success, true);
  assert.equal(result.data.version, "1.0.0");
});

test("breaking change detection: adding required field to schema fails old data", () => {
  // Simulate a new schema that requires 'image' field
  const newSchema = z.object({
    type: z.literal("SoftwareApplication"),
    name: z.string().min(1).max(256),
    description: z.string().min(1).max(256),
    genre: z.string().min(1).max(64),
    publisher: z.string().min(3).max(256),
    url: z.string().min(1).max(256),
    image: z.string().min(1).max(256), // Now required
    tags: z.array(z.string().min(1).max(64)).min(1).max(8).optional(),
  });

  const oldGameData = {
    type: "SoftwareApplication",
    name: "Legacy Game",
    description: "A game from the past",
    genre: "Adventure",
    publisher: "/publishers/acme",
    url: "https://example.com/legacy",
    // No image field
  };

  const result = newSchema.safeParse(oldGameData);
  assert.equal(result.success, false);
  assert.ok(result.error.issues.some((issue) => issue.path.includes("image")));
});

test("optional field addition: new optional fields don't break old data", () => {
  // Simulate adding an optional 'rating' field
  const evolvedSchema = z.object({
    type: z.literal("SoftwareApplication"),
    name: z.string().min(1).max(256),
    description: z.string().min(1).max(256),
    genre: z.string().min(1).max(64),
    publisher: z.string().min(3).max(256),
    url: z.string().min(1).max(256),
    image: z.string().min(1).max(256).optional(),
    tags: z.array(z.string().min(1).max(64)).min(1).max(8).optional(),
    rating: z.number().min(0).max(5).optional(), // New optional field
  });

  const oldGameData = {
    type: "SoftwareApplication",
    name: "Legacy Game",
    description: "A game from the past",
    genre: "Adventure",
    publisher: "/publishers/acme",
    url: "https://example.com/legacy",
  };

  const result = evolvedSchema.safeParse(oldGameData);
  assert.equal(result.success, true);
  assert.equal(result.data.rating, undefined); // Optional field not present
});
