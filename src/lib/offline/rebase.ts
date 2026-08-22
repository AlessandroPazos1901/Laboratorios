import { flagNumericResult } from "@/lib/clinical";
import { formatDni } from "@/lib/patients";
import {
  materializePatient,
  materializeRegistration,
  materializeResultChanges,
  sameClinicalDay,
  type LocalRegistrationEntry,
} from "@/lib/offline/materialize";
import { materializeCatalog } from "@/lib/offline/materialize-catalog";
import { orderOperationsByDependencies } from "@/lib/offline/sync";
import type { CatalogOperation } from "@/lib/catalog-operations";
import type { OfflineOperation } from "@/lib/offline/types";
import type { LabData, Patient, ResultValue } from "@/lib/types";

/**
 * El servidor manda un snapshot completo, no un delta. Si se guardara tal cual,
 * borraría de la pantalla todo cambio que siga en la cola: la operación seguiría
 * encolada, pero su efecto desaparecería. Eso es lo que hacía que reordenar un
 * análisis se revirtiera solos segundos después.
 *
 * Aquí se vuelven a aplicar las operaciones pendientes sobre lo que llegó. Con la
 * cola vacía devuelve la misma referencia, así que el camino conectado no paga nada.
 */
export function rebaseSnapshot(
  remote: LabData,
  pending: OfflineOperation[],
  actorName = "",
): LabData {
  if (!pending.length) return remote;
  return orderOperationsByDependencies(pending.map((operation) => ({ operation })))
    .reduce((data, { operation }) => applyOperation(data, operation, actorName), remote);
}

function applyOperation(data: LabData, operation: OfflineOperation, actorName: string): LabData {
  try {
    switch (operation.kind) {
      case "patient.upsert":
      case "patient.update":
        return rebasePatient(data, operation);
      case "analysis.register":
        return rebaseRegistration(data, operation, actorName);
      case "results.save":
        return rebaseResults(data, operation);
      case "catalog.apply":
        // Una acción desconocida (equipo con versión más nueva) devuelve `undefined`;
        // sin esta red, un snapshot entero se quedaría vacío.
        return materializeCatalog(data, operation.payload as unknown as CatalogOperation) ?? data;
      default:
        return data;
    }
  } catch {
    // Una operación que ya no encaja con el catálogo o los datos actuales no debe
    // tumbar el resto del rebase: se deja tal cual y el push dirá qué pasa con ella.
    return data;
  }
}

type EntryPayload = { numeric_value?: unknown; qualitative_value?: unknown; text_value?: unknown };
type QueuedEntry = {
  order_analysis_id?: unknown;
  analysis_version_id?: unknown;
  analyst_id?: unknown;
  clear?: unknown;
  payload?: EntryPayload;
};

function entryValue(entry: QueuedEntry) {
  if (entry.clear === true) return "";
  const payload = entry.payload;
  if (!payload) return "";
  if ("numeric_value" in payload) return String(payload.numeric_value ?? "");
  if ("qualitative_value" in payload) return String(payload.qualitative_value ?? "").trim();
  if ("text_value" in payload) return String(payload.text_value ?? "").trim();
  return "";
}

function queuedEntries(operation: OfflineOperation): QueuedEntry[] {
  const entries = operation.payload.resultEntries;
  return Array.isArray(entries) ? entries as QueuedEntry[] : [];
}

function rebasePatient(data: LabData, operation: OfflineOperation): LabData {
  const payload = operation.payload as {
    patientId?: unknown; fullName?: unknown; birthDate?: unknown; sex?: unknown;
  };
  const id = Number(payload.patientId);
  if (!Number.isFinite(id)) return data;
  const existing = data.patients.find((item) => item.id === id);
  const patient: Patient = {
    id,
    documentNumber: existing?.documentNumber ?? formatDni(id),
    fullName: String(payload.fullName ?? existing?.fullName ?? ""),
    birthDate: (payload.birthDate as string | null) ?? existing?.birthDate ?? "",
    sex: (payload.sex as Patient["sex"] | null) ?? existing?.sex ?? "U",
    syncVersion: existing?.syncVersion ?? 1,
    syncState: "pending",
    clientMutationId: operation.clientMutationId,
  };
  return materializePatient(data, patient);
}

function rebaseRegistration(data: LabData, operation: OfflineOperation, actorName: string): LabData {
  const patientId = Number(operation.payload.patientId);
  const occurredAt = String(operation.payload.occurredAt ?? "");
  const patient = data.patients.find((item) => item.id === patientId);
  if (!patient || !occurredAt) return data;

  const entries = queuedEntries(operation);
  const versionIds = entries
    .map((entry) => String(entry.analysis_version_id ?? ""))
    .filter(Boolean);

  // Si el servidor ya la aplicó pero el equipo perdió la respuesta, la operación
  // sigue en cola. Volver a aplicarla duplicaría los resultados en pantalla.
  const alreadyApplied = versionIds.length > 0 && data.orders.some((order) =>
    order.patientId === patientId
    && sameClinicalDay(order.createdAt, occurredAt)
    && versionIds.every((versionId) => order.results.some((result) => result.analysisVersionId === versionId)));
  if (alreadyApplied) return data;

  const registrations = entries.flatMap<LocalRegistrationEntry>((entry) => {
    const analysis = data.analyses.find((item) => item.versionId === entry.analysis_version_id);
    const value = entryValue(entry);
    return analysis && value ? [{ analysis, value }] : [];
  });
  if (!registrations.length) return data;

  const analystId = String(entries.find((entry) => entry.analyst_id)?.analyst_id ?? "");
  const analyst = data.analysts.find((item) => item.id === analystId);

  return materializeRegistration({
    data,
    patient,
    occurredAt,
    entries: registrations,
    analyst: analyst ?? { id: analystId, fullName: actorName, active: true },
    mutationId: operation.clientMutationId,
    actorName,
  }).data;
}

function rebaseResults(data: LabData, operation: OfflineOperation): LabData {
  const orderId = String(operation.payload.orderId ?? "");
  const order = data.orders.find((item) => item.id === orderId);
  if (!order) return data;

  const queued = new Map(queuedEntries(operation)
    .filter((entry) => typeof entry.order_analysis_id === "string")
    .map((entry) => [entry.order_analysis_id as string, entryValue(entry)]));
  if (!queued.size) return data;

  const results = order.results.map<ResultValue>((result) => {
    if (!queued.has(result.orderAnalysisId)) return result;
    const value = queued.get(result.orderAnalysisId)!;
    const numericValue = result.resultType === "numeric" && value ? Number(value) : undefined;
    const next: ResultValue = { ...result, value, numericValue, flag: "normal" };
    return Number.isFinite(numericValue)
      ? { ...next, flag: flagNumericResult(numericValue!, next) }
      : next;
  });
  return materializeResultChanges(data, orderId, results);
}
