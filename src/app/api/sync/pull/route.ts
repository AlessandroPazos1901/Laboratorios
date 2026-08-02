import { loadLabData } from "@/lib/supabase/load-lab-data";
import { offlineApiResponse, requireActiveOfflineUser } from "@/lib/offline/api-server";
import type { SyncBundle } from "@/lib/offline/types";

export async function GET(request: Request) {
  try {
    const cursorValue = Number(new URL(request.url).searchParams.get("cursor") ?? "0");
    const cursor = Number.isSafeInteger(cursorValue) && cursorValue >= 0 ? cursorValue : 0;
    const { supabase, user, profile } = await requireActiveOfflineUser();
    const [{ data: latestChange, error: cursorError }, data] = await Promise.all([
      supabase.from("sync_change_log").select("sequence").order("sequence", { ascending: false }).limit(1).maybeSingle(),
      loadLabData(supabase, { offlineWindowDays: 90 }),
    ]);
    if (cursorError) throw cursorError;
    const latestCursor = Number(latestChange?.sequence ?? cursor);
    const bundle: SyncBundle = {
      cursor: latestCursor,
      serverTime: new Date().toISOString(),
      mode: "snapshot",
      data,
      currentUser: { id: user.id, fullName: profile.full_name, role: profile.role },
    };
    return Response.json(bundle, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return offlineApiResponse(error);
  }
}
