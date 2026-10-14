// Both web and extension use this protocol. Secrets never enter an API URL.
export const MAX_TABS = 100;
export const MAX_PLAIN_BYTES = 48 * 1024;
export const encode = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
export function decode(value: string): Uint8Array<ArrayBuffer> {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) throw new Error('Invalid code encoding');
  return Uint8Array.from(atob(value.replaceAll('-', '+').replaceAll('_', '/')), c => c.charCodeAt(0));
}
export const random = (size = 32) => encode(crypto.getRandomValues(new Uint8Array(size)));
const utf8 = new TextEncoder();
export function safeUrls(values: unknown): string[] {
  if (!Array.isArray(values) || values.length < 1 || values.length > MAX_TABS) throw new Error('Choose between 1 and 100 tabs');
  const urls = values.map(value => {
    if (typeof value !== 'string' || value.length > 4096) throw new Error('Invalid or overly long URL');
    const url = new URL(value.trim());
    if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) throw new Error('Only HTTP(S) URLs without embedded credentials are allowed');
    return url.href;
  });
  return [...new Set(urls)];
}
export function parseCode(raw: string) {
  const code = raw.trim().includes('#') ? raw.trim().split('#')[1] : raw.trim();
  const parts = /^tb1\.([A-Za-z0-9_-]{22})\.([A-Za-z0-9_-]{43})$/.exec(code);
  if (!parts || decode(parts[1]).length !== 16 || decode(parts[2]).length !== 32) throw new Error('Paste a complete Tab Bridge link or code');
  if (encode(decode(parts[1])) !== parts[1] || encode(decode(parts[2])) !== parts[2]) throw new Error('Noncanonical transfer code');
  return { id: parts[1], secret: parts[2], code };
}
async function derive(secret: string, id: string, purpose: string) {
  const material = await crypto.subtle.importKey('raw', decode(secret), 'HKDF', false, ['deriveBits']);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt: decode(id), info: utf8.encode(`tab-bridge/v1/${purpose}`) }, material, 256));
}
export async function authorization(secret: string, id: string) { return encode(await derive(secret, id, 'retrieval')); }
export type Envelope = { id: string; iv: string; ciphertext: string; ttlSeconds: number };
export async function seal(values: unknown, ttlSeconds = 900) {
  const urls = safeUrls(values), id = random(16), secret = random(), iv = random(12);
  const plain = utf8.encode(JSON.stringify({ version: 1, urls }));
  if (plain.length > MAX_PLAIN_BYTES) throw new Error('Tab list exceeds 48 KiB');
  const key = await crypto.subtle.importKey('raw', await derive(secret, id, 'encryption'), 'AES-GCM', false, ['encrypt']);
  const ciphertext = encode(new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: decode(iv), additionalData: utf8.encode(`tb1.${id}`) }, key, plain)));
  return { envelope: { id, iv, ciphertext, ttlSeconds }, code: `tb1.${id}.${secret}`, auth: await authorization(secret, id) };
}
export async function unseal(code: string, envelope: Pick<Envelope, 'iv' | 'ciphertext'>) {
  const { id, secret } = parseCode(code);
  const key = await crypto.subtle.importKey('raw', await derive(secret, id, 'encryption'), 'AES-GCM', false, ['decrypt']);
  const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: decode(envelope.iv), additionalData: utf8.encode(`tb1.${id}`) }, key, decode(envelope.ciphertext));
  if (plain.byteLength > MAX_PLAIN_BYTES) throw new Error('Transfer exceeds local limit');
  const data = JSON.parse(new TextDecoder().decode(plain));
  if (data.version !== 1) throw new Error('Unsupported transfer format');
  return safeUrls(data.urls);
}
