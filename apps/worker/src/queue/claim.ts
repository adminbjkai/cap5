import { getEnv } from "@cap/config";
import { withTransaction } from "@cap/db";
import type { JobRow, JobType } from "../types.js";
import { CLAIM_SQL, CLAIM_SQL_WITH_EXCLUDE, RECLAIM_SQL } from "./sql.js";

const env = getEnv();

function log(event: string, fields: Record<string, unknown>) {
  console.log(JSON.stringify({ service: "worker", event, ...fields }));
}

export async function claimOne(excludeTypes: JobType[] = []): Promise<JobRow | null> {
  return withTransaction(env.DATABASE_URL, async (client) => {
    const sql = excludeTypes.length > 0 ? CLAIM_SQL_WITH_EXCLUDE(excludeTypes.length) : CLAIM_SQL;
    const params = [1, env.WORKER_ID, `${env.WORKER_LEASE_SECONDS} seconds`, ...excludeTypes];
    const result = await client.query<JobRow>(sql, params);
    return result.rows[0] ?? null;
  });
}

export async function reclaimExpiredLeases(): Promise<Array<{ id: number; video_id: string; job_type: JobType; status: string }>> {
  return withTransaction(env.DATABASE_URL, async (client) => {
    const result = await client.query(RECLAIM_SQL, [env.WORKER_CLAIM_BATCH_SIZE]);
    return result.rows;
  });
}
