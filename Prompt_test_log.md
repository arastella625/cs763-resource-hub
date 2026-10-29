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
