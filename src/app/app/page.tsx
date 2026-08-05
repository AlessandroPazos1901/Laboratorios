import { redirect } from "next/navigation";
import { LabApp } from "@/components/lab-app";
import { loadLabData } from "@/lib/supabase/load-lab-data";
import { createClient } from "@/lib/supabase/server";
import { OfflineAppBootstrap } from "@/components/offline-app-bootstrap";
import { OFFLINE_MODE_ENABLED } from "@/lib/offline/types";

export const metadata = { title: "Area de trabajo" };
export const dynamic = "force-dynamic";

export default async function ApplicationPage() {
  if (OFFLINE_MODE_ENABLED) return <OfflineAppBootstrap />;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const data = await loadLabData(supabase);
  const fullName = String(user.user_metadata.full_name ?? user.email?.split("@")[0] ?? "Laboratorio José");
  return <LabApp data={data} currentUser={{ fullName, role: "owner" }} />;
}
