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
  await client.query("begin");
  const { rows: [fixture] } = await client.query(`
    select
      (select authorized_user_id from public.lab_settings where id) as user_id,
      (select id from public.patients order by id limit 1) as patient_id,
      (select id from public.analysts where active order by created_at limit 1) as analyst_id
  `);
  const { rows: versions } = await client.query(`
    select av.id, a.code, a.result_type, av.decimals, av.qualitative_options, av.reference_ranges
    from public.analyses a
    join lateral (
      select * from public.analysis_versions
      where analysis_id = a.id and clinical_status = 'approved' and effective_to is null
      order by version desc limit 1
    ) av on true
    join public.analysis_groups g on g.id = a.group_id
    where a.active and g.active
    order by g.display_order, (a.source_metadata->>'picker_order')::integer
  `);
  await client.query("select set_config('request.jwt.claim.sub', $1, true)", [fixture.user_id]);
  await client.query("select set_config('request.jwt.claim.role', 'authenticated', true)");
  const entries = versions.map((version) => {
    const range = Array.isArray(version.reference_ranges) ? version.reference_ranges[0] ?? {} : {};
    const numeric = typeof range.low === "number" && typeof range.high === "number"
      ? (range.low + range.high) / 2
      : typeof range.low === "number" ? range.low + 1
        : typeof range.high === "number" ? Math.max(0, range.high - 1) : 1;
    const roundedNumeric = Number(numeric.toFixed(version.decimals ?? 0));
    const firstChoice = Array.isArray(version.qualitative_options)
      ? version.qualitative_options[0]
      : "Negativo";
    return {
      analysis_version_id: version.id,
      analyst_id: fixture.analyst_id,
      payload: version.result_type === "numeric"
        ? { numeric_value: roundedNumeric }
        : version.result_type === "qualitative"
          ? { qualitative_value: firstChoice }
          : { text_value: "Negativo" },
    };
  });
  const { rows } = await client.query(
    "select public.register_daily_analyses($1, $2::jsonb, now()) as response",
    [fixture.patient_id, JSON.stringify(entries)],
  );
  const formulaValues = new Map([["HEM-RBC", 4.44], ["HEM-HB", 13.33], ["HEM-HCT", 40]]);
  const formulaEntries = versions
    .filter((version) => formulaValues.has(version.code))
    .map((version) => ({
      analysis_version_id: version.id,
      analyst_id: fixture.analyst_id,
      payload: { numeric_value: formulaValues.get(version.code) },
    }));
  const { rows: formulaRows } = await client.query(
    "select public.register_daily_analyses($1, $2::jsonb, now()) as response",
    [fixture.patient_id, JSON.stringify(formulaEntries)],
  );
  process.stdout.write(`${JSON.stringify({
    reproduced: false,
    testedAnalyses: entries.length,
    formulaValues: Object.fromEntries(formulaValues),
    response: rows[0]?.response,
    formulaResponse: formulaRows[0]?.response,
  }, null, 2)}\n`);
} catch (error) {
  process.stdout.write(`${JSON.stringify({
    reproduced: true,
    code: error.code,
    message: error.message,
    detail: error.detail,
    hint: error.hint,
    where: error.where,
  }, null, 2)}\n`);
  process.exitCode = 1;
} finally {
  await client.query("rollback").catch(() => undefined);
  await client.end().catch(() => undefined);
}
