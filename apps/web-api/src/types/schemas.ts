import { z } from "zod"

// ---------------------------------------------------------------------------
// Videos
// ---------------------------------------------------------------------------

export const CreateVideoSchema = z.object({
  name: z.string().max(500).optional().default("Untitled Video"),
  webhookUrl: z.string().url().optional().nullable(),
})

export const VideoIdParamSchema = z.object({
  id: z.string().uuid(),
})

export const WatchEditsBodySchema = z.object({
  title: z.string().max(500).optional().nullable(),
  transcriptText: z.string().optional().nullable(),
  speakerLabels: z.record(z.string(), z.string()).optional().nullable(),
  notesText: z.string().max(20000).optional().nullable(),
})

// ---------------------------------------------------------------------------
// Uploads
// ---------------------------------------------------------------------------

export const SignedUploadSchema = z.object({
  videoId: z.string().uuid(),
  contentType: z.string().optional().default("application/octet-stream"),
})

export const UploadCompleteSchema = z.object({
  videoId: z.string().uuid(),
})

export const MultipartInitiateSchema = z.object({
  videoId: z.string().uuid(),
  contentType: z.string(),
})

export const MultipartPresignPartSchema = z.object({
  videoId: z.string().uuid(),
  partNumber: z.number().int().min(1).max(10000),
})

export const MultipartCompleteSchema = z.object({
  videoId: z.string().uuid(),
  parts: z.array(
    z.object({
      ETag: z.string(),
      PartNumber: z.number().int().min(1),
    })
  ),
})

export const MultipartAbortSchema = z.object({
  videoId: z.string().uuid(),
})

// ---------------------------------------------------------------------------
// Library
// ---------------------------------------------------------------------------

export const LibraryQuerySchema = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(50).default(24),
  sort: z.enum(["created_desc", "created_asc"]).optional().default("created_desc"),
})

// ---------------------------------------------------------------------------
// Jobs
// ---------------------------------------------------------------------------

export const JobIdParamSchema = z.object({
  id: z.coerce.number().int().min(1),
})

// ---------------------------------------------------------------------------
// Debug (non-production)
// ---------------------------------------------------------------------------

export const DebugCreateVideoSchema = z.object({
  name: z.string().optional().default("Smoke Video"),
  sourceType: z.enum(["web_mp4", "processed_mp4", "hls"]).optional().default("web_mp4"),
})

export const DebugEnqueueJobSchema = z.object({
  videoId: z.string().uuid(),
  jobType: z.string(),
  payload: z.record(z.string(), z.unknown()).optional(),
  priority: z.number().int().optional(),
  maxAttempts: z.number().int().optional(),
})

