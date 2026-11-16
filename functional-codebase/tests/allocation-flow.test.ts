// Stack: TypeScript / Node 24 / Express 5 / Prisma 7 / PostgreSQL
// Tool: Claude Code (claude-opus-5-5)
// Prompt Summary: PA2 functional baseline — integration tests for the full ticket flow, allocation engine, allocation listing and device returns
// AI Contribution: ~100% (generated)
// Human Modifications: none yet
// Verification: pending human review
// Confidence: pending

import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { prisma } from '../src/lib/prisma.js';
import { createFixtures, type Fixtures } from './helpers/fixtures.js';

const app = createApp();
const TICKETS = '/api/v1/assets/tickets';
let fx: Fixtures;

beforeAll(async () => {
  fx = await createFixtures('flow');
});

afterAll(async () => {
  await fx?.cleanup();
});

const getAsset = async (id: string) => (await request(app).get(`/api/v1/assets/${id}`)).body;

async function approvedTicket(body: Record<string, unknown>) {
  const created = await request(app).post(TICKETS).send(body);
  expect(created.status).toBe(201);
  const approved = await request(app)
    .put(`${TICKETS}/${created.body.id}`)
    .send({ status: 'approved', actorId: fx.itDirector.id });
  expect(approved.status).toBe(200);
  return created.body.id as string;
}

describe('full ticket flow: pending -> approved -> allocated -> closed', () => {
  let ticketId: string;
  let laptopAllocationId: string;

  it('submits a multi-kind request (pending)', async () => {
    const res = await request(app)
      .post(TICKETS)
      .send({
        title: 'Semester project kit',
        projectName: `Flow ${fx.tag}`,
        requesterId: fx.instructor.id,
        courseId: fx.course.id,
        items: [
          { assetId: fx.laptop.id, quantity: 2, loanDays: 7 },
          { assetId: fx.license.id, quantity: 3 },
          { assetId: fx.voucher.id, quantity: 1, creditAmount: 250 },
        ],
      });
    expect(res.status).toBe(201);
    expect(res.body.status).toBe('pending');
    ticketId = res.body.id;
  });

  it('IT director approves (approved) without changing inventory', async () => {
    const res = await request(app)
      .put(`${TICKETS}/${ticketId}`)
      .send({ status: 'approved', actorId: fx.itDirector.id, note: 'Approved for the semester' });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('approved');

    expect(await getAsset(fx.laptop.id)).toMatchObject({ availableStock: 5, status: 'reserved' });
    expect(await getAsset(fx.voucher.id)).toMatchObject({ availableStock: 5, creditBalance: 1000 });
  });

  it('only an administrator can execute the allocation', async () => {
    const res = await request(app).post(`${TICKETS}/${ticketId}/allocate`).send({ actorId: fx.itDirector.id });
    expect(res.status).toBe(403);
  });

  it('administrator executes the allocation (allocated): stock deducted, keys and tokens issued', async () => {
    const res = await request(app)
      .post(`${TICKETS}/${ticketId}/allocate`)
      .send({ actorId: fx.admin.id, note: 'Picked up at the IT desk' });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ status: 'allocated', allocatedById: fx.admin.id });
    expect(res.body.allocations).toHaveLength(3);
    expect(res.body.metrics).toMatchObject({ unitsAllocated: 6, creditAllocated: 250, outstandingPhysicalUnits: 2 });

    const byKind = Object.fromEntries(
      res.body.allocations.map((a: { kind: string }) => [a.kind, a]),
    ) as Record<string, { id: string; token: string; status: string; dueAt: string | null; tracking: unknown }>;
    expect(byKind.physical.token).toMatch(/^HW-[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}$/);
    expect(byKind.physical.status).toBe('checkedout');
    expect(byKind.physical.dueAt).not.toBeNull();
    expect(byKind.physical.tracking).toMatchObject({ isOverdue: false });
    expect(byKind.license.token).toMatch(/^LIC-([A-Z2-9]{5}-){4}[A-Z2-9]{5}$/);
    expect(byKind.license.status).toBe('issued');
    expect(byKind.voucher.token).toMatch(/^VCH-([A-Z2-9]{4}-){3}[A-Z2-9]{4}$/);
    laptopAllocationId = byKind.physical.id;

    expect(await getAsset(fx.laptop.id)).toMatchObject({ availableStock: 3, status: 'available' });
    expect(await getAsset(fx.license.id)).toMatchObject({ availableStock: 7 });
    expect(await getAsset(fx.voucher.id)).toMatchObject({ availableStock: 4, creditBalance: 750, metrics: { creditUsed: 250 } });
  });

  it('cannot allocate the same ticket twice', async () => {
    const res = await request(app).post(`${TICKETS}/${ticketId}/allocate`).send({ actorId: fx.admin.id });
    expect(res.status).toBe(409);
    expect(await getAsset(fx.laptop.id)).toMatchObject({ availableStock: 3 });
  });

  it('lists the active allocations and metrics for the course', async () => {
    const res = await request(app).get('/api/v1/assets/allocations').query({ courseId: fx.course.id });

    expect(res.status).toBe(200);
    expect(res.body.group).toMatchObject({ type: 'course', id: fx.course.id });
    expect(res.body.total).toBe(3);
    expect(res.body.metrics).toMatchObject({
      activeAllocations: 3,
      checkedOutUnits: 2,
      overdueUnits: 0,
      licenseKeysIssued: 1,
      licenseSeatsIssued: 3,
      voucherCodesIssued: 1,
      voucherCreditIssued: 250,
    });

    const licenses = await request(app)
      .get('/api/v1/assets/allocations')
      .query({ courseId: fx.course.id, category: 'software_license' });
    expect(licenses.body.data).toHaveLength(1);
    expect(licenses.body.data[0].token).toMatch(/^LIC-/);
  });

  it('shows the course in the asset catalog filter', async () => {
    const res = await request(app).get('/api/v1/assets').query({ courseId: fx.course.id });
    expect(res.body.data.map((a: { id: string }) => a.id).sort()).toEqual(
      [fx.laptop.id, fx.license.id, fx.voucher.id].sort(),
    );
  });

  it('refuses to shrink the pool below the allocated units', async () => {
    const res = await request(app).put(`/api/v1/assets/${fx.laptop.id}`).send({ totalStock: 1 });
    expect(res.status).toBe(409);
  });

  it('refuses to close while devices are still checked out', async () => {
    const res = await request(app).put(`${TICKETS}/${ticketId}`).send({ status: 'closed', actorId: fx.admin.id });
    expect(res.status).toBe(409);
    expect(res.body.error.details.outstandingAllocationIds).toEqual([laptopAllocationId]);
  });

  it('processes the physical device return', async () => {
    const res = await request(app)
      .post(`/api/v1/assets/${fx.laptop.id}/return`)
      .send({ allocationId: laptopAllocationId, actorId: fx.admin.id, note: 'Both units intact' });

    expect(res.status).toBe(200);
    expect(res.body.allocation).toMatchObject({
      id: laptopAllocationId,
      status: 'returned',
      returnedById: fx.admin.id,
      returnNote: 'Both units intact',
    });
    expect(res.body.allocation.returnedAt).not.toBeNull();
    expect(res.body.allocation.tracking).toMatchObject({ returnedLate: false });
    expect(res.body.allocation.tracking.checkoutDurationHours).toBeGreaterThanOrEqual(0);
    expect(res.body.asset).toMatchObject({ id: fx.laptop.id, availableStock: 5, status: 'available' });

    const again = await request(app)
      .post(`/api/v1/assets/${fx.laptop.id}/return`)
      .send({ allocationId: laptopAllocationId, actorId: fx.admin.id });
    expect(again.status).toBe(409);
  });

  it('closes the ticket (closed) with the full event log and metrics', async () => {
    const res = await request(app).put(`${TICKETS}/${ticketId}`).send({ status: 'closed', actorId: fx.admin.id });

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('closed');
    expect(res.body.events.map((e: { toStatus: string }) => e.toStatus)).toEqual([
      'pending',
      'approved',
      'allocated',
      'closed',
    ]);
    expect(res.body.metrics).toMatchObject({ outstandingPhysicalUnits: 0, unitsReturned: 2, eventCount: 4 });

    const active = await request(app).get('/api/v1/assets/allocations').query({ courseId: fx.course.id });
    expect(active.body.metrics.checkedOutUnits).toBe(0);
    const all = await request(app).get('/api/v1/assets/allocations').query({ courseId: fx.course.id, status: 'all' });
    expect(all.body.metrics.returnedUnits).toBe(2);
  });
});

describe('allocation engine guarantees', () => {
  it('allocates all-or-nothing when a pool runs short', async () => {
    const first = await approvedTicket({
      title: 'first',
      requesterId: fx.advisor.id,
      labId: fx.lab.id,
      items: [{ assetId: fx.iot.id, quantity: 3 }],
    });
    const second = await approvedTicket({
      title: 'second',
      requesterId: fx.advisor.id,
      labId: fx.lab.id,
      items: [
        { assetId: fx.license.id, quantity: 2 },
        { assetId: fx.iot.id, quantity: 3 },
      ],
    });
    const licenseBefore = (await getAsset(fx.license.id)).availableStock;

    expect((await request(app).post(`${TICKETS}/${first}/allocate`).send({ actorId: fx.admin.id })).status).toBe(200);
    const short = await request(app).post(`${TICKETS}/${second}/allocate`).send({ actorId: fx.admin.id });

    expect(short.status).toBe(409);
    expect(short.body.error.details).toMatchObject({ assetId: fx.iot.id, requestedUnits: 3, availableStock: 1 });
    // The license line of the failed ticket was rolled back and the ticket is still approved.
    expect((await getAsset(fx.license.id)).availableStock).toBe(licenseBefore);
    expect((await request(app).get(`${TICKETS}/${second}`)).body.status).toBe('approved');
  });

  it('never lets voucher credit drop below zero', async () => {
    const a = await approvedTicket({
      title: 'credit a',
      requesterId: fx.advisor.id,
      labId: fx.lab.id,
      items: [{ assetId: fx.voucher.id, quantity: 1, creditAmount: 600 }],
    });
    const b = await approvedTicket({
      title: 'credit b',
      requesterId: fx.advisor.id,
      labId: fx.lab.id,
      items: [{ assetId: fx.voucher.id, quantity: 1, creditAmount: 600 }],
    });

    expect((await request(app).post(`${TICKETS}/${a}/allocate`).send({ actorId: fx.admin.id })).status).toBe(200);
    const res = await request(app).post(`${TICKETS}/${b}/allocate`).send({ actorId: fx.admin.id });
    expect(res.status).toBe(409);
    expect((await getAsset(fx.voucher.id)).creditBalance).toBe(150);
  });

  it('lets only one of two concurrent allocate commands win', async () => {
    const id = await approvedTicket({
      title: 'race',
      requesterId: fx.advisor.id,
      labId: fx.lab.id,
      items: [{ assetId: fx.license.id, quantity: 1 }],
    });
    const before = (await getAsset(fx.license.id)).availableStock;

    const results = await Promise.all([
      request(app).post(`${TICKETS}/${id}/allocate`).send({ actorId: fx.admin.id }),
      request(app).post(`${TICKETS}/${id}/allocate`).send({ actorId: fx.admin.id }),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
    expect((await getAsset(fx.license.id)).availableStock).toBe(before - 1);
  });

  it('refuses to allocate a ticket that is not approved', async () => {
    const created = await request(app)
      .post(TICKETS)
      .send({ title: 'pending', requesterId: fx.advisor.id, labId: fx.lab.id, items: [{ assetId: fx.license.id }] });
    const res = await request(app).post(`${TICKETS}/${created.body.id}/allocate`).send({ actorId: fx.admin.id });
    expect(res.status).toBe(409);
  });
});

describe('overdue tracking and returns', () => {
  it('flags an overdue check-out and records a late return', async () => {
    const id = await approvedTicket({
      title: 'overdue',
      requesterId: fx.advisor.id,
      labId: fx.lab.id,
      items: [{ assetId: fx.laptop.id, quantity: 1, loanDays: 1 }],
    });
    const allocated = await request(app).post(`${TICKETS}/${id}/allocate`).send({ actorId: fx.admin.id });
    const allocationId = allocated.body.allocations[0].id as string;

    // Move the check-out three days into the past so its 1-day loan has expired.
    const threeDaysAgo = new Date(Date.now() - 3 * 86_400_000);
    await prisma.allocation.update({
      where: { id: allocationId },
      data: { allocatedAt: threeDaysAgo, dueAt: new Date(threeDaysAgo.getTime() + 86_400_000) },
    });

    const list = await request(app).get('/api/v1/assets/allocations').query({ labId: fx.lab.id, category: 'laptop' });
    expect(list.body.data[0]).toMatchObject({ id: allocationId, status: 'overdue', tracking: { isOverdue: true } });
    expect(list.body.data[0].tracking.overdueByHours).toBeGreaterThan(47);
    expect(list.body.metrics.overdueUnits).toBe(1);
    expect(await getAsset(fx.laptop.id)).toMatchObject({ status: 'overdue', metrics: { overdueAllocations: 1 } });

    const ret = await request(app)
      .post(`/api/v1/assets/${fx.laptop.id}/return`)
      .send({ allocationId, actorId: fx.itDirector.id });
    expect(ret.status).toBe(200);
    expect(ret.body.allocation.tracking).toMatchObject({ returnedLate: true });
    expect(ret.body.allocation.tracking.checkoutDurationHours).toBeGreaterThan(71);
    expect(ret.body.asset.status).toBe('available');
  });

  it('only physical assets can be returned', async () => {
    const res = await request(app)
      .post(`/api/v1/assets/${fx.license.id}/return`)
      .send({ allocationId: '00000000-0000-4000-8000-000000000000', actorId: fx.admin.id });
    expect(res.status).toBe(400);
  });

  it('refuses to retire an asset that has devices checked out', async () => {
    const id = await approvedTicket({
      title: 'retire guard',
      requesterId: fx.advisor.id,
      labId: fx.lab.id,
      items: [{ assetId: fx.laptop.id, quantity: 1 }],
    });
    await request(app).post(`${TICKETS}/${id}/allocate`).send({ actorId: fx.admin.id });

    const res = await request(app).delete(`/api/v1/assets/${fx.laptop.id}`);
    expect(res.status).toBe(409);
    expect(res.body.error.details).toMatchObject({ outstandingCheckouts: 1 });
  });
});
