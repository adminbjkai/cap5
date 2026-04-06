import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { JobRow } from "../types.js";

const ackMock = vi.fn(async () => undefined);
const withTransactionMock = vi.fn(async (_databaseUrl: string, fn: (client: unknown) => Promise<unknown>) => fn({ tx: true }));
const logMock = vi.fn();

vi.mock("@cap/db", () => ({
  withTransaction: withTransactionMock
}));

vi.mock("../queue/index.js", () => ({
  ack: ackMock
}));

vi.mock("./shared.js", () => ({
  log: logMock
}));

type MockResponse = {
  ok: boolean;
  status: number;
};

function createResponse(response: MockResponse): Response {
  return {
    ok: response.ok,
    status: response.status
  } as Response;
}

const job: JobRow = {
  id: 123,
  video_id: "11111111-1111-1111-1111-111111111111",
  job_type: "deliver_webhook",
  lease_token: "lease-token",
  payload: {
    webhookUrl: "https://example.com/webhook",
    event: "video.progress",
    videoId: "11111111-1111-1111-1111-111111111111",
    phase: "processing",
    progress: 60
  },
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
  delete process.env.OUTBOUND_WEBHOOK_SECRET;
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.clearAllMocks();
  vi.resetModules();
});

describe("handleDeliverWebhook", () => {
  it("sends signed outbound webhook headers and acks on success", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(createResponse({ ok: true, status: 200 })));
    vi.spyOn(Date, "now").mockReturnValue(1710000000000);

    const { signOutboundWebhook } = await import("../lib/hmac.js");
    const { handleDeliverWebhook } = await import("./deliver-webhook.js");

    await handleDeliverWebhook(job);

    const fetchMock = vi.mocked(fetch);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://example.com/webhook");
    expect(init.method).toBe("POST");
    expect(init.body).toBeTypeOf("string");

    const body = init.body as string;
    expect(JSON.parse(body)).toMatchObject({
      event: "video.progress",
      videoId: "11111111-1111-1111-1111-111111111111",
      phase: "processing",
      progress: 60
    });

    const headers = init.headers as Record<string, string>;
    expect(headers["Content-Type"]).toBe("application/json");
    expect(headers["x-cap-timestamp"]).toBe("1710000000");
    expect(headers["x-cap-delivery-id"]).toMatch(/^[0-9a-f-]{36}$/);
    expect(headers["x-cap-signature"]).toBe(signOutboundWebhook(body, "1710000000"));

    expect(withTransactionMock).toHaveBeenCalledTimes(1);
    expect(ackMock).toHaveBeenCalledTimes(1);
    expect(logMock).toHaveBeenCalledWith(
      "job.webhook.delivered",
      expect.objectContaining({ job_id: 123, delivery_id: headers["x-cap-delivery-id"] })
    );
  });

  it("logs and throws when delivery fails", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(createResponse({ ok: false, status: 502 })));
    vi.spyOn(Date, "now").mockReturnValue(1710000000000);

    const { handleDeliverWebhook } = await import("./deliver-webhook.js");

    await expect(handleDeliverWebhook(job)).rejects.toThrow("Webhook delivery failed with status 502");

    expect(ackMock).not.toHaveBeenCalled();
    expect(logMock).toHaveBeenCalledWith(
      "job.webhook.delivery_failed",
      expect.objectContaining({ job_id: 123, delivery_id: expect.stringMatching(/^[0-9a-f-]{36}$/) })
    );
  });
});
