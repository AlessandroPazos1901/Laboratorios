import { describe, expect, it } from "vitest";
import {
  createDataKey,
  decryptJson,
  derivePinKey,
  encryptJson,
  randomBase64,
  unwrapDataKey,
  wrapDataKey,
} from "@/lib/offline/crypto";
import { materializePatient, materializeRegistration } from "@/lib/offline/materialize";
import { orderOperationsByDependencies } from "@/lib/offline/sync";
import type { OfflineOperation } from "@/lib/offline/types";
import type { LabData, Patient } from "@/lib/types";

const emptyData: LabData = {
  patients: [],
  orders: [],
  analyses: [{
    id: "analysis-1",
    versionId: "version-1",
    code: "GLU",
    name: "Glucosa",
    group: "Bioquímica",
    resultType: "numeric",
    unit: "mg/dL",
    method: "Enzimático",
    reference: "70-110",
    active: true,
    low: 70,
    high: 110,
  }],
  analysts: [{ id: "analyst-1", fullName: "Tecnólogo Prueba", active: true }],
  trend: [],
  summary: { orders: 0, analyses: 0, patients: 0, criticalValues: 0 },
};

describe("cifrado offline", () => {
  it("envuelve la clave de datos con el PIN y no conserva el JSON en claro", async () => {
    const salt = randomBase64();
    const pinKey = await derivePinKey("12345678", salt);
    const dataKey = await createDataKey();
    const wrapped = await wrapDataKey(dataKey, pinKey);
    const restored = await unwrapDataKey(wrapped, pinKey);
    const encrypted = await encryptJson(restored, { dni: "12345678", result: "Positivo" });
    expect(encrypted.ciphertext).not.toContain("12345678");
    await expect(decryptJson(restored, encrypted)).resolves.toEqual({ dni: "12345678", result: "Positivo" });
  });

  it("rechaza una clave derivada de otro PIN", async () => {
    const salt = randomBase64();
    const dataKey = await createDataKey();
    const wrapped = await wrapDataKey(dataKey, await derivePinKey("12345678", salt));
    await expect(unwrapDataKey(wrapped, await derivePinKey("87654321", salt))).rejects.toThrow();
  });
});

describe("materialización local", () => {
  it("crea paciente y orden provisional con resultado calculado", () => {
    const patient: Patient = {
      id: 12345678, documentNumber: "12345678", fullName: "Paciente Prueba",
      birthDate: "1990-01-01", sex: "F",
      syncVersion: 1, syncState: "pending",
    };
    const withPatient = materializePatient(emptyData, patient);
    const output = materializeRegistration({
      data: withPatient,
      patient,
      occurredAt: "2026-08-02T15:00:00.000Z",
      entries: [
        { analysis: emptyData.analyses[0], value: "140" },
        { analysis: { ...emptyData.analyses[0], id: "blank-analysis", versionId: "blank-version", name: "No realizado" }, value: "   " },
      ],
      analyst: emptyData.analysts[0],
      mutationId: crypto.randomUUID(),
      actorName: "Tecnólogo Prueba",
    });
    expect(output.data.patients).toHaveLength(1);
    expect(output.data.orders).toHaveLength(1);
    expect(output.order.results[0].flag).toBe("high");
    expect(output.order.results[0]).toMatchObject({ analystId: "analyst-1", performedBy: "Tecnólogo Prueba" });
    expect(output.order.results).toHaveLength(1);
    expect(output.data.summary).toMatchObject({ orders: 1, analyses: 1, patients: 1 });
  });
});

describe("orden de sincronización", () => {
  it("coloca las dependencias antes de sus operaciones", () => {
    const patientId = crypto.randomUUID();
    const registerId = crypto.randomUUID();
    const base = (id: string, kind: OfflineOperation["kind"], dependencies: string[]): OfflineOperation => ({
      clientMutationId: id,
      deviceId: crypto.randomUUID(),
      actorId: crypto.randomUUID(),
      kind,
      createdAt: "2026-08-02T10:00:00.000Z",
      dependencies,
      payload: {},
    });
    const ordered = orderOperationsByDependencies([
      { operation: base(registerId, "analysis.register", [patientId]) },
      { operation: base(patientId, "patient.upsert", []) },
    ]);
    expect(ordered.map((item) => item.operation.clientMutationId)).toEqual([patientId, registerId]);
  });
});
