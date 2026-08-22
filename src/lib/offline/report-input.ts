import type { LabReportResult } from "@/lib/report-pdf";
import type { AnalysisDefinition, CatalogGroup, ResultValue } from "@/lib/types";

/**
 * Convierte los resultados guardados en las filas que imprime el PDF.
 *
 * Lo importante aquí es el orden. `buildLabReportPdf` ordena por `groupOrder` y
 * `analysisOrder`, y cuando faltan recurre a una tabla fija que solo conoce los
 * grupos originales del laboratorio: cualquier grupo o análisis posterior caía
 * en 999 y terminaba ordenado alfabéticamente, ignorando el orden que el
 * laboratorio hubiera fijado en el Catálogo. Por eso ambos se toman siempre del
 * catálogo vigente.
 */
export function offlineReportResults(
  results: ResultValue[],
  analyses: AnalysisDefinition[],
  catalogGroups: CatalogGroup[] = [],
): LabReportResult[] {
  const analysisByVersion = new Map(analyses.map((analysis) => [analysis.versionId, analysis]));
  const orderByGroupId = new Map(catalogGroups.map((group) => [group.id, group.displayOrder]));

  return results.map((result) => {
    const definition = result.analysisVersionId
      ? analysisByVersion.get(result.analysisVersionId)
      : undefined;
    return {
      group: result.group,
      analysisCode: result.analysisCode,
      analysis: result.analyte,
      subsection: definition?.subsection,
      value: result.value,
      unit: result.unit,
      reference: result.reference,
      flag: result.flag,
      groupOrder: definition?.groupId ? orderByGroupId.get(definition.groupId) : undefined,
      analysisOrder: definition?.pickerOrder,
    };
  });
}
