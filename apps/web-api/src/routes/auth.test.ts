import Fastify from "fastify";
import cookie from "@fastify/cookie";
import type { Logger } from "@cap/logger";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Minimal shape the auth routes reach for; cast through `unknown` to avoid
// pulling in every Logger method in this test mock.
const mockServiceLogger = (): Logger =>
  ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    trace: vi.fn(),
    withContext: vi.fn(),
    logger: {},
    context: {},
    logRequest: vi.fn()
  }) as unknown as Logger;

const queryMock = vi.fn();
const verifyPasswordMock = vi.fn();
const signTokenMock = vi.fn(() => "signed-token");
const parseExpiresInMock = vi.fn(() => 604800);
const hashPasswordMock = vi.fn();

vi.mock("@cap/db", () => ({
  query: queryMock
}));

vi.mock("../lib/auth.js", () => ({
  hashPassword: hashPasswordMock,
  verifyPassword: verifyPasswordMock,
  signToken: signTokenMock,
  parseExpiresIn: parseExpiresInMock
}));

describe("authRoutes login hardening", () => {
  beforeEach(() => {
    process.env.DATABASE_URL = "postgres://cap5:cap5_test@localhost:5432/cap5_test";
    process.env.MEDIA_SERVER_WEBHOOK_SECRET = "test-webhook-secret-with-32-plus-chars";
    process.env.JWT_SECRET = "test-jwt-secret-with-32-plus-chars";
    process.env.DEEPGRAM_API_KEY = "test-deepgram";
    process.env.GROQ_API_KEY = "test-groq";
    process.env.S3_ACCESS_KEY = "test-access-key";
    process.env.S3_SECRET_KEY = "test-secret-key";
    process.env.NODE_ENV = "test";
  });

  afterEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  it("rate limits repeated failed logins for the same email and IP", async () => {
    queryMock.mockResolvedValue({ rowCount: 1, rows: [{ id: "user-1", password_hash: "hash" }] });
    verifyPasswordMock.mockResolvedValue(false);

    const app = Fastify();
    app.decorate("serviceLogger", mockServiceLogger());
    await app.register(cookie);
    const { authRoutes } = await import("./auth.js");
    await app.register(authRoutes);

    for (let i = 0; i < 5; i += 1) {
      const response = await app.inject({
        method: "POST",
        url: "/api/auth/login",
        headers: { "content-type": "application/json", "x-real-ip": "10.0.0.8" },
        payload: { email: "test@example.com", password: "wrongpass" }
      });
      expect(response.statusCode).toBe(401);
    }

    const limited = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      headers: { "content-type": "application/json", "x-real-ip": "10.0.0.8" },
      payload: { email: "test@example.com", password: "wrongpass" }
    });

    expect(limited.statusCode).toBe(429);
    expect(limited.headers["retry-after"]).toBeTruthy();
    expect(queryMock).toHaveBeenCalledTimes(5);

    await app.close();
  });

  it("clears failed-attempt state after a successful login", async () => {
    queryMock.mockResolvedValue({ rowCount: 1, rows: [{ id: "user-1", password_hash: "hash" }] });
    verifyPasswordMock
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true);

    const app = Fastify();
    app.decorate("serviceLogger", mockServiceLogger());
    await app.register(cookie);
    const { authRoutes } = await import("./auth.js");
    await app.register(authRoutes);

    for (let i = 0; i < 2; i += 1) {
      const response = await app.inject({
        method: "POST",
        url: "/api/auth/login",
        headers: { "content-type": "application/json", "x-real-ip": "10.0.0.9" },
        payload: { email: "test@example.com", password: "wrongpass" }
      });
      expect(response.statusCode).toBe(401);
    }

    const success = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      headers: { "content-type": "application/json", "x-real-ip": "10.0.0.9" },
      payload: { email: "test@example.com", password: "correctpass" }
    });

    expect(success.statusCode).toBe(200);
    expect(success.headers["set-cookie"]).toContain("cap5_token=");

    verifyPasswordMock.mockResolvedValue(false);
    const afterSuccess = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      headers: { "content-type": "application/json", "x-real-ip": "10.0.0.9" },
      payload: { email: "test@example.com", password: "wrongpass" }
    });

    expect(afterSuccess.statusCode).toBe(401);

    await app.close();
  });
});
