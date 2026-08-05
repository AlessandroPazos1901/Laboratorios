import { readFile } from "node:fs/promises";
import pg from "pg";

const migrationPath = new URL("../supabase/migrations/202608040001_dni_patient_ids_single_user.sql", import.meta.url);
const source = await readFile(migrationPath, "utf8");
const migration = source
  .replace(/^\s*begin;\s*/i, "")
  .replace(/\s*commit;\s*$/i, "");

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
  const { rows } = await client.query(`
    select
      to_regclass('public.profiles')::text as profiles_table,
      (
        select json_agg(json_build_object('name', column_name, 'type', data_type) order by ordinal_position)
        from information_schema.columns
        where table_schema = 'public' and table_name = 'patients'
      ) as patient_columns,
      (
        select data_type
        from information_schema.columns
        where table_schema = 'public' and table_name = 'orders' and column_name = 'patient_id'
      ) as order_patient_id_type,
      (select count(*)::integer from public.patients) as patient_count,
      (select count(*)::integer from public.orders o join public.patients p on p.id = o.patient_id) as linked_order_count
  `);
  process.stdout.write(`${JSON.stringify({ dryRun: "passed", ...rows[0] }, null, 2)}\n`);
} catch (error) {
  process.stderr.write(`${JSON.stringify({
    dryRun: "failed",
    code: error.code,
    message: error.message,
    detail: error.detail,
    hint: error.hint,
    position: error.position,
  }, null, 2)}\n`);
  process.exitCode = 1;
} finally {
  await client.query("rollback").catch(() => undefined);
  await client.end().catch(() => undefined);
}
