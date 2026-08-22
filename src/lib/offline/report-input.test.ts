import { describe, expect, it } from "vitest";
import { offlineReportResults } from "./report-input";
import { buildReportTableRows, sortReportResults } from "@/lib/report-pdf";
import type { AnalysisDefinition, CatalogGroup, ResultValue } from "@/lib/types";

const GROUP = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

// Orden real de HECES en el catálogo: el laboratorio movió «PARÁSITO SERIADO»
// al principio, así que debe imprimirse primero pese a ir alfabéticamente detrás.
const catalog: AnalysisDefinition[] = [
  ["NÚMERO DE MUESTRAS", "PARÁSITO SERIADO", 10],
  ["MÉTODO DE PROCESO", "PARÁSITO SERIADO", 20],
  ["COLOR", "Examen físico", 30],
  ["CONSISTENCIA", "Examen físico", 40],
  ["PH", "Examen químico", 70],
  ["PARASITOS", "Examen parasitológico", 170],
].map(([name, subsection, pickerOrder], index) => ({
  id: `a${index}`, groupId: GROUP, versionId: `v${index}`, code: `HEC-${index}`,
  name: name as string, group: "MICROBIOLOGIA", resultType: "qualitative",
  unit: "", method: "", reference: "", active: true,
  subsection: subsection as string, pickerOrder: pickerOrder as number,
}));

const groups: CatalogGroup[] = [{ id: GROUP, name: "MICROBIOLOGIA", displayOrder: 50, active: true }];

const result = (versionId: string, analyte: string): ResultValue => ({
  id: `r-${versionId}`, orderAnalysisId: `oa-${versionId}`, analysisVersionId: versionId,
  batchId: "b1", registeredAt: "2026-08-22T10:00:00-05:00", analyte, analysisCode: "HEC",
  group: "MICROBIOLOGIA", resultType: "qualitative", value: "Negativo", unit: "",
  reference: "", flag: "normal", method: "", performedBy: "Analista",
});

// Capturados en desorden a propósito: así se registran en la práctica.
const captured = [
  result("v2", "COLOR"),
  result("v5", "PARASITOS"),
  result("v0", "NÚMERO DE MUESTRAS"),
  result("v4", "PH"),
  result("v1", "MÉTODO DE PROCESO"),
  result("v3", "CONSISTENCIA"),
];

describe("offlineReportResults", () => {
  it("toma del catálogo el orden del análisis y del grupo", () => {
    const rows = offlineReportResults(captured, catalog, groups);
    expect(rows.map((row) => row.analysisOrder)).toEqual([30, 170, 10, 70, 20, 40]);
    expect(new Set(rows.map((row) => row.groupOrder))).toEqual(new Set([50]));
  });

  it("arrastra el subgrupo, que es lo que titula cada bloque", () => {
    const rows = offlineReportResults(captured, catalog, groups);
    expect(rows.find((row) => row.analysis === "COLOR")?.subsection).toBe("Examen físico");
  });

  it("un resultado sin ficha en el catálogo no rompe el resto", () => {
    const rows = offlineReportResults([result("desconocida", "ANTIGUO")], catalog, groups);
    expect(rows[0]).toMatchObject({ analysis: "ANTIGUO", analysisOrder: undefined, subsection: undefined });
  });
});

describe("el informe respeta el orden del catálogo", () => {
  it("imprime los subgrupos como quedaron ordenados, no alfabéticamente", () => {
    const rows = buildReportTableRows(sortReportResults(offlineReportResults(captured, catalog, groups)));
    expect(rows.filter((row) => row.kind === "section").map((row) => row.label)).toEqual([
      "PARÁSITO SERIADO", "EXAMEN FÍSICO", "EXAMEN QUÍMICO", "EXAMEN PARASITOLÓGICO",
    ]);
  });

  it("sin el orden del catálogo caería en alfabético, que es el fallo que había", () => {
    const sinOrden = offlineReportResults(captured, catalog, groups)
      .map(({ analysisOrder, groupOrder, ...row }) => { void analysisOrder; void groupOrder; return row; });
    const labels = buildReportTableRows(sortReportResults(sinOrden))
      .filter((row) => row.kind === "section").map((row) => row.label);
    expect(labels[0]).not.toBe("PARÁSITO SERIADO");
  });
});
