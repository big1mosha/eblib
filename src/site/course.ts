import * as cheerio from "cheerio";
import type { Element } from "domhandler";
import { sanitizeHtml } from "@epubkit/core";

export interface CourseNode {
  id: string;
  title: string;
  url: string;
}

export interface Lesson extends CourseNode {
  topics: CourseNode[];
  /** Number the site claims in the "N Topics" badge. */
  topicCount: number;
  /** Emit the chapter without a heading (opening page of a single-page book). */
  heading?: boolean;
  /** Leave the chapter out of the table of contents. */
  inToc?: boolean;
}

export interface Section {
  title: string;
  lessons: Lesson[];
}

export interface BookMetadata {
  title: string;
  authors: string[];
  series?: string;
  subjects: string[];
  cover?: string;
  source?: string;
  description?: string;
  published?: string;
  publisher?: string;
  /** Which provider filled the fields above, if any. */
  enrichment?: { source: string; matchedTitle: string; at: string };
}

export interface PagingInfo {
  totalItems: number;
  totalPages: number;
  visibleLessons: number;
  complete: boolean;
}

export interface Course {
  courseId: string;
  metadata: BookMetadata;
  sections: Section[];
  hasSections: boolean;
  paging: PagingInfo;
}

export interface LessonPage {
  courseId?: string;
  title?: string;
  nextUrl?: string;
  topics: CourseNode[];
  contentHtml?: string;
}

export function parseCourseId(html: string): string | undefined {
  const classMatch = /ld-course-content-(\d+)/.exec(html);
  if (classMatch) return classMatch[1];
  const instance = /data-shortcode_instance="([^"]+)"/.exec(html);
  if (instance) {
    const decoded = decodeEntities(instance[1]!);
    const id = /"course_id":(\d+)/.exec(decoded);
    if (id) return id[1];
  }
  const body = /learndash-cpt-sfwd-courses-(\d+)-parent/.exec(html);
  if (body) return body[1];
  // Single-page courses have no lesson list, but still render the course
  // wrapper and the content tab with the course id.
  const wrapper = /id="learndash_post_(\d+)"/.exec(html);
  if (wrapper) return wrapper[1];
  return /ld-tab-content-(\d+)/.exec(html)?.[1];
}

export function parseMetadata(html: string): BookMetadata {
  const $ = cheerio.load(html);
  const text = (selector: string): string => collapse($(selector).first().text());

  const title =
    text("h1.page-header-title") ||
    text(".entry-title") ||
    attr($, 'meta[property="og:title"]', "content") ||
    collapse($("title").text());

  const authors = unique(
    $(".entry-terms-authors a")
      .toArray()
      .map((element) => collapse($(element).text())),
  );

  // The site often writes "Book – Author" in the title field.
  const cleanTitle = stripAuthorSuffix(title, authors);

  const series = text(".entry-terms-series a") || undefined;

  const subjects = unique(
    $(".entry-terms-ld_course_category a")
      .toArray()
      .map((element) => collapse($(element).text())),
  );

  const cover = pickCover($);

  const source =
    attr($, 'link[rel="canonical"]', "href") || attr($, 'meta[property="og:url"]', "content") || undefined;

  const description = attr($, 'meta[name="description"]', "content") || undefined;
  const published =
    attr($, 'meta[property="article:published_time"]', "content") ||
    attr($, "time.entry-time", "datetime") ||
    undefined;

  return {
    title: cleanTitle || "Untitled",
    authors,
    series,
    subjects,
    cover,
    source,
    description,
    published,
  };
}

function pickCover($: cheerio.CheerioAPI): string | undefined {
  const og = attr($, 'meta[property="og:image"]', "content");
  if (og) return og;

  const image = $("figure.entry-image img, .entry-image img").first();
  const dataSrc = image.attr("data-src") ?? image.attr("data-lazy-src");
  if (dataSrc) return dataSrc;
  const srcset = image.attr("data-srcset") ?? image.attr("srcset");
  const fromSrcset = largestSrcset(srcset);
  if (fromSrcset) return fromSrcset;
  return image.attr("src") || undefined;
}

/** Drop a trailing "– Author" when the author is already a separate field. */
function stripAuthorSuffix(title: string, authors: string[]): string {
  const normalized = title.normalize("NFC");
  for (const author of authors) {
    const name = author.normalize("NFC");
    if (!name) continue;
    const suffix = new RegExp(`\\s*[–—\\-]\\s*${escapeRegExp(name)}\\s*$`);
    if (suffix.test(normalized)) return normalized.replace(suffix, "").trim();
  }
  return title;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function largestSrcset(srcset: string | undefined): string | undefined {
  if (!srcset) return undefined;
  let best: { url: string; weight: number } | undefined;
  for (const part of srcset.split(",")) {
    const [url, descriptor] = part.trim().split(/\s+/);
    if (!url) continue;
    const weight = descriptor?.endsWith("w")
      ? Number(descriptor.slice(0, -1))
      : descriptor?.endsWith("x")
        ? Number(descriptor.slice(0, -1)) * 1000
        : 1;
    if (!best || weight > best.weight) best = { url, weight };
  }
  return best?.url;
}

export function parseStructure(html: string): { sections: Section[]; hasSections: boolean } {
  const $ = cheerio.load(html);
  const container = $(".ld-item-list-items")
    .toArray()
    .find((element) => $(element).find(".ld-item-list-item.ld-item-lesson-item").length > 0);

  if (!container) return { sections: [], hasSections: false };

  const sections: Section[] = [];
  let current: Section | undefined;
  let sawSection = false;

  for (const child of $(container).children().toArray()) {
    const element = $(child);
    if (element.hasClass("ld-item-list-section-heading")) {
      const title = collapse(element.find(".ld-lesson-section-heading").first().text());
      current = { title: title || "Untitled section", lessons: [] };
      sections.push(current);
      sawSection = true;
      continue;
    }
    if (!element.hasClass("ld-item-lesson-item")) continue;

    const lesson = parseLesson($, element);
    if (!lesson) continue;
    if (!current) {
      current = { title: "", lessons: [] };
      sections.push(current);
    }
    current.lessons.push(lesson);
  }

  const filled = sections.filter((section) => section.lessons.length > 0);
  return { sections: filled, hasSections: sawSection && filled.some((section) => section.title !== "") };
}

function parseLesson($: cheerio.CheerioAPI, element: cheerio.Cheerio<Element>): Lesson | null {
  const link = element.find("a.ld-item-name").first();
  const url = link.attr("href");
  if (!url) return null;

  const titleNode = element.find(".ld-item-title").first().clone();
  titleNode.find(".ld-item-components").remove();
  const title = collapse(titleNode.text()) || "Untitled";

  const id =
    /ld-lesson-item-(\d+)/.exec(element.attr("class") ?? "")?.[1] ??
    /ld-expand-(\d+)/.exec(element.attr("id") ?? "")?.[1] ??
    url;

  const topics: CourseNode[] = [];
  element.find(".ld-item-list-item-expanded a.ld-topic-row").each((_, row) => {
    const topic = parseTopic($, $(row));
    if (topic) topics.push(topic);
  });

  const badge = collapse(element.find(".ld-item-components").first().text());
  const topicCount = Number(/(\d+)\s*Topics?/i.exec(badge)?.[1] ?? topics.length);

  return { id, title, url, topics, topicCount };
}

export function parseTopic($: cheerio.CheerioAPI, row: cheerio.Cheerio<Element>): CourseNode | null {
  const url = row.attr("href");
  if (!url) return null;
  const title = collapse(row.find(".ld-topic-title").first().text()) || collapse(row.text()) || "Untitled";
  const item = row.closest(".ld-table-list-item");
  const id =
    /ld-table-list-item-(\d+)/.exec(item.attr("class") ?? "")?.[1] ??
    /ld-table-list-item-(\d+)/.exec(item.attr("id") ?? "")?.[1] ??
    hashUrl(url);
  return { id, title, url };
}

export function parsePaging(html: string): { totalItems: number; totalPages: number } {
  const $ = cheerio.load(html);
  const raw = $(".ld-pagination").first().attr("data-pager-results");
  if (!raw) return { totalItems: 0, totalPages: 0 };
  try {
    const parsed = JSON.parse(raw) as { total_items?: number; total_pages?: number };
    return { totalItems: Number(parsed.total_items ?? 0), totalPages: Number(parsed.total_pages ?? 0) };
  } catch {
    return { totalItems: 0, totalPages: 0 };
  }
}

/** Parse a lesson or topic page: title, parent course, next lesson, topics, content. */
export function parseLessonPage(html: string): LessonPage {
  const $ = cheerio.load(html);

  const courseId = /learndash-cpt-sfwd-courses-(\d+)-parent/.exec(html)?.[1];

  const title =
    collapse($(".ld-lesson-item.ld-is-current-lesson .ld-lesson-title").first().text()) ||
    collapse($("h1.ld-focus-mode-course-title, .ld-focus-mode-course-title").first().text()) ||
    undefined;

  let nextUrl: string | undefined;
  $("a").each((_, element) => {
    if (nextUrl) return;
    const label = collapse($(element).find(".ld-text").first().text());
    if (label === "Next Lesson" || label === "Next Topic") {
      nextUrl = $(element).attr("href");
    }
  });

  // In focus mode the sidebar lists every lesson; only the current lesson's
  // topics belong to this page.
  const current = $(".ld-lesson-item.ld-is-current-lesson").first();
  const scope = current.length > 0 ? current : $("body");
  const topics: CourseNode[] = [];
  scope.find("a.ld-topic-row").each((_, row) => {
    const topic = parseTopic($, $(row));
    if (topic) topics.push(topic);
  });

  const content = $("div.ld-tab-content.entry-content").first();
  const contentHtml = content.length > 0 ? content.html() ?? undefined : undefined;

  return { courseId, title, nextUrl, topics, contentHtml };
}

function attr($: cheerio.CheerioAPI, selector: string, name: string): string | undefined {
  return $(selector).first().attr(name) || undefined;
}

function collapse(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function unique(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))];
}

/** Stable, filesystem-safe id for topics that appear without a numeric id. */
function hashUrl(url: string): string {
  return `t${new Bun.CryptoHasher("sha256").update(url).digest("hex").slice(0, 10)}`;
}

export function decodeEntities(value: string): string {
  return value
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

export function parseCourseIntro(html: string): string | undefined {
  const $ = cheerio.load(html);
  let content = $("div.ld-tab-content.entry-content").first();
  if (content.length === 0) content = $(".ld-tab-content").first();
  if (content.length === 0) content = $(".entry-content").first();
  if (content.length === 0) return undefined;

  content.find("button.simplefavorite-button, .simplefavorite-button").remove();
  const raw = content.html()?.trim();
  if (!raw) return undefined;
  return sanitizeHtml(raw);
}

export interface PageChapter {
  title: string;
  html: string;
  /** False for the opening text that sits before the first heading. */
  heading: boolean;
}

/** The site separates front matter from the book text with a lone dot. */
function isPageBreak(value: string): boolean {
  const text = value.trim();
  return text === "." || text === "•" || text === "·" || text === "।";
}

/**
 * The content tab wraps everything in plain <div>s. Flatten them into the
 * block-level elements they hold, so paragraphs and headings can be grouped.
 */
function flattenBlocks($: cheerio.CheerioAPI, elements: cheerio.Cheerio<Element>): Element[] {
  const blocks: Element[] = [];
  const walk = (nodes: cheerio.Cheerio<Element>): void => {
    nodes.each((_, element) => {
      const node = $(element);
      if (node.is("div, section, article") && node.children().length > 0) {
        // Unwrap structural containers, but keep divs whose own text is the
        // content (leaves are pushed below). The site pads them with
        // whitespace, so ignore text nodes that are only spaces.
        const hasOwnText = node.contents().toArray().some(
          (child) => child.type === "text" && (child as { data?: string }).data?.trim(),
        );
        if (!hasOwnText) {
          walk(node.children());
          return;
        }
      }
      // Drop empty layout divs left behind by the unwrapping above.
      if (node.is("div, section, article") && node.children().length === 0 && !node.text().trim()) {
        return;
      }
      blocks.push(element);
    });
  };
  walk(elements);
  return blocks;
}

/**
 * Split the front matter (title, imprint, publisher) from the book text at the
 * first lone-dot paragraph.
 */
export function splitPageFrontMatter(contentHtml: string): { details?: string; body: string } {
  const $ = cheerio.load(`<div id="__root">${contentHtml}</div>`, null, false);
  const blocks = flattenBlocks($, $("#__root").children());
  const index = blocks.findIndex((element) => $(element).is("p") && isPageBreak($(element).text()));
  if (index === -1) return { body: contentHtml };

  const join = (elements: Element[]) =>
    elements.map((element) => $.html(element)).join("\n").trim();
  return {
    details: join(blocks.slice(0, index)) || undefined,
    body: join(blocks.slice(index + 1)),
  };
}

/**
 * Some courses have no lessons at all: the whole book sits in the content tab
 * as one HTML blob. Split it into chapters at h2/h3 headings; the text before
 * the first heading stays an unheaded opening page.
 */
export function splitPageChapters(contentHtml: string, fallbackTitle: string): PageChapter[] {
  const $ = cheerio.load(`<div id="__root">${contentHtml}</div>`, null, false);
  const chapters: PageChapter[] = [];
  let title = fallbackTitle;
  let heading = false;
  let nodes: string[] = [];

  const flush = () => {
    const html = nodes.join("\n").trim();
    nodes = [];
    if (!html) return;
    const text = cheerio.load(html, null, false).root().text().trim();
    if (!text) return;
    chapters.push({ title, html, heading });
  };

  for (const element of flattenBlocks($, $("#__root").children())) {
    const node = $(element);
    const found = node.is("h2, h3") ? collapse(node.text()) : "";
    if (found && found.length <= 80) {
      flush();
      title = found;
      heading = true;
      continue;
    }
    nodes.push($.html(element));
  }
  flush();

  if (chapters.length === 0) {
    const html = contentHtml.trim();
    return html ? [{ title: fallbackTitle, html, heading: true }] : [];
  }
  return chapters;
}

/** Split the content tab of a lesson-less course page into chapters. */
export function parsePageChapters(pageHtml: string, fallbackTitle: string): PageChapter[] {
  const content = parseCourseIntro(pageHtml);
  if (!content) return [];
  return splitPageChapters(splitPageFrontMatter(content).body, fallbackTitle);
}

export function splitIntroPages(html: string): Array<{ title: string; html: string }> {
  if (!html.trim()) return [];
  const $ = cheerio.load(`<div id="__root">${html}</div>`, null, false);
  const pages: Array<{ title: string; html: string }> = [];
  let currentElements: string[] = [];

  const flush = () => {
    if (currentElements.length === 0) return;
    const chunkHtml = currentElements.join("\n").trim();
    if (chunkHtml) {
      const page$ = cheerio.load(`<div id="__page">${chunkHtml}</div>`, null, false);
      let pageTitle = "";
      const heading = page$("#__page h1, #__page h2, #__page h3, #__page h4").first();
      if (heading.length > 0) {
        pageTitle = heading.text().trim();
      } else {
        const firstStrong = page$("#__page p strong, #__page strong").first();
        if (firstStrong.length > 0) {
          const strongText = firstStrong.text().trim();
          if (strongText.length > 0 && strongText.length < 50) {
            pageTitle = strongText.split(/[–—\-:\n]/)[0]?.trim() || strongText;
          }
        }
      }
      if (!pageTitle) {
        pageTitle = "কিছু কথা";
      }
      pages.push({ title: pageTitle, html: chunkHtml });
    }
    currentElements = [];
  };

  for (const element of flattenBlocks($, $("#__root").children())) {
    const node = $(element);
    if (node.is("p") && isPageBreak(node.text())) {
      flush();
    } else {
      currentElements.push($.html(element));
    }
  }
  flush();

  return pages;
}
