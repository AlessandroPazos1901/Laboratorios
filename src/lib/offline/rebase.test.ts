import { describe, expect, it } from "vitest";
import { rebaseSnapshot } from "./rebase";
import type { OfflineOperation } from "@/lib/offline/types";
import type { AnalysisDefinition, LabData, LabOrder, Patient, ResultValue } from "@/lib/types";

const GROUP = "11111111-1111-4111-8111-111111111111";
const VERSION = "22222222-2222-4222-8222-222222222222";
const ANALYSIS = "33333333-3333-4333-8333-333333333333";

const operation = (over: Partial<OfflineOperation>): OfflineOperation => ({
  clientMutationId: crypto.randomUUID(),
  deviceId: "device", actorId: "actor", kind: "catalog.apply",
  createdAt: "2026-08-21T10:00:00.000Z", dependencies: [], payload: {}, ...over,
});

const analysis = (over: Partial<AnalysisDefinition> = {}): AnalysisDefinition => ({
  id: ANALYSIS, groupId: GROUP, versionId: VERSION, code: "HEM-HB", name: "Hemoglobina",
  group: "Hematología", resultType: "numeric", unit: "g/dL", method: "", reference: "12 - 16",
  active: true, subsection: "Serie roja", pickerOrder: 10, low: 12, high: 16, ...over,
});

const patient = (over: Partial<Patient> = {}): Patient => ({
  id: 12345678, documentNumber: "12345678", fullName: "Ana Ruiz",
  birthDate: "1990-01-01", sex: "F", syncVersion: 1, ...over,
});

const result = (over: Partial<ResultValue> = {}): ResultValue => ({
  id: "r1", orderAnalysisId: "oa1", analysisVersionId: VERSION, batchId: "b1",
  registeredAt: "2026-08-21T10:00:00.000Z", analyte: "Hemoglobina", analysisCode: "HEM-HB",
  group: "Hematología", resultType: "numeric", value: "14", numericValue: 14,
  unit: "g/dL", reference: "12 - 16", low: 12, high: 16, flag: "normal", method: "",
  analystId: "an1", performedBy: "Bio. Pérez", ...over,
});

const order = (over: Partial<LabOrder> = {}): LabOrder => ({
  id: "o1", revisionId: "rev1", revisionNumber: 1, lockVersion: 3, code: "ORD-1",
  patientId: 12345678, patientName: "Ana Ruiz", documentNumber: "12345678",
  patientBirthDate: "1990-01-01", patientSex: "F", createdAt: "2026-08-21T10:00:00.000Z",
  groups: ["Hematología"], responsible: "Laboratorio", results: [result()], ...over,
});

const base = (over: Partial<LabData> = {}): LabData => ({
  patients: [patient()], orders: [], analysts: [{ id: "an1", fullName: "Bio. Pérez", active: true }],
  trend: [], summary: { orders: 0, analyses: 0, patients: 0, criticalValues: 0 },
  analyses: [analysis()],
  catalogGroups: [{ id: GROUP, name: "Hematología", displayOrder: 10, active: true }],
  catalogSubsections: [{ id: GROUP, groupId: GROUP, group: "Hematología", name: "Serie roja", displayOrder: 10 }],
  ...over,
});

describe("rebaseSnapshot", () => {
  it("sin operaciones pendientes devuelve el snapshot remoto tal cual", () => {
    const remote = base();
    expect(rebaseSnapshot(remote, [])).toBe(remote);
  });

  it("conserva un reordenamiento del catálogo que el servidor todavía no aplicó", () => {
    // Este es el fallo reportado: el análisis se movía y a los segundos volvía.
    const remote = base();
    const pending = operation({
      kind: "catalog.apply",
      payload: {
        action: "layout.save", groupId: GROUP,
        items: [{ analysisId: ANALYSIS, subsection: "Serie roja", displayOrder: 70 }],
      },
    });
    expect(rebaseSnapshot(remote, [pending]).analyses[0].pickerOrder).toBe(70);
    expect(remote.analyses[0].pickerOrder).toBe(10);
  });

  it("conserva un paciente creado sin conexión que aún no está en el servidor", () => {
    const remote = base({ patients: [] });
    const pending = operation({
      kind: "patient.upsert",
      payload: { patientId: 87654321, fullName: "Luis Vega", birthDate: "1980-05-02", sex: "M" },
    });
    const next = rebaseSnapshot(remote, [pending]);
    expect(next.patients).toHaveLength(1);
    expect(next.patients[0]).toMatchObject({ id: 87654321, documentNumber: "87654321", fullName: "Luis Vega" });
  });

  it("conserva resultados editados sin conexión y recalcula su alerta", () => {
    const remote = base({ orders: [order()] });
    const pending = operation({
      kind: "results.save",
      payload: {
        orderId: "o1", targetRevision: "rev1", expectedLockVersion: 3,
        resultEntries: [{ order_analysis_id: "oa1", payload: { numeric_value: 7 } }],
      },
    });
    const saved = rebaseSnapshot(remote, [pending]).orders[0].results[0];
    expect(saved.value).toBe("7");
    expect(saved.flag).toBe("low");
  });

  it("no duplica un registro que el servidor ya aplicó pero sigue en la cola", () => {
    // Ocurre cuando el push se guardó y el equipo perdió la respuesta.
    const remote = base({ orders: [order()] });
    const pending = operation({
      kind: "analysis.register",
      payload: {
        patientId: 12345678, occurredAt: "2026-08-21T10:00:00.000Z",
        resultEntries: [{ analysis_version_id: VERSION, analyst_id: "an1", payload: { numeric_value: 14 } }],
      },
    });
    expect(rebaseSnapshot(remote, [pending]).orders[0].results).toHaveLength(1);
  });

  it("reconstruye un registro que el servidor todavía no tiene", () => {
    const remote = base();
    const pending = operation({
      kind: "analysis.register",
      payload: {
        patientId: 12345678, occurredAt: "2026-08-21T10:00:00.000Z",
        resultEntries: [{ analysis_version_id: VERSION, analyst_id: "an1", payload: { numeric_value: 9 } }],
      },
    });
    const next = rebaseSnapshot(remote, [pending]);
    expect(next.orders).toHaveLength(1);
    expect(next.orders[0].results[0]).toMatchObject({ value: "9", performedBy: "Bio. Pérez", analystId: "an1" });
  });

  it("respeta las dependencias: el paciente nuevo existe antes de su registro", () => {
    const remote = base({ patients: [] });
    const created = operation({
      kind: "patient.upsert",
      createdAt: "2026-08-21T11:00:00.000Z",
      payload: { patientId: 87654321, fullName: "Luis Vega", birthDate: "1980-05-02", sex: "M" },
    });
    const registered = operation({
      kind: "analysis.register",
      createdAt: "2026-08-21T10:00:00.000Z", // más antigua a propósito
      dependencies: [created.clientMutationId],
      payload: {
        patientId: 87654321, occurredAt: "2026-08-21T11:05:00.000Z",
        resultEntries: [{ analysis_version_id: VERSION, analyst_id: "an1", payload: { numeric_value: 11 } }],
      },
    });
    const next = rebaseSnapshot(remote, [registered, created]);
    expect(next.orders).toHaveLength(1);
    expect(next.orders[0].patientName).toBe("Luis Vega");
  });

  it("una operación que ya no encaja no tumba a las demás", () => {
    const remote = base();
    const roto = operation({ kind: "catalog.apply", payload: { action: "no.existe" } });
    const bueno = operation({
      kind: "catalog.apply",
      payload: { action: "group.rename", groupId: GROUP, name: "Hematología clínica" },
    });
    expect(rebaseSnapshot(remote, [roto, bueno]).catalogGroups?.[0].name).toBe("Hematología clínica");
  });

  it("no muta el snapshot remoto recibido", () => {
    const remote = base({ orders: [order()] });
    rebaseSnapshot(remote, [operation({
      kind: "results.save",
      payload: { orderId: "o1", resultEntries: [{ order_analysis_id: "oa1", payload: { numeric_value: 7 } }] },
    })]);
    expect(remote.orders[0].results[0].value).toBe("14");
  });
});
