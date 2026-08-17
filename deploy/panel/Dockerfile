# syntax=docker/dockerfile:1.7@sha256:a57df69d0ea827fb7266491f2813635de6f17269be881f696fbfdf2d83dda33e

ARG NODE_IMAGE=node:24.18.0-trixie-slim@sha256:ae91dcc111a68c9d2d81ff2a17bda61be126426176fde6fe7d08ab13b7f50573

FROM ${NODE_IMAGE} AS frontend-build
WORKDIR /opt/frontend

ENV NODE_OPTIONS=--max-old-space-size=4096

RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates curl \
    && rm -rf /var/lib/apt/lists/*

COPY apps/frontend/package.json apps/frontend/package-lock.json apps/frontend/.npmrc ./
RUN npm ci --prefer-offline --no-audit --no-fund

COPY apps/frontend/ ./
COPY apps/backend/libs/contract /opt/backend/libs/contract

# Production requests use window.location.origin, keeping this image reusable
# across panel domains. Explicit backend-domain overrides remain disabled.
ENV DOMAIN_OVERRIDE=0
ENV NODE_ENV=production

RUN npm run start:build \
    && install -d -m 0755 dist/assets \
    && curl --fail --show-error --silent --location --retry 3 \
        https://validator.remna.dev/wasm_exec.js -o dist/assets/wasm_exec.js \
    && curl --fail --show-error --silent --location --retry 3 \
        https://validator.remna.dev/xray.schema.json -o dist/assets/xray.schema.json \
    && curl --fail --show-error --silent --location --retry 3 \
        https://validator.remna.dev/xray.schema.cn.json -o dist/assets/xray.schema.cn.json \
    && curl --fail --show-error --silent --location --retry 3 \
        https://validator.remna.dev/main.wasm -o dist/assets/main.wasm \
    && node -e "JSON.parse(require('fs').readFileSync('dist/assets/xray.schema.json', 'utf8')); JSON.parse(require('fs').readFileSync('dist/assets/xray.schema.cn.json', 'utf8'))" \
    && node -e "const b=require('fs').readFileSync('dist/assets/main.wasm'); if (b.length < 8 || b.subarray(0,4).toString('hex') !== '0061736d') process.exit(1)" \
    && test -s dist/assets/wasm_exec.js

FROM ${NODE_IMAGE} AS backend-build
WORKDIR /opt/app

ENV NODE_OPTIONS=--max-old-space-size=4096

COPY apps/backend/package.json apps/backend/package-lock.json ./
COPY apps/backend/prisma ./prisma
COPY apps/backend/rspack.config.mjs ./
COPY apps/backend/prisma.config.ts ./prisma.config.ts
COPY apps/backend/@types ./@types

RUN npm ci --prefer-offline --no-audit --no-fund

COPY apps/backend/tsconfig*.json ./
COPY apps/backend/src ./src
COPY apps/backend/libs ./libs

RUN npm run migrate:generate \
    && npm run build \
    && npm prune --omit=dev \
    && npm cache clean --force

RUN cd node_modules/@prisma/client/runtime \
    && find . -maxdepth 1 -type f ! -name 'library.js' ! -name 'package.json' -delete \
    && cd /opt/app/node_modules/.prisma/client \
    && find . -maxdepth 1 -type f \
      \( -name 'edge.*' -o -name 'index-browser.js' -o -name 'wasm.*' \
         -o -name 'query_engine_bg.*' -o -name '*-loader.mjs' \) -delete \
    && cd /opt/app \
    && rm -rf node_modules/typescript \
           node_modules/effect/dist/esm \
           node_modules/effect/dist/dts \
           node_modules/effect/src \
    && find node_modules \( -name '*.js.map' -o -name '*.mjs.map' \) -delete \
    && find node_modules \( -name '*.d.ts' -o -name '*.d.cts' -o -name '*.d.mts' \) -delete

FROM ${NODE_IMAGE} AS runtime
WORKDIR /opt/app

ARG SOURCE_COMMIT=unknown
ARG BUILD_TIME=unknown
ARG APP_VERSION=3.2.3-myremnawave

LABEL org.opencontainers.image.title="myRemnawave Panel" \
      org.opencontainers.image.description="Remnawave panel with myRemnawave machine management" \
      org.opencontainers.image.url="https://github.com/FengHaoyun-MONSTER/myRemnawave" \
      org.opencontainers.image.source="https://github.com/FengHaoyun-MONSTER/myRemnawave" \
      org.opencontainers.image.revision="${SOURCE_COMMIT}" \
      org.opencontainers.image.created="${BUILD_TIME}" \
      org.opencontainers.image.licenses="AGPL-3.0-only"

RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates curl \
    && npm install --global --no-audit --no-fund pm2@7.0.3 \
    && rm -rf /var/lib/apt/lists/* /root/.npm \
        /usr/local/lib/node_modules/npm \
        /usr/local/lib/node_modules/corepack \
        /usr/local/bin/npm \
        /usr/local/bin/npx \
        /usr/local/bin/corepack \
        /usr/local/include/node

ENV REMNAWAVE_BRANCH=main \
    PRISMA_HIDE_UPDATE_MESSAGE=true \
    PRISMA_ENGINES_CHECKSUM_IGNORE_MISSING=1 \
    PM2_DISABLE_VERSION_CHECK=true \
    NODE_OPTIONS=--max-old-space-size=4096 \
    __RW_METADATA_VERSION=${APP_VERSION} \
    __RW_METADATA_GIT_BACKEND_COMMIT=${SOURCE_COMMIT} \
    __RW_METADATA_GIT_FRONTEND_COMMIT=${SOURCE_COMMIT} \
    __RW_METADATA_GIT_BRANCH=main \
    __RW_METADATA_BUILD_TIME=${BUILD_TIME} \
    __RW_METADATA_BUILD_NUMBER=0

COPY --from=backend-build /opt/app/dist ./dist
COPY --from=frontend-build /opt/frontend/dist ./frontend
COPY --from=backend-build /opt/app/prisma/generated ./prisma/generated
COPY --from=backend-build /opt/app/prisma/migrations ./prisma/migrations
COPY --from=backend-build /opt/app/prisma/schema.prisma ./prisma/schema.prisma
COPY --from=backend-build /opt/app/node_modules ./node_modules

COPY apps/backend/configs /var/lib/remnawave/configs
COPY apps/backend/package.json apps/backend/package-lock.json ./
COPY apps/backend/prisma.config.ts ./prisma.config.ts
COPY apps/backend/ecosystem.config.js ./
COPY apps/backend/docker-entrypoint.sh ./

RUN chmod 0755 /opt/app/docker-entrypoint.sh /opt/app/dist/cli.js \
    && ln -s /opt/app/dist/cli.js /usr/local/bin/cli

EXPOSE 3000 3001 3010

HEALTHCHECK --interval=15s --timeout=5s --start-period=45s --retries=5 \
    CMD curl --fail --silent --show-error http://127.0.0.1:3001/health >/dev/null \
        && curl --fail --silent --show-error \
            --header 'X-Forwarded-For: 127.0.0.1' \
            --header 'X-Forwarded-Proto: https' \
            http://127.0.0.1:3000/ >/dev/null \
        || exit 1

ENTRYPOINT ["/bin/sh", "docker-entrypoint.sh"]
CMD ["pm2-runtime", "start", "ecosystem.config.js", "--env", "production"]
