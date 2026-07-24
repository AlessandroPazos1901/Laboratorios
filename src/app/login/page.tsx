"use client";

import { Activity, ArrowRight, Eye, EyeOff, ShieldCheck } from "lucide-react";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient, isSupabaseConfigured } from "@/lib/supabase/client";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [visible, setVisible] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const demoEnabled = process.env.NEXT_PUBLIC_DEMO_MODE === "true";

  async function signIn(event: React.FormEvent) {
    event.preventDefault();
    setError("");
    if (!isSupabaseConfigured) {
      setError("La conexión segura todavía no fue configurada.");
      return;
    }
    setLoading(true);
    const { error: authError } = await createClient().auth.signInWithPassword({ email, password });
    setLoading(false);
    if (authError) return setError("Correo o contraseña incorrectos.");
    router.replace("/app");
    router.refresh();
  }

  return (
    <main className="login-shell">
      <section className="login-context" aria-label="Información del sistema">
        <div className="brand-mark"><Activity aria-hidden="true" /><span>LIMS José</span></div>
        <div className="login-message">
          <p className="eyebrow">Área de trabajo clínica</p>
          <h1>Resultados confiables.<br />Trazabilidad completa.</h1>
          <p>Gestión diaria de pacientes, órdenes, resultados e informes en un solo lugar.</p>
        </div>
        <div className="security-note"><ShieldCheck aria-hidden="true" /><span>Acceso restringido al personal autorizado</span></div>
      </section>
      <section className="login-panel">
        <form className="login-card" onSubmit={signIn}>
          <div>
            <p className="eyebrow">Bienvenido</p>
            <h2>Iniciar sesión</h2>
            <p className="muted">Ingresa con la cuenta asignada por el laboratorio.</p>
          </div>
          <label>Correo electrónico
            <input type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="nombre@laboratorio.pe" required />
          </label>
          <label>Contraseña
            <span className="password-field">
              <input type={visible ? "text" : "password"} autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
              <button type="button" className="icon-button" onClick={() => setVisible(!visible)} aria-label={visible ? "Ocultar contraseña" : "Mostrar contraseña"}>{visible ? <EyeOff /> : <Eye />}</button>
            </span>
          </label>
          {error && <p className="form-error" role="alert">{error}</p>}
          <button className="button primary wide" type="submit" disabled={loading}>{loading ? "Verificando…" : <>Ingresar <ArrowRight /></>}</button>
          {demoEnabled && (
            <button className="button secondary wide" type="button" onClick={() => router.push("/app")}>
              Revisar prototipo con datos ficticios
            </button>
          )}
          <p className="login-help">¿No puedes ingresar? Contacta al propietario del sistema.</p>
        </form>
      </section>
    </main>
  );
}
