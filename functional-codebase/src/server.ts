// Stack: TypeScript / Node 24 / Express 5 / Prisma 7 / PostgreSQL
// Tool: Claude Code (claude-opus-5-5)
// Prompt Summary: PA2 functional baseline — process entry point: connects to PostgreSQL, starts the HTTP server and the overdue job
// AI Contribution: ~100% (generated)
// Human Modifications: none yet
// Verification: pending human review
// Confidence: pending

import { createApp } from './app.js';
import { startOverdueJob } from './jobs/overdueJob.js';
import { config } from './lib/config.js';
import { prisma } from './lib/prisma.js';

await prisma.$connect();
await prisma.$queryRaw`SELECT 1`;
console.log('Connected to PostgreSQL');

const stopOverdueJob = startOverdueJob();

const server = createApp().listen(config.port, () => {
  console.log(`Resource Hub listening on port ${config.port} (${config.nodeEnv})`);
});

async function shutdown(signal: string) {
  console.log(`${signal} received, shutting down`);
  stopOverdueJob();
  server.close();
  await prisma.$disconnect();
  process.exit(0);
}

process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));
