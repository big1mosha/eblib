import { readdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { EblibError, EXIT, PATHS } from "../../config.ts";
import { HttpCache } from "../../http/cache.ts";
import { cacheDirFor, outputFor, type GlobalFlags } from "../shared.ts";

interface CacheFlags extends GlobalFlags {
  books?: boolean;
}

export async function cacheCommand(action: string | undefined, flags: CacheFlags): Promise<void> {
  const out = outputFor(flags);
  const cacheDir = cacheDirFor(flags);

  if (action === "ls" || action === undefined) {
    const cache = await HttpCache.open(cacheDir);
    try {
      const entries = cache.list(100);
      if (flags.json) {
        out.json({ count: cache.count(), entries });
        return;
      }
      for (const entry of entries) out.info(`${entry.fetchedAt}  ${entry.status}  ${entry.url}`);
      out.progress(`${cache.count()} cached response(s)`);
    } finally {
      cache.close();
    }
    return;
  }

  if (action === "verify") {
    const cache = await HttpCache.open(cacheDir);
    try {
      const result = await cache.verify();
      out.info(`checked ${result.checked} response(s); dropped ${result.missing}`);
    } finally {
      cache.close();
    }
    return;
  }

  if (action === "clear") {
    const cache = await HttpCache.open(cacheDir);
    cache.clear();
    cache.close();
    out.info("cleared the HTTP cache");

    if (flags.books) {
      const booksDir = join(cacheDir, PATHS.books);
      const books = await readdir(booksDir).catch(() => [] as string[]);
      for (const book of books) await rm(join(booksDir, book), { recursive: true, force: true });
      out.info(`removed ${books.length} scraped book(s)`);
    }
    return;
  }

  throw new EblibError(`unknown cache action: ${action} (ls|clear|verify)`, EXIT.usage);
}
