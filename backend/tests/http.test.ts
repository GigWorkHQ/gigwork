import { describe, expect, mock, test } from "bun:test";
import type { Request, Response } from "express";
import { z } from "zod";
import { ApiError, asyncRoute, errorHandler } from "../src/http.js";

function responseDouble() {
  const output: { status?: number; body?: unknown } = {};
  const response = {
    status(status: number) { output.status = status; return this; },
    json(body: unknown) { output.body = body; return this; },
  } as unknown as Response;
  return { output, response };
}

describe("HTTP error handling", () => {
  test("serializes expected API errors", () => {
    const { output, response } = responseDouble();
    errorHandler(new ApiError(409, "conflict", "Try again."), {} as Request, response, mock());
    expect(output).toEqual({ status: 409, body: { error: { code: "conflict", message: "Try again." } } });
  });

  test("returns field paths for invalid input without exposing internal errors", () => {
    const { output, response } = responseDouble();
    try { z.object({ title: z.string() }).parse({ title: 12 }); } catch (error) {
      errorHandler(error, {} as Request, response, mock());
    }
    expect(output.status).toBe(400);
    expect(output.body).toMatchObject({ error: { code: "invalid_request", fields: [{ path: "title" }] } });
  });

  test("converts unknown errors to a generic response", () => {
    const { output, response } = responseDouble();
    const errorSpy = mock(() => undefined);
    const previous = console.error;
    console.error = errorSpy;
    try { errorHandler(new Error("secret database detail"), {} as Request, response, mock()); }
    finally { console.error = previous; }
    expect(output).toEqual({ status: 500, body: { error: { code: "internal_error", message: "An internal error occurred." } } });
    expect(errorSpy).toHaveBeenCalledTimes(1);
  });

  test("forwards async route rejections to Express", async () => {
    const next = mock();
    asyncRoute(async () => { throw new Error("route failed"); })({} as Request, {} as Response, next);
    await Promise.resolve();
    expect(next).toHaveBeenCalledWith(expect.objectContaining({ message: "route failed" }));
  });
});
