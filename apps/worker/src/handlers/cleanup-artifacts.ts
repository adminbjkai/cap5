import { getEnv } from "@cap/config";
import { withTransaction } from "@cap/db";
import type { JobRow } from "../types.js";
import { ack } from "../queue/index.js";
import { getS3ClientAndBucket, deleteObjects } from "../lib/s3.js";
import { log } from "./shared.js";

const env = getEnv();

// Use the module-level S3 client — do NOT re-initialize per job
const { client: s3Client, bucket: s3Bucket } = getS3ClientAndBucket();

export async function handleCleanupArtifacts(job: JobRow): Promise<void> {
  const videoId = job.video_id;
  const keysToDelete: string[] = [];

  await withTransaction(env.DATABASE_URL, async (client) => {
    const videoResult = await client.query<{
      thumbnail_key: string | null;
      result_key: string | null;
    }>(
      `SELECT thumbnail_key, result_key FROM videos WHERE id = $1::uuid`,
      [videoId]
    );

    if (videoResult.rowCount != null && videoResult.rowCount > 0 && videoResult.rows[0]) {
      const row = videoResult.rows[0];
      if (row.thumbnail_key) keysToDelete.push(row.thumbnail_key);
      if (row.result_key) keysToDelete.push(row.result_key);
    }

    const uploadResult = await client.query<{ raw_key: string | null }>(
      `SELECT raw_key FROM uploads WHERE video_id = $1::uuid`,
      [videoId]
    );

    for (const row of uploadResult.rows) {
      if (row.raw_key) keysToDelete.push(row.raw_key);
    }

    const transcriptResult = await client.query<{ vtt_key: string | null }>(
      `SELECT vtt_key FROM transcripts WHERE video_id = $1::uuid`,
      [videoId]
    );

    for (const row of transcriptResult.rows) {
      if (row.vtt_key) keysToDelete.push(row.vtt_key);
    }
  });

  if (keysToDelete.length > 0) {
    await deleteObjects(s3Client, s3Bucket, keysToDelete);
    log("job.cleanup.deleted_objects", { job_id: job.id, video_id: videoId, count: keysToDelete.length });
  } else {
    log("job.cleanup.no_objects", { job_id: job.id, video_id: videoId });
  }

  await withTransaction(env.DATABASE_URL, async (client) => {
    await ack(client, job);
  });
}
