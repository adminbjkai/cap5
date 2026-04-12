export const DEFAULT_SEGMENT_START_PADDING_SECONDS = 0.08;
export const DEFAULT_SEGMENT_END_PADDING_SECONDS = 0.12;
export const DEFAULT_SEGMENT_MERGE_GAP_SECONDS = 0.08;

export type SpeakerPlaybackSegment = {
  startSeconds?: number;
  endSeconds?: number;
  speaker?: number | null;
};

export type SpeakerPlaybackRange = {
  startSeconds: number;
  endSeconds: number;
};

export type BuildPlayableSpeakerRangesOptions = {
  durationSeconds: number;
  transcriptSegments: SpeakerPlaybackSegment[];
  selectedSpeakerIds: Set<number>;
  speakerFilteringActive: boolean;
  segmentStartPaddingSeconds?: number;
  segmentEndPaddingSeconds?: number;
  segmentMergeGapSeconds?: number;
};

export type PlaybackPositionAnalysis = {
  currentRange: SpeakerPlaybackRange | null;
  nextRange: SpeakerPlaybackRange | null;
};

export function buildPlayableSpeakerRanges({
  durationSeconds,
  transcriptSegments,
  selectedSpeakerIds,
  speakerFilteringActive,
  segmentStartPaddingSeconds = DEFAULT_SEGMENT_START_PADDING_SECONDS,
  segmentEndPaddingSeconds = DEFAULT_SEGMENT_END_PADDING_SECONDS,
  segmentMergeGapSeconds = DEFAULT_SEGMENT_MERGE_GAP_SECONDS,
}: BuildPlayableSpeakerRangesOptions): SpeakerPlaybackRange[] {
  if (durationSeconds <= 0) return [];

  const rawRanges = (Array.isArray(transcriptSegments) ? transcriptSegments : [])
    .map((segment) => {
      const startSeconds = Number(segment.startSeconds);
      if (!Number.isFinite(startSeconds)) return null;

      const fallbackEnd = startSeconds + 0.25;
      const rawEnd = Number(segment.endSeconds);
      const endSeconds = Number.isFinite(rawEnd) ? rawEnd : fallbackEnd;
      const safeStart = Math.max(0, Math.min(durationSeconds, startSeconds - segmentStartPaddingSeconds));
      const safeEnd = Math.max(safeStart, Math.min(durationSeconds, endSeconds + segmentEndPaddingSeconds));
      if (safeEnd <= safeStart) return null;

      const speaker = typeof segment.speaker === "number" && Number.isInteger(segment.speaker) && segment.speaker >= 0
        ? segment.speaker
        : null;
      const hasKnownSpeaker = speaker !== null;
      const isPlayable = !speakerFilteringActive || !hasKnownSpeaker || selectedSpeakerIds.has(speaker);
      if (!isPlayable) return null;

      return { startSeconds: safeStart, endSeconds: safeEnd };
    })
    .filter((range): range is SpeakerPlaybackRange => Boolean(range))
    .sort((a, b) => a.startSeconds - b.startSeconds);

  if (rawRanges.length <= 1) return rawRanges;

  const merged: SpeakerPlaybackRange[] = [];
  for (const range of rawRanges) {
    const previous = merged[merged.length - 1];
    if (!previous || range.startSeconds > previous.endSeconds + segmentMergeGapSeconds) {
      merged.push({ ...range });
      continue;
    }
    previous.endSeconds = Math.max(previous.endSeconds, range.endSeconds);
  }

  return merged;
}

export function analyzePlaybackPosition(
  candidateSeconds: number,
  playableRanges: SpeakerPlaybackRange[],
): PlaybackPositionAnalysis {
  if (playableRanges.length === 0) {
    return { currentRange: null, nextRange: null };
  }

  const current = Math.max(0, candidateSeconds);

  for (let index = 0; index < playableRanges.length; index += 1) {
    const range = playableRanges[index]!;
    if (current < range.startSeconds) {
      return { currentRange: null, nextRange: range };
    }
    if (current >= range.startSeconds && current <= range.endSeconds) {
      return {
        currentRange: range,
        nextRange: playableRanges[index + 1] ?? null,
      };
    }
  }

  return { currentRange: null, nextRange: null };
}

export function getPlaybackCorrection(
  candidateSeconds: number,
  playableRanges: SpeakerPlaybackRange[],
): number | null {
  const { currentRange, nextRange } = analyzePlaybackPosition(candidateSeconds, playableRanges);
  if (currentRange) return null;
  return nextRange?.startSeconds ?? null;
}
