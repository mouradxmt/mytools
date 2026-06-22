#!/usr/bin/env bash
#
# Deploy mytools to an OCI Micro (1 GB, x86_64, Oracle Linux) box.
#
# Architecture: app container (nginx) + Caddy (auto HTTPS) on the box,
# talking to a HOSTED Supabase project. Postgres is NOT run on the box.
#
# The app image is cross-built locally for linux/amd64 and shipped as a
# tarball (no registry needed, and the tiny box never has to build).
#
# Usage:
#   cp deploy.env.example deploy.env   # fill it in
#   bash self-host/oci/deploy.sh
#
# Re-running is safe and idempotent (it just ships a fresh image + restarts).
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$HERE/../.." && pwd)"
ENV_FILE="$HERE/deploy.env"
REMOTE_DIR="/opt/mytools"
IMAGE="mytools:latest"
PLATFORM="linux/amd64"   # OCI Micro is AMD x86_64

c_info='\033[36m'; c_ok='\033[32m'; c_err='\033[31m'; c_off='\033[0m'
log() { printf "${c_info}[deploy]${c_off} %s\n" "$*"; }
ok()  { printf "${c_ok}[deploy]${c_off} %s\n" "$*"; }
die() { printf "${c_err}[deploy] %s${c_off}\n" "$*" >&2; exit 1; }

[ -f "$ENV_FILE" ] || die "Missing $ENV_FILE — copy deploy.env.example and fill it in."
# shellcheck disable=SC1090
set -a; . "$ENV_FILE"; set +a

for v in SSH_HOST DOMAIN TLS_EMAIL SUPABASE_URL SUPABASE_ANON_KEY; do
  [ -n "${!v:-}" ] || die "$v is empty in deploy.env"
done
SSH_USER="${SSH_USER:-opc}"
SSH_KEY="${SSH_KEY:-$HOME/.ssh/id_ed25519}"
SSH_KEY="${SSH_KEY/#\~/$HOME}"

SSH_OPTS=(-i "$SSH_KEY" -o StrictHostKeyChecking=accept-new -o ConnectTimeout=15)
ssh_box() { ssh "${SSH_OPTS[@]}" "${SSH_USER}@${SSH_HOST}" "$@"; }
scp_box() { scp "${SSH_OPTS[@]}" "$@"; }

command -v docker >/dev/null || die "docker is required locally (for buildx)."

# ── 1. connectivity ────────────────────────────────────────────────────
log "Testing SSH to ${SSH_USER}@${SSH_HOST}…"
ssh_box "echo connected: \$(uname -m) \$(. /etc/os-release && echo \$PRETTY_NAME)" \
  || die "SSH failed. Check SSH_HOST, that your key is authorized, and port 22 is open."

# ── 2. cross-build the app image for amd64 ─────────────────────────────
log "Building $IMAGE for $PLATFORM (this runs locally, not on the box)…"
docker buildx build --platform "$PLATFORM" -t "$IMAGE" --load "$REPO_ROOT" \
  || die "buildx build failed."

# ── 3. ship the image as a tarball ─────────────────────────────────────
TARBALL="/tmp/mytools-image.tar.gz"
log "Saving + compressing image…"
docker save "$IMAGE" | gzip > "$TARBALL"
log "Image size: $(du -h "$TARBALL" | cut -f1). Uploading…"

# ── 4. ensure docker on the box ────────────────────────────────────────
log "Ensuring Docker is installed on the box…"
ssh_box 'bash -s' <<'REMOTE_SETUP'
set -e
if ! command -v docker >/dev/null 2>&1; then
  echo "[box] installing docker…"
  sudo dnf install -y dnf-plugins-core >/dev/null 2>&1 || true
  sudo dnf config-manager --add-repo https://download.docker.com/linux/centos/docker-ce.repo >/dev/null 2>&1 \
    || sudo dnf config-manager --add-repo https://download.docker.com/linux/rhel/docker-ce.repo
  sudo dnf install -y docker-ce docker-ce-cli containerd.io docker-compose-plugin
  sudo systemctl enable --now docker
  sudo usermod -aG docker "$USER" || true
fi
sudo mkdir -p /opt/mytools
sudo chown "$USER" /opt/mytools
echo "[box] docker: $(docker --version)"
REMOTE_SETUP

# ── 5. upload artifacts ────────────────────────────────────────────────
log "Uploading image + compose files…"
scp_box "$TARBALL" "${SSH_USER}@${SSH_HOST}:${REMOTE_DIR}/image.tar.gz"
scp_box "$HERE/docker-compose.yml" "${SSH_USER}@${SSH_HOST}:${REMOTE_DIR}/docker-compose.yml"
scp_box "$HERE/Caddyfile" "${SSH_USER}@${SSH_HOST}:${REMOTE_DIR}/Caddyfile"

# remote .env for compose interpolation
ssh_box "cat > ${REMOTE_DIR}/.env" <<EOF
SUPABASE_URL=${SUPABASE_URL}
SUPABASE_ANON_KEY=${SUPABASE_ANON_KEY}
DOMAIN=${DOMAIN}
TLS_EMAIL=${TLS_EMAIL}
EOF

# ── 6. open OS firewall for 80/443 ─────────────────────────────────────
log "Opening OS firewall (firewalld + iptables) for 80/443…"
ssh_box 'bash -s' <<'REMOTE_FW'
set -e
# firewalld (if active)
if sudo systemctl is-active --quiet firewalld; then
  sudo firewall-cmd --permanent --add-service=http  >/dev/null 2>&1 || true
  sudo firewall-cmd --permanent --add-service=https >/dev/null 2>&1 || true
  sudo firewall-cmd --reload >/dev/null 2>&1 || true
  echo "[box] firewalld: opened http/https"
fi
# OCI Oracle Linux ships an iptables default-deny INPUT chain; insert allows
# before the REJECT rule if they aren't already present.
for p in 80 443; do
  if ! sudo iptables -C INPUT -p tcp --dport $p -j ACCEPT 2>/dev/null; then
    sudo iptables -I INPUT 6 -p tcp --dport $p -j ACCEPT || sudo iptables -I INPUT -p tcp --dport $p -j ACCEPT
  fi
done
# persist iptables across reboots if the helper is present
sudo netfilter-persistent save >/dev/null 2>&1 || sudo service iptables save >/dev/null 2>&1 || true
echo "[box] iptables: ensured 80/443 ACCEPT"
REMOTE_FW

# ── 7. load image + bring up the stack ─────────────────────────────────
log "Loading image and starting containers…"
ssh_box "bash -s" <<REMOTE_UP
set -e
cd ${REMOTE_DIR}
gunzip -c image.tar.gz | sudo docker load
sudo docker compose up -d
sudo docker image prune -f >/dev/null 2>&1 || true
rm -f image.tar.gz
sudo docker compose ps
REMOTE_UP

rm -f "$TARBALL"

cat <<EOF

$(printf "${c_ok}")============================================================
 Deployed 🚀
============================================================$(printf "${c_off}")

  App      : https://${DOMAIN}
  Backend  : ${SUPABASE_URL} (hosted Supabase)

DNS: ensure an A record for ${DOMAIN} points at ${SSH_HOST}.
OCI: ensure the instance's Security List / NSG allows ingress TCP 80 and 443
     from 0.0.0.0/0  (Console → Networking → VCN → Security Lists).
     Caddy needs port 80 reachable to complete the Let's Encrypt challenge.

Watch TLS provisioning:
  ssh -i ${SSH_KEY} ${SSH_USER}@${SSH_HOST} 'cd ${REMOTE_DIR} && sudo docker compose logs -f caddy'

Re-deploy after code changes: just re-run this script.
EOF
