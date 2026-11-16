// Stack: TypeScript / Node 24 / Express 5 / Prisma 7 / PostgreSQL
// Tool: Claude Code (claude-opus-5-5)
// Prompt Summary: PA2 functional baseline — data access for help desk tickets: filters, includes, event log
// AI Contribution: ~100% (generated)
// Human Modifications: none yet
// Verification: pending human review
// Confidence: pending

import type { Prisma } from '../generated/prisma/client.js';
import { TicketStatus } from '../generated/prisma/enums.js';
import { prisma } from '../lib/prisma.js';
import type { TicketQuery } from '../validation/schemas.js';
import type { Db } from './assetRepository.js';

/** Statuses listed when no status filter is given ("active requests"). */
export const ACTIVE_TICKET_STATUSES: TicketStatus[] = [
  TicketStatus.pending,
  TicketStatus.approved,
  TicketStatus.allocated,
];

const personSummary = { select: { id: true, name: true, email: true, role: true } } as const;

export const ticketListInclude = {
  requester: personSummary,
  course: { select: { id: true, code: true, title: true, section: true, term: true } },
  lab: { select: { id: true, name: true } },
  items: {
    include: { asset: { select: { id: true, name: true, category: true } } },
    orderBy: { id: 'asc' },
  },
} satisfies Prisma.TicketInclude;

export const ticketDetailInclude = {
  ...ticketListInclude,
  reviewedBy: personSummary,
  allocatedBy: personSummary,
  events: { include: { actor: personSummary }, orderBy: { createdAt: 'asc' } },
  allocations: {
    include: { asset: { select: { id: true, name: true, category: true } } },
    orderBy: { allocatedAt: 'asc' },
  },
} satisfies Prisma.TicketInclude;

export type TicketDetail = Prisma.TicketGetPayload<{ include: typeof ticketDetailInclude }>;
export type TicketListRow = Prisma.TicketGetPayload<{ include: typeof ticketListInclude }>;

export function buildTicketWhere(query: TicketQuery): Prisma.TicketWhereInput {
  const and: Prisma.TicketWhereInput[] = [{ status: { in: query.status ?? ACTIVE_TICKET_STATUSES } }];

  if (query.priority) and.push({ priority: { in: query.priority } });
  if (query.courseId) and.push({ courseId: query.courseId });
  if (query.labId) and.push({ labId: query.labId });
  if (query.requesterId) and.push({ requesterId: query.requesterId });
  if (query.courseCode) and.push({ course: { code: { equals: query.courseCode, mode: 'insensitive' } } });
  if (query.section) and.push({ course: { section: { equals: query.section, mode: 'insensitive' } } });
  if (query.project) {
    and.push({
      OR: [
        { projectName: { contains: query.project, mode: 'insensitive' } },
        { lab: { name: { contains: query.project, mode: 'insensitive' } } },
      ],
    });
  }
  if (query.category) and.push({ items: { some: { asset: { category: { in: query.category } } } } });
  if (query.assetId) and.push({ items: { some: { assetId: query.assetId } } });
  return { AND: and };
}

export async function findTickets(where: Prisma.TicketWhereInput, limit: number, offset: number) {
  const [rows, total, byStatus] = await Promise.all([
    prisma.ticket.findMany({
      where,
      include: ticketListInclude,
      orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
      take: limit,
      skip: offset,
    }),
    prisma.ticket.count({ where }),
    prisma.ticket.groupBy({ by: ['status'], where, _count: { _all: true } }),
  ]);
  return { rows, total, byStatus };
}

export function findTicketDetail(id: string, db: Db = prisma) {
  return db.ticket.findUnique({ where: { id }, include: ticketDetailInclude });
}

export function recordEvent(
  db: Db,
  event: { ticketId: string; fromStatus: TicketStatus | null; toStatus: TicketStatus; actorId?: string | null; note?: string | null },
) {
  return db.ticketEvent.create({
    data: {
      ticketId: event.ticketId,
      fromStatus: event.fromStatus,
      toStatus: event.toStatus,
      actorId: event.actorId ?? null,
      note: event.note ?? null,
    },
  });
}
