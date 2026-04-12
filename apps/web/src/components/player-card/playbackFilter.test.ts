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

  it("returns no ranges when durationSeconds is non-positive", () => {
    const ranges = buildPlayableSpeakerRanges({
      durationSeconds: 0,
      transcriptSegments: [
        { startSeconds: 1, endSeconds: 2, speaker: 0 },
      ],
      selectedSpeakerIds: new Set([0]),
      speakerFilteringActive: true,
    });
    expect(ranges).toEqual([]);
  });

  it("clamps segment boundaries to [0, durationSeconds]", () => {
    const ranges = buildPlayableSpeakerRanges({
      durationSeconds: 10,
      transcriptSegments: [
        // Start before 0 and end after duration — should clamp, not drop.
        { startSeconds: -2, endSeconds: 100, speaker: 0 },
      ],
      selectedSpeakerIds: new Set([0]),
      speakerFilteringActive: true,
      segmentStartPaddingSeconds: 0,
      segmentEndPaddingSeconds: 0,
      segmentMergeGapSeconds: 0,
    });
    expect(ranges).toEqual([{ startSeconds: 0, endSeconds: 10 }]);
  });

  it("sorts input segments by start time before merging", () => {
    // Out-of-order input simulates a transcript that arrived with reordered
    // segments (e.g. after an edit). buildPlayableSpeakerRanges must normalize.
    const ranges = buildPlayableSpeakerRanges({
      durationSeconds: 30,
      transcriptSegments: [
        { startSeconds: 10, endSeconds: 12, speaker: 0 },
        { startSeconds: 4, endSeconds: 6, speaker: 0 },
        { startSeconds: 6.05, endSeconds: 8, speaker: 0 },
      ],
      selectedSpeakerIds: new Set([0]),
      speakerFilteringActive: true,
      segmentStartPaddingSeconds: 0,
      segmentEndPaddingSeconds: 0,
      segmentMergeGapSeconds: 0.1,
    });
    expect(ranges).toEqual([
      { startSeconds: 4, endSeconds: 8 },
      { startSeconds: 10, endSeconds: 12 },
    ]);
  });

  it("drops non-finite or degenerate segments without crashing", () => {
    const ranges = buildPlayableSpeakerRanges({
      durationSeconds: 30,
      transcriptSegments: [
        { startSeconds: Number.NaN, endSeconds: 3, speaker: 0 },
        { startSeconds: 5, endSeconds: 5, speaker: 0 }, // zero-length collapses after padding
        { startSeconds: 10, endSeconds: 12, speaker: 0 },
      ],
      selectedSpeakerIds: new Set([0]),
      speakerFilteringActive: true,
      segmentStartPaddingSeconds: 0,
      segmentEndPaddingSeconds: 0,
      segmentMergeGapSeconds: 0,
    });
    expect(ranges).toEqual([{ startSeconds: 10, endSeconds: 12 }]);
  });

  it("passes through every segment when speakerFilteringActive is false", () => {
    const ranges = buildPlayableSpeakerRanges({
      durationSeconds: 30,
      transcriptSegments: [
        { startSeconds: 0, endSeconds: 2, speaker: 0 },
        { startSeconds: 2, endSeconds: 4, speaker: 1 },
      ],
      // Empty selection would normally hide everything, but filtering is off
      // so everything is playable.
      selectedSpeakerIds: new Set<number>(),
      speakerFilteringActive: false,
      segmentStartPaddingSeconds: 0,
      segmentEndPaddingSeconds: 0,
      segmentMergeGapSeconds: 0,
    });
    expect(ranges).toEqual([{ startSeconds: 0, endSeconds: 4 }]);
  });
});
