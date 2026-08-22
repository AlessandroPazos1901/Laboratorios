import { deleteDB, openDB, unwrap, type DBSchema, type IDBPDatabase } from "idb";
import {
  createDataKey,
  decryptJson,
  deriveVaultKey,
  encryptJson,
  randomBase64,
  unwrapDataKey,
  wrapDataKey,
  type EncryptedValue,
} from "@/lib/offline/crypto";
import {
  normalizePatientSearch,
  patientMatchesQuery,
  patientQueryTerms,
  type PatientRosterBucket,
  type PatientRosterMetadata,
} from "@/lib/offline/patient-roster";
import { verifyOfflineLease } from "@/lib/offline/lease";
import { orderOperationsByDependencies } from "@/lib/offline/sync";
import type {
  OfflineLease,
  OfflineOperation,
  OfflineOperationStatus,
  OfflineVaultSnapshot,
  SyncConflict,
} from "@/lib/offline/types";

const DB_NAME = "lims-jose-offline-v1";
const DB_VERSION = 5;

export type OfflineVaultMeta = {
  id: string;
  deviceId: string;
  deviceName: string;
  userId: string;
  salt: string;
  wrappedKey: EncryptedValue;
  lease: OfflineLease;
  cursor: number;
  createdAt: string;
  updatedAt: string;
  lastSyncAt?: string;
};

type EncryptedRecord = EncryptedValue & { id: string; vaultId: string; updatedAt: string };
type OutboxRecord = EncryptedRecord & {
  clientMutationId: string;
  kind: OfflineOperation["kind"];
  status: OfflineOperationStatus;
  createdAt: string;
  error?: string;
};
type ConflictRecord = EncryptedRecord & { conflictId: string; createdAt: string };
type PatientRosterRecord = {
  id: string;
  vaultId: string;
  rosterId: string;
  searchTokens: string[];
  documentNumber: string;
  fullName: string;
  birthDate: string;
  sex: "F" | "M";
  updatedAt: string;
};
type PatientRosterBucketRecord = PatientRosterBucket & {
  id: string;
  vaultId: string;
  rosterId: string;
};

interface OfflineDb extends DBSchema {
  settings: { key: string; value: { key: string; value: string } };
  vaults: { key: string; value: OfflineVaultMeta; indexes: { "by-user": string } };
  records: { key: string; value: EncryptedRecord; indexes: { "by-vault": string } };
  outbox: {
    key: string;
    value: OutboxRecord;
    indexes: { "by-vault": string; "by-vault-status": [string, OfflineOperationStatus] };
  };
  conflicts: { key: string; value: ConflictRecord; indexes: { "by-vault": string } };
  rosterPatients: {
    key: string;
    value: PatientRosterRecord;
    indexes: {
      "by-vault-roster": [string, string];
      "by-search-token": string;
    };
  };
  rosterBuckets: { key: string; value: PatientRosterBucketRecord };
}

let databasePromise: Promise<IDBPDatabase<OfflineDb>> | null = null;

function openOfflineDatabase() {
  return new Promise<IDBPDatabase<OfflineDb>>((resolve, reject) => {
    let upgradeBlocked = false;
    const opening = openDB<OfflineDb>(DB_NAME, DB_VERSION, {
      upgrade(db, oldVersion) {
        if (oldVersion < 1) {
          db.createObjectStore("settings", { keyPath: "key" });
          const vaults = db.createObjectStore("vaults", { keyPath: "id" });
          vaults.createIndex("by-user", "userId");
          const records = db.createObjectStore("records", { keyPath: "id" });
          records.createIndex("by-vault", "vaultId");
          const outbox = db.createObjectStore("outbox", { keyPath: "id" });
          outbox.createIndex("by-vault", "vaultId");
          outbox.createIndex("by-vault-status", ["vaultId", "status"]);
          const conflicts = db.createObjectStore("conflicts", { keyPath: "id" });
          conflicts.createIndex("by-vault", "vaultId");
        }
        if (oldVersion < 3) {
          if (db.objectStoreNames.contains("rosterPatients")) db.deleteObjectStore("rosterPatients");
          const patients = db.createObjectStore("rosterPatients", { keyPath: "id" });
          patients.createIndex("by-vault-roster", ["vaultId", "rosterId"]);
          patients.createIndex("by-search-token", "searchTokens", { multiEntry: true });
        }
        if (oldVersion < 5 && !db.objectStoreNames.contains("rosterBuckets")) {
          db.createObjectStore("rosterBuckets", { keyPath: "id" });
        }
      },
      blocked() {
        upgradeBlocked = true;
        reject(new Error("offline_database_blocked"));
      },
      blocking(_currentVersion, _blockedVersion, event) {
        // Release this tab's connection so a future deployed schema can upgrade.
        (event.target as IDBDatabase | null)?.close();
        databasePromise = null;
      },
      terminated() {
        databasePromise = null;
      },
    });

    void opening.then((db) => {
      // A blocked attempt may finish after an older tab is finally closed. Do
      // not retain that orphan connection: the visible page will retry cleanly.
      if (upgradeBlocked) db.close();
      else resolve(db);
    }, reject);
  });
}

function database() {
  if (!databasePromise) {
    databasePromise = openOfflineDatabase().catch((error) => {
      databasePromise = null;
      throw error;
    });
  }
  return databasePromise;
}

const recordId = (vaultId: string) => `${vaultId}:snapshot`;
const outboxId = (vaultId: string, mutationId: string) => `${vaultId}:${mutationId}`;
const conflictId = (vaultId: string, id: string) => `${vaultId}:${id}`;
const rosterSettingId = (vaultId: string) => `patient-roster:${vaultId}`;
const rosterStagingSettingId = (vaultId: string) => `patient-roster-staging:${vaultId}`;
const rosterToken = (rosterId: string, value: string) => `${rosterId}:${value}`;

export type UnlockedVault = {
  meta: OfflineVaultMeta;
  key: CryptoKey;
  snapshot: OfflineVaultSnapshot;
};

export async function requestPersistentOfflineStorage() {
  const estimate = await navigator.storage?.estimate?.();
  const persisted = await navigator.storage?.persist?.();
  return { persisted: persisted ?? false, quota: estimate?.quota ?? 0, usage: estimate?.usage ?? 0 };
}

export async function getActiveVaultMeta() {
  const db = await database();
  const setting = await db.get("settings", "active-vault");
  return setting ? db.get("vaults", setting.value) : undefined;
}

export async function createOfflineVault(input: {
  password: string;
  lease: OfflineLease;
  snapshot: OfflineVaultSnapshot;
  cursor: number;
}) {
  await verifyOfflineLease(input.lease.token, input.lease.deviceId);
  const id = `${input.lease.userId}:${input.lease.deviceId}`;
  const salt = randomBase64(16);
  const wrappingKey = await deriveVaultKey(input.password, salt);
  const dataKey = await createDataKey();
  const wrappedKey = await wrapDataKey(dataKey, wrappingKey);
  const encrypted = await encryptJson(dataKey, input.snapshot);
  const now = new Date().toISOString();
  const meta: OfflineVaultMeta = {
    id,
    deviceId: input.lease.deviceId,
    deviceName: input.lease.deviceName,
    userId: input.lease.userId,
    salt,
    wrappedKey,
    lease: input.lease,
    cursor: input.cursor,
    createdAt: now,
    updatedAt: now,
    lastSyncAt: now,
  };
  const db = await database();
  const tx = db.transaction(["settings", "vaults", "records"], "readwrite");
  await tx.objectStore("vaults").put(meta);
  await tx.objectStore("records").put({
    id: recordId(id), vaultId: id, ...encrypted, updatedAt: now,
  });
  await tx.objectStore("settings").put({ key: "active-vault", value: id });
  await tx.done;
  return { meta, key: dataKey, snapshot: input.snapshot } satisfies UnlockedVault;
}

export async function unlockOfflineVault(password: string, allowExpired = false): Promise<UnlockedVault> {
  const meta = await getActiveVaultMeta();
  if (!meta) throw new Error("offline_vault_missing");
  const claims = await verifyOfflineLease(meta.lease.token, meta.deviceId);
  if (claims.userId !== meta.userId) throw new Error("offline_user_mismatch");
  if (!allowExpired && new Date(meta.lease.expiresAt).getTime() <= Date.now()) {
    throw new Error("offline_lease_expired");
  }
  const wrappingKey = await deriveVaultKey(password, meta.salt);
  let key: CryptoKey;
  try {
    key = await unwrapDataKey(meta.wrappedKey, wrappingKey);
  } catch {
    throw new Error("offline_password_incorrect");
  }
  const encrypted = await (await database()).get("records", recordId(meta.id));
  if (!encrypted) throw new Error("offline_snapshot_missing");
  try {
    const snapshot = await decryptJson<OfflineVaultSnapshot>(key, encrypted);
    return { meta, key, snapshot };
  } catch {
    throw new Error("offline_password_incorrect");
  }
}

/**
 * La contraseña cambió estando conectado: se vuelve a envolver la misma clave de
 * datos con la nueva. No hay que descifrar ni reescribir el snapshot, solo el
 * sobre. Sin esto, cambiar la contraseña dejaría el equipo sin poder abrirse.
 */
export async function rewrapOfflineVault(session: UnlockedVault, password: string) {
  const salt = randomBase64(16);
  const wrappedKey = await wrapDataKey(session.key, await deriveVaultKey(password, salt));
  const meta = { ...session.meta, salt, wrappedKey, updatedAt: new Date().toISOString() };
  await (await database()).put("vaults", meta);
  return { ...session, meta } satisfies UnlockedVault;
}

export async function saveOfflineSnapshot(session: UnlockedVault, snapshot: OfflineVaultSnapshot, cursor: number) {
  const now = new Date().toISOString();
  const encrypted = await encryptJson(session.key, snapshot);
  const meta = { ...session.meta, cursor, updatedAt: now, lastSyncAt: now };
  const db = await database();
  const tx = db.transaction(["vaults", "records"], "readwrite");
  await tx.objectStore("records").put({ id: recordId(meta.id), vaultId: meta.id, ...encrypted, updatedAt: now });
  await tx.objectStore("vaults").put(meta);
  await tx.done;
  return { ...session, meta, snapshot } satisfies UnlockedVault;
}

export async function renewOfflineVaultLease(meta: OfflineVaultMeta, lease: OfflineLease) {
  await verifyOfflineLease(lease.token, meta.deviceId);
  const updated = { ...meta, lease, updatedAt: new Date().toISOString() };
  await (await database()).put("vaults", updated);
  return updated;
}

export async function enqueueOfflineOperation(session: UnlockedVault, operation: OfflineOperation) {
  const encrypted = await encryptJson(session.key, operation);
  await (await database()).put("outbox", {
    id: outboxId(session.meta.id, operation.clientMutationId),
    vaultId: session.meta.id,
    clientMutationId: operation.clientMutationId,
    kind: operation.kind,
    status: "pending",
    createdAt: operation.createdAt,
    updatedAt: operation.createdAt,
    ...encrypted,
  });
}

export async function commitOfflineMutation(
  session: UnlockedVault,
  snapshot: OfflineVaultSnapshot,
  operation: OfflineOperation,
) {
  const now = new Date().toISOString();
  const [snapshotEncrypted, operationEncrypted] = await Promise.all([
    encryptJson(session.key, snapshot),
    encryptJson(session.key, operation),
  ]);
  const meta = { ...session.meta, updatedAt: now };
  const db = await database();
  const tx = db.transaction(["vaults", "records", "outbox"], "readwrite");
  await tx.objectStore("records").put({
    id: recordId(meta.id), vaultId: meta.id, ...snapshotEncrypted, updatedAt: now,
  });
  await tx.objectStore("outbox").put({
    id: outboxId(meta.id, operation.clientMutationId),
    vaultId: meta.id,
    clientMutationId: operation.clientMutationId,
    kind: operation.kind,
    status: "pending",
    createdAt: operation.createdAt,
    updatedAt: now,
    ...operationEncrypted,
  });
  await tx.objectStore("vaults").put(meta);
  await tx.done;
  return { ...session, meta, snapshot } satisfies UnlockedVault;
}

export async function replaceOfflineOperation(session: UnlockedVault, operation: OfflineOperation) {
  const db = await database();
  const id = outboxId(session.meta.id, operation.clientMutationId);
  const current = await db.get("outbox", id);
  if (!current) return enqueueOfflineOperation(session, operation);
  const encrypted = await encryptJson(session.key, operation);
  await db.put("outbox", { ...current, ...encrypted, status: "pending", error: undefined, updatedAt: new Date().toISOString() });
}

export async function listOfflineOperations(session: UnlockedVault, statuses?: OfflineOperationStatus[]) {
  const records = await (await database()).getAllFromIndex("outbox", "by-vault", session.meta.id);
  const selected = statuses ? records.filter((record) => statuses.includes(record.status)) : records;
  const values = await Promise.all(selected.map(async (record) => ({
    operation: await decryptJson<OfflineOperation>(session.key, record),
    status: record.status,
    error: record.error,
  })));
  return orderOperationsByDependencies(values);
}

/**
 * Cuántos cambios quedan sin enviar, sin abrir la bóveda. El `outbox` guarda el
 * estado en claro y solo cifra el contenido, así que esto funciona incluso
 * cuando la contraseña ya no descifra la copia local — que es justo cuando hace
 * falta saber qué se perdería al rehacerla.
 */
export async function countUnsentOperations(vaultId: string) {
  const records = await (await database()).getAllFromIndex("outbox", "by-vault", vaultId);
  return records.filter((record) => record.status !== "applied").length;
}

export async function setOfflineOperationStatus(
  session: UnlockedVault,
  mutationId: string,
  status: OfflineOperationStatus,
  error?: string,
) {
  const db = await database();
  const id = outboxId(session.meta.id, mutationId);
  const record = await db.get("outbox", id);
  if (record) await db.put("outbox", { ...record, status, error, updatedAt: new Date().toISOString() });
}

export async function removeOfflineOperation(session: UnlockedVault, mutationId: string) {
  await (await database()).delete("outbox", outboxId(session.meta.id, mutationId));
}

export async function addOfflineConflict(session: UnlockedVault, conflict: SyncConflict) {
  const encrypted = await encryptJson(session.key, conflict);
  await (await database()).put("conflicts", {
    id: conflictId(session.meta.id, conflict.id),
    vaultId: session.meta.id,
    conflictId: conflict.id,
    createdAt: conflict.createdAt,
    updatedAt: conflict.createdAt,
    ...encrypted,
  });
}

export async function listOfflineConflicts(session: UnlockedVault) {
  const records = await (await database()).getAllFromIndex("conflicts", "by-vault", session.meta.id);
  return Promise.all(records.map((record) => decryptJson<SyncConflict>(session.key, record)));
}

export async function removeOfflineConflict(session: UnlockedVault, id: string) {
  await (await database()).delete("conflicts", conflictId(session.meta.id, id));
}

export async function getPatientRosterMetadata(session: UnlockedVault) {
  const setting = await (await database()).get("settings", rosterSettingId(session.meta.id));
  if (!setting) return null;
  try {
    return JSON.parse(setting.value) as PatientRosterMetadata;
  } catch {
    return null;
  }
}

export async function beginPatientRosterImport(session: UnlockedVault, rosterId: string) {
  const db = await database();
  const settingId = rosterStagingSettingId(session.meta.id);
  const previous = await db.get("settings", settingId);
  if (previous?.value && previous.value !== rosterId) {
    await Promise.all([
      deletePatientRoster(session.meta.id, previous.value),
      deletePatientRosterBuckets(previous.value),
    ]);
  }
  await db.delete("settings", settingId);
  await cleanupInactivePatientRosters(session);
  await db.put("settings", { key: settingId, value: rosterId });
}

export async function writePatientRosterBatch(
  session: UnlockedVault,
  rosterId: string,
  buckets: PatientRosterBucket[],
) {
  const records = buckets.map((bucket) => ({
      ...bucket,
      id: `${rosterId}:${bucket.key}`,
      vaultId: session.meta.id,
      rosterId,
    } satisfies PatientRosterBucketRecord));
  const db = await database();
  // This directory can always be rebuilt from the source file. Relaxed
  // durability avoids a physical disk flush for every bucket batch; the
  // roster is activated only after every transaction completes successfully.
  const tx = db.transaction("rosterBuckets", "readwrite", { durability: "relaxed" });
  const store = unwrap(tx.store);
  records.forEach((record) => store.add(record));
  await tx.done;
}

const ROSTER_DELETE_BATCH_SIZE = 2_000;

async function deletePatientRoster(vaultId: string, rosterId: string) {
  const db = await database();
  const range = IDBKeyRange.only([vaultId, rosterId]);
  while (true) {
    const tx = db.transaction("rosterPatients", "readwrite");
    const keys = await tx.store.index("by-vault-roster").getAllKeys(range, ROSTER_DELETE_BATCH_SIZE);
    await Promise.all(keys.map((key) => tx.store.delete(key)));
    await tx.done;
    if (keys.length < ROSTER_DELETE_BATCH_SIZE) return;
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
  }
}

async function listPatientRosterIds(vaultId: string) {
  const db = await database();
  const tx = db.transaction("rosterPatients", "readonly");
  const range = IDBKeyRange.bound([vaultId, ""], [vaultId, "\uffff"]);
  const rosterIds = new Set<string>();
  let cursor = await tx.store.index("by-vault-roster").openKeyCursor(range);
  while (cursor) {
    const rosterId = String((cursor.key as [string, string])[1]);
    rosterIds.add(rosterId);
    cursor = await cursor.continue([vaultId, `${rosterId}\0`]);
  }
  await tx.done;
  return [...rosterIds];
}

async function deletePatientRosterBuckets(rosterId: string) {
  const db = await database();
  const tx = db.transaction("rosterBuckets", "readwrite", { durability: "relaxed" });
  await tx.store.delete(IDBKeyRange.bound(`${rosterId}:`, `${rosterId}:\uffff`));
  await tx.done;
}

async function listPatientBucketRosterIds(vaultId: string) {
  const db = await database();
  const tx = db.transaction("rosterBuckets", "readonly");
  const rosterIds = new Set<string>();
  let cursor = await tx.store.openCursor();
  while (cursor) {
    if (cursor.value.vaultId === vaultId) rosterIds.add(cursor.value.rosterId);
    cursor = await cursor.continue();
  }
  await tx.done;
  return [...rosterIds];
}

async function deleteAllPatientRosters(vaultId: string) {
  const [legacyRosterIds, bucketRosterIds] = await Promise.all([
    listPatientRosterIds(vaultId),
    listPatientBucketRosterIds(vaultId),
  ]);
  for (const rosterId of legacyRosterIds) await deletePatientRoster(vaultId, rosterId);
  for (const rosterId of bucketRosterIds) await deletePatientRosterBuckets(rosterId);
}

export async function activatePatientRoster(session: UnlockedVault, metadata: PatientRosterMetadata) {
  const previous = await getPatientRosterMetadata(session);
  const db = await database();
  const tx = db.transaction("settings", "readwrite");
  await tx.store.put({
    key: rosterSettingId(session.meta.id),
    value: JSON.stringify({ ...metadata, format: "buckets-v1" }),
  });
  const stagingId = rosterStagingSettingId(session.meta.id);
  const staging = await tx.store.get(stagingId);
  if (staging?.value === metadata.rosterId) await tx.store.delete(stagingId);
  await tx.done;
  return previous && previous.rosterId !== metadata.rosterId ? previous.rosterId : null;
}

export async function discardPatientRosterImport(session: UnlockedVault, rosterId: string) {
  await Promise.all([
    deletePatientRoster(session.meta.id, rosterId),
    deletePatientRosterBuckets(rosterId),
  ]);
  const db = await database();
  const settingId = rosterStagingSettingId(session.meta.id);
  const staging = await db.get("settings", settingId);
  if (staging?.value === rosterId) await db.delete("settings", settingId);
}

export async function cleanupInactivePatientRosters(session: UnlockedVault) {
  const [legacyRosterIds, bucketRosterIds] = await Promise.all([
    listPatientRosterIds(session.meta.id),
    listPatientBucketRosterIds(session.meta.id),
  ]);
  // Read protection after listing. If an import started while an earlier
  // cleanup was scanning, its staging marker is now visible before deletion.
  const [active, staging] = await Promise.all([
    getPatientRosterMetadata(session),
    (await database()).get("settings", rosterStagingSettingId(session.meta.id)),
  ]);
  const protectedRosterIds = new Set([active?.rosterId, staging?.value].filter((value): value is string => Boolean(value)));
  for (const rosterId of new Set([...legacyRosterIds, ...bucketRosterIds])) {
    if (!protectedRosterIds.has(rosterId)) await deletePatientRoster(session.meta.id, rosterId);
    if (!protectedRosterIds.has(rosterId)) await deletePatientRosterBuckets(rosterId);
  }
}

async function hydrateBucketPatients(
  db: IDBPDatabase<OfflineDb>,
  rosterId: string,
  documentNumbers: string[],
) {
  const wanted = new Set(documentNumbers);
  const prefixes = [...new Set(documentNumbers.map((dni) => dni.slice(0, 4)))];
  const buckets = await Promise.all(prefixes.map((prefix) => db.get("rosterBuckets", `${rosterId}:dni:${prefix}`)));
  return buckets.flatMap((bucket) => bucket?.kind === "patients" ? bucket.patients : [])
    .filter((patient) => wanted.has(patient.documentNumber));
}

async function searchBucketPatientRoster(
  db: IDBPDatabase<OfflineDb>,
  rosterId: string,
  normalized: string,
) {
  if (/^\d{4,8}$/.test(normalized)) {
    const bucket = await db.get("rosterBuckets", `${rosterId}:dni:${normalized.slice(0, 4)}`);
    return bucket?.kind === "patients" ? bucket.patients : [];
  }
  const terms = patientQueryTerms(normalized).filter((term): term is `name:${string}` => term.startsWith("name:"));
  if (!terms.length) return [];
  const buckets = await Promise.all(terms.map((term) => db.get("rosterBuckets", `${rosterId}:${term}`)));
  if (buckets.some((bucket) => bucket?.kind !== "names")) return [];
  const sets = buckets.map((bucket) => new Set(bucket?.kind === "names" ? bucket.documentNumbers : []))
    .sort((left, right) => left.size - right.size);
  const [first, ...rest] = sets;
  const matching = [...first].filter((dni) => rest.every((set) => set.has(dni))).slice(0, 250);
  return hydrateBucketPatients(db, rosterId, matching);
}

export async function searchPatientRoster(session: UnlockedVault, query: string, limit = 8) {
  const metadata = await getPatientRosterMetadata(session);
  const normalized = normalizePatientSearch(query);
  if (!metadata || normalized.length < 4) return [];
  const db = await database();
  if (metadata.format === "buckets-v1") {
    const patients = await searchBucketPatientRoster(db, metadata.rosterId, normalized);
    return patients
      .filter((patient) => patientMatchesQuery(patient, normalized))
      .slice(0, limit)
      .map((patient) => ({
        id: Number(patient.documentNumber),
        documentNumber: patient.documentNumber,
        fullName: patient.fullName,
        birthDate: patient.birthDate,
        sex: patient.sex,
        syncVersion: 0,
      }));
  }
  let records: PatientRosterRecord[];
  if (/^\d{8}$/.test(normalized)) {
    const record = await db.get("rosterPatients", rosterToken(metadata.rosterId, `dni-exact:${normalized}`));
    records = record ? [record] : [];
  } else {
    const terms = patientQueryTerms(normalized);
    if (!terms.length) return [];
    const keySets = await Promise.all(terms.map(async (term) => new Set(await db.getAllKeysFromIndex(
      "rosterPatients",
      "by-search-token",
      rosterToken(metadata.rosterId, term),
      5_000,
    ))));
    const [first, ...rest] = keySets.sort((left, right) => left.size - right.size);
    const matchingKeys = [...first].filter((key) => rest.every((set) => set.has(key))).slice(0, 250);
    records = (await Promise.all(matchingKeys.map((key) => db.get("rosterPatients", key))))
      .filter((record): record is PatientRosterRecord => Boolean(record));
  }
  return records
    .filter((patient) => patientMatchesQuery(patient, normalized))
    .slice(0, limit)
    .map((patient) => ({
      id: Number(patient.documentNumber),
      documentNumber: patient.documentNumber,
      fullName: patient.fullName,
      birthDate: patient.birthDate,
      sex: patient.sex,
      syncVersion: 0,
    }));
}

export async function deleteActiveOfflineVault() {
  const db = await database();
  const meta = await getActiveVaultMeta();
  if (!meta) return;
  await deleteAllPatientRosters(meta.id);
  const tx = db.transaction(["settings", "vaults", "records", "outbox", "conflicts"], "readwrite");
  const deleteByVault = async (storeName: "records" | "outbox" | "conflicts") => {
    const keys = await tx.objectStore(storeName).index("by-vault").getAllKeys(meta.id);
    await Promise.all(keys.map((key) => tx.objectStore(storeName).delete(key)));
  };
  await deleteByVault("records");
  await deleteByVault("outbox");
  await deleteByVault("conflicts");
  await tx.objectStore("vaults").delete(meta.id);
  await tx.objectStore("settings").delete("active-vault");
  await tx.objectStore("settings").delete(rosterSettingId(meta.id));
  await tx.objectStore("settings").delete(rosterStagingSettingId(meta.id));
  await tx.done;
}

export async function resetOfflineDatabaseForTests() {
  const active = databasePromise ? await databasePromise.catch(() => null) : null;
  active?.close();
  databasePromise = null;
  await deleteDB(DB_NAME);
}
