import { z } from "zod";
import { createClient } from "@/lib/supabase/server";

const uuid = z.string().uuid();
const requestSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("group.create"), name: z.string().trim().min(2).max(80) }),
  z.object({ action: z.literal("group.rename"), groupId: uuid, name: z.string().trim().min(2).max(80) }),
  z.object({ action: z.literal("group.archive"), groupId: uuid }),
  z.object({ action: z.literal("subsection.create"), groupId: uuid, name: z.string().trim().min(2).max(80) }),
  z.object({ action: z.literal("subsection.rename"), subsectionId: uuid, name: z.string().trim().min(2).max(80) }),
  z.object({ action: z.literal("subsection.renameLegacy"), groupId: uuid, currentName: z.string().trim().min(2).max(80), name: z.string().trim().min(2).max(80) }),
  z.object({ action: z.literal("subsection.delete"), subsectionId: uuid }),
  z.object({ action: z.literal("subsection.deleteLegacy"), groupId: uuid, currentName: z.string().trim().min(2).max(80) }),
  z.object({ action: z.literal("subsection.reorder"), groupId: uuid, subsectionIds: z.array(uuid) }),
  z.object({ action: z.literal("layout.save"), groupId: uuid, items: z.array(z.object({ analysisId: uuid, subsection: z.string().trim().max(80).nullable(), displayOrder: z.number().int().positive() })) }),
  z.object({
    action: z.literal("analysis.save"), analysisId: uuid.nullable(), groupId: uuid,
    subsection: z.string().trim().max(80).nullable(), name: z.string().trim().min(2).max(120),
    resultType: z.enum(["numeric", "qualitative", "text"]), sampleType: z.string().trim().min(2).max(80),
    method: z.string().trim().max(120).nullable(), unit: z.string().trim().max(40).nullable(), decimals: z.number().int().min(0).max(8).nullable(),
    qualitativeOptions: z.array(z.string().trim().min(1).max(80)).nullable(), referenceRanges: z.array(z.record(z.string(), z.union([z.string(), z.number()]))),
    criticalLimits: z.record(z.string(), z.number()),
  }),
  z.object({ action: z.literal("analysis.archive"), analysisId: uuid }),
]);

function friendlyError(message: string) {
  if (message.includes("owner_required") || message.includes("not_authorized")) return "Esta acción requiere conexión y autorización.";
  if (message.includes("duplicate key")) return "Ya existe una sección o subsección con ese nombre.";
  if (message.includes("group_not_found")) return "La sección ya no existe. Actualiza el catálogo.";
  if (message.includes("subsection_not_found")) return "La subsección ya no existe. Actualiza el catálogo.";
  if (message.includes("analysis_not_found")) return "El análisis ya no existe. Actualiza el catálogo.";
  if (message.includes("reference_range_required")) return "Indica el intervalo de referencia.";
  return "No se pudo guardar el catálogo.";
}

export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return Response.json({ error: "Sesión requerida." }, { status: 401 });
  const parsed = requestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Revisa los datos ingresados." }, { status: 400 });
  const input = parsed.data;
  let call;
  if (input.action === "group.create") call = supabase.rpc("create_catalog_group", { group_name: input.name });
  else if (input.action === "group.rename") call = supabase.rpc("rename_catalog_group", { target_group: input.groupId, group_name: input.name });
  else if (input.action === "group.archive") call = supabase.rpc("archive_catalog_group", { target_group: input.groupId });
  else if (input.action === "subsection.create") call = supabase.rpc("create_catalog_subsection", { target_group: input.groupId, subsection_name: input.name });
  else if (input.action === "subsection.rename") call = supabase.rpc("rename_catalog_subsection", { target_subsection: input.subsectionId, subsection_name: input.name });
  else if (input.action === "subsection.renameLegacy") call = supabase.rpc("rename_catalog_subsection_by_name", { target_group: input.groupId, current_name: input.currentName, subsection_name: input.name });
  else if (input.action === "subsection.delete") call = supabase.rpc("delete_catalog_subsection", { target_subsection: input.subsectionId });
  else if (input.action === "subsection.deleteLegacy") call = supabase.rpc("delete_catalog_subsection_by_name", { target_group: input.groupId, current_name: input.currentName });
  else if (input.action === "subsection.reorder") call = supabase.rpc("reorder_catalog_subsections", { target_group: input.groupId, subsection_ids: input.subsectionIds });
  else if (input.action === "layout.save") call = supabase.rpc("save_catalog_layout", { target_group: input.groupId, layout: input.items.map((item) => ({ analysis_id: item.analysisId, subsection: item.subsection, display_order: item.displayOrder })) });
  else if (input.action === "analysis.archive") call = supabase.rpc("archive_catalog_analysis", { target_analysis: input.analysisId });
  else call = supabase.rpc("save_catalog_analysis", {
    target_analysis: input.analysisId, target_group: input.groupId, target_subsection: input.subsection,
    analysis_name: input.name, approved_result_type: input.resultType, approved_sample_type: input.sampleType,
    approved_method: input.method, approved_unit: input.unit, approved_decimals: input.decimals,
    approved_qualitative_options: input.qualitativeOptions, approved_reference_ranges: input.referenceRanges,
    approved_critical_limits: input.criticalLimits,
  });
  const { data, error } = await call;
  if (error) return Response.json({ error: friendlyError(error.message) }, { status: error.code === "23505" ? 409 : 400 });
  return Response.json({ data });
}
