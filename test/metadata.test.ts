import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { enrichWorkspace } from "../src/enrich.ts";
import { HttpCache } from "../src/http/cache.ts";
import { HttpClient } from "../src/http/client.ts";
import {
  googleBooksUrl,
  openLibraryUrl,
  parseGoogleBooks,
  parseOpenLibrary,
  pickCandidate,
  similarity,
} from "../src/site/metadata.ts";
import { Workspace } from "../src/store/workspace.ts";

const dirs: string[] = [];

afterEach(async () => {
  for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true });
});

async function tempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "eblib-meta-"));
  dirs.push(dir);
  return dir;
}

const META = {
  title: "কাকাবাবু সমগ্র ৩",
  authors: ["সুনীল গঙ্গোপাধ্যায়"],
  subjects: [],
};

describe("similarity", () => {
  test("matches equal, contained and overlapping titles", () => {
    expect(similarity("কাকাবাবু সমগ্র ৩", "কাকাবাবু সমগ্র ৩")).toBe(1);
    expect(similarity("কাকাবাবু সমগ্র ৩", "কাকাবাবু সমগ্র")).toBeGreaterThan(0.8);
    expect(similarity("Kakababu Samagra 3", "Kakababu Samagra")).toBeGreaterThan(0.8);
    expect(similarity("Kakababu", "Feluda")).toBe(0);
  });
});

describe("pickCandidate", () => {
  test("prefers the matching author", () => {
    const candidates = [
      { title: "কাকাবাবু সমগ্র ৩", authors: ["অন্য লেখক"] },
      { title: "কাকাবাবু সমগ্র ৩", authors: ["সুনীল গঙ্গোপাধ্যায়"] },
    ];
    expect(pickCandidate(META, candidates)?.authors).toEqual(["সুনীল গঙ্গোপাধ্যায়"]);
  });

  test("rejects unrelated titles", () => {
    expect(pickCandidate(META, [{ title: "সম্পূর্ণ অন্য বই", authors: [] }])).toBeUndefined();
  });
});

describe("parseOpenLibrary", () => {
  test("reads docs into candidates", () => {
    const candidates = parseOpenLibrary({
      docs: [
        {
          key: "/works/OL1W",
          title: "Kakababu Samagra 3",
          author_name: ["Sunil Gangopadhyay"],
          first_publish_year: 1985,
          publisher: ["Ananda"],
          subject: ["Detective"],
        },
      ],
    });
    expect(candidates).toHaveLength(1);
    expect(candidates[0]).toMatchObject({
      title: "Kakababu Samagra 3",
      date: "1985",
      publisher: "Ananda",
      key: "/works/OL1W",
    });
  });

  test("tolerates an empty response", () => {
    expect(parseOpenLibrary({})).toEqual([]);
    expect(parseOpenLibrary({ docs: "nope" })).toEqual([]);
  });
});

describe("parseGoogleBooks", () => {
  test("reads volumeInfo", () => {
    const candidates = parseGoogleBooks({
      items: [
        {
          volumeInfo: {
            title: "Kakababu Samagra 3",
            authors: ["Sunil Gangopadhyay"],
            publisher: "Ananda",
            publishedDate: "1985-01-01",
            description: "<p>একটি <b>বই</b>।</p>",
            categories: ["Fiction"],
          },
        },
      ],
    });
    expect(candidates[0]).toMatchObject({
      title: "Kakababu Samagra 3",
      date: "1985-01-01",
      publisher: "Ananda",
      description: "একটি বই।",
    });
  });
});

describe("provider URLs", () => {
  test("encode the query", () => {
    expect(openLibraryUrl(META)).toContain("title=%E0%A6%95%E0%A6%BE%E0%A6%95%E0%A6%BE%E0%A6%AC%E0%A6%BE%E0%A6%AC%E0%A7%81");
    expect(googleBooksUrl(META)).toContain("intitle%3A");
  });
});

describe("enrichWorkspace", () => {
  test("fills missing fields from a cached response", async () => {
    const dir = await tempDir();
    const cache = await HttpCache.open(dir);
    await cache.put({
      url: openLibraryUrl(META),
      status: 200,
      headers: { "content-type": "application/json" },
      bytes: new TextEncoder().encode(
        JSON.stringify({
          docs: [
            {
              key: "/works/OL1W",
              title: "কাকাবাবু সমগ্র ৩",
              author_name: ["সুনীল গঙ্গোপাধ্যায়"],
              first_publish_year: 1985,
              publisher: ["Ananda"],
            },
          ],
        }),
      ),
      fetchedAt: new Date().toISOString(),
    });
    cache.close();

    const workspace = Workspace.create(dir, "42", {
      courseId: "42",
      source: "https://example.test/books/demo/",
      metadata: { ...META, subjects: [] },
      sections: [],
      hasSections: false,
      paging: { totalItems: 0, totalPages: 0, visibleLessons: 0, complete: true },
      items: {},
      images: {},
      warnings: [],
    });

    const client = await HttpClient.create({ cacheDir: dir, cookieFile: join(dir, "cookies.json") });
    const result = await enrichWorkspace(workspace, client, {
      source: "openlibrary",
      warn: () => {},
    });

    expect(result?.matchedTitle).toBe("কাকাবাবু সমগ্র ৩");
    expect(workspace.state.metadata.publisher).toBe("Ananda");
    expect(workspace.state.metadata.published).toBe("1985");
    expect(workspace.state.metadata.enrichment?.source).toBe("openlibrary");

    // A second run is a no-op unless refresh is requested.
    expect(await enrichWorkspace(workspace, client, { source: "openlibrary", warn: () => {} })).toBeNull();
  });

  test("rejects an unknown provider", async () => {
    const dir = await tempDir();
    const workspace = Workspace.create(dir, "43", {
      courseId: "43",
      source: "https://example.test/books/demo/",
      metadata: { ...META, subjects: [] },
      sections: [],
      hasSections: false,
      paging: { totalItems: 0, totalPages: 0, visibleLessons: 0, complete: true },
      items: {},
      images: {},
      warnings: [],
    });
    const client = await HttpClient.create({ cacheDir: dir, cookieFile: join(dir, "cookies.json") });
    await expect(
      enrichWorkspace(workspace, client, { source: "nope", warn: () => {} }),
    ).rejects.toThrow(/Unknown --metadata-source/);
  });
});
