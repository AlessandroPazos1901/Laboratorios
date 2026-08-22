"use client";

import {
  Activity, ArrowDown, ArrowLeft, ArrowUp, BarChart3, CalendarDays, Check, ChevronRight, CircleAlert,
  ClipboardList, Database, FileClock, FileDown, FlaskConical,
  GripVertical, Import, KeyRound, LogOut, Menu, Microscope, PanelLeftClose, PanelLeftOpen, Pencil, Plus, Search,
  Settings, ShieldCheck, SlidersHorizontal, TestTube2, Trash2, UserRound, Users, X,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { buildPickerGroups } from "@/lib/catalog-presets";
import { analysisBelongsToCatalogGroup, buildCatalogGroupOptions, catalogSubsectionDeleteRequest, catalogSubsectionRenameRequest } from "@/lib/catalog-groups";
import { biochemistryFormulaKey, flagNumericResult, formatNumericResult, formatPatientAgeAt, groupResultsByBatch, isCalculatedAnalysisResult, linkedBiochemistryValues, linkedHematologyValues, resultFlagFor, type BiochemistryFormulaKey } from "@/lib/clinical";
import {
  buildResultPresentationRows, displayResultNumber, entryFullFigure, formatDisplayReference, formatDisplayUnit,
  formatResultReference, formatResultUnit, resultEntryValue, resultStorageValue,
} from "@/lib/result-presentation";
import {
  ageColumns, AGE_BRACKETS, analysisKey, buildCountMatrix, countSheet, dayColumns, detailSheet,
  groupColor, matchesAgeRange, patientYears, tintedColor, transposedCountSheet,
  type AgeBasis, type SheetData,
} from "@/lib/analytics-report";
import { createClient, isSupabaseConfigured } from "@/lib/supabase/client";
import { useOfflineRepository, type OfflineRepository } from "@/lib/offline/repository";
import { probeServerConnectivity } from "@/lib/offline/connectivity";
import { reportViewsForGroup, resultsInView, type ReportView } from "@/lib/report-views";
import type { CatalogOperation } from "@/lib/catalog-operations";
import type { AnalysisDefinition, CatalogGroup, CatalogSubsection, LabData, LabOrder, ResultValue } from "@/lib/types";

type View = "trabajo" | "pacientes" | "analitica" | "catalogo" | "configuracion";
const nav: { id: View; label: string; icon: typeof Activity }[] = [
  { id: "analitica", label: "Analítica", icon: BarChart3 },
  { id: "trabajo", label: "Resultados", icon: ClipboardList },
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
function resultGroupEmoji(group: string) {
  const normalizedGroup = normalizePatientLookup(group);
  if (normalizedGroup.includes("hemat")) return "🩸";
  if (normalizedGroup.includes("bioquim")) return "🧪";
  if (normalizedGroup.includes("inmun")) return "🛡️";
  if (normalizedGroup.includes("uro")) return "💧";
  if (normalizedGroup.includes("secrecion")) return "🧫";
  if (normalizedGroup.includes("parasit") || normalizedGroup.includes("heces")) return "🔬";
  return "🔬";
}
function preparePdfWindow() {
  const preview = window.open("", "_blank");
  if (!preview) return null;
  preview.document.title = "Preparando informe";
  preview.document.body.textContent = "Generando el informe PDF…";
  preview.document.body.style.cssText = "margin:0;min-height:100vh;display:grid;place-items:center;font:700 22px Arial,sans-serif;color:#153f46;background:#f4fafb";
  return preview;
}

function closePdfWindow(preview: Window | null) {
  if (preview && !preview.closed) preview.close();
}

function showPdf(blob: Blob, preview: Window | null, fileName: string) {
  const reportUrl = URL.createObjectURL(blob);
  if (preview && !preview.closed) {
    preview.opener = null;
    preview.location.replace(reportUrl);
    window.setTimeout(() => URL.revokeObjectURL(reportUrl), 5 * 60_000);
    return true;
  }
  const link = document.createElement("a");
  link.href = reportUrl;
  link.download = fileName;
  link.hidden = true;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(reportUrl), 30_000);
  return false;
}

export function LabApp({ data, currentUser }: { data: LabData; currentUser?: { fullName: string; role: string } }) {
  const router = useRouter();
  const sourcePatients = data.patients;
  const sourceAnalyses = data.analyses;
  const [view, setView] = useState<View>("analitica");
  const sourceOrders = data.orders;
  const [orderOverrides, setOrderOverrides] = useState<Record<string, LabOrder>>({});
  const orders = sourceOrders.map((order) => orderOverrides[order.id] ?? order);
  const [selectedId, setSelectedId] = useState("");
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(true);
  const [notice, setNotice] = useState("");
  const [newRecordOpen, setNewRecordOpen] = useState(false);
  const [newRecordAt, setNewRecordAt] = useState("");
  // Con réplica local manda el estado del motor de sincronización: tener dos
  // sondas distintas hacía que la insignia y el envío se contradijeran.
  const connectivity = useOfflineRepository();
  const [probedOnline, setProbedOnline] = useState(true);
  const online = connectivity ? connectivity.online : probedOnline;

  useEffect(() => {
    if (connectivity) return;
    let mounted = true;
    const updateConnection = async () => {
      const reachable = await probeServerConnectivity();
      if (mounted) setProbedOnline(reachable);
    };
    void updateConnection();
    window.addEventListener("online", updateConnection);
    window.addEventListener("offline", updateConnection);
    return () => {
      mounted = false;
      window.removeEventListener("online", updateConnection);
      window.removeEventListener("offline", updateConnection);
    };
  }, [connectivity]);

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
          /> : <WorkQueue orders={orders} analyses={sourceAnalyses} selectedId={selectedId} setSelectedId={setSelectedId} updateOrder={updateOrder} notify={setNotice} openNewRecord={openNewRecord} />)}
          {view === "pacientes" && <PatientsView patients={sourcePatients} orders={orders} openOrder={openOrder} notify={setNotice} />}
          {view === "analitica" && <AnalyticsView orders={orders} analyses={sourceAnalyses} openOrder={openOrder} />}
          {/* Sin key: remontar la vista en cada cambio perdía el grupo abierto y
              obligaba a volver a navegar hasta él para editar el siguiente análisis. */}
          {view === "catalogo" && <CatalogView analyses={sourceAnalyses} catalogGroups={data.catalogGroups ?? []} subsections={data.catalogSubsections ?? []} />}
          {view === "configuracion" && <SettingsView analysts={data.analysts ?? []} />}
        </main>
      </div>
    </div>
  );
}

function PageHead({ eyebrow, title, text, action, compact = false }: { eyebrow: string; title: string; text: string; action?: React.ReactNode; compact?: boolean }) {
  return <div className={compact ? "page-head compact" : "page-head"}><div><p className="eyebrow">{eyebrow}</p><h1>{title}</h1><p>{text}</p></div>{action}</div>;
}

function rpcMessage(message: string) {
  if (message.includes("register_daily_analyses")) return "El sistema necesita una actualización. Comunícate con el administrador.";
  if (message.includes("invalid_dni")) return "El DNI debe tener exactamente 8 dígitos.";
  if (message.includes("patient_name_required")) return "Ingresa el nombre completo del paciente.";
  if (message.includes("analyses_required")) return "Selecciona al menos un análisis.";
  if (message.includes("analyst_required")) return "Selecciona quién realizó el análisis.";
  if (message.includes("analyst_inactive_or_missing")) return "El analista seleccionado ya no está activo. Elige otro.";
  if (message.includes("numeric_precision_exceeded")) return "El resultado tiene más decimales de los permitidos para ese análisis.";
  if (message.includes("concurrent_change")) return "Otro usuario modificó este registro. Recarga para continuar.";
  if (message.includes("missing_revision")) return "No se encontró la revisión activa. Recarga la página.";
  if (message.includes("all_results_required")) return "Completa todos los resultados antes de imprimir.";
  if (message.includes("all_group_results_required")) return "Completa todos los resultados de este grupo antes de imprimir.";
  if (message.includes("all_batch_results_required")) return "Completa todos los resultados de esta tanda antes de imprimir.";
  if (message.includes("reason_required")) return "Escribe un motivo de al menos 5 caracteres.";
  if (message.includes("reference_range_required")) return "Define al menos un intervalo de referencia antes de activar el análisis.";
  if (message.includes("qualitative_options_required")) return "Agrega las opciones válidas del resultado cualitativo.";
  if (message.includes("sample_type_required")) return "Indica el tipo de muestra.";
  if (message.includes("invalid_birth_date")) return "La fecha y hora de nacimiento no es válida.";
  if (message.includes("invalid_patient_sex")) return "Selecciona el sexo del paciente.";
  if (message.includes("update_patient_details")) return "El sistema necesita una actualización. Comunícate con el administrador.";
  if (message.includes("owner_required")) return "Solo una cuenta administradora puede aprobar el catálogo.";
  return "No se pudo completar la operación. Intenta nuevamente.";
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
      const sourceKey = analysis.resultType === "numeric" ? biochemistryFormulaKey(analysis.code, analysis.name) : null;
      if (sourceKey) {
        const currentBiochemistry = Object.fromEntries(allAnalyses.flatMap((candidate) => {
          const key = biochemistryFormulaKey(candidate.code, candidate.name);
          return key ? [[key, next[candidate.versionId] ?? ""]] : [];
        })) as Partial<Record<BiochemistryFormulaKey, string>>;
        const calculated = linkedBiochemistryValues(sourceKey, sanitized, currentBiochemistry);
        allAnalyses.forEach((candidate) => {
          const key = biochemistryFormulaKey(candidate.code, candidate.name);
          if (key && calculated[key] !== undefined) next[candidate.versionId] = calculated[key];
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
          entries: completedAnalyses.map((analysis) => ({
            analysis,
            value: analysis.resultType === "numeric"
              ? resultStorageValue(resultValues[analysis.versionId], analysis.code)
              : resultValues[analysis.versionId],
          })),
        });
      } else {
        const orderResult = await createClient().rpc("register_daily_analyses", {
          target_patient: patientId,
          occurred_at: new Date(occurredAt).toISOString(),
          result_entries: completedAnalyses.map((analysis) => ({
            analysis_version_id: analysis.versionId,
            analyst_id: analyst.id,
            payload: analysis.resultType === "numeric"
              ? { numeric_value: Number(resultStorageValue(resultValues[analysis.versionId], analysis.code)) }
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
      notify(offlineRepository?.enabled ? "Análisis guardados en este equipo. Se enviarán cuando haya internet." : "Análisis y resultados guardados en la orden diaria.");
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
            {currentAnalyses.map((analysis) => { const rawValue = resultValues[analysis.versionId] ?? ""; const storedValue = resultStorageValue(rawValue, analysis.code); const numericValue = Number(storedValue); const previewFlag = analysis.resultType === "numeric" && rawValue.trim() && Number.isFinite(numericValue) ? flagNumericResult(numericValue, analysis) : "normal"; const calculatedResult = isCalculatedAnalysisResult(analysis.code, analysis.name, analysis.group); const fullFigure = analysis.resultType === "numeric" ? entryFullFigure(storedValue, analysis.unit, analysis.code) : ""; return <div key={analysis.versionId} className={`direct-result-row ${rawValue.trim() ? "completed" : ""} ${previewFlag !== "normal" ? "outside-range" : ""} ${calculatedResult ? "calculated" : ""}`}>
              <label htmlFor={`direct-result-${analysis.versionId}`}><strong>{analysis.name}</strong><small>{analysis.subsection ?? analysis.code}</small></label>
              <div className="direct-result-control">
                {analysis.qualitativeOptions?.length
                  ? <ResultChoiceField id={`direct-result-${analysis.versionId}`} className="direct-result-input" value={rawValue} options={analysis.qualitativeOptions} onChange={(value) => changeAnalysisResult(analysis, value)} label={`Resultado de ${analysis.name}`} />
                  : <input id={`direct-result-${analysis.versionId}`} className="direct-result-input" value={rawValue} disabled={calculatedResult} inputMode={analysis.resultType === "numeric" ? "decimal" : "text"} onChange={(event) => changeAnalysisResult(analysis, event.target.value)} placeholder="—" aria-label={`Resultado de ${analysis.name}`} autoComplete="off" />}
                {fullFigure && <small className="entry-full-figure">= {fullFigure}</small>}
                {previewFlag !== "normal" && <small className={`inline-range-warning ${previewFlag}`}><CircleAlert />Fuera de rango</small>}
              </div>
              <div className="direct-result-meta"><span>{formatResultUnit(analysis.unit, analysis.code) || "Sin unidad"}</span><small>{analysis.reference ? formatResultReference(analysis.reference, analysis.unit, analysis.code) : "Sin referencia"}</small></div>
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
    <tbody>{orders.length ? orders.map((order) => <tr key={order.id} onClick={() => onSelect(order.id)} tabIndex={0}><td className="mono strong">{order.code}</td><td><strong>{order.patientName}</strong><small className="block mono">DNI {order.documentNumber}</small></td><td>{order.groups.join(" · ") || "Sin análisis"}</td><td>{fmtDate(order.createdAt)}</td><td>{order.responsible}</td><td><ChevronRight /></td></tr>) : <tr><td colSpan={6}><div className="empty small"><ClipboardList /><p>No hay órdenes registradas.</p></div></td></tr>}</tbody>
  </table></div>;
}

function OrderPickRow({ order, detail, onSelect }: { order: LabOrder; detail: string; onSelect: () => void }) {
  return <button type="button" onClick={onSelect}>
    <span className="avatar patient">{order.patientName.split(" ").slice(0, 2).map((part) => part[0]).join("")}</span>
    <span><strong>{order.patientName}</strong><small>DNI {order.documentNumber} · {detail}</small></span>
    <ChevronRight />
  </button>;
}

function WorkQueue({ orders, analyses, selectedId, setSelectedId, updateOrder, notify, openNewRecord }: { orders: LabOrder[]; analyses: AnalysisDefinition[]; selectedId: string; setSelectedId: (id: string) => void; updateOrder: (o: LabOrder) => void; notify: (s: string) => void; openNewRecord: () => void }) {
  const selected = orders.find((o) => o.id === selectedId) ?? null;
  const [search, setSearch] = useState("");
  const matches = useMemo(() => {
    const value = normalizePatientLookup(search.trim());
    if (value.length < 2) return [];
    return orders
      .filter((order) => normalizePatientLookup(`${order.code} ${order.patientName} ${order.documentNumber}`).includes(value))
      .slice(0, 12);
  }, [orders, search]);
  // Sin buscar, la jornada en curso: es lo que el analista tiene entre manos.
  const today = useMemo(() => {
    const day = new Date().toDateString();
    return orders.filter((order) => new Date(order.createdAt).toDateString() === day);
  }, [orders]);
  const recent = today.length ? today : orders.slice(0, 8);
  const searching = search.trim().length >= 2;

  // Una cosa a la vez: o se elige el registro, o se trabaja en él. Nunca ambos.
  if (selected) {
    return <>
      <button className="back-action result-back" type="button" onClick={() => setSelectedId("")}><ArrowLeft />Volver a la búsqueda</button>
      <ResultWorkspace key={`${selected.id}:${selected.results.map((result) => result.orderAnalysisId).join(",")}`} order={selected} analyses={analyses} updateOrder={updateOrder} notify={notify} />
    </>;
  }

  return <>
    <PageHead compact eyebrow="Operación" title="Resultados" text="Busca al paciente por DNI o nombre, o elígelo de la lista." action={<button className="button primary" onClick={openNewRecord}><Plus />Nuevo análisis</button>} />
    <div className="result-finder">
      <div className="compact-search"><Search /><input autoFocus value={search} onChange={(event) => setSearch(event.target.value)} placeholder="DNI o nombre del paciente" aria-label="Buscar resultados por DNI o nombre del paciente" /></div>
      {searching
        ? <div className="patient-search-results">
          {matches.length
            ? matches.map((order) => <OrderPickRow key={order.id} order={order} detail={fmtDate(order.createdAt)} onSelect={() => { setSelectedId(order.id); setSearch(""); }} />)
            : <p className="finder-empty">Sin coincidencias para “{search.trim()}”.</p>}
        </div>
        : recent.length > 0 && <div className="result-recent">
          <h3>{today.length ? "Registros de hoy" : "Últimos registros"}</h3>
          <div className="patient-search-results">
            {recent.map((order) => <OrderPickRow key={order.id} order={order} detail={today.length ? new Date(order.createdAt).toLocaleTimeString("es-PE", { hour: "2-digit", minute: "2-digit" }) : fmtDate(order.createdAt)} onSelect={() => setSelectedId(order.id)} />)}
          </div>
        </div>}
    </div>
    {!searching && recent.length === 0 && <section className="panel"><div className="empty"><Microscope /><h3>Todavía no hay registros</h3><p>Crea el primero con el botón “Nuevo análisis”.</p></div></section>}
  </>;
}

function ResultWorkspace({ order, analyses, updateOrder, notify }: { order: LabOrder; analyses: AnalysisDefinition[]; updateOrder: (o: LabOrder) => void; notify: (s: string) => void }) {
  const offlineRepository = useOfflineRepository();
  const [draft, setDraft] = useState(order.results);
  const [saving, setSaving] = useState(false);
  const [printing, setPrinting] = useState(false);
  const [editingResultId, setEditingResultId] = useState<string | null>(null);
  const [editingValue, setEditingValue] = useState("");
  const resultBatches = useMemo(() => groupResultsByBatch(draft, order.createdAt), [draft, order.createdAt]);
  const [selectedBatchId, setSelectedBatchId] = useState(resultBatches[0]?.batchId ?? "");
  const activeBatch = resultBatches.find((item) => item.batchId === selectedBatchId) ?? resultBatches[0];
  const [printResultIds, setPrintResultIds] = useState<Set<string>>(() => new Set(resultBatches[0]?.results.map((result) => result.orderAnalysisId) ?? []));
  const orderedBatchResults = useMemo(() => {
    if (!activeBatch) return [];
    const orderedVersions = buildPickerGroups(analyses).flatMap((group) => group.items.map((analysis) => analysis.versionId));
    const rankByVersion = new Map(orderedVersions.map((versionId, index) => [versionId, index]));
    return [...activeBatch.results].sort((left, right) => {
      const leftRank = left.analysisVersionId ? rankByVersion.get(left.analysisVersionId) : undefined;
      const rightRank = right.analysisVersionId ? rankByVersion.get(right.analysisVersionId) : undefined;
      return (leftRank ?? Number.MAX_SAFE_INTEGER) - (rightRank ?? Number.MAX_SAFE_INTEGER)
        || left.analyte.localeCompare(right.analyte, "es");
    });
  }, [activeBatch, analyses]);
  // El subgrupo del catálogo hace falta dos veces: para titular el informe y
  // para que las vistas de impresión filtren por lo mismo que se muestra.
  const enrichedResults = useMemo(() => {
    const analysisByVersion = new Map(analyses.map((analysis) => [analysis.versionId, analysis]));
    return orderedBatchResults.map((result) => ({
      ...result,
      analysis: result.analyte,
      subsection: result.analysisVersionId ? analysisByVersion.get(result.analysisVersionId)?.subsection : undefined,
    }));
  }, [analyses, orderedBatchResults]);
  const presentationRows = useMemo(() => buildResultPresentationRows(enrichedResults), [enrichedResults]);
  const batchViews = useMemo(() => activeBatch ? reportViewsForGroup(activeBatch.group) : [], [activeBatch]);
  const [activeViewId, setActiveViewId] = useState<string | null>(null);
  const activeView = batchViews.find((view) => view.id === activeViewId) ?? null;
  const activeBatchAnalysts = useMemo(() => [...new Set(activeBatch?.results.map((result) => result.performedBy).filter(Boolean) ?? [])], [activeBatch]);
  // En pantalla la edad es la de hoy; el PDF conserva la que tenía al tomar la muestra.
  const currentAge = order.patientBirthDate
    ? formatPatientAgeAt(order.patientBirthDate, new Date().toISOString())
    : "Edad no registrada";
  const critical = activeBatch?.results.some((result) => resultFlagFor(result) === "critical") ?? false;
  const allActiveResultsSelected = Boolean(activeBatch?.results.length) && activeBatch.results.every((result) => printResultIds.has(result.orderAnalysisId));

  function changeResult(id: string, value: string) {
    setDraft((results) => {
      const source = results.find((result) => result.id === id);
      if (!source) return results;
      const entryValue = sanitizeResultInput(source.resultType, value);
      const sanitized = source.resultType === "numeric"
        ? resultStorageValue(entryValue, source.analysisCode)
        : entryValue;
      const linked = source.resultType === "numeric" && source.analysisCode
        ? linkedHematologyValues(source.analysisCode, sanitized)
        : null;
      const sourceBiochemistryKey = source.resultType === "numeric"
        ? biochemistryFormulaKey(source.analysisCode ?? "", source.analyte)
        : null;
      const currentBiochemistry = Object.fromEntries(results.flatMap((result) => {
        const key = biochemistryFormulaKey(result.analysisCode ?? "", result.analyte);
        return key && result.batchId === source.batchId ? [[key, result.id === id ? sanitized : result.value]] : [];
      })) as Partial<Record<BiochemistryFormulaKey, string>>;
      const linkedBiochemistry = sourceBiochemistryKey
        ? linkedBiochemistryValues(sourceBiochemistryKey, sanitized, currentBiochemistry)
        : null;
      return results.map((result) => {
        let nextValue = result.id === id ? sanitized : result.value;
        if (linked && result.batchId === source.batchId && result.analysisCode) {
          nextValue = linked[result.analysisCode as keyof typeof linked] ?? nextValue;
        }
        if (linkedBiochemistry && result.batchId === source.batchId) {
          const key = biochemistryFormulaKey(result.analysisCode ?? "", result.analyte);
          if (key && linkedBiochemistry[key] !== undefined) nextValue = linkedBiochemistry[key];
        }
        if (nextValue === result.value) return result;
        if (result.resultType !== "numeric") return { ...result, value: nextValue };
        const numericValue = Number(nextValue);
        const next = { ...result, value: nextValue, numericValue, flag: "normal" as const };
        return { ...next, flag: resultFlagFor(next) };
      });
    });
  }

  function startEditing(result: ResultValue) {
    if (editingResultId === result.orderAnalysisId) {
      setEditingResultId(null);
      setEditingValue("");
      return;
    }
    setEditingResultId(result.orderAnalysisId);
    setEditingValue(result.resultType === "numeric"
      ? resultEntryValue(result.value, result.analysisCode)
      : result.value);
  }

  function changeEditingResult(result: ResultValue, value: string) {
    const sanitized = sanitizeResultInput(result.resultType, value);
    setEditingValue(sanitized);
    changeResult(result.id, sanitized);
  }

  async function save() {
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

    if (!entries.length) {
      setEditingResultId(null);
      setSaving(false);
      return order.lockVersion;
    }

    if (offlineRepository) {
      try {
        const saved = await offlineRepository.saveResults(order, savedResults);
        setDraft(saved.results);
        updateOrder({ ...order, results: saved.results, lockVersion: saved.lockVersion, syncState: offlineRepository.enabled ? "pending" : order.syncState });
        setEditingResultId(null);
        setSaving(false);
        notify(offlineRepository.enabled ? "Resultados guardados en este equipo. Se enviarán cuando haya internet." : "Resultados guardados.");
        return saved.lockVersion;
      } catch (reason) {
        setSaving(false);
        notify(rpcMessage(reason instanceof Error ? reason.message : "save_failed"));
        return null;
      }
    }

    // Solo esta llamada necesita la revisión del servidor. Una orden registrada
    // sin internet todavía no la tiene, y la ruta offline no la usa.
    if (!order.revisionId) {
      setSaving(false);
      notify("No se encontró la revisión activa. Recarga la página.");
      return null;
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
      if (!persisted?.id) return;
      // La base solo marca si tiene intervalos cargados; su "normal" no confirma
      // nada, así que no puede borrar el fuera de rango que ya calculamos aquí.
      const serverFlag = persisted.flag ?? "normal";
      savedResults[index] = { ...result, id: persisted.id, flag: serverFlag === "normal" ? result.flag : serverFlag };
    });
    const lockVersion = saved.lock_version;

    setDraft(savedResults);
    updateOrder({ ...order, results: savedResults, lockVersion });
    setEditingResultId(null);
    setSaving(false);
    notify("Resultados guardados.");
    return lockVersion;
  }

  function selectResultBatch(batchId: string, resultIds: string[]) {
    setSelectedBatchId(batchId);
    setPrintResultIds(new Set(resultIds));
    setActiveViewId(null);
  }

  function selectReportView(view: ReportView | null) {
    setActiveViewId(view?.id ?? null);
    if (!view) return setPrintResultIds(new Set(enrichedResults.map((result) => result.orderAnalysisId)));
    const matched = resultsInView(view, enrichedResults);
    setPrintResultIds(new Set(matched.map((result) => result.orderAnalysisId)));
    if (!matched.length) notify(`No hay análisis registrados para ${view.label} en esta tanda.`);
  }

  function togglePrintResult(resultId: string) {
    setPrintResultIds((current) => {
      const next = new Set(current);
      if (next.has(resultId)) next.delete(resultId);
      else next.add(resultId);
      return next;
    });
  }

  async function printReport(includedResultIds: string[], title?: string) {
    if (!activeBatch || !includedResultIds.length || printing || saving) return;
    // Open while the click still has user activation. Navigating a window after
    // awaiting save/PDF generation works in installed PWAs and offline tabs.
    const preview = preparePdfWindow();
    setPrinting(true);
    try {
      const lockVersion = await save();
      if (lockVersion === null) {
        closePdfWindow(preview);
        return;
      }
      let report: Blob;
      if (offlineRepository?.enabled) {
        const blob = await offlineRepository.buildOfflineReport(
          { ...order, results: draft, lockVersion },
          activeBatch.batchId,
          includedResultIds,
          title,
        );
        if (!blob) throw new Error("offline_report_unavailable");
        report = blob;
      } else {
        const legacyBatch = activeBatch.batchId.startsWith("legacy:");
        const reportResponse = await fetch(`/api/reports/${order.id}`, {
          method: "POST",
          cache: "no-store",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            ...(legacyBatch ? { group: activeBatch.group } : { batchId: activeBatch.batchId }),
            resultIds: includedResultIds,
            title,
          }),
        });
        if (!reportResponse.ok) {
          const error = await reportResponse.json().catch(() => null) as { error?: string } | null;
          closePdfWindow(preview);
          notify(error?.error ? rpcMessage(error.error) : "No se pudo generar el informe. El registro sigue editable.");
          return;
        }
        report = await reportResponse.blob();
      }
      const safeCode = order.code.replace(/[^a-zA-Z0-9-]+/g, "-").toLowerCase();
      const opened = showPdf(report, preview, `informe-${safeCode}.pdf`);
      notify(opened
        ? "Informe abierto. Usa el botón de imprimir del visor PDF."
        : "El navegador bloqueó la ventana; el informe se descargó como PDF.");
    } catch {
      setSaving(false);
      closePdfWindow(preview);
      notify("No se pudo generar el informe PDF.");
    } finally {
      setPrinting(false);
    }
  }

  return <section className="panel result-workspace">
    <div className="patient-strip patient-summary">
      <div className="patient-identity">
        <span className="avatar patient large">{order.patientName.split(" ").slice(0, 2).map((part) => part[0]).join("")}</span>
        <span>
          <strong>{order.patientName}</strong>
          <em className="mono">DNI {order.documentNumber}</em>
        </span>
      </div>
      <dl className="patient-vitals">
        <div className="age-data"><dt>Edad</dt><dd>{currentAge}</dd></div>
        <div><dt>Nacimiento</dt><dd>{fmtBirthDate(order.patientBirthDate)}</dd></div>
        <div><dt>Sexo</dt><dd>{sexLabel[order.patientSex]}</dd></div>
      </dl>
      <div className="patient-order-context"><span>Registro</span><strong className="mono">{order.code}</strong><small><CalendarDays />{fmtDate(order.createdAt)}</small></div>
    </div>
    {order.results.length === 0 ? <div className="empty"><Microscope /><h3>Este registro no tiene análisis</h3><p>Crea un nuevo registro seleccionando al menos un análisis.</p></div> : <>
      <div className="result-toolbar"><div><h2>Resultados por registro</h2><p>{draft.length} análisis · {resultBatches.length} tandas ordenadas por fecha</p></div>{activeBatchAnalysts.length > 0 && <span className="result-toolbar-analyst"><span>Realizado por <strong>{activeBatchAnalysts.join(" · ")}</strong></span></span>}</div>
      <nav className="result-group-menu" aria-label="Tandas realizadas">{resultBatches.map((item) => <button type="button" key={item.batchId} className={item.batchId === activeBatch?.batchId ? "active" : ""} onClick={() => selectResultBatch(item.batchId, item.results.map((result) => result.orderAnalysisId))}>
        <span><strong><span className="result-group-emoji" aria-hidden="true">{resultGroupEmoji(item.group)}</span>{item.group}</strong><small>{fmtDate(item.registeredAt)}</small></span><b>{item.results.length}</b>
      </button>)}</nav>
      {activeBatch && <div className="result-groups"><section className="result-group" aria-labelledby="active-result-group">
        <div className="result-group-head"><div><span>Tanda registrada · {fmtDate(activeBatch.registeredAt)}</span><h3 id="active-result-group"><span className="result-group-emoji" aria-hidden="true">{resultGroupEmoji(activeBatch.group)}</span>{activeBatch.group}</h3></div><button className="button secondary" onClick={() => void printReport([...printResultIds], activeView?.label)} disabled={saving || printing || !printResultIds.size} aria-busy={printing}>{printing ? <><span className="button-spinner" aria-hidden="true" />Generando informe…</> : `Imprimir seleccionados (${printResultIds.size})`}</button></div>
        {batchViews.length > 0 && <div className="report-view-picker">
          <span>Informe a imprimir</span>
          <div role="group" aria-label="Vista del informe">
            {batchViews.map((view) => <button type="button" key={view.id} className={view.id === activeViewId ? "active" : ""} aria-pressed={view.id === activeViewId} onClick={() => selectReportView(view)}>{view.label}</button>)}
            <button type="button" className={activeViewId === null ? "active" : ""} aria-pressed={activeViewId === null} onClick={() => selectReportView(null)}>Todo</button>
          </div>
          <small>{activeView
            ? `El informe se titulará «${activeView.label}». Puedes ajustar las casillas antes de imprimir.`
            : "Elige un informe para marcar sus análisis, o ajusta las casillas a mano."}</small>
        </div>}
        <div className="clinical-results-wrap"><table className="clinical-results-table">
          <thead><tr><th className="clinical-result-select"><input type="checkbox" checked={allActiveResultsSelected} onChange={() => setPrintResultIds(allActiveResultsSelected ? new Set() : new Set(activeBatch.results.map((result) => result.orderAnalysisId)))} aria-label={allActiveResultsSelected ? "No incluir ningún análisis en el informe" : "Incluir todos los análisis en el informe"} title="Seleccionar todos para imprimir" /></th><th>Examen</th><th>Resultado</th><th>Unidad</th><th>Valores normales</th><th aria-label="Acciones" /></tr></thead>
          <tbody>{presentationRows.map((row, index) => {
            if (row.kind === "section") return <tr className="clinical-section-row" key={`section-${row.label}-${index}`}><th colSpan={6}>{row.label}</th></tr>;
            const result = row.result;
            const editing = editingResultId === result.orderAnalysisId;
            const calculatedResult = isCalculatedAnalysisResult(result.analysisCode ?? "", result.analyte, result.group);
            const flag = resultFlagFor(result);
            const alertLabel = flag === "low" ? "Bajo" : flag === "high" ? "Alto" : flag === "critical" ? "Crítico" : null;
            return <tr key={result.orderAnalysisId} className={`clinical-result-row ${flag} ${editing ? "editing" : ""}`}>
              <td className="clinical-result-select"><input type="checkbox" checked={printResultIds.has(result.orderAnalysisId)} onChange={() => togglePrintResult(result.orderAnalysisId)} aria-label={`${printResultIds.has(result.orderAnalysisId) ? "Excluir" : "Incluir"} ${result.analyte} del informe`} /></td>
              <td className="clinical-result-name" style={{ paddingLeft: `${14 + row.indent * 18}px` }}><strong>{result.analyte}</strong></td>
              <td className="clinical-result-value">{editing
                ? result.qualitativeOptions?.length
                  ? <ResultChoiceField id={result.id} className={`result-input ${flag}`} value={editingValue} options={result.qualitativeOptions} onChange={(value) => changeEditingResult(result, value)} label={`Resultado de ${result.analyte}`} />
                  : <><input autoFocus className={`result-input ${flag}`} value={editingValue} inputMode={result.resultType === "numeric" ? "decimal" : undefined} onChange={(event) => changeEditingResult(result, event.target.value)} aria-label={`Resultado de ${result.analyte}`} />{entryFullFigure(result.value, result.unit, result.analysisCode) && <small className="entry-full-figure">= {entryFullFigure(result.value, result.unit, result.analysisCode)}</small>}{alertLabel && <small className={`inline-range-warning ${flag}`}><CircleAlert />{flag === "critical" ? "Valor crítico" : "Fuera de rango"}</small>}</>
                : <span className="clinical-result-reading"><strong>{result.resultType === "numeric" ? formatNumericResult(result.value, result.unit) : result.value}</strong>{alertLabel && <small className="clinical-result-alert">{alertLabel}</small>}</span>}</td>
              <td className="clinical-result-unit">{formatDisplayUnit(result.unit) || ""}</td>
              <td className="clinical-result-reference">{result.reference ? formatDisplayReference(result.reference, result.unit) : ""}</td>
              <td className="clinical-result-action">{!calculatedResult && <button type="button" className={editing ? "result-edit-button active" : "result-edit-button"} onClick={() => startEditing(result)} aria-pressed={editing}>{editing ? "Listo" : "Editar"}</button>}</td>
            </tr>;
          })}</tbody>
        </table></div>
      </section></div>}
      {critical && <div className="critical-notice"><span><strong>Hay un valor crítico</strong><small>Revísalo antes de imprimir. Esta advertencia no bloquea el registro.</small></span></div>}
      <div className="action-bar"><span>Los resultados pueden editarse cuando sea necesario.</span><div><button className="button primary" onClick={save} disabled={saving}>{saving ? "Guardando…" : "Guardar resultados"}</button></div></div>
    </>}
  </section>;
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
      notify(offlineRepository?.enabled ? "Paciente guardado en este equipo. Se enviará cuando haya internet." : "Paciente agregado correctamente.");
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
    if (!offlineRepository?.enabled) return setError("Este equipo aún no tiene su copia local. Conéctalo a internet e inicia sesión una vez.");
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
    if (!offlineRepository?.enabled || !file || !activeSheet) return setError("Primero inicia sesión para abrir los datos de este equipo.");
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
      notify(`${data.imported.toLocaleString("es-PE")} pacientes disponibles para buscar con o sin internet.`);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "No se pudieron guardar los pacientes en este equipo.");
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
      <div className="import-dialog-head"><div><p className="eyebrow">Pacientes disponibles</p><h2 id="import-patients-title">Cargar archivo de pacientes</h2><p>El archivo se prepara y queda guardado solamente en esta computadora.</p></div><button className="icon-button" type="button" onClick={close} aria-label="Cerrar" disabled={loading}><X /></button></div>
      <div className="import-steps" aria-label="Progreso"><span className={step >= 1 ? "active" : ""}><b>1</b>Archivo</span><span className={step >= 2 ? "active" : ""}><b>2</b>Columnas</span><span className={step >= 3 ? "active" : ""}><b>3</b>Finalizado</span></div>
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
          <p className="compat-note"><ShieldCheck />Estos pacientes podrán buscarse con o sin internet. Al registrar un análisis, sus datos se enviarán cuando haya conexión.</p>
          {loading && progress && <div className="roster-import-progress"><div><i style={{ width: `${percent}%` }} /></div>{progress.phase === "activating" ? <p><strong>Terminando de preparar los pacientes…</strong> Este último paso puede tardar unos segundos.</p> : <p><strong>{percent}%</strong> · {progress.processed.toLocaleString("es-PE")} de {progress.total.toLocaleString("es-PE")} filas · {progress.imported.toLocaleString("es-PE")} únicas</p>}</div>}
        </>}
        {result && <div className="import-result"><span className="import-result-icon"><Check /></span><h3>Pacientes preparados</h3><p>{result.imported.toLocaleString("es-PE")} pacientes únicos ya se pueden buscar con o sin internet.</p><div><span><strong>{result.total.toLocaleString("es-PE")}</strong> revisados</span><span><strong>{result.failed.toLocaleString("es-PE")}</strong> filas inválidas</span><span><strong>{result.duplicates.toLocaleString("es-PE")}</strong> duplicados ignorados</span></div>{result.failures.length > 0 && <div className="import-failures"><strong>Filas inválidas que requieren revisión</strong>{result.failures.slice(0, 8).map((failure) => <p key={`${failure.row}-${failure.reason}`}><b>Fila {failure.row}</b>{failure.reason}</p>)}</div>}</div>}
        {error && <p className="form-error" role="alert">{error}</p>}
      </div>
      <div className="import-dialog-actions"><span>{preview && !result ? "Comprueba las cuatro columnas antes de guardar los pacientes." : "El archivo completo permanece únicamente en este equipo."}</span><div><button className="button secondary" type="button" onClick={close} disabled={loading}>{result ? "Cerrar" : "Cancelar"}</button>{preview && !result && <button className="button primary" type="button" disabled={loading || !validMapping} onClick={importPatients}>{loading ? progress?.phase === "activating" ? "Terminando…" : `Preparando ${percent}%` : "Guardar pacientes"}</button>}</div></div>
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
      notify(offlineRepository?.enabled ? "Paciente actualizado en este equipo. El cambio se enviará cuando haya internet." : "Datos del paciente actualizados.");
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

// Con el padrón importado la tabla puede tener miles de filas; se recorta.
const PATIENT_TABLE_LIMIT = 50;

function PatientsView({ patients, orders, openOrder, notify }: { patients: LabData["patients"]; orders: LabOrder[]; openOrder: (id: string) => void; notify: (message: string) => void }) {
  const offlineRepository = useOfflineRepository();
  const [selectedId, setSelectedId] = useState<number | null>(null);
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
  // Se busca en el padrón completo: cambiar el texto no debe cerrar la ficha abierta.
  const selected = selectedId === null ? null : patients.find((patient) => patient.id === selectedId) ?? null;
  const lastOrderOf = useMemo(() => {
    const latest = new Map<number, LabOrder>();
    orders.forEach((order) => {
      const current = latest.get(order.patientId);
      if (!current || order.createdAt > current.createdAt) latest.set(order.patientId, order);
    });
    return latest;
  }, [orders]);
  const localRosterLocked = Boolean(offlineRepository && !offlineRepository.enabled);
  const patientActions = <div className="patient-page-actions"><button className="button secondary" disabled={localRosterLocked} title={localRosterLocked ? "Este equipo aún no tiene su copia local: conéctalo a internet e inicia sesión una vez" : "Cargar o reemplazar el archivo de pacientes de este equipo"} onClick={() => setImporting(true)}><Database />Cargar pacientes</button><button className="button primary" onClick={() => setAdding(true)}><Plus />Agregar paciente</button></div>;
  const dialogs = <>
    {adding && <AddPatientDialog close={() => setAdding(false)} notify={notify} />}
    {importing && <PatientImportDialog close={() => setImporting(false)} notify={notify} />}
  </>;

  if (!patients.length) return <><PageHead eyebrow="Registro maestro" title="Pacientes" text="Identidad única e historial de análisis." action={patientActions} /><article className="panel"><div className="empty"><Users /><h3>No hay pacientes registrados</h3><p>Agrega el primer paciente por DNI para comenzar.</p><button className="button primary" onClick={() => setAdding(true)}>Agregar paciente</button></div></article>{dialogs}</>;

  if (!selected) {
    // El padrón importado llega a miles de filas: se recorta y se pide afinar
    // la búsqueda en vez de pintar una tabla que el navegador no aguanta.
    const shown = visiblePatients.slice(0, PATIENT_TABLE_LIMIT);
    const now = new Date().toISOString();
    return <>
      <PageHead eyebrow="Registro maestro" title="Pacientes" text="Busca por DNI o nombre y abre la ficha para ver la evolución de sus resultados." action={patientActions} />
      <section className="filter-bar"><div className="compact-search"><Search /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Buscar por DNI o nombre…" aria-label="Buscar paciente por DNI o nombre" /></div></section>
      <article className="panel">
        <div className="table-wrap patient-table"><table>
          <thead><tr><th>DNI</th><th>Nombre completo</th><th>Edad</th><th>Sexo</th><th>Última orden registrada</th><th /></tr></thead>
          <tbody>{shown.length ? shown.map((patient) => {
            const last = lastOrderOf.get(patient.id);
            return <tr key={patient.id} onClick={() => setSelectedId(patient.id)} tabIndex={0}>
              <td className="mono strong">{patient.documentNumber}</td>
              <td><strong>{patient.fullName}</strong></td>
              <td>{formatPatientAgeAt(patient.birthDate, now)}</td>
              <td>{sexLabel[patient.sex]}</td>
              <td>{last ? <><strong>{fmtDate(last.createdAt)}</strong><small className="block mono">{last.code}</small></> : <span className="muted-text">Sin órdenes</span>}</td>
              <td><ChevronRight /></td>
            </tr>;
          }) : <tr><td colSpan={6}><div className="empty small"><Users /><p>Ningún paciente coincide con “{search.trim()}”.</p></div></td></tr>}</tbody>
        </table></div>
        {visiblePatients.length > shown.length && <p className="table-note">Mostrando {shown.length} de {visiblePatients.length} pacientes. Afina la búsqueda por DNI o nombre.</p>}
      </article>
      {dialogs}
    </>;
  }

  const patientOrders = orders.filter((order) => order.patientId === selected.id);
  const patientResults = patientOrders.flatMap((order) => order.results.map((result) => ({ order, result })))
    .sort((left, right) => right.order.createdAt.localeCompare(left.order.createdAt));
  const numericSeries = [...patientResults.reduce((series, entry) => {
    if (entry.result.resultType !== "numeric" || entry.result.numericValue === undefined || !Number.isFinite(entry.result.numericValue)) return series;
    const key = `${entry.result.analysisCode ?? entry.result.analyte}|${entry.result.unit}|${entry.result.method}`;
    const current = series.get(key) ?? { key, label: entry.result.analyte, analysisCode: entry.result.analysisCode, unit: entry.result.unit, method: entry.result.method, points: [] as LabData["trend"] };
    current.points.push({ date: new Intl.DateTimeFormat("es-PE", { day: "2-digit", month: "short", year: "2-digit" }).format(new Date(entry.order.createdAt)), value: displayResultNumber(entry.result.numericValue, entry.result.unit) });
    series.set(key, current);
    return series;
  }, new Map<string, { key: string; label: string; analysisCode?: string; unit: string; method: string; points: LabData["trend"] }>()).values()]
    .map((series) => ({ ...series, points: [...series.points].reverse() }))
    .sort((left, right) => left.label.localeCompare(right.label, "es"));
  const activeSeries = numericSeries.find((series) => series.key === selectedSeriesKey) ?? numericSeries[0] ?? null;
  const age = formatPatientAgeAt(selected.birthDate, new Date().toISOString());
  const lastOrder = lastOrderOf.get(selected.id);
  return <>
    <PageHead eyebrow="Registro maestro" title="Pacientes" text="Identidad única e historial de análisis." action={patientActions} />
    <button className="back-action result-back" type="button" onClick={() => setSelectedId(null)}><ArrowLeft />Volver a la lista de pacientes</button>
    <section className="patient-detail">
        {/* Misma franja de identidad que la sección de Resultados. */}
        <article className="panel patient-strip patient-summary">
          <div className="patient-identity">
            <span className="avatar patient large">{selected.fullName.split(" ").slice(0, 2).map((x) => x[0]).join("")}</span>
            <span><strong>{selected.fullName}</strong><em className="mono">DNI {selected.documentNumber}</em></span>
          </div>
          <dl className="patient-vitals">
            <div className="age-data"><dt>Edad</dt><dd>{age}</dd></div>
            <div><dt>Nacimiento</dt><dd>{fmtBirthDate(selected.birthDate)}</dd></div>
            <div><dt>Sexo</dt><dd>{sexLabel[selected.sex]}</dd></div>
          </dl>
          <div className="patient-order-context"><span>Última orden</span><strong className="mono">{lastOrder?.code ?? "—"}</strong><small><CalendarDays />{lastOrder ? fmtDate(lastOrder.createdAt) : "Sin órdenes"}</small></div>
          <button className="button secondary" onClick={() => setEditing(true)}><Pencil />Editar datos</button>
        </article>
        <article className="panel"><div className="panel-head patient-trend-head"><div><h2>Evolución de resultados</h2><p>Series compatibles por unidad y método</p></div>{numericSeries.length > 0 && <label>Análisis<select value={activeSeries?.key ?? ""} onChange={(event) => setSelectedSeriesKey(event.target.value)}>{numericSeries.map((series) => <option key={series.key} value={series.key}>{series.label}{series.unit ? ` (${formatDisplayUnit(series.unit)})` : ""}</option>)}</select></label>}</div>{activeSeries ? <><TrendChart points={activeSeries.points} label={activeSeries.label} unit={formatDisplayUnit(activeSeries.unit)} /><div className="compat-note"><ShieldCheck />{activeSeries.label} · {formatDisplayUnit(activeSeries.unit) || "sin unidad"} · {activeSeries.method || "método no registrado"}</div></> : <div className="empty small"><BarChart3 /><p>Aún no hay resultados numéricos para graficar.</p></div>}</article>
        <article className="panel"><div className="panel-head"><div><h2>Historial de órdenes</h2><p>{patientOrders.length} registros encontrados</p></div></div>{patientOrders.length ? <OrderTable orders={patientOrders} onSelect={openOrder} /> : <div className="empty small"><ClipboardList /><p>Sin órdenes en el periodo actual.</p></div>}</article>
    </section>
    {editing && <EditPatientDialog key={selected.id} patient={selected} close={() => setEditing(false)} notify={notify} />}
    {dialogs}
  </>;
}

function TrendChart({ points: values, label, unit }: { points: LabData["trend"]; label: string; unit: string }) {
  const [active, setActive] = useState<number | null>(null);
  const min = Math.min(...values.map((point) => point.value));
  const max = Math.max(...values.map((point) => point.value));
  const spread = Math.max(1, max - min);
  // Con un solo punto el paso no se puede dividir: se dibuja centrado a la izquierda.
  const step = values.length > 1 ? 540 / (values.length - 1) : 0;
  const x = (index: number) => 40 + index * step;
  const y = (value: number) => 180 - ((value - min) / spread) * 140;
  const band = values.length > 1 ? Math.max(18, step) : 80;
  const selected = active === null ? null : values[active];

  return <div className="trend-shell" onMouseLeave={() => setActive(null)}>
    <svg className="trend-chart" viewBox="0 0 620 220" role="img" aria-label={`Evolución de ${label}`}>
      {[180, 110, 40].map((line) => <line key={line} x1="40" y1={line} x2="580" y2={line} />)}
      <polyline points={values.map((point, index) => `${x(index)},${y(point.value)}`).join(" ")} fill="none" stroke="currentColor" strokeWidth="3" />
      {values.map((point, index) => <circle key={`${point.date}-${index}`} cx={x(index)} cy={y(point.value)} r={active === index ? 7 : 5} />)}
      <text x="40" y="208">{values[0]?.date}</text>
      <text x="500" y="208">{values.at(-1)?.date}</text>
      <text x="7" y="184">{min}</text>
      <text x="2" y="44">{max}</text>
      {values.map((point, index) => <rect
        key={`hit-${point.date}-${index}`}
        x={x(index) - band / 2} y="10" width={band} height="180" rx="5"
        className={active === index ? "trend-hit active" : "trend-hit"}
        tabIndex={0}
        aria-label={`${point.date}: ${point.value}${unit ? ` ${unit}` : ""}`}
        onMouseEnter={() => setActive(index)}
        onFocus={() => setActive(index)}
        onBlur={() => setActive(null)}
      />)}
    </svg>
    {selected && <div
      className={`trend-tooltip ${active === 0 ? "at-start" : active === values.length - 1 ? "at-end" : ""}`}
      style={{ left: `${x(active!) / 6.2}%`, top: `${y(selected.value) / 2.2}%` }}
      role="status"
    >
      <strong>{selected.value.toLocaleString("es-PE")}{unit ? ` ${unit}` : ""}</strong>
      <small><CalendarDays />{selected.date}</small>
    </div>}
  </div>;
}

const DAY_MS = 86_400_000;
const dateInputValue = (date: Date) => {
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 10);
};
const inputDate = (value: string, endOfDay = false) => new Date(`${value}T${endOfDay ? "23:59:59.999" : "00:00:00"}`);
const analyticsDate = (date: Date) => new Intl.DateTimeFormat("es-PE", { day: "2-digit", month: "short" }).format(date);
const analyticsLongDate = (date: Date) => new Intl.DateTimeFormat("es-PE", { day: "2-digit", month: "short", year: "numeric" }).format(date);

/**
 * Escribe el libro con ExcelJS. SheetJS CE acepta el estilo de celda y lo
 * descarta al guardar, así que el color por grupo obliga a esta librería.
 * Se carga bajo demanda: pesa y solo hace falta al exportar.
 */
async function writeAnalyticsWorkbook(fileName: string, sheets: { name: string; data: SheetData }[]) {
  const ExcelJS = (await import("exceljs")).default;
  const book = new ExcelJS.Workbook();

  sheets.forEach(({ name, data }) => {
    const sheet = book.addWorksheet(name);
    data.aoa.forEach((row) => sheet.addRow(row));
    data.merges.forEach(({ s, e }) => sheet.mergeCells(s.r + 1, s.c + 1, e.r + 1, e.c + 1));
    data.tints.forEach(({ r, c, group, strong }) => {
      const color = groupColor(group);
      const cell = sheet.getCell(r + 1, c + 1);
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: `FF${strong ? color : tintedColor(color)}` } };
      // Sobre el color pleno el texto negro no se lee; sobre el tono suave sí.
      cell.font = { bold: true, color: { argb: strong ? "FFFFFFFF" : "FF17242C" } };
      cell.alignment = { vertical: "middle", wrapText: true };
    });
    sheet.getRow(1).font = { bold: true, size: 13 };
    sheet.columns.forEach((column, index) => { column.width = index < 2 ? 26 : 12; });
  });

  const buffer = await book.xlsx.writeBuffer();
  const url = URL.createObjectURL(new Blob([buffer as BlobPart], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  }));
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  link.click();
  URL.revokeObjectURL(url);
}

// La edad siempre es la actual: el laboratorio pregunta por la edad que el
// paciente tiene hoy, no por la que tenía el día de la muestra.
const ANALYTICS_AGE_BASIS: AgeBasis = "current";
type AnalyticsCriteria = { start: string; end: string; group: string; analytes: string[]; ageMin: string; ageMax: string };

const bracketOf = (criteria: AnalyticsCriteria) => AGE_BRACKETS.find((bracket) =>
  criteria.ageMin === String(bracket.minYears)
  && criteria.ageMax === (bracket.maxYears === undefined ? "" : String(bracket.maxYears)));

const ageRangeLabel = (criteria: AnalyticsCriteria) => {
  const min = criteria.ageMin.trim();
  const max = criteria.ageMax.trim();
  if (!min && !max) return "Todas las edades";
  const bracket = bracketOf(criteria);
  if (bracket) return bracket.label;
  if (min && max) return `${min} a ${max} años`;
  return min ? `${min} años a más` : `Hasta ${max} años`;
};

function AnalyticsView({ orders, analyses, openOrder }: { orders: LabOrder[]; analyses: AnalysisDefinition[]; openOrder: (id: string) => void }) {
  const [openedAt] = useState(() => new Date().getTime());
  const latestDate = useMemo(() => orders.length
    ? orders.reduce((latest, order) => Math.max(latest, new Date(order.createdAt).getTime()), Number.NEGATIVE_INFINITY)
    : openedAt, [openedAt, orders]);
  const initialEnd = useMemo(() => new Date(latestDate), [latestDate]);
  const [criteria, setCriteria] = useState<AnalyticsCriteria>(() => ({
    start: dateInputValue(new Date(initialEnd.getTime() - 29 * DAY_MS)),
    end: dateInputValue(initialEnd),
    group: "",
    analytes: [],
    // Los tramos fijos no guardan estado propio: escriben en ageMin/ageMax, igual
    // que los botones de 7/30/90 días escriben en las fechas.
    ageMin: "",
    ageMax: "",
  }));
  // El panel edita un borrador; los indicadores solo cambian al aplicar.
  const [draft, setDraft] = useState(criteria);
  const [panelOpen, setPanelOpen] = useState(false);
  const [customAge, setCustomAge] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [exportState, setExportState] = useState<{ tone: "ok" | "error"; message: string } | null>(null);
  const [showSecondary, setShowSecondary] = useState(false);
  const [showAllAnalyses, setShowAllAnalyses] = useState(false);
  const [chartMode, setChartMode] = useState<"day" | "group" | "analysis">("day");
  const [chartAnalysis, setChartAnalysis] = useState("");
  const [analyteQuery, setAnalyteQuery] = useState("");
  const groups = useMemo(() => [...new Set(orders.flatMap((order) => [...order.groups, ...order.results.map((result) => result.group)]).filter(Boolean))].sort((a, b) => a.localeCompare(b, "es")), [orders]);

  const patch = (values: Partial<AnalyticsCriteria>) => setDraft((current) => ({ ...current, ...values }));

  // Se cruza por clave normalizada (código, o nombre para los resultados históricos
  // que llegan sin él), no por nombre literal.
  const analyteOptions = useMemo(() => {
    const seen = new Set<string>();
    return buildPickerGroups(analyses).flatMap((picker) => picker.items.flatMap((item) => {
      const key = analysisKey(item);
      if (seen.has(key)) return [];
      seen.add(key);
      return [{ key, name: item.name, group: picker.group }];
    }));
  }, [analyses]);
  const analyteNameByKey = useMemo(() => new Map(analyteOptions.map((option) => [option.key, option.name])), [analyteOptions]);

  const evaluate = (input: AnalyticsCriteria) => {
    const startDate = inputDate(input.start || dateInputValue(initialEnd));
    const endDate = inputDate(input.end || dateInputValue(initialEnd), true);
    const valid = Boolean(input.start && input.end) && startDate.getTime() <= endDate.getTime();
    const minYears = input.ageMin.trim() ? Number(input.ageMin) : undefined;
    const maxYears = input.ageMax.trim() ? Number(input.ageMax) : undefined;
    const ageFiltered = minYears !== undefined || maxYears !== undefined;
    const picked = new Set(input.analytes);
    const narrowed = Boolean(input.group) || picked.size > 0;
    const resultsOf = (order: LabOrder) => narrowed
      ? order.results.filter((result) => (!input.group || result.group === input.group)
        && (!picked.size || picked.has(analysisKey(result))))
      : order.results;
    // El filtro de edad se aplica a la orden, no al resultado: así tarjetas,
    // gráficas y export quedan coherentes sin tocar cada consumidor.
    const inPeriod = (order: LabOrder, from: Date, to: Date) => {
      const time = new Date(order.createdAt).getTime();
      return time >= from.getTime() && time <= to.getTime()
        && (!ageFiltered || matchesAgeRange(patientYears(order, ANALYTICS_AGE_BASIS), minYears, maxYears))
        && (!narrowed || resultsOf(order).length > 0);
    };
    const selected = valid ? orders.filter((order) => inPeriod(order, startDate, endDate)) : [];
    const results = selected.flatMap(resultsOf);
    return {
      input, startDate, endDate, valid, resultsOf, inPeriod,
      orders: selected, results, patients: new Set(selected.map((order) => order.patientId)).size,
    };
  };

  const view = evaluate(criteria);
  const preview = evaluate(draft);
  const { orders: filteredOrders, results: filteredResults, resultsOf: matchingResults, startDate, endDate } = view;

  const duration = view.valid ? endDate.getTime() - startDate.getTime() + 1 : 0;
  const previousEnd = new Date(startDate.getTime() - 1);
  const previousStart = new Date(previousEnd.getTime() - duration + 1);
  const previousOrders = view.valid ? orders.filter((order) => view.inPeriod(order, previousStart, previousEnd)) : [];
  const previousResults = previousOrders.flatMap(matchingResults);
  const previousPatientCount = new Set(previousOrders.map((order) => order.patientId)).size;
  const batches = new Set(filteredResults.map((result) => result.batchId)).size;
  const critical = filteredResults.filter((result) => result.flag === "critical").length;

  // Sin periodo anterior con datos el porcentaje no dice nada: mejor no mostrarlo.
  const comparisonLabel = (current: number, previous: number) => {
    if (!previous) return null;
    const change = Math.round(((current - previous) / previous) * 100);
    return `${change >= 0 ? "+" : ""}${change}% frente al periodo anterior`;
  };
  const setQuickPeriod = (days: number) => {
    const last = new Date(latestDate);
    patch({ end: dateInputValue(last), start: dateInputValue(new Date(last.getTime() - (days - 1) * DAY_MS)) });
  };

  const bucketCount = Math.max(1, Math.min(12, Math.ceil(duration / DAY_MS)));
  const bucketSize = duration / bucketCount;
  const chartGroups = [...new Set(filteredResults.map((result) => result.group))]
    .map((name) => ({ name, count: filteredResults.filter((result) => result.group === name).length }))
    .sort((left, right) => right.count - left.count)
    .map((item) => item.name);
  const chartAnalyses = [...new Set(filteredResults.map((result) => result.analyte))].sort((left, right) => left.localeCompare(right, "es"));
  const activeChartAnalysis = chartAnalyses.includes(chartAnalysis) ? chartAnalysis : chartAnalyses[0] ?? "";
  const chartSeries = chartMode === "day" ? ["Análisis realizados"] : chartMode === "group" ? chartGroups : activeChartAnalysis ? [activeChartAnalysis] : [];
  const seriesCount = (results: ResultValue[], name: string) => chartMode === "day"
    ? results.length
    : results.filter((result) => chartMode === "group" ? result.group === name : result.analyte === name).length;
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
        current: seriesCount(currentBucketResults, name),
        previous: seriesCount(previousBucketResults, name),
      }])),
    };
  });

  const groupDistribution = [...new Set(filteredResults.map((result) => result.group))].map((name) => ({ name, value: filteredResults.filter((result) => result.group === name).length })).sort((a, b) => b.value - a.value);
  const allAnalyses = [...new Set(filteredResults.map((result) => result.analyte))].map((name) => ({ name, value: filteredResults.filter((result) => result.analyte === name).length })).sort((a, b) => b.value - a.value);
  const topAnalyses = showAllAnalyses ? allAnalyses : allAnalyses.slice(0, 5);
  const criticalRows = filteredOrders.flatMap((order) => matchingResults(order).filter((result) => result.flag === "critical").map((result) => ({ order, result }))).slice(0, 8);

  const analyteLabel = (input: AnalyticsCriteria) => {
    if (!input.analytes.length) return "Todos los análisis";
    if (input.analytes.length === 1) return analyteNameByKey.get(input.analytes[0]) ?? "1 análisis";
    return `${input.analytes.length} análisis`;
  };
  const visibleAnalyteOptions = analyteOptions.filter((option) => (!draft.group || option.group === draft.group)
    && (!analyteQuery.trim() || option.name.toLocaleLowerCase("es").includes(analyteQuery.trim().toLocaleLowerCase("es"))));
  const toggleAnalyte = (key: string) => patch({
    analytes: draft.analytes.includes(key) ? draft.analytes.filter((item) => item !== key) : [...draft.analytes, key],
  });

  const openPanel = () => { setDraft(criteria); setCustomAge(false); setAnalyteQuery(""); setExportState(null); setPanelOpen(true); };
  const applyDraft = () => { setCriteria(draft); setPanelOpen(false); setExportState(null); };
  const draftBracketId = customAge ? "custom" : draft.ageMin.trim() || draft.ageMax.trim() ? bracketOf(draft)?.id ?? "custom" : "all";
  const showCustomAge = draftBracketId === "custom";

  useEffect(() => {
    if (!panelOpen) return;
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") setPanelOpen(false); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [panelOpen]);

  const exportWorkbook = async () => {
    if (exporting || !preview.valid) return;
    setExporting(true);
    setExportState(null);
    const fileName = `analitica-${draft.start}-${draft.end}.xlsx`;
    try {
      const meta = (title: string, note: string) => ({
        title, note, period: `${draft.start} a ${draft.end}`,
        group: `${draft.group || "Todos los grupos"} · ${analyteLabel(draft)}`,
      });
      // Filtrar por análisis también recorta las filas: si el usuario pidió tres,
      // el catálogo completo dejaría 85 filas en cero.
      const pickedKeys = new Set(draft.analytes);
      const exportAnalyses = analyses.filter((analysis) => (!draft.group || analysis.group === draft.group)
        && (!pickedKeys.size || pickedKeys.has(analysisKey(analysis))));
      const byDay = buildCountMatrix(exportAnalyses, preview.orders, preview.resultsOf, dayColumns(preview.startDate, preview.endDate));
      // El desglose etáreo ignora el filtro de edad a propósito: aplicarlo dejaría
      // un solo tramo con datos y el resto en cero.
      const ageOrders = orders.filter((order) => {
        const time = new Date(order.createdAt).getTime();
        return time >= preview.startDate.getTime() && time <= preview.endDate.getTime()
          && preview.resultsOf(order).length > 0;
      });
      const byAge = buildCountMatrix(exportAnalyses, ageOrders, preview.resultsOf, ageColumns(ANALYTICS_AGE_BASIS));
      // El detalle solo lista los análisis realizados; el catálogo completo dejaría
      // decenas de columnas vacías en cada orden.
      const detailColumns = byDay.rows.filter((row) => row.total > 0)
        .map(({ key, group: rowGroup, analysis }) => ({ key, group: rowGroup, analysis }));

      await writeAnalyticsWorkbook(fileName, [
        {
          name: "Conteo por día",
          data: countSheet(byDay, meta("Conteo de análisis por día", ageRangeLabel(draft))),
        },
        {
          name: "Por grupo etáreo",
          data: transposedCountSheet(byAge, "Grupo etáreo",
            meta("Conteo de análisis por grupo etáreo", "Edad actual del paciente · muestra todos los tramos")),
        },
        {
          name: "Detalle",
          data: detailSheet(
            detailColumns,
            preview.orders,
            preview.resultsOf,
            (result) => {
              if (result.resultType !== "numeric") return result.value;
              const numeric = Number(result.value);
              // Número real para que Excel pueda operar, en la misma escala que la pantalla.
              return result.value.trim() && Number.isFinite(numeric)
                ? displayResultNumber(numeric, result.unit)
                : result.value;
            },
            (order) => patientYears(order, ANALYTICS_AGE_BASIS) ?? "Sin registrar",
            fmtDate,
            meta("Detalle de resultados por orden", ageRangeLabel(draft)),
          ),
        },
      ]);
      setCriteria(draft);
      setExportState({ tone: "ok", message: `Se descargó ${fileName}.` });
    } catch {
      setExportState({ tone: "error", message: "No se pudo generar el Excel. Vuelve a intentarlo." });
    } finally {
      setExporting(false);
    }
  };

  return <>
    <PageHead eyebrow="Inteligencia operativa" title="Analítica" text="Consulta el resumen de los análisis realizados." action={
      <div className="analytics-head-filter">
        <dl>
          <div><dt>Periodo</dt><dd>{view.valid ? `${analyticsLongDate(startDate)} — ${analyticsLongDate(endDate)}` : "Incompleto"}</dd></div>
          <div><dt>Grupo</dt><dd>{criteria.group || "Todos"}</dd></div>
          <div><dt>Análisis</dt><dd>{analyteLabel(criteria)}</dd></div>
          <div><dt>Edad</dt><dd>{ageRangeLabel(criteria)}</dd></div>
        </dl>
        <button type="button" className="button" onClick={openPanel}><SlidersHorizontal />Filtrar y exportar</button>
      </div>
    } />

    {!view.valid && <div className="analytics-warning"><CircleAlert />La fecha inicial debe ser anterior a la fecha final. Abre <strong>Filtrar y exportar</strong> para corregirla.</div>}

    <section className="metrics-grid analytics-metrics">
      <article className="metric"><div><span>Órdenes</span><strong>{filteredOrders.length}</strong>{comparisonLabel(filteredOrders.length, previousOrders.length) && <small>{comparisonLabel(filteredOrders.length, previousOrders.length)}</small>}</div><ClipboardList /></article>
      <article className="metric"><div><span>Análisis realizados</span><strong>{filteredResults.length}</strong>{comparisonLabel(filteredResults.length, previousResults.length) && <small>{comparisonLabel(filteredResults.length, previousResults.length)}</small>}</div><FlaskConical /></article>
      <article className="metric"><div><span>Pacientes</span><strong>{view.patients}</strong>{comparisonLabel(view.patients, previousPatientCount) && <small>{comparisonLabel(view.patients, previousPatientCount)}</small>}</div><Users /></article>
    </section>

    {filteredOrders.length ? <>
      <section className="analytics-activity">
        <div className="analytics-activity-head">
          <div>
            <h2>Actividad de análisis</h2>
            <p>{chartMode === "day" ? "Cuántos análisis se realizaron en cada fecha del periodo." : chartMode === "group" ? "Cómo se reparte el volumen de cada fecha entre los grupos." : "Cuántas veces se realizó un análisis específico en cada fecha."}</p>
          </div>
          <div className="analytics-chart-controls">
            <div className="analytics-chart-mode" aria-label="Desglose del gráfico">
              <button type="button" className={chartMode === "day" ? "active" : ""} onClick={() => setChartMode("day")}>Por día</button>
              <button type="button" className={chartMode === "group" ? "active" : ""} onClick={() => setChartMode("group")}>Por grupo</button>
              <button type="button" className={chartMode === "analysis" ? "active" : ""} onClick={() => setChartMode("analysis")}>Por análisis</button>
            </div>
            {chartMode === "analysis" && <select value={activeChartAnalysis} onChange={(event) => setChartAnalysis(event.target.value)} aria-label="Seleccionar análisis para la gráfica">{chartAnalyses.map((name) => <option key={name}>{name}</option>)}</select>}
          </div>
        </div>
        <AnalyticsStackedBarChart data={chartData} groups={chartSeries} detailLabel={chartMode === "group" ? "Detalle de grupos" : chartMode === "analysis" ? "Detalle del análisis" : "Total del día"} />
      </section>

      <section className="analytics-lists">
        <article>
          <h2>Análisis por grupo</h2>
          <AnalyticsBars data={groupDistribution} emptyLabel="No hay grupos en este periodo." />
        </article>
        <article>
          <h2>Análisis más frecuentes</h2>
          <AnalyticsBars data={topAnalyses} emptyLabel="No hay análisis en este periodo." />
          {allAnalyses.length > 5 && <button type="button" className="text-button" onClick={() => setShowAllAnalyses((current) => !current)}>{showAllAnalyses ? "Ver solo los principales" : `Ver todos (${allAnalyses.length})`}</button>}
        </article>
      </section>

      <section className="analytics-secondary">
        <button type="button" className="analytics-disclosure" onClick={() => setShowSecondary((current) => !current)} aria-expanded={showSecondary}>
          {showSecondary ? "Ocultar indicadores adicionales" : "Ver más indicadores"}
        </button>
        {showSecondary && <>
          <dl className="analytics-secondary-grid">
            <div><dt>Tandas procesadas</dt><dd>{batches}</dd></div>
            <div><dt>Resultados críticos</dt><dd>{critical}</dd></div>
            <div><dt>Grupos distintos</dt><dd>{groupDistribution.length}</dd></div>
            <div><dt>Promedio por orden</dt><dd>{(filteredResults.length / filteredOrders.length).toFixed(1)}</dd></div>
          </dl>
          {criticalRows.length > 0 && <div className="table-wrap analytics-critical"><table><thead><tr><th>Orden</th><th>Paciente</th><th>Análisis</th><th>Resultado</th><th>Fecha</th><th /></tr></thead><tbody>{criticalRows.map(({ order, result }) => <tr key={`${order.id}-${result.id}`}><td className="mono strong">{order.code}</td><td>{order.patientName}</td><td>{result.analyte}<small className="table-subline">{result.group}</small></td><td><span className="status critical">{result.value} {result.unit}</span></td><td>{fmtDate(result.registeredAt || order.createdAt)}</td><td><button className="text-button" onClick={() => openOrder(order.id)}>Ver orden <ChevronRight /></button></td></tr>)}</tbody></table></div>}
        </>}
      </section>
    </> : <article className="panel"><div className="empty"><BarChart3 /><h3>Sin registros con estos filtros</h3><p>No hay análisis en el periodo, grupo o edad seleccionados.</p><button type="button" className="button secondary" onClick={openPanel}><SlidersHorizontal />Cambiar filtros</button></div></article>}

    {panelOpen && <div className="filter-scrim" onClick={() => setPanelOpen(false)}>
      <aside className="filter-panel" role="dialog" aria-modal="true" aria-label="Filtrar y exportar" onClick={(event) => event.stopPropagation()}>
        <header className="filter-panel-head">
          <h2>Filtrar y exportar</h2>
          <button type="button" className="icon-button" onClick={() => setPanelOpen(false)} aria-label="Cerrar panel"><X /></button>
        </header>

        <div className="filter-panel-body">
          <section className="filter-block">
            <h3>Periodo</h3>
            <div className="filter-choices" aria-label="Periodos rápidos">
              <button type="button" onClick={() => setQuickPeriod(7)}>7 días</button>
              <button type="button" onClick={() => setQuickPeriod(30)}>30 días</button>
              <button type="button" onClick={() => setQuickPeriod(90)}>90 días</button>
            </div>
            <div className="filter-dates">
              <label>Desde<input type="date" value={draft.start} max={draft.end} onChange={(event) => patch({ start: event.target.value })} /></label>
              <label>Hasta<input type="date" value={draft.end} min={draft.start} onChange={(event) => patch({ end: event.target.value })} /></label>
            </div>
            {!preview.valid && <p className="filter-hint error">La fecha inicial debe ser anterior a la fecha final.</p>}
          </section>

          <section className="filter-block">
            <h3>Grupo</h3>
            {/* Cambiar de grupo limpia lo elegido: si no, quedarían análisis
                seleccionados que la lista ya no muestra. */}
            <label className="filter-field">Grupo de análisis<select value={draft.group} onChange={(event) => patch({ group: event.target.value, analytes: [] })}><option value="">Todos los grupos</option>{groups.map((name) => <option key={name}>{name}</option>)}</select></label>
          </section>

          <section className="filter-block">
            <h3>Análisis</h3>
            <div className="filter-analyte-head">
              <input type="search" value={analyteQuery} onChange={(event) => setAnalyteQuery(event.target.value)} placeholder="Buscar análisis…" aria-label="Buscar análisis" />
              {draft.analytes.length > 0 && <button type="button" className="text-button" onClick={() => patch({ analytes: [] })}>Quitar selección ({draft.analytes.length})</button>}
            </div>
            <p className="filter-hint">{draft.analytes.length ? analyteLabel(draft) : "Sin marcar ninguno se incluyen todos."}</p>
            <div className="filter-analyte-list" role="group" aria-label="Análisis incluidos">
              {visibleAnalyteOptions.length
                ? visibleAnalyteOptions.map((option) => <label key={option.key}>
                  <input type="checkbox" checked={draft.analytes.includes(option.key)} onChange={() => toggleAnalyte(option.key)} />
                  <span>{option.name}<small>{option.group}</small></span>
                </label>)
                : <p className="filter-hint">Ningún análisis coincide con la búsqueda.</p>}
            </div>
          </section>

          <section className="filter-block">
            <h3>Edad</h3>
            <div className="filter-choices stacked" aria-label="Grupo etáreo">
              <button type="button" className={draftBracketId === "all" ? "active" : ""} onClick={() => { setCustomAge(false); patch({ ageMin: "", ageMax: "" }); }}>Todas las edades</button>
              {AGE_BRACKETS.map((bracket) => <button type="button" key={bracket.id} className={draftBracketId === bracket.id ? "active" : ""} onClick={() => { setCustomAge(false); patch({ ageMin: String(bracket.minYears), ageMax: bracket.maxYears === undefined ? "" : String(bracket.maxYears) }); }}>{bracket.label}</button>)}
              <button type="button" className={showCustomAge ? "active" : ""} onClick={() => setCustomAge(true)}>Personalizado</button>
            </div>
            {showCustomAge && <div className="filter-dates">
              <label>Desde<input type="number" min={0} max={130} inputMode="numeric" value={draft.ageMin} onChange={(event) => patch({ ageMin: event.target.value })} placeholder="años" /></label>
              <label>Hasta<input type="number" min={0} max={130} inputMode="numeric" value={draft.ageMax} onChange={(event) => patch({ ageMax: event.target.value })} placeholder="años" /></label>
            </div>}
            <p className="filter-hint">Se toma la edad que el paciente tiene hoy.</p>
          </section>

          <section className="filter-block filter-export">
            <h3>Exportar información</h3>
            <dl className="filter-export-summary">
              <div><dt>Periodo</dt><dd>{preview.valid ? `${analyticsLongDate(preview.startDate)} — ${analyticsLongDate(preview.endDate)}` : "Periodo incompleto"}</dd></div>
              <div><dt>Grupo</dt><dd>{draft.group || "Todos los grupos"}</dd></div>
              <div><dt>Análisis</dt><dd>{draft.analytes.length ? draft.analytes.map((key) => analyteNameByKey.get(key) ?? key).join(", ") : "Todos los análisis"}</dd></div>
              <div><dt>Edad</dt><dd>{ageRangeLabel(draft)}</dd></div>
            </dl>
            <p className="filter-export-counts"><strong>{preview.results.length}</strong> análisis · <strong>{preview.patients}</strong> pacientes · <strong>{preview.orders.length}</strong> órdenes</p>
            <button type="button" className="button secondary wide" onClick={() => void exportWorkbook()} disabled={!preview.results.length || exporting} aria-busy={exporting}>
              {exporting ? <><span className="button-spinner" aria-hidden="true" />Generando Excel…</> : <><FileDown />Exportar Excel</>}
            </button>
            {!preview.results.length && preview.valid && <p className="filter-hint">No hay análisis que exportar con estos filtros.</p>}
            {exportState && <p className={exportState.tone === "error" ? "filter-hint error" : "filter-hint ok"}>{exportState.message}</p>}
          </section>
        </div>

        <footer className="filter-panel-foot">
          <button type="button" className="button wide" onClick={applyDraft} disabled={!preview.valid}>Aplicar filtros</button>
        </footer>
      </aside>
    </div>}
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

/**
 * Los ids de lo que se crea los genera el equipo, no la base. Sin conexión hacen
 * falta para poder referenciar un grupo o un análisis recién creado antes de
 * sincronizar; `save_catalog_analysis` y compañía los respetan tal cual.
 * Editar también estrena `newVersionId`: cada edición abre una versión clínica
 * nueva y los resultados que se registren después deben apuntar a ella.
 */
function withClientIds(operation: CatalogOperation): CatalogOperation {
  if (operation.action === "group.create") return { ...operation, groupId: operation.groupId ?? crypto.randomUUID() };
  if (operation.action === "subsection.create") return { ...operation, subsectionId: operation.subsectionId ?? crypto.randomUUID() };
  if (operation.action === "analysis.save") {
    return {
      ...operation,
      newAnalysisId: operation.analysisId ? undefined : operation.newAnalysisId ?? crypto.randomUUID(),
      newVersionId: operation.newVersionId ?? crypto.randomUUID(),
    };
  }
  return operation;
}

async function catalogRequest(repository: OfflineRepository | null, input: CatalogOperation) {
  const operation = withClientIds(input);
  // Con réplica local el cambio se aplica aquí y se encola; sin ella va directo.
  if (repository) return repository.saveCatalog(operation);
  const response = await fetch("/api/catalog", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(operation),
  });
  const payload = await response.json().catch(() => null) as { error?: string } | null;
  if (!response.ok) throw new Error(payload?.error ?? "No se pudo guardar el catálogo.");
}

const catalogSectionKey = (value: string | null | undefined) => value?.trim().toLocaleLowerCase("es") || "";

function CatalogView({ analyses, catalogGroups, subsections }: { analyses: LabData["analyses"]; catalogGroups: CatalogGroup[]; subsections: CatalogSubsection[] }) {
  const router = useRouter();
  const offlineRepository = useOfflineRepository();
  const [localAnalyses, setLocalAnalyses] = useState(analyses);
  const [analysesSource, setAnalysesSource] = useState(analyses);
  const localSubsections = subsections;
  const [activeGroupId, setActiveGroupId] = useState(() => buildCatalogGroupOptions(analyses.filter((analysis) => analysis.active), catalogGroups)[0]?.id ?? "");
  const [groupEditor, setGroupEditor] = useState<"create" | "rename" | null>(null);
  const [groupName, setGroupName] = useState("");
  const [query, setQuery] = useState("");
  const [editingAnalysis, setEditingAnalysis] = useState<AnalysisDefinition | null>(null);
  const [creatingAnalysis, setCreatingAnalysis] = useState(false);
  const [newSubsectionName, setNewSubsectionName] = useState("");
  const [renamingSubsectionId, setRenamingSubsectionId] = useState("");
  const [renamingSubsectionName, setRenamingSubsectionName] = useState("");
  const [draggedAnalysisId, setDraggedAnalysisId] = useState("");
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const refreshStoredCatalog = offlineRepository?.refresh;
  const storedCatalogOnline = offlineRepository?.online;

  const groups = useMemo(() => buildCatalogGroupOptions(localAnalyses.filter((analysis) => analysis.active), catalogGroups), [catalogGroups, localAnalyses]);
  const activeGroup = groups.find((group) => group.id === activeGroupId) ?? groups[0] ?? null;

  // `localAnalyses` solo existe para pintar el arrastre antes de que responda el
  // servidor. Cuando la réplica local materializa un cambio del catálogo llega
  // por props, y sin esto la pantalla se quedaría con la copia anterior.
  // Ajuste durante el render, no en un efecto: así no hay un fotograma con los
  // datos viejos (https://react.dev/learn/you-might-not-need-an-effect).
  if (analyses !== analysesSource) {
    setAnalysesSource(analyses);
    setLocalAnalyses(analyses);
  }

  useEffect(() => {
    if (!storedCatalogOnline || !refreshStoredCatalog || !localAnalyses.some((analysis) => analysis.active && !analysis.groupId)) return;
    let cancelled = false;
    void refreshStoredCatalog().catch(() => {
      if (!cancelled) setMessage({ type: "error", text: "No se pudo actualizar el catálogo. Puedes seguir consultándolo e intentarlo nuevamente." });
    });
    return () => { cancelled = true; };
  }, [localAnalyses, refreshStoredCatalog, storedCatalogOnline]);

  const activeSections = useMemo(() => {
    if (!activeGroup) return [];
    const stored = localSubsections.filter((section) => activeGroup.persisted
      ? section.groupId === activeGroup.id
      : catalogSectionKey(section.group) === catalogSectionKey(activeGroup.name))
      .sort((left, right) => left.displayOrder - right.displayOrder);
    const known = new Set(stored.map((section) => catalogSectionKey(section.name)));
    const inferred = [...new Set(localAnalyses.filter((analysis) => analysis.active && analysisBelongsToCatalogGroup(analysis, activeGroup) && analysis.subsection && !known.has(catalogSectionKey(analysis.subsection))).map((analysis) => analysis.subsection!))]
      .map((name, index) => ({ id: `legacy:${activeGroup.id}:${name}`, groupId: activeGroup.id, group: activeGroup.name, name, displayOrder: 900 + index }));
    return [...stored, ...inferred];
  }, [activeGroup, localAnalyses, localSubsections]);
  const activeItems = useMemo(() => localAnalyses.filter((analysis) => analysis.active && activeGroup && analysisBelongsToCatalogGroup(analysis, activeGroup))
    .sort((left, right) => (left.pickerOrder ?? 999) - (right.pickerOrder ?? 999) || left.name.localeCompare(right.name, "es")), [activeGroup, localAnalyses]);
  // Cada cajón se sitúa por el primer análisis que contiene. Así «Sin subgrupo»
  // se mueve como cualquier otro sin necesitar una fila propia en la base.
  // ponytail: un subgrupo vacío no tiene análisis que lo ancle y espera al final
  // hasta que reciba el primero.
  const orderedBuckets = useMemo(() => {
    const anchor = (section: CatalogSubsection | null) => {
      const items = activeItems.filter((analysis) => catalogSectionKey(analysis.subsection) === catalogSectionKey(section?.name ?? null));
      return items.length
        ? Math.min(...items.map((analysis) => analysis.pickerOrder ?? 999))
        : 1_000_000 + (section?.displayOrder ?? 0);
    };
    return [null, ...activeSections]
      .map((section) => ({ section, order: anchor(section) }))
      .sort((left, right) => left.order - right.order)
      .map((entry) => entry.section);
  }, [activeItems, activeSections]);
  const bucketKeys = useMemo(() => orderedBuckets.map((section) => catalogSectionKey(section?.name ?? null)), [orderedBuckets]);

  async function refreshCatalog() {
    // `saveCatalog` ya deja los datos al día: con réplica local aplicando el
    // cambio en el equipo, y sin ella recargando desde el servidor. Aquí solo
    // queda el caso sin repositorio offline, donde manda el server component.
    if (!offlineRepository) router.refresh();
  }

  async function runCatalogChange(operation: CatalogOperation, success: string, refresh = true) {
    setSaving(true);
    setMessage(null);
    try {
      await catalogRequest(offlineRepository, operation);
      const queued = Boolean(offlineRepository?.enabled) && !offlineRepository?.online;
      setMessage({ type: "success", text: queued ? `${success} Se enviará cuando haya internet.` : success });
      if (refresh) await refreshCatalog();
      return true;
    } catch (reason) {
      setMessage({ type: "error", text: reason instanceof Error ? reason.message : "No se pudo guardar el catálogo." });
      return false;
    } finally {
      setSaving(false);
    }
  }

  function layoutOrder(items: AnalysisDefinition[], destination: string | null, draggedId: string, beforeId?: string) {
    const sectionOrder = bucketKeys;
    const dragged = items.find((analysis) => analysis.id === draggedId);
    if (!dragged) return items;
    const moved = { ...dragged, subsection: destination || undefined };
    const buckets = new Map(sectionOrder.map((key) => [key, items.filter((analysis) => analysis.id !== draggedId && catalogSectionKey(analysis.subsection) === key)]));
    const destinationKey = catalogSectionKey(destination);
    const destinationItems = buckets.get(destinationKey) ?? [];
    const targetIndex = beforeId ? destinationItems.findIndex((analysis) => analysis.id === beforeId) : -1;
    destinationItems.splice(targetIndex < 0 ? destinationItems.length : targetIndex, 0, moved);
    buckets.set(destinationKey, destinationItems);
    return sectionOrder.flatMap((key) => buckets.get(key) ?? []).map((analysis, index) => ({ ...analysis, pickerOrder: (index + 1) * 10 }));
  }

  async function saveLayout(ordered: AnalysisDefinition[]) {
    if (!activeGroup?.persisted) {
      setMessage({ type: "error", text: "Actualiza el catálogo antes de cambiar el orden." });
      return;
    }
    const previous = localAnalyses;
    setLocalAnalyses((current) => current.map((analysis) => ordered.find((item) => item.id === analysis.id) ?? analysis));
    const saved = await runCatalogChange({ action: "layout.save", groupId: activeGroup.id, items: ordered.map((analysis) => ({ analysisId: analysis.id, subsection: analysis.subsection ?? null, displayOrder: analysis.pickerOrder ?? 999 })) }, "Orden actualizado.", false);
    if (!saved) setLocalAnalyses(previous);
  }

  function dropAnalysis(subsection: string | null, beforeId?: string) {
    if (!draggedAnalysisId || query) return;
    if (beforeId === draggedAnalysisId) {
      setDraggedAnalysisId("");
      return;
    }
    const ordered = layoutOrder(activeItems, subsection, draggedAnalysisId, beforeId);
    setDraggedAnalysisId("");
    void saveLayout(ordered);
  }

  function moveAnalysis(analysis: AnalysisDefinition, direction: -1 | 1) {
    const sectionKey = catalogSectionKey(analysis.subsection);
    const sectionOrder = bucketKeys;
    const sameSection = activeItems.filter((item) => catalogSectionKey(item.subsection) === sectionKey);
    const index = sameSection.findIndex((item) => item.id === analysis.id);
    if (!sameSection[index + direction]) return;
    const reorderedSection = [...sameSection];
    [reorderedSection[index], reorderedSection[index + direction]] = [reorderedSection[index + direction], reorderedSection[index]];
    const ordered = sectionOrder.flatMap((key) => key === sectionKey
      ? reorderedSection
      : activeItems.filter((item) => catalogSectionKey(item.subsection) === key))
      .map((item, itemIndex) => ({ ...item, pickerOrder: (itemIndex + 1) * 10 }));
    void saveLayout(ordered);
  }

  async function createSubsection(event: React.FormEvent) {
    event.preventDefault();
    if (!activeGroup?.persisted || newSubsectionName.trim().length < 2) return;
    if (await runCatalogChange({ action: "subsection.create", groupId: activeGroup.id, name: newSubsectionName.trim() }, "Subgrupo creado.")) setNewSubsectionName("");
  }

  async function saveGroup(event: React.FormEvent) {
    event.preventDefault();
    const name = groupName.trim();
    if (name.length < 2) return;
    // El id se fija aquí para poder abrir la sección recién creada; antes se
    // generaba dentro y no había forma de saber a cuál saltar.
    const groupId = crypto.randomUUID();
    const saved = groupEditor === "create"
      ? await runCatalogChange({ action: "group.create", name, groupId }, "Sección creada.")
      : activeGroup?.persisted
        ? await runCatalogChange({ action: "group.rename", groupId: activeGroup.id, name }, "Sección actualizada.")
        : false;
    if (saved) {
      if (groupEditor === "create") setActiveGroupId(groupId);
      setGroupEditor(null);
      setGroupName("");
    }
  }

  async function archiveGroup() {
    if (!activeGroup?.persisted) return;
    const count = localAnalyses.filter((analysis) => analysis.active && analysisBelongsToCatalogGroup(analysis, activeGroup)).length;
    if (!window.confirm(`¿Retirar la sección «${activeGroup.name}» y sus ${count} análisis de los nuevos registros? Los informes anteriores se conservarán.`)) return;
    if (await runCatalogChange({ action: "group.archive", groupId: activeGroup.id }, "Sección retirada. Los informes anteriores se conservaron.")) {
      setGroupEditor(null);
      setActiveGroupId("");
    }
  }

  async function renameSubsection(section: CatalogSubsection) {
    if (!activeGroup?.persisted || renamingSubsectionName.trim().length < 2) return;
    const request = catalogSubsectionRenameRequest({
      subsectionId: section.id,
      groupId: activeGroup.id,
      currentName: section.name,
      nextName: renamingSubsectionName.trim(),
    });
    if (await runCatalogChange(request, "Subgrupo actualizado.")) setRenamingSubsectionId("");
  }

  async function deleteSubsection(section: CatalogSubsection) {
    if (!window.confirm(`¿Eliminar el subgrupo «${section.name}»? Sus análisis permanecerán en el grupo.`)) return;
    if (!activeGroup?.persisted) return;
    await runCatalogChange(catalogSubsectionDeleteRequest({
      subsectionId: section.id,
      groupId: activeGroup.id,
      currentName: section.name,
    }), "Subgrupo eliminado. Sus análisis permanecen en el grupo.");
  }

  // Mover un cajón es renumerar el orden plano del grupo: el propio orden de los
  // análisis es lo que sitúa cada cajón, así que no hay dos verdades que cuadrar.
  function moveBucket(section: CatalogSubsection | null, direction: -1 | 1) {
    const index = orderedBuckets.indexOf(section);
    if (index < 0 || !orderedBuckets[index + direction]) return;
    const reordered = [...orderedBuckets];
    [reordered[index], reordered[index + direction]] = [reordered[index + direction], reordered[index]];
    const ordered = reordered
      .flatMap((bucket) => activeItems.filter((analysis) => catalogSectionKey(analysis.subsection) === catalogSectionKey(bucket?.name ?? null)))
      .map((analysis, position) => ({ ...analysis, pickerOrder: (position + 1) * 10 }));
    void saveLayout(ordered);
  }

  async function archiveAnalysis(analysis: AnalysisDefinition) {
    if (!window.confirm(`¿Retirar «${analysis.name}» del registro de nuevos análisis? Los informes anteriores se conservarán.`)) return;
    if (await runCatalogChange({ action: "analysis.archive", analysisId: analysis.id }, "Análisis retirado.")) setLocalAnalyses((current) => current.map((item) => item.id === analysis.id ? { ...item, active: false } : item));
  }

  const renderSection = (section: CatalogSubsection | null) => {
    const sectionName = section?.name ?? null;
    const items = activeItems.filter((analysis) => catalogSectionKey(analysis.subsection) === catalogSectionKey(sectionName))
      .filter((analysis) => !query.trim() || normalizePatientLookup(`${analysis.name} ${analysis.reference} ${analysis.unit}`).includes(normalizePatientLookup(query)));
    const editableSection = Boolean(section && activeGroup?.persisted);
    const index = orderedBuckets.indexOf(section);
    const movable = Boolean(activeGroup?.persisted) && !query;
    return <section className="catalog-section" key={section?.id ?? "without-subsection"} onDragOver={(event) => event.preventDefault()} onDrop={() => dropAnalysis(sectionName)}>
      <header className="catalog-section-head">
        <div>{renamingSubsectionId === section?.id
          ? <input autoFocus value={renamingSubsectionName} onChange={(event) => setRenamingSubsectionName(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") void renameSubsection(section); if (event.key === "Escape") setRenamingSubsectionId(""); }} />
          : <><h2>{sectionName ?? "Sin subgrupo"}</h2><small>{items.length} análisis</small></>}</div>
        {renamingSubsectionId && renamingSubsectionId === section?.id
          ? <div><button type="button" className="text-button" onClick={() => void renameSubsection(section)}>Guardar</button><button type="button" className="text-button" onClick={() => setRenamingSubsectionId("")}>Cancelar</button></div>
          : <div>
            <button type="button" className="icon-button" title="Subir subgrupo" disabled={!movable || index <= 0} onClick={() => moveBucket(section, -1)} aria-label={`Subir ${sectionName ?? "Sin subgrupo"}`}><ArrowUp /></button>
            <button type="button" className="icon-button" title="Bajar subgrupo" disabled={!movable || index < 0 || index === orderedBuckets.length - 1} onClick={() => moveBucket(section, 1)} aria-label={`Bajar ${sectionName ?? "Sin subgrupo"}`}><ArrowDown /></button>
            {editableSection && section && <><button type="button" className="icon-button" title="Editar nombre" onClick={() => { setRenamingSubsectionId(section.id); setRenamingSubsectionName(section.name); }} aria-label={`Editar ${section.name}`}><Pencil /></button><button type="button" className="icon-button danger-text" title="Eliminar subgrupo" onClick={() => void deleteSubsection(section)} aria-label={`Eliminar ${section.name}`}><Trash2 /></button></>}
          </div>}
      </header>
      <div className="catalog-analysis-grid">
        <div className="catalog-column-head" aria-hidden="true"><span>Exámenes solicitados</span><span>Unidad</span><span>Valores normales</span></div>
        {items.map((analysis, position) => <article draggable={!query && activeGroup?.persisted} onDragStart={() => setDraggedAnalysisId(analysis.id)} onDragEnd={() => setDraggedAnalysisId("")} onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.stopPropagation(); dropAnalysis(sectionName, analysis.id); }} className={draggedAnalysisId === analysis.id ? "catalog-analysis-card dragging" : "catalog-analysis-card"} key={analysis.id}>
          <button type="button" className="catalog-drag-handle" aria-label={`Mover ${analysis.name}`} title="Arrastra para mover"><GripVertical /></button>
          <strong className="catalog-cell-name">{analysis.name}</strong>
          {analysis.resultType === "numeric"
            ? <><span className="catalog-cell-unit">{formatDisplayUnit(analysis.unit) || "—"}</span><span className="catalog-cell-reference">{formatDisplayReference(analysis.reference, analysis.unit) || "—"}</span></>
            : <span className="catalog-cell-reference wide">{analysis.resultType === "qualitative" ? analysis.qualitativeOptions?.join(" · ") || "Selección" : "Texto libre"}</span>}
          <div className="catalog-card-actions"><button type="button" className="icon-button" title="Subir análisis" disabled={!activeGroup?.persisted || Boolean(query) || position === 0} onClick={() => moveAnalysis(analysis, -1)} aria-label={`Subir ${analysis.name}`}><ArrowUp /></button><button type="button" className="icon-button" title="Bajar análisis" disabled={!activeGroup?.persisted || Boolean(query) || position === items.length - 1} onClick={() => moveAnalysis(analysis, 1)} aria-label={`Bajar ${analysis.name}`}><ArrowDown /></button><button type="button" className="icon-button" title="Editar análisis" disabled={!analysis.groupId} onClick={() => setEditingAnalysis(analysis)} aria-label={`Editar ${analysis.name}`}><Pencil /></button><button type="button" className="icon-button danger-text" title="Eliminar análisis" onClick={() => void archiveAnalysis(analysis)} aria-label={`Eliminar ${analysis.name}`}><Trash2 /></button></div>
        </article>)}
        {items.length === 0 && <div className="catalog-empty-drop">{query ? "No hay coincidencias en este subgrupo" : "Arrastra aquí los análisis de este subgrupo"}</div>}
      </div>
    </section>;
  };

  return <>
    <PageHead compact eyebrow="Catálogo" title="Catálogo" text="Ordena y configura los análisis." action={<div className="catalog-page-actions"><button className="button secondary" onClick={() => { setGroupEditor("create"); setGroupName(""); }}><Plus />Nueva sección</button><button className="button primary" disabled={!activeGroup?.persisted} onClick={() => setCreatingAnalysis(true)}><Plus />Nuevo análisis</button></div>} />
    {message && <p className={`catalog-message ${message.type}`} role="status">{message.type === "success" ? <Check /> : <CircleAlert />}{message.text}</p>}
    <article className="catalog-editor">
      <div className="catalog-group-manager"><strong>Secciones</strong>{groupEditor
        ? <form onSubmit={saveGroup}><input autoFocus value={groupName} onChange={(event) => setGroupName(event.target.value)} placeholder={groupEditor === "create" ? "Nombre de la nueva sección" : "Nombre de la sección"} aria-label="Nombre de la sección" /><button className="text-button" disabled={saving || groupName.trim().length < 2}>Guardar</button><button type="button" className="text-button" onClick={() => setGroupEditor(null)}>Cancelar</button></form>
        : <div><button type="button" className="icon-button" title="Editar sección" disabled={!activeGroup?.persisted} onClick={() => { if (activeGroup) { setGroupEditor("rename"); setGroupName(activeGroup.name); } }} aria-label="Editar sección"><Pencil /></button><button type="button" className="icon-button danger-text" title="Eliminar sección" disabled={!activeGroup?.persisted} onClick={() => void archiveGroup()} aria-label="Eliminar sección"><Trash2 /></button></div>}</div>
      <nav className="entry-group-tabs catalog-group-tabs" aria-label="Grupos del catálogo">{groups.map((group) => <button type="button" key={group.id} className={group.id === activeGroup?.id ? "active" : ""} onClick={() => { setActiveGroupId(group.id); setQuery(""); }}>{resultGroupEmoji(group.name)} {group.name}<b>{localAnalyses.filter((analysis) => analysis.active && analysisBelongsToCatalogGroup(analysis, group)).length}</b></button>)}</nav>
      {activeGroup && <>
        {!activeGroup.persisted && <p className="catalog-compat-note"><CircleAlert />Esta sección viene de datos antiguos y aún no tiene ficha propia. Conéctate una vez para actualizarla y poder editarla.</p>}
        <div className="catalog-editor-tools"><div className="compact-search"><Search /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Buscar análisis en este grupo" aria-label="Buscar análisis en este grupo" /></div><form onSubmit={createSubsection}><input value={newSubsectionName} onChange={(event) => setNewSubsectionName(event.target.value)} placeholder="Nombre de nuevo subgrupo" aria-label="Nombre de nuevo subgrupo" /><button className="button secondary" disabled={saving || newSubsectionName.trim().length < 2}><Plus />Crear subgrupo</button></form></div>
        <div className="catalog-sections">
          {/* Misma cabecera que abre la tabla del grupo en el informe impreso. */}
          <p className="catalog-report-band">{`Sección: ${activeGroup.name}`.toUpperCase()}</p>
          {orderedBuckets.map((section) => renderSection(section))}
        </div>
      </>}
    </article>
    {(editingAnalysis || creatingAnalysis) && activeGroup?.persisted && <CatalogAnalysisDialog analysis={editingAnalysis} initialGroupId={editingAnalysis?.groupId ?? activeGroup.id} groups={groups.filter((group) => group.persisted)} subsections={localSubsections} close={() => { setEditingAnalysis(null); setCreatingAnalysis(false); }} saved={async () => { setEditingAnalysis(null); setCreatingAnalysis(false); setMessage({ type: "success", text: editingAnalysis ? "Análisis actualizado." : "Análisis creado." }); await refreshCatalog(); }} />}
  </>;
}

function CatalogAnalysisDialog({ analysis, initialGroupId, groups, subsections, close, saved }: { analysis: AnalysisDefinition | null; initialGroupId: string; groups: { id: string; name: string }[]; subsections: CatalogSubsection[]; close: () => void; saved: () => Promise<void> }) {
  const offlineRepository = useOfflineRepository();
  const [name, setName] = useState(analysis?.name ?? "");
  const [groupId, setGroupId] = useState(analysis?.groupId ?? initialGroupId);
  const [subsection, setSubsection] = useState(analysis?.subsection ?? "");
  const [resultType, setResultType] = useState<"numeric" | "qualitative" | "text">(analysis?.resultType ?? "numeric");
  const [sampleType, setSampleType] = useState(analysis?.sampleType ?? "");
  const [method, setMethod] = useState(analysis?.method ?? "");
  const [unit, setUnit] = useState(analysis?.unit ?? "");
  const [decimals, setDecimals] = useState(String(analysis?.decimals ?? 2));
  const [referenceLabel, setReferenceLabel] = useState(analysis?.reference === "Por definir" ? "" : analysis?.reference ?? "");
  const [referenceLow, setReferenceLow] = useState(analysis?.low === undefined ? "" : String(analysis.low));
  const [referenceHigh, setReferenceHigh] = useState(analysis?.high === undefined ? "" : String(analysis.high));
  const [criticalLow, setCriticalLow] = useState(analysis?.criticalLow === undefined ? "" : String(analysis.criticalLow));
  const [criticalHigh, setCriticalHigh] = useState(analysis?.criticalHigh === undefined ? "" : String(analysis.criticalHigh));
  const [options, setOptions] = useState(analysis?.qualitativeOptions?.join(", ") ?? "Negativo, Positivo");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const availableSubsections = subsections.filter((section) => section.groupId === groupId);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError("");
    if (name.trim().length < 2) return setError("Escribe el nombre del análisis.");
    if (sampleType.trim().length < 2) return setError("Indica el tipo de muestra.");
    const parsedOptions = options.split(",").map((option) => option.trim()).filter(Boolean);
    const range: Record<string, string | number> = { label: referenceLabel.trim() };
    if (referenceLow.trim()) range.low = Number(referenceLow);
    if (referenceHigh.trim()) range.high = Number(referenceHigh);
    // Solo el numérico necesita intervalo: sin límites no se puede marcar un
    // valor fuera de rango. En cualitativo y texto el valor normal es opcional.
    if (resultType === "numeric" && (!range.label || (range.low === undefined && range.high === undefined))) return setError("Indica el texto y al menos un límite de referencia.");
    const critical: Record<string, number> = {};
    if (criticalLow.trim()) critical.low = Number(criticalLow);
    if (criticalHigh.trim()) critical.high = Number(criticalHigh);
    setSaving(true);
    try {
      await catalogRequest(offlineRepository, { action: "analysis.save", analysisId: analysis?.id ?? null, groupId, subsection: subsection || null, name: name.trim(), resultType, sampleType: sampleType.trim(), method: method.trim() || null, unit: resultType === "numeric" ? unit.trim() || null : null, decimals: resultType === "numeric" ? Number(decimals) : null, qualitativeOptions: resultType === "qualitative" ? parsedOptions : null, referenceRanges: [range], criticalLimits: critical });
      await saved();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "No se pudo guardar el análisis.");
    } finally {
      setSaving(false);
    }
  }

  return <div className="dialog-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) close(); }}>
    <section className="dialog-card catalog-dialog" role="dialog" aria-modal="true" aria-labelledby="catalog-analysis-title">
      <div className="dialog-head"><div><p className="eyebrow">{analysis ? "Editar análisis" : "Nuevo análisis"}</p><h2 id="catalog-analysis-title">{analysis?.name ?? "Agregar al catálogo"}</h2><p>Los informes anteriores conservarán la información con la que fueron emitidos.</p></div><button className="icon-button" type="button" onClick={close} aria-label="Cerrar"><X /></button></div>
      <form onSubmit={submit}>
        <div className="dialog-fields"><label>Nombre del análisis<input autoFocus value={name} onChange={(event) => setName(event.target.value)} /></label><label>Grupo<select value={groupId} onChange={(event) => { setGroupId(event.target.value); setSubsection(""); }}>{groups.map((group) => <option value={group.id} key={group.id}>{group.name}</option>)}</select></label><label>Subgrupo<select value={subsection} onChange={(event) => setSubsection(event.target.value)}><option value="">Sin subgrupo</option>{availableSubsections.map((section) => <option key={section.id}>{section.name}</option>)}</select></label><label>Tipo de resultado<select value={resultType} onChange={(event) => setResultType(event.target.value as typeof resultType)}><option value="numeric">Numérico</option><option value="qualitative">Selección</option><option value="text">Texto libre</option></select></label><label>Tipo de muestra<input value={sampleType} onChange={(event) => setSampleType(event.target.value)} placeholder="Suero, sangre, orina…" /></label><label>Método<input value={method} onChange={(event) => setMethod(event.target.value)} /></label>{resultType === "numeric" && <><label>Unidad<input value={unit} onChange={(event) => setUnit(event.target.value)} placeholder="mg/dL, %, por campo…" /></label><label>Decimales<input type="number" min="0" max="8" value={decimals} onChange={(event) => setDecimals(event.target.value)} /></label></>}</div>
        {resultType === "numeric" && <fieldset className="clinical-fields"><legend>Valores normales</legend><label>Texto que aparecerá en el informe<input value={referenceLabel} onChange={(event) => setReferenceLabel(event.target.value)} placeholder="70 - 110 mg/dL" /></label><div className="dialog-fields"><label>Límite bajo<input type="number" step="any" value={referenceLow} onChange={(event) => setReferenceLow(event.target.value)} /></label><label>Límite alto<input type="number" step="any" value={referenceHigh} onChange={(event) => setReferenceHigh(event.target.value)} /></label><label>Crítico bajo (opcional)<input type="number" step="any" value={criticalLow} onChange={(event) => setCriticalLow(event.target.value)} /></label><label>Crítico alto (opcional)<input type="number" step="any" value={criticalHigh} onChange={(event) => setCriticalHigh(event.target.value)} /></label></div></fieldset>}
        {resultType === "qualitative" && <><label>Opciones permitidas<input value={options} onChange={(event) => setOptions(event.target.value)} placeholder="Negativo, Positivo" /><small className="form-help">Separa cada opción con una coma.</small></label><label>Valor normal para el informe (opcional)<input value={referenceLabel} onChange={(event) => setReferenceLabel(event.target.value)} placeholder="Negativo" /></label></>}
        {resultType === "text" && <label>Valor normal para el informe (opcional)<input value={referenceLabel} onChange={(event) => setReferenceLabel(event.target.value)} /></label>}
        {error && <p className="form-error" role="alert">{error}</p>}
        <div className="dialog-actions"><span>Disponible para nuevos registros al guardar</span><div><button type="button" className="button secondary" onClick={close}>Cancelar</button><button className="button primary" disabled={saving}>{saving ? "Guardando…" : "Guardar análisis"}</button></div></div>
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
      // La copia local se abre con la contraseña de la cuenta. Sin re-cifrarla
      // aquí, este equipo ya no podría abrir sus datos sin internet.
      await offlineRepository?.rewrapVault(password);
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
