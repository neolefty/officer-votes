# PR previews

Every open (non-fork) PR on this repo gets a live test instance at
`https://pr-<number>.preview.wlbahai.org/?pp=<key>`, linked from a sticky
comment on the PR. Instances update automatically on push and are destroyed
when the PR closes. This doc is written for coding agents and humans
maintaining or porting the system.

## How it works

A **pull-based reconciler** (`reconcile.py`) runs every ~3 minutes from a
systemd timer on the host (`calcite`, the box that also serves production).
Each run:

1. Lists open PRs via `gh pr list` (fork PRs are skipped — never auto-deploy
   code from forks).
2. Lists running preview containers via Docker labels
   (`pr-preview.project`, `pr-preview.pr`, `pr-preview.sha`).
3. Tears down previews whose PR closed (container + data volume + Caddy block).
4. For each PR whose head SHA isn't already running: fetches `pull/<n>/head`
   into a bare clone, builds the repo's own `Dockerfile` via
   `git archive | docker build -`, starts a resource-capped container, writes
   a Caddy site block, and upserts the sticky PR comment.
5. Reloads Caddy if any site block changed; prunes unused preview images.

There is no webhook, runner, or daemon — just `gh`, `git`, `docker`, and one
timer. A SHA that fails to build is recorded in the state dir and not retried
until a new push (the PR comment says so).

## Naming & port conventions

Everything is keyed on **PR number**, never branch name:

- hostname `pr-<n>.preview.wlbahai.org`, container `pp-<project>-pr<n>`,
  volume `ppdata-<project>-pr<n>`, port `port_base + n` (officer-votes: 4000,
  so PR 123 → 4123).

Why: PR numbers are always DNS-safe, short, stable, unique, and map to ports
arithmetically. Branch names would need slugging (`/`, case, 63-char DNS
labels) and a hash-based port scheme with collision handling. Consequence:
**branch names need no special conventions** for previews. Each project gets
a 1000-port window; PR numbers ≥ 1000 are rejected (revisit then).

## Access gate

The app sends `Authorization: Bearer <token>` on its own requests, so HTTP
basic auth at the proxy would clash with it. Instead the generated Caddy
block implements a cookie gate: a request carrying `?pp=<preview_key>` gets a
30-day cookie and a redirect; requests with the cookie are proxied; anything
else gets a 401. The keyed link in the (public) PR comment means this blocks
drive-by scanners, not determined humans — acceptable for throwaway test
instances with fake data. The key lives in `/etc/pr-preview/<project>.json`
on the host, not in the repo.

## Files

| File | Purpose | Installed to |
|---|---|---|
| `reconcile.py` | the reconciler (Python stdlib only) | `/opt/pr-preview/` |
| `config.<project>.json` | per-project settings template | `/etc/pr-preview/<project>.json` |
| `pr-preview@.service` / `.timer` | systemd template units, instance = project | `/etc/systemd/system/` |
| `setup-root.sh` | idempotent one-time root install | run via `sudo` |

Host-side pieces created by setup: `/etc/caddy/preview/` (reconciler-writable
site blocks, imported by one line appended to `/etc/caddy/Caddyfile`), a
sudoers rule allowing only `systemctl reload caddy`, and the state dir
`~/.local/state/pr-preview/<project>/` (bare clone, lock, failed-build list).

## Host requirements

- Caddy as a systemd service using `/etc/caddy/Caddyfile` (stock build; certs
  are per-hostname HTTP-01, so no DNS plugin or wildcard cert needed)
- Docker, with the run user in the `docker` group
- `gh` authenticated as a user that can read PRs and write comments
- Python ≥ 3.10
- A wildcard DNS record: `*.preview.wlbahai.org A <host IP>` (one record
  covers all PRs; in Route 53 just put `*` in the leftmost label)

## Operations

```sh
systemctl start pr-preview@officer-votes.service   # reconcile right now
journalctl -u pr-preview@officer-votes -f          # logs
systemctl list-timers 'pr-preview@*'               # timer status
docker ps --filter label=pr-preview.project=officer-votes
cat /etc/caddy/preview/*.caddy                     # generated site blocks
```

To update the reconciler after changing `reconcile.py`: re-run
`sudo bash setup-root.sh` (it re-copies the script; everything else is
idempotent). To force a rebuild of one PR: `docker rm -f pp-officer-votes-pr<n>`
and wait for (or start) the next reconcile. To wipe a preview's election data:
remove its container, then `docker volume rm ppdata-officer-votes-pr<n>`.

## Troubleshooting

- **No preview appears**: `journalctl -u pr-preview@officer-votes` — most
  likely a docker build failure (logged, and noted on the PR) or `gh` auth.
- **Caddy reload fails**: the generated blocks are validated implicitly by
  reload; a failure leaves the old config running. `caddy validate --config
  /etc/caddy/Caddyfile` shows the offending file.
- **Cert errors on first visit**: Let's Encrypt issuance happens on the first
  request to a new `pr-<n>` hostname; give it a few seconds and retry. Needs
  ports 80/443 reachable and the wildcard DNS record in place.
- **401 despite the keyed link**: the key in the PR comment must match
  `preview_key` in `/etc/pr-preview/<project>.json` (changing the key orphans
  old comments until the next deploy rewrites them).

## Porting to another project

1. Copy `scripts/preview/` (or just reference this repo's copy).
2. Write `config.<project>.json`: repo slug, domain (`*.test.<project>.com`
   etc.), a fresh `port_base` at least 1000 away from other projects on the
   same host, the container's internal port, env/data mount.
3. Add the wildcard DNS record for that domain → the host.
4. `sudo bash setup-root.sh <project>`.

The reconciler assumes the project has a single `Dockerfile` at the repo root
that builds and runs the whole app. Projects needing sidecars (a database,
etc.) would need `compose`-based deploys — not implemented; previews here use
SQLite in a per-PR volume.
