import "server-only";

import type { PostgrestError, SupabaseClient } from "@supabase/supabase-js";
import { flagNumericResult, isMissingBatchSchema, numericLimits, referenceLabel, resultNumericLimits } from "@/lib/clinical";
import { formatDni } from "@/lib/patients";
import type { AnalysisDefinition, Analyst, CatalogGroup, CatalogSubsection, LabData, LabOrder, Patient, ResultFlag } from "@/lib/types";

type PatientRow = { id: number; full_name: string; birth_date: string | null; birth_time?: string | null; sex: Patient["sex"] | null; sync_version?: number };
type OrderRow = { id: string; order_number: number; patient_id: number; ordered_at: string; lock_version: number };
type GroupRow = { id: string; name: string; display_order: number; active: boolean };
type SubsectionRow = { id: string; group_id: string; name: string; display_order: number };
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
type OrderAnalysisRow = { id: string; order_id: string; analysis_id: string; analysis_version_id: string; batch_id: string | null; performed_by: string | null; analyst_id: string | null; display_order: number; created_at: string };
type AnalysisBatchRow = { id: string; order_id: string; group_id: string; registered_at: string };
type RevisionRow = { id: string; order_id: string; revision: number };
type ResultRow = { id: string; revision_id: string; order_analysis_id: string; numeric_value: number | null; text_value: string | null; qualitative_value: string | null; flag: Exclude<ResultFlag, "unreviewed">; clinical_snapshot: Record<string, unknown> };
type AnalystRow = { id: string; full_name: string; active: boolean };
type SettingsRow = { trade_name: string | null; report_footer: string | null };

const allowedFlags = new Set<Exclude<ResultFlag, "unreviewed">>(["normal", "low", "high", "critical"]);

/**
 * PostgREST recorta toda respuesta en `max-rows` (1000 en Supabase) y no avisa:
 * al pasar de mil filas, `result_values` y `order_analyses` llegaban truncados y
 * el ultimo registro del dia salia con los analisis pero con los valores en
 * blanco, tanto en la tabla como en lo que se mandaba a imprimir. Cada consulta
 * sin tope propio se pagina, y lleva `id` como ultimo criterio de orden para que
 * dos paginas no se solapen ni se salten una fila.
 */
const PAGE_SIZE = 1_000;

type PageableQuery<Row> = {
  range: (from: number, to: number) => PromiseLike<{ data: Row[] | null; error: PostgrestError | null }>;
};

async function selectAll<Row>(query: () => PageableQuery<Row>) {
  const rows: Row[] = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await query().range(from, from + PAGE_SIZE - 1);
    if (error) return { data: null, error };
    rows.push(...(data ?? []));
    if ((data?.length ?? 0) < PAGE_SIZE) return { data: rows, error: null };
  }
}

export async function loadLabData(
  supabase: SupabaseClient,
  options: { offlineWindowDays?: number } = {},
): Promise<LabData> {
  const patientColumns = "id,full_name,birth_date,birth_time,sex,sync_version";
  const ordersSince = options.offlineWindowDays
    ? new Date(Date.now() - options.offlineWindowDays * 24 * 60 * 60 * 1000).toISOString()
    : null;
  const ordersQuery = () => {
    const query = supabase
      .from("orders")
      .select("id,order_number,patient_id,ordered_at,lock_version")
      .neq("status", "cancelled")
      .order("ordered_at", { ascending: false })
      .order("id");
    return ordersSince ? query.gte("ordered_at", ordersSince) : query;
  };
  const [
    patientsResult, ordersResult, groupsResult, analysesResult, versionsResult,
    orderAnalysesResult, analysisBatchesResult, revisionsResult, resultsResult, analystsResult, settingsResult, subsectionsResult,
  ] = await Promise.all([
    selectAll(() => supabase.from("patients").select(patientColumns).order("id")),
    // Sin ventana offline basta el tope explicito de 250: cabe en una sola pagina.
    ordersSince ? selectAll(ordersQuery) : ordersQuery().limit(250),
    selectAll(() => supabase.from("analysis_groups").select("id,name,display_order,active").order("display_order").order("id")),
    selectAll(() => supabase.from("analyses").select("id,code,group_id,name,result_type,active,source_metadata").order("id")),
    selectAll(() => supabase.from("analysis_versions").select("id,analysis_id,version,sample_type,unit,method,decimals,qualitative_options,reference_ranges,critical_limits,effective_from,effective_to,clinical_status").order("version", { ascending: false }).order("id")),
    selectAll(() => supabase.from("order_analyses").select("id,order_id,analysis_id,analysis_version_id,batch_id,performed_by,analyst_id,display_order,created_at").order("display_order").order("id")),
    selectAll(() => supabase.from("order_analysis_batches").select("id,order_id,group_id,registered_at").order("registered_at", { ascending: false }).order("id")),
    selectAll(() => supabase.from("result_revisions").select("id,order_id,revision").order("revision", { ascending: false }).order("id")),
    selectAll(() => supabase.from("result_values").select("id,revision_id,order_analysis_id,numeric_value,text_value,qualitative_value,flag,clinical_snapshot").order("id")),
    selectAll(() => supabase.from("analysts").select("id,full_name,active").order("full_name").order("id")),
    supabase.from("lab_settings").select("trade_name,report_footer").eq("id", true).maybeSingle(),
    selectAll(() => supabase.from("analysis_subsections").select("id,group_id,name,display_order").order("display_order").order("id")),
  ]);

  // Never turn a failed clinical query into an empty collection. Doing so
  // would make a partial response look valid and overwrite the encrypted
  // offline snapshot with missing patients or results.
  const requiredResults = [
    patientsResult,
    ordersResult,
    groupsResult,
    analysesResult,
    versionsResult,
    analysisBatchesResult,
    revisionsResult,
    resultsResult,
    analystsResult,
    settingsResult,
  ];
  const requiredError = requiredResults.find((result) => result.error)?.error;
  if (requiredError) throw requiredError;

  const patientRows = (patientsResult.data ?? []) as unknown as PatientRow[];
  const orderRows = (ordersResult.data ?? []) as unknown as OrderRow[];
  const groupRows = (groupsResult.data ?? []) as GroupRow[];
  const analysisRows = (analysesResult.data ?? []) as AnalysisRow[];
  const versionRows = (versionsResult.data ?? []) as VersionRow[];
  let orderAnalysisRows = (orderAnalysesResult.data ?? []) as OrderAnalysisRow[];
  const analysisBatchRows = (analysisBatchesResult.data ?? []) as AnalysisBatchRow[];
  const revisionRows = (revisionsResult.data ?? []) as RevisionRow[];
  const resultRows = (resultsResult.data ?? []) as ResultRow[];
  const analystRows = (analystsResult.data ?? []) as AnalystRow[];
  const settings = settingsResult.data as SettingsRow | null;
  const subsectionRows = subsectionsResult.error ? [] : (subsectionsResult.data ?? []) as SubsectionRow[];

  if (orderAnalysesResult.error) {
    const missingPerformer = orderAnalysesResult.error.code === "42703"
      || orderAnalysesResult.error.code === "PGRST204"
      || orderAnalysesResult.error.message.includes("performed_by")
      || orderAnalysesResult.error.message.includes("analyst_id");
    if (missingPerformer) {
      const currentSchemaResult = await selectAll(() => supabase
        .from("order_analyses")
        .select("id,order_id,analysis_id,analysis_version_id,batch_id,display_order,created_at")
        .order("display_order")
        .order("id"));
      if (!currentSchemaResult.error) {
        orderAnalysisRows = (currentSchemaResult.data ?? []).map((row) => ({ ...row, performed_by: null, analyst_id: null })) as OrderAnalysisRow[];
      } else if (!isMissingBatchSchema(currentSchemaResult.error)) {
        throw currentSchemaResult.error;
      } else {
        const legacyResult = await selectAll(() => supabase
          .from("order_analyses")
          .select("id,order_id,analysis_id,analysis_version_id,display_order,created_at")
          .order("display_order")
          .order("id"));
        if (legacyResult.error) throw legacyResult.error;
        orderAnalysisRows = (legacyResult.data ?? []).map((row) => ({ ...row, batch_id: null, performed_by: null, analyst_id: null })) as OrderAnalysisRow[];
      }
    } else if (isMissingBatchSchema(orderAnalysesResult.error)) {
      const legacyResult = await selectAll(() => supabase
        .from("order_analyses")
        .select("id,order_id,analysis_id,analysis_version_id,display_order,created_at")
        .order("display_order")
        .order("id"));
      if (legacyResult.error) throw legacyResult.error;
      orderAnalysisRows = (legacyResult.data ?? []).map((row) => ({ ...row, batch_id: null, performed_by: null, analyst_id: null })) as OrderAnalysisRow[];
    } else {
      throw orderAnalysesResult.error;
    }
  }

  const groupsById = new Map(groupRows.map((row) => [row.id, row.name]));
  const analysesById = new Map(analysisRows.map((row) => [row.id, row]));
  const versionsById = new Map(versionRows.map((row) => [row.id, row]));
  const patientsById = new Map(patientRows.map((row) => [row.id, row]));
  const analystsById = new Map(analystRows.map((row) => [row.id, row.full_name]));
  const batchesById = new Map(analysisBatchRows.map((row) => [row.id, row]));
  const latestRevisionByOrder = new Map<string, RevisionRow>();
  revisionRows.forEach((row) => { if (!latestRevisionByOrder.has(row.order_id)) latestRevisionByOrder.set(row.order_id, row); });
  const resultsByRevision = new Map<string, ResultRow[]>();
  resultRows.forEach((row) => resultsByRevision.set(row.revision_id, [...(resultsByRevision.get(row.revision_id) ?? []), row]));
  const orderAnalysesByOrder = new Map<string, OrderAnalysisRow[]>();
  orderAnalysisRows.forEach((row) => orderAnalysesByOrder.set(row.order_id, [...(orderAnalysesByOrder.get(row.order_id) ?? []), row]));

  const patients: Patient[] = patientRows.map((row) => ({
    id: row.id,
    documentNumber: formatDni(row.id),
    fullName: row.full_name,
    birthDate: row.birth_date ?? "",
    birthTime: row.birth_time ?? undefined,
    sex: row.sex ?? "U",
    syncVersion: row.sync_version ?? 1,
  }));

  if (orderRows.some((row) => !patientsById.has(row.patient_id))) {
    throw new Error("patient_replica_incomplete");
  }

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
      const limits = isHistoricalUnreviewed ? {} : resultNumericLimits(snapshot, version);
      const storedFlag: ResultFlag = isHistoricalUnreviewed
        ? "unreviewed"
        : result && allowedFlags.has(result.flag) ? result.flag : "normal";
      // La base marca según los intervalos que tenga cargados; mientras el catálogo
      // solo apruebe la etiqueta, se evalúa aquí. Un aviso de la base siempre manda.
      const resultFlag: ResultFlag = storedFlag === "normal" && typeof result?.numeric_value === "number"
        ? flagNumericResult(result.numeric_value, limits)
        : storedFlag;
      const value = result?.numeric_value ?? result?.qualitative_value ?? result?.text_value ?? "";
      return [{
        id: result?.id ?? item.id,
        orderAnalysisId: item.id,
        analysisVersionId: item.analysis_version_id,
        batchId: item.batch_id ?? `legacy:${item.order_id}:${analysis.group_id}`,
        registeredAt: (item.batch_id ? batchesById.get(item.batch_id)?.registered_at : null) ?? item.created_at,
        analyte: String(snapshot.analysis_name ?? analysis?.name ?? "Análisis"),
        analysisCode: analysis.code,
        group: groupsById.get(analysis?.group_id ?? "") ?? "Sin grupo",
        resultType: analysis.result_type,
        value: String(value),
        numericValue: result?.numeric_value ?? undefined,
        unit: String(snapshot.unit ?? version?.unit ?? ""),
        reference: isHistoricalUnreviewed
          ? "Histórico · no evaluado"
          : String((snapshot.reference_range as Record<string, unknown> | null)?.label ?? referenceLabel(version?.reference_ranges)),
        ...limits,
        flag: resultFlag,
        method: isHistoricalUnreviewed
          ? "Importado del Excel"
          : String(snapshot.method ?? version?.method ?? ""),
        analystId: item.analyst_id ?? undefined,
        performedBy: analystsById.get(item.analyst_id ?? "") ?? "Analista no disponible",
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
      documentNumber: patient ? formatDni(patient.id) : "",
      patientBirthDate: patient?.birth_date ?? "",
      patientBirthTime: patient?.birth_time ?? undefined,
      patientSex: patient?.sex ?? "U",
      createdAt: row.ordered_at,
      groups,
      responsible: [...new Set(results.map((result) => result.performedBy))].join(", ") || "Sin asignar",
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
      id: row.id, groupId: row.group_id, versionId: version?.id ?? "", code: row.code, name: row.name, group: groupsById.get(row.group_id) ?? "Sin grupo",
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

  const analysts: Analyst[] = analystRows.map((row) => ({
    id: row.id,
    fullName: row.full_name,
    active: row.active,
  }));

  const catalogSubsections: CatalogSubsection[] = subsectionRows.length
    ? subsectionRows.map((row) => ({ id: row.id, groupId: row.group_id, group: groupsById.get(row.group_id) ?? "Sin grupo", name: row.name, displayOrder: row.display_order }))
    : [...new Map(analyses.filter((analysis) => analysis.subsection && analysis.groupId).map((analysis) => [
        `${analysis.groupId}:${analysis.subsection!.toLocaleLowerCase("es")}`,
        { id: `legacy:${analysis.groupId}:${analysis.subsection}`, groupId: analysis.groupId!, group: analysis.group, name: analysis.subsection!, displayOrder: analysis.pickerOrder ?? 999 },
      ])).values()];
  const catalogGroups: CatalogGroup[] = groupRows.map((row) => ({
    id: row.id,
    name: row.name,
    displayOrder: row.display_order,
    active: row.active,
  }));

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
    catalogGroups,
    catalogSubsections,
    analysts,
    trend: [],
    summary,
    reportSettings: {
      tradeName: settings?.trade_name ?? "Laboratorio Jose",
      footer: settings?.report_footer ?? "Resultados para evaluación por el profesional tratante.",
    },
  };
}
