// Stack: TypeScript / Node 24 / Express 5 / Prisma 7 / PostgreSQL
// Tool: Claude Code (claude-opus-5-5)
// Prompt Summary: PA2 functional baseline — periodic job that flags overdue physical check-outs
// AI Contribution: ~100% (generated)
// Human Modifications: none yet
// Verification: pending human review
// Confidence: pending

import { logger } from '../lib/logger.js';
import { sweepOverdue } from '../services/assetService.js';

/** Runs the overdue sweep every `intervalMs`; reads also sweep, so this only keeps flags fresh. */
export function startOverdueJob(intervalMs = 5 * 60_000) {
  const run = () =>
    sweepOverdue().catch((err: unknown) =>
      logger.error('overdue_sweep_failed', { message: err instanceof Error ? err.message : String(err) }),
    );
  void run();
  const timer = setInterval(run, intervalMs);
  timer.unref();
  return () => clearInterval(timer);
}
