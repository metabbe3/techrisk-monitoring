# Bundles Node 20 + Chromium + all deps — runs identically on any old-glibc Linux.
FROM mcr.microsoft.com/playwright:v1.52.0-noble

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY src ./src
COPY web ./web

ENTRYPOINT ["node", "src/main.js"]
