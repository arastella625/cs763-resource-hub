# SAST Triage Report: Resource Allocation & Help Desk Hub (PA2 naive baseline)

> **DRAFT SKELETON.** Claude prepared the structure, the scanner ledger and *suggested* verdicts.
> Everything marked **[YOU]** needs your own work, and every suggested verdict needs your review
> before submission. Delete this box when done.

## AI Deliverable Metadata Block

| Field | Value |
|---|---|
| Deliverable | `sast-triage-report.md` (PA2) |
| Author | Amber Rastella |
| AI tools | Claude Code (Claude Opus 5.5, `claude-opus-5-5`): code review (Appendix A), report skeleton, scanner ledger, suggested verdicts and draft root causes. It also ran the §4 dynamic verification commands at the author's direction (see the provenance note in §4) |
| Human work | **[YOU]** Only what you actually did, for example: directing the review and the tests, reviewing the evidence, final TP/FP verdicts, rewriting root causes in your own words, SonarQube triage |
| Conceptual AI contribution | **[YOU]** Set a percentage when the report is finished, for example "~40% (structure and scanner ledger); verdicts and analysis human-verified" |
| Summary of design-aid prompts | "Review the generated code"; "Start a sast-triage-report.md skeleton with the scanner ledger filled in"; running the review notes' §5 hand-test commands; "Paste my code review notes into the sast-triage report" |
| AI log | **[YOU]** Link or path to the export of the desktop session that produced this skeleton, in `.ai_logs/` |

---

## 1. Scope and method

| Item | Value |
|---|---|
| Code under test | `functional-codebase/` on branch `pa2`, commit `131f7ce`. Generated in one agent session (Prompt_test_log.md Entry 5) |
| Pipeline run | [43976561548](https://github.com/arastella625/cs763-resource-hub/actions/runs/43976561548). Raw output in `pipeline-logs/pa2/run-43976561548/` |
| Semgrep | 1.183.0, 266 rules from `p/default`, `p/owasp-top-ten`, `p/nodejs`, `p/typescript`, `p/dockerfile`, `p/secrets`, run on 60 tracked files (all 21 application source files) |
| Trivy | 0.76.1, filesystem scan (dependencies, secrets, misconfigurations) and image scan |
| SonarQube Cloud | Analysis of branch `pa2` succeeded. **[YOU]** Add the export or screenshots |
| Manual review | Reading of routes, services, repositories, validation, schema and migration (Claude Code review notes, Appendix A) |
| Dynamic verification | `curl` against the running Docker Compose stack, starting from seed data, 2026-11-16 18:39 EST, run by Claude Code at the author's direction (§4) |

**Verdict definitions**

- **True positive (TP):** the weakness exists and can be reached in this service as deployed.
- **False positive (FP):** the rule matched, but the code isn't vulnerable in context. The reason is given.
- **Informational / accepted:** real but low impact, or outside the agent-generated code (for example, base-image packages), and recorded for completeness.

---

## 2. Scanner ledger (every raw finding)

| ID | Scanner / rule | Location | Severity | CWE | Suggested verdict | Reason |
|---|---|---|---|---|---|---|
| S1 | Semgrep `dockerfile.security.missing-user.missing-user` | `functional-codebase/Dockerfile:51` | ERROR | CWE-250 | **TP** | The runtime stage has no `USER`, so `node dist/server.js` runs as root (UID 0). Confirm with `docker compose exec app id -u` (expected `0`). **[YOU]** |
| S2 | Trivy DS-0002 "Image user should not be 'root'" | `functional-codebase/Dockerfile` | HIGH | CWE-250 | **TP (duplicate of S1)** | Same root cause, found by a second tool. Counted once in §3 (V6) |
| S3 | Trivy DS-0026 "No HEALTHCHECK defined" | `functional-codebase/Dockerfile` | LOW | n/a | **FP in context** | `docker-compose.yml` defines an `app` health check (a `fetch` of `/api/v1/health`), which is how this service is run. It's only a real gap if the image runs without Compose |
| S4 | Trivy image: CVE-2023-45853 (zlib1g 1.2.13, no fixed version) | runtime image, Debian 12 | CRITICAL | CWE-190 / CWE-787 | **Informational / accepted** [VERIFY] | The vulnerable function (`zipOpenNewFileInZip4_6`) is in minizip, which this app never calls. Check the Debian security tracker's status for bookworm. **[YOU]** |
| S5 | Trivy image: 225 other Debian 12 base-package CVEs (37 high, mostly util-linux and PAM libraries) | runtime image | HIGH and below | various | **Informational (base image)** | They come from `node:24.22.2-slim` (chosen in PA1), not the agent's code. Mitigation: rebuild on a patched base, or use a distroless or Alpine base |
| S6 | Trivy image: 19 CVEs in Node packages bundled in the image (6 high) | runtime image, `node-pkg` | HIGH and below | various | **Informational (base image)** | All 19 are under `/usr/local/lib`, the npm CLI bundled with the base image: undici (8), ip-address (5), brace-expansion (3), glob, minimatch and postcss-selector-parser (1 each). None are in the app's `/app/node_modules`, and the runtime command (`node dist/server.js`) never calls npm. Mitigation: remove npm from the runtime stage or use a distroless base |
| S7 | Trivy fs: npm dependencies | `functional-codebase/package-lock.json` | none | n/a | **No findings** | 0 known-vulnerable dependencies |
| S8–Sn | SonarQube Cloud issues and hotspots | **[YOU]** | **[YOU]** | **[YOU]** | **[YOU]** | Expect hotspots on the three `$executeRaw` calls. See §5 for why they are FPs |

**Not findings (scanner noise):** Semgrep reported 3 warnings. One was a rule timeout on the PA1 file
`pipeline-logs/run-41482256156/full-run.log`. The other two were partial-parse warnings in
`.github/workflows/devsecops.yml:169`. None of them affects coverage of the application code.

---

## 3. Confirmed vulnerabilities

Every finding below came from manual review, and the scanners caught only V6. Each **[YOU]** item
needs your hand test (§4) before the status changes from *Candidate* to *Confirmed*.

### V1: Missing authentication; caller-supplied identity can be spoofed

| Field | Value |
|---|---|
| Layer | Authentication |
| CWE | **CWE-306** Missing Authentication for Critical Function. Related: CWE-290 Authentication Bypass by Spoofing |
| Location | `src/services/actors.ts:15` (`requireActor`), called from `ticketService.ts:174` (approve and reject), `allocationService.ts:31` (allocate), `assetService.ts:197` (return). Identity also leaks through `repositories/ticketRepository.ts:22,38` (event `actor` includes `id`, `email`, `role`) |
| Status | Candidate → **[YOU]** Confirmed / Not confirmed |
| Severity | **[YOU]** (suggested: Critical) |

**Root cause (draft, rewrite in your own words) [YOU]:** The service has no authentication.
`requireActor` looks up whatever `actorId` the request body supplies and checks that person's role,
so the role check confirms a *claim*, not an identity. The IDs of the IT director and admins are
returned in every ticket's event log, so an anonymous caller can approve tickets and execute
allocations by sending those IDs.

**Evidence:** §4, V1 rows. Staff IDs were read from event logs, an anonymous `PUT` approved ticket `…0001` as `…0007`, and an anonymous `allocate` as `…0008` issued 2 keys.

### V2: Missing authorization on inventory and ticket management

| Field | Value |
|---|---|
| Layer | Authorization |
| CWE | **CWE-862** Missing Authorization |
| Location | `src/routes/assets.ts` (POST, PUT, DELETE: no actor parameter at all), `src/services/ticketService.ts:153` (content edits: `actorId` optional, `validation/schemas.ts:151`), `ticketService.ts:269` (`deleteTicket`) |
| Status | Candidate → **[YOU]** |
| Severity | **[YOU]** (suggested: High) |

**Root cause (draft) [YOU]:** Several write endpoints never ask who the caller is. Anyone can create
or retire assets, resize a pool, or raise a voucher pool's `creditTotal` (and with it the available
credit balance). Anyone can also edit the items of, or delete, any pending ticket.

**Evidence:** §4, V2 row. With no identity at all, the AWS pool went from `creditTotal` 25000 / `creditBalance` 20000 to 999999 / 994999.

### V3: License keys and voucher codes exposed to unauthenticated callers

| Field | Value |
|---|---|
| Layer | Data output / API response |
| CWE | **CWE-200** Exposure of Sensitive Information to an Unauthorized Actor |
| Location | `src/services/serializers.ts:81` (`serializeAllocation` spreads every column, including `token`), reached through `GET /api/v1/assets/allocations` and `GET /api/v1/assets/tickets/{id}` |
| Status | Candidate → **[YOU]** |
| Severity | **[YOU]** (suggested: High) |

**Root cause (draft) [YOU]:** The serializer copies the whole database row into the response.
`GET /assets/allocations?status=all` has no caller check and returns every issued key and code.

**Evidence:** §4, V3 row. An anonymous `GET /assets/allocations?status=all` returned 7 cleartext license, voucher and hardware tokens, and 9 after the V1 allocate.

### V4: Keys stored in cleartext

| Field | Value |
|---|---|
| Layer | Database |
| CWE | **CWE-312** Cleartext Storage of Sensitive Information |
| Location | `prisma/schema.prisma:232` (`Allocation.token String @unique`) and the migration |
| Status | Candidate → **[YOU]** |
| Severity | **[YOU]** (suggested: Medium) |

**Root cause (draft) [YOU]:** License keys and voucher codes are stored as plain text. Anyone with
read access to the database or a backup gets usable keys. This is the likely "designated sensitive
field" for PA3's application-layer encryption.

**Evidence [YOU]:** `docker compose exec db psql -U resourcehub -d resourcehub -c 'SELECT token FROM "Allocation" LIMIT 3;'`

### V5: Error messages reveal people, roles and schema details

| Field | Value |
|---|---|
| Layer | Error handling |
| CWE | **CWE-209** Generation of Error Message Containing Sensitive Information. Related: CWE-204 Observable Response Discrepancy |
| Location | `src/services/actors.ts:17,19`; `src/lib/errors.ts:61,65` (Prisma `err.meta` returned to the client) |
| Status | Candidate → **[YOU]** |
| Severity | **[YOU]** (suggested: Low) |

**Root cause (draft) [YOU]:** A 403 names the person and their role. A 400 says whether an ID exists,
which lets a caller enumerate valid IDs.

**Evidence:** §4, V5 rows. A 403 returned "…Dr. Elena Park is instructor", and a 400 returned "…does not reference a known person".

### V6: Container runs as root (= S1, S2)

| Field | Value |
|---|---|
| Layer | Deployment / container |
| CWE | **CWE-250** Execution with Unnecessary Privileges |
| Location | `functional-codebase/Dockerfile:51` (runtime stage has no `USER`) |
| Status | Flagged by 2 scanners. `docker compose exec app id -u` returned `0` (§4). **[YOU]** Set the verdict |
| Severity | **[YOU]** (suggested: Medium) |

**Root cause (draft) [YOU]:** The official Node image has a non-root `node` user, but the runtime stage
never switches to it. If the app is compromised, the attacker has root inside the container. This
was first raised in the PA1 feedback, and the generated baseline did not change it.

### V7 (optional): No limit on work per request

| Field | Value |
|---|---|
| Layer | Availability |
| CWE | CWE-770 Allocation of Resources Without Limits or Throttling |
| Location | Every GET calls `sweepOverdue()` (`assetService.ts:32`), which opens a write transaction. There is no rate limiting |
| Status | **[YOU]** Keep as Low, or move to §5 |

### How V1–V3 chain together (multi-layer attack path)

No single finding above is the whole story. Together they give an anonymous caller a complete path
from no knowledge to stolen keys, crossing four layers (data output → authentication → business
logic → data output). The §4 tests ran this exact chain:

1. **Recon (V3/V5, data output):** `GET /assets/tickets?status=closed`, then `GET /assets/tickets/{id}`. The event log returns staff `actor` objects with `id`, `email` and `role` (§4: IT director `…0007`; admins `…0008` and `…0009`).
2. **Spoof approval (V1, authentication):** `PUT /assets/tickets/{pending}` with `{"status":"approved","actorId":"…0007"}`. Accepted.
3. **Spoof allocation (V1, business logic):** `POST /assets/tickets/{id}/allocate` with `{"actorId":"…0008"}`. Inventory is deducted and keys are issued.
4. **Collect (V3, data output):** `GET /assets/allocations?status=all` returns every issued key and code, including the two just created (§4: 7 before, 9 after).

Separately, V2 lets the same anonymous caller mint voucher credit with one request (§4: AWS pool
from 25000/20000 to 999999/994999). This chain is a good root for an attack tree in
`security-analysis.md`.

---

## 4. Dynamic verification log

**Provenance:** Claude Code (`claude-opus-5-5`) ran these commands at the author's direction on 2026-11-16,
using the review notes' §5 commands verbatim plus `docker compose exec app id -u`. Target: the local Compose stack built from
`pa2` at `1234186`, `localhost:3000`, on unauthenticated requests. Before the run, the database matched the seed data
(2 pending, 2 approved, 3 allocated and 2 closed tickets; AWS pool `creditTotal` 25000, `creditBalance` 20000).
Rows marked *(supplementary)* are extra read-only checks that were not in §5. **[YOU]** Review the evidence and set each verdict.

| Date / time (EST) | Finding | Request | Observed response | Verdict |
|---|---|---|---|---|
| 2026-11-16 18:39:18 | V3 | `GET /assets/allocations?status=all&limit=200`, no identity | 7 tokens returned in cleartext, e.g. `HW-DL74-QW8N-5ZRT`, `VCH-AWS7-K2QF-M9ZD-R4TX`, `LIC-JB4QZ-7HXMP-R2NTD-9KWFA-C3VYE` (license, voucher and hardware codes). After the V1 allocate below, the same call returned 9 | **[YOU]** |
| 2026-11-16 18:39:18 | V1 | Event log of closed ticket `55555555-…0010` | `actor` objects with `id`, `name`, `email`, `role` for `…0005` Prof. Tomas Ortega (faculty_advisor) and **`…0007` Jordan Blake (it_director)**. This ticket did not reveal an admin ID | **[YOU]** |
| 2026-11-16 18:39:27 | V1 *(supplementary)* | Event logs of seeded allocated tickets `…0006`, `…0007`, `…0008` | Admin IDs exposed: **`…0008` Samira Khan** (tickets 0006, 0008) and **`…0009` Chris Noel** (ticket 0007), each with email and role | **[YOU]** |
| 2026-11-16 18:39:18 | V1 | `PUT /tickets/55555555-…0001 {"status":"approved","actorId":"…0007"}` | Accepted: the response body shows `"status":"approved"` for "Burp Suite seats and YubiKeys for secure coding labs". The event log later shows the transition `pending → approved` | **[YOU]** |
| 2026-11-16 18:39:18 | V1 | `POST /tickets/55555555-…0001/allocate {"actorId":"…0008"}` | Two keys issued to the anonymous caller: `LIC-M58KK-XPBZD-VLKWR-XNV8S-TGSXK`, `HW-9VFR-LWH5-PXG5`. The ticket is now `allocated` (events: `pending → approved → allocated`) | **[YOU]** |
| 2026-11-16 18:39:18 | V2 | `PUT /assets/44444444-…0011 {"creditTotal": 999999}`, no identity | `"creditTotal":999999`, `"creditBalance":994999` (was 25000 / 20000). 974,999 credit minted | **[YOU]** |
| 2026-11-16 18:39:19 | V5 | `allocate` with instructor `actorId …0001` | HTTP 403 `{"error":{"message":"Executing an allocation requires role admin; Dr. Elena Park is instructor"}}` | **[YOU]** |
| 2026-11-16 18:39:19 | V5 | `allocate` with unknown `actorId …00ff` | HTTP 400 `{"error":{"message":"actorId 11111111-0000-4000-8000-0000000000ff does not reference a known person"}}` | **[YOU]** |
| 2026-11-16 18:39:19 | V6 | `docker compose exec app id -u` | `0` (root) | **[YOU]** |

**Database state after these tests:** ticket `…0001` is allocated (2 new keys) and the AWS pool's `creditTotal` is 999999.
Reset with `docker compose down -v && docker compose up -d` in `functional-codebase/` before running anything else.

---

## 5. Checked and not vulnerable (supports FP verdicts)

| Concern | Why it is not a vulnerability here |
|---|---|
| SQL injection in `$executeRaw` (`assetService.ts:132,147`, `assetRepository.ts:118`) | Tagged-template calls: Prisma sends every `${}` value as a bind parameter, and no SQL is built from strings |
| Race condition on allocate (overspending stock) | The ticket claim is a status-guarded `updateMany`, and each deduction is a conditional `updateMany ... where availableStock >= qty`, all in one transaction. Covered by `allocation-flow.test.ts:244` |
| Negative quantities or credit | Zod (`quantity.min(1)`, `money` positive) and database `CHECK` constraints |
| Mass assignment | Every body schema is a Zod `strictObject`, so unknown fields are rejected |
| Weak token randomness | `crypto.randomBytes` with a 32-character alphabet (256 mod 32 = 0, so no modulo bias) |

---

## 6. Summary

| | Count |
|---|---|
| Raw scanner findings (Semgrep + Trivy fs + Trivy image + SonarQube) | **[YOU]** total after adding SonarQube |
| True positives from scanners | **[YOU]** (S1/S2 = 1 unique so far) |
| False positives | **[YOU]** (S3 so far, plus SonarQube) |
| Informational (base image) | S4–S6 |
| Confirmed vulnerabilities (all sources) | **[YOU]** (V1–V6 if all hand tests confirm) |
| Found **only** by manual review | **[YOU]** (V1–V5 if confirmed) |

**[YOU] Key observation (your words):** 266 Semgrep rules found only the Dockerfile issue. The most
serious flaws (V1–V3) are logic and design flaws. The code contains nothing a pattern matcher
recognizes as dangerous, so the scanners had nothing to catch.

**PA3 remediation scope:** the confirmed CWEs in §3 become the PA3 scope, together with 3 STRIDE threats from
`security-analysis.md`. List only what you have confirmed.

---

## Appendix A: Code review notes

> **Provenance:** Claude Code (`claude-opus-5-5`, Claude desktop app) wrote this appendix in a read-only
> review of `pa2` at `fb3b30f` on 2026-11-16. It was pasted here at the author's request, lightly
> edited for this report. It is context for the findings above, not independent human analysis.

### A.1 What the agent produced

| | |
|---|---|
| Commits | 6, all tagged `AI:`, 17:42–17:58 EST (about 16 minutes), one agent session, no follow-up prompts |
| Size | About 3,500 lines in 43 files (src about 1,700, tests about 820, migration 264, seed 226, README 347) |
| Tests | 48 Vitest + Supertest integration tests, all passing (locally and in CI run 43976561548) |
| Scope | Nothing outside `functional-codebase/` changed, and no dependencies were added |

### A.2 How the code is organized

Layered architecture: **route → validation → service → repository → Prisma/PostgreSQL**, with central
error middleware.

| Layer | Files | Job |
|---|---|---|
| App / routing | `src/app.ts`, `src/routes/*.ts` | `express.json` (100 kb limit), request logger, one `Router` per resource, 404 and error handlers |
| Validation | `src/validation/schemas.ts` | Zod `strictObject` schemas for every body, path parameter and query string |
| Services | `src/services/*.ts` | Business rules: role checks, ticket lifecycle, allocation engine, metrics |
| Repositories | `src/repositories/*.ts` | Prisma queries and filters (the Repository pattern) |
| Data | `prisma/schema.prisma`, migration | 8 models, 6 enums, plus 6 hand-written `CHECK` constraints |
| Cross-cutting | `src/lib/errors.ts`, `logger.ts`, `assetKinds.ts` | `HttpError` type, JSON-line logs, token generator |

**Trace of `POST /api/v1/assets/tickets/{id}/allocate`:**

1. `routes/tickets.ts` parses `ticket_id` as a UUID and the body with `allocateTicketSchema` (`actorId`, optional `note`).
2. `allocationService.allocateTicket` calls `requireActor(actorId, [admin])`, which loads the person named **in the request body** and checks their role. This is the V1 weakness: it verifies a claim, not an identity.
3. It then opens one Prisma interactive transaction:
   - It **claims the ticket** with `updateMany where {id, status: approved}` → `allocated`. If 0 rows change, it returns 409, which is why a second, concurrent allocate fails.
   - For each line, `deductStock` runs a **conditional** `updateMany where availableStock >= qty` (and `creditBalance >= credit`). If 0 rows change, it throws, and the whole transaction rolls back (all-or-nothing).
   - It creates one `Allocation` per line with a token from `issueToken()` (`crypto.randomBytes`), and a due date for physical items.
   - It writes a `TicketEvent` audit row and recomputes the pool status flags.
4. After the commit it reloads the ticket and returns it **with every allocation and its token**. This is the V3 weakness.

### A.3 Defenses the agent added without being asked

The prompt deliberately said nothing about security, validation or integrity. The agent still added:

- Zod `strictObject` on every input (unknown fields rejected, so no mass assignment), length limits, UUID checks, and page size capped at 200.
- Database `CHECK` constraints: stock and credit never negative or above total, quantity > 0, exactly one of course or lab.
- Concurrency guards (status-conditional updates) on allocate, return, edit and every ticket transition.
- Role checks (IT director approves, admin allocates, only the course instructor or lab advisor can request) and a `TicketEvent` audit trail.
- Cryptographically random tokens, a generic 500 message with no stack trace, and a 100 kb body limit.

**What this means for the triage:** the naive baseline is not naive about *input* or *integrity*. That
is why the race condition, negative quantities and mass assignment appear in §5 as checked and not
vulnerable. The weaknesses are concentrated in **authentication, authorization and confidentiality**:
the agent built role checks on top of an identity that nobody verifies. It even recorded this as
README assumption 1 ("No authentication... Identity is supplied in the request body"), treating it
as a gap in the spec rather than a risk.

### A.4 What the generated tests never try

All 48 tests check functionality and business rules. None of them sends a forged `actorId`, calls a
write endpoint with no identity, or checks that a response leaves out tokens. The test "only an
administrator can execute the allocation" passes because the test supplies an honest `actorId`.
Happy-path tests like these cannot reveal V1–V3.

### A.5 Why the scanners missed V1–V5

Semgrep ran 266 rules and reported only the Dockerfile `USER` issue (V6). Missing authentication, an
identity the caller supplies, missing authorization, and keys returned in responses are logic and
design flaws. Nothing in the code *looks* dangerous: no `eval`, no SQL built from strings, no
hard-coded secret, so pattern matching had nothing to match. The 245 Trivy image findings come from
the `node:24.22.2-slim` base image (226 Debian packages, plus 19 in the npm CLI under
`/usr/local/lib`), not from agent-generated code.
