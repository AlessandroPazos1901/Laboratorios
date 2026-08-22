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
    // Este proxy solo llega a ejecutarse si el equipo alcanzó al servidor, o sea
    // con internet. Sin internet la navegación la resuelve el service worker
    // contra /offline y nunca pasa por aquí. Por eso mandar al ingreso principal
    // es siempre correcto: es la pantalla de ingreso cuando hay conexión.
    return NextResponse.redirect(new URL("/login", request.url));
  }

  return response;
}

export const config = {
  matcher: ["/app/:path*", "/api/:path*"],
};
