import type { NextFunction, Request, Response } from "express";

const ALLOWED_METHODS = "GET,POST,OPTIONS";
const ALLOWED_HEADERS = "Authorization,Content-Type";

// GigWork's own frontends are always allowed; CORS_ORIGINS adds more (e.g. previews, local dev).
export const FIRST_PARTY_ORIGINS = ["https://www.gigworkhq.com", "https://gigworkhq.com", "https://gigwork-khaki.vercel.app"];

export function parseAllowedOrigins(list: string, fallbackUri: string) {
  const entries = list
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);
  return new Set([...(entries.length ? entries : [fallbackUri]), ...FIRST_PARTY_ORIGINS].map((origin) => new URL(origin).origin));
}

// Sessions use bearer tokens, not cookies, so credentials are never allowed cross-origin.
export function corsMiddleware(allowedOrigins: ReadonlySet<string>) {
  return (request: Request, response: Response, next: NextFunction) => {
    const origin = request.header("origin");
    response.vary("Origin");
    if (origin && allowedOrigins.has(origin)) {
      response.setHeader("Access-Control-Allow-Origin", origin);
      if (request.method === "OPTIONS") {
        response.setHeader("Access-Control-Allow-Methods", ALLOWED_METHODS);
        response.setHeader("Access-Control-Allow-Headers", ALLOWED_HEADERS);
        response.setHeader("Access-Control-Max-Age", "600");
      }
    }
    if (request.method === "OPTIONS") {
      response.status(204).end();
      return;
    }
    next();
  };
}
