import { describe, expect, it } from "vitest";
import { calculateAgeAt, expandMillonesText, flagNumericResult, formatNumericResult, formatPatientAgeAt, groupResultsByBatch, isMissingBatchSchema, isValidDni, linkedHematologyValues, normalizeDocument } from "./clinical";
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

  it("no inventa horas cuando solo se registró la fecha de nacimiento", () => {
    expect(formatPatientAgeAt("2026-07-30", "2026-08-01T09:00:00-05:00")).toBe("2 días");
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

describe("formatNumericResult", () => {
  it("agrega coma de miles para valores grandes", () => {
    expect(formatNumericResult("1234567")).toBe("1,234,567");
  });
  it("conserva la cantidad de decimales ingresada", () => {
    expect(formatNumericResult("1234567.50")).toBe("1,234,567.50");
  });
  it("deja intactos los valores no numéricos", () => {
    expect(formatNumericResult("Negativo")).toBe("Negativo");
  });
  it("deja intacto un valor vacío", () => {
    expect(formatNumericResult("")).toBe("");
  });
  it("expande a la cifra absoluta cuando la unidad está en millones", () => {
    expect(formatNumericResult("3.78", "millones/µL")).toBe("3,780,000");
  });
});

describe("expandMillonesText", () => {
  it("quita 'millones' y deja la unidad tal como la usan otros análisis", () => {
    expect(expandMillonesText("millones/µL")).toBe("/µL");
  });
  it("expande los números de un rango de referencia en millones", () => {
    expect(expandMillonesText("4.0 - 5.9 millones/µL")).toBe("4,000,000 - 5,900,000 /µL");
  });
  it("deja intacto un texto sin 'millones'", () => {
    expect(expandMillonesText("150,000 - 400,000 /µL")).toBe("150,000 - 400,000 /µL");
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

describe("linkedHematologyValues", () => {
  it("completa hematocrito y hematíes desde hemoglobina", () => {
    expect(linkedHematologyValues("HEM-HB", "12.6")).toEqual({
      "HEM-RBC": "4.2", "HEM-HB": "12.6", "HEM-HCT": "37.8",
    });
  });

  it("completa hemoglobina y hematíes desde hematocrito", () => {
    expect(linkedHematologyValues("HEM-HCT", "36")).toEqual({
      "HEM-RBC": "4", "HEM-HB": "12", "HEM-HCT": "36",
    });
  });

  it("completa hemoglobina y hematocrito desde hematíes", () => {
    expect(linkedHematologyValues("HEM-RBC", "4.5")).toEqual({
      "HEM-RBC": "4.5", "HEM-HB": "13.5", "HEM-HCT": "40.5",
    });
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
