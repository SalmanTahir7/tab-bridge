export class StoreError extends Error {
    status;
    constructor(status, message) {
        super(message);
        this.status = status;
    }
}
// Test/local adapter only. Production requires PostgreSQL; never silently falls back.
export class MemoryStore {
    now;
    capacity;
    rows = new Map();
    quotas = new Map();
    constructor(now = () => Date.now(), capacity = 1000) {
        this.now = now;
        this.capacity = capacity;
    }
    async create(row) {
        await this.cleanup();
        const old = this.rows.get(row.id);
        if (old) {
            if (old.authHash === row.authHash && old.iv === row.iv && old.ciphertext === row.ciphertext && !old.claimHash)
                return;
            throw new StoreError(409, 'Transfer identifier already used');
        }
        if (this.rows.size >= this.capacity)
            throw new StoreError(503, 'Transfer storage is full; try later');
        this.rows.set(row.id, { ...row });
    }
    find(id, auth) {
        const row = this.rows.get(id);
        if (!row || row.authHash !== auth || row.expiresAt <= this.now())
            throw new StoreError(404, 'Transfer unavailable');
        return row;
    }
    async claim(id, auth, receipt) {
        const row = this.find(id, auth);
        if ((row.claimHash && row.claimHash !== receipt) || row.acknowledged)
            throw new StoreError(410, 'Transfer already claimed');
        row.claimHash = receipt;
        return { ...row };
    }
    async ack(id, auth, receipt) {
        const row = this.find(id, auth);
        if (row.claimHash !== receipt)
            throw new StoreError(409, 'Claim receipt does not match');
        row.acknowledged = true;
        row.ciphertext = '';
        row.iv = '';
    }
    async quota(key, limit, seconds) {
        const old = this.quotas.get(key);
        const slot = old && old.until > this.now() ? old : { count: 0, until: this.now() + seconds * 1000 };
        slot.count++;
        this.quotas.set(key, slot);
        return slot.count <= limit;
    }
    async cleanup() {
        for (const [id, row] of this.rows)
            if (row.expiresAt <= this.now())
                this.rows.delete(id);
        for (const [key, row] of this.quotas)
            if (row.until <= this.now())
                this.quotas.delete(key);
    }
    async healthy() { return true; }
}
