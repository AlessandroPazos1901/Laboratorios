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
