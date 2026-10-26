import { describe, expect, mock, test } from "bun:test";
import type { Request, Response } from "express";
import { corsMiddleware, parseAllowedOrigins } from "../src/cors.js";

function requestDouble(method: string, origin?: string) {
  return { method, header: (name: string) => (name.toLowerCase() === "origin" ? origin : undefined) } as unknown as Request;
}

function responseDouble() {
  const output: { status?: number; ended?: boolean; headers: Record<string, string>; vary: string[] } = { headers: {}, vary: [] };
  const response = {
    vary(field: string) { output.vary.push(field); return this; },
    setHeader(name: string, value: string) { output.headers[name] = value; return this; },
    status(status: number) { output.status = status; return this; },
    end() { output.ended = true; return this; },
  } as unknown as Response;
  return { output, response };
}

describe("CORS", () => {
  const allowed = parseAllowedOrigins("https://gigwork.app, http://127.0.0.1:5173/", "http://localhost:4174");

  test("normalizes the configured origins and falls back to the sign-in URI origin", () => {
    expect([...allowed]).toEqual(["https://gigwork.app", "http://127.0.0.1:5173"]);
    expect([...parseAllowedOrigins("", "https://gigwork.app/app")]).toEqual(["https://gigwork.app"]);
  });

  test("echoes an allowed origin and passes the request on", () => {
    const { output, response } = responseDouble();
    const next = mock();
    corsMiddleware(allowed)(requestDouble("GET", "https://gigwork.app"), response, next);
    expect(output.headers["Access-Control-Allow-Origin"]).toBe("https://gigwork.app");
    expect(output.vary).toEqual(["Origin"]);
    expect(next).toHaveBeenCalledTimes(1);
  });

  test("answers an allowed preflight with the bearer headers", () => {
    const { output, response } = responseDouble();
    const next = mock();
    corsMiddleware(allowed)(requestDouble("OPTIONS", "https://gigwork.app"), response, next);
    expect(output.status).toBe(204);
    expect(output.headers["Access-Control-Allow-Headers"]).toBe("Authorization,Content-Type");
    expect(next).not.toHaveBeenCalled();
  });

  test("gives other origins no CORS headers", () => {
    const { output, response } = responseDouble();
    const next = mock();
    corsMiddleware(allowed)(requestDouble("OPTIONS", "https://evil.example"), response, next);
    expect(output.headers).toEqual({});
    expect(output.status).toBe(204);
    expect(next).not.toHaveBeenCalled();
  });
});
