import type { VideoStatusResponse } from '../lib/api';
import { useTranscriptState } from '../hooks/useTranscriptState';
import { TranscriptControls } from './transcript-card/TranscriptControls';
import { TranscriptEditPanel } from './transcript-card/TranscriptEditPanel';
import { TranscriptLines } from './transcript-card/TranscriptLines';
import { TranscriptStatusMessages } from './transcript-card/TranscriptStatusMessages';

type TranscriptCardProps = {
  videoId: string | undefined;
  transcriptionStatus: VideoStatusResponse['transcriptionStatus'] | undefined;
  transcript: VideoStatusResponse['transcript'] | null | undefined;
  errorMessage: string | null | undefined;
  playbackTimeSeconds: number;
  onSeekToSeconds: (seconds: number) => void;
  onSaveTranscript: (text: string) => Promise<boolean>;
  onSaveSpeakerLabels: (labels: Record<string, string>) => Promise<boolean>;
  onSpeakerSelectionChange?: (selection: {
    selectedSpeakerIds: Set<number>;
    hiddenSpeakers: Set<number>;
    speakerIds: number[];
    allSpeakersDeselected: boolean;
    speakerFilteringActive: boolean;
  }) => void;
  /** When true, omits the outer card wrapper — for embedding in the right rail */
  compact?: boolean;
};

export function TranscriptCard({
  videoId,
  transcriptionStatus,
  transcript,
  errorMessage,
  playbackTimeSeconds,
  onSeekToSeconds,
  onSaveTranscript,
  onSaveSpeakerLabels,
  onSpeakerSelectionChange,
  compact = false,
}: TranscriptCardProps) {
  const {
    copyFeedback,
    isEditing,
    setIsEditing,
    draftText,
    setDraftText,
    saveError,
    setSaveError,
    saveFeedback,
    isSaving,
    textViewMode,
    setTextViewMode,
    searchQuery,
    setSearchQuery,
    activeMatchIndex,
    setActiveMatchIndex,
    searchInputRef,
    transcriptScrollRef,
    isReviewMode,
    reviewIndex,
    hiddenSpeakers,
    editingSpeaker,
    editingSpeakerLineIndex,
    speakerDraft,
    setSpeakerDraft,
    speakerSaveError,
    isSavingSpeaker,
    verifiedSegments,
    transcriptLines,
    transcriptText,
    originalTranscriptText,
    speakerIds,
    confidenceStats,
    uncertainSegments,
    searchMatches,
    activeLineIndex,
    getSpeakerLabel,
    toggleSpeakerVisibility,
    allSpeakersDeselected,
    speakerFilteringActive,
    speakerSelectionSummary,
    startSpeakerEdit,
    cancelSpeakerEdit,
    saveSpeakerLabel,
    toggleReviewMode,
    navigateReview,
    toggleVerified,
    copyTranscript,
    submitEdit,
    onEditKeyDown,
    highlightText,
    speakerColor,
  } = useTranscriptState({
    videoId,
    transcript,
    onSaveTranscript,
    onSaveSpeakerLabels,
    onSeekToSeconds,
    playbackTimeSeconds,
    onSpeakerSelectionChange,
  });

  const Inner = (
    <div className={compact ? 'flex h-full min-h-0 flex-col' : ''}>
      {/* Header — hidden in compact mode (VideoPage rail header handles it) */}
      {!compact && (
        <div className="mb-3 flex items-center justify-between gap-2">
          <div>
            <p className="workspace-label">Workspace panel</p>
            <h2 className="workspace-title">Transcript</h2>
          </div>
          <span className="status-chip">{transcriptionStatus ?? 'not_started'}</span>
        </div>
      )}

      <TranscriptStatusMessages
        compact={compact}
        transcriptionStatus={transcriptionStatus}
        transcriptTextLength={transcriptText.length}
        errorMessage={errorMessage}
      />

      {transcriptionStatus === 'complete' && transcriptText.length > 0 && (
        <div className={compact ? 'flex min-h-0 flex-1 flex-col' : 'space-y-3'}>
          <TranscriptControls
            compact={compact}
            isEditing={isEditing}
            searchInputRef={searchInputRef}
            searchQuery={searchQuery}
            onSearchQueryChange={setSearchQuery}
            onClearSearch={() => {
              setSearchQuery('');
              setActiveMatchIndex(-1);
            }}
            searchMatchesCount={searchMatches.length}
            activeMatchIndex={activeMatchIndex}
            textViewMode={textViewMode}
            onSetTextViewMode={setTextViewMode}
            onCopy={() => void copyTranscript()}
            onEdit={() => setIsEditing(true)}
            confidenceStats={confidenceStats}
            uncertainSegmentsCount={uncertainSegments.length}
            isReviewMode={isReviewMode}
            reviewIndex={reviewIndex}
            onToggleReviewMode={toggleReviewMode}
            onNavigateReview={navigateReview}
            speakerIds={speakerIds}
            allSpeakersDeselected={allSpeakersDeselected}
            speakerFilteringActive={speakerFilteringActive}
            speakerSelectionSummary={speakerSelectionSummary}
            hiddenSpeakers={hiddenSpeakers}
            getSpeakerLabel={(speaker) => getSpeakerLabel(speaker) ?? ''}
            onToggleSpeakerVisibility={toggleSpeakerVisibility}
            speakerColor={speakerColor}
            speakerSaveError={speakerSaveError}
          />

          {isEditing ? (
            <TranscriptEditPanel
              compact={compact}
              draftText={draftText}
              isSaving={isSaving}
              saveError={saveError}
              onDraftChange={setDraftText}
              onKeyDown={onEditKeyDown}
              onSave={() => void submitEdit()}
              onCancel={() => {
                setDraftText(transcriptText);
                setIsEditing(false);
                setSaveError(null);
              }}
            />
          ) : transcriptLines.length > 0 ? (
            <div ref={transcriptScrollRef} className={compact ? 'min-h-0 flex-1 overflow-y-auto' : ''}>
              <TranscriptLines
                compact={compact}
                transcriptLines={transcriptLines}
                isReviewMode={isReviewMode}
                hiddenSpeakers={hiddenSpeakers}
                activeLineIndex={activeLineIndex}
                textViewMode={textViewMode}
                transcriptText={transcriptText}
                originalTranscriptText={originalTranscriptText}
                transcriptVttKey={transcript?.vttKey}
                renderLineText={(lineText, lineIndex) => highlightText(lineText, lineIndex)}
                verifiedSegments={verifiedSegments}
                onToggleVerified={toggleVerified}
                onSeekToSeconds={onSeekToSeconds}
                getSpeakerLabel={getSpeakerLabel}
                editingSpeaker={editingSpeaker}
                editingSpeakerLineIndex={editingSpeakerLineIndex}
                speakerDraft={speakerDraft}
                onSpeakerDraftChange={setSpeakerDraft}
                isSavingSpeaker={isSavingSpeaker}
                onStartSpeakerEdit={startSpeakerEdit}
                onCancelSpeakerEdit={cancelSpeakerEdit}
                onSaveSpeakerLabel={(speaker) => { void saveSpeakerLabel(speaker); }}
              />
            </div>
          ) : (
            <pre
              className={`overflow-auto whitespace-pre-wrap text-[13px] leading-relaxed ${compact ? 'px-3 py-2' : 'scroll-panel max-h-[28rem] rounded-lg p-4'}`}
            >
              {textViewMode === 'original' ? originalTranscriptText : transcriptText}
            </pre>
          )}

          {transcript?.vttKey && (
            <span className={`text-[11px] text-muted block ${compact ? 'px-3 pb-2' : ''}`}>
              VTT: <span className="font-mono">{transcript.vttKey}</span>
            </span>
          )}
        </div>
      )}

      {copyFeedback && (
        <p className={`text-[11px] font-medium text-muted ${compact ? 'px-3 pb-2' : 'mt-3'}`}>
          {copyFeedback}
        </p>
      )}
      {saveFeedback && (
        <p className={`text-[11px] font-medium text-accent-700 ${compact ? 'px-3 pb-2' : 'mt-2'}`}>
          {saveFeedback}
        </p>
      )}
    </div>
  );

  if (compact) return Inner;
  return <section className="workspace-card">{Inner}</section>;
}
