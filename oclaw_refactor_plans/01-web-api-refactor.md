# `apps/web-api` Refactor Plan

> **Scope:** Backend API layer only — `apps/web-api/src/`
> **Constraint:** No user authentication. Keep all existing features intact.
> **Goal:** Simpler, more structured, cleaner, cooler code.
> **Date:** 2026-03-27

---

## Table of Contents

1. [Current State Audit](#1-current-state-audit)
2. [Proposed File/Folder Structure](#2-proposed-filefolder-structure)
3. [Key Refactors](#3-key-refactors)
4. [Code Quality Wins](#4-code-quality-wins)
5. [Testing Improvements](#5-testing-improvements)
6. [Estimated Complexity](#6-estimated-complexity)
7. [Migration Path](#7-migration-path)

---

## 1. Current State Audit

### What Exists

```
src/
├── index.ts                   # app bootstrap + all plugin/route registration
├── lib/
│   └── shared.ts              # ~550 lines: types, helpers, S3, idempotency, providers
│   └── shared.test.ts         # 3 test groups, ~50 lines
├── plugins/
│   ├── health.ts              # /health + /ready probes
│   └── logging.ts             # request ID, structured logging, hooks
└── routes/
    ├── videos.ts              # 5 routes, ~340 lines
    ├── uploads.ts             # 6 routes, ~280 lines
    ├── library.ts             # 1 route, ~80 lines
    ├── jobs.ts                # 1 route, ~35 lines
    ├── system.ts              # prod routes + debug routes, ~320 lines
    ├── webhooks.ts            # 1 route, ~200 lines
    └── webhooks.test.ts       # 3 test groups, ~60 lines
```

**Total source:** ~1,800 lines of TypeScript across 9 files.

### Pain Points

#### 1.1 `shared.ts` is a God File

`lib/shared.ts` (~550 lines) does five unrelated jobs:

- Domain types (`JobType`, `WebhookPayload`, `AiChapter`, etc.)
- Business helpers (cursor encoding, transcript normalization, chapter parsing, entity parsing)
- Security helpers (`sha256Hex`, `timingSafeEqual`, `verifyWebhookSignature`)
- S3 client factory (`getS3ClientAndBucket`, `getInternalS3ClientAndBucket`) + re-exports of all AWS SDK commands
- Database idempotency protocol (`idempotencyBegin`, `idempotencyFinish`)
- Provider status aggregation (`getSystemProviderStatus`, `deriveProviderHealthState`)

When this file grows, everything grows. Any new route or feature imports this monolith.

#### 1.2 Idempotency Logic is Duplicated

`idempotencyBegin`/`idempotencyFinish` exist in `shared.ts`, but `videos.ts` (watch-edits route) and `videos.ts` (retry route) hand-roll the same SQL inline:

```ts
// videos.ts — watch-edits (inline, not using shared idempotencyBegin)
const idempotencyInsert = await client.query<{ endpoint: string; idempotency_key: string }>(
  `INSERT INTO idempotency_keys ...`,
  ...
);
// ... duplicated conflict handling ...

// videos.ts — retry (inline, also not using idempotencyBegin)
const idemp = await client.query(
  `INSERT INTO idempotency_keys ...`,
  ...
);
```

Three separate implementations of the same protocol.

#### 1.3 No Request Validation Layer

Route handlers receive raw `req.body` and cast manually with `String(req.body?.foo ?? "")`, `Number(...)`, and plain object checks. There is no input schema enforcement, no helpful error messages for missing fields, and no TypeScript inference from validated shapes.

Example from `uploads.ts`:
```ts
const videoId = req.body?.videoId;  // string | undefined — no further validation
const partNumber = req.body?.partNumber;  // any — cast inline later
if (!videoId || !partNumber) return reply.code(400).send(badRequest("..."));
```

#### 1.4 Inconsistent Response Shapes

Routes return inconsistent envelopes:
- Most mutations: `{ ok: true, ... }` or `{ ok: false, error: "..." }`
- `GET /api/videos/:id/status`: flat object, no `ok` key
- `GET /api/library/videos`: flat object with `items` array
- `GET /api/jobs/:id`: raw `snake_case` DB row (explicitly noted in docs as a special case)
- `GET /api/system/provider-status`: own complex shape

No enforced contract at the serialization layer. Type safety stops at the route handler.

#### 1.5 Debug Code Embedded in Production Route Module

`system.ts` houses both the production `GET /api/system/provider-status` and the 200+ line debug suite (`/debug/enqueue`, `/debug/smoke`, etc.) behind an `if (env.NODE_ENV !== "production")` block. The debug route also contains the entire `generateTestMp4Buffer` ffmpeg helper inline.

This makes `system.ts` ~320 lines and mixes concerns heavily.

#### 1.6 S3 Client Construction is Leaky

`getS3ClientAndBucket` (public endpoint) and `getInternalS3ClientAndBucket` (internal endpoint) are:
- Defined in `shared.ts` (conceptually wrong domain — a utility lib shouldn't own infra clients)
- Missing from the internal version the `forcePathStyle` override documentation — both functions read `S3_FORCE_PATH_STYLE` separately but the logic differs (public uses `S3_PUBLIC_ENDPOINT ?? S3_ENDPOINT`, internal uses just `S3_ENDPOINT`)
- Both functions re-validate credentials at every call; there is no instance reuse

#### 1.7 `log()` Helper Duplication

`system.ts` and `webhooks.ts` both define an identical local `log()` function:

```ts
// system.ts
function log(app: FastifyInstance, fields: Record<string, unknown>) { ... }

// webhooks.ts
function log(app: FastifyInstance, fields: Record<string, unknown>) { ... }
```

#### 1.8 Type Safety Gaps

- `req.body` typed as `{ Body: { name?: string; webhookUrl?: string } }` in generics but still manually accessed with optional chaining and cast everywhere
- `result.rows[0]!` non-null assertions without runtime guards in multiple routes
- DB row types are defined inline in query generic parameters (e.g., the 20-field type in `GET /api/videos/:id/status`) with no reuse
- `WebhookPayload["phase"]` is cast rather than validated as a union

#### 1.9 `index.ts` Has Boot Logic Mixed with Config

The startup `if (app.serviceLogger)` block after `app.listen` is a minor smell — the start-up sequence belongs in a dedicated boot function.

#### 1.10 Missing Zod (Despite Being Available)

`@cap/config` depends on `zod: ^3.23.8`. Zod is already in the monorepo. Routes don't use it. Validating bodies with Zod would replace ~30 lines of hand-rolled validation with schemas that double as runtime documentation.

---

## 2. Proposed File/Folder Structure

```
apps/web-api/src/
│
├── index.ts                        # minimal: createApp() + listen()
│
├── app.ts                          # NEW: buildApp() — plugin + route registration
│
├── lib/
│   ├── types.ts                    # NEW: all shared domain types (JobType, WebhookPayload, AiChapter, …)
│   ├── constants.ts                # NEW: PROCESSING_PHASE_RANK, BLOCKED_WEBHOOK_HOSTS, etc.
│   ├── crypto.ts                   # NEW: sha256Hex, timingSafeEqual, verifyWebhookSignature
│   ├── cursor.ts                   # NEW: encodeLibraryCursor, decodeLibraryCursor, normalizeCursorTimestamp
│   ├── ai-helpers.ts               # NEW: structuredChaptersFromJson, structuredEntitiesFromJson, …
│   ├── transcript-helpers.ts       # NEW: transcriptTextFromSegments, normalizeEditableTranscriptSegments
│   ├── idempotency.ts              # NEW: idempotencyBegin, idempotencyFinish (consolidated, single source)
│   ├── s3.ts                       # NEW: getS3Client, getInternalS3Client (singleton-style, lazy init)
│   └── providers.ts                # NEW: getSystemProviderStatus, deriveProviderHealthState
│
├── plugins/
│   ├── health.ts                   # (unchanged)
│   └── logging.ts                  # (unchanged)
│
├── routes/
│   ├── videos/
│   │   ├── index.ts                # route registration (calls handlers)
│   │   ├── create.ts               # POST /api/videos
│   │   ├── status.ts               # GET /api/videos/:id/status
│   │   ├── watch-edits.ts          # PATCH /api/videos/:id/watch-edits
│   │   ├── delete.ts               # POST /api/videos/:id/delete
│   │   ├── retry.ts                # POST /api/videos/:id/retry
│   │   └── schemas.ts              # Zod schemas for video route bodies
│   │
│   ├── uploads/
│   │   ├── index.ts                # route registration
│   │   ├── signed.ts               # POST /api/uploads/signed
│   │   ├── complete.ts             # POST /api/uploads/complete
│   │   ├── multipart-initiate.ts   # POST /api/uploads/multipart/initiate
│   │   ├── multipart-presign.ts    # POST /api/uploads/multipart/presign-part
│   │   ├── multipart-complete.ts   # POST /api/uploads/multipart/complete
│   │   ├── multipart-abort.ts      # POST /api/uploads/multipart/abort
│   │   └── schemas.ts              # Zod schemas for upload route bodies
│   │
│   ├── library/
│   │   ├── index.ts                # route registration
│   │   ├── list.ts                 # GET /api/library/videos
│   │   └── schemas.ts              # Zod schemas for query params
│   │
│   ├── jobs/
│   │   ├── index.ts                # route registration
│   │   └── get.ts                  # GET /api/jobs/:id
│   │
│   ├── system/
│   │   ├── index.ts                # route registration (provider-status + root dev UI)
│   │   ├── provider-status.ts      # GET /api/system/provider-status
│   │   └── dev-ui.ts               # GET / (dev UI, always registered)
│   │
│   ├── webhooks/
│   │   ├── index.ts                # route registration
│   │   ├── media-server-progress.ts # POST /api/webhooks/media-server/progress
│   │   └── schemas.ts              # Zod schemas for webhook body
│   │
│   └── debug/
│       ├── index.ts                # guarded registration (NODE_ENV !== 'production')
│       ├── enqueue.ts              # POST /debug/enqueue
│       ├── videos.ts               # POST /debug/videos
│       ├── jobs.ts                 # POST /debug/jobs/enqueue + GET /debug/job/:id
│       ├── smoke.ts                # POST /debug/smoke (with generateTestMp4Buffer)
│       └── schemas.ts              # Zod schemas for debug bodies
│
└── errors.ts                       # NEW: AppError class, sendError(), error constants
```

**Why this structure:**
- Each route file has exactly one responsibility
- Debug routes are isolated in their own directory and can't accidentally bleed into production builds
- `lib/` modules are sized to their domain — easy to find, easy to test
- Zod schemas live next to the routes that own them

---

## 3. Key Refactors

### 3.1 Extract `lib/shared.ts` into Domain Modules

**Complexity: M**

Split the 550-line god file into focused modules:

```ts
// lib/types.ts — pure types, zero runtime code
export type JobType = "process_video" | "transcribe_video" | "generate_ai" | "cleanup_artifacts" | "deliver_webhook";
export type ProcessResponse = { resultKey: string; thumbnailKey: string; ... };
export type WebhookPayload = { ... };
export type ProviderHealthState = "healthy" | "active" | "degraded" | "idle" | "unavailable";
export type AiChapter = { title: string; seconds: number; sentiment?: "positive" | "neutral" | "negative" };
// ... all other shared types
```

```ts
// lib/constants.ts
export const PROCESSING_PHASE_RANK: Record<string, number> = { ... };
export const BLOCKED_WEBHOOK_HOSTS = ["localhost", "127.0.0.1", ...] as const;
```

```ts
// lib/crypto.ts
export function sha256Hex(value: string): string { ... }
export function timingSafeEqual(expected: string, actual: string): boolean { ... }
export function verifyWebhookSignature(raw: string, timestamp: string, sig: string): boolean { ... }
export function configuredSecret(value: string | null | undefined): boolean { ... }
```

```ts
// lib/cursor.ts
export function encodeLibraryCursor(createdAtIso: string, id: string): string { ... }
export function decodeLibraryCursor(cursor: string): { createdAtIso: string; id: string } | null { ... }
export function normalizeCursorTimestamp(value: string | Date): string | null { ... }
```

```ts
// lib/ai-helpers.ts
export function structuredChaptersFromJson(chapters: unknown): AiChapter[] { ... }
export function structuredEntitiesFromJson(value: unknown): AiEntities | null { ... }
export function structuredActionItemsFromJson(value: unknown): AiActionItem[] { ... }
export function structuredQuotesFromJson(value: unknown): AiQuote[] { ... }
export function keyPointsFromChapters(chapters: unknown): string[] { ... }
```

```ts
// lib/transcript-helpers.ts
export function transcriptTextFromSegments(segments: unknown): string | null { ... }
export function normalizeEditableTranscriptSegments(existing: unknown, text: string): TranscriptSegmentRow[] { ... }
```

### 3.2 Consolidate Idempotency into `lib/idempotency.ts`

**Complexity: M**

Currently three implementations exist. Consolidate into one:

```ts
// lib/idempotency.ts
export type IdempotencyBeginResult =
  | { kind: "proceed" }
  | { kind: "cached"; statusCode: number; body: Record<string, unknown> }
  | { kind: "conflict"; statusCode: 409; body: Record<string, unknown> };

export async function idempotencyBegin(args: {
  client: QueryClient;
  endpoint: string;
  idempotencyKey: string;
  requestHash: string;
  ttlInterval: string;
}): Promise<IdempotencyBeginResult> { ... }

export async function idempotencyFinish(args: {
  client: QueryClient;
  endpoint: string;
  idempotencyKey: string;
  statusCode: number;
  body: Record<string, unknown>;
}): Promise<void> { ... }

// Convenience: combine begin+finish for the common "wrap whole handler" pattern
export async function withIdempotency<T>(
  args: { ... },
  handler: (client: QueryClient) => Promise<{ statusCode: number; body: Record<string, unknown> }>
): Promise<{ statusCode: number; body: Record<string, unknown> }> { ... }
```

The `watch-edits` and `retry` routes in `videos.ts` should be rewritten to use `idempotencyBegin`, eliminating ~60 lines of duplicated SQL.

**Before (retry route — inline idempotency):**
```ts
const idemp = await client.query(
  `INSERT INTO idempotency_keys (endpoint, idempotency_key, request_hash, expires_at)
   VALUES ($1, $2, $3, now() + interval '24 hours')
   ON CONFLICT DO NOTHING
   RETURNING endpoint, idempotency_key`,
  [endpointKey, idempotencyKey, requestHash]
);
if (idemp.rowCount === 0) {
  const existing = await client.query(
    `SELECT request_hash, status_code, response_body FROM idempotency_keys ...`
  );
  if ((existing.rowCount ?? 0) > 0) {
    const row = existing.rows[0];
    if (row.request_hash !== requestHash) return { statusCode: 409, body: badRequest(...) };
    if (row.status_code) return { statusCode: row.status_code, body: row.response_body };
    return { statusCode: 409, body: badRequest("Duplicate request still in progress") };
  }
  return { statusCode: 409, body: badRequest("Idempotency key collision") };
}
```

**After (using shared helper):**
```ts
const begin = await idempotencyBegin({ client, endpoint: endpointKey, idempotencyKey, requestHash, ttlInterval: "24 hours" });
if (begin.kind !== "proceed") return { statusCode: begin.statusCode, body: begin.body };
```

### 3.3 Add Zod Validation Layer

**Complexity: M**

Add Zod schemas per route module. Validate at handler entry, before any DB I/O.

```ts
// routes/videos/schemas.ts
import { z } from "zod";

export const CreateVideoBody = z.object({
  name: z.string().trim().default("Untitled Video"),
  webhookUrl: z.string().url().optional().nullable(),
});

export const WatchEditsBody = z.object({
  title: z.string().trim().min(1).max(500).optional().nullable(),
  transcriptText: z.string().optional().nullable(),
  speakerLabels: z.record(z.string(), z.string()).optional().nullable(),
}).refine(
  (b) => b.title !== undefined || b.transcriptText !== undefined || b.speakerLabels !== undefined,
  { message: "At least one field must be provided: title, transcriptText, speakerLabels" }
);

export const VideoIdParams = z.object({
  id: z.string().uuid(),
});
```

```ts
// routes/uploads/schemas.ts
export const SignedUploadBody = z.object({
  videoId: z.string().uuid(),
  contentType: z.string().default("application/octet-stream"),
});

export const MultipartCompleteBody = z.object({
  videoId: z.string().uuid(),
  parts: z.array(z.object({
    ETag: z.string(),
    PartNumber: z.number().int().positive(),
  })).min(1),
});
```

**Usage pattern in handlers:**

```ts
// Before
const videoId = req.body?.videoId;
if (!videoId) return reply.code(400).send(badRequest("videoId is required"));

// After
const parseResult = SignedUploadBody.safeParse(req.body);
if (!parseResult.success) {
  return reply.code(400).send(sendError(parseResult.error));
}
const { videoId, contentType } = parseResult.data;
```

Zod validation also ensures `videoId` is a valid UUID before it hits the database, eliminating the `$1::uuid` cast explosion that would silently error or throw without clear attribution.

### 3.4 Centralize Error Handling

**Complexity: S**

Create `errors.ts` with a consistent error helper and an `AppError` class:

```ts
// errors.ts
export class AppError extends Error {
  constructor(
    public readonly statusCode: number,
    message: string,
    public readonly code?: string,
  ) {
    super(message);
    this.name = "AppError";
  }
}

export function badRequest(message: string) {
  return { ok: false as const, error: message };
}

export function notFound(message = "Not found") {
  return { ok: false as const, error: message };
}

// Converts a Zod error to API shape
export function zodError(err: ZodError) {
  const first = err.errors[0];
  return badRequest(first ? `${first.path.join(".")}: ${first.message}` : "Invalid request");
}

// Fastify setErrorHandler hook (registered in app.ts)
export function globalErrorHandler(
  error: FastifyError,
  _req: FastifyRequest,
  reply: FastifyReply,
) {
  if (error instanceof AppError) {
    return reply.code(error.statusCode).send(badRequest(error.message));
  }
  // Let Fastify handle 4xx from schema validation
  if (error.statusCode && error.statusCode < 500) {
    return reply.code(error.statusCode).send(badRequest(error.message));
  }
  reply.log.error(error);
  return reply.code(500).send({ ok: false, error: "Internal server error" });
}
```

Register in `app.ts`:
```ts
app.setErrorHandler(globalErrorHandler);
```

This removes the scattered `try/catch` in `webhooks.ts` and the `500` fallback in `system.ts`.

### 3.5 Extract S3 Client into `lib/s3.ts`

**Complexity: S**

```ts
// lib/s3.ts
import { S3Client } from "@aws-sdk/client-s3";

// Lazy singletons — constructed once, reused across requests
let _publicClient: { client: S3Client; bucket: string } | undefined;
let _internalClient: { client: S3Client; bucket: string } | undefined;

function buildS3Config(endpoint: string) {
  const accessKeyId = process.env.S3_ACCESS_KEY;
  const secretAccessKey = process.env.S3_SECRET_KEY;
  const bucket = process.env.S3_BUCKET;
  const region = process.env.S3_REGION ?? "us-east-1";
  const forcePathStyle = (process.env.S3_FORCE_PATH_STYLE ?? "true") === "true";

  if (!accessKeyId || !secretAccessKey || !bucket) {
    throw new Error("Missing S3 configuration: S3_ACCESS_KEY, S3_SECRET_KEY, S3_BUCKET");
  }

  return {
    client: new S3Client({
      endpoint,
      region,
      forcePathStyle,
      credentials: { accessKeyId, secretAccessKey },
      requestChecksumCalculation: "WHEN_REQUIRED",
      responseChecksumValidation: "WHEN_REQUIRED",
    }),
    bucket,
  };
}

export function getPublicS3(): { client: S3Client; bucket: string } {
  if (!_publicClient) {
    const endpoint = process.env.S3_PUBLIC_ENDPOINT ?? process.env.S3_ENDPOINT ?? "http://localhost:9000";
    _publicClient = buildS3Config(endpoint);
  }
  return _publicClient;
}

export function getInternalS3(): { client: S3Client; bucket: string } {
  if (!_internalClient) {
    const endpoint = process.env.S3_ENDPOINT;
    if (!endpoint) throw new Error("Missing S3 configuration: S3_ENDPOINT");
    _internalClient = buildS3Config(endpoint);
  }
  return _internalClient;
}
```

Export only the S3 commands actually used; don't barrel-export the entire SDK.

### 3.6 Separate Debug Routes into `routes/debug/`

**Complexity: S**

Move everything under `if (env.NODE_ENV !== "production")` in `system.ts` into dedicated files:

```ts
// routes/debug/index.ts
import type { FastifyInstance } from "fastify";
import { getEnv } from "@cap/config";
import { enqueueDebugRoute } from "./enqueue.js";
import { debugVideosRoute } from "./videos.js";
import { debugJobsRoutes } from "./jobs.js";
import { smokeTestRoute } from "./smoke.js";

const env = getEnv();

export async function debugRoutes(app: FastifyInstance) {
  if (env.NODE_ENV === "production") return; // safety guard
  app.register(enqueueDebugRoute);
  app.register(debugVideosRoute);
  app.register(debugJobsRoutes);
  app.register(smokeTestRoute);
}
```

The `generateTestMp4Buffer` ffmpeg helper moves to `routes/debug/smoke.ts` or a helper in `routes/debug/_ffmpeg.ts`.

### 3.7 Introduce `app.ts` for Application Factory

**Complexity: S**

Separate the Fastify app construction from the process entry point. This enables testing the full app without spawning a real server.

```ts
// app.ts
import Fastify from "fastify";
import { buildApp } from "./app.js";

export async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });

  await app.register(loggingPlugin, { serviceName: "web-api", version: "0.1.0" });
  await app.register(healthPlugin, { version: "0.1.0" });
  await app.register(rateLimitPlugin, { ... });
  await app.register(rawBodyPlugin, { ... });

  app.setErrorHandler(globalErrorHandler);

  await app.register(systemRoutes);
  await app.register(videoRoutes);
  await app.register(uploadRoutes);
  await app.register(libraryRoutes);
  await app.register(jobRoutes);
  await app.register(webhookRoutes);
  await app.register(debugRoutes);   // no-op in production

  return app;
}

// index.ts
import { buildApp } from "./app.js";
import { getEnv } from "@cap/config";

const env = getEnv();
const app = await buildApp();
await app.listen({ host: "0.0.0.0", port: env.WEB_API_PORT });
app.serviceLogger.info("web-api log", { event: "server.started", port: env.WEB_API_PORT });
```

### 3.8 Standardize Response Shapes with Typed Helpers

**Complexity: S**

Define response type helpers to enforce consistency:

```ts
// errors.ts (or lib/response.ts)
export type OkResponse<T extends Record<string, unknown> = Record<string, never>> = { ok: true } & T;
export type ErrResponse = { ok: false; error: string };

export function ok<T extends Record<string, unknown>>(data: T): OkResponse<T> {
  return { ok: true, ...data };
}
```

Mutation routes return `ok(...)` or `badRequest(...)`. GET routes can keep their existing flat shapes (they are well-defined and match the API docs). This removes the scattered `{ ok: true, ... }` literals.

### 3.9 Fix Inline Idempotency in `videos.ts` watch-edits

**Complexity: S**

The `PATCH /api/videos/:id/watch-edits` handler implements idempotency inline with ~40 lines of manual SQL that duplicates `idempotencyBegin`. Once `lib/idempotency.ts` exists (see 3.2), this route should use it.

### 3.10 Normalize `log()` Helper Usage

**Complexity: S**

Remove the local `log()` function defined in both `system.ts` and `webhooks.ts`. Both handlers already have `req.serviceLog` on every request (injected by the logging plugin). Use it:

```ts
// Before
function log(app: FastifyInstance, fields: Record<string, unknown>) {
  if (app.serviceLogger) { ... } else { console.log(...) }
}
log(app, { event: "webhook.processed", ... });

// After (inside route handler — request context available)
req.serviceLog.info("webhook.processed", { videoId: payload.videoId, ... });
```

For the system route error path where no request context exists (provider status failure), use `app.serviceLogger` directly, no local wrapper needed.

---

## 4. Code Quality Wins

### 4.1 Remove Non-Null Assertions with DB Queries

**Complexity: S**

Multiple routes use `result.rows[0]!.id` without a rowCount guard:

```ts
// Before (uploads.ts — after INSERT)
const jobResult = await client.query<{ id: number }>(`INSERT INTO job_queue ... RETURNING id`, [...]);
const body = { jobId: Number(jobResult.rows[0]!.id) };  // assumes rowCount > 0

// After
const jobRow = jobResult.rows[0];
if (!jobRow) throw new AppError(500, "Failed to enqueue job: no row returned");
const body = { jobId: Number(jobRow.id) };
```

### 4.2 Consistent `camelCase` Response Keys

`GET /api/jobs/:id` returns `snake_case` keys (`video_id`, `job_type`, etc.) because the API docs note it mirrors the queue row. This is intentional per the API contract — but it should be called out explicitly in the route comment and the Zod schema should enforce the output shape so it doesn't drift.

All other routes already use `camelCase`. No change needed to the jobs route behavior, just document the exception.

### 4.3 Remove Repeated `env.DATABASE_URL` Passing

Every `query(env.DATABASE_URL, ...)` call repeats the connection string. Consider a thin wrapper:

```ts
// lib/db.ts (or just re-export with bound URL)
import { query as rawQuery, withTransaction as rawTxn } from "@cap/db";
import { getEnv } from "@cap/config";

const env = getEnv();

export const query: typeof rawQuery = (sql, params) => rawQuery(env.DATABASE_URL, sql, params);
export const withTransaction: typeof rawTxn = (fn) => rawTxn(env.DATABASE_URL, fn);
```

This reduces every DB call from `query(env.DATABASE_URL, ...)` to `query(...)`. ~40 occurrences across all route files.

### 4.4 Dead Code Review

- `badRequest()` in `shared.ts` and `errors.ts` should be one canonical export — remove duplicate once centralized
- `PROCESSING_PHASE_RANK` exists in `shared.ts`; `phaseRank()` wraps it. After splitting into `constants.ts`, confirm `phaseRank` is still needed or inline it
- The re-exports of `S3Client`, `PutObjectCommand`, etc. from `shared.ts` should go away once `lib/s3.ts` exists
- `sanitizeProviderBaseUrl()` is only used in `getSystemProviderStatus()` — can be co-located with `providers.ts` instead of living in `shared.ts`
- `requireIdempotencyKey()` is called in every route but also wrapped locally in `videos.ts` as `requireIdempotencyKeyOrReply()` — make the reply-integrated helper part of a shared `lib/middleware.ts` or `lib/guards.ts`

### 4.5 Type the DB Row Results

Define named types for repeated query row shapes:

```ts
// lib/types.ts
export type VideoStatusRow = {
  id: string;
  name: string;
  processing_phase: string;
  processing_progress: number;
  result_key: string | null;
  // ...all 25 fields...
};
```

This removes the giant anonymous generic inline in `GET /api/videos/:id/status`.

### 4.6 Webhook URL Validation as Zod Refinement

The URL validation logic in `POST /api/videos` is ~15 lines of manual URL parsing. With Zod:

```ts
const webhookUrlSchema = z
  .string()
  .url()
  .refine((url) => ["http:", "https:"].includes(new URL(url).protocol), {
    message: "webhookUrl must use http or https",
  })
  .refine(
    (url) => {
      const { hostname } = new URL(url);
      return (
        !BLOCKED_WEBHOOK_HOSTS.includes(hostname) &&
        !hostname.endsWith(".internal") &&
        !hostname.endsWith(".local")
      );
    },
    { message: "webhookUrl cannot target internal services" }
  )
  .optional()
  .nullable();
```

### 4.7 TypeScript Strict Mode Audit

Check `tsconfig.json` for `"strict": true`. If not enabled, enable it and fix the resulting ~15-20 errors (mostly implicit `any` in DB row handling). Strict mode is free documentation.

---

## 5. Testing Improvements

### Current Coverage

| Area | Status |
|------|--------|
| `shared.ts` helpers | 3 tests — cursor encoding, chapter normalization |
| `webhooks.ts` validation | 3 tests — happy path, missing jobId, invalid videoId |
| Route-level unit tests | **None** |
| Integration tests | `tests/integration/full-flow.test.ts` — 1 test file |
| E2E tests | 5 files (jobs, library, uploads, videos, webhooks) — Playwright |

### Gaps

#### 5.1 No Route Handler Unit Tests

Zero tests exercise the actual Fastify route handlers in isolation (without a real DB). With the `buildApp()` factory from §3.7, you can use `app.inject()` to call routes without network I/O.

Add: `routes/videos/create.test.ts`, `routes/uploads/signed.test.ts`, etc.

#### 5.2 No Idempotency Tests

The idempotency protocol is complex and has three execution paths (proceed / cached / conflict). There are no tests for any of them. After extracting `lib/idempotency.ts`, add:

```ts
// lib/idempotency.test.ts
describe("idempotencyBegin", () => {
  it("returns proceed for new keys")
  it("returns cached for completed duplicate")
  it("returns conflict for in-progress duplicate")
  it("returns conflict for mismatched payload hash")
  it("cleans up expired keys")
})
```

These should use a real test DB (vitest integration config is already set up).

#### 5.3 `verifyWebhookSignature` Not Tested

The HMAC verification function is security-critical but untested. Add:

```ts
// lib/crypto.test.ts
describe("verifyWebhookSignature", () => {
  it("accepts a correctly signed payload")
  it("rejects tampered payload")
  it("rejects wrong timestamp")
  it("rejects wrong secret")
})
```

#### 5.4 Cursor Encoding Edge Cases

`decodeLibraryCursor` has three failure modes (malformed base64, bad date, bad UUID) — only the happy path is tested. Add edge-case tests.

#### 5.5 Webhook Route Integration Tests

`webhooks.test.ts` only tests the `validateWebhookPayload` pure function. It does not test:
- Timestamp skew rejection
- Signature rejection
- Deduplication via `delivery_id`
- Monotonic guard behavior
- Outbound webhook job enqueue

Add these as integration tests using vitest + real DB.

#### 5.6 Library Pagination Tests

`GET /api/library/videos` has cursor logic that hasn't been tested. Add integration tests for:
- First page (no cursor)
- Second page with cursor
- `created_asc` vs `created_desc`
- Invalid cursor rejection

#### 5.7 Zod Schema Tests

Once schemas are extracted, add unit tests for each schema's validation and error messages. Cheap to write, high value as documentation.

---

## 6. Estimated Complexity

| # | Item | Effort | Risk |
|---|------|--------|------|
| 3.1 | Split `shared.ts` into domain modules | **M** | Low — pure refactor, no logic change |
| 3.2 | Consolidate idempotency into `lib/idempotency.ts` | **M** | Medium — touches all mutation routes |
| 3.3 | Add Zod validation layer | **M** | Low — additive, can be done route by route |
| 3.4 | Centralize error handling (`errors.ts` + `setErrorHandler`) | **S** | Low — additive |
| 3.5 | Extract S3 client into `lib/s3.ts` | **S** | Low — pure refactor |
| 3.6 | Separate debug routes into `routes/debug/` | **S** | Low — file move |
| 3.7 | Introduce `app.ts` factory | **S** | Low — restructure, no logic change |
| 3.8 | Typed response helpers | **S** | Low — additive |
| 3.9 | Fix inline idempotency in watch-edits | **S** | Low — depends on 3.2 |
| 3.10 | Remove local `log()` duplicates | **S** | Low — find + replace |
| 4.1 | Remove non-null assertions | **S** | Low |
| 4.3 | Bind `query`/`withTransaction` to env | **S** | Low |
| 4.4 | Dead code sweep | **S** | Low |
| 4.5 | Named DB row types | **S** | Low |
| 4.6 | Webhook URL as Zod refinement | **S** | Low — depends on 3.3 |
| 4.7 | Strict mode audit | **M** | Medium — may surface hidden bugs |
| 5.2 | Idempotency unit tests | **M** | Low — needs test DB |
| 5.3 | Crypto/HMAC unit tests | **S** | Low |
| 5.4 | Cursor edge-case tests | **S** | Low |
| 5.5 | Webhook route integration tests | **M** | Low |
| 5.6 | Library pagination tests | **S** | Low |
| 5.7 | Zod schema unit tests | **S** | Low |

> S = 1-4 hours | M = half-day to 1.5 days | L = multiple days

---

## 7. Migration Path

Execute in this order to maintain a runnable, tested codebase at each step.

### Phase 1 — Non-Breaking Structural Cleanup (No Logic Change)

**Steps 1–5 can be done in any order within the phase.**

1. **Create `lib/constants.ts`** — move `PROCESSING_PHASE_RANK` and `BLOCKED_WEBHOOK_HOSTS` out of `shared.ts`. Update imports. Run `pnpm typecheck`.

2. **Create `lib/types.ts`** — move all type/interface declarations out of `shared.ts`. These have zero runtime presence. Update imports everywhere. Run `pnpm typecheck`.

3. **Create `lib/crypto.ts`** — move `sha256Hex`, `timingSafeEqual`, `verifyWebhookSignature`, `configuredSecret`. Update imports. Run `pnpm test`.

4. **Create `lib/cursor.ts`** — move cursor helpers. Update imports. Run `pnpm test` (existing shared.test.ts covers these).

5. **Create `lib/ai-helpers.ts` + `lib/transcript-helpers.ts`** — move the remaining transformation functions. Update imports. Run `pnpm test`.

6. **Create `lib/s3.ts`** with lazy singletons. Update `uploads.ts`, `system.ts`. Remove S3 re-exports from `shared.ts`. Run `pnpm test:integration` or `pnpm test:e2e`.

7. **Create `lib/providers.ts`** — move `getSystemProviderStatus`, `deriveProviderHealthState`, `sanitizeProviderBaseUrl`. Update `system.ts`. Run `pnpm test`.

8. **`shared.ts` should now be near-empty** — delete it or keep as a re-export barrel temporarily for backward compat while continuing migration.

9. **Remove local `log()` functions** from `system.ts` and `webhooks.ts`. Use `req.serviceLog` in handlers and `app.serviceLogger` in plugin-level code. Run `pnpm test`.

10. **Create `app.ts` factory** — move plugin + route registration out of `index.ts`. Update `index.ts` to just call `buildApp()` + `listen()`. Run `pnpm test:e2e`.

### Phase 2 — Error Handling + Response Standardization

11. **Create `errors.ts`** with `badRequest`, `notFound`, `zodError`, `globalErrorHandler`. Register `setErrorHandler` in `app.ts`. Run `pnpm test:e2e` (no behavior change yet).

12. **Bind DB helpers** — create thin `lib/db.ts` wrapper. Replace all `query(env.DATABASE_URL, ...)` calls. Run `pnpm typecheck` + `pnpm test:integration`.

13. **Add named DB row types** in `lib/types.ts` for the large inline query generics. `pnpm typecheck`.

### Phase 3 — Idempotency Consolidation

14. **Create `lib/idempotency.ts`** — single canonical implementation. Wire up unit tests (`lib/idempotency.test.ts`).

15. **Rewrite `watch-edits` and `retry` handlers** in `videos.ts` to use `idempotencyBegin` instead of the inline SQL. Run `pnpm test:integration`.

### Phase 4 — Validation Layer (Zod)

16. **Add `routes/videos/schemas.ts`** — `CreateVideoBody`, `WatchEditsBody`, `VideoIdParams`. Update `videos.ts` to use `safeParse`. Run `pnpm test:e2e`.

17. **Add `routes/uploads/schemas.ts`** — upload body schemas. Update `uploads.ts`. Run `pnpm test:e2e`.

18. **Add `routes/webhooks/schemas.ts`** — webhook body. Update `webhooks.ts`. Run `pnpm test`.

19. **Add `routes/library/schemas.ts`** and `routes/debug/schemas.ts`. Complete validation sweep.

### Phase 5 — Route Splitting

20. **Split `videos.ts`** into `routes/videos/{create,status,watch-edits,delete,retry}.ts` + `routes/videos/index.ts`. This is a file split only — no logic change. Run `pnpm test:e2e`.

21. **Split `uploads.ts`** similarly. Run `pnpm test:e2e`.

22. **Extract debug routes** from `system.ts` into `routes/debug/`. Run `pnpm test:e2e`.

23. **Split `system.ts`** into `routes/system/provider-status.ts` + `routes/system/dev-ui.ts`.

### Phase 6 — Test Coverage

24. **Add `lib/crypto.test.ts`** — HMAC tests.

25. **Add route handler unit tests** using `buildApp()` + `app.inject()`. Start with `routes/videos/create.test.ts`.

26. **Add `lib/idempotency.test.ts`** integration tests.

27. **Add webhook route integration tests** for signature rejection, deduplication, and monotonic guard.

28. **Add library pagination integration tests**.

### Phase 7 — Strict Mode (Optional but Recommended)

29. Enable `"strict": true` in `tsconfig.json`. Fix all type errors. Run full test suite.

---

### Verification Checkpoints

At the end of each phase, run:
```bash
pnpm typecheck
pnpm test
pnpm test:integration  # requires running DB + MinIO
```

The E2E test suite (`pnpm test:e2e`) should pass after every phase that touches route logic.

No route behavior, DB schema, or API contract changes are required or implied by this plan.
