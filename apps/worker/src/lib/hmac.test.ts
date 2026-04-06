import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => {
  vi.resetModules();
  delete process.env.OUTBOUND_WEBHOOK_SECRET;
  delete process.env.MEDIA_SERVER_WEBHOOK_SECRET;
});

describe("outbound webhook signing", () => {
  it("uses OUTBOUND_WEBHOOK_SECRET when provided", async () => {
    const { signOutboundWebhook } = await import("./hmac.js");
    const signature = signOutboundWebhook('{"ok":true}', "1710000000", {
      MEDIA_SERVER_WEBHOOK_SECRET: "media-server-secret-with-32-plus-chars",
      OUTBOUND_WEBHOOK_SECRET: "outbound-secret-with-32-plus-chars"
    });

    expect(signature).toMatch(/^v1=[0-9a-f]{64}$/);
  });

  it("falls back to MEDIA_SERVER_WEBHOOK_SECRET when no outbound secret is configured", async () => {
    const { signOutboundWebhook } = await import("./hmac.js");
    const signatureA = signOutboundWebhook('{"ok":true}', "1710000000", {
      MEDIA_SERVER_WEBHOOK_SECRET: "fallback-secret-with-32-plus-chars"
    });
    const signatureB = signOutboundWebhook('{"ok":true}', "1710000000", {
      MEDIA_SERVER_WEBHOOK_SECRET: "fallback-secret-with-32-plus-chars"
    });

    expect(signatureA).toBe(signatureB);
    expect(signatureA).toMatch(/^v1=[0-9a-f]{64}$/);
  });

  it("throws when neither signing secret is configured correctly", async () => {
    const { signOutboundWebhook } = await import("./hmac.js");

    expect(() => signOutboundWebhook('{"ok":true}', "1710000000", {})).toThrow(/at least 32 characters/);
  });
});
