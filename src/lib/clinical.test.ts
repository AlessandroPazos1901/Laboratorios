import { describe, expect, it } from "vitest";
import { biochemistryFormulaKey, birthMoment, calculateAgeAt, flagNumericResult, formatNumericResult, formatPatientAgeAt, formatReferenceRange, groupResultsByBatch, isCalculatedAnalysisResult, isCalculatedHematologyResult, isMissingBatchSchema, isValidDni, linkedBiochemistryValues, linkedHematologyValues, normalizeDocument, numericLimits, parseReferenceLimits, resultFlagFor, resultNumericLimits } from "./clinical";
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
    expect(formatPatientAgeAt("2024-01-15T10:00:00-05:00", "2026-08-01T09:00:00-05:00")).toBe("2 años y 6 meses");
  });

  it("muestra meses en menores de un año", () => {
    expect(formatPatientAgeAt("2026-01-15T10:00:00-05:00", "2026-08-01T09:00:00-05:00")).toBe("6 meses");
  });

  it("cuenta en días hasta el mes, sin arrastrar las horas", () => {
    expect(formatPatientAgeAt("2026-07-30T03:00:00-05:00", "2026-08-01T09:00:00-05:00")).toBe("2 días");
  });

  it("el primer día se informa en horas", () => {
    expect(formatPatientAgeAt("2026-08-01T03:00:00-05:00", "2026-08-01T07:00:00-05:00")).toBe("4 horas");
    expect(formatPatientAgeAt("2026-08-01T03:00:00-05:00", "2026-08-01T04:00:00-05:00")).toBe("1 hora");
  });

  it("omite los meses cuando el cumpleaños acaba de pasar", () => {
    expect(formatPatientAgeAt("2000-08-01", "2026-08-01T09:00:00-05:00")).toBe("26 años");
  });

  it("no inventa horas cuando solo se registró la fecha de nacimiento", () => {
    expect(formatPatientAgeAt("2026-07-30", "2026-08-01T09:00:00-05:00")).toBe("2 días");
  });
});

describe("birthMoment", () => {
  it("junta fecha y hora cuando el recién nacido la tiene", () => {
    expect(birthMoment("2026-08-22", "06:30")).toBe("2026-08-22T06:30");
  });

  it("sin hora devuelve la fecha tal cual, que es el caso de casi todos", () => {
    expect(birthMoment("2026-08-22")).toBe("2026-08-22");
    expect(birthMoment("2026-08-22", "")).toBe("2026-08-22");
  });

  it("sin fecha no compone nada", () => {
    expect(birthMoment("", "06:30")).toBe("");
  });

  it("compuesto, la edad de un bebé de horas deja de ser «0 días»", () => {
    const momento = birthMoment("2026-08-22", "06:30");
    expect(formatPatientAgeAt(momento, "2026-08-22T14:30:00")).toBe("8 horas");
    expect(formatPatientAgeAt("2026-08-22", "2026-08-22T14:30:00")).toBe("0 días");
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
  it("expande los resultados en millones a su cifra completa", () => {
    expect(formatNumericResult("3.78", "millones/µL")).toBe("3,780,000");
  });
  it("muestra leucocitos y plaquetas con su cifra completa", () => {
    expect(formatNumericResult("5000", "/µL")).toBe("5,000");
    expect(formatNumericResult("250000", "/µL")).toBe("250,000");
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

describe("parseReferenceLimits", () => {
  it("lee los intervalos tal como los aprueba el catálogo", () => {
    expect(parseReferenceLimits("70 - 100")).toEqual({ low: 70, high: 100 });
    expect(parseReferenceLimits("0.5 - 1.1")).toEqual({ low: 0.5, high: 1.1 });
    expect(parseReferenceLimits("1.005 - 1.030")).toEqual({ low: 1.005, high: 1.03 });
    expect(parseReferenceLimits("4,500 - 11,000 /µL")).toEqual({ low: 4500, high: 11000 });
    expect(parseReferenceLimits("150,000 - 400,000 /µL")).toEqual({ low: 150000, high: 400000 });
    expect(parseReferenceLimits("36% - 53%")).toEqual({ low: 36, high: 53 });
    expect(parseReferenceLimits("4.0 - 5.9 millones/µL")).toEqual({ low: 4, high: 5.9 });
  });

  it("lee los intervalos abiertos", () => {
    expect(parseReferenceLimits("< 200")).toEqual({ high: 200 });
    expect(parseReferenceLimits("Menos de 200 mg/dL")).toEqual({ high: 200 });
    expect(parseReferenceLimits("Mayor de 40 mg/dL")).toEqual({ low: 40 });
  });

  it("no adivina cuando la etiqueta no define cifras", () => {
    expect(parseReferenceLimits("Pendiente de validar (mg/dL)")).toEqual({});
    expect(parseReferenceLimits("Segun metodo")).toEqual({});
    expect(parseReferenceLimits("")).toEqual({});
  });

  it("deja sin marcar los intervalos por sexo en vez de usar el equivocado", () => {
    expect(parseReferenceLimits("Hombres: 3.5 - 7.2\nMujeres: 2.6 - 6.0")).toEqual({});
  });

  it("no confunde las cifras de la unidad con el intervalo", () => {
    expect(parseReferenceLimits("0 - 20 mm/1ra hora")).toEqual({ low: 0, high: 20 });
  });

  it("marca fuera de rango con lo que el catálogo aprueba hoy: solo la etiqueta", () => {
    const limits = numericLimits([{ label: "70 - 100" }], {});
    expect(limits).toEqual({ low: 70, high: 100, criticalLow: undefined, criticalHigh: undefined });
    expect(flagNumericResult(250, limits)).toBe("high");
    expect(flagNumericResult(40, limits)).toBe("low");
    expect(flagNumericResult(85, limits)).toBe("normal");
  });

  it("respeta las cifras explícitas por encima de la etiqueta", () => {
    expect(numericLimits([{ label: "70 - 100", low: 65, high: 105 }], {}))
      .toMatchObject({ low: 65, high: 105 });
  });
});

describe("resultFlagFor", () => {
  // Tal como llegan desde la réplica offline: sin low/high, solo la etiqueta.
  const fila = (value: string, reference: string, flag: ResultValue["flag"] = "normal") =>
    ({ resultType: "numeric" as const, value, reference, flag });

  it("marca fuera de rango aunque el resultado llegue sin cifras cargadas", () => {
    expect(resultFlagFor(fila("6.22", "4.0 - 5.9 millones/µL"))).toBe("high");
    expect(resultFlagFor(fila("18.67", "12.0 - 17.5"))).toBe("high");
    expect(resultFlagFor(fila("56", "36 - 53"))).toBe("high");
    expect(resultFlagFor(fila("30", "36 - 53"))).toBe("low");
    expect(resultFlagFor(fila("45", "36 - 53"))).toBe("normal");
  });

  it("prefiere las cifras del catálogo cuando sí vienen cargadas", () => {
    expect(resultFlagFor({ ...fila("56", "36 - 53"), low: 20, high: 80 })).toBe("normal");
  });

  it("respeta un aviso ya emitido por la base", () => {
    expect(resultFlagFor(fila("45", "36 - 53", "critical"))).toBe("critical");
    expect(resultFlagFor(fila("45", "36 - 53", "unreviewed"))).toBe("unreviewed");
  });

  it("no marca lo vacío, lo no numérico ni lo que no tiene intervalo", () => {
    expect(resultFlagFor(fila("", "36 - 53"))).toBe("normal");
    expect(resultFlagFor(fila("9999", "Pendiente de validar"))).toBe("normal");
    expect(resultFlagFor({ resultType: "qualitative", value: "Positivo", reference: "", flag: "normal" })).toBe("normal");
  });
});

describe("resultNumericLimits", () => {
  const version = {
    reference_ranges: [{ low: 4500, high: 11000, label: "4,500 - 11,000" }],
    critical_limits: { low: 2000, high: 30000 },
  };

  it("toma los intervalos de la versión vigente cuando no hay snapshot", () => {
    expect(resultNumericLimits({}, version)).toEqual({
      low: 4500, high: 11000, criticalLow: 2000, criticalHigh: 30000,
    });
  });

  it("prefiere el snapshot del resultado sobre el catálogo actual", () => {
    expect(resultNumericLimits({
      reference_range: { low: 4000, high: 10000 },
      critical_limits: { low: 1500, high: 25000 },
    }, version)).toEqual({ low: 4000, high: 10000, criticalLow: 1500, criticalHigh: 25000 });
  });

  it("deja los límites vacíos cuando el catálogo aún no los define", () => {
    expect(resultNumericLimits({}, undefined)).toEqual({
      low: undefined, high: undefined, criticalLow: undefined, criticalHigh: undefined,
    });
  });

  it("permite marcar fuera de rango un resultado cargado del servidor", () => {
    const limits = resultNumericLimits({}, version);
    expect(flagNumericResult(12000, limits)).toBe("high");
    expect(flagNumericResult(3000, limits)).toBe("low");
    expect(flagNumericResult(31000, limits)).toBe("critical");
    expect(flagNumericResult(7000, limits)).toBe("normal");
  });
});

describe("linkedHematologyValues", () => {
  it("completa hematocrito y hematíes desde hemoglobina", () => {
    expect(linkedHematologyValues("HEM-HB", "12.6")).toEqual({
      "HEM-RBC": "4.03", "HEM-HB": "12.6", "HEM-HCT": "37.93",
    });
  });

  it("completa hemoglobina y hematíes desde hematocrito", () => {
    expect(linkedHematologyValues("HEM-HCT", "36")).toEqual({
      "HEM-RBC": "3.83", "HEM-HB": "11.96", "HEM-HCT": "36",
    });
  });

  it("completa hemoglobina y hematocrito desde hematíes", () => {
    expect(linkedHematologyValues("HEM-RBC", "4.5")).toEqual({
      "HEM-RBC": "4.5", "HEM-HB": "14.06", "HEM-HCT": "42.33",
    });
  });

  it("vacía las tres al borrar el valor de origen", () => {
    expect(linkedHematologyValues("HEM-HCT", "")).toEqual({
      "HEM-RBC": "", "HEM-HB": "", "HEM-HCT": "",
    });
    expect(linkedHematologyValues("HEM-HB", "   ")).toEqual({
      "HEM-RBC": "", "HEM-HB": "", "HEM-HCT": "",
    });
  });

  it("no toca análisis ajenos a la fórmula", () => {
    expect(linkedHematologyValues("HEM-WBC", "")).toBeNull();
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

  it("calcula LDL alternativo cuando no hay trigliceridos", () => {
    expect(linkedBiochemistryValues("BIO-CHOL", "186", {})).toEqual({
      "BIO-HDL": "31.62", "BIO-VLDL": "", "BIO-LDL": "124.62",
    });
  });

  it("identifica los campos calculados que deben estar bloqueados", () => {
    expect(isCalculatedAnalysisResult("HEM-RBC", "", "Hematologia")).toBe(true);
    expect(isCalculatedAnalysisResult("HEM-HB", "", "Hematologia")).toBe(true);
    expect(isCalculatedAnalysisResult("BIO-HDL", "", "Bioquimica")).toBe(true);
    expect(isCalculatedAnalysisResult("BIO-LDL", "", "Bioquimica")).toBe(true);
    expect(isCalculatedAnalysisResult("BIO-VLDL", "", "Bioquimica")).toBe(true);
    expect(isCalculatedAnalysisResult("CUS-INDIRECTA", "B. Indirecta", "Bioquimica")).toBe(true);
    expect(isCalculatedAnalysisResult("BIO-GLOB", "Globulinas", "Bioquimica")).toBe(true);
    expect(isCalculatedAnalysisResult("BIO-CHOL", "", "Bioquimica")).toBe(false);
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
    expect(biochemistryFormulaKey("COD-LOCAL", "B. Indirecta", "Bioquímica")).toBe("BIO-BI");
    expect(biochemistryFormulaKey("COD-LOCAL", "Proteínas", "Bioquímica")).toBe("BIO-PROT");
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
