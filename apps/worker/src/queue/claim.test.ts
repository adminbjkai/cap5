import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const withTransactionMock = vi.fn();

vi.mock("@cap/db", () => ({
  withTransaction: withTransactionMock
}));

beforeEach(() => {
  process.env.DATABASE_URL = "postgres://cap5:cap5_test@localhost:5432/cap5_test";
  process.env.MEDIA_SERVER_WEBHOOK_SECRET = "test-webhook-secret-with-32-plus-chars";
  process.env.DEEPGRAM_API_KEY = "test-deepgram";
  process.env.GROQ_API_KEY = "test-groq";
  process.env.S3_ACCESS_KEY = "test-access-key";
  process.env.S3_SECRET_KEY = "test-secret-key";
  process.env.WORKER_ID = "worker-test";
  process.env.WORKER_LEASE_SECONDS = "60";
  process.env.WORKER_RECLAIM_BATCH_SIZE = "25";
});

afterEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
});

describe("claimOne", () => {
  it("returns the first row from the claim SQL and forwards the lease params", async () => {
    const queryMock = vi.fn().mockResolvedValue({
      rows: [
        {
          id: 42,
          video_id: "22222222-2222-2222-2222-222222222222",
          job_type: "process_video",
          lease_token: "tok",
          payload: {},
          attempts: 1,
          max_attempts: 6
        }
      ]
    });
    withTransactionMock.mockImplementation(async (_dbUrl, fn) => fn({ query: queryMock }));

    const { claimOne } = await import("./claim.js");
    const result = await claimOne();

    expect(result).not.toBeNull();
    expect(result?.id).toBe(42);
    expect(queryMock).toHaveBeenCalledTimes(1);
    const params = queryMock.mock.calls[0]?.[1] as unknown[];
    // [limit, worker_id, lease_interval]
    expect(params[0]).toBe(1);
    expect(params[1]).toBe("worker-test");
    expect(params[2]).toBe("60 seconds");
  });

  it("returns null when no job is available", async () => {
    const queryMock = vi.fn().mockResolvedValue({ rows: [] });
    withTransactionMock.mockImplementation(async (_dbUrl, fn) => fn({ query: queryMock }));

    const { claimOne } = await import("./claim.js");
    const result = await claimOne();

    expect(result).toBeNull();
  });

  it("appends exclude types as trailing params when excludeTypes is non-empty", async () => {
    const queryMock = vi.fn().mockResolvedValue({ rows: [] });
    withTransactionMock.mockImplementation(async (_dbUrl, fn) => fn({ query: queryMock }));

    const { claimOne } = await import("./claim.js");
    await claimOne(["deliver_webhook", "cleanup_artifacts"]);

    expect(queryMock).toHaveBeenCalledTimes(1);
    const sql = queryMock.mock.calls[0]?.[0] as string;
    const params = queryMock.mock.calls[0]?.[1] as unknown[];
    // The excluded-types SQL variant references job_type NOT IN (...).
    expect(sql).toContain("job_type NOT IN");
    expect(params).toEqual([1, "worker-test", "60 seconds", "deliver_webhook", "cleanup_artifacts"]);
  });
});

describe("reclaimExpiredLeases", () => {
  it("uses WORKER_RECLAIM_BATCH_SIZE as the LIMIT parameter", async () => {
    const queryMock = vi.fn().mockResolvedValue({ rows: [] });
    withTransactionMock.mockImplementation(async (_dbUrl, fn) => fn({ query: queryMock }));

    const { reclaimExpiredLeases } = await import("./claim.js");
    await reclaimExpiredLeases();

    expect(queryMock).toHaveBeenCalledTimes(1);
    const params = queryMock.mock.calls[0]?.[1] as unknown[];
    expect(params).toEqual([25]);
  });

  it("returns the rows the reclaim SQL surfaced (retryable + dead)", async () => {
    const stale = [
      {
        id: 101,
        video_id: "33333333-3333-3333-3333-333333333333",
        job_type: "process_video",
        status: "queued"
      },
      {
        id: 102,
        video_id: "44444444-4444-4444-4444-444444444444",
        job_type: "transcribe_audio",
        status: "dead"
      }
    ];
    const queryMock = vi.fn().mockResolvedValue({ rows: stale });
    withTransactionMock.mockImplementation(async (_dbUrl, fn) => fn({ query: queryMock }));

    const { reclaimExpiredLeases } = await import("./claim.js");
    const result = await reclaimExpiredLeases();

    expect(result).toEqual(stale);
    // Verify we're actually executing the reclaim statement, not the claim one.
    const sql = queryMock.mock.calls[0]?.[0] as string;
    expect(sql).toContain("WITH stale AS");
    expect(sql).toContain("locked_until < now()");
  });

  it("honors a custom WORKER_RECLAIM_BATCH_SIZE from env", async () => {
    process.env.WORKER_RECLAIM_BATCH_SIZE = "7";
    const queryMock = vi.fn().mockResolvedValue({ rows: [] });
    withTransactionMock.mockImplementation(async (_dbUrl, fn) => fn({ query: queryMock }));

    const { reclaimExpiredLeases } = await import("./claim.js");
    await reclaimExpiredLeases();

    const params = queryMock.mock.calls[0]?.[1] as unknown[];
    expect(params).toEqual([7]);
  });
});
