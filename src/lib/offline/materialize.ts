import { flagNumericResult } from "@/lib/clinical";
import type { SyncConflict } from "@/lib/offline/types";
import type { AnalysisDefinition, Analyst, LabData, LabOrder, Patient, ResultValue } from "@/lib/types";

export type ResultConflictDetail = {
  analysis: string;
  localValue: string;
  remoteValue: string;
  matches: boolean;
};

type ResultConflictEntry = {
  order_analysis_id?: unknown;
  clear?: unknown;
  payload?: {
    numeric_value?: unknown;
    qualitative_value?: unknown;
    text_value?: unknown;
  };
};

function normalizedConflictValue(value: unknown, numeric = false) {
  const text = String(value ?? "").trim();
  if (!numeric || !text) return text;
  const number = Number(text);
  return Number.isFinite(number) ? String(number) : text;
}

function localConflictValue(entry: ResultConflictEntry) {
  if (entry.clear === true) return { value: "", valid: true, numeric: false };
  const payload = entry.payload;
  if (!payload || typeof payload !== "object") return { value: "", valid: false, numeric: false };
  if ("numeric_value" in payload) return { value: normalizedConflictValue(payload.numeric_value, true), valid: true, numeric: true };
  if ("qualitative_value" in payload) return { value: normalizedConflictValue(payload.qualitative_value), valid: true, numeric: false };
  if ("text_value" in payload) return { value: normalizedConflictValue(payload.text_value), valid: true, numeric: false };
  return { value: "", valid: false, numeric: false };
}

export function resultConflictDetails(conflict: SyncConflict, data: LabData): ResultConflictDetail[] {
  if (conflict.kind !== "results.save") return [];
  const orderId = typeof conflict.local.orderId === "string" ? conflict.local.orderId : "";
  const entries = Array.isArray(conflict.local.resultEntries)
    ? conflict.local.resultEntries as ResultConflictEntry[]
    : [];
  const order = data.orders.find((item) => item.id === orderId);
  if (!order || !entries.length) return [];
  return entries.flatMap((entry) => {
    if (typeof entry.order_analysis_id !== "string") return [];
    const result = order.results.find((item) => item.orderAnalysisId === entry.order_analysis_id);
    const local = localConflictValue(entry);
    if (!result || !local.valid) return [];
    const remote = normalizedConflictValue(result.value, local.numeric || result.resultType === "numeric");
    return [{
      analysis: result.analyte,
      localValue: local.value,
      remoteValue: remote,
      matches: local.value === remote,
    }];
  });
}

export function resultConflictAlreadyApplied(conflict: SyncConflict, data: LabData) {
  if (conflict.kind !== "results.save") return false;
  const expectedEntries = Array.isArray(conflict.local.resultEntries) ? conflict.local.resultEntries.length : 0;
  const details = resultConflictDetails(conflict, data);
  return expectedEntries > 0 && details.length === expectedEntries && details.every((detail) => detail.matches);
}

export function withSummary(data: LabData): LabData {
  return {
    ...data,
    summary: {
      orders: data.orders.length,
      analyses: data.orders.reduce((total, order) => total + order.results.length, 0),
      patients: new Set(data.orders.map((order) => order.patientId)).size,
      criticalValues: data.orders.reduce(
        (total, order) => total + order.results.filter((result) => result.flag === "critical").length,
        0,
      ),
    },
  };
}

export function materializePatient(data: LabData, patient: Patient) {
  const index = data.patients.findIndex((item) => item.id === patient.id);
  const patients = [...data.patients];
  if (index >= 0) patients[index] = patient;
  else patients.unshift(patient);
  const orders = data.orders.map((order) => order.patientId === patient.id ? {
    ...order,
    patientName: patient.fullName,
    documentNumber: patient.documentNumber,
    patientBirthDate: patient.birthDate,
    patientSex: patient.sex,
  } : order);
  return withSummary({ ...data, patients, orders });
}

function sameClinicalDay(left: string, right: string) {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Lima", year: "numeric", month: "2-digit", day: "2-digit",
  });
  return formatter.format(new Date(left)) === formatter.format(new Date(right));
}

export type LocalRegistrationEntry = {
  analysis: AnalysisDefinition;
  value: string;
};

export function materializeRegistration(input: {
  data: LabData;
  patient: Patient;
  occurredAt: string;
  entries: LocalRegistrationEntry[];
  analyst: Analyst;
  mutationId: string;
  actorName: string;
}) {
  const entries = input.entries.filter(({ value }) => value.trim().length > 0);
  const existing = input.data.orders.find((order) =>
    order.patientId === input.patient.id && sameClinicalDay(order.createdAt, input.occurredAt));
  const batchByGroup = new Map<string, string>();
  entries.forEach(({ analysis }) => {
    if (!batchByGroup.has(analysis.group)) batchByGroup.set(analysis.group, crypto.randomUUID());
  });
  const results: ResultValue[] = entries.map(({ analysis, value }) => {
    const numericValue = analysis.resultType === "numeric" ? Number(value) : undefined;
    const base: ResultValue = {
      id: crypto.randomUUID(),
      orderAnalysisId: crypto.randomUUID(),
      analysisVersionId: analysis.versionId,
      batchId: batchByGroup.get(analysis.group)!,
      registeredAt: input.occurredAt,
      analyte: analysis.name,
      analysisCode: analysis.code,
      group: analysis.group,
      resultType: analysis.resultType,
      value,
      numericValue,
      unit: analysis.unit,
      reference: analysis.reference,
      low: analysis.low,
      high: analysis.high,
      criticalLow: analysis.criticalLow,
      criticalHigh: analysis.criticalHigh,
      flag: "normal",
      method: analysis.method,
      analystId: input.analyst.id,
      performedBy: input.analyst.fullName,
      qualitativeOptions: analysis.qualitativeOptions,
    };
    return analysis.resultType === "numeric" && Number.isFinite(numericValue)
      ? { ...base, flag: flagNumericResult(numericValue!, base) }
      : base;
  });
  const order: LabOrder = existing ? {
    ...existing,
    groups: [...new Set([...existing.groups, ...entries.map((entry) => entry.analysis.group)])],
    results: [...existing.results, ...results],
    syncState: "pending",
  } : {
    id: crypto.randomUUID(),
    revisionId: "",
    revisionNumber: 1,
    lockVersion: 1,
    code: `PEND-${input.occurredAt.slice(0, 10)}-${input.mutationId.slice(0, 6).toUpperCase()}`,
    patientId: input.patient.id,
    patientName: input.patient.fullName,
    documentNumber: input.patient.documentNumber,
    patientBirthDate: input.patient.birthDate,
    patientSex: input.patient.sex,
    createdAt: input.occurredAt,
    groups: [...batchByGroup.keys()],
    responsible: input.actorName,
    results,
    syncState: "pending",
    clientMutationId: input.mutationId,
  };
  const orders = existing
    ? input.data.orders.map((item) => item.id === existing.id ? order : item)
    : [order, ...input.data.orders];
  return { data: withSummary({ ...input.data, orders }), order };
}

export function materializeResultChanges(
  data: LabData,
  orderId: string,
  results: ResultValue[],
) {
  const orders = data.orders.map((order) => order.id === orderId
    ? { ...order, results, syncState: "pending" as const }
    : order);
  return withSummary({ ...data, orders });
}
