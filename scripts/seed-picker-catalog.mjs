const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const userEmail = process.env.LIMS_USER_EMAIL;
const userPassword = process.env.LIMS_USER_PASSWORD;

if (!url || (!serviceRoleKey && !(anonKey && userEmail && userPassword))) {
  throw new Error("Missing Supabase connection credentials.");
}

const groups = [
  { code: "HEM", name: "Hematologia", display_order: 10 },
  { code: "BIO", name: "Bioquimica", display_order: 20 },
  { code: "INM", name: "Inmunologia", display_order: 30 },
  { code: "URO", name: "Uroanalisis", display_order: 40 },
  { code: "PAR", name: "Parasitologia", display_order: 50 },
  { code: "OTR", name: "Otros", display_order: 60 },
];

const analyses = [
  ["HEM-RBC", "HEM", "Globulos rojos (hematies)", "numeric", true, 10, "", "mill/mm3", "Impedancia"],
  ["HEM-HB", "HEM", "Hemoglobina", "numeric", true, 20, "", "g/dL", "Impedancia"],
  ["HEM-HCT", "HEM", "Hematocrito", "numeric", true, 30, "", "%", "Impedancia"],
  ["HEM-WBC", "HEM", "Globulos blancos (leucocitos)", "numeric", true, 40, "", "10^3/uL", "Impedancia"],
  ["HEM-PLT", "HEM", "Plaquetas", "numeric", true, 50, "", "10^3/uL", "Impedancia"],
  ["HEM-LIN", "HEM", "Linfocitos", "numeric", true, 60, "", "%", "Frotis"],
  ["HEM-NEU", "HEM", "Neutrofilosegmentados", "numeric", false, 70, "", "%", "Frotis"],
  ["HEM-MON", "HEM", "Monocitos", "numeric", false, 80, "", "%", "Frotis"],
  ["BIO-GLU", "BIO", "Glucosa", "numeric", true, 10, "", "mg/dL", "Enzimatico"],
  ["BIO-URE", "BIO", "Urea", "numeric", true, 20, "", "mg/dL", "Enzimatico"],
  ["BIO-CRE", "BIO", "Creatinina", "numeric", true, 30, "", "mg/dL", "Jaffe"],
  ["BIO-CHOL", "BIO", "Colesterol total", "numeric", true, 40, "", "mg/dL", "Enzimatico"],
  ["BIO-TG", "BIO", "Trigliceridos", "numeric", true, 50, "", "mg/dL", "Enzimatico"],
  ["BIO-HBA1C", "BIO", "Hb. glicosilada", "numeric", true, 60, "", "%", "Inmunoensayo"],
  ["BIO-HDL", "BIO", "Colesterol HDL", "numeric", false, 70, "", "mg/dL", "Enzimatico"],
  ["BIO-LDL", "BIO", "Colesterol LDL", "numeric", false, 80, "", "mg/dL", "Calculado"],
  ["INM-FR", "INM", "FR", "qualitative", true, 10, "", "", "Aglutinacion"],
  ["INM-PCR", "INM", "PCR", "qualitative", true, 20, "", "", "Aglutinacion"],
  ["INM-RPR", "INM", "RPR", "qualitative", true, 30, "", "", "Floculacion"],
  ["INM-HCG-U", "INM", "HCG (orina)", "qualitative", true, 40, "", "", "Inmunocromatografia"],
  ["INM-HCG-S", "INM", "HCG (sangre)", "qualitative", true, 50, "", "", "Inmunocromatografia"],
  ["INM-HIV", "INM", "HIV (SIDA)", "qualitative", false, 60, "Inmunocromatografia", "", "Inmunocromatografia"],
  ["INM-HBSAG", "INM", "HBsAG (hepatitis B)", "qualitative", false, 70, "Inmunocromatografia", "", "Inmunocromatografia"],
  ["INM-TIF-O", "INM", "Tifico \"O\"", "text", false, 80, "Aglutinaciones", "", "Aglutinaciones"],
  ["URO-COLOR", "URO", "Color", "text", true, 10, "Examen fisico", "", "Observacion directa"],
  ["URO-ASP", "URO", "Aspecto", "text", true, 20, "Examen fisico", "", "Observacion directa"],
  ["URO-PH", "URO", "pH", "numeric", true, 30, "Examen fisico", "", "Tira reactiva"],
  ["URO-DEN", "URO", "Densidad", "numeric", true, 40, "Examen fisico", "", "Tira reactiva"],
  ["URO-PRO", "URO", "Proteinas", "qualitative", true, 50, "Examen bioquimico", "", "Tira reactiva"],
  ["URO-LEU", "URO", "Leucocitos", "text", true, 60, "Examen microscopico", "", "Microscopia"],
  ["URO-GLU", "URO", "Glucosa", "qualitative", false, 70, "Examen bioquimico", "", "Tira reactiva"],
  ["URO-CET", "URO", "Cetonas", "qualitative", false, 80, "Examen bioquimico", "", "Tira reactiva"],
  ["URO-HEMA", "URO", "Hematies", "text", false, 90, "Examen microscopico", "", "Microscopia"],
  ["URO-GER", "URO", "Germenes", "text", false, 100, "Examen microscopico", "", "Microscopia"],
  ["PAR-COLOR", "PAR", "Color", "text", true, 10, "", "", "Observacion directa"],
  ["PAR-CONS", "PAR", "Consistencia", "text", true, 20, "", "", "Observacion directa"],
  ["PAR-ASP", "PAR", "Aspecto", "text", true, 30, "", "", "Observacion directa"],
  ["PAR-MOCO", "PAR", "Moco", "text", true, 40, "", "", "Microscopia"],
  ["PAR-HUE", "PAR", "Huevo", "text", true, 50, "", "", "Microscopia"],
  ["PAR-QUI", "PAR", "Quistes", "text", true, 60, "", "", "Microscopia"],
  ["PAR-LAR", "PAR", "Larva", "text", false, 70, "", "", "Microscopia"],
  ["OTR-RXI", "OTR", "Rx. inflamatoria", "text", true, 10, "", "", "Microscopia"],
  ["OTR-GRA", "OTR", "Test graham", "text", true, 20, "", "", "Metodo directo"],
  ["OTR-THE", "OTR", "Thevenon", "qualitative", true, 30, "", "", "Metodo directo"],
  ["OTR-LEI", "OTR", "Leishmaniasis", "qualitative", true, 40, "", "", "Metodo directo"],
  ["OTR-GOT", "OTR", "Gota gruesa", "qualitative", true, 50, "", "", "Metodo directo"],
  ["OTR-HEL", "OTR", "Test de helecho", "qualitative", true, 60, "", "", "Metodo directo"],
];

const qualitativeDefaults = {
  FR: ["Negativo", "Positivo"],
  PCR: ["Negativo", "Positivo"],
  RPR: ["No reactivo", "Reactivo"],
  "HCG (orina)": ["Negativo", "Positivo"],
  "HCG (sangre)": ["Negativo", "Positivo"],
  "HIV (SIDA)": ["No reactivo", "Reactivo"],
  "HBsAG (hepatitis B)": ["No reactivo", "Reactivo"],
  Proteinas: ["Negativo", "Trazas", "+", "++", "+++"],
  Glucosa: ["Negativo", "Trazas", "+", "++", "+++"],
  Cetonas: ["Negativo", "Trazas", "+", "++", "+++"],
  Thevenon: ["Negativo", "Positivo"],
  Leishmaniasis: ["Negativo", "Positivo"],
  "Gota gruesa": ["Negativo", "Positivo"],
  "Test de helecho": ["Negativo", "Positivo"],
};

function sampleTypeFor(groupCode) {
  return {
    HEM: "Sangre",
    BIO: "Suero",
    INM: "Sangre",
    URO: "Orina",
    PAR: "Heces",
    OTR: "Muestra clinica",
  }[groupCode] ?? "Muestra clinica";
}

function referenceLabelFor(resultType, name, unit) {
  if (resultType === "numeric") {
    if (name === "Glucosa") return "70 - 100";
    if (name === "Urea") return "15 - 40";
    if (name === "Creatinina") return "0.5 - 1.1";
    if (name === "Colesterol total") return "< 200";
    if (name === "Trigliceridos") return "< 150";
    if (name === "Hb. glicosilada") return "4.0 - 5.6";
    if (name === "Hemoglobina") return "12 - 16";
    if (name === "Hematocrito") return "36 - 48";
    if (name === "Globulos blancos (leucocitos)") return "4.5 - 11.0";
    if (name === "Plaquetas") return "150 - 450";
    if (name === "pH") return "5.0 - 8.0";
    if (name === "Densidad") return "1.005 - 1.030";
    return unit ? `Pendiente de validar (${unit})` : "Pendiente de validar";
  }
  if (resultType === "qualitative") return "Segun metodo";
  return "Segun muestra";
}

async function rest(path, init = {}) {
  const { apiKey, accessToken } = await getAuthHeaders();
  const response = await fetch(`${url}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: apiKey,
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
      Prefer: "return=representation,resolution=merge-duplicates",
      ...(init.headers ?? {}),
    },
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`${response.status} ${response.statusText}: ${text}`);
  }
  return response.status === 204 ? null : response.json();
}

let authHeadersPromise;

async function getAuthHeaders() {
  if (!authHeadersPromise) {
    authHeadersPromise = (async () => {
      if (serviceRoleKey) {
        return { apiKey: serviceRoleKey, accessToken: serviceRoleKey };
      }
      const response = await fetch(`${url}/auth/v1/token?grant_type=password`, {
        method: "POST",
        headers: {
          apikey: anonKey,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ email: userEmail, password: userPassword }),
      });
      if (!response.ok) {
        const text = await response.text();
        throw new Error(`Auth failed: ${response.status} ${response.statusText}: ${text}`);
      }
      const data = await response.json();
      return { apiKey: anonKey, accessToken: data.access_token };
    })();
  }
  return authHeadersPromise;
}

async function main() {
  const owners = await rest("profiles?select=id,role,active&active=eq.true&order=created_at.asc&limit=5");
  const actor = owners.find((row) => row.role === "owner")?.id ?? owners[0]?.id;
  if (!actor) throw new Error("No active profile found to attribute catalog records.");

  await rest("analysis_groups?on_conflict=code", {
    method: "POST",
    body: JSON.stringify(groups.map((group) => ({ ...group, active: true }))),
  });

  const groupRows = await rest("analysis_groups?select=id,code");
  const groupIds = new Map(groupRows.map((row) => [row.code, row.id]));

  const existingAnalyses = await rest(`analyses?select=id,code,source_metadata&code=in.(${analyses.map(([code]) => code).join(",")})`);
  const existingByCode = new Map(existingAnalyses.map((row) => [row.code, row]));

  const analysisPayload = analyses.map(([code, groupCode, name, resultType, common, pickerOrder, subsection]) => {
    const existing = existingByCode.get(code);
    return {
      code,
      group_id: groupIds.get(groupCode),
      name,
      result_type: resultType,
      active: true,
      created_by: actor,
      source_metadata: {
        ...(existing?.source_metadata ?? {}),
        source: "RESULTADOS rows 1-6",
        picker_common: common,
        picker_order: pickerOrder,
        ...(subsection ? { picker_subsection: subsection } : {}),
      },
    };
  });

  await rest("analyses?on_conflict=code", {
    method: "POST",
    body: JSON.stringify(analysisPayload),
  });

  const analysisRows = await rest(`analyses?select=id,code&code=in.(${analyses.map(([code]) => code).join(",")})`);
  const analysisIds = new Map(analysisRows.map((row) => [row.code, row.id]));

  const versionRows = await rest(`analysis_versions?select=analysis_id,version&analysis_id=in.(${[...analysisIds.values()].join(",")})`);
  const existingVersionIds = new Set(versionRows.map((row) => row.analysis_id));

  const missingVersions = analyses
    .filter(([code]) => !existingVersionIds.has(analysisIds.get(code)))
    .map(([code, groupCode, name, resultType, , , , unit, method]) => ({
      analysis_id: analysisIds.get(code),
      version: 1,
      sample_type: sampleTypeFor(groupCode),
      method: method || null,
      unit: unit || null,
      decimals: resultType === "numeric" ? 2 : null,
      qualitative_options: resultType === "qualitative" ? (qualitativeDefaults[name] ?? ["Negativo", "Positivo"]) : null,
      reference_ranges: resultType === "numeric" ? [{ label: referenceLabelFor(resultType, name, unit) }] : [],
      critical_limits: {},
      approved_by: actor,
      clinical_status: "approved",
      source_metadata: { seeded_by: "scripts/seed-picker-catalog.mjs", source: "RESULTADOS rows 1-6" },
    }));

  if (missingVersions.length) {
    await rest("analysis_versions", {
      method: "POST",
      body: JSON.stringify(missingVersions),
    });
  }

  console.log(JSON.stringify({
    actor,
    groups: groups.length,
    analyses: analyses.length,
    insertedVersions: missingVersions.length,
  }));
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
