import { DEFAULT_HTTP, EblibError, EXIT, type HttpConfig } from "../config.ts";
import { HttpCache, textOf, type CachedResponse } from "./cache.ts";
import { AuthRequired, detectAuthWall, detectChallenge } from "./challenge.ts";
import { CookieJar } from "./cookies.ts";

export interface RequestOptions {
  /** Bypass the cache and fetch again. */
  refresh?: boolean;
  /** Never touch the network. */
  offline?: boolean;
  headers?: Record<string, string>;
  /** Skip the polite delay (used for the first request). */
  immediate?: boolean;
}

export interface Response extends CachedResponse {
  fromCache: boolean;
}

export interface ClientOptions {
  cacheDir: string;
  cookieFile: string;
  http?: Partial<HttpConfig>;
}

export class BudgetExceeded extends EblibError {
  constructor(limit: number) {
    super(`Request budget exceeded (${limit}). Raise --max-requests to continue.`, EXIT.general);
    this.name = "BudgetExceeded";
  }
}

export class HttpClient {
  private readonly cache: HttpCache;
  private readonly jar: CookieJar;
  private readonly config: HttpConfig;
  private lastRequestAt = 0;
  private requests = 0;

  private constructor(cache: HttpCache, jar: CookieJar, config: HttpConfig) {
    this.cache = cache;
    this.jar = jar;
    this.config = config;
  }

  static async create(options: ClientOptions): Promise<HttpClient> {
    const cache = await HttpCache.open(options.cacheDir);
    const jar = await CookieJar.load(options.cookieFile);
    return new HttpClient(cache, jar, { ...DEFAULT_HTTP, ...(options.http ?? {}) });
  }

  get requestCount(): number {
    return this.requests;
  }

  get cookies(): CookieJar {
    return this.jar;
  }

  get maxRequests(): number {
    return this.config.maxRequests;
  }

  async get(url: string, options: RequestOptions = {}): Promise<Response> {
    if (!options.refresh) {
      const cached = await this.cache.get(url);
      if (cached) return { ...cached, fromCache: true };
      if (options.offline) {
        throw new EblibError(`Offline cache miss: ${url}`, EXIT.offline);
      }
    } else if (options.offline) {
      throw new EblibError(`--offline cannot be combined with --refresh: ${url}`, EXIT.usage);
    }

    const response = await this.fetchWithRetry(url, options);
    await this.cache.put(response);
    await this.jar.save();
    return { ...response, fromCache: false };
  }

  /** Fetch a page and fail loudly when the body is a login wall. */
  async getPage(url: string, options: RequestOptions = {}): Promise<{ text: string; fromCache: boolean }> {
    const response = await this.get(url, options);
    const text = textOf(response);
    const wall = detectAuthWall(response.status, text);
    if (wall) throw new AuthRequired(url, wall);
    return { text, fromCache: response.fromCache };
  }

  private async fetchWithRetry(url: string, options: RequestOptions): Promise<CachedResponse> {
    let lastError: unknown;
    for (let attempt = 0; attempt <= this.config.retries; attempt++) {
      if (attempt > 0) {
        const backoff = 1000 * 2 ** (attempt - 1) + Math.random() * 500;
        await sleep(backoff);
      }
      try {
        return await this.fetchOnce(url, options);
      } catch (cause) {
        if (cause instanceof AuthRequired) throw cause;
        lastError = cause;
        const status = (cause as { status?: number }).status;
        if (status !== undefined && status < 500 && status !== 429) throw cause;
      }
    }
    throw lastError instanceof Error
      ? lastError
      : new EblibError(`Request failed: ${url}`, EXIT.general);
  }

  private async fetchOnce(url: string, options: RequestOptions): Promise<CachedResponse> {
    if (this.requests >= this.config.maxRequests) throw new BudgetExceeded(this.config.maxRequests);
    if (!options.immediate) await this.politeDelay();
    this.requests += 1;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.config.timeout);
    const headers: Record<string, string> = {
      "user-agent": this.config.userAgent,
      accept: "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
      "accept-language": "bn,en;q=0.8",
      ...(options.headers ?? {}),
    };
    const cookie = this.jar.header(url);
    if (cookie) headers.cookie = cookie;

    try {
      const response = await fetch(url, { headers, redirect: "follow", signal: controller.signal });
      const bytes = new Uint8Array(await response.arrayBuffer());
      const responseHeaders: Record<string, string> = {};
      response.headers.forEach((value, key) => {
        responseHeaders[key.toLowerCase()] = value;
      });
      const setCookies =
        typeof response.headers.getSetCookie === "function"
          ? response.headers.getSetCookie()
          : splitSetCookie(response.headers.get("set-cookie"));
      if (setCookies.length > 0) this.jar.absorb(url, setCookies);

      const contentType = responseHeaders["content-type"] ?? "";
      const textual = /text\/|json|xml|javascript/.test(contentType);
      if (textual) {
        const challenge = detectChallenge(response.status, textOf({ bytes } as CachedResponse), responseHeaders);
        if (challenge) throw new AuthRequired(url, challenge);
      }

      if (!response.ok) {
        const error = new EblibError(`HTTP ${response.status} for ${url}`, EXIT.general) as EblibError & {
          status: number;
        };
        error.status = response.status;
        throw error;
      }

      return {
        url: response.url || url,
        status: response.status,
        headers: responseHeaders,
        bytes,
        fetchedAt: new Date().toISOString(),
      };
    } finally {
      clearTimeout(timer);
    }
  }

  private async politeDelay(): Promise<void> {
    const now = Date.now();
    const wait = this.lastRequestAt + this.config.delay + Math.random() * this.config.jitter - now;
    if (wait > 0) await sleep(wait);
    this.lastRequestAt = Date.now();
  }

  async close(): Promise<void> {
    await this.jar.save();
    this.cache.close();
  }

  stats(): { cached: number; requests: number } {
    return { cached: this.cache.count(), requests: this.requests };
  }
}

function splitSetCookie(value: string | null): string[] {
  if (!value) return [];
  return value.split(/,(?=\s*[^;=]+=)/g).map((part) => part.trim());
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
