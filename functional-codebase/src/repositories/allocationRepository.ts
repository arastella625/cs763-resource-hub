// Stack: TypeScript / Node 24 / Express 5 / Prisma 7 / PostgreSQL
// Tool: Claude Code (claude-opus-5-5)
// Prompt Summary: PA2 functional baseline — data access for allocations: filters, includes, listing
// AI Contribution: ~100% (generated)
// Human Modifications: none yet
// Verification: pending human review
// Confidence: pending

import type { Prisma } from '../generated/prisma/client.js';
import type { AllocationStatus } from '../generated/prisma/enums.js';
import { prisma } from '../lib/prisma.js';
import type { AllocationQuery } from '../validation/schemas.js';
import { ACTIVE_ALLOCATION_STATUSES } from './assetRepository.js';

export const allocationInclude = {
  asset: { select: { id: true, name: true, category: true, department: true } },
  ticket: { select: { id: true, title: true, projectName: true, status: true } },
  course: { select: { id: true, code: true, section: true, title: true } },
  lab: { select: { id: true, name: true } },
} satisfies Prisma.AllocationInclude;

export type AllocationRow = Prisma.AllocationGetPayload<{ include: typeof allocationInclude }>;

export function buildAllocationWhere(query: AllocationQuery): Prisma.AllocationWhereInput {
  const and: Prisma.AllocationWhereInput[] = [];

  const status = query.status ?? 'active';
  if (status === 'active') and.push({ status: { in: ACTIVE_ALLOCATION_STATUSES } });
  else if (Array.isArray(status)) and.push({ status: { in: status as AllocationStatus[] } });

  if (query.courseId) and.push({ courseId: query.courseId });
  if (query.labId) and.push({ labId: query.labId });
  if (query.assetId) and.push({ assetId: query.assetId });
  if (query.ticketId) and.push({ ticketId: query.ticketId });
  if (query.category) and.push({ asset: { category: { in: query.category } } });
  return { AND: and };
}

export async function findAllocations(where: Prisma.AllocationWhereInput, limit: number, offset: number) {
  const [rows, total, all] = await Promise.all([
    prisma.allocation.findMany({
      where,
      include: allocationInclude,
      orderBy: [{ allocatedAt: 'desc' }, { id: 'asc' }],
      take: limit,
      skip: offset,
    }),
    prisma.allocation.count({ where }),
    // Light projection of the whole filtered set for the metrics block.
    prisma.allocation.findMany({
      where,
      select: { status: true, quantity: true, creditAmount: true, asset: { select: { category: true } } },
    }),
  ]);
  return { rows, total, all };
}
