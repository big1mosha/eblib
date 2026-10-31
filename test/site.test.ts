import { describe, expect, test } from "bun:test";
import {
  largestSrcset,
  parseCourseId,
  parseLessonPage,
  parseMetadata,
  parsePaging,
  parseStructure,
} from "../src/site/course.ts";

const COURSE = `<!doctype html>
<html><head>
  <link rel="canonical" href="https://example.test/books/demo/"/>
  <meta property="og:image" content="https://cdn.example.test/cover.jpg"/>
  <meta name="description" content="একটি বই"/>
</head><body class="learndash-cpt-sfwd-courses-209451-parent">
<h1 class="page-header-title">ডেমো বই</h1>
<span class="entry-terms-authors"><a href="#">লেখক এক</a></span>
<span class="entry-terms-series"><a href="#">সিরিজ</a></span>
<div class="ld-item-list-items ld-item-list-209451">
  <div class="ld-item-list-section-heading"><span class="ld-lesson-section-heading">প্রথম অংশ</span></div>
  <div class="ld-item-list-item ld-item-lesson-item ld-lesson-item-101">
    <a class="ld-item-name" href="https://example.test/lessons/one/">
      <div class="ld-item-title">পাঠ এক<span class="ld-item-components">2 Topics</span></div>
    </a>
    <div class="ld-item-list-item-expanded">
      <a class="ld-topic-row" href="https://example.test/topics/t1/"><span class="ld-topic-title">বিষয় ১</span></a>
      <a class="ld-topic-row" href="https://example.test/topics/t2/"><span class="ld-topic-title">বিষয় ২</span></a>
    </div>
  </div>
  <div class="ld-item-list-item ld-item-lesson-item ld-lesson-item-102">
    <a class="ld-item-name" href="https://example.test/lessons/two/">
      <div class="ld-item-title">পাঠ দুই</div>
    </a>
  </div>
  <div class="ld-item-list-section-heading"><span class="ld-lesson-section-heading">দ্বিতীয় অংশ</span></div>
  <div class="ld-item-list-item ld-item-lesson-item ld-lesson-item-103">
    <a class="ld-item-name" href="https://example.test/lessons/three/">
      <div class="ld-item-title">পাঠ তিন</div>
    </a>
  </div>
</div>
<div class="ld-pagination" data-pager-results="{&quot;paged&quot;:1,&quot;total_items&quot;:9,&quot;total_pages&quot;:2}"></div>
</body></html>`;

const LESSON = `<!doctype html>
<html><body class="postid-101 learndash-cpt-sfwd-lessons-101-current learndash-cpt-sfwd-courses-209451-parent">
<div class="ld-lesson-item ld-is-current-lesson">
  <div class="ld-lesson-title">পাঠ এক</div>
  <div class="ld-topic-list">
    <a class="ld-topic-row" href="https://example.test/topics/t1/"><span class="ld-topic-title">বিষয় ১</span></a>
  </div>
</div>
<div class="ld-lesson-item ld-is-not-current-lesson">
  <div class="ld-lesson-title">পাঠ দুই</div>
  <div class="ld-topic-list">
    <a class="ld-topic-row" href="https://example.test/topics/other/"><span class="ld-topic-title">অন্য বিষয়</span></a>
  </div>
</div>
<div class="ld-tab-content entry-content">
  <button class="simplefavorite-button">save</button>
  <p>প্রথম অনুচ্ছেদ।</p>
  <img data-src="/img/a.jpg" data-srcset="/img/a-300.jpg 300w, /img/a-800.jpg 800w" src="data:image/svg+xml;base64,AA"/>
  <iframe src="https://www.youtube.com/embed/xyz"></iframe>
  <script>alert(1)</script>
</div>
<div class="ld-content-actions">
  <a href="https://example.test/lessons/two/"><span class="ld-text">Next Lesson</span></a>
</div>
</body></html>`;

describe("parseStructure", () => {
  test("reads sections, lessons and topics", () => {
    const { sections, hasSections } = parseStructure(COURSE);
    expect(hasSections).toBe(true);
    expect(sections).toHaveLength(2);
    expect(sections[0]!.title).toBe("প্রথম অংশ");
    expect(sections[0]!.lessons).toHaveLength(2);
    expect(sections[0]!.lessons[0]!.title).toBe("পাঠ এক");
    expect(sections[0]!.lessons[0]!.id).toBe("101");
    expect(sections[0]!.lessons[0]!.topics.map((topic) => topic.title)).toEqual(["বিষয় ১", "বিষয় ২"]);
    expect(sections[0]!.lessons[0]!.topicCount).toBe(2);
    expect(sections[1]!.lessons[0]!.url).toBe("https://example.test/lessons/three/");
  });

  test("handles a course without sections", () => {
    const html = COURSE.replace(/<div class="ld-item-list-section-heading">.*?<\/div>/gs, "");
    const { sections, hasSections } = parseStructure(html);
    expect(hasSections).toBe(false);
    expect(sections).toHaveLength(1);
    expect(sections[0]!.title).toBe("");
    expect(sections[0]!.lessons).toHaveLength(3);
  });
});

describe("parsePaging", () => {
  test("reads the pager payload", () => {
    expect(parsePaging(COURSE)).toEqual({ totalItems: 9, totalPages: 2 });
  });

  test("returns zeroes without a pager", () => {
    expect(parsePaging("<html></html>")).toEqual({ totalItems: 0, totalPages: 0 });
  });
});

describe("parseMetadata", () => {
  test("drops the author suffix from the title", () => {
    const html = COURSE.replace(
      '<h1 class="page-header-title">ডেমো বই</h1>',
      '<h1 class="page-header-title">ডেমো বই – লেখক এক</h1>',
    );
    expect(parseMetadata(html).title).toBe("ডেমো বই");
  });

  test("collects title, author, series and cover", () => {
    const metadata = parseMetadata(COURSE);
    expect(metadata.title).toBe("ডেমো বই");
    expect(metadata.authors).toEqual(["লেখক এক"]);
    expect(metadata.series).toBe("সিরিজ");
    expect(metadata.cover).toBe("https://cdn.example.test/cover.jpg");
    expect(metadata.source).toBe("https://example.test/books/demo/");
  });
});

describe("parseLessonPage", () => {
  test("reads course, title, next lesson and topics", () => {
    const page = parseLessonPage(LESSON);
    expect(page.courseId).toBe("209451");
    expect(page.title).toBe("পাঠ এক");
    expect(page.nextUrl).toBe("https://example.test/lessons/two/");
    expect(page.topics).toHaveLength(1);
    expect(page.topics[0]!.title).toBe("বিষয় ১");
    expect(page.contentHtml).toContain("প্রথম অনুচ্ছেদ।");
  });
});

describe("parseCourseId", () => {
  test("reads the course container id", () => {
    expect(parseCourseId('<div class="ld-course-content-209451">')).toBe("209451");
    expect(parseCourseId('<body class="learndash-cpt-sfwd-courses-42-parent">')).toBe("42");
  });
});

describe("largestSrcset", () => {
  test("picks the widest candidate", () => {
    expect(largestSrcset("/a.jpg 300w, /b.jpg 800w, /c.jpg 150w")).toBe("/b.jpg");
    expect(largestSrcset("/a.jpg 1x, /b.jpg 2x")).toBe("/b.jpg");
    expect(largestSrcset(undefined)).toBeUndefined();
  });
});
