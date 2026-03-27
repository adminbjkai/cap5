import { Pool, type PoolClient, type QueryResultRow } from "pg";

// URL-keyed pool cache — prevents the singleton bug where different DATABASE_URL
// values after first call would silently reuse the wrong connection.
const pools = new Map<string, Pool>();

export function createPool(url: string): Pool {
  return new Pool({
    connectionString: url,
    max: 20,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 5000,
  });
}

export function getPool(url: string): Pool {
  let pool = pools.get(url);
  if (!pool) {
    pool = createPool(url);
    pools.set(url, pool);
  }
  return pool;
}

/** Remove a pool from the cache and end it. Useful for test isolation. */
export async function resetPool(url: string): Promise<void> {
  const pool = pools.get(url);
  if (pool) {
    pools.delete(url);
    await pool.end();
  }
}

/** End all cached pools and clear the cache. Call in afterAll() for test teardown. */
export async function disconnectAll(): Promise<void> {
  const endings = Array.from(pools.values()).map((p) => p.end());
  pools.clear();
  await Promise.all(endings);
}

export async function query<T extends QueryResultRow = QueryResultRow>(
  databaseUrl: string,
  text: string,
  params: unknown[] = []
) {
  const p = getPool(databaseUrl);
  return p.query<T>(text, params);
}

export async function withTransaction<T>(
  databaseUrl: string,
  fn: (client: PoolClient) => Promise<T>
): Promise<T> {
  const p = getPool(databaseUrl);
  const client = await p.connect();
  try {
    await client.query("BEGIN");
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}
