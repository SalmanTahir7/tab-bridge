import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Pool } from 'pg';
import { PostgresStore } from '../server/postgres';
import { random } from '../shared/crypto';
describe.skipIf(!process.env.TEST_DATABASE_URL)('real PostgreSQL transactions (dedicated test database)', () => {
  const pool = new Pool({ connectionString: process.env.TEST_DATABASE_URL, max: 12 });
  const store = new PostgresStore(pool, 2);
  beforeAll(async () => { await store.migrate(); await pool.query('TRUNCATE transfers, quotas'); });
  afterAll(async () => { await pool.end(); });
  it('resolves concurrent claims to exactly one receipt and allows its retries', async () => {
    const id = random(16); await store.create({ id, authHash: 'auth', ciphertext: 'cipher', iv: 'iv', expiresAt: Date.now() + 60000, claimHash: null, acknowledged: false });
    const outcomes = await Promise.allSettled(Array.from({ length: 10 }, (_, n) => store.claim(id, 'auth', `receipt${n}`)));
    expect(outcomes.filter(x => x.status === 'fulfilled')).toHaveLength(1);
    const winner = outcomes.find(x => x.status === 'fulfilled') as PromiseFulfilledResult<any>;
    expect((await store.claim(id, 'auth', winner.value.claimHash)).ciphertext).toBe('cipher');
    await store.ack(id, 'auth', winner.value.claimHash); await store.ack(id, 'auth', winner.value.claimHash);
    expect((await pool.query('SELECT ciphertext FROM transfers WHERE id=$1', [id])).rows[0].ciphertext).toBe('');
  });
  it('serializes capacity checks and removes expired rows', async () => {
    await pool.query('TRUNCATE transfers');
    const outcomes = await Promise.allSettled(Array.from({ length: 8 }, () => store.create({ id: random(16), authHash: 'a', ciphertext: 'c', iv: 'i', expiresAt: Date.now() + 60000, claimHash: null, acknowledged: false })));
    expect(outcomes.filter(x => x.status === 'fulfilled')).toHaveLength(2);
    await pool.query("UPDATE transfers SET expires_at=now()-interval '1 second'");
    await store.cleanup(); expect((await pool.query('SELECT count(*) FROM transfers')).rows[0].count).toBe('0');
  });
  it('counts concurrent quotas without lost updates', async () => {
    const results = await Promise.all(Array.from({ length: 15 }, () => store.quota('test', 5, 60)));
    expect(results.filter(Boolean)).toHaveLength(5);
  });
  it('rejects expiry before cleanup and wrong capability without changing the claim', async () => {
    await pool.query('TRUNCATE transfers');
    const id = random(16);
    await store.create({ id, authHash: 'correct', ciphertext: 'c', iv: 'i', expiresAt: Date.now() + 60000, claimHash: null, acknowledged: false });
    await expect(store.claim(id, 'wrong', 'receipt')).rejects.toMatchObject({ status: 404 });
    expect((await pool.query('SELECT claim_hash FROM transfers WHERE id=$1', [id])).rows[0].claim_hash).toBeNull();
    await pool.query("UPDATE transfers SET expires_at=now()-interval '1 second' WHERE id=$1", [id]);
    await expect(store.claim(id, 'correct', 'receipt')).rejects.toMatchObject({ status: 404 });
  });
});
