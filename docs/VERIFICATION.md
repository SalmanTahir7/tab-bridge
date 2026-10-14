# Verification record

Local implementation session: 13 October 2026. No production deployment, router changes, public tunnel activation or GitHub publication was performed.

## Executed

| Check | Result |
| --- | --- |
| TypeScript and production build | React frontend, compiled Node backend, Firefox extension bundles built successfully |
| Protocol tests | AES-GCM round trip; altered ciphertext, wrong key/ID rejected; 256-bit secret; separate auth derivation; schemes/credentials/tab/byte limits |
| API tests | Create/idempotent upload; competing receipts; same-receipt retry; repeat acknowledgment; payload deletion; schema/body/origin/challenge checks; expiry/capacity; quotas and spoofed-header rejection |
| Recovery tests | Receipt persisted before claim; response-loss retry uses same receipt; lost acknowledgment recovers ciphertext locally; storage failure prevents claim |
| Turnstile unit test | Mocked success/hostname/action validation and fail-closed outage behavior |
| Real database integration | Disposable PostgreSQL 18.4, loopback only; concurrent claims, capacity checks, quota increments, expiry and wrong capability; target Compose/CI uses PostgreSQL 17 |
| Browser smoke test | Local built app rendered; created and retrieved two synthetic sample URLs; authenticated decryption and server deletion confirmed in UI |
| Dependency audit | `npm audit` clean after updating vulnerable initial dependency versions |

The automated suite has **16 tests** after adding the direct PostgreSQL expiry/capability case. Database tests are skipped unless TEST_DATABASE_URL points to a dedicated test database; the local verification run supplies it. They truncate test tables: never point them at a real transfer database.

## Explicitly not yet verified

- Docker image build, Compose startup, Linux permissions and database bootstrap role script: Docker is unavailable on this host. Included CI performs an image build; it has not been run remotely.
- PostgreSQL 17 integration on Linux: CI is configured for it, but local integration used PostgreSQL 18.4 binaries.
- Firefox actual runtime: tab selection, content-script handoff, moz-extension origin behavior, persistence/restart, bulk import and signing. Extension bundles are built/type-checked; this is not the same as an in-Firefox acceptance run.
- Real Cloudflare Turnstile widget, token replay/expiry behavior, named tunnel, WAF rules, domain and TLS: require the owner's external configuration.
- Old laptop hardware, Ubuntu install, Ethernet/Deco topology, UFW/IPv6, reboot/lid/power recovery, backup/restore rehearsal and external management-port isolation.
- Cross-device browser behavior, mobile responsive interaction and accessibility beyond semantic controls/basic visual inspection.
- Security audit/penetration test under real public traffic. No production-security certification is claimed.

## Repeat checks

```sh
npm ci
npm run build
npm test
npm audit --audit-level=high
```

Set TEST_DATABASE_URL to a disposable PostgreSQL database before `npm test` to run database tests. Use an isolated empty database with a test-only role; migrations and TRUNCATE are intentional. The CI workflow creates one automatically.

Manual release acceptance: send from Firefox A, solve a real challenge, receive in Firefox B, retry a dropped connection using the same browser, reject a second claimant, reject a reused/expired challenge, wait out expiry, confirm restart persistence and quotas, inspect sanitized logs, and verify no public administrative listeners. Stop before the public activation step until owner authorization.
