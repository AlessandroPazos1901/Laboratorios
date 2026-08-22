import pg from "pg";

const databaseUrl = process.env.LAB_DATABASE_URL;
if (!databaseUrl) throw new Error("LAB_DATABASE_URL is required");

const expectedCodes = [
  "HEM-BLAST",
  "BIO-VLDL", "BIO-LIP", "BIO-PROT", "BIO-ALB", "BIO-ALP", "BIO-GGT", "BIO-LDH",
  "INM-ASO", "INM-RPR-Q", "INM-HAV", "INM-PSA-Q", "INM-HCG-U",
  "URO-MALB",
  "HEC-NSAMP", "HEC-LEU", "HEC-PMN", "HEC-MN", "HEC-HEMA", "PAR-M4",
  "VAG-NUG", "VAG-PMN", "VAG-OTR",
];

const client = new pg.Client({ connectionString: databaseUrl, ssl: { rejectUnauthorized: false } });

try {
  await client.connect();
  const { rows } = await client.query(`
    select a.code, a.name, a.active, g.code as group_code, g.name as group_name,
           a.source_metadata ->> 'picker_subsection' as subsection,
           count(v.id)::integer as current_versions
    from public.analyses a
    join public.analysis_groups g on g.id = a.group_id
    left join public.analysis_versions v on v.analysis_id = a.id and v.effective_to is null
    where a.code = any($1::text[])
    group by a.id, g.id
    order by g.display_order, (a.source_metadata ->> 'picker_order')::integer nulls last, a.code
  `, [expectedCodes]);

  const returned = new Set(rows.map((row) => row.code));
  const missing = expectedCodes.filter((code) => !returned.has(code));
  const invalid = rows.filter((row) => !row.active || row.current_versions !== 1 || !row.subsection);
  if (missing.length || invalid.length) {
    throw new Error(JSON.stringify({ missing, invalid }, null, 2));
  }

  process.stdout.write(`${JSON.stringify({ verified: true, analyses: rows.length, rows }, null, 2)}\n`);
} finally {
  await client.end().catch(() => undefined);
}
