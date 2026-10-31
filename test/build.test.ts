import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { validateEpub } from "@epubkit/core";
import { buildBook } from "../src/build/book.ts";
import { parseRange, selectStructure } from "../src/build/select.ts";
import { slugify } from "../src/build/book.ts";
import { Workspace } from "../src/store/workspace.ts";
import type { Section } from "../src/site/course.ts";

const dirs: string[] = [];

afterEach(async () => {
  for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true });
});

async function tempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "eblib-test-"));
  dirs.push(dir);
  return dir;
}

const SECTIONS: Section[] = [
  {
    title: "প্রথম অংশ",
    lessons: [
      {
        id: "1",
        title: "পাঠ এক",
        url: "https://example.test/lessons/1/",
        topicCount: 2,
        topics: [
          { id: "t1", title: "বিষয় ১", url: "https://example.test/topics/t1/" },
          { id: "t2", title: "বিষয় ২", url: "https://example.test/topics/t2/" },
        ],
      },
      {
        id: "2",
        title: "পাঠ দুই",
        url: "https://example.test/lessons/2/",
        topicCount: 0,
        topics: [],
      },
    ],
  },
  {
    title: "দ্বিতীয় অংশ",
    lessons: [
      {
        id: "3",
        title: "পাঠ তিন",
        url: "https://example.test/lessons/3/",
        topicCount: 0,
        topics: [],
      },
    ],
  },
];

describe("parseRange", () => {
  test("parses single values and ranges", () => {
    expect([...parseRange("1,3-5")!]).toEqual([1, 3, 4, 5]);
    expect([...parseRange(2)!]).toEqual([2]);
    expect(parseRange(undefined)).toBeNull();
    expect(parseRange("")).toBeNull();
  });
});

describe("selectStructure", () => {
  test("keeps everything by default", () => {
    expect(selectStructure(SECTIONS, {})).toHaveLength(2);
  });

  test("filters sections and lessons", () => {
    const selected = selectStructure(SECTIONS, { sections: "2" });
    expect(selected).toHaveLength(1);
    expect(selected[0]!.title).toBe("দ্বিতীয় অংশ");

    const lessons = selectStructure(SECTIONS, { lessons: "1-2" });
    expect(lessons).toHaveLength(1);
    expect(lessons[0]!.lessons).toHaveLength(2);
  });

  test("filters topics inside a lesson", () => {
    const selected = selectStructure(SECTIONS, { lessons: "1", topics: "2" });
    expect(selected[0]!.lessons[0]!.topics.map((topic) => topic.title)).toEqual(["বিষয় ২"]);
  });
});

describe("slugify", () => {
  test("keeps Bengali letters", () => {
    expect(slugify("কাকাবাবু সমগ্র ৩")).toBe("কাকাবাবু-সমগ্র-৩");
    expect(slugify("  --Hello, World!-- ")).toBe("hello-world");
    expect(slugify("!!!")).toBe("book");
  });
});

describe("buildBook", () => {
  test("produces a valid EPUB from cached content", async () => {
    const dir = await tempDir();
    const workspace = Workspace.create(dir, "42", {
      courseId: "42",
      source: "https://example.test/books/demo/",
      metadata: {
        title: "ডেমো বই",
        authors: ["লেখক এক"],
        subjects: ["কিশোর সাহিত্য"],
      },
      sections: SECTIONS,
      hasSections: true,
      paging: { totalItems: 3, totalPages: 1, visibleLessons: 3, complete: true },
      items: {},
      images: {},
      warnings: [],
    });

    await workspace.writeContent("lesson", "1", "");
    await workspace.writeContent("lesson", "2", "<p>দ্বিতীয় পাঠের লেখা।</p>");
    await workspace.writeContent("lesson", "3", "<p>তৃতীয় পাঠের লেখা।</p>");
    await workspace.writeContent("topic", "t1", "<p>প্রথম বিষয়ের লেখা।</p>");
    await workspace.writeContent("topic", "t2", "<p>দ্বিতীয় বিষয়ের লেখা।</p>");

    const outDir = await tempDir();
    const result = await buildBook({
      workspace,
      outDir,
      cover: "generate",
      fonts: [],
      warn: () => {},
    });

    expect(result.stats.chapters).toBe(3);
    expect(result.stats.topics).toBe(2);
    expect(result.bytes).toBeGreaterThan(1000);

    const data = new Uint8Array(await readFile(result.file));
    const validation = validateEpub(data);
    expect(validation.ok).toBe(true);
    expect(validation.issues.filter((issue) => issue.level === "error")).toHaveLength(0);
  });

  test("merges topics into their lesson when asked", async () => {
    const dir = await tempDir();
    const workspace = Workspace.create(dir, "43", {
      courseId: "43",
      source: "https://example.test/books/demo/",
      metadata: { title: "ডেমো বই", authors: [], subjects: [] },
      sections: [SECTIONS[0]!],
      hasSections: true,
      paging: { totalItems: 2, totalPages: 1, visibleLessons: 2, complete: true },
      items: {},
      images: {},
      warnings: [],
    });
    await workspace.writeContent("lesson", "1", "<p>পাঠ।</p>");
    await workspace.writeContent("lesson", "2", "<p>পাঠ দুই।</p>");
    await workspace.writeContent("topic", "t1", "<p>বিষয় এক।</p>");
    await workspace.writeContent("topic", "t2", "<p>বিষয় দুই।</p>");

    const outDir = await tempDir();
    const result = await buildBook({
      workspace,
      outDir,
      cover: "none",
      fonts: [],
      mergeTopics: true,
      warn: () => {},
    });

    expect(result.stats.topics).toBe(0);
    expect(result.stats.chapters).toBe(2);
  });

  test("fails when content is missing unless partial builds are allowed", async () => {
    const dir = await tempDir();
    const workspace = Workspace.create(dir, "44", {
      courseId: "44",
      source: "https://example.test/books/demo/",
      metadata: { title: "ডেমো", authors: [], subjects: [] },
      sections: SECTIONS,
      hasSections: true,
      paging: { totalItems: 3, totalPages: 1, visibleLessons: 3, complete: true },
      items: {},
      images: {},
      warnings: [],
    });
    await workspace.writeContent("lesson", "2", "<p>পাঠ দুই।</p>");

    const outDir = await tempDir();
    await expect(
      buildBook({ workspace, outDir, cover: "none", fonts: [], warn: () => {} }),
    ).rejects.toThrow(/Missing content/);

    const partial = await buildBook({
      workspace,
      outDir,
      cover: "none",
      fonts: [],
      allowPartial: true,
      warn: () => {},
    });
    expect(partial.stats.missing).toBeGreaterThan(0);
  });
});
