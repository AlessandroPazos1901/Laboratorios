import { redirect } from "next/navigation";
import { LabApp } from "@/components/lab-app";
import { loadLabData } from "@/lib/supabase/load-lab-data";
import { createClient } from "@/lib/supabase/server";

export const metadata = { title: "Area de trabajo" };
export const dynamic = "force-dynamic";

export default async function ApplicationPage() {
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
        <p className="eyebrow">Configuracion pendiente</p>
        <h1>El usuario aun no tiene un perfil activo</h1>
        <p>Ejecuta la migracion <span className="mono">202607240004_auth_profile_bootstrap.sql</span> y vuelve a iniciar sesion.</p>
      </section>
    </main>;
  }

  const data = await loadLabData(supabase);
  return <LabApp data={data} currentUser={{ fullName: profile.full_name, role: profile.role }} />;
}
