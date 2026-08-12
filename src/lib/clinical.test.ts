import { describe, expect, it } from "vitest";
import { biochemistryFormulaKey, calculateAgeAt, expandMillonesText, flagNumericResult, formatNumericResult, formatPatientAgeAt, formatReferenceRange, groupResultsByBatch, isCalculatedHematologyResult, isMissingBatchSchema, isValidDni, linkedBiochemistryValues, linkedHematologyValues, normalizeDocument } from "./clinical";
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
  it("mantiene abreviados los resultados expresados en millones", () => {
    expect(formatNumericResult("3.78", "millones/µL", "HEM-RBC")).toBe("3.78");
  });
  it("muestra leucocitos y plaquetas en miles", () => {
    expect(formatNumericResult("5000", "/µL", "HEM-WBC")).toBe("5");
    expect(formatNumericResult("250000", "/µL", "HEM-PLT")).toBe("250");
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

describe("formatReferenceRange", () => {
  it("muestra los millones con notación científica", () => {
    expect(formatReferenceRange("4.0 - 5.9 millones/µL")).toBe("4.0 - 5.9 10^6/µL");
  });

  it("mantiene intactos los rangos que no están expresados en millones", () => {
    expect(formatReferenceRange("12.0 - 17.5 g/dL")).toBe("12.0 - 17.5 g/dL");
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

  it("identifica los resultados bloqueados por código o nombre", () => {
    expect(isCalculatedHematologyResult("HEM-RBC", "")).toBe(true);
    expect(isCalculatedHematologyResult("LOCAL", "Hemoglobina", "Hematología")).toBe(true);
    expect(isCalculatedHematologyResult("HEM-HCT", "Hematocrito")).toBe(false);
    expect(isCalculatedHematologyResult("LOCAL", "Hemoglobina glicosilada", "Bioquímica")).toBe(false);
  });
});

describe("linkedBiochemistryValues", () => {
  it("calcula HDL, VLDL y LDL a partir de colesterol y triglicéridos", () => {
    const afterCholesterol = linkedBiochemistryValues("BIO-CHOL", "186", { "BIO-TG": "352" });
    expect(afterCholesterol).toEqual({ "BIO-HDL": "31.62", "BIO-VLDL": "70.4", "BIO-LDL": "83.98" });
    expect(linkedBiochemistryValues("BIO-TG", "352", {
      "BIO-CHOL": "186", "BIO-HDL": "31.62",
    })).toEqual({ "BIO-HDL": "31.62", "BIO-VLDL": "70.4", "BIO-LDL": "83.98" });
  });

  it("calcula bilirrubina indirecta", () => {
    expect(linkedBiochemistryValues("BIO-BD", "0.32", { "BIO-BT": "1.25" }))
      .toEqual({ "BIO-BI": "0.93" });
  });

  it("calcula globulinas", () => {
    expect(linkedBiochemistryValues("BIO-ALB", "4.21", { "BIO-PROT": "7.18" }))
      .toEqual({ "BIO-GLOB": "2.97" });
  });

  it("reconoce variantes por nombre del catálogo", () => {
    expect(biochemistryFormulaKey("COD-LOCAL", "Bilirrubina indirecta", "Bioquímica")).toBe("BIO-BI");
    expect(biochemistryFormulaKey("COD-LOCAL", "Proteínas totales", "Bioquímica")).toBe("BIO-PROT");
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
