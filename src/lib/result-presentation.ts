import { formatReferenceRange } from "@/lib/clinical";

export type ResultPresentationItem = {
  group: string;
  analysisCode?: string;
  analysis: string;
  subsection?: string;
};

export type ResultPresentationRow<T extends ResultPresentationItem> =
  | { kind: "section"; label: string }
  | { kind: "result"; result: T; indent: number };

const normalizeLabel = (value: string) => value
  .normalize("NFD")
  .replace(/\p{Diacritic}/gu, "")
  .toUpperCase()
  .replace(/[^A-Z0-9]+/g, " ")
  .trim();

const HEMOGRAM_CODES = new Set([
  "HEM-RBC", "HEM-HB", "HEM-HCT", "HEM-WBC", "HEM-ABA", "HEM-NEU",
  "HEM-EOS", "HEM-BAS", "HEM-MON", "HEM-LIN", "HEM-PLT",
]);
const HEMOGRAM_NAMES = new Set([
  "HEMATIES", "GLOBULOS ROJOS HEMATIES", "HEMOGLOBINA", "HEMATOCRITO",
  "LEUCOCITOS", "GLOBULOS BLANCOS LEUCOCITOS", "ABASTONADOS", "SEGMENTADOS",
  "NEUTROFILOS ABASTONADOS", "NEUTROFILOS SEGMENTADOS", "EOSINOFILOS",
  "BASOFILOS", "MONOCITOS", "LINFOCITOS", "PLAQUETAS", "BLASTOS",
]);
const HEMOGRAM_DIFFERENTIAL_CODES = new Set(["HEM-ABA", "HEM-NEU", "HEM-EOS", "HEM-BAS", "HEM-MON", "HEM-LIN"]);
const HEMOGRAM_DIFFERENTIAL_NAMES = new Set([
  "ABASTONADOS", "SEGMENTADOS", "NEUTROFILOS ABASTONADOS", "NEUTROFILOS SEGMENTADOS",
  "EOSINOFILOS", "BASOFILOS", "MONOCITOS", "LINFOCITOS", "BLASTOS",
]);
const BIO_CHILD_CODES = new Set(["BIO-BD", "BIO-BI", "BIO-ALB", "BIO-GLOB"]);
const BIO_CHILD_NAMES = new Set(["B DIRECTA", "DIRECTA", "B INDIRECTA", "INDIRECTA", "ALBUMINA", "GLOBULINAS"]);
const THOUSAND_RESULT_CODES = new Set(["HEM-WBC", "HEM-PLT"]);
const SUBSECTION_LABELS = new Map([
  ["HEMOGRAMA COMPLETO", "HEMOGRAMA COMPLETO"],
  ["EXAMEN FISICO", "EXAMEN FÍSICO"],
  ["EXAMEN BIOQUIMICO", "EXAMEN BIOQUÍMICO"],
  ["EXAMEN QUIMICO", "EXAMEN QUÍMICO"],
  ["EXAMEN MICROSCOPICO", "EXAMEN MICROSCÓPICO"],
  ["EXAMEN PARASITOLOGICO", "EXAMEN PARASITOLÓGICO"],
  ["PRUEBAS REUMATOLOGICAS", "PRUEBAS REUMATOLÓGICAS"],
  ["PRUEBAS SEROLOGICAS", "PRUEBAS SEROLÓGICAS"],
  ["PRUEBAS RAPIDAS", "PRUEBAS RÁPIDAS"],
  ["PRUEBAS QUIMICAS", "PRUEBAS QUÍMICAS"],
  ["PRUEBAS COMPLEMENTARIAS", "PRUEBAS COMPLEMENTARIAS"],
  ["AGLUTINACIONES", "AGLUTINACIONES"],
  ["MUESTRAS", "MUESTRAS"],
  ["METODOS", "MÉTODOS"],
]);

function canonicalSubsection(value: string | undefined) {
  if (!value?.trim()) return null;
  const normalized = normalizeLabel(value);
  return SUBSECTION_LABELS.get(normalized) ?? value.trim().toUpperCase();
}

function inferredSubsection(result: ResultPresentationItem) {
  const group = normalizeLabel(result.group);
  const code = result.analysisCode?.toUpperCase() ?? "";
  const analysis = normalizeLabel(result.analysis);
  const configuredSubsection = canonicalSubsection(result.subsection);
  if (configuredSubsection) return configuredSubsection;
  if (group.includes("HEMATOLOG") && (HEMOGRAM_CODES.has(code) || HEMOGRAM_NAMES.has(analysis))) return canonicalSubsection("HEMOGRAMA COMPLETO");
  if (group.includes("UROANAL")) {
    if (/^URO-(COLOR|ASP|PH|REAC|DEN)$/.test(code) || ["COLOR", "ASPECTO", "PH", "DENSIDAD", "REACCION"].includes(analysis)) return canonicalSubsection("EXAMEN FISICO");
    if (/^URO-(GLU|CET|PRO|BIL|BLD|NIT|URO|ASC)$/.test(code) || ["GLUCOSA", "CETONAS", "PROTEINAS", "BILIRRUBINA", "SANGRE", "NITRITOS", "UROBILINOGENO", "ACIDO ASCORBICO", "A ASCORBICO"].includes(analysis)) return canonicalSubsection("EXAMEN BIOQUIMICO");
    if (/^URO-(CEL|HEMA|LEU|PIO|GER|PRU|CRIS|CIL|OTR)/.test(code) || ["CELULAS", "CELULAS EPITELIALES", "C EPITELIALES", "HEMATIES", "LEUCOCITOS", "PIOCITOS", "GERMENES", "PROTEINURIA", "CRISTALES", "CILINDROS", "OTROS"].includes(analysis)) return canonicalSubsection("EXAMEN MICROSCOPICO");
  }
  if (group.includes("PARASITOLOG") || group === "HECES") {
    if (/^(PAR|HEC)-(COLOR|CONS|ASP|MOCO)$/.test(code) || ["COLOR", "CONSISTENCIA", "ASPECTO", "MOCO"].includes(analysis)) return canonicalSubsection("EXAMEN FISICO");
    if (/^(PAR|HEC)-(HUE|LAR|QUI|TRO|RXI|GRA|REST|PAR|REP)/.test(code) || ["HUEVO", "LARVA", "QUISTE", "TROFOZOITO", "RX INFLAMATORIA", "GLOBULOS DE GRASA", "RESTOS ALIMENTICIOS", "PARASITOS", "REPORTE PARASITOLOGICO"].includes(analysis)) return canonicalSubsection("EXAMEN MICROSCOPICO");
    if (/^(PAR|HEC)-(GRAHAM|THE|SUD|BEN)/.test(code) || ["TEST GRAHAM", "THEVENON", "SUDAN", "BENEDIC"].includes(analysis)) return canonicalSubsection("PRUEBAS COMPLEMENTARIAS");
    if (/^PAR-M[123]$/.test(code)) return canonicalSubsection("MUESTRAS");
    if (/^PAR-(DIR|TSR)$/.test(code)) return canonicalSubsection("METODOS");
  }
  if (group.includes("INMUNOLOG")) {
    if (/^INM-(TIF|PAR|BRU)/.test(code) || analysis.includes("AGLUTINACIONES")) return canonicalSubsection("AGLUTINACIONES");
    if (/^INM-(HBSAG|HIV|SIF|PSA|THE|HPI|HVC|HCG)/.test(code)) return canonicalSubsection("PRUEBAS RAPIDAS");
    if (/^INM-(FR|PCR)$/.test(code)) return canonicalSubsection("PRUEBAS REUMATOLOGICAS");
    if (code === "INM-RPR") return canonicalSubsection("PRUEBAS SEROLOGICAS");
  }
  if (group.includes("SECRECION VAGINAL")) {
    if (/^VAG-(AMIN|PH)$/.test(code)) return canonicalSubsection("PRUEBAS QUIMICAS");
    if (/^VAG-(TRI|KOH|HDU|GN)$/.test(code)) return canonicalSubsection("EXAMEN MICROSCOPICO");
  }
  return null;
}

function resultIndent(result: ResultPresentationItem, subsection: string | null) {
  const group = normalizeLabel(result.group);
  const code = result.analysisCode?.toUpperCase() ?? "";
  const analysis = normalizeLabel(result.analysis);
  if (group.includes("BIOQUIM") && (BIO_CHILD_CODES.has(code) || BIO_CHILD_NAMES.has(analysis))) return 1;
  if (group.includes("HEMATOLOG") && (HEMOGRAM_DIFFERENTIAL_CODES.has(code) || HEMOGRAM_DIFFERENTIAL_NAMES.has(analysis))) return 2;
  return subsection ? 1 : 0;
}

export function buildResultPresentationRows<T extends ResultPresentationItem>(results: T[]): ResultPresentationRow<T>[] {
  const rows: ResultPresentationRow<T>[] = [];
  let currentSubsection: string | null = null;
  results.forEach((result) => {
    const subsection = inferredSubsection(result);
    if (subsection !== currentSubsection) {
      currentSubsection = subsection;
      if (subsection) rows.push({ kind: "section", label: subsection });
    }
    rows.push({ kind: "result", result, indent: resultIndent(result, subsection) });
  });
  return rows;
}

export function usesThousandsEntry(analysisCode?: string) {
  return THOUSAND_RESULT_CODES.has(analysisCode?.toUpperCase() ?? "");
}

export function resultStorageValue(rawValue: string, analysisCode?: string) {
  const numericValue = Number(rawValue);
  if (!rawValue.trim() || !Number.isFinite(numericValue) || !usesThousandsEntry(analysisCode)) return rawValue;
  return String(Number((numericValue * 1_000).toFixed(8)));
}

export function resultDisplayNumber(value: number, analysisCode?: string) {
  return usesThousandsEntry(analysisCode) ? value / 1_000 : value;
}

export function formatResultUnit(unit: string, analysisCode?: string) {
  if (usesThousandsEntry(analysisCode)) return unit.trim() ? `10^3${unit.trim()}` : "10^3";
  const formatted = formatReferenceRange(unit).trim();
  const normalized = normalizeLabel(formatted);
  if (normalized === "MINUTOS" || normalized === "MINUTO") return "min";
  if (normalized === "MM 1RA HORA") return "mm/h";
  return formatted;
}

function escapedExpression(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function scaleReferenceNumbers(reference: string, analysisCode?: string) {
  if (!usesThousandsEntry(analysisCode)) return reference;
  return reference.replace(/\d[\d.,]*/g, (match) => {
    const value = Number(match.replace(/,/g, ""));
    if (!Number.isFinite(value)) return match;
    return String(Number((value / 1_000).toFixed(4)));
  });
}

export function formatResultReference(reference: string, unit: string, analysisCode?: string) {
  let formatted = scaleReferenceNumbers(formatReferenceRange(reference), analysisCode)
    .replace(/\bMenos de\s*/gi, "< ")
    .replace(/\bMayor(?:es)? (?:a|de)\s*/gi, "> ");
  const variants = [...new Set([unit.trim(), formatResultUnit(unit, analysisCode)].filter(Boolean))]
    .sort((left, right) => right.length - left.length);
  formatted = formatted.split("\n").map((line) => {
    let cleaned = line;
    for (const variant of variants) {
      cleaned = variant === "%"
        ? cleaned.replace(/%/g, "")
        : cleaned.replace(new RegExp(`\\s*${escapedExpression(variant)}`, "gi"), "");
    }
    return cleaned.replace(/\s+([,;)])/g, "$1").replace(/\s{2,}/g, " ").trim();
  }).join("\n");
  return formatted;
}
