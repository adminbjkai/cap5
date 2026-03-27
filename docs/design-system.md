# Design system

This is a lightweight summary of what actually exists in `apps/web`.

## Stack

- React 18
- Tailwind CSS
- custom component primitives under `src/components/ui`

## Existing UI primitives

Under `apps/web/src/components/ui`:

- `Badge`
- `Button`
- `FeedbackMessage`
- `Spinner`

## Main product surfaces

- `AppShell`
- `CommandPalette`
- `PlayerCard`
- `CustomVideoControls`
- `TranscriptCard`
- transcript-card subcomponents
- `SummaryCardCompact`
- `ChapterListInline`
- `ProviderStatusPanel`
- `ConfirmationDialog`

## Interaction patterns in code

- keyboard shortcuts
- command palette
- dark/light styling support in the app shell/styles
- compact right-rail layout on the video page
- inline title editing
- transcript edit and speaker-label edit flows

## Notes

Earlier design docs in the repo referenced a more abstract design system. The codebase today is mostly a product-specific component set, not a formal token/component package.
