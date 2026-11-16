// Stack: TypeScript / Node 24 / Express 5 / Prisma 7 / PostgreSQL
// Tool: Claude Code (claude-opus-5-5)
// Prompt Summary: PA2 functional baseline — Zod schemas for request bodies, path params and query strings
// AI Contribution: ~100% (generated)
// Human Modifications: none yet
// Verification: pending human review
// Confidence: pending

import { z } from 'zod';
import {
  AllocationStatus,
  AssetCategory,
  AssetStatus,
  TicketPriority,
  TicketStatus,
} from '../generated/prisma/enums.js';

// ---------------------------------------------------------------------------
// Building blocks
// ---------------------------------------------------------------------------

const MONEY_PATTERN = /^\d{1,10}(\.\d{1,2})?$/;

/** Positive amount with at most two decimals, given as a number or a numeric string. */
export const money = z
  .union([z.number(), z.string()])
  .refine((v) => MONEY_PATTERN.test(String(v)), 'must be a positive amount with at most 2 decimal places')
  .transform((v) => Number(v))
  .pipe(z.number().positive());

const text = (max: number) => z.string().trim().min(1).max(max);
const optionalText = (max: number) => z.string().trim().max(max).nullish();

export const uuidParam = (name: string) => z.object({ [name]: z.uuid({ message: `${name} must be a UUID` }) });

/** Accepts `?x=a,b` and `?x=a&x=b`; returns a validated, de-duplicated list. */
function csvEnum<T extends string>(values: readonly [T, ...T[]]) {
  return z
    .union([z.string(), z.array(z.string())])
    .transform((v) =>
      [...new Set((Array.isArray(v) ? v.join(',') : v).split(',').map((s) => s.trim()).filter(Boolean))],
    )
    .pipe(z.array(z.enum(values)).min(1))
    .optional();
}

const queryString = z.string().trim().min(1).max(200).optional();
const queryUuid = z.uuid().optional();
const booleanString = z.enum(['true', 'false']).transform((v) => v === 'true').optional();

const pagination = {
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
};

const categoryValues = Object.values(AssetCategory) as [AssetCategory, ...AssetCategory[]];
const assetStatusValues = Object.values(AssetStatus) as [AssetStatus, ...AssetStatus[]];
const ticketStatusValues = Object.values(TicketStatus) as [TicketStatus, ...TicketStatus[]];
const priorityValues = Object.values(TicketPriority) as [TicketPriority, ...TicketPriority[]];
const allocationStatusValues = Object.values(AllocationStatus) as [AllocationStatus, ...AllocationStatus[]];

// ---------------------------------------------------------------------------
// Assets
// ---------------------------------------------------------------------------

export const createAssetSchema = z.strictObject({
  name: text(200),
  category: z.enum(categoryValues),
  description: optionalText(2000),
  department: text(200),
  totalStock: z.number().int().min(0).max(1_000_000),
  checkoutPeriodDays: z.number().int().min(1).max(365).optional(),
  creditTotal: money.optional(),
});
export type CreateAssetInput = z.infer<typeof createAssetSchema>;

export const updateAssetSchema = z
  .strictObject({
    name: text(200),
    category: z.enum(categoryValues),
    description: optionalText(2000),
    department: text(200),
    totalStock: z.number().int().min(0).max(1_000_000),
    checkoutPeriodDays: z.number().int().min(1).max(365),
    creditTotal: money,
  })
  .partial()
  .refine((v) => Object.keys(v).length > 0, 'at least one field is required');
export type UpdateAssetInput = z.infer<typeof updateAssetSchema>;

export const assetQuerySchema = z.object({
  category: csvEnum(categoryValues),
  status: csvEnum(assetStatusValues),
  kind: z.enum(['physical', 'license', 'voucher']).optional(),
  department: queryString,
  q: queryString,
  available: booleanString,
  courseId: queryUuid,
  labId: queryUuid,
  ...pagination,
});
export type AssetQuery = z.infer<typeof assetQuerySchema>;

export const returnAssetSchema = z.strictObject({
  allocationId: z.uuid(),
  actorId: z.uuid(),
  note: optionalText(1000),
});
export type ReturnAssetInput = z.infer<typeof returnAssetSchema>;

// ---------------------------------------------------------------------------
// Tickets
// ---------------------------------------------------------------------------

export const ticketItemSchema = z.strictObject({
  assetId: z.uuid(),
  quantity: z.number().int().min(1).max(10_000).default(1),
  creditAmount: money.optional(),
  loanDays: z.number().int().min(1).max(365).optional(),
  justification: optionalText(1000),
});
export type TicketItemInput = z.infer<typeof ticketItemSchema>;

const ticketItems = z.array(ticketItemSchema).min(1).max(25);

export const createTicketSchema = z
  .strictObject({
    title: text(200),
    description: optionalText(5000),
    projectName: optionalText(200),
    priority: z.enum(priorityValues).default('normal'),
    requesterId: z.uuid(),
    courseId: z.uuid().optional(),
    labId: z.uuid().optional(),
    items: ticketItems,
  })
  .refine((v) => Boolean(v.courseId) !== Boolean(v.labId), {
    message: 'exactly one of courseId or labId is required',
    path: ['courseId'],
  });
export type CreateTicketInput = z.infer<typeof createTicketSchema>;

export const updateTicketSchema = z
  .strictObject({
    title: text(200),
    description: optionalText(5000),
    projectName: optionalText(200),
    priority: z.enum(priorityValues),
    items: ticketItems,
    status: z.enum(ticketStatusValues),
    actorId: z.uuid(),
    rejectionReason: optionalText(2000),
    note: optionalText(2000),
  })
  .partial()
  .refine((v) => Object.keys(v).length > 0, 'at least one field is required')
  .refine((v) => !v.status || v.actorId, { message: 'actorId is required to change status', path: ['actorId'] });
export type UpdateTicketInput = z.infer<typeof updateTicketSchema>;

export const ticketQuerySchema = z.object({
  status: csvEnum(ticketStatusValues),
  priority: csvEnum(priorityValues),
  category: csvEnum(categoryValues),
  courseId: queryUuid,
  labId: queryUuid,
  courseCode: queryString,
  section: queryString,
  project: queryString,
  requesterId: queryUuid,
  assetId: queryUuid,
  ...pagination,
});
export type TicketQuery = z.infer<typeof ticketQuerySchema>;

export const allocateTicketSchema = z.strictObject({
  actorId: z.uuid(),
  note: optionalText(2000),
});
export type AllocateTicketInput = z.infer<typeof allocateTicketSchema>;

// ---------------------------------------------------------------------------
// Allocations
// ---------------------------------------------------------------------------

export const allocationQuerySchema = z.object({
  courseId: queryUuid,
  labId: queryUuid,
  // 'active' (default) = checkedout + overdue + issued; 'all' = everything; or an explicit list.
  status: z
    .union([z.literal('active'), z.literal('all'), csvEnum(allocationStatusValues)])
    .optional()
    .default('active'),
  category: csvEnum(categoryValues),
  assetId: queryUuid,
  ticketId: queryUuid,
  ...pagination,
});
export type AllocationQuery = z.infer<typeof allocationQuerySchema>;
