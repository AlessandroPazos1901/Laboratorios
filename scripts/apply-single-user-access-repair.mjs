import { readFile } from "node:fs/promises";
import pg from "pg";

const client = new pg.Client({
  host: process.env.PGHOST,
  port: Number(process.env.PGPORT ?? 6543),
  database: process.env.PGDATABASE,
  user: process.env.PGUSER,
  password: process.env.PGPASSWORD,
  ssl: { rejectUnauthorized: false },
});

try {
  await client.connect();
  const migration = await readFile(
    new URL("../supabase/migrations/202608040002_single_user_access_repair.sql", import.meta.url),
    "utf8",
  );
  await client.query(migration);
  process.stdout.write(`${JSON.stringify({ repaired: true })}\n`);
} catch (error) {
  process.stderr.write(`${JSON.stringify({
    repaired: false,
    code: error.code,
    message: error.message,
    detail: error.detail,
  }, null, 2)}\n`);
  process.exitCode = 1;
} finally {
  await client.end().catch(() => undefined);
}
