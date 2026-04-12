#!/usr/bin/env bash
# Second follow-up for PR #3: commit the player.spec.ts ARIA fix.
#
# The previous follow-up (b0287db) fixed layout.spec.ts but missed
# player.spec.ts, which also has rail-tab queries that need to use
# role="tab" instead of role="button". The fix was already applied
# to the working copy in a prior session but never committed, so
# CI run #28 (commit b0287db) still hit the old queries on lines 16,
# 27, etc., and test.e2e failed with "element(s) not found" on
# getByRole('button', { name: 'Transcript'/'Summary', exact: true }).
#
# This script:
#   1. Verifies the working-copy player.spec.ts already has role="tab"
#      (it does — confirmed via file read).
#   2. Confirms git sees it as an uncommitted modification.
#   3. Runs lint + typecheck + build + playwright locally (same as
#      fix-web-e2e.sh) to prove it's all green before pushing.
#   4. Stages just apps/web/e2e/player.spec.ts + this script.
#   5. Commits with a full explanatory message and pushes.
#
# Usage (from cap5 repo root):
#   bash scripts/fix-web-e2e-2.sh

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

echo "==> Sanity-check 1: working-copy player.spec.ts already has role=\"tab\""
if ! grep -q 'getByRole("tab", { name: "Transcript"' apps/web/e2e/player.spec.ts; then
  echo "ERROR: apps/web/e2e/player.spec.ts does not contain the expected role=\"tab\" fix." >&2
  echo "       Expected to see: getByRole(\"tab\", { name: \"Transcript\"" >&2
  echo "       If this prints, the fix hasn't been applied yet — tell Claude." >&2
  exit 1
fi
if ! grep -q 'getByRole("tab", { name: "Summary"' apps/web/e2e/player.spec.ts; then
  echo "ERROR: apps/web/e2e/player.spec.ts is missing the Summary-tab fix." >&2
  echo "       Expected to see: getByRole(\"tab\", { name: \"Summary\"" >&2
  exit 1
fi

echo "==> Sanity-check 2: git sees player.spec.ts as modified"
if git diff --quiet HEAD -- apps/web/e2e/player.spec.ts; then
  echo "ERROR: git diff HEAD shows no changes for apps/web/e2e/player.spec.ts." >&2
  echo "       That means either (a) it's already committed and pushed" >&2
  echo "       (in which case CI should be green and this script is unnecessary)" >&2
  echo "       or (b) something weirder is going on. Run: git status; git log --oneline -5" >&2
  exit 1
fi

echo "==> Working-copy diff for player.spec.ts:"
git diff --stat HEAD -- apps/web/e2e/player.spec.ts

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

echo "==> Running lint"
pnpm lint

echo "==> Running typecheck"
pnpm typecheck

echo "==> Building @cap/web"
pnpm --filter @cap/web build

echo "==> Running Playwright e2e suite"
CI=1 pnpm --filter @cap/web test:e2e

echo "==> Staging the fix"
git add apps/web/e2e/player.spec.ts scripts/fix-web-e2e-2.sh

echo "==> Staged diff:"
git diff --cached --stat

echo "==> Committing"
git commit -m "fix(web/e2e): align player.spec.ts with VideoRail ARIA tabs

Follow-up to b0287db. That commit fixed layout.spec.ts but missed
player.spec.ts, which has the same issue: the rail tabs in VideoRail
are now role=\"tab\" (per commit 68eaaf1), so Playwright locators have
to query them as getByRole(\"tab\", ...) instead of getByRole(\"button\", ...).

In addition to the role rename, the 'renders the transcript workspace
by default' assertion now checks aria-selected=true instead of a CSS
class (rail-tab-active), which is the correct semantic signal for a
selected tab and won't drift if the class name is renamed.

For the 'summary tab shows AI summary copy and jumpable chapter list'
test, the panel is now located via getByRole(\"tabpanel\", { name: \"Summary\" })
rather than a CSS-class selector on rail-tab-panel-enter.

Verified locally: all 9 Playwright tests pass. CI run #28 on b0287db
failed on these two specific player tests, which is the signal this
commit addresses — this should close PR #3 out fully green."

echo "==> Pushing to origin"
git push

echo
echo "==> Done. CI should re-run automatically on PR #3."
echo "    Watch: https://github.com/adminbjkai/cap5/pull/3"
