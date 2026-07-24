import { redirect } from "next/navigation";
import { LabApp } from "@/components/lab-app";
import { createClient } from "@/lib/supabase/server";
import { loadLabData } from "@/lib/supabase/load-lab-data";

export const metadata = { title: "Área de trabajo" };
export const dynamic = "force-dynamic";

export default async function ApplicationPage() {
  if (process.env.NEXT_PUBLIC_DEMO_MODE === "true") return <LabApp />;

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: profile } = await supabase
    .from("profiles")
    .select("full_name,role,active")
    .eq("id", user.id)
    .maybeSingle();

  if (!profile?.active) {
    return <main className="setup-required">
      <section className="panel">
        <p className="eyebrow">Configuración pendiente</p>
        <h1>El usuario aún no tiene un perfil activo</h1>
        <p>Ejecuta la migración <span className="mono">202607240004_auth_profile_bootstrap.sql</span> y vuelve a iniciar sesión.</p>
      </section>
    </main>;
  }

  const data = await loadLabData(supabase);
  return <LabApp data={data} currentUser={{ fullName: profile.full_name, role: profile.role }} />;
}
