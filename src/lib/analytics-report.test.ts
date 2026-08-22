import { describe, expect, it } from "vitest";
import {
  AGE_BRACKETS, ageColumns, analysisKey, bracketFor, buildCountMatrix, dayColumns,
  countSheet, DEFAULT_GROUP_COLOR, detailSheet, groupColor, matchesAgeRange, patientAgeLabel, patientYears,
  tintedColor, transposedCountSheet, UNCATALOGUED_GROUP,
} from "./analytics-report";
import type { AnalysisDefinition, LabOrder, ResultValue } from "./types";

const analysis = (code: string, name: string, group: string, pickerOrder: number): AnalysisDefinition => ({
  id: code, versionId: `v-${code}`, code, name, group, resultType: "numeric",
  unit: "", method: "", reference: "", active: true, pickerOrder,
});

const result = (code: string, analyte: string, group: string): ResultValue => ({
  id: `r-${code}`, orderAnalysisId: `oa-${code}`, batchId: "b1", registeredAt: "2026-08-10T10:00:00-05:00",
  analyte, analysisCode: code, group, resultType: "numeric", value: "1", unit: "", reference: "",
  flag: "normal", method: "", performedBy: "Analista",
});

const order = (id: string, createdAt: string, birthDate: string, results: ResultValue[]): LabOrder => ({
  id, revisionId: `rev-${id}`, lockVersion: 1, code: `ORD-${id}`, patientId: Number(id.replace(/\D/g, "")) || 1,
  patientName: `Paciente ${id}`, documentNumber: "70000000", patientBirthDate: birthDate, patientSex: "F",
  createdAt, groups: [...new Set(results.map((item) => item.group))], responsible: "Analista", results,
});

const catalog = [
  analysis("HEM-HB", "Hemoglobina", "Hematología", 10),
  analysis("HEM-HCT", "Hematocrito", "Hematología", 20),
  analysis("BIO-GLU", "Glucosa", "Bioquímica", 10),
];

describe("patientAgeLabel", () => {
  const nacido = (birthDate: string) => order("1", "2026-08-10T10:00:00-05:00", birthDate, []);

  it("un recién nacido se cuenta en días, no en un cero", () => {
    expect(patientAgeLabel(nacido("2026-08-08"), "at-analysis")).toBe("2 días");
    expect(patientAgeLabel(nacido("2026-08-09"), "at-analysis")).toBe("1 día");
    expect(patientAgeLabel(nacido("2026-08-10"), "at-analysis")).toBe("0 días");
  });

  it("pasa a meses al cumplir cuatro semanas", () => {
    expect(patientAgeLabel(nacido("2026-07-14"), "at-analysis")).toBe("27 días");
    expect(patientAgeLabel(nacido("2026-07-13"), "at-analysis")).toBe("1 mes");
  });

  it("del mes al año cuenta meses, y después años con meses", () => {
    expect(patientAgeLabel(nacido("2025-10-10"), "at-analysis")).toBe("10 meses");
    expect(patientAgeLabel(nacido("2025-08-10"), "at-analysis")).toBe("1 año");
    expect(patientAgeLabel(nacido("1966-06-10"), "at-analysis")).toBe("60 años y 2 meses");
  });

  it("sin fecha de nacimiento no inventa una edad", () => {
    expect(patientAgeLabel(nacido(""), "at-analysis")).toBe("Sin registrar");
  });

  it("la base «actual» mide contra hoy, no contra la fecha de la orden", () => {
    const hoy = new Date("2027-08-10T10:00:00-05:00");
    expect(patientAgeLabel(nacido("2025-08-10"), "current", hoy)).toBe("2 años");
  });
});

describe("patientYears", () => {
  const ordered = order("1", "2026-08-10T10:00:00-05:00", "1966-08-10", []);

  it("cuenta el cumpleaños del mismo día como ya cumplido", () => {
    expect(patientYears(ordered, "at-analysis")).toBe(60);
  });

  it("no adelanta el cumpleaños que aún no llega", () => {
    expect(patientYears(order("1", "2026-08-09T10:00:00-05:00", "1966-08-10", []), "at-analysis")).toBe(59);
  });

  it("distingue la edad al analizar de la edad de hoy", () => {
    const old = order("1", "2023-08-10T10:00:00-05:00", "1966-08-10", []);
    expect(patientYears(old, "at-analysis")).toBe(57);
    expect(patientYears(old, "current", new Date("2026-08-20T10:00:00-05:00"))).toBe(60);
  });

  it("da cero para un neonato y null si no hay nacimiento", () => {
    expect(patientYears(order("1", "2026-08-10T10:00:00-05:00", "2026-08-01", []), "at-analysis")).toBe(0);
    expect(patientYears(order("1", "2026-08-10T10:00:00-05:00", "", []), "at-analysis")).toBeNull();
  });
});

describe("tramos de edad", () => {
  it("respeta los bordes exactos", () => {
    expect(bracketFor(0)?.id).toBe("1-11");
    expect(bracketFor(11)?.id).toBe("1-11");
    expect(bracketFor(12)?.id).toBe("12-17");
    expect(bracketFor(17)?.id).toBe("12-17");
    expect(bracketFor(18)?.id).toBe("18-39");
    expect(bracketFor(29)?.id).toBe("18-39");
    expect(bracketFor(30)?.id).toBe("40-59");
    expect(bracketFor(59)?.id).toBe("40-59");
    expect(bracketFor(60)?.id).toBe("60+");
    expect(bracketFor(95)?.id).toBe("60+");
  });

  it("cubre toda la vida sin huecos", () => {
    for (let years = 0; years <= 120; years += 1) expect(bracketFor(years)).not.toBeNull();
  });

  it("deja fuera de todo tramo a quien no tiene edad registrada", () => {
    expect(bracketFor(null)).toBeNull();
    expect(matchesAgeRange(null, 60)).toBe(false);
    expect(matchesAgeRange(null)).toBe(true);
  });

  it("acota por rango libre", () => {
    expect(matchesAgeRange(60, 60, undefined)).toBe(true);
    expect(matchesAgeRange(59, 60, undefined)).toBe(false);
    expect(matchesAgeRange(30, 18, 39)).toBe(true);
    expect(matchesAgeRange(40, 18, 39)).toBe(false);
  });
});

describe("analysisKey", () => {
  it("cruza catálogo y resultado por código", () => {
    expect(analysisKey(catalog[0])).toBe(analysisKey(result("HEM-HB", "HEMOGLOBINA", "Hematología")));
  });

  it("cae al nombre normalizado cuando el histórico no trae código", () => {
    expect(analysisKey({ analyte: "Hemoglobina" })).toBe(analysisKey({ name: "HEMOGLOBINA" }));
  });
});

describe("buildCountMatrix", () => {
  const columns = dayColumns(new Date(2026, 7, 10), new Date(2026, 7, 12));
  const orders = [
    order("1", "2026-08-10T09:00:00-05:00", "1966-08-10", [
      result("HEM-HB", "Hemoglobina", "Hematología"),
      result("BIO-GLU", "Glucosa", "Bioquímica"),
    ]),
    order("2", "2026-08-12T09:00:00-05:00", "2000-01-01", [
      result("HEM-HB", "Hemoglobina", "Hematología"),
    ]),
  ];

  it("rotula las columnas con el número de día y el mes en la banda", () => {
    expect(columns.map((column) => column.label)).toEqual(["10", "11", "12"]);
    expect([...new Set(columns.map((column) => column.band))]).toEqual(["agosto de 2026"]);
  });

  it("distingue meses distintos en la banda cuando el periodo los cruza", () => {
    const cruza = dayColumns(new Date(2026, 6, 30), new Date(2026, 7, 2));
    expect(cruza.map((column) => column.label)).toEqual(["30", "31", "1", "2"]);
    expect(cruza.map((column) => column.band)).toEqual([
      "julio de 2026", "julio de 2026", "agosto de 2026", "agosto de 2026",
    ]);
  });

  it("cuenta cada análisis en el día que se hizo", () => {
    const matrix = buildCountMatrix(catalog, orders, (item) => item.results, columns);
    const hb = matrix.rows.find((row) => row.analysis === "Hemoglobina");
    expect(hb?.counts).toEqual([1, 0, 1]);
    expect(hb?.total).toBe(2);
  });

  it("incluye en cero los análisis del catálogo sin actividad", () => {
    const matrix = buildCountMatrix(catalog, orders, (item) => item.results, columns);
    const hct = matrix.rows.find((row) => row.analysis === "Hematocrito");
    expect(hct?.counts).toEqual([0, 0, 0]);
    expect(hct?.total).toBe(0);
  });

  it("deja en cero el día sin órdenes", () => {
    const matrix = buildCountMatrix(catalog, orders, (item) => item.results, columns);
    expect(matrix.totals).toEqual([2, 0, 1]);
  });

  it("agrega los resultados ajenos al catálogo para que los totales cuadren", () => {
    const conArchivado = [...orders, order("3", "2026-08-11T09:00:00-05:00", "1990-01-01", [
      result("OLD-XYZ", "Análisis retirado", "Otros"),
    ])];
    const matrix = buildCountMatrix(catalog, conArchivado, (item) => item.results, columns);
    const extra = matrix.rows.find((row) => row.group === UNCATALOGUED_GROUP);
    expect(extra?.analysis).toBe("Análisis retirado");
    const totalResultados = conArchivado.reduce((sum, item) => sum + item.results.length, 0);
    expect(matrix.grandTotal).toBe(totalResultados);
  });

  it("mantiene el orden clínico del catálogo, no el alfabético", () => {
    const matrix = buildCountMatrix(catalog, [], (item) => item.results, columns);
    expect(matrix.rows.map((row) => row.analysis)).toEqual(["Hemoglobina", "Hematocrito", "Glucosa"]);
  });

  it("reparte por tramo de edad y separa a quien no tiene nacimiento", () => {
    const sinEdad = order("4", "2026-08-11T09:00:00-05:00", "", [result("BIO-GLU", "Glucosa", "Bioquímica")]);
    const matrix = buildCountMatrix(
      catalog,
      [...orders, sinEdad],
      (item) => item.results,
      ageColumns("at-analysis", new Date("2026-08-20T10:00:00-05:00")),
    );
    const porTramo = Object.fromEntries(matrix.columns.map((column, index) => [column.key, matrix.totals[index]]));
    expect(porTramo["60+"]).toBe(2);
    expect(porTramo["18-39"]).toBe(1);
    expect(porTramo["sin-edad"]).toBe(1);
    expect(matrix.grandTotal).toBe(4);
  });

  it("cuadra el total por día con el total por grupo etáreo", () => {
    const mismasOrdenes = [...orders, order("5", "2026-08-11T09:00:00-05:00", "", [
      result("HEM-HCT", "Hematocrito", "Hematología"),
    ])];
    const porDia = buildCountMatrix(catalog, mismasOrdenes, (item) => item.results, columns);
    const porEdad = buildCountMatrix(catalog, mismasOrdenes, (item) => item.results, ageColumns("at-analysis"));
    expect(porDia.grandTotal).toBe(porEdad.grandTotal);
    expect(porDia.grandTotal).toBe(mismasOrdenes.reduce((sum, item) => sum + item.results.length, 0));
  });

  it("cubre cada tramo del catálogo de tramos con una columna", () => {
    expect(ageColumns("at-analysis").map((column) => column.key))
      .toEqual([...AGE_BRACKETS.map((bracket) => bracket.id), "sin-edad"]);
  });
});

describe("hojas del libro", () => {
  const meta = { title: "T", period: "p", group: "g", note: "n" };
  const dias = dayColumns(new Date(2026, 7, 10), new Date(2026, 7, 11));
  const ordenes = [
    order("1", "2026-08-10T09:00:00-05:00", "1950-01-01", [
      result("HEM-HB", "Hemoglobina", "Hematología"),
      result("BIO-GLU", "Glucosa", "Bioquímica"),
    ]),
    order("2", "2026-08-11T09:00:00-05:00", "1990-01-01", [
      result("HEM-HB", "Hemoglobina", "Hematología"),
    ]),
  ];
  const matriz = buildCountMatrix(catalog, ordenes, (item) => item.results, dias);
  const cell = (sheet: { aoa: (string | number)[][] }, r: number, c: number) => sheet.aoa[r]?.[c];

  it("pone el mes combinado sobre sus días y el número de día debajo", () => {
    const hoja = countSheet(matriz, meta);
    expect(hoja.aoa[5].slice(2, 4)).toEqual(["agosto de 2026", "agosto de 2026"]);
    expect(hoja.aoa[6]).toEqual(["Grupo", "Análisis", "10", "11", "Total"]);
    expect(hoja.merges).toContainEqual({ s: { r: 5, c: 2 }, e: { r: 5, c: 3 } });
  });

  it("combina verticalmente el grupo que abarca varios análisis", () => {
    const hoja = countSheet(matriz, meta);
    // Hematología ocupa las dos primeras filas de datos (Hemoglobina y Hematocrito).
    expect(hoja.merges).toContainEqual({ s: { r: 7, c: 0 }, e: { r: 8, c: 0 } });
    expect(cell(hoja, 7, 0)).toBe("Hematología");
    expect(cell(hoja, 7, 1)).toBe("Hemoglobina");
  });

  it("transpone el corte etáreo: filas los tramos, columnas los análisis", () => {
    const porEdad = buildCountMatrix(catalog, ordenes, (item) => item.results, ageColumns("at-analysis"));
    const hoja = transposedCountSheet(porEdad, "Grupo etáreo", meta);
    expect(hoja.aoa[6]).toEqual(["Grupo etáreo", "Hemoglobina", "Hematocrito", "Glucosa", "Total"]);
    expect(hoja.aoa[5].slice(1, 3)).toEqual(["Hematología", "Hematología"]);
    expect(hoja.merges).toContainEqual({ s: { r: 5, c: 1 }, e: { r: 5, c: 2 } });
    const fila60 = hoja.aoa.find((row) => row[0] === "60 años a más");
    expect(fila60).toEqual(["60 años a más", 1, 0, 1, 2]);
  });

  it("da una fila por orden con el resultado bajo su análisis", () => {
    const columnas = matriz.rows.filter((row) => row.total > 0)
      .map(({ key, group, analysis }) => ({ key, group, analysis }));
    const hoja = detailSheet(columnas, ordenes, (item) => item.results,
      (r) => Number(r.value), () => "60 años y 2 meses", (value) => value.slice(0, 10), meta);
    expect(hoja.aoa[6]).toEqual(["Orden", "Fecha", "Paciente", "DNI", "Edad", "Hemoglobina", "Glucosa"]);
    expect(hoja.aoa[7]).toEqual(["ORD-1", "2026-08-10", "Paciente 1", "70000000", "60 años y 2 meses", 1, 1]);
    // La orden 2 no tiene glucosa: celda vacía, no cero.
    expect(hoja.aoa[8]).toEqual(["ORD-2", "2026-08-11", "Paciente 2", "70000000", "60 años y 2 meses", 1, ""]);
  });
});

describe("color por grupo", () => {
  it("reconoce el grupo con o sin tilde y sea cual sea la variante", () => {
    expect(groupColor("Hematologia")).toBe("FF0000");
    expect(groupColor("Hematología")).toBe("FF0000");
    expect(groupColor("Bioquimica")).toBe("0070C0");
    expect(groupColor("Inmunologia")).toBe("E26B0A");
    expect(groupColor("Uroanalisis")).toBe("FABF8F");
    expect(groupColor("Heces")).toBe("C4D79B");
    // "Gram y Cultivos" es como el laboratorio llama a microbiología.
    expect(groupColor("Microbiología")).toBe("B1A0C7");
    expect(groupColor("Gram y Cultivos")).toBe("B1A0C7");
  });

  it("cae al color de Otros cuando el grupo no está en la lista", () => {
    expect(groupColor("Secreción vaginal")).toBe(DEFAULT_GROUP_COLOR);
    expect(groupColor("")).toBe(DEFAULT_GROUP_COLOR);
  });

  it("atenúa el color hacia el blanco sin salirse del rango", () => {
    expect(tintedColor("FF0000")).toBe("FFC7C7");
    expect(tintedColor("FFFFFF")).toBe("FFFFFF");
    expect(tintedColor("000000", 0)).toBe("000000");
  });

  it("marca la celda del grupo en pleno y la del análisis atenuada", () => {
    const matriz = buildCountMatrix(catalog, [], () => [], dayColumns(new Date(2026, 7, 10), new Date(2026, 7, 11)));
    const hoja = countSheet(matriz, { title: "T", period: "p", group: "g", note: "n" });
    const grupo = hoja.tints.filter((tint) => tint.c === 0);
    const nombre = hoja.tints.filter((tint) => tint.c === 1);
    expect(grupo).toHaveLength(matriz.rows.length);
    expect(nombre).toHaveLength(matriz.rows.length);
    expect(grupo.every((tint) => tint.strong)).toBe(true);
    expect(nombre.every((tint) => !tint.strong)).toBe(true);
    // La primera fila de datos va justo debajo de la cabecera y la banda de meses.
    expect(grupo[0]).toEqual({ r: 7, c: 0, group: matriz.rows[0].group, strong: true });
  });
});
