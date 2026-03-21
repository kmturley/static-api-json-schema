import fs from "node:fs/promises";
import { watch } from "node:fs";
import http from "node:http";
import path from "node:path";

import { projectDefinition } from "../project.js";
import { runBuild, cleanOutDir } from "./engine.js";
import { formatError } from "./errors.js";
import type { BuildMode } from "./types.js";

async function main(): Promise<void> {
  const command = process.argv[2] ?? "build";
  const cwd = process.cwd();
  const mode = parseMode(process.argv.slice(3), command);

  try {
    switch (command) {
      case "build":
        await runBuild({ cwd, write: true, mode }, projectDefinition.schemaRegistry);
        console.log("Build complete");
        return;
      case "validate":
        await runBuild({ cwd, write: false, mode }, projectDefinition.schemaRegistry);
        console.log("Validation complete");
        return;
      case "clean":
        await cleanOutDir(cwd);
        console.log("Clean complete");
        return;
      case "dev":
        await runDev(cwd);
        return;
      default:
        throw new Error(`Unknown command: ${command}`);
    }
  } catch (error) {
    console.error(formatError(error));
    process.exitCode = 1;
  }
}

async function runDev(cwd: string): Promise<void> {
  await runBuild({ cwd, write: true, mode: "development" }, projectDefinition.schemaRegistry);

  const outRoot = path.join(cwd, "out");
  const server = http.createServer(async (request, response) => {
    const requestPath = request.url === "/" ? "/index.json" : request.url ?? "/index.json";
    const relativePath = requestPath.endsWith("/") ? `${requestPath}index.json` : requestPath;
    const targetPath = path.join(outRoot, relativePath);

    try {
      const content = await fs.readFile(targetPath);
      const contentType = targetPath.endsWith(".html") ? "text/html; charset=utf-8" : "application/json; charset=utf-8";
      response.writeHead(200, { "content-type": contentType });
      response.end(content);
    } catch {
      response.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
      response.end("Not found");
    }
  });

  server.listen(4173);
  console.log("Dev server listening on http://localhost:4173");

  const watcher = watch(path.join(cwd, "resources"), { recursive: true });
  let timer: NodeJS.Timeout | undefined;

  watcher.on("change", () => {
    if (timer) {
      clearTimeout(timer);
    }
    timer = setTimeout(async () => {
      try {
        await runBuild({ cwd, write: true, mode: "development" }, projectDefinition.schemaRegistry);
        console.log("Rebuild complete");
      } catch (error) {
        console.error(formatError(error));
      }
    }, 150);
  });
}

function parseMode(args: string[], command: string): BuildMode {
  if (command === "dev") {
    return "development";
  }

  const modeFlag = args.find((arg) => arg.startsWith("--mode="));
  if (!modeFlag) {
    return command === "build" ? "production" : "development";
  }

  const value = modeFlag.slice("--mode=".length);
  if (value === "development" || value === "production") {
    return value;
  }

  throw new Error(`Invalid mode: ${value}`);
}

void main();
