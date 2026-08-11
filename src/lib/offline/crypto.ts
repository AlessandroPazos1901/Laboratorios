const encoder = new TextEncoder();
const decoder = new TextDecoder();

// New enrollments use four digits. Keep accepting the former 8+ digit format
// so an already-enrolled computer can still decrypt its existing vault.
export const PIN_PATTERN = /^(?:\d{4}|\d{8,})$/;
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

export async function derivePinKey(pin: string, saltBase64: string) {
  if (!PIN_PATTERN.test(pin)) throw new Error("invalid_pin");
  const material = await crypto.subtle.importKey(
    "raw",
    encoder.encode(pin),
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

export async function wrapDataKey(dataKey: CryptoKey, pinKey: CryptoKey) {
  const raw = new Uint8Array(await crypto.subtle.exportKey("raw", dataKey));
  return encryptBytes(pinKey, raw);
}

export async function unwrapDataKey(value: EncryptedValue, pinKey: CryptoKey) {
  const raw = await decryptBytes(pinKey, value);
  return crypto.subtle.importKey("raw", raw, { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
}
