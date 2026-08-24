#!/usr/bin/env bash
# TechRisk Monitor — one-shot installer (Linux/macOS).
# Checks Docker, prepares .env and the dashboard network, builds, and starts
# the always-on web service (auto-restarts; survives instance reboots).
set -euo pipefail
cd "$(dirname "$0")"

WEB_PORT="${WEB_PORT:-8080}"
DASH_NET="techrisk-dashboard_techrisk-network"
say() { printf '\033[1m==>\033[0m %s\n' "$*"; }
die() { printf '\033[31mERROR:\033[0m %s\n' "$*" >&2; exit 1; }

# ── 1. Docker present + daemon reachable + compose v2 ──────────────────────
say "Checking Docker…"
if ! command -v docker >/dev/null; then
  cat <<'HINT'
Docker is not installed. Install it first:
  Ubuntu/Debian:  curl -fsSL https://get.docker.com | sh
  RHEL/CentOS:    curl -fsSL https://get.docker.com | sh
  Then:           sudo systemctl enable --now docker
HINT
  die "Docker not found"
fi
docker info >/dev/null 2>&1 || die "Docker daemon not reachable — start it: sudo systemctl start docker"

if ! docker compose version >/dev/null 2>&1; then
  say "Docker Compose v2 missing — installing the compose plugin…"
  ARCH=$(uname -m); case "$ARCH" in x86_64) ;; aarch64|arm64) ARCH=aarch64;; *) die "unsupported arch: $ARCH";; esac
  SUDO=""; [ "$(id -u)" -ne 0 ] && SUDO="sudo"
  PLUG_DIR=/usr/local/lib/docker/cli-plugins
  [ -d /usr/libexec/docker/cli-plugins ] && PLUG_DIR=/usr/libexec/docker/cli-plugins # RHEL/CentOS
  if command -v curl >/dev/null; then DL=(curl -fsSL -o); else DL=(wget -qO); fi
  $SUDO mkdir -p "$PLUG_DIR" || die "cannot create $PLUG_DIR (need root?)"
  "${DL[@]}" "$PLUG_DIR/docker-compose" \
    "https://github.com/docker/compose/releases/latest/download/docker-compose-linux-${ARCH}" \
    || die "could not download the compose plugin — install manually: https://docs.docker.com/compose/install/linux/"
  $SUDO chmod +x "$PLUG_DIR/docker-compose"
  docker compose version >/dev/null 2>&1 \
    || die "compose plugin installed but not picked up — restart your shell or check 'docker compose version'"
fi

# ── 2. Credentials ──────────────────────────────────────────────────────────
if [ ! -f .env ]; then
  cp .env.example .env
  say "Created .env from .env.example"
fi
grep -Eq '^LOGIN_EMAIL=..' .env || die "Set LOGIN_EMAIL and LOGIN_PASSWORD in .env, then re-run: nano .env"
grep -Eq '^LOGIN_PASSWORD=..' .env || die "Set LOGIN_PASSWORD in .env, then re-run"

# ── 3. External dashboard network (compose expects it to exist) ─────────────
docker network inspect "$DASH_NET" >/dev/null 2>&1 || {
  say "Creating network $DASH_NET"
  docker network create "$DASH_NET"
}

# ── 4. Build + start (remove-orphans first: no ghost containers) ────────────
say "Building image…"
docker compose build --pull

# Port preflight — fail with the culprit named, not a daemon error at start.
if (ss -ltn 2>/dev/null || netstat -ltn 2>/dev/null) | grep -q ":${WEB_PORT} "; then
  say "Port ${WEB_PORT} is already in use:"
  (ss -ltnp 2>/dev/null || netstat -ltnp 2>/dev/null) | grep ":${WEB_PORT} " || true
  docker ps --format '  {{.Names}}  {{.Ports}}' | grep "${WEB_PORT}->" || true
  cat <<HINT
If that is the previous techrisk deployment, stop it first:
  docker rm -f <that container name>
Otherwise pick another port and re-run:
  WEB_PORT=8081 bash install.sh
HINT
  die "port ${WEB_PORT} occupied"
fi

say "Starting web service…"
docker compose down --remove-orphans >/dev/null 2>&1 || true
docker compose up -d web

# ── 5. Wait for health ──────────────────────────────────────────────────────
say "Waiting for the web UI on :${WEB_PORT} …"
for i in $(seq 1 30); do
  if curl -fs "http://localhost:${WEB_PORT}/api/modules" >/dev/null 2>&1; then
    say "Up: http://localhost:${WEB_PORT}  (healthcheck: /api/modules)"
    say "Logs:      docker compose logs -f web"
    say "Capture:   open the UI → New capture, or: docker compose run --rm capture --modules all"
    exit 0
  fi
  sleep 2
done
die "Web UI did not become healthy in 60s — check: docker compose logs web"
