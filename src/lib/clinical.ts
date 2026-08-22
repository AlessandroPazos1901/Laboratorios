import type { ResultFlag, ResultValue } from "@/lib/types";

export function isMissingBatchSchema(error: { code?: string; message?: string } | null | undefined) {
  return Boolean(error && (
    error.code === "42703"
    || error.code === "PGRST204"
    || error.message?.includes("batch_id")
  ));
}

export function groupResultsByBatch(results: ResultValue[], fallbackDate: string) {
  const grouped = new Map<string, ResultValue[]>();
  results.forEach((result) => grouped.set(result.batchId, [...(grouped.get(result.batchId) ?? []), result]));
  return [...grouped.entries()].map(([batchId, batchResults]) => ({
    batchId,
    group: batchResults[0]?.group ?? "Sin grupo",
    results: batchResults,
    registeredAt: batchResults.reduce(
      (latest, result) => result.registeredAt > latest ? result.registeredAt : latest,
      batchResults[0]?.registeredAt ?? fallbackDate,
    ),
  })).sort((a, b) => b.registeredAt.localeCompare(a.registeredAt));
}

export function calculateAgeAt(birthDate: string, atDate: string) {
  const birth = new Date(birthDate.includes("T") ? birthDate : `${birthDate}T00:00:00`);
  const at = new Date(atDate.includes("T") ? atDate : `${atDate}T00:00:00`);
  let years = at.getFullYear() - birth.getFullYear();
  let months = at.getMonth() - birth.getMonth();

  if (at.getDate() < birth.getDate()) months -= 1;
  if (months < 0) {
    years -= 1;
    months += 12;
  }

  return { years: Math.max(0, years), months: Math.max(0, months) };
}

export function formatPatientAgeAt(birthAt: string, occurredAt: string) {
  if (!birthAt) return "No registrada";
  const hasBirthTime = birthAt.includes("T");
  const birth = new Date(birthAt.includes("T") ? birthAt : `${birthAt}T00:00:00`);
  const occurred = new Date(occurredAt.includes("T") ? occurredAt : `${occurredAt}T00:00:00`);
  const elapsed = occurred.getTime() - birth.getTime();
  if (!Number.isFinite(elapsed) || elapsed < 0) return "No registrada";

  const hour = 60 * 60 * 1000;
  const day = 24 * hour;
  const days = Math.floor(elapsed / day);
  if (days < 28) {
    if (!hasBirthTime) return `${days} ${days === 1 ? "día" : "días"}`;
    const hours = Math.floor((elapsed % day) / hour);
    return `${days} ${days === 1 ? "día" : "días"} ${hours} ${hours === 1 ? "hora" : "horas"}`;
  }

  const { years, months } = calculateAgeAt(birthAt, occurredAt);
  if (years < 1) {
    const completedMonths = Math.max(1, occurred.getFullYear() * 12 + occurred.getMonth()
      - (birth.getFullYear() * 12 + birth.getMonth())
      - (occurred.getDate() < birth.getDate() ? 1 : 0));
    return `${completedMonths} ${completedMonths === 1 ? "mes" : "meses"}`;
  }

  return `${years} ${years === 1 ? "año" : "años"} ${months} ${months === 1 ? "mes" : "meses"}`;
}

export function flagNumericResult(
  value: number,
  limits: {
    low?: number;
    high?: number;
    criticalLow?: number;
    criticalHigh?: number;
  },
): ResultFlag {
  if (
    (limits.criticalLow !== undefined && value <= limits.criticalLow) ||
    (limits.criticalHigh !== undefined && value >= limits.criticalHigh)
  ) {
    return "critical";
  }
  if (limits.low !== undefined && value < limits.low) return "low";
  if (limits.high !== undefined && value > limits.high) return "high";
  return "normal";
}

const REFERENCE_NUMBER = String.raw`\d[\d.,]*`;

function referenceNumber(token: string) {
  // Coma de miles, punto decimal: "4,500" es 4500 y "1.030" es 1.03.
  const value = Number(token.replace(/,/g, ""));
  return Number.isFinite(value) ? value : undefined;
}

// El catálogo aprueba el intervalo como etiqueta ("70 - 100", "< 200") y no como
// cifras, así que se derivan de ahí para poder marcar fuera de rango. Lo ambiguo
// —rangos por sexo, "Pendiente de validar"— se deja sin marcar antes que adivinar.
export function parseReferenceLimits(label: string): { low?: number; high?: number } {
  const text = label.trim();
  if (!text || text.includes("\n")) return {};
  // El "%" se pega al número ("36% - 53%"), así que se admite antes del separador.
  const between = text.match(new RegExp(`(${REFERENCE_NUMBER})\\s*%?\\s*(?:[-–—]|\\sa\\s)\\s*(${REFERENCE_NUMBER})`, "i"));
  if (between) return { low: referenceNumber(between[1]), high: referenceNumber(between[2]) };
  const below = text.match(new RegExp(`(?:<|menos de|hasta|inferior a)\\s*(${REFERENCE_NUMBER})`, "i"));
  if (below) return { high: referenceNumber(below[1]) };
  const above = text.match(new RegExp(`(?:>|mayor(?:es)? (?:a|de)|superior a)\\s*(${REFERENCE_NUMBER})`, "i"));
  if (above) return { low: referenceNumber(above[1]) };
  return {};
}

// Se evalúa contra la etiqueta del propio resultado, no contra lo que traiga
// cargado río arriba: la réplica offline puede haberse guardado sin cifras.
export function resultFlagFor(result: {
  resultType: "numeric" | "qualitative" | "text";
  value: string;
  reference?: string;
  flag: ResultFlag;
  low?: number;
  high?: number;
  criticalLow?: number;
  criticalHigh?: number;
}): ResultFlag {
  if (result.flag === "unreviewed" || result.resultType !== "numeric") return result.flag;
  const value = Number(result.value);
  if (!result.value.trim() || !Number.isFinite(value)) return "normal";
  if (result.flag !== "normal") return result.flag;
  const limits = result.low !== undefined || result.high !== undefined
    ? result
    : { ...parseReferenceLimits(result.reference ?? ""), criticalLow: result.criticalLow, criticalHigh: result.criticalHigh };
  return flagNumericResult(value, limits);
}

/**
 * Texto de referencia que se imprime. Vive aquí, junto a `numericLimits`, porque
 * lo usan tanto la carga desde Supabase como la réplica offline, y esta última
 * corre en el navegador: no puede importar nada marcado `server-only`.
 */
export function referenceLabel(ranges: unknown) {
  if (!Array.isArray(ranges) || ranges.length === 0) return "Por definir";
  const range = ranges[0] as Record<string, unknown>;
  if (typeof range.label === "string") return range.label;
  if (range.low !== undefined && range.high !== undefined) return `${range.low} – ${range.high}`;
  return "Según edad y sexo";
}

export function numericLimits(ranges: unknown, criticalLimits: unknown) {
  const range = Array.isArray(ranges) && ranges.length ? ranges[0] as Record<string, unknown> : {};
  const critical = criticalLimits && typeof criticalLimits === "object" ? criticalLimits as Record<string, unknown> : {};
  const numberOrUndefined = (value: unknown) => typeof value === "number" && Number.isFinite(value) ? value : undefined;
  const low = numberOrUndefined(range.low);
  const high = numberOrUndefined(range.high);
  const derived = low === undefined && high === undefined && typeof range.label === "string"
    ? parseReferenceLimits(range.label)
    : {};
  return {
    low: low ?? derived.low,
    high: high ?? derived.high,
    criticalLow: numberOrUndefined(critical.low),
    criticalHigh: numberOrUndefined(critical.high),
  };
}

// Los límites viajan con cada resultado para poder marcar fuera de rango al editarlo.
// Manda el snapshot: un resultado ya emitido se interpreta con los intervalos
// vigentes cuando se tomó la muestra, no con los del catálogo de hoy.
export function resultNumericLimits(
  snapshot: Record<string, unknown>,
  version?: { reference_ranges: unknown; critical_limits: unknown },
) {
  const snapshotRange = snapshot.reference_range as Record<string, unknown> | null | undefined;
  return numericLimits(
    snapshotRange ? [snapshotRange] : version?.reference_ranges,
    snapshot.critical_limits ?? version?.critical_limits,
  );
}

export const isMillonesUnit = (unit: string) => /mill/i.test(unit);

// La cifra guardada de un análisis en millones (hematíes) viene en millones;
// al mostrarla se expande a su valor absoluto con separadores de miles.
export function millonesFactor(unit: string) {
  return isMillonesUnit(unit) ? 1_000_000 : 1;
}

export function formatNumericResult(rawValue: string, unit = "") {
  const trimmed = rawValue.trim();
  const number = Number(trimmed);
  if (!trimmed || !Number.isFinite(number)) return rawValue;
  if (isMillonesUnit(unit)) {
    return (number * 1_000_000).toLocaleString("es-PE", { maximumFractionDigits: 0 });
  }
  const decimals = trimmed.includes(".") ? trimmed.split(".")[1].length : 0;
  return number.toLocaleString("es-PE", { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

// Notación abreviada, solo para la captura donde el analista teclea la cifra corta.
export function formatReferenceRange(text: string) {
  return text.replace(/\bmill(?:ón|ones)\b/gi, "10^6");
}

export function normalizeDocument(value: string) {
  return value.replace(/\D/g, "").slice(0, 12);
}

export function isValidDni(value: string) {
  return /^\d{8}$/.test(normalizeDocument(value));
}

const linkedHematologyCodes = new Set(["HEM-RBC", "HEM-HB", "HEM-HCT"]);
const HEMATOCRIT_TO_HEMOGLOBIN = 3.01;
const HEMOGLOBIN_TO_ERYTHROCYTES_THOUSANDS = 320;
const THOUSANDS_PER_MILLION = 1_000;

function conciseDecimal(value: number) {
  return Number(value.toFixed(2)).toString();
}

export function linkedHematologyValues(sourceCode: string, rawValue: string) {
  if (!linkedHematologyCodes.has(sourceCode)) return null;
  // Borrar el origen vacía la tanda: dejar las otras dos con la cifra anterior
  // mostraría un hemograma que nadie midió.
  if (!rawValue.trim()) return { "HEM-RBC": "", "HEM-HB": "", "HEM-HCT": "" };
  const source = Number(rawValue);
  if (!Number.isFinite(source)) return null;
  const hemoglobin = sourceCode === "HEM-HB" ? source
    : sourceCode === "HEM-HCT" ? source / HEMATOCRIT_TO_HEMOGLOBIN
      : source * THOUSANDS_PER_MILLION / HEMOGLOBIN_TO_ERYTHROCYTES_THOUSANDS;
  return {
    // La hoja calcula Hb x 320 en miles/µL; el catálogo guarda hematíes en millones/µL.
    "HEM-RBC": conciseDecimal(hemoglobin * HEMOGLOBIN_TO_ERYTHROCYTES_THOUSANDS / THOUSANDS_PER_MILLION),
    "HEM-HB": conciseDecimal(hemoglobin),
    "HEM-HCT": conciseDecimal(hemoglobin * HEMATOCRIT_TO_HEMOGLOBIN),
  };
}

export function isCalculatedHematologyResult(code: string, name = "", group = "") {
  const normalizedCode = code.trim().toUpperCase();
  if (normalizedCode === "HEM-RBC" || normalizedCode === "HEM-HB") return true;
  if (!normalizeAnalysisLabel(group).includes("HEMATOLOG")) return false;
  const normalizedName = name.normalize("NFD").replace(/\p{Diacritic}/gu, "").toUpperCase();
  return normalizedName.includes("HEMATIES") || normalizedName.includes("HEMOGLOBINA") || normalizedName.includes("GLOBULOS ROJOS");
}

export type BiochemistryFormulaKey =
  | "BIO-CHOL" | "BIO-HDL" | "BIO-LDL" | "BIO-VLDL" | "BIO-TG"
  | "BIO-BT" | "BIO-BD" | "BIO-BI"
  | "BIO-PROT" | "BIO-ALB" | "BIO-GLOB";

const biochemistryFormulaCodes = new Set<BiochemistryFormulaKey>([
  "BIO-CHOL", "BIO-HDL", "BIO-LDL", "BIO-VLDL", "BIO-TG",
  "BIO-BT", "BIO-BD", "BIO-BI",
  "BIO-PROT", "BIO-ALB", "BIO-GLOB",
]);

const normalizeAnalysisLabel = (value: string) => value
  .normalize("NFD")
  .replace(/\p{Diacritic}/gu, "")
  .toUpperCase()
  .replace(/[^A-Z0-9]+/g, " ")
  .trim();

export function biochemistryFormulaKey(code: string, name = "", group = ""): BiochemistryFormulaKey | null {
  const normalizedCode = code.trim().toUpperCase() as BiochemistryFormulaKey;
  if (biochemistryFormulaCodes.has(normalizedCode)) return normalizedCode;
  if (!normalizeAnalysisLabel(group).includes("BIOQUIM")) return null;
  const label = normalizeAnalysisLabel(name);
  if (label.includes("VLDL")) return "BIO-VLDL";
  if (label.includes("HDL")) return "BIO-HDL";
  if (label.includes("LDL")) return "BIO-LDL";
  if (label.includes("TRIGLICER")) return "BIO-TG";
  if (label.includes("COLESTEROL") && label.includes("TOTAL")) return "BIO-CHOL";
  if ((label.includes("BILIRRUBINA") && label.includes("INDIRECT")) || label === "B INDIRECTA") return "BIO-BI";
  if ((label.includes("BILIRRUBINA") && label.includes("DIRECT")) || label === "B DIRECTA") return "BIO-BD";
  if ((label.includes("BILIRRUBINA") && label.includes("TOTAL")) || label === "B TOTAL") return "BIO-BT";
  if (label.includes("PROTEINA") && !label.includes("GLOBULINA")) return "BIO-PROT";
  if (label.includes("ALBUMINA")) return "BIO-ALB";
  if (label.includes("GLOBULINA")) return "BIO-GLOB";
  return null;
}

const calculatedBiochemistryCodes = new Set<BiochemistryFormulaKey>([
  "BIO-HDL", "BIO-LDL", "BIO-VLDL", "BIO-BI", "BIO-GLOB",
]);

export function isCalculatedBiochemistryResult(code: string, name = "", group = "") {
  const key = biochemistryFormulaKey(code, name, group);
  return key !== null && calculatedBiochemistryCodes.has(key);
}

export function isCalculatedAnalysisResult(code: string, name = "", group = "") {
  return isCalculatedHematologyResult(code, name, group)
    || isCalculatedBiochemistryResult(code, name, group);
}

function numericFormulaValue(value: string | undefined) {
  if (!value?.trim()) return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

export function linkedBiochemistryValues(
  sourceKey: BiochemistryFormulaKey,
  rawValue: string,
  currentValues: Partial<Record<BiochemistryFormulaKey, string>>,
) {
  const values = { ...currentValues, [sourceKey]: rawValue };
  const calculated: Partial<Record<BiochemistryFormulaKey, string>> = {};
  const setValue = (key: BiochemistryFormulaKey, value: number | null) => {
    calculated[key] = value === null ? "" : conciseDecimal(value);
    values[key] = calculated[key];
  };

  if (["BIO-CHOL", "BIO-HDL", "BIO-VLDL", "BIO-TG"].includes(sourceKey)) {
    const cholesterol = numericFormulaValue(values["BIO-CHOL"]);
    const triglycerides = numericFormulaValue(values["BIO-TG"]);
    if (sourceKey === "BIO-CHOL" || sourceKey === "BIO-TG") {
      setValue("BIO-HDL", cholesterol === null ? null : cholesterol * 0.17);
      setValue("BIO-VLDL", triglycerides === null ? null : triglycerides / 5);
    }
    const hdl = numericFormulaValue(values["BIO-HDL"]);
    const vldl = numericFormulaValue(values["BIO-VLDL"]);
    setValue("BIO-LDL", cholesterol === null
      ? null
      : vldl === null
        ? cholesterol * 0.67
        : hdl === null
          ? null
          : cholesterol - vldl - hdl);
  }

  if (sourceKey === "BIO-BT" || sourceKey === "BIO-BD") {
    const total = numericFormulaValue(values["BIO-BT"]);
    const direct = numericFormulaValue(values["BIO-BD"]);
    setValue("BIO-BI", total !== null && direct !== null ? total - direct : null);
  }

  if (sourceKey === "BIO-PROT" || sourceKey === "BIO-ALB") {
    const proteins = numericFormulaValue(values["BIO-PROT"]);
    const albumin = numericFormulaValue(values["BIO-ALB"]);
    setValue("BIO-GLOB", proteins !== null && albumin !== null ? proteins - albumin : null);
  }

  return calculated;
}
