import { describe, expect, it, vi } from "vitest";
import { probeServerConnectivity } from "@/lib/offline/connectivity";

describe("detección de conectividad real", () => {
  it("marca sin conexión cuando el navegador dice online pero la red falla", async () => {
    const fetcher = vi.fn().mockRejectedValue(new TypeError("Failed to fetch"));
    await expect(probeServerConnectivity({ fetcher, browserOnline: true })).resolves.toBe(false);
    expect(fetcher).toHaveBeenCalledOnce();
  });

  it("considera conectado cualquier respuesta HTTP del servidor", async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(null, { status: 503 }));
    await expect(probeServerConnectivity({ fetcher, browserOnline: true })).resolves.toBe(true);
  });

  it("evita la solicitud cuando el navegador confirma que no tiene red", async () => {
    const fetcher = vi.fn();
    await expect(probeServerConnectivity({ fetcher, browserOnline: false })).resolves.toBe(false);
    expect(fetcher).not.toHaveBeenCalled();
  });
});
