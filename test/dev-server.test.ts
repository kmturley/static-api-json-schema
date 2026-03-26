import test from "node:test";
import assert from "node:assert/strict";

import { DEV_SERVER_ORIGIN, getDevServerPathCandidates, withDevServerConfig } from "../src/core/dev-server.js";
import type { ProjectConfig } from "../src/core/types.js";

test("overrides the root domain for the dev server", () => {
  const config: ProjectConfig = {
    apiName: "Example API",
    apiVersion: "1.0.0",
    rootDomain: "https://example.com",
    resourcesRoot: "resources",
    resourceTypes: {
      games: {},
    },
  };

  const devConfig = withDevServerConfig(config);

  assert.equal(devConfig.rootDomain, DEV_SERVER_ORIGIN);
  assert.equal(config.rootDomain, "https://example.com");
});

test("maps clean resource URLs to generated index files", () => {
  assert.deepEqual(getDevServerPathCandidates("/"), ["/index.json"]);
  assert.deepEqual(getDevServerPathCandidates("/games"), [
    "/games",
    "/games/index.json",
    "/games/index.html",
    "/games.json",
  ]);
  assert.deepEqual(getDevServerPathCandidates("/games/lumen"), [
    "/games/lumen",
    "/games/lumen/index.json",
    "/games/lumen/index.html",
    "/games/lumen.json",
  ]);
});

test("preserves explicit filenames and strips query strings", () => {
  assert.deepEqual(getDevServerPathCandidates("/docs/index.html?view=full"), ["/docs/index.html"]);
  assert.deepEqual(getDevServerPathCandidates("/docs/?view=full"), ["/docs/index.json", "/docs/index.html"]);
});
