import { describe, expect, test } from "bun:test";
import { contentText, extractContent, imageSources, isEmptyContent, rewriteImageSources } from "../src/site/content.ts";

const PAGE = `<!doctype html><html><body>
<div class="ld-tab-content entry-content">
  <button class="simplefavorite-button">সংরক্ষণ</button>
  <h2>পাঠ এক</h2>
  <p style="text-align:center;color:red">প্রথম অনুচ্ছেদ।</p>
  <p>&nbsp;</p>
  <img data-src="/img/a.jpg" data-srcset="/img/a-300.jpg 300w, /img/a-800.jpg 800w" src="data:image/svg+xml;base64,AA" alt="ছবি"/>
  <iframe src="https://www.youtube.com/embed/xyz"></iframe>
  <script>alert(1)</script>
  <div class="adsbygoogle">বিজ্ঞাপন</div>
</div>
</body></html>`;

describe("extractContent", () => {
  test("sanitises the content tab", () => {
    const html = extractContent(PAGE, { baseUrl: "https://example.test/lessons/one/" });
    expect(html).not.toContain("<button");
    expect(html).not.toContain("<script");
    expect(html).not.toContain("বিজ্ঞাপন");
    expect(html).toContain("প্রথম অনুচ্ছেদ।");
    expect(html).toContain('href="https://www.youtube.com/embed/xyz"');
    expect(html).toContain('src="https://example.test/img/a.jpg"');
    expect(html).toContain('style="text-align: center"');
    expect(html).not.toContain("color:red");
  });

  test("drops a duplicate leading heading", () => {
    const html = extractContent(PAGE, {
      baseUrl: "https://example.test/lessons/one/",
      title: "পাঠ এক",
    });
    expect(html).not.toContain("<h2>পাঠ এক</h2>");
  });

  test("returns an empty string without content", () => {
    expect(extractContent("<html><body><p>no</p></body></html>", { baseUrl: "https://x/" })).toBe("");
  });
});

describe("isEmptyContent", () => {
  test("detects empty fragments", () => {
    expect(isEmptyContent("")).toBe(true);
    expect(isEmptyContent("<p> </p>")).toBe(true);
    expect(isEmptyContent('<p><img src="../images/a.jpg"/></p>')).toBe(false);
    expect(isEmptyContent("<p>লেখা</p>")).toBe(false);
  });
});

describe("imageSources", () => {
  test("lists unique sources", () => {
    const html = '<p><img src="../images/a.jpg"/><img src="../images/a.jpg"/><img src="../images/b.jpg"/></p>';
    expect(imageSources(html)).toEqual(["../images/a.jpg", "../images/b.jpg"]);
  });
});

describe("rewriteImageSources", () => {
  test("maps absolute URLs to archive paths", () => {
    const html = '<p><img src="https://cdn.test/a.jpg"/></p>';
    const mapped = rewriteImageSources(html, new Map([["https://cdn.test/a.jpg", "../images/a.jpg"]]));
    expect(mapped).toContain('src="../images/a.jpg"');
  });
});

describe("contentText", () => {
  test("strips tags and collapses whitespace", () => {
    expect(contentText("<p>এক</p>\n<p>দুই</p>")).toBe("এক দুই");
  });
});
