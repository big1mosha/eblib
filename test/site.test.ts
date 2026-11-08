import { describe, expect, test } from "bun:test";
import {
  largestSrcset,
  parseCourseId,
  parseCourseIntro,
  parseLessonPage,
  parseMetadata,
  parsePageChapters,
  parsePaging,
  parseStructure,
  splitIntroPages,
  splitPageChapters,
  splitPageFrontMatter,
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

const SINGLE_PAGE = `<!doctype html>
<html><head>
  <link rel="canonical" href="https://example.test/books/one-page/"/>
</head><body class="postid-231628 single-sfwd-courses learndash-cpt learndash-cpt-sfwd-courses">
<h1 class="page-header-title">এক পৃষ্ঠার বই – লেখক এক</h1>
<span class="entry-terms-authors"><a href="#">লেখক এক</a></span>
<div id="learndash_post_231628">
  <div aria-labelledby="ld-content-tab-231628" class="ld-tab-content ld-visible entry-content" id="ld-tab-content-231628">
    <p class="wp-block-paragraph"><strong>এক পৃষ্ঠার বই</strong></p>
    <p class="wp-block-paragraph">প্রথম প্রকাশ: জানুয়ারি ২০০৯</p>
    <p class="wp-block-paragraph">.</p>
    <p class="wp-block-paragraph">শুরুর অনুচ্ছেদ।</p>
    <h3 class="wp-block-heading">॥১॥</h3>
    <p class="wp-block-paragraph">প্রথম অধ্যায়ের লেখা।</p>
    <h3 class="wp-block-heading">॥২॥</h3>
    <p class="wp-block-paragraph">দ্বিতীয় অধ্যায়ের লেখা।</p>
    <button class="simplefavorite-button">Bookmark</button>
  </div>
</div>
<div class="mai-grid entries"><h3>অন্য বই</h3><p>সুপারিশের লেখা।</p></div>
</body></html>`;

describe("single-page courses", () => {
  test("parseCourseId reads the course wrapper id", () => {
    expect(parseCourseId(SINGLE_PAGE)).toBe("231628");
    expect(parseCourseId('<div id="ld-tab-content-777"></div>')).toBe("777");
  });

  test("splits the course tab into chapters at headings", () => {
    const chapters = splitPageChapters(
      "<p><strong>বই</strong></p><p>শুরু।</p><h3>॥১॥</h3><p>এক।</p><h3>॥২॥</h3><p>দুই।</p>",
      "বই",
    );
    expect(chapters.map((chapter) => chapter.title)).toEqual(["বই", "॥১॥", "॥২॥"]);
    expect(chapters[1]!.html).toContain("এক।");
    expect(chapters[1]!.html).not.toContain("॥১॥");
  });

  test("splits the imprint from the body at the lone dot", () => {
    const content = parseCourseIntro(SINGLE_PAGE)!;
    const { details, body } = splitPageFrontMatter(content);
    expect(details).toContain("প্রথম প্রকাশ");
    expect(details).not.toContain("শুরুর অনুচ্ছেদ");
    expect(body).toContain("শুরুর অনুচ্ছেদ");
    expect(body).not.toContain("প্রথম প্রকাশ");
  });

  test("unwraps the plain divs the site puts around the text", () => {
    const wrapped =
      "<div>\n  <div></div>\n</div>\n<div>\n  <p><strong>বই</strong></p>\n  <p>প্রথম প্রকাশ: জানুয়ারি ২০০৯</p>\n  <p>.</p>\n  <p>শুরু।</p>\n  <h3>॥১॥</h3>\n  <p>এক।</p>\n</div>";
    const { details, body } = splitPageFrontMatter(wrapped);
    expect(details).toContain("প্রথম প্রকাশ");
    expect(body).toContain("শুরু।");
    const chapters = splitPageChapters(body, "বই");
    expect(chapters.map((chapter) => chapter.title)).toEqual(["বই", "॥১॥"]);
    expect(chapters.map((chapter) => chapter.heading)).toEqual([false, true]);
  });

  test("ignores the related-books grid outside the content tab", () => {
    const chapters = parsePageChapters(SINGLE_PAGE, "এক পৃষ্ঠার বই");
    expect(chapters.map((chapter) => chapter.title)).toEqual(["এক পৃষ্ঠার বই", "॥১॥", "॥২॥"]);
    expect(chapters.map((chapter) => chapter.heading)).toEqual([false, true, true]);
    expect(chapters.some((chapter) => chapter.html.includes("সুপারিশের লেখা"))).toBe(false);
    expect(chapters[0]!.html).toContain("শুরুর অনুচ্ছেদ");
    expect(chapters[1]!.html).toContain("প্রথম অধ্যায়ের লেখা");
    expect(JSON.stringify(chapters)).not.toContain("প্রথম প্রকাশ");
  });

  test("keeps a heading-less page as one chapter", () => {
    const chapters = splitPageChapters("<p>পুরো বই এক প্যারায়।</p>", "বই");
    expect(chapters).toHaveLength(1);
    expect(chapters[0]!.title).toBe("বই");
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

describe("parseCourseIntro and splitIntroPages", () => {
  test("extracts intro from course tab and separates by dot", () => {
    const html = `<div aria-labelledby="ld-content-tab-240254" class="ld-tab-content ld-visible entry-content" id="ld-tab-content-240254" role="tabpanel" tabindex="0">
<p class="wp-block-paragraph"><strong>কালো ঘুড়ি – হিমাদ্রিকিশোর দাশগুপ্ত</strong></p>
<p class="wp-block-paragraph">প্রথম প্রকাশ – বইমেলা ২০১৫<br>প্রকাশক – নিমাই গরাই, লালমাটি প্রকাশন<br>প্রচ্ছদ – অনুপ রায়</p>
<p class="wp-block-paragraph">.</p>
<p class="wp-block-paragraph"><strong>উৎসর্গ<br></strong>শাশ্বতী চন্দকে</p>
<p class="wp-block-paragraph">.</p>
<p class="wp-block-paragraph"><strong>ভূমিকা</strong></p>
<p class="wp-block-paragraph">মানুষ ভয় পেতেও ভালোবাসে৷</p>
<button class="simplefavorite-button">Bookmark</button>
</div>`;

    const intro = parseCourseIntro(html);
    expect(intro).toBeDefined();
    expect(intro).not.toContain("simplefavorite-button");

    const pages = splitIntroPages(intro!);
    expect(pages).toHaveLength(3);
    expect(pages[0]?.title).toBe("কালো ঘুড়ি");
    expect(pages[0]?.html).toContain("প্রথম প্রকাশ");
    expect(pages[1]?.title).toBe("উৎসর্গ");
    expect(pages[1]?.html).toContain("শাশ্বতী চন্দকে");
    expect(pages[2]?.title).toBe("ভূমিকা");
    expect(pages[2]?.html).toContain("মানুষ ভয় পেতেও ভালোবাসে৷");
  });

  test("handles intro without dot separators as a single page", () => {
    const html = `<div class="ld-tab-content entry-content">
<p><strong>কিশোর কর্নেল সমগ্র ১</strong></p>
<h2>কিছু কথা</h2>
<p>কর্নেলের রহস্য কাহিনি লিখতে শুরু করেছিলাম।</p>
</div>`;
    const intro = parseCourseIntro(html);
    const pages = splitIntroPages(intro!);
    expect(pages).toHaveLength(1);
    expect(pages[0]?.title).toBe("কিছু কথা");
    expect(pages[0]?.html).toContain("কর্নেলের রহস্য কাহিনি");
  });
});
