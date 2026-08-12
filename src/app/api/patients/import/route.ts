import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST() {
  return NextResponse.json({
    error: "La carga por internet fue deshabilitada. Usa «Cargar pacientes» desde la sección Pacientes.",
  }, { status: 410 });
}
