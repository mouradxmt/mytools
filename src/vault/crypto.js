// End-to-end encryption primitives for mytools.
//
// Design:
//   master_key   = random AES-GCM 256, encrypts all data blobs
//   auth_secret  = PBKDF2(password, "auth:v1:" + sha256(email), 200k) → sent to Supabase
//   kek_password = PBKDF2(password, "kek:v1:" + sha256(email), 250k) → wraps master_key
//   kek_recovery = PBKDF2(recoveryCode, "rec:v1:" + sha256(email), 250k) → wraps master_key
//
// Server only ever sees auth_secret (during login over TLS) and ciphertext.
// Master key never leaves the browser.

const enc = new TextEncoder();
const dec = new TextDecoder();

const AUTH_ITER = 200_000;
const KEK_ITER = 250_000;
const RECOVERY_CODE_LEN = 25;
const RECOVERY_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; // base32-ish, no confusing chars

// ── Encoding helpers ─────────────────────────────────────────────────
export function b64(bytes) {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}
export function ub64(s) { return Uint8Array.from(atob(s), (c) => c.charCodeAt(0)); }
function b64url(bytes) {
  return b64(bytes).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
async function sha256Hex(text) {
  const buf = await crypto.subtle.digest('SHA-256', enc.encode(text));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

// ── KDF ──────────────────────────────────────────────────────────────
async function deriveBits(password, info, iterations, bits = 256) {
  const baseKey = await crypto.subtle.importKey(
    'raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']
  );
  const out = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt: enc.encode(info), iterations, hash: 'SHA-256' },
    baseKey,
    bits
  );
  return new Uint8Array(out);
}

async function deriveAesKey(password, info, iterations) {
  const baseKey = await crypto.subtle.importKey(
    'raw', enc.encode(password), 'PBKDF2', false, ['deriveKey']
  );
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: enc.encode(info), iterations, hash: 'SHA-256' },
    baseKey,
    { name: 'AES-GCM', length: 256 },
    true, // extractable so we can wrap keys
    ['encrypt', 'decrypt']
  );
}

export async function deriveAuthSecret(email, password) {
  const salt = await sha256Hex(email.trim().toLowerCase());
  const bits = await deriveBits(password, `mytools:auth:v1:${salt}`, AUTH_ITER, 256);
  return b64url(bits); // ~43 chars, safe for Supabase password field
}

export async function deriveKekFromPassword(email, password) {
  const salt = await sha256Hex(email.trim().toLowerCase());
  return deriveAesKey(password, `mytools:kek:v1:${salt}`, KEK_ITER);
}

export async function deriveKekFromRecovery(email, recoveryCode) {
  const salt = await sha256Hex(email.trim().toLowerCase());
  // Normalize: uppercase, strip dashes/whitespace
  const normalized = recoveryCode.replace(/[\s-]/g, '').toUpperCase();
  return deriveAesKey(normalized, `mytools:rec:v1:${salt}`, KEK_ITER);
}

// ── Master key lifecycle ─────────────────────────────────────────────
export async function generateMasterKey() {
  return crypto.subtle.generateKey(
    { name: 'AES-GCM', length: 256 },
    true,
    ['encrypt', 'decrypt']
  );
}

async function exportRaw(key) {
  return new Uint8Array(await crypto.subtle.exportKey('raw', key));
}

async function importRawAesKey(rawBytes) {
  return crypto.subtle.importKey(
    'raw', rawBytes, { name: 'AES-GCM' }, true, ['encrypt', 'decrypt']
  );
}

// Wrap master key with a KEK. Returns {iv, ct} as base64.
export async function wrapMasterKey(kek, masterKey) {
  const raw = await exportRaw(masterKey);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, kek, raw);
  return { iv: b64(iv), ct: b64(new Uint8Array(ct)) };
}

// Unwrap master key. Throws if KEK is wrong (AES-GCM authentication fails).
export async function unwrapMasterKey(kek, blob) {
  const raw = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: ub64(blob.iv) }, kek, ub64(blob.ct)
  );
  return importRawAesKey(new Uint8Array(raw));
}

// ── Recovery code ────────────────────────────────────────────────────
export function generateRecoveryCode() {
  const bytes = crypto.getRandomValues(new Uint8Array(RECOVERY_CODE_LEN));
  let s = '';
  for (let i = 0; i < RECOVERY_CODE_LEN; i++) {
    if (i > 0 && i % 5 === 0) s += '-';
    s += RECOVERY_ALPHABET[bytes[i] % RECOVERY_ALPHABET.length];
  }
  return s; // e.g. "ABCDE-FGHJK-MNPQR-STUVW-XYZ23"
}

// ── Blob encrypt / decrypt ───────────────────────────────────────────
export async function encryptJSON(masterKey, value) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv }, masterKey, enc.encode(JSON.stringify(value))
  );
  return { iv: b64(iv), ct: b64(new Uint8Array(ct)) };
}

export async function decryptJSON(masterKey, blob) {
  const pt = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: ub64(blob.iv) }, masterKey, ub64(blob.ct)
  );
  return JSON.parse(dec.decode(pt));
}
