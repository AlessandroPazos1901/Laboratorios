import "server-only";
import { createClient } from "@/lib/supabase/server";

export class OfflineApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

export function assertSameOrigin(request: Request) {
  const origin = request.headers.get("origin");
  if (origin && origin !== new URL(request.url).origin) throw new OfflineApiError(403, "Origen no permitido.");
}

export async function requireActiveOfflineUser() {
  if (process.env.NEXT_PUBLIC_OFFLINE_MODE !== "true") {
    throw new OfflineApiError(404, "El modo offline no está habilitado.");
  }
  const supabase = await createClient();
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) throw new OfflineApiError(401, "Sesión requerida.");
  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("full_name,role,active")
    .eq("id", user.id)
    .maybeSingle();
  if (profileError || !profile?.active) throw new OfflineApiError(403, "Usuario inactivo o sin perfil.");
  return { supabase, user, profile };
}

export function offlineApiResponse(error: unknown) {
  if (error instanceof OfflineApiError) {
    return Response.json({ error: error.message }, { status: error.status });
  }
  const message = error instanceof Error ? error.message : "offline_api_error";
  if (message.includes("offline_") || message.includes("apply_offline_operation")) {
    return Response.json({ error: "La infraestructura offline todavía no está configurada." }, { status: 503 });
  }
  return Response.json({ error: "No se pudo completar la operación offline." }, { status: 500 });
}
