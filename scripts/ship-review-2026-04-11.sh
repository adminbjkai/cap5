#!/usr/bin/env bash
#
# ship-review-2026-04-11.sh
#
# Walks Murry through the commit + push + cleanup flow for the 2026-04-11
# audit pass. Intentionally interactive — each step is gated on confirmation,
# never force-pushes, never destroys untracked files without asking.
#
# Run from repo root:
#   bash scripts/ship-review-2026-04-11.sh
#
# What this script does (in order):
#   1. Sanity: confirm we're on main and clean-ish, confirm docs edits are
#      in the working copy, and show the diff.
#   2. Create a fresh branch chore/review-2026-04-11 from main.
#   3. Stage the known set of audit edits + the new review doc + this script.
#   4. Run typecheck + web tests locally. Abort if anything is red.
#   5. Commit with a descriptive message.
#   6. Optional cruft cleanup: nanobanana/, .DS_Store, vite timestamp files,
#      old ship scripts, and the local-only feat/auth-and-code-quality branch.
#      Each removal is confirmed before it happens.
#   7. Push the branch to origin and print the PR-open URL.
#
# Nothing here force-pushes or rewrites history. If any step fails, the
# script aborts and leaves the working copy intact for manual inspection.
#
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO_ROOT"

BRANCH="chore/review-2026-04-11"
REVIEW_DOC="docs/review-2026-04-11.md"

EDITED_FILES=(
  "README.md"
  "docs/system.md"
  "docs/contracts.md"
  "docs/status.md"
  "docs/cap5_implementation_plan.md"
  "apps/web/src/components/transcript-card/TranscriptControls.tsx"
  "apps/web/src/components/TranscriptCard.speaker-selection.test.tsx"
  "apps/web/src/components/player-card/playbackFilter.test.ts"
)

ADDED_FILES=(
  "$REVIEW_DOC"
  "scripts/ship-review-2026-04-11.sh"
)

bold() { printf "\033[1m%s\033[0m\n" "$*"; }
green() { printf "\033[32m%s\033[0m\n" "$*"; }
yellow() { printf "\033[33m%s\033[0m\n" "$*"; }
red() { printf "\033[31m%s\033[0m\n" "$*"; }

confirm() {
  local prompt="${1:-Proceed?}"
  read -r -p "$prompt [y/N] " reply
  case "$reply" in
    [yY]|[yY][eE][sS]) return 0 ;;
    *) return 1 ;;
  esac
}

# -----------------------------------------------------------------------------
# 1. Sanity
# -----------------------------------------------------------------------------
bold "=== 1. Sanity check ==="

CURRENT_BRANCH="$(git rev-parse --abbrev-ref HEAD)"
if [[ "$CURRENT_BRANCH" != "main" ]]; then
  red "Not on main (currently on '$CURRENT_BRANCH'). Run 'git checkout main' first."
  exit 1
fi

if ! git diff --quiet HEAD -- "${EDITED_FILES[@]}" 2>/dev/null; then
  green "Found working-copy edits to the expected audit files."
else
  red "No working-copy changes in the expected audit files. Nothing to ship."
  exit 1
fi

for f in "${ADDED_FILES[@]}"; do
  if [[ ! -f "$f" ]]; then
    red "Missing expected file: $f"
    exit 1
  fi
done

git fetch --prune origin main >/dev/null 2>&1 || yellow "(fetch --prune had warnings; continuing)"

LOCAL_HEAD="$(git rev-parse HEAD)"
REMOTE_HEAD="$(git rev-parse origin/main)"
if [[ "$LOCAL_HEAD" != "$REMOTE_HEAD" ]]; then
  yellow "main is not in sync with origin/main. Local=$LOCAL_HEAD Remote=$REMOTE_HEAD"
  confirm "Continue anyway?" || exit 1
fi

bold "--- diff summary ---"
git diff --stat HEAD -- "${EDITED_FILES[@]}" "${ADDED_FILES[@]}" || true
echo ""
confirm "Proceed to create branch $BRANCH and stage these edits?" || exit 1

# -----------------------------------------------------------------------------
# 2. Branch
# -----------------------------------------------------------------------------
bold "=== 2. Create branch $BRANCH ==="

if git show-ref --verify --quiet "refs/heads/$BRANCH"; then
  yellow "Branch $BRANCH already exists locally."
  confirm "Reuse it (checkout, no reset)?" || exit 1
  git checkout "$BRANCH"
else
  git checkout -b "$BRANCH" main
fi

# -----------------------------------------------------------------------------
# 3. Stage
# -----------------------------------------------------------------------------
bold "=== 3. Stage audit edits ==="
git add -- "${EDITED_FILES[@]}" "${ADDED_FILES[@]}"

bold "--- staged diff ---"
git diff --cached --stat
echo ""

# Guard against partial-stage: any remaining edits to audit files are a red flag.
if ! git diff --quiet -- "${EDITED_FILES[@]}"; then
  red "Unstaged edits remain in audit files after 'git add'. That's the exact"
  red "partial-commit failure mode we hit in 2026-04-10. Inspect and re-run."
  git status -- "${EDITED_FILES[@]}"
  exit 1
fi

# -----------------------------------------------------------------------------
# 4. Verify
# -----------------------------------------------------------------------------
bold "=== 4. Verify (typecheck + web tests) ==="
echo "Running 'pnpm typecheck' ..."
if ! pnpm typecheck; then
  red "typecheck failed. Aborting before commit."
  exit 1
fi

echo "Running 'pnpm --filter @cap/web test' ..."
if ! pnpm --filter @cap/web test; then
  red "web tests failed. Aborting before commit."
  exit 1
fi

green "typecheck + web tests green."

# -----------------------------------------------------------------------------
# 5. Commit
# -----------------------------------------------------------------------------
bold "=== 5. Commit ==="
COMMIT_MSG="chore(review): 2026-04-11 audit — doc drift, a11y chip toggle, playbackFilter edges

- docs/system.md: remove 'signed outbound webhooks' from 'intentionally missing'
  (outbound HMAC signing has been live since 2026-04-10 — ADR-003, impl plan,
  README, and deliver-webhook.ts all agree it's shipped)
- docs/contracts.md:
  - auth/setup: doc 400 -> code 409 (+ explicit 201 success shape)
  - auth/login: add documented 429 + Retry-After branch
  - auth/me: doc 500 -> code 404
  - videos/:id/delete: add concrete response shape and the idempotent-repeat note
- components/transcript-card/TranscriptControls.tsx: speaker-filter chips now
  expose aria-pressed + action-framed aria-label (a11y parity with the
  2026-04-10 ARIA video-rail-tab fix)
- components/TranscriptCard.speaker-selection.test.tsx: +1 test locking
  aria-pressed toggle behavior
- components/player-card/playbackFilter.test.ts: +5 edge-case tests
  (duration guard, clamp, out-of-order input, non-finite/degenerate, filter-off
  passthrough)
- docs/status.md, docs/cap5_implementation_plan.md: record the new coverage
- docs/review-2026-04-11.md: dated review doc for this pass
- scripts/ship-review-2026-04-11.sh: helper used to land these edits safely
"

git commit -m "$COMMIT_MSG"

# -----------------------------------------------------------------------------
# 6. Optional cleanup
# -----------------------------------------------------------------------------
bold "=== 6. Optional cruft cleanup ==="
yellow "The following is not committed — it only touches your working tree and local refs."

# 6a. nanobanana/
if [[ -d nanobanana ]]; then
  SIZE="$(du -sh nanobanana | awk '{print $1}')"
  if confirm "Delete nanobanana/ ($SIZE, gitignored, side-experiment)?"; then
    rm -rf nanobanana
    green "Removed nanobanana/"
  fi
fi

# 6b. .DS_Store files
DS_COUNT="$(find . -name .DS_Store -not -path './.git/*' 2>/dev/null | wc -l | tr -d ' ')"
if [[ "$DS_COUNT" -gt 0 ]]; then
  if confirm "Delete $DS_COUNT .DS_Store files (none are tracked)?"; then
    find . -name .DS_Store -not -path './.git/*' -delete 2>/dev/null || true
    green "Removed $DS_COUNT .DS_Store files"
  fi
fi

# 6c. vite timestamp files
shopt -s nullglob
VITE_STAMPS=(apps/web/vite.config.ts.timestamp-*.mjs)
shopt -u nullglob
if [[ ${#VITE_STAMPS[@]} -gt 0 ]]; then
  if confirm "Delete ${#VITE_STAMPS[@]} vite build-stamp files?"; then
    rm -f "${VITE_STAMPS[@]}"
    green "Removed vite timestamp files"
  fi
fi

# 6d. old ship scripts
for old in scripts/fix-ci-lint.sh scripts/ship-review-2026-04-10.sh; do
  if [[ -f "$old" ]]; then
    if confirm "Delete leftover $old ?"; then
      rm -f "$old"
      green "Removed $old"
    fi
  fi
done

# 6e. stale local branch
if git show-ref --verify --quiet refs/heads/feat/auth-and-code-quality; then
  if confirm "Delete stale local branch feat/auth-and-code-quality ?"; then
    git branch -D feat/auth-and-code-quality
    green "Removed branch feat/auth-and-code-quality"
  fi
fi

# -----------------------------------------------------------------------------
# 7. Push
# -----------------------------------------------------------------------------
bold "=== 7. Push ==="
confirm "Push $BRANCH to origin?" || { yellow "Skipped push. Branch is committed locally."; exit 0; }

git push -u origin "$BRANCH"

REMOTE_URL="$(git remote get-url origin)"
# Derive github slug if origin is a github remote.
if [[ "$REMOTE_URL" =~ github.com[:/](.+)/(.+)(\.git)?$ ]]; then
  OWNER="${BASH_REMATCH[1]}"
  REPO="${BASH_REMATCH[2]%.git}"
  green "Branch pushed. Open a PR at:"
  echo "  https://github.com/$OWNER/$REPO/compare/main...$BRANCH?expand=1"
fi

bold "Done."
