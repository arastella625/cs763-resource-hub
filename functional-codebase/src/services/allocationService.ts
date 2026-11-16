// Stack: TypeScript / Node 24 / Express 5 / Prisma 7 / PostgreSQL
// Tool: Claude Code (claude-opus-5-5)
// Prompt Summary: PA2 functional baseline — allocation engine (atomic inventory deduction for approved tickets) and allocation reporting
// AI Contribution: ~100% (generated)
// Human Modifications: none yet
// Verification: pending human review
// Confidence: pending

import { Prisma } from '../generated/prisma/client.js';
import { AllocationStatus, AssetCategory, PersonRole, TicketStatus } from '../generated/prisma/enums.js';
import { DEFAULT_CHECKOUT_PERIOD_DAYS, issueToken, kindOf } from '../lib/assetKinds.js';
import { conflict, notFound } from '../lib/errors.js';
import { logger } from '../lib/logger.js';
import { prisma } from '../lib/prisma.js';
import { buildAllocationWhere, findAllocations } from '../repositories/allocationRepository.js';
import { deductStock, refreshAssetStatuses } from '../repositories/assetRepository.js';
import { findTicketDetail, recordEvent } from '../repositories/ticketRepository.js';
import type { AllocateTicketInput, AllocationQuery } from '../validation/schemas.js';
import { requireActor } from './actors.js';
import { sweepOverdue } from './assetService.js';
import { serializeAllocation, serializeTicketDetail, toNumber } from './serializers.js';

const DAY_MS = 86_400_000;

/**
 * POST /tickets/:id/allocate — the only code path that changes inventory for a request.
 * In a single transaction it claims the approved ticket, deducts every line from its pool
 * (all-or-nothing), and issues a license key / voucher code / hardware token per line.
 */
export async function allocateTicket(ticketId: string, input: AllocateTicketInput) {
  const actor = await requireActor(input.actorId, [PersonRole.admin], 'Executing an allocation');

  const ticket = await prisma.$transaction(async (tx) => {
    const now = new Date();

    // Claim the ticket first: the status guard makes a second, concurrent allocate fail.
    const claimed = await tx.ticket.updateMany({
      where: { id: ticketId, status: TicketStatus.approved },
      data: { status: TicketStatus.allocated, allocatedById: actor.id, allocatedAt: now },
    });
    if (claimed.count !== 1) {
      const existing = await tx.ticket.findUnique({ where: { id: ticketId }, select: { status: true } });
      if (!existing) throw notFound(`Ticket ${ticketId} not found`);
      throw conflict(`Only approved tickets can be allocated; ticket is ${existing.status}`);
    }

    const t = await tx.ticket.findUniqueOrThrow({ where: { id: ticketId }, include: { items: { include: { asset: true } } } });

    for (const item of t.items) {
      const kind = kindOf(item.asset.category);
      const credit = kind === 'voucher' ? (item.creditAmount ?? undefined) : undefined;

      const ok = await deductStock(tx, item.assetId, item.quantity, credit);
      if (!ok) {
        // Throwing rolls back every deduction made so far and the ticket claim.
        const fresh = await tx.asset.findUnique({ where: { id: item.assetId } });
        throw conflict(`Insufficient inventory for ${item.asset.name}`, {
          assetId: item.assetId,
          requestedUnits: item.quantity,
          availableStock: fresh?.retiredAt ? 0 : (fresh?.availableStock ?? 0),
          requestedCredit: toNumber(item.creditAmount),
          creditBalance: toNumber(fresh?.creditBalance),
        });
      }

      const loanDays = item.loanDays ?? item.asset.checkoutPeriodDays ?? DEFAULT_CHECKOUT_PERIOD_DAYS;
      await tx.allocation.create({
        data: {
          ticketId,
          ticketItemId: item.id,
          assetId: item.assetId,
          courseId: t.courseId,
          labId: t.labId,
          quantity: item.quantity,
          creditAmount: credit ?? null,
          token: issueToken(kind),
          status: kind === 'physical' ? AllocationStatus.checkedout : AllocationStatus.issued,
          allocatedById: actor.id,
          allocatedAt: now,
          dueAt: kind === 'physical' ? new Date(now.getTime() + loanDays * DAY_MS) : null,
        },
      });
    }

    await recordEvent(tx, {
      ticketId,
      fromStatus: TicketStatus.approved,
      toStatus: TicketStatus.allocated,
      actorId: actor.id,
      note: input.note ?? null,
    });
    await refreshAssetStatuses(tx, [...new Set(t.items.map((i) => i.assetId))]);
    return (await findTicketDetail(ticketId, tx))!;
  });

  const body = serializeTicketDetail(ticket);
  logger.info('ticket_allocated', {
    ticketId,
    actorId: actor.id,
    allocations: body.allocations.length,
    unitsAllocated: body.metrics.unitsAllocated,
    creditAllocated: body.metrics.creditAllocated,
    hoursToAllocation: body.metrics.hoursToAllocation,
  });
  return body;
}

type MetricRow = {
  status: AllocationStatus;
  quantity: number;
  creditAmount: Prisma.Decimal | null;
  asset: { category: AssetCategory };
};

function allocationMetrics(rows: MetricRow[]) {
  const m = {
    allocations: rows.length,
    activeAllocations: 0,
    checkedOutUnits: 0,
    overdueUnits: 0,
    returnedUnits: 0,
    licenseKeysIssued: 0,
    licenseSeatsIssued: 0,
    voucherCodesIssued: 0,
    voucherCreditIssued: 0,
  };
  for (const r of rows) {
    const kind = kindOf(r.asset.category);
    if (r.status !== AllocationStatus.returned) m.activeAllocations += 1;
    if (r.status === AllocationStatus.checkedout || r.status === AllocationStatus.overdue) m.checkedOutUnits += r.quantity;
    if (r.status === AllocationStatus.overdue) m.overdueUnits += r.quantity;
    if (r.status === AllocationStatus.returned) m.returnedUnits += r.quantity;
    if (kind === 'license') {
      m.licenseKeysIssued += 1;
      m.licenseSeatsIssued += r.quantity;
    }
    if (kind === 'voucher') {
      m.voucherCodesIssued += r.quantity;
      m.voucherCreditIssued += Number(r.creditAmount ?? 0);
    }
  }
  m.voucherCreditIssued = Math.round(m.voucherCreditIssued * 100) / 100;
  return m;
}

/** GET /assets/allocations — allocations, checked-out metrics and issued keys per course or lab. */
export async function listAllocations(query: AllocationQuery) {
  await sweepOverdue();

  let group: { type: 'course' | 'lab'; id: string; name: string } | null = null;
  if (query.courseId) {
    const course = await prisma.course.findUnique({ where: { id: query.courseId } });
    if (!course) throw notFound(`Course ${query.courseId} not found`);
    group = { type: 'course', id: course.id, name: `${course.code}-${course.section} ${course.title}` };
  } else if (query.labId) {
    const lab = await prisma.researchLab.findUnique({ where: { id: query.labId } });
    if (!lab) throw notFound(`Research lab ${query.labId} not found`);
    group = { type: 'lab', id: lab.id, name: lab.name };
  }

  const now = new Date();
  const { rows, total, all } = await findAllocations(buildAllocationWhere(query), query.limit, query.offset);
  return {
    group,
    data: rows.map((r) => serializeAllocation(r, now)),
    total,
    limit: query.limit,
    offset: query.offset,
    metrics: allocationMetrics(all),
  };
}
