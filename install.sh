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
if ! docker info >/dev/null 2>&1; then
  say "Docker daemon not running — starting it…"
  SUDO=""; [ "$(id -u)" -ne 0 ] && SUDO="sudo"
  $SUDO systemctl enable --now docker 2>/dev/null || $SUDO service docker start 2>/dev/null || true
  sleep 2
  docker info >/dev/null 2>&1 || die "Docker daemon still not reachable — start it manually: systemctl enable --now docker"
fi

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

# ── 2. Credentials (asked once, written into .env — never committed) ────────
if [ ! -f .env ]; then
  cp .env.example .env
  say "Created .env from .env.example"
fi
if ! grep -Eq '^LOGIN_EMAIL=..' .env || ! grep -Eq '^LOGIN_PASSWORD=..' .env; then
  [ -t 0 ] || die "LOGIN_EMAIL/LOGIN_PASSWORD missing in .env and no terminal to ask — edit .env and re-run"
  say "Monitor credentials needed (stored in .env only — this repo is public, secrets are never pushed)"
  read -r -p "  Login email: " LOGIN_EMAIL
  read -r -s -p "  Login password: " LOGIN_PASSWORD; echo
  set_env() { # key value → replace or append in .env
    awk -v k="$1" -v v="$2" 'BEGIN{FS=OFS="="} index($1,k)==1{$0=k"="v} {print}' .env > .env.tmp && mv .env.tmp .env
    grep -q "^$1=" .env || printf '%s=%s\n' "$1" "$2" >> .env
  }
  set_env LOGIN_EMAIL "$LOGIN_EMAIL"
  set_env LOGIN_PASSWORD "$LOGIN_PASSWORD"
  say "Credentials saved to .env"
fi

# ── 3. External dashboard network (compose expects it to exist) ─────────────
docker network inspect "$DASH_NET" >/dev/null 2>&1 || {
  say "Creating network $DASH_NET"
  docker network create "$DASH_NET"
}

# ── 4. Build + start (remove-orphans first: no ghost containers) ────────────
say "Building image…"
docker compose build --pull

# Port preflight — retire the previous techrisk tool if it owns the port,
# otherwise fail with the culprit named instead of a daemon error.
if (ss -ltn 2>/dev/null || netstat -ltn 2>/dev/null) | grep -q ":${WEB_PORT} "; then
  HOLDER_PID=$( (ss -ltnp 2>/dev/null || netstat -ltnp 2>/dev/null) | grep ":${WEB_PORT} " | grep -oE 'pid=[0-9]+' | head -1 | cut -d= -f2)
  HOLDER_NAME=$(ps -p "${HOLDER_PID:-0}" -o comm= 2>/dev/null || true)
  say "Port ${WEB_PORT} is held by: ${HOLDER_NAME:-unknown} (pid ${HOLDER_PID:-?})"
  if echo "$HOLDER_NAME" | grep -qE 'go-monitoring|techrisk'; then
    # the previous generation of this tool — stop its service (so it stays
    # dead across reboots) or the bare process, then take the port
    UNIT=$(systemctl status "$HOLDER_PID" 2>/dev/null | head -1 | awk '{print $2}')
    if [ -n "${UNIT:-}" ] && [ "$UNIT" != "-" ]; then
      say "Disabling old unit: $UNIT"
      SUDO=""; [ "$(id -u)" -ne 0 ] && SUDO="sudo"
      $SUDO systemctl disable --now "$UNIT" || true
    else
      kill "$HOLDER_PID" 2>/dev/null || true
    fi
    for i in $(seq 1 10); do
      (ss -ltn 2>/dev/null || netstat -ltn 2>/dev/null) | grep -q ":${WEB_PORT} " || break
      kill -9 "$HOLDER_PID" 2>/dev/null || true
      sleep 1
    done
    (ss -ltn 2>/dev/null || netstat -ltn 2>/dev/null) | grep -q ":${WEB_PORT} " \
      && die "could not free port ${WEB_PORT} — stop ${HOLDER_NAME} manually and re-run"
    say "Old tool stopped — port ${WEB_PORT} is free"
  else
    (ss -ltnp 2>/dev/null || netstat -ltnp 2>/dev/null) | grep ":${WEB_PORT} " || true
    docker ps --format '  {{.Names}}  {{.Ports}}' | grep "${WEB_PORT}->" || true
    cat <<HINT
Not the old techrisk tool — I won't kill it blindly.
If it is disposable, stop it yourself, or pick another port:
  WEB_PORT=8081 bash install.sh
HINT
    die "port ${WEB_PORT} occupied"
  fi
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
