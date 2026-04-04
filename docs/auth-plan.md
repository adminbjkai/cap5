# Auth Implementation Plan

Single-user email/password authentication with stateless JWT.
This adds a login gate to cap5 — one account, one password, all videos belong to that account.

---

## Decision Record

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Auth method | Email + bcrypt password | Simple, no external OAuth deps |
| Token strategy | Stateless JWT (HS256) | No Redis, fits current stack |
| User model | Single user | Preserves single-tenant simplicity |
| Token storage (browser) | `httpOnly` cookie | XSS-safe; no localStorage needed |
| Token lifetime | 7 days | Single user, low revocation risk |
| Password hashing | bcrypt (cost 12) | Industry standard, built-in salt |

---

## Phase 1 — Backend Foundation

### 1A. New env vars (`packages/config/src/index.ts`)

Add to the Zod schema:

```
JWT_SECRET          z.string().min(32)          # HMAC signing key
JWT_EXPIRES_IN      z.string().default("7d")    # token TTL
SETUP_EMAIL         z.string().email().optional()   # seed user on first run
SETUP_PASSWORD      z.string().min(8).optional()    # seed user on first run
```

`JWT_SECRET` is required (app won't start without it).
`SETUP_EMAIL` / `SETUP_PASSWORD` are optional — used by the migration seed or a setup CLI to create the initial account.

**Files touched:** `packages/config/src/index.ts`, `.env.example`, `.env`

### 1B. Database migration (`db/migrations/0007_add_auth.sql`)

```sql
-- Users table (single row expected, but schema supports future multi-user)
CREATE TABLE users (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email         TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_users_email ON users (email);
```

No `user_id` on `videos` — single-user means all videos are owned by the one account. If we go multi-user later, that's a separate migration.

**Files touched:** new `db/migrations/0007_add_auth.sql`

### 1C. Auth library (`apps/web-api/src/lib/auth.ts`)

New module exporting:

```typescript
hashPassword(plain: string): Promise<string>
  // bcrypt.hash(plain, 12)

verifyPassword(plain: string, hash: string): Promise<boolean>
  // bcrypt.compare(plain, hash)

signToken(userId: string): string
  // jwt.sign({ sub: userId }, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN })

verifyToken(token: string): { sub: string }
  // jwt.verify(token, JWT_SECRET)
```

**Dependencies:** `bcrypt` (or `bcryptjs` for pure JS), `jsonwebtoken`
**Files touched:** new `apps/web-api/src/lib/auth.ts`, `apps/web-api/package.json`

### 1D. Auth Fastify plugin (`apps/web-api/src/plugins/auth.ts`)

Registered in `index.ts` after logging but before routes.

Behavior:
1. Reads JWT from `Authorization: Bearer <token>` header OR `cap5_token` httpOnly cookie
2. Verifies with `verifyToken()`
3. Decorates `request.userId` (string) and `request.authenticated` (boolean)
4. **Does NOT reject** — just decorates. Route-level guards decide.

Fastify type augmentation:

```typescript
declare module 'fastify' {
  interface FastifyRequest {
    userId: string | null;
    authenticated: boolean;
  }
}
```

**Why not reject globally?** Some routes must stay open:
- `POST /api/auth/login` — obviously
- `POST /api/auth/setup` — initial account creation
- `GET /health`, `GET /ready` — health checks
- `POST /api/webhooks/*` — server-to-server HMAC-authenticated

**Files touched:** new `apps/web-api/src/plugins/auth.ts`, `apps/web-api/src/plugins/logging.ts` (add userId to log context)

### 1E. Route guard helper (`apps/web-api/src/lib/shared.ts`)

Add a reusable guard:

```typescript
export function requireAuth(request: FastifyRequest, reply: FastifyReply): void {
  if (!request.authenticated) {
    reply.code(401).send({ error: 'Unauthorized', message: 'Authentication required' });
    throw new Error('unauthorized'); // halt handler
  }
}
```

**Files touched:** `apps/web-api/src/lib/shared.ts`

---

## Phase 2 — Auth Routes

### 2A. Auth route module (`apps/web-api/src/routes/auth.ts`)

```
POST /api/auth/setup
  Body: { email, password }
  Guard: only works if zero users exist in DB
  Response: { ok: true, userId }
  Purpose: one-time initial account creation

POST /api/auth/login
  Body: { email, password }
  Response: { ok: true, token, expiresIn }
  Sets httpOnly cookie: cap5_token=<jwt>
  Rate limited: 10 attempts per minute (override global)

POST /api/auth/logout
  Clears the cap5_token cookie
  Response: { ok: true }

GET /api/auth/me
  Guard: requireAuth
  Response: { userId, email, createdAt }
```

### 2B. Register auth routes in `index.ts`

```typescript
import { authRoutes } from "./routes/auth.js";
// Register BEFORE other routes so /api/auth/* is available
await app.register(authRoutes);
```

### 2C. Add guards to existing routes

Every existing route module gets `requireAuth(request, reply)` at the top of each handler:

| Route file | Endpoints to protect |
|------------|---------------------|
| `videos.ts` | All (create, status, watch-edits, delete, retry) |
| `uploads.ts` | All (signed, complete, multipart/*) |
| `library.ts` | All (list videos) |
| `jobs.ts` | All (job status) |
| `debug.ts` | All |

**Leave open (no guard):**
| Route file | Reason |
|------------|--------|
| `auth.ts` | Auth endpoints themselves |
| `webhooks.ts` | Server-to-server, uses HMAC |
| `system.ts` | Health/provider status (debatable — could protect provider-status) |

**Files touched:** `apps/web-api/src/index.ts`, new `apps/web-api/src/routes/auth.ts`, all existing route files (one-line guard addition each)

---

## Phase 3 — Frontend

### 3A. Auth API functions (`apps/web/src/lib/api.ts`)

Add to existing api.ts:

```typescript
export async function authSetup(email: string, password: string): Promise<{ ok: boolean; userId: string }>
export async function authLogin(email: string, password: string): Promise<{ ok: boolean; token: string }>
export async function authLogout(): Promise<{ ok: boolean }>
export async function authMe(): Promise<{ userId: string; email: string } | null>
```

The `fetcher()` function needs a small update: on 401 responses, redirect to `/login` instead of throwing (or emit an event the app can catch).

### 3B. Auth context (`apps/web/src/lib/auth-context.tsx`)

New React context:

```typescript
type AuthState = {
  checked: boolean;       // has initial /api/auth/me check completed?
  authenticated: boolean;
  user: { userId: string; email: string } | null;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
};
```

On mount, calls `GET /api/auth/me`. If 401, sets `authenticated = false`.
Cookie-based auth means no token juggling in JS — the browser sends the cookie automatically.

### 3C. Login page (`apps/web/src/pages/LoginPage.tsx`)

Simple form: email, password, submit button, error display.
If setup is needed (no users exist), show setup form instead (or redirect to `/setup`).

Styling: matches existing Tailwind patterns from the app.

### 3D. Setup page (`apps/web/src/pages/SetupPage.tsx`)

First-run experience. Shows when `GET /api/auth/me` returns a specific "no users" indicator.
Form: email, password, confirm password. Calls `POST /api/auth/setup`.

### 3E. Route protection (`apps/web/src/App.tsx`)

Wrap existing routes in a `<RequireAuth>` component:

```tsx
<Routes>
  <Route path="/login" element={<LoginPage />} />
  <Route path="/setup" element={<SetupPage />} />
  <Route element={<RequireAuth />}>
    <Route path="/" element={<HomePage />} />
    <Route path="/record" element={<RecordPage />} />
    <Route path="/video/:videoId" element={<VideoPage />} />
  </Route>
  <Route path="*" element={<Navigate to="/" replace />} />
</Routes>
```

`RequireAuth` checks `AuthContext.authenticated` — if false, redirects to `/login` (or `/setup` if no account exists).

### 3F. Logout button

Add to `AppShell` header — small "Log out" link or icon. Calls `authLogout()` and redirects to `/login`.

**Files touched:** `apps/web/src/lib/api.ts`, new `apps/web/src/lib/auth-context.tsx`, new `apps/web/src/pages/LoginPage.tsx`, new `apps/web/src/pages/SetupPage.tsx`, `apps/web/src/App.tsx`, `apps/web/src/components/AppShell.tsx`

---

## Phase 4 — Docker and Config

### 4A. Environment updates

`.env.example` — add:
```
JWT_SECRET=change-me-to-a-random-32-char-string
JWT_EXPIRES_IN=7d
# SETUP_EMAIL=admin@example.com
# SETUP_PASSWORD=changeme
```

`docker-compose.yml` — pass `JWT_SECRET` to web-api service environment.

### 4B. Seed script (optional convenience)

`scripts/create-user.ts` — CLI script that hashes a password and inserts into the users table.
Useful for headless/Docker setups where you want to pre-create the account without hitting the setup endpoint.

```bash
pnpm --filter @cap/web-api run create-user --email admin@example.com --password changeme
```

**Files touched:** `.env.example`, `docker-compose.yml`, new `scripts/create-user.ts`

---

## Phase 5 — Tests

### 5A. Unit tests

- `apps/web-api/src/lib/auth.test.ts` — hash/verify password, sign/verify token, expired token rejection
- `apps/web-api/src/plugins/auth.test.ts` — plugin decorates correctly, missing token = unauthenticated

### 5B. E2E tests

- `apps/web-api/tests/e2e/auth.test.ts`:
  - Setup flow: create account when none exists, reject second setup
  - Login: valid creds → 200 + cookie, invalid → 401
  - Protected routes: 401 without token, 200 with token
  - Logout: clears cookie

- Update existing E2E tests (`videos.test.ts`, `uploads.test.ts`, `library.test.ts`, `jobs.test.ts`):
  - Add a `beforeAll` that creates a user and logs in, stores the token/cookie
  - Pass auth header/cookie in all requests

### 5C. Frontend tests

- Update Playwright specs to handle login flow (either seed a user in test setup or bypass with a test cookie)

**Files touched:** new test files, updates to all existing E2E test files, Playwright config

---

## Implementation Order

Best done in this sequence so nothing breaks midway:

```
1. Install deps (bcrypt/bcryptjs, jsonwebtoken)
2. Add env vars to config schema
3. Create migration 0007
4. Build auth.ts library module + unit tests
5. Build auth plugin
6. Build auth routes + E2E tests
7. Add guards to existing routes + fix existing E2E tests
8. Build frontend auth context + login/setup pages
9. Wire up route protection in App.tsx
10. Add logout to AppShell
11. Update docker-compose + .env.example
12. Full E2E pass
```

Steps 1-6 can land without breaking anything (new routes, no guards yet).
Step 7 is the breaking change — all existing routes start requiring auth.
Steps 8-10 make the frontend handle it.

---

## Status and Implementation Notes

All 5 phases have been completed. Key deviations from the plan:

### JWT_SECRET is optional in runtime config

The plan stated `JWT_SECRET` as a required env var with min 32 chars. In practice, to avoid crashing services that don't need auth (worker, media-server), the config allows `JWT_SECRET` to be optional at load time. Instead, the auth library (`apps/web-api/src/lib/auth.ts`) throws a clear error at runtime if a token operation is attempted without the secret. The web-api service registers the auth plugin immediately on startup, which fails fast if JWT_SECRET is missing, but worker and media-server never load the auth code.

**Consequence:** Worker and media-server can start without JWT_SECRET in their env, reducing deployment coupling. Web-api still requires it (fails during plugin registration).

### Route protection uses inline checks, not middleware

The plan outlined a `requireAuth()` helper that would be called at the top of each route handler. This was implemented and is functionally equivalent to a global middleware guard — it just lives at the handler level instead of a separate middleware layer. The effect is identical: unauthenticated requests receive 401 Unauthorized.

**Consequence:** Auth logic is explicit at each protected endpoint, making the protection surface easy to audit.

---

## What This Does NOT Include

- **Multi-user / user_id on videos** — not needed for single-user gate
- **OAuth / social login** — can be added later as an alternative login method
- **Password reset / email verification** — no email service configured
- **Token revocation / blocklist** — stateless JWT, 7-day expiry is the only control
- **RBAC / permissions** — single user, no roles needed
- **API key auth** — webhooks already use HMAC; external API consumers not in scope

Any of these can be layered on later without reworking what we build here.

---

## Risk Assessment

| Risk | Severity | Mitigation |
|------|----------|------------|
| JWT_SECRET leaked | High | Required min 32 chars, not committed to git, documented in .env.example |
| Locked out (forgot password) | Medium | `scripts/create-user.ts` can reset via direct DB access |
| bcrypt perf on login | Low | Single user, one login at a time, cost 12 is fine |
| Existing E2E tests break | Medium | Update tests before merging guard changes |
| Cookie not sent cross-origin | Low | App is same-origin behind nginx proxy |
