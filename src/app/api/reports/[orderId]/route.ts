import { readFile } from "node:fs/promises";
import path from "node:path";
import { NextResponse } from "next/server";
import { formatPatientAgeAt } from "@/lib/clinical";
import { buildLabReportPdf, type LabReportResult } from "@/lib/report-pdf";
import { formatDni } from "@/lib/patients";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const clean = (value: unknown) => String(value ?? "").replace(/[^\u0020-\u007e\u00a0-\u00ff]/g, "-");

type PrintableResult = LabReportResult;

function resultText(row: { numeric_value: number | null; qualitative_value: string | null; text_value: string | null }) {
  return row.numeric_value ?? row.qualitative_value ?? row.text_value ?? "";
}

export async function POST(request: Request, context: { params: Promise<{ orderId: string }> }) {
  const { orderId } = await context.params;
  if (!UUID.test(orderId)) return NextResponse.json({ error: "Identificador inválido." }, { status: 400 });
  const body = await request.json().catch(() => null) as { group?: unknown; batchId?: unknown; resultIds?: unknown } | null;
  const targetGroup = typeof body?.group === "string" ? body.group.trim() : "";
  const targetBatch = typeof body?.batchId === "string" && UUID.test(body.batchId) ? body.batchId : "";
  const resultIds = Array.isArray(body?.resultIds)
    && body.resultIds.every((id) => typeof id === "string" && UUID.test(id))
    ? [...new Set(body.resultIds as string[])]
    : null;
  if (body?.batchId !== undefined && !targetBatch) {
    return NextResponse.json({ error: "Tanda de análisis inválida." }, { status: 400 });
  }
  if (!resultIds?.length) {
    return NextResponse.json({ error: "Selecciona al menos un análisis para imprimir." }, { status: 400 });
  }

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Sesión requerida." }, { status: 401 });

  const { data: order } = await supabase
    .from("orders")
    .select("id,order_number,patient_id,ordered_at")
    .eq("id", orderId)
    .maybeSingle();
  if (!order) return NextResponse.json({ error: "Registro no encontrado." }, { status: 404 });

  const [
    patientResult,
    revisionResult,
    selectedResult,
    groupsResult,
    analysesResult,
  ] = await Promise.all([
    supabase.from("patients").select("id,full_name,birth_date,sex").eq("id", order.patient_id).single(),
    supabase.from("result_revisions").select("id,revision").eq("order_id", order.id).order("revision", { ascending: false }).limit(1).single(),
    supabase.from("order_analyses").select("id,analysis_id,analysis_version_id,batch_id,analyst_id,display_order").eq("order_id", order.id).order("display_order"),
    supabase.from("analysis_groups").select("id,name,display_order"),
    supabase.from("analyses").select("id,code,name,group_id,source_metadata"),
  ]);

  if (
    patientResult.error || revisionResult.error || selectedResult.error
    || groupsResult.error || analysesResult.error
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
  const includedResultIds = new Set(resultIds);
  const printable: PrintableResult[] = selected.flatMap((item) => {
    const analysis = analysisById.get(item.analysis_id);
    const value = valueBySelection.get(item.id);
    if (!analysis || !value) return [];
    const group = groupById.get(analysis.group_id)?.name ?? "Otros";
    if (targetBatch && item.batch_id !== targetBatch) return [];
    if (targetGroup && group !== targetGroup) return [];
    if (!includedResultIds.has(item.id)) return [];
    const snapshot = (value.clinical_snapshot ?? {}) as Record<string, unknown>;
    return [{
      group,
      analysisCode: analysis.code,
      analysis: String(snapshot.analysis_name ?? analysis.name),
      subsection: typeof (analysis.source_metadata as Record<string, unknown> | null)?.picker_subsection === "string"
        ? String((analysis.source_metadata as Record<string, unknown>).picker_subsection)
        : undefined,
      value: String(resultText(value)),
      unit: String(snapshot.unit ?? ""),
      reference: snapshot.historical_unreviewed === true
        ? "Histórico · no evaluado"
        : String((snapshot.reference_range as Record<string, unknown> | null)?.label ?? ""),
      flag: snapshot.historical_unreviewed === true ? "unreviewed" : value.flag,
      groupOrder: groupById.get(analysis.group_id)?.display_order ?? 999,
      analysisOrder: Number((analysis.source_metadata as Record<string, unknown> | null)?.picker_order ?? 999),
    }];
  });

  const selectedCount = targetBatch
    ? selected.filter((item) => item.batch_id === targetBatch && includedResultIds.has(item.id)).length
    : targetGroup
    ? selected.filter((item) => {
        const analysis = analysisById.get(item.analysis_id);
        return analysis && includedResultIds.has(item.id) && (groupById.get(analysis.group_id)?.name ?? "Otros") === targetGroup;
      }).length
    : selected.filter((item) => includedResultIds.has(item.id)).length;
  if (selectedCount === 0) {
    return NextResponse.json({ error: "El grupo seleccionado no pertenece a esta orden." }, { status: 404 });
  }
  if (printable.length !== selectedCount) {
    return NextResponse.json({ error: "Completa todos los resultados del grupo antes de imprimir." }, { status: 409 });
  }

  const logoBytes = await readFile(path.join(process.cwd(), "public", "logo_laboratorio.png"));
  const bytes = await buildLabReportPdf({
    orderNumber: order.order_number,
    orderedAt: order.ordered_at,
    patientName: patientResult.data.full_name,
    documentNumber: formatDni(patientResult.data.id),
    sex: ({ F: "Femenino", M: "Masculino", X: "Otro", U: "No registrado" } as Record<string, string>)[patientResult.data.sex ?? "U"] ?? "No registrado",
    age: formatPatientAgeAt(patientResult.data.birth_date ?? "", order.ordered_at),
    revision: revision.revision,
    printedAt: new Date().toISOString(),
    results: printable,
  }, logoBytes);
  return new NextResponse(Buffer.from(bytes), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="informe-${clean(printable[0]?.group || targetGroup || "laboratorio").replace(/[^a-zA-Z0-9-]+/g, "-").toLowerCase()}.pdf"`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
