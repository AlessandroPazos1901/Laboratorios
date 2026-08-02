import { exportJWK, generateKeyPair } from "jose";

const { privateKey, publicKey } = await generateKeyPair("ES256", { extractable: true });
const privateJwk = await exportJWK(privateKey);
const publicJwk = await exportJWK(publicKey);

console.log("Configura estos valores por ambiente. No publiques la clave privada:\n");
console.log(`OFFLINE_LEASE_PRIVATE_JWK=${JSON.stringify(privateJwk)}`);
console.log(`NEXT_PUBLIC_OFFLINE_LEASE_PUBLIC_JWK=${JSON.stringify(publicJwk)}`);
