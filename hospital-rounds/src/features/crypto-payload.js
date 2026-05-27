"use strict";

// ============================
// QR payload 暗号化 (AES-GCM, アプリ固定鍵)
//
// 目的: 第三者が普通の QR スキャナで読み取った時に医療情報が即座に流出するのを防ぐ。
// 厳密な秘匿性は確保できない (バンドル化された JS から鍵抽出可能) が、
// "脅威モデル = QR スキャナでの偶発的読み取り" には十分。
//
// wire format:
//   平文:   "RND_HM #abc 1/1\n<payload-text>"
//   暗号文: "RND_HM #abc 1/1\nE1:<base64url(iv ‖ ciphertext)>"
//
// 暗号化アルゴリズム: AES-GCM 256bit (Web Crypto API)
//   iv:   12 byte (96 bit)、メッセージごとに crypto.getRandomValues
//   tag:  16 byte (認証付き暗号、改ざん検知)
//
// "E1:" prefix は将来の暗号化方式更新 (E2: / E3: ...) に備えたバージョン番号。
// ============================

// アプリ固定鍵 (32 byte = 256 bit)。ビルドに埋め込まれるため厳密な秘匿は不可能だが、
// 「カメラアプリで偶然読まれて即流出」の防止には十分。後で再配布 / 同期する時の
// 互換性のため、安易に変更しないこと (変更すると旧版で生成された QR を読めなくなる)。
const APP_KEY_BYTES = new Uint8Array([
  0x47, 0xa5, 0x1c, 0x9b, 0x38, 0x6d, 0x2e, 0x71,
  0xf4, 0x83, 0x05, 0xcc, 0x9a, 0x4d, 0x62, 0x18,
  0xb7, 0x29, 0x5a, 0xe0, 0x3c, 0x91, 0x8f, 0x46,
  0xd2, 0x57, 0x6a, 0x0b, 0xfd, 0xe5, 0x18, 0x73,
]);

const ENCRYPTED_PREFIX = "E1:";

let _cachedKeyPromise = null;
function getKey() {
  if (!_cachedKeyPromise) {
    _cachedKeyPromise = crypto.subtle.importKey(
      "raw", APP_KEY_BYTES,
      { name: "AES-GCM" }, false, ["encrypt", "decrypt"]
    );
  }
  return _cachedKeyPromise;
}

// base64url (RFC 4648 §5) — QR でも安全に運べる文字集合 (=/_/-)
function bytesToB64Url(bytes) {
  let s = "";
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function b64UrlToBytes(str) {
  let s = String(str || "").replace(/-/g, "+").replace(/_/g, "/");
  while (s.length % 4) s += "=";
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

// 任意の文字列を AES-GCM 暗号化して "E1:<base64url>" 形式の文字列を返す。
export async function encryptPayload(plain) {
  if (plain == null) return "";
  const key = await getKey();
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const pt = new TextEncoder().encode(String(plain));
  const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, pt);
  // iv (12B) ‖ ciphertext を連結して 1 つの base64url 文字列に
  const combined = new Uint8Array(iv.length + ct.byteLength);
  combined.set(iv, 0);
  combined.set(new Uint8Array(ct), iv.length);
  return ENCRYPTED_PREFIX + bytesToB64Url(combined);
}

// "E1:..." 形式なら復号、それ以外はそのまま返す (平文の透過処理)。
export async function decryptPayload(text) {
  const s = String(text || "");
  if (!s.startsWith(ENCRYPTED_PREFIX)) return s;
  const blob = b64UrlToBytes(s.slice(ENCRYPTED_PREFIX.length));
  if (blob.length < 12 + 16) throw new Error("encrypted payload too short");
  const iv = blob.slice(0, 12);
  const ct = blob.slice(12);
  const key = await getKey();
  const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, ct);
  return new TextDecoder().decode(pt);
}

export function isEncrypted(text) {
  return typeof text === "string" && text.startsWith(ENCRYPTED_PREFIX);
}
