import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { PDFDocument } from "pdf-lib";
import { describe, expect, it } from "vitest";
import {
  buildLabReportPdf, buildReportTableRows, formatReportReference, formatReportUnit, type LabReportResult,
} from "./report-pdf";
import { resultStorageValue } from "./result-presentation";

const reportResult = (analysisCode: string, analysis: string, group = "HEMATOLOGÍA"): LabReportResult => ({
  group,
  analysisCode,
  analysis,
  value: analysisCode === "HEM-WBC" ? "5000" : analysisCode === "HEM-PLT" ? "250000" : "5.3",
  unit: ["HEM-RBC", "HEM-WBC", "HEM-PLT"].includes(analysisCode)
    ? analysisCode === "HEM-RBC" ? "millones/µL" : "/µL"
    : "%",
  reference: analysisCode === "HEM-RBC"
    ? "4.0 - 5.9 millones/µL"
    : analysisCode === "HEM-WBC"
      ? "4,500 - 11,000 /µL"
      : analysisCode === "HEM-PLT"
        ? "150,000 - 400,000 /µL"
        : "0 - 100%",
  flag: "normal",
});

const orderedGroup = (groupOrder: number, results: LabReportResult[]) => results
  .map((result, index) => ({ ...result, groupOrder, analysisOrder: (index + 1) * 10 }));

describe("buildLabReportPdf", () => {
  it("respeta el título de una subsección creada en el catálogo", () => {
    const rows = buildReportTableRows([
      { ...reportResult("HEM-RBC", "HEMATIES"), subsection: "Serie roja" },
      { ...reportResult("HEM-HB", "HEMOGLOBINA"), subsection: "Serie roja" },
      { ...reportResult("HEM-WBC", "LEUCOCITOS"), subsection: "Serie blanca" },
    ]);

    expect(rows.map((row) => row.kind === "result" ? `R:${row.result.analysis}` : `S:${row.label}`)).toEqual([
      "S:SERIE ROJA",
      "R:HEMATIES",
      "R:HEMOGLOBINA",
      "S:SERIE BLANCA",
      "R:LEUCOCITOS",
    ]);
  });

  it("organiza hematología con el hemograma y su fórmula indentados", () => {
    const rows = buildReportTableRows([
      reportResult("HEM-RBC", "HEMATIES"),
      reportResult("HEM-HB", "HEMOGLOBINA"),
      reportResult("HEM-WBC", "LEUCOCITOS"),
      reportResult("HEM-ABA", "ABASTONADOS"),
      reportResult("HEM-LIN", "LINFOCITOS"),
      reportResult("HEM-PLT", "PLAQUETAS"),
      reportResult("HEM-VSG", "V.S.G."),
    ]);
    expect(rows.map((row) => row.kind === "result" ? `R:${row.result.analysis}:${row.indent}` : `${row.kind === "title" ? "T" : "S"}:${row.label}`)).toEqual([
      "S:HEMOGRAMA COMPLETO",
      "R:HEMATIES:1",
      "R:HEMOGLOBINA:1",
      "R:LEUCOCITOS:1",
      "R:ABASTONADOS:2",
      "R:LINFOCITOS:2",
      "R:PLAQUETAS:1",
      "R:V.S.G.:0",
    ]);
  });

  it("indenta los componentes de bilirrubina y proteínas en bioquímica", () => {
    const rows = buildReportTableRows([
      reportResult("BIO-BT", "B.TOTAL", "BIOQUÍMICA"),
      reportResult("BIO-BD", "B.DIRECTA", "BIOQUÍMICA"),
      reportResult("BIO-BI", "B.INDIRECTA", "BIOQUÍMICA"),
      reportResult("BIO-PROT", "PROTEINAS TOTALES", "BIOQUÍMICA"),
      reportResult("BIO-ALB", "ALBUMINA", "BIOQUÍMICA"),
      reportResult("BIO-GLOB", "GLOBULINAS", "BIOQUÍMICA"),
    ]);
    expect(rows.filter((row) => row.kind === "result").map((row) => [row.result.analysis, row.indent])).toEqual([
      ["B.TOTAL", 0], ["B.DIRECTA", 1], ["B.INDIRECTA", 1],
      ["PROTEINAS TOTALES", 0], ["ALBUMINA", 1], ["GLOBULINAS", 1],
    ]);
  });

  it("unifica subsecciones equivalentes y ordena los grupos del catálogo real", () => {
    const urineRows = buildReportTableRows([
      { ...reportResult("URO-CEL", "C.EPITELIALES", "UROANÁLISIS"), subsection: "Examen microscópico" },
      { ...reportResult("URO-HEMA", "HEMATIES", "UROANÁLISIS"), subsection: "Examen microscopico" },
      reportResult("URO-PIO", "PIOCITOS", "UROANÁLISIS"),
    ]);
    expect(urineRows.filter((row) => row.kind === "section").map((row) => row.label)).toEqual([
      "EXAMEN MICROSCÓPICO",
    ]);

    const immunologyRows = buildReportTableRows([
      reportResult("INM-FR", "F.REUMATOIDEO", "INMUNOLOGÍA"),
      reportResult("INM-PCR", "PCR", "INMUNOLOGÍA"),
      reportResult("INM-RPR", "RPR O VDRL", "INMUNOLOGÍA"),
      reportResult("INM-HIV", "PR HIV", "INMUNOLOGÍA"),
      reportResult("INM-TIF-O", "AGLUTINACIONES TIFICO O", "INMUNOLOGÍA"),
    ]);
    expect(immunologyRows.filter((row) => row.kind === "section").map((row) => row.label)).toEqual([
      "PRUEBAS REUMATOLÓGICAS", "PRUEBAS SEROLÓGICAS", "PRUEBAS RÁPIDAS", "AGLUTINACIONES",
    ]);

    const vaginalRows = buildReportTableRows([
      reportResult("VAG-AMIN", "TEST DE AMINAS", "SECRECIÓN VAGINAL"),
      reportResult("VAG-PH", "PH", "SECRECIÓN VAGINAL"),
      reportResult("VAG-TRI", "TRICHOMONAS", "SECRECIÓN VAGINAL"),
    ]);
    expect(vaginalRows.filter((row) => row.kind === "section").map((row) => row.label)).toEqual([
      "PRUEBAS QUÍMICAS", "EXAMEN MICROSCÓPICO",
    ]);
  });

  it("organiza uroanálisis como examen completo con secciones clínicas", () => {
    const rows = buildReportTableRows([
      reportResult("URO-COLOR", "COLOR", "UROANÁLISIS"),
      reportResult("URO-DEN", "DENSIDAD", "UROANÁLISIS"),
      reportResult("URO-GLU", "GLUCOSA", "UROANÁLISIS"),
      reportResult("URO-NIT", "NITRITOS", "UROANÁLISIS"),
      reportResult("URO-CEL", "C.EPITELIALES", "UROANÁLISIS"),
      reportResult("URO-CIL", "CILINDROS", "UROANÁLISIS"),
    ]);
    expect(rows.map((row) => row.kind === "result" ? `R:${row.result.analysis}:${row.indent}` : `${row.kind === "title" ? "T" : "S"}:${row.label}`)).toEqual([
      "T:EXAMEN COMPLETO DE ORINA",
      "S:EXAMEN FÍSICO", "R:COLOR:1", "R:DENSIDAD:1",
      "S:EXAMEN QUÍMICO", "R:GLUCOSA:1", "R:NITRITOS:1",
      "S:EXAMEN MICROSCÓPICO", "R:C.EPITELIALES:1", "R:CILINDROS:1",
    ]);
  });

  it("evita repetir las unidades dentro de los valores normales", () => {
    expect(formatReportUnit("millones/µL", "HEM-RBC")).toBe("10^6/µL");
    expect(formatReportUnit("/µL", "HEM-WBC")).toBe("10^3/µL");
    expect(formatReportUnit("minutos")).toBe("min");
    expect(formatReportUnit("mm/1ra hora")).toBe("mm/h");
    expect(formatReportReference("4.0 - 5.9 millones/µL", "millones/µL", "HEM-RBC")).toBe("4.0 - 5.9");
    expect(formatReportReference("4,500 - 11,000 /µL", "/µL", "HEM-WBC")).toBe("4.5 - 11");
    expect(formatReportReference("150,000 - 400,000 /µL", "/µL", "HEM-PLT")).toBe("150 - 400");
    expect(formatReportReference("36% - 53%", "%")).toBe("36 - 53");
    expect(formatReportReference("Menos de 200 mg/dL", "mg/dL")).toBe("< 200");
    expect(formatReportReference("Hombres: 3.5 - 7.2 mg/dL\nMujeres: 2.6 - 6.0 mg/dL", "mg/dL"))
      .toBe("Hombres: 3.5 - 7.2\nMujeres: 2.6 - 6.0");
  });

  it("convierte la captura abreviada a la cifra que se guarda", () => {
    expect(resultStorageValue("5", "HEM-WBC")).toBe("5000");
    expect(resultStorageValue("5.5", "HEM-WBC")).toBe("5500");
    expect(resultStorageValue("250", "HEM-PLT")).toBe("250000");
    expect(resultStorageValue("5.33", "HEM-RBC")).toBe("5.33");
  });

  it("genera una muestra visual con todos los grupos jerarquizados", async () => {
    const logo = await readFile(path.join(process.cwd(), "public", "logo_laboratorio.png"));
    const hematology = [
      reportResult("HEM-RBC", "HEMATIES"), reportResult("HEM-HB", "HEMOGLOBINA"),
      reportResult("HEM-HCT", "HEMATOCRITO"), reportResult("HEM-WBC", "LEUCOCITOS"),
      reportResult("HEM-ABA", "ABASTONADOS"), reportResult("HEM-NEU", "SEGMENTADOS"),
      reportResult("HEM-EOS", "EOSINOFILOS"), reportResult("HEM-BAS", "BASOFILOS"),
      reportResult("HEM-MON", "MONOCITOS"), reportResult("HEM-LIN", "LINFOCITOS"),
      reportResult("HEM-PLT", "PLAQUETAS"), reportResult("HEM-GRF", "GRUPO Y FACTOR"),
      reportResult("HEM-TC", "T.C."), reportResult("HEM-TS", "T.S."), reportResult("HEM-VSG", "V.S.G."),
    ];
    const biochemistry = orderedGroup(20, [
      reportResult("BIO-GLU", "GLUCOSA", "BIOQUÍMICA"), reportResult("BIO-CHOL", "COLESTEROL TOTAL", "BIOQUÍMICA"),
      reportResult("BIO-HDL", "COLESTEROL HDL", "BIOQUÍMICA"), reportResult("BIO-LDL", "COLESTEROL LDL", "BIOQUÍMICA"),
      reportResult("BIO-TG", "TRIGLICERIDOS", "BIOQUÍMICA"), reportResult("BIO-BT", "BILIRRUBINA TOTAL", "BIOQUÍMICA"),
      reportResult("BIO-BD", "DIRECTA", "BIOQUÍMICA"), reportResult("BIO-BI", "INDIRECTA", "BIOQUÍMICA"),
      reportResult("BIO-PROT", "PROTEINAS TOTALES", "BIOQUÍMICA"), reportResult("BIO-ALB", "ALBUMINA", "BIOQUÍMICA"),
      reportResult("BIO-GLOB", "GLOBULINAS", "BIOQUÍMICA"), reportResult("BIO-TGO", "TRANSAMINASAS TGO", "BIOQUÍMICA"),
    ]);
    const immunology = orderedGroup(30, [
      reportResult("INM-FR", "F.REUMATOIDEO", "INMUNOLOGÍA"), reportResult("INM-PCR", "PCR", "INMUNOLOGÍA"),
      reportResult("INM-RPR", "RPR O VDRL", "INMUNOLOGÍA"), reportResult("INM-HIV", "PR HIV", "INMUNOLOGÍA"),
      reportResult("INM-HPI", "HELICOBACTER P.", "INMUNOLOGÍA"),
      reportResult("INM-TIF-O", "AGLUTINACIONES TIFICO O", "INMUNOLOGÍA"),
      reportResult("INM-TIF-H", "AGLUTINACIONES TIFICO H", "INMUNOLOGÍA"),
    ]);
    const urine = orderedGroup(40, [
      reportResult("URO-COLOR", "COLOR", "UROANÁLISIS"), reportResult("URO-ASP", "ASPECTO", "UROANÁLISIS"),
      reportResult("URO-REAC", "REACCION", "UROANÁLISIS"), reportResult("URO-GLU", "GLUCOSA", "UROANÁLISIS"),
      reportResult("URO-PRO", "PROTEÍNAS", "UROANÁLISIS"), reportResult("URO-CEL", "C.EPITELIALES", "UROANÁLISIS"),
      reportResult("URO-HEMA", "HEMATIES", "UROANÁLISIS"), reportResult("URO-PIO", "PIOCITOS", "UROANÁLISIS"),
    ]);
    const stool = orderedGroup(50, [
      reportResult("PAR-COLOR", "COLOR", "HECES"), reportResult("PAR-CONS", "CONSISTENCIA", "HECES"),
      { ...reportResult("HEC-PH", "PH", "HECES"), subsection: "Examen químico" },
      { ...reportResult("PAR-THE", "THEVENON", "HECES"), subsection: "Examen químico" },
      { ...reportResult("HEC-GRA", "GLOBULOS DE GRASA", "HECES"), subsection: "Examen microscópico" },
      { ...reportResult("HEC-PAR", "PARASITOS", "HECES"), subsection: "Examen parasitológico" },
      reportResult("PAR-M1", "N° MUESTRA 1°", "HECES"), reportResult("PAR-DIR", "METODO DIRECTO", "HECES"),
    ]);
    const vaginal = orderedGroup(70, [
      reportResult("VAG-AMIN", "TEST DE AMINAS", "SECRECIÓN VAGINAL"), reportResult("VAG-PH", "PH", "SECRECIÓN VAGINAL"),
      reportResult("VAG-TRI", "TRICHOMONAS", "SECRECIÓN VAGINAL"), reportResult("VAG-KOH", "HONGOS (KOH)", "SECRECIÓN VAGINAL"),
    ]);
    const bytes = await buildLabReportPdf({
      orderNumber: 4663,
      orderCode: "LAB-4663",
      orderedAt: "2026-08-11T16:20:00-05:00",
      patientName: "Paciente de prueba",
      documentNumber: "70421856",
      sex: "Femenino",
      age: "34 años",
      revision: 1,
      printedAt: "2026-08-11T16:30:00-05:00",
      results: [...orderedGroup(10, hematology), ...biochemistry, ...immunology, ...urine, ...stool, ...vaginal],
    }, logo);
    const pdf = await PDFDocument.load(bytes);
    expect(pdf.getPageCount()).toBeGreaterThanOrEqual(4);
    if (process.env.WRITE_REPORT_SAMPLE === "1") {
      const output = path.join(process.cwd(), "tmp", "pdfs");
      await mkdir(output, { recursive: true });
      await writeFile(path.join(output, "informe-laboratorio-estructurado.pdf"), bytes);
    }
  });

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

  it("aprovecha una misma página para grupos pequeños", async () => {
    const logo = await readFile(path.join(process.cwd(), "public", "logo_laboratorio.png"));
    const bytes = await buildLabReportPdf({
      orderNumber: 4664,
      orderedAt: "2026-08-11T16:20:00-05:00",
      patientName: "Paciente de prueba",
      documentNumber: "70421856",
      sex: "Femenino",
      age: "34 años",
      revision: 1,
      printedAt: "2026-08-11T16:30:00-05:00",
      results: [
        reportResult("HEM-VSG", "V.S.G."),
        reportResult("BIO-GLU", "GLUCOSA", "BIOQUÍMICA"),
        reportResult("OTR-GRAM", "COLORACIÓN GRAM", "OTROS"),
      ],
    }, logo);
    const pdf = await PDFDocument.load(bytes);
    expect(pdf.getPageCount()).toBe(1);
  });
});
