import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { PlayerCard } from "./PlayerCard";

describe("PlayerCard speaker filtering", () => {
  it("shows an empty-state message and pauses playback when all speakers are deselected", () => {
    const { container, rerender } = render(
      <PlayerCard
        videoUrl="https://example.com/video.mp4"
        thumbnailUrl={null}
        seekRequest={null}
        onPlaybackTimeChange={vi.fn()}
        onDurationChange={vi.fn()}
        chapters={[]}
        onSeekToSeconds={vi.fn()}
        transcriptSegments={[
          { startSeconds: 0, endSeconds: 2, speaker: 0 },
          { startSeconds: 2, endSeconds: 4, speaker: 1 },
        ]}
        selectedSpeakerIds={new Set([0, 1])}
        speakerFilteringActive={false}
        allSpeakersDeselected={false}
      />,
    );

    const video = container.querySelector("video") as HTMLVideoElement;
    let paused = false;
    Object.defineProperty(video, "paused", {
      configurable: true,
      get: () => paused,
    });
    const pauseSpy = vi.fn(() => {
      paused = true;
    });
    Object.defineProperty(video, "pause", {
      configurable: true,
      value: pauseSpy,
    });

    rerender(
      <PlayerCard
        videoUrl="https://example.com/video.mp4"
        thumbnailUrl={null}
        seekRequest={null}
        onPlaybackTimeChange={vi.fn()}
        onDurationChange={vi.fn()}
        chapters={[]}
        onSeekToSeconds={vi.fn()}
        transcriptSegments={[
          { startSeconds: 0, endSeconds: 2, speaker: 0 },
          { startSeconds: 2, endSeconds: 4, speaker: 1 },
        ]}
        selectedSpeakerIds={new Set<number>()}
        speakerFilteringActive={true}
        allSpeakersDeselected={true}
      />,
    );

    expect(pauseSpy).toHaveBeenCalledTimes(1);
    expect(
      screen.getByText("No speakers selected. Re-enable at least one speaker to resume filtered playback."),
    ).toBeTruthy();
  });
});
