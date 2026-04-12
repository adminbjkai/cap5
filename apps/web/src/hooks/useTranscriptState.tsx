import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import type { VideoStatusResponse } from '../lib/api';
import { useVerifiedSegments } from '../components/transcript-card/useVerifiedSegments';
import {
  defaultSpeakerLabel,
  normalizeSpeakerLabels,
  speakerColor,
  type TranscriptLine,
} from '../components/transcript-card/shared';

export type TranscriptStateOptions = {
  videoId: string | undefined;
  transcript: VideoStatusResponse['transcript'] | null | undefined;
  onSaveTranscript: (text: string) => Promise<boolean>;
  onSaveSpeakerLabels: (labels: Record<string, string>) => Promise<boolean>;
  onSeekToSeconds: (seconds: number) => void;
  playbackTimeSeconds: number;
  onSpeakerSelectionChange?: (selection: {
    selectedSpeakerIds: Set<number>;
    hiddenSpeakers: Set<number>;
    speakerIds: number[];
    allSpeakersDeselected: boolean;
    speakerFilteringActive: boolean;
  }) => void;
};

const SPEAKER_SELECTION_STORAGE_PREFIX = 'cap5:selected-speakers:';

export function useTranscriptState({
  videoId,
  transcript,
  onSaveTranscript,
  onSaveSpeakerLabels,
  onSeekToSeconds,
  playbackTimeSeconds,
  onSpeakerSelectionChange,
}: TranscriptStateOptions) {
  // ── Edit & copy feedback ──────────────────────────────────────────────
  const [copyFeedback, setCopyFeedback] = useState<string | null>(null);
  const [isEditing, setIsEditing] = useState(false);
  const [draftText, setDraftText] = useState('');
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveFeedback, setSaveFeedback] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [textViewMode, setTextViewMode] = useState<'current' | 'original'>('current');

  // ── Search ────────────────────────────────────────────────────────────
  const [searchQuery, setSearchQuery] = useState('');
  const [activeMatchIndex, setActiveMatchIndex] = useState(-1);
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const transcriptScrollRef = useRef<HTMLDivElement | null>(null);
  const searchDebounceRef = useRef<number | null>(null);

  // ── Confidence review ─────────────────────────────────────────────────
  const [isReviewMode, setIsReviewMode] = useState(false);
  const [reviewIndex, setReviewIndex] = useState(0);

  // ── Speaker labels ────────────────────────────────────────────────────
  const [speakerLabels, setSpeakerLabels] = useState<Record<string, string>>(() =>
    normalizeSpeakerLabels(transcript?.speakerLabels ?? {})
  );
  const [selectedSpeakerIds, setSelectedSpeakerIds] = useState<Set<number>>(new Set());
  const [editingSpeaker, setEditingSpeaker] = useState<number | null>(null);
  const [editingSpeakerLineIndex, setEditingSpeakerLineIndex] = useState<number | null>(null);
  const [speakerDraft, setSpeakerDraft] = useState('');
  const [speakerSaveError, setSpeakerSaveError] = useState<string | null>(null);
  const [isSavingSpeaker, setIsSavingSpeaker] = useState(false);

  const { verifiedSegments, setVerifiedSegments } = useVerifiedSegments(videoId);

  // ── Derived: transcript lines ─────────────────────────────────────────
  const transcriptLines = useMemo<TranscriptLine[]>(() => {
    const segments = Array.isArray(transcript?.segments) ? transcript.segments : [];
    return segments
      .map((segment, index) => {
        const text = String(segment.text ?? '').trim();
        const start = Number(segment.startSeconds);
        const end = Number(segment.endSeconds);
        const confidence = typeof segment.confidence === 'number' ? segment.confidence : null;
        if (!text || !Number.isFinite(start)) return null;
        return {
          index,
          startSeconds: start,
          endSeconds: Number.isFinite(end) ? Math.max(start, end) : null,
          text,
          originalText:
            typeof segment.originalText === 'string' && segment.originalText.trim().length > 0
              ? segment.originalText
              : null,
          confidence,
          speaker:
            typeof segment.speaker === 'number' && Number.isInteger(segment.speaker) && segment.speaker >= 0
              ? segment.speaker
              : null,
        };
      })
      .filter((line): line is TranscriptLine => Boolean(line))
      .sort((a, b) => a.startSeconds - b.startSeconds);
  }, [transcript?.segments]);

  const transcriptText = useMemo(() => {
    if (transcriptLines.length > 0) {
      return transcriptLines.map(line => line.text).join('\n').trim();
    }
    return transcript?.text?.trim() ?? '';
  }, [transcript?.text, transcriptLines]);

  const originalTranscriptText = useMemo(() => {
    const withOriginal = transcriptLines.filter(
      line => line.originalText && line.originalText.trim().length > 0
    );
    if (withOriginal.length > 0) {
      return withOriginal.map(line => line.originalText as string).join('\n').trim();
    }
    return transcriptText;
  }, [transcriptLines, transcriptText]);

  const speakerIds = useMemo(() => {
    const unique = new Set<number>();
    for (const line of transcriptLines) {
      if (line.speaker !== null) unique.add(line.speaker);
    }
    return Array.from(unique.values()).sort((a, b) => a - b);
  }, [transcriptLines]);

  const hiddenSpeakers = useMemo(() => {
    if (speakerIds.length === 0) return new Set<number>();
    const hidden = new Set<number>();
    const selected = selectedSpeakerIds;
    for (const speaker of speakerIds) {
      if (!selected.has(speaker)) hidden.add(speaker);
    }
    return hidden;
  }, [selectedSpeakerIds, speakerIds]);

  const selectedSpeakerCount = selectedSpeakerIds.size;
  const allSpeakersDeselected = speakerIds.length > 0 && selectedSpeakerCount === 0;
  const speakerFilteringActive = speakerIds.length > 0 && selectedSpeakerCount < speakerIds.length;
  const speakerSelectionSummary = useMemo(() => {
    if (speakerIds.length === 0) return null;
    if (allSpeakersDeselected) return 'None selected';
    if (!speakerFilteringActive) return 'All selected';
    return `${selectedSpeakerCount} of ${speakerIds.length} selected`;
  }, [allSpeakersDeselected, selectedSpeakerCount, speakerFilteringActive, speakerIds.length]);

  const confidenceStats = useMemo(() => {
    const withConfidence = transcriptLines.filter(line => line.confidence !== null);
    if (withConfidence.length === 0) return null;
    const highConfidenceCount = withConfidence.filter(line => line.confidence! >= 0.8).length;
    const percentage = Math.round((highConfidenceCount / withConfidence.length) * 100);
    return { percentage, total: withConfidence.length, highCount: highConfidenceCount };
  }, [transcriptLines]);

  const uncertainSegments = useMemo(() => {
    return transcriptLines
      .map((line, idx) => ({ line, lineIndex: idx }))
      .filter(({ line }) => line.confidence !== null && line.confidence < 0.8);
  }, [transcriptLines]);

  const searchMatches = useMemo(() => {
    if (!searchQuery.trim()) return [];
    const query = searchQuery.toLowerCase();
    const matches: Array<{ lineIndex: number; matchText: string; startPos: number; endPos: number }> = [];
    for (let i = 0; i < transcriptLines.length; i++) {
      const line = transcriptLines[i]!;
      const lineText =
        textViewMode === 'original' && line.originalText ? line.originalText : line.text;
      const lowerText = lineText.toLowerCase();
      let searchPos = 0;
      while (true) {
        const matchPos = lowerText.indexOf(query, searchPos);
        if (matchPos === -1) break;
        matches.push({ lineIndex: i, matchText: lineText.substring(matchPos, matchPos + query.length), startPos: matchPos, endPos: matchPos + query.length });
        searchPos = matchPos + 1;
      }
    }
    return matches;
  }, [searchQuery, transcriptLines, textViewMode]);

  const activeLineIndex = useMemo(() => {
    if (transcriptLines.length === 0) return -1;
    const current = Number.isFinite(playbackTimeSeconds) ? Math.max(0, playbackTimeSeconds) : 0;
    const epsilon = 0.1;
    let nearestIndex = 0;
    for (let index = 0; index < transcriptLines.length; index += 1) {
      const line = transcriptLines[index]!;
      if (line.startSeconds <= current + epsilon) { nearestIndex = index; continue; }
      break;
    }
    return nearestIndex;
  }, [playbackTimeSeconds, transcriptLines]);

  // ── Effects ───────────────────────────────────────────────────────────
  useEffect(() => {
    setSpeakerLabels(normalizeSpeakerLabels(transcript?.speakerLabels ?? {}));
  }, [transcript?.speakerLabels]);

  useEffect(() => {
    if (!videoId) {
      setSelectedSpeakerIds(new Set(speakerIds));
      return;
    }

    if (speakerIds.length === 0) {
      setSelectedSpeakerIds(new Set());
      return;
    }

    const storageKey = `${SPEAKER_SELECTION_STORAGE_PREFIX}${videoId}`;
    const raw = window.localStorage.getItem(storageKey);
    if (!raw) {
      setSelectedSpeakerIds(new Set(speakerIds));
      return;
    }

    try {
      const parsed = JSON.parse(raw);
      const validStoredIds = Array.isArray(parsed)
        ? parsed
          .map((value) => Number(value))
          .filter((value) => Number.isInteger(value))
        : [];
      const allowed = new Set(speakerIds);
      const next = new Set<number>();
      for (const speaker of validStoredIds) {
        if (allowed.has(speaker)) next.add(speaker);
      }
      setSelectedSpeakerIds(next);
    } catch {
      setSelectedSpeakerIds(new Set(speakerIds));
    }
  }, [videoId, speakerIds]);

  useEffect(() => {
    if (!videoId || speakerIds.length === 0) return;
    const storageKey = `${SPEAKER_SELECTION_STORAGE_PREFIX}${videoId}`;
    window.localStorage.setItem(storageKey, JSON.stringify(Array.from(selectedSpeakerIds.values()).sort((a, b) => a - b)));
  }, [videoId, selectedSpeakerIds, speakerIds.length]);

  useEffect(() => {
    onSpeakerSelectionChange?.({
      selectedSpeakerIds: new Set(selectedSpeakerIds),
      hiddenSpeakers: new Set(hiddenSpeakers),
      speakerIds: [...speakerIds],
      allSpeakersDeselected,
      speakerFilteringActive,
    });
  }, [
    allSpeakersDeselected,
    hiddenSpeakers,
    onSpeakerSelectionChange,
    selectedSpeakerIds,
    speakerFilteringActive,
    speakerIds,
  ]);

  useEffect(() => {
    if (!isEditing) { setDraftText(transcriptText); setSaveError(null); }
  }, [isEditing, transcriptText]);

  useEffect(() => {
    if (!saveFeedback) return;
    const timeout = window.setTimeout(() => setSaveFeedback(null), 1800);
    return () => window.clearTimeout(timeout);
  }, [saveFeedback]);

  useEffect(() => {
    setActiveMatchIndex(searchQuery.trim() ? 0 : -1);
    if (searchDebounceRef.current) window.clearTimeout(searchDebounceRef.current);
  }, [searchQuery]);

  useEffect(() => {
    if (activeLineIndex < 0 || isEditing) return;
    const container = transcriptScrollRef.current;
    if (!container) return;
    const activeNode = container.querySelector<HTMLElement>(`[data-transcript-line-index="${activeLineIndex}"]`);
    if (!activeNode) return;
    const containerRect = container.getBoundingClientRect();
    const nodeRect = activeNode.getBoundingClientRect();
    if (nodeRect.top < containerRect.top + 8 || nodeRect.bottom > containerRect.bottom - 8) {
      activeNode.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }
  }, [activeLineIndex, isEditing]);

  useEffect(() => {
    if (activeMatchIndex < 0 || !searchQuery.trim() || isEditing) return;
    const match = searchMatches[activeMatchIndex];
    if (!match) return;
    const container = transcriptScrollRef.current;
    if (!container) return;
    const matchNode = container.querySelector<HTMLElement>(`[data-transcript-line-index="${match.lineIndex}"]`);
    if (!matchNode) return;
    const containerRect = container.getBoundingClientRect();
    const nodeRect = matchNode.getBoundingClientRect();
    if (nodeRect.top < containerRect.top + 8 || nodeRect.bottom > containerRect.bottom - 8) {
      matchNode.scrollIntoView({ block: 'center', behavior: 'smooth' });
    }
  }, [activeMatchIndex, searchMatches, searchQuery, isEditing]);

  useEffect(() => {
    const handleKeyDown = (event: Event) => {
      const kbd = event as unknown as globalThis.KeyboardEvent;
      if ((kbd.metaKey || kbd.ctrlKey) && kbd.key === 'f') {
        kbd.preventDefault();
        searchInputRef.current?.focus();
        return;
      }
      if (!searchQuery.trim() || !searchInputRef.current || document.activeElement !== searchInputRef.current) return;
      if (kbd.key === 'ArrowDown' || (kbd.shiftKey === false && kbd.key === 'Enter')) {
        kbd.preventDefault();
        setActiveMatchIndex(current => {
          const nextIndex = (current + 1) % Math.max(1, searchMatches.length);
          if (searchMatches[nextIndex]) onSeekToSeconds(transcriptLines[searchMatches[nextIndex]!.lineIndex]!.startSeconds);
          return nextIndex;
        });
      } else if (kbd.key === 'ArrowUp' || (kbd.shiftKey && kbd.key === 'Enter')) {
        kbd.preventDefault();
        setActiveMatchIndex(current => {
          const nextIndex = (current - 1 + searchMatches.length) % Math.max(1, searchMatches.length);
          if (searchMatches[nextIndex]) onSeekToSeconds(transcriptLines[searchMatches[nextIndex]!.lineIndex]!.startSeconds);
          return nextIndex;
        });
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [searchQuery, searchMatches, transcriptLines, onSeekToSeconds]);

  // ── Callbacks ─────────────────────────────────────────────────────────
  const getSpeakerLabel = useCallback((speaker: number | null): string | null => {
    if (speaker === null) return null;
    const custom = speakerLabels[String(speaker)]?.trim();
    return custom && custom.length > 0 ? custom : defaultSpeakerLabel(speaker);
  }, [speakerLabels]);

  const toggleSpeakerVisibility = useCallback((speaker: number) => {
    setSelectedSpeakerIds(prev => {
      const next = new Set(prev);
      if (next.has(speaker)) next.delete(speaker);
      else next.add(speaker);
      return next;
    });
  }, []);

  const startSpeakerEdit = useCallback((speaker: number, lineIndex: number) => {
    setEditingSpeaker(speaker);
    setEditingSpeakerLineIndex(lineIndex);
    setSpeakerDraft(
      (() => {
        const custom = speakerLabels[String(speaker)]?.trim();
        return custom && custom.length > 0 ? custom : defaultSpeakerLabel(speaker);
      })()
    );
    setSpeakerSaveError(null);
  }, [speakerLabels]);

  const cancelSpeakerEdit = useCallback(() => {
    setEditingSpeaker(null);
    setEditingSpeakerLineIndex(null);
    setSpeakerDraft('');
    setSpeakerSaveError(null);
    setIsSavingSpeaker(false);
  }, []);

  const saveSpeakerLabel = useCallback(async (speaker: number) => {
    const normalized = speakerDraft.trim();
    if (!normalized) { setSpeakerSaveError('Label cannot be empty.'); return; }
    const nextLabels = { ...speakerLabels, [String(speaker)]: normalized };
    setIsSavingSpeaker(true);
    setSpeakerSaveError(null);
    const ok = await onSaveSpeakerLabels(nextLabels);
    setIsSavingSpeaker(false);
    if (!ok) { setSpeakerSaveError('Unable to save speaker label.'); cancelSpeakerEdit(); return; }
    setSpeakerLabels(nextLabels);
    setSaveFeedback('Speaker labels saved.');
    cancelSpeakerEdit();
  }, [speakerDraft, speakerLabels, onSaveSpeakerLabels, cancelSpeakerEdit]);

  const toggleReviewMode = useCallback(() => {
    setIsReviewMode(prev => !prev);
    setReviewIndex(0);
    if (!isReviewMode && uncertainSegments.length > 0) {
      onSeekToSeconds(uncertainSegments[0]!.line.startSeconds);
    }
  }, [isReviewMode, uncertainSegments, onSeekToSeconds]);

  const navigateReview = useCallback((direction: 'prev' | 'next') => {
    if (uncertainSegments.length === 0) return;
    const newIndex =
      direction === 'next'
        ? (reviewIndex + 1) % uncertainSegments.length
        : (reviewIndex - 1 + uncertainSegments.length) % uncertainSegments.length;
    setReviewIndex(newIndex);
    onSeekToSeconds(uncertainSegments[newIndex]!.line.startSeconds);
  }, [reviewIndex, uncertainSegments, onSeekToSeconds]);

  const toggleVerified = useCallback((segmentIndex: number) => {
    setVerifiedSegments(prev => {
      const next = new Set(prev);
      if (next.has(segmentIndex)) next.delete(segmentIndex);
      else next.add(segmentIndex);
      return next;
    });
  }, [setVerifiedSegments]);

  const copyTranscript = useCallback(async () => {
    if (!transcriptText) return;
    try {
      await navigator.clipboard.writeText(transcriptText);
      setCopyFeedback('Transcript copied');
    } catch {
      setCopyFeedback('Unable to copy transcript.');
    }
    window.setTimeout(() => setCopyFeedback(null), 1800);
  }, [transcriptText]);

  const submitEdit = useCallback(async () => {
    const normalized = draftText.trim();
    if (!normalized) { setSaveError('Transcript cannot be empty.'); return; }
    setIsSaving(true);
    setSaveError(null);
    const ok = await onSaveTranscript(normalized);
    setIsSaving(false);
    if (ok) { setIsEditing(false); setSaveFeedback('Transcript saved.'); return; }
    setSaveError('Unable to save transcript edits.');
  }, [draftText, onSaveTranscript]);

  const onEditKeyDown = useCallback((event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      if (isSaving) return;
      setDraftText(transcriptText);
      setIsEditing(false);
      setSaveError(null);
      return;
    }
    if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
      event.preventDefault();
      if (!isSaving) void submitEdit();
    }
  }, [isSaving, transcriptText, submitEdit]);

  const highlightText = useCallback((text: string, lineIndex: number): React.ReactNode => {
    if (!searchQuery.trim()) return text;
    const matches = searchMatches
      .filter(m => m.lineIndex === lineIndex)
      .sort((a, b) => a.startPos - b.startPos);
    if (matches.length === 0) return text;
    const parts: React.ReactNode[] = [];
    let lastPos = 0;
    for (let i = 0; i < matches.length; i++) {
      const match = matches[i]!;
      if (match.startPos > lastPos) parts.push(text.substring(lastPos, match.startPos));
      const isActive = searchMatches.indexOf(match) === activeMatchIndex;
      parts.push(
        <span
          key={`match-${i}`}
          className={`transition-colors ${isActive ? 'bg-yellow-400 dark:bg-yellow-600' : 'bg-yellow-200 dark:bg-yellow-800'}`}
        >
          {text.substring(match.startPos, match.endPos)}
        </span>
      );
      lastPos = match.endPos;
    }
    if (lastPos < text.length) parts.push(text.substring(lastPos));
    return parts;
  }, [searchQuery, searchMatches, activeMatchIndex]);

  return {
    // State
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
    speakerLabels,
    selectedSpeakerIds,
    hiddenSpeakers,
    selectedSpeakerCount,
    allSpeakersDeselected,
    speakerFilteringActive,
    speakerSelectionSummary,
    editingSpeaker,
    editingSpeakerLineIndex,
    speakerDraft,
    setSpeakerDraft,
    speakerSaveError,
    isSavingSpeaker,
    verifiedSegments,
    // Derived
    transcriptLines,
    transcriptText,
    originalTranscriptText,
    speakerIds,
    confidenceStats,
    uncertainSegments,
    searchMatches,
    activeLineIndex,
    // Callbacks
    getSpeakerLabel,
    toggleSpeakerVisibility,
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
  };
}
