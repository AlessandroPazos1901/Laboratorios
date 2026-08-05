import { z } from "zod";
import { createClient } from "@/lib/supabase/server";

const createSchema = z.object({ fullName: z.string().trim().min(2).max(120) });
const updateSchema = z.object({ id: z.string().uuid(), active: z.boolean() });

async function authenticatedClient() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  return user ? supabase : null;
}

export async function POST(request: Request) {
  const supabase = await authenticatedClient();
  if (!supabase) return Response.json({ error: "Sesión requerida." }, { status: 401 });
  const parsed = createSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Ingresa el nombre completo del analista." }, { status: 400 });
  const { data, error } = await supabase.rpc("create_analyst", { analyst_name: parsed.data.fullName });
  if (error) {
    const duplicate = error.code === "23505";
    return Response.json({ error: duplicate ? "Ya existe un analista activo con ese nombre." : error.message }, { status: duplicate ? 409 : 400 });
  }
  return Response.json({ analyst: data }, { status: 201 });
}

export async function PATCH(request: Request) {
  const supabase = await authenticatedClient();
  if (!supabase) return Response.json({ error: "Sesión requerida." }, { status: 401 });
  const parsed = updateSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Cambio de analista inválido." }, { status: 400 });
  const { data, error } = await supabase.rpc("set_analyst_active", {
    target_analyst: parsed.data.id,
    analyst_active: parsed.data.active,
  });
  if (error) {
    const message = error.message.includes("at_least_one_active_analyst_required")
      ? "Debe quedar al menos un analista activo."
      : error.message;
    return Response.json({ error: message }, { status: 400 });
  }
  return Response.json({ analyst: data });
}
