import {
  appendBezierCurve, closePath, lineTo, moveTo, PDFDocument, PDFFont, PDFImage, PDFPage,
  popGraphicsState, pushGraphicsState, setLineWidth, setStrokingColor, StandardFonts, stroke, rgb,
} from "pdf-lib";
import { canonicalAnalysisOrder, canonicalGroupOrder } from "@/lib/catalog-order";
import { expandMillonesText, formatNumericResult } from "@/lib/clinical";

const LETTER: [number, number] = [612, 792];
const MARGIN = 42;
const CONTENT_WIDTH = LETTER[0] - MARGIN * 2;
const INK = rgb(0.08, 0.16, 0.25);
const MUTED = rgb(0.37, 0.43, 0.48);
const CRITICAL = rgb(0.70, 0.14, 0.17);
const TABLE_HEADER = rgb(0.84, 0.84, 0.84);
const TABLE_COLUMNS = [MARGIN, MARGIN + 235, MARGIN + 385, MARGIN + CONTENT_WIDTH] as const;

export type LabReportResult = {
  group: string;
  analysis: string;
  value: string;
  unit: string;
  reference: string;
  flag: string;
  groupOrder?: number;
  analysisOrder?: number;
};

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
  results: LabReportResult[];
};

const clean = (value: unknown) => String(value ?? "")
  .replace(/[–—]/g, "-")
  .replace(/[^ -~ -ÿ\n]/g, "-");

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
  const height = 66;
  drawRoundedBorder(page, MARGIN, top - height, CONTENT_WIDTH, height, 10);

  const rows = [
    ["ORDEN", data.orderCode ?? `ECOLAB-${data.orderNumber}`, "FECHA", new Date(data.orderedAt).toLocaleDateString("es-PE")],
    ["PACIENTE", data.patientName, "SEXO", data.sex],
    ["DNI", data.documentNumber, "EDAD", data.age],
  ];
  rows.forEach((row, index) => {
    const y = top - 17 - index * 19;
    page.drawText(row[0], { x: MARGIN + 18, y, size: 8.5, font: bold, color: INK });
    page.drawText(":", { x: MARGIN + 78, y, size: 8.5, font: bold, color: INK });
    page.drawText(clean(row[1]).slice(0, 44), { x: MARGIN + 90, y, size: 8.5, font: regular, color: INK, maxWidth: 260 });
    page.drawText(row[2], { x: MARGIN + 365, y, size: 8.5, font: bold, color: INK });
    page.drawText(":", { x: MARGIN + 407, y, size: 8.5, font: bold, color: INK });
    page.drawText(clean(row[3]).slice(0, 20), { x: MARGIN + 419, y, size: 8.5, font: regular, color: INK, maxWidth: 90 });
  });
}

function drawTableHeader(page: PDFPage, bold: PDFFont, group: string, top: number) {
  const titleHeight = 24;
  const columnHeight = 22;
  const bottom = top - titleHeight - columnHeight;
  page.drawRectangle({ x: MARGIN, y: bottom, width: CONTENT_WIDTH, height: columnHeight, color: TABLE_HEADER });
  page.drawRectangle({ x: MARGIN, y: bottom, width: CONTENT_WIDTH, height: titleHeight + columnHeight, borderColor: INK, borderWidth: 0.8 });
  page.drawLine({ start: { x: MARGIN, y: top - titleHeight }, end: { x: MARGIN + CONTENT_WIDTH, y: top - titleHeight }, thickness: 0.8, color: INK });
  TABLE_COLUMNS.slice(1, -1).forEach((x) => page.drawLine({
    start: { x, y: bottom }, end: { x, y: top - titleHeight }, thickness: 0.8, color: INK,
  }));

  const title = clean(group).toUpperCase();
  page.drawText(title, {
    x: MARGIN + (CONTENT_WIDTH - bold.widthOfTextAtSize(title, 10)) / 2,
    y: top - 16,
    size: 10,
    font: bold,
    color: INK,
  });
  const headers = ["ANALISIS", "RESULTADOS", "VALORES REFERENCIA"];
  headers.forEach((label, index) => {
    const left = TABLE_COLUMNS[index];
    const width = TABLE_COLUMNS[index + 1] - left;
    page.drawText(clean(label), {
      x: left + (width - bold.widthOfTextAtSize(clean(label), 8)) / 2,
      y: bottom + 7,
      size: 8,
      font: bold,
      color: INK,
    });
  });
  return bottom - 15;
}

function groupResults(results: LabReportResult[]) {
  const grouped = new Map<string, LabReportResult[]>();
  [...results].sort((left, right) =>
    (left.groupOrder ?? canonicalGroupOrder(left.group)) - (right.groupOrder ?? canonicalGroupOrder(right.group))
    || (left.analysisOrder ?? canonicalAnalysisOrder(left.group, left.analysis))
      - (right.analysisOrder ?? canonicalAnalysisOrder(right.group, right.analysis))
    || left.analysis.localeCompare(right.analysis, "es"))
    .forEach((result) => grouped.set(result.group, [...(grouped.get(result.group) ?? []), result]));
  return grouped;
}

export async function buildLabReportPdf(data: LabReportData, logoBytes: Uint8Array) {
  const pdf = await PDFDocument.create();
  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const logo = logoBytes[0] === 0x89 && logoBytes[1] === 0x50
    ? await pdf.embedPng(logoBytes)
    : await pdf.embedJpg(logoBytes);
  let page: PDFPage;
  let y = 0;
  let currentGroup = "";

  function drawLogo(target: PDFPage, image: PDFImage) {
    const width = CONTENT_WIDTH;
    const height = width / (image.width / image.height);
    target.drawImage(image, { x: MARGIN, y: 792 - MARGIN - height, width, height });
    return 792 - MARGIN - height - 8;
  }

  function addPage(group: string, _continuation = false) {
    page = pdf.addPage(LETTER);
    const cardTop = drawLogo(page, logo);
    drawPatientCard(page, data, regular, bold, cardTop);
    y = drawTableHeader(page, bold, group, cardTop - 84);
  }

  for (const [group, results] of groupResults(data.results)) {
    currentGroup = group;
    addPage(group);
    for (const result of results) {
      const analysisLines = splitText(result.analysis, regular, 8.5, 224);
      const resultWithUnit = [formatNumericResult(result.value, result.unit) || "-", expandMillonesText(result.unit)].filter(Boolean).join(" ");
      const resultLines = splitText(resultWithUnit, regular, 8.5, 138);
      const referenceLines = splitText(result.reference || "-", regular, 8, 131);
      const lineCount = Math.max(1, analysisLines.length, resultLines.length, referenceLines.length);
      const rowHeight = Math.max(18, lineCount * 10 + 5);
      if (y - rowHeight < 58) addPage(group, true);

      drawLines(page!, analysisLines, MARGIN + 3, y, bold, 8.5);
      drawLines(page!, resultLines, TABLE_COLUMNS[1] + 3, y, bold, 8.5, result.flag === "critical" ? CRITICAL : INK);
      drawLines(page!, referenceLines, TABLE_COLUMNS[2] + 3, y, regular, 8);
      y -= rowHeight;
    }
  }

  if (!currentGroup) addPage("RESULTADOS");

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
