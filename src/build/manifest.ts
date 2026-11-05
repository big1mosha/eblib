import type { BookImage, BookInput, ChapterInput, FontInput, PartInput, ThemeName } from "@epubkit/core";
import type { CoverAsset } from "@epubkit/core";
import { parseCourseIntro, splitIntroPages, type Lesson, type Section } from "../site/course.ts";
import { HttpCache } from "../http/cache.ts";
import { rewriteImageSources } from "../site/content.ts";
import type { Workspace } from "../store/workspace.ts";
import { selectStructure, type Selection } from "./select.ts";

export type PartsMode = "auto" | "always" | "never";

export interface ManifestOptions {
  selection?: Selection;
  skipTopics?: boolean;
  mergeTopics?: boolean;
  parts?: PartsMode;
  style?: ThemeName;
  splitSizeKb?: number;
  cover?: CoverAsset;
  fonts?: FontInput[];
  images?: BookImage[];
  allowPartial?: boolean;
  language?: string;
  titleOverride?: string;
  authorsOverride?: string[];
}

export interface ManifestStats {
  parts: number;
  chapters: number;
  topics: number;
  empty: number;
  missing: number;
  words: number;
}

export interface ManifestResult {
  input: BookInput;
  stats: ManifestStats;
  missing: string[];
}

/**
 * Turn a scraped workspace into the plain `BookInput` the EPUB writer expects.
 * Sections become part pages, lessons become chapters, and topics become
 * sub-chapters (or are merged into their lesson with `mergeTopics`).
 */
export async function buildManifest(
  workspace: Workspace,
  options: ManifestOptions = {},
): Promise<ManifestResult> {
  const state = workspace.state;
  const selection = selectStructure(state.sections, options.selection ?? {});
  const missing: string[] = [];
  const stats: ManifestStats = { parts: 0, chapters: 0, topics: 0, empty: 0, missing: 0, words: 0 };

  const imageMap = new Map<string, string>();
  for (const [url, image] of Object.entries(state.images ?? {})) {
    imageMap.set(url, `../${image.file}`);
  }

  const contentOf = async (kind: "lesson" | "topic", id: string, title: string): Promise<string | undefined> => {
    const html = await workspace.readContent(kind, id);
    if (html === null) {
      missing.push(`${kind} ${title}`);
      stats.missing += 1;
      return options.allowPartial ? placeholder(title) : undefined;
    }
    stats.words += countWords(html);
    return rewriteImageSources(html, imageMap);
  };

  let introHtml: string | undefined = undefined;
  try {
    introHtml = (await workspace.readContent("intro", state.courseId)) ?? state.introHtml;
    if (!introHtml && (state.metadata.source || state.source)) {
      const cache = await HttpCache.open(workspace.cacheDir);
      const cached = await cache.get(state.metadata.source ?? state.source);
      if (cached?.bytes) {
        const text = new TextDecoder().decode(cached.bytes);
        introHtml = parseCourseIntro(text);
        if (introHtml) {
          await workspace.writeContent("intro", state.courseId, introHtml);
          state.introHtml = introHtml;
        }
      }
    }
  } catch {
    // Non-fatal if intro cannot be read
  }

  const extraPages: ChapterInput[] = [];
  if (introHtml) {
    const pages = splitIntroPages(introHtml);
    for (const p of pages) {
      extraPages.push({
        title: p.title,
        html: rewriteImageSources(p.html, imageMap),
      });
    }
  }

  const partsMode = options.parts ?? "auto";
  const sections = partsMode === "never" ? flatten(selection) : selection;
  const parts: PartInput[] = [];

  for (const section of sections) {
    const lessons: ChapterInput[] = [];
    for (const lesson of section.lessons) {
      const chapter = await buildLesson(lesson, contentOf, options, stats);
      if (chapter) lessons.push(chapter);
    }
    if (lessons.length === 0) continue;

    const title = partsMode === "never" ? undefined : section.title || undefined;
    parts.push({ title, lessons });
  }

  if (partsMode === "always" && parts.length === 1 && !parts[0]!.title) {
    parts[0]!.title = state.metadata.title;
  }
  stats.parts = parts.filter((part) => part.title).length;

  const input: BookInput = {
    title: options.titleOverride ?? state.metadata.title,
    authors: options.authorsOverride ?? state.metadata.authors,
    language: options.language ?? "bn",
    description: state.metadata.description,
    subjects: state.metadata.subjects,
    series: state.metadata.series,
    source: state.metadata.source ?? state.source,
    date: state.metadata.published?.slice(0, 10),
    publisher: state.metadata.publisher,
    cover: options.cover,
    fonts: options.fonts,
    images: options.images,
    extraPages: extraPages.length > 0 ? extraPages : undefined,
    parts,
    style: options.style ?? "classic",
    splitSizeKb: options.splitSizeKb ?? 200,
    rights: "ব্যক্তিগত ব্যবহারের জন্য। পুনর্বিতরণ নিষিদ্ধ।",
  };

  return { input, stats, missing };
}

type ContentLoader = (
  kind: "lesson" | "topic",
  id: string,
  title: string,
) => Promise<string | undefined>;

async function buildLesson(
  lesson: Lesson,
  contentOf: ContentLoader,
  options: ManifestOptions,
  stats: ManifestStats,
): Promise<ChapterInput | null> {
  const html = await contentOf("lesson", lesson.id, lesson.title);
  const topics = options.skipTopics ? [] : lesson.topics;

  if (html === undefined && topics.length === 0) {
    stats.empty += 1;
    return null;
  }

  if (options.mergeTopics && topics.length > 0) {
    const merged: string[] = [];
    if (html) merged.push(html);
    for (const topic of topics) {
      const topicHtml = await contentOf("topic", topic.id, topic.title);
      if (topicHtml === undefined) continue;
      merged.push(`<h3>${escapeXml(topic.title)}</h3>`, topicHtml);
    }
    stats.chapters += 1;
    return { title: lesson.title, html: merged.join("\n") };
  }

  const topicInputs: ChapterInput[] = [];
  for (const topic of topics) {
    const topicHtml = await contentOf("topic", topic.id, topic.title);
    if (topicHtml === undefined) continue;
    stats.topics += 1;
    topicInputs.push({ title: topic.title, html: topicHtml });
  }

  if (!html && topicInputs.length === 0) {
    stats.empty += 1;
    return null;
  }

  stats.chapters += 1;
  return {
    title: lesson.title,
    html,
    topics: topicInputs.length > 0 ? topicInputs : undefined,
  };
}

function flatten(sections: Section[]): Section[] {
  return [{ title: "", lessons: sections.flatMap((section) => section.lessons) }];
}

function placeholder(title: string): string {
  return `<p class="missing">[এই অংশটি সংগ্রহ করা যায়নি: ${escapeXml(title)}]</p>`;
}

function countWords(html: string): number {
  const text = html.replace(/<[^>]*>/g, " ");
  return text.split(/\s+/).filter((word) => word.length > 0).length;
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
