#!/usr/bin/env bash
#
# Deploy mytools to Google Cloud Run, tuned to stay inside the perpetual free tier.
#
#   - Builds the Dockerfile in the cloud (Cloud Build) — no local Docker needed.
#   - Scales to zero (no idle cost), capped max-instances (no surprise bills).
#   - Request-based CPU (cpu-throttling) so vCPU-seconds are only spent serving.
#   - 256Mi memory, concurrency 80 → minimal GB-seconds.
#   - Automatic, free, managed HTTPS on the *.run.app URL.
#
# Backend stays on hosted Supabase (free tier). This deploys only the frontend.
#
# Usage:
#   cp self-host/cloudrun/deploy.env.example self-host/cloudrun/deploy.env  # fill in
#   bash self-host/cloudrun/deploy.sh
#
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$HERE/../.." && pwd)"
ENV_FILE="$HERE/deploy.env"

c_info='\033[36m'; c_ok='\033[32m'; c_err='\033[31m'; c_off='\033[0m'
log() { printf "${c_info}[cloudrun]${c_off} %s\n" "$*"; }
ok()  { printf "${c_ok}[cloudrun]${c_off} %s\n" "$*"; }
die() { printf "${c_err}[cloudrun] %s${c_off}\n" "$*" >&2; exit 1; }

command -v gcloud >/dev/null || die "gcloud CLI not found. Install: https://cloud.google.com/sdk/docs/install"
[ -f "$ENV_FILE" ] || die "Missing $ENV_FILE — copy deploy.env.example and fill it in."
# shellcheck disable=SC1090
set -a; . "$ENV_FILE"; set +a

for v in GCP_PROJECT REGION SERVICE SUPABASE_URL SUPABASE_ANON_KEY; do
  [ -n "${!v:-}" ] || die "$v is empty in deploy.env"
done

log "Account: $(gcloud config get-value account 2>/dev/null || echo '?')  Project: ${GCP_PROJECT}"

# Enable the APIs we need (idempotent).
log "Ensuring required APIs are enabled…"
gcloud services enable run.googleapis.com cloudbuild.googleapis.com artifactregistry.googleapis.com \
  --project "$GCP_PROJECT" >/dev/null

# Use '@' as the env-var delimiter so the JWT/URL (which contain no '@') stay intact.
ENV_VARS="^@^SUPABASE_URL=${SUPABASE_URL}@SUPABASE_ANON_KEY=${SUPABASE_ANON_KEY}"

log "Deploying '${SERVICE}' to ${REGION} (Cloud Build from Dockerfile)…"
gcloud run deploy "$SERVICE" \
  --source "$REPO_ROOT" \
  --project "$GCP_PROJECT" \
  --region "$REGION" \
  --platform managed \
  --allow-unauthenticated \
  --port 8080 \
  --memory 256Mi \
  --cpu 1 \
  --cpu-throttling \
  --concurrency 80 \
  --min-instances 0 \
  --max-instances 2 \
  --timeout 30 \
  --set-env-vars "$ENV_VARS"

URL="$(gcloud run services describe "$SERVICE" --project "$GCP_PROJECT" --region "$REGION" --format='value(status.url)')"

cat <<EOF

$(printf "${c_ok}")============================================================
 Deployed to Cloud Run 🚀
============================================================$(printf "${c_off}")

  App URL : ${URL}
  Backend : ${SUPABASE_URL} (hosted Supabase)

Free-tier guardrails in effect:
  scale-to-zero (min-instances=0), max-instances=2,
  256Mi mem, request-based CPU, concurrency 80.

IMPORTANT — point Supabase at this URL:
  Supabase → Authentication → URL Configuration
    Site URL          = ${URL}
    Redirect URLs     = ${URL}/**

EOF

if [ -n "${CUSTOM_DOMAIN:-}" ]; then
  cat <<EOF
Custom domain mapping for ${CUSTOM_DOMAIN}:
  gcloud beta run domain-mappings create --service "${SERVICE}" \\
    --domain "${CUSTOM_DOMAIN}" --project "${GCP_PROJECT}" --region "${REGION}"
  Then add the DNS records it prints. HTTPS cert is issued automatically.
  (Remember to also set Supabase Site URL to https://${CUSTOM_DOMAIN}.)

EOF
fi

ok "Done. Re-run this script to ship updates."
