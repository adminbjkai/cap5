import type { APIRequestContext } from "@playwright/test";

const apiPort = Number(process.env.WEB_API_PORT || 3000);

export const API_BASE = (process.env.E2E_API_URL || `http://127.0.0.1:${apiPort}`).replace(/\/$/, "");

export async function assertApiHealthy(request: APIRequestContext): Promise<void> {
  let response;
  try {
    response = await request.get(`${API_BASE}/health`);
  } catch (error) {
    throw new Error(
      `Cannot reach web-api at ${API_BASE}. ` +
        `Make sure the API and required backing services are running and healthy, then retry 'pnpm --filter @cap/web-api test:e2e' (for local Docker setups, 'docker compose up -d' is the common option).\n` +
        `Underlying error: ${error}`
    );
  }

  if (!response.ok()) {
    throw new Error(
      `web-api /health returned HTTP ${response.status()} at ${API_BASE}. ` +
        `Check 'docker compose logs web-api' and confirm Postgres and MinIO are running.`
    );
  }
}
