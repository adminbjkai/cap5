import type { FastifyRequest } from "fastify";

export const LOGIN_RATE_LIMIT_MAX_ATTEMPTS = 5;
export const LOGIN_RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000;
export const LOGIN_RATE_LIMIT_LOCK_MS = 15 * 60 * 1000;

type AttemptState = {
  failures: number[];
  blockedUntil: number | null;
};

export type LoginLimitStatus =
  | { allowed: true }
  | { allowed: false; retryAfterSeconds: number };

export class InMemoryLoginRateLimiter {
  private attempts = new Map<string, AttemptState>();

  check(key: string, now = Date.now()): LoginLimitStatus {
    const state = this.attempts.get(key);
    if (!state) return { allowed: true };

    this.pruneState(state, now);

    if (state.blockedUntil && state.blockedUntil > now) {
      return { allowed: false, retryAfterSeconds: Math.max(1, Math.ceil((state.blockedUntil - now) / 1000)) };
    }

    if (state.failures.length === 0) {
      this.attempts.delete(key);
    }

    return { allowed: true };
  }

  recordFailure(key: string, now = Date.now()): LoginLimitStatus {
    const state = this.attempts.get(key) ?? { failures: [], blockedUntil: null };
    this.pruneState(state, now);
    state.failures.push(now);

    if (state.failures.length >= LOGIN_RATE_LIMIT_MAX_ATTEMPTS) {
      state.blockedUntil = now + LOGIN_RATE_LIMIT_LOCK_MS;
    }

    this.attempts.set(key, state);
    return this.check(key, now);
  }

  clear(key: string): void {
    this.attempts.delete(key);
  }

  private pruneState(state: AttemptState, now: number): void {
    state.failures = state.failures.filter((ts) => now - ts < LOGIN_RATE_LIMIT_WINDOW_MS);
    if (state.blockedUntil && state.blockedUntil <= now) {
      state.blockedUntil = null;
    }
  }
}

export function getLoginAttemptKey(request: FastifyRequest, email: string): string {
  const forwarded = typeof request.headers["x-forwarded-for"] === "string"
    ? request.headers["x-forwarded-for"].split(",")[0]?.trim()
    : undefined;
  const realIp = typeof request.headers["x-real-ip"] === "string" ? request.headers["x-real-ip"].trim() : undefined;
  const ip = realIp || forwarded || request.ip || "unknown";
  return `${ip}:${email.trim().toLowerCase()}`;
}
