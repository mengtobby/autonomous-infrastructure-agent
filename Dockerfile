# Hosts the demo dashboard: recorded model drafts + a local sandbox that
# really executes each draft. Needs no GPU, no Ollama and no Docker socket.
#
#   docker build -t autonomous-infra-agent .
#   docker run --rm -p 8787:8787 autonomous-infra-agent
#
# The container is the isolation boundary for the local sandbox, so run it
# locked down (see README, "Hosting the demo").

FROM node:20-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
RUN npm run build && npm prune --omit=dev

FROM node:20-bookworm-slim
# The recorded scenarios include Python drafts, and the local sandbox runs
# them with `python`.
RUN apt-get update \
    && apt-get install -y --no-install-recommends python3 python-is-python3 \
    && rm -rf /var/lib/apt/lists/*

ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=8787 \
    LOG_LEVEL=info
WORKDIR /app
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY package.json ./
COPY public ./public

USER node
EXPOSE 8787
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
    CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8787)+'/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "dist/demo.js"]
