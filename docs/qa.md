# QA

## Existing automated coverage

### Web app

- Vitest component tests
- Playwright E2E specs for layout and player behavior

### API

- Playwright E2E for jobs, library, uploads, videos, webhooks
- Vitest integration flow under `tests/integration/full-flow.test.ts`
- unit tests for selected libs/routes

### Worker/providers

- provider tests for Deepgram and Groq

## Recommended smoke path

1. create video
2. upload media
3. complete upload
4. confirm `process_video` is queued
5. confirm processing completes
6. confirm transcript exists when audio exists
7. confirm AI output exists when transcript exists
8. confirm watch-edits persists title/transcript/speaker labels
9. confirm soft delete hides item from library

## Gaps

- delete/cleanup full lifecycle
- provider failure simulation across the whole pipeline
- outbound webhook delivery verification
- browser recording flow end-to-end
