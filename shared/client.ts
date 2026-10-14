import { authorization, parseCode, random, unseal } from './crypto';
export type Recovery = { receipt: string; expiresAt: number; envelope?: { iv: string; ciphertext: string }; acknowledged?: boolean };
export interface RecoveryStore { get(id: string): Promise<Recovery | undefined>; set(id: string, value: Recovery): Promise<void>; }
export async function api(path: string, body?: object, base = '') {
  const response = await fetch(`${base}/api${path}`, { method: body ? 'POST' : 'GET', headers: body ? { 'Content-Type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined, credentials: 'omit', cache: 'no-store', signal: AbortSignal.timeout(15000) });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || 'Transfer request failed');
  return result;
}
export async function receive(code: string, storage: RecoveryStore, base = '', send = api) {
  const { id, secret } = parseCode(code), auth = await authorization(secret, id);
  let recovery = await storage.get(id);
  if (!recovery || recovery.expiresAt <= Date.now()) {
    recovery = { receipt: random(), expiresAt: Date.now() + 3600000 };
    // Fail before claiming if browser storage is unavailable: no unrecoverable claim.
    await storage.set(id, recovery);
  }
  if (!recovery.envelope) {
    const envelope = await send(`/transfers/${id}/claim`, { auth, receipt: recovery.receipt }, base);
    recovery = { ...recovery, envelope, expiresAt: envelope.expiresAt };
    await storage.set(id, recovery);
  }
  const urls = await unseal(code, recovery.envelope!);
  // Ciphertext has already been saved and authenticated before deletion on server.
  let pendingAck = false;
  if (!recovery.acknowledged) {
    try {
      await send(`/transfers/${id}/ack`, { auth, receipt: recovery.receipt }, base);
      recovery.acknowledged = true; await storage.set(id, recovery);
    } catch { pendingAck = true; }
  }
  return { urls, pendingAck, expiresAt: recovery.expiresAt };
}
export const browserRecovery: RecoveryStore = {
  async get(id) {
    const value = localStorage.getItem(`tb-recovery:${id}`);
    return value ? JSON.parse(value) : undefined;
  },
  async set(id, value) {
    // Bound local retention. No decryption keys or plaintext URLs are saved here.
    for (const key of Object.keys(localStorage).filter(k => k.startsWith('tb-recovery:'))) {
      try { if (JSON.parse(localStorage.getItem(key)!).expiresAt <= Date.now()) localStorage.removeItem(key); }
      catch { localStorage.removeItem(key); }
    }
    if (!localStorage.getItem(`tb-recovery:${id}`) && Object.keys(localStorage).filter(k => k.startsWith('tb-recovery:')).length >= 10)
      throw new Error('Local recovery storage is full. Clear completed transfers first.');
    localStorage.setItem(`tb-recovery:${id}`, JSON.stringify(value));
  }
};
