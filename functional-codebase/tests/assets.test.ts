// Stack: TypeScript / Node 24 / Express 5 / Prisma 7 / PostgreSQL
// Tool: Claude Code (claude-opus-5-5)
// Prompt Summary: PA2 functional baseline — integration tests for asset CRUD and multi-field search
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
let fx: Fixtures;

beforeAll(async () => {
  fx = await createFixtures('assets');
});

afterAll(async () => {
  await fx?.cleanup();
});

describe('POST /api/v1/assets', () => {
  it('creates a physical asset with full availability and a default loan period', async () => {
    const res = await request(app)
      .post('/api/v1/assets')
      .send({ name: `Arduino Kit ${fx.tag}`, category: 'iot_node', department: fx.department, totalStock: 12 });

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      name: `Arduino Kit ${fx.tag}`,
      category: 'iot_node',
      kind: 'physical',
      department: fx.department,
      status: 'available',
      totalStock: 12,
      availableStock: 12,
      checkoutPeriodDays: 14,
      creditTotal: null,
      metrics: { allocatedUnits: 0, utilizationPct: 0 },
    });
    expect(res.body.id).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('creates a software license pool', async () => {
    const res = await request(app)
      .post('/api/v1/assets')
      .send({ name: `Figma Seats ${fx.tag}`, category: 'software_license', department: fx.department, totalStock: 30 });

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ kind: 'license', availableStock: 30, checkoutPeriodDays: null });
  });

  it('creates a cloud voucher pool with a credit balance', async () => {
    const res = await request(app).post('/api/v1/assets').send({
      name: `OCI Credits ${fx.tag}`,
      category: 'cloud_voucher',
      department: fx.department,
      totalStock: 10,
      creditTotal: 2500.5,
    });

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ kind: 'voucher', creditTotal: 2500.5, creditBalance: 2500.5 });
    expect(res.body.metrics.creditUsed).toBe(0);
  });

  it('rejects a voucher without creditTotal and unknown fields', async () => {
    const missing = await request(app)
      .post('/api/v1/assets')
      .send({ name: 'x', category: 'cloud_voucher', department: fx.department, totalStock: 1 });
    expect(missing.status).toBe(400);

    const extra = await request(app)
      .post('/api/v1/assets')
      .send({ name: 'x', category: 'laptop', department: fx.department, totalStock: 1, availableStock: 99 });
    expect(extra.status).toBe(400);
  });
});

describe('GET /api/v1/assets', () => {
  it('filters by department and category', async () => {
    const res = await request(app).get('/api/v1/assets').query({ department: fx.department, category: 'laptop' });

    expect(res.status).toBe(200);
    expect(res.body.total).toBe(1);
    expect(res.body.data[0].id).toBe(fx.laptop.id);
  });

  it('filters by several categories, kind, availability state and text search together', async () => {
    const multi = await request(app)
      .get('/api/v1/assets')
      .query({ department: fx.department, category: 'laptop,software_license' });
    expect(multi.body.data.map((a: { category: string }) => a.category).sort()).toEqual([
      'laptop',
      'software_license',
      'software_license',
    ]);

    const vouchers = await request(app).get('/api/v1/assets').query({ department: fx.department, kind: 'voucher' });
    expect(vouchers.body.data.every((a: { kind: string }) => a.kind === 'voucher')).toBe(true);
    expect(vouchers.body.total).toBe(2);

    const available = await request(app)
      .get('/api/v1/assets')
      .query({ department: fx.department, status: 'available', available: 'true', q: 'IoT Node' });
    expect(available.body.total).toBe(1);
    expect(available.body.data[0].id).toBe(fx.iot.id);
  });

  it('paginates', async () => {
    const res = await request(app).get('/api/v1/assets').query({ department: fx.department, limit: 2, offset: 0 });
    expect(res.body.data).toHaveLength(2);
    expect(res.body.total).toBeGreaterThan(2);
    expect(res.body).toMatchObject({ limit: 2, offset: 0 });
  });

  it('rejects an unknown filter value', async () => {
    const res = await request(app).get('/api/v1/assets').query({ status: 'lost' });
    expect(res.status).toBe(400);
  });
});

describe('GET /api/v1/assets/:asset_id', () => {
  it('returns one asset with availability metrics', async () => {
    const res = await request(app).get(`/api/v1/assets/${fx.voucher.id}`);

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      id: fx.voucher.id,
      kind: 'voucher',
      totalStock: 5,
      availableStock: 5,
      creditBalance: 1000,
    });
  });

  it('returns 404 for an unknown id and 400 for a malformed one', async () => {
    expect((await request(app).get('/api/v1/assets/00000000-0000-4000-8000-000000000000')).status).toBe(404);
    expect((await request(app).get('/api/v1/assets/not-a-uuid')).status).toBe(400);
  });
});

describe('PUT /api/v1/assets/:asset_id', () => {
  it('updates descriptive fields and resizes the pool', async () => {
    const res = await request(app)
      .put(`/api/v1/assets/${fx.iot.id}`)
      .send({ name: `IoT Node v2 ${fx.tag}`, totalStock: 6, checkoutPeriodDays: 21 });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ name: `IoT Node v2 ${fx.tag}`, totalStock: 6, availableStock: 6, checkoutPeriodDays: 21 });

    const back = await request(app).put(`/api/v1/assets/${fx.iot.id}`).send({ totalStock: 4 });
    expect(back.body).toMatchObject({ totalStock: 4, availableStock: 4 });
  });

  it('tops up voucher credit', async () => {
    const res = await request(app).put(`/api/v1/assets/${fx.voucher.id}`).send({ creditTotal: 1200 });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ creditTotal: 1200, creditBalance: 1200 });
  });

  it('refuses to change the category', async () => {
    const res = await request(app).put(`/api/v1/assets/${fx.laptop.id}`).send({ category: 'hardware' });
    expect(res.status).toBe(400);
  });
});

describe('DELETE /api/v1/assets/:asset_id', () => {
  it('retires an unused asset so it no longer appears', async () => {
    const created = await request(app)
      .post('/api/v1/assets')
      .send({ name: `Temp ${fx.tag}`, category: 'hardware', department: fx.department, totalStock: 1 });

    const del = await request(app).delete(`/api/v1/assets/${created.body.id}`);
    expect(del.status).toBe(204);

    expect((await request(app).get(`/api/v1/assets/${created.body.id}`)).status).toBe(404);
    const list = await request(app).get('/api/v1/assets').query({ department: fx.department, q: 'Temp' });
    expect(list.body.total).toBe(0);
    // History is kept: the row still exists with a retirement timestamp.
    const row = await prisma.asset.findUnique({ where: { id: created.body.id } });
    expect(row?.retiredAt).toBeInstanceOf(Date);
  });
});
