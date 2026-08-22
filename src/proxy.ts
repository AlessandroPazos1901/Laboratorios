import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

export async function proxy(request: NextRequest) {
  // Lightweight connectivity probe used by the PWA. It returns no data and
  // must not trigger a Supabase auth request every ten seconds.
  if (request.nextUrl.pathname === "/api/sync/ping") return NextResponse.next();

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !key) {
    if (request.nextUrl.pathname.startsWith("/api/")) {
      return NextResponse.json({ error: "Servicio no configurado." }, { status: 503 });
    }
    return NextResponse.redirect(new URL("/login", request.url));
  }

  let response = NextResponse.next({ request });
  const supabase = createServerClient(url, key, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll(items) {
        items.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        items.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
      },
    },
  });

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    if (request.nextUrl.pathname.startsWith("/api/")) {
      return NextResponse.json({ error: "Sesion requerida." }, { status: 401 });
    }
    // Con réplica local, /app trae su propio formulario de ingreso: es el mismo
    // que se usa sin internet, y así el personal ve una sola pantalla en lugar
    // de iniciar sesión aquí y volver a identificarse al abrir los datos.
    // Los datos siguen protegidos: /api responde 401 sin sesión.
    if (process.env.NEXT_PUBLIC_OFFLINE_MODE !== "true") {
      return NextResponse.redirect(new URL("/login", request.url));
    }
  }

  return response;
}

export const config = {
  matcher: ["/app/:path*", "/api/:path*"],
};
