// Stack: TypeScript / Node 24 / Express 5 / Prisma 7 / PostgreSQL
// Tool: Claude Code (claude-opus-5-5)
// Prompt Summary: PA2 functional baseline — data access for assets: filters, lookups, atomic stock changes, status refresh
// AI Contribution: ~100% (generated)
// Human Modifications: none yet
// Verification: pending human review
// Confidence: pending

import { Prisma } from '../generated/prisma/client.js';
import { AllocationStatus } from '../generated/prisma/enums.js';
import { categoriesOfKind } from '../lib/assetKinds.js';
import { prisma } from '../lib/prisma.js';
import type { AssetQuery } from '../validation/schemas.js';

export type Db = Prisma.TransactionClient | typeof prisma;

export const ACTIVE_ALLOCATION_STATUSES: AllocationStatus[] = [
  AllocationStatus.checkedout,
  AllocationStatus.overdue,
  AllocationStatus.issued,
];

export function buildAssetWhere(query: AssetQuery): Prisma.AssetWhereInput {
  const and: Prisma.AssetWhereInput[] = [{ retiredAt: null }];

  if (query.category) and.push({ category: { in: query.category } });
  if (query.kind) and.push({ category: { in: categoriesOfKind(query.kind) } });
  if (query.status) and.push({ status: { in: query.status } });
  if (query.department) and.push({ department: { contains: query.department, mode: 'insensitive' } });
  if (query.q) {
    and.push({
      OR: [
        { name: { contains: query.q, mode: 'insensitive' } },
        { description: { contains: query.q, mode: 'insensitive' } },
      ],
    });
  }
  if (query.available === true) and.push({ availableStock: { gt: 0 } });
  if (query.available === false) and.push({ availableStock: 0 });
  if (query.courseId || query.labId) {
    and.push({
      allocations: {
        some: {
          status: { in: ACTIVE_ALLOCATION_STATUSES },
          ...(query.courseId ? { courseId: query.courseId } : {}),
          ...(query.labId ? { labId: query.labId } : {}),
        },
      },
    });
  }
  return { AND: and };
}

export async function findAssets(where: Prisma.AssetWhereInput, limit: number, offset: number) {
  const [rows, total] = await Promise.all([
    prisma.asset.findMany({ where, orderBy: [{ category: 'asc' }, { name: 'asc' }], take: limit, skip: offset }),
    prisma.asset.count({ where }),
  ]);
  return { rows, total };
}

export function findActiveAsset(id: string, db: Db = prisma) {
  return db.asset.findFirst({ where: { id, retiredAt: null } });
}

/** Active-allocation counts per asset, used for availability metrics. */
export async function allocationStatsByAsset(assetIds: string[]) {
  if (assetIds.length === 0) return new Map<string, { active: number; overdue: number }>();
  const grouped = await prisma.allocation.groupBy({
    by: ['assetId', 'status'],
    where: { assetId: { in: assetIds }, status: { in: ACTIVE_ALLOCATION_STATUSES } },
    _count: { _all: true },
  });
  const stats = new Map<string, { active: number; overdue: number }>();
  for (const g of grouped) {
    const s = stats.get(g.assetId) ?? { active: 0, overdue: 0 };
    s.active += g._count._all;
    if (g.status === AllocationStatus.overdue) s.overdue += g._count._all;
    stats.set(g.assetId, s);
  }
  return stats;
}

/**
 * Atomically takes `quantity` units (and `credit` for vouchers) out of the pool.
 * The WHERE clause makes the check-and-decrement a single row update, so concurrent
 * allocations can never drive stock or credit below zero. Returns false if the pool
 * does not hold enough.
 */
export async function deductStock(db: Db, assetId: string, quantity: number, credit?: Prisma.Decimal) {
  const result = await db.asset.updateMany({
    where: {
      id: assetId,
      retiredAt: null,
      availableStock: { gte: quantity },
      ...(credit ? { creditBalance: { gte: credit } } : {}),
    },
    data: {
      availableStock: { decrement: quantity },
      ...(credit ? { creditBalance: { decrement: credit } } : {}),
    },
  });
  return result.count === 1;
}

export function restoreStock(db: Db, assetId: string, quantity: number) {
  return db.asset.update({ where: { id: assetId }, data: { availableStock: { increment: quantity } } });
}

/**
 * Recomputes the pool status flag. Precedence: overdue (a unit is out past its due date)
 * > checkedout (no units left in the pool) > reserved (an approved ticket is waiting for
 * allocation) > available. With no ids, every active asset is refreshed.
 */
export function refreshAssetStatuses(db: Db, assetIds?: string[]) {
  const filter =
    assetIds === undefined ? Prisma.empty : Prisma.sql`AND a2."id" = ANY(${assetIds}::uuid[])`;
  return db.$executeRaw`
    UPDATE "Asset" a SET "status" = s.next_status, "updatedAt" = NOW()
    FROM (
      SELECT a2."id",
        (CASE
          WHEN EXISTS (SELECT 1 FROM "Allocation" al WHERE al."assetId" = a2."id" AND al."status" = 'overdue') THEN 'overdue'
          WHEN a2."availableStock" = 0 THEN 'checkedout'
          WHEN EXISTS (
            SELECT 1 FROM "TicketItem" ti JOIN "Ticket" t ON t."id" = ti."ticketId"
            WHERE ti."assetId" = a2."id" AND t."status" = 'approved'
          ) THEN 'reserved'
          ELSE 'available'
        END)::"AssetStatus" AS next_status
      FROM "Asset" a2
      WHERE a2."retiredAt" IS NULL ${filter}
    ) s
    WHERE s."id" = a."id" AND a."status" <> s.next_status`;
}

/** Flags checked-out physical units whose due date has passed. Returns affected asset ids. */
export async function markOverdueAllocations(db: Db, now = new Date()) {
  const due = await db.allocation.findMany({
    where: { status: AllocationStatus.checkedout, dueAt: { lt: now } },
    select: { id: true, assetId: true },
  });
  if (due.length === 0) return [];
  await db.allocation.updateMany({
    where: { id: { in: due.map((d) => d.id) }, status: AllocationStatus.checkedout },
    data: { status: AllocationStatus.overdue },
  });
  return [...new Set(due.map((d) => d.assetId))];
}
