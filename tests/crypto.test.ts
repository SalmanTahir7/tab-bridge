import { describe, it, expect } from 'vitest';
import { seal, unseal, safeUrls, parseCode, random, decode, authorization } from '../shared/crypto';
describe('client encryption', () => {
  it('round trips authenticated data and derives a separate retrieval capability', async () => {
    const draft = await seal(['https://example.com/a?q=private', 'http://example.org']);
    expect(await unseal(draft.code, draft.envelope)).toEqual(['https://example.com/a?q=private', 'http://example.org/']);
    const { secret, id } = parseCode(draft.code);
    expect(decode(secret).length).toBe(32);
    expect(draft.auth).not.toBe(secret);
    expect(await authorization(secret, id)).toBe(draft.auth);
    expect(JSON.stringify(draft.envelope)).not.toContain('private');
  });
  it('rejects changed ciphertext, wrong key, and wrong associated transfer ID', async () => {
    const draft = await seal(['https://example.com']);
    const changed = (draft.envelope.ciphertext[0] === 'A' ? 'B' : 'A') + draft.envelope.ciphertext.slice(1);
    await expect(unseal(draft.code, { ...draft.envelope, ciphertext: changed })).rejects.toThrow();
    await expect(unseal(`tb1.${draft.envelope.id}.${random()}`, draft.envelope)).rejects.toThrow();
    await expect(unseal(`tb1.${random(16)}.${parseCode(draft.code).secret}`, draft.envelope)).rejects.toThrow();
  });
  it('strictly filters schemes and credentials without extracting embedded URLs', () => {
    for (const url of ['javascript:alert(1)', 'data:text/html,https://example.com', 'file:///tmp/a', 'https://user:secret@example.com', 'about:config']) expect(() => safeUrls([url])).toThrow();
    expect(safeUrls(['https://example.com', 'https://example.com/'])).toEqual(['https://example.com/']);
    expect(() => safeUrls(Array(101).fill('https://example.com'))).toThrow();
    expect(() => parseCode('123456')).toThrow();
  });
  it('enforces serialized payload limit', async () => {
    await expect(seal(Array.from({ length: 20 }, (_, i) => `https://example.com/${i}?q=${'a'.repeat(3000)}`))).rejects.toThrow('48 KiB');
  });
});
