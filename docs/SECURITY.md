# Security model and protocol

## Possession grants access

The full code is a bearer capability. Anyone holding it can claim/decrypt the bundle; the service cannot identify the intended recipient. A recipient can save or re-share URLs. A stolen code can consume a transfer and deny the intended recipient access. There is no account recovery. If the secret or winning receipt is lost, regenerate a transfer from the sender's still-open tabs.

## Cryptography v1

- Browser CSPRNG: 16-byte transfer ID, 32-byte secret, fresh 12-byte nonce.
- HKDF-SHA-256: transfer ID salt; independent `tab-bridge/v1/encryption` and `tab-bridge/v1/retrieval` info strings; 32-byte outputs.
- AES-256-GCM: UTF-8 JSON `{version:1,urls:[...]}`, default 128-bit tag, associated data `tb1.<id>`.
- Unpadded base64url; manual code `tb1.<22-character-id>.<43-character-secret>`.
- HTTPS upload includes derived retrieval credential; database stores its SHA-256 hash. Root secret and AES key never go to the API.
- Claim receipt: independent random 32 bytes, saved locally before request; only its SHA-256 hash is stored server-side. Retrying requires both authorization and receipt.

High-entropy random capabilities do not need password stretching. A six-digit PIN would fundamentally weaken this design.

## API

Mutation bodies are JSON; unknown fields are rejected; no account cookies.

| Route | Body/result |
| --- | --- |
| `GET /api/config` | Public Turnstile key; empty only in local demo |
| `POST /api/transfers` | `id, auth, iv, ciphertext, ttlSeconds, turnstileToken`; 201 on create/identical unclaimed retry |
| `POST /api/transfers/:id/claim` | `auth, receipt`; returns nonce/ciphertext/expiry |
| `POST /api/transfers/:id/ack` | `auth, receipt`; idempotently deletes ciphertext |
| `GET /health/live`, `/health/ready` | Minimal process/database status |

Errors: 400 schema; 403 challenge/origin/proxy; 404 missing/expired/wrong capability; 409 ID/receipt conflict; 410 claimed/acknowledged; 413 oversized; 429 quota with Retry-After; 503 capacity/backend failure. No internal error details or secrets returned.

## Transactions, retry and expiry

Creation holds a PostgreSQL advisory transaction lock for row counting/insertion. Identical unclaimed retries neither overwrite data nor extend expiry. IDs remain reserved while tombstones exist. Claim uses authenticated, unexpired `SELECT … FOR UPDATE`, compares receipt hashes, and assigns the first claimant in the same transaction. Different concurrent receipts cannot both win. Claims never become available again after a timeout.

Receiver saves ciphertext before decrypting and acknowledging. Local recovery stores no plaintext/key. Sender session draft does contain the root secret for upload retry; treat it as sensitive and clear it explicitly. Browser session restoration may prolong its retention. Server expiry cannot delete clipboard/history/recipient copies.

Exactly-once delivery is impossible over a failing network: a server cannot know whether an interrupted response arrived. The guarantee is one winning receipt with safe retry. Tab opening is also nontransactional; the extension resumes partial opening while its receiver page remains open, but a reload can lead to duplicates.

Expiry is checked on every claim/ack using database time, regardless of sweeper success. Keep host time synchronized. Local expired recovery is refused and pruned on later writes; a powered-off device can retain ciphertext until next use or explicit clearing. Losing browser storage after claiming may permanently lose the receipt.

## Threat model

| Threat | Mitigation | Limitation |
| --- | --- | --- |
| Database dump | Client encryption, no root key/plaintext | Timing/size/state remain; old ciphertext may exist in WAL/backups |
| Link disclosure | Fragment, high entropy, no-referrer, prompt history replacement | Clipboard/history sync/screenshots/extensions may disclose codes |
| Ciphertext tampering | AES-GCM authentication and ID binding | Server can still delete/delay/refuse data |
| Compromised web origin/script supply chain | CSP, minimal scripts, locked dependencies, review | Delivered JS and allowed Turnstile script remain trusted |
| Scheme injection | Exact parsing, HTTP(S) only, no embedded credentials; revalidate on decrypt | HTTP(S) pages can still be malicious; review links |
| Spam/denial of service | Challenge, durable per-IP/global limits, short TTL, storage caps | Solved challenges/global exhaustion can deny service; shared NAT throttling |
| Spoofed client IP | Direct mode ignores proxy headers; production tunnel-only network | Never expose an alternate origin when BEHIND_TUNNEL=true |
| Cross-origin requests | Exact web origin or Firefox extension-origin check; no cookies | Origin is not authentication; nonbrowser clients may omit it; capabilities/challenges remain mandatory |
| Server/host compromise | Unprivileged app, isolated DB, read-only filesystem, no Docker socket | Host controls web client delivery; encryption does not fix host compromise |
| Power/ISP outage | Persistent volume, retry receipts, bounded TTL | No SLA or account recovery |

Cloudflare terminates TLS and sees metadata and derived retrieval credentials, but the protocol does not send the fragment's root secret. It is part of the trust boundary, not an anonymity service. Allowed scripts can access the page's state. The app removes the fragment promptly but cannot guarantee it never reached history tooling.

Firefox handoff is tied to explicit selected-tab action, the configured exact origin, and the newly opened top-level tab. That web application receives the encrypted draft and code, consistent with the web-client trust model. The content script cannot request arbitrary tab lists. No permanent server credential is packaged.

## Logging, retention and backups

Fastify request logging is disabled. Optional REQUEST_METRICS=true emits route template, response status and elapsed time only. Never enable body/header dumps, raw errors, SQL statement logging, session replay or URL analytics. Cleanup failure logs a generic event. Compose rotates logs at three 5 MiB files per service. Database statement/error-statement logging is disabled in the supplied configuration.

Quota rows contain expiring HMAC address identifiers. Use a strong private secret; rotating it resets effective per-address quotas. Cloudflare log settings are separate and must be reviewed by the operator.

Do not back up live transfers by default. Restoring an old database can resurrect already-redeemed capabilities, violating one-time expectations. Restore schema/configuration with empty transfer/quota tables, as the runbook describes. Logical deletion is not physical erasure from PostgreSQL pages, WAL, SSDs or snapshots.

## Primary references

- [Web Crypto AES-GCM](https://developer.mozilla.org/en-US/docs/Web/API/SubtleCrypto/encrypt)
- [PostgreSQL explicit locking](https://www.postgresql.org/docs/current/explicit-locking.html)
- [Turnstile server verification](https://developers.cloudflare.com/turnstile/get-started/server-side-validation/)
- [Firefox menu click API](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/API/menus/onClicked)
- [Docker firewall behavior](https://docs.docker.com/engine/network/packet-filtering-firewalls/)
