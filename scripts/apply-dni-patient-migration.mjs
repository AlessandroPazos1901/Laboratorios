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
  const state = await client.query(`
    select
      (select data_type from information_schema.columns
       where table_schema = 'public' and table_name = 'patients' and column_name = 'id') as patient_id_type,
      to_regclass('public.profiles')::text as profiles_table
  `);
  if (state.rows[0]?.patient_id_type === "integer" && state.rows[0]?.profiles_table === null) {
    process.stdout.write(`${JSON.stringify({ applied: false, reason: "already_applied" })}\n`);
  } else {
    if (state.rows[0]?.patient_id_type !== "uuid" || state.rows[0]?.profiles_table !== "profiles") {
      throw new Error(`Unexpected pre-migration state: ${JSON.stringify(state.rows[0])}`);
    }
    const migration = await readFile(
      new URL("../supabase/migrations/202608040001_dni_patient_ids_single_user.sql", import.meta.url),
      "utf8",
    );
    await client.query(migration);
    process.stdout.write(`${JSON.stringify({ applied: true })}\n`);
  }
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
