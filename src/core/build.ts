import { projectDefinition } from "../project.js";
import { runBuild } from "./engine.js";

async function main(): Promise<void> {
  const cwd = process.cwd();
  const mode = process.argv.includes("--mode=production") ? "production" : "development";

  try {
    await runBuild({ cwd, write: true, mode }, projectDefinition.schemaRegistry);
    console.log("Build complete");
  } catch (error) {
    console.error(error);
    process.exitCode = 1;
  }
}

void main();
