export const CLAIM_SQL = `
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
SET status = 'leased',
    locked_by = $2,
    locked_until = now() + $3::interval,
    lease_token = gen_random_uuid(),
    attempts = j.attempts + 1,
    last_attempt_at = now(),
    last_error = NULL,
    updated_at = now()
FROM candidates c
WHERE j.id = c.id
RETURNING j.id, j.video_id, j.job_type, j.lease_token, j.payload, j.attempts, j.max_attempts;
`;

export const CLAIM_SQL_WITH_EXCLUDE = (excludeCount: number): string => `
WITH candidates AS (
  SELECT id
  FROM job_queue
  WHERE status IN ('queued', 'leased')
    AND run_after <= now()
    AND attempts < max_attempts
    AND (status = 'queued' OR locked_until < now())
    AND job_type NOT IN (${Array.from({ length: excludeCount }, (_, i) => `$${i + 4}`).join(",")})
  ORDER BY priority DESC, run_after ASC, id ASC
  FOR UPDATE SKIP LOCKED
  LIMIT $1
)
UPDATE job_queue j
SET status = 'leased',
    locked_by = $2,
    locked_until = now() + $3::interval,
    lease_token = gen_random_uuid(),
    attempts = j.attempts + 1,
    last_attempt_at = now(),
    last_error = NULL,
    updated_at = now()
FROM candidates c
WHERE j.id = c.id
RETURNING j.id, j.video_id, j.job_type, j.lease_token, j.payload, j.attempts, j.max_attempts;
`;

export const MARK_RUNNING_SQL = `
UPDATE job_queue
SET status = 'running', updated_at = now()
WHERE id = $1
  AND locked_by = $2
  AND lease_token = $3
  AND status = 'leased'
RETURNING id;
`;

export const HEARTBEAT_SQL = `
UPDATE job_queue
SET locked_until = now() + $4::interval,
    updated_at = now()
WHERE id = $1
  AND locked_by = $2
  AND lease_token = $3
  AND status IN ('leased', 'running')
  AND locked_until > now()
RETURNING id;
`;

export const ACK_SQL = `
UPDATE job_queue
SET status = 'succeeded',
    locked_by = NULL,
    locked_until = NULL,
    lease_token = NULL,
    finished_at = now(),
    updated_at = now()
WHERE id = $1
  AND locked_by = $2
  AND lease_token = $3
  AND status IN ('leased', 'running')
RETURNING id;
`;

export const FAIL_SQL = `
UPDATE job_queue
SET status = (CASE WHEN $5 = true OR attempts >= max_attempts THEN 'dead' ELSE 'queued' END)::job_status,
    run_after = CASE
      WHEN $5 = true OR attempts >= max_attempts THEN run_after
      ELSE now() + make_interval(secs => LEAST(7200, (30 * power(2, GREATEST(0, attempts - 1)))::INT))
    END,
    last_error = $4,
    locked_by = NULL,
    locked_until = NULL,
    lease_token = NULL,
    finished_at = CASE WHEN $5 = true OR attempts >= max_attempts THEN now() ELSE NULL END,
    updated_at = now()
WHERE id = $1
  AND locked_by = $2
  AND lease_token = $3
  AND status IN ('leased', 'running')
RETURNING id, status;
`;

export const RECLAIM_SQL = `
WITH stale AS (
  SELECT id
  FROM job_queue
  WHERE status IN ('leased', 'running')
    AND locked_until < now()
  ORDER BY locked_until ASC
  FOR UPDATE SKIP LOCKED
  LIMIT $1
)
UPDATE job_queue j
SET status = (CASE WHEN attempts >= max_attempts THEN 'dead' ELSE 'queued' END)::job_status,
    run_after = CASE
      WHEN attempts >= max_attempts THEN run_after
      ELSE now() + make_interval(secs => LEAST(7200, (30 * power(2, GREATEST(0, attempts - 1)))::INT))
    END,
    last_error = COALESCE(last_error, 'Lease expired'),
    locked_by = NULL,
    locked_until = NULL,
    lease_token = NULL,
    finished_at = CASE WHEN attempts >= max_attempts THEN now() ELSE NULL END,
    updated_at = now()
FROM stale s
WHERE j.id = s.id
RETURNING j.id, j.video_id, j.job_type, j.status;
`;

export const CLEANUP_MAINTENANCE_SQL = `
DELETE FROM idempotency_keys WHERE expires_at < now();
DELETE FROM webhook_events WHERE created_at < now() - interval '7 days';
`;
