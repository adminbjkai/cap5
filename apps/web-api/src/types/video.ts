/**
 * Shared TypeScript types and interfaces for video processing.
 */

export const PROCESSING_PHASE_RANK: Record<string, number> = {
  not_required: 0,
  queued: 10,
  downloading: 20,
  probing: 30,
  processing: 40,
  uploading: 50,
  generating_thumbnail: 60,
  complete: 70,
  failed: 80,
  cancelled: 90
};

export type JobType =
  | "process_video"
  | "transcribe_video"
  | "generate_ai"
  | "cleanup_artifacts"
  | "deliver_webhook";

export type ProcessResponse = {
  resultKey: string;
  thumbnailKey: string;
  durationSeconds?: number;
  width?: number;
  height?: number;
  fps?: number | null;
  hasAudio?: boolean;
};

export type WebhookPayload = {
  jobId: string | number;
  videoId: string;
  phase: keyof typeof PROCESSING_PHASE_RANK;
  progress: number;
  message?: string;
  error?: string;
  metadata?: {
    duration?: number;
    width?: number;
    height?: number;
    fps?: number;
  };
};

export type ProviderHealthState = "healthy" | "active" | "degraded" | "idle" | "unavailable";

export type AiChapter = {
  title: string;
  seconds: number;
  sentiment?: "positive" | "neutral" | "negative";
};

export type AiEntities = {
  people: string[];
  organizations: string[];
  locations: string[];
  dates: string[];
};

export type AiActionItem = {
  task: string;
  assignee?: string;
  deadline?: string;
};

export type AiQuote = {
  text: string;
  timestamp: number;
};

export type ProviderStatusResponse = {
  checkedAt: string;
  providers: Array<{
    key: "deepgram" | "groq";
    label: string;
    purpose: "transcription" | "ai";
    state: ProviderHealthState;
    configured: boolean;
    baseUrl: string | null;
    model: string | null;
    lastSuccessAt: string | null;
    lastJob: {
      id: number;
      videoId: string;
      status: string;
      updatedAt: string;
      lastError: string | null;
    } | null;
  }>;
};

export type IdempotencyBeginResult =
  | { kind: "proceed" }
  | { kind: "cached"; statusCode: number; body: Record<string, unknown> }
  | { kind: "conflict"; statusCode: 409; body: Record<string, unknown> };

export type TranscriptSegmentRow = {
  startSeconds?: number;
  endSeconds?: number;
  text?: string;
  confidence?: number | null;
  speaker?: number | null;
  originalText?: string;
};
