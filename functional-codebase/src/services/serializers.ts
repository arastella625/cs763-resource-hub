// Stack: TypeScript / Node 24 / Express 5 / Prisma 7 / PostgreSQL
// Tool: Claude Code (claude-opus-5-5)
// Prompt Summary: PA2 functional baseline — shapes database rows into API responses with computed metrics
// AI Contribution: ~100% (generated)
// Human Modifications: none yet
// Verification: pending human review
// Confidence: pending

import type { Allocation, Asset, Prisma } from '../generated/prisma/client.js';
import { AllocationStatus } from '../generated/prisma/enums.js';
import { kindOf } from '../lib/assetKinds.js';
import type { TicketDetail, TicketListRow } from '../repositories/ticketRepository.js';

const HOUR_MS = 3_600_000;

export const toNumber = (d: Prisma.Decimal | null | undefined) => (d == null ? null : Number(d));
const hoursBetween = (from: Date, to: Date) => Math.round(((to.getTime() - from.getTime()) / HOUR_MS) * 100) / 100;

// ---------------------------------------------------------------------------
// Assets
// ---------------------------------------------------------------------------

export function serializeAsset(asset: Asset, stats?: { active: number; overdue: number }) {
  const kind = kindOf(asset.category);
  const allocatedUnits = asset.totalStock - asset.availableStock;
  const creditTotal = toNumber(asset.creditTotal);
  const creditBalance = toNumber(asset.creditBalance);
  return {
    id: asset.id,
    name: asset.name,
    category: asset.category,
    kind,
    description: asset.description,
    department: asset.department,
    status: asset.status,
    totalStock: asset.totalStock,
    availableStock: asset.availableStock,
    checkoutPeriodDays: kind === 'physical' ? asset.checkoutPeriodDays : null,
    creditTotal: kind === 'voucher' ? creditTotal : null,
    creditBalance: kind === 'voucher' ? creditBalance : null,
    metrics: {
      allocatedUnits,
      utilizationPct: asset.totalStock === 0 ? 0 : Math.round((allocatedUnits / asset.totalStock) * 1000) / 10,
      activeAllocations: stats?.active ?? 0,
      overdueAllocations: stats?.overdue ?? 0,
      creditUsed:
        kind === 'voucher' && creditTotal !== null && creditBalance !== null
          ? Math.round((creditTotal - creditBalance) * 100) / 100
          : null,
    },
    createdAt: asset.createdAt,
    updatedAt: asset.updatedAt,
  };
}

// ---------------------------------------------------------------------------
// Allocations
// ---------------------------------------------------------------------------

type AllocationWithAsset = Allocation & { asset: { category: Asset['category'] } & Record<string, unknown> };

/** Check-out duration tracking for physical units; null for digital allocations. */
export function checkoutTracking(allocation: Allocation, category: Asset['category'], now = new Date()) {
  if (kindOf(category) !== 'physical') return null;
  const end = allocation.returnedAt ?? now;
  const overdueRef = allocation.dueAt && end > allocation.dueAt ? hoursBetween(allocation.dueAt, end) : 0;
  return {
    checkoutDurationHours: hoursBetween(allocation.allocatedAt, end),
    dueAt: allocation.dueAt,
    isOverdue: allocation.status === AllocationStatus.overdue,
    returnedLate: allocation.returnedAt != null && overdueRef > 0,
    overdueByHours: overdueRef,
    hoursRemaining:
      allocation.returnedAt == null && allocation.dueAt && allocation.dueAt > now
        ? hoursBetween(now, allocation.dueAt)
        : 0,
  };
}

export function serializeAllocation<T extends AllocationWithAsset>(a: T, now = new Date()) {
  const { creditAmount, ...rest } = a;
  return {
    ...rest,
    kind: kindOf(a.asset.category),
    creditAmount: toNumber(creditAmount),
    tracking: checkoutTracking(a, a.asset.category, now),
  };
}

// ---------------------------------------------------------------------------
// Tickets
// ---------------------------------------------------------------------------

function serializeItems(items: TicketListRow['items']) {
  return items.map((i) => ({ ...i, creditAmount: toNumber(i.creditAmount) }));
}

export function serializeTicketSummary(t: TicketListRow) {
  return {
    ...t,
    items: serializeItems(t.items),
    group: t.course
      ? { type: 'course' as const, id: t.course.id, name: `${t.course.code}-${t.course.section}` }
      : { type: 'lab' as const, id: t.lab!.id, name: t.lab!.name },
  };
}

export function ticketMetrics(t: TicketDetail, now = new Date()) {
  const sum = (xs: number[]) => Math.round(xs.reduce((a, b) => a + b, 0) * 100) / 100;
  const outstandingPhysical = t.allocations.filter(
    (a) => a.status === AllocationStatus.checkedout || a.status === AllocationStatus.overdue,
  );
  return {
    itemCount: t.items.length,
    unitsRequested: sum(t.items.map((i) => i.quantity)),
    creditRequested: sum(t.items.map((i) => toNumber(i.creditAmount) ?? 0)),
    unitsAllocated: sum(t.allocations.map((a) => a.quantity)),
    creditAllocated: sum(t.allocations.map((a) => toNumber(a.creditAmount) ?? 0)),
    keysIssued: t.allocations.length,
    outstandingPhysicalUnits: sum(outstandingPhysical.map((a) => a.quantity)),
    unitsReturned: sum(t.allocations.filter((a) => a.status === AllocationStatus.returned).map((a) => a.quantity)),
    hoursToReview: t.reviewedAt ? hoursBetween(t.createdAt, t.reviewedAt) : null,
    hoursToAllocation: t.allocatedAt ? hoursBetween(t.createdAt, t.allocatedAt) : null,
    hoursOpen: hoursBetween(t.createdAt, t.closedAt ?? now),
    eventCount: t.events.length,
  };
}

export function serializeTicketDetail(t: TicketDetail, now = new Date()) {
  return {
    ...serializeTicketSummary(t),
    allocations: t.allocations.map((a) => serializeAllocation(a, now)),
    metrics: ticketMetrics(t, now),
  };
}
