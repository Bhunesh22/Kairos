import "server-only";
import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import * as schema from "./schema";

function createDb() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set. Add your Neon connection string to .env.local.");
  return drizzle({ client: neon(url), schema });
}

let instance: ReturnType<typeof createDb> | undefined;

/** Lazily created so builds and imports don't need a database connection. */
export function getDb() {
  return (instance ??= createDb());
}

export { schema };
