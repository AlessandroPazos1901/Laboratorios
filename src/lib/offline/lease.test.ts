import { describe, expect, it } from "vitest";
import { SignJWT, exportJWK, generateKeyPair } from "jose";
import { verifyOfflineLease } from "@/lib/offline/lease";

async function issue(expiresAt: Date) {
  const { privateKey, publicKey } = await generateKeyPair("ES256", { extractable: true });
  const token = await new SignJWT({ deviceId: "device-1", deviceName: "Posta" })
    .setProtectedHeader({ alg: "ES256", typ: "JWT" })
    .setIssuer("lims-jose")
    .setAudience("lims-jose-offline")
    .setSubject("user-1")
    .setIssuedAt(Math.floor(Date.now() / 1000) - 60)
    .setExpirationTime(Math.floor(expiresAt.getTime() / 1000))
    .sign(privateKey);
  return { token, publicJwk: JSON.stringify(await exportJWK(publicKey)) };
}

describe("verifyOfflineLease", () => {
  // La posta puede pasar semanas sin internet: un token corto ya vencido no
  // puede renovarse (justamente por no haber red), así que debe seguir abriendo.
  it("acepta una autorización emitida con el plazo corto anterior", async () => {
    const { token, publicJwk } = await issue(new Date(Date.now() - 30 * 24 * 60 * 60 * 1000));
    expect((await verifyOfflineLease(token, "device-1", publicJwk)).userId).toBe("user-1");
  });

  it("rechaza el equipo equivocado", async () => {
    const { token, publicJwk } = await issue(new Date(Date.now() + 60_000));
    await expect(verifyOfflineLease(token, "otro", publicJwk)).rejects.toThrow("offline_device_mismatch");
  });
});
