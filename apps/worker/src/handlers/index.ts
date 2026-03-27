import type { JobType, JobRow } from "../types.js";
import { handleProcessVideo } from "./process-video.js";
import { handleTranscribeVideo } from "./transcribe-video.js";
import { handleGenerateAi } from "./generate-ai.js";
import { handleCleanupArtifacts } from "./cleanup-artifacts.js";
import { handleDeliverWebhook } from "./deliver-webhook.js";

export const HANDLER_MAP: Record<JobType, (job: JobRow) => Promise<void>> = {
  process_video: handleProcessVideo,
  transcribe_video: handleTranscribeVideo,
  generate_ai: handleGenerateAi,
  cleanup_artifacts: handleCleanupArtifacts,
  deliver_webhook: handleDeliverWebhook,
};

export {
  handleProcessVideo,
  handleTranscribeVideo,
  handleGenerateAi,
  handleCleanupArtifacts,
  handleDeliverWebhook,
};
