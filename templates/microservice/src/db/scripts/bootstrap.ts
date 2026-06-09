import "dotenv/config";
import { getLogger } from "../../shared/logger";

const logger = getLogger();

const DB_SUPERUSER_URL = process.env.DB_SUPERUSER_URL;
if (!DB_SUPERUSER_URL) {
  logger.error("DB_SUPERUSER_URL is required for bootstrap");
  process.exit(1);
}

const DB_SCHEMA = process.env.DB_SCHEMA ?? "schema_{{SERVICE_NAME}}";
const DB_ROLE = process.env.DB_ROLE ?? "{{SERVICE_NAME}}_user";
const DB_ROLE_PASSWORD = process.env.DB_ROLE_PASSWORD;
const DB_NAME = new URL(DB_SUPERUSER_URL).pathname.slice(1);

if (!DB_ROLE_PASSWORD) {
  logger.error("DB_ROLE_PASSWORD is required for bootstrap");
  process.exit(1);
}

import pg from "pg";
const { Client } = pg;

async function bootstrap() {
  const client = new Client({ connectionString: DB_SUPERUSER_URL });
  await client.connect();

  try {
    logger.info({ role: DB_ROLE }, "Checking role existence...");

    const roleCheck = await client.query(
      `SELECT 1 FROM pg_roles WHERE rolname = $1`,
      [DB_ROLE]
    );

    if (roleCheck.rowCount === 0) {
      await client.query(
        `CREATE ROLE "${DB_ROLE}" WITH LOGIN PASSWORD $1`,
        [DB_ROLE_PASSWORD]
      );
      logger.info({ role: DB_ROLE }, "Role created");
    } else {
      await client.query(
        `ALTER ROLE "${DB_ROLE}" WITH LOGIN PASSWORD $1`,
        [DB_ROLE_PASSWORD]
      );
      logger.info({ role: DB_ROLE }, "Role password synced");
    }

    logger.info({ schema: DB_SCHEMA }, "Checking schema existence...");

    await client.query(
      `CREATE SCHEMA IF NOT EXISTS "${DB_SCHEMA}" AUTHORIZATION "${DB_ROLE}"`
    );
    logger.info({ schema: DB_SCHEMA }, "Schema ensured");

    await client.query(
      `GRANT ALL PRIVILEGES ON SCHEMA "${DB_SCHEMA}" TO "${DB_ROLE}"`
    );

    await client.query(
      `GRANT CONNECT ON DATABASE "${DB_NAME}" TO "${DB_ROLE}"`
    );

    await client.query(
      `REVOKE ALL ON SCHEMA public FROM "${DB_ROLE}"`
    );

    logger.info({ role: DB_ROLE, schema: DB_SCHEMA }, "Bootstrap completed successfully");
  } finally {
    await client.end();
  }
}

bootstrap().catch((err) => {
  logger.error({ err }, "Bootstrap failed");
  process.exit(1);
});
