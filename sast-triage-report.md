# SAST Triage Report: Resource Allocation & Help Desk Hub (PA2 naive baseline)

> **DRAFT SKELETON.** Claude prepared the structure, the scanner ledger and *suggested* verdicts.
> Everything marked **[YOU]** needs your own work, and every suggested verdict needs your review
> before submission. Delete this box when done.

## AI Deliverable Metadata Block

| Field | Value |
|---|---|
| Deliverable | `sast-triage-report.md` (PA2) |
| Author | Amber Rastella |
| AI tools | Claude Code in the Claude desktop app (Claude Opus 5.5, `claude-opus-5-5`): code review, report skeleton, scanner ledger, suggested verdicts |
| Human work | **[YOU]** For example: dynamic verification of every confirmed finding, final TP/FP decisions, root-cause explanations, SonarQube triage |
| Conceptual AI contribution | **[YOU]** Set a percentage when the report is finished, for example "~40% (structure and scanner ledger); verdicts and analysis human-verified" |
| Summary of design-aid prompts | "Review the generated code"; "Start a sast-triage-report.md skeleton with the scanner ledger filled in" |
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
| Manual review | Line-by-line reading of routes, services, repositories, validation, schema and migration |
| Dynamic verification | `curl` against the running Docker Compose stack, with seeded data. **[YOU]** Record the date and results in §4 |

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

**Evidence [YOU]:** results of the F1 commands (approve as `...0007`, allocate as `...0008`).

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

**Evidence [YOU]:** result of the `creditTotal: 999999` command.

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

**Evidence [YOU]:** count of `"token"` values returned by the F3 command.

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

### V6: Container runs as root (= S1, S2)

| Field | Value |
|---|---|
| Layer | Deployment / container |
| CWE | **CWE-250** Execution with Unnecessary Privileges |
| Location | `functional-codebase/Dockerfile:51` (runtime stage has no `USER`) |
| Status | Confirmed by 2 scanners. **[YOU]** add the `id -u` result |
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

---

## 4. Dynamic verification log

**[YOU]** One row per command you ran (the commands are in the review notes, §5).

| Date / time | Finding | Request | Observed response | Verdict |
|---|---|---|---|---|
| | V3 | `GET /assets/allocations?status=all` | | |
| | V1 | event log reveals staff IDs | | |
| | V1 | `PUT /tickets/{pending}` as `...0007` | | |
| | V1 | `POST /tickets/{id}/allocate` as `...0008` | | |
| | V2 | `PUT /assets/...0011 {creditTotal: 999999}` | | |
| | V5 | `allocate` with an instructor or unknown `actorId` | | |
| | V6 | `docker compose exec app id -u` | | |

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
