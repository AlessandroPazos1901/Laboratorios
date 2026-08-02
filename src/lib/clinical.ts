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
  const birth = new Date(birthAt.includes("T") ? birthAt : `${birthAt}T00:00:00`);
  const occurred = new Date(occurredAt.includes("T") ? occurredAt : `${occurredAt}T00:00:00`);
  const elapsed = occurred.getTime() - birth.getTime();
  if (!Number.isFinite(elapsed) || elapsed < 0) return "No registrada";

  const hour = 60 * 60 * 1000;
  const day = 24 * hour;
  const days = Math.floor(elapsed / day);
  if (days < 28) {
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

export function normalizeDocument(value: string) {
  return value.replace(/\D/g, "").slice(0, 12);
}

export function isValidDni(value: string) {
  return /^\d{8}$/.test(normalizeDocument(value));
}

export function formatStatus(status: string) {
  return (
    {
      draft: "Borrador",
      pending_validation: "Completo",
      validated: "Impreso",
      delivered: "Impreso",
      cancelled: "Anulado",
    }[status] ?? status
  );
}
