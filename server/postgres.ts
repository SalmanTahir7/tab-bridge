import { Pool, type PoolClient } from 'pg';
import { readFile } from 'node:fs/promises';
import { StoreError, type Store, type StoredTransfer } from './store.js';
function map(row: any): StoredTransfer {
  return { id: row.id, authHash: row.auth_hash, iv: row.iv, ciphertext: row.ciphertext, expiresAt: new Date(row.expires_at).getTime(), claimHash: row.claim_hash, acknowledged: row.acknowledged };
}
export class PostgresStore implements Store {
  constructor(public pool: Pool, private capacity = 1000) {}
  async migrate() { await this.pool.query(await readFile(new URL('./schema.sql', import.meta.url), 'utf8')); }
  private async transaction<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try { await client.query('BEGIN'); const result = await fn(client); await client.query('COMMIT'); return result; }
    catch (error) { await client.query('ROLLBACK'); throw error; }
    finally { client.release(); }
  }
  async create(row: StoredTransfer) {
    await this.transaction(async client => {
      // Serialize capacity accounting and duplicate uploads across all API workers.
      await client.query('SELECT pg_advisory_xact_lock(824219)');
      await client.query('DELETE FROM transfers WHERE expires_at <= now()');
      const old = await client.query('SELECT * FROM transfers WHERE id=$1', [row.id]);
      if (old.rowCount) {
        const value = map(old.rows[0]);
        if (value.authHash === row.authHash && value.iv === row.iv && value.ciphertext === row.ciphertext && !value.claimHash) return;
        throw new StoreError(409, 'Transfer identifier already used');
      }
      const count = await client.query('SELECT count(*)::integer AS n FROM transfers');
      if (count.rows[0].n >= this.capacity) throw new StoreError(503, 'Transfer storage is full; try later');
      await client.query('INSERT INTO transfers(id,auth_hash,iv,ciphertext,expires_at) VALUES($1,$2,$3,$4,$5)', [row.id, row.authHash, row.iv, row.ciphertext, new Date(row.expiresAt)]);
    });
  }
  private async locked(client: PoolClient, id: string, auth: string) {
    const result = await client.query('SELECT * FROM transfers WHERE id=$1 AND auth_hash=$2 AND expires_at>now() FOR UPDATE', [id, auth]);
    if (!result.rowCount) throw new StoreError(404, 'Transfer unavailable');
    return map(result.rows[0]);
  }
  async claim(id: string, auth: string, receipt: string) {
    return this.transaction(async client => {
      const row = await this.locked(client, id, auth);
      if ((row.claimHash && row.claimHash !== receipt) || row.acknowledged) throw new StoreError(410, 'Transfer already claimed');
      await client.query('UPDATE transfers SET claim_hash=$2 WHERE id=$1', [id, receipt]);
      return { ...row, claimHash: receipt };
    });
  }
  async ack(id: string, auth: string, receipt: string) {
    await this.transaction(async client => {
      const row = await this.locked(client, id, auth);
      if (row.claimHash !== receipt) throw new StoreError(409, 'Claim receipt does not match');
      await client.query("UPDATE transfers SET acknowledged=true,ciphertext='',iv='' WHERE id=$1", [id]);
    });
  }
  async quota(key: string, limit: number, seconds: number) {
    const result = await this.pool.query(`INSERT INTO quotas(key,count,expires_at) VALUES($1,1,now()+$2*interval '1 second')
      ON CONFLICT(key) DO UPDATE SET count=CASE WHEN quotas.expires_at<=now() THEN 1 ELSE quotas.count+1 END,
      expires_at=CASE WHEN quotas.expires_at<=now() THEN now()+$2*interval '1 second' ELSE quotas.expires_at END RETURNING count`, [key, seconds]);
    return result.rows[0].count <= limit;
  }
  async cleanup() {
    await this.pool.query('DELETE FROM transfers WHERE expires_at<=now()');
    await this.pool.query('DELETE FROM quotas WHERE expires_at<=now()');
  }
  async healthy() { await this.pool.query('SELECT 1'); return true; }
}
