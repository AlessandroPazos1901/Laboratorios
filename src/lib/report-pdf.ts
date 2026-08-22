import {
  appendBezierCurve, closePath, lineTo, moveTo, PDFDocument, PDFFont, PDFPage,
  popGraphicsState, pushGraphicsState, setLineWidth, setStrokingColor, StandardFonts, stroke, rgb,
} from "pdf-lib";
import { canonicalAnalysisOrder, canonicalGroupOrder } from "@/lib/catalog-order";
import { formatNumericResult } from "@/lib/clinical";
import {
  buildResultPresentationRows, formatDisplayReference, formatDisplayUnit, type ResultPresentationRow,
} from "@/lib/result-presentation";

const LETTER: [number, number] = [612, 792];
const MARGIN = 42;
const CONTENT_WIDTH = LETTER[0] - MARGIN * 2;
const INK = rgb(0.08, 0.16, 0.25);
const MUTED = rgb(0.37, 0.43, 0.48);
const CRITICAL = rgb(0.70, 0.14, 0.17);
const TABLE_HEADER = rgb(0.84, 0.84, 0.84);
const GROUP_HEADER = rgb(0.90, 0.95, 0.95);
const SECTION_HEADER = rgb(0.94, 0.96, 0.96);
const TABLE_COLUMNS = [MARGIN, MARGIN + 230, MARGIN + 340, MARGIN + 415, MARGIN + CONTENT_WIDTH] as const;
// Métrica compacta: un informe corriente debe caber en una sola hoja Carta.
const ROW_LINE = 9;
const ROW_MIN = 16;
const TITLE_HEIGHT = 18;
const COLUMN_HEIGHT = 15;
const HEADER_HEIGHT = TITLE_HEIGHT + COLUMN_HEIGHT;
const CARD_HEIGHT = 52;
const CARD_GAP = 10;
const LOGO_MAX_HEIGHT = 64;
const LOGO_GAP = 24;
const PAGE_BOTTOM = 40;
const GROUP_GAP = 8;

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

function drawPatientCard(page: PDFPage, data: LabReportData, regular: PDFFont, bold: PDFFont, top: number) {
  drawRoundedBorder(page, MARGIN, top - CARD_HEIGHT, CONTENT_WIDTH, CARD_HEIGHT, 8);

  const rows = [
    ["ORDEN", data.orderCode ?? `ECOLAB-${data.orderNumber}`, "FECHA", new Date(data.orderedAt).toLocaleDateString("es-PE")],
    ["PACIENTE", data.patientName, "SEXO", data.sex],
    ["DNI", data.documentNumber, "EDAD", data.age],
  ];
  rows.forEach((row, index) => {
    const y = top - 14 - index * 15;
    page.drawText(row[0], { x: MARGIN + 18, y, size: 8.5, font: bold, color: INK });
    page.drawText(":", { x: MARGIN + 78, y, size: 8.5, font: bold, color: INK });
    page.drawText(clean(row[1]).slice(0, 44), { x: MARGIN + 90, y, size: 8.5, font: regular, color: INK, maxWidth: 260 });
    page.drawText(row[2], { x: MARGIN + 365, y, size: 8.5, font: bold, color: INK });
    page.drawText(":", { x: MARGIN + 407, y, size: 8.5, font: bold, color: INK });
    page.drawText(clean(row[3]).slice(0, 20), { x: MARGIN + 419, y, size: 8.5, font: regular, color: INK, maxWidth: 90 });
  });
}

function drawTableHeader(page: PDFPage, bold: PDFFont, group: string, top: number, continuation = false) {
  const bottom = top - HEADER_HEIGHT;
  page.drawRectangle({ x: MARGIN, y: bottom, width: CONTENT_WIDTH, height: COLUMN_HEIGHT, color: TABLE_HEADER });
  page.drawRectangle({ x: MARGIN, y: top - TITLE_HEIGHT, width: CONTENT_WIDTH, height: TITLE_HEIGHT, color: GROUP_HEADER });
  page.drawRectangle({ x: MARGIN, y: bottom, width: CONTENT_WIDTH, height: HEADER_HEIGHT, borderColor: INK, borderWidth: 0.8 });
  page.drawLine({ start: { x: MARGIN, y: top - TITLE_HEIGHT }, end: { x: MARGIN + CONTENT_WIDTH, y: top - TITLE_HEIGHT }, thickness: 0.8, color: INK });
  TABLE_COLUMNS.slice(1, -1).forEach((x) => page.drawLine({
    start: { x, y: bottom }, end: { x, y: top - TITLE_HEIGHT }, thickness: 0.8, color: INK,
  }));

  const title = clean(`${reportGroupTitle(group)}${continuation ? " - CONTINUACION" : ""}`).toUpperCase();
  page.drawText(title, {
    x: MARGIN + (CONTENT_WIDTH - bold.widthOfTextAtSize(title, 9.5)) / 2,
    y: top - 13,
    size: 9.5,
    font: bold,
    color: INK,
  });
  const headers = ["EXAMENES SOLICITADOS", "RESULTADOS", "UNIDAD", "V. NORMALES"];
  headers.forEach((label, index) => {
    const left = TABLE_COLUMNS[index];
    const width = TABLE_COLUMNS[index + 1] - left;
    page.drawText(clean(label), {
      x: left + (width - bold.widthOfTextAtSize(clean(label), 8)) / 2,
      y: bottom + 5,
      size: 8,
      font: bold,
      color: INK,
    });
  });
  return bottom;
}

function resultRowLines(row: Extract<LabReportTableRow, { kind: "result" }>, regular: PDFFont, bold: PDFFont, analysisX: number) {
  return {
    analysis: splitText(row.result.analysis, regular, 8.5, TABLE_COLUMNS[1] - analysisX - 5),
    result: splitText(formatNumericResult(row.result.value, row.result.unit) || "-", bold, 8.5, TABLE_COLUMNS[2] - TABLE_COLUMNS[1] - 8),
    unit: splitText(formatReportUnit(row.result.unit), regular, 8, TABLE_COLUMNS[3] - TABLE_COLUMNS[2] - 8),
    reference: splitText(formatReportReference(row.result.reference, row.result.unit), regular, 8, TABLE_COLUMNS[4] - TABLE_COLUMNS[3] - 8),
  };
}

function measureTableRow(row: LabReportTableRow, regular: PDFFont, bold: PDFFont) {
  if (row.kind === "title") {
    const lines = splitText(row.label, bold, 9, CONTENT_WIDTH - 12);
    return Math.max(ROW_MIN + 1, lines.length * ROW_LINE + 7);
  }
  if (row.kind === "section") {
    const lines = splitText(row.label, bold, 8.5, CONTENT_WIDTH - 12);
    return Math.max(ROW_MIN, lines.length * ROW_LINE + 6);
  }
  const lines = resultRowLines(row, regular, bold, MARGIN + 5 + row.indent * 13);
  const tallest = Math.max(lines.analysis.length, lines.result.length, lines.unit.length, lines.reference.length);
  return Math.max(ROW_MIN, tallest * ROW_LINE + 6);
}

function drawTableRow(page: PDFPage, row: LabReportTableRow, top: number, height: number, regular: PDFFont, bold: PDFFont) {
  const bottom = top - height;
  if (row.kind === "title") {
    drawLines(page, splitText(row.label, bold, 9, CONTENT_WIDTH - 12), MARGIN + 6, top - 11, bold, 9, INK, ROW_LINE);
    return bottom;
  }
  if (row.kind === "section") {
    page.drawRectangle({ x: MARGIN, y: bottom, width: CONTENT_WIDTH, height, color: SECTION_HEADER });
    drawLines(page, splitText(row.label, bold, 8.5, CONTENT_WIDTH - 12), MARGIN + 6, top - 11, bold, 8.5, INK, ROW_LINE);
    return bottom;
  }

  const baseline = top - 11;
  const analysisX = MARGIN + 5 + row.indent * 13;
  const lines = resultRowLines(row, regular, bold, analysisX);
  drawLines(page, lines.analysis, analysisX, baseline, regular, 8.5, INK, ROW_LINE);
  drawCenteredLines(page, lines.result, TABLE_COLUMNS[1], TABLE_COLUMNS[2], baseline, bold, 8.5, row.result.flag === "critical" ? CRITICAL : INK, ROW_LINE);
  drawCenteredLines(page, lines.unit, TABLE_COLUMNS[2], TABLE_COLUMNS[3], baseline, regular, 8, INK, ROW_LINE);
  drawCenteredLines(page, lines.reference, TABLE_COLUMNS[3], TABLE_COLUMNS[4], baseline, regular, 8, INK, ROW_LINE);
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
) {
  const leftRatio = left.width / left.height;
  const rightRatio = right.width / right.height;
  const height = Math.min(LOGO_MAX_HEIGHT, (CONTENT_WIDTH - LOGO_GAP) / (leftRatio + rightRatio));
  const rightWidth = height * rightRatio;
  return {
    height,
    left: { x: MARGIN, width: height * leftRatio },
    right: { x: MARGIN + CONTENT_WIDTH - rightWidth, width: rightWidth },
  };
}

export async function buildLabReportPdf(data: LabReportData, logos: LabReportLogos) {
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
  const logoBoxes = headerLogoBoxes(leftLogo, rightLogo);
  const logoHeight = logoBoxes.height;
  const freshTableTop = 792 - MARGIN - logoHeight - 6 - CARD_HEIGHT - CARD_GAP;
  const freshBodySpace = freshTableTop - HEADER_HEIGHT - PAGE_BOTTOM;
  let page: PDFPage | undefined;
  let y = 0;

  function drawLogos(target: PDFPage) {
    const top = 792 - MARGIN - logoHeight;
    target.drawImage(leftLogo, { ...logoBoxes.left, y: top, height: logoHeight });
    target.drawImage(rightLogo, { ...logoBoxes.right, y: top, height: logoHeight });
    return top - 6;
  }

  function addPage(group: string, continuation = false) {
    page = pdf.addPage(LETTER);
    const cardTop = drawLogos(page);
    drawPatientCard(page, data, regular, bold, cardTop);
    y = drawTableHeader(page, bold, group, cardTop - CARD_HEIGHT - CARD_GAP, continuation);
  }

  for (const [group, results] of groupResults(data.results)) {
    const rows = buildReportTableRows(results, data.title);
    const firstRowHeight = rows[0] ? measureTableRow(rows[0], regular, bold) : 0;
    const firstFollowingRows = rows[0]?.kind === "title"
      ? rows.slice(1, 3)
      : rows[0]?.kind === "section"
        ? rows.slice(1, 2)
        : [];
    const minimumGroupHeight = GROUP_GAP + HEADER_HEIGHT + firstRowHeight
      + firstFollowingRows.reduce((total, row) => total + measureTableRow(row, regular, bold), 0);
    const rowsHeight = rows.reduce((total, row) => total + measureTableRow(row, regular, bold), 0);
    const requiredHeight = rowsHeight <= freshBodySpace ? GROUP_GAP + HEADER_HEIGHT + rowsHeight : minimumGroupHeight;
    if (!page || y - requiredHeight < PAGE_BOTTOM) addPage(group);
    else y = drawTableHeader(page, bold, group, y - GROUP_GAP);
    for (let index = 0; index < rows.length; index += 1) {
      const row = rows[index];
      const rowHeight = measureTableRow(row, regular, bold);
      const followingRows = row.kind === "title"
        ? rows.slice(index + 1, index + 3)
        : row.kind === "section"
          ? rows.slice(index + 1, index + 2)
          : [];
      const nextHeight = followingRows.reduce((total, followingRow) => total + measureTableRow(followingRow, regular, bold), 0);
      if (y - rowHeight - nextHeight < PAGE_BOTTOM) addPage(group, true);
      y = drawTableRow(page!, row, y, rowHeight, regular, bold);
    }
  }

  if (!page) addPage("RESULTADOS");

  const printed = new Intl.DateTimeFormat("es-PE", {
    dateStyle: "short", timeStyle: "short", timeZone: "America/Lima",
  }).format(new Date(data.printedAt));
  pdf.getPages().forEach((outputPage, index) => {
    outputPage.drawText(`Impreso el ${clean(printed)}`, { x: MARGIN, y: 31, size: 7, font: regular, color: MUTED, maxWidth: 300 });
    outputPage.drawText(`Rev. ${data.revision}`, { x: 455, y: 31, size: 7, font: regular, color: MUTED, maxWidth: 70 });
    outputPage.drawText(`${index + 1}/${pdf.getPageCount()}`, { x: 548, y: 31, size: 7, font: regular, color: MUTED });
  });

  return pdf.save();
}
