import { describe, expect, it } from "vitest";
import { reportViewsForGroup, resultsInView } from "./report-views";
import { buildReportTableRows } from "./report-pdf";

const result = (analysis: string, subsection?: string) => ({
  group: "MICROBIOLOGIA", analysis, subsection, analysisCode: undefined,
});

// La tanda completa de HECES tal como está hoy en el catálogo.
const heces = [
  result("NÚMERO DE MUESTRAS", "PARÁSITO SERIADO"),
  result("MÉTODO DE PROCESO", "PARÁSITO SERIADO"),
  result("COLOR", "Examen físico"),
  result("CONSISTENCIA", "Examen físico"),
  result("MOCO", "Examen físico"),
  result("PH", "Examen químico"),
  result("THEVENON", "Examen químico"),
  result("LEUCOCITOS", "Examen microscópico"),
  result("HEMATÍES", "Examen microscópico"),
  result("PARASITOS", "Examen parasitológico"),
  result("RX INFLAMATORIA"),
];

const names = (subset: typeof heces) => subset.map((item) => item.analysis);
const view = (id: string) => reportViewsForGroup("MICROBIOLOGIA").find((item) => item.id === id)!;

describe("vistas de impresión", () => {
  it("solo el grupo de heces tiene vistas", () => {
    expect(reportViewsForGroup("MICROBIOLOGIA")).toHaveLength(4);
    expect(reportViewsForGroup("HEMATOLOGÍA")).toEqual([]);
    expect(reportViewsForGroup("UROANÁLISIS")).toEqual([]);
  });

  it("parásito seriado toma muestras, físico y parasitológico", () => {
    expect(names(resultsInView(view("parasito-seriado"), heces))).toEqual([
      "NÚMERO DE MUESTRAS", "MÉTODO DE PROCESO", "COLOR", "CONSISTENCIA", "MOCO", "PARASITOS",
    ]);
  });

  it("reacción inflamatoria toma físico, químico, microscópico y parasitológico", () => {
    expect(names(resultsInView(view("reaccion-inflamatoria"), heces))).toEqual([
      "COLOR", "CONSISTENCIA", "MOCO", "PH", "THEVENON", "LEUCOCITOS", "HEMATÍES", "PARASITOS",
    ]);
  });

  it("parásito directo se queda en físico y parasitológico", () => {
    expect(names(resultsInView(view("parasito-directo"), heces))).toEqual([
      "COLOR", "CONSISTENCIA", "MOCO", "PARASITOS",
    ]);
  });

  it("coprofuncional es todo menos el microscópico", () => {
    const included = names(resultsInView(view("coprofuncional"), heces));
    expect(included).not.toContain("LEUCOCITOS");
    expect(included).not.toContain("HEMATÍES");
    // Al ser una exclusión, arrastra también lo que no tiene subgrupo.
    expect(included).toContain("RX INFLAMATORIA");
    expect(included).toHaveLength(9);
  });

  it("un análisis sin subgrupo no entra en las vistas que enumeran subgrupos", () => {
    for (const id of ["parasito-seriado", "reaccion-inflamatoria", "parasito-directo"]) {
      expect(names(resultsInView(view(id), heces))).not.toContain("RX INFLAMATORIA");
    }
  });

  it("el subgrupo se compara sin tildes ni mayúsculas", () => {
    const mixed = [result("COLOR", "  examen FISICO ")];
    expect(resultsInView(view("parasito-directo"), mixed)).toHaveLength(1);
  });
});

describe("título de la vista en el informe", () => {
  const printable = (analysis: string, subsection?: string) => ({
    ...result(analysis, subsection), value: "1", unit: "", reference: "", flag: "normal",
  });

  it("encabeza el informe con el nombre de la vista", () => {
    const rows = buildReportTableRows(
      [printable("COLOR", "Examen físico"), printable("PARASITOS", "Examen parasitológico")],
      "PARÁSITO SERIADO",
    );
    expect(rows[0]).toEqual({ kind: "title", label: "PARÁSITO SERIADO" });
    expect(rows.filter((row) => row.kind === "section").map((row) => row.label))
      .toEqual(["EXAMEN FÍSICO", "EXAMEN PARASITOLÓGICO"]);
  });

  it("sin vista no agrega título", () => {
    const rows = buildReportTableRows([printable("COLOR", "Examen físico")]);
    expect(rows[0]).toEqual({ kind: "section", label: "EXAMEN FÍSICO" });
  });

  it("el título de la vista no desplaza al de uroanálisis cuando no hay vista", () => {
    const rows = buildReportTableRows([{ ...printable("COLOR", "Examen físico"), group: "UROANÁLISIS" }]);
    expect(rows[0]).toEqual({ kind: "title", label: "EXAMEN COMPLETO DE ORINA" });
  });
});
