import crypto from "node:crypto";

export function getOutboundWebhookSecret(env: Record<string, string | undefined> = process.env): string {
  const secret = env.OUTBOUND_WEBHOOK_SECRET ?? env.MEDIA_SERVER_WEBHOOK_SECRET;

  if (!secret || secret.length < 32) {
    throw new Error("Outbound webhook secret must be at least 32 characters");
  }

  return secret;
}

export function signOutboundWebhook(raw: string, timestamp: string, env: Record<string, string | undefined> = process.env): string {
  const digest = crypto
    .createHmac("sha256", getOutboundWebhookSecret(env))
    .update(`${timestamp}.${raw}`)
    .digest("hex");

  return `v1=${digest}`;
}
