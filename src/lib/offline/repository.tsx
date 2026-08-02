"use client";

import { createContext, useContext, type ReactNode } from "react";
import { buildLabReportPdf } from "@/lib/report-pdf";
import { formatPatientAgeAt } from "@/lib/clinical";
import { createClient } from "@/lib/supabase/client";
import {
  commitOfflineMutation,
  listOfflineOperations,
  type UnlockedVault,
} from "@/lib/offline/db";
import {
  materializePatient,
  materializeRegistration,
  materializeResultChanges,
  type LocalRegistrationEntry,
} from "@/lib/offline/materialize";
import type { OfflineOperation, OfflineVaultSnapshot } from "@/lib/offline/types";
import type { LabData, LabOrder, Patient, ResultValue } from "@/lib/types";

type CurrentUser = { id: string; fullName: string; role: string };

export type OfflineRepository = {
  enabled: boolean;
  online: boolean;
  savePatient(input: {
    documentNumber: string;
    fullName: string;
    birthAt?: string;
    sex?: Patient["sex"];
    phone?: string;
  }): Promise<Patient>;
  updatePatient(input: {
    patient: Patient;
    fullName: string;
    birthAt: string;
    sex: Patient["sex"];
    phone?: string;
  }): Promise<Patient>;
  registerAnalyses(input: {
    patient: Patient;
    occurredAt: string;
    entries: LocalRegistrationEntry[];
  }): Promise<string>;
  saveResults(order: LabOrder, results: ResultValue[]): Promise<{ lockVersion: number; results: ResultValue[] }>;
  buildOfflineReport(order: LabOrder, batchId: string): Promise<Blob | null>;
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
  const commit = async (nextData: LabData, operation: OfflineOperation) => {
    if (!props.session) throw new Error("offline_vault_locked");
    const snapshot: OfflineVaultSnapshot = {
      data: nextData,
      currentUser: props.currentUser,
      updatedAt: new Date().toISOString(),
    };
    const updatedSession = await commitOfflineMutation(props.session, snapshot, operation);
    props.setSession(updatedSession);
    props.setData(nextData);
    props.requestSync();
  };

  const repository: OfflineRepository = {
    enabled: Boolean(props.session),
    online: props.online,
    async savePatient(input) {
      if (!props.session) {
        const response = input.birthAt && input.sex
          ? await createClient().rpc("upsert_patient_with_demographics", {
              patient_dni: input.documentNumber,
              patient_name: input.fullName,
              patient_birth_at: input.birthAt,
              patient_sex: input.sex,
            })
          : await createClient().rpc("upsert_simple_patient", {
              patient_dni: input.documentNumber,
              patient_name: input.fullName,
            });
        if (response.error) throw response.error;
        await props.refresh();
        const row = response.data as { id: string; document_number?: string; full_name?: string; birth_at?: string; birth_date?: string; sex?: Patient["sex"]; phone?: string; sync_version?: number };
        return {
          id: row.id,
          documentNumber: row.document_number ?? input.documentNumber,
          fullName: row.full_name ?? input.fullName,
          birthAt: row.birth_at ?? input.birthAt ?? "",
          birthDate: row.birth_date ?? input.birthAt?.slice(0, 10) ?? "",
          sex: row.sex ?? input.sex ?? "U",
          phone: row.phone ?? input.phone,
          syncVersion: row.sync_version ?? 1,
        };
      }
      const existing = props.data.patients.find((patient) => patient.documentNumber === input.documentNumber);
      const operation = operationBase(props.session, props.currentUser, "patient.upsert");
      const patient: Patient = {
        id: existing?.id ?? crypto.randomUUID(),
        documentNumber: input.documentNumber,
        fullName: input.fullName,
        birthAt: input.birthAt ?? existing?.birthAt ?? "",
        birthDate: input.birthAt?.slice(0, 10) ?? existing?.birthDate ?? "",
        sex: input.sex ?? existing?.sex ?? "U",
        phone: input.phone ?? existing?.phone,
        syncVersion: existing?.syncVersion ?? 1,
        syncState: "pending",
        clientMutationId: operation.clientMutationId,
      };
      operation.payload = {
        localId: patient.id,
        documentNumber: patient.documentNumber,
        fullName: patient.fullName,
        birthAt: patient.birthAt || null,
        sex: patient.sex === "U" ? null : patient.sex,
        phone: patient.phone ?? null,
      };
      await commit(materializePatient(props.data, patient), operation);
      return patient;
    },
    async updatePatient(input) {
      if (!props.session) {
        const response = await createClient().rpc("update_patient_details", {
          target_patient: input.patient.id,
          patient_name: input.fullName,
          patient_birth_at: input.birthAt,
          patient_sex: input.sex,
          patient_phone: input.phone ?? null,
        });
        if (response.error) throw response.error;
        await props.refresh();
        return { ...input.patient, fullName: input.fullName, birthAt: input.birthAt, birthDate: input.birthAt.slice(0, 10), sex: input.sex, phone: input.phone };
      }
      const operation = operationBase(props.session, props.currentUser, "patient.update");
      operation.baseVersion = input.patient.syncVersion ?? 1;
      operation.payload = {
        patientId: input.patient.id,
        fullName: input.fullName,
        birthAt: input.birthAt,
        sex: input.sex,
        phone: input.phone ?? null,
      };
      const patient: Patient = {
        ...input.patient,
        fullName: input.fullName,
        birthAt: input.birthAt,
        birthDate: input.birthAt.slice(0, 10),
        sex: input.sex,
        phone: input.phone,
        syncState: "pending",
        clientMutationId: operation.clientMutationId,
      };
      await commit(materializePatient(props.data, patient), operation);
      return patient;
    },
    async registerAnalyses(input) {
      if (!props.session) {
        const response = await createClient().rpc("register_daily_analyses", {
          target_patient: input.patient.id,
          occurred_at: input.occurredAt,
          result_entries: input.entries.map(({ analysis, value }) => ({
            analysis_version_id: analysis.versionId,
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
        patientDocumentNumber: input.patient.documentNumber,
        occurredAt: input.occurredAt,
        resultEntries: input.entries.map(({ analysis, value }) => ({
          analysis_version_id: analysis.versionId,
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
        entries: input.entries,
        mutationId: operation.clientMutationId,
        actorName: props.currentUser.fullName,
      });
      await commit(materialized.data, operation);
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
      if (order.clientMutationId) {
        const queued = await listOfflineOperations(props.session, ["pending", "blocked"]);
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
      const operation = operationBase(props.session, props.currentUser, "results.save");
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
    async buildOfflineReport(order, batchId) {
      if (!props.session) return null;
      const results = order.results.filter((result) => result.batchId === batchId);
      if (!results.length || results.some((result) => !result.value.trim())) throw new Error("all_batch_results_required");
      const logo = new Uint8Array(await (await fetch("/logo_laboratorio.png")).arrayBuffer());
      const bytes = await buildLabReportPdf({
        orderNumber: Number(order.code.match(/(\d+)$/)?.[1] ?? 0),
        orderCode: order.code,
        orderedAt: order.createdAt,
        patientName: order.patientName,
        documentNumber: order.documentNumber,
        sex: ({ F: "Femenino", M: "Masculino", X: "Otro", U: "No registrado" } as const)[order.patientSex],
        age: formatPatientAgeAt(order.patientBirthAt, order.createdAt),
        revision: order.revisionNumber ?? 1,
        printedBy: props.currentUser.fullName,
        footer: props.data.reportSettings?.footer ?? "Resultados para evaluación por el profesional tratante.",
        results: results.map((result) => ({
          group: result.group,
          analysis: result.analyte,
          value: result.value,
          unit: result.unit,
          reference: result.reference,
          flag: result.flag,
        })),
      }, logo);
      return new Blob([bytes as BlobPart], { type: "application/pdf" });
    },
    refresh: props.refresh,
    requestSync: props.requestSync,
  };

  return <RepositoryContext.Provider value={repository}>{props.children}</RepositoryContext.Provider>;
}

export function useOfflineRepository() {
  return useContext(RepositoryContext);
}
