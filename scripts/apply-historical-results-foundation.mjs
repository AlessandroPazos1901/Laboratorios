import fs from "node:fs/promises";
import process from "node:process";
import pg from "pg";

const databaseUrl = process.env.LAB_DATABASE_URL;
if (!databaseUrl) throw new Error("LAB_DATABASE_URL is required");

const sql = await fs.readFile(
  "supabase/migrations/202607240009_historical_results_foundation.sql",
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
      (
        select count(*) = 21
        from public.analysis_versions
        where clinical_status = 'historical_unreviewed'
      ) as historical_versions_ready,
      (
        select not active
        from public.analyses
        where code = 'BIO-HB-DOS'
      ) as additional_analysis_inactive,
      exists(
        select 1
        from pg_indexes
        where schemaname = 'public'
          and indexname = 'orders_historical_source_row_uidx'
      ) as idempotency_guard_ready,
      (
        select prosrc like '%clinical_status = ''approved''%'
        from pg_proc
        where oid = 'public.create_simple_order(uuid,uuid[],timestamp with time zone)'::regprocedure
      ) as new_orders_restricted_to_approved;
  `);
  const failed = Object.entries(verification.rows[0])
    .filter(([, valid]) => !valid)
    .map(([name]) => name);
  if (failed.length) {
    throw new Error(`Historical foundation verification failed: ${failed.join(", ")}`);
  }
  console.log("Migration 009 applied and verified.");
} finally {
  await client.end();
}
