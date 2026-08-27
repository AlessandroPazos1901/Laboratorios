import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { PDFDocument } from "pdf-lib";
import { describe, expect, it } from "vitest";
import {
  buildLabReportPdf, buildReportTableRows, formatReportReference, formatReportUnit, headerLogoBoxes,
  REPORT_PAGE_SIZES, reportGeometry,
  type LabReportResult, type ReportPageSize,
} from "./report-pdf";
import { formatNumericResult } from "./clinical";
import { entryFullFigure, resultEntryValue, resultStorageValue } from "./result-presentation";

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

describe("membrete a dos piezas", () => {
  // Proporciones reales de los archivos del laboratorio.
  const izquierda = { width: 1205, height: 375 };
  const derecha = { width: 296, height: 351 };

  it("pega cada pieza a su margen y les da la misma altura", () => {
    const cajas = headerLogoBoxes(izquierda, derecha);
    expect(cajas.height).toBe(64);
    expect(cajas.left.x).toBe(42);
    // La derecha termina justo en el margen opuesto de una hoja Carta.
    expect(cajas.right.x + cajas.right.width).toBeCloseTo(570, 5);
  });

  it("no deja que las dos piezas se toquen", () => {
    const cajas = headerLogoBoxes(izquierda, derecha);
    expect(cajas.right.x).toBeGreaterThan(cajas.left.x + cajas.left.width);
  });

  it("encoge la altura si con imágenes anchas no cupieran de lado a lado", () => {
    const panoramica = { width: 2000, height: 200 };
    const cajas = headerLogoBoxes(panoramica, panoramica);
    expect(cajas.height).toBeLessThan(64);
    expect(cajas.left.width + cajas.right.width).toBeLessThanOrEqual(528);
    expect(cajas.right.x).toBeGreaterThan(cajas.left.x + cajas.left.width);
  });
});

const labLogos = async () => ({
  left: await readFile(path.join(process.cwd(), "public", "membrete-izquierda.png")),
  right: await readFile(path.join(process.cwd(), "public", "membrete-derecha.png")),
});

describe("tamaño de hoja", () => {
  const sizes: ReportPageSize[] = ["a5", "carta", "a4"];

  it("mantiene toda la geometría dentro de la hoja", () => {
    for (const size of sizes) {
      const geo = reportGeometry(size);
      expect(geo.margin).toBeGreaterThanOrEqual(28);
      expect(geo.columns[0]).toBe(geo.margin);
      expect(geo.columns.at(-1)).toBeCloseTo(geo.width - geo.margin, 5);
      // Columnas estrictamente crecientes: si dos se cruzaran, el texto de una
      // se dibujaría encima de la vecina.
      geo.columns.forEach((x, index) => index && expect(x).toBeGreaterThan(geo.columns[index - 1]));
      expect(geo.logoMaxHeight).toBeLessThanOrEqual(64);
      // El pie tiene que caber entero en la reserva inferior: si la sobrepasara,
      // la última fila de la tabla quedaría escrita encima.
      expect(geo.footerBaseline).toBeGreaterThan(8);
      expect(geo.footerBaseline + 8.5).toBeLessThanOrEqual(geo.bottomReserve);
      // La fila tiene que seguir siendo más alta que su interlineado, o dos
      // líneas seguidas se escribirían una encima de otra.
      expect(geo.rowMin).toBeGreaterThan(geo.rowLine);
      expect(geo.font(8.5)).toBeGreaterThanOrEqual(5);
      // Arriba solo puede recortarse aire, nunca hasta el borde imprimible.
      expect(geo.topMargin).toBeGreaterThanOrEqual(14);
      expect(geo.topMargin).toBeLessThanOrEqual(geo.margin);
    }
  });

  it("aprovecha más la hoja en A5 que si copiara las medidas de Carta", () => {
    const a5 = reportGeometry("a5");
    const carta = reportGeometry("carta");
    const bodyOf = (geo: ReturnType<typeof reportGeometry>) =>
      geo.height - geo.topMargin - geo.logoGap - geo.cardHeight - geo.cardGap - geo.bottomReserve;
    const comoCarta = a5.height - carta.margin - carta.logoGap - carta.cardHeight - carta.cardGap - carta.bottomReserve;
    // Al menos dos filas de 16pt ganadas, que es lo que evita la segunda hoja.
    expect(bodyOf(a5) - comoCarta).toBeGreaterThanOrEqual(32);
  });

  it("emite el PDF en el tamaño real del papel, sin encoger", async () => {
    const logo = await labLogos();
    for (const size of sizes) {
      const bytes = await buildLabReportPdf({
        orderNumber: 1,
        orderedAt: "2026-08-11T16:20:00-05:00",
        patientName: "Paciente con un nombre bastante largo para la tarjeta",
        documentNumber: "70421856",
        sex: "Femenino",
        age: "34 años",
        revision: 1,
        printedAt: "2026-08-11T16:30:00-05:00",
        results: orderedGroup(10, [reportResult("HEM-RBC", "HEMATIES"), reportResult("HEM-WBC", "LEUCOCITOS")]),
      }, logo, size);
      const page = (await PDFDocument.load(bytes)).getPage(0);
      const [width, height] = REPORT_PAGE_SIZES[size];
      expect(page.getWidth()).toBeCloseTo(width, 2);
      expect(page.getHeight()).toBeCloseTo(height, 2);
    }
  });
});

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

  it("agrupa un análisis rezagado con su subgrupo en vez de repetir el título", () => {
    const rows = buildReportTableRows([
      { ...reportResult("URO-COLOR", "COLOR", "UROANÁLISIS"), subsection: "Examen físico" },
      { ...reportResult("URO-ASP", "ASPECTO", "UROANÁLISIS"), subsection: "Examen físico" },
      { ...reportResult("URO-GLU", "GLUCOSA", "UROANÁLISIS"), subsection: "Examen bioquímico" },
      { ...reportResult("URO-REAC", "REACCION", "UROANÁLISIS"), subsection: "Examen físico" },
    ]);

    expect(rows.map((row) => row.kind === "result" ? `R:${row.result.analysis}` : `S:${row.label}`)).toEqual([
      "S:EXAMEN COMPLETO DE ORINA",
      "S:EXAMEN FÍSICO",
      "R:COLOR",
      "R:ASPECTO",
      "R:REACCION",
      "S:EXAMEN QUÍMICO",
      "R:GLUCOSA",
    ]);
  });

  it("cierra con los análisis sin subgrupo y no les pone título", () => {
    const rows = buildReportTableRows([
      { ...reportResult("GRA-LIB", "OBSERVACIONES", "GRAM") },
      { ...reportResult("GRA-CEL", "CÉLULAS CLAVE", "GRAM"), subsection: "Examen microscópico" },
    ]);

    expect(rows.map((row) => row.kind === "result" ? `R:${row.result.analysis}` : `S:${row.label}`)).toEqual([
      "S:EXAMEN MICROSCÓPICO",
      "R:CÉLULAS CLAVE",
      "R:OBSERVACIONES",
    ]);
    expect(rows.at(-1)).toMatchObject({ kind: "result", indent: 0 });
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

  it("imprime las unidades sin abreviar y sin repetirlas en los valores normales", () => {
    expect(formatReportUnit("millones/µL")).toBe("/µL");
    expect(formatReportUnit("/µL")).toBe("/µL");
    expect(formatReportUnit("minutos")).toBe("min");
    expect(formatReportUnit("mm/1ra hora")).toBe("mm/h");
    expect(formatReportReference("4.0 - 5.9 millones/µL", "millones/µL")).toBe("4,000,000 - 5,900,000");
    expect(formatReportReference("4,000,000 - 5,900,000 /µL", "millones/µL")).toBe("4,000,000 - 5,900,000");
    expect(formatReportReference("4,500 - 11,000 /µL", "/µL")).toBe("4,500 - 11,000");
    expect(formatReportReference("150,000 - 400,000 /µL", "/µL")).toBe("150,000 - 400,000");
    expect(formatReportReference("36% - 53%", "%")).toBe("36 - 53");
    expect(formatReportReference("Menos de 200 mg/dL", "mg/dL")).toBe("< 200");
    expect(formatReportReference("Hombres: 3.5 - 7.2 mg/dL\nMujeres: 2.6 - 6.0 mg/dL", "mg/dL"))
      .toBe("Hombres: 3.5 - 7.2\nMujeres: 2.6 - 6.0");
  });

  it("convierte la captura abreviada a la cifra que se guarda y de vuelta", () => {
    expect(resultStorageValue("5", "HEM-WBC")).toBe("5000");
    expect(resultStorageValue("5.5", "HEM-WBC")).toBe("5500");
    expect(resultStorageValue("250", "HEM-PLT")).toBe("250000");
    expect(resultStorageValue("5.33", "HEM-RBC")).toBe("5.33");
    expect(resultEntryValue("5000", "HEM-WBC")).toBe("5");
    expect(resultEntryValue("250000", "HEM-PLT")).toBe("250");
    expect(resultEntryValue("5.33", "HEM-RBC")).toBe("5.33");
    expect(resultEntryValue("1200", "BIO-GLU")).toBe("1200");
  });

  it("muestra la cifra completa con separador de miles", () => {
    expect(formatNumericResult("5000", "/µL")).toBe("5,000");
    expect(formatNumericResult("250000", "/µL")).toBe("250,000");
    expect(formatNumericResult("4.5", "millones/µL")).toBe("4,500,000");
  });

  it("anticipa en la captura la cifra que se guardará, solo donde la escala difiere", () => {
    expect(entryFullFigure("5000", "/µL", "HEM-WBC")).toBe("5,000 /µL");
    expect(entryFullFigure("250000", "/µL", "HEM-PLT")).toBe("250,000 /µL");
    expect(entryFullFigure("4.5", "millones/µL", "HEM-RBC")).toBe("4,500,000 /µL");
    expect(entryFullFigure("95", "mg/dL", "BIO-GLU")).toBe("");
    expect(entryFullFigure("", "/µL", "HEM-WBC")).toBe("");
  });

  it("genera una muestra visual con todos los grupos jerarquizados", async () => {
    const logo = {
      left: await readFile(path.join(process.cwd(), "public", "membrete-izquierda.png")),
      right: await readFile(path.join(process.cwd(), "public", "membrete-derecha.png")),
    };
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
    // Seis grupos y 54 análisis: el diseño compacto debe mantenerlos en pocas hojas.
    expect(pdf.getPageCount()).toBeLessThanOrEqual(3);
    if (process.env.WRITE_REPORT_SAMPLE === "1") {
      const output = path.join(process.cwd(), "tmp", "pdfs");
      await mkdir(output, { recursive: true });
      await writeFile(path.join(output, "informe-laboratorio-estructurado.pdf"), bytes);
      // Una muestra por tamaño: la revisión de A5 es visual, no automatizable.
      for (const size of ["a5", "carta", "a4"] as ReportPageSize[]) {
        await writeFile(
          path.join(output, `informe-${size}.pdf`),
          await buildLabReportPdf({
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
          }, logo, size),
        );
      }
    }
  });

  it("genera un informe válido y pagina análisis extensos", async () => {
    const logo = {
      left: await readFile(path.join(process.cwd(), "public", "membrete-izquierda.png")),
      right: await readFile(path.join(process.cwd(), "public", "membrete-derecha.png")),
    };
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
    expect(bytes.byteLength).toBeGreaterThan(logo.left.byteLength + logo.right.byteLength);
    if (process.env.WRITE_REPORT_SAMPLE === "1") {
      const output = path.join(process.cwd(), "tmp", "pdfs");
      await mkdir(output, { recursive: true });
      await writeFile(path.join(output, "informe-laboratorio-muestra.pdf"), bytes);
    }
  });

  it("mantiene un hemograma completo en una sola hoja", async () => {
    const logo = {
      left: await readFile(path.join(process.cwd(), "public", "membrete-izquierda.png")),
      right: await readFile(path.join(process.cwd(), "public", "membrete-derecha.png")),
    };
    const bytes = await buildLabReportPdf({
      orderNumber: 4665,
      orderedAt: "2026-08-11T16:20:00-05:00",
      patientName: "Paciente de prueba",
      documentNumber: "70421856",
      sex: "Femenino",
      age: "34 años",
      revision: 1,
      printedAt: "2026-08-11T16:30:00-05:00",
      results: orderedGroup(10, [
        reportResult("HEM-RBC", "HEMATIES"), reportResult("HEM-HB", "HEMOGLOBINA"),
        reportResult("HEM-HCT", "HEMATOCRITO"), reportResult("HEM-WBC", "LEUCOCITOS"),
        reportResult("HEM-ABA", "ABASTONADOS"), reportResult("HEM-NEU", "SEGMENTADOS"),
        reportResult("HEM-EOS", "EOSINOFILOS"), reportResult("HEM-BAS", "BASOFILOS"),
        reportResult("HEM-MON", "MONOCITOS"), reportResult("HEM-LIN", "LINFOCITOS"),
        reportResult("HEM-PLT", "PLAQUETAS"), reportResult("HEM-GRF", "GRUPO Y FACTOR"),
        reportResult("HEM-TC", "T.C."), reportResult("HEM-TS", "T.S."), reportResult("HEM-VSG", "V.S.G."),
      ]),
    }, logo);
    expect((await PDFDocument.load(bytes)).getPageCount()).toBe(1);
  });

  it("aprovecha una misma página para grupos pequeños", async () => {
    const logo = {
      left: await readFile(path.join(process.cwd(), "public", "membrete-izquierda.png")),
      right: await readFile(path.join(process.cwd(), "public", "membrete-derecha.png")),
    };
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
