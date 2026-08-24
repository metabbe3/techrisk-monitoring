#!/usr/bin/env bash
# TechRisk Monitor — update + rebuild + restart + clean old images.
# Run any time:  bash update.sh   (add PRUNE_ALL=1 to also drop every unused image)
set -euo pipefail
cd "$(dirname "$0")"
say() { printf '\033[1m==>\033[0m %s\n' "$*"; }

# 1. Latest source (skip quietly if this isn't a git checkout or has local edits)
if git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  if git diff --quiet && git pull --ff-only >/dev/null 2>&1; then
    say "Source updated: $(git log --oneline -1)"
  else
    say "git pull skipped (local changes or no remote) — building current files"
  fi
fi

# 2. Rebuild + restart (recreate on image change; volumes keep sessions/output)
say "Rebuilding…"
docker compose build --pull
say "Restarting web…"
docker compose up -d --remove-orphans web

# 3. Wait for health
WEB_PORT="${WEB_PORT:-8080}"
for i in $(seq 1 30); do
  curl -fs "http://localhost:${WEB_PORT}/api/modules" >/dev/null 2>&1 && { say "Up: http://localhost:${WEB_PORT}"; break; }
  [ "$i" = 30 ] && { echo "not healthy yet — check: docker compose logs web"; exit 1; }
  sleep 2
done

# 4. Prune: old builds of this image (dangling) + stopped containers.
#    PRUNE_ALL=1 additionally drops every unused image (next build re-pulls the base).
say "Pruning old images…"
docker container prune -f >/dev/null
docker image prune -f >/dev/null
if [ "${PRUNE_ALL:-0}" = "1" ]; then
  docker image prune -af >/dev/null
  say "PRUNE_ALL: all unused images removed (base image will re-download on next build)"
fi
say "Done. Old dangling images removed."
