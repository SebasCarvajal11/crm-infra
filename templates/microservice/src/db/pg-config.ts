import { env } from "../config/env";

export const pgConnectionConfig = {
  connectionString: env.DATABASE_URL,
  options: `-c search_path=${env.DB_SCHEMA}`,
};
