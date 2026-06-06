import pino from "pino";

// ── PII Redaction Paths ─────────────────────────────────────────────────────
const REDACTED_PATHS = [
  "req.headers.authorization",
  "req.headers.cookie",
  "res.headers.set-cookie",
  "*.email",
  "*.user_email",
  "*.createdByEmail",
  "*.authorEmail",
  "*.token",
  "*.password",
  "*.old_password",
  "*.new_password",
  "*.access_token",
  "*.refresh_token",
  "*.secret_password",
];

// ── Logger Factory ──────────────────────────────────────────────────────────
export function createLogger(service: string): pino.Logger {
  const isProduction = process.env.NODE_ENV === "production";
  const level = process.env.LOG_LEVEL ?? (isProduction ? "info" : "debug");

  return pino({
    level,
    redact: {
      paths: REDACTED_PATHS,
      remove: true,
    },
    formatters: {
      level(label) {
        return { level: label };
      },
      bindings(bindings) {
        return {
          pid: bindings.pid,
          host: bindings.hostname,
          service,
        };
      },
    },
    timestamp: pino.stdTimeFunctions.isoTime,
    serializers: {
      err: pino.stdSerializers.err,
      req: pino.stdSerializers.req,
      res: pino.stdSerializers.res,
    },
    ...(isProduction
      ? {}
      : {
          transport: {
            target: "pino-pretty",
            options: {
              colorize: true,
              translateTime: "SYS:HH:MM:ss",
              ignore: "pid,hostname",
            },
          },
        }),
  });
}

// ── Singleton Logger ────────────────────────────────────────────────────────
let logger: pino.Logger;

export function initLogger(service: string): pino.Logger {
  logger = createLogger(service);
  return logger;
}

export function getLogger(): pino.Logger {
  if (!logger) {
    logger = createLogger(process.env.SERVICE_NAME ?? "unknown");
  }
  return logger;
}
