"use client";

import {
  Activity, Archive, BarChart3, Bell, BookOpenCheck, Check, ChevronRight, CircleAlert,
  ClipboardList, Clock3, Database, FileClock, FileDown, FlaskConical, Gauge, History,
  Import, LayoutDashboard, LogOut, Menu, Microscope, PanelLeftClose, Plus, Search,
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

const statusOrder: OrderStatus[] = ["draft", "pending_validation", "validated", "delivered"];
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
  const [orders, setOrders] = useState(data?.orders ?? demoOrders);
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState((data?.orders ?? demoOrders)[0]?.id ?? "");
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [notice, setNotice] = useState("");

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
    setOrders((all) => all.map((order) => order.id === next.id ? next : order));
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
          <div className="account"><span className="avatar">{(currentUser?.fullName ?? "Ana Abad").split(" ").slice(0, 2).map((part) => part[0]).join("").toUpperCase()}</span><span><strong>{currentUser?.fullName ?? "Ana Abad"}</strong><small>{currentUser?.role === "owner" ? "Propietario" : currentUser ? "Personal clínico" : "Tecnólogo médico"}</small></span><button className="icon-button" aria-label="Cerrar sesión" onClick={signOut}><LogOut /></button></div>
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
          <button className="button primary" onClick={() => { setView("trabajo"); setNotice("Seleccione o registre el paciente antes de crear la orden."); }}><Plus /> Nueva orden</button>
        </header>
        {notice && <div className="toast" role="status"><Check />{notice}<button className="icon-button" onClick={() => setNotice("")}><X /></button></div>}
        <main className="workspace">
          {view === "inicio" && <Dashboard orders={orders} summary={sourceSummary} openOrder={openOrder} />}
          {view === "trabajo" && <WorkQueue orders={orders} selectedId={selectedId} setSelectedId={setSelectedId} updateOrder={updateOrder} notify={setNotice} />}
          {view === "pacientes" && <PatientsView patients={sourcePatients} orders={orders} trend={sourceTrend} openOrder={openOrder} />}
          {view === "analitica" && <AnalyticsView summary={sourceSummary} />}
          {view === "catalogo" && <CatalogView analyses={sourceAnalyses} />}
          {view === "importaciones" && <ImportView />}
          {view === "auditoria" && <AuditView events={sourceAuditEvents} />}
          {view === "configuracion" && <SettingsView connected={Boolean(data)} />}
        </main>
      </div>
    </div>
  );
}

function PageHead({ eyebrow, title, text, action }: { eyebrow: string; title: string; text: string; action?: React.ReactNode }) {
  return <div className="page-head"><div><p className="eyebrow">{eyebrow}</p><h1>{title}</h1><p>{text}</p></div>{action}</div>;
}

function Dashboard({ orders, summary, openOrder }: { orders: LabOrder[]; summary: LabData["summary"]; openOrder: (id: string) => void }) {
  const delayed = orders.filter((order) => order.turnaroundMinutes !== undefined && order.turnaroundMinutes > 120).length;
  const criticalOrder = orders.find((order) => order.results.some((result) => result.flag === "critical"));
  const cards = [
    ["Órdenes del periodo", String(summary.orders), "Datos reales", ClipboardList],
    ["Análisis solicitados", String(summary.analyses), "Datos reales", FlaskConical],
    ["Pendientes de validar", String(summary.pendingValidation), "Requieren revisión", Clock3],
    ["Tiempo de respuesta", summary.medianTurnaroundMinutes === null ? "—" : `${summary.medianTurnaroundMinutes} min`, "Mediana del periodo", Gauge],
  ] as const;
  return <>
    <PageHead eyebrow="Viernes, 24 de julio" title="Buen día, Ana" text="Este es el estado operativo del laboratorio en tiempo real." action={<div className="period-control"><button className="active">Hoy</button><button>7 días</button><button>30 días</button></div>} />
    <section className="metrics-grid" aria-label="Indicadores principales">{cards.map(([label, value, delta, Icon]) => <article className="metric" key={label}><div><span>{label}</span><strong>{value}</strong><small>{delta}</small></div><Icon /></article>)}</section>
    <section className="dashboard-grid">
      <article className="panel chart-panel">
        <div className="panel-head"><div><h2>Actividad del laboratorio</h2><p>Órdenes recibidas y validadas por día</p></div><span className="legend"><i className="teal" />Recibidas <i className="blue" />Validadas</span></div>
        {orders.length ? <ActivityChart /> : <div className="empty small"><BarChart3 /><p>Aún no hay órdenes para graficar.</p></div>}
      </article>
      <article className="panel attention-panel">
        <div className="panel-head"><div><h2>Requieren atención</h2><p>Acciones clínicas pendientes</p></div></div>
        {summary.criticalValues > 0 && criticalOrder && <button onClick={() => openOrder(criticalOrder.id)} className="attention critical"><CircleAlert /><span><strong>{summary.criticalValues} {summary.criticalValues === 1 ? "valor crítico" : "valores críticos"}</strong><small>{criticalOrder.code}</small></span><ChevronRight /></button>}
        {delayed > 0 && <button className="attention warning"><Clock3 /><span><strong>{delayed} {delayed === 1 ? "orden demorada" : "órdenes demoradas"}</strong><small>Superaron el tiempo objetivo</small></span><ChevronRight /></button>}
        {summary.pendingValidation > 0 && <button className="attention neutral"><BookOpenCheck /><span><strong>{summary.pendingValidation} por validar</strong><small>Resultados listos para revisión</small></span><ChevronRight /></button>}
        {summary.criticalValues === 0 && delayed === 0 && summary.pendingValidation === 0 && <div className="empty small"><Check /><p>No hay acciones pendientes.</p></div>}
      </article>
    </section>
    <article className="panel">
      <div className="panel-head"><div><h2>Órdenes recientes</h2><p>Últimos movimientos del turno</p></div><button className="text-button">Ver trabajo diario <ChevronRight /></button></div>
      <OrderTable orders={orders} onSelect={openOrder} />
    </article>
  </>;
}

function ActivityChart() {
  return <div className="bar-chart" aria-label="Gráfico: actividad semanal">
    {[["Lun", 64, 51], ["Mar", 76, 65], ["Mié", 58, 52], ["Jue", 86, 71], ["Vie", 70, 56], ["Sáb", 38, 31], ["Dom", 22, 18]].map(([day, a, b]) => <div className="bar-group" key={String(day)}><div className="bars"><i style={{ height: `${a}%` }} /><i style={{ height: `${b}%` }} /></div><span>{day}</span></div>)}
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
    <PageHead eyebrow="Operación" title="Trabajo diario" text="Registra, revisa y libera los resultados del turno." />
    <div className="work-layout">
      <section className="panel order-list">
        <div className="filter-tabs"><button className={filter === "all" ? "active" : ""} onClick={() => setFilter("all")}>Todas</button>{statusOrder.map((s) => <button key={s} className={filter === s ? "active" : ""} onClick={() => setFilter(s)}>{formatStatus(s)}</button>)}</div>
        <div className="compact-search"><Search /><input placeholder="Filtrar cola…" aria-label="Filtrar cola de órdenes" /></div>
        <div className="queue">{visible.map((o) => <button key={o.id} className={o.id === selected?.id ? "queue-item selected" : "queue-item"} onClick={() => setSelectedId(o.id)}><span><strong className="mono">{o.code}</strong><b>{o.patientName}</b><small>{o.groups.join(" · ")}</small></span><span><em>{new Date(o.createdAt).toLocaleTimeString("es-PE", { hour: "2-digit", minute: "2-digit" })}</em><i className={`status-dot ${o.status}`} /></span></button>)}{visible.length === 0 && <div className="empty small"><ClipboardList /><p>No hay órdenes en esta cola.</p></div>}</div>
      </section>
      {selected ? <ResultWorkspace order={selected} updateOrder={updateOrder} notify={notify} /> : <section className="panel"><div className="empty"><Microscope /><h3>Sin órdenes registradas</h3><p>Crea la primera orden después de registrar el catálogo y un paciente.</p></div></section>}
    </div>
  </>;
}

function ResultWorkspace({ order, updateOrder, notify }: { order: LabOrder; updateOrder: (o: LabOrder) => void; notify: (s: string) => void }) {
  const [draft, setDraft] = useState(order.results);
  const [criticalAcknowledged, setCriticalAcknowledged] = useState(false);
  const [communication, setCommunication] = useState("");
  const locked = order.status === "validated" || order.status === "delivered";
  const critical = draft.some((r) => r.flag === "critical");

  function changeResult(id: string, value: string) {
    setDraft((results) => results.map((result) => {
      if (result.id !== id) return result;
      const numericValue = Number(value);
      const flag = Number.isFinite(numericValue) ? flagNumericResult(numericValue, result) : result.flag;
      return { ...result, value, numericValue, flag };
    }));
  }
  function save() { updateOrder({ ...order, results: draft }); notify("Borrador guardado con trazabilidad."); }
  function validate() {
    if (critical && (!criticalAcknowledged || communication.trim().length < 5)) return notify("Confirme y documente la comunicación del valor crítico.");
    updateOrder({ ...order, results: draft, status: "validated" });
    notify("Resultados validados. Se creó la versión clínica 1.");
  }
  return <section className="panel result-workspace">
    <div className="patient-strip"><div><span className="avatar patient">{order.patientName.split(" ").slice(0, 2).map((x) => x[0]).join("")}</span><span><small>{order.code}</small><strong>{order.patientName}</strong><em className="mono">DNI {order.documentNumber}</em></span></div><span className={`status ${order.status}`}>{formatStatus(order.status)}</span></div>
    <div className="workflow-rail">{statusOrder.map((status, index) => { const current = statusOrder.indexOf(order.status); return <div className={index <= current ? "done" : ""} key={status}><i>{index < current ? <Check /> : index + 1}</i><span>{formatStatus(status)}</span></div>; })}</div>
    {order.results.length === 0 ? <div className="empty"><Microscope /><h3>Resultados aún no registrados</h3><p>Seleccione los análisis solicitados para comenzar la captura.</p><button className="button primary"><Plus />Agregar análisis</button></div> : <>
      <div className="result-toolbar"><div><h2>Captura de resultados</h2><p>{draft.length} analitos · {order.groups.length} grupos</p></div><button className="button secondary" onClick={() => window.open(`/api/reports/${order.id}`, "_blank")} disabled={order.status === "draft"}><FileDown />Informe PDF</button></div>
      <div className="result-table table-wrap"><table><thead><tr><th>Análisis</th><th>Resultado</th><th>Unidad</th><th>Referencia</th><th>Bandera</th></tr></thead><tbody>{draft.map((result) => <tr key={result.id}><td><strong>{result.analyte}</strong><small className="block">{result.group} · {result.method}</small></td><td><input className={`result-input ${result.flag}`} value={result.value} disabled={locked} onChange={(e) => changeResult(result.id, e.target.value)} aria-label={`Resultado de ${result.analyte}`} /></td><td className="mono">{result.unit}</td><td className="mono">{result.reference}</td><td><ResultFlag flag={result.flag} /></td></tr>)}</tbody></table></div>
      {critical && !locked && <div className="critical-box"><CircleAlert /><div><h3>Valor crítico detectado</h3><p>Antes de validar, confirme la revisión y registre a quién se comunicó el resultado.</p><label className="checkbox"><input type="checkbox" checked={criticalAcknowledged} onChange={(e) => setCriticalAcknowledged(e.target.checked)} />He revisado el valor y confirmé la identidad del paciente.</label><label>Registro de comunicación<input value={communication} onChange={(e) => setCommunication(e.target.value)} placeholder="Ej.: Dra. Pérez, 10:48, llamada telefónica" /></label></div></div>}
      {critical && locked && <div className="critical-record"><ShieldCheck /><span><strong>Valor crítico revisado y comunicado</strong><small>La evidencia pertenece a la revisión validada y ya no puede editarse.</small></span></div>}
      <div className="action-bar"><span><ShieldCheck />Los cambios quedan registrados con usuario y hora.</span><div>{!locked && <><button className="button secondary" onClick={save}>Guardar borrador</button><button className="button primary" onClick={validate}><BookOpenCheck />Validar resultados</button></>}{locked && <button className="button secondary"><FileClock />Solicitar corrección</button>}</div></div>
    </>}
  </section>;
}

function ResultFlag({ flag }: { flag: ResultValue["flag"] }) {
  const label = { normal: "Normal", low: "Bajo", high: "Alto", critical: "Crítico" }[flag];
  return <span className={`flag ${flag}`}>{flag !== "normal" && <CircleAlert />}{label}</span>;
}

function PatientsView({ patients, orders, trend, openOrder }: { patients: LabData["patients"]; orders: LabOrder[]; trend: LabData["trend"]; openOrder: (id: string) => void }) {
  const [selectedId, setSelectedId] = useState(patients[0]?.id ?? "");
  const selected = patients.find((patient) => patient.id === selectedId) ?? patients[0] ?? null;
  if (!selected) return <><PageHead eyebrow="Registro maestro" title="Pacientes" text="Identidad única, historial de órdenes y evolución clínica." action={<button className="button primary"><Plus />Nuevo paciente</button>} /><article className="panel"><div className="empty"><Users /><h3>No hay pacientes registrados</h3><p>Registra el primer paciente por DNI para comenzar.</p></div></article></>;
  const patientOrders = orders.filter((o) => o.patientId === selected.id);
  const age = selected.birthDate ? calculateAgeAt(selected.birthDate, new Date().toISOString().slice(0, 10)) : null;
  return <>
    <PageHead eyebrow="Registro maestro" title="Pacientes" text="Identidad única, historial de órdenes y evolución clínica." action={<button className="button primary"><Plus />Nuevo paciente</button>} />
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
  const groups = new Set(analyses.map((analysis) => analysis.group));
  const archived = analyses.filter((analysis) => !analysis.active).length;
  return <>
    <PageHead eyebrow="Gobierno clínico" title="Catálogo de análisis" text="Versiona métodos, unidades e intervalos sin alterar el historial." action={<button className="button primary"><Plus />Nuevo análisis</button>} />
    <div className="catalog-summary"><span><FlaskConical /><strong>{analyses.length - archived}</strong> análisis activos</span><span><Database /><strong>{groups.size}</strong> grupos</span><span><Archive /><strong>{archived}</strong> archivados</span></div>
    <article className="panel"><div className="table-actions"><div className="compact-search"><Search /><input placeholder="Buscar código o análisis…" aria-label="Buscar en el catálogo" /></div><select aria-label="Filtrar catálogo por grupo"><option>Todos los grupos</option><option>Hematología</option><option>Bioquímica</option></select></div><div className="table-wrap"><table><thead><tr><th>Código</th><th>Análisis</th><th>Grupo</th><th>Tipo</th><th>Unidad</th><th>Método</th><th>Referencia</th><th>Estado</th></tr></thead><tbody>{analyses.map((a) => <tr key={a.id}><td className="mono strong">{a.code}</td><td><strong>{a.name}</strong></td><td>{a.group}</td><td>{a.resultType === "numeric" ? "Numérico" : a.resultType === "qualitative" ? "Cualitativo" : "Texto"}</td><td className="mono">{a.unit || "—"}</td><td>{a.method}</td><td className="mono">{a.reference}</td><td><span className="status validated">Activo</span></td></tr>)}</tbody></table></div></article>
  </>;
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
      <article className="panel settings-card"><Users /><div><h2>Usuarios y acceso</h2><p>La cuenta propietaria administra usuarios; el personal comparte facultades clínicas.</p><button className="text-button">Administrar <ChevronRight /></button></div></article>
      <article className="panel settings-card"><ShieldCheck /><div><h2>Seguridad y retención</h2><p>Sesiones, política de correcciones, respaldos y conservación de informes.</p><button className="text-button">Revisar <ChevronRight /></button></div></article>
      <article className="panel settings-card"><Database /><div><h2>Conexión de datos</h2><p>{connected ? "Supabase conectado con sesión y políticas RLS activas." : "Prototipo local con datos ficticios."}</p><span className={`status ${connected ? "validated" : "pending_validation"}`}>{connected ? "Conectado" : "Demostración"}</span></div></article>
    </div>
  </>;
}
