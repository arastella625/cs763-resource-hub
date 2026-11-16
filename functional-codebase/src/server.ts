import { createApp } from './app.js';
import { config } from './lib/config.js';
import { prisma } from './lib/prisma.js';

await prisma.$connect();
await prisma.$queryRaw`SELECT 1`;
console.log('Connected to PostgreSQL');

const server = createApp().listen(config.port, () => {
  console.log(`Resource Hub listening on port ${config.port} (${config.nodeEnv})`);
});

async function shutdown(signal: string) {
  console.log(`${signal} received, shutting down`);
  server.close();
  await prisma.$disconnect();
  process.exit(0);
}

process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));
