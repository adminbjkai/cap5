import { describe, expect, it } from "vitest";
import {
  InMemoryLoginRateLimiter,
  LOGIN_RATE_LIMIT_LOCK_MS,
  LOGIN_RATE_LIMIT_MAX_ATTEMPTS,
  LOGIN_RATE_LIMIT_WINDOW_MS
} from "./login-rate-limit.js";

describe("InMemoryLoginRateLimiter", () => {
  it("blocks after the configured number of failures", () => {
    const limiter = new InMemoryLoginRateLimiter();
    const now = 1710000000000;

    for (let i = 0; i < LOGIN_RATE_LIMIT_MAX_ATTEMPTS - 1; i += 1) {
      expect(limiter.recordFailure("ip:user@example.com", now + i * 1000)).toEqual({ allowed: true });
    }

    expect(limiter.recordFailure("ip:user@example.com", now + LOGIN_RATE_LIMIT_MAX_ATTEMPTS * 1000)).toEqual({
      allowed: false,
      retryAfterSeconds: Math.ceil(LOGIN_RATE_LIMIT_LOCK_MS / 1000)
    });
  });

  it("allows requests again after the lock window expires", () => {
    const limiter = new InMemoryLoginRateLimiter();
    const now = 1710000000000;

    for (let i = 0; i < LOGIN_RATE_LIMIT_MAX_ATTEMPTS; i += 1) {
      limiter.recordFailure("ip:user@example.com", now + i * 1000);
    }

    expect(limiter.check("ip:user@example.com", now + LOGIN_RATE_LIMIT_LOCK_MS + LOGIN_RATE_LIMIT_WINDOW_MS + 1000)).toEqual({ allowed: true });
  });

  it("clears failure state after a successful login", () => {
    const limiter = new InMemoryLoginRateLimiter();
    limiter.recordFailure("ip:user@example.com", 1710000000000);
    limiter.clear("ip:user@example.com");
    expect(limiter.check("ip:user@example.com", 1710000001000)).toEqual({ allowed: true });
  });
});
