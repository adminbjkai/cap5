# Frontend Refactor Plan — cap4 `apps/web`

> Authored by: senior frontend audit (oclaw subagent)  
> Date: 2026-03-27  
> Scope: `apps/web/src/` only — no auth changes, all existing features preserved.

---

## Table of Contents

1. [Current State Audit](#1-current-state-audit)
2. [Proposed File/Folder Structure](#2-proposed-filefolder-structure)
3. [Component Refactors](#3-component-refactors)
4. [State Management](#4-state-management)
5. [API Layer](#5-api-layer)
6. [Design System](#6-design-system)
7. [UX Improvements](#7-ux-improvements)
8. [Testing](#8-testing)
9. [Estimated Complexity](#9-estimated-complexity)
10. [Migration Path](#10-migration-path)

---

## 1. Current State Audit

### 1.1 Component Inventory

| File | Lines | Role | Pain Points |
|---|---|---|---|
| `App.tsx` | ~100 | Root router + palette/shortcuts state | OK — manageable, minor prop drilling to AppShell |
| `AppShell.tsx` | ~200 | Layout + theme + mobile menu | Theme logic + mobile drawer both inline; SVG icons duplicated |
| `pages/HomePage.tsx` | ~260 | Library grid | All state local; sort/filter/delete logic inline; helper fns (`phaseBucket`, `dateLabel`, `phaseLabel`) should be in `lib/` |
| `pages/RecordPage.tsx` | ~450 | Screen recorder + uploader | God-component — recording state machine, audio meter, camera preview, upload progress, file picker all in one 450-line component |
| `pages/VideoPage.tsx` | ~310 | Video viewer | Manages 20+ state slices; `renderRailTabContent` closure is a smell |
| `pages/video-page/VideoPageHeader.tsx` | ~200 | Title + actions toolbar | 25-prop interface; pure component but prop surface is enormous |
| `pages/video-page/VideoRail.tsx` | ~50 | Tab container | Fine, but animation state (`outgoingRailTab`, `renderedRailTab`) leaks up from VideoPage |
| `pages/video-page/SummaryStrip.tsx` | missing — in VideoPage render | Inline, not seen as separate component yet | — |
| `pages/video-page/NotesPanel.tsx` | not read | Persists notes to localStorage | Unknown isolation quality |
| `components/PlayerCard.tsx` | ~280 | Video + seeker timeline | `formatTimestamp` duplicated here AND in 4 other files; speaker palette duplicated vs `transcript-card/shared.ts` |
| `components/CustomVideoControls.tsx` | ~380 | Overlay playback controls | Largest single file; fully self-contained which is good, but mixes pointer tracking, keyboard, PiP, fullscreen, speed menu all inline |
| `components/TranscriptCard.tsx` | ~430 | Transcript display + edit | Largest component; manages 18+ state slices; `highlightText` is a render function stored inline; search, edit, speaker edit, review mode all cohabitating |
| `components/transcript-card/TranscriptControls.tsx` | ~160 | Toolbar row | 23-prop flat interface — no grouping |
| `components/transcript-card/TranscriptLines.tsx` | not read | Renders lines | — |
| `components/transcript-card/TranscriptEditPanel.tsx` | not read | Edit textarea | — |
| `components/transcript-card/TranscriptStatusMessages.tsx` | not read | Status banners | — |
| `components/transcript-card/useVerifiedSegments.ts` | not read | localStorage hook | — |
| `components/transcript-card/shared.ts` | ~60 | Types + utils | Good separation, but `formatTimestamp` here too |
| `components/SummaryCard.tsx` | ~330 | AI summary | Renders both compact and full modes in one component via `if (compact)`; both render paths are long |
| `components/ChapterList.tsx` | ~120 | Chapter navigation | Also renders two modes (`inline` vs sidebar) — same dual-mode smell |
| `components/CommandPalette.tsx` | ~90 | Command launcher | Clean |
| `components/ShortcutsOverlay.tsx` | ~75 | Shortcuts modal | Clean |
| `components/ConfirmationDialog.tsx` | ~50 | Delete confirm | Clean |
| `components/StatusPanel.tsx` | ~140 | Processing lifecycle | Not used on VideoPage directly; seems like an unused/orphaned component from an older layout |
| `components/ProviderStatusPanel.tsx` | ~90 | Provider health | Clean |
| `hooks/useKeyboardShortcuts.ts` | ~130 | Global keyboard handling | Good; chord navigation pattern is solid |
| `lib/api.ts` | ~280 | HTTP client | All raw `fetch`; no abort support; `parseJson` is fine; upload progress via XHR is correct but untested boundary cases |
| `lib/format.ts` | ~40 | Formatting utils | `formatTimestamp` missing here — it lives as a local copy in 4 component files |
| `lib/sessions.ts` | ~50 | localStorage sessions | Fine |

### 1.2 Pain Points

#### Duplication: `formatTimestamp`
The function is copy-pasted in:
- `PlayerCard.tsx`
- `CustomVideoControls.tsx`
- `ChapterList.tsx`
- `SummaryCard.tsx`
- `transcript-card/shared.ts` (as `formatTimestamp`)

Should live only in `lib/format.ts`.

#### Duplication: Speaker color palette
Two separate `SPEAKER_PALETTE` arrays — one in `PlayerCard.tsx`, one in `transcript-card/shared.ts`. They differ slightly (one is lighter pastel, one is more saturated). Should be consolidated.

#### VideoPage god-state
`VideoPage.tsx` manages 20+ independent `useState` calls covering:
- Loading/error
- Status polling + failure backoff
- Title editing (draft, saving, message)
- Delete dialog (open, deleting, deleted, error)
- Retry (retrying, message)
- Seek (playback time, duration, seekRequest)
- Rail tab (tab, renderedTab, outgoingTab)
- Summary expanded
- Copy feedback

This makes VideoPage nearly impossible to test and painful to extend.

#### Prop drilling: VideoPageHeader
`VideoPageHeader` has **25 props**. It's a presentational component but the sheer surface area makes refactoring risky. Several props are logically grouped (`titleDraft + isSavingTitle + titleSaveMessage + onStartTitleEdit + ...` = one group).

#### Dual render-mode components
`SummaryCard` and `ChapterList` each have a `compact` / `inline` prop that bifurcates rendering into two entirely different layouts inside one file. The two modes should be separate components that share primitives.

#### RecordPage state machine
The recorder state machine lives entirely in component state, making it untestable and hard to follow. The state transitions are implicit — you have to read through 450 lines to understand the valid sequences.

#### Custom event bus (anti-pattern)
Global `window.dispatchEvent(new CustomEvent("cap:..."))` is used to:
- Request video deletion (`cap:request-delete-active-video`)
- Broadcast escape (`cap:escape`)
- Broadcast seek (`cap:seek`)

These bypass React's data flow and make the app harder to reason about. The delete and escape events are particularly dangerous since they trigger side effects in components that may not be mounted.

#### `renderRailTabContent` closure
A render function defined inside `VideoPage` and passed as a prop to `VideoRail`. This closes over 10+ values and re-creates on every render. The rail should receive data, not a render function.

#### No shared loading/error primitives
Error states, loading skeletons, and status banners are implemented differently across components. `panel-danger`, inline `<p>` elements, and `panel-warning` classes are used inconsistently.

#### Mixed inline styles
The design system docs say "never hardcode hex colors," yet across components there are ~30 instances of `style={{ color: "var(--text-primary)" }}` etc. These should use the Tailwind token aliases (`text-foreground`, `text-secondary`, `text-muted`) that are already defined in `tailwind.config.cjs`.

#### `StatusPanel` is orphaned
`StatusPanel.tsx` appears to be from a previous layout where processing status was shown in its own section. It's not imported by `VideoPage` (which uses `VideoPageHeader` for inline status). It should either be integrated or deleted.

#### Naming inconsistencies
- `workspace-card` / `workspace-label` / `workspace-title` — good
- `panel-subtle` / `panel-danger` / `panel-warning` — good  
- `status-chip` / `status-chip-success` / `status-chip-processing` — inconsistent; some use `status-chip-info`, `status-chip-compact` elsewhere
- `btn-primary` / `btn-secondary` / `btn-tertiary` — fine but `btn-tertiary` is defined in docs but barely used

---

## 2. Proposed File/Folder Structure

```
apps/web/src/
├── App.tsx
├── main.tsx
├── index.css
│
├── lib/
│   ├── api.ts              # HTTP client (see §5 for improvements)
│   ├── api.types.ts        # All API types extracted (new)
│   ├── format.ts           # formatTimestamp, formatDuration, formatBytes, formatEta, buildPublicObjectUrl
│   ├── sessions.ts
│   └── constants.ts        # SPEAKER_PALETTE, PROCESSING_PHASES, etc. (new)
│
├── hooks/
│   ├── useKeyboardShortcuts.ts
│   ├── usePolling.ts       # Extracted from VideoPage (new)
│   ├── useClipboard.ts     # Extracted from VideoPage/TranscriptCard (new)
│   └── useLocalStorage.ts  # Generic localStorage hook (new)
│
├── store/
│   ├── videoPageStore.ts   # Zustand store for VideoPage state (new)
│   └── types.ts
│
├── components/
│   ├── ui/                 # Primitive, design-system-level components
│   │   ├── Button.tsx
│   │   ├── Dialog.tsx      # Replaces ConfirmationDialog + dialog-backdrop pattern
│   │   ├── StatusChip.tsx
│   │   ├── Skeleton.tsx
│   │   ├── ErrorPanel.tsx
│   │   ├── PillToggle.tsx
│   │   └── Kbd.tsx         # keyboard key display
│   │
│   ├── layout/
│   │   ├── AppShell.tsx    # Slim version — just layout, delegates theme to useTheme hook
│   │   ├── Sidebar.tsx     # Extracted from AppShell
│   │   └── MobileMenu.tsx  # Extracted from AppShell
│   │
│   ├── player/
│   │   ├── PlayerCard.tsx           # Thinner wrapper
│   │   ├── PlayerTimeline.tsx       # Chapter seeker extracted
│   │   ├── PlayerSpeakerBar.tsx     # Speaker visualization extracted
│   │   └── CustomVideoControls.tsx  # Largely unchanged, cleanup only
│   │
│   ├── transcript/
│   │   ├── TranscriptCard.tsx         # Reduced, delegates to sub-components
│   │   ├── TranscriptToolbar.tsx      # Renamed from TranscriptControls
│   │   ├── TranscriptLines.tsx        # Unchanged
│   │   ├── TranscriptEditPanel.tsx    # Unchanged
│   │   ├── TranscriptStatusBanner.tsx # Renamed from TranscriptStatusMessages
│   │   ├── SpeakerFilterRow.tsx       # Extracted from TranscriptToolbar
│   │   ├── useTranscriptState.ts      # All TranscriptCard state extracted (new)
│   │   ├── useVerifiedSegments.ts     # Unchanged
│   │   └── shared.ts                  # Types + SPEAKER_PALETTE (source of truth)
│   │
│   ├── summary/
│   │   ├── SummaryRailView.tsx    # compact=true version split out
│   │   ├── SummaryFullView.tsx    # full version split out
│   │   ├── SummaryChapters.tsx    # Chapter list in summary tab
│   │   └── SummaryEntities.tsx    # Entity chips
│   │
│   ├── chapters/
│   │   ├── ChapterListInline.tsx  # Was inline=true
│   │   └── ChapterListCard.tsx    # Was sidebar card version
│   │
│   ├── library/
│   │   ├── LibraryGrid.tsx        # Extracted from HomePage
│   │   ├── LibraryCard.tsx        # Individual video card extracted
│   │   └── LibraryFilters.tsx     # Sort + filter controls
│   │
│   ├── CommandPalette.tsx         # Unchanged
│   ├── ShortcutsOverlay.tsx       # Unchanged
│   └── ProviderStatusPanel.tsx    # Unchanged
│
└── pages/
    ├── HomePage.tsx              # Thin orchestrator
    ├── RecordPage/
    │   ├── index.tsx             # Thin orchestrator
    │   ├── RecordSetup.tsx       # Input/controls panel
    │   ├── RecordPreview.tsx     # Preview + upload panel
    │   ├── useRecorder.ts        # Recording state machine (new hook)
    │   └── useUploader.ts        # Upload logic (new hook)
    └── VideoPage/
        ├── index.tsx             # Thin orchestrator (was VideoPage.tsx)
        ├── VideoPageHeader.tsx   # Grouped props (see §3)
        ├── VideoRail.tsx         # Simplified — receives data, not render fn
        ├── SummaryStrip.tsx
        ├── NotesPanel.tsx
        ├── chapters.ts
        ├── shared.ts
        └── useVideoPlayerShortcuts.ts
```

---

## 3. Component Refactors

### 3.1 `AppShell.tsx`

**Problems:**
- Theme toggle logic + mobile menu logic + layout all cohabitating
- SVG icons defined inline twice (desktop + mobile versions)
- `storedTheme` uses `useMemo` for a synchronous localStorage read that should be in an initializer function

**Refactor:**

```typescript
// hooks/useTheme.ts — extract theme logic
export function useTheme() {
  const [theme, setTheme] = useState<'light' | 'dark'>(() => {
    // Run once on mount, not in useMemo
    const stored = localStorage.getItem('cap-theme');
    if (stored === 'light' || stored === 'dark') return stored;
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  });
  // ... toggle, sync, persist
  return { theme, toggleTheme };
}
```

```typescript
// components/layout/AppShell.tsx — layout only
export function AppShell({ children, overlays }: AppShellProps) {
  const { theme, toggleTheme } = useTheme();
  return (
    <div className="app-shell flex font-sans">
      <Sidebar theme={theme} onToggleTheme={toggleTheme} />
      <MobileMenu theme={theme} onToggleTheme={toggleTheme} />
      <main className="app-content min-h-screen pt-16 lg:pt-0">
        {children}
      </main>
      {overlays}
    </div>
  );
}
```

Move SVG icons to a shared `icons/` set or use a small icon library (e.g., `lucide-react`) — the same moon/sun/home/record SVGs appear multiple times.

---

### 3.2 `VideoPage.tsx` → `VideoPage/index.tsx`

**Problems:**
- 20+ `useState` calls
- `renderRailTabContent` render function passed as prop
- Custom event listeners for delete + escape mixed in with polling logic
- All side effects in one component

**Refactor — extract store:**

```typescript
// store/videoPageStore.ts (Zustand)
interface VideoPageState {
  // Core
  status: VideoStatusResponse | null;
  loading: boolean;
  errorMessage: string | null;
  lastUpdatedAt: string | null;
  consecutivePollFailures: number;
  
  // Playback
  playbackTimeSeconds: number;
  videoDurationSeconds: number;
  seekRequest: SeekRequest | null;
  
  // Title editing
  titleEditing: { active: boolean; draft: string; saving: boolean; message: string | null };
  
  // Delete
  deleteDialog: { open: boolean; deleting: boolean; deleted: boolean; error: string | null };
  
  // Retry
  retry: { retrying: boolean; message: string | null };
  
  // UI
  railTab: RailTab;
  summaryExpanded: boolean;
  copyFeedback: string | null;
  
  // Actions
  setPlaybackTime: (s: number) => void;
  requestSeek: (s: number) => void;
  setRailTab: (tab: RailTab) => void;
  // ... etc
}
```

**Refactor — VideoRail receives data, not render function:**

```typescript
// Before (anti-pattern):
<VideoRail renderRailTabContent={renderRailTabContent} ... />

// After (data-driven):
<VideoRail
  railTab={railTab}
  videoId={videoId}
  status={status}
  playbackTimeSeconds={playbackTimeSeconds}
  onSeekToSeconds={requestSeek}
  onSaveTranscript={saveTranscript}
  onSaveSpeakerLabels={saveSpeakerLabels}
  chapters={chapters}
/>
// VideoRail renders the right tab content internally
```

**Refactor — polling hook:**

```typescript
// hooks/usePolling.ts
export function usePolling({
  enabled,
  intervalMs,
  maxIntervalMs,
  onPoll,
}: PollingOptions) {
  // exponential backoff, cleanup, pause-when-terminal
}
```

---

### 3.3 `VideoPageHeader.tsx`

**Problem:** 25 props is too many. They're logically grouped.

**Refactor — group props:**

```typescript
type VideoPageHeaderProps = {
  title: TitleProps;          // { value, editing, draft, saving, message, onStartEdit, onChange, onKeyDown, onSave, onCancel }
  processing: ProcessingProps; // { isProcessing, phase, progress, lastUpdatedAt, error, showRetry, retrying, retryMessage, onRetry }
  actions: ActionProps;        // { shareUrl, videoUrl, loading, onCopyUrl, onRefresh, onDelete, copyFeedback }
  jobStatusLabel: string | null;
};
```

This reduces the call site from 25 individual props to 4 grouped objects, which is far more readable and safer to refactor.

---

### 3.4 `TranscriptCard.tsx`

**Problem:** 18+ state slices, `highlightText` render function inline, mixed concerns.

**Refactor — extract hook:**

```typescript
// transcript/useTranscriptState.ts
export function useTranscriptState({
  videoId,
  transcript,
  playbackTimeSeconds,
  onSeekToSeconds,
  onSaveTranscript,
  onSaveSpeakerLabels,
}: UseTranscriptStateOptions) {
  // All ~18 state slices + derived values
  // Returns a well-typed object
  return {
    // Edit mode
    isEditing, draftText, isSaving, saveError, saveFeedback,
    startEdit, cancelEdit, submitEdit, setDraftText,
    
    // Search
    searchQuery, searchMatches, activeMatchIndex,
    setSearchQuery, clearSearch, navigateMatch,
    searchInputRef, transcriptScrollRef,
    
    // Review mode
    isReviewMode, reviewIndex, confidenceStats, uncertainSegments,
    toggleReviewMode, navigateReview,
    verifiedSegments, toggleVerified,
    
    // Speakers
    speakerIds, hiddenSpeakers, speakerLabels,
    editingSpeaker, speakerDraft, isSavingSpeaker, speakerSaveError,
    toggleSpeakerVisibility, startSpeakerEdit, cancelSpeakerEdit, saveSpeakerLabel,
    
    // Derived
    transcriptLines, transcriptText, activeLineIndex,
    textViewMode, setTextViewMode,
    copyTranscript, copyFeedback,
    
    // Utilities
    highlightText,
    getSpeakerLabel,
  };
}
```

`TranscriptCard.tsx` becomes a thin composition layer:

```typescript
export function TranscriptCard(props: TranscriptCardProps) {
  const state = useTranscriptState(props);
  const Inner = (
    <div>
      <TranscriptStatusBanner ... />
      {state.isEditing ? (
        <TranscriptEditPanel ... />
      ) : (
        <>
          <TranscriptToolbar ... />
          <div ref={state.transcriptScrollRef}>
            <TranscriptLines ... />
          </div>
        </>
      )}
    </div>
  );
  return props.compact ? Inner : <section className="workspace-card">{Inner}</section>;
}
```

---

### 3.5 `TranscriptControls.tsx` → `TranscriptToolbar.tsx`

**Problem:** 23-prop flat interface.

**Refactor — group props:**

```typescript
type TranscriptToolbarProps = {
  search: SearchProps;           // { ref, query, onChange, onClear, matchCount, activeIndex }
  viewMode: ViewModeProps;       // { mode, onChange }
  actions: ActionProps;          // { onCopy, onEdit, isEditing }
  confidence: ConfidenceProps;   // { stats, uncertainCount, isReviewMode, reviewIndex, onToggle, onNavigate }
  speakers: SpeakerProps;        // { ids, hidden, getLabel, onToggleVisibility, color, saveError }
  compact: boolean;
};
```

---

### 3.6 `SummaryCard.tsx`

**Problem:** Two render modes in one file.

**Refactor — split:**

```typescript
// summary/SummaryRailView.tsx — compact version (used in VideoRail)
export function SummaryRailView({ aiStatus, aiOutput, chapters, onJumpToSeconds }) { ... }

// summary/SummaryFullView.tsx — standalone card version
export function SummaryFullView({ aiStatus, aiOutput, shareableResultUrl, chapters, onJumpToSeconds }) { ... }
```

Both import shared sub-components:
- `SummaryChapters` — chapter list with timestamps
- `SummaryEntities` — entity chips
- `SummaryActionItems` — action items list
- `SummaryQuotes` — quote list

---

### 3.7 `ChapterList.tsx`

**Problem:** Two render modes (`inline`, sidebar card).

**Refactor — split:**

```typescript
// chapters/ChapterListInline.tsx — flat table used below-the-fold on VideoPage
// chapters/ChapterListCard.tsx — card with header (sidebar usage)
```

Both share the `activeIndex` calculation and formatting, extracted to `lib/chapters.ts`.

---

### 3.8 `RecordPage.tsx` → `RecordPage/index.tsx`

**Problem:** 450-line god-component.

**Refactor — extract recorder state machine:**

```typescript
// pages/RecordPage/useRecorder.ts
type RecorderState = 'idle' | 'requesting_permissions' | 'ready' | 'recording' | 'stopping' | 'preview';

export function useRecorder() {
  const [state, setState] = useState<RecorderState>('idle');
  // All refs: displayStreamRef, micStreamRef, mediaRecorderRef, etc.
  // All recorder logic: startRecording, stopRecording, finalizeRecording, cleanup
  return { state, recordedBlob, previewUrl, sourceLabel, micLevel, microphones, selectedMicId, ... };
}

// pages/RecordPage/useUploader.ts
export function useUploader() {
  const [state, setUploadState] = useState<UploadState>('idle');
  // upload, retry, progress tracking
  return { uploadState, uploadProgress, videoId, jobId, upload, retry };
}
```

`RecordPage/index.tsx` becomes ~100 lines:

```typescript
export function RecordPage() {
  const recorder = useRecorder();
  const uploader = useUploader();
  // Auto-upload trigger effect
  useEffect(() => {
    if (recorder.state === 'preview' && recorder.sourceLabel === 'Screen recording') {
      void uploader.upload(recorder.recordedBlob!);
    }
  }, [recorder.state]);
  
  return (
    <div className="space-y-5">
      <RecordSetup recorder={recorder} />
      <RecordPreview recorder={recorder} uploader={uploader} />
    </div>
  );
}
```

---

### 3.9 `PlayerCard.tsx`

**Problem:** Chapter seeker and speaker bar are long inline sections.

**Refactor — extract sub-components:**

```typescript
// player/PlayerTimeline.tsx — seeker + chapter dots + hover tooltip
// player/PlayerSpeakerBar.tsx — speaker color bar

// PlayerCard.tsx becomes:
return (
  <div className="rounded-xl border shadow-card overflow-hidden" style={surfaceStyle}>
    <div className="video-frame">
      <div ref={videoContainerRef} className="relative h-full w-full">
        <video ref={videoRef} ... />
        <CustomVideoControls ... />
      </div>
    </div>
    {durationSeconds > 0 && (
      <PlayerTimeline
        chapters={timelineChapters}
        durationSeconds={durationSeconds}
        playbackTimeSeconds={playbackTimeSeconds}
        onSeek={handleChapterSeek}
      />
    )}
    {speakerSlices.length > 0 && (
      <PlayerSpeakerBar slices={speakerSlices} />
    )}
  </div>
);
```

---

### 3.10 Primitive UI Components (`components/ui/`)

These should be extracted once and used everywhere:

```typescript
// ui/StatusChip.tsx
type StatusChipVariant = 'success' | 'warning' | 'danger' | 'info' | 'processing' | 'default';
export function StatusChip({ variant, children }: StatusChipProps) {
  return <span className={`status-chip ${variantClass[variant]}`}>{children}</span>;
}

// ui/ErrorPanel.tsx
export function ErrorPanel({ message, className }: ErrorPanelProps) {
  if (!message) return null;
  return <div className={`panel-danger ${className}`}>{message}</div>;
}

// ui/Skeleton.tsx
export function SkeletonBlock({ className }: { className?: string }) {
  return <div className={`skeleton-block ${className}`} />;
}

// ui/Dialog.tsx
// Single dialog primitive used by ConfirmationDialog, CommandPalette, ShortcutsOverlay
export function Dialog({ open, onClose, label, children, className }: DialogProps) {
  if (!open) return null;
  return (
    <div className="dialog-backdrop fixed inset-0 z-[70] flex ..." onClick={onClose}>
      <div role="dialog" aria-modal="true" aria-label={label} 
           className={`dialog-surface ${className}`}
           onClick={e => e.stopPropagation()}>
        {children}
      </div>
    </div>
  );
}
```

---

## 4. State Management

### 4.1 Current Problems

1. **VideoPage has 20+ useState calls** — no structure, hard to derive anything, impossible to unit test
2. **No shared state** — `App.tsx` manages palette/shortcuts state; VideoPage manages video state; there's no cross-page communication mechanism (hence the custom event bus)
3. **Custom event bus** — `window.dispatchEvent(new CustomEvent("cap:..."))` used in 3 places. This bypasses React lifecycle and makes code impossible to trace.
4. **RecordPage manages a state machine via plain useState** — no explicit state transitions, easy to enter invalid states

### 4.2 Proposed Solution

**Introduce Zustand for page-level stores only** (not global app state — this is not complex enough for Redux).

**Keep:** Local component state for UI-only things (hover state, whether a menu is open, etc.)  
**Extract to store:** Business logic state that spans multiple sub-components

```bash
npm install zustand
```

```typescript
// store/videoPageStore.ts
import { create } from 'zustand';

export const useVideoPageStore = create<VideoPageState>((set, get) => ({
  // Initial state...
  
  requestSeek: (seconds) => {
    const clamped = Math.max(0, seconds);
    set(state => ({
      playbackTimeSeconds: clamped,
      seekRequest: { seconds: clamped, requestId: (state.seekRequest?.requestId ?? 0) + 1 },
    }));
  },
  
  openDeleteDialog: () => set({ deleteDialog: { open: true, deleting: false, deleted: false, error: null } }),
  
  // etc...
}));
```

**Replace custom event bus** with direct store actions:

```typescript
// Before:
window.dispatchEvent(new CustomEvent("cap:request-delete-active-video"));

// After (from CommandPalette action):
import { useVideoPageStore } from '../store/videoPageStore';
// ... 
onSelect: () => useVideoPageStore.getState().openDeleteDialog(),
```

For the escape key handler in `App.tsx`, pass it down or use a simple shared signal:

```typescript
// In App.tsx — pass onEscape handler via context or store
useKeyboardShortcuts({
  onEscape: () => {
    // Check store state directly
    const store = useVideoPageStore.getState();
    if (store.deleteDialog.open) { store.closeDeleteDialog(); return; }
    if (store.titleEditing.active) { store.cancelTitleEdit(); return; }
    // ... etc
  },
});
```

**RecordPage — use a proper state machine:**

```typescript
// pages/RecordPage/useRecorder.ts
// Use a simple XState-like transitions map or just a well-typed reducer

type RecorderEvent = 
  | { type: 'START' }
  | { type: 'STOP' }
  | { type: 'FINALIZE'; blob: Blob }
  | { type: 'RESET' }
  | { type: 'ERROR'; message: string };

function recorderReducer(state: RecorderState, event: RecorderEvent): RecorderState {
  // Explicit, testable transitions
}
```

---

## 5. API Layer

### 5.1 Current `api.ts` Review

**Strengths:**
- Clean `parseJson<T>` error helper
- Good TypeScript types for all responses
- Idempotency keys on mutations
- Multipart upload with sequential parts and progress

**Weaknesses:**

1. **No abort controller support** — long-running fetches (polling, upload) can't be cancelled when the component unmounts
2. **No request deduplication** — if `getVideoStatus` is called while a previous call is in-flight, both proceed
3. **Types and API functions in the same file** — makes it hard to import types without importing all the fetch functions
4. **`uploadMultipart` is synchronous/sequential** — parts could be parallelized safely (AWS S3 supports parallel parts) 
5. **`parseJson` swallows response body on error as a string** — should be a typed `ApiError` that can carry status code and body
6. **`buildPublicObjectUrl` lives in `lib/format.ts` not `lib/api.ts`** — it's an API concern (constructs storage URLs), not a format concern

### 5.2 Proposed Improvements

```typescript
// lib/api.types.ts — extract all types
export type VideoCreateResponse = { ... };
export type VideoStatusResponse = { ... };
// ... all types

// lib/api.ts — functions only
import type { VideoStatusResponse, ... } from './api.types';

// Typed error class
export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly statusText: string,
    public readonly body: string,
  ) {
    super(`${status} ${statusText}`);
  }
}

async function parseJson<T>(res: Response): Promise<T> {
  const body = await res.text();
  if (!res.ok) throw new ApiError(res.status, res.statusText, body);
  return JSON.parse(body) as T;
}

// Add abort signal support to polling-heavy functions
export async function getVideoStatus(
  videoId: string,
  signal?: AbortSignal,
): Promise<VideoStatusResponse> {
  return parseJson<VideoStatusResponse>(
    await fetch(`/api/videos/${encodeURIComponent(videoId)}/status`, { signal })
  );
}

// Parallel multipart upload
export async function uploadMultipart(
  videoId: string,
  blob: Blob,
  contentType: string,
  onProgress?: (progress: UploadProgress) => void,
): Promise<number | null> {
  const CHUNK_SIZE = 10 * 1024 * 1024;
  const PARALLEL_CHUNKS = 3; // upload 3 parts at a time
  const totalParts = Math.ceil(blob.size / CHUNK_SIZE);
  
  // Initiate...
  
  // Presign all parts upfront
  const presignedUrls = await Promise.all(
    Array.from({ length: totalParts }, (_, i) =>
      parseJson<MultipartPresignResponse>(
        await fetch('/api/uploads/multipart/presign-part', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Idempotency-Key': newIdempotencyKey('mp-presign') },
          body: JSON.stringify({ videoId, partNumber: i + 1 }),
        })
      )
    )
  );
  
  // Upload in parallel batches
  // ...
}
```

**Move `buildPublicObjectUrl` to `api.ts`:**

```typescript
// lib/api.ts
export function buildStorageUrl(key: string): string {
  const endpoint = import.meta.env.VITE_S3_PUBLIC_ENDPOINT as string | undefined;
  const bucket = (import.meta.env.VITE_S3_BUCKET as string | undefined) ?? 'cap4';
  const base = endpoint ? `${endpoint.replace(/\/$/, '')}/${bucket}` : `/${bucket}`;
  return `${base}/${key.split('/').map(encodeURIComponent).join('/')}`;
}
```

---

## 6. Design System

### 6.1 Token Consolidation

The design token system is already well-structured. The main gaps:

**Missing tokens that are used inline:**

```css
/* These appear inline as style={{ color: "var(--...)" }} throughout the codebase.
   They already exist as CSS vars but haven't been mapped to Tailwind. Add to tailwind.config.cjs: */
extend: {
  colors: {
    "accent-blue-gradient-start": "var(--accent-blue)",  // already exists as bg-accent-gradient
    "danger-text": "var(--danger-text)",                  // used in VideoPageHeader Delete button
  }
}
```

**Inline style audit — replace all with Tailwind tokens:**

| Current | Replace with |
|---|---|
| `style={{ color: "var(--text-primary)" }}` | `className="text-foreground"` |
| `style={{ color: "var(--text-secondary)" }}` | `className="text-secondary"` |
| `style={{ color: "var(--text-muted)" }}` | `className="text-muted"` |
| `style={{ color: "var(--accent-blue)" }}` | `className="text-blue"` |
| `style={{ background: "var(--bg-surface)" }}` | `className="bg-surface"` |
| `style={{ background: "var(--bg-surface-subtle)" }}` | `className="bg-surface-subtle"` |
| `style={{ borderColor: "var(--border-default)" }}` | `className="border-border-default"` |

**Note:** Tailwind uses `border-{color}` for `border-color`. The existing tokens `border-default` and `border-strong` map to `border-border-default` and `border-border-strong` which is verbose. Consider renaming in config:

```js
// tailwind.config.cjs — cleaner naming
colors: {
  "border": "var(--border-default)",       // border-border (still verbose)
  // OR add dedicated border utilities:
  // Alternatively, just add a CSS utility class:
}
```

Simplest fix — add component classes to `index.css`:

```css
@layer utilities {
  .border-default { border-color: var(--border-default); }
  .border-strong  { border-color: var(--border-strong); }
}
```

This is already partially done in the codebase (`divide-default`, `border-default` appear in components).

### 6.2 Component Primitives Needed

The following patterns repeat across 5+ components with slight variations. Extracting them to `@layer components` in `index.css` or to React components would reduce duplication:

**Inline label+value pattern** (appears in RecordPage session panel, ProviderStatusPanel, StatusPanel):

```css
@layer components {
  .field-row          { @apply flex items-center justify-between gap-3 text-sm; }
  .field-row-label    { @apply text-muted; }
  .field-row-value    { @apply font-medium text-foreground; }
}
```

**Section with label + title** (appears everywhere: `workspace-label` + `workspace-title`):
Already defined in CSS — good. Just ensure consistent usage.

**Feedback message** (appears after copy/save actions in every component):

```typescript
// ui/FeedbackMessage.tsx
export function FeedbackMessage({ message, variant = 'muted' }: FeedbackMessageProps) {
  if (!message) return null;
  return (
    <p className={`text-[11px] font-medium ${variantClass[variant]}`}>{message}</p>
  );
}
```

### 6.3 `formatTimestamp` Consolidation

**Current state:** 5 copies across `PlayerCard.tsx`, `CustomVideoControls.tsx`, `ChapterList.tsx`, `SummaryCard.tsx`, `transcript-card/shared.ts`.

**Fix:**

```typescript
// lib/format.ts — add:
export function formatTimestamp(secondsInput: number): string {
  const totalSeconds = Math.max(0, Math.floor(secondsInput));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) {
    return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
  }
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '00')}`;
}
```

Remove all other copies. `transcript-card/shared.ts` can re-export from `lib/format.ts`.

### 6.4 Speaker Palette Consolidation

```typescript
// lib/constants.ts
export const SPEAKER_PALETTE = [
  "#7dd3fc", "#fdba74", "#86efac", "#d8b4fe",
  "#fda4af", "#99f6e4", "#fcd34d", "#a5b4fc",
] as const;

export function speakerColor(speaker: number): string {
  return SPEAKER_PALETTE[Math.abs(speaker) % SPEAKER_PALETTE.length]!;
}
```

Remove from `PlayerCard.tsx` (the saturated palette variant) and `transcript-card/shared.ts`.  
**Decision:** Use the lighter pastel palette from `shared.ts` (it's more legible on the speaker bar and in the transcript).

---

## 7. UX Improvements

All improvements below are **within existing features** — no new features.

### 7.1 Loading States

**Current:** VideoPage has a skeleton for the player card, but no skeleton for the rail tabs. The rail shows nothing while status loads.

**Improvement:** Add rail loading state:

```typescript
// VideoRail — when loading && !status, show skeleton tabs
{loading && !status ? (
  <div className="p-4 space-y-3">
    <SkeletonBlock className="h-4 w-3/4 rounded" />
    <SkeletonBlock className="h-4 w-1/2 rounded" />
    <SkeletonBlock className="h-4 w-2/3 rounded" />
  </div>
) : (
  // normal content
)}
```

### 7.2 Transcript Auto-scroll

**Current:** The transcript auto-scrolls to the active line, but only if it's not fully visible. This is correct. However, when switching from edit mode back to live mode, scroll position is not reset to the current active line.

**Fix:** When `isEditing` transitions from `true` to `false`, immediately scroll to `activeLineIndex`.

### 7.3 Rail Tab Transitions

**Current:** `outgoingRailTab` / `renderedRailTab` pattern creates a crossfade. The 180ms CSS transition is applied but the animation classes (`rail-tab-panel-exit`, `rail-tab-panel-enter`) need to be verified in `index.css`.

**Improvement:** Use `framer-motion` `AnimatePresence` for cleaner tab transitions, or ensure the CSS classes produce a real slide animation (not just opacity):

```css
@layer components {
  .rail-tab-panel-enter {
    animation: rail-slide-in 180ms var(--ease-spring) forwards;
  }
  .rail-tab-panel-exit {
    animation: rail-slide-out 180ms var(--ease-spring) forwards;
    position: absolute; width: 100%;
  }
  @keyframes rail-slide-in {
    from { opacity: 0; transform: translateX(8px); }
    to   { opacity: 1; transform: translateX(0); }
  }
  @keyframes rail-slide-out {
    from { opacity: 1; transform: translateX(0); }
    to   { opacity: 0; transform: translateX(-8px); }
  }
}
```

### 7.4 Copy Feedback

**Current:** Copy feedback appears as a floating `<p>` in various positions. It's inconsistent and can jump layout.

**Improvement:** Use a fixed-position toast notification for all copy/save feedback:

```typescript
// ui/Toast.tsx — simple fixed-bottom toast
// Used everywhere instead of inline feedback paragraphs
export function Toast({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-[80] animate-in fade-in slide-in-from-bottom-2 duration-200">
      <div className="rounded-full border bg-surface px-4 py-2 text-sm font-medium shadow-elevated text-foreground">
        {message}
      </div>
    </div>
  );
}
```

### 7.5 Empty States

**Current:** The "No videos yet" empty state is good. The processing transcript/summary states are minimal text.

**Improvement:** Add progress indication to transcript and summary status banners:

```typescript
// When transcriptionStatus === 'processing', show a subtle pulse bar
{transcriptionStatus === 'processing' && (
  <div className="px-4 pt-4">
    <div className="flex items-center gap-2 text-[13px] text-secondary">
      <span className="h-2 w-2 rounded-full bg-blue animate-pulse" />
      Transcribing audio…
    </div>
    <div className="mt-2 progress-track h-1">
      <div className="seeker-fill w-full animate-pulse" />
    </div>
  </div>
)}
```

### 7.6 PlayerCard — Buffering Indicator

**Current:** `CustomVideoControls` shows a `buffering-overlay` with a `buffering-pulse` div. Verify these CSS classes exist and produce a visible spinner in `index.css`. If not, add them.

### 7.7 Delete Confirmation UX

**Current:** Delete button in `VideoPageHeader` is a plain text button with `danger-text` color. It's easy to miss its destructiveness.

**Improvement:** Style as a distinct destructive action button (`btn-danger` class):

```css
@layer components {
  .btn-danger {
    @apply btn-secondary border-red-200 text-red-600 hover:border-red-300 hover:bg-red-50;
  }
}
```

### 7.8 Command Palette — Video Results

**Current:** Videos in the palette show "Open video" as subtitle. This is not useful.

**Improvement:** Show the processing phase as subtitle:

```typescript
subtitle: video.processingPhase === 'complete' 
  ? `${video.transcriptionStatus === 'complete' ? 'With transcript' : 'No transcript'}`
  : `Processing: ${video.processingPhase}`,
```

---

## 8. Testing

### 8.1 Current State

```
src/__tests__/
├── ChapterList.test.tsx       # Exists
├── TranscriptParagraph.test.tsx  # Exists
└── setup.ts
```

Only 2 test files for the entire frontend. No coverage for:
- `lib/api.ts`
- `lib/format.ts`  
- `hooks/useKeyboardShortcuts.ts`
- Any page component
- `RecordPage` state machine
- `TranscriptCard` state logic

### 8.2 What to Add

**Priority 1 — Unit tests (pure functions):**

```typescript
// lib/format.test.ts
describe('formatTimestamp', () => {
  it('formats under 1 hour', () => expect(formatTimestamp(90)).toBe('01:30'));
  it('formats over 1 hour', () => expect(formatTimestamp(3661)).toBe('01:01:01'));
  it('handles zero', () => expect(formatTimestamp(0)).toBe('00:00'));
  it('handles negative (clamps to 0)', () => expect(formatTimestamp(-5)).toBe('00:00'));
});

describe('formatBytes', () => { ... });
describe('formatEta', () => { ... });
describe('formatDuration', () => { ... });
```

```typescript
// lib/api.test.ts (with msw for mocking)
describe('getVideoStatus', () => {
  it('returns parsed status on 200', async () => { ... });
  it('throws ApiError with status and body on 4xx', async () => { ... });
});
```

**Priority 2 — Hook tests:**

```typescript
// hooks/useKeyboardShortcuts.test.ts
describe('useKeyboardShortcuts', () => {
  it('calls onToggleCommandPalette on Cmd+K', () => { ... });
  it('does not call handlers when target is input', () => { ... });
  it('calls onGoHome on g → h chord within 1200ms', () => { ... });
  it('does not fire chord after 1200ms', () => { ... });
});
```

```typescript
// transcript/useTranscriptState.test.ts (after extraction)
describe('useTranscriptState', () => {
  it('computes activeLineIndex from playbackTimeSeconds', () => { ... });
  it('filters hidden speakers from visible lines', () => { ... });
  it('search matches are case-insensitive', () => { ... });
});
```

**Priority 3 — Recorder state machine:**

```typescript
// RecordPage/useRecorder.test.ts
describe('useRecorder', () => {
  it('starts in idle state', () => { ... });
  it('transitions to requesting_permissions on startRecording', () => { ... });
  it('transitions to error if getDisplayMedia throws NotAllowedError', () => { ... });
  it('transitions to preview on stop if blob.size > 0', () => { ... });
  it('transitions to error on stop if blob.size === 0', () => { ... });
});
```

**Priority 4 — Component integration tests:**

```typescript
// components/CommandPalette.test.tsx
// components/ConfirmationDialog.test.tsx
// pages/VideoPage/VideoPageHeader.test.tsx
```

**Priority 5 — E2E (extends existing Playwright setup):**

```typescript
// e2e/video-page.spec.ts
test('transcript auto-scrolls to active segment', async ({ page }) => { ... });
test('command palette opens on Cmd+K and navigates', async ({ page }) => { ... });
test('speaker label edit is saved and displayed', async ({ page }) => { ... });
```

---

## 9. Estimated Complexity

| Item | Effort | Risk | Notes |
|---|---|---|---|
| `formatTimestamp` consolidation | S | Low | 5 files, mechanical change |
| Speaker palette consolidation | S | Low | 2 files |
| Replace inline styles with Tailwind tokens | S | Low | ~30 instances, mechanical |
| Add `border-default` / `border-strong` utilities | S | Low | 2 lines in CSS |
| Extract `useTheme` hook | S | Low | Isolated, well-tested |
| Extract `Sidebar.tsx` from AppShell | S | Low | Cosmetic refactor |
| Add `Toast.tsx` component | S | Low | New component, no regressions |
| Add `ErrorPanel.tsx`, `StatusChip.tsx`, `Skeleton.tsx` primitives | S | Low | Additive |
| Split `ChapterList` into two components | S | Low | Clear split point |
| Split `SummaryCard` into `SummaryRailView` / `SummaryFullView` | M | Low | More coupling than ChapterList |
| Extract `PlayerTimeline.tsx` from PlayerCard | M | Low | State stays in PlayerCard, extract render |
| Extract `PlayerSpeakerBar.tsx` | S | Low | Pure presentational |
| Group `VideoPageHeader` props | M | Medium | 25→4 props; touches VideoPage call site |
| Extract `useTranscriptState` hook | M | Medium | Large surface area; careful testing needed |
| Rename `TranscriptControls` → `TranscriptToolbar` + group props | M | Low | Prop interface change propagates |
| Extract `SpeakerFilterRow.tsx` | S | Low | Carve from TranscriptToolbar |
| Split `RecordPage` → `useRecorder` + `useUploader` | L | Medium | Complex async state; must not break recording |
| Extract `VideoPage` state to Zustand store | L | High | Largest risk; touches all VideoPage sub-components |
| Replace custom event bus | M | High | Requires store to be in place first |
| Extract `usePolling` hook | M | Medium | Depends on store refactor |
| Add `useClipboard` hook | S | Low | Consolidates 4 copy implementations |
| Move `buildPublicObjectUrl` to `api.ts` | S | Low | Rename + re-export |
| Extract `api.types.ts` | S | Low | No behavior change |
| Add `AbortController` to `getVideoStatus` | M | Low | Affects polling hook |
| Parallel multipart upload | M | Medium | Performance improvement; test boundaries |
| Add `lib/format.ts` unit tests | S | Low | Pure functions, easy |
| Add `useKeyboardShortcuts` tests | S | Low | Pure hook |
| Add `useTranscriptState` tests | M | Medium | After extraction |
| Add `useRecorder` tests | M | Medium | After extraction |
| Transcript auto-scroll on edit-mode exit | S | Low | One-line fix |
| Rail tab slide animation | S | Low | CSS only |
| Add rail loading skeleton | S | Low | Additive |
| Add `btn-danger` class | S | Low | CSS only |
| Improve CommandPalette video subtitles | S | Low | 3 lines |
| Transcript processing status pulse | S | Low | Additive |

**Total effort estimate:** ~8-12 engineering days for full refactor.  
**Safe incremental order:** See §10.

---

## 10. Migration Path

This is ordered from safest (no regressions possible) to riskiest (VideoPage state refactor).

### Phase 1 — Pure cleanup (no behavior change, 1-2 days)

1. **Add `formatTimestamp` to `lib/format.ts`**, remove all 4 local copies, update imports.
2. **Consolidate speaker palette** to `lib/constants.ts`, import everywhere.
3. **Replace inline `style={{ color: "var(--...)" }}`** with Tailwind token classes in all components.
4. **Add `border-default` / `border-strong` utility classes** to `index.css`.
5. **Delete `StatusPanel.tsx`** if confirmed unused (search codebase first).
6. **Move `buildPublicObjectUrl`** to `lib/api.ts` as `buildStorageUrl`, add re-export from `lib/format.ts` for backwards compat.
7. **Extract `api.types.ts`** from `api.ts`.

### Phase 2 — Component splits (no logic change, 2-3 days)

8. **Split `ChapterList`** into `ChapterListInline.tsx` and `ChapterListCard.tsx`.
9. **Split `SummaryCard`** into `SummaryRailView.tsx` and `SummaryFullView.tsx` (with shared sub-components).
10. **Extract `PlayerTimeline.tsx`** and `PlayerSpeakerBar.tsx` from `PlayerCard`.
11. **Extract `Sidebar.tsx`** and `MobileMenu.tsx` from `AppShell`.
12. **Create `ui/` primitives**: `StatusChip`, `ErrorPanel`, `Skeleton`, `Toast`, `FeedbackMessage`.
13. **Replace dialog boilerplate** in `CommandPalette`, `ShortcutsOverlay`, `ConfirmationDialog` with shared `Dialog` primitive.

### Phase 3 — Hook extractions (medium risk, 2-3 days)

14. **Extract `useTheme`** from `AppShell`.
15. **Extract `useTranscriptState`** from `TranscriptCard`. Keep `TranscriptCard` interface stable; change internals only.
16. **Extract `useClipboard`** — consolidate copy logic from `VideoPage`, `TranscriptCard`, `SummaryCard`.
17. **Rename `TranscriptControls` → `TranscriptToolbar`** and group its 23 props.
18. **Split `RecordPage` into `useRecorder` + `useUploader`** — highest priority for RecordPage; large component becomes thin.

### Phase 4 — State management refactor (high risk, 2-3 days)

19. **Install Zustand** (`npm install zustand`).
20. **Create `store/videoPageStore.ts`** with all VideoPage state.
21. **Migrate `VideoPage.tsx`** to use the store — one state slice at a time, not all at once.
22. **Replace `renderRailTabContent` closure** — pass data to `VideoRail`, let it decide rendering.
23. **Group `VideoPageHeader` props** (the 25-prop interface).
24. **Replace `window.dispatchEvent`** custom events with store actions.
25. **Extract `usePolling`** hook from VideoPage, use with AbortController.

### Phase 5 — Test coverage (ongoing, 1-2 days)

26. Add `lib/format.test.ts` (pure functions).
27. Add `hooks/useKeyboardShortcuts.test.ts`.
28. Add `transcript/useTranscriptState.test.ts` (after Phase 3).
29. Add `RecordPage/useRecorder.test.ts` (after Phase 3).
30. Add API error boundary tests with `msw`.

### Phase 6 — UX polish (1 day)

31. Rail tab slide animation CSS.
32. Rail loading skeleton.
33. Transcript processing status pulse.
34. `btn-danger` class + apply to delete button.
35. Toast notifications for all copy/save feedback.
36. CommandPalette video subtitles improvement.
37. Transcript auto-scroll on edit-mode exit.

---

## Appendix: Quick Wins Checklist

High-value, low-effort changes that can be shipped immediately:

- [ ] `formatTimestamp` consolidated to `lib/format.ts`
- [ ] `style={{ color: "var(--text-primary)" }}` → `className="text-foreground"` (etc.) — global find+replace
- [ ] `StatusPanel.tsx` — confirm unused, delete
- [ ] Add `FeedbackMessage` component — removes 15+ inline feedback `<p>` elements
- [ ] `btn-danger` class + apply to VideoPage Delete button
- [ ] `ChapterList` split — zero behavior change, cleaner code
- [ ] Add `Dialog` primitive — unifies 3 dialog implementations
