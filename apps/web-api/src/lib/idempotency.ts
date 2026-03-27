/**
 * Idempotency helpers for route handlers.
 */

import type { IdempotencyBeginResult } from "../types/video.js";

function badRequest(message: string) {
  return { ok: false, error: message };
}

type QueryResult<Row extends Record<string, unknown>> = {
  rowCount: number;
  rows: Row[];
};

type QueryClient = {
  query<Row extends Record<string, unknown> = Record<string, unknown>>(
    text: string,
    params?: readonly unknown[]
  ): Promise<QueryResult<Row>>;
};

export async function idempotencyBegin(args: {
  client: QueryClient;
  endpoint: string;
  idempotencyKey: string;
  requestHash: string;
  ttlInterval: string;
}): Promise<IdempotencyBeginResult> {
  // Allow reuse after expiry (best-effort; there is no cleanup job yet).
  await args.client.query(
    `DELETE FROM idempotency_keys
     WHERE endpoint = $1
       AND idempotency_key = $2
       AND expires_at < now()`,
    [args.endpoint, args.idempotencyKey]
  );

  const inserted = await args.client.query(
    `INSERT INTO idempotency_keys (endpoint, idempotency_key, request_hash, expires_at)
     VALUES ($1, $2, $3, now() + $4::interval)
     ON CONFLICT DO NOTHING
     RETURNING endpoint`,
    [args.endpoint, args.idempotencyKey, args.requestHash, args.ttlInterval]
  );

  if (inserted.rowCount > 0) return { kind: "proceed" };

  const existing = await args.client.query(
    `SELECT request_hash, status_code, response_body
     FROM idempotency_keys
     WHERE endpoint = $1 AND idempotency_key = $2`,
    [args.endpoint, args.idempotencyKey]
  );

  if (existing.rowCount === 0) {
    return { kind: "conflict", statusCode: 409, body: badRequest("Idempotency key collision") };
  }

  const row = existing.rows[0] as { request_hash?: string; status_code?: number | null; response_body?: unknown };
  if (row.request_hash !== args.requestHash) {
    return { kind: "conflict", statusCode: 409, body: badRequest("Idempotency key reuse with different request payload") };
  }

  if (typeof row.status_code === "number" && row.response_body && typeof row.response_body === "object") {
    return { kind: "cached", statusCode: row.status_code, body: row.response_body as Record<string, unknown> };
  }

  return { kind: "conflict", statusCode: 409, body: badRequest("Duplicate request still in progress") };
}

export async function idempotencyFinish(args: {
  client: QueryClient;
  endpoint: string;
  idempotencyKey: string;
  statusCode: number;
  body: Record<string, unknown>;
}): Promise<void> {
  await args.client.query(
    `UPDATE idempotency_keys
     SET status_code = $3,
         response_body = $4::jsonb
     WHERE endpoint = $1 AND idempotency_key = $2`,
    [args.endpoint, args.idempotencyKey, args.statusCode, JSON.stringify(args.body)]
  );
}
