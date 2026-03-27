export type JobType = "process_video" | "transcribe_video" | "generate_ai" | "cleanup_artifacts" | "deliver_webhook";

export type JobPayload = Record<string, unknown>;

export type JobRow = {
  id: number;
  video_id: string;
  job_type: JobType;
  lease_token: string;
  payload: JobPayload;
  attempts: number;
  max_attempts: number;
};

export type FailResult = {
  id: number;
  status: "queued" | "dead";
};

export type ProcessResponse = {
  resultKey: string;
  thumbnailKey: string;
  durationSeconds?: number;
  width?: number;
  height?: number;
  fps?: number;
  hasAudio?: boolean;
};

export const PROCESSING_PHASE_META = {
  queued: { rank: 10, progress: 5 },
  downloading: { rank: 20, progress: 20 },
  probing: { rank: 30, progress: 33 },
  processing: { rank: 40, progress: 60 },
  uploading: { rank: 50, progress: 88 },
  generating_thumbnail: { rank: 60, progress: 95 },
  complete: { rank: 70, progress: 100 },
  failed: { rank: 80, progress: 100 },
  cancelled: { rank: 90, progress: 100 }
} as const;

export type ProcessingPhase = keyof typeof PROCESSING_PHASE_META;
