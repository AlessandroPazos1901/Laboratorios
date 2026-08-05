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
  const { rows: [audit] } = await client.query(`
    select
      to_regclass('public.profiles')::text as profiles_table,
      to_regclass('public.analysts')::text as analysts_table,
      (select json_agg(column_name order by ordinal_position)
       from information_schema.columns
       where table_schema = 'public' and table_name = 'patients') as patient_columns,
      (select data_type from information_schema.columns
       where table_schema = 'public' and table_name = 'patients' and column_name = 'id') as patient_id_type,
      (select data_type from information_schema.columns
       where table_schema = 'public' and table_name = 'orders' and column_name = 'patient_id') as order_patient_id_type,
      (select count(*)::integer from public.patients) as patient_count,
      (select count(*)::integer from public.orders) as order_count,
      (select count(*)::integer from public.orders o left join public.patients p on p.id = o.patient_id where p.id is null) as orphan_order_count,
      (select count(*)::integer from public.patients where id < 0 or id > 99999999) as invalid_dni_count,
      (select count(*)::integer from auth.users) as auth_user_count,
      (select count(*)::integer from public.lab_settings) as lab_settings_count,
      (select count(*)::integer from public.lab_settings
       where authorized_user_id is not null) as authorized_account_count,
      (select count(*)::integer from information_schema.columns
       where table_schema = 'public' and table_name = 'analysts'
         and column_name in ('legacy_profile_id', 'created_by', 'updated_by')) as analyst_legacy_column_count
  `);

  await client.query(`select set_config(
    'request.jwt.claim.sub',
    (select authorized_user_id::text from public.lab_settings where id),
    false
  )`);
  const { rows: [authorizedCheck] } = await client.query(
    "select public.current_profile_is_active() as allowed",
  );
  await client.query(`select set_config(
    'request.jwt.claim.sub',
    '00000000-0000-0000-0000-000000000000',
    false
  )`);
  const { rows: [unauthorizedCheck] } = await client.query(
    "select public.current_profile_is_active() as allowed",
  );

  const expectedColumns = ["birth_date", "sex", "created_at", "updated_at", "full_name", "sync_version", "id"];
  const valid = audit.profiles_table === null
    && audit.analysts_table === "analysts"
    && audit.patient_id_type === "integer"
    && audit.order_patient_id_type === "integer"
    && JSON.stringify(audit.patient_columns) === JSON.stringify(expectedColumns)
    && audit.orphan_order_count === 0
    && audit.invalid_dni_count === 0
    && audit.authorized_account_count === 1
    && audit.analyst_legacy_column_count === 0
    && authorizedCheck.allowed === true
    && unauthorizedCheck.allowed === false;

  process.stdout.write(`${JSON.stringify({
    valid,
    ...audit,
    authorized_access: authorizedCheck.allowed,
    unauthorized_access: unauthorizedCheck.allowed,
  }, null, 2)}\n`);
  if (!valid) process.exitCode = 1;
} catch (error) {
  process.stderr.write(`${JSON.stringify({ valid: false, code: error.code, message: error.message }, null, 2)}\n`);
  process.exitCode = 1;
} finally {
  await client.end().catch(() => undefined);
}
