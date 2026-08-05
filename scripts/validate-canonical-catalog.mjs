import { readFile } from "node:fs/promises";
import pg from "pg";

const source = await readFile(
  new URL("../supabase/migrations/202608040003_canonical_catalog_and_print_order.sql", import.meta.url),
  "utf8",
);
const migration = source.replace(/^\s*begin;\s*/i, "").replace(/\s*commit;\s*$/i, "");
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
  await client.query("begin");
  await client.query(migration);
  const { rows: [audit] } = await client.query(`
    select
      (select jsonb_agg(name order by display_order) from public.analysis_groups where active) as groups,
      (select count(*)::integer from public.analyses where active) as active_analyses,
      (select jsonb_agg(a.name order by (a.source_metadata->>'picker_order')::integer)
       from public.analyses a join public.analysis_groups g on g.id = a.group_id
       where a.active and g.code = 'HEM') as hematology,
      (select count(*)::integer from public.order_analyses) as historical_selections,
      (select count(*)::integer from public.analysis_versions av
       join public.analyses a on a.id = av.analysis_id
       where a.active and av.source_metadata->>'catalog_version' = '2') as canonical_versions,
      to_regprocedure('public.assign_canonical_analysis_order()') is not null as order_trigger_function
  `);
  const expectedGroups = ["HEMATOLOGÍA", "BIOQUÍMICA", "INMUNOLOGÍA", "UROANÁLISIS", "PARASITOLOGÍA", "OTROS"];
  const valid = JSON.stringify(audit.groups) === JSON.stringify(expectedGroups)
    && audit.active_analyses === 88
    && audit.canonical_versions === 88
    && audit.order_trigger_function === true;
  process.stdout.write(`${JSON.stringify({ dryRun: valid ? "passed" : "failed", ...audit }, null, 2)}\n`);
  if (!valid) process.exitCode = 1;
} catch (error) {
  process.stderr.write(`${JSON.stringify({
    dryRun: "failed", code: error.code, message: error.message, detail: error.detail, hint: error.hint,
  }, null, 2)}\n`);
  process.exitCode = 1;
} finally {
  await client.query("rollback").catch(() => undefined);
  await client.end().catch(() => undefined);
}
