import "fake-indexeddb/auto";
import { afterEach, describe, expect, it } from "vitest";
import {
  activatePatientRoster,
  beginPatientRosterImport,
  cleanupInactivePatientRosters,
  getActiveVaultMeta,
  resetOfflineDatabaseForTests,
  searchPatientRoster,
  writePatientRosterBatch,
  type UnlockedVault,
} from "@/lib/offline/db";
import { createDataKey } from "@/lib/offline/crypto";
import {
  normalizePatientBirthDate,
  patientRosterBucketKeys,
  normalizePatientRosterRow,
  normalizePatientSex,
} from "@/lib/offline/patient-roster";

afterEach(() => resetOfflineDatabaseForTests());

describe("normalización del directorio local", () => {
  it("convierte códigos y textos de sexo a M/F", () => {
    expect(normalizePatientSex("1")).toBe("M");
    expect(normalizePatientSex("Femenino")).toBe("F");
    expect(normalizePatientSex("desconocido")).toBeNull();
  });

  it("acepta fechas de Excel, ISO y día/mes/año", () => {
    expect(normalizePatientBirthDate(32_874)).toBe("1990-01-01");
    expect(normalizePatientBirthDate("2001-12-31")).toBe("2001-12-31");
    expect(normalizePatientBirthDate("31/12/2001")).toBe("2001-12-31");
  });

  it("normaliza una fila clínica completa", () => {
    expect(normalizePatientRosterRow({ dni: 1234567, fullName: "  Pérez   Ana ", birthDate: "02/03/1985", sex: "F" })).toEqual({
      patient: { documentNumber: "01234567", fullName: "Pérez Ana", birthDate: "1985-03-02", sex: "F" },
    });
  });

  it("genera bloques compactos para DNI y para cada palabra del nombre", () => {
    expect(patientRosterBucketKeys({
      documentNumber: "12345678",
      fullName: "María Pérez Soto",
      birthDate: "1985-03-02",
      sex: "F",
    })).toEqual({ dni: "dni:1234", names: ["name:MARI", "name:PERE", "name:SOTO"] });
  });
});

describe("directorio local", () => {
  it("informa si otra ventana bloquea la actualización de la base local", async () => {
    const heldDatabase = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open("lims-jose-offline-v1", 2);
      request.onupgradeneeded = () => {
        request.result.createObjectStore("settings", { keyPath: "key" });
        request.result.createObjectStore("rosterPatients", { keyPath: "id" });
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });

    await expect(getActiveVaultMeta()).rejects.toThrow("offline_database_blocked");
    heldDatabase.close();
  });

  it("conserva y permite buscar los pacientes del formato anterior", async () => {
    const legacyDatabase = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open("lims-jose-offline-v1", 3);
      request.onupgradeneeded = () => {
        request.result.createObjectStore("settings", { keyPath: "key" });
        const patients = request.result.createObjectStore("rosterPatients", { keyPath: "id" });
        patients.createIndex("by-vault-roster", ["vaultId", "rosterId"]);
        patients.createIndex("by-dni-token", "dniToken", { unique: true });
        patients.createIndex("by-search-token", "searchTokens", { multiEntry: true });
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const metadata = {
      rosterId: "legacy-roster",
      fileName: "pacientes.xlsb",
      sheetName: "Pacientes",
      count: 1,
      sourceRows: 1,
      importedAt: "2026-08-11T00:00:00.000Z",
    };
    const transaction = legacyDatabase.transaction(["settings", "rosterPatients"], "readwrite");
    transaction.objectStore("settings").put({ key: "patient-roster:user:device", value: JSON.stringify(metadata) });
    transaction.objectStore("rosterPatients").put({
      id: "legacy-roster:dni-exact:12345678",
      vaultId: "user:device",
      rosterId: "legacy-roster",
      dniToken: "legacy-roster:dni-exact:12345678",
      searchTokens: ["legacy-roster:name:PERE"],
      documentNumber: "12345678",
      fullName: "María Pérez Soto",
      birthDate: "1985-03-02",
      sex: "F",
      updatedAt: "2026-08-11T00:00:00.000Z",
    });
    await new Promise<void>((resolve, reject) => {
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error);
    });
    legacyDatabase.close();

    const session = { meta: { id: "user:device" } } as UnlockedVault;
    await expect(searchPatientRoster(session, "12345678")).resolves.toMatchObject([
      { documentNumber: "12345678", fullName: "María Pérez Soto" },
    ]);

  });

  it("encuentra por DNI exacto y por nombre sin depender de Supabase", async () => {
    const key = await createDataKey();
    const session = {
      key,
      meta: { id: "user:device" },
      snapshot: {},
    } as UnlockedVault;
    const rosterId = "roster-test";
    await beginPatientRosterImport(session, rosterId);
    await writePatientRosterBatch(session, rosterId, [
      { key: "dni:1234", kind: "patients", patients: [
        { documentNumber: "12345678", fullName: "María Pérez Soto", birthDate: "1985-03-02", sex: "F" },
      ] },
      { key: "dni:8765", kind: "patients", patients: [
        { documentNumber: "87654321", fullName: "Carlos Quispe Rojas", birthDate: "1978-06-10", sex: "M" },
      ] },
      { key: "name:PERE", kind: "names", documentNumbers: ["12345678"] },
      { key: "name:SOTO", kind: "names", documentNumbers: ["12345678"] },
    ]);
    await cleanupInactivePatientRosters(session);
    await activatePatientRoster(session, {
      rosterId,
      fileName: "pacientes.xlsb",
      sheetName: "Pacientes",
      count: 2,
      sourceRows: 2,
      importedAt: "2026-08-10T00:00:00.000Z",
    });

    await expect(searchPatientRoster(session, "12345678")).resolves.toMatchObject([{ documentNumber: "12345678", sex: "F" }]);
    await expect(searchPatientRoster(session, "1234")).resolves.toMatchObject([{ documentNumber: "12345678" }]);
    await expect(searchPatientRoster(session, "Perez")).resolves.toMatchObject([{ documentNumber: "12345678" }]);
    await expect(searchPatientRoster(session, "Perez Soto")).resolves.toMatchObject([{ documentNumber: "12345678" }]);

    const replacementId = "roster-replacement";
    await beginPatientRosterImport(session, replacementId);
    await writePatientRosterBatch(session, replacementId, [
      { key: "dni:1122", kind: "patients", patients: [
        { documentNumber: "11223344", fullName: "Paciente Reemplazo", birthDate: "1992-04-01", sex: "F" },
      ] },
      { key: "name:PACI", kind: "names", documentNumbers: ["11223344"] },
    ]);
    await expect(activatePatientRoster(session, {
      rosterId: replacementId,
      fileName: "pacientes-nuevos.xlsb",
      sheetName: "Pacientes",
      count: 1,
      sourceRows: 1,
      importedAt: "2026-08-11T00:00:00.000Z",
    })).resolves.toBe(rosterId);
    await expect(searchPatientRoster(session, "11223344")).resolves.toMatchObject([{ documentNumber: "11223344" }]);
  });
});
