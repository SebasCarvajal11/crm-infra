import type { MiddlewareHandler } from "hono";
import { getLogger, traceStorage } from "../logger";
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

    // Get or generate traceId and correlationId
    const traceId =
      c.req.header("x-request-id") ??
      c.req.header("x-trace-id") ??
      randomUUID();

    const correlationId =
      c.req.header("x-correlation-id") ??
      c.req.header("x-user-id") ??
      c.req.header("x-user-sub") ??
      randomUUID();

    await traceStorage.run({ traceId, correlationId }, async () => {
      // Create child logger with trace context
      const logger = getLogger().child({
        traceId,
        correlationId,
        method: c.req.method,
        path: c.req.path,
      });

      // Store in context for route handlers
      c.set("traceId", traceId);
      c.set("requestLogger", logger);

      // Set trace/correlation headers in response
      c.header("x-trace-id", traceId);
      c.header("x-correlation-id", correlationId);

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
    });
  };
}
