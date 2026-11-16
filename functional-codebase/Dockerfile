# syntax=docker/dockerfile:1
# Stack: TypeScript / Node 24 / Express 5 / Prisma 7 / PostgreSQL
# Tool: Claude Code (claude-opus-5-5)
# Prompt Summary: PA2 functional baseline — multi-stage image; build stage also carries mock data and the seed for the compose migrate job
# AI Contribution: ~100% (generated)
# Human Modifications: none yet
# Verification: pending human review
# Confidence: pending


ARG NODE_VERSION=24.22.2

# ---- build: install all deps, generate the Prisma client, compile TypeScript ----
FROM node:${NODE_VERSION}-slim AS build
WORKDIR /app

# The Prisma schema engine (used by `prisma migrate` in the compose migrate job) needs libssl.
RUN apt-get update && apt-get install -y --no-install-recommends openssl \
    && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json ./
RUN npm ci

COPY tsconfig.json tsconfig.build.json prisma.config.ts ./
COPY prisma ./prisma
COPY src ./src
RUN npm run build

# Static mock data loaded by `prisma db seed` in the compose migrate job.
COPY mock-data ./mock-data

# ---- prod-deps: a clean production-only install ----
# prisma and typescript are devDependencies but also optional peers of @prisma/client,
# so npm marks them devOptional and keeps them unless optional deps are omitted too.
FROM node:${NODE_VERSION}-slim AS prod-deps
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev --omit=optional

# ---- runtime: built output + production dependencies only ----
FROM node:${NODE_VERSION}-slim AS runtime
ENV NODE_ENV=production
WORKDIR /app

COPY --from=build /app/package.json ./
COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist

EXPOSE 3000
CMD ["node", "dist/server.js"]
