# LUMORA server — production image.
# Runtime needs only Node; `pg` and `ws` (optionalDependencies) are installed for the
# Postgres + real-time features. devDependencies (test/tooling) are excluded.
FROM node:20-alpine

WORKDIR /app

# Install only production + optional deps (reproducible, no devDependencies).
COPY package.json ./
RUN npm install --omit=dev --no-audit --no-fund

# App code (see .dockerignore for what's excluded).
COPY core ./core
COPY server ./server
COPY web ./web
COPY db ./db

ENV NODE_ENV=production
ENV PORT=8787
EXPOSE 8787

# Container healthcheck hits the liveness probe.
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8787)+'/api/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "server/index.js"]
