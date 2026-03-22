import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";

import { z } from "zod";

import { runBuild } from "../src/core/engine.js";
import type { JsonObject, SchemaRegistry } from "../src/core/types.js";
import { makeFixture, makeTestConfig } from "./helpers.js";

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
    "resources/games/test/index.yaml":
      "type: SoftwareApplication\nname: Test Game\ngenre: Action\npublisher: /publishers/acme\n",
    "resources/games/test/versions/1.2.0.yaml": "type: SoftwareSourceCode\nversion: 1.2.0\ndatePublished: 2024-01-01\n",
    "resources/games/test/versions/1.1.0.yaml": "type: SoftwareSourceCode\nversion: 1.1.0\ndatePublished: 2023-01-01\n",
  });

  const result = await runBuild({ cwd, write: true, config: makeTestConfig(), mode: "development" }, registry);

  assert.ok(result.documents.some((document) => document.outputPath === "games/test/versions/latest/index.json"));
  assert.ok(result.documents.some((document) => document.outputPath === "games/search/genre/action/index.json"));

  const latest = JSON.parse(await fs.readFile(path.join(cwd, "out/games/test/versions/latest/index.json"), "utf8"));
  assert.equal(latest["@id"], "https://example.com/games/test/versions/latest");

  const rootIndex = JSON.parse(await fs.readFile(path.join(cwd, "out/index.json"), "utf8"));
  assert.equal(rootIndex.name, "Example API");
  assert.deepEqual(rootIndex.about, [
    {
      "@id": "https://example.com/games/search",
      "@type": "CollectionPage",
      name: "games search",
    },
  ]);

  const publishersIndex = JSON.parse(await fs.readFile(path.join(cwd, "out/publishers/index.json"), "utf8"));
  assert.equal(publishersIndex.hasPart[0]["@type"], "Organization");
  assert.equal(publishersIndex.hasPart[0].name, "Acme Games");

  const gamesSearchIndex = JSON.parse(
    await fs.readFile(path.join(cwd, "out/games/search/genre/action/index.json"), "utf8"),
  );
  assert.equal(gamesSearchIndex.hasPart[0]["@type"], "SoftwareApplication");
  assert.equal(gamesSearchIndex.hasPart[0].name, "Test Game");
});

test("writes formatted JSON in development mode and minified JSON in production mode", async () => {
  const cwd = await makeFixture({
    "resources/publishers/acme/index.yaml": "type: Organization\nname: Acme Games\n",
  });

  await runBuild({ cwd, write: true, config: makeTestConfig({ publishers: {} }), mode: "development" }, registry);
  const developmentJson = await fs.readFile(path.join(cwd, "out/publishers/acme/index.json"), "utf8");
  assert.match(developmentJson, /\n {2}"@context":/);

  await runBuild({ cwd, write: true, config: makeTestConfig({ publishers: {} }), mode: "production" }, registry);
  const productionJson = await fs.readFile(path.join(cwd, "out/publishers/acme/index.json"), "utf8");
  assert.doesNotMatch(productionJson, /\n {2}"@context":/);
  assert.ok(!productionJson.includes("\n"));
});

test("fails on duplicate YAML keys", async () => {
  const cwd = await makeFixture({
    "resources/publishers/acme/index.yaml": "type: Organization\nname: Acme\nname: Duplicate\n",
  });

  await assert.rejects(() => runBuild({ cwd, write: false, config: makeTestConfig({ publishers: {} }) }, registry));
});

test("fails with context when a referenced local asset does not exist", async () => {
  const assetRegistry: SchemaRegistry = {
    games: {
      resourceSchema: z.object({
        type: z.literal("SoftwareApplication"),
        name: z.string(),
      }),
      versionSchema: z.object({
        type: z.literal("SoftwareSourceCode"),
        version: z.string(),
        file: z.object({
          path: z.string(),
        }),
      }),
      resourceJsonLdType: "SoftwareApplication",
      versionJsonLdType: "SoftwareSourceCode",
      allowedResourceTypes: ["SoftwareApplication"],
      allowedVersionTypes: ["SoftwareSourceCode"],
      compileResource({ resource, helper }) {
        return helper.makeJsonLdDocument("SoftwareApplication", {
          name: resource.data.name as string,
        });
      },
      compileVersion({ version, helper }) {
        return helper.makeJsonLdDocumentAt(helper.versionUrl(version.versionId), "SoftwareSourceCode", {
          version: version.data.version as string,
          file: helper.copyAsset(
            { path: (version.data.file as JsonObject).path as string },
            {
              resourceType: version.resourceType,
              resourceId: version.resourceId,
              versionId: version.versionId,
            },
          ),
        });
      },
    },
  };

  const cwd = await makeFixture({
    "resources/games/test/index.yaml": "type: SoftwareApplication\nname: Test Game\n",
    "resources/games/test/versions/1.0.0.yaml":
      "type: SoftwareSourceCode\nversion: 1.0.0\nfile:\n  path: /games/test/files/missing.zip\n",
  });

  await assert.rejects(
    () => runBuild({ cwd, write: false, config: makeTestConfig({ games: {} }), mode: "development" }, assetRegistry),
    (error: unknown) =>
      error instanceof Error && error.message.includes("Referenced local asset does not exist") && "fieldPath" in error,
  );
});

test("rebuilds latest alias to the next-highest version when the highest version is removed", async () => {
  const cwd = await makeFixture({
    "resources/games/test/index.yaml": "type: SoftwareApplication\nname: Test Game\n",
    "resources/games/test/versions/2.0.0.yaml": "type: SoftwareSourceCode\nversion: 2.0.0\ndatePublished: 2025-01-01\n",
    "resources/games/test/versions/1.0.0.yaml": "type: SoftwareSourceCode\nversion: 1.0.0\ndatePublished: 2024-01-01\n",
  });

  await runBuild({ cwd, write: true, config: makeTestConfig({ games: {} }), mode: "development" }, registry);
  let latest = JSON.parse(await fs.readFile(path.join(cwd, "out/games/test/versions/latest/index.json"), "utf8"));
  assert.equal(latest.version, "2.0.0");

  await fs.rm(path.join(cwd, "resources/games/test/versions/2.0.0.yaml"));
  await runBuild({ cwd, write: true, config: makeTestConfig({ games: {} }), mode: "development" }, registry);

  latest = JSON.parse(await fs.readFile(path.join(cwd, "out/games/test/versions/latest/index.json"), "utf8"));
  assert.equal(latest.version, "1.0.0");
});

test("creates empty attribute search indexes when no resources match", async () => {
  const cwd = await makeFixture({
    "resources/games/test/index.yaml": "type: SoftwareApplication\nname: Test Game\n",
  });

  await runBuild(
    { cwd, write: true, config: makeTestConfig({ games: { searchAttributes: ["genre"] } }), mode: "development" },
    registry,
  );

  const attributeIndex = JSON.parse(await fs.readFile(path.join(cwd, "out/games/search/genre/index.json"), "utf8"));
  assert.deepEqual(attributeIndex.hasPart, []);
});

test("fails when a declared resource type is incompatible with its directory resource type", async () => {
  const mismatchRegistry: SchemaRegistry = {
    publishers: {
      resourceSchema: z.object({
        type: z.string(),
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

  const cwd = await makeFixture({
    "resources/publishers/acme/index.yaml": "type: SoftwareApplication\nname: Wrong Type\n",
  });

  await assert.rejects(
    () =>
      runBuild(
        { cwd, write: false, config: makeTestConfig({ publishers: {} }), mode: "development" },
        mismatchRegistry,
      ),
    (error: unknown) => error instanceof Error && error.message.includes("Declared resource type is incompatible"),
  );
});

test("fails when an internal reference target does not exist", async () => {
  const cwd = await makeFixture({
    "resources/games/test/index.yaml": "type: SoftwareApplication\nname: Test Game\npublisher: /publishers/missing\n",
  });

  await assert.rejects(
    () => runBuild({ cwd, write: false, config: makeTestConfig({ games: {} }), mode: "development" }, registry),
    (error: unknown) =>
      error instanceof Error &&
      error.message.includes("Referenced internal resource or version does not exist") &&
      "referencePath" in error,
  );
});

test("indexes arrays, numbers, booleans and ignores empty, missing, and mixed values", async () => {
  const indexingRegistry: SchemaRegistry = {
    items: {
      resourceSchema: z.object({
        type: z.literal("Thing"),
        name: z.string(),
        tags: z.array(z.string()).optional(),
        rating: z.number().optional(),
        featured: z.boolean().optional(),
        emptyLabel: z.string().optional(),
        maybeNull: z.string().nullable().optional(),
        mixed: z.array(z.union([z.string(), z.object({ bad: z.string() })])).optional(),
      }),
      resourceJsonLdType: "Thing",
      allowedResourceTypes: ["Thing"],
      compileResource({ resource, helper }) {
        return helper.makeJsonLdDocument("Thing", {
          name: resource.data.name as string,
        });
      },
    },
  };

  const cwd = await makeFixture({
    "resources/items/alpha/index.yaml": [
      "type: Thing",
      "name: Alpha",
      "tags:",
      "  - red",
      "  - blue",
      "rating: 5",
      "featured: true",
      'emptyLabel: ""',
      "maybeNull: null",
      "mixed:",
      "  - valid",
      "  - bad: nope",
      "",
    ].join("\n"),
  });

  await runBuild(
    {
      cwd,
      write: true,
      mode: "development",
      config: makeTestConfig({
        items: {
          searchAttributes: ["tags", "rating", "featured", "emptyLabel", "missing", "maybeNull", "mixed"],
        },
      }),
    },
    indexingRegistry,
  );

  const tagsIndex = JSON.parse(await fs.readFile(path.join(cwd, "out/items/search/tags/red/index.json"), "utf8"));
  assert.equal(tagsIndex.hasPart[0].name, "Alpha");

  const ratingIndex = JSON.parse(await fs.readFile(path.join(cwd, "out/items/search/rating/5/index.json"), "utf8"));
  assert.equal(ratingIndex.value, "5");

  const featuredIndex = JSON.parse(
    await fs.readFile(path.join(cwd, "out/items/search/featured/true/index.json"), "utf8"),
  );
  assert.equal(featuredIndex.value, "true");

  const emptyAttributeIndex = JSON.parse(
    await fs.readFile(path.join(cwd, "out/items/search/emptyLabel/index.json"), "utf8"),
  );
  assert.deepEqual(emptyAttributeIndex.hasPart, []);

  const missingAttributeIndex = JSON.parse(
    await fs.readFile(path.join(cwd, "out/items/search/missing/index.json"), "utf8"),
  );
  assert.deepEqual(missingAttributeIndex.hasPart, []);

  const nullAttributeIndex = JSON.parse(
    await fs.readFile(path.join(cwd, "out/items/search/maybeNull/index.json"), "utf8"),
  );
  assert.deepEqual(nullAttributeIndex.hasPart, []);

  const mixedAttributeIndex = JSON.parse(
    await fs.readFile(path.join(cwd, "out/items/search/mixed/index.json"), "utf8"),
  );
  assert.deepEqual(mixedAttributeIndex.hasPart, []);
});

test("fails with detailed diagnostics for search normalization collisions", async () => {
  const cwd = await makeFixture({
    "resources/items/first/index.yaml": "type: Thing\nname: First Item\ntag: C++\n",
    "resources/items/second/index.yaml": "type: Thing\nname: Second Item\ntag: C\n",
  });

  const indexingRegistry: SchemaRegistry = {
    items: {
      resourceSchema: z.object({
        type: z.literal("Thing"),
        name: z.string(),
        tag: z.string(),
      }),
      resourceJsonLdType: "Thing",
      allowedResourceTypes: ["Thing"],
      compileResource({ resource, helper }) {
        return helper.makeJsonLdDocument("Thing", {
          name: resource.data.name as string,
        });
      },
    },
  };

  await assert.rejects(
    () =>
      runBuild(
        {
          cwd,
          write: false,
          mode: "development",
          config: makeTestConfig({
            items: {
              searchAttributes: ["tag"],
            },
          }),
        },
        indexingRegistry,
      ),
    (error: unknown) =>
      error instanceof Error &&
      error.message.includes("Search value normalization collision detected") &&
      "normalizedValue" in error &&
      "originalValue" in error &&
      "conflictingSource" in error,
  );
});

test("fails with detailed diagnostics for reserved path segments", async () => {
  const cwd = await makeFixture({
    "resources/publishers/search/index.yaml": "type: Organization\nname: Reserved\n",
  });

  await assert.rejects(
    () => runBuild({ cwd, write: false, config: makeTestConfig({ publishers: {} }), mode: "development" }, registry),
    (error: unknown) =>
      error instanceof Error &&
      error.message.includes("reserved generated path segment") &&
      "originalValue" in error &&
      "normalizedValue" in error,
  );
});

test("allows circular references without recursive compile loops", async () => {
  const circularRegistry: SchemaRegistry = {
    nodes: {
      resourceSchema: z.object({
        type: z.literal("Thing"),
        name: z.string(),
        related: z.string(),
      }),
      resourceJsonLdType: "Thing",
      allowedResourceTypes: ["Thing"],
      compileResource({ resource, helper }) {
        return helper.makeJsonLdDocument("Thing", {
          name: resource.data.name as string,
          related: helper.resolveInternalReference(resource.data.related as string),
        });
      },
    },
  };

  const cwd = await makeFixture({
    "resources/nodes/alpha/index.yaml": "type: Thing\nname: Alpha\nrelated: /nodes/beta\n",
    "resources/nodes/beta/index.yaml": "type: Thing\nname: Beta\nrelated: /nodes/alpha\n",
  });

  await runBuild(
    {
      cwd,
      write: true,
      mode: "development",
      config: makeTestConfig({ nodes: {} }),
    },
    circularRegistry,
  );

  const alpha = JSON.parse(await fs.readFile(path.join(cwd, "out/nodes/alpha/index.json"), "utf8"));
  const beta = JSON.parse(await fs.readFile(path.join(cwd, "out/nodes/beta/index.json"), "utf8"));

  assert.equal(alpha.related["@id"], "https://example.com/nodes/beta");
  assert.equal(beta.related["@id"], "https://example.com/nodes/alpha");
});

test("fails cleanly when the configured resources root is not a readable directory", async () => {
  const cwd = await makeFixture({
    resources: "not a directory",
  });

  await assert.rejects(
    () =>
      runBuild(
        {
          cwd,
          write: false,
          mode: "development",
          config: {
            ...makeTestConfig(),
            resourcesRoot: "resources",
          },
        },
        registry,
      ),
    (error: unknown) => error instanceof Error && error.message.includes("Required source directory cannot be read"),
  );
});

test("generates consistent root, collection, search, and version index documents", async () => {
  const cwd = await makeFixture({
    "resources/publishers/acme/index.yaml":
      "type: Organization\nname: Acme Games\ndescription: Publisher\nurl: https://example.com/publishers/acme\n",
    "resources/games/test/index.yaml": [
      "type: SoftwareApplication",
      "name: Test Game",
      "description: Example game",
      "genre: Action",
      "publisher: /publishers/acme",
      "url: https://example.com/games/test",
      "",
    ].join("\n"),
    "resources/games/test/versions/1.0.0.yaml": [
      "type: SoftwareSourceCode",
      "version: 1.0.0",
      "datePublished: 2024-01-01",
      "releaseNotes: First release",
      "files:",
      "  - name: Test Game macOS",
      "    path: /games/test/assets/test-game-1.0.0.zip",
      "    encodingFormat: application/zip",
      "    license: https://spdx.org/licenses/CC0-1.0.html",
      "",
    ].join("\n"),
    "resources/games/test/assets/test-game-1.0.0.zip": "zip payload",
  });

  await runBuild({ cwd, write: true, config: makeTestConfig(), mode: "development" }, registry);

  const rootIndex = JSON.parse(await fs.readFile(path.join(cwd, "out/index.json"), "utf8"));
  assert.equal(rootIndex.hasPart[0]["@type"], "CollectionPage");
  assert.equal(rootIndex.about[0]["@id"], "https://example.com/games/search");

  const collectionIndex = JSON.parse(await fs.readFile(path.join(cwd, "out/games/index.json"), "utf8"));
  assert.equal(collectionIndex.about[0]["@id"], "https://example.com/games/search");
  assert.equal(collectionIndex.hasPart[0]["@id"], "https://example.com/games/test");

  const searchManifest = JSON.parse(await fs.readFile(path.join(cwd, "out/games/search/index.json"), "utf8"));
  assert.equal(searchManifest.about[0]["@id"], "https://example.com/games");
  assert.equal(searchManifest.hasPart[0]["@id"], "https://example.com/games/search/genre");

  const searchValueIndex = JSON.parse(
    await fs.readFile(path.join(cwd, "out/games/search/genre/action/index.json"), "utf8"),
  );
  assert.equal(searchValueIndex.about[0]["@id"], "https://example.com/games");
  assert.equal(searchValueIndex.value, "Action");

  const versionIndex = JSON.parse(await fs.readFile(path.join(cwd, "out/games/test/versions/index.json"), "utf8"));
  assert.equal(versionIndex.about[0]["@id"], "https://example.com/games/test");
  assert.equal(versionIndex.hasPart[0]["@type"], "SoftwareSourceCode");
});

test("generates documentation with example requests and example responses", async () => {
  const cwd = await makeFixture({
    "resources/publishers/acme/index.yaml":
      "type: Organization\nname: Acme Games\ndescription: Publisher\nurl: https://example.com/publishers/acme\n",
    "resources/games/test/index.yaml": [
      "type: SoftwareApplication",
      "name: Test Game",
      "description: Example game",
      "genre: Action",
      "publisher: /publishers/acme",
      "url: https://example.com/games/test",
      "tags:",
      "  - action",
      "",
    ].join("\n"),
    "resources/games/test/versions/1.0.0.yaml": [
      "type: SoftwareSourceCode",
      "version: 1.0.0",
      "datePublished: 2024-01-01",
      "releaseNotes: First release",
      "files:",
      "  - name: Test Game macOS",
      "    path: /games/test/assets/test-game-1.0.0.zip",
      "    encodingFormat: application/zip",
      "    license: https://spdx.org/licenses/CC0-1.0.html",
      "",
    ].join("\n"),
    "resources/games/test/assets/test-game-1.0.0.zip": "zip payload",
  });

  await runBuild({ cwd, write: true, config: makeTestConfig(), mode: "development" }, registry);

  const docsHtml = await fs.readFile(path.join(cwd, "out/docs/index.html"), "utf8");
  assert.match(docsHtml, /Example Request:/);
  assert.match(docsHtml, /Example Response:/);
  assert.match(docsHtml, /https:\/\/example\.com\/games\/test/);
  assert.match(docsHtml, /https:\/\/example\.com\/games\/test\/versions\/1\.0\.0/);
  assert.match(docsHtml, /https:\/\/example\.com\/games\/search/);
});

test("publishes machine-readable type definitions for generated document shapes", async () => {
  const cwd = await makeFixture({
    "resources/publishers/acme/index.yaml": "type: Organization\nname: Acme Games\n",
    "resources/games/test/index.yaml":
      "type: SoftwareApplication\nname: Test Game\ngenre: Action\npublisher: /publishers/acme\n",
    "resources/games/test/versions/1.0.0.yaml": "type: SoftwareSourceCode\nversion: 1.0.0\ndatePublished: 2024-01-01\n",
  });

  await runBuild({ cwd, write: true, config: makeTestConfig(), mode: "development" }, registry);

  const manifest = JSON.parse(await fs.readFile(path.join(cwd, "out/types/index.json"), "utf8"));
  assert.equal(manifest.apiName, "Example API");
  assert.ok(manifest.definitions.some((entry: { name: string }) => entry.name === "root-index"));
  assert.ok(manifest.definitions.some((entry: { name: string }) => entry.name === "games-resource"));
  assert.ok(manifest.definitions.some((entry: { name: string }) => entry.name === "games-version"));

  const rootIndexSchema = JSON.parse(await fs.readFile(path.join(cwd, "out/types/root-index.schema.json"), "utf8"));
  assert.equal(rootIndexSchema["$id"], "https://example.com/types/root-index.schema.json");
  assert.equal(rootIndexSchema.type, "object");
  assert.ok(rootIndexSchema.required.includes("@context"));
  assert.ok(rootIndexSchema.required.includes("hasPart"));

  const resourceSchema = JSON.parse(
    await fs.readFile(path.join(cwd, "out/types/resources/games.resource.schema.json"), "utf8"),
  );
  assert.equal(resourceSchema["$id"], "https://example.com/types/resources/games.resource.schema.json");
  assert.equal(resourceSchema.type, "object");
  assert.ok(resourceSchema.required.includes("@context"));
});
