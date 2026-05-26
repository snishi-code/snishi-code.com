"use strict";

// AES-GCM + PBKDF2 with WebCrypto. Returns a versioned, URL-safe-ish text payload.

// OWASP 2023 推奨値 (SHA-256 + PBKDF2)。E1 wire 形式のまま反復数だけ引き上げる。
// 旧 100k で作られた payload は復号できないため、相互運用には全端末を更新する
// (院内パイロットでは同一タグからフォークするので問題なし)。
const PBKDF2_ITER = 600000;
const PBKDF2_HASH = "SHA-256";
const AES_NAME = "AES-GCM";
const AES_LEN = 256;
const IV_LEN = 12;

function b64(bytes) {
  let s = "";
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s).replace(/=+$/, "");
}
function unb64(s) {
  const pad = s.length % 4 === 0 ? "" : "=".repeat(4 - (s.length % 4));
  const raw = atob(s + pad);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

async function deriveKey(passphrase, saltStr) {
  const enc = new TextEncoder();
  const base = await crypto.subtle.importKey(
    "raw",
    enc.encode(String(passphrase || "")),
    "PBKDF2",
    false,
    ["deriveKey"]
  );
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", salt: enc.encode(String(saltStr || "")), iterations: PBKDF2_ITER, hash: PBKDF2_HASH },
    base,
    { name: AES_NAME, length: AES_LEN },
    false,
    ["encrypt", "decrypt"]
  );
}

// Returns base64 of `iv || ciphertext`. Format prefix `E1:` for versioning.
export async function encryptText(plaintext, passphrase, salt) {
  const key = await deriveKey(passphrase, salt);
  const iv = crypto.getRandomValues(new Uint8Array(IV_LEN));
  const enc = new TextEncoder().encode(String(plaintext || ""));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: AES_NAME, iv }, key, enc));
  const buf = new Uint8Array(iv.length + ct.length);
  buf.set(iv, 0);
  buf.set(ct, iv.length);
  return "E1:" + b64(buf);
}

export async function decryptText(payload, passphrase, salt) {
  const s = String(payload || "");
  if (!s.startsWith("E1:")) throw new Error("形式が不正です");
  const buf = unb64(s.slice(3));
  if (buf.length <= IV_LEN) throw new Error("形式が不正です");
  const iv = buf.slice(0, IV_LEN);
  const ct = buf.slice(IV_LEN);
  const key = await deriveKey(passphrase, salt);
  let dec;
  try {
    dec = await crypto.subtle.decrypt({ name: AES_NAME, iv }, key, ct);
  } catch (_) {
    throw new Error("復号失敗（パスフレーズ違い）");
  }
  return new TextDecoder().decode(dec);
}

// Short fingerprint of passphrase+salt for "same key?" verification without leaking the key
export async function passphraseFingerprint(passphrase, salt) {
  const enc = new TextEncoder();
  const h = await crypto.subtle.digest("SHA-256", enc.encode("FP:" + (passphrase || "") + ":" + (salt || "")));
  return b64(new Uint8Array(h)).slice(0, 12);
}
