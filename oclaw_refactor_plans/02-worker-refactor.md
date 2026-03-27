# Worker Refactor Plan — `apps/worker`

> **Scope:** `apps/worker/src/` only  
> **Constraint:** No auth added, all features preserved, no breaking changes  
> **Goal:** Simpler, more structured, cleaner, cooler code

---

## Table of Contents

1. [Current State Audit](#1-current-state-audit)
2. [Proposed File/Folder Structure](#2-proposed-filefolder-structure)
3. [Handler Refactors](#3-handler-refactors)
4. [Queue Layer Design](#4-queue-layer-design)
5. [Error Handling](#5-error-handling)
6. [Testing Improvements](#6-testing-improvements)
7. [Estimated Complexity](#7-estimated-complexity)
8. [Migration Path](#8-migration-path)

---

## 1. Current State Audit

### Summary

`apps/worker/src/index.ts` is **~950 lines** of a single flat file containing:
- All TypeScript type definitions
- All SQL query strings (7 distinct queries)
- All job handler logic (5 handlers)
- Queue claim/ack/fail/heartbeat machinery
- Polling loop + reclaim loop + maintenance loop
- Startup sequencing
- Logging utility
- Error classification helpers

This is a monolith-in-a-file. Every problem below is a consequence of that.

---

### Problem Catalogue

#### 1.1 Type Definitions Inlined at Top

```typescript
// All in index.ts, mixed with SQL constants:
type JobType = "process_video" | "transcribe_video" | "generate_ai" | "cleanup_artifacts" | "deliver_webhook";
type JobPayload = Record<string, unknown>;
type JobRow = { id: number; video_id: string; job_type: JobType; ... };
type FailResult = { id: number; status: "queued" | "dead"; };
type ProcessResponse = { resultKey: string; thumbnailKey: string; ... };
type ProcessingPhase = keyof typeof PROCESSING_PHASE_META;
```

These types are shared across all handlers but live only in the index file. Any extracted file needs to import from index or duplicate them.

---

#### 1.2 SQL Constants as Module-Level Strings

Seven SQL query strings (`CLAIM_SQL`, `MARK_RUNNING_SQL`, `HEARTBEAT_SQL`, `ACK_SQL`, `FAIL_SQL`, `RECLAIM_SQL`, `CLEANUP_MAINTENANCE_SQL`) all live as raw template literals at the top of `index.ts`. Problems:

- No type safety on parameter positions — `$1`, `$2`, `$3` are just magic numbers
- `claimOne()` mutates `CLAIM_SQL` string via `.replace()` to add `NOT IN` filter — this is fragile string manipulation
- SQL is interleaved with TypeScript, making it hard to audit either

```typescript
// BAD: runtime string mutation
const sql = excludeTypes.length > 0
  ? CLAIM_SQL.replace("WHERE status IN ('queued', 'leased')", `WHERE status IN ('queued', 'leased') AND job_type NOT IN (${excludeTypes.map((_, i) => `$${i + 4}`).join(",")})`)
  : CLAIM_SQL;
```

---

#### 1.3 `PROCESSING_PHASE_META` is a Hidden Constant

```typescript
const PROCESSING_PHASE_META = {
  queued: { rank: 10, progress: 5 },
  // ...
} as const;
```

This is a domain constant that should live near the types, not buried at line ~50 of index.ts. It is referenced across multiple handlers.

---

#### 1.4 `claimOne()` Does Dynamic SQL Injection

The `claimOne` function dynamically splices an `AND job_type NOT IN (...)` clause into the SQL string by string replacement. This is:
- Fragile (depends on exact whitespace match of the `WHERE` clause)
- Hard to test
- A maintenance hazard (changing the base query could silently break the replacement)

A parameterized approach or two separate SQL constants is far safer.

---

#### 1.5 `handleJob()` Is a Redundant Dispatcher

```typescript
async function handleJob(job: JobRow): Promise<void> {
  await ensureVideoNotDeleted(job, "before_handle");

  if (job.job_type === "process_video") { await handleProcessVideo(job); return; }
  if (job.job_type === "transcribe_video") { await handleTranscribeVideo(job); return; }
  // ...
  throw new Error(`unsupported job type: ${job.job_type} `);
}
```

And then `processJob()` also has a special case that bypasses `handleJob()` entirely:

```typescript
// In processJob():
if (job.job_type === "cleanup_artifacts") {
  await handleCleanupArtifacts(job);
  return;
}
await handleJob(job);
```

`cleanup_artifacts` is routed **twice differently** from every other job type. This is a logic bug waiting to happen — `ensureVideoNotDeleted` is skipped for `cleanup_artifacts` via the bypass, but `handleJob()` would call it if the bypass weren't there. The routing is split across two functions with inconsistent branching.

---

#### 1.6 Handler Functions Are 100–200 Lines Each

| Handler | Approx. Lines |
|---------|--------------|
| `handleProcessVideo` | ~130 |
| `handleTranscribeVideo` | ~100 |
| `handleGenerateAi` | ~110 |
| `handleCleanupArtifacts` | ~50 |
| `handleDeliverWebhook` | ~30 |

Each handler contains: DB read/lock, status guard, external I/O, DB finalize, downstream job enqueue, and ack. That is too many responsibilities per function.

---

#### 1.7 Duplicate Downstream Job Enqueue Pattern

Both `handleProcessVideo` and `handleTranscribeVideo` contain identical dead-job reset + insert logic:

```typescript
// First try to reset any existing dead job
const resetResult = await client.query(
  `UPDATE job_queue SET status = 'queued', attempts = 0, run_after = now(),
   last_error = NULL, updated_at = now()
   WHERE video_id = $1::uuid AND job_type = $2 AND status = 'dead' RETURNING id`,
  [job.video_id, 'transcribe_video']  // or 'generate_ai'
);

// If no dead job was reset, insert a new one
if ((resetResult.rowCount ?? 0) === 0) {
  await client.query(`INSERT INTO job_queue ...`);
}
```

This 15-line pattern is copy-pasted twice. It should be a single `enqueueDownstream(client, videoId, jobType)` function.

---

#### 1.8 Inconsistent Trailing Spaces in SQL

Several SQL queries have trailing spaces in values that appear to be typos:

```typescript
return { skip: true as const, reason: `status_${row.ai_status} ` };  // trailing space
//                                                              ^^^
```

```sql
WHERE id = $1:: uuid   -- space before uuid
```

These are cosmetic but indicate the file has grown without review passes.

---

#### 1.9 `markTerminalFailure` Is a Separate DB Round-Trip After `fail()`

When a job exhausts its retry budget:

```typescript
const failed = await fail(job, errorMessage, isFatal);
if (failed?.status === "dead") {
  await markTerminalFailure(job, errorMessage);
}
```

`fail()` updates `job_queue`. Then `markTerminalFailure()` opens a *second* transaction to update `videos`. These should either be a single transaction or the video state update should be part of the fail path. Two separate transactions create a window where `job_queue.status = 'dead'` but `videos.processing_phase != 'failed'`.

---

#### 1.10 `handleCleanupArtifacts` Re-Initializes S3 Client

```typescript
async function handleCleanupArtifacts(job: JobRow): Promise<void> {
  // ...
  const { client: s3Client, bucket } = getS3ClientAndBucket(process.env);  // re-init!
```

The module-level `s3Client` and `s3Bucket` are already initialized at startup. This handler re-initializes them from `process.env` — a subtle inconsistency that would only manifest if env changed at runtime (it never does, but it's still wrong).

---

#### 1.11 `processJob()` Mixed Heartbeat and Handler Concerns

```typescript
async function processJob(job: JobRow): Promise<void> {
  await withTransaction(env.DATABASE_URL, async (client) => {
    await markRunning(client, job);
  });

  const stopHeartbeat = startHeartbeatLoop(job);

  try {
    const alive = await heartbeat(job);  // immediate heartbeat check before handler
    if (!alive) throw new Error(`lease expired before handling job ${job.id} `);
    
    if (job.job_type === "cleanup_artifacts") {  // special case bypass
      await handleCleanupArtifacts(job);
      return;
    }
    await handleJob(job);
    // ...
  } catch (error) {
    if (error instanceof DeletedVideoSkipError) {  // special error handling
      await withTransaction(...)  // ack path
      return;
    }
    // standard fail path
  } finally {
    stopHeartbeat();
  }
}
```

`processJob` is doing: transition-to-running, heartbeat start, pre-flight heartbeat check, routing, error classification, ack-on-delete, fail-on-error. That's 6 responsibilities.

---

#### 1.12 No Handler Registry / Dispatch Table

The handler dispatch is done with `if/else if` chains. Adding a new job type requires modifying two places (`handleJob` + `processJob`), and there's no compile-time guarantee all `JobType` values are handled.

---

#### 1.13 `main()` Loop Has No Concurrency Guard

The polling loop is:

```typescript
while (true) {
  const job = await claimOne(excludeTypes);
  if (job) await processJob(job);  // blocks the loop
  await new Promise((resolve) => setTimeout(resolve, env.WORKER_POLL_MS));
}
```

This is strictly serial — one job at a time. That's a valid design choice for a single-worker, but it's not documented as intentional. If concurrency is ever desired, the architecture change would be non-trivial. The intent should be explicit.

---

#### 1.14 `groq.ts` Has Two Parallel Fetch Paths with Duplicated System Prompts

`providers/groq.ts` exports one function `summarizeWithGroq` which internally branches into `generateSingleChunk` and `generateMultipleChunks`. Both functions contain:
- Their own `fetch` call to the Groq API
- Their own `AbortController` / timeout management
- Largely overlapping normalization logic
- Extensive inlined system prompt strings (300+ chars each)

The system prompts should be extracted as named constants. The fetch/retry wrapper should be a shared internal helper.

---

#### 1.15 Groq `AbortController` / Timeout Lifetime Is Wrong in Multi-Chunk Path

```typescript
export async function summarizeWithGroq(args: { ... timeoutMs: number; ... }): Promise<GroqSummary> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), args.timeoutMs);
  // ...
  return generateSingleChunk(url, args, ..., controller, timeout);
  // OR
  return generateMultipleChunks(url, args, ..., controller, timeout);
}
```

`generateMultipleChunks` loops over N chunks, each making its own fetch call — all sharing the same `controller` and `timeout`. If the overall timeout fires mid-loop, all subsequent chunk fetches are aborted. But the timeout is *per-call*, not per-chunk. For a long transcript, this could silently truncate results.

The `finally { clearTimeout(timeout); }` is inside `generateSingleChunk` but the `timeout` was created *outside* in the caller. If `generateMultipleChunks` is called instead, the timeout is never cleared.

---

#### 1.16 `CLEANUP_MAINTENANCE_SQL` Runs Two Statements in One Query

```typescript
const CLEANUP_MAINTENANCE_SQL = `
DELETE FROM idempotency_keys WHERE expires_at < now();
DELETE FROM webhook_events WHERE created_at < now() - interval '7 days';
`;
```

The `pg` driver's `client.query()` does not guarantee multi-statement execution behavior the same way `psql` does. This works in practice with the `pg` driver because it passes through to libpq, but it's not idiomatic — it should be two explicit `await client.query(...)` calls.

---

#### 1.17 No Structured Handler Context / Dependencies

Every handler receives only a `JobRow`. To do anything useful, they close over module-level `env`, `s3Client`, `s3Bucket` globals. This makes:
- Testing handlers in isolation nearly impossible without module mocking
- Dependency injection infeasible

---

## 2. Proposed File/Folder Structure

```
apps/worker/src/
├── index.ts                    # ~80 lines: startup, polling loop, orchestration only
├── types.ts                    # All shared types + PROCESSING_PHASE_META
│
├── queue/
│   ├── index.ts                # Re-exports public queue API
│   ├── sql.ts                  # All SQL constants (named, documented)
│   ├── claim.ts                # claimOne(), reclaimExpiredLeases()
│   ├── lifecycle.ts            # ack(), fail(), markRunning(), heartbeat(), startHeartbeatLoop()
│   └── maintenance.ts          # runMaintenance()
│
├── handlers/
│   ├── index.ts                # Handler registry (dispatch table)
│   ├── context.ts              # HandlerContext type + createHandlerContext()
│   ├── process-video.ts        # handleProcessVideo()
│   ├── transcribe-video.ts     # handleTranscribeVideo()
│   ├── generate-ai.ts          # handleGenerateAi()
│   ├── cleanup-artifacts.ts    # handleCleanupArtifacts()
│   └── deliver-webhook.ts      # handleDeliverWebhook()
│
├── lib/
│   ├── ffmpeg.ts               # (existing — no changes needed)
│   ├── s3.ts                   # (existing — no changes needed)
│   └── transcript.ts           # (existing — no changes needed)
│
└── providers/
    ├── deepgram.ts             # (existing — minor prompt extraction)
    ├── deepgram.test.ts        # (existing)
    ├── groq.ts                 # (refactored — extract prompts, fix timeout bug)
    └── groq.test.ts            # (existing)
```

---

## 3. Handler Refactors

### 3.1 Handler Context

Every handler should receive a `HandlerContext` instead of closing over globals:

```typescript
// handlers/context.ts

import type { S3Client } from "@aws-sdk/client-s3";
import type { Env } from "@cap/config";

export type HandlerContext = {
  env: Env;
  s3Client: S3Client;
  s3Bucket: string;
};

export function createHandlerContext(env: Env): HandlerContext {
  const { client, bucket } = getS3ClientAndBucket();
  return { env, s3Client: client, s3Bucket: bucket };
}
```

All handlers become:

```typescript
export async function handleProcessVideo(job: JobRow, ctx: HandlerContext): Promise<void>
```

This makes handlers independently testable with injected mock context.

---

### 3.2 Handler Registry (Dispatch Table)

```typescript
// handlers/index.ts

import type { JobRow } from "../types.js";
import type { HandlerContext } from "./context.js";
import { handleProcessVideo } from "./process-video.js";
import { handleTranscribeVideo } from "./transcribe-video.js";
import { handleGenerateAi } from "./generate-ai.js";
import { handleCleanupArtifacts } from "./cleanup-artifacts.js";
import { handleDeliverWebhook } from "./deliver-webhook.js";

type Handler = (job: JobRow, ctx: HandlerContext) => Promise<void>;

export const HANDLERS: Record<string, Handler> = {
  process_video: handleProcessVideo,
  transcribe_video: handleTranscribeVideo,
  generate_ai: handleGenerateAi,
  cleanup_artifacts: handleCleanupArtifacts,
  deliver_webhook: handleDeliverWebhook,
};

export function getHandler(jobType: string): Handler {
  const handler = HANDLERS[jobType];
  if (!handler) throw new Error(`unsupported job type: ${jobType}`);
  return handler;
}
```

This eliminates the `if/else if` chain and ensures the dispatch table is the canonical list of supported job types.

---

### 3.3 Shared `enqueueDownstream` Utility

Extract the repeated dead-job-reset + insert pattern:

```typescript
// queue/lifecycle.ts (or handlers/context.ts)

export async function enqueueDownstream(
  client: PoolClient,
  videoId: string,
  jobType: JobType,
  priority: number,
  maxAttempts: number
): Promise<void> {
  const reset = await client.query(
    `UPDATE job_queue
     SET status = 'queued', attempts = 0, run_after = now(),
         last_error = NULL, updated_at = now()
     WHERE video_id = $1::uuid AND job_type = $2 AND status = 'dead'
     RETURNING id`,
    [videoId, jobType]
  );

  if ((reset.rowCount ?? 0) === 0) {
    await client.query(
      `INSERT INTO job_queue (video_id, job_type, status, priority, run_after, payload, max_attempts)
       VALUES ($1::uuid, $2, 'queued', $3, now(), '{}'::jsonb, $4)
       ON CONFLICT (video_id, job_type) WHERE status IN ('queued', 'leased', 'running')
       DO UPDATE SET updated_at = now()`,
      [videoId, jobType, priority, maxAttempts]
    );
  }
}
```

Both `handleProcessVideo` and `handleTranscribeVideo` call this instead of copy-pasting.

---

### 3.4 `handleProcessVideo` Refactor

**Current issues:**
- 130 lines including multiple nested `withTransaction` calls
- Runs `updateProcessingPhase` four times in rapid succession (`probing → processing → uploading → generating_thumbnail`) when those phases are simulated, not real
- Phase transitions are cosmetic fast-forwards rather than reflecting actual work state

**Proposed approach:**
- Split into `preflightProcessVideo(job, ctx)` → `{ skip, rawKey }` and `finalizeProcessVideo(job, ctx, mediaResult)`
- The phase fast-forward (`probing → generating_thumbnail`) should be a single `setProcessingComplete(client, job, mediaResult)` helper that writes all fields in one UPDATE
- Remove the four artificial `updateProcessingPhase` calls between `probing` and `complete` — they happen inside a single transaction with no observable intermediate state, making them pure noise

**Before (inside finalize transaction):**
```typescript
await updateProcessingPhase(client, job, "probing");
await updateProcessingPhase(client, job, "processing");
await updateProcessingPhase(client, job, "uploading");
await updateProcessingPhase(client, job, "generating_thumbnail");

await client.query(
  `UPDATE videos SET processing_phase = 'complete', ...`
```

**After:**
```typescript
await client.query(
  `UPDATE videos
   SET processing_phase = 'complete',
       processing_phase_rank = 70,
       processing_progress = 100,
       result_key = $2,
       thumbnail_key = $3,
       ...
   WHERE id = $1::uuid AND deleted_at IS NULL
     AND processing_phase_rank < 70`,
  [job.video_id, mediaResult.resultKey, ...]
);
```

Four round-trips become one.

---

### 3.5 `handleTranscribeVideo` Refactor

**Current issues:**
- `ensureVideoNotDeleted` is called mid-handler (between VTT upload and DB finalize) but is unnecessary — the finalize transaction re-checks `deleted_at` with a `FOR UPDATE` lock anyway
- The `ack()` call inside the finalize transaction is fine but the skip-ack outside isn't DRY (same `withTransaction(ack)` pattern appears 3 times)

**Proposed changes:**
- Remove standalone `ensureVideoNotDeleted` call before VTT upload; rely on the finalize transaction's `FOR UPDATE` check
- Extract `skipAndAck(job, reason)` helper for the three skip paths

---

### 3.6 `handleGenerateAi` Refactor

**Current issues:**
- Trailing space in status reason strings: `` `status_${row.ai_status} ` ``
- SQL has `$1:: uuid` (space before `uuid`) — cosmetic but wrong
- `chaptersJson` is built inline with complex ternary logic that should be a named function

**Proposed changes:**
- Fix trailing spaces and SQL typos
- Extract `buildChaptersPayload(summary: GroqSummary): ChapterRecord[]` function
- The `INSERT INTO ai_outputs ... ON CONFLICT` query should use consistent indentation

---

### 3.7 `handleCleanupArtifacts` Refactor

**Current issues:**
- Re-initializes `S3Client` from `process.env` instead of using injected context
- Three separate SELECT queries to gather keys (videos, uploads, transcripts) — could be one JOIN

**Proposed changes:**
- Use `ctx.s3Client` and `ctx.s3Bucket`
- Consolidate key collection into one query:

```sql
SELECT
  v.thumbnail_key,
  v.result_key,
  u.raw_key,
  t.vtt_key
FROM videos v
LEFT JOIN uploads u ON u.video_id = v.id
LEFT JOIN transcripts t ON t.video_id = v.id
WHERE v.id = $1::uuid
```

Four round-trips (one tx + three queries) become one query.

---

### 3.8 `handleDeliverWebhook` Refactor

**Current issues:**
- Payload is cast with inline type annotation rather than validated
- No explicit `idempotency_keys` or `webhook_events` write for outbound delivery auditing
- Missing timeout on the outbound `fetch` call

**Proposed changes:**
- Add `AbortSignal.timeout(ctx.env.PROVIDER_TIMEOUT_MS)` to the outbound fetch
- Validate payload shape at handler entry with a simple type guard

---

## 4. Queue Layer Design

All queue SQL and machinery moves to `src/queue/`.

### 4.1 `queue/sql.ts` — Named, Documented Constants

```typescript
// queue/sql.ts

/** Atomically claim up to N jobs, excluding given types. */
export const SQL_CLAIM = `
WITH candidates AS (
  SELECT id
  FROM job_queue
  WHERE status IN ('queued', 'leased')
    AND run_after <= now()
    AND attempts < max_attempts
    AND (status = 'queued' OR locked_until < now())
  ORDER BY priority DESC, run_after ASC, id ASC
  FOR UPDATE SKIP LOCKED
  LIMIT $1
)
UPDATE job_queue j
SET
  status       = 'leased',
  locked_by    = $2,
  locked_until = now() + $3::interval,
  lease_token  = gen_random_uuid(),
  attempts     = j.attempts + 1,
  last_attempt_at = now(),
  last_error   = NULL,
  updated_at   = now()
FROM candidates c
WHERE j.id = c.id
RETURNING j.id, j.video_id, j.job_type, j.lease_token, j.payload, j.attempts, j.max_attempts;
`;

/** Variant with job_type exclusion filter — $4...$N are excluded types. */
export function buildClaimSql(excludeCount: number): string {
  if (excludeCount === 0) return SQL_CLAIM;
  const placeholders = Array.from({ length: excludeCount }, (_, i) => `$${i + 4}`).join(", ");
  return SQL_CLAIM.replace(
    "WHERE status IN ('queued', 'leased')",
    `WHERE status IN ('queued', 'leased') AND job_type NOT IN (${placeholders})`
  );
}

export const SQL_MARK_RUNNING = `...`;
export const SQL_HEARTBEAT = `...`;
export const SQL_ACK = `...`;
export const SQL_FAIL = `...`;
export const SQL_RECLAIM = `...`;
export const SQL_MAINTENANCE_CLEANUP = `DELETE FROM idempotency_keys WHERE expires_at < now()`;
export const SQL_MAINTENANCE_WEBHOOKS = `DELETE FROM webhook_events WHERE created_at < now() - interval '7 days'`;
```

Key change: `buildClaimSql(n)` is a pure function that takes the count of excluded types and returns the appropriate SQL. The string mutation is still there, but it's isolated, named, and testable in isolation.

### 4.2 `queue/lifecycle.ts` — Typed Queue Operations

```typescript
// queue/lifecycle.ts

export async function ack(client: PoolClient, job: JobRow): Promise<void> { ... }
export async function fail(job: JobRow, error: unknown, fatal = false): Promise<FailResult | null> { ... }
export async function markRunning(client: PoolClient, job: JobRow): Promise<void> { ... }
export async function heartbeat(job: JobRow, env: WorkerEnv): Promise<boolean> { ... }
export function startHeartbeatLoop(job: JobRow, env: WorkerEnv): () => void { ... }
```

Note: `heartbeat` and `startHeartbeatLoop` currently close over the module-level `env`. Passing `env` as a parameter removes the global dependency.

### 4.3 `queue/claim.ts` — Claim and Reclaim

```typescript
// queue/claim.ts

export async function claimOne(
  env: WorkerEnv,
  excludeTypes: JobType[] = []
): Promise<JobRow | null> { ... }

export async function reclaimExpiredLeases(env: WorkerEnv): Promise<void> { ... }
```

### 4.4 `queue/maintenance.ts`

```typescript
// queue/maintenance.ts

export async function runMaintenance(databaseUrl: string): Promise<void> {
  await withTransaction(databaseUrl, async (client) => {
    await client.query(SQL_MAINTENANCE_CLEANUP);
    await client.query(SQL_MAINTENANCE_WEBHOOKS);
  });
}
```

Two explicit queries instead of one multi-statement string.

---

## 5. Error Handling

### 5.1 Current Problems

1. Error classification (`isFatalError`) is a loose duck-type check: `"fatal" in error && error.fatal === true`. It works but is invisible to TypeScript.
2. `DeletedVideoSkipError` is defined and caught in `processJob` but never thrown by handlers — it can only reach `processJob` through `handleJob` → `ensureVideoNotDeleted`. If a handler skips `ensureVideoNotDeleted` or calls it outside the try block, the error wouldn't be caught.
3. `markTerminalFailure` and `fail` are separate transactions. A crash between them leaves state inconsistent.

### 5.2 Centralized Error Types

```typescript
// types.ts

/** Marks an error as non-retryable. Worker will set job to 'dead' immediately. */
export class FatalJobError extends Error {
  readonly fatal = true as const;
  constructor(message: string, public readonly cause?: unknown) {
    super(message);
    this.name = "FatalJobError";
  }
}

/** Signals that the video was deleted; job should be acked, not failed. */
export class VideoDeletedError extends Error {
  constructor(public readonly videoId: string) {
    super(`video ${videoId} deleted`);
    this.name = "VideoDeletedError";
  }
}
```

Providers throw `FatalJobError` for auth failures:

```typescript
// Before (in deepgram.ts):
const error: FatalError = new Error(`deepgram request failed (${response.status}): ${detail}`);
if (response.status === 401 || response.status === 403) {
  error.fatal = true;
}
throw error;

// After:
if (response.status === 401 || response.status === 403) {
  throw new FatalJobError(`deepgram auth failed (${response.status}): ${detail}`);
}
throw new Error(`deepgram request failed (${response.status}): ${detail}`);
```

### 5.3 Atomic Terminal Failure

Combine `fail()` and `markTerminalFailure()` into a single transaction path:

```typescript
// queue/lifecycle.ts

export async function failJob(
  job: JobRow,
  error: unknown,
  env: WorkerEnv,
  options: { fatal?: boolean } = {}
): Promise<void> {
  const isFatal = options.fatal || error instanceof FatalJobError;
  const errorMessage = error instanceof Error ? error.message : String(error);

  await withTransaction(env.DATABASE_URL, async (client) => {
    const result = await client.query<FailResult>(SQL_FAIL, [
      job.id, env.WORKER_ID, job.lease_token, errorMessage, isFatal
    ]);

    const row = result.rows[0];
    if (row?.status === "dead") {
      // Update video state in the same transaction — no gap
      await applyTerminalFailure(client, job, errorMessage);
    }
  });
}
```

### 5.4 `processJob` Error Handler Simplified

```typescript
// After refactor — processJob catch block:
} catch (error) {
  if (error instanceof VideoDeletedError) {
    await withTransaction(env.DATABASE_URL, (client) => ack(client, job));
    log("job.acked", { job_id: job.id, reason: "video_deleted" });
    return;
  }

  await failJob(job, error, env);
  log("job.failed", { job_id: job.id, error: String(error), attempts: job.attempts });
}
```

---

## 6. Testing Improvements

### 6.1 Current Test Coverage

Only `providers/deepgram.test.ts` and `providers/groq.test.ts` exist. Zero tests for:
- Queue layer (claim, ack, fail, heartbeat)
- Any handler
- `processJob` orchestration
- `claimOne` with excluded types
- Error classification

### 6.2 Per-Handler Unit Test Strategy

With `HandlerContext` injected, each handler becomes independently testable.

#### Pattern: Mock `withTransaction` and external calls

```typescript
// handlers/process-video.test.ts

import { describe, it, expect, vi, beforeEach } from "vitest";
import { handleProcessVideo } from "./process-video.js";

vi.mock("@cap/db", () => ({
  withTransaction: vi.fn()
}));

const mockCtx: HandlerContext = {
  env: { ...mockEnv, MEDIA_SERVER_BASE_URL: "http://mock-media" },
  s3Client: {} as S3Client,
  s3Bucket: "test-bucket"
};

describe("handleProcessVideo", () => {
  it("skips already-complete videos", async () => {
    // Setup withTransaction to return { skip: true, reason: "already_terminal" }
    // Assert ack is called, handler returns cleanly
  });

  it("calls media server and finalizes on success", async () => {
    // Setup withTransaction to return { skip: false, rawKey: "raw/test.mp4" }
    // Mock fetch for /process
    // Assert videos UPDATE and job enqueue happen
  });

  it("marks terminal failure on fatal media server error", async () => {
    // Setup fetch to return 500
    // Assert fail() is called
  });
});
```

#### Per-handler test file targets:

| Test File | Key Scenarios |
|-----------|--------------|
| `handlers/process-video.test.ts` | skip-already-complete, skip-deleted, success+has-audio, success+no-audio, media-server-error |
| `handlers/transcribe-video.test.ts` | skip-complete, skip-deleted, empty-transcript→no_audio, success+ai-enqueue, deepgram-auth-fatal |
| `handlers/generate-ai.test.ts` | skip-complete, skip-no-transcript, empty-transcript→skip, success, groq-auth-fatal |
| `handlers/cleanup-artifacts.test.ts` | deletes all keys, no-keys (empty), s3-error propagates |
| `handlers/deliver-webhook.test.ts` | success delivery, non-ok response throws, missing webhookUrl throws |

### 6.3 Queue Layer Unit Tests

```typescript
// queue/lifecycle.test.ts

describe("ack", () => {
  it("throws if rowCount === 0 (lease lost)", async () => { ... });
  it("succeeds when lease is valid", async () => { ... });
});

describe("failJob", () => {
  it("sets status=queued with backoff when attempts < max_attempts", async () => { ... });
  it("sets status=dead when attempts >= max_attempts", async () => { ... });
  it("sets status=dead immediately for FatalJobError", async () => { ... });
  it("calls applyTerminalFailure in same transaction when dead", async () => { ... });
});
```

```typescript
// queue/claim.test.ts

describe("buildClaimSql", () => {
  it("returns base SQL when excludeCount=0", () => { ... });
  it("adds NOT IN clause with correct placeholders for excludeCount=2", () => { ... });
});
```

### 6.4 Integration Test Skeleton

```typescript
// __tests__/worker-integration.test.ts
// Requires a test postgres instance (can use docker or testcontainers)

describe("full job lifecycle", () => {
  it("claims → runs → acks a process_video job", async () => {
    // Insert a video + job_queue row
    // Call claimOne()
    // Verify job is 'leased'
    // Call processJob() with mocked handlers
    // Verify job is 'succeeded'
  });

  it("fails → retries → goes dead at max_attempts", async () => { ... });

  it("reclaims expired lease", async () => { ... });
});
```

---

## 7. Estimated Complexity

| Task | Effort | Notes |
|------|--------|-------|
| Create `src/types.ts` — extract all types + PROCESSING_PHASE_META | **S** | Pure extraction, no logic change |
| Create `queue/sql.ts` — extract SQL constants + `buildClaimSql()` | **S** | Cosmetic + minor refactor of string mutation |
| Create `queue/lifecycle.ts` — extract ack/fail/markRunning/heartbeat | **S** | Pure extraction |
| Fix `fail()` + `markTerminalFailure()` into single transaction | **M** | Logic change, needs careful testing |
| Create `queue/claim.ts` — extract claimOne/reclaimExpiredLeases | **S** | Pure extraction |
| Create `queue/maintenance.ts` — split multi-statement SQL | **S** | Trivial |
| Create `handlers/context.ts` — HandlerContext type | **S** | New type only |
| Create `handlers/index.ts` — dispatch table | **S** | Replaces if/else chain |
| Extract `handleProcessVideo` to own file + remove phase fast-forwards | **M** | Logic change (4 queries → 1) |
| Extract `handleTranscribeVideo` to own file + cleanup | **S** | Near-pure extraction + minor cleanup |
| Extract `handleGenerateAi` to own file + fix typos + extract `buildChaptersPayload` | **S** | Mostly cleanup |
| Extract `handleCleanupArtifacts` + fix S3 re-init + consolidate queries | **M** | SQL change (3 queries → 1 JOIN) |
| Extract `handleDeliverWebhook` + add timeout | **S** | Minor |
| Add `enqueueDownstream()` helper, replace duplication in 2 handlers | **S** | DRY extraction |
| Add `FatalJobError` / `VideoDeletedError` classes, update providers | **S** | New types + find/replace |
| Lean `index.ts` orchestrator | **S** | Composition, no new logic |
| Fix `groq.ts` timeout lifetime bug (multi-chunk path) | **M** | Subtle correctness fix |
| Extract Groq system prompts as named constants | **S** | Cosmetic |
| Write handler unit tests (5 handlers × ~5 cases) | **L** | New test infrastructure, mock setup |
| Write queue lifecycle unit tests | **M** | Need DB mock or test DB |
| Write integration test skeleton | **L** | Needs test DB + testcontainers setup |

**Total: ~6 S tasks, ~5 M tasks, ~2 L tasks**

---

## 8. Migration Path

Execute in this order to keep the worker functional throughout. Each step is independently deployable.

### Phase 1 — Zero-Risk Extractions (no logic change)

**Step 1: Create `src/types.ts`**  
Move `JobType`, `JobPayload`, `JobRow`, `FailResult`, `ProcessResponse`, `ProcessingPhase`, `PROCESSING_PHASE_META`, `DeletedVideoSkipError` out of `index.ts`. Update imports. Run tests. ✅

**Step 2: Create `src/queue/sql.ts`**  
Move all SQL constants. Add `buildClaimSql(n)`. Update `claimOne()` to use it. No behavior change.

**Step 3: Create `src/queue/lifecycle.ts`**  
Move `ack`, `fail`, `markRunning`, `heartbeat`, `startHeartbeatLoop`. Update imports in `index.ts`.

**Step 4: Create `src/queue/claim.ts`**  
Move `claimOne`, `reclaimExpiredLeases`. Update imports.

**Step 5: Create `src/queue/maintenance.ts`**  
Move `runMaintenance`. Split multi-statement SQL into two calls.

**Step 6: Create `src/handlers/context.ts`**  
Add `HandlerContext` type. Create `createHandlerContext()` factory. No behavior change yet.

---

### Phase 2 — Handler Extraction

**Step 7: Extract handlers one at a time, adding `ctx` parameter**

Extract in this order (easiest → hardest):
1. `deliver-webhook.ts` (30 lines, no DB writes besides ack)
2. `cleanup-artifacts.ts` (fix S3 re-init + JOIN query)
3. `generate-ai.ts` (fix typos, extract `buildChaptersPayload`)
4. `transcribe-video.ts` (add `enqueueDownstream`)
5. `process-video.ts` (remove phase fast-forwards, add `enqueueDownstream`)

After each extraction: update `index.ts` to import and wire up the handler. Keep the `if/else` dispatch for now.

**Step 8: Create `src/handlers/index.ts` dispatch table**  
Replace the `if/else if` chain in `handleJob` (and the special `cleanup_artifacts` bypass in `processJob`) with a single `getHandler(jobType)(job, ctx)` call.

---

### Phase 3 — Error Handling Improvements

**Step 9: Add `FatalJobError` and `VideoDeletedError` to `types.ts`**  
Update `providers/deepgram.ts` and `providers/groq.ts` to throw `FatalJobError` on 401/403.

**Step 10: Merge `fail()` + `markTerminalFailure()` into atomic `failJob()`**  
This is the highest-risk change. Run integration tests before and after. The observable difference is that `videos.processing_phase = 'failed'` and `job_queue.status = 'dead'` are now guaranteed to be set atomically.

---

### Phase 4 — Provider Fixes

**Step 11: Fix `groq.ts` timeout lifetime bug**  
Move `AbortController` and `setTimeout` creation into each of `generateSingleChunk` and `generateMultipleChunks` (or give each chunk fetch its own per-chunk timeout). Ensure `clearTimeout` is always called via `finally`.

**Step 12: Extract Groq system prompts as named constants**  
Cosmetic but reduces the function body sizes significantly.

---

### Phase 5 — Lean Orchestrator

**Step 13: Slim down `src/index.ts`**  
After all extractions, `index.ts` should contain only:
- `waitForDatabaseReady()`
- `isMediaServerHealthy()`
- `processJob()` (lean: markRunning → heartbeat check → dispatch → error handling)
- `main()` (startup + polling loop + reclaim interval + maintenance interval)
- Log calls

Target: ≤100 lines.

---

### Phase 6 — Tests

**Step 14: Add handler unit tests**  
Write tests per the strategy in §6.2. Target ≥80% handler branch coverage.

**Step 15: Add queue lifecycle tests**  
Unit tests for `ack`, `fail`, `buildClaimSql`. Integration tests require a test DB — set up testcontainers or a dedicated test schema.

**Step 16: Add integration test skeleton**  
Full lifecycle test: enqueue → claim → process → ack. Regression protection for the retry/reclaim path.

---

### Verification Checklist

After each phase, verify:
- [ ] Worker starts and connects to DB
- [ ] `process_video` job claims, runs, acks
- [ ] `transcribe_video` downstream enqueue works
- [ ] `generate_ai` downstream enqueue works
- [ ] `cleanup_artifacts` deletes S3 objects
- [ ] `deliver_webhook` fires and acks
- [ ] Failed job retries with backoff
- [ ] Job exhausting max_attempts goes `dead` + video marked `failed`
- [ ] Expired lease is reclaimed by reclaim loop
- [ ] Maintenance loop runs without error

---

## Appendix: Final `index.ts` Target Shape

```typescript
// src/index.ts — target: ~100 lines

import { getEnv } from "@cap/config";
import { withTransaction } from "@cap/db";
import { log } from "./lib/logger.js";
import { waitForDatabaseReady, isMediaServerHealthy } from "./lib/startup.js";
import { claimOne, reclaimExpiredLeases } from "./queue/claim.js";
import { markRunning, startHeartbeatLoop, ack, failJob } from "./queue/lifecycle.js";
import { runMaintenance } from "./queue/maintenance.js";
import { getHandler } from "./handlers/index.js";
import { createHandlerContext } from "./handlers/context.js";
import { VideoDeletedError } from "./types.js";

const env = getEnv();
const ctx = createHandlerContext(env);

async function processJob(job: JobRow): Promise<void> {
  await withTransaction(env.DATABASE_URL, (client) => markRunning(client, job));
  const stopHeartbeat = startHeartbeatLoop(job, env);

  try {
    const alive = await heartbeat(job, env);
    if (!alive) throw new Error(`lease lost before start for job ${job.id}`);

    const handler = getHandler(job.job_type);
    await handler(job, ctx);

    log("job.acked", { job_id: job.id, job_type: job.job_type });
  } catch (error) {
    if (error instanceof VideoDeletedError) {
      await withTransaction(env.DATABASE_URL, (client) => ack(client, job));
      log("job.acked", { job_id: job.id, reason: "video_deleted" });
      return;
    }
    await failJob(job, error, env);
    log("job.failed", { job_id: job.id, error: String(error), attempts: job.attempts });
  } finally {
    stopHeartbeat();
  }
}

async function main(): Promise<void> {
  log("worker.started", { worker_id: env.WORKER_ID });
  await waitForDatabaseReady(env.DATABASE_URL);

  setInterval(() => void reclaimExpiredLeases(env).catch((e) => log("reclaim.error", { error: String(e) })), env.WORKER_RECLAIM_MS);
  setInterval(() => void runMaintenance(env.DATABASE_URL).catch((e) => log("maintenance.error", { error: String(e) })), 60 * 60 * 1000);

  while (true) {
    const excludeTypes = (await isMediaServerHealthy(env.MEDIA_SERVER_BASE_URL))
      ? []
      : (log("worker.health.degraded", { skipping: ["process_video"] }), ["process_video"] as JobType[]);

    const job = await claimOne(env, excludeTypes);
    if (job) {
      log("job.claimed", { job_id: job.id, job_type: job.job_type, attempts: job.attempts });
      await processJob(job);
    }

    await new Promise((r) => setTimeout(r, env.WORKER_POLL_MS));
  }
}

main().catch((error) => {
  log("worker.crash", { error: String(error) });
  process.exit(1);
});
```

Clean. Readable. Every concern delegated to its module.
