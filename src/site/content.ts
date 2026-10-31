import * as cheerio from "cheerio";
import { sanitizeHtml } from "@epubkit/core";

export interface ExtractOptions {
  /** Absolute page URL, used to resolve relative links and images. */
  baseUrl: string;
  /** Page title; a leading duplicate heading is dropped. */
  title?: string;
}

/**
 * Pull the LearnDash content tab out of a lesson/topic page and reduce it to
 * safe XHTML with absolute image URLs.
 */
export function extractContent(html: string, options: ExtractOptions): string {
  const $ = cheerio.load(html);

  let content = $("div.ld-tab-content.entry-content").first();
  if (content.length === 0) content = $(".ld-tab-content").first();
  if (content.length === 0) content = $(".entry-content").first();
  if (content.length === 0) return "";

  content.find("button.simplefavorite-button, .simplefavorite-button").remove();

  // Embeds cannot live inside an EPUB, so keep a link to the source.
  content.find("iframe[src]").each((_, element) => {
    const src = $(element).attr("src");
    if (!src) return;
    $(element).replaceWith(
      `<p class="embed"><a href="${src.replace(/"/g, "&quot;")}">${src}</a></p>`,
    );
  });

  const raw = content.html() ?? "";
  return sanitizeHtml(raw, { baseUrl: options.baseUrl, title: options.title });
}

export function contentText(html: string): string {
  if (!html) return "";
  const $ = cheerio.load(`<div id="__root">${html}</div>`, null, false);
  return ($("#__root").text() ?? "").replace(/\s+/g, " ").trim();
}

/** True when the fragment has no readable text and no images. */
export function isEmptyContent(html: string): boolean {
  if (!html.trim()) return true;
  const $ = cheerio.load(`<div id="__root">${html}</div>`, null, false);
  const hasImage = $("#__root img").length > 0;
  const text = ($("#__root").text() ?? "").replace(/\s+/g, "");
  return !hasImage && text.length < 2;
}

export function imageSources(html: string): string[] {
  if (!html) return [];
  const $ = cheerio.load(`<div id="__root">${html}</div>`, null, false);
  const sources: string[] = [];
  $("#__root img").each((_, element) => {
    const src = $(element).attr("src");
    if (src) sources.push(src);
  });
  return [...new Set(sources)];
}

/** Rewrite absolute image URLs to archive-relative paths. */
export function rewriteImageSources(html: string, mapping: Map<string, string>): string {
  if (mapping.size === 0) return html;
  const $ = cheerio.load(`<div id="__root">${html}</div>`, null, false);
  $("#__root img").each((_, element) => {
    const src = $(element).attr("src");
    if (!src) return;
    const next = mapping.get(src);
    if (next) $(element).attr("src", next);
  });
  return $("#__root").html() ?? html;
}
