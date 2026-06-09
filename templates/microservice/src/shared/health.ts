import type { Pool } from "pg";
import type Redis from "ioredis";

// ── Types ───────────────────────────────────────────────────────────────────
export type DependencyStatus = "ok" | "down" | "timeout";

export type HealthDependency = {
  name: string;
  status: DependencyStatus;
  latencyMs?: number;
  error?: string;
};

export type HealthResponse = {
  status: "ok" | "degraded" | "down";
  service: string;
  version: string;
  uptime: number;
  timestamp: string;
  dependencies: HealthDependency[];
};

// ── Checkers ────────────────────────────────────────────────────────────────
export async function checkPostgres(pool: Pool): Promise<HealthDependency> {
  const start = Date.now();
  try {
    const client = await pool.connect();
    client.release();
    return { name: "postgres", status: "ok", latencyMs: Date.now() - start };
  } catch (error) {
    return {
      name: "postgres",
      status: "down",
      latencyMs: Date.now() - start,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}

export async function checkRedis(redis: Redis | undefined | null): Promise<HealthDependency> {
  if (!redis) return { name: "redis", status: "ok" };
  const start = Date.now();
  try {
    const pong = await redis.ping();
    if (pong === "PONG") {
      return { name: "redis", status: "ok", latencyMs: Date.now() - start };
    }
    return { name: "redis", status: "down", latencyMs: Date.now() - start, error: `Unexpected: ${pong}` };
  } catch (error) {
    return {
      name: "redis",
      status: "down",
      latencyMs: Date.now() - start,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}

// ── Aggregator ──────────────────────────────────────────────────────────────
export function buildHealthResponse(
  service: string,
  version: string,
  startTime: number,
  dependencies: HealthDependency[]
): { body: HealthResponse; status: 200 | 503 } {
  const hasDown = dependencies.some((d) => d.status === "down");
  const status = hasDown ? "down" : "ok";

  return {
    status: status === "down" ? 503 : 200,
    body: {
      status,
      service,
      version,
      uptime: Math.floor((Date.now() - startTime) / 1000),
      timestamp: new Date().toISOString(),
      dependencies,
    },
  };
}
