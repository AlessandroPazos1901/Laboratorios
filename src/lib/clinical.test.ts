import { describe, expect, it } from "vitest";
import { calculateAgeAt, flagNumericResult, formatPatientAgeAt, groupResultsByBatch, isMissingBatchSchema, isValidDni, normalizeDocument } from "./clinical";
import type { ResultValue } from "./types";

describe("calculateAgeAt", () => {
  it("calcula la edad en la fecha de la orden y no con la fecha actual", () => {
    expect(calculateAgeAt("2000-08-01", "2026-07-24")).toEqual({ years: 25, months: 11 });
  });
  it("respeta el día del cumpleaños", () => {
    expect(calculateAgeAt("2000-07-24", "2026-07-24")).toEqual({ years: 26, months: 0 });
  });
});

describe("formatPatientAgeAt", () => {
  it("muestra años y meses desde el primer año", () => {
    expect(formatPatientAgeAt("2024-01-15T10:00:00-05:00", "2026-08-01T09:00:00-05:00")).toBe("2 años 6 meses");
  });

  it("muestra meses en menores de un año", () => {
    expect(formatPatientAgeAt("2026-01-15T10:00:00-05:00", "2026-08-01T09:00:00-05:00")).toBe("6 meses");
  });

  it("muestra días y horas durante los primeros 28 días", () => {
    expect(formatPatientAgeAt("2026-07-30T03:00:00-05:00", "2026-08-01T09:00:00-05:00")).toBe("2 días 6 horas");
  });
});

describe("flagNumericResult", () => {
  const limits = { low: 70, high: 100, criticalLow: 40, criticalHigh: 250 };
  it.each([
    [39, "critical"], [40, "critical"], [69, "low"], [70, "normal"],
    [100, "normal"], [101, "high"], [250, "critical"],
  ])("clasifica %s como %s", (value, flag) => {
    expect(flagNumericResult(value as number, limits)).toBe(flag);
  });
});

describe("DNI", () => {
  it("normaliza separadores y limita longitud", () => {
    expect(normalizeDocument("70.421-856abc")).toBe("70421856");
  });
  it("acepta exactamente ocho dígitos", () => {
    expect(isValidDni("70421856")).toBe(true);
    expect(isValidDni("7042185")).toBe(false);
  });
});

describe("groupResultsByBatch", () => {
  it("conserva tandas repetidas del mismo grupo y las ordena por fecha", () => {
    const result = (batchId: string, registeredAt: string, analyte: string) => ({
      id: `${batchId}-${analyte}`,
      orderAnalysisId: `${batchId}-${analyte}`,
      batchId,
      registeredAt,
      analyte,
      group: "Hematología",
      resultType: "numeric",
      value: "10",
      unit: "g/dL",
      reference: "Normal",
      flag: "normal",
      method: "Automatizado",
    }) as ResultValue;

    const batches = groupResultsByBatch([
      result("primera", "2026-08-01T09:00:00Z", "Hemoglobina"),
      result("primera", "2026-08-01T09:00:00Z", "Hematocrito"),
      result("segunda", "2026-08-01T11:00:00Z", "Hemoglobina"),
      result("segunda", "2026-08-01T11:00:00Z", "Hematocrito"),
      result("segunda", "2026-08-01T11:00:00Z", "Plaquetas"),
    ], "2026-08-01T00:00:00Z");

    expect(batches.map((batch) => [batch.batchId, batch.results.length])).toEqual([
      ["segunda", 3],
      ["primera", 2],
    ]);
  });
});

describe("isMissingBatchSchema", () => {
  it("detecta el esquema antiguo que hacía desaparecer el detalle completo", () => {
    expect(isMissingBatchSchema({ code: "42703", message: "column order_analyses.batch_id does not exist" })).toBe(true);
    expect(isMissingBatchSchema({ code: "42501", message: "permission denied" })).toBe(false);
  });
});
