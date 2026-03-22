import http from "node:http";
import fs from "node:fs/promises";
import path from "node:path";

import { projectDefinition } from "../project.js";
import { runBuild } from "./engine.js";

async function main(): Promise<void> {
  const cwd = process.cwd();

  try {
    // Run an initial build, but skip cleaning to avoid 404s/flashing during restarts
    await runBuild({ cwd, write: true, mode: "development", clean: false }, projectDefinition.schemaRegistry);

    const outRoot = path.join(cwd, "out");
    const server = http.createServer(async (request, response) => {
      const requestPath = request.url === "/" ? "/index.json" : (request.url ?? "/index.json");
      const relativePath = requestPath.endsWith("/") ? `${requestPath}index.json` : requestPath;
      const targetPath = path.join(outRoot, relativePath);

      try {
        const content = await fs.readFile(targetPath);
        const contentType = targetPath.endsWith(".html")
          ? "text/html; charset=utf-8"
          : "application/json; charset=utf-8";
        response.writeHead(200, { "content-type": contentType });
        response.end(content);
      } catch {
        response.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
        response.end("Not found");
      }
    });

    server.listen(4173);
    console.log("Dev server listening on http://localhost:4173");
  } catch (error) {
    console.error(error);
    process.exitCode = 1;
  }
}

void main();
