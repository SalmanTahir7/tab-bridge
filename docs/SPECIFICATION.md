# Final product requirements

Version 2 · 13 October 2026. Supersedes owner-only authentication, Netlify backend hosting/storage, and private-network-only access assumptions.

## Objective

Build a public, privacy-focused, accountless browser-tab transfer utility for personal use, free use by portfolio visitors worldwide, and demonstration of full-stack, DevOps, and cybersecurity engineering. Host on an Ubuntu Server laptop connected by Ethernet to a Deco router.

The supplied baseline was a local-only Firefox extension. This update extends that codebase with a functioning web application and API. Development is local-first. Publication, production deployment, router changes, and tunnel/DNS activation require owner authorization; none is performed automatically.

## Architecture requirements

| Layer | Required implementation |
| --- | --- |
| Frontend | React, Vite, TypeScript; accessible send/receive forms |
| Backend | Node.js, Fastify, TypeScript; strict validation |
| Temporary storage | PostgreSQL ciphertext, claim state, expiry and quotas |
| Infrastructure | Docker Compose with limits, health checks and persistence |
| Public HTTPS | Outbound Cloudflare Tunnel, no router port forwarding |
| Abuse prevention | Turnstile server verification; per-client/global quotas |
| Automation | GitHub Actions testing/build; eventual protected deployment |
| Portfolio | Standalone initially; later linked from existing Netlify portfolio |

No Netlify Functions or Blobs, visitor accounts, owner passwords, public database, public Docker administration, or public SSH.

## Functional acceptance

1. **Create:** accept 1–100 HTTP(S) URLs; deduplicate; reject unsupported schemes and embedded credentials; maximum 4096 characters per URL and 48 KiB serialized plaintext. Encrypt locally before uploading.
2. **Share:** generate cryptographically random 256-bit secrets (minimum requirement: 128 bits). Provide `https://<origin>/#tb1.<id>.<secret>` and a copyable manual code. Code length is intentional; no guessable short PIN. Optional QR codes must be rendered locally from the same link; deferred in this release.
3. **Retrieve:** explicit user action claims the transfer; merely opening a link does not consume it. Authenticate/decrypt locally, revalidate URLs, show a preview before opening. Web UI offers individual links/copy list; Firefox opens all reviewed tabs.
4. **Single recipient:** concurrent different receipts yield one winner. Only the same receipt resumes that claim. Never release a claim back to another recipient. Acknowledgment deletes ciphertext while retaining an expiring tombstone for idempotency.
5. **Failure recovery:** persist receipt before claim, ciphertext before acknowledgment, and never acknowledge failed authentication/decryption. Preserve identical sender draft/ID/key for interrupted upload responses. Fresh Turnstile token required on upload retry; retry never extends existing expiry. Document loss when the code or sole receipt is gone.
6. **Expiry:** UI offers 5/15/60 minutes; API supports 60–3600 seconds. Enforce expiry during every database lookup, independent of the 30-second sweeper. Logical expiry is not forensic erasure from WAL, backups, history or recipients.
7. **Firefox:** support multi-selection, right-click send and code import using the same API. Tab-bound, exact-origin handoff passes an encrypted draft to a web challenge. No privileged server credential in the extension. Preserve local copy/import.
8. **Local privacy:** explicit clear-data control. Recovery storage contains ciphertext and receipt, not decryption key/plaintext. Sender session draft contains the secret to enable upload retry and must be described as sensitive.

## Limits and public protection

| Control | Default |
| --- | --- |
| Body/ciphertext | 72 KiB body; 65,560 base64url ciphertext characters |
| Storage | 1,000 rows including tombstones, atomically enforced |
| Per-client requests | 60 per 60 seconds |
| Global requests | 3,000 per 60 seconds |
| Per-client uploads | 20 attempts per hour |
| Global uploads | 200 attempts per hour |
| TTL | Maximum 1 hour |
| Local recovery | At most 10 entries, expiry pruning on writes |
| DB pool | 10 connections; 5-second query/connection timeout |

Failed attempts count. Shared NAT users share quotas. IPv6 rotation can evade per-address limits; global limits and Turnstile remain necessary. IP quota keys are HMAC-derived and expire, not logged in plaintext. Verify Turnstile success, exact hostname, and action `upload` server-side. Fail closed on outages. Configure additional Cloudflare edge protections before launch.

## Operational/security requirements

- No URLs or transfer secrets in request/access/error logs, analytics, or the database. No query-string capabilities, third-party analytics or session replay.
- No-store responses, no-referrer policy, CSP, no framing, and safe external link attributes.
- Public Compose publishes no host ports. Database internal network only. No Docker socket or unauthenticated TCP daemon. LAN-only SSH keys; no public management routes.
- Privacy notice acknowledges Cloudflare network metadata, trusted delivered JavaScript, clipboard/history risks, and capability access limitations.
- Deployment instructions must cover Ubuntu installation, Ethernet/DHCP, SSH, firewall/IPv6, Docker, tunnel, reverse proxy choice, persistence, backup/recovery, updates, health and logs.

## Milestones and exit gates

| Milestone | Deliverables | Exit gate |
| --- | --- | --- |
| M1 Local protocol/app | Crypto, validation, React, codes, local API | Build, crypto/tamper tests, local round trip |
| M2 Durable lifecycle | PostgreSQL, row locks, quotas, expiry, recovery | Real DB claim/capacity/quota races; injected network-failure tests |
| M3 Public abuse boundary | Turnstile, strict config, proxy trust, limits, logs | Live challenge success/replay/expiry tests, origin spoof checks |
| M4 Firefox | Selected-tab handoff and shared receiver | Two-device Firefox run, partial-open behavior, signed package |
| M5 Homelab readiness | Ubuntu/SSH/Docker/tunnel/persistence/runbook | Reboot, firewall/IPv6, restore and update rehearsals |
| M6 Authorized launch | Explicit owner approval, DNS/tunnel activation | External HTTPS/transfer check and rollback record |
| M7 Portfolio/automation | README, diagrams, interview narrative | CI green; portfolio link; later protected approved release pipeline |

Code for M1–M4 and preparation for M5–M7 are included. Runtime/external acceptance gates remain separate from implementation. Consult VERIFICATION.md for actual evidence.

## Non-goals and later improvements

No accounts, tab-history archives, recipient identity proof, transfer discovery/listing, unlimited uploads or permanent storage. QR codes, downloadable encrypted recovery files, durable per-tab opening ledgers and additional edge rules can follow. Linking from Netlify preserves one origin; embedding or separately hosting the frontend requires a fresh CORS/CSP/trust review.
