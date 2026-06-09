import "dotenv/config";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Pool } from "pg";
import { getLogger } from "../../shared/logger";

const logger = getLogger();

const DB_URL = process.env.DB_URL ?? process.env.DATABASE_URL;
if (!DB_URL) {
  logger.error("DB_URL is required for migrations");
  process.exit(1);
}

async function runMigrations() {
  const pool = new Pool({ connectionString: DB_URL });
  const db = drizzle(pool);

  try {
    logger.info("Running migrations...");
    await migrate(db, { migrationsFolder: "./drizzle" });
    logger.info("Migrations completed successfully");
  } finally {
    await pool.end();
  }
}

runMigrations().catch((err) => {
  logger.error({ err }, "Migration failed");
  process.exit(1);
});
