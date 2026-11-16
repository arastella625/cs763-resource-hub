# Resource Allocation & Help Desk Hub: functional baseline (PA2)

This backend service (Domain 2) distributes lab hardware, software license keys and cloud credit vouchers to courses and research labs. It also runs a help desk ticket pipeline and an allocation engine that operates separately from ticket review.

**Stack:** Node 24, TypeScript, Express 5, Prisma 7 (with `@prisma/adapter-pg`), PostgreSQL 17, Zod, Vitest and Supertest, Docker.

> **Generated baseline.** Claude Code generated this code from the PA2 prompt. Every source and test file starts with a provenance header (Stack / Tool / Prompt Summary / AI Contribution / …). JSON files (mock data, `package.json`, `tsconfig.json`) cannot hold comments. The same is true of `prisma/migrations/migration_lock.toml`, which Prisma generates and marks "do not edit". This build has **no authentication**: callers identify themselves with `actorId` / `requesterId` in the request body (see [Assumptions](#assumptions)).

---

## Run

### With Docker (app, database and mock data)

```bash
cd functional-codebase
cp .env.example .env            # placeholder values for local use
docker compose up --build
curl localhost:3000/api/v1/health   # {"status":"ok"}
```

Compose starts three services:

| Service | What it does |
|---|---|
| `db` | PostgreSQL 17, bound to `127.0.0.1:5432` |
| `migrate` | One-shot job: `prisma migrate deploy && prisma db seed`, then exits |
| `app` | The API on port `3000` (production-only runtime image) |

The seed inserts only records whose id is not in the database yet. Restarting therefore never duplicates data or resets inventory. To start over from the original mock data, run `docker compose down -v && docker compose up --build`.

### Without Docker for the app

```bash
docker compose up -d db          # just the database
npm ci
npx prisma migrate deploy        # create the schema
npm run db:seed                  # load mock-data/
npm run dev                      # tsx watch on :3000
```

### Scripts

| Script | Purpose |
|---|---|
| `npm run dev` | Run with reload (tsx) |
| `npm run build` | Generate the Prisma client and compile to `dist/` |
| `npm start` | Run the compiled app |
| `npm test` | Vitest + Supertest integration tests (real database) |
| `npm run test:coverage` | Tests with V8 coverage (`coverage/lcov.info`) |
| `npm run lint` / `npm run typecheck` | ESLint / `tsc --noEmit` |
| `npm run db:migrate` | Create or apply a migration in development |
| `npm run db:deploy` | Apply migrations |
| `npm run db:seed` | Load `mock-data/*.json` (idempotent) |

## Test

```bash
docker compose up -d db   # tests need a running PostgreSQL
npm test
```

* The tests run against the real database in `DATABASE_URL`, which is taken from `.env` locally or from the environment in CI. A Vitest global setup runs `prisma migrate deploy` first.
* Each test file creates its own people, course, lab and assets, tagged with a unique department name, and deletes them afterwards. The tests never rely on or change the seeded mock data, so `npm test` is safe to run against the compose database.
* Test files run one after another (`fileParallelism: false`) because they share a database.
* Suites:
  * `tests/assets.test.ts`: asset CRUD and search
  * `tests/tickets.test.ts`: ticket submission, listing, edits, review and deletion
  * `tests/allocation-flow.test.ts`: the full `pending → approved → allocated → closed` flow, device returns, all-or-nothing allocation, the voucher credit floor, concurrent allocate commands and overdue tracking
  * `tests/health.test.ts`: health check

---

## API

Base path: `/api/v1`. Requests and responses are JSON. Errors have the form `{"error": {"message", "details?"}}`:

| Status | Meaning |
|---|---|
| `400` | Validation error, malformed JSON or unknown field |
| `403` | The actor's role is not allowed to do this |
| `404` | Not found |
| `409` | Lifecycle or inventory conflict |

List endpoints return `{data, total, limit, offset, ...}` and accept `limit` (1–200, default 50) and `offset`. Comma-separated filters can also be repeated (`?status=a&status=b`).

The examples use the seeded mock-data ids. The id prefix tells you the record type: `1111…` people, `2222…` courses, `3333…` labs, `4444…` assets, `5555…` tickets.

```bash
B=http://localhost:3000/api/v1
ADMIN=11111111-0000-4000-8000-000000000008        # Samira Khan (admin)
DIRECTOR=11111111-0000-4000-8000-000000000007     # Jordan Blake (it_director)
```

### Assets

**`POST /assets`** adds an inventory asset. `category` is one of `hardware`, `laptop`, `iot_node` (physical), `software_license` or `cloud_voucher`. Physical assets may set `checkoutPeriodDays` (default 14). Vouchers require `creditTotal`.

```bash
curl -X POST $B/assets -H 'content-type: application/json' -d '{
  "name": "Arduino Uno R4 Kit", "category": "iot_node", "department": "Electrical & Computer Engineering",
  "totalStock": 25, "checkoutPeriodDays": 30 }'

curl -X POST $B/assets -H 'content-type: application/json' -d '{
  "name": "Oracle Cloud Credits", "category": "cloud_voucher", "department": "Computer Science",
  "totalStock": 10, "creditTotal": 5000 }'
```

The response includes `kind` (`physical` / `license` / `voucher`), `status`, `totalStock`, `availableStock`, `creditTotal` and `creditBalance` (vouchers only), and `metrics`, which holds `allocatedUnits`, `utilizationPct`, `activeAllocations`, `overdueAllocations` and `creditUsed`.

**`GET /assets`** searches the catalog. Retired assets are never listed. Filters can be combined:

| Param | Meaning |
|---|---|
| `category` | comma list of categories |
| `kind` | `physical`, `license` or `voucher` |
| `status` | comma list of `available`, `reserved`, `checkedout`, `overdue` |
| `department` | case-insensitive substring of the owning department or program |
| `available` | `true` (units in the pool) or `false` (pool empty) |
| `q` | text search in name and description |
| `courseId` / `labId` | assets the course or lab currently holds (active allocations) |

```bash
curl "$B/assets?department=electrical&available=true"
curl "$B/assets?category=laptop,hardware&status=available,reserved"
curl "$B/assets?labId=33333333-0000-4000-8000-000000000002"
```

**`GET /assets/{asset_id}`**, **`PUT /assets/{asset_id}`** and **`DELETE /assets/{asset_id}`** read, update and retire one asset.

```bash
curl $B/assets/44444444-0000-4000-8000-000000000001
curl -X PUT $B/assets/44444444-0000-4000-8000-000000000001 -H 'content-type: application/json' \
  -d '{"totalStock": 24, "description": "Refreshed fleet"}'
curl -X DELETE $B/assets/44444444-0000-4000-8000-000000000002     # 204
```

Rules for `PUT`:

* You can change `name`, `description`, `department`, `totalStock`, `checkoutPeriodDays` (physical assets) and `creditTotal` (vouchers).
* Changing `totalStock` shifts `availableStock` by the same delta. Changing `creditTotal` shifts `creditBalance` the same way. Either change is refused (`409`) if it would drop below what is already allocated.
* `category` cannot change.

`DELETE` soft-deletes the asset by setting `retiredAt`. It returns `409` while units are checked out or a pending or approved ticket requests the asset.

**`POST /assets/{asset_id}/return`** processes the return of a checked-out physical device. It closes the allocation (`status: returned`, `returnedAt`), puts its units back into the pool and returns the allocation (with check-out duration tracking) plus the updated asset. The actor must be an `admin` or `it_director`.

```bash
# allocation 77777777-...-003: two Saleae analyzers, seeded as overdue
curl -X POST $B/assets/44444444-0000-4000-8000-000000000007/return -H 'content-type: application/json' \
  -d "{\"allocationId\": \"77777777-0000-4000-8000-000000000003\", \"actorId\": \"$ADMIN\", \"note\": \"Returned to ECE stockroom\"}"
```

### Allocations

**`GET /assets/allocations`** lists resource allocations: checked-out devices, license keys and voucher codes, with summary metrics. Filters:

| Param | Meaning |
|---|---|
| `courseId` / `labId` | the requesting group; the response also echoes it as `group` |
| `status` | `active` (default: `checkedout`, `overdue`, `issued`), `all`, or a comma list of those statuses plus `returned` |
| `category` | comma list of categories |
| `assetId`, `ticketId` | a single asset or ticket |

Each allocation includes its `token` (license key `LIC-…`, voucher code `VCH-…` or hardware assignment token `HW-…`). Physical allocations also carry `tracking`: `checkoutDurationHours`, `dueAt`, `isOverdue`, `overdueByHours`, `hoursRemaining` and `returnedLate`.

`metrics` covers the whole filtered set: `activeAllocations`, `checkedOutUnits`, `overdueUnits`, `returnedUnits`, `licenseKeysIssued`, `licenseSeatsIssued`, `voucherCodesIssued` and `voucherCreditIssued`.

```bash
curl "$B/assets/allocations?courseId=22222222-0000-4000-8000-000000000002"
curl "$B/assets/allocations?labId=33333333-0000-4000-8000-000000000002&category=hardware,iot_node"
curl "$B/assets/allocations?status=all"
```

### Tickets

**`POST /assets/tickets`** submits a request. `requesterId` must be the instructor of `courseId` or the faculty advisor of `labId`; give exactly one of the two. `items` holds 1–25 lines, each for a different asset:

| Item field | Applies to |
|---|---|
| `quantity` | all items (default 1) |
| `creditAmount` | required for vouchers, not allowed otherwise |
| `loanDays` | physical items only (defaults to the asset's `checkoutPeriodDays`) |
| `justification` | all items, optional |

`priority` is `low`, `normal` (default), `high` or `urgent`.

```bash
curl -X POST $B/assets/tickets -H 'content-type: application/json' -d '{
  "title": "Jetsons and AWS credit for the edge ML project",
  "projectName": "Edge Inference",
  "priority": "high",
  "requesterId": "11111111-0000-4000-8000-000000000004",
  "labId": "33333333-0000-4000-8000-000000000001",
  "items": [
    { "assetId": "44444444-0000-4000-8000-000000000005", "quantity": 2, "loanDays": 21 },
    { "assetId": "44444444-0000-4000-8000-000000000011", "quantity": 1, "creditAmount": 750 },
    { "assetId": "44444444-0000-4000-8000-000000000009", "quantity": 3 }
  ] }'
```

**`GET /assets/tickets`** lists requests. Without `status` it lists only active requests (`pending`, `approved`, `allocated`). Filters:

| Param | Meaning |
|---|---|
| `status` | comma list of statuses |
| `priority` | comma list of priorities |
| `courseId`, `labId`, `requesterId` | the requesting group or person |
| `courseCode` and `section` | for example `CS763` and `A1` |
| `project` | substring of the project name or lab name |
| `category` | tickets with a line of that asset category |
| `assetId` | tickets with a line for that asset |

`metrics.byStatus` counts the matches per status.

```bash
curl "$B/assets/tickets?status=pending,approved"
curl "$B/assets/tickets?courseCode=CS763&section=A1&status=pending,approved,allocated,closed"
curl "$B/assets/tickets?category=cloud_voucher&project=genomics"
```

**`GET /assets/tickets/{ticket_id}`** returns the ticket with its items, `events` (the audit log of every transition), `allocations` and `metrics`. The metrics are `itemCount`, `unitsRequested`, `creditRequested`, `unitsAllocated`, `creditAllocated`, `keysIssued`, `outstandingPhysicalUnits`, `unitsReturned`, `hoursToReview`, `hoursToAllocation`, `hoursOpen` and `eventCount`.

**`PUT /assets/tickets/{ticket_id}`** does two things:

* Edits contents (`title`, `description`, `projectName`, `priority`, `items`). This works only while the ticket is `pending`.
* Performs a review transition with `status` and `actorId` (plus optional `note`):

| From | To | Who | Notes |
|---|---|---|---|
| `pending` | `approved` | `it_director` | Inventory is **not** changed; requested assets show `reserved` |
| `pending` / `approved` | `rejected` | `it_director` | `rejectionReason` required |
| `allocated` / `rejected` | `closed` | `admin`, `it_director` or the requester | `allocated` tickets close only after all physical devices are returned |
| any | `allocated` | n/a | Refused (`409`); use the allocate command |

```bash
T=55555555-0000-4000-8000-000000000001      # seeded pending ticket
curl -X PUT $B/assets/tickets/$T -H 'content-type: application/json' -d '{"priority": "urgent"}'
curl -X PUT $B/assets/tickets/$T -H 'content-type: application/json' \
  -d "{\"status\": \"approved\", \"actorId\": \"$DIRECTOR\", \"note\": \"Approved for weeks 9-14\"}"
```

**`DELETE /assets/tickets/{ticket_id}`** deletes a `pending` request (`204`). Reviewed tickets return `409` so the audit trail stays intact.

**`POST /assets/tickets/{ticket_id}/allocate`** is the allocation engine and must be run by an `admin`. It works on an `approved` ticket. In **one database transaction** it:

1. claims the ticket (`approved → allocated`; a concurrent second call gets `409`)
2. atomically deducts each line from its pool, along with credit from the voucher balance
3. creates an allocation for each line, with a generated license key, voucher code or hardware token and, for physical items, a due date
4. logs the event

If any pool is short, the whole allocation is rolled back. The response is `409` with the requested and available amounts, and the ticket stays `approved`.

```bash
curl -X POST $B/assets/tickets/$T/allocate -H 'content-type: application/json' \
  -d "{\"actorId\": \"$ADMIN\", \"note\": \"Collected at IT desk\"}"
```

### Full flow (example)

1. `POST /assets/tickets`: the ticket is `pending`.
2. `PUT /assets/tickets/{id}` with `{status: "approved", actorId: <it_director>}`: the ticket is `approved` and stock is unchanged.
3. `POST /assets/tickets/{id}/allocate` with `{actorId: <admin>}`: the ticket is `allocated`, stock is deducted and keys are issued.
4. `POST /assets/{asset_id}/return` with `{allocationId, actorId}` for each physical line: units go back to the pool.
5. `PUT /assets/tickets/{id}` with `{status: "closed", actorId}`: the ticket is `closed`.

---

## Data model

```
Person (role: instructor | faculty_advisor | it_director | admin)
Course (code, section, term, department) ── instructor → Person
ResearchLab (name, department) ── facultyAdvisor → Person
Asset (category, department, totalStock, availableStock, status,
       checkoutPeriodDays?, creditTotal?, creditBalance?, retiredAt?)
Ticket (status, priority, projectName, requester, course | lab, reviewer, allocator, timestamps)
  ├─ TicketItem (asset, quantity, creditAmount?, loanDays?, justification)
  ├─ TicketEvent (fromStatus → toStatus, actor, note, createdAt)   -- audit log
  └─ Allocation (ticketItem, asset, course | lab, quantity, creditAmount?, token,
                 status: checkedout | overdue | issued | returned, dueAt?, returnedAt?)
```

The migration (`prisma/migrations/20261116000000_init`) also adds `CHECK` constraints, so the database itself refuses a negative stock or credit balance, more available units than total stock, a non-positive line quantity, or a ticket tied to both or neither of a course and a lab.

## Mock data (`mock-data/`)

| File | Contents |
|---|---|
| `people.json` | 3 instructors, 3 faculty advisors, 1 IT director, 2 admins |
| `courses.json` | CS763 A1, CS777 A1, EC544 A1, CS601 O1 (Fall 2026) |
| `labs.json` | Secure Systems Lab, IoT & Edge Computing Lab, Cloud Data Lab |
| `assets.json` | 13 assets: 2 laptop models, 2 IoT node types, 3 hardware items, 3 software licenses, 3 cloud voucher pools |
| `tickets.json` | 10 tickets: 2 pending, 2 approved, 1 rejected, 3 allocated (one with an overdue analyzer), 2 closed (one after allocation and return, one after rejection) |

Ticket timestamps are stored as "days ago" offsets and resolved when the seed runs, so the demo always shows a realistic timeline. One check-out is overdue in the demo.

## Project layout

```
src/
  app.ts, server.ts         Express app, process entry point
  routes/                   HTTP layer: parse/validate, call a service, send JSON
  services/                 Business rules: lifecycle, allocation engine, returns, metrics
  repositories/             Prisma data access: filters, atomic stock updates, status refresh
  validation/schemas.ts     Zod schemas for bodies, params, queries
  lib/                      config, prisma client, errors, logger, asset kinds and token generation
  jobs/overdueJob.ts        Periodic overdue sweep
prisma/                     schema, migration, seed
mock-data/                  JSON seed data
tests/                      Vitest + Supertest integration tests
```

---

## Assumptions

These are the interpretations chosen where the specification was ambiguous.

1. **No authentication.** The specification defines none. Identity is supplied in the request body (`requesterId` on ticket creation, `actorId` on transitions, allocation and returns) and checked against the `Person` table and its role. This is a functional baseline, not an access-control design.
2. **Roles.**
   * Only the course's instructor or the lab's faculty advisor may submit a ticket for that group.
   * Only the `it_director` approves or rejects ("IT director sign-off").
   * Only an `admin` executes allocations ("processed by an administrator").
   * Returns are processed by an `admin` or the `it_director`.
   * A ticket can be closed by an `admin`, the `it_director` or its requester.
3. **Assets are pools, not individual serial-numbered units.** `totalStock` and `availableStock` count units: devices, license seats or voucher codes. A ticket line requests `quantity` units of one asset.
4. **Polymorphism by category.** `hardware`, `laptop` and `iot_node` are physical. They have a loan period, a due date, check-out duration tracking and returns. `software_license` issues one alphanumeric key per allocation line covering `quantity` seats; licenses are never returned. `cloud_voucher` pools have both a code count and a credit balance (`creditTotal` / `creditBalance`, 2-decimal currency). A voucher line's `creditAmount` is the total credit for that line and is deducted from the balance, which can never go below zero. That rule is enforced by an atomic conditional update and by a database `CHECK`.
5. **Asset status flag** is derived and kept in sync after every change. In order of precedence:
   * `overdue`: some unit is past its due date
   * `checkedout`: no units are left in the pool
   * `reserved`: an approved ticket is waiting for allocation of this asset
   * `available`: otherwise

   Allocations carry their own status: `checkedout`, `overdue`, `issued` (digital) or `returned`.
6. **Overdue detection** runs on every read of assets, tickets and allocations, and in a background sweep every 5 minutes.
7. **"Multi-tiered requests"** means a ticket with several lines across asset kinds, plus a priority tier (`low` / `normal` / `high` / `urgent`).
8. **Approval does not reserve stock.** Inventory changes only through the allocate command, as the specification requires. If two approved tickets compete for the same units, the first to be allocated wins and the other gets `409` without any change to the database.
9. **Allocation is all-or-nothing per ticket.** Partial fulfilment is not supported.
10. **Closing.** An `allocated` ticket can be closed only after all of its physical devices are returned. `rejected` tickets can also be closed. The `approved → rejected` transition lets the IT director withdraw an approval before allocation.
11. **Deleting.** Assets are soft-deleted (retired) so ticket and allocation history stays intact. Tickets can be hard-deleted only while `pending`.
12. **"Department program"** filtering uses the asset's `department` field (case-insensitive substring). **"Project"** filtering matches the ticket's `projectName` or the lab name. **"Course section"** filtering uses `courseCode` and `section`.
13. **Ticket listing default.** "All active requests" means `pending`, `approved` and `allocated`. Pass `status` to see `rejected` or `closed` tickets.
14. **`GET /assets/allocations`** without `courseId` or `labId` returns all groups (an administrative overview). With one, the response is scoped to that course or lab.
15. **Returns** name the allocation being returned (`allocationId`), because a pool can have several open check-outs. One return closes the whole allocation line.
16. **Logging metrics.** Every request produces one JSON log line on stdout, and lifecycle events (`ticket_submitted`, `ticket_transition`, `ticket_allocated`, `asset_returned`, …) are logged with durations and quantities. Tests silence logs with `LOG_LEVEL=silent`.
17. The outdated root `spec.md` was ignored as instructed.
