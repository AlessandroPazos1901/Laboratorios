import { createClient as createAdminClient } from "@supabase/supabase-js";
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const invitationSchema = z.object({
  fullName: z.string().trim().min(2).max(120),
  email: z.string().trim().toLowerCase().email().max(254),
});

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Sesión requerida." }, { status: 401 });

  const { data: profile } = await supabase
    .from("profiles")
    .select("role,active")
    .eq("id", user.id)
    .maybeSingle();
  if (!profile?.active || profile.role !== "owner") {
    return NextResponse.json({ error: "Solo una cuenta administradora puede invitar usuarios." }, { status: 403 });
  }

  const parsed = invitationSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Revisa el nombre y el correo electrónico." }, { status: 400 });

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const secret = process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !secret) {
    return NextResponse.json({ error: "Falta configurar la clave administrativa de Supabase." }, { status: 503 });
  }

  const admin = createAdminClient(url, secret, {
    auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
  });
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/$/, "") ?? request.nextUrl.origin;
  const { data, error } = await admin.auth.admin.inviteUserByEmail(parsed.data.email, {
    data: { full_name: parsed.data.fullName },
    redirectTo: `${siteUrl}/reset-password`,
  });
  if (error || !data.user) {
    const duplicate = error?.message.toLocaleLowerCase("en").includes("already") || error?.status === 422;
    return NextResponse.json({ error: duplicate ? "Ya existe una cuenta con ese correo." : "No se pudo enviar la invitación." }, { status: duplicate ? 409 : 502 });
  }

  const { error: profileError } = await admin.from("profiles").upsert({
    id: data.user.id,
    full_name: parsed.data.fullName,
    role: "owner",
    active: true,
  }, { onConflict: "id" });
  if (profileError) {
    return NextResponse.json({ error: "La invitación se envió, pero no se pudo activar el perfil. Contacta al administrador." }, { status: 500 });
  }

  return NextResponse.json({ invited: true, email: parsed.data.email });
}
