// Stack: TypeScript / Node 24 / Express 5 / Prisma 7 / PostgreSQL
// Tool: Claude Code (claude-opus-5-5)
// Prompt Summary: PA2 functional baseline — route for reading active allocations per course or lab (/api/v1/assets/allocations)
// AI Contribution: ~100% (generated)
// Human Modifications: none yet
// Verification: pending human review
// Confidence: pending

import { Router } from 'express';
import { listAllocations } from '../services/allocationService.js';
import { allocationQuerySchema } from '../validation/schemas.js';

export const allocationsRouter = Router();

allocationsRouter.get('/', async (req, res) => {
  res.json(await listAllocations(allocationQuerySchema.parse(req.query)));
});
