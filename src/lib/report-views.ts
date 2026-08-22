import { normalizeLabel, resultSubsection, type ResultPresentationItem } from "@/lib/result-presentation";

/**
 * Una misma sección del catálogo se informa de varias formas según el examen
 * pedido. De HECES salen cuatro informes distintos con los mismos análisis
 * detrás, así que en vez de duplicar el catálogo se define qué subgrupos entran
 * en cada uno.
 *
 * La vista es un atajo, no una regla: marca los análisis que le corresponden y
 * el analista ajusta con las casillas lo que sobre o falte en ese paciente.
 */
export type ReportView = {
  id: string;
  /** Nombre en el botón, y por defecto también el título impreso. */
  label: string;
  /**
   * No imprimir el título. Se usa cuando el nombre de la vista coincide con el
   * de un subgrupo que ya se imprime: repetirlo dos veces seguidas no aporta.
   */
  omitPrintedTitle?: boolean;
  /** Subgrupos que entran. Excluyente con `except`. */
  subsections?: string[];
  /** Entra todo el grupo salvo estos subgrupos. */
  except?: string[];
};

// Claves y subgrupos normalizados (sin tildes, en mayúsculas).
const VIEWS: Record<string, ReportView[]> = {
  MICROBIOLOGIA: [
    {
      id: "parasito-seriado",
      label: "PARÁSITO SERIADO",
      // El subgrupo homónimo ya encabeza el bloque.
      omitPrintedTitle: true,
      subsections: ["PARASITO SERIADO", "EXAMEN FISICO", "EXAMEN PARASITOLOGICO"],
    },
    {
      id: "reaccion-inflamatoria",
      label: "REACCIÓN INFLAMATORIA",
      subsections: ["EXAMEN FISICO", "EXAMEN QUIMICO", "EXAMEN MICROSCOPICO", "EXAMEN PARASITOLOGICO"],
    },
    {
      id: "parasito-directo",
      label: "PARÁSITO DIRECTO",
      subsections: ["EXAMEN FISICO", "EXAMEN PARASITOLOGICO"],
    },
    {
      id: "coprofuncional",
      label: "COPROFUNCIONAL",
      except: ["EXAMEN MICROSCOPICO"],
    },
  ],
};

/** Título que llevará el informe, o nada si la vista no debe titularse. */
export function printedTitleFor(view: ReportView | null) {
  return view && !view.omitPrintedTitle ? view.label : undefined;
}

export function reportViewsForGroup(group: string): ReportView[] {
  return VIEWS[normalizeLabel(group)] ?? [];
}

export function viewIncludes(view: ReportView, result: ResultPresentationItem) {
  const subsection = normalizeLabel(resultSubsection(result) ?? "");
  // `except` deja pasar lo que no tiene subgrupo; `subsections` no, porque
  // enumera exactamente lo que debe salir.
  if (view.except) return !view.except.includes(subsection);
  return Boolean(view.subsections?.includes(subsection));
}

export function resultsInView<T extends ResultPresentationItem>(view: ReportView, results: T[]) {
  return results.filter((result) => viewIncludes(view, result));
}
