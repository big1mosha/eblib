import { resolve } from "node:path";
import { PATHS } from "../config.ts";
import { HttpClient } from "../http/client.ts";
import { createOutput, type Output } from "../log.ts";
import type { Selection } from "../build/select.ts";
import type { PartsMode } from "../build/manifest.ts";
import type { ThemeName } from "@epubkit/core";

export interface GlobalFlags {
  out?: string;
  cacheDir?: string;
  name?: string;
  resume?: boolean;
  refresh?: boolean;
  refreshStructure?: boolean;
  refreshContent?: boolean;
  offline?: boolean;
  lessons?: string;
  topics?: string;
  sections?: string;
  skipTopics?: boolean;
  mergeTopics?: boolean;
  parts?: string;
  splitSize?: number | string;
  style?: string;
  font?: string | boolean;
  cover?: string;
  allowPartial?: boolean;
  failFast?: boolean;
  report?: string;
  json?: boolean;
  quiet?: boolean;
  verbose?: boolean;
  color?: boolean;
  dryRun?: boolean;
  delay?: number | string;
  jitter?: number | string;
  timeout?: number | string;
  retries?: number | string;
  maxRequests?: number | string;
  cookieFile?: string;
  metadataSource?: string;
  refreshMetadata?: boolean;
  title?: string;
  author?: string | string[];
}

export function authorsFrom(flags: GlobalFlags): string[] | undefined {
  if (!flags.author) return undefined;
  return Array.isArray(flags.author) ? flags.author : [flags.author];
}

const STYLES = new Set(["classic", "minimal", "none"]);

export function outputFor(flags: GlobalFlags): Output {
  return createOutput({
    json: flags.json,
    quiet: flags.quiet,
    verbose: flags.verbose,
    noColor: flags.color === false,
  });
}

export function cacheDirFor(flags: GlobalFlags): string {
  return resolve(flags.cacheDir ?? PATHS.cache);
}

export function outDirFor(flags: GlobalFlags): string {
  return resolve(flags.out ?? PATHS.out);
}

export function selectionFrom(flags: GlobalFlags): Selection {
  return { sections: flags.sections, lessons: flags.lessons, topics: flags.topics };
}

export function partsModeFrom(flags: GlobalFlags): PartsMode {
  const mode = flags.parts ?? "auto";
  if (mode === "auto" || mode === "always" || mode === "never") return mode;
  throw new Error(`Unknown --parts value: ${mode} (auto|always|never)`);
}

export function styleFrom(flags: GlobalFlags): ThemeName {
  const style = (flags.style ?? "classic") as ThemeName;
  if (!STYLES.has(style)) throw new Error(`Unknown --style value: ${style} (classic|minimal|none)`);
  return style;
}

export function numberFlag(value: number | string | undefined, fallback: number): number {
  if (value === undefined) return fallback;
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export async function clientFor(flags: GlobalFlags): Promise<HttpClient> {
  const cacheDir = cacheDirFor(flags);
  const cookieFile = flags.cookieFile ? resolve(flags.cookieFile) : resolve(cacheDir, PATHS.cookies);
  return HttpClient.create({
    cacheDir,
    cookieFile,
    http: {
      delay: numberFlag(flags.delay, 2000),
      jitter: numberFlag(flags.jitter, 500),
      timeout: numberFlag(flags.timeout, 30_000),
      retries: numberFlag(flags.retries, 3),
      maxRequests: numberFlag(flags.maxRequests, 1000),
    },
  });
}

export function coverModeFrom(flags: GlobalFlags): string {
  return flags.cover ?? "auto";
}

export function splitSizeFrom(flags: GlobalFlags): number {
  return numberFlag(flags.splitSize, 200);
}
