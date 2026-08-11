"use client";

import { Activity, CloudOff, Database, KeyRound, LockKeyhole, RefreshCw, ShieldCheck, Trash2, Wifi } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import Image from "next/image";
import { LabApp } from "@/components/lab-app";
import {
  addOfflineConflict,
  createOfflineVault,
  deleteActiveOfflineVault,
  enqueueOfflineOperation,
  getActiveVaultMeta,
  listOfflineConflicts,
  listOfflineOperations,
  removeOfflineConflict,
  removeOfflineOperation,
  renewOfflineVaultLease,
  requestPersistentOfflineStorage,
  saveOfflineSnapshot,
  setOfflineOperationStatus,
  unlockOfflineVault,
  type OfflineVaultMeta,
  type UnlockedVault,
} from "@/lib/offline/db";
import { PIN_PATTERN } from "@/lib/offline/crypto";
import { OfflineRepositoryProvider } from "@/lib/offline/repository";
import {
  OFFLINE_MODE_ENABLED,
  type OfflineLease,
  type OfflineOperation,
  type OfflineRuntimeStatus,
  type SyncBundle,
  type SyncConflict,
  type SyncPushResult,
} from "@/lib/offline/types";
import type { LabData } from "@/lib/types";

async function jsonResponse<T>(response: Response) {
  const body = await response.json().catch(() => null) as (T & { error?: string }) | null;
  if (!response.ok) throw new Error(body?.error ?? `http_${response.status}`);
  return body as T;
}

function unavailablePatientName(value: string) {
  return !value.trim() || /no disponible|no encontrado|sin nombre/i.test(value);
}

function normalizeOfflineData(data: LabData, rejectIncomplete = false): LabData {
  const patients = [...data.patients];
  const patientsById = new Map(patients.map((patient) => [patient.id, patient]));

  // Older snapshots may still have the patient duplicated inside an order.
  // Recover that copy so DNI/name search works again without requiring a wipe.
  for (const order of data.orders) {
    if (patientsById.has(order.patientId) || unavailablePatientName(order.patientName)) continue;
    const documentNumber = order.documentNumber || String(order.patientId).padStart(8, "0");
    if (!/^\d{8}$/.test(documentNumber)) continue;
    const recovered = {
      id: order.patientId,
      documentNumber,
      fullName: order.patientName,
      birthDate: order.patientBirthDate,
      sex: order.patientSex,
      syncVersion: 1,
    } satisfies LabData["patients"][number];
    patients.push(recovered);
    patientsById.set(recovered.id, recovered);
  }

  const missingPatient = data.orders.some((order) => !patientsById.has(order.patientId));
  if (rejectIncomplete && missingPatient) throw new Error("La descarga de pacientes está incompleta; se conservó la copia local anterior.");

  const orders = data.orders.map((order) => {
    const patient = patientsById.get(order.patientId);
    return patient ? {
      ...order,
      patientName: patient.fullName,
      documentNumber: patient.documentNumber,
      patientBirthDate: patient.birthDate,
      patientSex: patient.sex,
    } : order;
  });
  return { ...data, patients, orders };
}

export function OfflineAppBootstrap() {
  const [status, setStatus] = useState<OfflineRuntimeStatus>("loading");
  const [online, setOnline] = useState(true);
  const [data, setData] = useState<LabData | null>(null);
  const [currentUser, setCurrentUser] = useState<SyncBundle["currentUser"] | null>(null);
  const [bundle, setBundle] = useState<SyncBundle | null>(null);
  const [session, setSession] = useState<UnlockedVault | null>(null);
  const [meta, setMeta] = useState<OfflineVaultMeta | null>(null);
  const [pendingCount, setPendingCount] = useState(0);
  const [conflicts, setConflicts] = useState<SyncConflict[]>([]);
  const [syncing, setSyncing] = useState(false);
  const [message, setMessage] = useState("");
  const [updateAvailable, setUpdateAvailable] = useState(false);
  const syncRequested = useRef(0);
  const syncingRef = useRef(false);

  const fetchBundle = useCallback(async (cursor = 0) => {
    const response = await fetch(`/api/sync/pull?cursor=${cursor}`, { cache: "no-store" });
    if (response.status === 401) {
      window.location.replace("/login");
      throw new Error("session_required");
    }
    const remote = await jsonResponse<SyncBundle>(response);
    return { ...remote, data: normalizeOfflineData(remote.data, true) };
  }, []);

  const refreshCounters = useCallback(async (active: UnlockedVault) => {
    const [operations, storedConflicts] = await Promise.all([
      listOfflineOperations(active, ["pending", "syncing", "blocked"]),
      listOfflineConflicts(active),
    ]);
    setPendingCount(operations.length);
    setConflicts(storedConflicts);
  }, []);

  const refreshOnlineData = useCallback(async () => {
    const remote = await fetchBundle(session?.meta.cursor ?? 0);
    if (session?.snapshot.data.patients.length && !remote.data.patients.length) {
      throw new Error("La descarga no contiene pacientes; se conservó la copia local anterior.");
    }
    setBundle(remote);
    setData(remote.data);
    setCurrentUser(remote.currentUser);
    if (session) {
      const snapshot = { data: remote.data, currentUser: remote.currentUser, updatedAt: remote.serverTime };
      const updatedSession = await saveOfflineSnapshot(session, snapshot, remote.cursor);
      setSession(updatedSession);
      setMeta(updatedSession.meta);
      await refreshCounters(updatedSession);
    }
  }, [fetchBundle, refreshCounters, session]);

  const performSync = useCallback(async (active = session) => {
    if (!active || !navigator.onLine || syncingRef.current) return;
    let working: UnlockedVault = { ...active, meta: { ...active.meta }, snapshot: active.snapshot };
    syncingRef.current = true;
    setSyncing(true);
    setMessage("");
    try {
      if (new Date(working.meta.lease.expiresAt).getTime() - Date.now() < 12 * 60 * 60 * 1000) {
        const { lease } = await jsonResponse<{ lease: OfflineLease }>(await fetch("/api/offline/renew", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ deviceId: working.meta.deviceId }),
        }));
        working = { ...working, meta: await renewOfflineVaultLease(working.meta, lease) };
        setMeta(working.meta);
      }
      const queued = await listOfflineOperations(working, ["pending", "blocked"]);
      if (queued.length) {
        queued.forEach(({ operation }) => void setOfflineOperationStatus(working, operation.clientMutationId, "syncing"));
        const payload = { deviceId: working.meta.deviceId, operations: queued.slice(0, 50).map((item) => item.operation) };
        const pushed = await jsonResponse<{ results: SyncPushResult[] }>(await fetch("/api/sync/push", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        }));
        for (const result of pushed.results) {
          if (result.status === "applied") {
            await removeOfflineOperation(working, result.clientMutationId);
          } else if (result.status === "conflict" && result.conflict) {
            const conflict: SyncConflict = {
              ...result.conflict,
              id: crypto.randomUUID(),
              createdAt: new Date().toISOString(),
            };
            await addOfflineConflict(working, conflict);
            await removeOfflineOperation(working, result.clientMutationId);
          } else {
            await setOfflineOperationStatus(working, result.clientMutationId, "blocked", result.error);
          }
        }
      }
      const remote = await fetchBundle(working.meta.cursor);
      if (working.snapshot.data.patients.length && !remote.data.patients.length) {
        throw new Error("La descarga no contiene pacientes; se conservó la copia local anterior.");
      }
      const snapshot = { data: remote.data, currentUser: remote.currentUser, updatedAt: remote.serverTime };
      working = await saveOfflineSnapshot(working, snapshot, remote.cursor);
      setSession(working);
      setData(remote.data);
      setCurrentUser(remote.currentUser);
      setBundle(remote);
      setMeta(working.meta);
      await refreshCounters(working);
      setMessage("Sincronización completada.");
    } catch (error) {
      const text = error instanceof Error ? error.message : "sync_failed";
      setMessage(text.includes("fetch") ? "Sin conexión con el servidor; los cambios siguen protegidos en este equipo." : `Sincronización pendiente: ${text}`);
      const queued = await listOfflineOperations(working, ["syncing"]);
      await Promise.all(queued.map(({ operation }) => setOfflineOperationStatus(working, operation.clientMutationId, "pending")));
      await refreshCounters(working);
    } finally {
      syncingRef.current = false;
      setSyncing(false);
    }
  }, [fetchBundle, refreshCounters, session]);

  useEffect(() => {
    let mounted = true;
    async function start() {
      if (!OFFLINE_MODE_ENABLED) {
        setStatus("disabled");
        return;
      }
      const localMeta = await getActiveVaultMeta();
      if (!mounted) return;
      setMeta(localMeta ?? null);
      if (localMeta) {
        setStatus(new Date(localMeta.lease.expiresAt).getTime() <= Date.now() ? "expired" : "locked");
        return;
      }
      if (!navigator.onLine) {
        setOnline(false);
        setStatus("not-prepared");
        return;
      }
      try {
        const remote = await fetchBundle();
        if (!mounted) return;
        setBundle(remote);
        setData(remote.data);
        setCurrentUser(remote.currentUser);
        setStatus("not-prepared");
      } catch (error) {
        if (!mounted) return;
        setMessage(error instanceof Error ? error.message : "No se pudo iniciar la aplicación.");
        setStatus("error");
      }
    }
    void start();
    return () => { mounted = false; };
  }, [fetchBundle]);

  useEffect(() => {
    const wentOnline = () => { setOnline(true); if (session) void performSync(session); };
    const wentOffline = () => setOnline(false);
    window.addEventListener("online", wentOnline);
    window.addEventListener("offline", wentOffline);
    const interval = window.setInterval(() => {
      if (!session) return;
      const expired = new Date(session.meta.lease.expiresAt).getTime() <= Date.now();
      if (expired && !navigator.onLine) {
        setSession(null);
        setData(null);
        setCurrentUser(null);
        setStatus("expired");
      } else if (navigator.onLine) {
        void performSync(session);
      }
    }, 30_000);
    return () => {
      window.removeEventListener("online", wentOnline);
      window.removeEventListener("offline", wentOffline);
      window.clearInterval(interval);
    };
  }, [performSync, session]);

  useEffect(() => {
    const registrationPromise = navigator.serviceWorker?.ready;
    if (!registrationPromise) return;
    void registrationPromise.then((registration) => {
      if (registration.waiting) setUpdateAvailable(true);
      registration.addEventListener("updatefound", () => {
        registration.installing?.addEventListener("statechange", () => {
          if (registration.waiting) setUpdateAvailable(true);
        });
      });
    });
  }, []);

  const requestSync = () => {
    syncRequested.current += 1;
    if (session && navigator.onLine) window.setTimeout(() => void performSync(session), 0);
    if (session) void refreshCounters(session);
  };

  async function enroll(pin: string, deviceName: string) {
    if (!bundle || !PIN_PATTERN.test(pin)) throw new Error("El PIN debe tener exactamente 4 dígitos.");
    const storage = await requestPersistentOfflineStorage();
    const available = Math.max(0, storage.quota - storage.usage);
    if (storage.quota && available < 25 * 1024 * 1024) throw new Error("El navegador no tiene al menos 25 MB libres para el modo offline.");
    const deviceId = crypto.randomUUID();
    const { lease } = await jsonResponse<{ lease: OfflineLease }>(await fetch("/api/offline/enroll", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ deviceId, deviceName }),
    }));
    const unlocked = await createOfflineVault({
      pin,
      lease,
      snapshot: { data: bundle.data, currentUser: bundle.currentUser, updatedAt: bundle.serverTime },
      cursor: bundle.cursor,
    });
    setSession(unlocked);
    setMeta(unlocked.meta);
    setData(unlocked.snapshot.data);
    setCurrentUser(unlocked.snapshot.currentUser);
    setStatus("unlocked");
    await refreshCounters(unlocked);
  }

  async function unlock(pin: string) {
    const unlocked = await unlockOfflineVault(pin);
    const normalized = {
      ...unlocked,
      snapshot: { ...unlocked.snapshot, data: normalizeOfflineData(unlocked.snapshot.data) },
    };
    setSession(normalized);
    setMeta(unlocked.meta);
    setData(normalized.snapshot.data);
    setCurrentUser(unlocked.snapshot.currentUser);
    setStatus("unlocked");
    await refreshCounters(normalized);
    if (navigator.onLine) void performSync(normalized);
  }

  async function renew() {
    if (!meta || !navigator.onLine) return;
    const { lease } = await jsonResponse<{ lease: OfflineLease }>(await fetch("/api/offline/renew", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ deviceId: meta.deviceId }),
    }));
    const updated = await renewOfflineVaultLease(meta, lease);
    setMeta(updated);
    setStatus("locked");
    setMessage("Autorización renovada. Ingresa el PIN para abrir la bóveda.");
  }

  async function deleteVault() {
    if (!window.confirm("Se eliminarán los datos offline de este equipo. No continúes si existen cambios pendientes.")) return;
    if (meta && navigator.onLine) {
      await fetch(`/api/offline/devices/${meta.deviceId}`, { method: "DELETE" }).catch(() => undefined);
    }
    await deleteActiveOfflineVault();
    window.location.reload();
  }

  async function acceptRemote(conflict: SyncConflict) {
    if (!session) return;
    await removeOfflineConflict(session, conflict.id);
    await refreshCounters(session);
  }

  async function retryLocal(conflict: SyncConflict) {
    if (!session || !currentUser) return;
    const operation: OfflineOperation = {
      clientMutationId: crypto.randomUUID(),
      deviceId: session.meta.deviceId,
      actorId: currentUser.id,
      kind: conflict.kind,
      createdAt: new Date().toISOString(),
      dependencies: [],
      baseVersion: conflict.remoteVersion,
      payload: conflict.local,
    };
    await enqueueOfflineOperation(session, operation);
    await removeOfflineConflict(session, conflict.id);
    await refreshCounters(session);
    requestSync();
  }

  if (status === "disabled") {
    return <OfflineGate icon={<CloudOff />} title="Modo offline desactivado" text="Activa NEXT_PUBLIC_OFFLINE_MODE después de aplicar la migración y configurar las claves de autorización." />;
  }
  if (status === "loading") return <OfflineGate icon={<Activity className="spin" />} title="Preparando LIMS Jose" text="Verificando la aplicación y el almacenamiento seguro…" />;
  if (status === "error") return <OfflineGate icon={<CloudOff />} title="No se pudo abrir el sistema" text={message || "Reconecta este equipo y vuelve a intentarlo."} />;
  if (status === "not-prepared" && !data) {
    return <OfflineGate icon={<Database />} title="Este equipo no está preparado" text="Conéctalo a internet, inicia sesión y habilita el modo offline antes de la próxima interrupción." />;
  }
  if ((status === "locked" || status === "expired") && meta) {
    return <UnlockGate meta={meta} expired={status === "expired"} online={online} message={message} unlock={unlock} renew={renew} deleteVault={deleteVault} />;
  }
  if (!data || !currentUser) return <OfflineGate icon={<Database />} title="Datos no disponibles" text="No existe una copia clínica utilizable en este equipo." />;

  return <OfflineRepositoryProvider
    data={data}
    currentUser={currentUser}
    session={session}
    online={online}
    setData={setData}
    setSession={setSession}
    refresh={refreshOnlineData}
    requestSync={requestSync}
  >
    <div className="offline-runtime-shell">
      <OfflineStatusBar
        online={online}
        prepared={Boolean(session)}
        syncing={syncing}
        pending={pendingCount}
        conflicts={conflicts.length}
        lastSyncAt={meta?.lastSyncAt}
        message={message}
        updateAvailable={updateAvailable}
        sync={() => void performSync()}
        lock={() => { setSession(null); setData(null); setCurrentUser(null); setStatus("locked"); }}
        deleteVault={deleteVault}
        activateUpdate={async () => {
          if (pendingCount) return setMessage("Sincroniza los cambios pendientes antes de actualizar la PWA.");
          const registration = await navigator.serviceWorker.ready;
          registration.waiting?.postMessage({ type: "SKIP_WAITING" });
          window.location.reload();
        }}
      />
      {status === "not-prepared" && bundle && <EnrollPanel enroll={enroll} />}
      {conflicts.length > 0 && <ConflictPanel conflicts={conflicts} acceptRemote={acceptRemote} retryLocal={retryLocal} />}
      <LabApp data={data} currentUser={{ fullName: currentUser.fullName, role: currentUser.role }} />
    </div>
  </OfflineRepositoryProvider>;
}

function OfflineGate({ icon, title, text }: { icon: React.ReactNode; title: string; text: string }) {
  return <main className="offline-gate"><section><span>{icon}</span><p className="eyebrow">Continuidad operativa</p><h1>{title}</h1><p>{text}</p><Image src="/logo_laboratorio.png" width={786} height={156} alt="Laboratorio Clínico Centro de Salud" /></section></main>;
}

function EnrollPanel({ enroll }: { enroll(pin: string, deviceName: string): Promise<void> }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(() => `Equipo ${navigator.platform || "Windows"}`);
  const [pin, setPin] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  if (!open) return <div className="offline-enroll-banner"><ShieldCheck /><span><strong>Este equipo todavía depende de internet.</strong><small>Descarga una copia cifrada para continuar durante una caída.</small></span><button className="button primary" onClick={() => setOpen(true)}>Habilitar uso offline</button></div>;
  return <div className="dialog-backdrop offline-setup-dialog"><section className="dialog-card"><p className="eyebrow">Equipo de confianza</p><h2>Habilitar uso offline</h2><p>La información clínica quedará cifrada en este perfil de Windows durante 72 horas. Usa un perfil de Windows protegido y no compartas el PIN.</p><label>Nombre del equipo<input value={name} onChange={(event) => setName(event.target.value)} maxLength={80} /></label><label>PIN local de 4 dígitos<input type="password" inputMode="numeric" autoComplete="off" maxLength={4} value={pin} onChange={(event) => setPin(event.target.value.replace(/\D/g, "").slice(0, 4))} /></label>{error && <p className="form-error">{error}</p>}<div className="dialog-actions"><button className="button secondary" onClick={() => setOpen(false)}>Cancelar</button><button className="button primary" disabled={saving || !PIN_PATTERN.test(pin) || name.trim().length < 2} onClick={async () => { setSaving(true); setError(""); try { await enroll(pin, name.trim()); } catch (reason) { setError(reason instanceof Error ? reason.message : "No se pudo preparar el equipo."); } finally { setSaving(false); } }}>{saving ? "Cifrando…" : "Cifrar y habilitar"}</button></div></section></div>;
}

function UnlockGate(props: { meta: OfflineVaultMeta; expired: boolean; online: boolean; message: string; unlock(pin: string): Promise<void>; renew(): Promise<void>; deleteVault(): Promise<void> }) {
  const [pin, setPin] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  return <main className="offline-gate"><section><span>{props.expired ? <CloudOff /> : <LockKeyhole />}</span><p className="eyebrow">{props.meta.deviceName}</p><h1>{props.expired ? "Autorización offline vencida" : "Bóveda clínica bloqueada"}</h1><p>{props.expired ? "Los datos siguen cifrados. Reconecta y renueva la autorización para abrirlos." : `Autorizado hasta ${new Date(props.meta.lease.expiresAt).toLocaleString("es-PE")}.`}</p>{props.message && <p className="compat-note">{props.message}</p>}{!props.expired && <><label>PIN local<input autoFocus type="password" inputMode="numeric" autoComplete="off" maxLength={32} value={pin} onChange={(event) => setPin(event.target.value.replace(/\D/g, "").slice(0, 32))} onKeyDown={(event) => { if (event.key === "Enter") (event.currentTarget.nextElementSibling as HTMLButtonElement | null)?.click(); }} /></label><button className="button primary wide" disabled={loading || !PIN_PATTERN.test(pin)} onClick={async () => { setLoading(true); setError(""); try { await props.unlock(pin); } catch (reason) { setError(reason instanceof Error && reason.message === "offline_pin_incorrect" ? "PIN incorrecto." : "No se pudo abrir la bóveda."); } finally { setLoading(false); } }}><KeyRound />{loading ? "Abriendo…" : "Desbloquear"}</button></>}{props.expired && <button className="button primary wide" disabled={!props.online || loading} onClick={async () => { setLoading(true); setError(""); try { await props.renew(); } catch (reason) { setError(reason instanceof Error ? reason.message : "No se pudo renovar."); } finally { setLoading(false); } }}><RefreshCw />{props.online ? "Renovar por 72 horas" : "Conecta este equipo"}</button>}{error && <p className="form-error">{error}</p>}<button className="text-button danger-text" onClick={() => void props.deleteVault()}><Trash2 />Eliminar datos offline de este equipo</button></section></main>;
}

function OfflineStatusBar(props: { online: boolean; prepared: boolean; syncing: boolean; pending: number; conflicts: number; lastSyncAt?: string; message: string; updateAvailable: boolean; sync(): void; lock(): void; deleteVault(): void; activateUpdate(): void }) {
  return <div className="offline-status-bar"><span className={props.online ? "online" : "offline"}>{props.online ? <Wifi /> : <CloudOff />}{props.online ? "Con internet" : "Sin internet"}</span><span><Database />{props.prepared ? `${props.pending} pendientes · ${props.conflicts} conflictos` : "Equipo no preparado"}</span>{props.lastSyncAt && <small>Última sincronización: {new Date(props.lastSyncAt).toLocaleString("es-PE")}</small>}{props.message && <small>{props.message}</small>}<div>{props.prepared && <button className="text-button" disabled={!props.online || props.syncing} onClick={props.sync}><RefreshCw className={props.syncing ? "spin" : ""} />{props.syncing ? "Sincronizando" : "Sincronizar"}</button>}{props.updateAvailable && <button className="text-button" onClick={props.activateUpdate}>Actualizar PWA</button>}{props.prepared && <button className="text-button" onClick={props.lock}><LockKeyhole />Bloquear</button>}</div></div>;
}

function ConflictPanel(props: { conflicts: SyncConflict[]; acceptRemote(conflict: SyncConflict): Promise<void>; retryLocal(conflict: SyncConflict): Promise<void> }) {
  return <details className="offline-conflict-panel" open><summary>{props.conflicts.length} conflicto(s) requieren revisión</summary>{props.conflicts.map((conflict) => <article key={conflict.id}><div><strong>{conflict.kind}</strong><small>{conflict.reason}</small></div><pre>Local: {JSON.stringify(conflict.local, null, 2)}{"\n"}Servidor: {JSON.stringify(conflict.remote, null, 2)}</pre><div><button className="button secondary" onClick={() => void props.acceptRemote(conflict)}>Conservar servidor</button><button className="button primary" onClick={() => void props.retryLocal(conflict)}>Reintentar cambio local</button></div></article>)}</details>;
}
