// 暗号まわり（PIN の確認、ID の郵便ポスト方式）
// すべて iPhone のブラウザに入っている標準の仕組み（Web Crypto）を使う。

const te = new TextEncoder();
const td = new TextDecoder();

export function b64(buf) {
  const bytes = new Uint8Array(buf);
  let s = '';
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s);
}
export function unb64(s) {
  return Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
}
export const randBytes = (n) => crypto.getRandomValues(new Uint8Array(n));

const PIN_ITER = 150000;
const PASS_ITER = 600000;

async function pbkdf2Bits(secret, salt, iterations) {
  const base = await crypto.subtle.importKey('raw', te.encode(secret), 'PBKDF2', false, ['deriveBits']);
  return crypto.subtle.deriveBits({ name: 'PBKDF2', salt, iterations, hash: 'SHA-256' }, base, 256);
}

// ---- PIN ----
export async function hashPin(pin, saltB64) {
  const salt = saltB64 ? unb64(saltB64) : randBytes(16);
  const bits = await pbkdf2Bits(pin, salt, PIN_ITER);
  return { salt: b64(salt), hash: b64(bits) };
}

export async function verifyPin(pin, rec) {
  if (!rec) return false;
  const { hash } = await hashPin(pin, rec.salt);
  return hash === rec.hash;
}

// ---- 合言葉から AES の鍵を作る ----
async function aesFromPass(pass, salt, iterations) {
  const base = await crypto.subtle.importKey('raw', te.encode(pass), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations, hash: 'SHA-256' },
    base,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

async function wrapPrivate(pkcs8, pass) {
  const salt = randBytes(16);
  const iv = randBytes(12);
  const key = await aesFromPass(pass, salt, PASS_ITER);
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, pkcs8);
  return { salt: b64(salt), iv: b64(iv), encPrivateKey: b64(ct), iter: PASS_ITER };
}

// 合言葉が違うと例外になる
async function unwrapPrivate(keys, pass) {
  const key = await aesFromPass(pass, unb64(keys.salt), keys.iter || PASS_ITER);
  return crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(keys.iv) }, key, unb64(keys.encPrivateKey));
}

// ---- 郵便ポスト方式（入れる鍵と取り出す鍵が別） ----
const RSA = { name: 'RSA-OAEP', hash: 'SHA-256' };

export async function createIdKeys(pass) {
  const kp = await crypto.subtle.generateKey(
    { ...RSA, modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]) },
    true,
    ['encrypt', 'decrypt'],
  );
  const spki = await crypto.subtle.exportKey('spki', kp.publicKey);
  const pkcs8 = await crypto.subtle.exportKey('pkcs8', kp.privateKey);
  return { publicKey: b64(spki), ...(await wrapPrivate(pkcs8, pass)) };
}

export async function changePass(keys, oldPass, newPass) {
  const pkcs8 = await unwrapPrivate(keys, oldPass);
  return { publicKey: keys.publicKey, ...(await wrapPrivate(pkcs8, newPass)) };
}

export async function encryptId(keys, id) {
  const pub = await crypto.subtle.importKey('spki', unb64(keys.publicKey), RSA, false, ['encrypt']);
  return b64(await crypto.subtle.encrypt({ name: 'RSA-OAEP' }, pub, te.encode(id)));
}

// 合言葉で取り出す鍵を開ける（違えば例外）
export async function openPrivate(keys, pass) {
  const pkcs8 = await unwrapPrivate(keys, pass);
  return crypto.subtle.importKey('pkcs8', pkcs8, RSA, false, ['decrypt']);
}

export async function decryptId(privKey, ct) {
  return td.decode(await crypto.subtle.decrypt({ name: 'RSA-OAEP' }, privKey, unb64(ct)));
}

// ---- 識別番号（ランダムな英数字 4 文字。0/O/1/I は使わない） ----
export const CODE_CHARS = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';

export function randomCode(existing = new Set()) {
  for (;;) {
    const b = randBytes(4);
    let c = '';
    for (const x of b) c += CODE_CHARS[x % 32];
    if (!existing.has(c)) return c;
  }
}
