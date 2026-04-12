import { describe, expect, it, vi, beforeEach } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { TranscriptCard } from "./TranscriptCard";
import type { VideoStatusResponse } from "../lib/api";

const baseTranscript: NonNullable<VideoStatusResponse["transcript"]> = {
  provider: "deepgram",
  language: "en",
  vttKey: "cap5/test/transcript.vtt",
  text: "Host intro.\nGuest reply.\nNarration bridge.",
  speakerLabels: { "0": "Host", "1": "Guest" },
  segments: [
    { startSeconds: 0, endSeconds: 3, text: "Host intro.", speaker: 0 },
    { startSeconds: 3, endSeconds: 6, text: "Guest reply.", speaker: 1 },
    { startSeconds: 6, endSeconds: 8, text: "Narration bridge.", speaker: null },
  ],
};

function renderTranscriptCard(
  transcript: NonNullable<VideoStatusResponse["transcript"]> = baseTranscript,
  videoId = "video-1",
) {
  return render(
    <TranscriptCard
      videoId={videoId}
      transcriptionStatus="complete"
      transcript={transcript}
      errorMessage={null}
      playbackTimeSeconds={0}
      onSeekToSeconds={vi.fn()}
      onSaveTranscript={vi.fn(async () => true)}
      onSaveSpeakerLabels={vi.fn(async () => true)}
      compact
    />,
  );
}

describe("TranscriptCard speaker selection", () => {
  beforeEach(() => {
    cleanup();
    window.localStorage.clear();
  });

  it("hides a deselected speaker line", () => {
    const view = renderTranscriptCard();

    fireEvent.click(view.container.querySelectorAll("button.speaker-filter-chip")[0] as HTMLButtonElement);

    expect(screen.queryByText("Host intro.")).toBeNull();
    expect(screen.getByText("Guest reply.")).toBeTruthy();
    expect(screen.getByText("Narration bridge.")).toBeTruthy();
  });

  it("persists speaker selection per video across remounts", () => {
    const firstRender = renderTranscriptCard();
    fireEvent.click(firstRender.container.querySelectorAll("button.speaker-filter-chip")[1] as HTMLButtonElement);
    expect(screen.queryByText("Guest reply.")).toBeNull();

    firstRender.unmount();

    renderTranscriptCard();

    expect(screen.queryByText("Guest reply.")).toBeNull();
    expect(screen.getByText("Host intro.")).toBeTruthy();
  });

  it("prunes restored selection when the transcript speaker IDs change", () => {
    window.localStorage.setItem("cap5:selected-speakers:video-1", JSON.stringify([0]));

    const nextTranscript: NonNullable<VideoStatusResponse["transcript"]> = {
      ...baseTranscript,
      speakerLabels: { "1": "Guest" },
      segments: [
        { startSeconds: 3, endSeconds: 6, text: "Guest reply.", speaker: 1 },
      ],
    };

    renderTranscriptCard(nextTranscript);

    expect(screen.getByText("No speakers selected.")).toBeTruthy();
    expect(screen.queryByText("Guest reply.")).toBeNull();
  });

  it("exposes aria-pressed state on each speaker-filter chip and flips it on toggle", () => {
    const view = renderTranscriptCard();

    const chips = view.container.querySelectorAll<HTMLButtonElement>("button.speaker-filter-chip");
    expect(chips.length).toBe(2);
    // Both chips start selected (aria-pressed=true).
    chips.forEach((chip) => {
      expect(chip.getAttribute("aria-pressed")).toBe("true");
    });

    fireEvent.click(chips[0]!);

    // After toggling Host off, the first chip flips to aria-pressed=false; the
    // second chip stays pressed. aria-label also flips to match.
    expect(chips[0]!.getAttribute("aria-pressed")).toBe("false");
    expect(chips[0]!.getAttribute("aria-label")).toBe("Show Host");
    expect(chips[1]!.getAttribute("aria-pressed")).toBe("true");
    expect(chips[1]!.getAttribute("aria-label")).toBe("Hide Guest");
  });
});
