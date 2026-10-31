import { SITE } from "../../config.ts";
import { clientFor, outputFor, type GlobalFlags } from "../shared.ts";

interface ListFlags extends GlobalFlags {
  limit?: number | string;
  search?: string;
}

/**
 * List courses from the WordPress sitemap. This is an index only — it never
 * fetches a book page, so it stays cheap.
 */
export async function listCommand(flags: ListFlags): Promise<void> {
  const out = outputFor(flags);
  const limit = Number.isFinite(Number(flags.limit)) && Number(flags.limit) > 0 ? Number(flags.limit) : 50;
  const search = flags.search?.toLowerCase();

  const client = await clientFor(flags);
  try {
    const index = await client.getPage(`${SITE}/wp-sitemap.xml`, {
      refresh: flags.refresh,
      offline: flags.offline,
    });
    const shards = [...index.text.matchAll(/<loc>([^<]+sfwd-courses-\d+\.xml)<\/loc>/g)].map(
      (match) => match[1]!,
    );

    const books: Array<{ url: string; slug: string }> = [];
    for (const shard of shards) {
      const response = await client.getPage(shard, { offline: flags.offline });
      for (const match of response.text.matchAll(/<loc>([^<]+)<\/loc>/g)) {
        const url = match[1]!;
        if (!url.includes("/books/")) continue;
        const slug = decodeURIComponent(url.replace(/\/$/, "").split("/").pop() ?? "");
        if (search && !slug.toLowerCase().includes(search)) continue;
        books.push({ url, slug });
        if (books.length >= limit) break;
      }
      if (books.length >= limit) break;
    }

    if (flags.json) {
      out.json({ count: books.length, books });
      return;
    }
    for (const book of books) {
      out.info(`${book.slug}\n  ${book.url}`);
    }
    out.progress(`${books.length} book(s)`);
  } finally {
    await client.close();
  }
}
