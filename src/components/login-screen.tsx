"use client";

import { ArrowRight, Eye, EyeOff } from "lucide-react";
import Image from "next/image";
import { useState, type ReactNode } from "react";

const LOGO = "/logo-login.png";
const LOGO_ALT = "Laboratorio Clínico del Centro de Salud Acomayo";

/**
 * El marco de la pantalla de ingreso. Lo comparten la pantalla principal y la
 * que aparece sin internet: son el mismo trámite y deben verse igual, así que
 * hay un solo sitio donde cambiarlas.
 */
export function LoginShell({ children }: { children: ReactNode }) {
  return (
    <main className="login-shell">
      <section className="login-context" aria-label="Información del sistema">
        <Image className="login-context-image" src={LOGO} alt={LOGO_ALT} fill priority sizes="46vw" />
      </section>
      <section className="login-panel">{children}</section>
    </main>
  );
}

export function LoginCardVisual() {
  return (
    <div className="login-mobile-visual">
      <Image src={LOGO} alt={LOGO_ALT} width={1531} height={1563} sizes="(max-width: 820px) calc(100vw - 48px), 1px" />
    </div>
  );
}

/** Lo único que distingue una pantalla de la otra. */
export function ConnectionBadge({ online }: { online: boolean }) {
  return (
    <span className={online ? "login-status online" : "login-status offline"}>
      <span className="status-dot" />
      {online ? "Online" : "Offline"}
    </span>
  );
}

export function LoginScreen(props: {
  online: boolean;
  intro: string;
  notice?: string;
  error?: string;
  loading: boolean;
  submitLabel?: string;
  loadingLabel?: string;
  onSubmit(username: string, password: string): void;
  /** Solo con internet: recuperar la contraseña necesita enviar un correo. */
  onRecover?(username: string): void;
  footer?: ReactNode;
}) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [visible, setVisible] = useState(false);

  return (
    <LoginShell>
      <form
        className="login-card"
        onSubmit={(event) => {
          event.preventDefault();
          props.onSubmit(username, password);
        }}
      >
        <LoginCardVisual />
        <div>
          <ConnectionBadge online={props.online} />
          <h2>Iniciar sesión</h2>
          <p className="muted">{props.intro}</p>
        </div>
        <label>Usuario
          <input
            type="text"
            autoComplete="username"
            autoCapitalize="none"
            spellCheck={false}
            value={username}
            onChange={(event) => setUsername(event.target.value)}
            placeholder="laboratorio"
            required
          />
        </label>
        <label>Contraseña
          <span className="password-field">
            <input
              type={visible ? "text" : "password"}
              autoComplete="current-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              required
            />
            <button
              type="button"
              className="icon-button"
              onClick={() => setVisible(!visible)}
              aria-label={visible ? "Ocultar contraseña" : "Mostrar contraseña"}
            >{visible ? <EyeOff /> : <Eye />}</button>
          </span>
        </label>
        {props.onRecover && (
          <button className="text-button login-recovery" type="button" onClick={() => props.onRecover?.(username)}>
            ¿Olvidaste tu contraseña?
          </button>
        )}
        {props.notice && <p className="compat-note">{props.notice}</p>}
        {props.error && <p className="form-error" role="alert">{props.error}</p>}
        <button className="button primary wide" type="submit" disabled={props.loading}>
          {props.loading
            ? (props.loadingLabel ?? "Verificando…")
            : <>{props.submitLabel ?? "Ingresar"} <ArrowRight /></>}
        </button>
        {props.footer ?? <p className="login-help">Si no puedes ingresar, contacta al propietario del sistema.</p>}
      </form>
    </LoginShell>
  );
}
