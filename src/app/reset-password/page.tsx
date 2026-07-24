"use client";

import { Activity, Check, ShieldCheck } from "lucide-react";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient, isSupabaseConfigured } from "@/lib/supabase/client";

export default function ResetPasswordPage() {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);

  async function update(event: React.FormEvent) {
    event.preventDefault();
    setMessage("");
    if (password.length < 12) return setMessage("La contraseña debe tener al menos 12 caracteres.");
    if (password !== confirmation) return setMessage("Las contraseñas no coinciden.");
    if (!isSupabaseConfigured) return setMessage("Supabase todavía no está configurado.");
    setLoading(true);
    const { error } = await createClient().auth.updateUser({ password });
    setLoading(false);
    if (error) return setMessage("El enlace venció o no es válido. Solicita uno nuevo.");
    router.replace("/app");
  }

  return <main className="reset-shell">
    <form className="login-card reset-card" onSubmit={update}>
      <div className="brand-mark dark"><Activity /><span>LIMS José</span></div>
      <div><p className="eyebrow">Acceso seguro</p><h1>Nueva contraseña</h1><p className="muted">Crea una contraseña exclusiva para tu cuenta del laboratorio.</p></div>
      <label>Nueva contraseña<input type="password" autoComplete="new-password" minLength={12} value={password} onChange={(e) => setPassword(e.target.value)} required /></label>
      <label>Confirmar contraseña<input type="password" autoComplete="new-password" minLength={12} value={confirmation} onChange={(e) => setConfirmation(e.target.value)} required /></label>
      {message && <p className="form-error" role="alert">{message}</p>}
      <button className="button primary wide" disabled={loading}>{loading ? "Actualizando…" : <><Check />Guardar contraseña</>}</button>
      <p className="security-note reset"><ShieldCheck />El enlace solo puede usarse durante su vigencia.</p>
    </form>
  </main>;
}
