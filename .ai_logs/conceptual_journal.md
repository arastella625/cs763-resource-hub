# MASTER CONCEPTUAL JOURNAL & AI TELEMETRY LOG

* **Student Name:** Amber Rastella
* **Assigned Domain Module:** Domain 2: Resource Allocation & Help Desk Hub
* **Core Technology Stack:** Node.js 24 / TypeScript / Express 5 / Prisma 7 / PostgreSQL 17 / Docker

> **Provenance.** Created from `conceptual_journal_template.md`. Section 1 is facts from the logs.
> Sections 2.1–2.3 were **drafted by Claude Code (`claude-opus-5-5`) at the author's request** and
> are labelled as such. Sections 3.1, 3.2 and 4 record the author's own collaboration and checks.

================================================================================

## SECTION 1: SYSTEM ENVIRONMENT & TOOL SPECIFICATION

================================================================================

### 1.1 AI Tool & Engine Deployments

| Tool Context | Framework / Platform Name & Version | Underlying LLM Brain Model String | Operational Setting / Access Mode |
| :---- | :---- | :---- | :---- |
| **Code Generation** (PA2 naive build) | Claude Code CLI 2.1.316 (native install, WSL2 Ubuntu 24.04), launched from the repo root | `claude-opus-5-5`, effort `high` | Local terminal agent, auto permission mode; project settings: model pinned, auto-memory and claude.ai connectors off, `Read(**/spec.md)` denied (Agent_environment.md §4) |
| **Review / Document** (repo prep, code review, triage skeleton, hand tests) | Claude Code in the Claude desktop app (Windows), a separate session that is not the build agent | `claude-opus-5-5` | Desktop app, auto mode; work recorded in Agent_environment.md §6.1 and in the commit messages |
| *(Add a row only if another AI tool was used)* | | | |

### 1.2 Verification Telemetry Access Checklist

- [x] Primary auto-extracted session logs saved to `/.ai_logs/`: `pa2-session-1.jsonl` (PA2 build session `9afc6f30…`, email redacted)
- [ ] **[YOU]** Desktop review session (Claude desktop app, Code tab): this produced the code review, both reports, the dynamic tests and journal 2.1–2.3. Don't commit a raw export: it contains pasted course emails and classmates' discussion posts. Add a redacted export, or a summary of its prompts, here
- [ ] External Chat Cloud Share Link 1 (if applicable): none
- [ ] External Chat Cloud Share Link 2 (if applicable): none

================================================================================

## SECTION 2: COGNITIVE REFLECTION — CODE GENERATION & COMPREHENSION

================================================================================

### 2.1 The Architectural Flow (How You Understand the Code)

*Provide a rigorous, detailed architectural breakdown explaining the data path your AI tool generated for your core routes. Describe how an incoming HTTP request payload is captured by your framework, parsed by your middleware, processed via database queries, and safely closed or rolled back inside your transaction engine. State what design patterns (Repository, MVC, Singleton, etc.) the AI decided to adopt.*

> **AI-drafted (Claude Code).**

The agent built a layered service: **route → validation → service → repository → Prisma →
PostgreSQL**. Each resource has its own Express `Router` (`src/routes/`). Zod schemas
(`src/validation/schemas.ts`) parse every body, path parameter and query string. Business rules
live in services (`src/services/`), and database access is isolated in repositories
(`src/repositories/`). That is the Repository pattern behind a service layer, with one shared
`PrismaClient` (a module-level singleton in `src/lib/prisma.ts`) and central error middleware
(`src/lib/errors.ts`) that turns typed `HttpError`s, Zod errors and Prisma error codes into JSON
responses.

The core route, `POST /api/v1/assets/tickets/{id}/allocate`, shows the data path:

1. `express.json()` (100 kb limit) parses the body. The router validates `ticket_id` as a UUID and
   the body against `allocateTicketSchema` (`actorId`, optional `note`). Unknown fields are rejected.
2. `allocateTicket` calls `requireActor(actorId, [admin])`, which loads the person named in the
   body and checks their role.
3. A Prisma interactive transaction opens. First it **claims** the ticket with
   `updateMany({ where: { id, status: 'approved' }, data: { status: 'allocated' } })`. If zero rows
   change, the ticket wasn't approved or another request already claimed it, and it returns 409.
   This single conditional write is what makes a second, concurrent allocate fail.
4. For each ticket line, `deductStock` runs a conditional
   `updateMany where availableStock >= quantity (and creditBalance >= credit)`. The check and the
   subtraction happen in one SQL statement, so two requests can't both read "enough stock" and both
   subtract. If any line updates zero rows, the service throws, and Prisma rolls back the whole
   transaction, including the claim and earlier deductions (all-or-nothing).
5. It inserts one `Allocation` per line with a token from `crypto.randomBytes`, writes a
   `TicketEvent` audit row, and recomputes the pool status flags with parameterized raw SQL.
6. After the commit, it reloads the ticket and returns it, including every allocation's token.

Database `CHECK` constraints (non-negative stock and credit, available ≤ total, quantity > 0) back
up the application checks.

### 2.2 Defensive Edge-Case Evaluation (Line-by-Line Code Review)

*Perform a line-by-line human audit of the generated source code. Identify where the AI tool completely failed to account for edge cases, unusual boundaries, or unexpected system properties prior to running your pipeline scanners.*

> **AI-drafted (Claude Code).**

**Edge cases the agent missed:**

- **Who is calling.** `requireActor` (`src/services/actors.ts:15`) proves only that the supplied
  `actorId` exists and has the right role, not that the caller *is* that person. Every role check
  rests on this.
- **Edits with no identity.** In `updateTicketSchema`, `actorId` is required only when `status`
  changes (`schemas.ts:157`), so a `PUT` that only replaces `items` needs no identity at all. The
  same holds for `DELETE /tickets/{id}` and every asset write.
- **What a response contains.** `serializeAllocation` (`serializers.ts:81`) spreads the full row, so
  the `token` field reaches any caller of `GET /assets/allocations` or a ticket detail.
- **What an error reveals.** The 403 text includes the person's name and role, and the 400 text
  confirms whether an ID exists (`actors.ts:17,19`).
- **What a read does.** Every GET on assets, tickets or allocations runs `sweepOverdue()`, a write
  transaction, with no rate limit.

**Edge cases the agent did handle** (checked before the scanners ran): negative or zero quantities
(Zod `min(1)` plus a `CHECK` constraint), credit going below zero (conditional deduction), two
concurrent allocates (status-guarded claim; test `allocation-flow.test.ts:244`), malformed JSON
(400), unknown fields (strict schemas), and shrinking a pool below what is allocated (conditional
raw-SQL update, which returns 409).

### 2.3 The AI Agent's "Security Sins" (Evaluating Code Deficiencies)

*Reflect on the prompt sequence fed to your generation tool. Evaluate why it naturally generated insecure code under your happy-path functional prompt constraints. Detail what security shortcuts the model attempted to take to make the feature execute quickly, and analyze how easily it fell into standard vulnerability traps like BOLA/IDOR, Race Conditions, or input injection.*

> **AI-drafted (Claude Code).**

The prompt was purely functional, and the master spec says nothing about authentication, so the
agent met the letter of the spec. It still added a lot of defensive engineering on its own: strict
Zod validation, database `CHECK` constraints, concurrency guards, an audit table and cryptographic
token generation. So it did **not** fall into the classic traps of race conditions, injection or
negative balances. Those protect *data integrity*, which a model is trained to treat as part of
"working code."

The shortcut it took was on **identity**. To make the role rules in the spec work ("IT director
sign-off", "an administrator executes the allocation") without an authentication system, it took
the caller's identity from the request body and checked that person's role. That makes the feature
run and the tests pass, but every authorization decision trusts the client. It recorded this
openly as README assumption 1, as a gap in the spec, not as a risk. The result is the BOLA/IDOR
family of flaws in a different form: no records belonging to others are guessed, because no caller
is ever verified in the first place.

The same "make it work" bias shows in the serializer (spreading whole rows, which exposes tokens)
and in helpful error messages that name people and roles. The generated tests confirm the honest
path only: none of the 48 tests sends a forged `actorId`, so the suite passes while the main
control can be bypassed.

================================================================================

## SECTION 3: COGNITIVE REFLECTION — DOCUMENT AUTHORING & THREAT DESIGN

================================================================================

### 3.1 AI Collaboration Matrix for Security Analysis

*Detail exactly how you collaborated with your chosen AI tools to construct your written security requirements, abuse cases, attack trees, and threat modeling frameworks.*

**Facts from the logs (for context):** Claude Code (desktop app) planned the PA2 work, prepared the
repository, reviewed the generated code, and wrote `sast-triage-report.md` and
`security-analysis.md`. It also ran the dynamic tests and drafted journal sections 2.1–2.3. The
author directed the work turn by turn (multi-turn chaining) and approved each step.

Throughout PA2, I acted as the technical reviewer and director while using Claude Code to handle heavy lifting like repo setup, dynamic testing, and initial drafts of security-analysis.md, sast-triage-report.md, and sections 2.1–2.3. Using multi-turn chaining, I broke the work into controlled checkpoints—asking the tool to tackle one security artifact at a time and approving each output before continuing. Along the way, I audited its code reviews and threat modeling frameworks against the real implementation, tightening up the abuse cases and requirements to make sure nothing was hallucinated or overly generic.

### 3.2 Evaluation of Automated Conceptual "Blind Spots"

*Analyze the output your document-authoring AI generated. Did the tool hallucinate security threat concepts, overlook critical domain-specific logical risks, or suggest generic text summaries that lacked rigorous engineering context? Detail how you manually audited and revised the AI's structural concepts to match real-world parameters.*

**AI errors recorded during the work (facts):**

- Claude first mapped V1 to CWE-639 (a record-ID guessing weakness), then corrected it to
  CWE-306/CWE-290, because the flaw is a caller *claiming* someone else's identity.
- It miscounted scanner output twice (the Trivy image total as 246 instead of 245, and the Debian
  high-severity count as 42 instead of 37) and corrected both when checking its own numbers.
- Its first walkthrough gave `gh run download RUN_ID` with a literal placeholder. Run as written,
  it failed with HTTP 404, and the bare download also pulled a 106 MB image artifact.

What jumped out to me most during review was the broken gh run download RUN_ID walkthrough—which failed with a 404 and pulled down an unnecessary 106 MB image—as well as the early CWE-639 mapping for V1 that missed the actual authentication spoofing root cause (CWE-306/CWE-290). Seeing those mistakes alongside the miscounted Trivy and Debian severity totals made it clear that LLMs frequently trade precision for plausibility, especially when translating raw scanner output or operational steps into prose. For security engineering work, AI is useful for structuring drafts, but human auditing is non-negotiable for verifying threat classifications, exact metrics, and runnable commands.

================================================================================

## SECTION 4: HUMAN VERIFICATION & AUDIT TRAIL LOG

================================================================================

*Record every manual configuration test, integration check, dynamic execution verification (Postman, cURL loops), or tool scan triage loop handled completely by you by hand.*

> *Only checks the author ran personally are listed here. The full dynamic test set in
> `sast-triage-report.md` §4 was run by Claude Code and is recorded there.*
> **[YOU] Optional, about 3 minutes:** add a row for each command in the walkthrough's
> "Run a few hand tests yourself" step that you run.

| Timestamp | Component Target | Testing/Auditing New Methodology | Verified Outcome / Discovered Defect |
| :---- | :---- | :---- | :---- |
| 2026-11-16 ~18:02 EST | `functional-codebase` stack | Ran `docker compose up --build -d`, `curl` on `/assets` and `/assets/tickets`, then `npm test` | Stack healthy with seeded data; 48/48 tests passed |
| 2026-11-16 ~18:05 EST | `.ai_logs/pa2-session-1.jsonl` | Searched the exported transcript for any Read or `cat` of `spec.md`, and for secrets | No `spec.md` access; only placeholder passwords |
