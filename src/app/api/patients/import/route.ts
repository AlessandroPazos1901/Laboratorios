import ExcelJS from "exceljs";
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_FILE_SIZE = 15 * 1024 * 1024;
const ALLOWED = new Set(["xlsx", "xlsm"]);

function extensionOf(name: string) {
  return name.toLocaleLowerCase("es").split(".").pop() ?? "";
}

function safeName(name: string) {
  return name.replace(/[^\p{L}\p{N}._ -]/gu, "_").slice(0, 120);
}

function cellText(cell: ExcelJS.Cell) {
  const value = cell.value;
  if (value === null || value === undefined) return "";
  if (typeof value === "object") {
    if ("richText" in value && Array.isArray(value.richText)) return value.richText.map((part) => part.text).join("");
    if ("result" in value) return String(value.result ?? "");
    if ("text" in value) return String(value.text ?? "");
  }
  return String(value).trim();
}

function normalizeDni(value: string) {
  const digits = value.replace(/\D/g, "");
  return digits.length > 0 && digits.length < 8 ? digits.padStart(8, "0") : digits;
}

async function loadWorkbook(file: File) {
  const extension = extensionOf(file.name);
  if (!ALLOWED.has(extension)) throw new Error("Formato no permitido. Usa un archivo XLSX o XLSM.");
  if (file.size <= 0 || file.size > MAX_FILE_SIZE) throw new Error("El archivo debe pesar entre 1 byte y 15 MB.");
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(await file.arrayBuffer());
  if (workbook.worksheets.length === 0) throw new Error("El libro no contiene hojas.");
  return workbook;
}

export async function POST(request: Request) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Sesión requerida." }, { status: 401 });

    const form = await request.formData();
    const action = String(form.get("action") ?? "preview");
    const file = form.get("file");
    if (!(file instanceof File)) return NextResponse.json({ error: "Selecciona un archivo Excel." }, { status: 400 });
    const workbook = await loadWorkbook(file);

    if (action === "preview") {
      const sheets = workbook.worksheets.map((sheet) => {
        const columnCount = Math.min(100, Math.max(sheet.actualColumnCount, sheet.getRow(1).cellCount));
        const headers = Array.from({ length: columnCount }, (_, index) => cellText(sheet.getRow(1).getCell(index + 1)) || `Columna ${index + 1}`);
        const sampleRows = Array.from({ length: Math.min(5, Math.max(0, sheet.actualRowCount - 1)) }, (_, rowIndex) =>
          headers.map((_, columnIndex) => cellText(sheet.getRow(rowIndex + 2).getCell(columnIndex + 1))),
        );
        return { name: sheet.name, rows: Math.max(0, sheet.actualRowCount - 1), headers, sampleRows };
      });
      return NextResponse.json({ file: safeName(file.name), sheets, warning: extensionOf(file.name) === "xlsm" ? "Las macros no se ejecutaron." : null });
    }

    if (action !== "import") return NextResponse.json({ error: "Acción no válida." }, { status: 400 });
    const sheetName = String(form.get("sheet") ?? "");
    const nameColumn = Number(form.get("nameColumn"));
    const dniColumn = Number(form.get("dniColumn"));
    const sheet = workbook.getWorksheet(sheetName);
    if (!sheet) return NextResponse.json({ error: "La hoja seleccionada no existe." }, { status: 400 });
    if (!Number.isInteger(nameColumn) || !Number.isInteger(dniColumn) || nameColumn < 1 || dniColumn < 1 || nameColumn === dniColumn) {
      return NextResponse.json({ error: "Mapea columnas diferentes para Nombre y DNI." }, { status: 400 });
    }

    const candidates: { row: number; name: string; dni: string }[] = [];
    const failures: { row: number; reason: string }[] = [];
    const seen = new Set<string>();
    for (let rowNumber = 2; rowNumber <= sheet.actualRowCount; rowNumber += 1) {
      const name = cellText(sheet.getRow(rowNumber).getCell(nameColumn)).replace(/\s+/g, " ").trim();
      const dni = normalizeDni(cellText(sheet.getRow(rowNumber).getCell(dniColumn)));
      if (!name && !dni) continue;
      if (name.length < 2) { failures.push({ row: rowNumber, reason: "Nombre vacío o demasiado corto." }); continue; }
      if (!/^\d{8}$/.test(dni)) { failures.push({ row: rowNumber, reason: "El DNI debe tener 8 dígitos." }); continue; }
      if (seen.has(dni)) { failures.push({ row: rowNumber, reason: "DNI repetido dentro del archivo." }); continue; }
      seen.add(dni);
      candidates.push({ row: rowNumber, name, dni });
    }

    let imported = 0;
    for (let offset = 0; offset < candidates.length; offset += 20) {
      const chunk = candidates.slice(offset, offset + 20);
      const results = await Promise.all(chunk.map((candidate) => supabase.rpc("upsert_import_patient", {
        patient_dni: candidate.dni,
        patient_name: candidate.name,
        patient_birth_date: null,
        patient_sex: null,
        source_metadata: {
          import_kind: "patient_roster",
          file: safeName(file.name),
          sheet: sheet.name,
          row: candidate.row,
        },
      })));
      results.forEach((result, index) => {
        if (result.error) failures.push({ row: chunk[index].row, reason: result.error.message });
        else imported += 1;
      });
    }

    return NextResponse.json({ imported, failed: failures.length, failures: failures.slice(0, 100), total: imported + failures.length });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "No se pudo procesar el archivo." }, { status: 422 });
  }
}
