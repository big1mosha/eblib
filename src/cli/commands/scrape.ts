import { copyFile } from "node:fs/promises";
import { EblibError, EXIT } from "../../config.ts";
import { buildBook } from "../../build/book.ts";
import { resolveFonts } from "../../build/fonts.ts";
import { scrapeCourse } from "../../scrape.ts";
import { enrichWorkspace } from "../../enrich.ts";
import { parseMetadata, parsePageChapters, parsePaging, parseStructure } from "../../site/course.ts";
import {
  cacheDirFor,
  clientFor,
  coverModeFrom,
  outDirFor,
  outputFor,
  partsModeFrom,
  selectionFrom,
  splitSizeFrom,
  styleFrom,
  authorsFrom,
  type GlobalFlags,
} from "../shared.ts";

export async function scrapeCommand(url: string | undefined, flags: GlobalFlags): Promise<void> {
  const out = outputFor(flags);
  if (!url) throw new EblibError("Usage: eblib scrape <url>", EXIT.usage);

  const client = await clientFor(flags);
  try {
    if (flags.dryRun) {
      const response = await client.getPage(url, { offline: flags.offline });
      const metadata = parseMetadata(response.text);
      const { sections } = parseStructure(response.text);
      const paging = parsePaging(response.text);
      const chapters = sections.length === 0 ? parsePageChapters(response.text, metadata.title) : [];
      const lessons =
        sections.reduce((total, section) => total + section.lessons.length, 0) || chapters.length;
      const topics = sections.reduce(
        (total, section) => total + section.lessons.reduce((n, lesson) => n + lesson.topics.length, 0),
        0,
      );
      out.info(metadata.title);
      out.info(`  lessons: ${lessons}${paging.totalItems > lessons ? ` (page reports ${paging.totalItems})` : ""}`);
      if (chapters.length > 0) out.info(`  single page: ${chapters.length} chapter(s)`);
      out.info(`  topics: ${topics}`);
      out.info(`  planned requests: ${1 + (chapters.length > 0 ? 0 : lessons + topics)} (cache hits are free)`);
      return;
    }

    const { workspace, report } = await scrapeCourse(client, {
      url,
      cacheDir: cacheDirFor(flags),
      out,
      resume: flags.resume !== false,
      refresh: flags.refresh,
      refreshStructure: flags.refreshStructure,
      refreshContent: flags.refreshContent,
      offline: flags.offline,
      skipTopics: flags.skipTopics,
      failFast: flags.failFast,
      selection: selectionFrom(flags),
    });

    await enrichWorkspace(workspace, client, {
      source: flags.metadataSource,
      refreshMetadata: flags.refreshMetadata,
      refresh: flags.refresh,
      offline: flags.offline,
      warn: (message) => out.warn(message),
    });

    const fonts = await resolveFonts({
      client,
      cacheDir: cacheDirFor(flags),
      font: typeof flags.font === "string" ? flags.font : undefined,
      noFont: flags.font === "none",
      offline: flags.offline,
      refresh: flags.refresh,
      warn: (message) => out.warn(message),
    });

    if (flags.fetchOnly) {
      if (flags.report) await copyFile(workspace.path("report.json"), flags.report);
      out.info(
        `Cached ${report.lessons} lesson(s), ${report.topics} topic(s) in ${workspace.dir}`,
      );
      out.event({
        event: "fetched",
        courseId: report.courseId,
        lessons: report.lessons,
        topics: report.topics,
      });
      if (flags.json) out.json(report);
      if (report.failed.length > 0) {
        throw new EblibError(
          `${report.failed.length} item(s) failed; rerun with --resume`,
          EXIT.partial,
        );
      }
      return;
    }

    const result = await buildBook({
      workspace,
      outDir: outDirFor(flags),
      name: flags.name,
      cover: coverModeFrom(flags),
      fonts,
      selection: selectionFrom(flags),
      skipTopics: flags.skipTopics,
      mergeTopics: flags.mergeTopics,
      parts: partsModeFrom(flags),
      style: styleFrom(flags),
      splitSizeKb: splitSizeFrom(flags),
      allowPartial: flags.allowPartial,
      titleOverride: flags.title,
      authorsOverride: authorsFrom(flags),
      warn: (message) => out.warn(message),
    });

    if (flags.report) await copyFile(workspace.path("report.json"), flags.report);

    out.info(
      `${result.file} (${(result.bytes / 1024 / 1024).toFixed(1)} MB, ${result.stats.chapters} chapters, ${result.stats.topics} topics)`,
    );
    out.event({ event: "built", file: result.file, bytes: result.bytes, stats: result.stats });
    if (flags.json) out.json({ ...report, file: result.file, bytes: result.bytes });

    if (report.failed.length > 0) {
      throw new EblibError(`${report.failed.length} item(s) failed; rerun with --resume`, EXIT.partial);
    }
  } finally {
    await client.close();
  }
}
