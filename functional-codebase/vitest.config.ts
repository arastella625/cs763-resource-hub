// Stack: TypeScript / Node 24 / Express 5 / Prisma 7 / PostgreSQL
// Tool: Claude Code (claude-opus-5-5)
// Prompt Summary: PA2 functional baseline — Vitest config: env loading, migration global setup, sequential DB tests
// AI Contribution: ~100% (generated)
// Human Modifications: none yet
// Verification: pending human review
// Confidence: pending

import { existsSync } from 'node:fs';
import { defineConfig } from 'vitest/config';

// Integration tests talk to the real PostgreSQL in DATABASE_URL. Locally that comes from
// .env (the docker compose db); CI sets it in the environment.
if (!process.env.DATABASE_URL && existsSync('.env')) process.loadEnvFile('.env');
process.env.LOG_LEVEL ??= 'silent';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    globalSetup: ['tests/helpers/globalSetup.ts'],
    // Test files share one database; run them one after another.
    fileParallelism: false,
    testTimeout: 20_000,
    hookTimeout: 30_000,
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: ['src/generated/**'],
      reporter: ['text', 'lcov'],
    },
  },
});
