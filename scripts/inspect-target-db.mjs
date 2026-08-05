import pg from "pg";

const client = new pg.Client({
  host: process.env.PGHOST,
  port: Number(process.env.PGPORT ?? 5432),
  database: process.env.PGDATABASE,
  user: process.env.PGUSER,
  password: process.env.PGPASSWORD,
  ssl: { rejectUnauthorized: false },
});

try {
  await client.connect();
  const { rows } = await client.query(`
    select
      current_database() as database,
      current_user as db_user,
      (select count(*)::integer from public.patients) as patient_count,
      to_regclass('public.profiles')::text as profiles_table,
      to_regclass('public.analysts')::text as analysts_table,
      (
        select json_agg(json_build_object(
          'name', column_name,
          'type', data_type,
          'nullable', is_nullable
        ) order by ordinal_position)
        from information_schema.columns
        where table_schema = 'public' and table_name = 'patients'
      ) as patient_columns,
      (
        select count(*)::integer
        from public.patients
        where document_type <> 'DNI' or document_number !~ '^[0-9]{8}$'
      ) as invalid_dni_rows,
      (
        select count(*)::integer
        from (
          select document_number::integer
          from public.patients
          where document_number ~ '^[0-9]{8}$'
          group by document_number::integer
          having count(*) > 1
        ) duplicates
      ) as duplicate_numeric_dni
  `);
  process.stdout.write(`${JSON.stringify(rows[0], null, 2)}\n`);
} catch (error) {
  process.stderr.write(`${JSON.stringify({ code: error.code, message: error.message })}\n`);
  process.exitCode = 1;
} finally {
  await client.end().catch(() => undefined);
}
