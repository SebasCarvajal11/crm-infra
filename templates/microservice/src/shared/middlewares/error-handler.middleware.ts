import type { Context } from "hono";
import { HTTPException } from "hono/http-exception";
import { ZodError } from "zod";
import { getLogger, traceStorage } from "../logger";

// Standard NormalizedError — mirrors cima-contracts NormalizedError
export interface NormalizedError {
  code: string;
  message: string;
  details?: Record<string, unknown>;
  traceId?: string;
  correlationId?: string;
}

// --- Custom Error Classes ---

export class AppError extends Error {
  constructor(
    public readonly statusCode: number,
    message: string,
    public readonly code: string = "INTERNAL_SERVER_ERROR",
    public readonly details?: Record<string, unknown>
  ) {
    super(message);
    this.name = "AppError";
  }
}

export class BadRequestError extends AppError {
  constructor(message = "Bad Request", details?: Record<string, unknown>) {
    super(400, message, "BAD_REQUEST", details);
  }
}

export class UnauthorizedError extends AppError {
  constructor(message = "Unauthorized", details?: Record<string, unknown>) {
    super(401, message, "UNAUTHORIZED", details);
  }
}

export class ForbiddenError extends AppError {
  constructor(message = "Forbidden", details?: Record<string, unknown>) {
    super(403, message, "FORBIDDEN", details);
  }
}

export class NotFoundError extends AppError {
  constructor(message = "Not Found", details?: Record<string, unknown>) {
    super(404, message, "NOT_FOUND", details);
  }
}

export class ConflictError extends AppError {
  constructor(message = "Conflict", details?: Record<string, unknown>) {
    super(409, message, "CONFLICT", details);
  }
}

export class TooManyRequestsError extends AppError {
  constructor(message = "Too Many Requests", details?: Record<string, unknown>) {
    super(429, message, "TOO_MANY_REQUESTS", details);
  }
}

// --- Global Error Handler ---

type HttpStatus = 400 | 401 | 403 | 404 | 409 | 422 | 429 | 500;

function getCodeFromStatus(status: number): string {
  switch (status) {
    case 400: return "BAD_REQUEST";
    case 401: return "UNAUTHORIZED";
    case 403: return "FORBIDDEN";
    case 404: return "NOT_FOUND";
    case 409: return "CONFLICT";
    case 422: return "VALIDATION_ERROR";
    case 429: return "TOO_MANY_REQUESTS";
    default: return "INTERNAL_SERVER_ERROR";
  }
}

export const onError = (err: Error, c: Context): Response => {
  const logger = c.get("requestLogger") ?? getLogger();
  const traceId = c.get("traceId");
  const correlationId = traceStorage.getStore()?.correlationId ?? c.req.header("x-correlation-id");

  let statusCode: HttpStatus = 500;
  let responseBody: NormalizedError = {
    code: "INTERNAL_SERVER_ERROR",
    message: "Internal Server Error",
    traceId,
    correlationId,
  };

  if (err instanceof AppError) {
    statusCode = err.statusCode as HttpStatus;
    responseBody = {
      code: err.code,
      message: err.message,
      details: err.details,
      traceId,
      correlationId,
    };
  } else if (err instanceof HTTPException) {
    statusCode = err.status as HttpStatus;
    responseBody = {
      code: getCodeFromStatus(err.status),
      message: err.message || "HTTP Exception",
      traceId,
      correlationId,
    };
  } else if (err instanceof ZodError) {
    statusCode = 400;
    const issues = err.issues.map(i => ({
      path: i.path.join("."),
      message: i.message,
    }));
    responseBody = {
      code: "VALIDATION_ERROR",
      message: "Validation failed",
      details: { issues },
      traceId,
      correlationId,
    };
  } else {
    logger.error({
      err,
      traceId,
      correlationId,
      method: c.req.method,
      path: c.req.path,
      msg: "unhandled error",
    });
  }

  return c.json(responseBody, statusCode);
};
