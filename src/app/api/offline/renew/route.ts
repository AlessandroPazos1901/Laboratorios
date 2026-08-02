import { z } from "zod";
import { assertSameOrigin, OfflineApiError, offlineApiResponse, requireActiveOfflineUser } from "@/lib/offline/api-server";
import { signOfflineLease } from "@/lib/offline/lease-server";

const schema = z.object({ deviceId: z.string().uuid() });

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const { deviceId } = schema.parse(await request.json());
    const { supabase, user } = await requireActiveOfflineUser();
    const { data: device, error: readError } = await supabase
      .from("offline_devices")
      .select("id,name,revoked_at")
      .eq("id", deviceId)
      .eq("user_id", user.id)
      .maybeSingle();
    if (readError) throw readError;
    if (!device || device.revoked_at) throw new OfflineApiError(403, "El equipo fue revocado.");
    const lease = await signOfflineLease({ userId: user.id, deviceId, deviceName: device.name });
    const { error } = await supabase.from("offline_devices").update({
      lease_expires_at: lease.expiresAt,
      last_seen_at: new Date().toISOString(),
    }).eq("id", deviceId).eq("user_id", user.id);
    if (error) throw error;
    return Response.json({ lease }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return offlineApiResponse(error);
  }
}
