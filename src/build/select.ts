import type { Lesson, Section } from "../site/course.ts";

export interface Selection {
  sections?: string | number;
  lessons?: string | number;
  topics?: string | number;
}

/**
 * Parse `1-5,8` into a 1-based index set. An empty spec selects everything.
 */
export function parseRange(spec: string | number | undefined): Set<number> | null {
  if (spec === undefined) return null;
  const text = String(spec).trim();
  if (!text) return null;
  const indexes = new Set<number>();
  for (const part of text.split(",")) {
    const token = part.trim();
    if (!token) continue;
    const range = /^(\d+)\s*-\s*(\d+)$/.exec(token);
    if (range) {
      const from = Number(range[1]);
      const to = Number(range[2]);
      for (let i = Math.min(from, to); i <= Math.max(from, to); i++) indexes.add(i);
      continue;
    }
    const single = Number(token);
    if (Number.isInteger(single) && single > 0) indexes.add(single);
  }
  return indexes.size > 0 ? indexes : null;
}

/** Apply `--sections`, `--lessons`, `--topics` to a parsed structure. */
export function selectStructure(sections: Section[], selection: Selection): Section[] {
  const sectionRange = parseRange(selection.sections);
  const lessonRange = parseRange(selection.lessons);
  const topicRange = parseRange(selection.topics);

  let lessonNo = 0;
  const result: Section[] = [];

  sections.forEach((section, sectionIndex) => {
    if (sectionRange && !sectionRange.has(sectionIndex + 1)) return;

    const lessons: Lesson[] = [];
    for (const lesson of section.lessons) {
      lessonNo += 1;
      if (lessonRange && !lessonRange.has(lessonNo)) continue;

      const topics = topicRange
        ? lesson.topics.filter((_, index) => topicRange.has(index + 1))
        : lesson.topics;
      lessons.push({ ...lesson, topics });
    }

    if (lessons.length > 0) result.push({ ...section, lessons });
  });

  return result;
}

export function countItems(sections: Section[]): { lessons: number; topics: number } {
  let lessons = 0;
  let topics = 0;
  for (const section of sections) {
    lessons += section.lessons.length;
    for (const lesson of section.lessons) topics += lesson.topics.length;
  }
  return { lessons, topics };
}
