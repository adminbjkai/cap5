import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import {
  useCallback,
  useEffect,
  useMemo,
  type KeyboardEvent,
} from "react";
import { useEventBusOn } from "../lib/eventBus";
import {
  deleteVideo,
  getJobStatus,
  getVideoStatus,
  saveWatchEdits,
  retryVideo,
  type VideoStatusResponse,
} from "../lib/api";
import { ConfirmationDialog } from "../components/ConfirmationDialog";
import { upsertRecentSession } from "../lib/sessions";
import { PlayerCard } from "../components/PlayerCard";
import { TranscriptCard } from "../components/TranscriptCard";
import { SummaryCardCompact } from "../components/SummaryCardCompact";
import { ChapterListInline } from "../components/ChapterListInline";
import { buildPublicObjectUrl } from "../lib/format";
import { NotesPanel } from "./video-page/NotesPanel";
import { deriveVideoChapters, buildWatchIdempotencyKey } from "./video-page/chapters";
import { useVideoPlayerShortcuts } from "./video-page/useVideoPlayerShortcuts";
import { VideoPageHeader } from "./video-page/VideoPageHeader";
import { VideoRail } from "./video-page/VideoRail";
import { SummaryStrip } from "./video-page/SummaryStrip";
import type { RailTab } from "./video-page/shared";
import { useVideoStore } from "../hooks/useVideoStore";

/* ── Terminal-state sets ─────────────────────────────────────────────────── */
const TERMINAL_PROCESSING_PHASES  = new Set(["complete", "failed", "cancelled"]);
const TERMINAL_TRANSCRIPTION_STATUSES = new Set(["complete", "no_audio", "skipped", "failed"]);
const TERMINAL_AI_STATUSES        = new Set(["complete", "skipped", "failed"]);

function hasReachedTerminalState(status: VideoStatusResponse | null): boolean {
  if (!status) return false;
  return (
    TERMINAL_PROCESSING_PHASES.has(status.processingPhase) &&
    TERMINAL_TRANSCRIPTION_STATUSES.has(status.transcriptionStatus) &&
    TERMINAL_AI_STATUSES.has(status.aiStatus)
  );
}

/* ══════════════════════════════════════════════════════════════════════════
   VIDEO PAGE
   ══════════════════════════════════════════════════════════════════════════ */
export function VideoPage() {
  const params        = useParams<{ videoId: string }>();
  const [searchParams] = useSearchParams();
  const navigate      = useNavigate();
  const videoId       = params.videoId ?? "";

  const jobId = useMemo(() => {
    const raw = searchParams.get("jobId");
    if (!raw) return null;
    const parsed = Number(raw);
    return Number.isFinite(parsed) ? parsed : null;
  }, [searchParams]);

  /* ── Store ───────────────────────────────────────────────────────────── */
  const {
    status, jobStatus, loading, errorMessage, consecutivePollFailures, lastUpdatedAt,
    playbackTimeSeconds, videoDurationSeconds: _videoDurationSeconds, seekRequest,
    copyFeedback, isTitleEditing, titleDraft, isSavingTitle, titleSaveMessage,
    isRetrying, retryMessage, isDeleteDialogOpen, isDeleting, isDeleted, deleteError,
    isSummaryExpanded, railTab, renderedRailTab, outgoingRailTab,
    setStatus, setJobStatus, setLoading, setErrorMessage, setConsecutivePollFailures,
    setLastUpdatedAt, setPlaybackTimeSeconds, setVideoDurationSeconds, setSeekRequest,
    setCopyFeedback, setIsTitleEditing, setTitleDraft, setIsSavingTitle, setTitleSaveMessage,
    setIsRetrying, setRetryMessage, setIsDeleteDialogOpen, setIsDeleting, setIsDeleted,
    setDeleteError, setIsSummaryExpanded, setRailTab, setRenderedRailTab, setOutgoingRailTab,
  } = useVideoStore();

  /* ── Derived values ──────────────────────────────────────────────────── */
  const shareableResultUrl = status?.resultKey ? buildPublicObjectUrl(status.resultKey) : null;
  const videoUrl           = status?.resultKey ? buildPublicObjectUrl(status.resultKey) : null;
  const isProcessing       = !hasReachedTerminalState(status);
  const transcriptSegments = useMemo(
    () => status?.transcript?.segments ?? [],
    [status?.transcript?.segments],
  );
  const chapters = useMemo(
    () => deriveVideoChapters(status?.aiOutput, transcriptSegments),
    [status?.aiOutput, transcriptSegments],
  );
  const summaryText = status?.aiOutput?.summary?.trim() ?? "";
  const hasSummaryStrip = summaryText.length > 0;
  const shouldTruncateSummary = summaryText.length > 220;
  const displayTitle = status?.aiOutput?.title?.trim() || status?.name?.trim() || "Untitled recording";

  const showRetryButton = useMemo(() => {
    if (!status) return false;
    return status.transcriptionStatus === "failed" || status.aiStatus === "failed";
  }, [status]);

  /* ── Rail tab transition ─────────────────────────────────────────────── */
  useEffect(() => {
    if (railTab === renderedRailTab) return;
    setOutgoingRailTab(renderedRailTab);
    setRenderedRailTab(railTab);
    const timeout = window.setTimeout(() => setOutgoingRailTab(null), 180);
    return () => window.clearTimeout(timeout);
  }, [railTab, renderedRailTab, setOutgoingRailTab, setRenderedRailTab]);

  useEffect(() => { setIsSummaryExpanded(false); }, [videoId, summaryText, setIsSummaryExpanded]);

  /* ── Title sync ──────────────────────────────────────────────────────── */
  useEffect(() => {
    if (!isTitleEditing) setTitleDraft(displayTitle);
  }, [displayTitle, isTitleEditing, setTitleDraft]);

  /* ── Seek ────────────────────────────────────────────────────────────── */
  const requestSeek = useCallback((seconds: number) => {
    if (!Number.isFinite(seconds)) return;
    const clamped = Math.max(0, seconds);
    setPlaybackTimeSeconds(clamped);
    setSeekRequest((cur) => ({ seconds: clamped, requestId: (cur?.requestId ?? 0) + 1 }));
  }, [setPlaybackTimeSeconds, setSeekRequest]);

  /* ── Polling ─────────────────────────────────────────────────────────── */
  const refresh = useCallback(async () => {
    if (!videoId) return;
    setLoading(true);
    setErrorMessage(null);
    try {
      const nextStatus = await getVideoStatus(videoId);
      setStatus(nextStatus);
      setLastUpdatedAt(new Date().toISOString());
      setConsecutivePollFailures(0);
      setErrorMessage(null);

      if (jobId !== null) {
        try { setJobStatus(await getJobStatus(jobId)); } catch { setJobStatus(null); }
      }

      upsertRecentSession({
        videoId,
        jobId: jobId ?? undefined,
        createdAt: new Date().toISOString(),
        processingPhase: nextStatus.processingPhase,
        processingProgress: nextStatus.processingProgress,
        resultKey: nextStatus.resultKey,
        thumbnailKey: nextStatus.thumbnailKey,
        errorMessage: nextStatus.errorMessage,
      });
    } catch (error) {
      setConsecutivePollFailures((c) => c + 1);
      const message = error instanceof Error ? error.message : "Status temporarily unavailable.";
      setErrorMessage(`Status temporarily unavailable. We'll keep retrying automatically. (${message})`);
    } finally {
      setLoading(false);
    }
  }, [videoId, jobId, setLoading, setErrorMessage, setStatus, setLastUpdatedAt, setConsecutivePollFailures, setJobStatus]);

  useEffect(() => { if (videoId) void refresh(); }, [videoId, refresh]);

  useEffect(() => {
    if (!videoId || isDeleted || isDeleting || hasReachedTerminalState(status)) return;
    const delayMs = consecutivePollFailures === 0
      ? 2000
      : Math.min(15000, 2000 * 2 ** consecutivePollFailures);
    const timeout = window.setTimeout(() => void refresh(), delayMs);
    return () => window.clearTimeout(timeout);
  }, [videoId, status, refresh, consecutivePollFailures, isDeleted, isDeleting]);

  /* ── Retry ───────────────────────────────────────────────────────────── */
  const handleRetry = useCallback(async () => {
    if (!videoId || isRetrying) return;
    setIsRetrying(true); setRetryMessage(null);
    try {
      const result = await retryVideo(videoId);
      setRetryMessage(result.ok ? "Job queued for retry." : "Failed to queue retry.");
      if (result.ok) await refresh();
    } catch (err) {
      setRetryMessage(err instanceof Error ? err.message : "Retry request failed.");
    } finally {
      setIsRetrying(false);
      window.setTimeout(() => setRetryMessage(null), 3000);
    }
  }, [videoId, isRetrying, refresh, setIsRetrying, setRetryMessage]);

  /* ── Title save ──────────────────────────────────────────────────────── */
  const saveTitle = useCallback(async (): Promise<void> => {
    const normalizedTitle = titleDraft.trim();
    if (!normalizedTitle) { setTitleSaveMessage("Title cannot be empty."); return; }
    setIsSavingTitle(true); setTitleSaveMessage(null);
    try {
      await saveWatchEdits(videoId, { title: normalizedTitle }, buildWatchIdempotencyKey());
      setIsTitleEditing(false);
      setTitleSaveMessage("Title saved.");
      await refresh();
    } catch {
      setTitleSaveMessage("Unable to save title.");
    } finally {
      setIsSavingTitle(false);
      window.setTimeout(() => setTitleSaveMessage(null), 1800);
    }
  }, [titleDraft, videoId, refresh, setTitleSaveMessage, setIsSavingTitle, setIsTitleEditing]);

  const handleTitleDraftKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter") { event.preventDefault(); if (!isSavingTitle) void saveTitle(); return; }
    if (event.key === "Escape") {
      event.preventDefault();
      if (isSavingTitle) return;
      setTitleDraft(displayTitle); setIsTitleEditing(false); setTitleSaveMessage(null);
    }
  };

  /* ── Transcript save ─────────────────────────────────────────────────── */
  const saveTranscript = useCallback(async (text: string): Promise<boolean> => {
    try { await saveWatchEdits(videoId, { transcriptText: text }, buildWatchIdempotencyKey()); await refresh(); return true; }
    catch { return false; }
  }, [videoId, refresh]);

  const saveSpeakerLabels = useCallback(async (labels: Record<string, string>): Promise<boolean> => {
    try {
      await saveWatchEdits(videoId, { speakerLabels: labels }, buildWatchIdempotencyKey());
      await refresh();
      return true;
    } catch { return false; }
  }, [videoId, refresh]);

  /* ── Delete ──────────────────────────────────────────────────────────── */
  const handleDelete = useCallback(async (): Promise<void> => {
    if (!videoId || isDeleting) return;
    setIsDeleting(true); setDeleteError(null);
    try {
      await deleteVideo(videoId);
      setIsDeleted(true);
      navigate("/", { replace: true });
    } catch (error) {
      setDeleteError(error instanceof Error ? error.message : "Unable to delete video.");
    } finally {
      setIsDeleting(false);
    }
  }, [videoId, isDeleting, navigate, setIsDeleting, setDeleteError, setIsDeleted]);

  /* ── Copy ────────────────────────────────────────────────────────────── */
  const copyToClipboard = async (value: string, label: string) => {
    try { await navigator.clipboard.writeText(value); setCopyFeedback(`${label} copied`); }
    catch { setCopyFeedback(`Unable to copy ${label.toLowerCase()}.`); }
    window.setTimeout(() => setCopyFeedback(null), 1600);
  };

  /* ── Rail tab content renderer ───────────────────────────────────────── */
  const renderRailTabContent = (tab: RailTab) => {
    if (tab === "notes") return <NotesPanel videoId={videoId} />;
    if (tab === "summary") {
      return (
        <SummaryCardCompact
          aiStatus={status?.aiStatus}
          aiOutput={status?.aiOutput}
          errorMessage={status?.aiErrorMessage}
          chapters={chapters}
          onJumpToSeconds={requestSeek}
        />
      );
    }
    return (
      <TranscriptCard
        videoId={videoId}
        transcriptionStatus={status?.transcriptionStatus}
        transcript={status?.transcript}
        errorMessage={status?.transcriptErrorMessage}
        playbackTimeSeconds={playbackTimeSeconds}
        onSeekToSeconds={requestSeek}
        onSaveTranscript={saveTranscript}
        onSaveSpeakerLabels={saveSpeakerLabels}
        compact
      />
    );
  };

  useVideoPlayerShortcuts(requestSeek);

  /* ── Global events (via EventBus — replaces window.addEventListener) ──── */
  useEventBusOn("cap5:request-delete-active-video", () => {
    setDeleteError(null);
    setIsDeleteDialogOpen(true);
  });

  useEventBusOn("cap5:escape", () => {
    if (isDeleteDialogOpen && !isDeleting) {
      setIsDeleteDialogOpen(false);
      setDeleteError(null);
    }
    if (isTitleEditing && !isSavingTitle) {
      setTitleDraft(displayTitle);
      setIsTitleEditing(false);
      setTitleSaveMessage(null);
    }
  });

  /* ── Guard ───────────────────────────────────────────────────────────── */
  if (!videoId) {
    return (
      <div className="workspace-card">
        <p className="panel-danger">Missing video ID.</p>
      </div>
    );
  }

  /* ══════════════════════════════════════════════════════════════════════
     RENDER
     ══════════════════════════════════════════════════════════════════════ */
  return (
    <div className="animate-in fade-in duration-300">
      <ConfirmationDialog
        open={isDeleteDialogOpen}
        title="Delete video?"
        message={`Delete "${displayTitle}"? This removes it from the library and returns you to the home page.`}
        confirmLabel="Delete video"
        busy={isDeleting}
        errorMessage={deleteError}
        onCancel={() => { if (isDeleting) return; setIsDeleteDialogOpen(false); setDeleteError(null); }}
        onConfirm={() => void handleDelete()}
      />

      <VideoPageHeader
        titleProps={{
          displayTitle,
          isTitleEditing,
          titleDraft,
          isSavingTitle,
          titleSaveMessage,
          onStartTitleEdit: () => { setTitleDraft(displayTitle); setIsTitleEditing(true); setTitleSaveMessage(null); },
          onTitleDraftChange: (event) => setTitleDraft(event.target.value),
          onTitleDraftKeyDown: handleTitleDraftKeyDown,
          onSaveTitle: () => void saveTitle(),
          onCancelTitleEdit: () => { setTitleDraft(displayTitle); setIsTitleEditing(false); },
        }}
        videoProps={{
          shareableResultUrl,
          videoUrl,
          isProcessing,
          processingPhase: status?.processingPhase,
          processingProgress: status?.processingProgress,
          lastUpdatedAt,
          errorMessage,
          jobStatusLabel: jobStatus?.status ?? null,
        }}
        uiProps={{
          loading,
          copyFeedback,
        }}
        actionProps={{
          onCopyUrl: () => void copyToClipboard(shareableResultUrl ?? "", "URL"),
          onRefresh: () => void refresh(),
          onOpenDeleteDialog: () => { setDeleteError(null); setIsDeleteDialogOpen(true); },
          showRetryButton,
          isRetrying,
          retryMessage,
          onRetry: () => void handleRetry(),
        }}
      />

      <div className="grid gap-4 lg:grid-cols-[minmax(0,7fr)_minmax(0,5fr)]">
        <div className="min-w-0">
          {loading && !status ? (
            <div className="workspace-card overflow-hidden p-0">
              <div className="skeleton-block aspect-video w-full" />
            </div>
          ) : (
            <PlayerCard
              resultKey={status?.resultKey ?? null}
              thumbnailKey={status?.thumbnailKey ?? null}
              seekRequest={seekRequest}
              onPlaybackTimeChange={setPlaybackTimeSeconds}
              onDurationChange={setVideoDurationSeconds}
              chapters={chapters}
              onSeekToSeconds={requestSeek}
              transcriptSegments={status?.transcript?.segments ?? []}
            />
          )}
        </div>

        <VideoRail
          railTab={railTab}
          renderedRailTab={renderedRailTab}
          outgoingRailTab={outgoingRailTab}
          onSelectTab={setRailTab}
          renderRailTabContent={renderRailTabContent}
        />
      </div>

      {hasSummaryStrip && (
        <SummaryStrip
          summaryText={summaryText}
          isExpanded={isSummaryExpanded}
          shouldTruncate={shouldTruncateSummary}
          onToggleExpanded={() => setIsSummaryExpanded((cur) => !cur)}
        />
      )}

      {chapters.length > 0 && (
        <div className="mt-5">
          <h2 className="text-sm font-semibold mb-2 text-foreground">Chapters</h2>
          <ChapterListInline
            chapters={chapters}
            currentSeconds={playbackTimeSeconds}
            durationSeconds={_videoDurationSeconds}
            onSeek={requestSeek}
          />
        </div>
      )}
    </div>
  );
}
