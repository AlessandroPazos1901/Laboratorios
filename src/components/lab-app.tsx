"use client";

import {
  Activity, BarChart3, Bell, BookOpenCheck, Check, ChevronRight, CircleAlert,
  ClipboardList, Database, FileClock, FileDown, FlaskConical, History,
  Import, LayoutDashboard, LogOut, Menu, Microscope, PanelLeftClose, Plus, Printer, Search,
  Settings, ShieldCheck, TestTube2, Users, X,
} from "lucide-react";
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { analyses as demoAnalyses, auditEvents as demoAuditEvents, orders as demoOrders, patients as demoPatients, trend as demoTrend } from "@/lib/demo-data";
import { calculateAgeAt, flagNumericResult, formatStatus } from "@/lib/clinical";
import { createClient, isSupabaseConfigured } from "@/lib/supabase/client";
import type { LabData, LabOrder, OrderStatus, ResultValue } from "@/lib/types";

type View = "inicio" | "trabajo" | "pacientes" | "analitica" | "catalogo" | "importaciones" | "auditoria" | "configuracion";
const nav: { id: View; label: string; icon: typeof Activity }[] = [
  { id: "inicio", label: "Inicio", icon: LayoutDashboard },
  { id: "trabajo", label: "Trabajo diario", icon: ClipboardList },
  { id: "pacientes", label: "Pacientes", icon: Users },
  { id: "analitica", label: "Analítica", icon: BarChart3 },
  { id: "catalogo", label: "Catálogo", icon: TestTube2 },
  { id: "importaciones", label: "Importaciones", icon: Import },
  { id: "auditoria", label: "Auditoría", icon: History },
  { id: "configuracion", label: "Configuración", icon: Settings },
];

const statusOrder: OrderStatus[] = ["draft", "validated"];
const fmtDate = (date: string) => new Intl.DateTimeFormat("es-PE", { dateStyle: "medium", timeStyle: "short" }).format(new Date(date));

export function LabApp({ data, currentUser }: { data?: LabData; currentUser?: { fullName: string; role: string } }) {
  const router = useRouter();
  const sourcePatients = data?.patients ?? demoPatients;
  const sourceAnalyses = data?.analyses ?? demoAnalyses;
  const sourceAuditEvents = data?.auditEvents ?? demoAuditEvents;
  const sourceTrend = data?.trend ?? demoTrend;
  const sourceSummary = data?.summary ?? {
    orders: demoOrders.length,
    analyses: demoOrders.reduce((sum, order) => sum + order.results.length, 0),
    patients: new Set(demoOrders.map((order) => order.patientId)).size,
    delivered: demoOrders.filter((order) => order.status === "delivered").length,
    pendingValidation: demoOrders.filter((order) => order.status === "pending_validation").length,
    criticalValues: demoOrders.flatMap((order) => order.results).filter((result) => result.flag === "critical").length,
    medianTurnaroundMinutes: 54,
  };
  const [view, setView] = useState<View>("inicio");
  const sourceOrders = data?.orders ?? demoOrders;
  const [orderOverrides, setOrderOverrides] = useState<Record<string, LabOrder>>({});
  const orders = sourceOrders.map((order) => orderOverrides[order.id] ?? order);
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState((data?.orders ?? demoOrders)[0]?.id ?? "");
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
          <button className="icon-button notify" aria-label="Notificaciones"><Bell /><span>1</span></button>
          <button className="button primary" onClick={openNewRecord}><Plus /> Nuevo análisis</button>
        </header>
        {notice && <div className="toast" role="status"><Check />{notice}<button className="icon-button" onClick={() => setNotice("")}><X /></button></div>}
        <main className="workspace">
          {view === "inicio" && <Dashboard orders={orders} summary={sourceSummary} openOrder={openOrder} />}
          {view === "trabajo" && <WorkQueue orders={orders} selectedId={selectedId} setSelectedId={setSelectedId} updateOrder={updateOrder} notify={setNotice} />}
          {view === "pacientes" && <PatientsView patients={sourcePatients} orders={orders} trend={sourceTrend} openOrder={openOrder} newRecord={openNewRecord} />}
          {view === "analitica" && <AnalyticsView summary={sourceSummary} />}
          {view === "catalogo" && <CatalogView analyses={sourceAnalyses} />}
          {view === "importaciones" && <ImportView />}
          {view === "auditoria" && <AuditView events={sourceAuditEvents} />}
          {view === "configuracion" && <SettingsView connected={Boolean(data)} />}
        </main>
        {newRecordOpen && <NewRecordDialog
          patients={sourcePatients}
          analyses={sourceAnalyses}
          initialOccurredAt={newRecordAt}
          close={() => setNewRecordOpen(false)}
          notify={setNotice}
          onCreated={(id) => {
            setSelectedId(id);
            setView("trabajo");
            setNewRecordOpen(false);
          }}
        />}
      </div>
    </div>
  );
}

function PageHead({ eyebrow, title, text, action }: { eyebrow: string; title: string; text: string; action?: React.ReactNode }) {
  return <div className="page-head"><div><p className="eyebrow">{eyebrow}</p><h1>{title}</h1><p>{text}</p></div>{action}</div>;
}

function rpcMessage(message: string) {
  if (message.includes("invalid_dni")) return "El DNI debe tener exactamente 8 dígitos.";
  if (message.includes("patient_name_required")) return "Ingresa el nombre completo del paciente.";
  if (message.includes("analyses_required")) return "Selecciona al menos un análisis.";
  if (message.includes("concurrent_change")) return "Otro usuario modificó este registro. Recarga para continuar.";
  if (message.includes("all_results_required")) return "Completa todos los resultados antes de imprimir.";
  if (message.includes("reason_required")) return "Escribe un motivo de al menos 5 caracteres.";
  if (message.includes("reference_range_required")) return "Define al menos un intervalo de referencia antes de activar el análisis.";
  if (message.includes("qualitative_options_required")) return "Agrega las opciones válidas del resultado cualitativo.";
  if (message.includes("sample_type_required")) return "Indica el tipo de muestra.";
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
    notify("Registro creado. Ya puedes ingresar los resultados.");
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
        {existing ? <div className="patient-found"><Check /><span><small>Paciente encontrado</small><strong>{existing.fullName}</strong></span></div> :
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
  const visible = filter === "all" ? orders : orders.filter((o) => o.status === filter);
  return <>
    <PageHead eyebrow="Operación" title="Trabajo diario" text="Registra resultados y continúa rápidamente donde lo dejaste." />
    <div className="work-layout">
      <section className="panel order-list">
        <div className="filter-tabs"><button className={filter === "all" ? "active" : ""} onClick={() => setFilter("all")}>Todas</button>{statusOrder.map((s) => <button key={s} className={filter === s ? "active" : ""} onClick={() => setFilter(s)}>{formatStatus(s)}</button>)}</div>
        <div className="compact-search"><Search /><input placeholder="Filtrar cola…" aria-label="Filtrar cola de órdenes" /></div>
        <div className="queue">{visible.map((o) => <button key={o.id} className={o.id === selected?.id ? "queue-item selected" : "queue-item"} onClick={() => setSelectedId(o.id)}><span><strong className="mono">{o.code}</strong><b>{o.patientName}</b><small>{o.groups.join(" · ")}</small></span><span><em>{new Date(o.createdAt).toLocaleTimeString("es-PE", { hour: "2-digit", minute: "2-digit" })}</em><i className={`status-dot ${o.status}`} /></span></button>)}{visible.length === 0 && <div className="empty small"><ClipboardList /><p>No hay órdenes en esta cola.</p></div>}</div>
      </section>
      {selected ? <ResultWorkspace key={selected.id} order={selected} updateOrder={updateOrder} notify={notify} /> : <section className="panel"><div className="empty"><Microscope /><h3>Sin registros</h3><p>Crea el primero después de cargar el catálogo.</p></div></section>}
    </div>
  </>;
}

function ResultWorkspace({ order, updateOrder, notify }: { order: LabOrder; updateOrder: (o: LabOrder) => void; notify: (s: string) => void }) {
  const router = useRouter();
  const [draft, setDraft] = useState(order.results);
  const [saving, setSaving] = useState(false);
  const locked = order.status === "validated" || order.status === "delivered";
  const critical = draft.some((result) => result.flag === "critical");

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
    const lockVersion = locked ? order.lockVersion : await save();
    if (lockVersion === null) return;
    const reportResponse = await fetch(`/api/reports/${order.id}`, {
      method: "POST",
      cache: "no-store",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ expectedLockVersion: lockVersion }),
    });
    if (!reportResponse.ok) {
      const error = await reportResponse.json().catch(() => null) as { error?: string } | null;
      return notify(error?.error ? rpcMessage(error.error) : "No se pudo generar el informe. El registro sigue editable.");
    }
    const reportBlob = await reportResponse.blob();
    updateOrder({ ...order, results: draft, status: "validated", lockVersion: lockVersion + (locked ? 0 : 1) });
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
      <div className="result-toolbar"><div><h2>Resultados</h2><p>{draft.length} análisis · {order.groups.length} grupos</p></div><button className="button secondary" onClick={printReport} disabled={saving}><Printer />Imprimir</button></div>
      <div className="result-table table-wrap"><table><thead><tr><th>Análisis</th><th>Resultado</th><th>Unidad</th><th>Referencia</th><th>Bandera</th></tr></thead><tbody>{draft.map((result) => <tr key={result.id}><td><strong>{result.analyte}</strong><small className="block">{result.group} · {result.method}</small></td><td>{result.resultType === "qualitative" && result.qualitativeOptions?.length
        ? <select className={`result-input ${result.flag}`} value={result.value} disabled={locked} onChange={(event) => changeResult(result.id, event.target.value)} aria-label={`Resultado de ${result.analyte}`}><option value="">Seleccionar…</option>{result.qualitativeOptions.map((option) => <option key={option}>{option}</option>)}</select>
        : <input className={`result-input ${result.flag}`} value={result.value} disabled={locked} inputMode={result.resultType === "numeric" ? "decimal" : undefined} onChange={(event) => changeResult(result.id, event.target.value)} aria-label={`Resultado de ${result.analyte}`} />}</td><td className="mono">{result.unit}</td><td className="mono">{result.reference}</td><td><ResultFlag flag={result.flag} /></td></tr>)}</tbody></table></div>
      {critical && <div className="critical-notice"><CircleAlert /><span><strong>Hay un valor crítico</strong><small>Revísalo antes de imprimir. Esta advertencia no bloquea el registro.</small></span></div>}
      <div className="action-bar"><span><ShieldCheck />Cada cambio queda registrado con usuario y hora.</span><div>{!locked && <button className="button primary" onClick={save} disabled={saving}>{saving ? "Guardando…" : "Guardar resultados"}</button>}{locked && <button className="button secondary" onClick={amend}><FileClock />Corregir resultados</button>}</div></div>
    </>}
  </section>;
}

function ResultFlag({ flag }: { flag: ResultValue["flag"] }) {
  const label = { normal: "Normal", low: "Bajo", high: "Alto", critical: "Crítico", unreviewed: "No evaluado" }[flag];
  return <span className={`flag ${flag}`}>{!["normal", "unreviewed"].includes(flag) && <CircleAlert />}{label}</span>;
}

function PatientsView({ patients, orders, trend, openOrder, newRecord }: { patients: LabData["patients"]; orders: LabOrder[]; trend: LabData["trend"]; openOrder: (id: string) => void; newRecord: () => void }) {
  const [selectedId, setSelectedId] = useState(patients[0]?.id ?? "");
  const selected = patients.find((patient) => patient.id === selectedId) ?? patients[0] ?? null;
  if (!selected) return <><PageHead eyebrow="Registro maestro" title="Pacientes" text="Identidad única e historial de análisis." action={<button className="button primary" onClick={newRecord}><Plus />Nuevo análisis</button>} /><article className="panel"><div className="empty"><Users /><h3>No hay pacientes registrados</h3><p>Registra el primer paciente por DNI para comenzar.</p><button className="button primary" onClick={newRecord}>Registrar ahora</button></div></article></>;
  const patientOrders = orders.filter((o) => o.patientId === selected.id);
  const age = selected.birthDate ? calculateAgeAt(selected.birthDate, new Date().toISOString().slice(0, 10)) : null;
  return <>
    <PageHead eyebrow="Registro maestro" title="Pacientes" text="Identidad única e historial de análisis." action={<button className="button primary" onClick={newRecord}><Plus />Nuevo análisis</button>} />
    <div className="patients-layout">
      <section className="panel patient-list"><div className="compact-search"><Search /><input placeholder="DNI o nombre…" aria-label="Buscar paciente por DNI o nombre" /></div>{patients.map((p) => <button key={p.id} className={selected.id === p.id ? "patient-row active" : "patient-row"} onClick={() => setSelectedId(p.id)}><span className="avatar patient">{p.fullName.split(" ").slice(0, 2).map((x) => x[0]).join("")}</span><span><strong>{p.fullName}</strong><small className="mono">DNI {p.documentNumber}</small></span><ChevronRight /></button>)}</section>
      <section className="patient-detail">
        <article className="panel profile-panel"><div><span className="avatar patient large">{selected.fullName.split(" ").slice(0, 2).map((x) => x[0]).join("")}</span><span><p className="eyebrow">Paciente activo</p><h2>{selected.fullName}</h2><p className="mono">DNI {selected.documentNumber}</p></span></div><button className="button secondary">Editar datos</button><dl><div><dt>Edad</dt><dd>{age ? `${age.years} años` : "No registrada"}</dd></div><div><dt>Sexo</dt><dd>{{ F: "Femenino", M: "Masculino", X: "Otro", U: "No registrado" }[selected.sex]}</dd></div><div><dt>Nacimiento</dt><dd>{selected.birthDate || "No registrado"}</dd></div><div><dt>Teléfono</dt><dd>{selected.phone ?? "No registrado"}</dd></div></dl></article>
        <article className="panel"><div className="panel-head"><div><h2>Evolución de resultados</h2><p>Series compatibles por unidad y método</p></div></div>{trend.length ? <><TrendChart points={trend} /><div className="compat-note"><ShieldCheck />Serie compatible: misma unidad y método. Otros métodos se muestran por separado.</div></> : <div className="empty small"><BarChart3 /><p>Aún no hay resultados numéricos validados.</p></div>}</article>
        <article className="panel"><div className="panel-head"><div><h2>Historial de órdenes</h2><p>{patientOrders.length} registros encontrados</p></div></div>{patientOrders.length ? <OrderTable orders={patientOrders} onSelect={openOrder} /> : <div className="empty small"><ClipboardList /><p>Sin órdenes en el periodo actual.</p></div>}</article>
      </section>
    </div>
  </>;
}

function TrendChart({ points: values }: { points: LabData["trend"] }) {
  const min = Math.min(...values.map((point) => point.value));
  const max = Math.max(...values.map((point) => point.value));
  const spread = Math.max(1, max - min);
  const points = values.map((point, index) => `${40 + index * (540 / Math.max(1, values.length - 1))},${180 - ((point.value - min) / spread) * 140}`).join(" ");
  return <svg className="trend-chart" viewBox="0 0 620 220" role="img" aria-label="Evolución numérica del paciente"><line x1="40" y1="180" x2="580" y2="180" /><line x1="40" y1="110" x2="580" y2="110" /><line x1="40" y1="40" x2="580" y2="40" /><polyline points={points} fill="none" stroke="currentColor" strokeWidth="3" />{points.split(" ").map((point, index) => { const [x, y] = point.split(","); return <circle key={index} cx={x} cy={y} r="5" />; })}<text x="40" y="208">{values[0]?.date}</text><text x="500" y="208">{values.at(-1)?.date}</text><text x="7" y="184">{min}</text><text x="2" y="44">{max}</text></svg>;
}

function AnalyticsView({ summary }: { summary: LabData["summary"] }) {
  return <>
    <PageHead eyebrow="Inteligencia operativa" title="Analítica" text="Compara volumen, oportunidad y calidad por periodo." action={<button className="button secondary"><FileDown />Exportar</button>} />
    <section className="filter-bar"><label>Desde<input type="date" defaultValue="2026-07-01" /></label><label>Hasta<input type="date" defaultValue="2026-07-24" /></label><label>Grupo<select defaultValue=""><option value="">Todos los grupos</option><option>Hematología</option><option>Bioquímica</option></select></label><label>Comparar con<select><option>Periodo anterior equivalente</option><option>Periodo personalizado</option></select></label><button className="button primary">Aplicar filtros</button></section>
    <section className="metrics-grid analytics"><article className="metric"><span>Órdenes</span><strong>{summary.orders}</strong><small>Periodo seleccionado</small></article><article className="metric"><span>Análisis solicitados</span><strong>{summary.analyses}</strong><small>Periodo seleccionado</small></article><article className="metric"><span>Pacientes únicos</span><strong>{summary.patients}</strong><small>Con órdenes</small></article><article className="metric"><span>Informes entregados</span><strong>{summary.delivered}</strong><small>{summary.orders ? `${Math.round(summary.delivered / summary.orders * 100)}% del total` : "Sin órdenes"}</small></article></section>
    {summary.orders ? <section className="dashboard-grid"><article className="panel chart-panel"><div className="panel-head"><div><h2>Volumen comparado</h2><p>Órdenes por semana</p></div><span className="legend"><i className="teal" />Actual <i className="muted-line" />Anterior</span></div><ComparisonChart /></article><article className="panel"><div className="empty small"><BarChart3 /><p>La distribución aparecerá al procesar órdenes del periodo.</p></div></article></section> : <article className="panel"><div className="empty"><BarChart3 /><h3>Sin datos para el periodo</h3><p>Registra órdenes para habilitar comparaciones y distribuciones.</p></div></article>}
  </>;
}

function ComparisonChart() {
  return <svg className="comparison-chart" viewBox="0 0 680 220" role="img" aria-label="El periodo actual supera al anterior"><polyline points="20,170 120,140 220,150 320,95 420,110 520,62 640,76" className="previous" /><polyline points="20,158 120,124 220,130 320,76 420,88 520,38 640,50" className="current" /><text x="18" y="210">Sem 1</text><text x="205" y="210">Sem 2</text><text x="405" y="210">Sem 3</text><text x="600" y="210">Sem 4</text></svg>;
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

function ImportView() {
  const [file, setFile] = useState<File | null>(null);
  const [result, setResult] = useState<{ sheets: string[]; totalRows: number; warnings: string[] } | null>(null);
  const [loading, setLoading] = useState(false);
  async function preview() {
    if (!file) return;
    setLoading(true);
    const body = new FormData(); body.append("file", file);
    const response = await fetch("/api/import/preview", { method: "POST", body });
    const data = await response.json();
    setLoading(false);
    if (response.ok) setResult(data);
  }
  return <>
    <PageHead eyebrow="Ingreso controlado" title="Importaciones" text="Carga archivos privados con validación, vista previa y conciliación." />
    <div className="import-grid">
      <article className="panel upload-panel"><Import /><h2>Seleccionar archivo</h2><p>XLSX, XLSM o CSV · máximo 15 MB. Las macros nunca se ejecutan.</p><label className="file-button">Elegir archivo<input type="file" accept=".xlsx,.xlsm,.csv" onChange={(e) => { setFile(e.target.files?.[0] ?? null); setResult(null); }} /></label>{file && <div className="selected-file"><FileClock /><span><strong>{file.name}</strong><small>{(file.size / 1024 / 1024).toFixed(2)} MB</small></span><button className="icon-button" onClick={() => setFile(null)}><X /></button></div>}<button className="button primary" disabled={!file || loading} onClick={preview}>{loading ? "Analizando…" : "Generar vista previa"}</button></article>
      <article className="panel import-rules"><h2>Controles de importación</h2>{["El archivo se procesa en memoria y no se publica.", "Los DNI duplicados se envían a revisión.", "Cada fila conserva archivo, hoja y posición de origen.", "La confirmación final es idempotente y auditable."].map((x) => <p key={x}><Check />{x}</p>)}</article>
    </div>
    {result && <article className="panel preview-result"><div className="panel-head"><div><h2>Vista previa lista</h2><p>No se importó ningún dato todavía.</p></div><span className="status validated">Validado</span></div><dl><div><dt>Hojas detectadas</dt><dd>{result.sheets.length}</dd></div><div><dt>Filas aproximadas</dt><dd>{result.totalRows.toLocaleString("es-PE")}</dd></div><div><dt>Advertencias</dt><dd>{result.warnings.length}</dd></div></dl>{result.warnings.map((w) => <p className="warning-line" key={w}><CircleAlert />{w}</p>)}<button className="button primary" disabled>Confirmar importación (requiere Supabase)</button></article>}
  </>;
}

function AuditView({ events }: { events: LabData["auditEvents"] }) {
  return <>
    <PageHead eyebrow="Trazabilidad" title="Auditoría" text="Registro inmutable de acciones clínicas y administrativas." action={<button className="button secondary"><FileDown />Exportar registro</button>} />
    <section className="filter-bar"><label>Acción<select><option>Todas</option><option>Resultados</option><option>Validaciones</option><option>Catálogo</option></select></label><label>Usuario<select><option>Todos</option><option>Ana Abad</option><option>José Sacramento</option></select></label><label>Desde<input type="date" defaultValue="2026-07-24" /></label><div className="compact-search"><Search /><input placeholder="Orden o entidad…" aria-label="Buscar en auditoría por orden o entidad" /></div></section>
    <article className="panel audit-list">{events.map((event) => <div className="audit-event" key={event.id}><i><History /></i><div><div><strong>{event.action}</strong><span className="mono">{event.entity}</span></div><p>{event.summary}</p>{event.reason && <small>Motivo: {event.reason}</small>}</div><div><strong>{event.actor}</strong><small>{fmtDate(event.occurredAt)}</small></div></div>)}{events.length === 0 && <div className="empty"><History /><h3>Sin eventos registrados</h3><p>La auditoría se completará automáticamente con las primeras operaciones.</p></div>}</article>
  </>;
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
