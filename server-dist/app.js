import Fastify from 'fastify';
import helmet from '@fastify/helmet';
import fastifyStatic from '@fastify/static';
import { createHash, createHmac } from 'node:crypto';
import { resolve } from 'node:path';
import { StoreError } from './store.js';
const hash = (value) => createHash('sha256').update(value).digest('hex');
const token = { type: 'string', pattern: '^[A-Za-z0-9_-]{43}$' };
const id = { type: 'string', pattern: '^[A-Za-z0-9_-]{22}$' };
const schema = (properties) => ({ type: 'object', additionalProperties: false, required: Object.keys(properties), properties });
export async function buildApp(config) {
    const app = Fastify({ bodyLimit: 72 * 1024, logger: false, trustProxy: false, requestTimeout: 10000, connectionTimeout: 10000,
        ajv: { customOptions: { removeAdditional: false } } });
    await app.register(helmet, { contentSecurityPolicy: { directives: {
                defaultSrc: ["'self'"], scriptSrc: ["'self'", 'https://challenges.cloudflare.com'],
                frameSrc: ['https://challenges.cloudflare.com'], connectSrc: ["'self'"], styleSrc: ["'self'"],
                objectSrc: ["'none'"], baseUri: ["'none'"], formAction: ["'self'"], frameAncestors: ["'none'"]
            } }, referrerPolicy: { policy: 'no-referrer' } });
    app.addHook('onRequest', async (req, reply) => {
        reply.header('Cache-Control', 'no-store');
        if (!req.url.startsWith('/api/'))
            return;
        if (req.headers.origin && req.headers.origin !== config.origin && !/^moz-extension:\/\/[a-f0-9-]+$/.test(req.headers.origin))
            return reply.code(403).send({ error: 'Origin not allowed' });
        // Trust this header only in the isolated tunnel-only deployment, never on a public/LAN-bound origin.
        const ip = config.behindTunnel ? String(req.headers['cf-connecting-ip'] || '') : req.ip;
        if (!ip)
            return reply.code(403).send({ error: 'Proxy identity missing' });
        const bucket = createHmac('sha256', config.quotaSecret).update(ip).digest('hex');
        // Global check FIRST bounds attacker-created quota rows and work per minute.
        if (!await config.store.quota('global:requests', 3000, 60) || !await config.store.quota(`requests:${bucket}`, 60, 60))
            return reply.code(429).header('Retry-After', '60').send({ error: 'Request quota reached; retry later' });
        if (req.method === 'POST' && req.url === '/api/transfers') {
            if (!await config.store.quota('global:uploads', 200, 3600) || !await config.store.quota(`uploads:${bucket}`, 20, 3600))
                return reply.code(429).header('Retry-After', '3600').send({ error: 'Upload quota reached; retry later' });
        }
    });
    app.setErrorHandler((error, _req, reply) => {
        const candidate = error.statusCode;
        const status = error instanceof StoreError ? error.status : candidate && candidate < 500 ? candidate : 503;
        reply.code(status).send({ error: error instanceof StoreError ? error.message : status < 500 ? 'Invalid request' : 'Service temporarily unavailable' });
    });
    app.addHook('onResponse', async (request, reply) => {
        if (process.env.REQUEST_METRICS === 'true')
            process.stdout.write(JSON.stringify({ event: 'request', route: request.routeOptions.url || 'unmatched', status: reply.statusCode, elapsedMs: Math.round(reply.elapsedTime) }) + '\n');
    });
    app.get('/health/live', async () => ({ ok: true }));
    app.get('/health/ready', async (_req, reply) => {
        try {
            await config.store.healthy();
            return { ok: true };
        }
        catch {
            return reply.code(503).send({ ok: false });
        }
    });
    app.get('/api/config', async () => ({ siteKey: config.siteKey }));
    app.post('/api/transfers', {
        schema: { body: schema({ id, auth: token, iv: { type: 'string', pattern: '^[A-Za-z0-9_-]{16}$' }, ciphertext: { type: 'string', pattern: '^[A-Za-z0-9_-]+$', minLength: 24, maxLength: 65560 }, ttlSeconds: { type: 'integer', minimum: 60, maximum: 3600 }, turnstileToken: { type: 'string', minLength: 1, maxLength: 2048 } }) }
    }, async (req, reply) => {
        if (!await config.verify(req.body.turnstileToken, config.behindTunnel ? String(req.headers['cf-connecting-ip']) : req.ip))
            return reply.code(403).send({ error: 'Verification failed. Complete a new challenge and retry.' });
        const b = req.body;
        await config.store.create({ id: b.id, authHash: hash(b.auth), iv: b.iv, ciphertext: b.ciphertext, expiresAt: Date.now() + b.ttlSeconds * 1000, claimHash: null, acknowledged: false });
        return reply.code(201).send({ id: b.id });
    });
    const claimSchema = { body: schema({ auth: token, receipt: token }), params: schema({ id }) };
    app.post('/api/transfers/:id/claim', { schema: claimSchema }, async (req) => {
        const row = await config.store.claim(req.params.id, hash(req.body.auth), hash(req.body.receipt));
        return { iv: row.iv, ciphertext: row.ciphertext, expiresAt: row.expiresAt };
    });
    app.post('/api/transfers/:id/ack', { schema: claimSchema }, async (req) => {
        await config.store.ack(req.params.id, hash(req.body.auth), hash(req.body.receipt));
        return { ok: true };
    });
    if (config.staticFiles)
        await app.register(fastifyStatic, { root: resolve('dist') });
    return app;
}
