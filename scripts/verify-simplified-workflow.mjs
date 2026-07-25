import process from "node:process";
import { createClient } from "@supabase/supabase-js";

const required = ["LAB_SUPABASE_URL", "LAB_SUPABASE_ANON_KEY", "LAB_TEST_EMAIL", "LAB_TEST_PASSWORD"];
for (const name of required) {
  if (!process.env[name]) throw new Error(`${name} is required`);
}

const supabase = createClient(
  process.env.LAB_SUPABASE_URL,
  process.env.LAB_SUPABASE_ANON_KEY,
  { auth: { persistSession: false, autoRefreshToken: false } },
);

const login = await supabase.auth.signInWithPassword({
  email: process.env.LAB_TEST_EMAIL,
  password: process.env.LAB_TEST_PASSWORD,
});
if (login.error || !login.data.user) throw login.error ?? new Error("Authentication failed");

const profile = await supabase
  .from("profiles")
  .select("id,full_name,active,role")
  .eq("id", login.data.user.id)
  .single();
if (profile.error || !profile.data.active) throw profile.error ?? new Error("Inactive profile");

const patientRead = await supabase.from("patients").select("id", { count: "exact", head: true });
if (patientRead.error) throw patientRead.error;
const catalogRead = await supabase.from("analyses").select("id,active", { count: "exact" });
if (catalogRead.error) throw catalogRead.error;

const search = await supabase.rpc("search_patients", { search_text: "00000000", result_limit: 1 });
if (search.error) throw search.error;

const invalidPatient = await supabase.rpc("upsert_simple_patient", {
  patient_dni: "1",
  patient_name: "Verificación",
});
if (!invalidPatient.error?.message.includes("invalid_dni")) {
  throw new Error("upsert_simple_patient did not enforce DNI validation");
}

console.log(JSON.stringify({
  authenticated: true,
  activeProfile: true,
  fullNameColumn: true,
  searchPatients: true,
  dniValidation: true,
  ownerProfile: profile.data.role === "owner",
  existingPatients: patientRead.count,
  catalogEntries: catalogRead.count,
  activeCatalogEntries: catalogRead.data.filter((analysis) => analysis.active).length,
}));

await supabase.auth.signOut();
