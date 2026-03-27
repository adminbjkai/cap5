/**
 * Inline (table-style) chapter list without a card wrapper.
 * Used in VideoPage below-the-fold section.
 */
import { useMemo } from "react";
import { formatTimestamp } from "../lib/format";

type ChapterItem = {
  title: string;
  seconds: number;
};

type ChapterListInlineProps = {
  chapters: ChapterItem[];
  currentSeconds: number;
  durationSeconds: number;
  onSeek: (seconds: number) => void;
};

export function ChapterListInline({
  chapters,
  currentSeconds,
  durationSeconds,
  onSeek,
}: ChapterListInlineProps) {
  const validChapters = useMemo(() => {
    if (durationSeconds <= 0) return chapters;
    return chapters.filter((c) => c.seconds >= 0 && c.seconds <= durationSeconds);
  }, [chapters, durationSeconds]);

  const activeIndex = useMemo(() => {
    if (validChapters.length === 0) return -1;
    let active = 0;
    for (let i = 0; i < validChapters.length; i++) {
      if (validChapters[i]!.seconds <= currentSeconds + 0.1) {
        active = i;
      } else {
        break;
      }
    }
    return active;
  }, [validChapters, currentSeconds]);

  if (validChapters.length === 0) return null;

  return (
    <div className="divide-y divide-default rounded-xl border">
      {validChapters.map((chapter, index) => {
        const isActive = index === activeIndex;
        return (
          <button
            key={`${chapter.title}-${index}-${chapter.seconds}`}
            type="button"
            onClick={() => onSeek(chapter.seconds)}
            className={`w-full flex items-center gap-4 px-4 py-2 text-left transition-colors hover:bg-surface-muted ${
              isActive ? "bg-surface-muted" : ""
            }`}
          >
            <span
              className={`font-mono text-[11px] w-10 shrink-0 ${
                isActive ? "font-semibold text-foreground" : "text-muted"
              }`}
            >
              {formatTimestamp(chapter.seconds)}
            </span>
            <span
              className={`text-[13px] flex-1 leading-snug ${
                isActive ? "font-medium text-foreground" : "text-secondary"
              }`}
            >
              {chapter.title}
            </span>
            {isActive && <span className="h-1.5 w-1.5 rounded-full shrink-0 bg-blue" />}
          </button>
        );
      })}
    </div>
  );
}
