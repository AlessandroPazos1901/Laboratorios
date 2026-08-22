import { readFile } from "node:fs/promises";
import pg from "pg";

const databaseUrl = process.env.LAB_DATABASE_URL;
if (!databaseUrl) throw new Error("LAB_DATABASE_URL is required");

const client = new pg.Client({
  connectionString: databaseUrl,
  ssl: { rejectUnauthorized: false },
});

try {
  await client.connect();
  const migration = await readFile(
    new URL("../supabase/migrations/202608200002_complete_requested_catalog_and_formulas.sql", import.meta.url),
    "utf8",
  );
  await client.query(migration);
  process.stdout.write(`${JSON.stringify({ applied: true })}\n`);
} catch (error) {
  process.stderr.write(`${JSON.stringify({
    applied: false,
    code: error.code,
    message: error.message,
    detail: error.detail,
    hint: error.hint,
  }, null, 2)}\n`);
  process.exitCode = 1;
} finally {
  await client.end().catch(() => undefined);
}
