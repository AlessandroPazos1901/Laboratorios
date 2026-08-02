import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import pg from "pg";

const databaseUrl = process.env.LAB_DATABASE_URL;
if (!databaseUrl) {
  throw new Error("LAB_DATABASE_URL is required. Use the Supabase direct database connection string.");
}

const localEnv = await fs.readFile(path.resolve(".env.local"), "utf8");
const appUrl = localEnv.match(/^NEXT_PUBLIC_SUPABASE_URL=(.+)$/m)?.[1]?.trim();
const expectedProjectRef = appUrl ? new URL(appUrl).hostname.split(".")[0] : "";
const databaseIdentity = `${new URL(databaseUrl).hostname}:${decodeURIComponent(new URL(databaseUrl).username)}`;
if (expectedProjectRef && !databaseIdentity.includes(expectedProjectRef)) {
  throw new Error(`Database connection does not belong to the app project ${expectedProjectRef}. Migration aborted.`);
}

const migrationPaths = [
  "supabase/migrations/202608010001_group_daily_patient_orders.sql",
  "supabase/migrations/202608010002_independent_analysis_batches.sql",
  "supabase/migrations/202608010003_analysis_performer.sql",
  "supabase/migrations/202608010004_patient_demographics.sql",
  "supabase/migrations/202608010005_cod_catalog.sql",
  "supabase/migrations/202608010006_edit_patient_details.sql",
].map((migration) => path.resolve(migration));
const client = new pg.Client({
  connectionString: databaseUrl,
  ssl: { rejectUnauthorized: false },
});

await client.connect();
try {
  for (const migrationPath of migrationPaths) {
    await client.query(await fs.readFile(migrationPath, "utf8"));
  }

  const verification = await client.query(`
    select
      to_regprocedure('public.register_daily_analyses(uuid,jsonb,timestamp with time zone)')
        is not null as daily_registration,
      to_regprocedure('public.record_order_group_print(uuid,text,integer)')
        is not null as group_print,
      to_regprocedure('public.record_order_batch_print(uuid,uuid,integer)')
        is not null as batch_print,
      to_regclass('public.order_analysis_batches')
        is not null as analysis_batches,
      exists (
        select 1 from information_schema.columns
        where table_schema = 'public'
          and table_name = 'order_analyses'
          and column_name = 'performed_by'
      ) as analysis_performer,
      exists (
        select 1 from information_schema.columns
        where table_schema = 'public'
          and table_name = 'patients'
          and column_name = 'birth_at'
      ) as patient_birth_time,
      to_regprocedure('public.upsert_patient_with_demographics(text,text,timestamp with time zone,text)')
        is not null as patient_demographics,
      exists (
        select 1 from public.analysis_versions versions
        where versions.source_metadata->>'source_workbook' = 'COD.xlsx'
          and versions.source_metadata->>'catalog_version' = '1'
      ) as cod_catalog,
      to_regprocedure('public.update_patient_details(uuid,text,timestamp with time zone,text,text)')
        is not null as edit_patient_details,
      (
        select prosrc like '%pg_advisory_xact_lock%'
        from pg_proc
        where oid = 'public.create_simple_order(uuid,uuid[],timestamp with time zone)'::regprocedure
      ) as same_day_order_lock;
  `);
  const failed = Object.entries(verification.rows[0])
    .filter(([, valid]) => !valid)
    .map(([name]) => name);
  if (failed.length) {
    throw new Error(`Daily order migration verification failed: ${failed.join(", ")}`);
  }

  await client.query("notify pgrst, 'reload schema'");
  console.log("Daily orders, independent batches and patient demographics applied; PostgREST schema reload requested.");
} finally {
  await client.end();
}
