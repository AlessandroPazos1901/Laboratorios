import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { PDFDocument } from "pdf-lib";
import { describe, expect, it } from "vitest";
import { buildLabReportPdf } from "./report-pdf";

describe("buildLabReportPdf", () => {
  it("genera un informe válido y pagina análisis extensos", async () => {
    const logo = await readFile(path.join(process.cwd(), "public", "logo_laboratorio.png"));
    const bytes = await buildLabReportPdf({
      orderNumber: 1225937,
      orderedAt: "2026-08-01T10:30:00-05:00",
      patientName: "Paciente de prueba",
      documentNumber: "70421856",
      sex: "Femenino",
      age: "34 años",
      revision: 1,
      printedAt: "2026-08-01T10:35:00-05:00",
      results: Array.from({ length: 42 }, (_, index) => ({
        group: "Bioquímica",
        analysis: `Examen solicitado ${index + 1}`,
        value: String(index + 1),
        unit: "mg/dL",
        reference: index % 7 === 0 ? "Hombres: 3.5 - 7.2\nMujeres: 2.6 - 6.0" : "70 - 110",
        flag: "normal",
      })),
    }, logo);

    const pdf = await PDFDocument.load(bytes);
    expect(pdf.getPageCount()).toBeGreaterThan(1);
    expect(bytes.byteLength).toBeGreaterThan(logo.byteLength);
    if (process.env.WRITE_REPORT_SAMPLE === "1") {
      const output = path.join(process.cwd(), "tmp", "pdfs");
      await mkdir(output, { recursive: true });
      await writeFile(path.join(output, "informe-laboratorio-muestra.pdf"), bytes);
    }
  });
});
