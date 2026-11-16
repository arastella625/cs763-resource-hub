// Stack: TypeScript / Node 24 / Express 5 / Prisma 7 / PostgreSQL
// Tool: Claude Code (claude-opus-5-5)
// Prompt Summary: PA2 functional baseline — maps asset categories to physical / license / voucher kinds and issues tokens
// AI Contribution: ~100% (generated)
// Human Modifications: none yet
// Verification: pending human review
// Confidence: pending

import { randomBytes } from 'node:crypto';
import { AssetCategory } from '../generated/prisma/enums.js';

export type AssetKind = 'physical' | 'license' | 'voucher';

export const PHYSICAL_CATEGORIES: AssetCategory[] = [
  AssetCategory.hardware,
  AssetCategory.laptop,
  AssetCategory.iot_node,
];

export function kindOf(category: AssetCategory): AssetKind {
  if (category === AssetCategory.software_license) return 'license';
  if (category === AssetCategory.cloud_voucher) return 'voucher';
  return 'physical';
}

export function categoriesOfKind(kind: AssetKind): AssetCategory[] {
  if (kind === 'license') return [AssetCategory.software_license];
  if (kind === 'voucher') return [AssetCategory.cloud_voucher];
  return PHYSICAL_CATEGORIES;
}

export const DEFAULT_CHECKOUT_PERIOD_DAYS = 14;

// Unambiguous uppercase alphabet (no 0/O, 1/I) for human-readable keys.
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function randomGroup(length: number): string {
  const bytes = randomBytes(length);
  let out = '';
  for (const b of bytes) out += ALPHABET[b % ALPHABET.length];
  return out;
}

function groups(count: number, length: number): string {
  return Array.from({ length: count }, () => randomGroup(length)).join('-');
}

/** License key, voucher code or hardware assignment token, depending on the asset kind. */
export function issueToken(kind: AssetKind): string {
  if (kind === 'license') return `LIC-${groups(5, 5)}`;
  if (kind === 'voucher') return `VCH-${groups(4, 4)}`;
  return `HW-${groups(3, 4)}`;
}
