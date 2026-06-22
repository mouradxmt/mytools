#!/bin/sh
# Writes runtime config consumed by the browser. Runs at container start.
set -e
TARGET=/usr/share/nginx/html/env.js
cat > "$TARGET" <<EOF
window.__MYTOOLS_ENV = {
  SUPABASE_URL: "${SUPABASE_URL:-}",
  SUPABASE_ANON_KEY: "${SUPABASE_ANON_KEY:-}"
};
EOF
echo "[mytools] wrote $TARGET (SUPABASE_URL=${SUPABASE_URL:-unset})"
