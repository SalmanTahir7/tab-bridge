import { afterEach, describe, expect, it } from 'vitest';
import { buildApp } from '../server/app';
import { MemoryStore } from '../server/store';
import { random, seal } from '../shared/crypto';
const apps: Awaited<ReturnType<typeof buildApp>>[] = [];
async function setup(store = new MemoryStore()) {
  const app = await buildApp({ store, origin: 'https://tabs.example.com', siteKey: 'test', quotaSecret: 'test-key', verify: async token => token === 'valid' });
  apps.push(app); return { app, store };
}
afterEach(async () => { await Promise.all(apps.splice(0).map(app => app.close())); });
describe('public API', () => {
  it('allows one claimant, same-receipt retries, idempotent ack, then no ciphertext', async () => {
    const { app, store } = await setup(), draft = await seal(['https://example.com/private']);
    const payload = { ...draft.envelope, auth: draft.auth, turnstileToken: 'valid' };
    expect((await app.inject({ method: 'POST', url: '/api/transfers', payload })).statusCode).toBe(201);
    expect((await app.inject({ method: 'POST', url: '/api/transfers', payload })).statusCode).toBe(201);
    const path = `/api/transfers/${draft.envelope.id}`;
    const receipt = random();
    const results = await Promise.all([receipt, random()].map(receipt => app.inject({ method: 'POST', url: `${path}/claim`, payload: { auth: draft.auth, receipt } })));
    expect(results.map(r => r.statusCode).sort()).toEqual([200, 410]);
    const winner = results[0].statusCode === 200 ? receipt : ''; expect(winner).not.toBe('');
    expect((await app.inject({ method: 'POST', url: `${path}/claim`, payload: { auth: draft.auth, receipt } })).json().ciphertext).toBe(draft.envelope.ciphertext);
    for (let n = 0; n < 2; n++) expect((await app.inject({ method: 'POST', url: `${path}/ack`, payload: { auth: draft.auth, receipt } })).statusCode).toBe(200);
    expect(store.rows.get(draft.envelope.id)!.ciphertext).toBe('');
    expect((await app.inject({ method: 'POST', url: `${path}/claim`, payload: { auth: draft.auth, receipt } })).statusCode).toBe(410);
  });
  it('requires Turnstile, bounds input, rejects foreign web origins and bad capabilities', async () => {
    const { app } = await setup(), draft = await seal(['https://example.com']);
    const payload = { ...draft.envelope, auth: draft.auth, turnstileToken: 'invalid' };
    expect((await app.inject({ method: 'POST', url: '/api/transfers', payload })).statusCode).toBe(403);
    expect((await app.inject({ method: 'POST', url: '/api/transfers', payload: { ...payload, ttlSeconds: 3601 } })).statusCode).toBe(400);
    expect((await app.inject({ method: 'POST', url: '/api/transfers', payload: { ...payload, extra: 'field' } })).statusCode).toBe(400);
    expect((await app.inject({ method: 'POST', url: '/api/transfers', headers: { origin: 'https://evil.example' }, payload })).statusCode).toBe(403);
    expect((await app.inject({ method: 'POST', url: '/api/transfers', payload: { ...payload, ciphertext: 'a'.repeat(80000) } })).statusCode).toBe(413);
    expect((await app.inject({ method: 'POST', url: `/api/transfers/${draft.envelope.id}/claim`, payload: { auth: random(), receipt: random() } })).statusCode).toBe(404);
  });
  it('enforces expiry even before sweeping and enforces global capacity', async () => {
    let now = Date.now(); const store = new MemoryStore(() => now, 1), { app } = await setup(store);
    const first = await seal(['https://example.com'], 60), second = await seal(['https://example.org']);
    for (const [draft, status] of [[first, 201], [second, 503]] as const) expect((await app.inject({ method: 'POST', url: '/api/transfers', payload: { ...draft.envelope, auth: draft.auth, turnstileToken: 'valid' } })).statusCode).toBe(status);
    now += 61000;
    expect((await app.inject({ method: 'POST', url: `/api/transfers/${first.envelope.id}/claim`, payload: { auth: first.auth, receipt: random() } })).statusCode).toBe(404);
    await store.cleanup(); expect(store.rows.size).toBe(0);
  });
  it('limits requests and does not trust spoofed forwarding headers in direct mode', async () => {
    const { app } = await setup();
    for (let n = 0; n < 60; n++) expect((await app.inject({ url: '/api/config', headers: { 'cf-connecting-ip': `fake-${n}` } })).statusCode).toBe(200);
    const response = await app.inject('/api/config'); expect(response.statusCode).toBe(429); expect(response.headers['retry-after']).toBe('60');
  });
});
