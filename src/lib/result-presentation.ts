import { formatNumericResult, formatReferenceRange, isMillonesUnit, millonesFactor } from "@/lib/clinical";

export type ResultPresentationItem = {
  group: string;
  analysisCode?: string;
  analysis: string;
  subsection?: string;
};

export type ResultPresentationRow<T extends ResultPresentationItem> =
  | { kind: "section"; label: string }
  | { kind: "result"; result: T; indent: number };

export const normalizeLabel = (value: string) => value
  .normalize("NFD")
  .replace(/\p{Diacritic}/gu, "")
  .toUpperCase()
  .replace(/[^A-Z0-9]+/g, " ")
  .trim();

const HEMOGRAM_CODES = new Set([
  "HEM-RBC", "HEM-HB", "HEM-HCT", "HEM-WBC", "HEM-ABA", "HEM-NEU",
  "HEM-EOS", "HEM-BAS", "HEM-MON", "HEM-LIN", "HEM-BLAST", "HEM-PLT",
]);
const HEMOGRAM_NAMES = new Set([
  "HEMATIES", "GLOBULOS ROJOS HEMATIES", "HEMOGLOBINA", "HEMATOCRITO",
  "LEUCOCITOS", "GLOBULOS BLANCOS LEUCOCITOS", "ABASTONADOS", "SEGMENTADOS",
  "NEUTROFILOS ABASTONADOS", "NEUTROFILOS SEGMENTADOS", "EOSINOFILOS",
  "BASOFILOS", "MONOCITOS", "LINFOCITOS", "PLAQUETAS", "BLASTOS",
]);
const HEMOGRAM_DIFFERENTIAL_CODES = new Set(["HEM-ABA", "HEM-NEU", "HEM-EOS", "HEM-BAS", "HEM-MON", "HEM-LIN", "HEM-BLAST"]);
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

/**
 * Subgrupo con el que se imprime un resultado: el del catálogo si lo tiene, y si
 * no, el que se deduce del código. Las vistas de impresión filtran por esto
 * mismo, así que lo que agrupa el informe y lo que selecciona una vista no
 * pueden discrepar.
 */
export function resultSubsection(result: ResultPresentationItem) {
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
    if (/^PAR-M[1234]$/.test(code)) return canonicalSubsection("MUESTRAS");
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
  // Se agrupa por subgrupo, no por cambios consecutivos: un análisis rezagado
  // en el orden de captura repetía el título de su subgrupo más abajo.
  // El Map conserva el orden de primera aparición, así que el subgrupo sigue
  // saliendo donde lo pone el orden clínico.
  const buckets = new Map<string, T[]>();
  const unassigned: T[] = [];
  results.forEach((result) => {
    const subsection = resultSubsection(result);
    if (!subsection) return void unassigned.push(result);
    const current = buckets.get(subsection);
    if (current) current.push(result);
    else buckets.set(subsection, [result]);
  });

  const rows: ResultPresentationRow<T>[] = [];
  buckets.forEach((items, subsection) => {
    rows.push({ kind: "section", label: subsection });
    items.forEach((result) => rows.push({ kind: "result", result, indent: resultIndent(result, subsection) }));
  });
  // Los análisis sin subgrupo cierran el bloque, sin título propio.
  unassigned.forEach((result) => rows.push({ kind: "result", result, indent: resultIndent(result, null) }));
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

// Inversa de resultStorageValue: la cifra tal como el analista la tecleó.
export function resultEntryValue(storedValue: string, analysisCode?: string) {
  const numericValue = Number(storedValue);
  if (!storedValue.trim() || !Number.isFinite(numericValue) || !usesThousandsEntry(analysisCode)) return storedValue;
  return String(Number((numericValue / 1_000).toFixed(8)));
}

// Cifra absoluta para gráficas: lo guardado ya está en unidades reales salvo los millones.
export function displayResultNumber(value: number, unit: string) {
  return value * millonesFactor(unit);
}

function namedUnit(unit: string) {
  const normalized = normalizeLabel(unit);
  if (normalized === "MINUTOS" || normalized === "MINUTO") return "min";
  if (normalized === "MM 1RA HORA") return "mm/h";
  return unit;
}

// Unidad abreviada de la captura: el analista teclea 5 y se guardan 5000.
export function formatResultUnit(unit: string, analysisCode?: string) {
  if (usesThousandsEntry(analysisCode)) return unit.trim() ? `10^3${unit.trim()}` : "10^3";
  return namedUnit(formatReferenceRange(unit).trim());
}

// Unidad de lectura e impresión: sin abreviar en 10^3 ni 10^6.
export function formatDisplayUnit(unit: string) {
  return namedUnit(unit.replace(/\bmill(?:ón|ones)\b/gi, "").trim());
}

// Cifra que se guardará e imprimirá, solo donde la captura usa una escala abreviada.
// Deja en blanco al resto para no repetir el mismo número bajo cada campo.
export function entryFullFigure(storedValue: string, unit: string, analysisCode?: string) {
  if (!usesThousandsEntry(analysisCode) && !isMillonesUnit(unit)) return "";
  const figure = formatNumericResult(storedValue, unit).trim();
  if (!figure) return "";
  const displayUnit = formatDisplayUnit(unit);
  return displayUnit ? `${figure} ${displayUnit}` : figure;
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

function stripUnits(reference: string, variants: string[]) {
  const ordered = [...new Set(variants.map((variant) => variant.trim()).filter(Boolean))]
    .sort((left, right) => right.length - left.length);
  return reference
    .replace(/\bMenos de\s*/gi, "< ")
    .replace(/\bMayor(?:es)? (?:a|de)\s*/gi, "> ")
    .split("\n")
    .map((line) => {
      let cleaned = line;
      for (const variant of ordered) {
        cleaned = variant === "%"
          ? cleaned.replace(/%/g, "")
          : cleaned.replace(new RegExp(`\\s*${escapedExpression(variant)}`, "gi"), "");
      }
      return cleaned.replace(/\s+([,;)])/g, "$1").replace(/\s{2,}/g, " ").trim();
    })
    .join("\n");
}

// Referencia en la escala de captura: 4.5 - 11 para leucocitos, 4.0 - 5.9 para hematíes.
export function formatResultReference(reference: string, unit: string, analysisCode?: string) {
  return stripUnits(
    scaleReferenceNumbers(formatReferenceRange(reference), analysisCode),
    [unit, formatResultUnit(unit, analysisCode)],
  );
}

// Referencia de lectura e impresión: cifras completas con separador de miles.
export function formatDisplayReference(reference: string, unit: string) {
  const expanded = isMillonesUnit(unit)
    ? reference
      .replace(/\d[\d.,]*/g, (match) => {
        const value = Number(match.replace(/,/g, ""));
        // Una referencia ya escrita en cifras absolutas no se vuelve a multiplicar.
        if (!Number.isFinite(value) || value >= 1_000) return match;
        return (value * 1_000_000).toLocaleString("es-PE");
      })
      .replace(/\bmill(?:ón|ones)\b/gi, "")
    : reference;
  return stripUnits(expanded, [unit, formatDisplayUnit(unit)]);
}

/** Compara ignorando mayúsculas, tildes y espacios de más. */
export const looseKey = (value: string) => value
  .normalize("NFD").replace(/\p{Diacritic}/gu, "").trim().toLocaleLowerCase("es").replace(/\s+/g, " ");

/**
 * La opción de la lista que corresponde a lo tecleado, o `null` si no hay
 * ninguna. La base exige coincidencia exacta (`qualitative_option_not_allowed`),
 * así que «positivo» tecleado en minúscula tiene que volverse «POSITIVO» aquí y
 * no llegar al servidor tal cual para que lo rechace sin explicación.
 */
export function matchChoiceOption(options: string[], value: string) {
  const typed = value.trim();
  if (!typed) return "";
  const exact = options.find((option) => option === typed);
  if (exact) return exact;
  const loose = options.filter((option) => looseKey(option) === looseKey(typed));
  return loose.length === 1 ? loose[0] : null;
}

/**
 * Lo que se teclea en un resultado, filtrado antes de llegar al estado. Un campo
 * numérico no admite ni una letra, y no deja escribir más decimales de los que
 * el catálogo aprobó para ese análisis: pasarse era `numeric_precision_exceeded`
 * al guardar, con toda la tanda ya escrita.
 */
export function sanitizeResultInput(type: "numeric" | "qualitative" | "text", rawValue: string, decimals?: number) {
  if (type !== "numeric") return rawValue;
  const normalized = rawValue.replace(",", ".").replace(/[^0-9.-]/g, "");
  const negative = normalized.startsWith("-");
  const unsigned = normalized.replace(/-/g, "");
  const [whole, ...rest] = unsigned.split(".");
  const fraction = rest.join("");
  const limited = typeof decimals === "number" && decimals >= 0 ? fraction.slice(0, decimals) : fraction;
  // `decimals: 0` significa entero: el punto tampoco se queda escrito.
  const separator = rest.length && limited === "" && decimals === 0 ? "" : rest.length ? "." : "";
  return `${negative ? "-" : ""}${whole}${separator}${limited}`;
}
