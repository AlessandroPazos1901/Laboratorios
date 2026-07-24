import ExcelJS from "exceljs";
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_FILE_SIZE = 15 * 1024 * 1024;
const ALLOWED = new Set(["xlsx", "xlsm", "csv"]);

function extensionOf(name: string) {
  return name.toLowerCase().split(".").pop() ?? "";
}

function safeName(name: string) {
  return name.replace(/[^\p{L}\p{N}._ -]/gu, "_").slice(0, 120);
}

export async function POST(request: Request) {
  try {
    const data = await request.formData();
    const file = data.get("file");
    if (!(file instanceof File)) return NextResponse.json({ error: "Archivo requerido." }, { status: 400 });
    const extension = extensionOf(file.name);
    if (!ALLOWED.has(extension)) return NextResponse.json({ error: "Formato no permitido." }, { status: 415 });
    if (file.size <= 0 || file.size > MAX_FILE_SIZE) return NextResponse.json({ error: "El archivo debe pesar entre 1 byte y 15 MB." }, { status: 413 });

    if (extension === "csv") {
      const text = await file.text();
      if (text.includes("\u0000")) return NextResponse.json({ error: "El CSV no es texto válido." }, { status: 422 });
      const lines = text.split(/\r?\n/).filter(Boolean);
      const headers = (lines[0] ?? "").split(/[,;]/).map((value) => value.trim()).slice(0, 100);
      return NextResponse.json({
        file: safeName(file.name),
        sheets: ["CSV"],
        totalRows: Math.max(0, lines.length - 1),
        headers,
        warnings: headers.some((header) => /^edad$/i.test(header)) ? ["La edad será recalculada con nacimiento y fecha de la orden."] : [],
      });
    }

    const workbook = new ExcelJS.Workbook();
    const bytes = await file.arrayBuffer();
    await workbook.xlsx.load(bytes);
    const sheets = workbook.worksheets.map((sheet) => sheet.name);
    const totalRows = workbook.worksheets.reduce((sum, sheet) => sum + Math.max(0, sheet.actualRowCount - 1), 0);
    const warnings: string[] = [];
    if (extension === "xlsm") warnings.push("El archivo contiene o puede contener macros; no se ejecutaron.");
    if (sheets.some((name) => name.toUpperCase() === "RESULTADOS")) warnings.push("Se detectó RESULTADOS: requiere el mapeo clínico aprobado de 88 campos.");
    if (sheets.some((name) => name.toUpperCase() === "PADRON")) warnings.push("Se detectó PADRON: los DNI duplicados o incompletos pasarán a revisión.");
    return NextResponse.json({ file: safeName(file.name), sheets, totalRows, warnings });
  } catch {
    return NextResponse.json({ error: "No se pudo interpretar el archivo. Verifica que no esté dañado o protegido." }, { status: 422 });
  }
}
