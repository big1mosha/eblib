#!/usr/bin/env bun
import { spawnSync } from "node:child_process";
import { ensureEpubkit, ensureInstalled } from "./setup.ts";

const fetched = ensureEpubkit();
const installed = ensureInstalled(fetched);

// Bun's resolver cannot see node_modules created after this process started,
// so start over once the first install finished.
if (installed) {
  const result = spawnSync(process.execPath, process.argv.slice(1), { stdio: "inherit" });
  process.exit(result.status ?? 1);
}

await import("./cli.ts");
