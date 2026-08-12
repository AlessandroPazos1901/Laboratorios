"use client";

import { createContext, useContext, useEffect, type ReactNode } from "react";
import { buildLabReportPdf } from "@/lib/report-pdf";
import { formatPatientAgeAt } from "@/lib/clinical";
import { patientIdFromDni } from "@/lib/patients";
import { createClient } from "@/lib/supabase/client";
import {
  activatePatientRoster,
  beginPatientRosterImport,
  cleanupInactivePatientRosters,
  commitOfflineMutation,
  discardPatientRosterImport,
  getPatientRosterMetadata,
  listOfflineOperations,
  searchPatientRoster,
  writePatientRosterBatch,
  type UnlockedVault,
} from "@/lib/offline/db";
import { previewPatientRosterFile, streamPatientRosterFile } from "@/lib/offline/patient-roster-client";
import {
  materializePatient,
  materializeRegistration,
  materializeResultChanges,
  type LocalRegistrationEntry,
} from "@/lib/offline/materialize";
import type { OfflineOperation, OfflineVaultSnapshot } from "@/lib/offline/types";
import type {
  PatientRosterImportResult,
  PatientRosterMapping,
  PatientRosterMetadata,
  PatientRosterPreview,
} from "@/lib/offline/patient-roster";
import type { Analyst, LabData, LabOrder, Patient, ResultValue } from "@/lib/types";

type CurrentUser = { id: string; fullName: string; role: string };

export type OfflineRepository = {
  enabled: boolean;
  online: boolean;
  savePatient(input: {
    documentNumber: string;
    fullName: string;
    birthDate?: string;
    sex?: Patient["sex"];
  }): Promise<Patient>;
  updatePatient(input: {
    patient: Patient;
    fullName: string;
    birthDate: string;
    sex: Patient["sex"];
  }): Promise<Patient>;
  registerAnalyses(input: {
    patient: Patient;
    occurredAt: string;
    analyst: Analyst;
    entries: LocalRegistrationEntry[];
  }): Promise<string>;
  saveResults(order: LabOrder, results: ResultValue[]): Promise<{ lockVersion: number; results: ResultValue[] }>;
  buildOfflineReport(order: LabOrder, batchId: string, includedResultIds: string[]): Promise<Blob | null>;
  previewPatientRoster(file: File): Promise<PatientRosterPreview>;
  importPatientRoster(input: {
    file: File;
    mapping: PatientRosterMapping;
    estimatedRows?: number;
    onProgress?(progress: { processed: number; total: number; imported: number; failed: number; phase: "importing" | "activating" }): void;
  }): Promise<PatientRosterImportResult>;
  getPatientRosterMetadata(): Promise<PatientRosterMetadata | null>;
  searchPatients(query: string, limit?: number): Promise<Patient[]>;
  refresh(): Promise<void>;
  requestSync(): void;
};

const RepositoryContext = createContext<OfflineRepository | null>(null);

function operationBase(session: UnlockedVault, user: CurrentUser, kind: OfflineOperation["kind"]): OfflineOperation {
  return {
    clientMutationId: crypto.randomUUID(),
    deviceId: session.meta.deviceId,
    actorId: user.id,
    kind,
    createdAt: new Date().toISOString(),
    dependencies: [],
    payload: {},
  };
}

export function OfflineRepositoryProvider(props: {
  children: ReactNode;
  data: LabData;
  currentUser: CurrentUser;
  session: UnlockedVault | null;
  online: boolean;
  setData(data: LabData): void;
  setSession(session: UnlockedVault): void;
  refresh(): Promise<void>;
  requestSync(): void;
}) {
  useEffect(() => {
    if (!props.session) return;
    void cleanupInactivePatientRosters(props.session).catch(() => undefined);
  }, [props.session]);

  const commit = async (nextData: LabData, operation: OfflineOperation, syncAfterCommit = false) => {
    if (!props.session) throw new Error("offline_vault_locked");
    const snapshot: OfflineVaultSnapshot = {
      data: nextData,
      currentUser: props.currentUser,
      updatedAt: new Date().toISOString(),
    };
    const updatedSession = await commitOfflineMutation(props.session, snapshot, operation);
    props.setSession(updatedSession);
    props.setData(nextData);
    if (syncAfterCommit) props.requestSync();
  };

  const repository: OfflineRepository = {
    enabled: Boolean(props.session),
    online: props.online,
    async savePatient(input) {
      if (!props.session) {
        const response = input.birthDate && input.sex
          ? await createClient().rpc("upsert_patient_with_demographics", {
              patient_dni: input.documentNumber,
              patient_name: input.fullName,
              patient_birth_date: input.birthDate,
              patient_sex: input.sex,
            })
          : await createClient().rpc("upsert_simple_patient", {
              patient_dni: input.documentNumber,
              patient_name: input.fullName,
            });
        if (response.error) throw response.error;
        await props.refresh();
        const row = response.data as { id: number; full_name?: string; birth_date?: string; sex?: Patient["sex"]; sync_version?: number };
        return {
          id: row.id,
          documentNumber: input.documentNumber,
          fullName: row.full_name ?? input.fullName,
          birthDate: row.birth_date ?? input.birthDate ?? "",
          sex: row.sex ?? input.sex ?? "U",
          syncVersion: row.sync_version ?? 1,
        };
      }
      const patientId = patientIdFromDni(input.documentNumber);
      if (patientId === null) throw new Error("invalid_dni");
      const existing = props.data.patients.find((patient) => patient.id === patientId);
      const operation = operationBase(props.session, props.currentUser, "patient.upsert");
      const patient: Patient = {
        id: patientId,
        documentNumber: input.documentNumber,
        fullName: input.fullName,
        birthDate: input.birthDate ?? existing?.birthDate ?? "",
        sex: input.sex ?? existing?.sex ?? "U",
        syncVersion: existing?.syncVersion ?? 1,
        syncState: "pending",
        clientMutationId: operation.clientMutationId,
      };
      operation.payload = {
        patientId: patient.id,
        fullName: patient.fullName,
        birthDate: patient.birthDate || null,
        sex: patient.sex === "U" ? null : patient.sex,
      };
      await commit(materializePatient(props.data, patient), operation, true);
      return patient;
    },
    async updatePatient(input) {
      if (!props.session) {
        const response = await createClient().rpc("update_patient_details", {
          target_patient: input.patient.id,
          patient_name: input.fullName,
          patient_birth_date: input.birthDate,
          patient_sex: input.sex,
        });
        if (response.error) throw response.error;
        await props.refresh();
        return { ...input.patient, fullName: input.fullName, birthDate: input.birthDate, sex: input.sex };
      }
      const operation = operationBase(props.session, props.currentUser, "patient.update");
      operation.baseVersion = input.patient.syncVersion ?? 1;
      operation.payload = {
        patientId: input.patient.id,
        fullName: input.fullName,
        birthDate: input.birthDate,
        sex: input.sex,
      };
      const patient: Patient = {
        ...input.patient,
        fullName: input.fullName,
        birthDate: input.birthDate,
        sex: input.sex,
        syncState: "pending",
        clientMutationId: operation.clientMutationId,
      };
      await commit(materializePatient(props.data, patient), operation);
      return patient;
    },
    async registerAnalyses(input) {
      const entries = input.entries.filter(({ value }) => value.trim().length > 0);
      if (!entries.length) throw new Error("analyses_required");
      if (!props.session) {
        const response = await createClient().rpc("register_daily_analyses", {
          target_patient: input.patient.id,
          occurred_at: input.occurredAt,
          result_entries: entries.map(({ analysis, value }) => ({
            analysis_version_id: analysis.versionId,
            analyst_id: input.analyst.id,
            payload: analysis.resultType === "numeric"
              ? { numeric_value: Number(value) }
              : analysis.resultType === "qualitative"
                ? { qualitative_value: value.trim() }
                : { text_value: value.trim() },
          })),
        });
        if (response.error) throw response.error;
        await props.refresh();
        return String((response.data as { order_id?: string } | null)?.order_id ?? "");
      }
      const operation = operationBase(props.session, props.currentUser, "analysis.register");
      if (input.patient.clientMutationId) operation.dependencies = [input.patient.clientMutationId];
      operation.payload = {
        patientId: input.patient.id,
        occurredAt: input.occurredAt,
        resultEntries: entries.map(({ analysis, value }) => ({
          analysis_version_id: analysis.versionId,
          analyst_id: input.analyst.id,
          payload: analysis.resultType === "numeric"
            ? { numeric_value: Number(value) }
            : analysis.resultType === "qualitative"
              ? { qualitative_value: value.trim() }
              : { text_value: value.trim() },
        })),
      };
      const materialized = materializeRegistration({
        data: props.data,
        patient: input.patient,
        occurredAt: input.occurredAt,
        entries,
        analyst: input.analyst,
        mutationId: operation.clientMutationId,
        actorName: props.currentUser.fullName,
      });
      await commit(materialized.data, operation, true);
      return materialized.order.id;
    },
    async saveResults(order, results) {
      if (!props.session) {
        const originalByAnalysis = new Map(order.results.map((result) => [result.orderAnalysisId, result.value]));
        const entries = results.filter((result) => result.value !== (originalByAnalysis.get(result.orderAnalysisId) ?? "")).map((result) => ({
          order_analysis_id: result.orderAnalysisId,
          ...(result.value.trim()
            ? { payload: result.resultType === "numeric" ? { numeric_value: Number(result.value) } : result.resultType === "qualitative" ? { qualitative_value: result.value.trim() } : { text_value: result.value.trim() } }
            : { clear: true }),
        }));
        const response = await createClient().rpc("save_result_batch", {
          target_revision: order.revisionId,
          result_entries: entries,
          expected_lock_version: order.lockVersion,
        });
        if (response.error) throw response.error;
        const saved = response.data as { lock_version: number; results: { order_analysis_id: string; id: string | null; flag: ResultValue["flag"] | null }[] };
        const savedByAnalysis = new Map(saved.results.map((item) => [item.order_analysis_id, item]));
        const next = results.map((result) => {
          const persisted = savedByAnalysis.get(result.orderAnalysisId);
          return persisted?.id ? { ...result, id: persisted.id, flag: persisted.flag ?? "normal" } : result;
        });
        await props.refresh();
        return { lockVersion: saved.lock_version, results: next };
      }
      const nextData = materializeResultChanges(props.data, order.id, results);
      const queued = await listOfflineOperations(props.session, ["pending", "blocked"]);
      if (order.clientMutationId) {
        const original = queued.find((item) => item.operation.clientMutationId === order.clientMutationId)?.operation;
        if (!original) throw new Error("offline_registration_missing");
        original.payload = {
          ...original.payload,
          resultEntries: results.map((result) => ({
            analysis_version_id: result.analysisVersionId,
            payload: result.resultType === "numeric"
              ? { numeric_value: Number(result.value) }
              : result.resultType === "qualitative"
                ? { qualitative_value: result.value.trim() }
                : { text_value: result.value.trim() },
          })),
        };
        await commit(nextData, original);
        return { lockVersion: order.lockVersion, results };
      }
      const pendingSave = queued.find(({ operation }) =>
        operation.kind === "results.save" && operation.payload.orderId === order.id);
      // Until it reaches the server, consecutive edits to the same order are one
      // desired final state. Reuse the mutation id so IndexedDB atomically replaces
      // the pending payload instead of creating operations with the same base version.
      const operation = pendingSave
        ? { ...pendingSave.operation, payload: { ...pendingSave.operation.payload } }
        : operationBase(props.session, props.currentUser, "results.save");
      operation.baseVersion = order.lockVersion;
      operation.payload = {
        orderId: order.id,
        targetRevision: order.revisionId,
        expectedLockVersion: order.lockVersion,
        resultEntries: results.map((result) => ({
          order_analysis_id: result.orderAnalysisId,
          ...(result.value.trim()
            ? { payload: result.resultType === "numeric" ? { numeric_value: Number(result.value) } : result.resultType === "qualitative" ? { qualitative_value: result.value.trim() } : { text_value: result.value.trim() } }
            : { clear: true }),
        })),
      };
      await commit(nextData, operation);
      return { lockVersion: order.lockVersion, results };
    },
    async buildOfflineReport(order, batchId, includedResultIds) {
      if (!props.session) return null;
      const included = new Set(includedResultIds);
      const results = order.results.filter((result) => result.batchId === batchId && included.has(result.orderAnalysisId));
      if (!results.length || results.some((result) => !result.value.trim())) throw new Error("all_batch_results_required");
      const analysisByVersion = new Map(props.data.analyses.map((analysis) => [analysis.versionId, analysis]));
      const logo = new Uint8Array(await (await fetch("/logo_laboratorio.png")).arrayBuffer());
      const bytes = await buildLabReportPdf({
        orderNumber: Number(order.code.match(/(\d+)$/)?.[1] ?? 0),
        orderCode: order.code,
        orderedAt: order.createdAt,
        patientName: order.patientName,
        documentNumber: order.documentNumber,
        sex: ({ F: "Femenino", M: "Masculino", X: "Otro", U: "No registrado" } as const)[order.patientSex],
        age: formatPatientAgeAt(order.patientBirthDate, order.createdAt),
        revision: order.revisionNumber ?? 1,
        printedAt: new Date().toISOString(),
        results: results.map((result) => ({
          group: result.group,
          analysisCode: result.analysisCode,
          analysis: result.analyte,
          subsection: result.analysisVersionId ? analysisByVersion.get(result.analysisVersionId)?.subsection : undefined,
          value: result.value,
          unit: result.unit,
          reference: result.reference,
          flag: result.flag,
        })),
      }, logo);
      return new Blob([bytes as BlobPart], { type: "application/pdf" });
    },
    async previewPatientRoster(file) {
      if (!props.session) throw new Error("Primero prepara este equipo para trabajar sin internet y luego ingresa tu PIN.");
      return previewPatientRosterFile(file);
    },
    async importPatientRoster(input) {
      if (!props.session) throw new Error("Primero prepara este equipo para trabajar sin internet y luego ingresa tu PIN.");
      const rosterId = crypto.randomUUID();
      try {
        await beginPatientRosterImport(props.session, rosterId);
        const estimate = await navigator.storage?.estimate?.().catch(() => undefined);
        const available = (estimate?.quota ?? 0) - (estimate?.usage ?? 0);
        const required = (input.estimatedRows ?? 0) * 400;
        if (available > 0 && required > available) {
          throw new Error(`No hay espacio suficiente. Libera al menos ${Math.ceil((required - available) / 1024 / 1024)} MB e inténtalo nuevamente.`);
        }
        const result = await streamPatientRosterFile({
          file: input.file,
          mapping: input.mapping,
          onBatch: (patients) => writePatientRosterBatch(props.session!, rosterId, patients),
          onProgress: (progress) => input.onProgress?.({ ...progress, phase: "importing" }),
        });
        input.onProgress?.({
          processed: result.total,
          total: result.total,
          imported: result.imported,
          failed: result.failed,
          phase: "activating",
        });
        const previousRosterId = await activatePatientRoster(props.session, {
          rosterId,
          fileName: input.file.name,
          sheetName: input.mapping.sheetName,
          count: result.imported,
          sourceRows: result.total,
          importedAt: new Date().toISOString(),
        });
        if (previousRosterId) void discardPatientRosterImport(props.session, previousRosterId).catch(() => undefined);
        return result;
      } catch (reason) {
        void discardPatientRosterImport(props.session, rosterId).catch(() => undefined);
        throw reason;
      }
    },
    async getPatientRosterMetadata() {
      return props.session ? getPatientRosterMetadata(props.session) : null;
    },
    async searchPatients(query, limit = 8) {
      if (!props.session) return [];
      return searchPatientRoster(props.session, query, limit);
    },
    refresh: props.refresh,
    requestSync: props.requestSync,
  };

  return <RepositoryContext.Provider value={repository}>{props.children}</RepositoryContext.Provider>;
}

export function useOfflineRepository() {
  return useContext(RepositoryContext);
}
