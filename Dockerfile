# ── Build stage ───────────────────────────────────────────────────────
FROM node:20-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build
# Pre-compress static assets so nginx can serve .gz directly (gzip_static).
RUN find dist -type f \( -name '*.js' -o -name '*.css' -o -name '*.svg' -o -name '*.json' \) \
      -exec gzip -9 -k {} \;

# ── Serve stage ───────────────────────────────────────────────────────
FROM nginx:alpine
RUN rm -f /etc/nginx/conf.d/default.conf
COPY self-host/app/nginx.conf /etc/nginx/conf.d/default.conf
# Entrypoint hooks: nginx:alpine runs *.sh in /docker-entrypoint.d/ before start.
COPY self-host/app/10-port.sh /docker-entrypoint.d/10-port.sh
COPY self-host/app/40-mytools-env.sh /docker-entrypoint.d/40-mytools-env.sh
RUN chmod +x /docker-entrypoint.d/10-port.sh /docker-entrypoint.d/40-mytools-env.sh
COPY --from=build /app/dist /usr/share/nginx/html
# Cloud Run sends traffic to $PORT (default 8080); 10-port.sh wires nginx to it.
EXPOSE 8080
