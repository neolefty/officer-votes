#!/bin/bash
# Simple GitOps deploy script
# Run from cron: */5 * * * * ~/source/officer-votes/scripts/deploy.sh
set -e

REPO_DIR="${REPO_DIR:-$HOME/source/officer-votes}"
LOG_FILE="${LOG_FILE:-$HOME/deploy.log}"

cd "$REPO_DIR"

log() {
    echo "$(date '+%Y-%m-%d %H:%M:%S') - $1" >> "$LOG_FILE"
}

# Fetch latest
git fetch origin main

LOCAL=$(git rev-parse HEAD)
REMOTE=$(git rev-parse origin/main)

if [ "$LOCAL" = "$REMOTE" ]; then
    # No changes - exit silently
    exit 0
fi

log "Updating from ${LOCAL:0:7} to ${REMOTE:0:7}"

git pull origin main

docker compose build
docker compose up -d

log "Deploy complete: ${REMOTE:0:7}"
