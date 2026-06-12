#!/usr/bin/env bash
# One-time root setup for the PR preview reconciler on the host.
# Idempotent: safe to re-run (e.g. to install an updated reconcile.py).
#
#   sudo bash setup-root.sh [project]    # project defaults to officer-votes
#
# Assumes: Caddy installed as a systemd service with /etc/caddy/Caddyfile,
# Docker running, and the run user (default: whoever invoked sudo) is in the
# docker group and has `gh` authenticated.
set -euo pipefail

PROJECT="${1:-officer-votes}"
RUN_USER="${SUDO_USER:?run via sudo so SUDO_USER identifies the unprivileged run user}"
SRC_DIR="$(cd "$(dirname "$0")" && pwd)"

echo "== Installing reconciler to /opt/pr-preview"
install -d /opt/pr-preview
install -m 755 "$SRC_DIR/reconcile.py" /opt/pr-preview/reconcile.py

echo "== Caddy snippet dir (owned by $RUN_USER so the reconciler can write site blocks)"
install -d -o "$RUN_USER" -g "$RUN_USER" /etc/caddy/preview
# Placeholder so the import glob below never matches zero files.
if [ ! -f /etc/caddy/preview/00-placeholder.caddy ]; then
    echo "# pr-preview placeholder; per-PR site blocks appear alongside this file" \
        > /etc/caddy/preview/00-placeholder.caddy
    chown "$RUN_USER:$RUN_USER" /etc/caddy/preview/00-placeholder.caddy
fi
if ! grep -q 'import /etc/caddy/preview' /etc/caddy/Caddyfile; then
    printf '\n# PR preview instances (managed by /opt/pr-preview/reconcile.py)\nimport /etc/caddy/preview/*.caddy\n' \
        >> /etc/caddy/Caddyfile
    echo "   added import line to /etc/caddy/Caddyfile"
fi

echo "== Sudoers rule: $RUN_USER may reload caddy without a password"
echo "$RUN_USER ALL=(root) NOPASSWD: /usr/bin/systemctl reload caddy" \
    > /etc/sudoers.d/pr-preview-caddy
chmod 440 /etc/sudoers.d/pr-preview-caddy

echo "== Project config /etc/pr-preview/$PROJECT.json"
install -d /etc/pr-preview
if [ ! -f "/etc/pr-preview/$PROJECT.json" ]; then
    KEY="$(od -An -tx1 -N8 /dev/urandom | tr -d ' \n')"
    sed "s/__PREVIEW_KEY__/$KEY/" "$SRC_DIR/config.$PROJECT.json" \
        > "/etc/pr-preview/$PROJECT.json"
    echo "   created with preview key: $KEY"
else
    echo "   exists; leaving as-is"
fi

echo "== systemd units"
install -m 644 "$SRC_DIR/pr-preview@.service" "$SRC_DIR/pr-preview@.timer" /etc/systemd/system/
systemctl daemon-reload

echo "== Validating and reloading caddy"
caddy validate --config /etc/caddy/Caddyfile >/dev/null
systemctl reload caddy

echo "== Enabling timer"
systemctl enable --now "pr-preview@$PROJECT.timer"

echo
echo "Done. Useful commands:"
echo "  systemctl start pr-preview@$PROJECT.service   # run reconcile right now"
echo "  journalctl -u pr-preview@$PROJECT -f          # follow logs"
echo "  docker ps --filter label=pr-preview.project=$PROJECT"
