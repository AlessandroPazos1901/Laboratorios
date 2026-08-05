import { describe, expect, it } from "vitest";
import { compareCatalogEntries } from "./catalog-order";

describe("canonical catalog order", () => {
  it("ordena un subconjunto de hematología según el catálogo, no alfabéticamente", () => {
    const rows = [
      { group: "HEMATOLOGÍA", analysis: "PLAQUETAS" },
      { group: "HEMATOLOGÍA", analysis: "EOSINOFILOS" },
      { group: "HEMATOLOGÍA", analysis: "HEMOGLOBINA" },
    ];
    expect(rows.sort(compareCatalogEntries).map((row) => row.analysis)).toEqual([
      "HEMOGLOBINA", "EOSINOFILOS", "PLAQUETAS",
    ]);
  });

  it("respeta el orden de los grupos", () => {
    const rows = [
      { group: "OTROS", analysis: "GOTA GRUESA" },
      { group: "BIOQUÍMICA", analysis: "GLUCOSA" },
      { group: "HEMATOLOGÍA", analysis: "HEMOGLOBINA" },
    ];
    expect(rows.sort(compareCatalogEntries).map((row) => row.group)).toEqual([
      "HEMATOLOGÍA", "BIOQUÍMICA", "OTROS",
    ]);
  });
});
