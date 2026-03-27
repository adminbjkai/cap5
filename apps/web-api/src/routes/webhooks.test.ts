import { beforeAll, describe, expect, it } from "vitest";

type WebhooksModule = typeof import("./webhooks.js");

let webhooks: WebhooksModule;

beforeAll(async () => {
  webhooks = await import("./webhooks.js");
});

describe("validateWebhookPayload", () => {
  it("accepts a valid payload and normalizes numeric job ids to strings", () => {
    const result = webhooks.validateWebhookPayload({
      jobId: 42,
      videoId: "550e8400-e29b-41d4-a716-446655440000",
      phase: "processing",
      progress: 55,
      metadata: {
        duration: 120.5,
        width: 1920,
        height: 1080,
        fps: 30
      }
    });

    expect(result.error).toBeUndefined();
    expect(result.payload).toEqual({
      jobId: "42",
      videoId: "550e8400-e29b-41d4-a716-446655440000",
      phase: "processing",
      progress: 55,
      metadata: {
        duration: 120.5,
        width: 1920,
        height: 1080,
        fps: 30
      }
    });
  });

  it("rejects missing job ids before database writes", () => {
    expect(
      webhooks.validateWebhookPayload({
        videoId: "550e8400-e29b-41d4-a716-446655440000",
        phase: "processing",
        progress: 55
      })
    ).toEqual({ error: "Missing or invalid jobId" });
  });

  it("rejects invalid video ids", () => {
    expect(
      webhooks.validateWebhookPayload({
        jobId: "job-1",
        videoId: "not-a-uuid",
        phase: "processing",
        progress: 55
      })
    ).toEqual({ error: "Missing or invalid videoId" });
  });
});
