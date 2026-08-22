import { describe, expect, it } from "vitest";
import { materializeCatalog, offlineAnalysisCode } from "./materialize-catalog";
import { buildCatalogGroupOptions } from "@/lib/catalog-groups";
import type { CatalogOperation } from "@/lib/catalog-operations";
import type { AnalysisDefinition, LabData } from "@/lib/types";

const GROUP = "11111111-1111-4111-8111-111111111111";
const SUB = "22222222-2222-4222-8222-222222222222";
const ANALYSIS = "33333333-3333-4333-8333-333333333333";

const analysis = (over: Partial<AnalysisDefinition> = {}): AnalysisDefinition => ({
  id: ANALYSIS, groupId: GROUP, versionId: "v1", code: "HEM-HB", name: "Hemoglobina",
  group: "Hematología", resultType: "numeric", unit: "g/dL", method: "", reference: "12 - 16",
  active: true, subsection: "Serie roja", pickerOrder: 10, ...over,
});

const base = (over: Partial<LabData> = {}): LabData => ({
  patients: [], orders: [], analysts: [], trend: [],
  summary: { orders: 0, analyses: 0, patients: 0, criticalValues: 0 },
  analyses: [analysis()],
  catalogGroups: [{ id: GROUP, name: "Hematología", displayOrder: 10, active: true }],
  catalogSubsections: [{ id: SUB, groupId: GROUP, group: "Hematología", name: "Serie roja", displayOrder: 10 }],
  ...over,
});

const apply = (data: LabData, operation: CatalogOperation) => materializeCatalog(data, operation);

describe("materializeCatalog", () => {
  it("crea el grupo con el id del equipo y lo pone al final", () => {
    const id = "44444444-4444-4444-8444-444444444444";
    const next = apply(base(), { action: "group.create", name: "Bioquímica", groupId: id });
    expect(next.catalogGroups).toHaveLength(2);
    expect(next.catalogGroups?.at(-1)).toMatchObject({ id, name: "Bioquímica", displayOrder: 20, active: true });
  });

  it("no duplica un grupo que ya existe (reenvío)", () => {
    const once = apply(base(), { action: "group.create", name: "Bioquímica", groupId: GROUP });
    expect(once.catalogGroups).toHaveLength(1);
  });

  it("al renombrar el grupo arrastra el nombre a análisis y subgrupos", () => {
    const next = apply(base(), { action: "group.rename", groupId: GROUP, name: "Hematología clínica" });
    expect(next.analyses[0].group).toBe("Hematología clínica");
    expect(next.catalogSubsections?.[0].group).toBe("Hematología clínica");
  });

  it("el renombrado llega a la lista de secciones sin duplicar la vieja", () => {
    const next = apply(base(), { action: "group.rename", groupId: GROUP, name: "Hematología clínica" });
    const options = buildCatalogGroupOptions(next.analyses.filter((item) => item.active), next.catalogGroups);
    expect(options.map((option) => option.name)).toEqual(["Hematología clínica"]);
    // El id no cambia: la pestaña abierta debe seguir abierta tras renombrar.
    expect(options[0].id).toBe(GROUP);
  });

  it("archivar el grupo desactiva también sus análisis", () => {
    const next = apply(base(), { action: "group.archive", groupId: GROUP });
    expect(next.catalogGroups?.[0].active).toBe(false);
    expect(next.analyses[0].active).toBe(false);
  });

  it("renombrar un subgrupo reetiqueta sus análisis sin distinguir mayúsculas", () => {
    const data = base({ analyses: [analysis({ subsection: "  SERIE ROJA " })] });
    const next = apply(data, { action: "subsection.rename", subsectionId: SUB, name: "Serie eritroide" });
    expect(next.catalogSubsections?.[0].name).toBe("Serie eritroide");
    expect(next.analyses[0].subsection).toBe("Serie eritroide");
  });

  it("borrar un subgrupo deja sus análisis en el grupo, sin subgrupo", () => {
    const next = apply(base(), { action: "subsection.delete", subsectionId: SUB });
    expect(next.catalogSubsections).toHaveLength(0);
    expect(next.analyses[0].subsection).toBeUndefined();
    expect(next.analyses[0].active).toBe(true);
  });

  it("el renombrado heredado crea la ficha que no existía", () => {
    const data = base({ catalogSubsections: [] });
    const next = apply(data, {
      action: "subsection.renameLegacy", groupId: GROUP, currentName: "Serie roja", name: "Serie eritroide",
    });
    expect(next.catalogSubsections).toHaveLength(1);
    expect(next.catalogSubsections?.[0]).toMatchObject({ groupId: GROUP, name: "Serie eritroide", displayOrder: 10 });
    expect(next.analyses[0].subsection).toBe("Serie eritroide");
  });

  it("reordenar subgrupos reescribe su posición", () => {
    const other = "55555555-5555-4555-8555-555555555555";
    const data = base({
      catalogSubsections: [
        { id: SUB, groupId: GROUP, group: "Hematología", name: "Serie roja", displayOrder: 10 },
        { id: other, groupId: GROUP, group: "Hematología", name: "Serie blanca", displayOrder: 20 },
      ],
    });
    const next = apply(data, { action: "subsection.reorder", groupId: GROUP, subsectionIds: [other, SUB] });
    expect(next.catalogSubsections?.find((section) => section.id === other)?.displayOrder).toBe(10);
    expect(next.catalogSubsections?.find((section) => section.id === SUB)?.displayOrder).toBe(20);
  });

  it("el layout fija orden y subgrupo, y el subgrupo vacío lo quita", () => {
    const next = apply(base(), {
      action: "layout.save", groupId: GROUP,
      items: [{ analysisId: ANALYSIS, subsection: null, displayOrder: 70 }],
    });
    expect(next.analyses[0]).toMatchObject({ pickerOrder: 70, subsection: undefined });
  });

  it("crea el análisis con el código que derivará la base del mismo id", () => {
    const id = "66666666-6666-4666-8666-666666666666";
    const version = "77777777-7777-4777-8777-777777777777";
    const next = apply(base(), {
      action: "analysis.save", analysisId: null, groupId: GROUP, subsection: "Serie roja",
      name: "Reticulocitos", resultType: "numeric", sampleType: "Sangre", method: "Manual",
      unit: "%", decimals: 1, qualitativeOptions: null,
      referenceRanges: [{ label: "0.5 - 2.5", low: 0.5, high: 2.5 }], criticalLimits: { low: 0.1 },
      newAnalysisId: id, newVersionId: version,
    });
    expect(next.analyses).toHaveLength(2);
    expect(next.analyses[1]).toMatchObject({
      id, versionId: version, code: "CUS-666666666666", name: "Reticulocitos",
      group: "Hematología", reference: "0.5 - 2.5", low: 0.5, high: 2.5, criticalLow: 0.1,
      subsection: "Serie roja", pickerOrder: 20, active: true,
    });
  });

  it("editar un análisis estrena versión clínica sin crear otra fila", () => {
    const version = "88888888-8888-4888-8888-888888888888";
    const next = apply(base(), {
      action: "analysis.save", analysisId: ANALYSIS, groupId: GROUP, subsection: null,
      name: "Hemoglobina corregida", resultType: "numeric", sampleType: "Sangre", method: "",
      unit: "g/dL", decimals: 2, qualitativeOptions: null,
      referenceRanges: [{ label: "13 - 17", low: 13, high: 17 }], criticalLimits: {},
      newVersionId: version,
    });
    expect(next.analyses).toHaveLength(1);
    expect(next.analyses[0]).toMatchObject({
      id: ANALYSIS, versionId: version, name: "Hemoglobina corregida", low: 13, high: 17, subsection: undefined,
    });
  });

  it("archivar un análisis lo desactiva sin borrarlo", () => {
    const next = apply(base(), { action: "analysis.archive", analysisId: ANALYSIS });
    expect(next.analyses[0].active).toBe(false);
  });

  it("no muta la réplica original", () => {
    const data = base();
    apply(data, { action: "analysis.archive", analysisId: ANALYSIS });
    expect(data.analyses[0].active).toBe(true);
  });

  it("el código offline coincide con el que deriva la base del id", () => {
    expect(offlineAnalysisCode("66666666-6666-4666-8666-666666666666")).toBe("CUS-666666666666");
  });
});
