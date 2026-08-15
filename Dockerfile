# Skilldex Hub — `skilldex serve` in a container.
# The build stage compiles the renderer SPA and bundles the server; the
# runtime stage ships only the two build outputs on a bare node image
# (the server bundle has zero runtime npm dependencies).

FROM node:22-alpine AS build
WORKDIR /build
COPY package.json package-lock.json ./
# The electron binary is never executed here — skip its ~100MB download.
ENV ELECTRON_SKIP_BINARY_DOWNLOAD=1
RUN npm ci
COPY . .
RUN npm run build:hub

FROM node:22-alpine
WORKDIR /app
# ssh client for machine management over Tailscale SSH (via the sidecar netns).
RUN apk add --no-cache openssh-client
COPY --from=build /build/out/renderer ./renderer
COPY --from=build /build/out/hub ./hub
COPY --from=build /build/out/agent ./agent
ENV SKILLDEX_DATA_DIR=/data
EXPOSE 8654
VOLUME /data
CMD ["node", "hub/server.js"]
