import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import pg from "pg";

const databaseUrl = process.env.LAB_DATABASE_URL;
if (!databaseUrl) throw new Error("LAB_DATABASE_URL is required");

const migrationPath = path.resolve(
  "supabase/migrations/202607240005_simplified_lab_workflow.sql",
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
      to_regclass('public.profiles') is not null as profiles,
      to_regclass('public.patients') is not null as patients,
      to_regclass('public.orders') is not null as orders,
      to_regclass('public.result_values') is not null as result_values,
      to_regprocedure('public.save_result_draft(uuid,uuid,jsonb,integer)') is not null as save_result_draft,
      to_regprocedure('public.amend_report(uuid,text)') is not null as amend_report
  `);
  const missing = Object.entries(prerequisite.rows[0])
    .filter(([, exists]) => !exists)
    .map(([name]) => name);
  if (missing.length) {
    throw new Error(`Prerequisite migrations are incomplete: ${missing.join(", ")}`);
  }

  await client.query(sql);

  const verification = await client.query(`
    select
      exists(
        select 1 from information_schema.columns
        where table_schema='public' and table_name='patients' and column_name='full_name'
      ) as full_name,
      to_regprocedure('public.upsert_simple_patient(text,text)') is not null as upsert_simple_patient,
      to_regprocedure('public.create_simple_order(uuid,uuid[],timestamp with time zone)') is not null as create_simple_order,
      to_regprocedure('public.record_order_print(uuid,integer)') is not null as record_order_print,
      to_regprocedure('public.cancel_simple_order(uuid,text)') is not null as cancel_simple_order
  `);
  const failed = Object.entries(verification.rows[0])
    .filter(([, exists]) => !exists)
    .map(([name]) => name);
  if (failed.length) throw new Error(`Migration verification failed: ${failed.join(", ")}`);

  console.log("Migration 005 applied and verified.");
} finally {
  await client.end();
}
