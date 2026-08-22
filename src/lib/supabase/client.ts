"use client";

import { createBrowserClient } from "@supabase/ssr";

export function createClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) throw new Error("Supabase no está configurado");
  return createBrowserClient(url, key);
}

export const isSupabaseConfigured = Boolean(
  process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
);

/**
 * El personal entra con un usuario corto, no con el correo. La cuenta de Supabase
 * sigue siendo una sola: la base traduce usuario → correo para poder autenticar.
 */
export async function resolveLoginEmail(username: string) {
  const candidate = username.trim();
  if (!candidate || !isSupabaseConfigured) return null;
  const { data, error } = await createClient().rpc("email_for_login", { candidate });
  return error ? null : (data as string | null);
}
