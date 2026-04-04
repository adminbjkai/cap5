import type { APIRequestContext } from "@playwright/test";

const apiPort = Number(process.env.WEB_API_PORT || 3000);

export const API_BASE = (process.env.E2E_API_URL || `http://127.0.0.1:${apiPort}`).replace(/\/$/, "");
const E2E_AUTH_EMAIL = "e2e@cap5.local";
const E2E_AUTH_PASSWORD = "cap5-e2e-password";

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

export async function ensureAuthenticated(request: APIRequestContext): Promise<void> {
  const statusResponse = await request.get(`${API_BASE}/api/auth/status`);
  if (!statusResponse.ok()) {
    throw new Error(`Unable to check auth status: ${statusResponse.status()} ${await statusResponse.text()}`);
  }

  const { setupRequired } = (await statusResponse.json()) as { setupRequired: boolean };

  if (setupRequired) {
    const setupResponse = await request.post(`${API_BASE}/api/auth/setup`, {
      headers: {
        "Content-Type": "application/json",
      },
      data: {
        email: E2E_AUTH_EMAIL,
        password: E2E_AUTH_PASSWORD,
      },
    });

    if (![201, 409].includes(setupResponse.status())) {
      throw new Error(`Unable to set up e2e auth user: ${setupResponse.status()} ${await setupResponse.text()}`);
    }
  }

  const loginResponse = await request.post(`${API_BASE}/api/auth/login`, {
    headers: {
      "Content-Type": "application/json",
    },
    data: {
      email: E2E_AUTH_EMAIL,
      password: E2E_AUTH_PASSWORD,
    },
  });

  if (!loginResponse.ok()) {
    throw new Error(`Unable to log in e2e auth user: ${loginResponse.status()} ${await loginResponse.text()}`);
  }
}
