// Stack: TypeScript / Node 24 / Express 5 / Prisma 7 / PostgreSQL
// Tool: Claude Code (claude-opus-5-5)
// Prompt Summary: PA2 functional baseline — isolated per-file test fixtures (people, course, lab, assets) and cleanup
// AI Contribution: ~100% (generated)
// Human Modifications: none yet
// Verification: pending human review
// Confidence: pending

import { randomUUID } from 'node:crypto';
import { Prisma } from '../../src/generated/prisma/client.js';
import { prisma } from '../../src/lib/prisma.js';

/**
 * Every test file creates its own people, groups and assets tagged with a unique
 * department name, so tests never depend on (or modify) the seeded mock data.
 */
export async function createFixtures(label: string) {
  const tag = `${label}-${randomUUID().slice(0, 8)}`;
  const department = `Test ${tag}`;
  const person = (name: string, role: 'instructor' | 'faculty_advisor' | 'it_director' | 'admin') =>
    prisma.person.create({ data: { name: `${name} ${tag}`, email: `${name.toLowerCase().replaceAll(" ", ".")}.${tag}@test.example`, role } });

  const instructor = await person('Instructor', 'instructor');
  const otherInstructor = await person('Other Instructor', 'instructor');
  const advisor = await person('Advisor', 'faculty_advisor');
  const itDirector = await person('IT Director', 'it_director');
  const admin = await person('Admin', 'admin');

  const course = await prisma.course.create({
    data: { code: `T${tag.slice(-6)}`, title: 'Test Course', section: 'Z9', term: 'Test Term', department, instructorId: instructor.id },
  });
  const lab = await prisma.researchLab.create({
    data: { name: `Lab ${tag}`, department, facultyAdvisorId: advisor.id },
  });

  const asset = (data: Omit<Prisma.AssetCreateInput, 'department' | 'availableStock'>) =>
    prisma.asset.create({ data: { ...data, department, availableStock: data.totalStock } });

  const laptop = await asset({ name: `Laptop ${tag}`, category: 'laptop', totalStock: 5, checkoutPeriodDays: 14 });
  const iot = await asset({ name: `IoT Node ${tag}`, category: 'iot_node', totalStock: 4, checkoutPeriodDays: 30 });
  const license = await asset({ name: `License ${tag}`, category: 'software_license', totalStock: 10 });
  const voucher = await asset({
    name: `Voucher ${tag}`,
    category: 'cloud_voucher',
    totalStock: 5,
    creditTotal: new Prisma.Decimal(1000),
    creditBalance: new Prisma.Decimal(1000),
  });

  const people = [instructor, otherInstructor, advisor, itDirector, admin];

  async function cleanup() {
    const personIds = people.map((p) => p.id);
    await prisma.allocation.deleteMany({ where: { asset: { department } } });
    await prisma.ticket.deleteMany({ where: { requesterId: { in: personIds } } });
    await prisma.asset.deleteMany({ where: { department } });
    await prisma.course.deleteMany({ where: { id: course.id } });
    await prisma.researchLab.deleteMany({ where: { id: lab.id } });
    await prisma.person.deleteMany({ where: { id: { in: personIds } } });
  }

  return { tag, department, instructor, otherInstructor, advisor, itDirector, admin, course, lab, laptop, iot, license, voucher, cleanup };
}

export type Fixtures = Awaited<ReturnType<typeof createFixtures>>;
