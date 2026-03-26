import http from "node:http";
import fs from "node:fs/promises";
import path from "node:path";

import { projectDefinition } from "../project.js";
import {
  DEV_SERVER_ORIGIN,
  getDevServerContentType,
  getDevServerPathCandidates,
  withDevServerConfig,
} from "./dev-server.js";
import { runBuild } from "./engine.js";

async function main(): Promise<void> {
  const cwd = process.cwd();

  try {
    // Run a clean initial build so removed or renamed resources do not leave stale output behind.
    await runBuild(
      {
        cwd,
        write: true,
        mode: "development",
        config: withDevServerConfig(projectDefinition.config),
      },
      projectDefinition.schemaRegistry,
    );

    const outRoot = path.join(cwd, "out");
    const server = http.createServer(async (request, response) => {
      for (const relativePath of getDevServerPathCandidates(request.url)) {
        const targetPath = path.join(outRoot, relativePath);

        try {
          const content = await fs.readFile(targetPath);
          const contentType = getDevServerContentType(targetPath);
          response.writeHead(200, { "content-type": contentType });
          response.end(content);
          return;
        } catch {
          continue;
        }
      }

      response.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
      response.end("Not found");
    });

    server.listen(3000);
    console.log(`Dev server listening on ${DEV_SERVER_ORIGIN}`);
  } catch (error) {
    console.error(error);
    process.exitCode = 1;
  }
}

void main();
