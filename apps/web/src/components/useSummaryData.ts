import { useMemo, useState } from 'react';
import type { VideoStatusResponse } from '../lib/api';
import { formatTimestamp } from '../lib/format';

export type TimedKeyPoint = { title: string; jumpSeconds: number | null };
export type EntitySection = { label: string; items: string[] };

export type SummaryDataProps = {
  aiOutput: VideoStatusResponse['aiOutput'] | null | undefined;
  chapters: Array<{ title: string; seconds: number }>;
};

export function useSummaryData({ aiOutput, chapters }: SummaryDataProps) {
  const [copyFeedback, setCopyFeedback] = useState<string | null>(null);

  const summaryForCopy = useMemo(() => {
    if (!aiOutput) return null;
    const title = aiOutput.title?.trim() ? `Title: ${aiOutput.title.trim()}` : null;
    const summary = aiOutput.summary?.trim() ? `Summary: ${aiOutput.summary.trim()}` : null;
    const points =
      aiOutput.keyPoints.length > 0
        ? `Key points:\n${aiOutput.keyPoints.map((p) => `- ${p}`).join('\n')}`
        : null;
    return [title, summary, points].filter(Boolean).join('\n\n');
  }, [aiOutput]);

  const copyValue = async (value: string, successLabel: string, failureLabel: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setCopyFeedback(successLabel);
    } catch {
      setCopyFeedback(failureLabel);
    }
    window.setTimeout(() => setCopyFeedback(null), 1800);
  };

  const chapterItems = useMemo<TimedKeyPoint[]>(() => {
    const usable = chapters.filter((c) => Number.isFinite(c.seconds) && c.seconds >= 0);
    if (usable.length > 0) return usable.map((c) => ({ title: c.title, jumpSeconds: c.seconds }));
    if (!aiOutput) return [];
    return aiOutput.keyPoints.map((p) => ({ title: p, jumpSeconds: null }));
  }, [aiOutput, chapters]);

  const entitySections = useMemo<EntitySection[]>(() => {
    if (!aiOutput?.entities) return [];
    return [
      { label: 'People', items: aiOutput.entities.people },
      { label: 'Organizations', items: aiOutput.entities.organizations },
      { label: 'Locations', items: aiOutput.entities.locations },
      { label: 'Dates', items: aiOutput.entities.dates },
    ].filter((section) => section.items.length > 0);
  }, [aiOutput]);

  const actionItems = aiOutput?.actionItems ?? [];
  const quotes = aiOutput?.quotes ?? [];

  return {
    copyFeedback,
    summaryForCopy,
    copyValue,
    chapterItems,
    entitySections,
    actionItems,
    quotes,
    formatTimestamp,
  };
}
