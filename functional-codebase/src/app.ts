// Stack: TypeScript / Node 24 / Express 5 / Prisma 7 / PostgreSQL
// Tool: Claude Code (claude-opus-5-5)
// Prompt Summary: PA2 functional baseline — Express application: middleware, /api/v1 routers and error handling
// AI Contribution: ~100% (generated)
// Human Modifications: none yet
// Verification: pending human review
// Confidence: pending

import express from 'express';
import { errorHandler, notFoundHandler } from './lib/errors.js';
import { requestLogger } from './lib/logger.js';
import { allocationsRouter } from './routes/allocations.js';
import { assetsRouter } from './routes/assets.js';
import { healthRouter } from './routes/health.js';
import { ticketsRouter } from './routes/tickets.js';

export function createApp() {
  const app = express();
  app.use(express.json({ limit: '100kb' }));
  app.use(requestLogger);

  app.use('/api/v1', healthRouter);
  // The fixed sub-paths must be mounted before /assets/:asset_id would capture them.
  app.use('/api/v1/assets/allocations', allocationsRouter);
  app.use('/api/v1/assets/tickets', ticketsRouter);
  app.use('/api/v1/assets', assetsRouter);

  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}
