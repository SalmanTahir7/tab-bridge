# Ubuntu homelab deployment and operations

This is an operator runbook, not an executed deployment. Do not activate public DNS/tunnels, publish, change the router, or deploy production until the owner explicitly authorizes it. All sample hostnames/subnets must be replaced with real values.

## 1. Prepare the old laptop

Back up existing data before installation; installation may erase the disk. Check CPU architecture, RAM (2 GiB minimum practical starting point, 4 GiB preferable), Ethernet, cooling, storage health and available disk space. Do not use a damaged/swollen battery. Choose a currently supported Ubuntu Server LTS release from the official Ubuntu download site and verify its image/checksum. Create USB installation media, boot it, and select the correct target disk yourself. Prefer a minimal server install, security updates and a non-root administrative user. Record the recovery/install choices.

Disk encryption protects a stolen laptop but may require manual unlock after power failure; decide whether unattended reboot or full-disk protection matters more. Keep the machine ventilated; configure lid-close behavior deliberately and test that closing the lid does not suspend the service. Configure firmware AC-power recovery only if supported and wanted. A UPS is optional; no home-service availability guarantee is assumed.

Connect Ethernet to the Deco LAN. Determine the actual LAN subnet and address with `ip -br addr`, `ip route`, and `resolvectl status`. Check `timedatectl status` for clock synchronization. A DHCP reservation is helpful but is an owner-performed router setting, not an automatic action. Note whether Deco is in router or access-point mode and whether another ISP router exists. Tunnel ingress does not require forwarding ports, bridge mode, DMZ, UPnP mappings, or a public IP address.

## 2. Private SSH and firewall

Generate an Ed25519 key on your management computer and install its public key for the server user over the LAN. Verify a second key-based login before disabling passwords. Create an SSH configuration drop-in with `PermitRootLogin no`, `PasswordAuthentication no`, `KbdInteractiveAuthentication no`, and `PubkeyAuthentication yes`; validate with `sudo sshd -t`, then reload the `ssh` service. Retain console access while changing SSH/firewall rules.

Use UFW with default deny incoming and allow outgoing. Permit TCP 22 **only from your actual management LAN CIDR**, not from everywhere. For example, after replacing the sample subnet:

```sh
sudo ufw default deny incoming
sudo ufw default allow outgoing
sudo ufw allow from 192.168.68.0/24 to any port 22 proto tcp
sudo ufw enable
sudo ufw status verbose
```

That CIDR is an example, not an assumption about your Deco network. Inspect IPv6 too; do not leave a globally reachable SSH listener unintentionally allowed. A separately configured private VPN can support remote management later; do not create a public SSH tunnel or port-forward. Do not expose PostgreSQL, Docker TCP endpoints, Portainer, CI runners, or administrative dashboards.

Docker-published ports can bypass ordinary UFW filtering. The production Compose file intentionally has **no `ports` mappings**. Do not rely on UFW to protect an accidentally published database. See [Docker firewall documentation](https://docs.docker.com/engine/network/packet-filtering-firewalls/).

## 3. Docker and source

Install Docker Engine and the Compose plugin using [Docker's Ubuntu instructions](https://docs.docker.com/engine/install/ubuntu/), not an unreviewed installer script. Verify `docker version` and `docker compose version`. Docker group membership is effectively root access; use sudo or restrict membership to the owner.

Copy/clone this project into a private service directory such as `/opt/tab-bridge`; owner controls writes. Run `npm ci`, `npm run build`, and tests on a development host/CI before a release. Container builds install from the committed lockfile. The runtime runs the app as the `node` user, on a read-only filesystem, with dropped capabilities and memory/CPU/PID limits. Database initialization creates a nonsuperuser `tabbridge` application role; the API never receives the PostgreSQL administrator password.

Container tags currently track Node 24, PostgreSQL 17 and current cloudflared. Before a production release, resolve and record tested image digests and pin them for repeatability. Use reviewed dependency/image updates, not automatic untested production pulls. Keep database major-version changes as explicit migrations, not routine tag edits.

## 4. Configure secrets and site identity

Create a Cloudflare account/domain setup under your control, a Turnstile widget restricted to your chosen hostname, and eventually a named tunnel. These are manual external configuration steps. Never paste private keys into code, screenshots, CI output, or this README.

On the server, create `secrets/` with directory mode 700 and `.env` with mode 600. Generate independent high-entropy values (for example `openssl rand -hex 32`) for:

- `secrets/db_admin_password`: PostgreSQL administrator, database container only.
- `secrets/db_password`: application database login.
- `secrets/quota_secret`: HMAC key for transient quota identifiers.
- `secrets/turnstile_secret`: actual Cloudflare Turnstile secret.
- `secrets/tunnel_token`: actual named-tunnel connector token, added only when authorized.

Compose file-backed secrets are mounts, not an encrypted secret vault. Their backing files must be readable by the containers' runtime UIDs. For local Compose, a private mode-700 parent directory with appropriately readable secret files is one workable arrangement; check UID/read permissions instead of blindly applying mode 600 to every file and expecting non-root containers to read it. Keep this directory excluded from Git and artifact packages. Consider root-managed ownership/ACLs for a hardened host.

Production `.env` contains public configuration only:

```dotenv
PUBLIC_ORIGIN=https://tabs.example.com
TURNSTILE_SITE_KEY=your_public_site_key
```

Never copy the local-demo `.env` into a public deployment. Compose explicitly sets `LOCAL_DEMO=false`, and production startup refuses missing HTTPS origin, site key, database URL or secrets. Real challenge tokens expire after five minutes and are single-use; retries must complete a fresh challenge. [Cloudflare verification reference](https://developers.cloudflare.com/turnstile/get-started/server-side-validation/).

Database passwords are applied at initial volume creation only. Changing a password file does not change an existing role: coordinate `ALTER ROLE` securely and restart the app when rotating credentials. Do not delete the database volume to “fix” a password mismatch.

## 5. Test privately first

Build the image and start database/app without the public profile. `docker compose build` does not publish. `docker compose up -d db app` uses no host ports. Depending on Compose validation, the unstarted tunnel's declared secret may still need a placeholder file; use an empty local file, never a fabricated working token.

Check `docker compose ps` and `docker compose logs --tail=100 app db`. Probe inside the app container:

```sh
docker compose exec app node -e "fetch('http://127.0.0.1:3000/health/ready').then(async r=>console.log(r.status,await r.text()))"
```

For a private browser rehearsal, use `compose.private-test.yaml` to bind the app only to 127.0.0.1 and turn proxy-header trust off. Access it over an SSH local forward from the management machine. Turnstile hostname/origin must match the browser origin; public-origin challenge testing normally happens during the authorized staged launch. Do not disable production verification just to make a mismatched hostname work.

Never combine the private-test port override with the public profile. Return to the base Compose file before launch. `BEHIND_TUNNEL=true` trusts `CF-Connecting-IP` only because the app is isolated and reachable solely through cloudflared. Introducing any alternate proxy/direct path requires revisiting that trust boundary.

## 6. Authorized public activation

Only after owner approval:

1. Create/configure the named tunnel's public hostname `tabs.example.com` with service target `http://app:3000`. Only this app service should be routed; no SSH, database, Docker API, wildcard management route, or metrics/admin endpoint.
2. Store the connector token securely, replace all placeholders, and configure Turnstile hostname/action expectations.
3. Set conservative Cloudflare WAF/rate rules for `/api/*` as available on the account; no caching of API responses, no payload/header logging, no frontend analytics/session recording. Restrict hostname routes and use a catch-all rejection if using locally managed ingress rules.
4. Start `docker compose --profile public up -d --build`. This is the publication/deployment step, not a command already run for you.
5. From outside the LAN, verify HTTPS, a genuine upload challenge, successful create/retrieve, duplicate claimant rejection, expiry, and outage recovery. Confirm management ports are inaccessible from an external network and check both IPv4 and IPv6.

cloudflared creates outbound connections; allow required outbound connectivity (including TCP/UDP 7844) per [Cloudflare's tunnel firewall documentation](https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/configure-tunnels/tunnel-with-firewall/). The app also needs DNS and outbound HTTPS for Siteverify. No inbound forwarding is required.

Fastify serves the built frontend and API, so a separate Nginx/Caddy reverse proxy is unnecessary initially. Edge TLS terminates at Cloudflare; the tunnel protects transport to the connector and HTTP remains inside the isolated Docker network. If adding a reverse proxy later, preserve body/time limits, no-store headers and trustworthy client-IP handling.

## 7. Persistence, backup and recovery

`pgdata` persists database data across app/container restarts. `docker compose down` retains it; **`down -v` destroys it** and must not be used as a routine maintenance command. Keep free disk space and monitor WAL/autovacuum. Row caps bound logical payload storage (~66 MB encoded at the maximum), not total PostgreSQL/WAL/filesystem usage. Set disk alerts and keep several GiB spare.

Back up source, release identifiers, deployment configuration, schema and secrets separately (secrets encrypted offline). Do **not** routinely back up transient transfer rows: old snapshots can resurrect redeemed capabilities. A schema-only dump on the server is:

```sh
docker compose exec -T db pg_dump -U postgres -d tabbridge --schema-only --no-owner > schema.sql
```

Store the schema dump with deployment records; keep password material out of shell history and logs. Rehearse recovery on an isolated host with no tunnel:

1. Install the tested Docker/Compose versions and restore configuration/secrets with private permissions.
2. Initialize a fresh volume so the app role exists. Let this release's schema initialization create empty tables (or restore a compatible schema-only dump).
3. Restore **no live transfer/quota rows**. Inform users that transfers on the failed host are lost; senders should create new ones.
4. Verify health, empty tables, local round trip, quotas and expiry, then request/record authorization before public reconnection.

For a full host snapshot restore, ensure old transfers are purged while isolated, before any app/tunnel access. Data-loss recovery is preferable to silently replaying already-redeemed transfers. Expired ciphertext can remain in WAL/backups/SSD pages; there is no secure-delete guarantee.

## 8. Maintenance and incident response

Useful checks: `docker compose ps`, `docker compose logs --since=30m --tail=100 app`, `docker stats --no-stream`, `df -h`, `free -h`, `systemctl status docker`, `journalctl -u docker --since today`, `timedatectl status`, and `ss -lntup`. Health readiness confirms database reachability, not sufficient disk space, challenge availability or end-to-end transfer success.

App request logging is off by default. If enabled with REQUEST_METRICS=true, only route templates/status/elapsed time are emitted. Do not dump request bodies, SQL parameters, transfer IDs/codes or URLs during troubleshooting. Review Cloudflare's separate log retention. Logs rotate; monitor generic cleanup failures and HTTP 429/503 rates. Quota spikes may indicate attack or legitimate shared-NAT use.

Install Ubuntu security updates regularly; plan and test required reboots. Review Dependabot PRs, run CI, test an image privately, note the previous digest, then deploy only an approved release. Verify readiness and a synthetic transfer after updates. Roll back the app image if necessary; do not downgrade a PostgreSQL data directory across major versions. The initial schema uses idempotent creation; future schema changes need explicit numbered migrations and compatibility/rollback planning.

If abuse, compromise or dangerous configuration is suspected, stop the tunnel service first to remove public ingress. Preserve minimal non-sensitive diagnostics, rotate affected server credentials, rebuild from a trusted release, and clear untrusted temporary data while isolated. Do not promise recovery of lost client secrets. Check cooling, disk health and power behavior after unexplained host failures.

## 9. CI/CD and portfolio evolution

Included GitHub Actions performs locked installation, type/build checks, all tests against a PostgreSQL service, dependency audit, Docker build, and a Firefox development artifact. It has read-only repository permissions and no deployment keys. The workflow must be at the repository root together with package.json. Publishing this folder as its own repository is an operator step.

Initially deploy from a private LAN SSH session by pulling an approved commit/artifact; never open SSH to GitHub-hosted runners. Later, add a manual protected-environment release workflow that produces a signed immutable image, with required owner review. A private outbound pull agent can retrieve approved digests. Do not run untrusted pull-request jobs on a privileged self-hosted runner in the home network; Docker socket access would grant host control. No automatic deploy workflow is included or enabled.

Link to the standalone HTTPS app from the existing Netlify portfolio after launch approval. Keep the transfer application at its own origin; do not introduce Netlify Functions/Blobs. Use the README diagram and protocol tests to explain client encryption, database concurrency, recovery tradeoffs and trust boundaries in interviews.
