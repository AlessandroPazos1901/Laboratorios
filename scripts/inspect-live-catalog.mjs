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
  const { rows } = await client.query(`
    select
      ag.code as group_code,
      ag.name as group_name,
      ag.display_order as group_order,
      a.code,
      a.name,
      a.result_type,
      a.active,
      a.source_metadata->>'picker_order' as picker_order,
      av.version,
      av.unit,
      av.reference_ranges,
      (select count(*)::integer from public.order_analyses oa where oa.analysis_id = a.id) as historical_uses
    from public.analysis_groups ag
    join public.analyses a on a.group_id = ag.id
    left join lateral (
      select version, unit, reference_ranges
      from public.analysis_versions
      where analysis_id = a.id and effective_to is null
      order by version desc
      limit 1
    ) av on true
    order by ag.display_order, coalesce((a.source_metadata->>'picker_order')::integer, 999), a.name
  `);
  process.stdout.write(`${JSON.stringify(rows, null, 2)}\n`);
} catch (error) {
  process.stderr.write(`${JSON.stringify({ code: error.code, message: error.message }, null, 2)}\n`);
  process.exitCode = 1;
} finally {
  await client.end().catch(() => undefined);
}
