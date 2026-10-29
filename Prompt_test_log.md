# Prompt Test Log

**Project:** Resource Allocation & Help Desk Hub (Project Portal, Domain 2)
**Course:** CS763 Secure Software Development, Boston University MET, Fall 2026
**Author:** Amber Rastella

This log records every prompt given to the AI developer agent that produced code, with the generated output, to show the agent environment works end to end. The full agent configuration is documented in [Agent_environment.md](Agent_environment.md).

| Field | Value |
|---|---|
| Agent | Claude Code 2.1.312 (native install, WSL2 Ubuntu 24.04.5) |
| Model | Opus 5.5 (`claude-opus-5-5`), effort `high` |
| Permission mode | auto |
| Session | PA1 setup session, started 2026-10-28 |

Each entry gives the verbatim prompt, a timestamp (ET), a summary of what the agent generated, and the key generated code (file paths plus excerpts).

---

## Entry 1: Scaffold the barebone app

**Timestamp:** 2026-10-28 21:44 EDT
**Session:** PA1 setup session 2 (relaunched from the repo folder after the docker group fix)

### Prompt (verbatim)

This entry's prompt came in two parts. First, the Task 2 section of the PA1 handoff prompt:

> **Task 2: Start the prompt log, then scaffold the barebone app.**
> - Create `Prompt_test_log.md`. From now on, append every prompt I give you that generates code: the verbatim prompt, a timestamp, a summary of what you generated, and the key generated code (or file paths plus excerpts).
> - Explain the Prisma vs. `pg` trade-off and wait for my choice.
> - Then scaffold ONLY a barebone app matching the folder layout in spec.md §10: package.json, tsconfig, an Express app with `GET /api/v1/health` returning `{ "status": "ok" }`, a database connection to PostgreSQL, a minimal schema/migration setup (no feature tables yet), one Vitest + Supertest test for /health, and npm scripts (dev, build, start, test, lint).
> - Do not implement the spec's features yet, and do not add security hardening. PA1 is foundation only.
> CHECKPOINT.

Then, at the start of session 2:

> Task 1 is done and I chose Prisma. Read ~/cs763-pa1-status.md for the findings and current state, re-verify Docker works, then continue from Task 2

### Generated

**Prisma vs. `pg` decision:** Prisma, chosen by the author in session 1 (matches spec.md §1.2 and NFR-6).

**Summary.** The agent scaffolded a barebone Express 5 + TypeScript (strict, ESM/NodeNext) app with Prisma 7 connected to PostgreSQL through the `@prisma/adapter-pg` driver adapter, an empty Prisma schema (no models), one Vitest + Supertest test, and ESLint. No spec features were implemented.

| Package | Version |
|---|---|
| express | 5.3.0 |
| prisma, @prisma/client, @prisma/adapter-pg | 7.10.1 |
| pg | 8.23.1 |
| zod | 4.6.7 (installed, not used yet) |
| typescript | 6.0.3 (TS 7 skipped because typescript-eslint supports `<6.1`) |
| vitest / supertest | 5.0.5 / 7.3.1 |
| eslint / typescript-eslint | 10.13.0 / 8.72.1 |
| tsx | 4.23.15 |

npm's `latest` tag for `prisma` pointed to `8.0.0-rc.28`, so the agent pinned the stable 7.10.1. npm 11 blocked install scripts for `prisma`, `@prisma/engines` and `esbuild`. They were left unapproved because generate, migrate and tsx all work without them.

**Files created**

```
package.json, package-lock.json, tsconfig.json, tsconfig.build.json,
vitest.config.ts, eslint.config.js, prisma.config.ts, .env.example,
prisma/schema.prisma, prisma/migrations/.gitkeep,
src/app.ts, src/server.ts, src/routes/health.ts,
src/lib/config.ts, src/lib/prisma.ts,
src/services/.gitkeep, src/jobs/.gitkeep, mock-data/.gitkeep,
tests/health.test.ts
```

`.gitignore` also gained `src/generated/` (the generated Prisma client).

**npm scripts** (`package.json`)

```json
"dev": "tsx watch --env-file-if-exists=.env src/server.ts",
"build": "prisma generate && tsc -p tsconfig.build.json",
"start": "node --env-file-if-exists=.env dist/server.js",
"test": "vitest run",
"lint": "eslint .",
"typecheck": "tsc --noEmit",
"db:generate": "prisma generate",
"db:migrate": "prisma migrate dev",
"db:deploy": "prisma migrate deploy"
```

**`src/routes/health.ts`**

```ts
export const healthRouter = Router();

healthRouter.get('/health', (_req, res) => {
  res.json({ status: 'ok' });
});
```

**`src/app.ts`**

```ts
export function createApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/v1', healthRouter);
  return app;
}
```

**`src/lib/prisma.ts`** (database connection)

```ts
const adapter = new PrismaPg({ connectionString: config.databaseUrl });

export const prisma = new PrismaClient({ adapter });
```

**`src/server.ts`** (excerpt)

```ts
await prisma.$connect();
await prisma.$queryRaw`SELECT 1`;
console.log('Connected to PostgreSQL');

const server = createApp().listen(config.port, () => { ... });
```

**`prisma/schema.prisma`**

```prisma
generator client {
  provider            = "prisma-client"
  output              = "../src/generated/prisma"
  moduleFormat        = "esm"
  importFileExtension = "js"
}

datasource db {
  provider = "postgresql"
}
```

**`tests/health.test.ts`**

```ts
describe('GET /api/v1/health', () => {
  it('returns status ok', async () => {
    const res = await request(createApp()).get('/api/v1/health');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'ok' });
  });
});
```

### Verification

| Check | Result |
|---|---|
| `npm run typecheck` | pass |
| `npm run lint` | pass, 0 problems |
| `npm test` | 1 file, 1 test passed |
| `npm run build` | Prisma client generated, `dist/` emitted |
| `prisma migrate dev` / `migrate deploy` against a temporary `postgres:17` container | "Already in sync" / "No pending migrations to apply" (no models yet) |
| `npm start` + `curl localhost:3000/api/v1/health` | `Connected to PostgreSQL`, then `{"status":"ok"}`; clean shutdown on SIGTERM |

---

## Entry 2: Docker (multi-stage Dockerfile and compose)

**Timestamp:** 2026-10-28 21:49 EDT
**Session:** PA1 setup session 2

### Prompt (verbatim)

> go

This approved continuing to Task 3 of the PA1 handoff prompt, which reads:

> **Task 3: Docker.**
> - Multi-stage `Dockerfile`: a build stage that compiles TypeScript, and a slim runtime stage that copies only the built output and production dependencies.
> - `docker-compose.yml` with `app` and `db` (PostgreSQL 17) services, a healthcheck on the database, and environment variables loaded from `.env` (also commit a `.env.example` with placeholder values only).
> - Verify that `docker compose up --build` works and that /health responds.
> CHECKPOINT.

### Generated

**Summary.** The agent wrote a three-stage `Dockerfile` (`build`, `prod-deps`, `runtime`) on `node:24.22.2-slim` (Debian 12), a `.dockerignore`, and a `docker-compose.yml` with `db` (PostgreSQL 17 with a `pg_isready` healthcheck), a one-shot `migrate` job (`prisma migrate deploy`) and `app`. `app` starts only after `db` is healthy and `migrate` has exited 0. `.env.example` was committed in Entry 1. Compose loads `.env` via `env_file` and variable interpolation, and overrides `DATABASE_URL` to point at the `db` service.

**Files created:** `Dockerfile`, `.dockerignore`, `docker-compose.yml`; README gained a "Running locally" section.

**Iterations during generation**

1. The first version used `npm prune --omit=dev` in the build stage. The runtime image was 819 MB and still contained `prisma`, `typescript` and the Prisma Studio UI deps. Cause: `prisma` and `typescript` are optional peers of `@prisma/client`, so npm marks them `devOptional` in the lockfile and keeps them under `--omit=dev`. Fix: a separate `prod-deps` stage running `npm ci --omit=dev --omit=optional`. Runtime image: 452 MB, `node_modules` 88 MB, production packages only.
2. The `migrate` job warned that Prisma could not detect libssl. The Prisma schema engine needs OpenSSL, so `openssl` was installed in the build stage only (the runtime uses the pure-JS `pg` adapter).

**`Dockerfile`**

```dockerfile
# syntax=docker/dockerfile:1

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

# ---- prod-deps: a clean production-only install ----
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
```

**`docker-compose.yml`** (excerpt)

```yaml
  db:
    image: postgres:17
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U $${POSTGRES_USER} -d $${POSTGRES_DB}"]

  migrate:
    build: { context: ., target: build }
    command: ["npx", "prisma", "migrate", "deploy"]
    depends_on:
      db: { condition: service_healthy }

  app:
    build: { context: ., target: runtime }
    env_file: .env
    environment:
      DATABASE_URL: postgresql://${POSTGRES_USER}:${POSTGRES_PASSWORD}@db:5432/${POSTGRES_DB}
    depends_on:
      db: { condition: service_healthy }
      migrate: { condition: service_completed_successfully }
```

### Verification

Fresh run (`docker compose down -v && docker compose up --build -d`):

```
SERVICE   STATUS
app       Up 6 seconds (healthy)
db        Up 13 seconds (healthy)
migrate   Exited (0) 6 seconds ago

$ curl -i localhost:3000/api/v1/health
HTTP/1.1 200 OK
{"status":"ok"}

migrate | Datasource "db": PostgreSQL database "resourcehub", schema "public" at "db:5432"
migrate | No pending migrations to apply.
app     | Connected to PostgreSQL
app     | Resource Hub listening on port 3000 (development)
```

| Image | Size |
|---|---|
| `cs763-resource-hub-app` (runtime stage) | 452 MB |
| `cs763-resource-hub-migrate` (build stage) | 1.2 GB |
