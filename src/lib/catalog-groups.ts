import { canonicalGroupOrder } from "@/lib/catalog-order";
import type { AnalysisDefinition, CatalogGroup } from "@/lib/types";

type AnalysisGroupSource = Pick<AnalysisDefinition, "group" | "groupId">;

export type CatalogGroupOption = {
  id: string;
  name: string;
  persisted: boolean;
};

export function normalizeCatalogGroup(value: string) {
  return value.normalize("NFD").replace(/\p{Diacritic}/gu, "").trim().toLocaleUpperCase("es");
}

export function buildCatalogGroupOptions(analyses: AnalysisGroupSource[], catalogGroups: CatalogGroup[] = []) {
  const groups = new Map<string, CatalogGroupOption>();
  for (const group of catalogGroups.filter((item) => item.active).sort((left, right) => left.displayOrder - right.displayOrder)) {
    groups.set(normalizeCatalogGroup(group.name), { id: group.id, name: group.name, persisted: true });
  }
  for (const analysis of analyses) {
    const key = normalizeCatalogGroup(analysis.group);
    if (!key) continue;
    const current = groups.get(key);
    if (!current || (!current.persisted && analysis.groupId)) {
      groups.set(key, {
        id: analysis.groupId ?? `legacy:${key}`,
        name: analysis.group,
        persisted: Boolean(analysis.groupId),
      });
    }
  }
  return [...groups.values()].sort((left, right) =>
    canonicalGroupOrder(left.name) - canonicalGroupOrder(right.name)
    || left.name.localeCompare(right.name, "es"));
}

export function analysisBelongsToCatalogGroup(analysis: AnalysisGroupSource, group: CatalogGroupOption) {
  if (analysis.groupId && group.persisted) return analysis.groupId === group.id;
  return normalizeCatalogGroup(analysis.group) === normalizeCatalogGroup(group.name);
}

export function catalogSubsectionRenameRequest(input: {
  subsectionId: string;
  groupId: string;
  currentName: string;
  nextName: string;
}) {
  return input.subsectionId.startsWith("legacy:")
    ? {
        action: "subsection.renameLegacy",
        groupId: input.groupId,
        currentName: input.currentName,
        name: input.nextName,
      }
    : {
        action: "subsection.rename",
        subsectionId: input.subsectionId,
        name: input.nextName,
      };
}

export function catalogSubsectionDeleteRequest(input: {
  subsectionId: string;
  groupId: string;
  currentName: string;
}) {
  return input.subsectionId.startsWith("legacy:")
    ? {
        action: "subsection.deleteLegacy",
        groupId: input.groupId,
        currentName: input.currentName,
      }
    : {
        action: "subsection.delete",
        subsectionId: input.subsectionId,
      };
}
