import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { AnalysisDefinition, AuditEvent, LabData, LabOrder, OrderStatus, Patient, ResultFlag } from "@/lib/types";

type PatientRow = { id: string; document_number: string; first_names: string; paternal_surname: string; maternal_surname: string | null; birth_date: string | null; sex: Patient["sex"] | null; phone: string | null };
type OrderRow = { id: string; order_number: number; patient_id: string; status: OrderStatus; ordered_at: string; validated_at: string | null; delivered_at: string | null; created_by: string };
type GroupRow = { id: string; name: string };
type AnalysisRow = { id: string; code: string; group_id: string; name: string; result_type: AnalysisDefinition["resultType"]; active: boolean };
type VersionRow = { id: string; analysis_id: string; version: number; unit: string | null; method: string | null; reference_ranges: unknown; effective_from: string; effective_to: string | null };
type OrderAnalysisRow = { id: string; order_id: string; analysis_id: string; analysis_version_id: string };
type RevisionRow = { id: string; order_id: string; revision: number; status: OrderStatus };
type ResultRow = { id: string; revision_id: string; order_analysis_id: string; numeric_value: number | null; text_value: string | null; qualitative_value: string | null; flag: ResultFlag; clinical_snapshot: Record<string, unknown> };
type ProfileRow = { id: string; full_name: string };
type AuditRow = { id: number; occurred_at: string; actor_id: string | null; action: string; entity_table: string; entity_id: string; before_values: unknown; after_values: unknown; reason: string | null };

const allowedStatuses = new Set<OrderStatus>(["draft", "pending_validation", "validated", "delivered", "cancelled"]);
const allowedFlags = new Set<ResultFlag>(["normal", "low", "high", "critical"]);

function referenceLabel(ranges: unknown) {
  if (!Array.isArray(ranges) || ranges.length === 0) return "Por definir";
  const range = ranges[0] as Record<string, unknown>;
  if (typeof range.label === "string") return range.label;
  if (range.low !== undefined && range.high !== undefined) return `${range.low} – ${range.high}`;
  return "Según edad y sexo";
}

export async function loadLabData(supabase: SupabaseClient): Promise<LabData> {
  const [
    patientsResult, ordersResult, groupsResult, analysesResult, versionsResult,
    orderAnalysesResult, revisionsResult, resultsResult, profilesResult, auditResult,
  ] = await Promise.all([
    supabase.from("patients").select("id,document_number,first_names,paternal_surname,maternal_surname,birth_date,sex,phone").is("archived_at", null),
    supabase.from("orders").select("id,order_number,patient_id,status,ordered_at,validated_at,delivered_at,created_by").order("ordered_at", { ascending: false }).limit(250),
    supabase.from("analysis_groups").select("id,name"),
    supabase.from("analyses").select("id,code,group_id,name,result_type,active"),
    supabase.from("analysis_versions").select("id,analysis_id,version,unit,method,reference_ranges,effective_from,effective_to").order("version", { ascending: false }),
    supabase.from("order_analyses").select("id,order_id,analysis_id,analysis_version_id"),
    supabase.from("result_revisions").select("id,order_id,revision,status").order("revision", { ascending: false }),
    supabase.from("result_values").select("id,revision_id,order_analysis_id,numeric_value,text_value,qualitative_value,flag,clinical_snapshot"),
    supabase.from("profiles").select("id,full_name"),
    supabase.from("audit_events").select("id,occurred_at,actor_id,action,entity_table,entity_id,before_values,after_values,reason").order("occurred_at", { ascending: false }).limit(100),
  ]);

  const patientRows = (patientsResult.data ?? []) as PatientRow[];
  const orderRows = (ordersResult.data ?? []) as OrderRow[];
  const groupRows = (groupsResult.data ?? []) as GroupRow[];
  const analysisRows = (analysesResult.data ?? []) as AnalysisRow[];
  const versionRows = (versionsResult.data ?? []) as VersionRow[];
  const orderAnalysisRows = (orderAnalysesResult.data ?? []) as OrderAnalysisRow[];
  const revisionRows = (revisionsResult.data ?? []) as RevisionRow[];
  const resultRows = (resultsResult.data ?? []) as ResultRow[];
  const profileRows = (profilesResult.data ?? []) as ProfileRow[];
  const auditRows = (auditResult.data ?? []) as AuditRow[];

  const groupsById = new Map(groupRows.map((row) => [row.id, row.name]));
  const analysesById = new Map(analysisRows.map((row) => [row.id, row]));
  const versionsById = new Map(versionRows.map((row) => [row.id, row]));
  const patientsById = new Map(patientRows.map((row) => [row.id, row]));
  const profilesById = new Map(profileRows.map((row) => [row.id, row.full_name]));
  const latestRevisionByOrder = new Map<string, RevisionRow>();
  revisionRows.forEach((row) => { if (!latestRevisionByOrder.has(row.order_id)) latestRevisionByOrder.set(row.order_id, row); });
  const resultsByRevision = new Map<string, ResultRow[]>();
  resultRows.forEach((row) => resultsByRevision.set(row.revision_id, [...(resultsByRevision.get(row.revision_id) ?? []), row]));
  const orderAnalysesByOrder = new Map<string, OrderAnalysisRow[]>();
  orderAnalysisRows.forEach((row) => orderAnalysesByOrder.set(row.order_id, [...(orderAnalysesByOrder.get(row.order_id) ?? []), row]));

  const patients: Patient[] = patientRows.map((row) => ({
    id: row.id,
    documentNumber: row.document_number,
    fullName: [row.first_names, row.paternal_surname, row.maternal_surname].filter(Boolean).join(" "),
    birthDate: row.birth_date ?? "",
    sex: row.sex ?? "U",
    phone: row.phone ?? undefined,
  }));

  const orders: LabOrder[] = orderRows.map((row) => {
    const patient = patientsById.get(row.patient_id);
    const selected = orderAnalysesByOrder.get(row.id) ?? [];
    const revision = latestRevisionByOrder.get(row.id);
    const revisionResults = revision ? resultsByRevision.get(revision.id) ?? [] : [];
    const resultByOrderAnalysis = new Map(revisionResults.map((result) => [result.order_analysis_id, result]));
    const groups = [...new Set(selected.map((item) => groupsById.get(analysesById.get(item.analysis_id)?.group_id ?? "")).filter((name): name is string => Boolean(name)))];
    const results = selected.flatMap((item) => {
      const result = resultByOrderAnalysis.get(item.id);
      if (!result) return [];
      const analysis = analysesById.get(item.analysis_id);
      const version = versionsById.get(item.analysis_version_id);
      const snapshot = result.clinical_snapshot ?? {};
      const value = result.numeric_value ?? result.qualitative_value ?? result.text_value ?? "";
      return [{
        id: result.id,
        analyte: String(snapshot.analysis_name ?? analysis?.name ?? "Análisis"),
        group: groupsById.get(analysis?.group_id ?? "") ?? "Sin grupo",
        value: String(value),
        numericValue: result.numeric_value ?? undefined,
        unit: String(snapshot.unit ?? version?.unit ?? ""),
        reference: String((snapshot.reference_range as Record<string, unknown> | null)?.label ?? referenceLabel(version?.reference_ranges)),
        flag: allowedFlags.has(result.flag) ? result.flag : "normal",
        method: String(snapshot.method ?? version?.method ?? ""),
      }];
    });
    const status = allowedStatuses.has(row.status) ? row.status : "draft";
    const turnaroundMinutes = row.validated_at ? Math.round((new Date(row.validated_at).getTime() - new Date(row.ordered_at).getTime()) / 60000) : undefined;
    return {
      id: row.id,
      code: `ORD-${new Date(row.ordered_at).getFullYear()}-${String(row.order_number).padStart(5, "0")}`,
      patientId: row.patient_id,
      patientName: patient ? [patient.first_names, patient.paternal_surname, patient.maternal_surname].filter(Boolean).join(" ") : "Paciente no disponible",
      documentNumber: patient?.document_number ?? "",
      createdAt: row.ordered_at,
      status,
      groups,
      responsible: profilesById.get(row.created_by) ?? "Sin asignar",
      turnaroundMinutes,
      results,
    };
  });

  const latestVersions = new Map<string, VersionRow>();
  versionRows.forEach((row) => { if (!latestVersions.has(row.analysis_id)) latestVersions.set(row.analysis_id, row); });
  const analyses: AnalysisDefinition[] = analysisRows.map((row) => {
    const version = latestVersions.get(row.id);
    return {
      id: row.id, code: row.code, name: row.name, group: groupsById.get(row.group_id) ?? "Sin grupo",
      resultType: row.result_type, unit: version?.unit ?? "", method: version?.method ?? "",
      reference: referenceLabel(version?.reference_ranges), active: row.active,
    };
  });

  const auditEvents: AuditEvent[] = auditRows.map((row) => ({
    id: String(row.id),
    occurredAt: row.occurred_at,
    actor: row.actor_id ? profilesById.get(row.actor_id) ?? "Usuario" : "Sistema",
    action: row.action,
    entity: `${row.entity_table}:${row.entity_id}`,
    summary: row.action === "insert" ? "Registro creado" : row.action === "update" ? "Registro actualizado" : row.action === "delete" ? "Registro eliminado" : row.action,
    reason: row.reason ?? undefined,
  }));

  const turnaround = orders.map((order) => order.turnaroundMinutes).filter((value): value is number => value !== undefined).sort((a, b) => a - b);
  const summary = {
    orders: orders.length,
    analyses: orderAnalysisRows.length,
    patients: new Set(orders.map((order) => order.patientId)).size,
    delivered: orders.filter((order) => order.status === "delivered").length,
    pendingValidation: orders.filter((order) => order.status === "pending_validation").length,
    criticalValues: resultRows.filter((result) => result.flag === "critical").length,
    medianTurnaroundMinutes: turnaround.length ? turnaround[Math.floor(turnaround.length / 2)] : null,
  };

  return { patients, orders, analyses, auditEvents, trend: [], summary };
}
