import { describe, expect, it } from "vitest";
import { analysisBelongsToCatalogGroup, buildCatalogGroupOptions, catalogSubsectionDeleteRequest, catalogSubsectionRenameRequest } from "@/lib/catalog-groups";

describe("catalog groups", () => {
  it("keeps showing groups from snapshots created before groupId existed", () => {
    const analyses = [
      { group: "HEMATOLOGÍA" },
      { group: "HEMATOLOGÍA" },
      { group: "BIOQUÍMICA" },
    ];

    const groups = buildCatalogGroupOptions(analyses);

    expect(groups.map(({ name }) => name)).toEqual(["HEMATOLOGÍA", "BIOQUÍMICA"]);
    expect(groups.every(({ persisted }) => !persisted)).toBe(true);
    expect(analysisBelongsToCatalogGroup(analyses[0], groups[0])).toBe(true);
  });

  it("uses the database identifier as soon as the current data is available", () => {
    const analyses = [
      { group: "BIOQUÍMICA" },
      { group: "Bioquímica", groupId: "7d2a0be5-a9bc-4d9f-857b-8d68ad4f5834" },
    ];

    const [group] = buildCatalogGroupOptions(analyses);

    expect(group).toMatchObject({ id: analyses[1].groupId, persisted: true });
    expect(analysisBelongsToCatalogGroup(analyses[0], group)).toBe(true);
  });

  it("shows a newly created section before it has analyses", () => {
    expect(buildCatalogGroupOptions([], [{
      id: "7d2a0be5-a9bc-4d9f-857b-8d68ad4f5834",
      name: "MICROBIOLOGÍA",
      displayOrder: 70,
      active: true,
    }])).toEqual([{
      id: "7d2a0be5-a9bc-4d9f-857b-8d68ad4f5834",
      name: "MICROBIOLOGÍA",
      persisted: true,
    }]);
  });

  it("renames old subsections through their group and current name", () => {
    expect(catalogSubsectionRenameRequest({
      subsectionId: "legacy:group:Examen físico",
      groupId: "7d2a0be5-a9bc-4d9f-857b-8d68ad4f5834",
      currentName: "Examen físico",
      nextName: "Examen macroscópico",
    })).toEqual({
      action: "subsection.renameLegacy",
      groupId: "7d2a0be5-a9bc-4d9f-857b-8d68ad4f5834",
      currentName: "Examen físico",
      name: "Examen macroscópico",
    });
  });

  it("deletes old subsections without deleting their analyses", () => {
    expect(catalogSubsectionDeleteRequest({
      subsectionId: "legacy:group:Examen químico",
      groupId: "7d2a0be5-a9bc-4d9f-857b-8d68ad4f5834",
      currentName: "Examen químico",
    })).toEqual({
      action: "subsection.deleteLegacy",
      groupId: "7d2a0be5-a9bc-4d9f-857b-8d68ad4f5834",
      currentName: "Examen químico",
    });
  });

  it("deletes an empty stored subsection through its database identifier", () => {
    expect(catalogSubsectionDeleteRequest({
      subsectionId: "5fd03b63-a31d-4a24-8bd8-f6d49dfb795d",
      groupId: "7d2a0be5-a9bc-4d9f-857b-8d68ad4f5834",
      currentName: "Examen fisico",
    })).toEqual({
      action: "subsection.delete",
      subsectionId: "5fd03b63-a31d-4a24-8bd8-f6d49dfb795d",
    });
  });
});
