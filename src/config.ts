export const SITE = "https://www.ebanglalibrary.com";

export const EXIT = {
  ok: 0,
  general: 1,
  usage: 2,
  auth: 3,
  partial: 4,
  offline: 5,
  invalid: 6,
} as const;

export class EblibError extends Error {
  readonly exitCode: number;

  constructor(message: string, exitCode: number = EXIT.general) {
    super(message);
    this.name = "EblibError";
    this.exitCode = exitCode;
  }
}

export function fail(message: string, exitCode: number = EXIT.general): never {
  throw new EblibError(message, exitCode);
}

export interface HttpConfig {
  delay: number;
  jitter: number;
  timeout: number;
  retries: number;
  maxRequests: number;
  userAgent: string;
}

export const DEFAULT_HTTP: HttpConfig = {
  delay: 2000,
  jitter: 500,
  timeout: 30_000,
  retries: 3,
  maxRequests: 1000,
  userAgent:
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
};

export const PATHS = {
  cache: ".eblib",
  out: "dist",
  cookies: "cookies.json",
  auth: "auth.json",
  db: "http.db",
  bodies: "http",
  books: "books",
} as const;
