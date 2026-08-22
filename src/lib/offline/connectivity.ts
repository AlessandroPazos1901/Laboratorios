export type ConnectivityFetch = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

export async function probeServerConnectivity(input: {
  fetcher?: ConnectivityFetch;
  browserOnline?: boolean;
  timeoutMs?: number;
} = {}) {
  const browserOnline = input.browserOnline ?? (typeof navigator === "undefined" || navigator.onLine);
  if (!browserOnline) return false;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), input.timeoutMs ?? 5_000);
  try {
    // Any HTTP response proves that the real server was reached. Authentication
    // and server errors are handled separately by the synchronization flow.
    await (input.fetcher ?? fetch)("/api/sync/ping", {
      cache: "no-store",
      credentials: "same-origin",
      signal: controller.signal,
    });
    return true;
  } catch {
    return false;
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Corta una espera que no debería eternizarse.
 *
 * La sonda de arriba solo prueba que responde *nuestro* servidor. Si el router
 * sigue en pie pero no hay internet —o en desarrollo, donde el servidor es la
 * propia máquina—, la sonda dice «hay conexión» y las llamadas a Supabase se
 * quedan colgadas sin límite, porque su cliente no trae tiempo de espera. Eso
 * dejaba el botón de ingreso en «Iniciando sesión…» para siempre.
 */
export function withTimeout<T>(work: Promise<T>, timeoutMs = 12_000) {
  return Promise.race([
    work,
    new Promise<never>((_, reject) => setTimeout(() => reject(new Error("network_timeout")), timeoutMs)),
  ]);
}
