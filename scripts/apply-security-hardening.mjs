import fs from "node:fs/promises";
import process from "node:process";
import pg from "pg";

const databaseUrl = process.env.LAB_DATABASE_URL;
if (!databaseUrl) throw new Error("LAB_DATABASE_URL is required");

const sql = await fs.readFile(
  "supabase/migrations/202607240008_harden_auth_and_writes.sql",
  "utf8",
);
const client = new pg.Client({
  connectionString: databaseUrl,
  ssl: { rejectUnauthorized: false },
});

await client.connect();
try {
  await client.query(sql);
  const verification = await client.query(`
    select
      exists(
        select 1
        from pg_proc
        where oid='public.handle_new_auth_user()'::regprocedure
          and prosrc like '%false%'
      ) as inactive_signup,
      not has_table_privilege('authenticated', 'public.result_values', 'INSERT')
        as result_writes_revoked,
      not has_table_privilege('authenticated', 'public.orders', 'INSERT')
        as order_writes_revoked,
      exists(
        select 1
        from public.profiles p
        where p.active and p.role='owner'
      ) as owner_preserved
  `);
  const failed = Object.entries(verification.rows[0])
    .filter(([, valid]) => !valid)
    .map(([name]) => name);
  if (failed.length) {
    throw new Error(`Security verification failed: ${failed.join(", ")}`);
  }
  console.log("Migration 008 applied and verified.");
} finally {
  await client.end();
}
