const encoder = new TextEncoder();
const decoder = new TextDecoder();
const searchKeys = new WeakMap<CryptoKey, Promise<CryptoKey>>();

// La bóveda local se abre con la misma contraseña que la cuenta: un solo
// credencial en lugar de contraseña online + PIN offline. El largo mínimo solo
// evita derivar de una cadena vacía; la validación real la hace Supabase.
export const VAULT_SECRET_MIN_LENGTH = 4;
export const PBKDF2_ITERATIONS = 600_000;

export type EncryptedValue = { ciphertext: string; iv: string };

function toBase64(bytes: Uint8Array) {
  let binary = "";
  bytes.forEach((byte) => { binary += String.fromCharCode(byte); });
  return btoa(binary);
}

function fromBase64(value: string) {
  const binary = atob(value);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

export function randomBase64(length = 16) {
  return toBase64(crypto.getRandomValues(new Uint8Array(length)));
}

export async function deriveVaultKey(secret: string, saltBase64: string) {
  if (secret.length < VAULT_SECRET_MIN_LENGTH) throw new Error("invalid_vault_secret");
  const material = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    "PBKDF2",
    false,
    ["deriveKey"],
  );
  return crypto.subtle.deriveKey({
    name: "PBKDF2",
    salt: fromBase64(saltBase64),
    iterations: PBKDF2_ITERATIONS,
    hash: "SHA-256",
  }, material, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
}

export async function createDataKey() {
  return crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, true, ["encrypt", "decrypt"]);
}

export async function encryptBytes(key: CryptoKey, bytes: Uint8Array): Promise<EncryptedValue> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const payload = bytes.slice().buffer as ArrayBuffer;
  const encrypted = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, payload);
  return { ciphertext: toBase64(new Uint8Array(encrypted)), iv: toBase64(iv) };
}

export async function decryptBytes(key: CryptoKey, value: EncryptedValue) {
  const decrypted = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: fromBase64(value.iv) },
    key,
    fromBase64(value.ciphertext),
  );
  return new Uint8Array(decrypted);
}

export async function encryptJson(key: CryptoKey, value: unknown) {
  return encryptBytes(key, encoder.encode(JSON.stringify(value)));
}

export async function decryptJson<T>(key: CryptoKey, value: EncryptedValue): Promise<T> {
  return JSON.parse(decoder.decode(await decryptBytes(key, value))) as T;
}

export async function wrapDataKey(dataKey: CryptoKey, wrappingKey: CryptoKey) {
  const raw = new Uint8Array(await crypto.subtle.exportKey("raw", dataKey));
  return encryptBytes(wrappingKey, raw);
}

export async function unwrapDataKey(value: EncryptedValue, wrappingKey: CryptoKey) {
  const raw = await decryptBytes(wrappingKey, value);
  return crypto.subtle.importKey("raw", raw, { name: "AES-GCM" }, true, ["encrypt", "decrypt"]);
}

export function createSearchKey(dataKey: CryptoKey) {
  let derived = searchKeys.get(dataKey);
  if (!derived) {
    derived = crypto.subtle.exportKey("raw", dataKey).then(async (raw) => {
      const material = await crypto.subtle.importKey("raw", raw, "HKDF", false, ["deriveKey"]);
      return crypto.subtle.deriveKey({
        name: "HKDF",
        hash: "SHA-256",
        salt: encoder.encode("lims-jose-offline-search-v1"),
        info: encoder.encode("patient-roster-index"),
      }, material, { name: "HMAC", hash: "SHA-256", length: 256 }, false, ["sign"]);
    });
    searchKeys.set(dataKey, derived);
  }
  return derived;
}

export async function searchToken(key: CryptoKey, value: string) {
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(value));
  // 128 bits keeps collision risk negligible while avoiding hundreds of MB
  // of repeated index text for directories with more than half a million rows.
  return toBase64(new Uint8Array(signature).slice(0, 16));
}
