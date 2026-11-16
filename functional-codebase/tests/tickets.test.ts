// Stack: TypeScript / Node 24 / Express 5 / Prisma 7 / PostgreSQL
// Tool: Claude Code (claude-opus-5-5)
// Prompt Summary: PA2 functional baseline — integration tests for help desk ticket submission, listing, review and deletion
// AI Contribution: ~100% (generated)
// Human Modifications: none yet
// Verification: pending human review
// Confidence: pending

import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { createFixtures, type Fixtures } from './helpers/fixtures.js';

const app = createApp();
const TICKETS = '/api/v1/assets/tickets';
let fx: Fixtures;

beforeAll(async () => {
  fx = await createFixtures('tickets');
});

afterAll(async () => {
  await fx?.cleanup();
});

function courseTicket(overrides: Record<string, unknown> = {}) {
  return {
    title: 'Laptops and seats for lab week',
    projectName: `Alpha ${fx.tag}`,
    priority: 'high',
    requesterId: fx.instructor.id,
    courseId: fx.course.id,
    items: [
      { assetId: fx.laptop.id, quantity: 2, loanDays: 7, justification: 'pair programming' },
      { assetId: fx.license.id, quantity: 3 },
    ],
    ...overrides,
  };
}

function labTicket(overrides: Record<string, unknown> = {}) {
  return {
    title: 'Cloud credit for experiments',
    projectName: `Beta ${fx.tag}`,
    requesterId: fx.advisor.id,
    labId: fx.lab.id,
    items: [{ assetId: fx.voucher.id, quantity: 1, creditAmount: 150.25 }],
    ...overrides,
  };
}

describe('POST /api/v1/assets/tickets', () => {
  it('accepts a multi-item request from the course instructor as pending', async () => {
    const res = await request(app).post(TICKETS).send(courseTicket());

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      status: 'pending',
      priority: 'high',
      requesterId: fx.instructor.id,
      courseId: fx.course.id,
      labId: null,
      group: { type: 'course', id: fx.course.id },
      metrics: { itemCount: 2, unitsRequested: 5, unitsAllocated: 0, eventCount: 1 },
    });
    expect(res.body.items).toHaveLength(2);
    expect(res.body.events[0]).toMatchObject({ fromStatus: null, toStatus: 'pending' });
  });

  it('accepts a voucher request from the lab faculty advisor', async () => {
    const res = await request(app).post(TICKETS).send(labTicket());

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ labId: fx.lab.id, group: { type: 'lab', name: fx.lab.name } });
    expect(res.body.items[0].creditAmount).toBe(150.25);
    expect(res.body.metrics.creditRequested).toBe(150.25);
  });

  it('refuses requests from someone who is not the group instructor or advisor', async () => {
    const res = await request(app).post(TICKETS).send(courseTicket({ requesterId: fx.otherInstructor.id }));
    expect(res.status).toBe(403);
  });

  it('validates items against the asset kind', async () => {
    const res = await request(app)
      .post(TICKETS)
      .send(labTicket({ items: [{ assetId: fx.voucher.id, quantity: 1 }, { assetId: fx.license.id, loanDays: 3 }] }));
    expect(res.status).toBe(400);
    expect(res.body.error.details).toHaveLength(2);
  });

  it('requires exactly one of courseId or labId', async () => {
    const res = await request(app).post(TICKETS).send(courseTicket({ labId: fx.lab.id }));
    expect(res.status).toBe(400);
  });
});

describe('GET /api/v1/assets/tickets', () => {
  it('lists active requests filtered by course, section, project and category', async () => {
    const byCourse = await request(app).get(TICKETS).query({ courseId: fx.course.id });
    expect(byCourse.status).toBe(200);
    expect(byCourse.body.total).toBe(1);

    const bySection = await request(app).get(TICKETS).query({ courseCode: fx.course.code, section: 'z9' });
    expect(bySection.body.total).toBe(1);

    const byProject = await request(app).get(TICKETS).query({ project: `beta ${fx.tag}` });
    expect(byProject.body.total).toBe(1);
    expect(byProject.body.data[0].labId).toBe(fx.lab.id);

    const byCategory = await request(app).get(TICKETS).query({ category: 'cloud_voucher', labId: fx.lab.id });
    expect(byCategory.body.total).toBe(1);
    expect(byCategory.body.metrics.byStatus).toEqual({ pending: 1 });
  });

  it('filters by status and by asset category together', async () => {
    const res = await request(app)
      .get(TICKETS)
      .query({ status: 'pending,approved', category: 'laptop', courseId: fx.course.id });
    expect(res.body.total).toBe(1);

    const none = await request(app).get(TICKETS).query({ status: 'allocated', courseId: fx.course.id });
    expect(none.body.total).toBe(0);
  });
});

describe('GET /api/v1/assets/tickets/:ticket_id', () => {
  it('returns the ticket with items, event log and metrics', async () => {
    const created = await request(app).post(TICKETS).send(labTicket({ title: 'Metrics probe' }));
    const res = await request(app).get(`${TICKETS}/${created.body.id}`);

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ id: created.body.id, title: 'Metrics probe', allocations: [] });
    expect(res.body.metrics).toMatchObject({
      itemCount: 1,
      unitsRequested: 1,
      creditRequested: 150.25,
      hoursToReview: null,
      hoursToAllocation: null,
    });
    expect(res.body.metrics.hoursOpen).toBeGreaterThanOrEqual(0);
  });

  it('returns 404 for an unknown ticket', async () => {
    const res = await request(app).get(`${TICKETS}/00000000-0000-4000-8000-000000000000`);
    expect(res.status).toBe(404);
  });
});

describe('PUT /api/v1/assets/tickets/:ticket_id', () => {
  it('edits the contents of a pending ticket', async () => {
    const created = await request(app).post(TICKETS).send(courseTicket());
    const res = await request(app)
      .put(`${TICKETS}/${created.body.id}`)
      .send({ title: 'Edited', priority: 'urgent', items: [{ assetId: fx.iot.id, quantity: 1 }] });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ title: 'Edited', priority: 'urgent', status: 'pending' });
    expect(res.body.items).toHaveLength(1);
    expect(res.body.items[0].assetId).toBe(fx.iot.id);
  });

  it('approves only with IT director sign-off and does not touch inventory', async () => {
    const created = await request(app).post(TICKETS).send(courseTicket());
    const url = `${TICKETS}/${created.body.id}`;

    const byAdmin = await request(app).put(url).send({ status: 'approved', actorId: fx.admin.id });
    expect(byAdmin.status).toBe(403);

    const approved = await request(app).put(url).send({ status: 'approved', actorId: fx.itDirector.id, note: 'ok' });
    expect(approved.status).toBe(200);
    expect(approved.body).toMatchObject({ status: 'approved', reviewedById: fx.itDirector.id });
    expect(approved.body.metrics.hoursToReview).toBeGreaterThanOrEqual(0);

    const laptop = await request(app).get(`/api/v1/assets/${fx.laptop.id}`);
    expect(laptop.body).toMatchObject({ availableStock: 5, status: 'reserved' });

    // Approved tickets can no longer be edited, and PUT cannot allocate.
    expect((await request(app).put(url).send({ title: 'too late' })).status).toBe(409);
    expect((await request(app).put(url).send({ status: 'allocated', actorId: fx.admin.id })).status).toBe(409);
  });

  it('rejects with a reason and then closes the ticket', async () => {
    const created = await request(app).post(TICKETS).send(labTicket());
    const url = `${TICKETS}/${created.body.id}`;

    expect((await request(app).put(url).send({ status: 'rejected', actorId: fx.itDirector.id })).status).toBe(400);

    const rejected = await request(app)
      .put(url)
      .send({ status: 'rejected', actorId: fx.itDirector.id, rejectionReason: 'Budget exhausted' });
    expect(rejected.status).toBe(200);
    expect(rejected.body).toMatchObject({ status: 'rejected', rejectionReason: 'Budget exhausted' });

    const closed = await request(app).put(url).send({ status: 'closed', actorId: fx.advisor.id });
    expect(closed.status).toBe(200);
    expect(closed.body.status).toBe('closed');
    expect(closed.body.closedAt).not.toBeNull();
    expect(closed.body.events.map((e: { toStatus: string }) => e.toStatus)).toEqual(['pending', 'rejected', 'closed']);
  });

  it('refuses transitions that skip the lifecycle', async () => {
    const created = await request(app).post(TICKETS).send(labTicket());
    const res = await request(app).put(`${TICKETS}/${created.body.id}`).send({ status: 'closed', actorId: fx.admin.id });
    expect(res.status).toBe(409);
  });
});

describe('DELETE /api/v1/assets/tickets/:ticket_id', () => {
  it('deletes a pending request', async () => {
    const created = await request(app).post(TICKETS).send(labTicket());
    const url = `${TICKETS}/${created.body.id}`;

    expect((await request(app).delete(url)).status).toBe(204);
    expect((await request(app).get(url)).status).toBe(404);
  });

  it('refuses to delete a reviewed request', async () => {
    const created = await request(app).post(TICKETS).send(labTicket());
    const url = `${TICKETS}/${created.body.id}`;
    await request(app).put(url).send({ status: 'approved', actorId: fx.itDirector.id });

    expect((await request(app).delete(url)).status).toBe(409);
  });
});
