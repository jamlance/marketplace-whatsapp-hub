# Multi-stage build for WhatsApp Hub (email + SMS + WhatsApp).
FROM node:20-alpine AS builder
WORKDIR /work
# Use the OS Chromium for whatsapp-web.js/puppeteer; never download one.
ENV PUPPETEER_SKIP_DOWNLOAD=true
RUN apk add --no-cache git python3 make g++
RUN npm install -g pnpm@9
COPY package.json pnpm-workspace.yaml ./
COPY packages/core ./packages/core
COPY apps/whatsapp-hub ./apps/whatsapp-hub
RUN pnpm install --no-frozen-lockfile
WORKDIR /work/apps/whatsapp-hub
RUN pnpm exec vite build

FROM node:20-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /app
# Chromium + the libs whatsapp-web.js/puppeteer need at runtime.
RUN apk add --no-cache git chromium nss freetype harfbuzz ca-certificates ttf-freefont
ENV PUPPETEER_SKIP_DOWNLOAD=true \
    PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium-browser \
    WWEBJS_DATA_PATH=/data/wwebjs
RUN mkdir -p /data/wwebjs
COPY --from=builder /work/package.json /work/pnpm-workspace.yaml ./
COPY --from=builder /work/node_modules ./node_modules
COPY --from=builder /work/packages ./packages
COPY --from=builder /work/apps/whatsapp-hub/package.json ./apps/whatsapp-hub/package.json
COPY --from=builder /work/apps/whatsapp-hub/node_modules ./apps/whatsapp-hub/node_modules
COPY --from=builder /work/apps/whatsapp-hub/dist ./apps/whatsapp-hub/dist
COPY apps/whatsapp-hub/server.js ./apps/whatsapp-hub/server.js
COPY apps/whatsapp-hub/whatsapp.js ./apps/whatsapp-hub/whatsapp.js
EXPOSE 3000
ENV PORT=3000 HOST=0.0.0.0
WORKDIR /app/apps/whatsapp-hub
CMD ["node", "server.js"]
