import { importJWK, jwtVerify, type JWK } from "jose";
import { OFFLINE_LEASE_HOURS, type OfflineLeaseClaims } from "@/lib/offline/types";

const ISSUER = "lims-jose";
const AUDIENCE = "lims-jose-offline";

export async function verifyOfflineLease(
  token: string,
  expectedDeviceId: string,
  publicJwkValue = process.env.NEXT_PUBLIC_OFFLINE_LEASE_PUBLIC_JWK,
) {
  if (!publicJwkValue) throw new Error("offline_public_key_missing");
  let publicJwk: JWK;
  try {
    publicJwk = JSON.parse(publicJwkValue) as JWK;
  } catch {
    throw new Error("offline_public_key_invalid");
  }
  const key = await importJWK(publicJwk, "ES256");
  // clockTolerance de una década: un equipo con el token corto de antes está
  // justamente sin internet para renovarlo. Se renueva solo al reconectar.
  const { payload } = await jwtVerify(token, key, { issuer: ISSUER, audience: AUDIENCE, clockTolerance: OFFLINE_LEASE_HOURS * 3600 });
  if (payload.deviceId !== expectedDeviceId) throw new Error("offline_device_mismatch");
  const claims: OfflineLeaseClaims = {
    userId: String(payload.sub ?? ""),
    deviceId: String(payload.deviceId ?? ""),
    deviceName: String(payload.deviceName ?? ""),
    issuedAt: new Date(Number(payload.iat ?? 0) * 1000).toISOString(),
    expiresAt: new Date(Number(payload.exp ?? 0) * 1000).toISOString(),
  };
  if (!claims.userId || !claims.deviceId) throw new Error("offline_lease_invalid");
  return claims;
}

export const offlineLeaseIssuer = { issuer: ISSUER, audience: AUDIENCE };
