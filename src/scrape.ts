import { join } from "node:path";
import { EblibError, EXIT, SITE } from "./config.ts";
import type { HttpClient } from "./http/client.ts";
import { exists, readJson, writeJson } from "./io.ts";
import type { Output } from "./log.ts";
import { extractContent, imageSources } from "./site/content.ts";
import {
  parseCourseId,
  parseCourseIntro,
  parseLessonPage,
  parseMetadata,
  parsePaging,
  parseStructure,
  type CourseNode,
  type Lesson,
  type LessonPage,
} from "./site/course.ts";
import { downloadImage } from "./site/images.ts";
import { hashText, itemKey, Workspace, type BookState } from "./store/workspace.ts";
import { countItems, selectStructure, type Selection } from "./build/select.ts";

export interface ScrapeOptions {
  url: string;
  cacheDir: string;
  out: Output;
  resume?: boolean;
  refresh?: boolean;
  refreshStructure?: boolean;
  refreshContent?: boolean;
  offline?: boolean;
  skipTopics?: boolean;
  failFast?: boolean;
  selection?: Selection;
}

export interface ScrapeReport {
  courseId: string;
  title: string;
  source: string;
  lessons: number;
  topics: number;
  failed: Array<{ title: string; url: string; error: string }>;
  images: number;
  warnings: string[];
  startedAt: string;
  finishedAt: string;
}

export interface ScrapeResult {
  workspace: Workspace;
  report: ScrapeReport;
}

/** Accept a full course URL, a numeric course id, or a `/books/<slug>/` path. */
export function normalizeCourseUrl(input: string): string {
  if (/^\d+$/.test(input)) return `${SITE}/?p=${input}`;
  if (/^https?:\/\//i.test(input)) return input;
  return `${SITE}${input.startsWith("/") ? "" : "/"}${input}`;
}

/**
 * Fetch structure, then content, then images. Every response goes through the
 * HTTP cache, so a rerun only pays for what is missing.
 */
export async function scrapeCourse(client: HttpClient, options: ScrapeOptions): Promise<ScrapeResult> {
  const startedAt = new Date().toISOString();
  const source = normalizeCourseUrl(options.url);
  const page = await client.getPage(source, {
    refresh: options.refresh || options.refreshStructure,
    offline: options.offline,
  });

  const courseId = parseCourseId(page.text);
  if (!courseId) throw new EblibError(`No LearnDash course found at ${source}`, EXIT.invalid);

  const metadata = parseMetadata(page.text);
  const introHtml = parseCourseIntro(page.text);
  const { sections, hasSections } = parseStructure(page.text);
  if (sections.length === 0) throw new EblibError(`Course ${courseId} has no lessons`, EXIT.invalid);

  const paging = parsePaging(page.text);
  const visibleLessons = sections.reduce((total, section) => total + section.lessons.length, 0);

  const existing = options.resume === false ? null : await Workspace.open(options.cacheDir, courseId);
  const workspace =
    existing ??
    Workspace.create(options.cacheDir, courseId, {
      courseId,
      source,
      metadata,
      sections,
      hasSections,
      paging: {
        totalItems: paging.totalItems || visibleLessons,
        totalPages: paging.totalPages || 1,
        visibleLessons,
        complete: visibleLessons >= (paging.totalItems || visibleLessons),
      },
      items: {},
      images: {},
      warnings: [],
    } satisfies Omit<BookState, "updatedAt">);

  if (existing) {
    workspace.state.metadata = metadata;
    workspace.state.source = source;
    workspace.state.sections = sections;
    workspace.state.hasSections = hasSections;
  }

  if (introHtml) {
    workspace.state.introHtml = introHtml;
    await workspace.writeContent("intro", courseId, introHtml);
  }

  const state = workspace.state;
  if (state.paging.totalItems > visibleLessons && options.selection?.lessons === undefined) {
    await resolveTail(client, workspace, options);
  }

  await saveCover(client, workspace, options);

  const selected = selectStructure(state.sections, options.selection ?? {});
  const totals = countItems(selected);
  options.out.progress(
    `${metadata.title} — ${totals.lessons} lessons, ${totals.topics} topics`,
  );

  let done = 0;
  const report: ScrapeReport = {
    courseId,
    title: metadata.title,
    source,
    lessons: 0,
    topics: 0,
    failed: [],
    images: 0,
    warnings: state.warnings,
    startedAt,
    finishedAt: "",
  };

  const seenTopics = new Set<string>();

  for (const section of selected) {
    for (const lesson of section.lessons) {
      done += 1;
      try {
        const topics = options.skipTopics ? [] : await scanTopics(client, lesson, options);
        await storePage(workspace, client, "lesson", lesson.id, lesson.url, lesson.title, options);
        report.lessons += 1;

        for (const topic of topics) {
          const key = itemKey("topic", topic.id);
          if (seenTopics.has(key)) continue;
          seenTopics.add(key);
          await storePage(workspace, client, "topic", topic.id, topic.url, topic.title, options);
          report.topics += 1;
        }
      } catch (cause) {
        if (cause instanceof EblibError && cause.exitCode === EXIT.auth) throw cause;
        const error = cause as Error;
        report.failed.push({ title: lesson.title, url: lesson.url, error: error.message });
        await workspace.markFailed("lesson", lesson.id, error.message);
        options.out.warn(`${lesson.title}: ${error.message}`);
        if (options.failFast) throw cause;
      }

      if (done % 5 === 0) {
        await workspace.save();
        options.out.event({ event: "progress", done, total: totals.lessons });
        options.out.progress(`  ${done}/${totals.lessons}`);
      }
    }
  }

  report.images = Object.keys(state.images).length;
  report.finishedAt = new Date().toISOString();
  await workspace.save();
  await writeJson(workspace.path("report.json"), report);

  if (report.failed.length > 0) {
    workspace.addWarning(`${report.failed.length} item(s) failed; rerun with --resume`);
    await workspace.save();
  }

  return { workspace, report };
}

/** Follow the "Next Lesson" chain when the course page truncates its list. */
async function resolveTail(client: HttpClient, workspace: Workspace, options: ScrapeOptions): Promise<void> {
  const state = workspace.state;
  const allLessons = state.sections.flatMap((section) => section.lessons);
  const last = allLessons[allLessons.length - 1];
  if (!last) return;

  const lastSection = state.sections[state.sections.length - 1]!;
  const seen = new Set(allLessons.map((lesson) => lesson.url));
  const needed = state.paging.totalItems - allLessons.length;
  let added = 0;
  let url: string | undefined = last.url;

  while (url && added < needed) {
    const response = await client.getPage(url, {
      refresh: options.refresh || options.refreshStructure,
      offline: options.offline,
    });
    const page = parseLessonPage(response.text);
    if (page.courseId && page.courseId !== state.courseId) break;

    if (url !== last.url) {
      const id = /learndash-cpt-sfwd-lessons-(\d+)-current/.exec(response.text)?.[1] ?? url;
      lastSection.lessons.push({
        id,
        title: page.title ?? `Lesson ${allLessons.length + added + 1}`,
        url,
        topics: page.topics,
        topicCount: page.topics.length,
      });
      added += 1;
    }

    const next: string | undefined = page.nextUrl ? new URL(page.nextUrl, url).href : undefined;
    if (!next || seen.has(next)) break;
    seen.add(next);
    url = next;
  }

  if (added > 0) {
    state.paging.visibleLessons = allLessons.length + added;
    state.paging.complete = state.paging.visibleLessons >= state.paging.totalItems;
    workspace.addWarning(
      `structure-truncated: ${added} lesson(s) appended to "${lastSection.title || "last section"}" without section names`,
    );
    if (!state.paging.complete) {
      workspace.addWarning(
        `structure-truncated: the lesson chain ended at ${state.paging.visibleLessons} of ${state.paging.totalItems} reported items`,
      );
    }
    await workspace.save();
  }
}

/** LearnDash sometimes hides topics from the course list; the page still has them. */
async function scanTopics(
  client: HttpClient,
  lesson: Lesson,
  options: ScrapeOptions,
): Promise<CourseNode[]> {
  if (lesson.topics.length > 0) return lesson.topics;
  const response = await client.getPage(lesson.url, {
    refresh: options.refresh || options.refreshContent,
    offline: options.offline,
  });
  const page = parseLessonPage(response.text);
  if (page.topics.length > 0) lesson.topics = page.topics;
  return lesson.topics;
}

async function storePage(
  workspace: Workspace,
  client: HttpClient,
  kind: "lesson" | "topic",
  id: string,
  url: string,
  title: string,
  options: ScrapeOptions,
): Promise<void> {
  const response = await client.getPage(url, {
    refresh: options.refresh || options.refreshContent,
    offline: options.offline,
  });
  const page: LessonPage = parseLessonPage(response.text);
  const html = extractContent(response.text, { baseUrl: url, title: page.title ?? title });

  const images = await cacheImages(workspace, client, html, options);
  const existing = workspace.item(kind, id);
  const unchanged = existing?.status === "done" && existing.hash === hashOf(html);
  if (!unchanged || options.refresh || options.refreshContent) {
    await workspace.writeContent(kind, id, html, images);
  }
  await workspace.save();
}

async function cacheImages(
  workspace: Workspace,
  client: HttpClient,
  html: string,
  options: ScrapeOptions,
): Promise<number> {
  const dir = workspace.path("images");
  let count = 0;
  for (const url of imageSources(html)) {
    if (!/^https?:/i.test(url)) continue;
    const known = workspace.state.images[url];
    if (known && !options.refresh && (await exists(workspace.path(known.file)))) {
      count += 1;
      continue;
    }
    try {
      const image = await downloadImage(client, url, dir, {
        refresh: options.refresh,
        offline: options.offline,
      });
      workspace.state.images[url] = {
        file: `images/${image.file.split("/").pop()}`,
        width: image.width,
        height: image.height,
      };
      count += 1;
    } catch (cause) {
      workspace.addWarning(`image failed: ${url} (${(cause as Error).message})`);
    }
  }
  return count;
}

async function saveCover(
  client: HttpClient,
  workspace: Workspace,
  options: ScrapeOptions,
): Promise<void> {
  const cover = workspace.state.metadata.cover;
  if (!cover) return;
  const dir = workspace.path("cover");
  try {
    const image = await downloadImage(client, cover, dir, {
      refresh: options.refresh,
      offline: options.offline,
    });
    workspace.state.metadata.coverFile = `cover/${image.file.split("/").pop()}`;
    workspace.state.metadata.coverWidth = image.width;
    workspace.state.metadata.coverHeight = image.height;
    await workspace.save();
  } catch (cause) {
    workspace.addWarning(`cover download failed: ${(cause as Error).message}`);
  }
}

function hashOf(html: string): string {
  return hashText(html);
}

/** Read an existing workspace or fail with a hint to scrape first. */
export async function openWorkspace(cacheDir: string, courseId: string): Promise<Workspace> {
  const workspace = await Workspace.open(cacheDir, courseId);
  if (!workspace) {
    throw new EblibError(
      `No cached book for course ${courseId} in ${cacheDir}; run "eblib scrape <url>" first`,
      EXIT.usage,
    );
  }
  return workspace;
}

/** Guess the course id from a workspace path or a numeric id. */
export async function resolveCourseId(target: string): Promise<string> {
  if (/^\d+$/.test(target)) return target;
  const state = await readJson<BookState>(join(target, "book.json"));
  if (state?.courseId) return state.courseId;
  const fromDir = /books[/\\](\d+)/.exec(target)?.[1];
  if (fromDir) return fromDir;
  throw new EblibError(`Cannot tell which course ${target} belongs to`, EXIT.usage);
}
