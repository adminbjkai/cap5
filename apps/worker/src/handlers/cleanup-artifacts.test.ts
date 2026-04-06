import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { JobRow } from "../types.js";

const withTransactionMock = vi.fn();
const ackMock = vi.fn(async () => undefined);
const deleteObjectsMock = vi.fn(async () => undefined);
const logMock = vi.fn();

vi.mock("@cap/db", () => ({
  withTransaction: withTransactionMock
}));

vi.mock("../queue/index.js", () => ({
  ack: ackMock
}));

vi.mock("../lib/s3.js", () => ({
  getS3ClientAndBucket: () => ({ client: { mocked: true }, bucket: "cap5" }),
  deleteObjects: deleteObjectsMock
}));

vi.mock("./shared.js", () => ({
  log: logMock
}));

const job: JobRow = {
  id: 55,
  video_id: "11111111-1111-1111-1111-111111111111",
  job_type: "cleanup_artifacts",
  lease_token: "lease-token",
  payload: {},
  attempts: 0,
  max_attempts: 5
};

beforeEach(() => {
  process.env.DATABASE_URL = "postgres://cap5:cap5_test@localhost:5432/cap5_test";
  process.env.MEDIA_SERVER_WEBHOOK_SECRET = "test-webhook-secret-with-32-plus-chars";
  process.env.DEEPGRAM_API_KEY = "test-deepgram";
  process.env.GROQ_API_KEY = "test-groq";
  process.env.S3_ACCESS_KEY = "test-access-key";
  process.env.S3_SECRET_KEY = "test-secret-key";
});

afterEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
});

describe("handleCleanupArtifacts", () => {
  it("collects all artifact keys, deletes them, and acks the job", async () => {
    const client = {
      query: vi
        .fn()
        .mockResolvedValueOnce({ rowCount: 1, rows: [{ thumbnail_key: "thumb.jpg", result_key: "result.mp4" }] })
        .mockResolvedValueOnce({ rows: [{ raw_key: "raw-1.mp4" }, { raw_key: "raw-2.mp4" }] })
        .mockResolvedValueOnce({ rows: [{ vtt_key: "captions.vtt" }] })
    };

    withTransactionMock
      .mockImplementationOnce(async (_dbUrl, fn) => fn(client))
      .mockImplementationOnce(async (_dbUrl, fn) => fn({ query: vi.fn() }));

    const { handleCleanupArtifacts } = await import("./cleanup-artifacts.js");
    await handleCleanupArtifacts(job);

    expect(deleteObjectsMock).toHaveBeenCalledWith({ mocked: true }, "cap5", [
      "thumb.jpg",
      "result.mp4",
      "raw-1.mp4",
      "raw-2.mp4",
      "captions.vtt"
    ]);
    expect(ackMock).toHaveBeenCalledTimes(1);
    expect(logMock).toHaveBeenCalledWith(
      "job.cleanup.deleted_objects",
      expect.objectContaining({ job_id: 55, count: 5 })
    );
  });

  it("logs no_objects and still acks when nothing is found", async () => {
    const client = {
      query: vi
        .fn()
        .mockResolvedValueOnce({ rowCount: 0, rows: [] })
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [] })
    };

    withTransactionMock
      .mockImplementationOnce(async (_dbUrl, fn) => fn(client))
      .mockImplementationOnce(async (_dbUrl, fn) => fn({ query: vi.fn() }));

    const { handleCleanupArtifacts } = await import("./cleanup-artifacts.js");
    await handleCleanupArtifacts(job);

    expect(deleteObjectsMock).not.toHaveBeenCalled();
    expect(ackMock).toHaveBeenCalledTimes(1);
    expect(logMock).toHaveBeenCalledWith(
      "job.cleanup.no_objects",
      expect.objectContaining({ job_id: 55, video_id: job.video_id })
    );
  });
});
