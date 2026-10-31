import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CookieJar, parseNetscapeCookies, parseSetCookie } from "../src/http/cookies.ts";
import { HttpCache } from "../src/http/cache.ts";

const dirs: string[] = [];

afterEach(async () => {
  for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true });
});

async function tempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "eblib-http-"));
  dirs.push(dir);
  return dir;
}

describe("parseSetCookie", () => {
  test("reads name, value, domain, path and expiry", () => {
    const cookie = parseSetCookie(
      "session=abc123; Domain=.example.test; Path=/books; Max-Age=3600; HttpOnly",
      "www.example.test",
    );
    expect(cookie?.name).toBe("session");
    expect(cookie?.value).toBe("abc123");
    expect(cookie?.domain).toBe("example.test");
    expect(cookie?.path).toBe("/books");
    expect(cookie?.expires).toBeGreaterThan(Math.floor(Date.now() / 1000));
  });

  test("rejects malformed cookies", () => {
    expect(parseSetCookie("novalue", "example.test")).toBeNull();
  });
});

describe("CookieJar", () => {
  test("sends only matching cookies", async () => {
    const dir = await tempDir();
    const jar = await CookieJar.load(join(dir, "cookies.json"));
    jar.add({ name: "a", value: "1", domain: "example.test", path: "/", expires: 0 });
    jar.add({ name: "b", value: "2", domain: "other.test", path: "/", expires: 0 });
    expect(jar.header("https://www.example.test/books/")).toBe("a=1");
    expect(jar.header("https://other.test/")).toBe("b=2");
    await jar.save();
  });

  test("imports Netscape cookie files", () => {
    const text = [
      "# Netscape HTTP Cookie File",
      ".example.test\tTRUE\t/\tFALSE\t0\tname\tvalue",
      "",
    ].join("\n");
    const cookies = parseNetscapeCookies(text);
    expect(cookies).toHaveLength(1);
    expect(cookies[0]).toMatchObject({ name: "name", value: "value", domain: "example.test" });
  });
});

describe("HttpCache", () => {
  test("stores and returns bodies", async () => {
    const dir = await tempDir();
    const cache = await HttpCache.open(dir);
    try {
      await cache.put({
        url: "https://example.test/a",
        status: 200,
        headers: { "content-type": "text/html" },
        bytes: new TextEncoder().encode("<html>ok</html>"),
        fetchedAt: new Date().toISOString(),
      });
      const hit = await cache.get("https://example.test/a");
      expect(hit?.status).toBe(200);
      expect(new TextDecoder().decode(hit!.bytes)).toBe("<html>ok</html>");
      expect(cache.count()).toBe(1);
      expect((await cache.verify()).missing).toBe(0);
    } finally {
      cache.close();
    }
  });

  test("drops rows whose body file vanished", async () => {
    const dir = await tempDir();
    const cache = await HttpCache.open(dir);
    try {
      await cache.put({
        url: "https://example.test/b",
        status: 200,
        headers: {},
        bytes: new Uint8Array([1, 2, 3]),
        fetchedAt: new Date().toISOString(),
      });
      expect(await cache.get("https://example.test/b")).not.toBeNull();
      await rm(join(dir, "http"), { recursive: true, force: true });
      expect((await cache.verify()).missing).toBe(1);
      expect(cache.count()).toBe(0);
    } finally {
      cache.close();
    }
  });
});
