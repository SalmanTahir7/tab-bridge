import { describe, expect, it } from 'vitest';
import { receive, type Recovery, type RecoveryStore } from '../shared/client';
import { seal } from '../shared/crypto';
function storage() { const rows = new Map<string, Recovery>(); return { rows, get: async (id: string) => rows.get(id), set: async (id: string, row: Recovery) => { rows.set(id, structuredClone(row)); } }; }
describe('interrupted retrieval', () => {
  it('persists receipt before request and uses the same receipt after lost response', async () => {
    const draft = await seal(['https://example.com']), cache = storage(); let savedReceipt = '', calls = 0;
    const send = async (path: string, body?: object) => {
      if (path.endsWith('/ack')) return { ok: true };
      expect(cache.rows.size).toBe(1);
      const receipt = (body as any).receipt;
      if (!calls++) { savedReceipt = receipt; throw new Error('response interrupted after claim'); }
      expect(receipt).toBe(savedReceipt);
      return { ...draft.envelope, expiresAt: Date.now() + 60000 };
    };
    await expect(receive(draft.code, cache, '', send)).rejects.toThrow('interrupted');
    expect((await receive(draft.code, cache, '', send)).urls).toEqual(['https://example.com/']);
  });
  it('recovers locally after lost acknowledgment and never saves plaintext/key', async () => {
    const draft = await seal(['https://example.com/private']), cache = storage(); let claims = 0;
    const send = async (path: string) => { if (path.endsWith('/ack')) throw new Error('lost ack'); claims++; return { ...draft.envelope, expiresAt: Date.now() + 60000 }; };
    expect((await receive(draft.code, cache, '', send)).pendingAck).toBe(true);
    expect((await receive(draft.code, cache, '', send)).urls).toEqual(['https://example.com/private']);
    expect(claims).toBe(1); expect(JSON.stringify([...cache.rows.values()])).not.toContain('private');
    expect(JSON.stringify([...cache.rows.values()])).not.toContain(draft.code.split('.')[2]);
  });
  it('does not claim if browser storage cannot save the receipt', async () => {
    const draft = await seal(['https://example.com']); let requested = false;
    const cache: RecoveryStore = { get: async () => undefined, set: async () => { throw new Error('storage denied'); } };
    await expect(receive(draft.code, cache, '', async () => { requested = true; })).rejects.toThrow('storage denied');
    expect(requested).toBe(false);
  });
});
