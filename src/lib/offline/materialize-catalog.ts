import { numericLimits, referenceLabel } from "@/lib/clinical";
import type { CatalogOperation } from "@/lib/catalog-operations";
import type { AnalysisDefinition, CatalogGroup, CatalogSubsection, LabData } from "@/lib/types";

/**
 * Aplica una edición del catálogo a la réplica local, replicando lo que hacen
 * las RPC de `apply_catalog_operation`. Sin esto, un cambio hecho sin conexión
 * no se vería hasta sincronizar y el analista creería que no se guardó.
 *
 * Las funciones de la base comparan los nombres de subgrupo sin distinguir
 * mayúsculas ni espacios sobrantes; aquí se hace igual, porque si las dos
 * mitades no coinciden la pantalla y el servidor acabarían mostrando cosas
 * distintas para el mismo cambio.
 */
const key = (value: string | null | undefined) => (value ?? "").trim().toLocaleLowerCase("es");

/** Mismo código que deriva `save_catalog_analysis` del id del análisis. */
export function offlineAnalysisCode(analysisId: string) {
  return `CUS-${analysisId.replace(/-/g, "").slice(0, 12).toUpperCase()}`;
}

function groupNameOf(data: LabData, groupId: string) {
  return data.catalogGroups?.find((group) => group.id === groupId)?.name
    ?? data.analyses.find((analysis) => analysis.groupId === groupId)?.group
    ?? "Sin grupo";
}

/** Renombra el subgrupo en los análisis del grupo que lo tuvieran asignado. */
function retagAnalyses(data: LabData, groupId: string, from: string, to: string | undefined) {
  return data.analyses.map((analysis) => analysis.groupId === groupId && key(analysis.subsection) === key(from)
    ? { ...analysis, subsection: to }
    : analysis);
}

function nextOrder(values: number[]) {
  return values.length ? Math.max(...values) + 10 : 10;
}

export function materializeCatalog(data: LabData, operation: CatalogOperation): LabData {
  const groups: CatalogGroup[] = data.catalogGroups ?? [];
  const subsections: CatalogSubsection[] = data.catalogSubsections ?? [];

  switch (operation.action) {
    case "group.create": {
      if (!operation.groupId || groups.some((group) => group.id === operation.groupId)) return data;
      return {
        ...data,
        catalogGroups: [...groups, {
          id: operation.groupId,
          name: operation.name.trim(),
          displayOrder: nextOrder(groups.map((group) => group.displayOrder)),
          active: true,
        }],
      };
    }

    case "group.rename": {
      const name = operation.name.trim();
      return {
        ...data,
        catalogGroups: groups.map((group) => group.id === operation.groupId ? { ...group, name } : group),
        catalogSubsections: subsections.map((section) => section.groupId === operation.groupId ? { ...section, group: name } : section),
        // `AnalysisDefinition.group` guarda el nombre, no el id.
        analyses: data.analyses.map((analysis) => analysis.groupId === operation.groupId ? { ...analysis, group: name } : analysis),
      };
    }

    case "group.archive": {
      // archive_catalog_group desactiva también los análisis del grupo.
      return {
        ...data,
        catalogGroups: groups.map((group) => group.id === operation.groupId ? { ...group, active: false } : group),
        analyses: data.analyses.map((analysis) => analysis.groupId === operation.groupId ? { ...analysis, active: false } : analysis),
      };
    }

    case "subsection.create": {
      if (!operation.subsectionId || subsections.some((section) => section.id === operation.subsectionId)) return data;
      const inGroup = subsections.filter((section) => section.groupId === operation.groupId);
      return {
        ...data,
        catalogSubsections: [...subsections, {
          id: operation.subsectionId,
          groupId: operation.groupId,
          group: groupNameOf(data, operation.groupId),
          name: operation.name.trim(),
          displayOrder: nextOrder(inGroup.map((section) => section.displayOrder)),
        }],
      };
    }

    case "subsection.rename": {
      const current = subsections.find((section) => section.id === operation.subsectionId);
      if (!current) return data;
      const name = operation.name.trim();
      return {
        ...data,
        catalogSubsections: subsections.map((section) => section.id === current.id ? { ...section, name } : section),
        analyses: retagAnalyses(data, current.groupId, current.name, name),
      };
    }

    case "subsection.renameLegacy": {
      const name = operation.name.trim();
      const stored = subsections.find((section) =>
        section.groupId === operation.groupId && key(section.name) === key(operation.currentName));
      // Sin fila guardada, la base crea una con el orden del primer análisis.
      const created: CatalogSubsection[] = stored ? [] : [{
        id: crypto.randomUUID(),
        groupId: operation.groupId,
        group: groupNameOf(data, operation.groupId),
        name,
        displayOrder: Math.min(999, ...data.analyses
          .filter((analysis) => analysis.groupId === operation.groupId && key(analysis.subsection) === key(operation.currentName))
          .map((analysis) => analysis.pickerOrder ?? 999)),
      }];
      return {
        ...data,
        catalogSubsections: [
          ...subsections.map((section) => section.id === stored?.id ? { ...section, name } : section),
          ...created,
        ],
        analyses: retagAnalyses(data, operation.groupId, operation.currentName, name),
      };
    }

    case "subsection.delete": {
      const current = subsections.find((section) => section.id === operation.subsectionId);
      if (!current) return data;
      return {
        ...data,
        catalogSubsections: subsections.filter((section) => section.id !== current.id),
        // Los análisis se quedan en el grupo, sin subgrupo.
        analyses: retagAnalyses(data, current.groupId, current.name, undefined),
      };
    }

    case "subsection.deleteLegacy": {
      return {
        ...data,
        catalogSubsections: subsections.filter((section) =>
          !(section.groupId === operation.groupId && key(section.name) === key(operation.currentName))),
        analyses: retagAnalyses(data, operation.groupId, operation.currentName, undefined),
      };
    }

    case "subsection.reorder": {
      const position = new Map(operation.subsectionIds.map((id, index) => [id, (index + 1) * 10]));
      return {
        ...data,
        catalogSubsections: subsections.map((section) => position.has(section.id)
          ? { ...section, displayOrder: position.get(section.id)! }
          : section),
      };
    }

    case "layout.save": {
      const layout = new Map(operation.items.map((item) => [item.analysisId, item]));
      return {
        ...data,
        analyses: data.analyses.map((analysis) => {
          const item = layout.get(analysis.id);
          if (!item) return analysis;
          return { ...analysis, pickerOrder: item.displayOrder, subsection: item.subsection?.trim() || undefined };
        }),
      };
    }

    case "analysis.save": {
      const limits = numericLimits(operation.referenceRanges, operation.criticalLimits);
      const shared = {
        groupId: operation.groupId,
        group: groupNameOf(data, operation.groupId),
        name: operation.name.trim(),
        resultType: operation.resultType,
        unit: operation.resultType === "numeric" ? operation.unit?.trim() ?? "" : "",
        method: operation.method?.trim() ?? "",
        reference: referenceLabel(operation.referenceRanges),
        active: true,
        sampleType: operation.sampleType.trim(),
        decimals: operation.resultType === "numeric" ? operation.decimals ?? undefined : undefined,
        qualitativeOptions: operation.resultType === "qualitative" ? operation.qualitativeOptions ?? undefined : undefined,
        ...limits,
        subsection: operation.subsection?.trim() || undefined,
      };

      if (operation.analysisId) {
        return {
          ...data,
          analyses: data.analyses.map((analysis) => analysis.id === operation.analysisId
            // La edición abre una versión clínica nueva: los resultados que se
            // registren desde ahora deben apuntar a ella, no a la anterior.
            ? { ...analysis, ...shared, versionId: operation.newVersionId ?? analysis.versionId }
            : analysis),
        };
      }
      if (!operation.newAnalysisId || data.analyses.some((analysis) => analysis.id === operation.newAnalysisId)) return data;
      const created: AnalysisDefinition = {
        ...shared,
        id: operation.newAnalysisId,
        versionId: operation.newVersionId ?? "",
        code: offlineAnalysisCode(operation.newAnalysisId),
        common: true,
        pickerOrder: nextOrder(data.analyses
          .filter((analysis) => analysis.groupId === operation.groupId)
          .map((analysis) => analysis.pickerOrder ?? 0)),
      };
      return { ...data, analyses: [...data.analyses, created] };
    }

    case "analysis.archive": {
      return {
        ...data,
        analyses: data.analyses.map((analysis) => analysis.id === operation.analysisId
          ? { ...analysis, active: false }
          : analysis),
      };
    }
  }
}
