import type { NextFunction, Request, Response } from "express";
import { ZodError } from "zod";

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
  }
}

export const asyncRoute =
  (handler: (request: Request, response: Response) => Promise<unknown>) =>
  (request: Request, response: Response, next: NextFunction) =>
    handler(request, response).catch(next);

export function errorHandler(
  error: unknown,
  _request: Request,
  response: Response,
  _next: NextFunction,
) {
  if (error instanceof ApiError) {
    response.status(error.status).json({ error: { code: error.code, message: error.message } });
    return;
  }
  if (error instanceof ZodError) {
    response.status(400).json({
      error: {
        code: "invalid_request",
        message: "The request is invalid.",
        fields: error.issues.map((issue) => ({ path: issue.path.join("."), message: issue.message })),
      },
    });
    return;
  }
  console.error("Unhandled API error:", error);
  response.status(500).json({ error: { code: "internal_error", message: "An internal error occurred." } });
}
