import { catalogFriendlyError, catalogOperationSchema } from "@/lib/catalog-operations";
import { createClient } from "@/lib/supabase/server";

export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return Response.json({ error: "Sesión requerida." }, { status: 401 });
  const parsed = catalogOperationSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    const detail = parsed.error.issues.map((issue) => `${issue.path.join(".") || "(raíz)"}: ${issue.message}`).join("; ");
    return Response.json(
      { error: process.env.NODE_ENV === "production" ? "Revisa los datos ingresados." : `Revisa los datos ingresados — ${detail}` },
      { status: 400 },
    );
  }
  // El mismo reparto que usa la cola offline: una sola implementación del catálogo.
  const { data, error } = await supabase.rpc("apply_catalog_operation", { operation_payload: parsed.data });
  if (error) return Response.json({ error: catalogFriendlyError(error.message) }, { status: error.code === "23505" ? 409 : 400 });
  return Response.json({ data });
}
