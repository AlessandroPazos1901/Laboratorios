import { z } from "zod";
import { assertSameOrigin, offlineApiResponse, requireActiveOfflineUser } from "@/lib/offline/api-server";
import { signOfflineLease } from "@/lib/offline/lease-server";

const schema = z.object({
  deviceId: z.string().uuid(),
  deviceName: z.string().trim().min(2).max(80),
});

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const input = schema.parse(await request.json());
    const { supabase, user } = await requireActiveOfflineUser();
    const lease = await signOfflineLease({ userId: user.id, deviceId: input.deviceId, deviceName: input.deviceName });
    const { error } = await supabase.from("offline_devices").upsert({
      id: input.deviceId,
      user_id: user.id,
      name: input.deviceName,
      lease_expires_at: lease.expiresAt,
      last_seen_at: new Date().toISOString(),
      revoked_at: null,
    }, { onConflict: "id" });
    if (error) throw error;
    return Response.json({ lease }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return offlineApiResponse(error);
  }
}
