import { EblibError, EXIT } from "../../config.ts";
import { parseMetadata, parsePageChapters, parsePaging, parseStructure } from "../../site/course.ts";
import { clientFor, outputFor, type GlobalFlags } from "../shared.ts";

export async function infoCommand(url: string | undefined, flags: GlobalFlags): Promise<void> {
  const out = outputFor(flags);
  if (!url) throw new EblibError("Usage: eblib info <url>", EXIT.usage);

  const client = await clientFor(flags);
  try {
    const response = await client.getPage(url, {
      refresh: flags.refresh,
      offline: flags.offline,
    });
    const metadata = parseMetadata(response.text);
    const { sections, hasSections } = parseStructure(response.text);
    const paging = parsePaging(response.text);
    const chapters = sections.length === 0 ? parsePageChapters(response.text, metadata.title) : [];
    const lessons =
      sections.reduce((total, section) => total + section.lessons.length, 0) || chapters.length;
    const topics = sections.reduce(
      (total, section) => total + section.lessons.reduce((n, lesson) => n + lesson.topics.length, 0),
      0,
    );

    if (flags.json) {
      out.json({ metadata, hasSections, paging, sections, chapters });
      return;
    }

    out.info(metadata.title);
    if (metadata.authors.length) out.info(`  author: ${metadata.authors.join(", ")}`);
    if (metadata.series) out.info(`  series: ${metadata.series}`);
    if (metadata.cover) out.info(`  cover: ${metadata.cover}`);
    out.info(`  source: ${metadata.source ?? url}`);
    out.info(`  lessons: ${lessons}  topics: ${topics}  sections: ${hasSections ? sections.length : 0}`);
    if (paging.totalItems > lessons) {
      out.warn(
        `course page lists ${lessons} of ${paging.totalItems} lessons; the rest is resolved from the lesson chain`,
      );
    }
    for (const [index, section] of sections.entries()) {
      const title = section.title || "(no section)";
      out.info(`  ${index + 1}. ${title} — ${section.lessons.length} lesson(s)`);
      if (flags.verbose) {
        for (const lesson of section.lessons) {
          out.info(`       - ${lesson.title}${lesson.topics.length ? ` (${lesson.topics.length} topics)` : ""}`);
        }
      }
    }
    if (chapters.length > 0) {
      out.info(`  single page — ${chapters.length} chapter(s)`);
      if (flags.verbose) {
        for (const chapter of chapters) out.info(`       - ${chapter.title}`);
      }
    }
  } finally {
    await client.close();
  }
}
