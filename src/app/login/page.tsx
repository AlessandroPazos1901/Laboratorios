"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { LoginScreen } from "@/components/login-screen";
import { createClient, isSupabaseConfigured, resolveLoginEmail } from "@/lib/supabase/client";
import { handOffCredentials } from "@/lib/offline/handoff";
import { OFFLINE_MODE_ENABLED } from "@/lib/offline/types";

export default function LoginPage() {
  const router = useRouter();
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function signIn(username: string, password: string) {
    setError("");
    if (!isSupabaseConfigured) return setError("La conexión segura todavía no fue configurada.");
    setLoading(true);
    const email = await resolveLoginEmail(username);
    const { error: authError } = email
      ? await createClient().auth.signInWithPassword({ email, password })
      : { error: new Error("unknown_user") };
    if (authError) {
      setLoading(false);
      return setError("Usuario o contraseña incorrectos.");
    }
    // Con réplica local, /app necesita esta misma contraseña para abrir la copia
    // cifrada. Se le pasa por memoria y se navega sin recargar, que es lo que
    // conserva ese dato; recargando se perdería y volvería a pedir el ingreso.
    if (OFFLINE_MODE_ENABLED) {
      handOffCredentials(username, password);
      router.push("/app");
      return;
    }
    setLoading(false);
    window.location.replace("/app");
  }

  async function recoverPassword(username: string) {
    setError("");
    if (!username) return setError("Ingresa tu usuario para solicitar la recuperación.");
    if (!isSupabaseConfigured) return setError("La recuperación de contraseña aún no está disponible. Comunícate con el administrador.");
    setLoading(true);
    const email = await resolveLoginEmail(username);
    const { error: recoveryError } = email
      ? await createClient().auth.resetPasswordForEmail(email, { redirectTo: `${window.location.origin}/reset-password` })
      : { error: null };
    setLoading(false);
    if (recoveryError) return setError("No se pudo enviar la recuperación. Inténtalo nuevamente.");
    setError("Si el usuario está registrado, recibirá instrucciones en su correo para crear una nueva contraseña.");
  }

  return (
    <LoginScreen
      online
      intro="Ingresa con la cuenta compartida autorizada del laboratorio."
      error={error}
      loading={loading}
      onSubmit={(username, password) => void signIn(username, password)}
      onRecover={(username) => void recoverPassword(username)}
    />
  );
}
