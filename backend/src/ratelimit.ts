import type { NextFunction, Request, Response } from "express";
import { ApiError } from "./http.js";

// Fixed-window, per-IP request limiter kept in memory. The API runs as one instance, so a process-local counter is
// enough to stop nonce spam and write floods (audit L-2). request.ip honours TRUST_PROXY.
export function rateLimit(options: { name: string; perMinute: number; methods?: string[] }) {
  const windows = new Map<string, { start: number; count: number }>();
  const methods = options.methods ? new Set(options.methods) : null;
  let lastSweep = Date.now();
  return (request: Request, response: Response, next: NextFunction) => {
    if (methods && !methods.has(request.method)) return next();
    const now = Date.now();
    if (now - lastSweep > 60_000) {
      for (const [key, window] of windows) if (now - window.start >= 60_000) windows.delete(key);
      lastSweep = now;
    }
    const key = request.ip ?? "unknown";
    const window = windows.get(key);
    if (!window || now - window.start >= 60_000) {
      windows.set(key, { start: now, count: 1 });
      return next();
    }
    window.count += 1;
    if (window.count > options.perMinute) {
      response.setHeader("Retry-After", String(Math.ceil((window.start + 60_000 - now) / 1000)));
      return next(new ApiError(429, "rate_limited", `Too many ${options.name} requests. Wait a minute and try again.`));
    }
    next();
  };
}
