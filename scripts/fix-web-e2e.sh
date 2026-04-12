#!/usr/bin/env bash
# Follow-up commit for PR #3: fix CI / Web E2E failure on chore/review-2026-04-10.
#
# CI / Web E2E is red on this PR — AND has been red on main since commit
# 68eaaf1 (2026-04-06), runs #21..#25 all failing the same way. That commit
# refactored apps/web/src/pages/video-page/VideoRail.tsx to use proper ARIA
# (role="tablist" + role="tab" + role="tabpanel") but did NOT update
# apps/web/e2e/layout.spec.ts, which still queries the three rail tabs as
# getByRole("button", { name: "Notes"/"Summary"/"Transcript" }).
#
# Per the ARIA spec, an explicit role="tab" on a <button> overrides the
# native button role in the accessibility tree, so Playwright's
# accessibility-tree locators can only reach those elements as role="tab".
# The test has to be updated, not the component.
#
# Fix: change the 3 desktop-test queries and the 1 mobile-test query in
# layout.spec.ts to use getByRole("tab", { name: ..., exact: true }).
# The unrelated `page.getByRole("button").nth(1).click()` on the mobile
# test (which targets the hamburger menu, not a rail tab) is intentionally
# unchanged.
#
# Reproduced locally first (got the exact CI error: "getByRole('button',
# { name: 'Notes', exact: true }) — element(s) not found" at layout.spec.ts:19
# on both the initial attempt and the retry), then applied the fix.
#
# Usage (from the repo root, on your Mac):
#   bash scripts/fix-web-e2e.sh

set -euo pipefail

BRANCH="chore/review-2026-04-10"

cd "$(git rev-parse --show-toplevel)"

echo "==> Verifying you're in cap5"
if [ ! -f CLAUDE.md ] || ! grep -q "Single-tenant video processing platform" CLAUDE.md; then
  echo "ERROR: this doesn't look like the cap5 repo root. Aborting." >&2
  exit 1
fi

echo "==> Current branch: $(git branch --show-current)"
if [ "$(git branch --show-current)" != "$BRANCH" ]; then
  echo "==> Switching to $BRANCH"
  git checkout "$BRANCH"
fi

echo "==> Sanity-check: the fix is actually in layout.spec.ts"
if ! grep -q 'getByRole("tab", { name: "Notes"' apps/web/e2e/layout.spec.ts; then
  echo "ERROR: apps/web/e2e/layout.spec.ts does not contain the expected role=\"tab\" fix." >&2
  echo "       Expected to see: getByRole(\"tab\", { name: \"Notes\"" >&2
  exit 1
fi

echo "==> Checking for stale sandbox leftover directories"
stale=""
for d in apps/web/dist.old apps/web/dist.old2 apps/web/.playwright.old apps/web/.playwright.old2; do
  if [ -e "$d" ]; then
    stale="$stale $d"
  fi
done
if [ -n "$stale" ]; then
  echo "ERROR: Found stale leftover directories that will break lint:" >&2
  for d in $stale; do echo "         $d" >&2; done
  echo "       Remove them first:" >&2
  echo "         rm -rf$stale" >&2
  exit 1
fi

echo "==> Running lint (should still be green after the previous fix commit)"
pnpm lint

echo "==> Running typecheck"
pnpm typecheck

echo "==> Building @cap/web (Playwright tests run against the built bundle)"
pnpm --filter @cap/web build

echo "==> Running Playwright e2e suite"
# playwright.config.ts already handles CI retries/workers via the CI env var
CI=1 pnpm --filter @cap/web test:e2e

echo "==> Staging the fix"
git add apps/web/e2e/layout.spec.ts docs/review-2026-04-10.md scripts/fix-web-e2e.sh

echo "==> Staged diff:"
git diff --cached --stat

echo "==> Committing"
git commit -m "fix(web/e2e): align layout.spec.ts with VideoRail ARIA tabs

CI / Web E2E has been red on main since commit 68eaaf1 (2026-04-06),
which refactored apps/web/src/pages/video-page/VideoRail.tsx to use
proper ARIA semantics (role=\"tablist\" + role=\"tab\" + role=\"tabpanel\")
but did not update apps/web/e2e/layout.spec.ts. The test still queried
the rail tabs as getByRole(\"button\", { name: \"Notes\"/\"Summary\"/\"Transcript\" }),
which no longer matches — per the ARIA spec, an explicit role=\"tab\" on
a <button> overrides the native button role in the accessibility tree,
so Playwright's accessibility-tree locators can only reach those elements
as role=\"tab\".

Fix: update the three rail-tab queries in the desktop test and the one
in the mobile test to use getByRole(\"tab\", { name: ..., exact: true }).
The unrelated page.getByRole(\"button\").nth(1).click() call on the mobile
test (hamburger menu, not a rail tab) is intentionally unchanged.

Verified locally: reproduced the exact CI failure against the unfixed
file, then all 7 Playwright tests pass with the fix applied. Closes
the Web E2E gap on both this PR and main.

Also updates docs/review-2026-04-10.md with a new section documenting
the breakage and the fix."

echo "==> Pushing to origin"
git push

echo
echo "==> Done. CI should re-run automatically on PR #3."
echo "    Watch: https://github.com/adminbjkai/cap5/pull/3"
