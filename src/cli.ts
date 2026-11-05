#!/usr/bin/env bun
import { cac } from "cac";
import { EblibError, EXIT } from "./config.ts";
import { AuthRequired } from "./http/challenge.ts";
import { createOutput } from "./log.ts";
import { authCommand } from "./cli/commands/auth.ts";
import { buildCommand } from "./cli/commands/build.ts";
import { cacheCommand } from "./cli/commands/cache.ts";
import { exportCommand } from "./cli/commands/export.ts";
import { infoCommand } from "./cli/commands/info.ts";
import { listCommand } from "./cli/commands/list.ts";
import { scrapeCommand } from "./cli/commands/scrape.ts";
import type { GlobalFlags } from "./cli/shared.ts";

const VERSION = "0.1.0";
const cli = cac("eblib");

function globalOptions(command: ReturnType<typeof cli.command>): ReturnType<typeof cli.command> {
  return command
    .option("-o, --out <dir>", "EPUB output directory", { default: "dist" })
    .option("--cache-dir <dir>", "cache and workspace directory", { default: ".eblib" })
    .option("--name <slug>", "output file name (without .epub)")
    .option("--title <title>", "override the book title")
    .option("--author <name>", "override the author (repeatable)")
    .option("--resume", "skip finished items (default)", { default: true })
    .option("--no-resume", "ignore saved progress")
    .option("--refresh", "ignore the HTTP cache")
    .option("--refresh-structure", "re-parse the course page")
    .option("--refresh-content", "re-fetch lesson and topic content")
    .option("--offline", "use the cache only")
  .option("--fetch-only", "fetch and cache content without building an EPUB")
    .option("--lessons <range>", "lesson range, e.g. 1-5,8")
    .option("--topics <range>", "topic range within lessons")
    .option("--sections <range>", "section range")
    .option("--skip-topics", "treat lessons as single chapters")
    .option("--merge-topics", "put topics inside the lesson page")
    .option("--parts <mode>", "auto|always|never", { default: "auto" })
    .option("--split-size <kb>", "split chapters larger than this", { default: "200" })
    .option("--style <name>", "classic|minimal|none", { default: "classic" })
    .option("--font <path|none>", "use a font file, or none")
    .option("--cover <mode>", "auto|site|generate|none|<path>", { default: "auto" })
    .option("--allow-partial", "build with placeholders for failed items")
    .option("--fail-fast", "stop on the first error")
    .option("--report <path>", "copy the scrape report here")
    .option("--json", "machine-readable output")
    .option("--quiet", "suppress normal output")
    .option("--verbose", "show every item")
    .option("--no-color", "disable colors")
    .option("--dry-run", "plan only")
    .option("--delay <ms>", "delay between requests", { default: "2000" })
    .option("--jitter <ms>", "random delay added to each request", { default: "500" })
    .option("--timeout <ms>", "request timeout", { default: "30000" })
    .option("--retries <n>", "retry count for 5xx responses", { default: "3" })
    .option("--max-requests <n>", "request budget per run", { default: "1000" })
    .option("--cookie-file <path>", "cookie jar path")
    .option("--metadata-source <name>", "enrich metadata: site|openlibrary|googlebooks|none")
    .option("--refresh-metadata", "query the metadata provider again");
}

async function guard(action: () => Promise<void>, flags: GlobalFlags): Promise<void> {
  const output = createOutput({
    json: flags.json,
    quiet: flags.quiet,
    verbose: flags.verbose,
    noColor: flags.color === false,
  });
  try {
    await action();
  } catch (cause) {
    if (cause instanceof AuthRequired) {
      output.error(
        [
          "Challenge or login required.",
          `  ${cause.url}`,
          `  ${cause.message}`,
          "",
          "Run: eblib auth <url>",
          "Then: eblib scrape <url> --resume",
        ].join("\n"),
      );
      process.exitCode = EXIT.auth;
      return;
    }
    if (cause instanceof EblibError) {
      output.error(cause.message);
      process.exitCode = cause.exitCode;
      return;
    }
    output.error((cause as Error).stack ?? String(cause));
    process.exitCode = EXIT.general;
  }
}

globalOptions(cli.command("scrape <url>", "Scrape a book and build an EPUB")).action(
  (url: string, flags: GlobalFlags) => guard(() => scrapeCommand(url, flags), flags),
);

globalOptions(cli.command("info <url>", "Show book metadata and structure")).action(
  (url: string, flags: GlobalFlags) => guard(() => infoCommand(url, flags), flags),
);

globalOptions(cli.command("build <book>", "Rebuild an EPUB from the cache")).action(
  (book: string, flags: GlobalFlags) => guard(() => buildCommand(book, flags), flags),
);

globalOptions(cli.command("export <book>", "Write a portable folder for epubkit create")).action(
  (book: string, flags: GlobalFlags) => guard(() => exportCommand(book, flags), flags),
);

globalOptions(cli.command("list", "List books from the site sitemap"))
  .option("--limit <n>", "how many books", { default: "50" })
  .option("--search <text>", "filter by slug")
  .action((flags: GlobalFlags) => guard(() => listCommand(flags), flags));

globalOptions(cli.command("auth [url]", "Open a browser to solve a challenge or log in"))
  .option("--from <path>", "import a Netscape cookies.txt file")
  .action((url: string | undefined, flags: GlobalFlags) => guard(() => authCommand(url, flags), flags));

globalOptions(cli.command("cache <action>", "Inspect the cache (ls|clear|verify)"))
  .option("--books", "also delete scraped books with clear")
  .action((action: string, flags: GlobalFlags) => guard(() => cacheCommand(action, flags), flags));

cli.help();
cli.version(VERSION);

// `eblib <url>` is shorthand for `eblib scrape <url>`.
const argv = [...process.argv];
const noFont = argv.indexOf("--no-font");
if (noFont !== -1) argv.splice(noFont, 1, "--font", "none");
const first = argv[2];
if (first && (first.startsWith("http") || first.startsWith("/books/"))) {
  argv.splice(2, 0, "scrape");
}

await cli.parse(argv);
