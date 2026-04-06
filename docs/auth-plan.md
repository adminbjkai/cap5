# Auth Status and Constraints

This file is no longer a speculative implementation plan.
Auth is implemented in the current codebase.

## Current auth model

cap5 uses single-user email/password authentication with stateless JWT sessions.

### What is implemented

- one-account setup flow via `POST /api/auth/setup`
- login via `POST /api/auth/login`
- logout via `POST /api/auth/logout`
- current-user lookup via `GET /api/auth/me`
- `httpOnly` cookie storage with `cap5_token`
- bcrypt password hashing
- JWT signing with `JWT_SECRET`
- route protection on the main application endpoints
- frontend auth context and login page

## Hardening completed

Recent auth hardening now includes:

- targeted login attempt throttling for `/api/auth/login`
- `Retry-After` on rate-limited login responses
- auth event logging for:
  - login success
  - login failure
  - login throttling
- failed-attempt state clears after a successful login

## Constraints

- single-user only
- no multi-tenant ownership model
- JWT remains stateless
- auth is intentionally simple and local to the current app scope

## Code anchors

Backend:
- `apps/web-api/src/lib/auth.ts`
- `apps/web-api/src/lib/login-rate-limit.ts`
- `apps/web-api/src/plugins/auth.ts`
- `apps/web-api/src/routes/auth.ts`

Frontend:
- `apps/web/src/lib/auth-context.tsx`
- `apps/web/src/pages/LoginPage.tsx`

Database/config:
- `db/migrations/0007_add_auth.sql`
- `packages/config/src/index.ts`
- `.env.example`

## Remaining auth follow-up ideas

These are not blockers for the current single-user app, but they are reasonable future improvements:

- debug-level logging for invalid/expired token verification failures
- optional password rotation/change flow
- optional admin reset flow for a locked-out operator
- optional auth audit fields like `last_login_at`

## Do not use this file as a roadmap for all product work

For broader implementation order, use:
- `docs/status.md`
- `docs/cap5_implementation_plan.md`
