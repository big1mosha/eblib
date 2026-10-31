import { readJson, writeJson } from "../io.ts";

export interface Cookie {
  name: string;
  value: string;
  domain: string;
  path: string;
  /** Unix seconds; 0 = session cookie. */
  expires: number;
}

export class CookieJar {
  private cookies: Cookie[] = [];
  private readonly file: string;
  private dirty = false;

  private constructor(file: string) {
    this.file = file;
  }

  static async load(file: string): Promise<CookieJar> {
    const jar = new CookieJar(file);
    const data = await readJson<{ cookies?: Cookie[] }>(file);
    if (data?.cookies) jar.cookies = data.cookies.filter((cookie) => cookie.name);
    return jar;
  }

  add(cookie: Cookie): void {
    this.cookies = this.cookies.filter(
      (existing) =>
        !(
          existing.name === cookie.name &&
          existing.domain === cookie.domain &&
          existing.path === cookie.path
        ),
    );
    this.cookies.push(cookie);
    this.dirty = true;
  }

  /** Parse one or more `Set-Cookie` header values for a response URL. */
  absorb(url: string, values: string[]): void {
    const host = new URL(url).hostname;
    for (const raw of values) {
      const parsed = parseSetCookie(raw, host);
      if (parsed) this.add(parsed);
    }
  }

  header(url: string): string | undefined {
    const target = new URL(url);
    const now = Math.floor(Date.now() / 1000);
    const pairs: string[] = [];
    for (const cookie of this.cookies) {
      if (cookie.expires !== 0 && cookie.expires < now) continue;
      if (!domainMatches(target.hostname, cookie.domain)) continue;
      if (!pathMatches(target.pathname || "/", cookie.path)) continue;
      pairs.push(`${cookie.name}=${cookie.value}`);
    }
    return pairs.length > 0 ? pairs.join("; ") : undefined;
  }

  all(): Cookie[] {
    return [...this.cookies];
  }

  async save(): Promise<void> {
    if (!this.dirty) return;
    await writeJson(this.file, { cookies: this.cookies });
    this.dirty = false;
  }
}

export function parseSetCookie(raw: string, host: string): Cookie | null {
  const [pair, ...attributes] = raw.split(";");
  if (!pair) return null;
  const index = pair.indexOf("=");
  if (index <= 0) return null;
  const name = pair.slice(0, index).trim();
  const value = pair.slice(index + 1).trim();
  if (!name) return null;

  let domain = host;
  let path = "/";
  let expires = 0;

  for (const attribute of attributes) {
    const [key, ...rest] = attribute.split("=");
    const lower = (key ?? "").trim().toLowerCase();
    const attrValue = rest.join("=").trim();
    if (lower === "domain" && attrValue) domain = attrValue.replace(/^\./, "");
    else if (lower === "path" && attrValue) path = attrValue;
    else if (lower === "max-age" && attrValue) {
      const seconds = Number(attrValue);
      if (Number.isFinite(seconds)) expires = Math.floor(Date.now() / 1000) + seconds;
    } else if (lower === "expires" && attrValue) {
      const time = Date.parse(attrValue);
      if (Number.isFinite(time)) expires = Math.floor(time / 1000);
    }
  }

  return { name, value, domain, path, expires };
}

function domainMatches(host: string, domain: string): boolean {
  return host === domain || host.endsWith(`.${domain}`);
}

function pathMatches(path: string, cookiePath: string): boolean {
  if (cookiePath === "/") return true;
  return path === cookiePath || path.startsWith(`${cookiePath}/`);
}

/** Read a Netscape cookies.txt file exported by a browser extension. */
export function parseNetscapeCookies(text: string): Cookie[] {
  const cookies: Cookie[] = [];
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim() || line.startsWith("#")) continue;
    const parts = line.split("\t");
    if (parts.length < 7) continue;
    const [domain, , path, , expires, name, value] = parts;
    if (!domain || !name) continue;
    cookies.push({
      name,
      value: value ?? "",
      domain: domain.replace(/^\./, ""),
      path: path || "/",
      expires: Number(expires) || 0,
    });
  }
  return cookies;
}
