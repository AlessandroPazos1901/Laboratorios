import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import pg from "pg";

const databaseUrl = process.env.LAB_DATABASE_URL;
if (!databaseUrl) throw new Error("LAB_DATABASE_URL is required");

const migrationPath = path.resolve(
  "supabase/migrations/202607240007_atomic_results_and_catalog_approval.sql",
);
const sql = await fs.readFile(migrationPath, "utf8");
const client = new pg.Client({
  connectionString: databaseUrl,
  ssl: { rejectUnauthorized: false },
});

await client.connect();
try {
  const prerequisite = await client.query(`
    select
      exists(
        select 1 from information_schema.columns
        where table_schema='public' and table_name='analyses'
          and column_name='source_metadata'
      ) as source_metadata,
      to_regprocedure('public.upsert_import_patient(text,text,date,text,jsonb)')
        is not null as import_rpc
  `);
  const missing = Object.entries(prerequisite.rows[0])
    .filter(([, exists]) => !exists)
    .map(([name]) => name);
  if (missing.length) {
    throw new Error(`Migration 006 is incomplete: ${missing.join(", ")}`);
  }

  await client.query(sql);

  const verification = await client.query(`
    select
      to_regprocedure('public.save_result_batch(uuid,jsonb,integer)')
        is not null as result_batch,
      to_regprocedure('public.approve_analysis_version(uuid,text,text,text,text,integer,jsonb,jsonb,jsonb)')
        is not null as catalog_approval
  `);
  const failed = Object.entries(verification.rows[0])
    .filter(([, valid]) => !valid)
    .map(([name]) => name);
  if (failed.length) {
    throw new Error(`Migration verification failed: ${failed.join(", ")}`);
  }

  console.log("Migration 007 applied and verified.");
} finally {
  await client.end();
}
