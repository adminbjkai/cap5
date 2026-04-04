# Code Review: cap5 Auth System

**Date:** 2026-04-04
**Scope:** Single-user JWT authentication implementation + code quality improvements
**Verdict:** Approved

## Summary

A single-user JWT authentication system has been implemented across a Fastify + React video processing platform. The auth system is well-structured with proper security practices (bcrypt, httpOnly cookies, JWT), good separation of concerns, and maintains consistency with existing patterns in the codebase.

## Critical Issues

None found.

## Suggestions for Future Iterations

| # | File | Suggestion | Category | Priority |
|---|------|------------|----------|----------|
| 1 | routes/auth.ts | Implement rate limiting on /api/auth/login (TODO exists) | Security | High |
| 2 | plugins/auth.ts | Log token validation failures at debug level | Maintainability | Medium |
| 3 | auth-context.tsx | Combine /api/auth/me + /api/auth/status into single /api/auth/check endpoint | Performance | Low |
| 4 | 0007_add_auth.sql | Consider adding last_login_at, last_password_changed_at columns | Maintainability | Low |
| 5 | auth.ts | Consider making BCRYPT_ROUNDS configurable via env var | Performance | Low |

## What Looks Good

- Bcrypt with rounds=12 for password hashing (timing-attack resistant)
- JWT payload uses only `sub` (user ID), no sensitive data in token
- httpOnly, sameSite=strict, secure cookies prevent XSS and CSRF
- Generic "Invalid credentials" error prevents user enumeration
- Centralized `requireAuth()` helper used consistently across all routes
- Email normalized to lowercase on both signup and login
- Minimum 8-character password validation (server + client)
- Auth plugin runs in `onRequest` hook, decorating every request
- Cookie maxAge matches JWT_EXPIRES_IN config value
- Frontend auth context properly handles initialization errors
- All migrations are idempotent with transaction wrappers
- JWT_SECRET optional in shared config (won't crash worker/media-server)

## Files Changed

### Backend
- `apps/web-api/src/lib/auth.ts` — JWT signing, bcrypt, parseExpiresIn (exported)
- `apps/web-api/src/plugins/auth.ts` — Fastify request decoration
- `apps/web-api/src/routes/auth.ts` — Auth endpoints with email normalization, rate-limit TODO
- `apps/web-api/src/lib/shared.ts` — Centralized requireAuth helper
- `apps/web-api/src/routes/videos.ts` — Uses requireAuth
- `apps/web-api/src/routes/uploads.ts` — Uses requireAuth
- `apps/web-api/src/routes/library.ts` — Uses requireAuth
- `apps/web-api/src/routes/jobs.ts` — Uses requireAuth
- `apps/web-api/src/routes/debug.ts` — Uses requireAuth
- `packages/config/src/index.ts` — JWT_SECRET (optional), JWT_EXPIRES_IN

### Frontend
- `apps/web/src/lib/auth-context.tsx` — React auth state, robust initialization
- `apps/web/src/lib/api.ts` — credentials: same-origin, error handling
- `apps/web/src/pages/LoginPage.tsx` — Login/signup with password hint
- `apps/web/src/components/AppShell.tsx` — User display, logout
- `apps/web/src/App.tsx` — Auth routing

### Database & Config
- `db/migrations/0007_add_auth.sql` — Users table (idempotent, transactional)
- `.env.example` — JWT_SECRET, JWT_EXPIRES_IN documented
- `docker-compose.yml` — JWT vars passed to web-api

### Documentation
- `README.md` — Removed "no auth" claim
- `docs/contracts.md` — Full auth endpoint documentation
- `docs/status.md` — Auth marked as implemented
- `docs/development.md` — JWT env vars documented
- `docs/system.md` — Frontend auth flow documented
- `docs/auth-plan.md` — Implementation status notes added
