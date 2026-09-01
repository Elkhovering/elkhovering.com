# Static Astro site, built and served in one image.
#
# Stage 2 listens on 8000 — the port the Oracelk-generated `web` service
# proxies to. If that ever changes, `proxy_pass` in the project's nginx.conf
# on the server has to change with it.

# ─────────────────────────── stage 1: build ───────────────────────────
FROM node:24-alpine AS build

WORKDIR /app

# Hermetic and quiet: no telemetry ping, no funding/audit noise in the log.
ENV ASTRO_TELEMETRY_DISABLED=1 \
    npm_config_fund=false \
    npm_config_audit=false \
    npm_config_update_notifier=false

# Manifests first — this layer survives until dependencies actually change.
# `npm ci`, not `install`: the lockfile is authoritative.
COPY package.json package-lock.json ./
RUN npm ci

# NODE_ENV is deliberately NOT production above: it would make npm ci prune
# devDependencies, which is a landmine the day a build tool moves there.
COPY . .

# An Astro build can succeed and still emit nothing useful if a content
# collection breaks. Turn that into a red build, not an empty site.
RUN npm run build \
 && test -s dist/index.html \
 && test -d dist/_astro

# Media is ~76MB of the ~77MB output and changes far less often than markup.
# Setting it aside makes it its own layer below, so a copy edit re-pushes
# kilobytes instead of the whole site.
RUN mv dist/media /dist-media

# ─────────────────────────── stage 2: serve ───────────────────────────
FROM nginx:1.27-alpine AS runtime

LABEL org.opencontainers.image.source="https://github.com/Elkhovering/elkhovering.com" \
      org.opencontainers.image.title="elkhovering.com" \
      org.opencontainers.image.description="Static Astro site served by nginx on :8000"

COPY docker/nginx.conf /etc/nginx/conf.d/default.conf

# A syntax error becomes a red build instead of a crash-looping container.
RUN nginx -t

# The stock image ships index.html and 50x.html in the document root. The
# first is overwritten below; the second would stay publicly reachable.
RUN rm -rf /usr/share/nginx/html/*

# Heavy and stable first, light and volatile second — two disjoint layers.
COPY --from=build /dist-media /usr/share/nginx/html/media
COPY --from=build /app/dist   /usr/share/nginx/html

EXPOSE 8000

# busybox wget: nginx:alpine has no curl, and a whole package layer for a
# healthcheck is not worth it.
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget -q -O /dev/null http://127.0.0.1:8000/healthz || exit 1

# CMD and STOPSIGNAL are inherited from the base image.
