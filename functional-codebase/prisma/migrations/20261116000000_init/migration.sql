-- Stack: TypeScript / Node 24 / Express 5 / Prisma 7 / PostgreSQL
-- Tool: Claude Code (claude-opus-5-5)
-- Prompt Summary: PA2 functional baseline — initial schema: groups, people, assets, tickets, allocations
-- AI Contribution: ~100% (generated)
-- Human Modifications: none yet
-- Verification: pending human review
-- Confidence: pending

-- CreateEnum
CREATE TYPE "PersonRole" AS ENUM ('instructor', 'faculty_advisor', 'it_director', 'admin');

-- CreateEnum
CREATE TYPE "AssetCategory" AS ENUM ('hardware', 'laptop', 'iot_node', 'software_license', 'cloud_voucher');

-- CreateEnum
CREATE TYPE "AssetStatus" AS ENUM ('available', 'reserved', 'checkedout', 'overdue');

-- CreateEnum
CREATE TYPE "TicketStatus" AS ENUM ('pending', 'approved', 'rejected', 'allocated', 'closed');

-- CreateEnum
CREATE TYPE "TicketPriority" AS ENUM ('low', 'normal', 'high', 'urgent');

-- CreateEnum
CREATE TYPE "AllocationStatus" AS ENUM ('checkedout', 'overdue', 'issued', 'returned');

-- CreateTable
CREATE TABLE "Person" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "role" "PersonRole" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Person_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Course" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "section" TEXT NOT NULL,
    "term" TEXT NOT NULL,
    "department" TEXT NOT NULL,
    "instructorId" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Course_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ResearchLab" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "department" TEXT NOT NULL,
    "facultyAdvisorId" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ResearchLab_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Asset" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "category" "AssetCategory" NOT NULL,
    "description" TEXT,
    "department" TEXT NOT NULL,
    "totalStock" INTEGER NOT NULL,
    "availableStock" INTEGER NOT NULL,
    "status" "AssetStatus" NOT NULL DEFAULT 'available',
    "checkoutPeriodDays" INTEGER,
    "creditTotal" DECIMAL(12,2),
    "creditBalance" DECIMAL(12,2),
    "retiredAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Asset_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Ticket" (
    "id" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "projectName" TEXT,
    "priority" "TicketPriority" NOT NULL DEFAULT 'normal',
    "status" "TicketStatus" NOT NULL DEFAULT 'pending',
    "requesterId" UUID NOT NULL,
    "courseId" UUID,
    "labId" UUID,
    "reviewedById" UUID,
    "reviewedAt" TIMESTAMP(3),
    "rejectionReason" TEXT,
    "allocatedById" UUID,
    "allocatedAt" TIMESTAMP(3),
    "closedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Ticket_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TicketItem" (
    "id" UUID NOT NULL,
    "ticketId" UUID NOT NULL,
    "assetId" UUID NOT NULL,
    "quantity" INTEGER NOT NULL,
    "creditAmount" DECIMAL(12,2),
    "loanDays" INTEGER,
    "justification" TEXT,

    CONSTRAINT "TicketItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TicketEvent" (
    "id" UUID NOT NULL,
    "ticketId" UUID NOT NULL,
    "fromStatus" "TicketStatus",
    "toStatus" "TicketStatus" NOT NULL,
    "actorId" UUID,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TicketEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Allocation" (
    "id" UUID NOT NULL,
    "ticketId" UUID NOT NULL,
    "ticketItemId" UUID NOT NULL,
    "assetId" UUID NOT NULL,
    "courseId" UUID,
    "labId" UUID,
    "quantity" INTEGER NOT NULL,
    "creditAmount" DECIMAL(12,2),
    "token" TEXT NOT NULL,
    "status" "AllocationStatus" NOT NULL,
    "allocatedById" UUID NOT NULL,
    "allocatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "dueAt" TIMESTAMP(3),
    "returnedAt" TIMESTAMP(3),
    "returnedById" UUID,
    "returnNote" TEXT,

    CONSTRAINT "Allocation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Person_email_key" ON "Person"("email");

-- CreateIndex
CREATE UNIQUE INDEX "Course_code_section_term_key" ON "Course"("code", "section", "term");

-- CreateIndex
CREATE UNIQUE INDEX "ResearchLab_name_key" ON "ResearchLab"("name");

-- CreateIndex
CREATE INDEX "Asset_category_status_idx" ON "Asset"("category", "status");

-- CreateIndex
CREATE INDEX "Asset_department_idx" ON "Asset"("department");

-- CreateIndex
CREATE INDEX "Ticket_status_idx" ON "Ticket"("status");

-- CreateIndex
CREATE INDEX "Ticket_courseId_idx" ON "Ticket"("courseId");

-- CreateIndex
CREATE INDEX "Ticket_labId_idx" ON "Ticket"("labId");

-- CreateIndex
CREATE INDEX "TicketItem_ticketId_idx" ON "TicketItem"("ticketId");

-- CreateIndex
CREATE INDEX "TicketItem_assetId_idx" ON "TicketItem"("assetId");

-- CreateIndex
CREATE INDEX "TicketEvent_ticketId_idx" ON "TicketEvent"("ticketId");

-- CreateIndex
CREATE UNIQUE INDEX "Allocation_ticketItemId_key" ON "Allocation"("ticketItemId");

-- CreateIndex
CREATE UNIQUE INDEX "Allocation_token_key" ON "Allocation"("token");

-- CreateIndex
CREATE INDEX "Allocation_assetId_status_idx" ON "Allocation"("assetId", "status");

-- CreateIndex
CREATE INDEX "Allocation_courseId_idx" ON "Allocation"("courseId");

-- CreateIndex
CREATE INDEX "Allocation_labId_idx" ON "Allocation"("labId");

-- AddForeignKey
ALTER TABLE "Course" ADD CONSTRAINT "Course_instructorId_fkey" FOREIGN KEY ("instructorId") REFERENCES "Person"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ResearchLab" ADD CONSTRAINT "ResearchLab_facultyAdvisorId_fkey" FOREIGN KEY ("facultyAdvisorId") REFERENCES "Person"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Ticket" ADD CONSTRAINT "Ticket_requesterId_fkey" FOREIGN KEY ("requesterId") REFERENCES "Person"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Ticket" ADD CONSTRAINT "Ticket_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "Course"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Ticket" ADD CONSTRAINT "Ticket_labId_fkey" FOREIGN KEY ("labId") REFERENCES "ResearchLab"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Ticket" ADD CONSTRAINT "Ticket_reviewedById_fkey" FOREIGN KEY ("reviewedById") REFERENCES "Person"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Ticket" ADD CONSTRAINT "Ticket_allocatedById_fkey" FOREIGN KEY ("allocatedById") REFERENCES "Person"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TicketItem" ADD CONSTRAINT "TicketItem_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "Ticket"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TicketItem" ADD CONSTRAINT "TicketItem_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "Asset"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TicketEvent" ADD CONSTRAINT "TicketEvent_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "Ticket"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TicketEvent" ADD CONSTRAINT "TicketEvent_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "Person"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Allocation" ADD CONSTRAINT "Allocation_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "Ticket"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Allocation" ADD CONSTRAINT "Allocation_ticketItemId_fkey" FOREIGN KEY ("ticketItemId") REFERENCES "TicketItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Allocation" ADD CONSTRAINT "Allocation_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "Asset"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Allocation" ADD CONSTRAINT "Allocation_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "Course"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Allocation" ADD CONSTRAINT "Allocation_labId_fkey" FOREIGN KEY ("labId") REFERENCES "ResearchLab"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Allocation" ADD CONSTRAINT "Allocation_allocatedById_fkey" FOREIGN KEY ("allocatedById") REFERENCES "Person"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Allocation" ADD CONSTRAINT "Allocation_returnedById_fkey" FOREIGN KEY ("returnedById") REFERENCES "Person"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- Inventory guards (not expressible in the Prisma schema): balances can never go below zero
-- and the pool can never hold more than its total stock.
ALTER TABLE "Asset" ADD CONSTRAINT "Asset_stock_nonnegative_check" CHECK ("availableStock" >= 0 AND "totalStock" >= 0);
ALTER TABLE "Asset" ADD CONSTRAINT "Asset_stock_within_total_check" CHECK ("availableStock" <= "totalStock");
ALTER TABLE "Asset" ADD CONSTRAINT "Asset_credit_nonnegative_check" CHECK ("creditBalance" IS NULL OR "creditBalance" >= 0);
ALTER TABLE "Asset" ADD CONSTRAINT "Asset_credit_within_total_check" CHECK ("creditBalance" IS NULL OR "creditBalance" <= "creditTotal");
ALTER TABLE "TicketItem" ADD CONSTRAINT "TicketItem_quantity_positive_check" CHECK ("quantity" > 0);
ALTER TABLE "Ticket" ADD CONSTRAINT "Ticket_single_group_check" CHECK (("courseId" IS NULL) <> ("labId" IS NULL));
