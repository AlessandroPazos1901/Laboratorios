import type { ResultFlag } from "@/lib/types";

export function calculateAgeAt(birthDate: string, atDate: string) {
  const birth = new Date(`${birthDate}T00:00:00`);
  const at = new Date(`${atDate}T00:00:00`);
  let years = at.getFullYear() - birth.getFullYear();
  let months = at.getMonth() - birth.getMonth();

  if (at.getDate() < birth.getDate()) months -= 1;
  if (months < 0) {
    years -= 1;
    months += 12;
  }

  return { years: Math.max(0, years), months: Math.max(0, months) };
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
