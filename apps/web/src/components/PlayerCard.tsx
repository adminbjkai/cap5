import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { formatTimestamp } from "../lib/format";
import { CustomVideoControls } from "./CustomVideoControls";
import {
  buildPlayableSpeakerRanges,
  getPlaybackCorrection,
  DEFAULT_SEGMENT_START_PADDING_SECONDS,
  DEFAULT_SEGMENT_END_PADDING_SECONDS,
  type SpeakerPlaybackSegment,
} from "./player-card/playbackFilter";

type SeekRequest = { seconds: number; requestId: number };
type ChapterItem  = { title: string; seconds: number };
const PLAYBACK_GUARD_INTERVAL_MS = 120;

const SPEAKER_PALETTE = [
  "#0ea5e9",
  "#f97316",
  "#22c55e",
  "#a855f7",
  "#e11d48",
  "#14b8a6",
  "#f59e0b",
  "#6366f1",
];

export function PlayerCard({
  videoUrl,
  thumbnailUrl,
  seekRequest,
  onPlaybackTimeChange,
  onDurationChange,
  chapters,
  onSeekToSeconds,
  transcriptSegments,
  selectedSpeakerIds,
  speakerFilteringActive,
  allSpeakersDeselected,
}: {
  videoUrl: string | null;
  thumbnailUrl: string | null;
  seekRequest: SeekRequest | null;
  onPlaybackTimeChange?: (seconds: number) => void;
  onDurationChange?: (seconds: number) => void;
  chapters: ChapterItem[];
  onSeekToSeconds: (seconds: number) => void;
  transcriptSegments: SpeakerPlaybackSegment[];
  selectedSpeakerIds: Set<number>;
  speakerFilteringActive: boolean;
  allSpeakersDeselected: boolean;
}) {
  const [playbackTimeSeconds, setPlaybackTimeSeconds] = useState(0);
  const [durationSeconds,     setDurationSeconds]     = useState(0);
  const [hoveredChapterIndex, setHoveredChapterIndex] = useState<number | null>(null);
  const [pinnedTooltip,       setPinnedTooltip]       = useState<number | null>(null);
  const [isBuffering,         setIsBuffering]         = useState(false);

  // Timeline hover preview state
  const [hoverPct,            setHoverPct]            = useState<number | null>(null);
  const [hoverSeconds,        setHoverSeconds]        = useState<number | null>(null);
  const [hoverChapterLabel,   setHoverChapterLabel]   = useState<string | null>(null);

  const videoRef     = useRef<HTMLVideoElement | null>(null);
  const videoContainerRef = useRef<HTMLDivElement | null>(null);
  const trackRef     = useRef<HTMLDivElement | null>(null);
  const lastAutoSkipRef = useRef<{ from: number; to: number; atMs: number } | null>(null);

  const syncPlaybackTime = useCallback((seconds: number) => {
    setPlaybackTimeSeconds(seconds);
    onPlaybackTimeChange?.(seconds);
  }, [onPlaybackTimeChange]);

  /* ── Derived values ───────────────────────────────────────────────────── */
  const hasResult   = Boolean(videoUrl);
  const timelineChapters = useMemo(
    () => (
      durationSeconds > 0
        ? chapters.filter((chapter) => chapter.seconds >= 0 && chapter.seconds <= durationSeconds)
        : []
    ),
    [chapters, durationSeconds]
  );
  const speakerSlices = useMemo(() => {
    if (durationSeconds <= 0) return [];
    const validSegments = (Array.isArray(transcriptSegments) ? transcriptSegments : [])
      .map((segment) => {
        const startSeconds = Number(segment.startSeconds);
        const fallbackEnd = startSeconds + 0.25;
        const rawEnd = Number(segment.endSeconds);
        const endSeconds = Number.isFinite(rawEnd) ? rawEnd : fallbackEnd;
        const speaker = typeof segment.speaker === "number" && Number.isInteger(segment.speaker) && segment.speaker >= 0
          ? segment.speaker
          : null;
        if (!Number.isFinite(startSeconds) || !Number.isFinite(endSeconds)) return null;
        if (speaker === null) return null;
        const safeStart = Math.max(0, Math.min(durationSeconds, startSeconds - DEFAULT_SEGMENT_START_PADDING_SECONDS));
        const safeEnd = Math.max(safeStart, Math.min(durationSeconds, endSeconds + DEFAULT_SEGMENT_END_PADDING_SECONDS));
        if (safeEnd <= safeStart) return null;
        return { startSeconds: safeStart, endSeconds: safeEnd, speaker };
      })
      .filter((segment): segment is { startSeconds: number; endSeconds: number; speaker: number } => Boolean(segment))
      .sort((a, b) => a.startSeconds - b.startSeconds);

    return validSegments.map((segment, index) => ({
      key: `${segment.speaker}-${segment.startSeconds}-${index}`,
      leftPct: (segment.startSeconds / durationSeconds) * 100,
      widthPct: ((segment.endSeconds - segment.startSeconds) / durationSeconds) * 100,
      color: SPEAKER_PALETTE[segment.speaker % SPEAKER_PALETTE.length]!,
      speaker: segment.speaker
    }));
  }, [durationSeconds, transcriptSegments]);

  const playableSpeakerRanges = useMemo(() => buildPlayableSpeakerRanges({
    durationSeconds,
    transcriptSegments,
    selectedSpeakerIds,
    speakerFilteringActive,
  }), [durationSeconds, transcriptSegments, selectedSpeakerIds, speakerFilteringActive]);

  const enforcePlaybackFilter = useCallback((source: "filter-change" | "timeupdate" | "guard" | "seek" | "play" | "seeked") => {
    const player = videoRef.current;
    if (!player) return null;

    if (allSpeakersDeselected) {
      if (!player.paused) player.pause();
      return null;
    }

    if (!speakerFilteringActive) return null;

    const nextAllowed = getPlaybackCorrection(player.currentTime, playableSpeakerRanges);
    if (nextAllowed === null) return null;

    const lastSkip = lastAutoSkipRef.current;
    const now = Date.now();
    if (
      source !== "seek"
      && source !== "filter-change"
      && lastSkip
      && Math.abs(lastSkip.from - player.currentTime) <= 0.03
      && Math.abs(lastSkip.to - nextAllowed) <= 0.03
      && now - lastSkip.atMs <= 200
    ) {
      return null;
    }

    lastAutoSkipRef.current = { from: player.currentTime, to: nextAllowed, atMs: now };
    player.currentTime = nextAllowed;
    syncPlaybackTime(nextAllowed);
    return nextAllowed;
  }, [allSpeakersDeselected, playableSpeakerRanges, speakerFilteringActive, syncPlaybackTime]);

  useEffect(() => {
    const player = videoRef.current;
    if (!player) return;

    if (allSpeakersDeselected) {
      if (!player.paused) player.pause();
      return;
    }

    enforcePlaybackFilter("filter-change");
  }, [allSpeakersDeselected, enforcePlaybackFilter]);

  useEffect(() => {
    const player = videoRef.current;
    if (!player || !speakerFilteringActive || allSpeakersDeselected) return;

    const guardPlayback = () => {
      if (player.paused || player.seeking || player.ended) return;
      enforcePlaybackFilter("guard");
    };
    const handlePlay = () => { void enforcePlaybackFilter("play"); };
    const handleSeeked = () => { void enforcePlaybackFilter("seeked"); };

    const interval = window.setInterval(guardPlayback, PLAYBACK_GUARD_INTERVAL_MS);
    player.addEventListener("play", handlePlay);
    player.addEventListener("seeked", handleSeeked);

    return () => {
      window.clearInterval(interval);
      player.removeEventListener("play", handlePlay);
      player.removeEventListener("seeked", handleSeeked);
    };
  }, [allSpeakersDeselected, enforcePlaybackFilter, speakerFilteringActive]);

  /* ── Seek on external request ─────────────────────────────────────────── */
  useEffect(() => {
    if (!seekRequest) return;
    const player = videoRef.current;
    if (!player) return;
    const clamped = Math.max(0, seekRequest.seconds);
    const nextAllowed = !allSpeakersDeselected && speakerFilteringActive
      ? getPlaybackCorrection(clamped, playableSpeakerRanges) ?? clamped
      : clamped;
    player.currentTime = nextAllowed;
    syncPlaybackTime(nextAllowed);
    if (!allSpeakersDeselected) {
      enforcePlaybackFilter("seek");
    }
  }, [allSpeakersDeselected, enforcePlaybackFilter, playableSpeakerRanges, seekRequest, speakerFilteringActive, syncPlaybackTime]);



  const activeChapterIndex = useMemo(() => {
    if (timelineChapters.length === 0) return -1;
    let active = 0;
    for (let i = 0; i < timelineChapters.length; i++) {
      if (timelineChapters[i]!.seconds <= playbackTimeSeconds + 0.1) active = i;
      else break;
    }
    return active;
  }, [timelineChapters, playbackTimeSeconds]);

  const currentChapter = activeChapterIndex >= 0 ? timelineChapters[activeChapterIndex] : null;
  const nextChapter    = activeChapterIndex >= 0
    ? (timelineChapters[activeChapterIndex + 1] ?? null)
    : (timelineChapters[0] ?? null);

  const tooltipChapterIndex = pinnedTooltip ?? hoveredChapterIndex;

  /* ── Chapter seek helpers ─────────────────────────────────────────────── */
  const handleChapterSeek = useCallback((seconds: number) => {
    const clamped = Math.max(0, seconds);
    const nextAllowed = !allSpeakersDeselected && speakerFilteringActive
      ? getPlaybackCorrection(clamped, playableSpeakerRanges) ?? clamped
      : clamped;
    const player  = videoRef.current;
    if (player) player.currentTime = nextAllowed;
    syncPlaybackTime(nextAllowed);
    onSeekToSeconds(nextAllowed);
  }, [allSpeakersDeselected, onSeekToSeconds, playableSpeakerRanges, speakerFilteringActive, syncPlaybackTime]);

  const goToPrevChapter = () => {
    if (activeChapterIndex <= 0) return;
    const prev = timelineChapters[activeChapterIndex - 1];
    if (prev) handleChapterSeek(prev.seconds);
  };
  const goToNextChapter = () => {
    if (activeChapterIndex < 0 || activeChapterIndex >= timelineChapters.length - 1) return;
    const next = timelineChapters[activeChapterIndex + 1];
    if (next) handleChapterSeek(next.seconds);
  };

  /* ── Timeline hover tracking ──────────────────────────────────────────── */
  const getSecondsFromEvent = useCallback((e: React.MouseEvent) => {
    const track = trackRef.current;
    if (!track || durationSeconds <= 0) return null;
    const rect = track.getBoundingClientRect();
    const pct  = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    return { pct, seconds: pct * durationSeconds };
  }, [durationSeconds]);

  const updateHover = useCallback((e: React.MouseEvent) => {
    const result = getSecondsFromEvent(e);
    if (!result) return;
    setHoverPct(result.pct * 100);
    setHoverSeconds(result.seconds);
    // Find nearest chapter label
    if (timelineChapters.length > 0) {
      let nearest = timelineChapters[0]!;
      for (const ch of timelineChapters) {
        if (ch.seconds <= result.seconds) nearest = ch;
        else break;
      }
      setHoverChapterLabel(nearest.title);
    } else {
      setHoverChapterLabel(null);
    }
  }, [getSecondsFromEvent, timelineChapters]);

  const handleTrackClick = useCallback((e: React.MouseEvent) => {
    const result = getSecondsFromEvent(e);
    if (!result) return;
    handleChapterSeek(result.seconds);
    setPinnedTooltip(null);
  }, [getSecondsFromEvent, handleChapterSeek]);

  /* ── Not-ready state ──────────────────────────────────────────────────── */
  if (!hasResult) {
    return (
      <div className="rounded-xl border shadow-card overflow-hidden"
           style={{ background: "var(--bg-surface)", borderColor: "var(--border-default)" }}>
        <div className="aspect-video flex items-center justify-center bg-surface-subtle"
             >
          <div className="text-center">
            <svg className="h-10 w-10 mx-auto mb-3 text-muted"
                 viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
              <path d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
            </svg>
            <p className="text-sm font-medium text-muted">Video processing…</p>
            <p className="text-xs mt-1 text-muted">This page updates automatically</p>
          </div>
        </div>
      </div>
    );
  }

  /* ── Playback percent for the seeker fill ─────────────────────────────── */
  const playPct = durationSeconds > 0 ? (playbackTimeSeconds / durationSeconds) * 100 : 0;

  return (
    <div className="rounded-xl border shadow-card overflow-hidden"
         style={{ background: "var(--bg-surface)", borderColor: "var(--border-default)" }}>

      {/* Video */}
      <div className="video-frame">
        <div ref={videoContainerRef} className="relative h-full w-full">
          <video
            ref={videoRef}
            playsInline
            className="aspect-video w-full bg-black"
            src={videoUrl ?? undefined}
            poster={thumbnailUrl ?? undefined}
            onLoadedMetadata={(e) => {
              const time     = e.currentTarget.currentTime || 0;
              const duration = Number.isFinite(e.currentTarget.duration) ? e.currentTarget.duration : 0;
              setPlaybackTimeSeconds(time);
              setDurationSeconds(duration);
              onPlaybackTimeChange?.(time);
              onDurationChange?.(duration);
            }}
            onTimeUpdate={(e) => {
              const player = e.currentTarget;
              const time = player.currentTime || 0;
              if (speakerFilteringActive && !allSpeakersDeselected) {
                const corrected = enforcePlaybackFilter("timeupdate");
                if (corrected !== null) {
                  return;
                }
              }

              syncPlaybackTime(time);
            }}
            onWaiting={() => setIsBuffering(true)}
            onPlaying={() => setIsBuffering(false)}
            onCanPlay={() => setIsBuffering(false)}
          />
          <CustomVideoControls
            videoRef={videoRef}
            containerRef={videoContainerRef}
            playbackTimeSeconds={playbackTimeSeconds}
            durationSeconds={durationSeconds}
            chapters={timelineChapters}
            isBuffering={isBuffering}
            onSeek={handleChapterSeek}
          />
          {allSpeakersDeselected && (
            <div className="pointer-events-none absolute inset-x-4 top-4 rounded-lg border border-amber-300 bg-amber-50/95 px-3 py-2 text-sm text-amber-900 shadow-sm">
              No speakers selected. Re-enable at least one speaker to resume filtered playback.
            </div>
          )}
        </div>
      </div>

      {/* Chapter timeline — only shown if chapters exist */}
      {timelineChapters.length > 0 && durationSeconds > 0 && (
        <div className="px-4 pt-3 pb-4">

          {/* Current / Next chapter labels */}
          <div className="flex flex-wrap items-center justify-between gap-1 mb-2.5 text-xs text-muted"
               >
            <span>
              Now:&nbsp;
              <span className="font-medium text-foreground">
                {currentChapter ? currentChapter.title : "Start"}
              </span>
            </span>
            {nextChapter && (
              <span>
                Next:&nbsp;
                <span className="font-medium">{formatTimestamp(nextChapter.seconds)}&nbsp;{nextChapter.title}</span>
              </span>
            )}
          </div>

          {/* ── Interactive seeker timeline ─────────────────────────────── */}
          <div
            ref={trackRef}
            className="seeker-track group"
            onClick={handleTrackClick}
            onMouseMove={updateHover}
            onMouseLeave={() => { setHoverPct(null); setHoverSeconds(null); setHoverChapterLabel(null); }}
            role="slider"
            aria-valuemin={0}
            aria-valuemax={Math.round(durationSeconds)}
            aria-valuenow={Math.round(playbackTimeSeconds)}
            aria-label="Chapter timeline"
          >
            {/* Track base */}
            <div className="progress-track absolute left-0 right-0 top-1/2 h-[3px] -translate-y-1/2 rounded-full" />

            {/* Playback fill */}
            <div
              className="seeker-fill"
              style={{ width: `${playPct}%` }}
            />

            {/* Hover time indicator (vertical hairline) */}
            {hoverPct !== null && (
              <div
                className="seeker-hover-indicator"
                style={{ left: `${hoverPct}%`, opacity: 0.5 }}
              />
            )}

            {/* Hover tooltip */}
            {hoverPct !== null && hoverSeconds !== null && (
              <div
                className="popover-panel pointer-events-none absolute bottom-full mb-2 w-auto min-w-[80px] px-2.5 py-1.5 text-center"
                style={{
                  left: `${Math.min(Math.max(hoverPct, 8), 92)}%`,
                  transform: "translateX(-50%)",
                }}
              >
                <p className="font-mono text-[11px] font-semibold text-muted">
                  {formatTimestamp(hoverSeconds)}
                </p>
                {hoverChapterLabel && (
                  <p className="text-xs leading-snug mt-0.5 max-w-[160px] text-left text-foreground"
                     >
                    {hoverChapterLabel}
                  </p>
                )}
              </div>
            )}

            {/* Chapter marker dots */}
            {timelineChapters.map((chapter, index) => {
              const leftPct   = Math.max(0, Math.min(100, (chapter.seconds / durationSeconds) * 100));
              const isActive  = index === activeChapterIndex;
              const showDotTip = tooltipChapterIndex === index && hoverPct === null;
              return (
                <div
                  key={`${chapter.title}-${index}-${chapter.seconds}`}
                  className="absolute top-1/2 -translate-x-1/2 -translate-y-1/2"
                  style={{ left: `${leftPct}%` }}
                >
                  {showDotTip && (
                    <div className="popover-panel pointer-events-none absolute bottom-full left-1/2 mb-2 w-52 -translate-x-1/2 px-2.5 py-1.5 text-left">
                      <p className="font-mono text-[11px] font-semibold text-muted">
                        {formatTimestamp(chapter.seconds)}
                      </p>
                      <p className="text-xs leading-snug text-foreground">
                        {chapter.title}
                      </p>
                    </div>
                  )}
                  <button
                    type="button"
                    title={`${formatTimestamp(chapter.seconds)} — ${chapter.title}`}
                    onClick={(e) => {
                      e.stopPropagation(); // don't also trigger the track click
                      setPinnedTooltip(index);
                      handleChapterSeek(chapter.seconds);
                    }}
                    onMouseEnter={() => setHoveredChapterIndex(index)}
                    onMouseLeave={() => setHoveredChapterIndex((c) => (c === index ? null : c))}
                    onFocus={() => setHoveredChapterIndex(index)}
                    onBlur={() => setHoveredChapterIndex((c) => (c === index ? null : c))}
                    onTouchStart={() => setPinnedTooltip(index)}
                    className={`chapter-handle ${isActive ? "chapter-handle-active" : ""}`}
                  >
                    <span className="sr-only">Jump to chapter: {chapter.title}</span>
                  </button>
                </div>
              );
            })}
          </div>
          {speakerSlices.length > 0 && (
            <div className="speaker-timeline-bar" aria-label="Speaker timeline">
              {speakerSlices.map((slice) => (
                <div
                  key={slice.key}
                  className="speaker-timeline-segment"
                  style={{
                    left: `${slice.leftPct}%`,
                    width: `${slice.widthPct}%`,
                    backgroundColor: slice.color
                  }}
                  title={`Speaker ${slice.speaker + 1}`}
                />
              ))}
            </div>
          )}
          {allSpeakersDeselected && (
            <p className="mt-2 text-xs font-medium text-amber-700">
              Filtered playback is paused because no speakers are selected.
            </p>
          )}

          {/* Time display + Prev / Next */}
          <div className="mt-2.5 flex items-center justify-between gap-2">
            <p className="font-mono text-xs text-muted">
              {formatTimestamp(playbackTimeSeconds)}
              <span className="mx-1 opacity-40">/</span>
              {durationSeconds > 0 ? formatTimestamp(durationSeconds) : "--:--"}
            </p>
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={goToPrevChapter}
                disabled={activeChapterIndex <= 0}
                className="btn-secondary px-2.5 py-1 text-xs disabled:opacity-40"
              >
                ← Prev
              </button>
              <button
                type="button"
                onClick={goToNextChapter}
                disabled={activeChapterIndex < 0 || activeChapterIndex >= timelineChapters.length - 1}
                className="btn-secondary px-2.5 py-1 text-xs disabled:opacity-40"
              >
                Next →
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Time display when there are no chapters */}
      {timelineChapters.length === 0 && (
        <div className="px-4 pt-2.5 pb-2 flex items-center justify-center font-mono text-sm text-muted"
             >
          {formatTimestamp(playbackTimeSeconds)}
          <span className="mx-1 opacity-40">/</span>
          {durationSeconds > 0 ? formatTimestamp(durationSeconds) : "--:--"}
        </div>
      )}
    </div>
  );
}
