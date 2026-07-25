import { PDFDocument, PDFFont, PDFPage, StandardFonts, rgb } from "pdf-lib";
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const LETTER: [number, number] = [612, 792];
const clean = (value: unknown) => String(value ?? "").replace(/[^\u0020-\u007e\u00a0-\u00ff]/g, "-");

type PrintableResult = {
  group: string;
  analysis: string;
  value: string;
  unit: string;
  reference: string;
  flag: string;
};

function resultText(row: { numeric_value: number | null; qualitative_value: string | null; text_value: string | null }) {
  return row.numeric_value ?? row.qualitative_value ?? row.text_value ?? "";
}

function flagLabel(flag: string) {
  return flag === "critical" ? "CRÍTICO" : flag === "high" ? "ALTO" : flag === "low" ? "BAJO" : "";
}

export async function POST(request: Request, context: { params: Promise<{ orderId: string }> }) {
  const { orderId } = await context.params;
  if (!UUID.test(orderId)) return NextResponse.json({ error: "Identificador inválido." }, { status: 400 });
  const body = await request.json().catch(() => null) as { expectedLockVersion?: unknown } | null;
  const expectedLockVersion = Number(body?.expectedLockVersion);
  if (!Number.isInteger(expectedLockVersion) || expectedLockVersion < 0) {
    return NextResponse.json({ error: "Versión de registro inválida." }, { status: 400 });
  }

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Sesión requerida." }, { status: 401 });

  const { data: order } = await supabase
    .from("orders")
    .select("id,order_number,patient_id,ordered_at,status")
    .eq("id", orderId)
    .maybeSingle();
  if (!order) return NextResponse.json({ error: "Registro no encontrado." }, { status: 404 });
  if (order.status === "cancelled") return NextResponse.json({ error: "Un registro anulado no se puede imprimir." }, { status: 409 });

  const [
    patientResult,
    revisionResult,
    selectedResult,
    groupsResult,
    analysesResult,
    settingsResult,
    profileResult,
  ] = await Promise.all([
    supabase.from("patients").select("full_name,document_number").eq("id", order.patient_id).single(),
    supabase.from("result_revisions").select("id,revision").eq("order_id", order.id).order("revision", { ascending: false }).limit(1).single(),
    supabase.from("order_analyses").select("id,analysis_id,analysis_version_id,display_order").eq("order_id", order.id).order("display_order"),
    supabase.from("analysis_groups").select("id,name,display_order"),
    supabase.from("analyses").select("id,name,group_id"),
    supabase.from("lab_settings").select("trade_name,report_footer").eq("id", true).maybeSingle(),
    supabase.from("profiles").select("full_name").eq("id", user.id).maybeSingle(),
  ]);

  if (
    patientResult.error || revisionResult.error || selectedResult.error
    || groupsResult.error || analysesResult.error || settingsResult.error
    || profileResult.error
  ) {
    return NextResponse.json({ error: "No se pudieron cargar los datos para impresión." }, { status: 500 });
  }

  const selected = selectedResult.data ?? [];
  const revision = revisionResult.data;
  const valuesResult = await supabase
    .from("result_values")
    .select("order_analysis_id,numeric_value,qualitative_value,text_value,flag,clinical_snapshot")
    .eq("revision_id", revision.id);
  if (valuesResult.error) {
    return NextResponse.json({ error: "No se pudieron cargar los resultados." }, { status: 500 });
  }
  const values = valuesResult.data;

  const groupById = new Map((groupsResult.data ?? []).map((group) => [group.id, group]));
  const analysisById = new Map((analysesResult.data ?? []).map((analysis) => [analysis.id, analysis]));
  const valueBySelection = new Map((values ?? []).map((value) => [value.order_analysis_id, value]));
  const printable: PrintableResult[] = selected.flatMap((item) => {
    const analysis = analysisById.get(item.analysis_id);
    const value = valueBySelection.get(item.id);
    if (!analysis || !value) return [];
    const snapshot = (value.clinical_snapshot ?? {}) as Record<string, unknown>;
    return [{
      group: groupById.get(analysis.group_id)?.name ?? "Otros",
      analysis: String(snapshot.analysis_name ?? analysis.name),
      value: String(resultText(value)),
      unit: String(snapshot.unit ?? ""),
      reference: String((snapshot.reference_range as Record<string, unknown> | null)?.label ?? ""),
      flag: value.flag,
    }];
  });

  if (printable.length !== selected.length) {
    return NextResponse.json({ error: "Completa todos los resultados antes de imprimir." }, { status: 409 });
  }

  const pdf = await PDFDocument.create();
  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const teal = rgb(0.03, 0.42, 0.40);
  const ink = rgb(0.09, 0.14, 0.17);
  const muted = rgb(0.38, 0.45, 0.48);
  const line = rgb(0.84, 0.88, 0.88);
  let page: PDFPage = pdf.addPage(LETTER);
  let firstPage = true;
  let y = 0;

  function addPage() {
    if (firstPage) firstPage = false;
    else page = pdf.addPage(LETTER);
    y = 744;
    page.drawText(clean(settingsResult.data?.trade_name || "Laboratorio clínico"), { x: 42, y, size: 16, font: bold, color: teal });
    page.drawText("RESULTADOS DE LABORATORIO", { x: 355, y: y + 1, size: 10, font: bold, color: ink });
    y -= 20;
    page.drawLine({ start: { x: 42, y }, end: { x: 570, y }, thickness: 1, color: teal });
    y -= 24;
  }

  function draw(text: string, x: number, size = 9, font: PDFFont = regular, color = ink) {
    page.drawText(clean(text), { x, y, size, font, color, maxWidth: 520 });
  }

  function ensureSpace(height: number) {
    if (y - height < 105) addPage();
  }

  addPage();
  draw(`Paciente: ${patientResult.data.full_name}`, 42, 10, bold);
  draw(`DNI: ${patientResult.data.document_number}`, 390, 9);
  y -= 18;
  draw(`Registro: N.º ${order.order_number}`, 42, 9);
  draw(`Fecha: ${new Date(order.ordered_at).toLocaleString("es-PE")}`, 250, 9);
  y -= 18;
  draw(`Revisión: ${revision.revision}`, 42, 8, regular, muted);
  y -= 24;

  const grouped = new Map<string, PrintableResult[]>();
  printable.forEach((result) => grouped.set(result.group, [...(grouped.get(result.group) ?? []), result]));
  for (const [group, results] of grouped) {
    ensureSpace(64);
    draw(group.toUpperCase(), 42, 10, bold, teal);
    y -= 17;
    draw("ANÁLISIS", 42, 7, bold, muted);
    draw("RESULTADO", 265, 7, bold, muted);
    draw("UNIDAD", 382, 7, bold, muted);
    draw("REFERENCIA", 452, 7, bold, muted);
    y -= 9;
    page.drawLine({ start: { x: 42, y }, end: { x: 570, y }, thickness: 0.6, color: line });
    y -= 15;
    for (const result of results) {
      ensureSpace(25);
      draw(result.analysis, 42, 9);
      const flag = flagLabel(result.flag);
      draw(`${result.value}${flag ? `  ${flag}` : ""}`, 265, 9, flag ? bold : regular, result.flag === "critical" ? rgb(0.70, 0.14, 0.17) : ink);
      draw(result.unit || "—", 382, 8);
      draw(result.reference || "—", 452, 8);
      y -= 19;
    }
    y -= 8;
  }

  ensureSpace(90);
  y -= 28;
  page.drawLine({ start: { x: 42, y }, end: { x: 245, y }, thickness: 0.7, color: muted });
  y -= 14;
  draw("Sello y firma del especialista", 42, 8, regular, muted);
  y -= 14;
  draw(`Impreso por: ${profileResult.data?.full_name ?? "Usuario del laboratorio"}`, 42, 8, regular, muted);

  const footer = clean(settingsResult.data?.report_footer || "Resultados para evaluación por el profesional tratante.");
  for (const outputPage of pdf.getPages()) {
    outputPage.drawText(footer, { x: 42, y: 35, size: 7, font: regular, color: muted, maxWidth: 528 });
  }

  const bytes = await pdf.save();
  const printResult = await supabase.rpc("record_order_print", {
    target_order: order.id,
    expected_lock_version: expectedLockVersion,
  });
  if (printResult.error) {
    return NextResponse.json({ error: printResult.error.message }, { status: 409 });
  }

  return new NextResponse(Buffer.from(bytes), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": 'inline; filename="informe-laboratorio.pdf"',
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
