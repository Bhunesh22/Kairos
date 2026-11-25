import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import * as schema from "@/lib/db/schema";

/**
 * In-process Postgres (PGlite) with the real Drizzle schema applied, for
 * testing SQL without touching Neon. Cast to the app's db type at the mock site.
 */
export async function createTestDb() {
  const { generateDrizzleJson, generateMigration } = await import("drizzle-kit/api");
  const client = new PGlite();
  for (const statement of await generateMigration(generateDrizzleJson({}), generateDrizzleJson(schema))) {
    await client.exec(statement);
  }
  return drizzle({ client, schema });
}
