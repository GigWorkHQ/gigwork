import { describe, expect, mock, test } from "bun:test";
import type { Request, Response } from "express";
import { rateLimit } from "../src/ratelimit.js";

const request = (ip: string, method = "POST") => ({ ip, method }) as unknown as Request;
const response = () => ({ setHeader: mock() }) as unknown as Response;

describe("rate limit", () => {
  test("allows the limit per IP per minute, then answers 429", () => {
    const limiter = rateLimit({ name: "test", perMinute: 3 });
    const results: unknown[] = [];
    for (let i = 0; i < 4; i++) limiter(request("1.1.1.1"), response(), (error?: unknown) => results.push(error));
    expect(results.slice(0, 3)).toEqual([undefined, undefined, undefined]);
    expect((results[3] as { status: number; code: string })).toMatchObject({ status: 429, code: "rate_limited" });
  });

  test("counts each IP separately and ignores methods it does not cover", () => {
    const limiter = rateLimit({ name: "write", perMinute: 1, methods: ["POST"] });
    const errors: unknown[] = [];
    const next = (error?: unknown) => { if (error) errors.push(error); };
    limiter(request("1.1.1.1"), response(), next);
    limiter(request("2.2.2.2"), response(), next);
    for (let i = 0; i < 5; i++) limiter(request("1.1.1.1", "GET"), response(), next);
    expect(errors).toEqual([]);
    limiter(request("1.1.1.1"), response(), next);
    expect(errors).toHaveLength(1);
  });
});
