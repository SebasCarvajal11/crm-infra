import { writeFileSync } from "node:fs";
import type { Pool } from "pg";
import type Redis from "ioredis";

const HEALTH_FILE = "/tmp/worker-healthy";
const INTERVAL_MS = 30_000;

export type WorkerHealthDeps = {
  pool?: Pool;
  redis?: Redis | null;
};

async function checkWorkerDeps(deps: WorkerHealthDeps): Promise<{
  status: "ok" | "error";
  details: Record<string, "ok" | "error">;
}> {
  const results: Record<string, "ok" | "error"> = {};

  if (deps.pool) {
    try {
      const client = await deps.pool.connect();
      client.release();
      results.db = "ok";
    } catch {
      results.db = "error";
    }
  }

  if (deps.redis) {
    try {
      const pong = await deps.redis.ping();
      results.redis = pong === "PONG" ? "ok" : "error";
    } catch {
      results.redis = "error";
    }
  }

  const allOk = Object.values(results).every((s) => s === "ok");
  return { status: allOk ? "ok" : "error", details: results };
}

export function startWorkerHealthcheck(
  workerName: string,
  deps: WorkerHealthDeps
): { stop: () => void } {
  let timer: NodeJS.Timeout | null = null;

  async function tick() {
    const { status, details } = await checkWorkerDeps(deps);
    const report = JSON.stringify({
      worker: workerName,
      status,
      details,
      ts: new Date().toISOString(),
    });
    try {
      writeFileSync(HEALTH_FILE, report, "utf-8");
    } catch {
      // Ignore write errors (e.g. read-only fs in some environments)
    }
  }

  // Run immediately, then on interval
  tick().catch(() => undefined);
  timer = setInterval(() => tick().catch(() => undefined), INTERVAL_MS);

  return {
    stop() {
      if (timer) {
        clearInterval(timer);
        timer = null;
      }
    },
  };
}
