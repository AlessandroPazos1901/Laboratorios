"use client";

import { Activity, CloudOff, Database, RefreshCw, Trash2 } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import Image from "next/image";
import { LabApp } from "@/components/lab-app";
import { ConnectionBadge, LoginCardVisual, LoginScreen, LoginShell } from "@/components/login-screen";
import {
  addOfflineConflict,
  countUnsentOperations,
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
  resumeOfflineVault,
  unlockOfflineVault,
  type OfflineVaultMeta,
  type UnlockedVault,
} from "@/lib/offline/db";
import { probeServerConnectivity, withTimeout } from "@/lib/offline/connectivity";
import { forgetVaultKey, recallVaultKey, rememberVaultKey } from "@/lib/offline/session-key";
import { takeHandedCredentials } from "@/lib/offline/handoff";
import { resultConflictAlreadyApplied, resultConflictDetails } from "@/lib/offline/materialize";
import { exportDataKey, importDataKey } from "@/lib/offline/crypto";
import { rebaseSnapshot } from "@/lib/offline/rebase";
import { orderOperationsByDependencies } from "@/lib/offline/sync";
import { OfflineRepositoryProvider } from "@/lib/offline/repository";
import { createClient, isSupabaseConfigured, resolveLoginEmail } from "@/lib/supabase/client";
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

/**
 * Marca de un solo rebote a /login. `sessionStorage` puede lanzar (ventana
 * privada, almacenamiento bloqueado); si falla, se comporta como si no hubiera
 * rebote y el peor caso es pedir la contraseña aquí.
 */
const BOUNCE_KEY = "lims-jose:login-bounce";
const bounceMark = {
  taken: () => { try { return sessionStorage.getItem(BOUNCE_KEY) === "1"; } catch { return false; } },
  set: () => { try { sessionStorage.setItem(BOUNCE_KEY, "1"); } catch { /* sin marca, un rebote más */ } },
  clear: () => { try { sessionStorage.removeItem(BOUNCE_KEY); } catch { /* nada que limpiar */ } },
};

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
      birthTime: order.patientBirthTime,
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
      patientBirthTime: patient.birthTime,
      patientSex: patient.sex,
    } : order;
  });
  return { ...data, patients, orders };
}

export function OfflineAppBootstrap() {
  const [status, setStatus] = useState<OfflineRuntimeStatus>("loading");
  const [online, setOnline] = useState(() => typeof navigator === "undefined" || navigator.onLine);
  const [data, setData] = useState<LabData | null>(null);
  const [currentUser, setCurrentUser] = useState<SyncBundle["currentUser"] | null>(null);
  const [session, setSession] = useState<UnlockedVault | null>(null);
  const [meta, setMeta] = useState<OfflineVaultMeta | null>(null);
  const [conflicts, setConflicts] = useState<SyncConflict[]>([]);
  // Distinto de null: la copia local está cifrada con un secreto anterior y hay
  // que rehacerla. El número dice cuántos cambios sin enviar se perderían.
  const [stalePending, setStalePending] = useState<number | null>(null);
  // La contraseña que acaba de validar Supabase, para rehacer la copia sin
  // volver a pedirla. Vive en memoria solo hasta que se usa.
  const stalePasswordRef = useRef("");
  const [message, setMessage] = useState("");
  const syncRequested = useRef(0);
  const syncingRef = useRef(false);
  // `requestSync` se dispara desde un `setTimeout` y desde escuchadores de ventana:
  // sin esta referencia capturaban la bóveda del render anterior al commit.
  const sessionRef = useRef<UnlockedVault | null>(session);
  sessionRef.current = session;

  const fetchBundle = useCallback(async (cursor = 0) => {
    let response: Response;
    try {
      response = await fetch(`/api/sync/pull?cursor=${cursor}`, { cache: "no-store" });
      setOnline(true);
    } catch (reason) {
      setOnline(false);
      throw reason;
    }
    // Un 401 no manda a otra pantalla: quien lo recibe decide. En el arranque
    // significa «pide credenciales aquí»; durante una sincronización, «la sesión
    // caducó». Antes redirigía siempre y por eso había dos pantallas de ingreso.
    const remote = await jsonResponse<SyncBundle>(response);
    return { ...remote, data: normalizeOfflineData(remote.data, true) };
  }, []);

  const refreshCounters = useCallback(async (active: UnlockedVault) => {
    const [operations, storedConflicts] = await Promise.all([
      listOfflineOperations(active, ["pending", "syncing", "blocked"]),
      listOfflineConflicts(active),
    ]);
    setConflicts(storedConflicts);
    return operations;
  }, []);

  /**
   * El servidor responde siempre con el snapshot completo. Guardarlo tal cual
   * borraba de la pantalla cualquier cambio que siguiera en la cola: la operación
   * quedaba encolada pero su efecto desaparecía a los segundos. Por eso todo
   * snapshot que llega pasa antes por `rebaseSnapshot`.
   */
  const applyRemoteSnapshot = useCallback(async (active: UnlockedVault | null, remote: SyncBundle) => {
    const pending = active
      ? (await listOfflineOperations(active, ["pending", "syncing", "blocked"])).map(({ operation }) => operation)
      : [];
    const merged = rebaseSnapshot(remote.data, pending, remote.currentUser.fullName);
    setData(merged);
    setCurrentUser(remote.currentUser);
    if (!active) return null;
    const snapshot = { data: merged, currentUser: remote.currentUser, updatedAt: remote.serverTime };
    const updated = await saveOfflineSnapshot(active, snapshot, remote.cursor);
    setSession(updated);
    setMeta(updated.meta);
    return updated;
  }, []);

  const refreshOnlineData = useCallback(async () => {
    const active = sessionRef.current;
    const remote = await fetchBundle(active?.meta.cursor ?? 0);
    const updated = await applyRemoteSnapshot(active, remote);
    if (updated) await refreshCounters(updated);
  }, [applyRemoteSnapshot, fetchBundle, refreshCounters]);

  const performSync = useCallback(async (input?: UnlockedVault) => {
    const active = input ?? sessionRef.current;
    if (!active || syncingRef.current) return;
    if (!await probeServerConnectivity()) {
      setOnline(false);
      return;
    }
    setOnline(true);
    let working: UnlockedVault = { ...active, meta: { ...active.meta }, snapshot: active.snapshot };
    syncingRef.current = true;
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
      // El envío admite 50 operaciones por lote. Antes se mandaba uno solo y el
      // resto quedaba varado; ahora se vacía la cola en tandas sucesivas.
      for (;;) {
        const queued = orderOperationsByDependencies(await listOfflineOperations(working, ["pending", "blocked"]));
        if (!queued.length) break;
        const sending = queued.slice(0, 50);
        // Solo el lote que realmente sale se marca "syncing": marcar toda la cola
        // dejaba lo que no cabía en un estado que ningún envío posterior recoge.
        await Promise.all(sending.map(({ operation }) =>
          setOfflineOperationStatus(working, operation.clientMutationId, "syncing")));
        const payload = { deviceId: working.meta.deviceId, operations: sending.map((item) => item.operation) };
        const pushed = await jsonResponse<{ results: SyncPushResult[] }>(await fetch("/api/sync/push", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        }));
        let resolved = 0;
        for (const result of pushed.results) {
          if (result.status === "applied") {
            await removeOfflineOperation(working, result.clientMutationId);
            resolved += 1;
          } else if (result.status === "conflict" && result.conflict) {
            const conflict: SyncConflict = {
              ...result.conflict,
              id: crypto.randomUUID(),
              createdAt: new Date().toISOString(),
            };
            await addOfflineConflict(working, conflict);
            await removeOfflineOperation(working, result.clientMutationId);
            resolved += 1;
          } else {
            await setOfflineOperationStatus(working, result.clientMutationId, "blocked", result.error);
          }
        }
        // El servidor puede no devolver una operación que sí enviamos; sin esto
        // se quedaría en "syncing" para siempre.
        const unanswered = await listOfflineOperations(working, ["syncing"]);
        await Promise.all(unanswered.map(({ operation }) =>
          setOfflineOperationStatus(working, operation.clientMutationId, "pending")));
        // Lote entero rechazado: repetirlo en bucle no cambiaría el resultado.
        if (!resolved) break;
      }
      const remote = await fetchBundle(working.meta.cursor);
      const savedConflicts = await listOfflineConflicts(working);
      const duplicateConflicts = savedConflicts.filter((conflict) =>
        resultConflictAlreadyApplied(conflict, remote.data));
      await Promise.all(duplicateConflicts.map((conflict) => removeOfflineConflict(working, conflict.id)));
      working = await applyRemoteSnapshot(working, remote) ?? working;
      const remaining = await refreshCounters(working);
      syncRequested.current = remaining.length;
      setMessage(remaining.length
        ? `${remaining.length === 1 ? "Un cambio sigue" : `${remaining.length} cambios siguen`} pendiente${remaining.length === 1 ? "" : "s"} de guardarse. Se reintentará solo.`
        : "Todos los cambios fueron guardados.");
    } catch (reason) {
      // El servidor responde pero la sesión caducó. Sin esto la cola se reintentaba
      // en bucle contra un 401 y la insignia seguía diciendo «Con conexión».
      if (reason instanceof Error && reason.message === "http_401") {
        window.location.replace("/login");
        return;
      }
      const reachable = await probeServerConnectivity();
      setOnline(reachable);
      // Con el servidor accesible, callar el motivo real deja al usuario creyendo
      // que solo faltan cambios por subir mientras la descarga lleva días fallando.
      const detail = reason instanceof Error ? reason.message : "";
      setMessage(!reachable
        ? "Sin internet. Los cambios permanecen guardados en este equipo."
        : `No se pudo sincronizar con el servidor${detail ? ` (${detail})` : ""}. Se reintentará automáticamente.`);
      const queued = await listOfflineOperations(working, ["syncing"]);
      await Promise.all(queued.map(({ operation }) => setOfflineOperationStatus(working, operation.clientMutationId, "pending")));
      const remaining = await refreshCounters(working);
      syncRequested.current = remaining.length;
    } finally {
      syncingRef.current = false;
    }
  }, [applyRemoteSnapshot, fetchBundle, refreshCounters]);

  useEffect(() => {
    let mounted = true;
    async function start() {
      try {
        if (!OFFLINE_MODE_ENABLED) {
          setStatus("disabled");
          return;
        }
        const localMeta = await getActiveVaultMeta();
        if (!mounted) return;
        setMeta(localMeta ?? null);
        const reachable = await probeServerConnectivity();
        if (!mounted) return;
        setOnline(reachable);

        // Recarga de la misma pestaña: la clave sigue guardada, así que se
        // retoma sin pedir nada. Antes esto expulsaba al ingreso principal y
        // parecía que la sesión se hubiera cerrado sola.
        const stashed = recallVaultKey();
        if (localMeta && stashed) {
          try {
            await adoptVaultRef.current(await resumeOfflineVault(await importDataKey(stashed)));
            return;
          } catch {
            // Bóveda cambiada o clave inservible: se sigue
            // por el camino normal y se pedirá la contraseña.
            forgetVaultKey();
            if (!mounted) return;
          }
        }

        // Con internet solo se ingresa por la pantalla principal. Si viene de
        // ahí, trae la contraseña y la copia local se abre sola: el usuario no
        // ve un segundo formulario.
        const handed = takeHandedCredentials();
        if (handed) {
          await signInRef.current(handed.username, handed.password);
          return;
        }
        // Con internet pero sin credenciales (recarga, o se entró directo a
        // /app): se devuelve a la pantalla principal en vez de abrir aquí un
        // segundo formulario que haría teclear la contraseña dos veces. El
        // rebote se marca una vez: si al volver siguiera sin credenciales, ir y
        // venir sin fin sería peor que pedirlas aquí.
        if (reachable && !bounceMark.taken()) {
          bounceMark.set();
          window.location.replace("/login");
          return;
        }
        bounceMark.clear();
        // Sin internet esta es la única puerta.
        setStatus("needs-access");
      } catch (error) {
        if (!mounted) return;
        const reason = error instanceof Error ? error.message : "";
        // La bóveda vieja no abre con la contraseña nueva: eso tiene su propia
        // pantalla con el botón para rehacer la copia, no es un error de arranque.
        if (reason === "stale_vault") {
          setStatus("needs-access");
          return;
        }
        setMessage(reason === "offline_database_blocked"
          ? "Los datos están abiertos en otra ventana. Cierra todas las pestañas y ventanas de LIMS José, luego abre solo una."
          : reason || "No se pudo iniciar la aplicación.");
        setStatus("error");
      }
    }
    void start();
    return () => { mounted = false; };
  }, [fetchBundle]);

  useEffect(() => {
    // También en la pantalla de ingreso: hay que saber si validar contra la base
    // o contra la copia local, y el texto del formulario lo dice.
    if (status !== "unlocked" && status !== "needs-access") return;
    let mounted = true;
    const checkConnectivity = async () => {
      const reachable = await probeServerConnectivity();
      if (!mounted) return false;
      setOnline(reachable);
      return reachable;
    };
    /**
     * Un solo ciclo cubre las dos necesidades: subir lo que está en la cola y
     * bajar lo que hicieron los demás equipos (`performSync` termina con un pull).
     * Sin esto, con varias personas trabajando a la vez cada una veía su propia
     * copia congelada hasta recargar.
     */
    const catchUp = async () => {
      if (!await checkConnectivity() || !sessionRef.current) return;
      await performSync(sessionRef.current);
    };
    const wentOnline = () => void catchUp();
    const wentOffline = () => setOnline(false);
    const visibilityChanged = () => { if (document.visibilityState === "visible") void catchUp(); };
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") void catchUp();
    }, 30_000);
    window.addEventListener("online", wentOnline);
    window.addEventListener("offline", wentOffline);
    document.addEventListener("visibilitychange", visibilityChanged);
    void checkConnectivity();
    return () => {
      mounted = false;
      window.clearInterval(timer);
      window.removeEventListener("online", wentOnline);
      window.removeEventListener("offline", wentOffline);
      document.removeEventListener("visibilitychange", visibilityChanged);
    };
  }, [performSync, refreshOnlineData, status]);

  const requestSync = useCallback(() => {
    syncRequested.current += 1;
    const active = sessionRef.current;
    if (!active) return;
    void refreshCounters(active);
    window.setTimeout(() => void performSync(), 0);
  }, [performSync, refreshCounters]);

  /** Primer ingreso en este equipo: descarga los datos y deja la copia cifrada lista. */
  async function prepareDevice(password: string) {
    const storage = await requestPersistentOfflineStorage();
    const available = Math.max(0, storage.quota - storage.usage);
    if (storage.quota && available < 25 * 1024 * 1024) throw new Error("Este equipo no tiene suficiente espacio libre para guardar los datos necesarios.");
    const remote = await fetchBundle();
    const deviceId = crypto.randomUUID();
    const deviceName = `Equipo ${navigator.userAgent.includes("Windows") ? "Windows" : "de laboratorio"}`;
    const { lease } = await jsonResponse<{ lease: OfflineLease }>(await fetch("/api/offline/enroll", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ deviceId, deviceName }),
    }));
    const unlocked = await createOfflineVault({
      password,
      lease,
      snapshot: { data: remote.data, currentUser: remote.currentUser, updatedAt: remote.serverTime },
      cursor: remote.cursor,
    });
    setSession(unlocked);
    setMeta(unlocked.meta);
    setData(unlocked.snapshot.data);
    setCurrentUser(unlocked.snapshot.currentUser);
    setStatus("unlocked");
    bounceMark.clear();
    rememberVaultKey(await exportDataKey(unlocked.key));
    await refreshCounters(unlocked);
  }

  /**
   * Una sola puerta. Con internet manda Supabase, que es la única autoridad sobre
   * la contraseña. Sin internet vale que la contraseña abra la bóveda local: solo
   * pudo cifrarse así tras un ingreso conectado válido.
   */
  // El arranque necesita llamar a `signIn` sin volver a dispararse en cada
  // render, y `signIn` depende de casi todo el componente.
  const signInRef = useRef<(username: string, password: string) => Promise<void>>(null!);
  signInRef.current = signIn;
  const adoptVaultRef = useRef<(vault: UnlockedVault) => Promise<void>>(null!);
  adoptVaultRef.current = adoptVault;

  async function signIn(username: string, password: string) {
    const reachable = await probeServerConnectivity();
    setOnline(reachable);
    if (reachable) {
      try {
        return await withTimeout(signInOnline(username, password));
      } catch (reason) {
        // Solo el silencio de la red hace caer al camino local. Una contraseña
        // mal escrita se responde tal cual: entrar con la copia local en ese
        // caso sería aceptar credenciales que el servidor ya rechazó.
        if (!(reason instanceof Error) || reason.message !== "network_timeout") throw reason;
        setOnline(false);
        setMessage("El servidor no responde. Se abrió la copia guardada en este equipo.");
      }
    }
    if (!meta) throw new Error("offline_not_prepared");
    return unlock(password);
  }

  async function signInOnline(username: string, password: string) {
    {
      const email = await resolveLoginEmail(username);
      const failed = !email || (await createClient().auth.signInWithPassword({ email, password })).error;
      if (failed) throw new Error("bad_credentials");
      const localMeta = await getActiveVaultMeta();
      if (!localMeta) return prepareDevice(password);
      if (new Date(localMeta.lease.expiresAt).getTime() <= Date.now()) {
        const { lease } = await jsonResponse<{ lease: OfflineLease }>(await fetch("/api/offline/renew", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ deviceId: localMeta.deviceId }),
        }));
        setMeta(await renewOfflineVaultLease(localMeta, lease));
      }
      try {
        return await unlock(password);
      } catch (reason) {
        if (!(reason instanceof Error) || reason.message !== "offline_password_incorrect") throw reason;
        // Supabase aceptó la contraseña, así que no está mal escrita: la copia
        // local se cifró con un secreto anterior (el PIN de la versión previa, o
        // una contraseña cambiada en otro equipo). No es un error de tecleo y
        // decirlo así confunde: hay que rehacer la copia.
        stalePasswordRef.current = password;
        setStalePending(await countUnsentOperations(localMeta.id));
        throw new Error("stale_vault");
      }
    }
  }

  async function unlock(password: string) {
    return adoptVault(await unlockOfflineVault(password));
  }

  async function adoptVault(unlocked: UnlockedVault) {
    const normalized = {
      ...unlocked,
      snapshot: { ...unlocked.snapshot, data: normalizeOfflineData(unlocked.snapshot.data) },
    };
    setSession(normalized);
    setMeta(unlocked.meta);
    setData(normalized.snapshot.data);
    setCurrentUser(unlocked.snapshot.currentUser);
    setStatus("unlocked");
    // Se entró bien: el próximo arranque puede volver a rebotar si hace falta.
    bounceMark.clear();
    rememberVaultKey(await exportDataKey(normalized.key));
    // Si la pestaña se cerró a mitad de un envío, esas operaciones quedaron en
    // "syncing" y ningún envío posterior las recoge. Al abrir se devuelven a la
    // cola; reenviarlas es inofensivo porque el recibo del servidor las deduplica.
    const stranded = await listOfflineOperations(normalized, ["syncing"]);
    await Promise.all(stranded.map(({ operation }) =>
      setOfflineOperationStatus(normalized, operation.clientMutationId, "pending")));
    const queuedOperations = await refreshCounters(normalized);
    // Cualquier cambio pendiente merece salir, no solo los que crean registros:
    // una edición de catálogo hecha sin conexión también tiene que subir. Y aunque
    // no haya nada que subir, conviene bajar lo que hicieron los otros equipos.
    syncRequested.current = queuedOperations.length;
    void performSync(normalized);
  }

  /** Borra la copia local ilegible y la vuelve a bajar. Ya hay sesión válida. */
  async function rebuildDevice() {
    const password = stalePasswordRef.current;
    if (!password) throw new Error("bad_credentials");
    if (meta) await fetch(`/api/offline/devices/${meta.deviceId}`, { method: "DELETE" }).catch(() => undefined);
    await deleteActiveOfflineVault();
    forgetVaultKey();
    setMeta(null);
    setStalePending(null);
    await prepareDevice(password);
    stalePasswordRef.current = "";
  }

  async function deleteVault() {
    if (!window.confirm("¿Eliminar los datos guardados en este equipo? Antes de continuar, comprueba que no haya cambios por enviar.")) return;
    if (meta && online) {
      await fetch(`/api/offline/devices/${meta.deviceId}`, { method: "DELETE" }).catch(() => undefined);
    }
    await deleteActiveOfflineVault();
    forgetVaultKey();
    window.location.reload();
  }

  async function signOutAfterStartupError() {
    try {
      if (isSupabaseConfigured) await createClient().auth.signOut({ scope: "local" });
    } finally {
      window.location.replace("/login");
    }
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
      payload: conflict.kind === "results.save" && conflict.remoteVersion
        ? { ...conflict.local, expectedLockVersion: conflict.remoteVersion }
        : conflict.local,
    };
    await enqueueOfflineOperation(session, operation);
    await removeOfflineConflict(session, conflict.id);
    await refreshCounters(session);
    requestSync();
  }

  if (status === "disabled") {
    return <OfflineGate icon={<CloudOff />} title="Trabajo sin internet no disponible" text="Esta función aún no está habilitada. Comunícate con el administrador del sistema." />;
  }
  if (status === "loading") return <OfflineGate icon={<Activity className="spin" />} title="Preparando LIMS Jose" text="Comprobando los datos guardados en este equipo…" />;
  if (status === "error") return <OfflineGate icon={<CloudOff />} title="No se pudo abrir el sistema" text={message || "Reconecta este equipo y vuelve a intentarlo."} actionLabel="Cerrar sesión y volver al ingreso" action={signOutAfterStartupError} />;
  if (status === "needs-access") {
    return <AccessGate meta={meta} online={online} message={message} signIn={signIn} deleteVault={deleteVault} stalePending={stalePending} rebuildDevice={rebuildDevice} />;
  }
  if (!data || !currentUser) return <OfflineGate icon={<Database />} title="Datos no disponibles" text="Este equipo todavía no tiene los datos necesarios para trabajar sin internet." />;

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
      {conflicts.length > 0 &&<ConflictPanel conflicts={conflicts} data={data} acceptRemote={acceptRemote} retryLocal={retryLocal} />}
      <LabApp data={data} currentUser={{ fullName: currentUser.fullName, role: currentUser.role }} />
    </div>
  </OfflineRepositoryProvider>;
}

function OfflineGate({ icon, title, text, actionLabel, action }: { icon: React.ReactNode; title: string; text: string; actionLabel?: string; action?: () => void | Promise<void> }) {
  return <main className="offline-gate"><section><span>{icon}</span><p className="eyebrow">Trabajo sin internet</p><h1>{title}</h1><p>{text}</p>{actionLabel && action && <button className="button primary" onClick={() => void action()}>{actionLabel}</button>}<Image src="/logo_laboratorio.png" width={786} height={156} alt="Laboratorio Clínico Centro de Salud" /></section></main>;
}

const accessError: Record<string, string> = {
  bad_credentials: "Usuario o contraseña incorrectos.",
  offline_password_incorrect: "Contraseña incorrecta.",
  offline_not_prepared: "Este equipo aún no se ha usado con internet. Conéctalo una vez para poder trabajar sin conexión.",
  offline_database_blocked: "Los datos están abiertos en otra ventana. Cierra las demás pestañas de LIMS José.",
};

/**
 * La única pantalla de ingreso. Con internet valida contra la base; sin internet,
 * contra la copia cifrada de este equipo. Mismo usuario y misma contraseña en los
 * dos casos: antes había que iniciar sesión y además recordar un PIN aparte.
 */
function AccessGate(props: {
  meta: OfflineVaultMeta | null;
  online: boolean;
  message: string;
  stalePending: number | null;
  signIn(username: string, password: string): Promise<void>;
  rebuildDevice(): Promise<void>;
  deleteVault(): Promise<void>;
}) {
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const run = async (action: () => Promise<void>) => {
    setLoading(true);
    setError("");
    try {
      await action();
    } catch (reason) {
      const code = reason instanceof Error ? reason.message : "";
      setError(accessError[code] ?? "No se pudo ingresar. Vuelve a intentarlo.");
    } finally {
      setLoading(false);
    }
  };

  const stalePending = props.stalePending;
  if (stalePending !== null) {
    return <LoginShell><section className="login-card">
      <LoginCardVisual />
      <div>
        <ConnectionBadge online={props.online} />
        <h2>Hay que rehacer los datos de este equipo</h2>
        <p className="muted">Tu contraseña es correcta. Lo que pasa es que esta computadora guardó su copia con la clave anterior, y esa copia ya no se puede abrir.</p>
      </div>
      <p className="compat-note">{stalePending > 0
        ? `Atención: quedan ${stalePending} ${stalePending === 1 ? "cambio sin enviar que se perderá" : "cambios sin enviar que se perderán"}. No se pueden recuperar porque están cifrados con la clave anterior.`
        : "No hay cambios sin enviar, así que no se pierde nada: los datos se vuelven a descargar del servidor."}</p>
      {error && <p className="form-error" role="alert">{error}</p>}
      <button className="button primary wide" disabled={loading} onClick={() => {
        if (stalePending > 0 && !window.confirm(`Se perderán ${stalePending} cambios sin enviar. ¿Continuar?`)) return;
        void run(() => props.rebuildDevice());
      }}><RefreshCw />{loading ? "Descargando…" : "Rehacer la copia de este equipo"}</button>
    </section></LoginShell>;
  }

  return <LoginScreen
    online={props.online}
    intro={props.online
      ? "Ingresa con la cuenta compartida autorizada del laboratorio."
      : props.meta
        ? "Sin internet, con la misma contraseña de siempre. Puedes trabajar todo el tiempo que haga falta; lo registrado se envía solo cuando vuelva el internet."
        : "Sin internet y este equipo todavía no tiene datos guardados. Conéctalo una vez para prepararlo."}
    notice={props.message || undefined}
    error={error}
    loading={loading}
    loadingLabel="Ingresando…"
    onSubmit={(username, password) => void run(() => props.signIn(username, password))}
    footer={props.meta
      ? <button type="button" className="text-button danger-text" onClick={() => void props.deleteVault()}>
          <Trash2 />Eliminar los datos guardados en este equipo
        </button>
      : undefined}
  />;
}

function ConflictPanel(props: { conflicts: SyncConflict[]; data: LabData; acceptRemote(conflict: SyncConflict): Promise<void>; retryLocal(conflict: SyncConflict): Promise<void> }) {
  const conflictLabel = props.conflicts.length === 1 ? "cambio requiere" : "cambios requieren";
  return <details className="offline-conflict-panel" open><summary>{props.conflicts.length} {conflictLabel} revisión</summary>{props.conflicts.map((conflict) => {
    const details = resultConflictDetails(conflict, props.data);
    return <article key={conflict.id}>
      <div><strong>{conflict.kind === "results.save" ? "Resultados modificados" : "Datos del paciente modificados"}</strong><small>Evita sobrescribir información sin revisarla</small></div>
      <p>Esta información también fue modificada mientras el equipo estaba sin internet. Compara los datos y elige cuáles conservar.</p>
      {details.length > 0
        ? <dl>{details.map((detail) => <div key={detail.analysis}><dt><strong>{detail.analysis}</strong></dt><dd>En este equipo: <b>{detail.localValue || "Sin resultado"}</b> · Guardado anteriormente: <b>{detail.remoteValue || "Sin resultado"}</b></dd></div>)}</dl>
        : <p>No fue posible mostrar la comparación completa. Si tienes dudas, conserva la información guardada anteriormente.</p>}
      <div><button className="button secondary" onClick={() => void props.acceptRemote(conflict)}>Conservar lo guardado</button><button className="button primary" onClick={() => {
        if (window.confirm("¿Enviar los resultados de este equipo y reemplazar los guardados anteriormente?")) void props.retryLocal(conflict);
      }}>Enviar mis cambios</button></div>
    </article>;
  })}</details>;
}
