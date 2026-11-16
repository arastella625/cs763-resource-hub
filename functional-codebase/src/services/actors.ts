// Stack: TypeScript / Node 24 / Express 5 / Prisma 7 / PostgreSQL
// Tool: Claude Code (claude-opus-5-5)
// Prompt Summary: PA2 functional baseline — looks up the acting person and checks their role for an operation
// AI Contribution: ~100% (generated)
// Human Modifications: none yet
// Verification: pending human review
// Confidence: pending

import type { PersonRole } from '../generated/prisma/enums.js';
import { badRequest, forbidden } from '../lib/errors.js';
import { prisma } from '../lib/prisma.js';
import type { Db } from '../repositories/assetRepository.js';

/** Resolves `actorId` to a person and enforces that their role is one of `roles`. */
export async function requireActor(actorId: string, roles: PersonRole[], action: string, db: Db = prisma) {
  const actor = await db.person.findUnique({ where: { id: actorId } });
  if (!actor) throw badRequest(`actorId ${actorId} does not reference a known person`);
  if (!roles.includes(actor.role)) {
    throw forbidden(`${action} requires role ${roles.join(' or ')}; ${actor.name} is ${actor.role}`);
  }
  return actor;
}
