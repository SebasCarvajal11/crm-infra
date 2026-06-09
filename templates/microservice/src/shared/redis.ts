import Redis from "ioredis";
import { getLogger } from "./logger";

const logger = getLogger();

let publisherConnection: Redis | null = null;
let subscriberConnection: Redis | null = null;

function createRedisClient(name: string): Redis | null {
  const url = process.env.REDIS_URL;
  if (!url) {
    logger.warn({ name }, "REDIS_URL not set; Redis connection skipped");
    return null;
  }

  const client = new Redis(url, {
    maxRetriesPerRequest: 3,
    enableReadyCheck: true,
    lazyConnect: false,
  });

  client.on("connect", () => logger.info({ name }, "Redis connected"));
  client.on("error", (err) => logger.error({ err, name }, "Redis error"));
  client.on("close", () => logger.warn({ name }, "Redis connection closed"));

  return client;
}

export function getRedisConnection(): Redis | null {
  if (!publisherConnection) {
    publisherConnection = createRedisClient("publisher");
  }
  return publisherConnection;
}

export function getRedisSubscriber(): Redis | null {
  if (!subscriberConnection) {
    subscriberConnection = createRedisClient("subscriber");
  }
  return subscriberConnection;
}

export async function closeRedisConnections(): Promise<void> {
  if (publisherConnection) {
    await publisherConnection.quit().catch(() => undefined);
    publisherConnection = null;
  }
  if (subscriberConnection) {
    await subscriberConnection.quit().catch(() => undefined);
    subscriberConnection = null;
  }
}
