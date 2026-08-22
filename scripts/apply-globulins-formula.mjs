import { readFile } from "node:fs/promises";
import pg from "pg";

async function connectionString() {
  if (process.env.LAB_DATABASE_URL) return process.env.LAB_DATABASE_URL;
  if (process.stdin.isTTY) throw new Error("LAB_DATABASE_URL is required");
  let input = "";
  process.stdin.setEncoding("utf8");
  for await (const chunk of process.stdin) input += chunk;
  const value = input.trim();
  if (!value) throw new Error("LAB_DATABASE_URL is required");
  return value;
}

const client = new pg.Client({
  connectionString: await connectionString(),
  ssl: { rejectUnauthorized: false },
});

try {
  await client.connect();
  const migration = await readFile(
    new URL("../supabase/migrations/202608200003_add_globulins_and_lock_calculated_results.sql", import.meta.url),
    "utf8",
  );
  await client.query(migration);

  const ids = [
    "1acf7da9-7726-4869-9b0c-b4306e998eae",
    "43cdd789-4b21-401b-bd71-e0e12615c82b",
    "cd8a5b70-6ff6-4118-b3f5-ea3eb2bad2fd",
  ];
  const { rows: sources } = await client.query(`
    select a.id, a.code, a.name, a.source_metadata->>'formula_key' as formula_key
    from public.analyses a
    where a.id = any($1::uuid[])
    union all
    select v.id, a.code, a.name, a.source_metadata->>'formula_key' as formula_key
    from public.analysis_versions v
    join public.analyses a on a.id = v.analysis_id
    where v.id = any($1::uuid[])
    order by name
  `, [ids]);
  const { rows: globulins } = await client.query(`
    select a.id, a.code, a.name, a.active, av.method, av.unit, av.decimals,
           a.source_metadata->>'formula' as formula
    from public.analyses a
    join lateral (
      select method, unit, decimals
      from public.analysis_versions
      where analysis_id = a.id and effective_to is null
      order by version desc limit 1
    ) av on true
    where a.code = 'BIO-GLOB'
  `);
  process.stdout.write(`${JSON.stringify({ applied: true, sources, globulins }, null, 2)}\n`);
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
