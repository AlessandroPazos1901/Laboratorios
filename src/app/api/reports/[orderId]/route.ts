import { readFile } from "node:fs/promises";
import path from "node:path";
import { NextResponse } from "next/server";
import { formatPatientAgeAt } from "@/lib/clinical";
import { buildLabReportPdf, type LabReportResult } from "@/lib/report-pdf";
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
  const body = await request.json().catch(() => null) as { expectedLockVersion?: unknown; group?: unknown; batchId?: unknown } | null;
  const expectedLockVersion = Number(body?.expectedLockVersion);
  const targetGroup = typeof body?.group === "string" ? body.group.trim() : "";
  const targetBatch = typeof body?.batchId === "string" && UUID.test(body.batchId) ? body.batchId : "";
  if (!Number.isInteger(expectedLockVersion) || expectedLockVersion < 0) {
    return NextResponse.json({ error: "Versión de registro inválida." }, { status: 400 });
  }
  if (body?.batchId !== undefined && !targetBatch) {
    return NextResponse.json({ error: "Tanda de análisis inválida." }, { status: 400 });
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
    supabase.from("patients").select("full_name,document_number,birth_date,birth_at,sex").eq("id", order.patient_id).single(),
    supabase.from("result_revisions").select("id,revision").eq("order_id", order.id).order("revision", { ascending: false }).limit(1).single(),
    supabase.from("order_analyses").select("id,analysis_id,analysis_version_id,batch_id,display_order").eq("order_id", order.id).order("display_order"),
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
    const group = groupById.get(analysis.group_id)?.name ?? "Otros";
    if (targetBatch && item.batch_id !== targetBatch) return [];
    if (targetGroup && group !== targetGroup) return [];
    const snapshot = (value.clinical_snapshot ?? {}) as Record<string, unknown>;
    return [{
      group,
      analysis: String(snapshot.analysis_name ?? analysis.name),
      value: String(resultText(value)),
      unit: String(snapshot.unit ?? ""),
      reference: snapshot.historical_unreviewed === true
        ? "Histórico · no evaluado"
        : String((snapshot.reference_range as Record<string, unknown> | null)?.label ?? ""),
      flag: snapshot.historical_unreviewed === true ? "unreviewed" : value.flag,
    }];
  });

  const selectedCount = targetBatch
    ? selected.filter((item) => item.batch_id === targetBatch).length
    : targetGroup
    ? selected.filter((item) => {
        const analysis = analysisById.get(item.analysis_id);
        return analysis && (groupById.get(analysis.group_id)?.name ?? "Otros") === targetGroup;
      }).length
    : selected.length;
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
    documentNumber: patientResult.data.document_number,
    sex: ({ F: "Femenino", M: "Masculino", X: "Otro", U: "No registrado" } as Record<string, string>)[patientResult.data.sex ?? "U"] ?? "No registrado",
    age: formatPatientAgeAt(patientResult.data.birth_at ?? patientResult.data.birth_date ?? "", order.ordered_at),
    revision: revision.revision,
    printedBy: profileResult.data?.full_name ?? "Usuario del laboratorio",
    footer: settingsResult.data?.report_footer || "Resultados para evaluación por el profesional tratante.",
    results: printable,
  }, logoBytes);
  const printResult = targetBatch
    ? await supabase.rpc("record_order_batch_print", {
        target_order: order.id,
        target_batch: targetBatch,
        expected_lock_version: expectedLockVersion,
      })
    : targetGroup
    ? await supabase.rpc("record_order_group_print", {
        target_order: order.id,
        target_group: targetGroup,
        expected_lock_version: expectedLockVersion,
      })
    : await supabase.rpc("record_order_print", {
        target_order: order.id,
        expected_lock_version: expectedLockVersion,
      });
  if (printResult.error) {
    return NextResponse.json({ error: printResult.error.message }, { status: 409 });
  }

  const updatedOrder = printResult.data as { status?: string; lock_version?: number } | null;
  return new NextResponse(Buffer.from(bytes), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="informe-${clean(printable[0]?.group || targetGroup || "laboratorio").replace(/[^a-zA-Z0-9-]+/g, "-").toLowerCase()}.pdf"`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
      "X-Order-Status": updatedOrder?.status ?? order.status,
      "X-Lock-Version": String(updatedOrder?.lock_version ?? expectedLockVersion),
    },
  });
}
