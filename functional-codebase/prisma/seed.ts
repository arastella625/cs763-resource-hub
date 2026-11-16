// Stack: TypeScript / Node 24 / Express 5 / Prisma 7 / PostgreSQL
// Tool: Claude Code (claude-opus-5-5)
// Prompt Summary: PA2 functional baseline — idempotent seed that loads mock-data/*.json into the database
// AI Contribution: ~100% (generated)
// Human Modifications: none yet
// Verification: pending human review
// Confidence: pending
//
// Run with `npx prisma db seed` (or `npm run db:seed`). Records are created only when their
// id does not exist yet, so re-running never duplicates data or resets live inventory.
// Ticket dates are stored as offsets ("daysAgo") and resolved against the time of seeding.

import { readFileSync } from 'node:fs';
import { Prisma } from '../src/generated/prisma/client.js';
import {
  AllocationStatus,
  type AssetCategory,
  type PersonRole,
  type TicketPriority,
  TicketStatus,
} from '../src/generated/prisma/enums.js';
import { kindOf } from '../src/lib/assetKinds.js';
import { prisma } from '../src/lib/prisma.js';
import { refreshAssetStatuses } from '../src/repositories/assetRepository.js';

type PersonSeed = { id: string; name: string; email: string; role: PersonRole };
type CourseSeed = { id: string; code: string; title: string; section: string; term: string; department: string; instructorId: string };
type LabSeed = { id: string; name: string; department: string; facultyAdvisorId: string };
type AssetSeed = {
  id: string;
  name: string;
  category: AssetCategory;
  description?: string;
  department: string;
  totalStock: number;
  checkoutPeriodDays?: number;
  creditTotal?: number;
};
type Step = { byId: string; daysAgo: number; note?: string; rejectionReason?: string };
type TicketSeed = {
  id: string;
  title: string;
  description?: string;
  projectName?: string;
  priority: TicketPriority;
  status: TicketStatus;
  requesterId: string;
  courseId?: string;
  labId?: string;
  createdDaysAgo: number;
  review?: Step;
  allocation?: Step;
  closed?: Step;
  items: {
    id: string;
    assetId: string;
    quantity: number;
    creditAmount?: number;
    loanDays?: number;
    justification?: string;
    allocation?: { id: string; token: string; returnedDaysAgo?: number };
  }[];
};

const load = <T>(file: string): T => JSON.parse(readFileSync(new URL(`../mock-data/${file}`, import.meta.url), 'utf8')) as T;
const DAY_MS = 86_400_000;
const daysAgo = (n: number, now: Date) => new Date(now.getTime() - n * DAY_MS);
const money = (n: number | undefined) => (n === undefined ? null : new Prisma.Decimal(n.toFixed(2)));

async function seed() {
  const people = load<PersonSeed[]>('people.json');
  const courses = load<CourseSeed[]>('courses.json');
  const labs = load<LabSeed[]>('labs.json');
  const assets = load<AssetSeed[]>('assets.json');
  const tickets = load<TicketSeed[]>('tickets.json');
  const now = new Date();
  const counts = { people: 0, courses: 0, labs: 0, assets: 0, tickets: 0, allocations: 0 };

  await prisma.$transaction(async (tx) => {
    for (const p of people) {
      if (await tx.person.findUnique({ where: { id: p.id } })) continue;
      await tx.person.create({ data: p });
      counts.people++;
    }
    for (const c of courses) {
      if (await tx.course.findUnique({ where: { id: c.id } })) continue;
      await tx.course.create({ data: c });
      counts.courses++;
    }
    for (const l of labs) {
      if (await tx.researchLab.findUnique({ where: { id: l.id } })) continue;
      await tx.researchLab.create({ data: l });
      counts.labs++;
    }
    for (const a of assets) {
      if (await tx.asset.findUnique({ where: { id: a.id } })) continue;
      const kind = kindOf(a.category);
      await tx.asset.create({
        data: {
          id: a.id,
          name: a.name,
          category: a.category,
          description: a.description ?? null,
          department: a.department,
          totalStock: a.totalStock,
          availableStock: a.totalStock,
          checkoutPeriodDays: kind === 'physical' ? (a.checkoutPeriodDays ?? 14) : null,
          creditTotal: kind === 'voucher' ? money(a.creditTotal) : null,
          creditBalance: kind === 'voucher' ? money(a.creditTotal) : null,
        },
      });
      counts.assets++;
    }

    for (const t of tickets) {
      if (await tx.ticket.findUnique({ where: { id: t.id } })) continue;
      const rejected = Boolean(t.review?.rejectionReason);
      await tx.ticket.create({
        data: {
          id: t.id,
          title: t.title,
          description: t.description ?? null,
          projectName: t.projectName ?? null,
          priority: t.priority,
          status: t.status,
          requesterId: t.requesterId,
          courseId: t.courseId ?? null,
          labId: t.labId ?? null,
          reviewedById: t.review?.byId ?? null,
          reviewedAt: t.review ? daysAgo(t.review.daysAgo, now) : null,
          rejectionReason: t.review?.rejectionReason ?? null,
          allocatedById: t.allocation?.byId ?? null,
          allocatedAt: t.allocation ? daysAgo(t.allocation.daysAgo, now) : null,
          closedAt: t.closed ? daysAgo(t.closed.daysAgo, now) : null,
          createdAt: daysAgo(t.createdDaysAgo, now),
          items: {
            create: t.items.map((i) => ({
              id: i.id,
              assetId: i.assetId,
              quantity: i.quantity,
              creditAmount: money(i.creditAmount),
              loanDays: i.loanDays ?? null,
              justification: i.justification ?? null,
            })),
          },
        },
      });

      // Event log mirroring the lifecycle the ticket went through.
      const events: Prisma.TicketEventCreateManyInput[] = [
        { ticketId: t.id, fromStatus: null, toStatus: TicketStatus.pending, actorId: t.requesterId, note: 'submitted', createdAt: daysAgo(t.createdDaysAgo, now) },
      ];
      let from: TicketStatus = TicketStatus.pending;
      if (t.review) {
        const to = rejected ? TicketStatus.rejected : TicketStatus.approved;
        events.push({ ticketId: t.id, fromStatus: from, toStatus: to, actorId: t.review.byId, note: t.review.rejectionReason ?? t.review.note ?? null, createdAt: daysAgo(t.review.daysAgo, now) });
        from = to;
      }
      if (t.allocation) {
        events.push({ ticketId: t.id, fromStatus: from, toStatus: TicketStatus.allocated, actorId: t.allocation.byId, note: t.allocation.note ?? null, createdAt: daysAgo(t.allocation.daysAgo, now) });
        from = TicketStatus.allocated;
      }
      if (t.closed) {
        events.push({ ticketId: t.id, fromStatus: from, toStatus: TicketStatus.closed, actorId: t.closed.byId, note: t.closed.note ?? null, createdAt: daysAgo(t.closed.daysAgo, now) });
      }
      await tx.ticketEvent.createMany({ data: events });

      // Allocations: deduct the pool exactly as the allocation engine would.
      if (t.allocation) {
        const allocatedAt = daysAgo(t.allocation.daysAgo, now);
        for (const item of t.items) {
          if (!item.allocation) continue;
          const asset = await tx.asset.findUniqueOrThrow({ where: { id: item.assetId } });
          const kind = kindOf(asset.category);
          const returned = item.allocation.returnedDaysAgo !== undefined;
          const loanDays = item.loanDays ?? asset.checkoutPeriodDays ?? 14;
          const dueAt = kind === 'physical' ? new Date(allocatedAt.getTime() + loanDays * DAY_MS) : null;
          let status: AllocationStatus = AllocationStatus.issued;
          if (kind === 'physical') {
            if (returned) status = AllocationStatus.returned;
            else status = dueAt! < now ? AllocationStatus.overdue : AllocationStatus.checkedout;
          }

          await tx.allocation.create({
            data: {
              id: item.allocation.id,
              ticketId: t.id,
              ticketItemId: item.id,
              assetId: item.assetId,
              courseId: t.courseId ?? null,
              labId: t.labId ?? null,
              quantity: item.quantity,
              creditAmount: kind === 'voucher' ? money(item.creditAmount) : null,
              token: item.allocation.token,
              status,
              allocatedById: t.allocation.byId,
              allocatedAt,
              dueAt,
              returnedAt: returned ? daysAgo(item.allocation.returnedDaysAgo!, now) : null,
              returnedById: returned ? t.allocation.byId : null,
            },
          });
          await tx.asset.update({
            where: { id: item.assetId },
            data: {
              availableStock: { decrement: returned ? 0 : item.quantity },
              ...(kind === 'voucher' ? { creditBalance: { decrement: money(item.creditAmount)! } } : {}),
            },
          });
          counts.allocations++;
        }
      }
      counts.tickets++;
    }

    await refreshAssetStatuses(tx);
  }, { timeout: 60_000 });

  console.log(`Seed complete: ${JSON.stringify(counts)} new records`);
}

try {
  await seed();
} finally {
  await prisma.$disconnect();
}
