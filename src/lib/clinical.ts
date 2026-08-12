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

const isMillonesUnit = (unit: string) => /mill/i.test(unit);
const thousandResultCodes = new Set(["HEM-WBC", "HEM-PLT"]);

export function formatNumericResult(rawValue: string, unit = "", analysisCode = "") {
  const trimmed = rawValue.trim();
  const number = Number(trimmed);
  if (!trimmed || !Number.isFinite(number)) return rawValue;
  if (thousandResultCodes.has(analysisCode.toUpperCase())) {
    return Number((number / 1_000).toFixed(8)).toLocaleString("es-PE", { maximumFractionDigits: 8 });
  }
  if (isMillonesUnit(unit)) {
    return number.toLocaleString("es-PE", { maximumFractionDigits: 8 });
  }
  const decimals = trimmed.includes(".") ? trimmed.split(".")[1].length : 0;
  return number.toLocaleString("es-PE", { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

// Conservado para datos históricos y lugares que todavía requieren la cifra absoluta.
export function expandMillonesText(text: string) {
  if (!isMillonesUnit(text)) return text;
  return text
    .replace(/\d+(?:[.,]\d+)?/g, (match) => (Number(match.replace(",", ".")) * 1_000_000).toLocaleString("es-PE"))
    .replace(/millones\s*/gi, "")
    .trim();
}

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

function conciseDecimal(value: number) {
  return Number(value.toFixed(2)).toString();
}

export function linkedHematologyValues(sourceCode: string, rawValue: string) {
  if (!linkedHematologyCodes.has(sourceCode) || !rawValue.trim()) return null;
  const source = Number(rawValue);
  if (!Number.isFinite(source)) return null;
  const hemoglobin = sourceCode === "HEM-HB" ? source
    : sourceCode === "HEM-HCT" ? source / 3
      : source * 3;
  return {
    "HEM-RBC": conciseDecimal(hemoglobin / 3),
    "HEM-HB": conciseDecimal(hemoglobin),
    "HEM-HCT": conciseDecimal(hemoglobin * 3),
  };
}
