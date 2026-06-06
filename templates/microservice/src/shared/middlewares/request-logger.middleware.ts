import type { MiddlewareHandler } from "hono";
import { getLogger } from "../logger";
import { randomUUID } from "crypto";

declare module "hono" {
  interface ContextVariableMap {
    traceId: string;
    requestLogger: import("pino").Logger;
  }
}

export function requestLoggerMiddleware(): MiddlewareHandler {
  return async (c, next) => {
    const start = Date.now();

    // Get or generate traceId
    const traceId =
      c.req.header("x-request-id") ??
      c.req.header("x-trace-id") ??
      randomUUID();

    // Create child logger with trace context
    const logger = getLogger().child({
      traceId,
      method: c.req.method,
      path: c.req.path,
    });

    // Store in context for route handlers
    c.set("traceId", traceId);
    c.set("requestLogger", logger);

    // Set traceId in response headers
    c.header("x-trace-id", traceId);

    // Log request
    logger.info({
      msg: "request started",
      query: c.req.query(),
    });

    await next();

    // Log response
    const duration = Date.now() - start;
    const status = c.res.status;

    const logFn = status >= 500 ? "error" : status >= 400 ? "warn" : "info";

    logger[logFn]({
      msg: "request completed",
      status,
      duration,
    });
  };
}
