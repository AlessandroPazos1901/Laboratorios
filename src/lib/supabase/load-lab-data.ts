import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { isMissingBatchSchema } from "@/lib/clinical";
import type { AnalysisDefinition, LabData, LabOrder, Patient, ResultFlag } from "@/lib/types";

type PatientRow = { id: string; document_number: string; full_name: string; birth_date: string | null; birth_at: string | null; sex: Patient["sex"] | null; phone: string | null; sync_version?: number };
type OrderRow = { id: string; order_number: number; patient_id: string; ordered_at: string; created_by: string; lock_version: number };
type GroupRow = { id: string; name: string };
type AnalysisRow = {
  id: string;
  code: string;
  group_id: string;
  name: string;
  result_type: AnalysisDefinition["resultType"];
  active: boolean;
  source_metadata: Record<string, unknown> | null;
};
type VersionRow = {
  id: string;
  analysis_id: string;
  version: number;
  sample_type: string;
  unit: string | null;
  method: string | null;
  decimals: number | null;
  qualitative_options: unknown;
  reference_ranges: unknown;
  critical_limits: unknown;
  effective_from: string;
  effective_to: string | null;
  clinical_status: "approved" | "historical_unreviewed";
};
type OrderAnalysisRow = { id: string; order_id: string; analysis_id: string; analysis_version_id: string; batch_id: string | null; performed_by: string | null; display_order: number; created_at: string };
type AnalysisBatchRow = { id: string; order_id: string; group_id: string; registered_at: string };
type RevisionRow = { id: string; order_id: string; revision: number };
type ResultRow = { id: string; revision_id: string; order_analysis_id: string; numeric_value: number | null; text_value: string | null; qualitative_value: string | null; flag: Exclude<ResultFlag, "unreviewed">; clinical_snapshot: Record<string, unknown> };
type ProfileRow = { id: string; full_name: string };
type SettingsRow = { trade_name: string | null; report_footer: string | null };

const allowedFlags = new Set<Exclude<ResultFlag, "unreviewed">>(["normal", "low", "high", "critical"]);

function referenceLabel(ranges: unknown) {
  if (!Array.isArray(ranges) || ranges.length === 0) return "Por definir";
  const range = ranges[0] as Record<string, unknown>;
  if (typeof range.label === "string") return range.label;
  if (range.low !== undefined && range.high !== undefined) return `${range.low} – ${range.high}`;
  return "Según edad y sexo";
}

function numericLimits(ranges: unknown, criticalLimits: unknown) {
  const range = Array.isArray(ranges) && ranges.length ? ranges[0] as Record<string, unknown> : {};
  const critical = criticalLimits && typeof criticalLimits === "object" ? criticalLimits as Record<string, unknown> : {};
  const numberOrUndefined = (value: unknown) => typeof value === "number" && Number.isFinite(value) ? value : undefined;
  return {
    low: numberOrUndefined(range.low),
    high: numberOrUndefined(range.high),
    criticalLow: numberOrUndefined(critical.low),
    criticalHigh: numberOrUndefined(critical.high),
  };
}

export async function loadLabData(
  supabase: SupabaseClient,
  options: { offlineWindowDays?: number } = {},
): Promise<LabData> {
  const patientColumns = options.offlineWindowDays
    ? "id,document_number,full_name,birth_date,birth_at,sex,phone,sync_version"
    : "id,document_number,full_name,birth_date,birth_at,sex,phone";
  let ordersQuery = supabase
    .from("orders")
    .select("id,order_number,patient_id,ordered_at,created_by,lock_version")
    .neq("status", "cancelled")
    .order("ordered_at", { ascending: false });
  if (options.offlineWindowDays) {
    const since = new Date(Date.now() - options.offlineWindowDays * 24 * 60 * 60 * 1000).toISOString();
    ordersQuery = ordersQuery.gte("ordered_at", since).limit(5_000);
  } else {
    ordersQuery = ordersQuery.limit(250);
  }
  const [
    patientsResult, ordersResult, groupsResult, analysesResult, versionsResult,
    orderAnalysesResult, analysisBatchesResult, revisionsResult, resultsResult, profilesResult, settingsResult,
  ] = await Promise.all([
    supabase.from("patients").select(patientColumns).is("archived_at", null),
    ordersQuery,
    supabase.from("analysis_groups").select("id,name"),
    supabase.from("analyses").select("id,code,group_id,name,result_type,active,source_metadata"),
    supabase.from("analysis_versions").select("id,analysis_id,version,sample_type,unit,method,decimals,qualitative_options,reference_ranges,critical_limits,effective_from,effective_to,clinical_status").order("version", { ascending: false }),
    supabase.from("order_analyses").select("id,order_id,analysis_id,analysis_version_id,batch_id,performed_by,display_order,created_at").order("display_order"),
    supabase.from("order_analysis_batches").select("id,order_id,group_id,registered_at").order("registered_at", { ascending: false }),
    supabase.from("result_revisions").select("id,order_id,revision").order("revision", { ascending: false }),
    supabase.from("result_values").select("id,revision_id,order_analysis_id,numeric_value,text_value,qualitative_value,flag,clinical_snapshot"),
    supabase.from("profiles").select("id,full_name"),
    supabase.from("lab_settings").select("trade_name,report_footer").eq("id", true).maybeSingle(),
  ]);

  const patientRows = (patientsResult.data ?? []) as unknown as PatientRow[];
  const orderRows = (ordersResult.data ?? []) as OrderRow[];
  const groupRows = (groupsResult.data ?? []) as GroupRow[];
  const analysisRows = (analysesResult.data ?? []) as AnalysisRow[];
  const versionRows = (versionsResult.data ?? []) as VersionRow[];
  let orderAnalysisRows = (orderAnalysesResult.data ?? []) as OrderAnalysisRow[];
  const analysisBatchRows = (analysisBatchesResult.data ?? []) as AnalysisBatchRow[];
  const revisionRows = (revisionsResult.data ?? []) as RevisionRow[];
  const resultRows = (resultsResult.data ?? []) as ResultRow[];
  const profileRows = (profilesResult.data ?? []) as ProfileRow[];
  const settings = settingsResult.data as SettingsRow | null;

  if (orderAnalysesResult.error) {
    const missingPerformer = orderAnalysesResult.error.code === "42703"
      || orderAnalysesResult.error.code === "PGRST204"
      || orderAnalysesResult.error.message.includes("performed_by");
    if (missingPerformer) {
      const currentSchemaResult = await supabase
        .from("order_analyses")
        .select("id,order_id,analysis_id,analysis_version_id,batch_id,display_order,created_at")
        .order("display_order");
      if (!currentSchemaResult.error) {
        orderAnalysisRows = (currentSchemaResult.data ?? []).map((row) => ({ ...row, performed_by: null })) as OrderAnalysisRow[];
      } else if (!isMissingBatchSchema(currentSchemaResult.error)) {
        throw currentSchemaResult.error;
      } else {
        const legacyResult = await supabase
          .from("order_analyses")
          .select("id,order_id,analysis_id,analysis_version_id,display_order,created_at")
          .order("display_order");
        if (legacyResult.error) throw legacyResult.error;
        orderAnalysisRows = (legacyResult.data ?? []).map((row) => ({ ...row, batch_id: null, performed_by: null })) as OrderAnalysisRow[];
      }
    } else if (isMissingBatchSchema(orderAnalysesResult.error)) {
      const legacyResult = await supabase
        .from("order_analyses")
        .select("id,order_id,analysis_id,analysis_version_id,display_order,created_at")
        .order("display_order");
      if (legacyResult.error) throw legacyResult.error;
      orderAnalysisRows = (legacyResult.data ?? []).map((row) => ({ ...row, batch_id: null, performed_by: null })) as OrderAnalysisRow[];
    } else {
      throw orderAnalysesResult.error;
    }
  }

  const groupsById = new Map(groupRows.map((row) => [row.id, row.name]));
  const analysesById = new Map(analysisRows.map((row) => [row.id, row]));
  const versionsById = new Map(versionRows.map((row) => [row.id, row]));
  const patientsById = new Map(patientRows.map((row) => [row.id, row]));
  const profilesById = new Map(profileRows.map((row) => [row.id, row.full_name]));
  const batchesById = new Map(analysisBatchRows.map((row) => [row.id, row]));
  const latestRevisionByOrder = new Map<string, RevisionRow>();
  revisionRows.forEach((row) => { if (!latestRevisionByOrder.has(row.order_id)) latestRevisionByOrder.set(row.order_id, row); });
  const resultsByRevision = new Map<string, ResultRow[]>();
  resultRows.forEach((row) => resultsByRevision.set(row.revision_id, [...(resultsByRevision.get(row.revision_id) ?? []), row]));
  const orderAnalysesByOrder = new Map<string, OrderAnalysisRow[]>();
  orderAnalysisRows.forEach((row) => orderAnalysesByOrder.set(row.order_id, [...(orderAnalysesByOrder.get(row.order_id) ?? []), row]));

  const patients: Patient[] = patientRows.map((row) => ({
    id: row.id,
    documentNumber: row.document_number,
    fullName: row.full_name,
    birthDate: row.birth_date ?? "",
    birthAt: row.birth_at ?? (row.birth_date ? `${row.birth_date}T00:00:00` : ""),
    sex: row.sex ?? "U",
    phone: row.phone ?? undefined,
    syncVersion: row.sync_version ?? 1,
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
      const analysis = analysesById.get(item.analysis_id);
      const version = versionsById.get(item.analysis_version_id);
      if (!analysis || !version) return [];
      const snapshot = result?.clinical_snapshot ?? {};
      const isHistoricalUnreviewed = snapshot.historical_unreviewed === true;
      const resultFlag: ResultFlag = isHistoricalUnreviewed
        ? "unreviewed"
        : result && allowedFlags.has(result.flag) ? result.flag : "normal";
      const value = result?.numeric_value ?? result?.qualitative_value ?? result?.text_value ?? "";
      return [{
        id: result?.id ?? item.id,
        orderAnalysisId: item.id,
        analysisVersionId: item.analysis_version_id,
        batchId: item.batch_id ?? `legacy:${item.order_id}:${analysis.group_id}`,
        registeredAt: (item.batch_id ? batchesById.get(item.batch_id)?.registered_at : null) ?? item.created_at,
        analyte: String(snapshot.analysis_name ?? analysis?.name ?? "Análisis"),
        group: groupsById.get(analysis?.group_id ?? "") ?? "Sin grupo",
        resultType: analysis.result_type,
        value: String(value),
        numericValue: result?.numeric_value ?? undefined,
        unit: String(snapshot.unit ?? version?.unit ?? ""),
        reference: isHistoricalUnreviewed
          ? "Histórico · no evaluado"
          : String((snapshot.reference_range as Record<string, unknown> | null)?.label ?? referenceLabel(version?.reference_ranges)),
        flag: resultFlag,
        method: isHistoricalUnreviewed
          ? "Importado del Excel"
          : String(snapshot.method ?? version?.method ?? ""),
        performedBy: profilesById.get(item.performed_by ?? row.created_by) ?? "Usuario no disponible",
        qualitativeOptions: Array.isArray(version?.qualitative_options)
          ? version.qualitative_options.filter((option): option is string => typeof option === "string")
          : undefined,
      }];
    });
    return {
      id: row.id,
      revisionId: revision?.id ?? "",
      revisionNumber: revision?.revision ?? 1,
      lockVersion: row.lock_version,
      code: `ORD-${new Date(row.ordered_at).getFullYear()}-${String(row.order_number).padStart(5, "0")}`,
      patientId: row.patient_id,
      patientName: patient?.full_name ?? "Paciente no disponible",
      documentNumber: patient?.document_number ?? "",
      patientBirthAt: patient?.birth_at ?? (patient?.birth_date ? `${patient.birth_date}T00:00:00` : ""),
      patientSex: patient?.sex ?? "U",
      patientPhone: patient?.phone ?? undefined,
      createdAt: row.ordered_at,
      groups,
      responsible: profilesById.get(row.created_by) ?? "Sin asignar",
      results,
    };
  });

  const latestVersions = new Map<string, VersionRow>();
  versionRows.forEach((row) => {
    if (row.clinical_status === "approved" && !latestVersions.has(row.analysis_id)) {
      latestVersions.set(row.analysis_id, row);
    }
  });
  const analyses: AnalysisDefinition[] = analysisRows.map((row) => {
    const version = latestVersions.get(row.id);
    const metadata = row.source_metadata ?? {};
    const limits = numericLimits(version?.reference_ranges, version?.critical_limits);
    return {
      id: row.id, versionId: version?.id ?? "", code: row.code, name: row.name, group: groupsById.get(row.group_id) ?? "Sin grupo",
      resultType: row.result_type, unit: version?.unit ?? "", method: version?.method ?? "",
      reference: referenceLabel(version?.reference_ranges), active: row.active,
      sampleType: version?.sample_type,
      decimals: version?.decimals ?? undefined,
      qualitativeOptions: Array.isArray(version?.qualitative_options)
        ? version.qualitative_options.filter((option): option is string => typeof option === "string")
        : undefined,
      ...limits,
      subsection: typeof metadata.picker_subsection === "string" ? metadata.picker_subsection : undefined,
      common: typeof metadata.picker_common === "boolean" ? metadata.picker_common : undefined,
      pickerOrder: typeof metadata.picker_order === "number" ? metadata.picker_order : undefined,
    };
  });

  const summary = {
    orders: orders.length,
    analyses: orderAnalysisRows.length,
    patients: new Set(orders.map((order) => order.patientId)).size,
    criticalValues: resultRows.filter((result) => result.flag === "critical").length,
  };

  return {
    patients,
    orders,
    analyses,
    trend: [],
    summary,
    reportSettings: {
      tradeName: settings?.trade_name ?? "Laboratorio Jose",
      footer: settings?.report_footer ?? "Resultados para evaluación por el profesional tratante.",
    },
  };
}
