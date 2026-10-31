import { EblibError, EXIT } from "../config.ts";

const CHALLENGE_MARKERS = [
  "just a moment",
  "challenges.cloudflare.com",
  "attention required! | cloudflare",
  "cf-chl-",
  "turnstile",
  "hcaptcha",
  "recaptcha/api.js",
  "checking your browser",
];

const AUTH_MARKERS = [
  "rest_not_logged_in",
  "You must be logged in to view this content",
  "ld-login-modal",
  "login to continue",
];

export class AuthRequired extends EblibError {
  readonly url: string;

  constructor(url: string, reason: string) {
    super(`Authentication or challenge required: ${reason}`, EXIT.auth);
    this.name = "AuthRequired";
    this.url = url;
  }
}

/** Cloudflare interstitials, bot walls and generic bot challenges. */
export function detectChallenge(status: number, body: string, headers: Record<string, string>): string | null {
  const mitigated = headers["cf-mitigated"]?.toLowerCase();
  if (mitigated === "challenge") return "Cloudflare challenge header";
  if (status === 403 || status === 429 || status === 503) {
    const lower = body.slice(0, 20_000).toLowerCase();
    for (const marker of CHALLENGE_MARKERS) {
      if (lower.includes(marker)) return `HTTP ${status} with "${marker}"`;
    }
    return null;
  }
  if (body.length < 5_000) {
    const lower = body.toLowerCase();
    for (const marker of CHALLENGE_MARKERS) {
      if (lower.includes(marker)) return `challenge page with "${marker}"`;
    }
  }
  return null;
}

/** A login wall or a page that silently rendered without the book content. */
export function detectAuthWall(status: number, body: string): string | null {
  if (status === 401) return "HTTP 401";
  if (body.length > 50_000) return null;
  const lower = body.toLowerCase();
  for (const marker of AUTH_MARKERS) {
    if (lower.includes(marker.toLowerCase())) return `login wall with "${marker}"`;
  }
  return null;
}
