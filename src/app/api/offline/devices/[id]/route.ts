import { assertSameOrigin, offlineApiResponse, requireActiveOfflineUser } from "@/lib/offline/api-server";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function DELETE(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    assertSameOrigin(request);
    const { id } = await context.params;
    if (!UUID.test(id)) return Response.json({ error: "Equipo inválido." }, { status: 400 });
    const { supabase, user } = await requireActiveOfflineUser();
    const { error } = await supabase.from("offline_devices")
      .update({ revoked_at: new Date().toISOString() })
      .eq("id", id)
      .eq("user_id", user.id);
    if (error) throw error;
    return new Response(null, { status: 204 });
  } catch (error) {
    return offlineApiResponse(error);
  }
}
