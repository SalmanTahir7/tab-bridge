import { readFileSync } from 'node:fs';
import { Pool } from 'pg';
import { buildApp } from './app.js';
import { MemoryStore } from './store.js';
import { PostgresStore } from './postgres.js';
import { turnstileVerifier } from './turnstile.js';
const env = process.env;
function secret(name: string) { return env[`${name}_FILE`] ? readFileSync(env[`${name}_FILE`]!, 'utf8').trim() : env[name] || ''; }
const local = env.LOCAL_DEMO === 'true';
if (local && env.NODE_ENV === 'production') throw new Error('LOCAL_DEMO cannot run in production');
const origin = env.PUBLIC_ORIGIN || 'http://localhost:5173';
if (!local && (!origin.startsWith('https://') || new URL(origin).origin !== origin || !secret('TURNSTILE_SECRET') || !env.TURNSTILE_SITE_KEY || secret('QUOTA_SECRET').length < 32 || !env.DATABASE_URL)) throw new Error('Public origin, database URL, site key and strong secrets are required');
const pool = local ? null : new Pool({ connectionString: env.DATABASE_URL, password: secret('POSTGRES_PASSWORD') || undefined, max: 10, connectionTimeoutMillis: 5000, statement_timeout: 5000 });
const store = pool ? new PostgresStore(pool) : new MemoryStore();
if (store instanceof PostgresStore) await store.migrate();
const app = await buildApp({ store, origin, siteKey: env.TURNSTILE_SITE_KEY || '', quotaSecret: secret('QUOTA_SECRET') || 'local-demo-only',
  verify: local ? async value => value === 'local-demo' : turnstileVerifier(secret('TURNSTILE_SECRET'), new URL(origin).hostname),
  staticFiles: env.SERVE_STATIC === 'true', behindTunnel: !local && env.BEHIND_TUNNEL === 'true' });
const cleanup = setInterval(() => { store.cleanup().catch(() => process.stderr.write('cleanup_failed\n')); }, 30000);
cleanup.unref();
for (const signal of ['SIGINT', 'SIGTERM'] as const) process.on(signal, async () => { clearInterval(cleanup); await app.close(); await pool?.end(); process.exit(0); });
await app.listen({ port: Number(env.PORT || 3000), host: local ? '127.0.0.1' : '0.0.0.0' });
process.stdout.write(`Tab Bridge API ready (${local ? 'LOCAL DEMO / ephemeral memory' : 'PostgreSQL'})\n`);
