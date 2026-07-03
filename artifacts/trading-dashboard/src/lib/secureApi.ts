/**
 * End-to-end security layer for STRUCT.ai remote access.
 *
 * Three layers, matching services/auth_service.py on the backend:
 *   1. Device key — a shared secret only your own devices know, saved in
 *      this browser's localStorage the first time it's entered. Sent with
 *      every login attempt; the server rejects unrecognized devices before
 *      even checking the password.
 *   2. Login — password + TOTP code → short-lived session token (Bearer header).
 *   3. Payload encryption — every request/response body under /trading-api/*
 *      is AES-256-GCM encrypted with a key derived from a shared passphrase
 *      that never crosses the network. Any tunnel/relay (e.g. Cloudflare)
 *      only ever sees ciphertext, even though it terminates TLS at its edge.
 *
 * The password/TOTP/passphrase are entered once per browser session via
 * LoginGate.tsx and kept in memory only — closing the tab requires logging
 * in again. The device key is the one exception: it's saved to localStorage
 * on purpose, so you don't have to re-type it every time on your own devices.
 */

const KDF_SALT = new TextEncoder().encode("struct.ai-e2e-v1-salt");
const KDF_ITERATIONS = 100_000;

let sessionToken: string | null = null;
let aesKey: CryptoKey | null = null;

export function isUnlocked() {
  return sessionToken !== null && aesKey !== null;
}

export function lock() {
  sessionToken = null;
  aesKey = null;
}

const DEVICE_KEY_STORAGE_KEY = "struct_device_key";

export function getStoredDeviceKey(): string {
  try {
    return localStorage.getItem(DEVICE_KEY_STORAGE_KEY) ?? "";
  } catch {
    return "";
  }
}

export function setStoredDeviceKey(key: string): void {
  try {
    if (key) {
      localStorage.setItem(DEVICE_KEY_STORAGE_KEY, key);
    } else {
      localStorage.removeItem(DEVICE_KEY_STORAGE_KEY);
    }
  } catch {
    // localStorage unavailable (e.g. private browsing) — device key just
    // won't persist across reloads; login will still work if re-entered.
  }
}

async function deriveKey(passphrase: string): Promise<CryptoKey> {
  const enc = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey("raw", enc.encode(passphrase), "PBKDF2", false, ["deriveKey"]);
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", salt: KDF_SALT, iterations: KDF_ITERATIONS, hash: "SHA-256" },
    keyMaterial,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

function toB64(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

function fromB64(s: string): Uint8Array {
  return Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
}

async function encryptJson(obj: unknown): Promise<string> {
  if (!aesKey) throw new Error("Locked");
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const data = new TextEncoder().encode(JSON.stringify(obj));
  const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, aesKey, data);
  return JSON.stringify({ iv: toB64(iv), data: toB64(new Uint8Array(ct)) });
}

async function decryptJson(envelope: { iv: string; data: string }): Promise<any> {
  if (!aesKey) throw new Error("Locked");
  const iv = fromB64(envelope.iv);
  const ct = fromB64(envelope.data);
  const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, aesKey, ct);
  return JSON.parse(new TextDecoder().decode(pt));
}

declare global {
  interface Window {
    __nativeFetch?: typeof fetch;
  }
}

export async function login(
  password: string,
  totpCode: string,
  encryptionPassphrase: string,
  deviceKey: string,
): Promise<void> {
  const nativeFetch = window.__nativeFetch ?? window.fetch;
  const res = await nativeFetch("/trading-api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ password, totp_code: totpCode, device_key: deviceKey }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: "Login failed" }));
    throw new Error(err.detail ?? "Login failed");
  }
  const { token } = await res.json();
  sessionToken = token;
  aesKey = await deriveKey(encryptionPassphrase);
  if (deviceKey) {
    setStoredDeviceKey(deviceKey);
  }
}

const EXEMPT = ["/trading-api/auth/login", "/trading-api/health"];

export function installSecureFetch() {
  if (window.__nativeFetch) return;
  window.__nativeFetch = window.fetch.bind(window);

  window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();
    const isApi = url.startsWith("/trading-api");
    const exempt = EXEMPT.some((p) => url.startsWith(p));

    if (!isApi || exempt) {
      return window.__nativeFetch!(input, init);
    }
    if (!isUnlocked()) {
      throw new Error("Session locked — please log in");
    }

    const headers = new Headers(init?.headers);
    headers.set("Authorization", `Bearer ${sessionToken}`);

    let body = init?.body;
    if (body && typeof body === "string") {
      body = await encryptJson(JSON.parse(body));
      headers.set("Content-Type", "application/json");
    }

    const res = await window.__nativeFetch!(input, { ...init, headers, body });

    try {
      const envelope = await res.clone().json();
      if (envelope && typeof envelope.iv === "string" && typeof envelope.data === "string") {
        const decrypted = await decryptJson(envelope);
        return new Response(JSON.stringify(decrypted), { status: res.status, statusText: res.statusText, headers: res.headers });
      }
    } catch {
      // Not an encrypted envelope (e.g. 401 from the auth gate) — fall through to raw response.
    }
    return res;
  };
}