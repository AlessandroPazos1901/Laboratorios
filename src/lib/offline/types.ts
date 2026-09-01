import type { LabData } from "@/lib/types";

export const OFFLINE_MODE_ENABLED = process.env.NEXT_PUBLIC_OFFLINE_MODE === "true";
// La posta puede pasar semanas sin internet: la autorización no caduca en la
// práctica. Se deja un plazo (no "sin exp") para que el token siga siendo un
// JWT normal y se pueda acortar de nuevo cambiando solo este número.
export const OFFLINE_LEASE_HOURS = 10 * 365 * 24;

export type OfflineOperationKind =
  | "patient.upsert"
  | "patient.update"
  | "analysis.register"
  | "results.save"
  | "catalog.apply";

export type OfflineOperationStatus = "pending" | "syncing" | "applied" | "conflict" | "blocked";

export type OfflineOperation = {
  clientMutationId: string;
  deviceId: string;
  actorId: string;
  kind: OfflineOperationKind;
  createdAt: string;
  dependencies: string[];
  baseVersion?: number;
  payload: Record<string, unknown>;
};

export type SyncConflict = {
  id: string;
  clientMutationId: string;
  kind: OfflineOperationKind;
  reason: string;
  local: Record<string, unknown>;
  remote: Record<string, unknown>;
  remoteVersion?: number;
  createdAt: string;
};

export type SyncPushResult = {
  clientMutationId: string;
  status: "applied" | "conflict" | "blocked";
  serverRefs?: Record<string, string | number | string[]>;
  conflict?: Omit<SyncConflict, "id" | "createdAt">;
  error?: string;
};

export type SyncBundle = {
  cursor: number;
  serverTime: string;
  mode: "snapshot" | "delta";
  data: LabData;
  currentUser: { id: string; fullName: string; role: string };
};

export type OfflineLeaseClaims = {
  userId: string;
  deviceId: string;
  deviceName: string;
  issuedAt: string;
  expiresAt: string;
};

export type OfflineLease = OfflineLeaseClaims & { token: string };

export type OfflineVaultSnapshot = {
  data: LabData;
  currentUser: SyncBundle["currentUser"];
  updatedAt: string;
};

export type OfflineRuntimeStatus =
  | "disabled"
  | "loading"
  // Una sola puerta para «no preparado», «bloqueado» y «autorización vencida»:
  // el formulario de ingreso resuelve los tres casos con el mismo credencial.
  | "needs-access"
  | "unlocked"
  | "error";
