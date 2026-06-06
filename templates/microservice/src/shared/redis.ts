import Redis from "ioredis";
import { env } from "../config/env";

let sharedConnection: Redis | undefined;

/** Conexión Redis compartida (cola de email, rate limit, worker). */
export function getRedisConnection(): Redis | undefined {
  if (!env.REDIS_URL) return undefined;
  if (!sharedConnection) {
    sharedConnection = new Redis(env.REDIS_URL, {
      maxRetriesPerRequest: null,
    });
  }
  return sharedConnection;
}
