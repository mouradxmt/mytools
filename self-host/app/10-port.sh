#!/bin/sh
# Cloud Run (and any platform) tells the container which port to listen on via
# $PORT. nginx config can't read env directly, so substitute it at start.
# Defaults to 8080 (Cloud Run's default) when unset.
set -e
PORT="${PORT:-8080}"
sed -i "s/__PORT__/${PORT}/g" /etc/nginx/conf.d/default.conf
echo "[mytools] nginx listening on ${PORT}"
