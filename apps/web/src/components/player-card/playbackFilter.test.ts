import { describe, expect, it } from "vitest";
import {
  buildPlayableSpeakerRanges,
  getPlaybackCorrection,
} from "./playbackFilter";

describe("playbackFilter", () => {
  it("merges adjacent playable speaker ranges", () => {
    const ranges = buildPlayableSpeakerRanges({
      durationSeconds: 30,
      transcriptSegments: [
        { startSeconds: 1, endSeconds: 2, speaker: 0 },
        { startSeconds: 2.05, endSeconds: 3, speaker: 0 },
      ],
      selectedSpeakerIds: new Set([0]),
      speakerFilteringActive: true,
      segmentStartPaddingSeconds: 0,
      segmentEndPaddingSeconds: 0,
      segmentMergeGapSeconds: 0.1,
    });

    expect(ranges).toEqual([{ startSeconds: 1, endSeconds: 3 }]);
  });

  it("skips deselected speaker gaps by returning the next playable start", () => {
    const ranges = buildPlayableSpeakerRanges({
      durationSeconds: 30,
      transcriptSegments: [
        { startSeconds: 0, endSeconds: 2, speaker: 0 },
        { startSeconds: 2, endSeconds: 4, speaker: 1 },
        { startSeconds: 4, endSeconds: 6, speaker: 0 },
      ],
      selectedSpeakerIds: new Set([0]),
      speakerFilteringActive: true,
      segmentStartPaddingSeconds: 0,
      segmentEndPaddingSeconds: 0,
      segmentMergeGapSeconds: 0,
    });

    expect(getPlaybackCorrection(2.5, ranges)).toBe(4);
  });

  it("keeps unlabeled segments playable while filtering is active", () => {
    const ranges = buildPlayableSpeakerRanges({
      durationSeconds: 30,
      transcriptSegments: [
        { startSeconds: 0, endSeconds: 2, speaker: 0 },
        { startSeconds: 2, endSeconds: 4, speaker: null },
        { startSeconds: 4, endSeconds: 6, speaker: 1 },
      ],
      selectedSpeakerIds: new Set([0]),
      speakerFilteringActive: true,
      segmentStartPaddingSeconds: 0,
      segmentEndPaddingSeconds: 0,
      segmentMergeGapSeconds: 0,
    });

    expect(ranges).toEqual([
      { startSeconds: 0, endSeconds: 4 },
    ]);
    expect(getPlaybackCorrection(2.5, ranges)).toBeNull();
  });

  it("produces no playable ranges when every detected speaker is deselected", () => {
    const ranges = buildPlayableSpeakerRanges({
      durationSeconds: 30,
      transcriptSegments: [
        { startSeconds: 0, endSeconds: 2, speaker: 0 },
        { startSeconds: 2, endSeconds: 4, speaker: 1 },
      ],
      selectedSpeakerIds: new Set<number>(),
      speakerFilteringActive: true,
      segmentStartPaddingSeconds: 0,
      segmentEndPaddingSeconds: 0,
      segmentMergeGapSeconds: 0,
    });

    expect(ranges).toEqual([]);
    expect(getPlaybackCorrection(1, ranges)).toBeNull();
  });

  it("corrects seeks before the first playable segment", () => {
    const ranges = buildPlayableSpeakerRanges({
      durationSeconds: 30,
      transcriptSegments: [
        { startSeconds: 5, endSeconds: 6, speaker: 0 },
        { startSeconds: 10, endSeconds: 12, speaker: 1 },
      ],
      selectedSpeakerIds: new Set([0]),
      speakerFilteringActive: true,
      segmentStartPaddingSeconds: 0,
      segmentEndPaddingSeconds: 0,
      segmentMergeGapSeconds: 0,
    });

    expect(getPlaybackCorrection(0, ranges)).toBe(5);
  });
});
