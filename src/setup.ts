import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";

const root = resolve(import.meta.dir, "..");
const vendor = join(root, "vendor", "epubkit");
const coreManifest = join(vendor, "packages", "core", "package.json");
const installedManifest = join(root, "node_modules", "@epubkit", "core", "package.json");
const repo = "https://github.com/big1mosha/epubkit.git";

function run(command: string, args: string[]): void {
  const result = spawnSync(command, args, { cwd: root, stdio: "inherit" });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(" ")} exited with ${result.status}`);
  }
}

function fetchEpubkit(): void {
  const isGitCheckout = existsSync(join(root, ".git")) && existsSync(join(root, ".gitmodules"));
  if (isGitCheckout) {
    run("git", ["submodule", "update", "--init", "--recursive"]);
    if (existsSync(coreManifest)) return;
  }
  // Not a git checkout (for example a downloaded zip): clone directly.
  run("git", ["clone", repo, vendor]);
}

export function ensureEpubkit(): boolean {
  if (existsSync(coreManifest)) return false;

  console.error("eblib needs epubkit (@epubkit/core) to build EPUBs.");
  console.error(`epubkit lives in its own repo: ${repo}`);

  if (process.env.EBLIB_FETCH_EPUBKIT !== "1") {
    if (!process.stdin.isTTY) {
      console.error("Fetch it with: git submodule update --init --recursive");
      process.exit(1);
    }
    const answer = prompt(`Fetch epubkit into vendor/epubkit now? [y/N]`);
    if (!/^y(es)?$/i.test(answer?.trim() ?? "")) {
      console.error("Skipped. Run `git submodule update --init --recursive` when ready.");
      process.exit(1);
    }
  }

  fetchEpubkit();
  if (!existsSync(coreManifest)) {
    console.error(`epubkit is still missing at ${vendor}`);
    process.exit(1);
  }
  return true;
}

export function ensureInstalled(force = false): boolean {
  if (!force && existsSync(installedManifest)) return false;
  run("bun", ["install"]);
  return true;
}

if (import.meta.main) {
  ensureEpubkit();
  ensureInstalled();
}
