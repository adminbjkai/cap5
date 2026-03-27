/**
 * AI output parsing and normalization helpers.
 */

import type { AiChapter, AiEntities, AiActionItem, AiQuote } from "../types/video.js";

export function transcriptTextFromSegments(segments: unknown): string | null {
  if (!Array.isArray(segments)) return null;
  const text = segments
    .map((segment) => {
      if (!segment || typeof segment !== "object") return "";
      const value = (segment as { text?: unknown }).text;
      return typeof value === "string" ? value.trim() : "";
    })
    .filter((value) => value.length > 0)
    .join("\n")
    .trim();
  return text.length > 0 ? text : null;
}

export function keyPointsFromChapters(chapters: unknown): string[] {
  if (!Array.isArray(chapters)) return [];
  return chapters
    .map((chapter) => {
      if (typeof chapter === "string") return chapter.trim();
      if (!chapter || typeof chapter !== "object") return "";
      const point = (chapter as { point?: unknown }).point;
      if (typeof point === "string") return point.trim();
      const title = (chapter as { title?: unknown }).title;
      return typeof title === "string" ? title.trim() : "";
    })
    .filter((point) => point.length > 0);
}

export function structuredChaptersFromJson(chapters: unknown): AiChapter[] {
  if (!Array.isArray(chapters)) return [];

  const deduped = new Map<string, AiChapter>();

  for (const chapter of chapters) {
    if (!chapter || typeof chapter !== "object") continue;
    const record = chapter as Record<string, unknown>;
    const rawTitle = typeof record.title === "string" ? record.title : record.point;
    const title = typeof rawTitle === "string" ? rawTitle.trim() : "";
    const seconds = Number(record.startSeconds ?? record.start);
    const sentiment =
      record.sentiment === "positive" || record.sentiment === "neutral" || record.sentiment === "negative"
        ? record.sentiment
        : undefined;

    if (!title || !Number.isFinite(seconds) || seconds < 0) continue;

    const normalized: AiChapter = {
      title,
      seconds,
      ...(sentiment ? { sentiment } : {})
    };
    const key = `${Math.round(seconds * 10)}:${title.toLowerCase()}`;
    if (!deduped.has(key)) deduped.set(key, normalized);
  }

  return Array.from(deduped.values()).sort((a, b) => a.seconds - b.seconds);
}

function stringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => (typeof item === "string" ? item.trim() : ""))
    .filter((item) => item.length > 0);
}

export function structuredEntitiesFromJson(value: unknown): AiEntities | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const entities: AiEntities = {
    people: stringArray(record.people),
    organizations: stringArray(record.organizations),
    locations: stringArray(record.locations),
    dates: stringArray(record.dates)
  };
  return Object.values(entities).some((items) => items.length > 0) ? entities : null;
}

export function structuredActionItemsFromJson(value: unknown): AiActionItem[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => {
      if (!item || typeof item !== "object") return null;
      const record = item as Record<string, unknown>;
      const task = typeof record.task === "string" ? record.task.trim() : "";
      if (!task) return null;
      const assignee = typeof record.assignee === "string" && record.assignee.trim() ? record.assignee.trim() : undefined;
      const deadline = typeof record.deadline === "string" && record.deadline.trim() ? record.deadline.trim() : undefined;
      return { task, ...(assignee ? { assignee } : {}), ...(deadline ? { deadline } : {}) };
    })
    .filter((item): item is AiActionItem => Boolean(item));
}

export function structuredQuotesFromJson(value: unknown): AiQuote[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => {
      if (!item || typeof item !== "object") return null;
      const record = item as Record<string, unknown>;
      const text = typeof record.text === "string" ? record.text.trim() : "";
      const timestamp = Number(record.timestamp);
      if (!text || !Number.isFinite(timestamp) || timestamp < 0) return null;
      return { text, timestamp };
    })
    .filter((item): item is AiQuote => Boolean(item));
}
