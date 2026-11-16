// Stack: TypeScript / Node 24 / Express 5 / Prisma 7 / PostgreSQL
// Tool: Claude Code (claude-opus-5-5)
// Prompt Summary: PA2 functional baseline — Vitest global setup that applies Prisma migrations before the suite
// AI Contribution: ~100% (generated)
// Human Modifications: none yet
// Verification: pending human review
// Confidence: pending

import { execFileSync } from 'node:child_process';

export default function setup() {
  if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL is not set; start the database (docker compose up -d db) and create .env');
  }
  // Idempotent: applies only migrations the test database has not seen yet.
  execFileSync('npx', ['prisma', 'migrate', 'deploy'], { stdio: 'pipe', env: process.env });
}
