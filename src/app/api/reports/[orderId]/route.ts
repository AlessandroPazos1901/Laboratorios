import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { NextResponse } from "next/server";
import { orders } from "@/lib/demo-data";
import { formatStatus } from "@/lib/clinical";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const pdfText = (value: string) => value.replace(/[^\u0020-\u007e\u00a0-\u00ff]/g, "-");

export async function GET(_request: Request, context: { params: Promise<{ orderId: string }> }) {
  const { orderId } = await context.params;
  if (!UUID.test(orderId)) return NextResponse.json({ error: "Identificador inválido." }, { status: 400 });
  if (process.env.NEXT_PUBLIC_DEMO_MODE !== "true") {
    return NextResponse.json({ error: "Conecte Supabase para generar informes clínicos autorizados." }, { status: 503 });
  }
  const order = orders.find((item) => item.id === orderId);
  if (!order) return NextResponse.json({ error: "Orden no encontrada." }, { status: 404 });
  if (order.status === "draft") return NextResponse.json({ error: "Una orden en borrador no puede emitirse." }, { status: 409 });

  const pdf = await PDFDocument.create();
  const page = pdf.addPage([595.28, 841.89]);
  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const { height } = page.getSize();
  const teal = rgb(0.03, 0.49, 0.48);
  const ink = rgb(0.09, 0.14, 0.17);
  const muted = rgb(0.38, 0.45, 0.48);
  let y = height - 55;
  const draw = (text: string, x: number, size = 9, font = regular, color = ink) => page.drawText(pdfText(text), { x, y, size, font, color });

  draw("LABORATORIO CLÍNICO JOSÉ", 42, 16, bold, teal);
  draw("INFORME DE RESULTADOS", 368, 12, bold, ink);
  y -= 22; draw("Documento demostrativo - datos ficticios", 42, 8, regular, muted);
  y -= 24; page.drawLine({ start: { x: 42, y }, end: { x: 553, y }, thickness: 1, color: teal });
  y -= 25; draw(`Paciente: ${order.patientName}`, 42, 10, bold);
  draw(`DNI: ${order.documentNumber}`, 360, 9);
  y -= 18; draw(`Orden: ${order.code}`, 42, 9);
  draw(`Ingreso: ${new Date(order.createdAt).toLocaleString("es-PE")}`, 230, 9);
  y -= 18; draw(`Estado: ${formatStatus(order.status)} · Versión 1`, 42, 9);
  y -= 28;

  for (const group of order.groups) {
    draw(group.toUpperCase(), 42, 10, bold, teal); y -= 18;
    draw("ANÁLISIS", 42, 8, bold, muted); draw("RESULTADO", 265, 8, bold, muted); draw("UNIDAD", 360, 8, bold, muted); draw("REFERENCIA", 425, 8, bold, muted); y -= 12;
    page.drawLine({ start: { x: 42, y }, end: { x: 553, y }, thickness: .5, color: rgb(.82,.86,.86) }); y -= 15;
    const results = order.results.filter((result) => result.group === group);
    if (!results.length) { draw("Sin resultados demostrativos en esta sección.", 42, 9, regular, muted); y -= 20; }
    for (const result of results) {
      draw(result.analyte, 42, 9);
      draw(`${result.value}${result.flag === "critical" ? "  CRÍTICO" : result.flag === "high" ? "  ALTO" : result.flag === "low" ? "  BAJO" : ""}`, 265, 9, result.flag === "normal" ? regular : bold, result.flag === "critical" ? rgb(.7,.14,.17) : ink);
      draw(result.unit, 360, 8); draw(result.reference, 425, 8); y -= 19;
    }
    y -= 10;
  }
  y = Math.max(y, 105);
  page.drawLine({ start: { x: 42, y }, end: { x: 230, y }, thickness: .6, color: muted });
  y -= 15; draw("Responsable de validación", 42, 8, regular, muted);
  y -= 14; draw(order.responsible, 42, 9, bold);
  page.drawText("Este informe no genera diagnósticos. Interpretar en el contexto clínico.", { x: 42, y: 40, size: 7, font: regular, color: muted });

  const bytes = await pdf.save();
  return new NextResponse(Buffer.from(bytes), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="informe-${order.code}.pdf"`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
