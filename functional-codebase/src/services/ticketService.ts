// Stack: TypeScript / Node 24 / Express 5 / Prisma 7 / PostgreSQL
// Tool: Claude Code (claude-opus-5-5)
// Prompt Summary: PA2 functional baseline — help desk ticket pipeline: submission, edits, review transitions, listing
// AI Contribution: ~100% (generated)
// Human Modifications: none yet
// Verification: pending human review
// Confidence: pending

import { Prisma } from '../generated/prisma/client.js';
import { AllocationStatus, PersonRole, TicketStatus } from '../generated/prisma/enums.js';
import { kindOf } from '../lib/assetKinds.js';
import { badRequest, conflict, forbidden, notFound } from '../lib/errors.js';
import { logger } from '../lib/logger.js';
import { prisma } from '../lib/prisma.js';
import { type Db, refreshAssetStatuses } from '../repositories/assetRepository.js';
import { buildTicketWhere, findTicketDetail, findTickets, recordEvent } from '../repositories/ticketRepository.js';
import type { CreateTicketInput, TicketItemInput, TicketQuery, UpdateTicketInput } from '../validation/schemas.js';
import { requireActor } from './actors.js';
import { sweepOverdue } from './assetService.js';
import { serializeTicketDetail, serializeTicketSummary } from './serializers.js';

/**
 * Review transitions allowed through PUT. `allocated` is deliberately absent: only the
 * allocation engine (POST .../allocate) may move a ticket there.
 */
const TRANSITIONS: Record<TicketStatus, TicketStatus[]> = {
  pending: [TicketStatus.approved, TicketStatus.rejected],
  approved: [TicketStatus.rejected],
  rejected: [TicketStatus.closed],
  allocated: [TicketStatus.closed],
  closed: [],
};

async function loadTicket(id: string, db: Db = prisma) {
  const ticket = await findTicketDetail(id, db);
  if (!ticket) throw notFound(`Ticket ${id} not found`);
  return ticket;
}

/** Checks each requested line against the asset it targets and the asset kind's rules. */
async function validateItems(items: TicketItemInput[], db: Db) {
  const ids = items.map((i) => i.assetId);
  if (new Set(ids).size !== ids.length) throw badRequest('Each asset may appear only once per ticket');

  const assets = await db.asset.findMany({ where: { id: { in: ids }, retiredAt: null } });
  const byId = new Map(assets.map((a) => [a.id, a]));
  const problems: { index: number; assetId: string; message: string }[] = [];

  items.forEach((item, index) => {
    const asset = byId.get(item.assetId);
    const fail = (message: string) => problems.push({ index, assetId: item.assetId, message });
    if (!asset) return fail('asset not found');

    const kind = kindOf(asset.category);
    if (item.quantity > asset.totalStock) fail(`quantity exceeds total stock of ${asset.totalStock}`);
    if (kind === 'voucher') {
      if (item.creditAmount === undefined) fail('creditAmount is required for cloud_voucher items');
      else if (item.creditAmount > Number(asset.creditTotal)) fail(`creditAmount exceeds pool total of ${asset.creditTotal}`);
    } else if (item.creditAmount !== undefined) {
      fail('creditAmount applies to cloud_voucher items only');
    }
    if (kind !== 'physical' && item.loanDays !== undefined) fail('loanDays applies to physical items only');
  });

  if (problems.length > 0) throw badRequest('Invalid ticket items', problems);
}

const itemData = (items: TicketItemInput[]) =>
  items.map((i) => ({
    assetId: i.assetId,
    quantity: i.quantity,
    creditAmount: i.creditAmount === undefined ? null : new Prisma.Decimal(i.creditAmount.toFixed(2)),
    loanDays: i.loanDays ?? null,
    justification: i.justification ?? null,
  }));

export async function createTicket(input: CreateTicketInput) {
  const requester = await prisma.person.findUnique({ where: { id: input.requesterId } });
  if (!requester) throw badRequest(`requesterId ${input.requesterId} does not reference a known person`);

  // Requests come from the course instructor or the lab's faculty advisor.
  if (input.courseId) {
    const course = await prisma.course.findUnique({ where: { id: input.courseId } });
    if (!course) throw badRequest(`courseId ${input.courseId} does not reference a known course`);
    if (course.instructorId !== requester.id) {
      throw forbidden(`${requester.name} is not the instructor of ${course.code}-${course.section}`);
    }
  } else {
    const lab = await prisma.researchLab.findUnique({ where: { id: input.labId! } });
    if (!lab) throw badRequest(`labId ${input.labId} does not reference a known research lab`);
    if (lab.facultyAdvisorId !== requester.id) {
      throw forbidden(`${requester.name} is not the faculty advisor of ${lab.name}`);
    }
  }

  const ticket = await prisma.$transaction(async (tx) => {
    await validateItems(input.items, tx);
    const created = await tx.ticket.create({
      data: {
        title: input.title,
        description: input.description ?? null,
        projectName: input.projectName ?? null,
        priority: input.priority,
        requesterId: requester.id,
        courseId: input.courseId ?? null,
        labId: input.labId ?? null,
        items: { create: itemData(input.items) },
      },
    });
    await recordEvent(tx, { ticketId: created.id, fromStatus: null, toStatus: TicketStatus.pending, actorId: requester.id, note: 'submitted' });
    return loadTicket(created.id, tx);
  });

  const body = serializeTicketDetail(ticket);
  logger.info('ticket_submitted', {
    ticketId: ticket.id,
    requesterId: requester.id,
    group: body.group,
    priority: ticket.priority,
    itemCount: body.metrics.itemCount,
    unitsRequested: body.metrics.unitsRequested,
    creditRequested: body.metrics.creditRequested,
  });
  return body;
}

export async function getTicket(id: string) {
  await sweepOverdue();
  return serializeTicketDetail(await loadTicket(id));
}

export async function listTickets(query: TicketQuery) {
  const { rows, total, byStatus } = await findTickets(buildTicketWhere(query), query.limit, query.offset);
  return {
    data: rows.map(serializeTicketSummary),
    total,
    limit: query.limit,
    offset: query.offset,
    metrics: {
      byStatus: Object.fromEntries(byStatus.map((g) => [g.status, g._count._all])),
    },
  };
}

const CONTENT_FIELDS = ['title', 'description', 'projectName', 'priority', 'items'] as const;

/**
 * PUT /tickets/:id — edits the contents of a pending ticket and/or performs a review
 * transition (approve, reject, close). Both happen in one transaction.
 */
export async function updateTicket(id: string, input: UpdateTicketInput) {
  const current = await loadTicket(id);
  const editsContent = CONTENT_FIELDS.some((f) => input[f] !== undefined);
  const target = input.status !== undefined && input.status !== current.status ? input.status : undefined;

  if (editsContent && current.status !== TicketStatus.pending) {
    throw conflict(`Only pending tickets can be edited; ticket is ${current.status}`);
  }

  let actor = null;
  if (target) {
    if (target === TicketStatus.allocated) {
      throw conflict('Tickets move to allocated only through POST /api/v1/assets/tickets/{ticket_id}/allocate');
    }
    if (!TRANSITIONS[current.status].includes(target)) {
      throw conflict(`Cannot move ticket from ${current.status} to ${target}`, {
        allowed: TRANSITIONS[current.status],
      });
    }
    if (target === TicketStatus.approved || target === TicketStatus.rejected) {
      // Sign-off belongs to the IT director.
      actor = await requireActor(input.actorId!, [PersonRole.it_director], `Setting a ticket to ${target}`);
      if (target === TicketStatus.rejected && !input.rejectionReason) {
        throw badRequest('rejectionReason is required to reject a ticket');
      }
    } else {
      actor = await prisma.person.findUnique({ where: { id: input.actorId! } });
      if (!actor) throw badRequest(`actorId ${input.actorId} does not reference a known person`);
      const staff: PersonRole[] = [PersonRole.admin, PersonRole.it_director];
      if (!staff.includes(actor.role) && actor.id !== current.requesterId) {
        throw forbidden('Closing a ticket requires an admin, the IT director or the requester');
      }
      const outstanding = current.allocations.filter(
        (a) => a.status === AllocationStatus.checkedout || a.status === AllocationStatus.overdue,
      );
      if (outstanding.length > 0) {
        throw conflict('Ticket still has physical devices checked out; return them first', {
          outstandingAllocationIds: outstanding.map((a) => a.id),
        });
      }
    }
  }

  const updated = await prisma.$transaction(async (tx) => {
    if (editsContent) {
      if (input.items) {
        await validateItems(input.items, tx);
        await tx.ticketItem.deleteMany({ where: { ticketId: id } });
        await tx.ticketItem.createMany({ data: itemData(input.items).map((d) => ({ ...d, ticketId: id })) });
      }
      // Guarded by status so a concurrent approval cannot be followed by an edit.
      const edited = await tx.ticket.updateMany({
        where: { id, status: TicketStatus.pending },
        data: {
          title: input.title,
          description: input.description,
          projectName: input.projectName,
          priority: input.priority,
        },
      });
      if (edited.count !== 1) throw conflict('Ticket changed state concurrently; reload and retry');
    }

    if (target && actor) {
      const now = new Date();
      const data: Prisma.TicketUncheckedUpdateManyInput = { status: target };
      if (target === TicketStatus.approved || target === TicketStatus.rejected) {
        data.reviewedById = actor.id;
        data.reviewedAt = now;
        data.rejectionReason = target === TicketStatus.rejected ? input.rejectionReason : null;
      }
      if (target === TicketStatus.closed) data.closedAt = now;

      const moved = await tx.ticket.updateMany({ where: { id, status: current.status }, data });
      if (moved.count !== 1) throw conflict('Ticket changed state concurrently; reload and retry');
      await recordEvent(tx, {
        ticketId: id,
        fromStatus: current.status,
        toStatus: target,
        actorId: actor.id,
        note: input.note ?? input.rejectionReason ?? null,
      });
    } else if (editsContent) {
      await recordEvent(tx, {
        ticketId: id,
        fromStatus: TicketStatus.pending,
        toStatus: TicketStatus.pending,
        actorId: input.actorId ?? null,
        note: input.note ?? `edited: ${CONTENT_FIELDS.filter((f) => input[f] !== undefined).join(', ')}`,
      });
    }

    // Approval reserves (flags) the requested pools; rejection releases them.
    const assetIds = (await tx.ticketItem.findMany({ where: { ticketId: id }, select: { assetId: true } })).map(
      (i) => i.assetId,
    );
    const previousIds = current.items.map((i) => i.assetId);
    await refreshAssetStatuses(tx, [...new Set([...assetIds, ...previousIds])]);
    return loadTicket(id, tx);
  });

  const body = serializeTicketDetail(updated);
  if (target) {
    logger.info('ticket_transition', {
      ticketId: id,
      from: current.status,
      to: target,
      actorId: actor?.id,
      hoursToReview: body.metrics.hoursToReview,
      hoursOpen: body.metrics.hoursOpen,
    });
  }
  if (editsContent) logger.info('ticket_edited', { ticketId: id, fields: CONTENT_FIELDS.filter((f) => input[f] !== undefined) });
  return body;
}

/** Only pending requests can be deleted; anything reviewed stays for the audit trail. */
export async function deleteTicket(id: string) {
  const deleted = await prisma.ticket.deleteMany({ where: { id, status: TicketStatus.pending } });
  if (deleted.count !== 1) {
    const existing = await prisma.ticket.findUnique({ where: { id }, select: { status: true } });
    if (!existing) throw notFound(`Ticket ${id} not found`);
    throw conflict(`Only pending tickets can be deleted; ticket is ${existing.status}`);
  }
  logger.info('ticket_deleted', { ticketId: id });
}
