#!/usr/bin/env bash
#
# mytools self-host bootstrap.
#
# Pulls the official Supabase docker stack, generates secrets + API keys,
# wires in the mytools app, brings everything up, and applies the schema.
#
# Usage:
#   bash self-host/init.sh            # set up + start
#   bash self-host/init.sh up         # (re)build + start
#   bash self-host/init.sh down        # stop the stack
#   bash self-host/init.sh migrate     # re-apply the SQL migration only
#   bash self-host/init.sh logs        # tail logs
#
# Override defaults via environment:
#   MYTOOLS_PORT=3001            host port for the app
#   MYTOOLS_SUPABASE_URL=...     externally-reachable gateway URL (default http://localhost:8000)
#   MYTOOLS_APP_URL=...          externally-reachable app URL (default http://localhost:3001)
#   SUPABASE_REF=master          git ref of the supabase repo to pull
#
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
SB_DIR="$SCRIPT_DIR/supabase"
ENV_FILE="$SB_DIR/.env"
MIGRATION="$REPO_ROOT/supabase/migrations/0001_init.sql"
SB_REF="${SUPABASE_REF:-master}"

c_info='\033[36m'; c_ok='\033[32m'; c_err='\033[31m'; c_off='\033[0m'
log()  { printf "${c_info}[mytools]${c_off} %s\n" "$*"; }
ok()   { printf "${c_ok}[mytools]${c_off} %s\n" "$*"; }
die()  { printf "${c_err}[mytools] %s${c_off}\n" "$*" >&2; exit 1; }

compose() { ( cd "$SB_DIR" && docker compose "$@" ); }

# ── helpers ────────────────────────────────────────────────────────────
need() { command -v "$1" >/dev/null 2>&1 || die "'$1' is required but not installed."; }

get_env() { [ -f "$ENV_FILE" ] && grep -E "^$1=" "$ENV_FILE" | head -n1 | cut -d= -f2- || true; }

set_env() {
  local key="$1" val="$2" tmp
  tmp="$(mktemp)"
  if [ -f "$ENV_FILE" ] && grep -qE "^${key}=" "$ENV_FILE"; then
    awk -v k="$key" -v v="$val" '$0 ~ "^"k"=" {print k"="v; next} {print}' "$ENV_FILE" > "$tmp"
    mv "$tmp" "$ENV_FILE"
  else
    printf "%s=%s\n" "$key" "$val" >> "$ENV_FILE"
    rm -f "$tmp"
  fi
}

# node is a required dep; use it for randomness so we avoid SIGPIPE issues
# with `tr | head` under `set -o pipefail`.
rand() {
  node -e 'const c=require("crypto");const n=+process.argv[1]||32;let s="";while(s.length<n)s+=c.randomBytes(n*2).toString("base64").replace(/[^A-Za-z0-9]/g,"");process.stdout.write(s.slice(0,n));' "${1:-32}"
}

is_placeholder() {
  # true if value is empty or one of supabase's example defaults
  case "$1" in
    ""|your-super-secret-jwt-token-with-at-least-32-characters-long|\
your-super-secret-and-long-postgres-password|\
this_password_is_insecure_and_should_be_updated) return 0;;
    *) return 1;;
  esac
}

wait_for_auth() {
  log "Waiting for database + auth schema (up to ~3 min)…"
  local i
  for i in $(seq 1 60); do
    if compose exec -T db psql -U postgres -d postgres -tAc "select to_regclass('auth.users')" 2>/dev/null | grep -q 'auth.users'; then
      return 0
    fi
    sleep 3
  done
  die "auth schema never appeared. Inspect: (cd $SB_DIR && docker compose logs auth)"
}

apply_migration() {
  [ -f "$MIGRATION" ] || die "Migration not found: $MIGRATION"
  log "Applying mytools migration…"
  compose exec -T db psql -U postgres -d postgres -v ON_ERROR_STOP=1 < "$MIGRATION"
  ok "Schema applied."
}

# ── subcommands ────────────────────────────────────────────────────────
cmd="${1:-setup}"

case "$cmd" in
  down)    compose down; ok "Stopped."; exit 0;;
  logs)    compose logs -f; exit 0;;
  migrate) wait_for_auth; apply_migration; exit 0;;
  up|setup) ;;  # fall through
  *) die "Unknown command: $cmd (use: setup | up | down | migrate | logs)";;
esac

# ── prerequisites ──────────────────────────────────────────────────────
need docker
need git
need node
need awk
docker compose version >/dev/null 2>&1 || die "docker compose v2 is required."

# ── fetch supabase stack ───────────────────────────────────────────────
if [ ! -f "$SB_DIR/docker-compose.yml" ]; then
  log "Downloading Supabase docker stack (ref: $SB_REF)…"
  tmp="$(mktemp -d)"
  if ! git clone --depth 1 --branch "$SB_REF" https://github.com/supabase/supabase "$tmp/s" >/dev/null 2>&1; then
    git clone --depth 1 https://github.com/supabase/supabase "$tmp/s" >/dev/null 2>&1 \
      || die "Failed to clone supabase repo."
  fi
  mkdir -p "$SB_DIR"
  cp -rf "$tmp/s/docker/." "$SB_DIR/"
  rm -rf "$tmp"
  ok "Supabase stack placed in $SB_DIR"
else
  log "Supabase stack already present at $SB_DIR"
fi

[ -f "$ENV_FILE" ] || cp "$SB_DIR/.env.example" "$ENV_FILE"

# ── secrets + keys ─────────────────────────────────────────────────────
JWT_SECRET="$(get_env JWT_SECRET)"
if is_placeholder "$JWT_SECRET"; then
  log "Generating new JWT secret + API keys…"
  KEYS="$(node "$SCRIPT_DIR/gen-keys.mjs")"
else
  log "Re-using existing JWT secret; regenerating matching API keys…"
  KEYS="$(JWT_SECRET="$JWT_SECRET" node "$SCRIPT_DIR/gen-keys.mjs")"
fi
JWT_SECRET="$(printf '%s\n' "$KEYS" | sed -n 's/^JWT_SECRET=//p')"
ANON_KEY="$(printf '%s\n' "$KEYS" | sed -n 's/^ANON_KEY=//p')"
SERVICE_ROLE_KEY="$(printf '%s\n' "$KEYS" | sed -n 's/^SERVICE_ROLE_KEY=//p')"

PG_PW="$(get_env POSTGRES_PASSWORD)"
if is_placeholder "$PG_PW"; then PG_PW="$(rand 32)"; fi

DASH_USER="$(get_env DASHBOARD_USERNAME)"; [ -n "$DASH_USER" ] || DASH_USER="admin"
DASH_PW="$(get_env DASHBOARD_PASSWORD)"
if is_placeholder "$DASH_PW"; then DASH_PW="$(rand 20)"; fi

APP_URL="${MYTOOLS_APP_URL:-http://localhost:3001}"
API_URL="${MYTOOLS_SUPABASE_URL:-http://localhost:8000}"
APP_PORT="${MYTOOLS_PORT:-3001}"

log "Writing $ENV_FILE …"
set_env JWT_SECRET            "$JWT_SECRET"
set_env ANON_KEY              "$ANON_KEY"
set_env SERVICE_ROLE_KEY      "$SERVICE_ROLE_KEY"
set_env POSTGRES_PASSWORD     "$PG_PW"
set_env DASHBOARD_USERNAME    "$DASH_USER"
set_env DASHBOARD_PASSWORD    "$DASH_PW"
set_env ENABLE_EMAIL_SIGNUP   "true"
set_env ENABLE_EMAIL_AUTOCONFIRM "true"     # no SMTP needed; signups confirmed instantly
set_env DISABLE_SIGNUP        "false"
set_env SITE_URL              "$APP_URL"
set_env API_EXTERNAL_URL      "$API_URL"
set_env SUPABASE_PUBLIC_URL   "$API_URL"
set_env ADDITIONAL_REDIRECT_URLS "$APP_URL"
# consumed by docker-compose.override.yml
set_env MYTOOLS_SUPABASE_URL  "$API_URL"
set_env MYTOOLS_APP_URL       "$APP_URL"
set_env MYTOOLS_PORT          "$APP_PORT"

# ── compose override (adds the app) ────────────────────────────────────
cp "$SCRIPT_DIR/docker-compose.override.yml" "$SB_DIR/docker-compose.override.yml"

# Supabase's .env pins COMPOSE_FILE, which disables auto-merge of the override.
# Ensure our override is included so plain `docker compose ...` picks up the app.
CF="$(get_env COMPOSE_FILE)"
if [ -z "$CF" ]; then
  : # not pinned → docker compose auto-loads the override; nothing to do
elif printf '%s' "$CF" | grep -q 'docker-compose.override.yml'; then
  : # already included
else
  set_env COMPOSE_FILE "${CF}:docker-compose.override.yml"
  log "Added override to COMPOSE_FILE: ${CF}:docker-compose.override.yml"
fi

# ── up ─────────────────────────────────────────────────────────────────
log "Building app image and starting the full stack…"
compose up -d --build

wait_for_auth
apply_migration

# ── summary ────────────────────────────────────────────────────────────
cat <<EOF

$(printf "${c_ok}")============================================================
 mytools is up 🚀
============================================================$(printf "${c_off}")

  App           : $APP_URL
  Supabase API  : $API_URL
  Studio (admin): $API_URL   (login: $DASH_USER / $DASH_PW)

  Anon key      : $ANON_KEY

Useful commands:
  bash self-host/init.sh logs      # tail logs
  bash self-host/init.sh down      # stop everything
  bash self-host/init.sh migrate   # re-apply schema

Secrets live in: $ENV_FILE  (keep it private; it is .gitignored)

For a public server set these before running, then re-run:
  MYTOOLS_APP_URL=https://app.example.com \\
  MYTOOLS_SUPABASE_URL=https://api.example.com \\
  bash self-host/init.sh
(and put a TLS reverse proxy in front of the app + Kong gateway.)

EOF
