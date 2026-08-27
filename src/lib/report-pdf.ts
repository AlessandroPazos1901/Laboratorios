import {
  appendBezierCurve, closePath, lineTo, moveTo, PDFDocument, PDFFont, PDFPage,
  popGraphicsState, pushGraphicsState, setLineWidth, setStrokingColor, StandardFonts, stroke, rgb,
} from "pdf-lib";
import { canonicalAnalysisOrder, canonicalGroupOrder } from "@/lib/catalog-order";
import { formatNumericResult } from "@/lib/clinical";
import {
  buildResultPresentationRows, formatDisplayReference, formatDisplayUnit, type ResultPresentationRow,
} from "@/lib/result-presentation";

/**
 * Tamaños de hoja en puntos. El PDF se emite en el tamaño real del papel: si se
 * emitiera siempre en Carta, el visor encogería la hoja para que cupiera en A5
 * (al 68%) y el cuerpo de 8.5pt terminaría en 5.8pt, ilegible.
 */
export const REPORT_PAGE_SIZES = {
  a5: [419.53, 595.28],
  carta: [612, 792],
  a4: [595.28, 841.89],
} as const;
export type ReportPageSize = keyof typeof REPORT_PAGE_SIZES;
export const DEFAULT_REPORT_PAGE_SIZE: ReportPageSize = "carta";

export function isReportPageSize(value: unknown): value is ReportPageSize {
  return typeof value === "string" && value in REPORT_PAGE_SIZES;
}

const INK = rgb(0.08, 0.16, 0.25);
const MUTED = rgb(0.37, 0.43, 0.48);
const CRITICAL = rgb(0.70, 0.14, 0.17);
const TABLE_HEADER = rgb(0.84, 0.84, 0.84);
const GROUP_HEADER = rgb(0.90, 0.95, 0.95);
const SECTION_HEADER = rgb(0.94, 0.96, 0.96);
// Métrica compacta: un informe corriente debe caber en una sola hoja Carta.
// Los tamaños de letra NO dependen de la hoja: un punto es un punto en cualquier
// papel. Lo que se adapta es la geometría (márgenes, columnas, membrete).
const ROW_LINE = 9;
const ROW_MIN = 16;
const TITLE_HEIGHT = 18;
const COLUMN_HEIGHT = 15;
const HEADER_HEIGHT = TITLE_HEIGHT + COLUMN_HEIGHT;
const LOGO_MAX_HEIGHT = 64;
const LOGO_GAP = 24;
const GROUP_GAP = 8;
/** Pie de página. Legible para el paciente, no solo para el laboratorio. */
const FOOTER_SIZE = 8.5;

/** Anchos de columna como fracción del área útil, tomados del diseño en Carta. */
const COLUMN_FRACTIONS = [0, 230 / 528, 340 / 528, 415 / 528, 1] as const;

/**
 * Aire vertical del encabezado y del pie. En A5 cada punto que se recorta aquí
 * es una fila más que cabe en la hoja, y una hoja de más es un informe partido
 * en dos. En Carta y A4 sobra sitio, así que conservan las medidas de siempre.
 */
const VERTICAL_DEFAULTS = { topMargin: 0, logoGap: 6, cardHeight: 52, cardGap: 10, bottomReserve: 40 };
const VERTICAL_OVERRIDES: Partial<Record<ReportPageSize, Partial<typeof VERTICAL_DEFAULTS>>> = {
  a5: { topMargin: 14, logoGap: 3, cardHeight: 47, cardGap: 6, bottomReserve: 32 },
};

/**
 * Puntos que se restan a la letra del informe en cada tamaño de hoja. El alto de
 * fila baja lo mismo: encoger solo la letra dejaría el informe idéntico de
 * páginas, porque quien pagina es `ROW_MIN`, no el cuerpo del texto.
 *
 * El pie queda fuera a propósito: se agrandó a 8.5pt para que el paciente lo lea.
 * Este es el mando para calibrar A5 contra la impresora real del laboratorio.
 */
const FONT_DELTA: Partial<Record<ReportPageSize, number>> = { a5: -1 };

export type ReportGeometry = {
  width: number;
  height: number;
  margin: number;
  topMargin: number;
  contentWidth: number;
  columns: readonly number[];
  logoMaxHeight: number;
  logoGap: number;
  cardHeight: number;
  cardGap: number;
  bottomReserve: number;
  footerBaseline: number;
  /** Tamaño de letra del informe (todo menos el pie), ya con el ajuste aplicado. */
  font: (base: number) => number;
  rowLine: number;
  rowMin: number;
};

export function reportGeometry(size: ReportPageSize = DEFAULT_REPORT_PAGE_SIZE): ReportGeometry {
  const [width, height] = REPORT_PAGE_SIZES[size];
  // Margen proporcional al ancho, con piso de 28pt (~1 cm) porque casi ninguna
  // impresora doméstica imprime más cerca del borde.
  const margin = Math.max(28, (width * 42) / 612);
  const contentWidth = width - margin * 2;
  const vertical = { ...VERTICAL_DEFAULTS, ...VERTICAL_OVERRIDES[size] };
  const fontDelta = FONT_DELTA[size] ?? 0;
  return {
    width,
    height,
    margin,
    topMargin: vertical.topMargin || margin,
    contentWidth,
    columns: COLUMN_FRACTIONS.map((fraction) => margin + fraction * contentWidth),
    logoMaxHeight: Math.min(LOGO_MAX_HEIGHT, (width * LOGO_MAX_HEIGHT) / 612),
    logoGap: vertical.logoGap,
    cardHeight: vertical.cardHeight,
    cardGap: vertical.cardGap,
    bottomReserve: vertical.bottomReserve,
    // El pie manda sobre la reserva inferior: si crece la letra, la última fila
    // de la tabla se aparta sola en vez de quedar pisada.
    footerBaseline: vertical.bottomReserve - FOOTER_SIZE - 1,
    // Piso de 5pt: por debajo de eso ningún informe clínico es legible impreso.
    font: (base: number) => Math.max(5, base + fontDelta),
    rowLine: ROW_LINE + fontDelta,
    rowMin: ROW_MIN + fontDelta,
  };
}

const CARTA = reportGeometry("carta");

export type LabReportResult = {
  group: string;
  analysisCode?: string;
  analysis: string;
  subsection?: string;
  value: string;
  unit: string;
  reference: string;
  flag: string;
  groupOrder?: number;
  analysisOrder?: number;
};

export type LabReportTableRow = ResultPresentationRow<LabReportResult>
  | { kind: "title"; label: string };

export type LabReportData = {
  orderNumber: number;
  orderCode?: string;
  orderedAt: string;
  patientName: string;
  documentNumber: string;
  sex: string;
  age: string;
  revision: number;
  printedAt: string;
  /** Nombre de la vista impresa, p. ej. «PARÁSITO SERIADO». */
  title?: string;
  results: LabReportResult[];
};

const clean = (value: unknown) => String(value ?? "")
  .replace(/[–—]/g, "-")
  .replace(/[^ -~ -ÿ\n]/g, "-");

const normalizeReportLabel = (value: string) => value
  .normalize("NFD")
  .replace(/\p{Diacritic}/gu, "")
  .toUpperCase()
  .replace(/[^A-Z0-9]+/g, " ")
  .trim();

function reportGroupTitle(group: string) {
  const normalized = normalizeReportLabel(group);
  if (normalized.includes("UROANAL")) return "SECCIÓN: ORINAS";
  // El grupo se llama MICROBIOLOGIA en el catálogo, pero el informe que recibe
  // el paciente es el de heces.
  if (normalized.includes("MICROBIOLOG")) return "SECCIÓN: HECES";
  return group;
}

export function buildReportTableRows(results: LabReportResult[], title?: string): LabReportTableRow[] {
  const rows: LabReportTableRow[] = buildResultPresentationRows(results);
  const urinalysis = results.some((result) => normalizeReportLabel(result.group).includes("UROANAL"));
  // El título de la vista manda sobre el fijo de uroanálisis.
  const heading = title?.trim() || (urinalysis ? "EXAMEN COMPLETO DE ORINA" : "");
  if (!heading) return rows;
  return [
    { kind: "title", label: heading },
    ...rows.map((row) => urinalysis && row.kind === "section" && row.label === "EXAMEN BIOQUÍMICO"
      ? { ...row, label: "EXAMEN QUÍMICO" }
      : row),
  ];
}

export function formatReportUnit(unit: string) {
  return formatDisplayUnit(unit);
}

export function formatReportReference(reference: string, unit: string) {
  return formatDisplayReference(reference, unit);
}

function splitText(text: string, font: PDFFont, size: number, maxWidth: number) {
  const output: string[] = [];
  for (const paragraph of clean(text).split("\n")) {
    const words = paragraph.trim().split(/\s+/).filter(Boolean);
    if (!words.length) {
      output.push("");
      continue;
    }
    let line = words.shift() ?? "";
    for (const word of words) {
      const next = `${line} ${word}`;
      if (font.widthOfTextAtSize(next, size) <= maxWidth) line = next;
      else {
        output.push(line);
        line = word;
      }
    }
    output.push(line);
  }
  return output;
}

function drawLines(page: PDFPage, lines: string[], x: number, y: number, font: PDFFont, size: number, color = INK, lineHeight = size + 2) {
  lines.forEach((line, index) => page.drawText(line, { x, y: y - index * lineHeight, font, size, color }));
}

// Centra cada línea dentro de su columna, como en los informes impresos del laboratorio.
function drawCenteredLines(page: PDFPage, lines: string[], left: number, right: number, y: number, font: PDFFont, size: number, color = INK, lineHeight = size + 2) {
  lines.forEach((line, index) => page.drawText(line, {
    x: left + Math.max(0, (right - left - font.widthOfTextAtSize(line, size)) / 2),
    y: y - index * lineHeight,
    font,
    size,
    color,
  }));
}

function drawRoundedBorder(page: PDFPage, x: number, y: number, width: number, height: number, radius: number) {
  const k = 0.5522847498;
  page.pushOperators(
    pushGraphicsState(), setStrokingColor(INK), setLineWidth(1.2),
    moveTo(x + radius, y), lineTo(x + width - radius, y),
    appendBezierCurve(x + width - radius + radius * k, y, x + width, y + radius - radius * k, x + width, y + radius),
    lineTo(x + width, y + height - radius),
    appendBezierCurve(x + width, y + height - radius + radius * k, x + width - radius + radius * k, y + height, x + width - radius, y + height),
    lineTo(x + radius, y + height),
    appendBezierCurve(x + radius - radius * k, y + height, x, y + height - radius + radius * k, x, y + height - radius),
    lineTo(x, y + radius),
    appendBezierCurve(x, y + radius - radius * k, x + radius - radius * k, y, x + radius, y),
    closePath(), stroke(), popGraphicsState(),
  );
}

/** Recorta al ancho disponible midiendo, no contando caracteres. */
function fitText(text: string, font: PDFFont, size: number, maxWidth: number) {
  const value = clean(text);
  if (font.widthOfTextAtSize(value, size) <= maxWidth) return value;
  let cut = value;
  while (cut.length > 1 && font.widthOfTextAtSize(`${cut}…`, size) > maxWidth) cut = cut.slice(0, -1);
  return `${cut}…`;
}

function drawPatientCard(page: PDFPage, data: LabReportData, regular: PDFFont, bold: PDFFont, top: number, geo: ReportGeometry) {
  drawRoundedBorder(page, geo.margin, top - geo.cardHeight, geo.contentWidth, geo.cardHeight, 8);

  const rows = [
    ["ORDEN", data.orderCode ?? `ECOLAB-${data.orderNumber}`, "FECHA", new Date(data.orderedAt).toLocaleDateString("es-PE")],
    ["PACIENTE", data.patientName, "SEXO", data.sex],
    ["DNI", data.documentNumber, "EDAD", data.age],
  ];
  // Las dos columnas de la tarjeta se reparten el área útil: en A5 la posición
  // fija de la derecha (MARGIN + 365) caía fuera de la hoja.
  const leftLabel = geo.margin + geo.contentWidth * (18 / 528);
  const leftValue = geo.margin + geo.contentWidth * (90 / 528);
  const rightLabel = geo.margin + geo.contentWidth * (365 / 528);
  const rightValue = geo.margin + geo.contentWidth * (419 / 528);
  const card = geo.font(8.5);
  rows.forEach((row, index) => {
    const y = top - 14 - index * 15;
    page.drawText(row[0], { x: leftLabel, y, size: card, font: bold, color: INK });
    page.drawText(":", { x: leftValue - 12, y, size: card, font: bold, color: INK });
    page.drawText(fitText(row[1], regular, card, rightLabel - leftValue - 8), { x: leftValue, y, size: card, font: regular, color: INK });
    page.drawText(row[2], { x: rightLabel, y, size: card, font: bold, color: INK });
    page.drawText(":", { x: rightValue - 12, y, size: card, font: bold, color: INK });
    page.drawText(fitText(row[3], regular, card, geo.margin + geo.contentWidth - rightValue - 8), { x: rightValue, y, size: card, font: regular, color: INK });
  });
}

function drawTableHeader(page: PDFPage, bold: PDFFont, group: string, top: number, geo: ReportGeometry, continuation = false) {
  const bottom = top - HEADER_HEIGHT;
  page.drawRectangle({ x: geo.margin, y: bottom, width: geo.contentWidth, height: COLUMN_HEIGHT, color: TABLE_HEADER });
  page.drawRectangle({ x: geo.margin, y: top - TITLE_HEIGHT, width: geo.contentWidth, height: TITLE_HEIGHT, color: GROUP_HEADER });
  page.drawRectangle({ x: geo.margin, y: bottom, width: geo.contentWidth, height: HEADER_HEIGHT, borderColor: INK, borderWidth: 0.8 });
  page.drawLine({ start: { x: geo.margin, y: top - TITLE_HEIGHT }, end: { x: geo.margin + geo.contentWidth, y: top - TITLE_HEIGHT }, thickness: 0.8, color: INK });
  geo.columns.slice(1, -1).forEach((x) => page.drawLine({
    start: { x, y: bottom }, end: { x, y: top - TITLE_HEIGHT }, thickness: 0.8, color: INK,
  }));

  const title = clean(`${reportGroupTitle(group)}${continuation ? " - CONTINUACION" : ""}`).toUpperCase();
  page.drawText(title, {
    x: geo.margin + (geo.contentWidth - bold.widthOfTextAtSize(title, geo.font(9.5))) / 2,
    y: top - 13,
    size: geo.font(9.5),
    font: bold,
    color: INK,
  });
  // En A5 «EXAMENES SOLICITADOS» a 8pt ya no cabe en su columna: se recorta al
  // ancho real en vez de desbordar sobre la columna vecina.
  const headers = ["EXAMENES SOLICITADOS", "RESULTADOS", "UNIDAD", "V. NORMALES"];
  headers.forEach((label, index) => {
    const left = geo.columns[index];
    const width = geo.columns[index + 1] - left;
    const text = fitText(label, bold, geo.font(8), width - 4);
    page.drawText(text, {
      x: left + (width - bold.widthOfTextAtSize(text, geo.font(8))) / 2,
      y: bottom + 5,
      size: geo.font(8),
      font: bold,
      color: INK,
    });
  });
  return bottom;
}

function resultRowLines(row: Extract<LabReportTableRow, { kind: "result" }>, regular: PDFFont, bold: PDFFont, analysisX: number, geo: ReportGeometry) {
  return {
    analysis: splitText(row.result.analysis, regular, geo.font(8.5), geo.columns[1] - analysisX - 5),
    result: splitText(formatNumericResult(row.result.value, row.result.unit) || "-", bold, geo.font(8.5), geo.columns[2] - geo.columns[1] - 8),
    unit: splitText(formatReportUnit(row.result.unit), regular, geo.font(8), geo.columns[3] - geo.columns[2] - 8),
    reference: splitText(formatReportReference(row.result.reference, row.result.unit), regular, geo.font(8), geo.columns[4] - geo.columns[3] - 8),
  };
}

function measureTableRow(row: LabReportTableRow, regular: PDFFont, bold: PDFFont, geo: ReportGeometry) {
  if (row.kind === "title") {
    const lines = splitText(row.label, bold, geo.font(9), geo.contentWidth - 12);
    return Math.max(geo.rowMin + 1, lines.length * geo.rowLine + 7);
  }
  if (row.kind === "section") {
    const lines = splitText(row.label, bold, geo.font(8.5), geo.contentWidth - 12);
    return Math.max(geo.rowMin, lines.length * geo.rowLine + 6);
  }
  const lines = resultRowLines(row, regular, bold, geo.margin + 5 + row.indent * 13, geo);
  const tallest = Math.max(lines.analysis.length, lines.result.length, lines.unit.length, lines.reference.length);
  return Math.max(geo.rowMin, tallest * geo.rowLine + 6);
}

function drawTableRow(page: PDFPage, row: LabReportTableRow, top: number, height: number, regular: PDFFont, bold: PDFFont, geo: ReportGeometry) {
  const bottom = top - height;
  if (row.kind === "title") {
    drawLines(page, splitText(row.label, bold, geo.font(9), geo.contentWidth - 12), geo.margin + 6, top - 11, bold, geo.font(9), INK, geo.rowLine);
    return bottom;
  }
  if (row.kind === "section") {
    page.drawRectangle({ x: geo.margin, y: bottom, width: geo.contentWidth, height, color: SECTION_HEADER });
    drawLines(page, splitText(row.label, bold, geo.font(8.5), geo.contentWidth - 12), geo.margin + 6, top - 11, bold, geo.font(8.5), INK, geo.rowLine);
    return bottom;
  }

  const baseline = top - 11;
  const analysisX = geo.margin + 5 + row.indent * 13;
  const lines = resultRowLines(row, regular, bold, analysisX, geo);
  drawLines(page, lines.analysis, analysisX, baseline, regular, geo.font(8.5), INK, geo.rowLine);
  drawCenteredLines(page, lines.result, geo.columns[1], geo.columns[2], baseline, bold, geo.font(8.5), row.result.flag === "critical" ? CRITICAL : INK, geo.rowLine);
  drawCenteredLines(page, lines.unit, geo.columns[2], geo.columns[3], baseline, regular, geo.font(8), INK, geo.rowLine);
  drawCenteredLines(page, lines.reference, geo.columns[3], geo.columns[4], baseline, regular, geo.font(8), INK, geo.rowLine);
  return bottom;
}

/**
 * Orden de impresión. Manda lo que diga el catálogo (`groupOrder` /
 * `analysisOrder`); la tabla canónica solo cubre a quien no lo traiga, y para un
 * grupo que no conoce devuelve 999, con lo que el desempate acaba siendo
 * alfabético. Por eso quien construye las filas debe traer siempre el orden.
 */
export function sortReportResults(results: LabReportResult[]) {
  return [...results].sort((left, right) =>
    (left.groupOrder ?? canonicalGroupOrder(left.group)) - (right.groupOrder ?? canonicalGroupOrder(right.group))
    || (left.analysisOrder ?? canonicalAnalysisOrder(left.group, left.analysis))
      - (right.analysisOrder ?? canonicalAnalysisOrder(right.group, right.analysis))
    || left.analysis.localeCompare(right.analysis, "es"));
}

function groupResults(results: LabReportResult[]) {
  const grouped = new Map<string, LabReportResult[]>();
  sortReportResults(results)
    .forEach((result) => grouped.set(result.group, [...(grouped.get(result.group) ?? []), result]));
  return grouped;
}

/** Las dos piezas del membrete, nombradas por dónde caen en la hoja. */
export type LabReportLogos = { left: Uint8Array; right: Uint8Array };

/**
 * Membrete a dos piezas: el símbolo pegado al margen izquierdo y el nombre del
 * laboratorio al derecho. Comparten altura para que se lean como una sola
 * cabecera, y esa altura se encoge si con las proporciones dadas no cupieran
 * a lo ancho de la hoja.
 */
export function headerLogoBoxes(
  left: { width: number; height: number },
  right: { width: number; height: number },
  geo: ReportGeometry = CARTA,
) {
  const leftRatio = left.width / left.height;
  const rightRatio = right.width / right.height;
  const height = Math.min(geo.logoMaxHeight, (geo.contentWidth - LOGO_GAP) / (leftRatio + rightRatio));
  const rightWidth = height * rightRatio;
  return {
    height,
    left: { x: geo.margin, width: height * leftRatio },
    right: { x: geo.margin + geo.contentWidth - rightWidth, width: rightWidth },
  };
}

export async function buildLabReportPdf(
  data: LabReportData,
  logos: LabReportLogos,
  pageSize: ReportPageSize = DEFAULT_REPORT_PAGE_SIZE,
) {
  const geo = reportGeometry(pageSize);
  const pdf = await PDFDocument.create();
  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  // Los archivos del laboratorio llevan extensión .png pero son JPEG, así que
  // el formato se decide por los bytes mágicos y no por el nombre.
  const embedLogo = (bytes: Uint8Array) => bytes[0] === 0x89 && bytes[1] === 0x50
    ? pdf.embedPng(bytes)
    : pdf.embedJpg(bytes);
  const leftLogo = await embedLogo(logos.left);
  const rightLogo = await embedLogo(logos.right);
  const logoBoxes = headerLogoBoxes(leftLogo, rightLogo, geo);
  const logoHeight = logoBoxes.height;
  const freshTableTop = geo.height - geo.topMargin - logoHeight - geo.logoGap - geo.cardHeight - geo.cardGap;
  const freshBodySpace = freshTableTop - HEADER_HEIGHT - geo.bottomReserve;
  let page: PDFPage | undefined;
  let y = 0;

  function drawLogos(target: PDFPage) {
    const top = geo.height - geo.topMargin - logoHeight;
    target.drawImage(leftLogo, { ...logoBoxes.left, y: top, height: logoHeight });
    target.drawImage(rightLogo, { ...logoBoxes.right, y: top, height: logoHeight });
    return top - geo.logoGap;
  }

  function addPage(group: string, continuation = false) {
    page = pdf.addPage([geo.width, geo.height]);
    const cardTop = drawLogos(page);
    drawPatientCard(page, data, regular, bold, cardTop, geo);
    y = drawTableHeader(page, bold, group, cardTop - geo.cardHeight - geo.cardGap, geo, continuation);
  }

  for (const [group, results] of groupResults(data.results)) {
    const rows = buildReportTableRows(results, data.title);
    const firstRowHeight = rows[0] ? measureTableRow(rows[0], regular, bold, geo) : 0;
    const firstFollowingRows = rows[0]?.kind === "title"
      ? rows.slice(1, 3)
      : rows[0]?.kind === "section"
        ? rows.slice(1, 2)
        : [];
    const minimumGroupHeight = GROUP_GAP + HEADER_HEIGHT + firstRowHeight
      + firstFollowingRows.reduce((total, row) => total + measureTableRow(row, regular, bold, geo), 0);
    const rowsHeight = rows.reduce((total, row) => total + measureTableRow(row, regular, bold, geo), 0);
    const requiredHeight = rowsHeight <= freshBodySpace ? GROUP_GAP + HEADER_HEIGHT + rowsHeight : minimumGroupHeight;
    if (!page || y - requiredHeight < geo.bottomReserve) addPage(group);
    else y = drawTableHeader(page, bold, group, y - GROUP_GAP, geo);
    for (let index = 0; index < rows.length; index += 1) {
      const row = rows[index];
      const rowHeight = measureTableRow(row, regular, bold, geo);
      const followingRows = row.kind === "title"
        ? rows.slice(index + 1, index + 3)
        : row.kind === "section"
          ? rows.slice(index + 1, index + 2)
          : [];
      const nextHeight = followingRows.reduce((total, followingRow) => total + measureTableRow(followingRow, regular, bold, geo), 0);
      if (y - rowHeight - nextHeight < geo.bottomReserve) addPage(group, true);
      y = drawTableRow(page!, row, y, rowHeight, regular, bold, geo);
    }
  }

  if (!page) addPage("RESULTADOS");

  const printed = new Intl.DateTimeFormat("es-PE", {
    dateStyle: "short", timeStyle: "short", timeZone: "America/Lima",
  }).format(new Date(data.printedAt));
  // Pie proporcional al área útil: en A5 las posiciones fijas (455 / 548) caían
  // fuera de la hoja y el número de página no se imprimía. En Carta las
  // fracciones devuelven exactamente los mismos puntos de siempre.
  const footerX = (carta: number) => geo.margin + geo.contentWidth * ((carta - 42) / 528);
  pdf.getPages().forEach((outputPage, index) => {
    outputPage.drawText(`Impreso el ${clean(printed)}`, { x: geo.margin, y: geo.footerBaseline, size: FOOTER_SIZE, font: regular, color: MUTED, maxWidth: geo.contentWidth * (300 / 528) });
    outputPage.drawText(`Rev. ${data.revision}`, { x: footerX(455), y: geo.footerBaseline, size: FOOTER_SIZE, font: regular, color: MUTED, maxWidth: geo.contentWidth * (70 / 528) });
    // Un informe de diez hojas o más ensancha esta etiqueta; sin el tope se
    // saldría por el borde derecho de la A5, que es la hoja más justa.
    const pageLabel = `${index + 1}/${pdf.getPageCount()}`;
    const pageRight = geo.margin + geo.contentWidth - regular.widthOfTextAtSize(pageLabel, FOOTER_SIZE);
    outputPage.drawText(pageLabel, { x: Math.min(footerX(548), pageRight), y: geo.footerBaseline, size: FOOTER_SIZE, font: regular, color: MUTED });
  });

  return pdf.save();
}
