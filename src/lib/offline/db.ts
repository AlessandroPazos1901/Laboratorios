import { deleteDB, openDB, type DBSchema, type IDBPDatabase } from "idb";
import {
  createDataKey,
  decryptJson,
  derivePinKey,
  encryptJson,
  randomBase64,
  unwrapDataKey,
  wrapDataKey,
  type EncryptedValue,
} from "@/lib/offline/crypto";
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
const DB_VERSION = 1;

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
}

let databasePromise: Promise<IDBPDatabase<OfflineDb>> | null = null;

function database() {
  if (!databasePromise) {
    databasePromise = openDB<OfflineDb>(DB_NAME, DB_VERSION, {
      upgrade(db) {
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
      },
    });
  }
  return databasePromise;
}

const recordId = (vaultId: string) => `${vaultId}:snapshot`;
const outboxId = (vaultId: string, mutationId: string) => `${vaultId}:${mutationId}`;
const conflictId = (vaultId: string, id: string) => `${vaultId}:${id}`;

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
  pin: string;
  lease: OfflineLease;
  snapshot: OfflineVaultSnapshot;
  cursor: number;
}) {
  await verifyOfflineLease(input.lease.token, input.lease.deviceId);
  const id = `${input.lease.userId}:${input.lease.deviceId}`;
  const salt = randomBase64(16);
  const pinKey = await derivePinKey(input.pin, salt);
  const dataKey = await createDataKey();
  const wrappedKey = await wrapDataKey(dataKey, pinKey);
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

export async function unlockOfflineVault(pin: string, allowExpired = false): Promise<UnlockedVault> {
  const meta = await getActiveVaultMeta();
  if (!meta) throw new Error("offline_vault_missing");
  const claims = await verifyOfflineLease(meta.lease.token, meta.deviceId);
  if (claims.userId !== meta.userId) throw new Error("offline_user_mismatch");
  if (!allowExpired && new Date(meta.lease.expiresAt).getTime() <= Date.now()) {
    throw new Error("offline_lease_expired");
  }
  const pinKey = await derivePinKey(pin, meta.salt);
  let key: CryptoKey;
  try {
    key = await unwrapDataKey(meta.wrappedKey, pinKey);
  } catch {
    throw new Error("offline_pin_incorrect");
  }
  const encrypted = await (await database()).get("records", recordId(meta.id));
  if (!encrypted) throw new Error("offline_snapshot_missing");
  try {
    const snapshot = await decryptJson<OfflineVaultSnapshot>(key, encrypted);
    return { meta, key, snapshot };
  } catch {
    throw new Error("offline_pin_incorrect");
  }
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

export async function deleteActiveOfflineVault() {
  const db = await database();
  const meta = await getActiveVaultMeta();
  if (!meta) return;
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
  await tx.done;
}

export async function resetOfflineDatabaseForTests() {
  databasePromise = null;
  await deleteDB(DB_NAME);
}
