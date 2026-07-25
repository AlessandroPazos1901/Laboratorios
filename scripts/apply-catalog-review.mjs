import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import pg from "pg";

const databaseUrl = process.env.LAB_DATABASE_URL;
if (!databaseUrl) throw new Error("LAB_DATABASE_URL is required");

const migrationPath = path.resolve(
  "supabase/migrations/202607240006_catalog_review_and_patient_import.sql",
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
        where table_schema='public' and table_name='patients' and column_name='full_name'
      ) as full_name,
      to_regprocedure('public.upsert_simple_patient(text,text)') is not null
        as simplified_workflow
  `);
  const missing = Object.entries(prerequisite.rows[0])
    .filter(([, exists]) => !exists)
    .map(([name]) => name);
  if (missing.length) {
    throw new Error(`Migration 005 is incomplete: ${missing.join(", ")}`);
  }

  await client.query(sql);

  const verification = await client.query(`
    select
      to_regprocedure('public.upsert_import_patient(text,text,date,text,jsonb)')
        is not null as import_rpc,
      (select count(*) from public.analysis_groups) >= 6 as groups,
      (select count(*) from public.analyses where source_metadata->>'clinical_review'='pending')
        >= 20 as pending_catalog,
      exists(
        select 1
        from public.profiles p
        where p.active and p.role='owner'
      ) as owner
  `);
  const failed = Object.entries(verification.rows[0])
    .filter(([, valid]) => !valid)
    .map(([name]) => name);
  if (failed.length) {
    throw new Error(`Migration verification failed: ${failed.join(", ")}`);
  }

  console.log("Migration 006 applied: 20 catalog entries pending clinical review.");
} finally {
  await client.end();
}
