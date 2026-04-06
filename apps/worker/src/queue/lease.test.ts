import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { JobRow } from "../types.js";

const withTransactionMock = vi.fn();

vi.mock("@cap/db", () => ({
  withTransaction: withTransactionMock
}));

const job: JobRow = {
  id: 7,
  video_id: "11111111-1111-1111-1111-111111111111",
  job_type: "process_video",
  lease_token: "lease-token",
  payload: {},
  attempts: 1,
  max_attempts: 6
};

beforeEach(() => {
  process.env.DATABASE_URL = "postgres://cap5:cap5_test@localhost:5432/cap5_test";
  process.env.MEDIA_SERVER_WEBHOOK_SECRET = "test-webhook-secret-with-32-plus-chars";
  process.env.DEEPGRAM_API_KEY = "test-deepgram";
  process.env.GROQ_API_KEY = "test-groq";
  process.env.S3_ACCESS_KEY = "test-access-key";
  process.env.S3_SECRET_KEY = "test-secret-key";
  process.env.WORKER_ID = "worker-test";
  process.env.WORKER_LEASE_SECONDS = "60";
});

afterEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
});

describe("queue lease helpers", () => {
  it("marks fatal failures as dead", async () => {
    const queryMock = vi.fn().mockResolvedValue({ rows: [{ id: 7, status: "dead" }] });
    withTransactionMock.mockImplementation(async (_dbUrl, fn) => fn({ query: queryMock }));

    const { fail } = await import("./lease.js");
    const result = await fail(job, new Error("boom"), true);

    expect(result).toEqual({ id: 7, status: "dead" });
    expect(queryMock).toHaveBeenCalledTimes(1);
    expect(queryMock.mock.calls[0]?.[1]).toEqual([7, "worker-test", "lease-token", "boom", true]);
  });

  it("requeues non-fatal failures when the queue returns queued", async () => {
    const queryMock = vi.fn().mockResolvedValue({ rows: [{ id: 7, status: "queued" }] });
    withTransactionMock.mockImplementation(async (_dbUrl, fn) => fn({ query: queryMock }));

    const { fail } = await import("./lease.js");
    const result = await fail(job, "temporary outage", false);

    expect(result).toEqual({ id: 7, status: "queued" });
    expect(queryMock.mock.calls[0]?.[1]).toEqual([7, "worker-test", "lease-token", "temporary outage", false]);
  });

  it("throws when markRunning loses the lease", async () => {
    const queryMock = vi.fn().mockResolvedValue({ rowCount: 0 });
    const client = { query: queryMock };

    const { markRunning } = await import("./lease.js");

    await expect(markRunning(client as never, job)).rejects.toThrow("unable to transition job 7 to running");
  });
});
