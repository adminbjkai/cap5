/**
 * Auth routes:
 *   POST /api/auth/setup    — create initial account
 *   POST /api/auth/login    — authenticate and get token
 *   POST /api/auth/logout   — clear token cookie
 *   GET  /api/auth/me       — get current user
 *   GET  /api/auth/status   — check if setup is required
 */

import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { getEnv } from '@cap/config';
import { query } from '@cap/db';
import { hashPassword, verifyPassword, signToken, parseExpiresIn } from '../lib/auth.js';
import { InMemoryLoginRateLimiter, getLoginAttemptKey } from '../lib/login-rate-limit.js';
import { parseBody } from '../plugins/validation.js';

const env = getEnv();
const loginRateLimiter = new InMemoryLoginRateLimiter();

const LoginSchema = z.object({
  email: z.string().email().min(1),
  password: z.string().min(8),
});

const SetupSchema = z.object({
  email: z.string().email().min(1),
  password: z.string().min(8),
});

function logAuthEvent(
  app: FastifyInstance,
  level: "info" | "warn",
  message: string,
  fields: Record<string, unknown>
): void {
  if (level === "warn") {
    app.serviceLogger?.warn(message, fields);
    return;
  }

  app.serviceLogger?.info(message, fields);
}

export async function authRoutes(app: FastifyInstance) {
  // ------------------------------------------------------------------
  // GET /api/auth/status — check if setup is required (always public)
  // ------------------------------------------------------------------

  app.get('/api/auth/status', async (_req, reply) => {
    const result = await query<{ count: number }>(
      env.DATABASE_URL,
      'SELECT count(*)::int as count FROM users'
    );

    const count = result.rows[0]?.count ?? 0;
    return reply.send({
      setupRequired: count === 0,
    });
  });

  // ------------------------------------------------------------------
  // POST /api/auth/setup — create initial account (one-time only)
  // ------------------------------------------------------------------

  app.post<{ Body: { email: string; password: string } }>(
    '/api/auth/setup',
    async (req, reply) => {
      const body = parseBody(SetupSchema, req.body);
      const email = body.email.toLowerCase();

      // Check if any users exist
      const countResult = await query<{ count: number }>(
        env.DATABASE_URL,
        'SELECT count(*)::int as count FROM users'
      );

      const count = countResult.rows[0]?.count ?? 0;
      if (count > 0) {
        return reply.code(409).send({ error: 'Account already exists' });
      }

      // Hash password and insert user
      const passwordHash = await hashPassword(body.password);

      const result = await query<{ id: string }>(
        env.DATABASE_URL,
        'INSERT INTO users (email, password_hash) VALUES ($1, $2) RETURNING id',
        [email, passwordHash]
      );

      const userId = result.rows[0]?.id;
      if (!userId) {
        return reply.code(500).send({ error: 'Failed to create account' });
      }

      return reply.code(201).send({
        ok: true,
        userId,
      });
    }
  );

  // ------------------------------------------------------------------
  // POST /api/auth/login — authenticate and get token
  // ------------------------------------------------------------------

  app.post<{ Body: { email: string; password: string } }>(
    '/api/auth/login',
    async (req, reply) => {
      const body = parseBody(LoginSchema, req.body);
      const email = body.email.toLowerCase();
      const attemptKey = getLoginAttemptKey(req, email);
      const gate = loginRateLimiter.check(attemptKey);

      if (!gate.allowed) {
        reply.header('Retry-After', String(gate.retryAfterSeconds));
        logAuthEvent(app, 'warn', 'auth.login_rate_limited', { email, ip: req.ip, retryAfterSeconds: gate.retryAfterSeconds });
        return reply.code(429).send({ error: 'Too many login attempts. Try again later.' });
      }

      // Look up user by email
      const userResult = await query<{ id: string; password_hash: string }>(
        env.DATABASE_URL,
        'SELECT id, password_hash FROM users WHERE email = $1',
        [email]
      );

      if (userResult.rowCount === 0) {
        loginRateLimiter.recordFailure(attemptKey);
        logAuthEvent(app, 'warn', 'auth.login_failed', { email, ip: req.ip, reason: 'user_not_found' });
        return reply.code(401).send({ error: 'Invalid credentials' });
      }

      const user = userResult.rows[0]!;

      // Verify password
      const passwordValid = await verifyPassword(body.password, user.password_hash);
      if (!passwordValid) {
        loginRateLimiter.recordFailure(attemptKey);
        logAuthEvent(app, 'warn', 'auth.login_failed', { email, ip: req.ip, reason: 'invalid_password', userId: user.id });
        return reply.code(401).send({ error: 'Invalid credentials' });
      }

      loginRateLimiter.clear(attemptKey);

      // Sign token
      const token = signToken(user.id);

      // Set httpOnly cookie
      const cookieMaxAge = parseExpiresIn(env.JWT_EXPIRES_IN);
      reply.setCookie('cap5_token', token, {
        path: '/',
        httpOnly: true,
        sameSite: 'strict',
        secure: env.NODE_ENV === 'production',
        maxAge: cookieMaxAge,
      });

      logAuthEvent(app, 'info', 'auth.login_succeeded', { email, ip: req.ip, userId: user.id });

      return reply.send({
        ok: true,
        token,
        expiresIn: env.JWT_EXPIRES_IN,
      });
    }
  );

  // ------------------------------------------------------------------
  // POST /api/auth/logout — clear cookie
  // ------------------------------------------------------------------

  app.post('/api/auth/logout', async (_req, reply) => {
    reply.clearCookie('cap5_token', { path: '/' });
    return reply.send({ ok: true });
  });

  // ------------------------------------------------------------------
  // GET /api/auth/me — get current user (requires auth)
  // ------------------------------------------------------------------

  app.get('/api/auth/me', async (req, reply) => {
    if (!req.authenticated || !req.userId) {
      return reply.code(401).send({ error: 'Unauthorized' });
    }

    const userResult = await query<{ id: string; email: string; created_at: string }>(
      env.DATABASE_URL,
      'SELECT id, email, created_at FROM users WHERE id = $1',
      [req.userId]
    );

    if (userResult.rowCount === 0) {
      return reply.code(404).send({ error: 'User not found' });
    }

    const user = userResult.rows[0]!;
    return reply.send({
      userId: user.id,
      email: user.email,
      createdAt: user.created_at,
    });
  });
}
