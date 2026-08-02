"use client";

import { Activity, ArrowRight, Eye, EyeOff, ShieldCheck } from "lucide-react";
import { useState } from "react";
import { createClient, isSupabaseConfigured } from "@/lib/supabase/client";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [visible, setVisible] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function signIn(event: React.FormEvent) {
    event.preventDefault();
    setError("");
    if (!isSupabaseConfigured) {
      setError("La conexion segura todavia no fue configurada.");
      return;
    }
    setLoading(true);
    const { error: authError } = await createClient().auth.signInWithPassword({ email, password });
    setLoading(false);
    if (authError) return setError("Correo o contrasena incorrectos.");
    window.location.replace("/app");
  }

  async function recoverPassword() {
    setError("");
    if (!email) return setError("Ingresa tu correo para solicitar la recuperacion.");
    if (!isSupabaseConfigured) return setError("La recuperacion estara disponible al conectar Supabase.");
    setLoading(true);
    const { error: recoveryError } = await createClient().auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/reset-password`,
    });
    setLoading(false);
    if (recoveryError) return setError("No se pudo enviar la recuperacion. Intenta nuevamente.");
    setError("Si el correo esta registrado, recibira instrucciones para crear una nueva contrasena.");
  }

  return (
    <main className="login-shell">
      <section className="login-context" aria-label="Informacion del sistema">
        <div className="brand-mark"><Activity aria-hidden="true" /><span>LIMS Jose</span></div>
        <div className="login-message">
          <p className="eyebrow">Area de trabajo clinica</p>
          <h1>Resultados confiables.<br />Trazabilidad completa.</h1>
          <p>Gestion diaria de pacientes, ordenes, resultados e informes en un solo lugar.</p>
        </div>
        <div className="security-note"><ShieldCheck aria-hidden="true" /><span>Acceso restringido al personal autorizado</span></div>
      </section>
      <section className="login-panel">
        <form className="login-card" onSubmit={signIn}>
          <div>
            <p className="eyebrow">Bienvenido</p>
            <h2>Iniciar sesion</h2>
            <p className="muted">Ingresa con la cuenta asignada por el laboratorio.</p>
          </div>
          <label>Correo electronico
            <input type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="nombre@laboratorio.pe" required />
          </label>
          <label>Contrasena
            <span className="password-field">
              <input type={visible ? "text" : "password"} autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
              <button type="button" className="icon-button" onClick={() => setVisible(!visible)} aria-label={visible ? "Ocultar contrasena" : "Mostrar contrasena"}>{visible ? <EyeOff /> : <Eye />}</button>
            </span>
          </label>
          <button className="text-button login-recovery" type="button" onClick={recoverPassword}>Olvidaste tu contrasena?</button>
          {error && <p className="form-error" role="alert">{error}</p>}
          <button className="button primary wide" type="submit" disabled={loading}>{loading ? "Verificando..." : <>Ingresar <ArrowRight /></>}</button>
          <p className="login-help">Si no puedes ingresar, contacta al propietario del sistema.</p>
        </form>
      </section>
    </main>
  );
}
