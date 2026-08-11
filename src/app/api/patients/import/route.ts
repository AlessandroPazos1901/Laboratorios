import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST() {
  return NextResponse.json({
    error: "La carga de pacientes a Supabase fue deshabilitada. Usa Base local desde la PWA.",
  }, { status: 410 });
}
