"use client";

import { ArrowRight, Eye, EyeOff } from "lucide-react";
import Image from "next/image";
import { useState } from "react";
import { createClient, isSupabaseConfigured, resolveLoginEmail } from "@/lib/supabase/client";

export default function LoginPage() {
  const [username, setUsername] = useState("");
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
    const email = await resolveLoginEmail(username);
    const { error: authError } = email
      ? await createClient().auth.signInWithPassword({ email, password })
      : { error: new Error("unknown_user") };
    setLoading(false);
    if (authError) return setError("Usuario o contrasena incorrectos.");
    window.location.replace("/app");
  }

  async function recoverPassword() {
    setError("");
    if (!username) return setError("Ingresa tu usuario para solicitar la recuperacion.");
    if (!isSupabaseConfigured) return setError("La recuperacion de contrasena aun no esta disponible. Comunicate con el administrador.");
    setLoading(true);
    const email = await resolveLoginEmail(username);
    const { error: recoveryError } = email
      ? await createClient().auth.resetPasswordForEmail(email, { redirectTo: `${window.location.origin}/reset-password` })
      : { error: null };
    setLoading(false);
    if (recoveryError) return setError("No se pudo enviar la recuperacion. Intenta nuevamente.");
    setError("Si el usuario esta registrado, recibira instrucciones en su correo para crear una nueva contrasena.");
  }

  return (
    <main className="login-shell">
      <section className="login-context" aria-label="Informacion del sistema">
        <Image
          className="login-context-image"
          src="/logo-login.png"
          alt="Laboratorio Clinico del Centro de Salud Acomayo"
          fill
          priority
          sizes="46vw"
        />
      </section>
      <section className="login-panel">
        <form className="login-card" onSubmit={signIn}>
          <div className="login-mobile-visual">
            <Image
              src="/logo-login.png"
              alt="Laboratorio Clinico del Centro de Salud Acomayo"
              width={1531}
              height={1563}
              sizes="(max-width: 820px) calc(100vw - 48px), 1px"
            />
          </div>
          <div>
            <p className="eyebrow">Bienvenido</p>
            <h2>Iniciar sesion</h2>
            <p className="muted">Ingresa con la cuenta compartida autorizada del laboratorio.</p>
          </div>
          <label>Usuario
            <input type="text" autoComplete="username" autoCapitalize="none" spellCheck={false} value={username} onChange={(e) => setUsername(e.target.value)} placeholder="laboratorio" required />
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
