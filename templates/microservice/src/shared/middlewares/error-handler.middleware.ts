import type { Context } from "hono";
import { getLogger } from "../logger";

// --- Custom Error Classes ---

export class AppError extends Error {
  constructor(
    public readonly statusCode: number,
    message: string
  ) {
    super(message);
    this.name = "AppError";
  }
}

export class BadRequestError extends AppError {
  constructor(message = "Bad Request") {
    super(400, message);
  }
}

export class UnauthorizedError extends AppError {
  constructor(message = "Unauthorized") {
    super(401, message);
  }
}

export class ForbiddenError extends AppError {
  constructor(message = "Forbidden") {
    super(403, message);
  }
}

export class NotFoundError extends AppError {
  constructor(message = "Not Found") {
    super(404, message);
  }
}

export class ConflictError extends AppError {
  constructor(message = "Conflict") {
    super(409, message);
  }
}

export class TooManyRequestsError extends AppError {
  constructor(message = "Too Many Requests") {
    super(429, message);
  }
}

// --- Global Error Handler ---

type HttpStatus = 400 | 401 | 403 | 404 | 409 | 422 | 429 | 500;

export const onError = (err: Error, c: Context): Response => {
  if (err instanceof AppError) {
    return c.json({ error: err.message }, err.statusCode as HttpStatus);
  }

  const logger = c.get("requestLogger") ?? getLogger();
  const traceId = c.get("traceId");

  logger.error({
    err,
    traceId,
    method: c.req.method,
    path: c.req.path,
    msg: "unhandled error",
  });

  return c.json(
    { error: "Internal Server Error", ...(traceId ? { traceId } : {}) },
    500
  );
};
