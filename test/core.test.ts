import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";

import { discoverSources } from "../src/core/discovery.js";
import {
  assertSafeResourceSegment,
  compareSemverDesc,
  ensureInsideRoot,
  toSearchSlug,
} from "../src/core/utils.js";
import { loadYamlFile } from "../src/core/yaml.js";
import { makeFixture, makeTestConfig } from "./helpers.js";

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
    (error: unknown) =>
      error instanceof Error &&
      error.message.includes("lowercase ASCII letters"),
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
