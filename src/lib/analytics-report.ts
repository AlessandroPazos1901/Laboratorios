import { buildPickerGroups } from "@/lib/catalog-presets";
import { birthMoment, calculateAgeAt, formatPatientAgeAt } from "@/lib/clinical";
import type { AnalysisDefinition, LabOrder, ResultValue } from "@/lib/types";

// La edad al analizar responde "cuántos análisis se hicieron a mayores de 60";
// la actual, "cuántos acumulan mis pacientes que hoy son mayores de 60".
export type AgeBasis = "at-analysis" | "current";

export type AgeBracket = { id: string; label: string; minYears: number; maxYears?: number };

export const AGE_BRACKETS: AgeBracket[] = [
  { id: "1-11", label: "0 a 11 años", minYears: 0, maxYears: 11 },
  { id: "12-17", label: "12 a 17 años", minYears: 12, maxYears: 17 },
  { id: "18-39", label: "18 a 29 años", minYears: 18, maxYears: 29 },
  { id: "40-59", label: "30 a 59 años", minYears: 30, maxYears: 59 },
  { id: "60+", label: "60 años a más", minYears: 60 },
];

export const UNCATALOGUED_GROUP = "Fuera del catálogo vigente";
export const UNKNOWN_AGE_LABEL = "Sin edad registrada";

export function patientYears(order: LabOrder, basis: AgeBasis, now = new Date()): number | null {
  if (!order.patientBirthDate) return null;
  const reference = basis === "current" ? now.toISOString() : order.createdAt;
  const { years } = calculateAgeAt(order.patientBirthDate, reference);
  return Number.isFinite(years) ? years : null;
}

/**
 * Edad legible para la hoja de detalle. Un entero de años convierte a todo
 * recién nacido en «0»; esto reparte la escala: días hasta el mes, meses hasta
 * el año, y años con meses a partir de ahí.
 */
export function patientAgeLabel(order: LabOrder, basis: AgeBasis, now = new Date()) {
  if (!order.patientBirthDate) return "Sin registrar";
  const reference = basis === "current" ? now.toISOString() : order.createdAt;
  return formatPatientAgeAt(birthMoment(order.patientBirthDate, order.patientBirthTime), reference);
}

// Sin fecha de nacimiento no se entra en ningún tramo acotado: antes dejar fuera
// al paciente que atribuirle una edad que nadie registró.
export function matchesAgeRange(years: number | null, min?: number, max?: number) {
  if (min === undefined && max === undefined) return true;
  if (years === null) return false;
  return (min === undefined || years >= min) && (max === undefined || years <= max);
}

export function bracketFor(years: number | null) {
  if (years === null) return null;
  return AGE_BRACKETS.find((bracket) => matchesAgeRange(years, bracket.minYears, bracket.maxYears)) ?? null;
}

export function bracketById(id: string) {
  return AGE_BRACKETS.find((bracket) => bracket.id === id) ?? null;
}

const normalizeKey = (value: string) => value
  .normalize("NFD")
  .replace(/\p{Diacritic}/gu, "")
  .toUpperCase()
  .replace(/[^A-Z0-9]+/g, " ")
  .trim();

// Los resultados históricos llegan sin código, así que el nombre es el respaldo.
export function analysisKey(entry: { analysisCode?: string; code?: string; analyte?: string; name?: string }) {
  const code = entry.analysisCode ?? entry.code ?? "";
  if (code.trim()) return `C:${normalizeKey(code)}`;
  return `N:${normalizeKey(entry.analyte ?? entry.name ?? "")}`;
}

export type CountColumn = {
  key: string;
  label: string;
  /** Encabezado superior que agrupa columnas contiguas: el mes, para los días. */
  band?: string;
  /** Los resultados de esta orden cuentan en la columna. */
  matches: (order: LabOrder, result: ResultValue) => boolean;
};

export type CountRow = { key: string; group: string; analysis: string; counts: number[]; total: number };

export type CountMatrix = { columns: CountColumn[]; rows: CountRow[]; totals: number[]; grandTotal: number };

/**
 * Filas: todos los análisis vigentes del catálogo en su orden clínico, incluidos
 * los que dan cero. Los resultados que no cruzan con ninguno se agregan al final
 * para que la suma de columnas siga igualando el volumen real.
 */
export function buildCountMatrix(
  analyses: AnalysisDefinition[],
  orders: LabOrder[],
  resultsOf: (order: LabOrder) => ResultValue[],
  columns: CountColumn[],
): CountMatrix {
  const rows: CountRow[] = [];
  const rowByKey = new Map<string, CountRow>();

  const addRow = (key: string, group: string, analysis: string) => {
    const row: CountRow = { key, group, analysis, counts: columns.map(() => 0), total: 0 };
    rows.push(row);
    rowByKey.set(key, row);
    return row;
  };

  buildPickerGroups(analyses).forEach((picker) => {
    picker.items.forEach((analysis) => {
      const key = analysisKey(analysis);
      if (!rowByKey.has(key)) addRow(key, picker.group, analysis.name);
    });
  });

  orders.forEach((order) => {
    resultsOf(order).forEach((result) => {
      const key = analysisKey(result);
      const row = rowByKey.get(key)
        ?? addRow(key, UNCATALOGUED_GROUP, result.analyte || "Análisis sin nombre");
      columns.forEach((column, index) => {
        if (!column.matches(order, result)) return;
        row.counts[index] += 1;
        row.total += 1;
      });
    });
  });

  const totals = columns.map((_, index) => rows.reduce((sum, row) => sum + row.counts[index], 0));
  return { columns, rows, totals, grandTotal: totals.reduce((sum, value) => sum + value, 0) };
}

const dayKey = (value: string) => {
  const date = new Date(value);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
};

const monthLabel = (date: Date) => new Intl.DateTimeFormat("es-PE", { month: "long", year: "numeric" }).format(date);

// La columna se rotula con el número de día; el mes va en la banda superior,
// que es lo que evita la ambigüedad cuando el periodo cruza de un mes a otro.
export function dayColumns(from: Date, to: Date): CountColumn[] {
  const columns: CountColumn[] = [];
  const cursor = new Date(from.getFullYear(), from.getMonth(), from.getDate());
  const last = new Date(to.getFullYear(), to.getMonth(), to.getDate());
  while (cursor.getTime() <= last.getTime() && columns.length < 400) {
    const key = dayKey(cursor.toISOString());
    columns.push({
      key,
      label: String(cursor.getDate()),
      band: monthLabel(cursor),
      matches: (order) => dayKey(order.createdAt) === key,
    });
    cursor.setDate(cursor.getDate() + 1);
  }
  return columns;
}

export function ageColumns(basis: AgeBasis, now = new Date()): CountColumn[] {
  return [
    ...AGE_BRACKETS.map((bracket) => ({
      key: bracket.id,
      label: bracket.label,
      matches: (order: LabOrder) => bracketFor(patientYears(order, basis, now))?.id === bracket.id,
    })),
    {
      key: "sin-edad",
      label: UNKNOWN_AGE_LABEL,
      matches: (order: LabOrder) => patientYears(order, basis, now) === null,
    },
  ];
}

export type SheetCell = string | number;
export type SheetMerge = { s: { r: number; c: number }; e: { r: number; c: number } };
/** Celda que rotula un grupo clínico y por tanto se pinta con su color. */
export type SheetTint = { r: number; c: number; group: string; strong: boolean };
export type SheetData = { aoa: SheetCell[][]; merges: SheetMerge[]; tints: SheetTint[] };
export type SheetMeta = { title: string; period: string; group: string; note: string };

const GROUP_COLORS: [RegExp, string][] = [
  [/HEMATOLOG/, "FF0000"],
  [/BIOQUIM/, "0070C0"],
  [/INMUNOLOG/, "E26B0A"],
  [/UROANALISIS|ORINA/, "FABF8F"],
  [/HECES|COPRO/, "C4D79B"],
  [/GRAM|CULTIVO|MICROBIOLOG/, "B1A0C7"],
];
export const DEFAULT_GROUP_COLOR = "0070C0";

/** Color ARGB del grupo, tolerante a tildes y variantes de escritura. */
export function groupColor(group: string) {
  const key = normalizeKey(group);
  return GROUP_COLORS.find(([pattern]) => pattern.test(key))?.[1] ?? DEFAULT_GROUP_COLOR;
}

/** Mezcla el color con blanco: el nombre del análisis lleva un tono suave del grupo. */
export function tintedColor(hex: string, whiteRatio = 0.78) {
  const blend = (offset: number) => {
    const channel = parseInt(hex.slice(offset, offset + 2), 16);
    return Math.round(channel + (255 - channel) * whiteRatio).toString(16).padStart(2, "0");
  };
  return `${blend(0)}${blend(2)}${blend(4)}`.toUpperCase();
}

const headingRows = (meta: SheetMeta): SheetCell[][] => [
  [meta.title],
  [`Periodo: ${meta.period}`],
  [`Grupo: ${meta.group}`],
  [meta.note],
  [],
];
const HEADING_HEIGHT = 5;

/** Combina las celdas contiguas que repiten la misma etiqueta. */
function spanMerges(labels: (string | undefined)[], row: number, firstColumn: number, vertical = false): SheetMerge[] {
  const merges: SheetMerge[] = [];
  let start = 0;
  for (let index = 1; index <= labels.length; index += 1) {
    if (index < labels.length && labels[index] === labels[start]) continue;
    if (labels[start] !== undefined && index - start > 1) {
      merges.push(vertical
        ? { s: { r: row + start, c: firstColumn }, e: { r: row + index - 1, c: firstColumn } }
        : { s: { r: row, c: firstColumn + start }, e: { r: row, c: firstColumn + index - 1 } });
    }
    start = index;
  }
  return merges;
}

/** Filas = análisis del catálogo; columnas = días, con el mes combinado encima. */
export function countSheet(matrix: CountMatrix, meta: SheetMeta): SheetData {
  const hasBands = matrix.columns.some((column) => column.band);
  const bandRow: SheetCell[][] = hasBands
    ? [["", "", ...matrix.columns.map((column) => column.band ?? ""), ""]]
    : [];
  const headerRow = HEADING_HEIGHT + bandRow.length;
  const aoa: SheetCell[][] = [
    ...headingRows(meta),
    ...bandRow,
    ["Grupo", "Análisis", ...matrix.columns.map((column) => column.label), "Total"],
    ...matrix.rows.map((row) => [row.group, row.analysis, ...row.counts, row.total]),
    ["", "Total", ...matrix.totals, matrix.grandTotal],
  ];
  return {
    aoa,
    merges: [
      ...(hasBands ? spanMerges(matrix.columns.map((column) => column.band), HEADING_HEIGHT, 2) : []),
      ...spanMerges(matrix.rows.map((row) => row.group), headerRow + 1, 0, true),
    ],
    // Columna A con el color pleno del grupo; columna B, el nombre del análisis, atenuada.
    tints: matrix.rows.flatMap((row, index) => [
      { r: headerRow + 1 + index, c: 0, group: row.group, strong: true },
      { r: headerRow + 1 + index, c: 1, group: row.group, strong: false },
    ]),
  };
}

/** Transpuesta: filas = tramos de edad; columnas = grupo y análisis. */
export function transposedCountSheet(matrix: CountMatrix, rowHeader: string, meta: SheetMeta): SheetData {
  const aoa: SheetCell[][] = [
    ...headingRows(meta),
    ["", ...matrix.rows.map((row) => row.group), ""],
    [rowHeader, ...matrix.rows.map((row) => row.analysis), "Total"],
    ...matrix.columns.map((column, index) => [
      column.label,
      ...matrix.rows.map((row) => row.counts[index]),
      matrix.totals[index],
    ]),
    ["Total", ...matrix.rows.map((row) => row.total), matrix.grandTotal],
  ];
  return {
    aoa,
    merges: spanMerges(matrix.rows.map((row) => row.group), HEADING_HEIGHT, 1),
    tints: matrix.rows.flatMap((row, index) => [
      { r: HEADING_HEIGHT, c: 1 + index, group: row.group, strong: true },
      { r: HEADING_HEIGHT + 1, c: 1 + index, group: row.group, strong: false },
    ]),
  };
}

export type DetailColumn = { key: string; group: string; analysis: string };

/** Filas = una orden; columnas = datos del paciente y cada análisis realizado. */
export function detailSheet(
  columns: DetailColumn[],
  orders: LabOrder[],
  resultsOf: (order: LabOrder) => ResultValue[],
  cellOf: (result: ResultValue) => SheetCell,
  ageOf: (order: LabOrder) => SheetCell,
  formatDate: (value: string) => string,
  meta: SheetMeta,
): SheetData {
  const fixed = ["Orden", "Fecha", "Paciente", "DNI", "Edad"];
  const rows = [...orders]
    .sort((left, right) => left.createdAt.localeCompare(right.createdAt))
    .map((order) => {
      const byKey = new Map<string, ResultValue>();
      // Una orden es de un día; si un análisis se repite, vale el último registrado.
      resultsOf(order).forEach((result) => byKey.set(analysisKey(result), result));
      return [
        order.code, formatDate(order.createdAt), order.patientName, order.documentNumber, ageOf(order),
        ...columns.map((column) => {
          const result = byKey.get(column.key);
          return result ? cellOf(result) : "";
        }),
      ];
    });
  return {
    aoa: [
      ...headingRows(meta),
      [...fixed.map(() => ""), ...columns.map((column) => column.group)],
      [...fixed, ...columns.map((column) => column.analysis)],
      ...rows,
    ],
    merges: spanMerges(columns.map((column) => column.group), HEADING_HEIGHT, fixed.length),
    tints: columns.flatMap((column, index) => [
      { r: HEADING_HEIGHT, c: fixed.length + index, group: column.group, strong: true },
      { r: HEADING_HEIGHT + 1, c: fixed.length + index, group: column.group, strong: false },
    ]),
  };
}
