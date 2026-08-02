import { flagNumericResult } from "@/lib/clinical";
import type { AnalysisDefinition, LabData, LabOrder, Patient, ResultValue } from "@/lib/types";

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
  const index = data.patients.findIndex((item) =>
    item.id === patient.id || item.documentNumber === patient.documentNumber);
  const patients = [...data.patients];
  if (index >= 0) patients[index] = patient;
  else patients.unshift(patient);
  const orders = data.orders.map((order) => order.patientId === patient.id ? {
    ...order,
    patientName: patient.fullName,
    documentNumber: patient.documentNumber,
    patientBirthAt: patient.birthAt,
    patientSex: patient.sex,
    patientPhone: patient.phone,
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
  mutationId: string;
  actorName: string;
}) {
  const existing = input.data.orders.find((order) =>
    order.patientId === input.patient.id && sameClinicalDay(order.createdAt, input.occurredAt));
  const batchByGroup = new Map<string, string>();
  input.entries.forEach(({ analysis }) => {
    if (!batchByGroup.has(analysis.group)) batchByGroup.set(analysis.group, crypto.randomUUID());
  });
  const results: ResultValue[] = input.entries.map(({ analysis, value }) => {
    const numericValue = analysis.resultType === "numeric" ? Number(value) : undefined;
    const base: ResultValue = {
      id: crypto.randomUUID(),
      orderAnalysisId: crypto.randomUUID(),
      analysisVersionId: analysis.versionId,
      batchId: batchByGroup.get(analysis.group)!,
      registeredAt: input.occurredAt,
      analyte: analysis.name,
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
      performedBy: input.actorName,
      qualitativeOptions: analysis.qualitativeOptions,
    };
    return analysis.resultType === "numeric" && Number.isFinite(numericValue)
      ? { ...base, flag: flagNumericResult(numericValue!, base) }
      : base;
  });
  const order: LabOrder = existing ? {
    ...existing,
    groups: [...new Set([...existing.groups, ...input.entries.map((entry) => entry.analysis.group)])],
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
    patientBirthAt: input.patient.birthAt,
    patientSex: input.patient.sex,
    patientPhone: input.patient.phone,
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
