"use client";

import {
  Activity, ArrowLeft, BarChart3, BookOpenCheck, CalendarDays, Check, ChevronRight, CircleAlert, Droplet,
  ClipboardList, Database, FileClock, FileDown, FlaskConical,
  Import, KeyRound, LogOut, Menu, Microscope, PanelLeftClose, PanelLeftOpen, Pencil, Plus, Printer, Search,
  Settings, ShieldCheck, TestTube2, UserRound, Users, X,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { buildPickerGroups } from "@/lib/catalog-presets";
import { expandMillonesText, flagNumericResult, formatNumericResult, formatPatientAgeAt, groupResultsByBatch, linkedHematologyValues } from "@/lib/clinical";
import { createClient, isSupabaseConfigured } from "@/lib/supabase/client";
import { useOfflineRepository } from "@/lib/offline/repository";
import type { AnalysisDefinition, LabData, LabOrder, ResultValue } from "@/lib/types";

type View = "trabajo" | "pacientes" | "analitica" | "catalogo" | "configuracion";
const nav: { id: View; label: string; icon: typeof Activity }[] = [
  { id: "analitica", label: "Analítica", icon: BarChart3 },
  { id: "trabajo", label: "Trabajo diario", icon: ClipboardList },
  { id: "pacientes", label: "Pacientes", icon: Users },
  { id: "catalogo", label: "Catálogo", icon: TestTube2 },
  { id: "configuracion", label: "Configuración", icon: Settings },
];

const fmtDate = (date: string) => new Intl.DateTimeFormat("es-PE", { dateStyle: "medium", timeStyle: "short" }).format(new Date(date));
const fmtBirthDate = (date: string) => date
  ? new Intl.DateTimeFormat("es-PE", { dateStyle: "medium" }).format(new Date(date))
  : "No registrada";
const sexLabel = { F: "Femenino", M: "Masculino", X: "Otro", U: "No registrado" } as const;
const normalizePatientLookup = (value: string) => value.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLocaleLowerCase("es");
function printPdfInBrowser(blob: Blob) {
  return new Promise<void>((resolve, reject) => {
    const reportUrl = URL.createObjectURL(blob);
    const frame = document.createElement("iframe");
    frame.className = "browser-print-frame";
    frame.title = "Informe listo para imprimir";
    frame.setAttribute("aria-hidden", "true");
    let finished = false;
    let fallback = 0;
    const finish = () => {
      if (finished) return;
      finished = true;
      window.clearTimeout(fallback);
      frame.remove();
      URL.revokeObjectURL(reportUrl);
      resolve();
    };
    const fail = () => {
      if (finished) return;
      finished = true;
      window.clearTimeout(fallback);
      frame.remove();
      URL.revokeObjectURL(reportUrl);
      reject(new Error("print_failed"));
    };
    frame.onload = () => {
      const printWindow = frame.contentWindow;
      if (!printWindow) return fail();
      printWindow.addEventListener("afterprint", finish, { once: true });
      window.setTimeout(() => {
        try {
          printWindow.focus();
          printWindow.print();
          fallback = window.setTimeout(finish, 5_000);
        } catch {
          fail();
        }
      }, 250);
    };
    frame.onerror = fail;
    frame.src = reportUrl;
    document.body.appendChild(frame);
  });
}

export function LabApp({ data, currentUser }: { data: LabData; currentUser?: { fullName: string; role: string } }) {
  const router = useRouter();
  const sourcePatients = data.patients;
  const sourceAnalyses = data.analyses;
  const [view, setView] = useState<View>("analitica");
  const sourceOrders = data.orders;
  const [orderOverrides, setOrderOverrides] = useState<Record<string, LabOrder>>({});
  const orders = sourceOrders.map((order) => orderOverrides[order.id] ?? order);
  const [selectedId, setSelectedId] = useState(data.orders[0]?.id ?? "");
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(true);
  const [notice, setNotice] = useState("");
  const [newRecordOpen, setNewRecordOpen] = useState(false);
  const [newRecordAt, setNewRecordAt] = useState("");
  const [online, setOnline] = useState(true);

  useEffect(() => {
    let mounted = true;
    const updateConnection = async () => {
      if (!navigator.onLine) return mounted && setOnline(false);
      try {
        await fetch(`/login?connection-check=${Date.now()}`, { method: "HEAD", cache: "no-store" });
        if (mounted) setOnline(true);
      } catch {
        if (mounted) setOnline(false);
      }
    };
    void updateConnection();
    const interval = window.setInterval(() => void updateConnection(), 30_000);
    window.addEventListener("online", updateConnection);
    window.addEventListener("offline", updateConnection);
    return () => {
      mounted = false;
      window.clearInterval(interval);
      window.removeEventListener("online", updateConnection);
      window.removeEventListener("offline", updateConnection);
    };
  }, []);

  function openOrder(id: string) {
    setNewRecordOpen(false);
    setSelectedId(id);
    setView("trabajo");
  }

  function updateOrder(next: LabOrder) {
    setOrderOverrides((current) => ({ ...current, [next.id]: next }));
  }

  function openNewRecord() {
    const now = new Date();
    setNewRecordAt(new Date(now.getTime() - now.getTimezoneOffset() * 60_000).toISOString().slice(0, 16));
    setView("trabajo");
    setNewRecordOpen(true);
  }

  async function signOut() {
    if (isSupabaseConfigured) await createClient().auth.signOut();
    router.replace("/login");
    router.refresh();
  }

  return (
    <div className={`app-shell ${sidebarCollapsed ? "sidebar-collapsed" : ""}`}>
      <aside className={`sidebar ${sidebarOpen ? "open" : ""} ${sidebarCollapsed ? "collapsed" : ""}`}>
        <div className="sidebar-head">
          <div className="brand-mark"><Activity /><span>LIMS José</span></div>
          <button className="icon-button sidebar-collapse-button" onClick={() => setSidebarCollapsed((value) => !value)} aria-label={sidebarCollapsed ? "Expandir barra lateral" : "Comprimir barra lateral"} title={sidebarCollapsed ? "Expandir menú" : "Comprimir menú"}>{sidebarCollapsed ? <PanelLeftOpen /> : <PanelLeftClose />}</button>
          <button className="icon-button mobile-only" onClick={() => setSidebarOpen(false)} aria-label="Cerrar menú"><PanelLeftClose /></button>
        </div>
        <nav aria-label="Navegación principal">
          {nav.map(({ id, label, icon: Icon }) => (
            <button key={id} className={view === id ? "nav-item active" : "nav-item"} title={sidebarCollapsed ? label : undefined} onClick={() => { setView(id); setSidebarOpen(false); }}>
              <Icon aria-hidden="true" /><span>{label}</span>{id === "trabajo" && <b>2</b>}
            </button>
          ))}
        </nav>
        <div className="sidebar-foot">
          <div className={online ? "lab-status online" : "lab-status offline"} title={online ? "Con conexión" : "Sin conexión"}><span className="status-dot" /><span>{online ? "Con conexión" : "Sin conexión"}</span></div>
          <div className="account"><span className="avatar">{(currentUser?.fullName ?? "Usuario").split(" ").slice(0, 2).map((part) => part[0]).join("").toUpperCase()}</span><span><strong>{currentUser?.fullName ?? "Usuario"}</strong><small>Administrador</small></span><button className="icon-button" aria-label="Cerrar sesión" onClick={signOut}><LogOut /></button></div>
        </div>
      </aside>
      <div className="app-body">
        <button className="shell-menu-button icon-button mobile-only" onClick={() => setSidebarOpen(true)} aria-label="Abrir menú"><Menu /></button>
        {notice && <div className="toast" role="status"><Check />{notice}<button className="icon-button" onClick={() => setNotice("")}><X /></button></div>}
        <main className="workspace">
          {view === "trabajo" && (newRecordOpen ? <NewAnalysisWorkspace
            patients={sourcePatients}
            analyses={sourceAnalyses}
            analysts={data.analysts ?? []}
            initialOccurredAt={newRecordAt}
            cancel={() => setNewRecordOpen(false)}
            notify={setNotice}
            onCreated={(id) => {
              setOrderOverrides((current) => {
                const next = { ...current };
                delete next[id];
                return next;
              });
              setSelectedId(id);
              setNewRecordOpen(false);
            }}
          /> : <WorkQueue orders={orders} selectedId={selectedId} setSelectedId={setSelectedId} updateOrder={updateOrder} notify={setNotice} openNewRecord={openNewRecord} />)}
          {view === "pacientes" && <PatientsView patients={sourcePatients} orders={orders} openOrder={openOrder} notify={setNotice} />}
          {view === "analitica" && <AnalyticsView orders={orders} openOrder={openOrder} />}
          {view === "catalogo" && <CatalogView analyses={sourceAnalyses} />}
          {view === "configuracion" && <SettingsView analysts={data.analysts ?? []} />}
        </main>
      </div>
    </div>
  );
}

function PageHead({ eyebrow, title, text, action }: { eyebrow: string; title: string; text: string; action?: React.ReactNode }) {
  return <div className="page-head"><div><p className="eyebrow">{eyebrow}</p><h1>{title}</h1><p>{text}</p></div>{action}</div>;
}

function rpcMessage(message: string) {
  if (message.includes("register_daily_analyses")) return "La base de datos no está actualizada. Aplica la migración de órdenes diarias y vuelve a intentarlo.";
  if (message.includes("invalid_dni")) return "El DNI debe tener exactamente 8 dígitos.";
  if (message.includes("patient_name_required")) return "Ingresa el nombre completo del paciente.";
  if (message.includes("analyses_required")) return "Selecciona al menos un análisis.";
  if (message.includes("analyst_required")) return "Selecciona quién realizó el análisis.";
  if (message.includes("analyst_inactive_or_missing")) return "El analista seleccionado ya no está activo. Elige otro.";
  if (message.includes("numeric_precision_exceeded")) return "El resultado tiene más decimales de los permitidos para ese análisis.";
  if (message.includes("concurrent_change")) return "Otro usuario modificó este registro. Recarga para continuar.";
  if (message.includes("all_results_required")) return "Completa todos los resultados antes de imprimir.";
  if (message.includes("all_group_results_required")) return "Completa todos los resultados de este grupo antes de imprimir.";
  if (message.includes("all_batch_results_required")) return "Completa todos los resultados de esta tanda antes de imprimir.";
  if (message.includes("reason_required")) return "Escribe un motivo de al menos 5 caracteres.";
  if (message.includes("reference_range_required")) return "Define al menos un intervalo de referencia antes de activar el análisis.";
  if (message.includes("qualitative_options_required")) return "Agrega las opciones válidas del resultado cualitativo.";
  if (message.includes("sample_type_required")) return "Indica el tipo de muestra.";
  if (message.includes("invalid_birth_date")) return "La fecha y hora de nacimiento no es válida.";
  if (message.includes("invalid_patient_sex")) return "Selecciona el sexo del paciente.";
  if (message.includes("update_patient_details")) return "La base de datos no está actualizada. Aplica la migración de edición de pacientes.";
  if (message.includes("owner_required")) return "Solo una cuenta administradora puede aprobar el catálogo.";
  return "No se pudo completar la operación. Intenta nuevamente.";
}

function AnalysisGlyph({ label }: { label: string }) {
  const normalized = label.toLocaleLowerCase("es");
  const isBlood = normalized.includes("hemat") || normalized.includes("hemog");
  const Icon = normalized.includes("orina") || normalized.includes("uro")
    ? FlaskConical
    : isBlood
      ? Droplet
      : normalized.includes("bio") || normalized.includes("gluc")
        ? TestTube2
        : Microscope;
  return <span className={isBlood ? "analysis-glyph blood" : "analysis-glyph"}><Icon aria-hidden="true" /></span>;
}

function ResultChoiceField({ id, value, options, disabled, className, label, onChange }: {
  id: string;
  value: string;
  options: string[];
  disabled?: boolean;
  className?: string;
  label: string;
  onChange: (value: string) => void;
}) {
  if (options.length < 8) {
    return <select id={id} className={className} value={value} disabled={disabled} onChange={(event) => onChange(event.target.value)} aria-label={label}>
      <option value="">Seleccionar...</option>
      {options.map((option) => <option key={option}>{option}</option>)}
    </select>;
  }

  const listId = `result-options-${id.replace(/[^a-zA-Z0-9_-]/g, "-")}`;
  return <span className="searchable-result">
    <input id={id} className={className} list={listId} value={value} disabled={disabled} onChange={(event) => onChange(event.target.value)} placeholder="Escribe para buscar..." aria-label={label} autoComplete="off" />
    <datalist id={listId}>{options.map((option) => <option value={option} key={option} />)}</datalist>
    {!disabled && <small>Escribe o selecciona una opción</small>}
  </span>;
}

function hasInvalidChoice(analysis: { qualitativeOptions?: string[] }, value: string) {
  return Boolean(analysis.qualitativeOptions?.length)
    && !analysis.qualitativeOptions!.includes(value.trim());
}

function sanitizeResultInput(type: "numeric" | "qualitative" | "text", rawValue: string) {
  if (type === "numeric") {
    const normalized = rawValue.replace(",", ".").replace(/[^0-9.-]/g, "");
    const negative = normalized.startsWith("-");
    const unsigned = normalized.replace(/-/g, "");
    const [whole, ...decimals] = unsigned.split(".");
    return `${negative ? "-" : ""}${whole}${decimals.length ? `.${decimals.join("")}` : ""}`;
  }
  if (type === "text") return rawValue;
  return rawValue;
}

function NewAnalysisWorkspace({ patients, analyses, analysts, initialOccurredAt, cancel, notify, onCreated }: { patients: LabData["patients"]; analyses: LabData["analyses"]; analysts: LabData["analysts"]; initialOccurredAt: string; cancel: () => void; notify: (message: string) => void; onCreated: (id: string) => void }) {
  const router = useRouter();
  const offlineRepository = useOfflineRepository();
  const [patientReady, setPatientReady] = useState(false);
  const [patientId, setPatientId] = useState<number | null>(null);
  const [patientQuery, setPatientQuery] = useState("");
  const [dni, setDni] = useState("");
  const [name, setName] = useState("");
  const [birthDate, setBirthDate] = useState("");
  const [sex, setSex] = useState<"F" | "M" | "X" | "">("");
  const [occurredAt, setOccurredAt] = useState(initialOccurredAt);
  const activeAnalysts = analysts.filter((analyst) => analyst.active);
  const [analystId, setAnalystId] = useState(activeAnalysts.length === 1 ? activeAnalysts[0].id : "");
  const [resultValues, setResultValues] = useState<Record<string, string>>({});
  const [focusedVersionId, setFocusedVersionId] = useState<string | null>(null);
  const groups = useMemo(() => buildPickerGroups(analyses), [analyses]);
  const [selectedGroup, setSelectedGroup] = useState("");
  const [saving, setSaving] = useState(false);
  const [patientSaving, setPatientSaving] = useState(false);
  const [patientError, setPatientError] = useState("");
  const [error, setError] = useState("");
  const [directoryMatches, setDirectoryMatches] = useState<LabData["patients"]>([]);
  const [directoryPatient, setDirectoryPatient] = useState<LabData["patients"][number] | null>(null);
  const existing = patients.find((patient) => patient.documentNumber === dni)
    ?? (directoryPatient?.documentNumber === dni ? directoryPatient : undefined);
  const activeGroupName = selectedGroup || groups[0]?.group || "";
  const currentGroup = groups.find((group) => group.group === activeGroupName) ?? null;
  const currentAnalyses = currentGroup?.items ?? [];
  const patientMatches = useMemo(() => {
    if (patientQuery.trim().length < 2) return [];
    const normalized = normalizePatientLookup(patientQuery.trim());
    const current = patients.filter((patient) => normalizePatientLookup(`${patient.documentNumber} ${patient.fullName}`).includes(normalized));
    const localDirectory = patientQuery.trim().length >= 4
      ? directoryMatches.filter((patient) => normalizePatientLookup(`${patient.documentNumber} ${patient.fullName}`).includes(normalized.split(/\s+/).at(-1) ?? normalized))
      : [];
    return [...new Map([...current, ...localDirectory].map((patient) => [patient.documentNumber, patient])).values()].slice(0, 8);
  }, [directoryMatches, patientQuery, patients]);
  const allAnalyses = useMemo(() => groups.flatMap((group) => group.items), [groups]);
  const completedAnalyses = allAnalyses.filter((analysis) => resultValues[analysis.versionId]?.trim());

  useEffect(() => {
    if (!offlineRepository?.enabled || patientQuery.trim().length < 4) return;
    let cancelled = false;
    const timer = window.setTimeout(() => {
      void offlineRepository.searchPatients(patientQuery, 8).then((matches) => {
        if (cancelled) return;
        setDirectoryMatches(matches);
        const exactDni = patientQuery.trim();
        const exact = /^\d{8}$/.test(exactDni) ? matches.find((patient) => patient.documentNumber === exactDni) : null;
        if (exact) {
          setDirectoryPatient(exact);
          setName(exact.fullName);
          setBirthDate(exact.birthDate);
          setSex(exact.sex === "U" ? "" : exact.sex);
        }
      }).catch(() => {
        if (!cancelled) setDirectoryMatches([]);
      });
    }, 180);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [offlineRepository, patientQuery]);

  function changeAnalysisResult(analysis: AnalysisDefinition, rawValue: string) {
    const sanitized = sanitizeResultInput(analysis.resultType, rawValue);
    setResultValues((current) => {
      const next = { ...current, [analysis.versionId]: sanitized };
      const linked = analysis.resultType === "numeric"
        ? linkedHematologyValues(analysis.code, sanitized)
        : null;
      if (linked) {
        allAnalyses.forEach((candidate) => {
          const calculated = linked[candidate.code as keyof typeof linked];
          if (calculated !== undefined) next[candidate.versionId] = calculated;
        });
      }
      return next;
    });
  }

  function changeDni(rawValue: string) {
    const normalized = rawValue.replace(/\D/g, "").slice(0, 8);
    const matched = patients.find((patient) => patient.documentNumber === normalized);
    setDni(normalized);
    setPatientQuery(normalized);
    setPatientError("");
    if (matched) {
      setDirectoryPatient(null);
      setName(matched.fullName);
      setBirthDate(matched.birthDate);
      setSex(matched.sex === "U" ? "" : matched.sex);
    } else if (existing && existing.documentNumber !== normalized) {
      setDirectoryPatient(null);
      setName("");
      setBirthDate("");
      setSex("");
    }
  }

  function choosePatient(patient: LabData["patients"][number]) {
    setDirectoryPatient(patient);
    setPatientQuery(`${patient.fullName} · ${patient.documentNumber}`);
    setDni(patient.documentNumber);
    setName(patient.fullName);
    setBirthDate(patient.birthDate);
    setSex(patient.sex === "U" ? "" : patient.sex);
    setPatientError("");
  }

  async function preparePatient(event: React.FormEvent) {
    event.preventDefault();
    setPatientError("");
    if (!/^\d{8}$/.test(dni)) return setPatientError("El DNI debe tener exactamente 8 dígitos.");
    if (!existing && name.trim().length < 2) return setPatientError("Ingresa el nombre completo del paciente.");
    if (!sex) return setPatientError("Selecciona el sexo del paciente.");
    if (!birthDate) return setPatientError("Ingresa la fecha de nacimiento.");
    const birthTime = new Date(`${birthDate}T00:00:00`).getTime();
    const analysisTime = new Date(occurredAt).getTime();
    if (!Number.isFinite(birthTime) || !Number.isFinite(analysisTime)) return setPatientError("Revisa las fechas ingresadas.");
    if (birthTime > analysisTime) return setPatientError("El nacimiento no puede ser posterior al análisis.");

    setPatientSaving(true);
    try {
      if (offlineRepository) {
        const saved = await offlineRepository.savePatient({
          documentNumber: dni,
          fullName: (existing?.fullName ?? name).trim(),
          birthDate,
          sex: sex as "F" | "M" | "X",
        });
        setPatientId(saved.id);
      } else {
        const patientResult = await createClient().rpc("upsert_patient_with_demographics", {
          patient_dni: dni,
          patient_name: (existing?.fullName ?? name).trim(),
          patient_birth_date: birthDate,
          patient_sex: sex,
        });
        if (patientResult.error) throw patientResult.error;
        const savedPatientId = (patientResult.data as { id: number } | null)?.id;
        if (savedPatientId === undefined) throw new Error("patient_id_missing");
        setPatientId(savedPatientId);
      }
      setPatientReady(true);
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : "No se pudo guardar el paciente.";
      setPatientError(rpcMessage(message));
    } finally {
      setPatientSaving(false);
    }
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError("");
    if (patientId === null) return setError("Selecciona primero al paciente.");
    const analyst = activeAnalysts.find((item) => item.id === analystId);
    if (!analyst) return setError("Selecciona quién realizó el análisis.");
    if (completedAnalyses.length === 0) return setError("Ingresa al menos un resultado. Los campos vacíos no se guardarán.");
    if (completedAnalyses.some((analysis) => hasInvalidChoice(analysis, resultValues[analysis.versionId] ?? ""))) return setError("Selecciona un resultado válido de la lista.");
    if (completedAnalyses.some((analysis) => analysis.resultType === "numeric" && !Number.isFinite(Number(resultValues[analysis.versionId])))) return setError("Revisa los resultados numéricos antes de guardar.");
    setSaving(true);
    try {
      let newOrderId = "";
      if (offlineRepository) {
        const patient = patients.find((item) => item.id === patientId) ?? {
          id: patientId,
          documentNumber: dni,
          fullName: (existing?.fullName ?? name).trim(),
          birthDate,
          sex: sex as "F" | "M" | "X",
        };
        newOrderId = await offlineRepository.registerAnalyses({
          patient,
          occurredAt: new Date(occurredAt).toISOString(),
          analyst,
          entries: completedAnalyses.map((analysis) => ({ analysis, value: resultValues[analysis.versionId] })),
        });
      } else {
        const orderResult = await createClient().rpc("register_daily_analyses", {
          target_patient: patientId,
          occurred_at: new Date(occurredAt).toISOString(),
          result_entries: completedAnalyses.map((analysis) => ({
            analysis_version_id: analysis.versionId,
            analyst_id: analyst.id,
            payload: analysis.resultType === "numeric"
              ? { numeric_value: Number(resultValues[analysis.versionId]) }
              : analysis.resultType === "qualitative"
                ? { qualitative_value: resultValues[analysis.versionId].trim() }
                : { text_value: resultValues[analysis.versionId].trim() },
          })),
        });
        if (orderResult.error) throw orderResult.error;
        newOrderId = String((orderResult.data as { order_id?: string } | null)?.order_id ?? "");
      }
      if (!newOrderId) throw new Error("order_id_missing");
      onCreated(newOrderId);
      notify(offlineRepository?.enabled ? "Análisis guardados en este equipo y pendientes de sincronización." : "Análisis y resultados guardados en la orden diaria.");
      if (!offlineRepository) router.refresh();
    } catch (reason) {
      setError(rpcMessage(reason instanceof Error ? reason.message : "No se pudo guardar la orden."));
    } finally {
      setSaving(false);
    }
  }

  if (!patientReady) {
    return <div className="dialog-backdrop patient-gate" role="presentation">
      <section className="dialog-card patient-dialog" role="dialog" aria-modal="true" aria-labelledby="patient-dialog-title">
        <div className="dialog-head"><div><p className="eyebrow">Nuevo análisis</p><h2 id="patient-dialog-title">Busca o registra al paciente</h2><p>Completa sus datos antes de ingresar los análisis.</p></div><button className="icon-button" onClick={cancel} aria-label="Cerrar"><X /></button></div>
        <form onSubmit={preparePatient}>
          <label className="patient-search-field">Buscar paciente<div className="compact-search"><Search /><input autoFocus value={patientQuery} onChange={(event) => { const value = event.target.value; setPatientQuery(value); if (/^\d{0,8}$/.test(value)) changeDni(value); }} placeholder="DNI o nombre completo" /></div></label>
          {patientMatches.length > 0 && <div className="patient-search-results">{patientMatches.map((patient) => <button type="button" key={patient.id} onClick={() => choosePatient(patient)}><span className="avatar patient">{patient.fullName.split(" ").slice(0, 2).map((part) => part[0]).join("")}</span><span><strong>{patient.fullName}</strong><small>DNI {patient.documentNumber}</small></span><ChevronRight /></button>)}</div>}
          <div className="dialog-fields patient-data-grid">
            <label>DNI<input inputMode="numeric" maxLength={8} value={dni} onChange={(event) => changeDni(event.target.value)} placeholder="00000000" /></label>
            <label>Nombre completo<input value={existing?.fullName ?? name} disabled={Boolean(existing)} onChange={(event) => setName(event.target.value.replace(/[0-9]/g, ""))} placeholder="Nombres y apellidos" /></label>
            <label>Sexo<select value={sex} onChange={(event) => setSex(event.target.value as typeof sex)}><option value="">Seleccionar</option><option value="F">Femenino</option><option value="M">Masculino</option><option value="X">Otro</option></select></label>
            <label>Fecha de nacimiento<input type="date" max={occurredAt.slice(0, 10)} value={birthDate} onChange={(event) => setBirthDate(event.target.value)} /></label>
            <label>Fecha del análisis<div className="input-with-icon"><CalendarDays /><input type="datetime-local" value={occurredAt} onChange={(event) => setOccurredAt(event.target.value)} /></div></label>
            <label className="analyst-field"><span><UserRound />Realizado por</span><select value={analystId} onChange={(event) => setAnalystId(event.target.value)} required><option value="">Seleccionar analista…</option>{activeAnalysts.map((analyst) => <option value={analyst.id} key={analyst.id}>{analyst.fullName}</option>)}</select>{activeAnalysts.length === 0 && <small>No hay analistas activos. Agrégalos en Configuración.</small>}</label>
          </div>
          {existing && <div className="patient-found"><Check /><span><small>Paciente encontrado</small><strong>{existing.fullName}</strong></span></div>}
          {patientError && <p className="form-error" role="alert">{patientError}</p>}
          <div className="dialog-actions"><span>Los campos son obligatorios</span><div><button type="button" className="button secondary" onClick={cancel}>Cancelar</button><button className="button primary" disabled={patientSaving}>{patientSaving ? "Guardando…" : "Continuar"}<ChevronRight /></button></div></div>
        </form>
      </section>
    </div>;
  }

  return <section className="new-analysis-flow" aria-labelledby="new-analysis-title">
    <header className="registration-head compact-registration-head">
      <button className="back-action" type="button" onClick={cancel}><ArrowLeft />Atrás</button>
      <div className="patient-quick-facts" id="new-analysis-title"><strong>{existing?.fullName ?? name}</strong><span>DNI {dni} · {activeAnalysts.find((item) => item.id === analystId)?.fullName ?? "Sin analista"}</span></div>
      <div className="entry-progress"><strong>{completedAnalyses.length}</strong><span>resultados listos<small>Los campos vacíos se omiten</small></span></div>
      <button className="text-button" type="button" onClick={() => { setPatientReady(false); setSelectedGroup(""); setResultValues({}); }}>Cambiar paciente</button>
    </header>
    <form onSubmit={submit} className="registration-form">
      <div className="direct-entry-board">
        <section className="direct-entry-sheet" role="region" aria-labelledby="active-group-title">
          <nav className="entry-group-tabs" aria-label="Grupos de análisis">
            {groups.map((group) => { const completed = group.items.filter((item) => resultValues[item.versionId]?.trim()).length; return <button type="button" key={group.group} className={group.group === activeGroupName ? "active" : ""} onClick={() => setSelectedGroup(group.group)}>
              {group.group}{completed > 0 && <b>{completed}</b>}
            </button>; })}
          </nav>
          <p className="entry-group-hint" id="active-group-title">Escribe únicamente los resultados realizados. Usa Tab para avanzar.</p>
          <div className="direct-result-grid">
            {currentAnalyses.map((analysis) => { const rawValue = resultValues[analysis.versionId] ?? ""; const numericValue = Number(rawValue); const previewFlag = analysis.resultType === "numeric" && rawValue.trim() && Number.isFinite(numericValue) ? flagNumericResult(numericValue, analysis) : "normal"; return <div key={analysis.versionId} className={`direct-result-row ${rawValue.trim() ? "completed" : ""} ${previewFlag !== "normal" ? "outside-range" : ""}`}>
              <label htmlFor={`direct-result-${analysis.versionId}`}><strong>{analysis.name}</strong><small>{analysis.subsection ?? analysis.code}</small></label>
              <div className="direct-result-control">
                {analysis.qualitativeOptions?.length
                  ? <ResultChoiceField id={`direct-result-${analysis.versionId}`} className="direct-result-input" value={rawValue} options={analysis.qualitativeOptions} onChange={(value) => changeAnalysisResult(analysis, value)} label={`Resultado de ${analysis.name}`} />
                  : <input id={`direct-result-${analysis.versionId}`} className="direct-result-input" value={analysis.resultType === "numeric" && focusedVersionId !== analysis.versionId ? formatNumericResult(rawValue, analysis.unit) : rawValue} inputMode={analysis.resultType === "numeric" ? "decimal" : "text"} onChange={(event) => changeAnalysisResult(analysis, event.target.value)} onFocus={() => setFocusedVersionId(analysis.versionId)} onBlur={() => setFocusedVersionId(null)} placeholder="—" aria-label={`Resultado de ${analysis.name}`} autoComplete="off" />}
                {previewFlag !== "normal" && <small className={`inline-range-warning ${previewFlag}`}><CircleAlert />Fuera de rango</small>}
              </div>
              <div className="direct-result-meta"><span>{expandMillonesText(analysis.unit) || "Sin unidad"}</span><small>{analysis.reference || "Sin referencia"}</small></div>
            </div>; })}
            {currentAnalyses.length === 0 && <div className="empty small"><Microscope /><p>No hay análisis activos en este grupo.</p></div>}
          </div>
        </section>
      </div>

      {error && <p className="form-error registration-error" role="alert">{error}</p>}
      <footer className="registration-actions"><span><ShieldCheck />Solo se guardarán los {completedAnalyses.length} campos con resultado.</span><div><button type="button" className="button secondary" onClick={cancel}>Cancelar</button><button className="button primary" disabled={saving || completedAnalyses.length === 0}>{saving ? "Guardando..." : `Guardar ${completedAnalyses.length || ""} resultados`}</button></div></footer>
    </form>
  </section>;
}

function OrderTable({ orders, onSelect }: { orders: LabOrder[]; onSelect: (id: string) => void }) {
  return <div className="table-wrap"><table><thead><tr><th>Orden</th><th>Paciente</th><th>Grupos</th><th>Ingreso</th><th>Responsable</th><th /></tr></thead>
    <tbody>{orders.length ? orders.map((order) => <tr key={order.id} onClick={() => onSelect(order.id)} tabIndex={0}><td className="mono strong">{order.code}</td><td><strong>{order.patientName}</strong><small className="block mono">DNI {order.documentNumber}</small></td><td>{order.groups.join(" · ") || "Sin análisis"}</td><td>{new Date(order.createdAt).toLocaleTimeString("es-PE", { hour: "2-digit", minute: "2-digit" })}</td><td>{order.responsible}</td><td><ChevronRight /></td></tr>) : <tr><td colSpan={6}><div className="empty small"><ClipboardList /><p>No hay órdenes registradas.</p></div></td></tr>}</tbody>
  </table></div>;
}

function WorkQueue({ orders, selectedId, setSelectedId, updateOrder, notify, openNewRecord }: { orders: LabOrder[]; selectedId: string; setSelectedId: (id: string) => void; updateOrder: (o: LabOrder) => void; notify: (s: string) => void; openNewRecord: () => void }) {
  const selected = orders.find((o) => o.id === selectedId) ?? orders[0] ?? null;
  const [search, setSearch] = useState("");
  const visible = orders.filter((order) => {
    const value = search.trim().toLocaleLowerCase("es");
    if (!value) return true;
    return `${order.code} ${order.patientName} ${order.documentNumber} ${order.groups.join(" ")}`
      .toLocaleLowerCase("es")
      .includes(value);
  });
  return <>
    <PageHead eyebrow="Operación" title="Trabajo diario" text="Registra resultados y continúa rápidamente donde lo dejaste." action={<button className="button primary" onClick={openNewRecord}><Plus />Nuevo análisis</button>} />
    <div className="work-layout">
      <section className="panel order-list">
        <div className="compact-search"><Search /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Filtrar por orden, DNI o paciente" aria-label="Filtrar cola por orden, DNI o paciente" /></div>
        <div className="queue">{visible.map((o) => <button key={o.id} className={o.id === selected?.id ? "queue-item selected" : "queue-item"} onClick={() => setSelectedId(o.id)}><span><strong className="mono">{o.code}</strong><b>{o.patientName}</b><small>{o.groups.join(" · ")}</small></span><span><em>{new Date(o.createdAt).toLocaleTimeString("es-PE", { hour: "2-digit", minute: "2-digit" })}</em></span></button>)}{visible.length === 0 && <div className="empty small"><ClipboardList /><p>No hay órdenes en esta cola.</p></div>}</div>
      </section>
      {selected ? <ResultWorkspace key={`${selected.id}:${selected.results.map((result) => result.orderAnalysisId).join(",")}`} order={selected} updateOrder={updateOrder} notify={notify} /> : <section className="panel"><div className="empty"><Microscope /><h3>Sin registros</h3><p>Crea el primero después de cargar el catálogo.</p></div></section>}
    </div>
  </>;
}

function ResultWorkspace({ order, updateOrder, notify }: { order: LabOrder; updateOrder: (o: LabOrder) => void; notify: (s: string) => void }) {
  const offlineRepository = useOfflineRepository();
  const [draft, setDraft] = useState(order.results);
  const [saving, setSaving] = useState(false);
  const [printing, setPrinting] = useState(false);
  const [editingResultId, setEditingResultId] = useState<string | null>(null);
  const resultBatches = useMemo(() => groupResultsByBatch(draft, order.createdAt), [draft, order.createdAt]);
  const [selectedBatchId, setSelectedBatchId] = useState(resultBatches[0]?.batchId ?? "");
  const activeBatch = resultBatches.find((item) => item.batchId === selectedBatchId) ?? resultBatches[0];
  const critical = activeBatch?.results.some((result) => result.flag === "critical") ?? false;

  function changeResult(id: string, value: string) {
    setDraft((results) => {
      const source = results.find((result) => result.id === id);
      if (!source) return results;
      const sanitized = sanitizeResultInput(source.resultType, value);
      const linked = source.resultType === "numeric" && source.analysisCode
        ? linkedHematologyValues(source.analysisCode, sanitized)
        : null;
      return results.map((result) => {
        let nextValue = result.id === id ? sanitized : result.value;
        if (linked && result.batchId === source.batchId && result.analysisCode) {
          nextValue = linked[result.analysisCode as keyof typeof linked] ?? nextValue;
        }
        if (nextValue === result.value) return result;
        if (result.resultType !== "numeric") return { ...result, value: nextValue };
        const numericValue = Number(nextValue);
        const flag = nextValue.trim() && Number.isFinite(numericValue) ? flagNumericResult(numericValue, result) : "normal";
        return { ...result, value: nextValue, numericValue, flag };
      });
    });
  }

  async function save() {
    if (!order.revisionId) {
      notify("No se encontró la revisión activa. Recarga la página.");
      return null;
    }
    setSaving(true);
    const supabase = createClient();
    const savedResults = [...draft];
    const originalByAnalysis = new Map(order.results.map((result) => [result.orderAnalysisId, result.value]));
    const entries = savedResults
      .filter((result) => result.value !== (originalByAnalysis.get(result.orderAnalysisId) ?? ""))
      .map((result) => ({
        order_analysis_id: result.orderAnalysisId,
        ...(result.value.trim()
          ? {
              payload: result.resultType === "numeric"
                ? { numeric_value: Number(result.value) }
                : result.resultType === "qualitative"
                  ? { qualitative_value: result.value.trim() }
                  : { text_value: result.value.trim() },
            }
          : { clear: true }),
      }));

    if (savedResults.some((result) => result.value.trim() && hasInvalidChoice(result, result.value))) {
      setSaving(false);
      notify("Selecciona un resultado válido de la lista.");
      return null;
    }

    if (entries.some((entry) => "payload" in entry && "numeric_value" in entry.payload && !Number.isFinite(entry.payload.numeric_value))) {
      setSaving(false);
      notify("Revisa los resultados numéricos antes de guardar.");
      return null;
    }

    if (offlineRepository) {
      try {
        const saved = await offlineRepository.saveResults(order, savedResults);
        setDraft(saved.results);
        updateOrder({ ...order, results: saved.results, lockVersion: saved.lockVersion, syncState: offlineRepository.enabled ? "pending" : order.syncState });
        setEditingResultId(null);
        setSaving(false);
        notify(offlineRepository.enabled ? "Resultados protegidos en este equipo; sincronización pendiente." : "Resultados guardados.");
        return saved.lockVersion;
      } catch (reason) {
        setSaving(false);
        notify(rpcMessage(reason instanceof Error ? reason.message : "save_failed"));
        return null;
      }
    }

    const response = await supabase.rpc("save_result_batch", {
      target_revision: order.revisionId,
      result_entries: entries,
      expected_lock_version: order.lockVersion,
    });
    if (response.error) {
      setSaving(false);
      notify(rpcMessage(response.error.message));
      return null;
    }
    const saved = response.data as {
      lock_version: number;
      results: { order_analysis_id: string; id: string | null; flag: ResultValue["flag"] | null }[];
    };
    const savedByAnalysis = new Map(saved.results.map((result) => [result.order_analysis_id, result]));
    savedResults.forEach((result, index) => {
      const persisted = savedByAnalysis.get(result.orderAnalysisId);
      if (persisted?.id) savedResults[index] = { ...result, id: persisted.id, flag: persisted.flag ?? "normal" };
    });
    const lockVersion = saved.lock_version;

    setDraft(savedResults);
    updateOrder({ ...order, results: savedResults, lockVersion });
    setEditingResultId(null);
    setSaving(false);
    notify("Resultados guardados.");
    return lockVersion;
  }

  async function printReport() {
    if (!activeBatch || printing || saving) return;
    setPrinting(true);
    try {
      const lockVersion = await save();
      if (lockVersion === null) return;
      if (offlineRepository?.enabled) {
        const blob = await offlineRepository.buildOfflineReport(
          { ...order, results: draft, lockVersion },
          activeBatch.batchId,
        );
        if (!blob) throw new Error("offline_report_unavailable");
        await printPdfInBrowser(blob);
        return;
      }
      const legacyBatch = activeBatch.batchId.startsWith("legacy:");
      const reportResponse = await fetch(`/api/reports/${order.id}`, {
        method: "POST",
        cache: "no-store",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(legacyBatch
          ? { group: activeBatch.group }
          : { batchId: activeBatch.batchId }),
      });
      if (!reportResponse.ok) {
        const error = await reportResponse.json().catch(() => null) as { error?: string } | null;
        notify(error?.error ? rpcMessage(error.error) : "No se pudo generar el informe. El registro sigue editable.");
        return;
      }
      await printPdfInBrowser(await reportResponse.blob());
    } catch {
      setSaving(false);
      notify("No se pudo abrir el selector de impresión del navegador.");
    } finally {
      setPrinting(false);
    }
  }

  return <section className="panel result-workspace">
    <div className="patient-strip patient-summary">
      <div className="patient-summary-main">
        <div className="patient-identity"><span className="avatar patient large">{order.patientName.split(" ").slice(0, 2).map((part) => part[0]).join("")}</span><span><small>Paciente seleccionado</small><strong>{order.patientName}</strong><em className="mono">DNI {order.documentNumber}</em></span></div>
        <div className="patient-order-context"><span>Registro</span><strong className="mono">{order.code}</strong><small><CalendarDays />{fmtDate(order.createdAt)}</small></div>
      </div>
      <dl className="patient-clinical-data">
        <div className="age-data"><dt>Edad al registrar</dt><dd>{order.patientBirthDate ? formatPatientAgeAt(order.patientBirthDate, order.createdAt) : "No registrada"}</dd></div>
        <div><dt>Fecha de nacimiento</dt><dd>{fmtBirthDate(order.patientBirthDate)}</dd></div>
        <div><dt>Sexo</dt><dd>{sexLabel[order.patientSex]}</dd></div>
      </dl>
    </div>
    {order.results.length === 0 ? <div className="empty"><Microscope /><h3>Este registro no tiene análisis</h3><p>Crea un nuevo registro seleccionando al menos un análisis.</p></div> : <>
      <div className="result-toolbar"><div><h2>Resultados por registro</h2><p>{draft.length} análisis · {resultBatches.length} tandas ordenadas por fecha</p></div></div>
      <nav className="result-group-menu" aria-label="Tandas realizadas">{resultBatches.map((item) => <button type="button" key={item.batchId} className={item.batchId === activeBatch?.batchId ? "active" : ""} onClick={() => setSelectedBatchId(item.batchId)}>
        <AnalysisGlyph label={item.group} /><span><strong>{item.group}</strong><small>{fmtDate(item.registeredAt)}</small></span><b>{item.results.length}</b>
      </button>)}</nav>
      {activeBatch && <div className="result-groups"><section className="result-group" aria-labelledby="active-result-group">
        <div className="result-group-head"><div><span>Tanda registrada · {fmtDate(activeBatch.registeredAt)}</span><h3 id="active-result-group">{activeBatch.group}</h3></div><button className="button secondary" onClick={printReport} disabled={saving || printing} aria-busy={printing}>{printing ? <><span className="button-spinner" aria-hidden="true" />Preparando impresión…</> : <><Printer />Imprimir esta tanda</>}</button></div>
        <div className="result-card-list">{activeBatch.results.map((result) => {
          const editing = editingResultId === result.orderAnalysisId;
          return <article key={result.id} className={editing ? "result-card editing" : "result-card"}>
            <header className="result-card-head">
              <div className="result-card-title"><AnalysisGlyph label={result.group} /><span><strong>{result.analyte}</strong><small>{result.method || "Método por definir"}</small></span></div>
              <button type="button" className={editing ? "result-edit-button active" : "result-edit-button"} onClick={() => setEditingResultId(editing ? null : result.orderAnalysisId)} aria-pressed={editing}>{editing ? <Check /> : <Pencil />}{editing ? "Terminar edición" : "Editar resultado"}</button>
            </header>
            <div className="result-card-body">
              <label className="result-value-field"><span>Resultado</span>{result.qualitativeOptions?.length
                ? <ResultChoiceField id={result.id} className={`result-input ${result.flag}`} value={result.value} options={result.qualitativeOptions} disabled={!editing} onChange={(value) => changeResult(result.id, value)} label={`Resultado de ${result.analyte}`} />
                : <input className={`result-input ${result.flag}`} value={!editing && result.resultType === "numeric" ? formatNumericResult(result.value, result.unit) : result.value} inputMode={result.resultType === "numeric" ? "decimal" : undefined} disabled={!editing} onChange={(event) => changeResult(result.id, event.target.value)} aria-label={`Resultado de ${result.analyte}`} />}</label>
              <div className="result-fact"><span>Unidad</span><strong className="mono">{expandMillonesText(result.unit) || "—"}</strong></div>
              <div className="result-fact reference"><span>Rango de referencia</span><strong>{result.reference || "No definido"}</strong></div>
              <div className="result-fact flag-fact"><span>Evaluación</span><ResultFlag flag={result.flag} /></div>
            </div>
            <footer className="result-card-foot"><span><Users />Realizado por <strong>{result.performedBy}</strong></span>{editing && <small>Modifica el valor y pulsa «Terminar edición».</small>}</footer>
          </article>;
        })}</div>
      </section></div>}
      {critical && <div className="critical-notice"><CircleAlert /><span><strong>Hay un valor crítico</strong><small>Revísalo antes de imprimir. Esta advertencia no bloquea el registro.</small></span></div>}
      <div className="action-bar"><span><ShieldCheck />Los resultados pueden editarse cuando sea necesario.</span><div><button className="button primary" onClick={save} disabled={saving}>{saving ? "Guardando…" : "Guardar resultados"}</button></div></div>
    </>}
  </section>;
}

function ResultFlag({ flag }: { flag: ResultValue["flag"] }) {
  const label = { normal: "Normal", low: "Bajo", high: "Alto", critical: "Crítico", unreviewed: "No evaluado" }[flag];
  return <span className={`flag ${flag}`}>{!["normal", "unreviewed"].includes(flag) && <CircleAlert />}{label}</span>;
}

function AddPatientDialog({ close, notify }: { close: () => void; notify: (message: string) => void }) {
  const router = useRouter();
  const offlineRepository = useOfflineRepository();
  const [dni, setDni] = useState("");
  const [name, setName] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError("");
    if (!/^\d{8}$/.test(dni)) return setError("El DNI debe tener exactamente 8 dígitos.");
    if (name.trim().length < 2) return setError("Ingresa el nombre completo del paciente.");
    setSaving(true);
    try {
      if (offlineRepository) await offlineRepository.savePatient({ documentNumber: dni, fullName: name.trim() });
      else {
        const response = await createClient().rpc("upsert_simple_patient", { patient_dni: dni, patient_name: name.trim() });
        if (response.error) throw response.error;
      }
      notify(offlineRepository?.enabled ? "Paciente guardado en este equipo; sincronización pendiente." : "Paciente agregado correctamente.");
      close();
      if (!offlineRepository) router.refresh();
    } catch (reason) {
      setError(rpcMessage(reason instanceof Error ? reason.message : "patient_save_failed"));
    } finally {
      setSaving(false);
    }
  }

  return <div className="dialog-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) close(); }}>
    <section className="dialog-card patient-edit-dialog" role="dialog" aria-modal="true" aria-labelledby="add-patient-title">
      <div className="dialog-head"><div><p className="eyebrow">Registro maestro</p><h2 id="add-patient-title">Agregar paciente</h2><p>Registra su identidad básica. Los datos clínicos se completarán al crear un análisis.</p></div><button className="icon-button" type="button" onClick={close} aria-label="Cerrar"><X /></button></div>
      <form onSubmit={submit}>
        <label>DNI<input autoFocus inputMode="numeric" maxLength={8} value={dni} onChange={(event) => setDni(event.target.value.replace(/\D/g, "").slice(0, 8))} placeholder="00000000" /></label>
        <label>Nombre completo<input value={name} onChange={(event) => setName(event.target.value)} placeholder="Nombres y apellidos" /></label>
        {error && <p className="form-error" role="alert">{error}</p>}
        <div className="dialog-actions"><span>El DNI identifica al paciente y evita duplicados.</span><div><button className="button secondary" type="button" onClick={close}>Cancelar</button><button className="button primary" disabled={saving}>{saving ? "Guardando..." : "Agregar paciente"}</button></div></div>
      </form>
    </section>
  </div>;
}

function PatientImportDialog({ close, notify }: { close: () => void; notify: (message: string) => void }) {
  const offlineRepository = useOfflineRepository();
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<Awaited<ReturnType<NonNullable<typeof offlineRepository>["previewPatientRoster"]>> | null>(null);
  const [sheetName, setSheetName] = useState("");
  const [nameColumn, setNameColumn] = useState(0);
  const [dniColumn, setDniColumn] = useState(0);
  const [birthDateColumn, setBirthDateColumn] = useState(0);
  const [sexColumn, setSexColumn] = useState(0);
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState<{ processed: number; total: number; imported: number; failed: number; phase: "importing" | "activating" } | null>(null);
  const [error, setError] = useState("");
  const [result, setResult] = useState<{ imported: number; failed: number; duplicates: number; total: number; failures: { row: number; reason: string }[] } | null>(null);
  const activeSheet = preview?.sheets.find((sheet) => sheet.name === sheetName) ?? preview?.sheets[0] ?? null;

  function suggestColumns(sheet: NonNullable<typeof preview>["sheets"][number]) {
    const normalize = (value: string) => value.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLocaleLowerCase("es");
    const suggestedName = sheet.headers.findIndex((header) => /nombre|paciente|name/.test(normalize(header))) + 1;
    const suggestedDni = sheet.headers.findIndex((header) => /dni|documento|doc\.?/.test(normalize(header))) + 1;
    const suggestedBirthDate = sheet.headers.findIndex((header) => /nacimiento|fec.*nac|fecnac|birth/.test(normalize(header))) + 1;
    const suggestedSex = sheet.headers.findIndex((header) => /sexo|sex|genero|idsexo/.test(normalize(header))) + 1;
    setNameColumn(suggestedName);
    setDniColumn(suggestedDni);
    setBirthDateColumn(suggestedBirthDate);
    setSexColumn(suggestedSex);
  }

  function chooseSheet(name: string, data = preview) {
    setSheetName(name);
    const sheet = data?.sheets.find((item) => item.name === name);
    if (sheet) suggestColumns(sheet);
  }

  async function selectFile(nextFile: File | null) {
    setFile(nextFile);
    setPreview(null);
    setResult(null);
    setProgress(null);
    setError("");
    if (!nextFile) return;
    if (!offlineRepository?.enabled) return setError("Primero habilita y desbloquea el modo offline en este equipo.");
    if (!/\.(xlsb|xlsx|xlsm|xls)$/i.test(nextFile.name)) return setError("Selecciona un archivo XLSB, XLSX, XLSM o XLS.");
    if (nextFile.size > 200 * 1024 * 1024) return setError("El archivo supera el límite de 200 MB.");
    setLoading(true);
    try {
      const data = await offlineRepository.previewPatientRoster(nextFile);
      if (!data.sheets.some((sheet) => sheet.headers.length > 0)) throw new Error("No se encontraron hojas con encabezados.");
      setPreview(data);
      const firstSheet = data.sheets.find((sheet) => sheet.headers.length > 0);
      if (firstSheet) chooseSheet(firstSheet.name, data);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "No se pudo leer el archivo.");
    } finally {
      setLoading(false);
    }
  }

  async function importPatients() {
    if (!offlineRepository?.enabled || !file || !activeSheet) return setError("El modo offline debe estar desbloqueado.");
    const columns = [dniColumn, nameColumn, birthDateColumn, sexColumn];
    if (columns.some((column) => !column) || new Set(columns).size !== columns.length) {
      return setError("Mapea cuatro columnas diferentes: DNI, nombre completo, nacimiento y sexo.");
    }
    setError("");
    setLoading(true);
    setProgress({ processed: 0, total: activeSheet.rows, imported: 0, failed: 0, phase: "importing" });
    try {
      const data = await offlineRepository.importPatientRoster({
        file,
        mapping: { sheetName: activeSheet.name, dniColumn, nameColumn, birthDateColumn, sexColumn },
        estimatedRows: activeSheet.rows,
        onProgress: setProgress,
      });
      setResult(data);
      notify(`${data.imported.toLocaleString("es-PE")} pacientes disponibles para búsqueda offline.`);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "No se pudo crear la base local.");
    } finally {
      setLoading(false);
    }
  }

  const step = result ? 3 : preview ? 2 : 1;
  const mappedColumns = [dniColumn, nameColumn, birthDateColumn, sexColumn];
  const validMapping = mappedColumns.every(Boolean) && new Set(mappedColumns).size === mappedColumns.length;
  const percent = progress?.total ? Math.min(100, Math.floor((progress.processed / progress.total) * 100)) : 0;
  const columnOptions = activeSheet?.headers.map((header, index) => <option value={index + 1} key={`${header}-${index}`}>{header || `Columna ${index + 1}`}</option>);
  return <div className="dialog-backdrop" role="presentation">
    <section className="dialog-card patient-import-dialog" role="dialog" aria-modal="true" aria-labelledby="import-patients-title">
      <div className="import-dialog-head"><div><p className="eyebrow">Directorio local</p><h2 id="import-patients-title">Vincular base de pacientes</h2><p>El archivo se procesa en este equipo y no se envía a Supabase.</p></div><button className="icon-button" type="button" onClick={close} aria-label="Cerrar" disabled={loading}><X /></button></div>
      <div className="import-steps" aria-label="Progreso"><span className={step >= 1 ? "active" : ""}><b>1</b>Archivo</span><span className={step >= 2 ? "active" : ""}><b>2</b>Mapeo</span><span className={step >= 3 ? "active" : ""}><b>3</b>Resultado</span></div>
      <div className="patient-import-body">
        {!preview && !result && <div className="import-dropzone"><Import /><h3>Selecciona el archivo de pacientes</h3><p>XLSB, XLSX, XLSM o XLS · máximo 200 MB · primera fila con encabezados.</p><label className="button primary file-button">Elegir Excel<input type="file" accept=".xlsb,.xlsx,.xlsm,.xls" onChange={(event) => selectFile(event.target.files?.[0] ?? null)} /></label>{file && <small>{file.name}</small>}{loading && <div className="import-progress"><i /><span>Analizando el archivo en este equipo...</span></div>}</div>}
        {preview && !result && activeSheet && <>
          <div className="import-file-summary"><FileClock /><span><strong>{preview.file}</strong><small>{activeSheet.rows} filas en la hoja seleccionada</small></span><button className="text-button" type="button" onClick={() => selectFile(null)}>Cambiar archivo</button></div>
          {preview.warning && <p className="warning-line"><CircleAlert />{preview.warning}</p>}
          <div className="import-mapping-grid">
            <label>Hoja<select value={activeSheet.name} onChange={(event) => chooseSheet(event.target.value)}>{preview.sheets.map((sheet) => <option key={sheet.name}>{sheet.name}</option>)}</select></label>
            <label>Columna de DNI<select value={dniColumn} onChange={(event) => setDniColumn(Number(event.target.value))}><option value={0}>Seleccionar...</option>{columnOptions}</select></label>
            <label>Nombre completo<select value={nameColumn} onChange={(event) => setNameColumn(Number(event.target.value))}><option value={0}>Seleccionar...</option>{columnOptions}</select></label>
            <label>Fecha de nacimiento<select value={birthDateColumn} onChange={(event) => setBirthDateColumn(Number(event.target.value))}><option value={0}>Seleccionar...</option>{columnOptions}</select></label>
            <label>Sexo (M/F)<select value={sexColumn} onChange={(event) => setSexColumn(Number(event.target.value))}><option value={0}>Seleccionar...</option>{columnOptions}</select></label>
          </div>
          <div className="import-preview-table table-wrap"><table><thead><tr><th>Fila</th><th>DNI</th><th>Nombre completo</th><th>Nacimiento</th><th>Sexo</th></tr></thead><tbody>{activeSheet.sampleRows.map((row, index) => <tr key={index}><td>{index + 2}</td><td className="mono">{dniColumn ? row[dniColumn - 1] || "—" : "Selecciona"}</td><td>{nameColumn ? row[nameColumn - 1] || "—" : "Selecciona"}</td><td>{birthDateColumn ? row[birthDateColumn - 1] || "—" : "Selecciona"}</td><td>{sexColumn ? row[sexColumn - 1] || "—" : "Selecciona"}</td></tr>)}</tbody></table></div>
          <p className="compat-note"><ShieldCheck />La base quedará disponible en este equipo. Solo los pacientes utilizados en un análisis se sincronizarán con Supabase.</p>
          {loading && progress && <div className="roster-import-progress"><div><i style={{ width: `${percent}%` }} /></div>{progress.phase === "activating" ? <p><strong>Activando la base local…</strong> Este último paso puede tardar unos segundos.</p> : <p><strong>{percent}%</strong> · {progress.processed.toLocaleString("es-PE")} de {progress.total.toLocaleString("es-PE")} filas · {progress.imported.toLocaleString("es-PE")} únicas</p>}</div>}
        </>}
        {result && <div className="import-result"><span className="import-result-icon"><Check /></span><h3>Base local preparada</h3><p>{result.imported.toLocaleString("es-PE")} pacientes únicos ya se pueden buscar sin internet.</p><div><span><strong>{result.total.toLocaleString("es-PE")}</strong> procesados</span><span><strong>{result.failed.toLocaleString("es-PE")}</strong> filas inválidas</span><span><strong>{result.duplicates.toLocaleString("es-PE")}</strong> duplicados ignorados</span></div>{result.failures.length > 0 && <div className="import-failures"><strong>Filas inválidas que requieren revisión</strong>{result.failures.slice(0, 8).map((failure) => <p key={`${failure.row}-${failure.reason}`}><b>Fila {failure.row}</b>{failure.reason}</p>)}</div>}</div>}
        {error && <p className="form-error" role="alert">{error}</p>}
      </div>
      <div className="import-dialog-actions"><span>{preview && !result ? "Comprueba las cuatro columnas antes de crear el índice local." : "La base completa permanece únicamente en este equipo."}</span><div><button className="button secondary" type="button" onClick={close} disabled={loading}>{result ? "Cerrar" : "Cancelar"}</button>{preview && !result && <button className="button primary" type="button" disabled={loading || !validMapping} onClick={importPatients}>{loading ? progress?.phase === "activating" ? "Activando…" : `Preparando ${percent}%` : "Crear base local"}</button>}</div></div>
    </section>
  </div>;
}

function EditPatientDialog({ patient, close, notify }: { patient: LabData["patients"][number]; close: () => void; notify: (message: string) => void }) {
  const router = useRouter();
  const offlineRepository = useOfflineRepository();
  const [name, setName] = useState(patient.fullName);
  const [birthDate, setBirthDate] = useState(patient.birthDate);
  const [sex, setSex] = useState<"F" | "M" | "X" | "">(patient.sex === "U" ? "" : patient.sex);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError("");
    if (name.trim().length < 2) return setError("Ingresa el nombre completo del paciente.");
    if (!birthDate || !Number.isFinite(new Date(`${birthDate}T00:00:00`).getTime())) return setError("Ingresa una fecha de nacimiento válida.");
    if (new Date(`${birthDate}T00:00:00`).getTime() > Date.now()) return setError("El nacimiento no puede estar en el futuro.");
    if (!sex) return setError("Selecciona el sexo del paciente.");

    setSaving(true);
    try {
      if (offlineRepository) {
        await offlineRepository.updatePatient({
          patient,
          fullName: name.trim(),
          birthDate,
          sex,
        });
      } else {
        const response = await createClient().rpc("update_patient_details", {
          target_patient: patient.id,
          patient_name: name.trim(),
          patient_birth_date: birthDate,
          patient_sex: sex,
        });
        if (response.error) throw response.error;
      }
      notify(offlineRepository?.enabled ? "Paciente actualizado localmente; sincronización pendiente." : "Datos del paciente actualizados.");
      close();
      if (!offlineRepository) router.refresh();
    } catch (reason) {
      setError(rpcMessage(reason instanceof Error ? reason.message : "patient_update_failed"));
    } finally {
      setSaving(false);
    }
  }

  return <div className="dialog-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) close(); }}>
    <section className="dialog-card patient-edit-dialog" role="dialog" aria-modal="true" aria-labelledby="edit-patient-title">
      <div className="dialog-head"><div><p className="eyebrow">Datos maestros</p><h2 id="edit-patient-title">Editar paciente</h2><p>DNI {patient.documentNumber}</p></div><button className="icon-button" type="button" onClick={close} aria-label="Cerrar"><X /></button></div>
      <form onSubmit={submit}>
        <label>Nombre completo<input autoFocus value={name} onChange={(event) => setName(event.target.value)} /></label>
        <div className="dialog-fields">
          <label>Sexo<select value={sex} onChange={(event) => setSex(event.target.value as typeof sex)}><option value="">Seleccionar</option><option value="F">Femenino</option><option value="M">Masculino</option><option value="X">Otro</option></select></label>
          <label>Fecha de nacimiento<input type="date" max={new Date().toISOString().slice(0, 10)} value={birthDate} onChange={(event) => setBirthDate(event.target.value)} /></label>
        </div>
        {error && <p className="form-error" role="alert">{error}</p>}
        <div className="dialog-actions"><span>El DNI permanece sin cambios.</span><div><button className="button secondary" type="button" onClick={close}>Cancelar</button><button className="button primary" disabled={saving}>{saving ? "Guardando..." : "Guardar cambios"}</button></div></div>
      </form>
    </section>
  </div>;
}

function PatientsView({ patients, orders, openOrder, notify }: { patients: LabData["patients"]; orders: LabOrder[]; openOrder: (id: string) => void; notify: (message: string) => void }) {
  const offlineRepository = useOfflineRepository();
  const [selectedId, setSelectedId] = useState(patients[0]?.id ?? "");
  const [search, setSearch] = useState("");
  const [editing, setEditing] = useState(false);
  const [adding, setAdding] = useState(false);
  const [importing, setImporting] = useState(false);
  const [selectedSeriesKey, setSelectedSeriesKey] = useState("");
  const visiblePatients = patients.filter((patient) => {
    const value = search.trim().toLocaleLowerCase("es");
    if (!value) return true;
    return `${patient.documentNumber} ${patient.fullName}`.toLocaleLowerCase("es").includes(value);
  });
  const selected = visiblePatients.find((patient) => patient.id === selectedId) ?? visiblePatients[0] ?? null;
  const localRosterLocked = Boolean(offlineRepository && !offlineRepository.enabled);
  const patientActions = <div className="patient-page-actions"><button className="button secondary" disabled={localRosterLocked} title={localRosterLocked ? "Habilita y desbloquea el modo offline para guardar la base cifrada" : "Crear o reemplazar el directorio local de pacientes"} onClick={() => setImporting(true)}><Database />Base local</button><button className="button primary" onClick={() => setAdding(true)}><Plus />Agregar paciente</button></div>;
  if (!selected) return <><PageHead eyebrow="Registro maestro" title="Pacientes" text="Identidad única e historial de análisis." action={patientActions} /><article className="panel"><div className="empty"><Users /><h3>No hay pacientes registrados</h3><p>Agrega el primer paciente por DNI para comenzar.</p><button className="button primary" onClick={() => setAdding(true)}>Agregar paciente</button></div></article>{adding && <AddPatientDialog close={() => setAdding(false)} notify={notify} />}{importing && <PatientImportDialog close={() => setImporting(false)} notify={notify} />}</>;
  const patientOrders = orders.filter((order) => order.patientId === selected.id);
  const patientResults = patientOrders.flatMap((order) => order.results.map((result) => ({ order, result })))
    .sort((left, right) => right.order.createdAt.localeCompare(left.order.createdAt));
  const numericSeries = [...patientResults.reduce((series, entry) => {
    if (entry.result.resultType !== "numeric" || entry.result.numericValue === undefined || !Number.isFinite(entry.result.numericValue)) return series;
    const key = `${entry.result.analyte}|${entry.result.unit}|${entry.result.method}`;
    const current = series.get(key) ?? { key, label: entry.result.analyte, unit: entry.result.unit, method: entry.result.method, points: [] as LabData["trend"] };
    current.points.push({ date: new Intl.DateTimeFormat("es-PE", { day: "2-digit", month: "short", year: "2-digit" }).format(new Date(entry.order.createdAt)), value: entry.result.numericValue });
    series.set(key, current);
    return series;
  }, new Map<string, { key: string; label: string; unit: string; method: string; points: LabData["trend"] }>()).values()]
    .map((series) => ({ ...series, points: [...series.points].reverse() }))
    .sort((left, right) => left.label.localeCompare(right.label, "es"));
  const activeSeries = numericSeries.find((series) => series.key === selectedSeriesKey) ?? numericSeries[0] ?? null;
  const age = formatPatientAgeAt(selected.birthDate, new Date().toISOString());
  return <>
    <PageHead eyebrow="Registro maestro" title="Pacientes" text="Identidad única e historial de análisis." action={patientActions} />
    <div className="patients-layout">
      <section className="panel patient-list"><div className="compact-search"><Search /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="DNI o nombre…" aria-label="Buscar paciente por DNI o nombre" /></div>{visiblePatients.map((p) => <button key={p.id} className={selected.id === p.id ? "patient-row active" : "patient-row"} onClick={() => setSelectedId(p.id)}><span className="avatar patient">{p.fullName.split(" ").slice(0, 2).map((x) => x[0]).join("")}</span><span><strong>{p.fullName}</strong><small className="mono">DNI {p.documentNumber}</small></span><ChevronRight /></button>)}</section>
      <section className="patient-detail">
        <article className="panel profile-panel"><div><span className="avatar patient large">{selected.fullName.split(" ").slice(0, 2).map((x) => x[0]).join("")}</span><span><p className="eyebrow">Paciente activo</p><h2>{selected.fullName}</h2><p className="mono">DNI {selected.documentNumber}</p></span></div><button className="button secondary" onClick={() => setEditing(true)}>Editar datos</button><dl><div><dt>Edad</dt><dd>{age}</dd></div><div><dt>Sexo</dt><dd>{{ F: "Femenino", M: "Masculino", X: "Otro", U: "No registrado" }[selected.sex]}</dd></div><div><dt>Nacimiento</dt><dd>{selected.birthDate ? fmtBirthDate(selected.birthDate) : "No registrado"}</dd></div></dl></article>
        <article className="panel"><div className="panel-head patient-trend-head"><div><h2>Evolución de resultados</h2><p>Series compatibles por unidad y método</p></div>{numericSeries.length > 0 && <label>Análisis<select value={activeSeries?.key ?? ""} onChange={(event) => setSelectedSeriesKey(event.target.value)}>{numericSeries.map((series) => <option key={series.key} value={series.key}>{series.label}{series.unit ? ` (${expandMillonesText(series.unit)})` : ""}</option>)}</select></label>}</div>{activeSeries ? <><TrendChart points={activeSeries.points} /><div className="compat-note"><ShieldCheck />{activeSeries.label} · {expandMillonesText(activeSeries.unit) || "sin unidad"} · {activeSeries.method || "método no registrado"}</div></> : <div className="empty small"><BarChart3 /><p>Aún no hay resultados numéricos para graficar.</p></div>}</article>
        <article className="panel"><div className="panel-head"><div><h2>Historial de resultados</h2><p>{patientResults.length} resultados registrados</p></div></div>{patientResults.length ? <div className="table-wrap patient-results-table"><table><thead><tr><th>Fecha</th><th>Análisis</th><th>Resultado</th><th>Grupo</th><th>Orden</th></tr></thead><tbody>{patientResults.map(({ order, result }) => <tr key={`${order.id}-${result.orderAnalysisId}`}><td>{fmtDate(order.createdAt)}</td><td><strong>{result.analyte}</strong><small className="block">{result.method || "Método no registrado"}</small></td><td className="mono"><strong>{formatNumericResult(result.value, result.unit) || "Pendiente"}</strong>{result.unit ? ` ${expandMillonesText(result.unit)}` : ""}</td><td>{result.group}</td><td><button className="table-link" type="button" onClick={() => openOrder(order.id)}>{order.code}</button></td></tr>)}</tbody></table></div> : <div className="empty small"><TestTube2 /><p>Este paciente todavía no tiene resultados.</p></div>}</article>
        <article className="panel"><div className="panel-head"><div><h2>Historial de órdenes</h2><p>{patientOrders.length} registros encontrados</p></div></div>{patientOrders.length ? <OrderTable orders={patientOrders} onSelect={openOrder} /> : <div className="empty small"><ClipboardList /><p>Sin órdenes en el periodo actual.</p></div>}</article>
      </section>
    </div>
    {editing && <EditPatientDialog key={selected.id} patient={selected} close={() => setEditing(false)} notify={notify} />}
    {adding && <AddPatientDialog close={() => setAdding(false)} notify={notify} />}
    {importing && <PatientImportDialog close={() => setImporting(false)} notify={notify} />}
  </>;
}

function TrendChart({ points: values }: { points: LabData["trend"] }) {
  const min = Math.min(...values.map((point) => point.value));
  const max = Math.max(...values.map((point) => point.value));
  const spread = Math.max(1, max - min);
  const points = values.map((point, index) => `${40 + index * (540 / Math.max(1, values.length - 1))},${180 - ((point.value - min) / spread) * 140}`).join(" ");
  return <svg className="trend-chart" viewBox="0 0 620 220" role="img" aria-label="Evolución numérica del paciente"><line x1="40" y1="180" x2="580" y2="180" /><line x1="40" y1="110" x2="580" y2="110" /><line x1="40" y1="40" x2="580" y2="40" /><polyline points={points} fill="none" stroke="currentColor" strokeWidth="3" />{points.split(" ").map((point, index) => { const [x, y] = point.split(","); return <circle key={index} cx={x} cy={y} r="5" />; })}<text x="40" y="208">{values[0]?.date}</text><text x="500" y="208">{values.at(-1)?.date}</text><text x="7" y="184">{min}</text><text x="2" y="44">{max}</text></svg>;
}

const DAY_MS = 86_400_000;
const dateInputValue = (date: Date) => {
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 10);
};
const inputDate = (value: string, endOfDay = false) => new Date(`${value}T${endOfDay ? "23:59:59.999" : "00:00:00"}`);
const analyticsDate = (date: Date) => new Intl.DateTimeFormat("es-PE", { day: "2-digit", month: "short" }).format(date);
function AnalyticsView({ orders, openOrder }: { orders: LabOrder[]; openOrder: (id: string) => void }) {
  const [openedAt] = useState(() => new Date().getTime());
  const latestDate = useMemo(() => orders.length
    ? orders.reduce((latest, order) => Math.max(latest, new Date(order.createdAt).getTime()), Number.NEGATIVE_INFINITY)
    : openedAt, [openedAt, orders]);
  const initialEnd = useMemo(() => new Date(latestDate), [latestDate]);
  const [start, setStart] = useState(() => dateInputValue(new Date(initialEnd.getTime() - 29 * DAY_MS)));
  const [end, setEnd] = useState(() => dateInputValue(initialEnd));
  const [group, setGroup] = useState("");
  const [chartMode, setChartMode] = useState<"group" | "analysis">("group");
  const [chartAnalysis, setChartAnalysis] = useState("");
  const groups = useMemo(() => [...new Set(orders.flatMap((order) => [...order.groups, ...order.results.map((result) => result.group)]).filter(Boolean))].sort((a, b) => a.localeCompare(b, "es")), [orders]);
  const startDate = inputDate(start || dateInputValue(initialEnd));
  const endDate = inputDate(end || dateInputValue(initialEnd), true);
  const validPeriod = Boolean(start && end) && startDate.getTime() <= endDate.getTime();
  const duration = validPeriod ? endDate.getTime() - startDate.getTime() + 1 : 0;
  const previousEnd = new Date(startDate.getTime() - 1);
  const previousStart = new Date(previousEnd.getTime() - duration + 1);

  const matchingResults = (order: LabOrder) => group ? order.results.filter((result) => result.group === group) : order.results;
  const inPeriod = (order: LabOrder, from: Date, to: Date) => {
    const time = new Date(order.createdAt).getTime();
    return time >= from.getTime() && time <= to.getTime() && (!group || matchingResults(order).length > 0);
  };
  const filteredOrders = validPeriod ? orders.filter((order) => inPeriod(order, startDate, endDate)) : [];
  const previousOrders = validPeriod ? orders.filter((order) => inPeriod(order, previousStart, previousEnd)) : [];
  const filteredResults = filteredOrders.flatMap(matchingResults);
  const previousResults = previousOrders.flatMap(matchingResults);
  const patientCount = new Set(filteredOrders.map((order) => order.patientId)).size;
  const previousPatientCount = new Set(previousOrders.map((order) => order.patientId)).size;
  const batches = new Set(filteredResults.map((result) => result.batchId)).size;
  const previousBatches = new Set(previousResults.map((result) => result.batchId)).size;
  const critical = filteredResults.filter((result) => result.flag === "critical").length;

  const comparisonLabel = (current: number, previous: number) => {
    if (!previous) return current ? "Nuevo frente al periodo anterior" : "Sin variación";
    const change = Math.round(((current - previous) / previous) * 100);
    return `${change >= 0 ? "+" : ""}${change}% frente al periodo anterior`;
  };
  const setQuickPeriod = (days: number) => {
    const last = new Date(latestDate);
    setEnd(dateInputValue(last));
    setStart(dateInputValue(new Date(last.getTime() - (days - 1) * DAY_MS)));
  };

  const bucketCount = Math.max(1, Math.min(12, Math.ceil(duration / DAY_MS)));
  const bucketSize = duration / bucketCount;
  const chartGroups = [...new Set(filteredResults.map((result) => result.group))]
    .map((name) => ({ name, count: filteredResults.filter((result) => result.group === name).length }))
    .sort((left, right) => right.count - left.count)
    .map((item) => item.name);
  const chartAnalyses = [...new Set(filteredResults.map((result) => result.analyte))].sort((left, right) => left.localeCompare(right, "es"));
  const activeChartAnalysis = chartAnalyses.includes(chartAnalysis) ? chartAnalysis : chartAnalyses[0] ?? "";
  const chartSeries = chartMode === "group" ? chartGroups : activeChartAnalysis ? [activeChartAnalysis] : [];
  const chartData = Array.from({ length: bucketCount }, (_, index) => {
    const currentFrom = startDate.getTime() + index * bucketSize;
    const currentTo = index === bucketCount - 1 ? endDate.getTime() + 1 : currentFrom + bucketSize;
    const priorFrom = previousStart.getTime() + index * bucketSize;
    const priorTo = index === bucketCount - 1 ? previousEnd.getTime() + 1 : priorFrom + bucketSize;
    const currentBucket = filteredOrders.filter((order) => { const value = new Date(order.createdAt).getTime(); return value >= currentFrom && value < currentTo; });
    const previousBucket = previousOrders.filter((order) => { const value = new Date(order.createdAt).getTime(); return value >= priorFrom && value < priorTo; });
    const currentBucketResults = currentBucket.flatMap(matchingResults);
    const previousBucketResults = previousBucket.flatMap(matchingResults);
    return {
      label: analyticsDate(new Date(currentFrom)),
      groups: Object.fromEntries(chartSeries.map((name) => [name, {
        current: currentBucketResults.filter((result) => chartMode === "group" ? result.group === name : result.analyte === name).length,
        previous: previousBucketResults.filter((result) => chartMode === "group" ? result.group === name : result.analyte === name).length,
      }])),
    };
  });

  const groupDistribution = [...new Set(filteredResults.map((result) => result.group))].map((name) => ({ name, value: filteredResults.filter((result) => result.group === name).length })).sort((a, b) => b.value - a.value);
  const topAnalyses = [...new Set(filteredResults.map((result) => result.analyte))].map((name) => ({ name, value: filteredResults.filter((result) => result.analyte === name).length })).sort((a, b) => b.value - a.value).slice(0, 6);
  const criticalRows = filteredOrders.flatMap((order) => matchingResults(order).filter((result) => result.flag === "critical").map((result) => ({ order, result }))).slice(0, 8);

  const exportCsv = () => {
    const escape = (value: unknown) => `"${String(value ?? "").replaceAll('"', '""')}"`;
    const rows = filteredOrders.flatMap((order) => matchingResults(order).map((result) => [order.code, fmtDate(order.createdAt), order.patientName, order.documentNumber, result.group, result.analyte, result.value, result.unit, result.flag, result.performedBy]));
    const content = [["Orden", "Fecha", "Paciente", "DNI", "Grupo", "Análisis", "Resultado", "Unidad", "Bandera", "Realizado por"], ...rows].map((row) => row.map(escape).join(",")).join("\r\n");
    const url = URL.createObjectURL(new Blob([`\uFEFF${content}`], { type: "text/csv;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = `analitica-${start}-${end}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  return <>
    <PageHead eyebrow="Inteligencia operativa" title="Analítica" text="Indicadores reales de volumen, oportunidad y calidad del laboratorio." action={<button className="button secondary" onClick={exportCsv} disabled={!filteredResults.length}><FileDown />Exportar CSV</button>} />
    <section className="analytics-filter-bar">
      <div className="analytics-quick-periods" aria-label="Periodos rápidos"><button onClick={() => setQuickPeriod(7)}>7 días</button><button onClick={() => setQuickPeriod(30)}>30 días</button><button onClick={() => setQuickPeriod(90)}>90 días</button></div>
      <label>Desde<input type="date" value={start} max={end} onChange={(event) => setStart(event.target.value)} /></label>
      <label>Hasta<input type="date" value={end} min={start} onChange={(event) => setEnd(event.target.value)} /></label>
      <label>Grupo<select value={group} onChange={(event) => setGroup(event.target.value)}><option value="">Todos los grupos</option>{groups.map((name) => <option key={name}>{name}</option>)}</select></label>
    </section>
    {!validPeriod && <div className="analytics-warning"><CircleAlert />La fecha inicial debe ser anterior a la fecha final.</div>}
    <section className="metrics-grid analytics-metrics">
      <article className="metric"><div><span>Órdenes</span><strong>{filteredOrders.length}</strong><small>{comparisonLabel(filteredOrders.length, previousOrders.length)}</small></div><ClipboardList /></article>
      <article className="metric"><div><span>Resultados registrados</span><strong>{filteredResults.length}</strong><small>{comparisonLabel(filteredResults.length, previousResults.length)}</small></div><FlaskConical /></article>
      <article className="metric"><div><span>Pacientes únicos</span><strong>{patientCount}</strong><small>{comparisonLabel(patientCount, previousPatientCount)}</small></div><Users /></article>
      <article className="metric"><div><span>Tandas registradas</span><strong>{batches}</strong><small>{comparisonLabel(batches, previousBatches)}</small></div><TestTube2 /></article>
    </section>
    {filteredOrders.length ? <>
      <section className="analytics-insights"><div><CircleAlert /><span><small>Resultados críticos</small><strong>{critical}</strong></span></div><div><TestTube2 /><span><small>Grupos distintos</small><strong>{groupDistribution.length}</strong></span></div><div><Activity /><span><small>Promedio por orden</small><strong>{(filteredResults.length / filteredOrders.length).toFixed(1)}</strong></span></div></section>
      <section className="analytics-grid">
        <article className="panel analytics-volume-panel">
          <div className="panel-head analytics-volume-head"><div><h2>{chartMode === "group" ? "Distribución de análisis por grupo" : "Evolución de un análisis"}</h2><p>{chartMode === "group" ? "Cada barra muestra el volumen del día y su composición por grupo." : "Consulta cuántas veces se realizó un análisis específico en cada día."}</p></div><div className="analytics-chart-controls"><div className="analytics-chart-mode" aria-label="Desglose del gráfico"><button type="button" className={chartMode === "group" ? "active" : ""} onClick={() => setChartMode("group")}>Por grupo</button><button type="button" className={chartMode === "analysis" ? "active" : ""} onClick={() => setChartMode("analysis")}>Por análisis</button></div>{chartMode === "analysis" && <select value={activeChartAnalysis} onChange={(event) => setChartAnalysis(event.target.value)} aria-label="Seleccionar análisis para la gráfica">{chartAnalyses.map((name) => <option key={name}>{name}</option>)}</select>}</div></div>
          <AnalyticsStackedBarChart data={chartData} groups={chartSeries} detailLabel={chartMode === "group" ? "Detalle de grupos" : "Detalle del análisis"} />
        </article>
        <article className="panel"><div className="panel-head"><div><h2>Distribución por grupo</h2><p>Resultados registrados</p></div></div><AnalyticsBars data={groupDistribution} emptyLabel="No hay grupos en este periodo." /></article>
        <article className="panel"><div className="panel-head"><div><h2>Análisis más realizados</h2><p>Los seis con mayor volumen</p></div></div><AnalyticsBars data={topAnalyses} emptyLabel="No hay análisis en este periodo." /></article>
      </section>
      {criticalRows.length > 0 && <article className="panel analytics-critical"><div className="panel-head"><div><h2>Resultados críticos recientes</h2><p>Requieren seguimiento clínico.</p></div></div><div className="table-wrap"><table><thead><tr><th>Orden</th><th>Paciente</th><th>Análisis</th><th>Resultado</th><th>Fecha</th><th /></tr></thead><tbody>{criticalRows.map(({ order, result }) => <tr key={`${order.id}-${result.id}`}><td className="mono strong">{order.code}</td><td>{order.patientName}</td><td>{result.analyte}<small className="table-subline">{result.group}</small></td><td><span className="status critical">{result.value} {result.unit}</span></td><td>{fmtDate(result.registeredAt || order.createdAt)}</td><td><button className="text-button" onClick={() => openOrder(order.id)}>Ver orden <ChevronRight /></button></td></tr>)}</tbody></table></div></article>}
    </> : <article className="panel"><div className="empty"><BarChart3 /><h3>Sin datos para el periodo</h3><p>Ajusta las fechas o registra órdenes para habilitar los indicadores.</p></div></article>}
  </>;
}

const analyticsGroupColor = (index: number) => `hsl(${(174 + index * 47) % 360} 55% 40%)`;
type AnalyticsChartPoint = { label: string; groups: Record<string, { current: number; previous: number }> };

function AnalyticsStackedBarChart({ data, groups, detailLabel }: { data: AnalyticsChartPoint[]; groups: string[]; detailLabel: string }) {
  const [activeIndex, setActiveIndex] = useState<number | null>(null);
  const [focusedGroup, setFocusedGroup] = useState<string | null>(null);
  const totals = data.map((point) => groups.reduce((total, name) => total + (point.groups[name]?.current ?? 0), 0));
  const maximum = Math.max(1, ...totals);
  const x = (index: number) => 50 + (index + .5) * (600 / Math.max(1, data.length));
  const y = (value: number) => 190 - value / maximum * 145;
  const barWidth = Math.min(38, Math.max(16, 420 / Math.max(1, data.length)));
  const labelIndexes = new Set([0, Math.floor((data.length - 1) / 2), data.length - 1]);
  const selectedData = activeIndex === null ? null : data[activeIndex];

  return <div className="analytics-chart-shell" onMouseLeave={() => setActiveIndex(null)}>
    {groups.length > 1 && <div className="analytics-series-legend" aria-label="Series del gráfico">{groups.map((name, index) => <button type="button" key={name} className={focusedGroup === name ? "active" : ""} onClick={() => setFocusedGroup((current) => current === name ? null : name)} aria-pressed={focusedGroup === name}><i style={{ background: analyticsGroupColor(index) }} />{name}</button>)}</div>}
    <div className="analytics-plot">
      <svg className="analytics-chart" viewBox="0 0 700 240" role="img" aria-label="Distribución interactiva de análisis por grupo y periodo">
        {[0, 0.5, 1].map((ratio) => <g className="analytics-grid-line" key={ratio}><line x1="50" y1={y(maximum * ratio)} x2="650" y2={y(maximum * ratio)} /><text x="12" y={y(maximum * ratio) + 4}>{Math.round(maximum * ratio)}</text></g>)}
        {data.map((point, dataIndex) => <g key={`${point.label}-${dataIndex}`}>
          {groups.map((name, groupIndex) => {
            const value = point.groups[name]?.current ?? 0;
            const stackTop = groups.slice(0, groupIndex + 1).reduce((total, groupName) => total + (point.groups[groupName]?.current ?? 0), 0);
            const segmentTop = y(stackTop);
            const segmentHeight = Math.max(0, y(stackTop - value) - segmentTop);
            const dimmed = Boolean(focusedGroup && focusedGroup !== name);
            if (!value) return null;
            return <rect key={name} x={x(dataIndex) - barWidth / 2} y={segmentTop} width={barWidth} height={segmentHeight} rx="2" className="analytics-bar-segment" style={{ fill: analyticsGroupColor(groupIndex), opacity: dimmed ? .16 : 1 }} />;
          })}
          <text className="analytics-bar-total" x={x(dataIndex)} y={y(totals[dataIndex]) - 7} textAnchor="middle">{totals[dataIndex]}</text>
          {labelIndexes.has(dataIndex) && <text className="x-label" x={x(dataIndex)} y="225" textAnchor="middle">{point.label}</text>}
          <rect x={x(dataIndex) - Math.max(18, barWidth / 2)} y={Math.min(y(totals[dataIndex]) - 10, 170)} width={Math.max(36, barWidth)} height={Math.max(30, 200 - y(totals[dataIndex]))} rx="5" className={activeIndex === dataIndex ? "analytics-bar-target active" : "analytics-bar-target"} tabIndex={0} aria-label={`${point.label}: ${totals[dataIndex]} análisis. ${groups.map((name) => `${name}, ${point.groups[name]?.current ?? 0}`).join("; ")}`} onMouseEnter={() => setActiveIndex(dataIndex)} onFocus={() => setActiveIndex(dataIndex)} onBlur={() => setActiveIndex(null)} />
        </g>)}
      </svg>
      {activeIndex !== null && selectedData && <div className={`analytics-chart-tooltip daily-detail ${activeIndex === 0 ? "at-start" : activeIndex === data.length - 1 ? "at-end" : ""} ${y(totals[activeIndex]) < 120 ? "below" : ""}`} style={{ left: `${x(activeIndex) / 7}%`, top: `${y(totals[activeIndex]) / 2.4}%` }} role="status">
        <header><CalendarDays /><span><strong>{selectedData.label}</strong><small>{detailLabel} · {totals[activeIndex]} en total</small></span></header>
        <div className="analytics-tooltip-breakdown">{groups.map((name, index) => {
          const values = selectedData.groups[name] ?? { current: 0, previous: 0 };
          return <div key={name}><i style={{ background: analyticsGroupColor(index) }} /><span title={name}>{name}</span><strong>{values.current}</strong><small>Anterior {values.previous}</small></div>;
        })}</div>
      </div>}
    </div>
    <p className="analytics-chart-hint">Pasa el cursor por una barra para ver el detalle completo de ese día y su comparación anterior.</p>
  </div>;
}

function AnalyticsBars({ data, emptyLabel }: { data: { name: string; value: number }[]; emptyLabel: string }) {
  const maximum = Math.max(1, ...data.map((item) => item.value));
  if (!data.length) return <div className="empty small"><BarChart3 /><p>{emptyLabel}</p></div>;
  return <div className="analytics-bars">{data.map((item) => <div className="analytics-bar-row" key={item.name}><div><span title={item.name}>{item.name}</span><strong>{item.value}</strong></div><i><b style={{ width: `${item.value / maximum * 100}%` }} /></i></div>)}</div>;
}

function CatalogView({ analyses }: { analyses: LabData["analyses"] }) {
  const [query, setQuery] = useState("");
  const [group, setGroup] = useState("");
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<LabData["analyses"][number] | null>(null);
  const groups = new Set(analyses.map((analysis) => analysis.group));
  const archived = analyses.filter((analysis) => !analysis.active).length;
  const visible = analyses.filter((analysis) =>
    (!group || analysis.group === group)
    && `${analysis.code} ${analysis.name}`.toLocaleLowerCase("es").includes(query.toLocaleLowerCase("es")),
  );
  const pageCount = Math.max(1, Math.ceil(visible.length / 20));
  const currentPage = Math.min(page, pageCount);
  const pagedAnalyses = visible.slice((currentPage - 1) * 20, currentPage * 20);
  return <>
    <PageHead eyebrow="Gobierno clínico" title="Catálogo de análisis" text="Los elementos importados deben revisarse antes de usarse en una orden." />
    <div className="catalog-summary"><span><FlaskConical /><strong>{analyses.length - archived}</strong> análisis activos</span><span><Database /><strong>{groups.size}</strong> grupos</span><span><BookOpenCheck /><strong>{archived}</strong> por revisar</span></div>
    <article className="panel"><div className="table-actions"><div className="compact-search"><Search /><input value={query} onChange={(event) => { setQuery(event.target.value); setPage(1); }} placeholder="Buscar código o análisis…" aria-label="Buscar en el catálogo" /></div><select value={group} onChange={(event) => { setGroup(event.target.value); setPage(1); }} aria-label="Filtrar catálogo por grupo"><option value="">Todos los grupos</option>{[...groups].sort().map((name) => <option key={name}>{name}</option>)}</select></div><div className="table-wrap"><table><thead><tr><th>Código</th><th>Análisis</th><th>Grupo</th><th>Tipo</th><th>Unidad</th><th>Método</th><th>Referencia</th><th>Estado</th><th /></tr></thead><tbody>{pagedAnalyses.map((a) => <tr key={a.id}><td className="mono strong">{a.code}</td><td><strong>{a.name}</strong></td><td>{a.group}</td><td>{a.active ? (a.resultType === "numeric" ? "Numérico" : a.resultType === "qualitative" ? "Cualitativo" : "Texto") : "Por definir"}</td><td className="mono">{a.unit || "—"}</td><td>{a.method || "—"}</td><td className="mono">{a.active ? a.reference : "Pendiente"}</td><td><span className={`status ${a.active ? "validated" : "pending_validation"}`}>{a.active ? "Activo" : "Revisión pendiente"}</span></td><td><button className="text-button" onClick={() => setSelected(a)}>{a.active ? "Nueva versión" : "Revisar"} <ChevronRight /></button></td></tr>)}</tbody></table></div><footer className="catalog-pagination"><span>Mostrando {visible.length ? (currentPage - 1) * 20 + 1 : 0}–{Math.min(currentPage * 20, visible.length)} de {visible.length}</span><div><button type="button" className="button secondary" disabled={currentPage === 1} onClick={() => setPage((value) => Math.max(1, value - 1))}><ArrowLeft />Atrás</button><strong>Página {currentPage} de {pageCount}</strong><button type="button" className="button secondary" disabled={currentPage === pageCount} onClick={() => setPage((value) => Math.min(pageCount, value + 1))}>Siguiente<ChevronRight /></button></div></footer></article>
    {selected && <CatalogApprovalDialog analysis={selected} close={() => setSelected(null)} />}
  </>;
}

function CatalogApprovalDialog({ analysis, close }: { analysis: LabData["analyses"][number]; close: () => void }) {
  const router = useRouter();
  const offlineRepository = useOfflineRepository();
  const [resultType, setResultType] = useState<"numeric" | "qualitative" | "text">(analysis.active ? analysis.resultType : "numeric");
  const [sampleType, setSampleType] = useState(analysis.sampleType ?? "");
  const [method, setMethod] = useState(analysis.method ?? "");
  const [unit, setUnit] = useState(analysis.unit ?? "");
  const [decimals, setDecimals] = useState(String(analysis.decimals ?? 2));
  const [referenceLabel, setReferenceLabel] = useState(analysis.active ? analysis.reference : "");
  const [referenceLow, setReferenceLow] = useState("");
  const [referenceHigh, setReferenceHigh] = useState("");
  const [criticalLow, setCriticalLow] = useState("");
  const [criticalHigh, setCriticalHigh] = useState("");
  const [options, setOptions] = useState(analysis.qualitativeOptions?.join(", ") ?? "Negativo, Positivo");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError("");
    if (offlineRepository && !offlineRepository.online) return setError("La aprobación del catálogo requiere conexión.");
    if (sampleType.trim().length < 2) return setError("Indica el tipo de muestra.");
    const parsedOptions = options.split(",").map((option) => option.trim()).filter(Boolean);
    const range: Record<string, string | number> = { label: referenceLabel.trim() };
    if (referenceLow.trim()) range.low = Number(referenceLow);
    if (referenceHigh.trim()) range.high = Number(referenceHigh);
    if (resultType === "numeric" && (!range.label || (range.low === undefined && range.high === undefined))) {
      return setError("Indica la etiqueta y al menos un límite de referencia.");
    }
    const critical: Record<string, number> = {};
    if (criticalLow.trim()) critical.low = Number(criticalLow);
    if (criticalHigh.trim()) critical.high = Number(criticalHigh);
    setSaving(true);
    const response = await createClient().rpc("approve_analysis_version", {
      target_analysis: analysis.id,
      approved_result_type: resultType,
      approved_sample_type: sampleType.trim(),
      approved_method: method.trim() || null,
      approved_unit: unit.trim() || null,
      approved_decimals: resultType === "numeric" ? Number(decimals) : null,
      approved_qualitative_options: resultType === "qualitative" ? parsedOptions : null,
      approved_reference_ranges: resultType === "numeric" ? [range] : [],
      approved_critical_limits: critical,
    });
    setSaving(false);
    if (response.error) return setError(rpcMessage(response.error.message));
    close();
    router.refresh();
  }

  return <div className="dialog-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) close(); }}>
    <section className="dialog-card catalog-dialog" role="dialog" aria-modal="true" aria-labelledby="catalog-review-title">
      <div className="dialog-head"><div><p className="eyebrow">Aprobación clínica</p><h2 id="catalog-review-title">{analysis.name}</h2><p>{analysis.code} · {analysis.group}. Crear una versión nueva no altera informes anteriores.</p></div><button className="icon-button" onClick={close} aria-label="Cerrar"><X /></button></div>
      <form onSubmit={submit}>
        <div className="dialog-fields">
          <label>Tipo de resultado<select value={resultType} onChange={(event) => setResultType(event.target.value as typeof resultType)}><option value="numeric">Numérico</option><option value="qualitative">Cualitativo</option><option value="text">Texto libre</option></select></label>
          <label>Tipo de muestra<input value={sampleType} onChange={(event) => setSampleType(event.target.value)} placeholder="Suero, sangre, orina…" /></label>
          <label>Método<input value={method} onChange={(event) => setMethod(event.target.value)} placeholder="Método aprobado" /></label>
          {resultType === "numeric" && <><label>Unidad<input value={unit} onChange={(event) => setUnit(event.target.value)} placeholder="mg/dL, %, células/mm³…" /></label><label>Decimales<input type="number" min="0" max="8" value={decimals} onChange={(event) => setDecimals(event.target.value)} /></label></>}
        </div>
        {resultType === "numeric" && <fieldset className="clinical-fields"><legend>Intervalo de referencia</legend><label>Texto para el informe<input value={referenceLabel} onChange={(event) => setReferenceLabel(event.target.value)} placeholder="70–110 mg/dL" /></label><div className="dialog-fields"><label>Límite bajo<input type="number" step="any" value={referenceLow} onChange={(event) => setReferenceLow(event.target.value)} /></label><label>Límite alto<input type="number" step="any" value={referenceHigh} onChange={(event) => setReferenceHigh(event.target.value)} /></label><label>Crítico bajo (opcional)<input type="number" step="any" value={criticalLow} onChange={(event) => setCriticalLow(event.target.value)} /></label><label>Crítico alto (opcional)<input type="number" step="any" value={criticalHigh} onChange={(event) => setCriticalHigh(event.target.value)} /></label></div><p className="form-help">Esta primera versión aplica a todas las edades y sexos. Crea versiones segmentadas antes de producción cuando corresponda.</p></fieldset>}
        {resultType === "qualitative" && <label>Opciones permitidas<input value={options} onChange={(event) => setOptions(event.target.value)} placeholder="Negativo, Positivo" /><small className="form-help">Sepáralas con comas. El usuario elegirá una opción, no escribirá texto libre.</small></label>}
        {resultType === "text" && <p className="compat-note"><ShieldCheck />El resultado será texto libre y no tendrá banderas automáticas.</p>}
        {error && <p className="form-error" role="alert">{error}</p>}
        <div className="dialog-actions"><span>Requiere aprobación del responsable clínico</span><div><button type="button" className="button secondary" onClick={close}>Cancelar</button><button className="button primary" disabled={saving}>{saving ? "Guardando…" : "Aprobar y activar"}</button></div></div>
      </form>
    </section>
  </div>;
}

function SettingsView({ analysts }: { analysts: LabData["analysts"] }) {
  const router = useRouter();
  const offlineRepository = useOfflineRepository();
  const [localAnalysts, setLocalAnalysts] = useState(analysts);
  const [analystName, setAnalystName] = useState("");
  const [savingAnalyst, setSavingAnalyst] = useState(false);
  const [analystMessage, setAnalystMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const [password, setPassword] = useState("");
  const [passwordConfirmation, setPasswordConfirmation] = useState("");
  const [changingPassword, setChangingPassword] = useState(false);
  const [passwordMessage, setPasswordMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);

  async function refreshConfiguration() {
    if (offlineRepository) await offlineRepository.refresh();
    else router.refresh();
  }

  async function addAnalyst(event: React.FormEvent) {
    event.preventDefault();
    setAnalystMessage(null);
    if (offlineRepository && !offlineRepository.online) return setAnalystMessage({ type: "error", text: "Administrar analistas requiere conexión." });
    if (analystName.trim().length < 2) return setAnalystMessage({ type: "error", text: "Ingresa el nombre completo del analista." });
    setSavingAnalyst(true);
    try {
      const response = await fetch("/api/analysts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fullName: analystName.trim() }),
      });
      const payload = await response.json().catch(() => null) as { analyst?: { id: string; full_name: string; active: boolean }; error?: string } | null;
      if (!response.ok || !payload?.analyst) return setAnalystMessage({ type: "error", text: payload?.error ?? "No se pudo agregar el analista." });
      const created = payload.analyst;
      setLocalAnalysts((current) => [...current, { id: created.id, fullName: created.full_name, active: created.active }].sort((a, b) => a.fullName.localeCompare(b.fullName, "es")));
      setAnalystName("");
      setAnalystMessage({ type: "success", text: "Analista agregado y disponible para nuevos registros." });
      await refreshConfiguration();
    } catch {
      setAnalystMessage({ type: "error", text: "No se pudo conectar con el servicio de analistas." });
    } finally {
      setSavingAnalyst(false);
    }
  }

  async function toggleAnalyst(id: string, active: boolean) {
    setAnalystMessage(null);
    if (offlineRepository && !offlineRepository.online) return setAnalystMessage({ type: "error", text: "Administrar analistas requiere conexión." });
    setSavingAnalyst(true);
    try {
      const response = await fetch("/api/analysts", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, active }),
      });
      const payload = await response.json().catch(() => null) as { error?: string } | null;
      if (!response.ok) return setAnalystMessage({ type: "error", text: payload?.error ?? "No se pudo actualizar el analista." });
      setLocalAnalysts((current) => current.map((analyst) => analyst.id === id ? { ...analyst, active } : analyst));
      setAnalystMessage({ type: "success", text: active ? "Analista reactivado." : "Analista desactivado para nuevos registros." });
      await refreshConfiguration();
    } catch {
      setAnalystMessage({ type: "error", text: "No se pudo conectar con el servicio de analistas." });
    } finally {
      setSavingAnalyst(false);
    }
  }

  async function changePassword(event: React.FormEvent) {
    event.preventDefault();
    setPasswordMessage(null);
    if (offlineRepository && !offlineRepository.online) return setPasswordMessage({ type: "error", text: "Cambiar la contraseña requiere conexión." });
    if (password.length < 12) return setPasswordMessage({ type: "error", text: "La contraseña debe tener al menos 12 caracteres." });
    if (password !== passwordConfirmation) return setPasswordMessage({ type: "error", text: "Las contraseñas no coinciden." });
    setChangingPassword(true);
    try {
      const response = await createClient().auth.updateUser({ password });
      if (response.error) return setPasswordMessage({ type: "error", text: "No se pudo cambiar la contraseña. Vuelve a iniciar sesión e inténtalo nuevamente." });
      setPassword("");
      setPasswordConfirmation("");
      setPasswordMessage({ type: "success", text: "Contraseña actualizada." });
    } catch {
      setPasswordMessage({ type: "error", text: "No se pudo conectar con el servicio de autenticación." });
    } finally {
      setChangingPassword(false);
    }
  }

  return <>
    <PageHead eyebrow="Administración" title="Configuración" text="Gestiona la cuenta compartida y las identidades clínicas de los analistas." />
    <div className="settings-grid">
      <article className="panel settings-form-card analyst-settings-card"><div className="settings-card-head"><span><UserRound /></span><div><h2>Analistas</h2><p>No crean cuentas. Se seleccionan al registrar cada análisis.</p></div></div><form onSubmit={addAnalyst}><label>Nombre completo<input value={analystName} onChange={(event) => setAnalystName(event.target.value.replace(/[0-9]/g, ""))} maxLength={120} placeholder="Nombre del analista" required /></label>{analystMessage && <p className={`settings-message ${analystMessage.type}`} role="status">{analystMessage.type === "success" ? <Check /> : <CircleAlert />}{analystMessage.text}</p>}<button className="button primary" disabled={savingAnalyst}><Plus />{savingAnalyst ? "Guardando…" : "Agregar analista"}</button></form><div className="analyst-list">{localAnalysts.map((analyst) => <div key={analyst.id}><span><strong>{analyst.fullName}</strong><small>{analyst.active ? "Disponible para nuevos análisis" : "Inactivo"}</small></span><button type="button" className={analyst.active ? "button secondary" : "button primary"} disabled={savingAnalyst} onClick={() => void toggleAnalyst(analyst.id, !analyst.active)}>{analyst.active ? "Desactivar" : "Reactivar"}</button></div>)}{localAnalysts.length === 0 && <p className="form-help">Agrega al menos un analista antes de registrar resultados.</p>}</div></article>
      <article className="panel settings-form-card"><div className="settings-card-head"><span><Users /></span><div><h2>Cuenta compartida</h2><p>Todo el personal accede con la misma cuenta.</p></div></div><div className="shared-account-note"><ShieldCheck /><p>La autoría clínica se registra mediante el analista seleccionado. No se enviarán invitaciones a otros usuarios.</p></div></article>
      <article className="panel settings-form-card"><div className="settings-card-head"><span><KeyRound /></span><div><h2>Cambiar contraseña</h2><p>Actualiza rápidamente la contraseña de tu sesión actual.</p></div></div><form onSubmit={changePassword}><label>Nueva contraseña<input type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="new-password" minLength={12} required /></label><label>Repite la contraseña<input type="password" value={passwordConfirmation} onChange={(event) => setPasswordConfirmation(event.target.value)} autoComplete="new-password" minLength={12} required /></label>{passwordMessage && <p className={`settings-message ${passwordMessage.type}`} role="status">{passwordMessage.type === "success" ? <Check /> : <CircleAlert />}{passwordMessage.text}</p>}<button className="button primary" disabled={changingPassword}><KeyRound />{changingPassword ? "Actualizando…" : "Cambiar contraseña"}</button></form></article>
    </div>
  </>;
}
