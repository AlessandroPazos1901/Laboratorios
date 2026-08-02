import "server-only";
import { importJWK, SignJWT, type JWK } from "jose";
import { OFFLINE_LEASE_HOURS, type OfflineLeaseClaims } from "@/lib/offline/types";
import { offlineLeaseIssuer } from "@/lib/offline/lease";

export async function signOfflineLease(input: Omit<OfflineLeaseClaims, "issuedAt" | "expiresAt">) {
  const raw = process.env.OFFLINE_LEASE_PRIVATE_JWK;
  if (!raw) throw new Error("offline_private_key_missing");
  let jwk: JWK;
  try {
    jwk = JSON.parse(raw) as JWK;
  } catch {
    throw new Error("offline_private_key_invalid");
  }
  const key = await importJWK(jwk, "ES256");
  const issued = new Date();
  const expires = new Date(issued.getTime() + OFFLINE_LEASE_HOURS * 60 * 60 * 1000);
  const token = await new SignJWT({ deviceId: input.deviceId, deviceName: input.deviceName })
    .setProtectedHeader({ alg: "ES256", typ: "JWT" })
    .setIssuer(offlineLeaseIssuer.issuer)
    .setAudience(offlineLeaseIssuer.audience)
    .setSubject(input.userId)
    .setIssuedAt(Math.floor(issued.getTime() / 1000))
    .setExpirationTime(Math.floor(expires.getTime() / 1000))
    .sign(key);
  return {
    token,
    userId: input.userId,
    deviceId: input.deviceId,
    deviceName: input.deviceName,
    issuedAt: issued.toISOString(),
    expiresAt: expires.toISOString(),
  };
}
