import { getEnv } from "@cap/config";
import { withTransaction } from "@cap/db";
import type { JobRow } from "../types.js";
import { ack } from "../queue/index.js";
import { log } from "./shared.js";

const env = getEnv();

export async function handleDeliverWebhook(job: JobRow): Promise<void> {
  const payload = job.payload as { webhookUrl?: string; event?: string; videoId?: string; phase?: string; progress?: number };
  if (!payload.webhookUrl) {
    throw new Error("Missing webhookUrl in deliver_webhook payload");
  }

  const body = JSON.stringify({
    event: payload.event,
    videoId: payload.videoId,
    phase: payload.phase,
    progress: payload.progress,
    timestamp: new Date().toISOString()
  });

  try {
    const response = await fetch(payload.webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body
    });

    if (!response.ok) {
      throw new Error(`Webhook delivery failed with status ${response.status}`);
    }

    log("job.webhook.delivered", { job_id: job.id, video_id: job.video_id, event: payload.event });
  } catch (err: unknown) {
    log("job.webhook.delivery_failed", { job_id: job.id, video_id: job.video_id, error: String(err) });
    throw err;
  }

  await withTransaction(env.DATABASE_URL, async (client) => {
    await ack(client, job);
  });
}
