import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST() {
  return NextResponse.json({
    error: "El laboratorio utiliza una sola cuenta compartida. Administra las identidades clínicas desde Analistas.",
  }, { status: 410 });
}
