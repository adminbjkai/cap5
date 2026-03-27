import { getEnv } from "@cap/config";
import { withTransaction } from "@cap/db";
import { CLEANUP_MAINTENANCE_SQL } from "./sql.js";

const env = getEnv();

export async function runMaintenance(): Promise<void> {
  await withTransaction(env.DATABASE_URL, async (client) => {
    await client.query(CLEANUP_MAINTENANCE_SQL);
  });
}
