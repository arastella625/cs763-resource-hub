// Stack: TypeScript / Node 24 / Express 5 / Prisma 7 / PostgreSQL
// Tool: Claude Code (claude-opus-5-5)
// Prompt Summary: PA2 functional baseline — asset inventory lifecycle: CRUD, overdue sweep and physical device returns
// AI Contribution: ~100% (generated)
// Human Modifications: none yet
// Verification: pending human review
// Confidence: pending

import { Prisma } from '../generated/prisma/client.js';
import { AllocationStatus, PersonRole, TicketStatus } from '../generated/prisma/enums.js';
import { DEFAULT_CHECKOUT_PERIOD_DAYS, kindOf } from '../lib/assetKinds.js';
import { badRequest, conflict, notFound } from '../lib/errors.js';
import { logger } from '../lib/logger.js';
import { prisma } from '../lib/prisma.js';
import {
  allocationStatsByAsset,
  buildAssetWhere,
  findActiveAsset,
  findAssets,
  markOverdueAllocations,
  refreshAssetStatuses,
  restoreStock,
} from '../repositories/assetRepository.js';
import { allocationInclude } from '../repositories/allocationRepository.js';
import type { AssetQuery, CreateAssetInput, ReturnAssetInput, UpdateAssetInput } from '../validation/schemas.js';
import { requireActor } from './actors.js';
import { serializeAllocation, serializeAsset } from './serializers.js';

const decimal = (n: number) => new Prisma.Decimal(n.toFixed(2));

/** Flags overdue physical check-outs and refreshes the affected pools' status flags. */
export async function sweepOverdue(now = new Date()) {
  return prisma.$transaction(async (tx) => {
    const assetIds = await markOverdueAllocations(tx, now);
    if (assetIds.length > 0) {
      await refreshAssetStatuses(tx, assetIds);
      logger.info('allocations_marked_overdue', { assetIds });
    }
    return assetIds;
  });
}

async function loadAsset(id: string) {
  const asset = await findActiveAsset(id);
  if (!asset) throw notFound(`Asset ${id} not found`);
  return asset;
}

export async function listAssets(query: AssetQuery) {
  await sweepOverdue();
  const { rows, total } = await findAssets(buildAssetWhere(query), query.limit, query.offset);
  const stats = await allocationStatsByAsset(rows.map((r) => r.id));
  return {
    data: rows.map((r) => serializeAsset(r, stats.get(r.id))),
    total,
    limit: query.limit,
    offset: query.offset,
  };
}

export async function getAsset(id: string) {
  await sweepOverdue();
  const asset = await loadAsset(id);
  const stats = await allocationStatsByAsset([id]);
  return serializeAsset(asset, stats.get(id));
}

function checkKindSpecificFields(
  kind: ReturnType<typeof kindOf>,
  input: { creditTotal?: number; checkoutPeriodDays?: number },
) {
  if (kind !== 'physical' && input.checkoutPeriodDays !== undefined) {
    throw badRequest('checkoutPeriodDays applies to physical assets only');
  }
  if (kind !== 'voucher' && input.creditTotal !== undefined) {
    throw badRequest('creditTotal applies to cloud_voucher assets only');
  }
}

export async function createAsset(input: CreateAssetInput) {
  const kind = kindOf(input.category);
  checkKindSpecificFields(kind, input);
  if (kind === 'voucher' && input.creditTotal === undefined) {
    throw badRequest('creditTotal is required for cloud_voucher assets');
  }

  const asset = await prisma.$transaction(async (tx) => {
    const created = await tx.asset.create({
      data: {
        name: input.name,
        category: input.category,
        description: input.description ?? null,
        department: input.department,
        totalStock: input.totalStock,
        availableStock: input.totalStock,
        checkoutPeriodDays: kind === 'physical' ? (input.checkoutPeriodDays ?? DEFAULT_CHECKOUT_PERIOD_DAYS) : null,
        creditTotal: kind === 'voucher' ? decimal(input.creditTotal!) : null,
        creditBalance: kind === 'voucher' ? decimal(input.creditTotal!) : null,
      },
    });
    await refreshAssetStatuses(tx, [created.id]);
    return tx.asset.findUniqueOrThrow({ where: { id: created.id } });
  });

  logger.info('asset_created', { assetId: asset.id, category: asset.category, totalStock: asset.totalStock });
  return serializeAsset(asset);
}

export async function updateAsset(id: string, input: UpdateAssetInput) {
  const current = await loadAsset(id);
  const kind = kindOf(current.category);
  if (input.category !== undefined && input.category !== current.category) {
    throw badRequest('category cannot be changed; create a new asset instead');
  }
  checkKindSpecificFields(kind, input);

  const updated = await prisma.$transaction(async (tx) => {
    // Plain descriptive fields.
    await tx.asset.update({
      where: { id },
      data: {
        name: input.name,
        description: input.description,
        department: input.department,
        checkoutPeriodDays: input.checkoutPeriodDays,
      },
    });

    // Resizing the pool shifts the available stock by the same delta, but never below
    // the units that are currently allocated (conditional update = atomic check).
    if (input.totalStock !== undefined && input.totalStock !== current.totalStock) {
      const result = await tx.$executeRaw`
        UPDATE "Asset"
        SET "availableStock" = "availableStock" + (${input.totalStock}::int - "totalStock"),
            "totalStock" = ${input.totalStock}::int
        WHERE "id" = ${id}::uuid AND "availableStock" + (${input.totalStock}::int - "totalStock") >= 0`;
      if (result !== 1) {
        throw conflict('totalStock cannot drop below the number of units currently allocated', {
          allocatedUnits: current.totalStock - current.availableStock,
        });
      }
    }

    // Same rule for voucher credit: the balance moves with the total but never below zero.
    if (input.creditTotal !== undefined) {
      const newTotal = decimal(input.creditTotal);
      const result = await tx.$executeRaw`
        UPDATE "Asset"
        SET "creditBalance" = "creditBalance" + (${newTotal}::numeric - "creditTotal"),
            "creditTotal" = ${newTotal}::numeric
        WHERE "id" = ${id}::uuid AND "creditBalance" + (${newTotal}::numeric - "creditTotal") >= 0`;
      if (result !== 1) {
        const used = Number(current.creditTotal) - Number(current.creditBalance);
        throw conflict('creditTotal cannot drop below the credit already issued', { creditUsed: used });
      }
    }

    await refreshAssetStatuses(tx, [id]);
    return tx.asset.findUniqueOrThrow({ where: { id } });
  });

  logger.info('asset_updated', { assetId: id, fields: Object.keys(input) });
  const stats = await allocationStatsByAsset([id]);
  return serializeAsset(updated, stats.get(id));
}

/**
 * Retires (soft-deletes) an asset so allocation and ticket history stays intact.
 * Refused while physical units are still checked out or open tickets reference it.
 */
export async function deleteAsset(id: string) {
  await loadAsset(id);
  const [outstanding, openTickets] = await Promise.all([
    prisma.allocation.count({
      where: { assetId: id, status: { in: [AllocationStatus.checkedout, AllocationStatus.overdue] } },
    }),
    prisma.ticket.count({
      where: { status: { in: [TicketStatus.pending, TicketStatus.approved] }, items: { some: { assetId: id } } },
    }),
  ]);
  if (outstanding > 0 || openTickets > 0) {
    throw conflict('Asset is still in use', { outstandingCheckouts: outstanding, openTickets });
  }
  await prisma.asset.update({ where: { id }, data: { retiredAt: new Date() } });
  logger.info('asset_retired', { assetId: id });
}

/**
 * Processes the return of a checked-out physical device: closes the allocation with a
 * return timestamp and puts its units back into the pool, in one transaction.
 */
export async function returnAsset(assetId: string, input: ReturnAssetInput) {
  const asset = await loadAsset(assetId);
  if (kindOf(asset.category) !== 'physical') {
    throw badRequest(`Only physical assets can be returned; ${asset.name} is ${asset.category}`);
  }
  const actor = await requireActor(input.actorId, [PersonRole.admin, PersonRole.it_director], 'Processing a return');

  const quantity = await prisma.$transaction(async (tx) => {
    const returnedAt = new Date();
    const closed = await tx.allocation.updateMany({
      where: {
        id: input.allocationId,
        assetId,
        status: { in: [AllocationStatus.checkedout, AllocationStatus.overdue] },
      },
      data: {
        status: AllocationStatus.returned,
        returnedAt,
        returnedById: actor.id,
        returnNote: input.note ?? null,
      },
    });
    if (closed.count !== 1) {
      const existing = await tx.allocation.findUnique({ where: { id: input.allocationId } });
      if (!existing || existing.assetId !== assetId) {
        throw notFound(`Allocation ${input.allocationId} not found for asset ${assetId}`);
      }
      throw conflict(`Allocation ${input.allocationId} is already ${existing.status}`);
    }
    const { quantity: units } = await tx.allocation.findUniqueOrThrow({ where: { id: input.allocationId } });
    await restoreStock(tx, assetId, units);
    await refreshAssetStatuses(tx, [assetId]);
    return units;
  });

  const allocation = await prisma.allocation.findUniqueOrThrow({
    where: { id: input.allocationId },
    include: allocationInclude,
  });
  const result = serializeAllocation(allocation);
  logger.info('asset_returned', {
    assetId,
    allocationId: allocation.id,
    ticketId: allocation.ticketId,
    quantity,
    checkoutDurationHours: result.tracking?.checkoutDurationHours,
    returnedLate: result.tracking?.returnedLate,
    actorId: actor.id,
  });
  return { allocation: result, asset: await getAsset(assetId) };
}
