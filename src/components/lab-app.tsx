"use client";

import {
  Activity, ArrowLeft, BarChart3, BookOpenCheck, CalendarDays, Check, ChevronRight, CircleAlert, Droplet,
  ClipboardList, Database, FileClock, FileDown, FlaskConical,
  Import, LayoutDashboard, LogOut, Menu, Microscope, PanelLeftClose, Plus, Printer, Search,
  Settings, ShieldCheck, TestTube2, Users, X,
} from "lucide-react";
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { buildPickerGroups, filterPickerAnalyses } from "@/lib/catalog-presets";
import { flagNumericResult, formatPatientAgeAt, formatStatus, groupResultsByBatch } from "@/lib/clinical";
import { createClient, isSupabaseConfigured } from "@/lib/supabase/client";
import type { LabData, LabOrder, OrderStatus, ResultValue } from "@/lib/types";

type View = "inicio" | "trabajo" | "pacientes" | "analitica" | "catalogo" | "configuracion";
const nav: { id: View; label: string; icon: typeof Activity }[] = [
  { id: "inicio", label: "Inicio", icon: LayoutDashboard },
  { id: "trabajo", label: "Trabajo diario", icon: ClipboardList },
  { id: "pacientes", label: "Pacientes", icon: Users },
  { id: "analitica", label: "Analítica", icon: BarChart3 },
  { id: "catalogo", label: "Catálogo", icon: TestTube2 },
  { id: "configuracion", label: "Configuración", icon: Settings },
];

const statusOrder: OrderStatus[] = ["draft", "validated"];
const fmtDate = (date: string) => new Intl.DateTimeFormat("es-PE", { dateStyle: "medium", timeStyle: "short" }).format(new Date(date));
const toLocalDateTimeInput = (value: string) => {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value.slice(0, 16);
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
};

export function LabApp({ data, currentUser }: { data: LabData; currentUser?: { fullName: string; role: string } }) {
  const router = useRouter();
  const sourcePatients = data.patients;
  const sourceAnalyses = data.analyses;
  const sourceSummary = data.summary;
  const [view, setView] = useState<View>("inicio");
  const sourceOrders = data.orders;
  const [orderOverrides, setOrderOverrides] = useState<Record<string, LabOrder>>({});
  const orders = sourceOrders.map((order) => orderOverrides[order.id] ?? order);
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState(data.orders[0]?.id ?? "");
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [notice, setNotice] = useState("");
  const [newRecordOpen, setNewRecordOpen] = useState(false);
  const [newRecordAt, setNewRecordAt] = useState("");

  const matches = useMemo(() => {
    const value = query.trim().toLocaleLowerCase("es");
    if (!value) return [];
    return [
      ...sourcePatients.filter((p) => `${p.documentNumber} ${p.fullName}`.toLowerCase().includes(value)).map((p) => ({ id: p.id, title: p.fullName, meta: `DNI ${p.documentNumber}`, kind: "Paciente" })),
      ...orders.filter((o) => `${o.code} ${o.documentNumber} ${o.patientName}`.toLowerCase().includes(value)).map((o) => ({ id: o.id, title: o.code, meta: `${o.patientName} · DNI ${o.documentNumber}`, kind: "Orden" })),
    ].slice(0, 6);
  }, [query, orders, sourcePatients]);

  function openOrder(id: string) {
    setNewRecordOpen(false);
    setSelectedId(id);
    setView("trabajo");
    setQuery("");
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
    <div className="app-shell">
      <aside className={`sidebar ${sidebarOpen ? "open" : ""}`}>
        <div className="sidebar-head">
          <div className="brand-mark"><Activity /><span>LIMS José</span></div>
          <button className="icon-button mobile-only" onClick={() => setSidebarOpen(false)} aria-label="Cerrar menú"><PanelLeftClose /></button>
        </div>
        <nav aria-label="Navegación principal">
          {nav.map(({ id, label, icon: Icon }) => (
            <button key={id} className={view === id ? "nav-item active" : "nav-item"} onClick={() => { setView(id); setSidebarOpen(false); }}>
              <Icon aria-hidden="true" /><span>{label}</span>{id === "trabajo" && <b>2</b>}
            </button>
          ))}
        </nav>
        <div className="sidebar-foot">
          <div className="lab-status"><span className="status-dot" /> Operación normal</div>
          <div className="account"><span className="avatar">{(currentUser?.fullName ?? "Usuario").split(" ").slice(0, 2).map((part) => part[0]).join("").toUpperCase()}</span><span><strong>{currentUser?.fullName ?? "Usuario"}</strong><small>Administrador</small></span><button className="icon-button" aria-label="Cerrar sesión" onClick={signOut}><LogOut /></button></div>
        </div>
      </aside>
      <div className="app-body">
        <header className="topbar">
          <button className="icon-button mobile-only" onClick={() => setSidebarOpen(true)} aria-label="Abrir menú"><Menu /></button>
          <div className="global-search">
            <Search aria-hidden="true" />
            <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Buscar por DNI, paciente u orden…" aria-label="Búsqueda global" />
            <kbd>Ctrl K</kbd>
            {matches.length > 0 && <div className="search-results">{matches.map((match) => <button key={`${match.kind}-${match.id}`} onClick={() => match.kind === "Orden" ? openOrder(match.id) : setView("pacientes")}><span><small>{match.kind}</small><strong>{match.title}</strong><em>{match.meta}</em></span><ChevronRight /></button>)}</div>}
          </div>
          <button className="button primary" onClick={openNewRecord}><Plus /> Nuevo análisis</button>
        </header>
        {notice && <div className="toast" role="status"><Check />{notice}<button className="icon-button" onClick={() => setNotice("")}><X /></button></div>}
        <main className="workspace">
          {view === "inicio" && <Dashboard orders={orders} summary={sourceSummary} openOrder={openOrder} />}
          {view === "trabajo" && (newRecordOpen ? <NewAnalysisWorkspace
            patients={sourcePatients}
            analyses={sourceAnalyses}
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
          /> : <WorkQueue orders={orders} selectedId={selectedId} setSelectedId={setSelectedId} updateOrder={updateOrder} notify={setNotice} />)}
          {view === "pacientes" && <PatientsView patients={sourcePatients} orders={orders} openOrder={openOrder} notify={setNotice} />}
          {view === "analitica" && <AnalyticsView orders={orders} openOrder={openOrder} />}
          {view === "catalogo" && <CatalogView analyses={sourceAnalyses} />}
          {view === "configuracion" && <SettingsView connected={Boolean(data)} />}
        </main>
      </div>
    </div>
  );
}

function PageHead({ eyebrow, title, text, action }: { eyebrow: string; title: string; text: string; action?: React.ReactNode }) {
  return <div className="page-head"><div><p className="eyebrow">{eyebrow}</p><h1>{title}</h1><p>{text}</p></div>{action}</div>;
}

function rpcMessage(message: string) {
  if (message.includes("register_daily_analyses") || message.includes("record_order_group_print") || message.includes("record_order_batch_print")) return "La base de datos no está actualizada. Aplica la migración de órdenes diarias y vuelve a intentarlo.";
  if (message.includes("invalid_dni")) return "El DNI debe tener exactamente 8 dígitos.";
  if (message.includes("patient_name_required")) return "Ingresa el nombre completo del paciente.";
  if (message.includes("analyses_required")) return "Selecciona al menos un análisis.";
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
  if (message.includes("invalid_patient_phone")) return "El teléfono no puede superar 30 caracteres.";
  if (message.includes("update_patient_details")) return "La base de datos no está actualizada. Aplica la migración de edición de pacientes.";
  if (message.includes("owner_required")) return "Solo una cuenta administradora puede aprobar el catálogo.";
  return "No se pudo completar la operación. Intenta nuevamente.";
}

function NewRecordDialog({ patients, analyses, initialOccurredAt, close, notify, onCreated }: { patients: LabData["patients"]; analyses: LabData["analyses"]; initialOccurredAt: string; close: () => void; notify: (message: string) => void; onCreated: (id: string) => void }) {
  const router = useRouter();
  const [dni, setDni] = useState("");
  const [name, setName] = useState("");
  const [occurredAt, setOccurredAt] = useState(initialOccurredAt);
  const [selectedVersions, setSelectedVersions] = useState<string[]>([]);
  const [analysisQuery, setAnalysisQuery] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const existing = patients.find((patient) => patient.documentNumber === dni);
  const visibleAnalyses = analyses.filter((analysis) =>
    analysis.active && analysis.versionId && `${analysis.code} ${analysis.name} ${analysis.group}`.toLocaleLowerCase("es").includes(analysisQuery.toLocaleLowerCase("es")),
  );

  function toggle(versionId: string) {
    setSelectedVersions((current) => current.includes(versionId) ? current.filter((id) => id !== versionId) : [...current, versionId]);
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError("");
    if (!/^\d{8}$/.test(dni)) return setError("El DNI debe tener exactamente 8 dígitos.");
    if (!existing && name.trim().length < 2) return setError("Ingresa el nombre completo del paciente.");
    if (selectedVersions.length === 0) return setError("Selecciona al menos un análisis.");
    setSaving(true);
    const supabase = createClient();
    let patientId = existing?.id;
    if (!patientId) {
      const patientResult = await supabase.rpc("upsert_simple_patient", { patient_dni: dni, patient_name: name.trim() });
      if (patientResult.error) {
        setSaving(false);
        return setError(rpcMessage(patientResult.error.message));
      }
      patientId = (patientResult.data as { id: string } | null)?.id;
    }
    if (!patientId) {
      setSaving(false);
      return setError("No se pudo identificar al paciente.");
    }
    const orderResult = await supabase.rpc("create_simple_order", {
      target_patient: patientId,
      selected_analysis_versions: selectedVersions,
      occurred_at: new Date(occurredAt).toISOString(),
    });
    setSaving(false);
    if (orderResult.error) return setError(rpcMessage(orderResult.error.message));
    const newOrderId = String(orderResult.data);
    onCreated(newOrderId);
    notify("Orden diaria guardada. Ya puedes ingresar los resultados.");
    router.refresh();
  }

  return <div className="dialog-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) close(); }}>
    <section className="dialog-card" role="dialog" aria-modal="true" aria-labelledby="new-record-title">
      <div className="dialog-head"><div><p className="eyebrow">Registro rápido</p><h2 id="new-record-title">Nuevo análisis</h2><p>Busca el DNI y selecciona los análisis realizados.</p></div><button className="icon-button" onClick={close} aria-label="Cerrar"><X /></button></div>
      <form onSubmit={submit}>
        <div className="dialog-fields">
          <label>DNI<input autoFocus inputMode="numeric" maxLength={8} value={dni} onChange={(event) => { setDni(event.target.value.replace(/\D/g, "").slice(0, 8)); setError(""); }} placeholder="8 dígitos" /></label>
          <label>Fecha y hora<input type="datetime-local" value={occurredAt} onChange={(event) => setOccurredAt(event.target.value)} /></label>
        </div>
        {existing ? <div className="patient-found"><Check /><span><small>Paciente encontrado</small><strong>{existing.fullName}</strong><small>Si ya tiene una orden en esa fecha, los análisis se agregarán a la misma.</small></span></div> :
          <label>Nombre completo<input value={name} onChange={(event) => setName(event.target.value)} placeholder="Nombres y apellidos" /></label>}
        <div className="analysis-picker">
          <div className="compact-search"><Search /><input value={analysisQuery} onChange={(event) => setAnalysisQuery(event.target.value)} placeholder="Buscar análisis o grupo…" aria-label="Buscar análisis" /></div>
          <div className="analysis-options">{visibleAnalyses.map((analysis) => <label className={selectedVersions.includes(analysis.versionId) ? "analysis-option selected" : "analysis-option"} key={analysis.id}><input type="checkbox" checked={selectedVersions.includes(analysis.versionId)} onChange={() => toggle(analysis.versionId)} /><span><strong>{analysis.name}</strong><small>{analysis.group} · {analysis.unit || analysis.resultType}</small></span></label>)}
            {visibleAnalyses.length === 0 && <div className="empty small"><Microscope /><p>No hay análisis disponibles. Carga primero el catálogo.</p></div>}
          </div>
        </div>
        {error && <p className="form-error" role="alert">{error}</p>}
        <div className="dialog-actions"><span>{selectedVersions.length} seleccionados</span><div><button type="button" className="button secondary" onClick={close}>Cancelar</button><button className="button primary" disabled={saving}>{saving ? "Creando…" : "Crear registro"}</button></div></div>
      </form>
    </section>
  </div>;
}

void NewRecordDialog;

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
    return <select className={className} value={value} disabled={disabled} onChange={(event) => onChange(event.target.value)} aria-label={label}>
      <option value="">Seleccionar...</option>
      {options.map((option) => <option key={option}>{option}</option>)}
    </select>;
  }

  const listId = `result-options-${id.replace(/[^a-zA-Z0-9_-]/g, "-")}`;
  return <span className="searchable-result">
    <input className={className} list={listId} value={value} disabled={disabled} onChange={(event) => onChange(event.target.value)} placeholder="Escribe para buscar..." aria-label={label} autoComplete="off" />
    <datalist id={listId}>{options.map((option) => <option value={option} key={option} />)}</datalist>
    {!disabled && <small>Escribe o selecciona una opción</small>}
  </span>;
}

function hasInvalidChoice(analysis: { qualitativeOptions?: string[] }, value: string) {
  return Boolean(analysis.qualitativeOptions?.length)
    && !analysis.qualitativeOptions!.includes(value.trim());
}

function NewAnalysisWorkspace({ patients, analyses, initialOccurredAt, cancel, notify, onCreated }: { patients: LabData["patients"]; analyses: LabData["analyses"]; initialOccurredAt: string; cancel: () => void; notify: (message: string) => void; onCreated: (id: string) => void }) {
  const router = useRouter();
  const [dni, setDni] = useState("");
  const [name, setName] = useState("");
  const [birthAt, setBirthAt] = useState("");
  const [sex, setSex] = useState<"F" | "M" | "X" | "">("");
  const [occurredAt, setOccurredAt] = useState(initialOccurredAt);
  const [selectedVersions, setSelectedVersions] = useState<string[]>([]);
  const [resultValues, setResultValues] = useState<Record<string, string>>({});
  const groups = useMemo(() => buildPickerGroups(analyses), [analyses]);
  const [selectedGroup, setSelectedGroup] = useState(groups[0]?.group ?? "");
  const [analysisQuery, setAnalysisQuery] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const existing = patients.find((patient) => patient.documentNumber === dni);
  const currentGroup = groups.find((group) => group.group === selectedGroup) ?? groups[0] ?? null;
  const visibleAnalyses = currentGroup ? filterPickerAnalyses(currentGroup.items, analysisQuery) : [];
  const visibleSelected = useMemo(() => {
    const all = groups.flatMap((group) => group.items);
    return selectedVersions
      .map((versionId) => all.find((analysis) => analysis.versionId === versionId))
      .filter((analysis): analysis is (typeof all)[number] => Boolean(analysis));
  }, [groups, selectedVersions]);

  function toggle(versionId: string) {
    if (selectedVersions.includes(versionId)) return removeSelected(versionId);
    setSelectedVersions((current) => [...current, versionId]);
  }

  function removeSelected(versionId: string) {
    setSelectedVersions((current) => current.filter((id) => id !== versionId));
    setResultValues((current) => {
      const next = { ...current };
      delete next[versionId];
      return next;
    });
  }

  function changeDni(rawValue: string) {
    const normalized = rawValue.replace(/\D/g, "").slice(0, 8);
    const matched = patients.find((patient) => patient.documentNumber === normalized);
    setDni(normalized);
    setError("");
    if (matched) {
      setName(matched.fullName);
      setBirthAt(toLocalDateTimeInput(matched.birthAt || matched.birthDate));
      setSex(matched.sex === "U" ? "" : matched.sex);
    } else if (existing) {
      setName("");
      setBirthAt("");
      setSex("");
    }
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError("");
    if (!/^\d{8}$/.test(dni)) return setError("El DNI debe tener exactamente 8 digitos.");
    if (!existing && name.trim().length < 2) return setError("Ingresa el nombre completo del paciente.");
    if (!sex) return setError("Selecciona el sexo del paciente.");
    if (!birthAt) return setError("Ingresa la fecha y hora de nacimiento.");
    const birthTime = new Date(birthAt).getTime();
    const analysisTime = new Date(occurredAt).getTime();
    if (!Number.isFinite(birthTime) || !Number.isFinite(analysisTime)) return setError("Revisa las fechas ingresadas.");
    if (birthTime > analysisTime) return setError("El nacimiento no puede ser posterior al análisis.");
    if (selectedVersions.length === 0) return setError("Selecciona al menos un análisis.");
    if (visibleSelected.some((analysis) => !resultValues[analysis.versionId]?.trim())) return setError("Completa el resultado de cada análisis seleccionado.");
    if (visibleSelected.some((analysis) => hasInvalidChoice(analysis, resultValues[analysis.versionId] ?? ""))) return setError("Selecciona un resultado válido de la lista.");
    if (visibleSelected.some((analysis) => analysis.resultType === "numeric" && !Number.isFinite(Number(resultValues[analysis.versionId])))) return setError("Revisa los resultados numéricos antes de guardar.");
    setSaving(true);
    const supabase = createClient();
    const patientResult = await supabase.rpc("upsert_patient_with_demographics", {
      patient_dni: dni,
      patient_name: (existing?.fullName ?? name).trim(),
      patient_birth_at: new Date(birthAt).toISOString(),
      patient_sex: sex,
    });
    if (patientResult.error) {
      setSaving(false);
      return setError(rpcMessage(patientResult.error.message));
    }
    const patientId = (patientResult.data as { id: string } | null)?.id;
    if (!patientId) {
      setSaving(false);
      return setError("No se pudo identificar al paciente.");
    }
    const orderResult = await supabase.rpc("register_daily_analyses", {
      target_patient: patientId,
      occurred_at: new Date(occurredAt).toISOString(),
      result_entries: visibleSelected.map((analysis) => ({
        analysis_version_id: analysis.versionId,
        payload: analysis.resultType === "numeric"
          ? { numeric_value: Number(resultValues[analysis.versionId]) }
          : analysis.resultType === "qualitative"
            ? { qualitative_value: resultValues[analysis.versionId].trim() }
            : { text_value: resultValues[analysis.versionId].trim() },
      })),
    });
    setSaving(false);
    if (orderResult.error) return setError(rpcMessage(orderResult.error.message));
    const newOrderId = String((orderResult.data as { order_id?: string } | null)?.order_id ?? "");
    if (!newOrderId) return setError("No se pudo identificar la orden guardada.");
    onCreated(newOrderId);
    notify("Análisis y resultados guardados en la orden diaria.");
    router.refresh();
  }

  return <section className="new-analysis-flow" aria-labelledby="new-analysis-title">
    <header className="registration-head">
      <button className="back-action" type="button" onClick={cancel}><ArrowLeft />Volver a trabajo diario</button>
      <div><p className="eyebrow">Registro de resultados</p><h1 id="new-analysis-title">Nuevo análisis</h1><p>Identifica al paciente, elige las pruebas y escribe sus resultados en una sola pantalla.</p></div>
      <div className="registration-progress"><span className={dni.length === 8 ? "done" : ""}>1<i>Paciente</i></span><span className={selectedVersions.length ? "done" : ""}>2<i>Análisis</i></span><span className={visibleSelected.length > 0 && visibleSelected.every((analysis) => resultValues[analysis.versionId]?.trim()) ? "done" : ""}>3<i>Resultados</i></span></div>
    </header>
    <form onSubmit={submit} className="registration-form">
      <section className="patient-entry-card">
        <div className="section-marker"><Users /><span><small>Paso 1</small><strong>Paciente y fecha</strong></span></div>
        <div className="patient-entry-fields">
          <label>DNI<input autoFocus inputMode="numeric" maxLength={8} value={dni} onChange={(event) => changeDni(event.target.value)} placeholder="00000000" /></label>
          {!existing && <label>Nombre completo<input value={name} onChange={(event) => setName(event.target.value)} placeholder="Nombres y apellidos" /></label>}
          <label>Sexo<select value={sex} onChange={(event) => setSex(event.target.value as typeof sex)}><option value="">Seleccionar</option><option value="F">Femenino</option><option value="M">Masculino</option><option value="X">Otro</option></select></label>
          <label>Fecha y hora de nacimiento<input type="datetime-local" max={occurredAt} value={birthAt} onChange={(event) => setBirthAt(event.target.value)} /></label>
          <label>Fecha y hora<div className="input-with-icon"><CalendarDays /><input type="datetime-local" value={occurredAt} onChange={(event) => setOccurredAt(event.target.value)} /></div></label>
        </div>
        {existing && <div className="patient-match"><Check /><span><small>Paciente encontrado</small><strong>{existing.fullName}</strong><em>Verifica sexo y nacimiento antes de guardar.</em></span></div>}
      </section>

      <div className="registration-board">
        <nav className="analysis-group-rail" aria-label="Grupos de análisis">
          <div className="rail-title"><small>Paso 2</small><strong>Elige un grupo</strong></div>
          {groups.map((group) => <button key={group.group} type="button" className={selectedGroup === group.group ? "active" : ""} onClick={() => { setSelectedGroup(group.group); setAnalysisQuery(""); }}>
            <AnalysisGlyph label={group.group} /><span><strong>{group.group}</strong><small>{group.items.length} pruebas</small></span><b>{group.items.filter((item) => selectedVersions.includes(item.versionId)).length || ""}</b>
          </button>)}
        </nav>

        <section className="analysis-tray">
          <div className="tray-head"><div><small>Grupo activo</small><h2>{currentGroup?.group ?? "Análisis"}</h2></div><div className="compact-search"><Search /><input value={analysisQuery} onChange={(event) => setAnalysisQuery(event.target.value)} placeholder="Buscar prueba..." aria-label="Buscar análisis" /></div></div>
          <div className="analysis-card-grid">
            {visibleAnalyses.map((analysis) => { const selected = selectedVersions.includes(analysis.versionId); return <button type="button" className={selected ? "analysis-card selected" : "analysis-card"} key={analysis.id} onClick={() => toggle(analysis.versionId)} aria-pressed={selected}>
              <AnalysisGlyph label={`${analysis.group} ${analysis.name}`} />
              <span><strong>{analysis.name}</strong><small>{analysis.subsection ?? analysis.code}</small><em>{analysis.unit || (analysis.resultType === "qualitative" ? "Cualitativo" : "Texto")}</em></span>
              <i>{selected ? <Check /> : <Plus />}</i>
            </button>; })}
            {visibleAnalyses.length === 0 && <div className="empty small"><Microscope /><p>No hay pruebas que coincidan con la búsqueda.</p></div>}
          </div>
        </section>

        <aside className="result-capture">
          <div className="capture-head"><div><small>Paso 3</small><h2>Registra resultados</h2></div><span>{visibleSelected.length}</span></div>
          {visibleSelected.length === 0 ? <div className="capture-empty"><TestTube2 /><strong>Selecciona una prueba</strong><p>Aparecerá aquí lista para ingresar su resultado.</p></div> : <div className="capture-list">{visibleSelected.map((analysis) => <article key={analysis.versionId} className="capture-row">
            <AnalysisGlyph label={`${analysis.group} ${analysis.name}`} />
            <div className="capture-copy"><strong>{analysis.name}</strong><small>{analysis.group} · {analysis.reference}</small></div>
            {analysis.qualitativeOptions?.length
              ? <ResultChoiceField id={analysis.versionId} value={resultValues[analysis.versionId] ?? ""} options={analysis.qualitativeOptions} onChange={(value) => setResultValues((current) => ({ ...current, [analysis.versionId]: value }))} label={`Resultado de ${analysis.name}`} />
              : <div className="capture-input"><input value={resultValues[analysis.versionId] ?? ""} inputMode={analysis.resultType === "numeric" ? "decimal" : undefined} onChange={(event) => setResultValues((current) => ({ ...current, [analysis.versionId]: event.target.value }))} placeholder="Resultado" aria-label={`Resultado de ${analysis.name}`} /><span>{analysis.unit}</span></div>}
            <button type="button" className="remove-analysis" onClick={() => removeSelected(analysis.versionId)} aria-label={`Quitar ${analysis.name}`}><X /></button>
          </article>)}</div>}
        </aside>
      </div>

      {error && <p className="form-error registration-error" role="alert">{error}</p>}
      <footer className="registration-actions"><span><ShieldCheck />Se guardará en una sola orden por paciente y día.</span><div><button type="button" className="button secondary" onClick={cancel}>Cancelar</button><button className="button primary" disabled={saving}>{saving ? "Guardando..." : `Guardar ${selectedVersions.length || ""} resultados`}</button></div></footer>
    </form>
  </section>;
}

function Dashboard({ orders, summary, openOrder }: { orders: LabOrder[]; summary: LabData["summary"]; openOrder: (id: string) => void }) {
  const criticalOrder = orders.find((order) => order.results.some((result) => result.flag === "critical"));
  const drafts = orders.filter((order) => order.status === "draft").length;
  const printed = orders.filter((order) => order.status === "validated" || order.status === "delivered").length;
  const cards = [
    ["Registros", String(summary.orders), "Periodo actual", ClipboardList],
    ["Análisis realizados", String(summary.analyses), "Resultados solicitados", FlaskConical],
    ["Pacientes", String(summary.patients), "Pacientes distintos", Users],
    ["Impresos", String(printed), "Listos para entregar", Printer],
  ] as const;
  return <>
    <PageHead eyebrow={new Intl.DateTimeFormat("es-PE", { dateStyle: "full" }).format(new Date())} title="Resumen del laboratorio" text="Actividad registrada en el sistema." action={<div className="period-control"><button className="active">Hoy</button><button>7 días</button><button>30 días</button></div>} />
    <section className="metrics-grid" aria-label="Indicadores principales">{cards.map(([label, value, delta, Icon]) => <article className="metric" key={label}><div><span>{label}</span><strong>{value}</strong><small>{delta}</small></div><Icon /></article>)}</section>
    <section className="dashboard-grid">
      <article className="panel chart-panel">
        <div className="panel-head"><div><h2>Actividad del laboratorio</h2><p>Órdenes recibidas y validadas por día</p></div><span className="legend"><i className="teal" />Recibidas <i className="blue" />Validadas</span></div>
        {orders.length ? <ActivityChart orders={orders} /> : <div className="empty small"><BarChart3 /><p>Aún no hay registros para graficar.</p></div>}
      </article>
      <article className="panel attention-panel">
        <div className="panel-head"><div><h2>Requieren atención</h2><p>Acciones clínicas pendientes</p></div></div>
        {summary.criticalValues > 0 && criticalOrder && <button onClick={() => openOrder(criticalOrder.id)} className="attention critical"><CircleAlert /><span><strong>{summary.criticalValues} {summary.criticalValues === 1 ? "valor crítico" : "valores críticos"}</strong><small>{criticalOrder.code}</small></span><ChevronRight /></button>}
        {drafts > 0 && <button className="attention neutral"><BookOpenCheck /><span><strong>{drafts} {drafts === 1 ? "registro pendiente" : "registros pendientes"}</strong><small>Faltan resultados o impresión</small></span><ChevronRight /></button>}
        {summary.criticalValues === 0 && drafts === 0 && <div className="empty small"><Check /><p>No hay acciones pendientes.</p></div>}
      </article>
    </section>
    <article className="panel">
      <div className="panel-head"><div><h2>Órdenes recientes</h2><p>Últimos movimientos del turno</p></div><button className="text-button">Ver trabajo diario <ChevronRight /></button></div>
      <OrderTable orders={orders} onSelect={openOrder} />
    </article>
  </>;
}

function ActivityChart({ orders }: { orders: LabOrder[] }) {
  const days = Array.from({ length: 7 }, (_, index) => {
    const date = new Date();
    date.setHours(0, 0, 0, 0);
    date.setDate(date.getDate() - (6 - index));
    const next = new Date(date);
    next.setDate(next.getDate() + 1);
    const count = orders.filter((order) => {
      const created = new Date(order.createdAt);
      return created >= date && created < next;
    }).length;
    return { label: new Intl.DateTimeFormat("es-PE", { weekday: "short" }).format(date), count };
  });
  const maximum = Math.max(1, ...days.map((day) => day.count));
  return <div className="bar-chart" aria-label="Gráfico: actividad semanal">
    {days.map((day) => <div className="bar-group" key={day.label}><div className="bars" title={`${day.count} registros`}><i style={{ height: `${Math.max(3, day.count / maximum * 100)}%` }} /></div><span>{day.label}</span></div>)}
  </div>;
}

function OrderTable({ orders, onSelect }: { orders: LabOrder[]; onSelect: (id: string) => void }) {
  return <div className="table-wrap"><table><thead><tr><th>Orden</th><th>Paciente</th><th>Grupos</th><th>Ingreso</th><th>Responsable</th><th>Estado</th><th /></tr></thead>
    <tbody>{orders.length ? orders.map((order) => <tr key={order.id} onClick={() => onSelect(order.id)} tabIndex={0}><td className="mono strong">{order.code}</td><td><strong>{order.patientName}</strong><small className="block mono">DNI {order.documentNumber}</small></td><td>{order.groups.join(" · ") || "Sin análisis"}</td><td>{new Date(order.createdAt).toLocaleTimeString("es-PE", { hour: "2-digit", minute: "2-digit" })}</td><td>{order.responsible}</td><td><span className={`status ${order.status}`}>{formatStatus(order.status)}</span></td><td><ChevronRight /></td></tr>) : <tr><td colSpan={7}><div className="empty small"><ClipboardList /><p>No hay órdenes registradas.</p></div></td></tr>}</tbody>
  </table></div>;
}

function WorkQueue({ orders, selectedId, setSelectedId, updateOrder, notify }: { orders: LabOrder[]; selectedId: string; setSelectedId: (id: string) => void; updateOrder: (o: LabOrder) => void; notify: (s: string) => void }) {
  const selected = orders.find((o) => o.id === selectedId) ?? orders[0] ?? null;
  const [filter, setFilter] = useState("all");
  const [search, setSearch] = useState("");
  const visible = (filter === "all" ? orders : orders.filter((o) => o.status === filter)).filter((order) => {
    const value = search.trim().toLocaleLowerCase("es");
    if (!value) return true;
    return `${order.code} ${order.patientName} ${order.documentNumber} ${order.groups.join(" ")}`
      .toLocaleLowerCase("es")
      .includes(value);
  });
  return <>
    <PageHead eyebrow="Operación" title="Trabajo diario" text="Registra resultados y continúa rápidamente donde lo dejaste." />
    <div className="work-layout">
      <section className="panel order-list">
        <div className="compact-search"><Search /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Filtrar por orden, DNI o paciente" aria-label="Filtrar cola por orden, DNI o paciente" /></div>
        <div className="filter-tabs"><button className={filter === "all" ? "active" : ""} onClick={() => setFilter("all")}>Todas</button>{statusOrder.map((s) => <button key={s} className={filter === s ? "active" : ""} onClick={() => setFilter(s)}>{formatStatus(s)}</button>)}</div>
        <div className="compact-search"><Search /><input placeholder="Filtrar cola…" aria-label="Filtrar cola de órdenes" /></div>
        <div className="queue">{visible.map((o) => <button key={o.id} className={o.id === selected?.id ? "queue-item selected" : "queue-item"} onClick={() => setSelectedId(o.id)}><span><strong className="mono">{o.code}</strong><b>{o.patientName}</b><small>{o.groups.join(" · ")}</small></span><span><em>{new Date(o.createdAt).toLocaleTimeString("es-PE", { hour: "2-digit", minute: "2-digit" })}</em><i className={`status-dot ${o.status}`} /></span></button>)}{visible.length === 0 && <div className="empty small"><ClipboardList /><p>No hay órdenes en esta cola.</p></div>}</div>
      </section>
      {selected ? <ResultWorkspace key={`${selected.id}:${selected.results.map((result) => result.orderAnalysisId).join(",")}`} order={selected} updateOrder={updateOrder} notify={notify} /> : <section className="panel"><div className="empty"><Microscope /><h3>Sin registros</h3><p>Crea el primero después de cargar el catálogo.</p></div></section>}
    </div>
  </>;
}

function ResultWorkspace({ order, updateOrder, notify }: { order: LabOrder; updateOrder: (o: LabOrder) => void; notify: (s: string) => void }) {
  const router = useRouter();
  const [draft, setDraft] = useState(order.results);
  const [saving, setSaving] = useState(false);
  const locked = order.status === "validated" || order.status === "delivered";
  const resultBatches = useMemo(() => groupResultsByBatch(draft, order.createdAt), [draft, order.createdAt]);
  const [selectedBatchId, setSelectedBatchId] = useState(resultBatches[0]?.batchId ?? "");
  const activeBatch = resultBatches.find((item) => item.batchId === selectedBatchId) ?? resultBatches[0];
  const critical = activeBatch?.results.some((result) => result.flag === "critical") ?? false;

  function changeResult(id: string, value: string) {
    setDraft((results) => results.map((result) => {
      if (result.id !== id) return result;
      if (result.resultType !== "numeric") return { ...result, value };
      const numericValue = Number(value);
      const flag = value.trim() && Number.isFinite(numericValue) ? flagNumericResult(numericValue, result) : "normal";
      return { ...result, value, numericValue, flag };
    }));
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
    setSaving(false);
    notify("Resultados guardados.");
    return lockVersion;
  }

  async function printReport() {
    if (!activeBatch) return;
    const lockVersion = locked ? order.lockVersion : await save();
    if (lockVersion === null) return;
    const legacyBatch = activeBatch.batchId.startsWith("legacy:");
    const reportResponse = await fetch(`/api/reports/${order.id}`, {
      method: "POST",
      cache: "no-store",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(legacyBatch
        ? { expectedLockVersion: lockVersion, group: activeBatch.group }
        : { expectedLockVersion: lockVersion, batchId: activeBatch.batchId }),
    });
    if (!reportResponse.ok) {
      const error = await reportResponse.json().catch(() => null) as { error?: string } | null;
      return notify(error?.error ? rpcMessage(error.error) : "No se pudo generar el informe. El registro sigue editable.");
    }
    const reportBlob = await reportResponse.blob();
    const nextStatus = (reportResponse.headers.get("X-Order-Status") as OrderStatus | null) ?? order.status;
    const nextLockVersion = Number(reportResponse.headers.get("X-Lock-Version") ?? lockVersion);
    updateOrder({ ...order, results: draft, status: nextStatus, lockVersion: nextLockVersion });
    const reportUrl = URL.createObjectURL(reportBlob);
    window.open(reportUrl, "_blank", "noopener,noreferrer");
    window.setTimeout(() => URL.revokeObjectURL(reportUrl), 60_000);
  }

  async function amend() {
    const reason = window.prompt("Motivo de la corrección:");
    if (!reason) return;
    const response = await createClient().rpc("amend_report", { target_order: order.id, amendment_reason: reason });
    if (response.error) return notify(rpcMessage(response.error.message));
    notify("Se creó una nueva revisión editable.");
    router.refresh();
  }

  return <section className="panel result-workspace">
    <div className="patient-strip"><div><span className="avatar patient">{order.patientName.split(" ").slice(0, 2).map((part) => part[0]).join("")}</span><span><small>{order.code}</small><strong>{order.patientName}</strong><em className="mono">DNI {order.documentNumber}</em></span></div><span className={`status ${order.status}`}>{formatStatus(order.status)}</span></div>
    <div className="workflow-rail">{statusOrder.map((status, index) => { const current = locked ? 1 : 0; return <div className={index <= current ? "done" : ""} key={status}><i>{index < current ? <Check /> : index + 1}</i><span>{formatStatus(status)}</span></div>; })}</div>
    {order.results.length === 0 ? <div className="empty"><Microscope /><h3>Este registro no tiene análisis</h3><p>Crea un nuevo registro seleccionando al menos un análisis.</p></div> : <>
      <div className="result-toolbar"><div><h2>Resultados por registro</h2><p>{draft.length} análisis · {resultBatches.length} tandas ordenadas por fecha</p></div></div>
      <nav className="result-group-menu" aria-label="Tandas realizadas">{resultBatches.map((item) => <button type="button" key={item.batchId} className={item.batchId === activeBatch?.batchId ? "active" : ""} onClick={() => setSelectedBatchId(item.batchId)}>
        <AnalysisGlyph label={item.group} /><span><strong>{item.group}</strong><small>{fmtDate(item.registeredAt)}</small></span><b>{item.results.length}</b>
      </button>)}</nav>
      {activeBatch && <div className="result-groups"><section className="result-group" aria-labelledby="active-result-group">
        <div className="result-group-head"><div><span>Tanda registrada · {fmtDate(activeBatch.registeredAt)}</span><h3 id="active-result-group">{activeBatch.group}</h3></div><button className="button secondary" onClick={printReport} disabled={saving}><Printer />Imprimir esta tanda</button></div>
        <div className="result-table table-wrap"><table><thead><tr><th>Análisis</th><th>Resultado</th><th>Unidad</th><th>Referencia</th><th>Bandera</th></tr></thead><tbody>{activeBatch.results.map((result) => <tr key={result.id}><td><strong>{result.analyte}</strong><small className="block">{result.method || "Método por definir"}</small><span className="performed-by-label"><Users />Realizado por {result.performedBy}</span></td><td>{result.qualitativeOptions?.length
          ? <ResultChoiceField id={result.id} className={`result-input ${result.flag}`} value={result.value} options={result.qualitativeOptions} disabled={locked} onChange={(value) => changeResult(result.id, value)} label={`Resultado de ${result.analyte}`} />
          : <input className={`result-input ${result.flag}`} value={result.value} disabled={locked} inputMode={result.resultType === "numeric" ? "decimal" : undefined} onChange={(event) => changeResult(result.id, event.target.value)} aria-label={`Resultado de ${result.analyte}`} />}</td><td className="mono">{result.unit}</td><td className="mono">{result.reference}</td><td><ResultFlag flag={result.flag} /></td></tr>)}</tbody></table></div>
      </section></div>}
      {critical && <div className="critical-notice"><CircleAlert /><span><strong>Hay un valor crítico</strong><small>Revísalo antes de imprimir. Esta advertencia no bloquea el registro.</small></span></div>}
      <div className="action-bar"><span><ShieldCheck />Cada cambio queda registrado con usuario y hora.</span><div>{!locked && <button className="button primary" onClick={save} disabled={saving}>{saving ? "Guardando…" : "Guardar resultados"}</button>}{locked && <button className="button secondary" onClick={amend}><FileClock />Corregir resultados</button>}</div></div>
    </>}
  </section>;
}

function ResultFlag({ flag }: { flag: ResultValue["flag"] }) {
  const label = { normal: "Normal", low: "Bajo", high: "Alto", critical: "Crítico", unreviewed: "No evaluado" }[flag];
  return <span className={`flag ${flag}`}>{!["normal", "unreviewed"].includes(flag) && <CircleAlert />}{label}</span>;
}

function AddPatientDialog({ close, notify }: { close: () => void; notify: (message: string) => void }) {
  const router = useRouter();
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
    const response = await createClient().rpc("upsert_simple_patient", { patient_dni: dni, patient_name: name.trim() });
    setSaving(false);
    if (response.error) return setError(rpcMessage(response.error.message));
    notify("Paciente agregado correctamente.");
    close();
    router.refresh();
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

type PatientImportPreview = {
  file: string;
  warning: string | null;
  sheets: { name: string; rows: number; headers: string[]; sampleRows: string[][] }[];
};

function PatientImportDialog({ close, notify }: { close: () => void; notify: (message: string) => void }) {
  const router = useRouter();
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<PatientImportPreview | null>(null);
  const [sheetName, setSheetName] = useState("");
  const [nameColumn, setNameColumn] = useState(0);
  const [dniColumn, setDniColumn] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<{ imported: number; failed: number; total: number; failures: { row: number; reason: string }[] } | null>(null);
  const activeSheet = preview?.sheets.find((sheet) => sheet.name === sheetName) ?? preview?.sheets[0] ?? null;

  function suggestColumns(sheet: PatientImportPreview["sheets"][number]) {
    const normalize = (value: string) => value.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLocaleLowerCase("es");
    const suggestedName = sheet.headers.findIndex((header) => /nombre|paciente|name/.test(normalize(header))) + 1;
    const suggestedDni = sheet.headers.findIndex((header) => /dni|documento|doc\.?/.test(normalize(header))) + 1;
    setNameColumn(suggestedName);
    setDniColumn(suggestedDni);
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
    setError("");
    if (!nextFile) return;
    setLoading(true);
    const form = new FormData();
    form.append("action", "preview");
    form.append("file", nextFile);
    const response = await fetch("/api/patients/import", { method: "POST", body: form });
    const data = await response.json() as PatientImportPreview & { error?: string };
    setLoading(false);
    if (!response.ok) return setError(data.error ?? "No se pudo leer el archivo.");
    setPreview(data);
    if (data.sheets[0]) chooseSheet(data.sheets[0].name, data);
  }

  async function importPatients() {
    if (!file || !activeSheet) return;
    if (!nameColumn || !dniColumn || nameColumn === dniColumn) return setError("Mapea columnas diferentes para Nombre y DNI.");
    setError("");
    setLoading(true);
    const form = new FormData();
    form.append("action", "import");
    form.append("file", file);
    form.append("sheet", activeSheet.name);
    form.append("nameColumn", String(nameColumn));
    form.append("dniColumn", String(dniColumn));
    const response = await fetch("/api/patients/import", { method: "POST", body: form });
    const data = await response.json() as { imported: number; failed: number; total: number; failures: { row: number; reason: string }[]; error?: string };
    setLoading(false);
    if (!response.ok) return setError(data.error ?? "No se pudo importar el archivo.");
    setResult(data);
    notify(`${data.imported} pacientes importados o actualizados.`);
    router.refresh();
  }

  const step = result ? 3 : preview ? 2 : 1;
  return <div className="dialog-backdrop" role="presentation">
    <section className="dialog-card patient-import-dialog" role="dialog" aria-modal="true" aria-labelledby="import-patients-title">
      <div className="import-dialog-head"><div><p className="eyebrow">Carga masiva</p><h2 id="import-patients-title">Importar pacientes</h2><p>Sube un Excel y relaciona únicamente Nombre y DNI.</p></div><button className="icon-button" type="button" onClick={close} aria-label="Cerrar"><X /></button></div>
      <div className="import-steps" aria-label="Progreso"><span className={step >= 1 ? "active" : ""}><b>1</b>Archivo</span><span className={step >= 2 ? "active" : ""}><b>2</b>Mapeo</span><span className={step >= 3 ? "active" : ""}><b>3</b>Resultado</span></div>
      <div className="patient-import-body">
        {!preview && !result && <div className="import-dropzone"><Import /><h3>Selecciona el archivo de pacientes</h3><p>Formato XLSX o XLSM · máximo 15 MB · primera fila con encabezados.</p><label className="button primary file-button">Elegir Excel<input type="file" accept=".xlsx,.xlsm" onChange={(event) => selectFile(event.target.files?.[0] ?? null)} /></label>{file && <small>{file.name}</small>}{loading && <div className="import-progress"><i /><span>Analizando archivo...</span></div>}</div>}
        {preview && !result && activeSheet && <>
          <div className="import-file-summary"><FileClock /><span><strong>{preview.file}</strong><small>{activeSheet.rows} filas en la hoja seleccionada</small></span><button className="text-button" type="button" onClick={() => selectFile(null)}>Cambiar archivo</button></div>
          {preview.warning && <p className="warning-line"><CircleAlert />{preview.warning}</p>}
          <div className="import-mapping-grid">
            <label>Hoja<select value={activeSheet.name} onChange={(event) => chooseSheet(event.target.value)}>{preview.sheets.map((sheet) => <option key={sheet.name}>{sheet.name}</option>)}</select></label>
            <label>Columna de nombre<select value={nameColumn} onChange={(event) => setNameColumn(Number(event.target.value))}><option value={0}>Seleccionar...</option>{activeSheet.headers.map((header, index) => <option value={index + 1} key={`${header}-${index}`}>{header}</option>)}</select></label>
            <label>Columna de DNI<select value={dniColumn} onChange={(event) => setDniColumn(Number(event.target.value))}><option value={0}>Seleccionar...</option>{activeSheet.headers.map((header, index) => <option value={index + 1} key={`${header}-${index}`}>{header}</option>)}</select></label>
          </div>
          <div className="import-preview-table table-wrap"><table><thead><tr><th>Fila</th><th>Nombre</th><th>DNI</th></tr></thead><tbody>{activeSheet.sampleRows.map((row, index) => <tr key={index}><td>{index + 2}</td><td>{nameColumn ? row[nameColumn - 1] || "—" : "Selecciona una columna"}</td><td className="mono">{dniColumn ? row[dniColumn - 1] || "—" : "Selecciona una columna"}</td></tr>)}</tbody></table></div>
          <p className="compat-note"><ShieldCheck />Los DNI existentes se actualizarán; no se crearán pacientes duplicados.</p>
        </>}
        {result && <div className="import-result"><span className="import-result-icon"><Check /></span><h3>Importación terminada</h3><p>{result.imported} pacientes importados o actualizados.</p><div><span><strong>{result.total}</strong> procesados</span><span><strong>{result.failed}</strong> con observaciones</span></div>{result.failures.length > 0 && <div className="import-failures"><strong>Filas que requieren revisión</strong>{result.failures.slice(0, 8).map((failure) => <p key={`${failure.row}-${failure.reason}`}><b>Fila {failure.row}</b>{failure.reason}</p>)}</div>}</div>}
        {error && <p className="form-error" role="alert">{error}</p>}
      </div>
      <div className="import-dialog-actions"><span>{preview && !result ? "Verifica la vista previa antes de continuar." : "Solo se procesan Nombre y DNI."}</span><div><button className="button secondary" type="button" onClick={close}>{result ? "Cerrar" : "Cancelar"}</button>{preview && !result && <button className="button primary" type="button" disabled={loading || !nameColumn || !dniColumn || nameColumn === dniColumn} onClick={importPatients}>{loading ? "Importando..." : "Importar pacientes"}</button>}</div></div>
    </section>
  </div>;
}

function EditPatientDialog({ patient, close, notify }: { patient: LabData["patients"][number]; close: () => void; notify: (message: string) => void }) {
  const router = useRouter();
  const [name, setName] = useState(patient.fullName);
  const [birthAt, setBirthAt] = useState(toLocalDateTimeInput(patient.birthAt || patient.birthDate));
  const [sex, setSex] = useState<"F" | "M" | "X" | "">(patient.sex === "U" ? "" : patient.sex);
  const [phone, setPhone] = useState(patient.phone ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError("");
    if (name.trim().length < 2) return setError("Ingresa el nombre completo del paciente.");
    if (!birthAt || !Number.isFinite(new Date(birthAt).getTime())) return setError("Ingresa una fecha y hora de nacimiento válida.");
    if (new Date(birthAt).getTime() > Date.now()) return setError("El nacimiento no puede estar en el futuro.");
    if (!sex) return setError("Selecciona el sexo del paciente.");
    if (phone.trim().length > 30) return setError("El teléfono no puede superar 30 caracteres.");

    setSaving(true);
    const response = await createClient().rpc("update_patient_details", {
      target_patient: patient.id,
      patient_name: name.trim(),
      patient_birth_at: new Date(birthAt).toISOString(),
      patient_sex: sex,
      patient_phone: phone.trim() || null,
    });
    setSaving(false);
    if (response.error) return setError(rpcMessage(response.error.message));
    notify("Datos del paciente actualizados.");
    close();
    router.refresh();
  }

  return <div className="dialog-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) close(); }}>
    <section className="dialog-card patient-edit-dialog" role="dialog" aria-modal="true" aria-labelledby="edit-patient-title">
      <div className="dialog-head"><div><p className="eyebrow">Datos maestros</p><h2 id="edit-patient-title">Editar paciente</h2><p>DNI {patient.documentNumber}</p></div><button className="icon-button" type="button" onClick={close} aria-label="Cerrar"><X /></button></div>
      <form onSubmit={submit}>
        <label>Nombre completo<input autoFocus value={name} onChange={(event) => setName(event.target.value)} /></label>
        <div className="dialog-fields">
          <label>Sexo<select value={sex} onChange={(event) => setSex(event.target.value as typeof sex)}><option value="">Seleccionar</option><option value="F">Femenino</option><option value="M">Masculino</option><option value="X">Otro</option></select></label>
          <label>Teléfono<input value={phone} maxLength={30} onChange={(event) => setPhone(event.target.value)} placeholder="Opcional" /></label>
        </div>
        <label>Fecha y hora de nacimiento<input type="datetime-local" max={toLocalDateTimeInput(new Date().toISOString())} value={birthAt} onChange={(event) => setBirthAt(event.target.value)} /></label>
        {error && <p className="form-error" role="alert">{error}</p>}
        <div className="dialog-actions"><span>El DNI permanece sin cambios.</span><div><button className="button secondary" type="button" onClick={close}>Cancelar</button><button className="button primary" disabled={saving}>{saving ? "Guardando..." : "Guardar cambios"}</button></div></div>
      </form>
    </section>
  </div>;
}

function PatientsView({ patients, orders, openOrder, notify }: { patients: LabData["patients"]; orders: LabOrder[]; openOrder: (id: string) => void; notify: (message: string) => void }) {
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
  const patientActions = <div className="patient-page-actions"><button className="button secondary" onClick={() => setImporting(true)}><Import />Importar</button><button className="button primary" onClick={() => setAdding(true)}><Plus />Agregar paciente</button></div>;
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
  const age = formatPatientAgeAt(selected.birthAt || selected.birthDate, new Date().toISOString());
  return <>
    <PageHead eyebrow="Registro maestro" title="Pacientes" text="Identidad única e historial de análisis." action={patientActions} />
    <div className="patients-layout">
      <section className="panel patient-list"><div className="compact-search"><Search /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="DNI o nombre…" aria-label="Buscar paciente por DNI o nombre" /></div>{visiblePatients.map((p) => <button key={p.id} className={selected.id === p.id ? "patient-row active" : "patient-row"} onClick={() => setSelectedId(p.id)}><span className="avatar patient">{p.fullName.split(" ").slice(0, 2).map((x) => x[0]).join("")}</span><span><strong>{p.fullName}</strong><small className="mono">DNI {p.documentNumber}</small></span><ChevronRight /></button>)}</section>
      <section className="patient-detail">
        <article className="panel profile-panel"><div><span className="avatar patient large">{selected.fullName.split(" ").slice(0, 2).map((x) => x[0]).join("")}</span><span><p className="eyebrow">Paciente activo</p><h2>{selected.fullName}</h2><p className="mono">DNI {selected.documentNumber}</p></span></div><button className="button secondary" onClick={() => setEditing(true)}>Editar datos</button><dl><div><dt>Edad</dt><dd>{age}</dd></div><div><dt>Sexo</dt><dd>{{ F: "Femenino", M: "Masculino", X: "Otro", U: "No registrado" }[selected.sex]}</dd></div><div><dt>Nacimiento</dt><dd>{selected.birthAt ? fmtDate(selected.birthAt) : selected.birthDate || "No registrado"}</dd></div><div><dt>Teléfono</dt><dd>{selected.phone ?? "No registrado"}</dd></div></dl></article>
        <article className="panel"><div className="panel-head patient-trend-head"><div><h2>Evolución de resultados</h2><p>Series compatibles por unidad y método</p></div>{numericSeries.length > 0 && <label>Análisis<select value={activeSeries?.key ?? ""} onChange={(event) => setSelectedSeriesKey(event.target.value)}>{numericSeries.map((series) => <option key={series.key} value={series.key}>{series.label}{series.unit ? ` (${series.unit})` : ""}</option>)}</select></label>}</div>{activeSeries ? <><TrendChart points={activeSeries.points} /><div className="compat-note"><ShieldCheck />{activeSeries.label} · {activeSeries.unit || "sin unidad"} · {activeSeries.method || "método no registrado"}</div></> : <div className="empty small"><BarChart3 /><p>Aún no hay resultados numéricos para graficar.</p></div>}</article>
        <article className="panel"><div className="panel-head"><div><h2>Historial de resultados</h2><p>{patientResults.length} resultados registrados</p></div></div>{patientResults.length ? <div className="table-wrap patient-results-table"><table><thead><tr><th>Fecha</th><th>Análisis</th><th>Resultado</th><th>Grupo</th><th>Orden</th></tr></thead><tbody>{patientResults.map(({ order, result }) => <tr key={`${order.id}-${result.orderAnalysisId}`}><td>{fmtDate(order.createdAt)}</td><td><strong>{result.analyte}</strong><small className="block">{result.method || "Método no registrado"}</small></td><td className="mono"><strong>{result.value || "Pendiente"}</strong>{result.unit ? ` ${result.unit}` : ""}</td><td>{result.group}</td><td><button className="table-link" type="button" onClick={() => openOrder(order.id)}>{order.code}</button></td></tr>)}</tbody></table></div> : <div className="empty small"><TestTube2 /><p>Este paciente todavía no tiene resultados.</p></div>}</article>
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
const median = (values: number[]) => {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : Math.round((sorted[middle - 1] + sorted[middle]) / 2);
};

function AnalyticsView({ orders, openOrder }: { orders: LabOrder[]; openOrder: (id: string) => void }) {
  const [openedAt] = useState(() => new Date().getTime());
  const latestDate = useMemo(() => orders.length
    ? orders.reduce((latest, order) => Math.max(latest, new Date(order.createdAt).getTime()), Number.NEGATIVE_INFINITY)
    : openedAt, [openedAt, orders]);
  const initialEnd = useMemo(() => new Date(latestDate), [latestDate]);
  const [start, setStart] = useState(() => dateInputValue(new Date(initialEnd.getTime() - 29 * DAY_MS)));
  const [end, setEnd] = useState(() => dateInputValue(initialEnd));
  const [group, setGroup] = useState("");
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
  const delivered = filteredOrders.filter((order) => order.status === "delivered" || order.status === "validated").length;
  const previousDelivered = previousOrders.filter((order) => order.status === "delivered" || order.status === "validated").length;
  const critical = filteredResults.filter((result) => result.flag === "critical").length;
  const turnaround = median(filteredOrders.map((order) => order.turnaroundMinutes).filter((value): value is number => typeof value === "number"));

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
  const chartData = Array.from({ length: bucketCount }, (_, index) => {
    const currentFrom = startDate.getTime() + index * bucketSize;
    const currentTo = index === bucketCount - 1 ? endDate.getTime() + 1 : currentFrom + bucketSize;
    const priorFrom = previousStart.getTime() + index * bucketSize;
    const priorTo = index === bucketCount - 1 ? previousEnd.getTime() + 1 : priorFrom + bucketSize;
    return {
      label: analyticsDate(new Date(currentFrom)),
      current: filteredOrders.filter((order) => { const value = new Date(order.createdAt).getTime(); return value >= currentFrom && value < currentTo; }).length,
      previous: previousOrders.filter((order) => { const value = new Date(order.createdAt).getTime(); return value >= priorFrom && value < priorTo; }).length,
    };
  });

  const groupDistribution = [...new Set(filteredResults.map((result) => result.group))].map((name) => ({ name, value: filteredResults.filter((result) => result.group === name).length })).sort((a, b) => b.value - a.value);
  const topAnalyses = [...new Set(filteredResults.map((result) => result.analyte))].map((name) => ({ name, value: filteredResults.filter((result) => result.analyte === name).length })).sort((a, b) => b.value - a.value).slice(0, 6);
  const statusDistribution = filteredOrders.map((order) => order.status).reduce<Record<string, number>>((totals, status) => ({ ...totals, [status]: (totals[status] ?? 0) + 1 }), {});
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
      <article className="metric"><div><span>Informes completados</span><strong>{delivered}</strong><small>{filteredOrders.length ? `${Math.round(delivered / filteredOrders.length * 100)}% de las órdenes` : "Sin órdenes"} · {comparisonLabel(delivered, previousDelivered)}</small></div><Check /></article>
    </section>
    {filteredOrders.length ? <>
      <section className="analytics-insights"><div><CircleAlert /><span><small>Resultados críticos</small><strong>{critical}</strong></span></div><div><FileClock /><span><small>Mediana de entrega</small><strong>{turnaround === null ? "Sin datos" : `${turnaround} min`}</strong></span></div><div><Activity /><span><small>Promedio por orden</small><strong>{(filteredResults.length / filteredOrders.length).toFixed(1)}</strong></span></div></section>
      <section className="analytics-grid">
        <article className="panel analytics-volume-panel"><div className="panel-head"><div><h2>Volumen comparado</h2><p>Órdenes del periodo actual contra el periodo anterior equivalente.</p></div><span className="legend"><i className="teal" />Actual <i className="muted-line" />Anterior</span></div><AnalyticsLineChart data={chartData} /></article>
        <article className="panel"><div className="panel-head"><div><h2>Distribución por grupo</h2><p>Resultados registrados</p></div></div><AnalyticsBars data={groupDistribution} emptyLabel="No hay grupos en este periodo." /></article>
        <article className="panel"><div className="panel-head"><div><h2>Análisis más realizados</h2><p>Los seis con mayor volumen</p></div></div><AnalyticsBars data={topAnalyses} emptyLabel="No hay análisis en este periodo." /></article>
        <article className="panel"><div className="panel-head"><div><h2>Estado de órdenes</h2><p>Situación al cierre del periodo</p></div></div><div className="status-breakdown">{Object.entries(statusDistribution).map(([status, value]) => <div className="status-row" key={status}><span className={`status ${status}`}>{formatStatus(status as OrderStatus)}</span><i><b style={{ width: `${value / filteredOrders.length * 100}%` }} /></i><strong>{value}</strong></div>)}</div></article>
      </section>
      {criticalRows.length > 0 && <article className="panel analytics-critical"><div className="panel-head"><div><h2>Resultados críticos recientes</h2><p>Requieren seguimiento clínico.</p></div></div><div className="table-wrap"><table><thead><tr><th>Orden</th><th>Paciente</th><th>Análisis</th><th>Resultado</th><th>Fecha</th><th /></tr></thead><tbody>{criticalRows.map(({ order, result }) => <tr key={`${order.id}-${result.id}`}><td className="mono strong">{order.code}</td><td>{order.patientName}</td><td>{result.analyte}<small className="table-subline">{result.group}</small></td><td><span className="status critical">{result.value} {result.unit}</span></td><td>{fmtDate(result.registeredAt || order.createdAt)}</td><td><button className="text-button" onClick={() => openOrder(order.id)}>Ver orden <ChevronRight /></button></td></tr>)}</tbody></table></div></article>}
    </> : <article className="panel"><div className="empty"><BarChart3 /><h3>Sin datos para el periodo</h3><p>Ajusta las fechas o registra órdenes para habilitar los indicadores.</p></div></article>}
  </>;
}

function AnalyticsLineChart({ data }: { data: { label: string; current: number; previous: number }[] }) {
  const maximum = Math.max(1, ...data.flatMap((point) => [point.current, point.previous]));
  const x = (index: number) => 50 + index * (600 / Math.max(1, data.length - 1));
  const y = (value: number) => 190 - value / maximum * 145;
  const currentPoints = data.map((point, index) => `${x(index)},${y(point.current)}`).join(" ");
  const previousPoints = data.map((point, index) => `${x(index)},${y(point.previous)}`).join(" ");
  const labelIndexes = new Set([0, Math.floor((data.length - 1) / 2), data.length - 1]);
  return <svg className="analytics-chart" viewBox="0 0 700 240" role="img" aria-label="Comparación de órdenes entre el periodo actual y el anterior">
    {[0, 0.5, 1].map((ratio) => <g key={ratio}><line x1="50" y1={y(maximum * ratio)} x2="650" y2={y(maximum * ratio)} /><text x="10" y={y(maximum * ratio) + 4}>{Math.round(maximum * ratio)}</text></g>)}
    <polyline points={previousPoints} className="previous" /><polyline points={currentPoints} className="current" />
    {data.map((point, index) => <g key={`${point.label}-${index}`}><circle cx={x(index)} cy={y(point.current)} r="4" className="current-point"><title>{point.label}: {point.current} órdenes</title></circle>{labelIndexes.has(index) && <text className="x-label" x={x(index)} y="225" textAnchor={index === 0 ? "start" : index === data.length - 1 ? "end" : "middle"}>{point.label}</text>}</g>)}
  </svg>;
}

function AnalyticsBars({ data, emptyLabel }: { data: { name: string; value: number }[]; emptyLabel: string }) {
  const maximum = Math.max(1, ...data.map((item) => item.value));
  if (!data.length) return <div className="empty small"><BarChart3 /><p>{emptyLabel}</p></div>;
  return <div className="analytics-bars">{data.map((item) => <div className="analytics-bar-row" key={item.name}><div><span title={item.name}>{item.name}</span><strong>{item.value}</strong></div><i><b style={{ width: `${item.value / maximum * 100}%` }} /></i></div>)}</div>;
}

function CatalogView({ analyses }: { analyses: LabData["analyses"] }) {
  const [query, setQuery] = useState("");
  const [group, setGroup] = useState("");
  const [selected, setSelected] = useState<LabData["analyses"][number] | null>(null);
  const groups = new Set(analyses.map((analysis) => analysis.group));
  const archived = analyses.filter((analysis) => !analysis.active).length;
  const visible = analyses.filter((analysis) =>
    (!group || analysis.group === group)
    && `${analysis.code} ${analysis.name}`.toLocaleLowerCase("es").includes(query.toLocaleLowerCase("es")),
  );
  return <>
    <PageHead eyebrow="Gobierno clínico" title="Catálogo de análisis" text="Los elementos importados deben revisarse antes de usarse en una orden." />
    <div className="catalog-summary"><span><FlaskConical /><strong>{analyses.length - archived}</strong> análisis activos</span><span><Database /><strong>{groups.size}</strong> grupos</span><span><BookOpenCheck /><strong>{archived}</strong> por revisar</span></div>
    <article className="panel"><div className="table-actions"><div className="compact-search"><Search /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Buscar código o análisis…" aria-label="Buscar en el catálogo" /></div><select value={group} onChange={(event) => setGroup(event.target.value)} aria-label="Filtrar catálogo por grupo"><option value="">Todos los grupos</option>{[...groups].sort().map((name) => <option key={name}>{name}</option>)}</select></div><div className="table-wrap"><table><thead><tr><th>Código</th><th>Análisis</th><th>Grupo</th><th>Tipo</th><th>Unidad</th><th>Método</th><th>Referencia</th><th>Estado</th><th /></tr></thead><tbody>{visible.map((a) => <tr key={a.id}><td className="mono strong">{a.code}</td><td><strong>{a.name}</strong></td><td>{a.group}</td><td>{a.active ? (a.resultType === "numeric" ? "Numérico" : a.resultType === "qualitative" ? "Cualitativo" : "Texto") : "Por definir"}</td><td className="mono">{a.unit || "—"}</td><td>{a.method || "—"}</td><td className="mono">{a.active ? a.reference : "Pendiente"}</td><td><span className={`status ${a.active ? "validated" : "pending_validation"}`}>{a.active ? "Activo" : "Revisión pendiente"}</span></td><td><button className="text-button" onClick={() => setSelected(a)}>{a.active ? "Nueva versión" : "Revisar"} <ChevronRight /></button></td></tr>)}</tbody></table></div></article>
    {selected && <CatalogApprovalDialog analysis={selected} close={() => setSelected(null)} />}
  </>;
}

function CatalogApprovalDialog({ analysis, close }: { analysis: LabData["analyses"][number]; close: () => void }) {
  const router = useRouter();
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

function SettingsView({ connected }: { connected: boolean }) {
  return <>
    <PageHead eyebrow="Administración" title="Configuración" text="Identidad del laboratorio, usuarios y políticas operativas." />
    <div className="settings-grid">
      <article className="panel settings-card"><FlaskConical /><div><h2>Identidad del laboratorio</h2><p>Nombre legal, RUC, dirección, logotipo y responsables de firma.</p><button className="text-button">Configurar <ChevronRight /></button></div></article>
      <article className="panel settings-card"><Users /><div><h2>Usuarios y acceso</h2><p>Los tres administradores activos tienen las mismas facultades.</p><button className="text-button">Ver usuarios <ChevronRight /></button></div></article>
      <article className="panel settings-card"><ShieldCheck /><div><h2>Seguridad y retención</h2><p>Sesiones, política de correcciones, respaldos y conservación de informes.</p><button className="text-button">Revisar <ChevronRight /></button></div></article>
      <article className="panel settings-card"><Database /><div><h2>Conexión de datos</h2><p>{connected ? "Supabase conectado con sesión y políticas RLS activas." : "Prototipo local con datos ficticios."}</p><span className={`status ${connected ? "validated" : "pending_validation"}`}>{connected ? "Conectado" : "Demostración"}</span></div></article>
    </div>
  </>;
}
