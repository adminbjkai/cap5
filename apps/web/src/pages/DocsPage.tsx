import { useState } from 'react';

type DeckSection = {
  id: string;
  title: string;
  description: string;
  color: string;
  sections: { heading: string; content: string }[];
};

const decks: DeckSection[] = [
  {
    id: 'overview',
    title: 'Platform Overview',
    description: 'What cap5 is, key features, user experience, and design philosophy.',
    color: '#22d3ee',
    sections: [
      {
        heading: 'What is cap5?',
        content:
          'A single-tenant video processing platform for uploading or recording video, normalizing it into MP4, generating transcripts with speaker diarization, and producing AI enrichments — all from one clean monorepo.',
      },
      {
        heading: 'Core Features',
        content: `Screen Recording — Browser-based screen/tab/window capture with optional microphone mixing via AudioContext.\n\nVideo Processing — FFmpeg normalizes any input to H.264/AAC MP4 with faststart. Generates best-frame thumbnail. ffprobe extracts duration, dimensions, FPS, and audio presence.\n\nAI Transcription — Deepgram Nova-2 speech-to-text with speaker diarization, language detection, smart formatting, and punctuation. Stored as timed segments with WebVTT.\n\nAI Enrichment — Groq Llama 3.3 70B generates title, summary, chapters (max 12), entities, action items, and quotes. Multi-chunk synthesis for long transcripts (>24K chars).\n\nSmart Library — Search by title with instant client-side filtering. From/to date range pickers. Status filter (all, processing, complete, failed). Cursor-based pagination.\n\nSecure Auth — Single-user email/password auth with bcrypt. Stateless JWT (HS256, 7-day lifetime). httpOnly Secure SameSite=Strict cookie. First-run setup flow.`,
      },
      {
        heading: 'User Experience',
        content: `Record or upload video → auto-process → review with AI enrichments.\n\nWatch page features: video player with custom controls and speaker-aware playback, multi-tab sidebar (transcript, summary, chapters, notes, action items), inline editing of title, transcript text, speaker labels, and operator notes, chapter timeline with click-to-seek.\n\nNavigation: Cmd+K command palette with fuzzy search, Space/Arrow key shortcuts, collapsible sidebar persisted to localStorage, confirmation dialogs for destructive actions.`,
      },
      {
        heading: 'Scope & Goals',
        content: `What cap5 is: Single-tenant, single-user design. PostgreSQL does everything (metadata, queue, transcripts, AI outputs, idempotency, webhook ledger). Docker Compose deployment. Clean monorepo with pnpm workspaces. Idempotent mutations via Idempotency-Key header.\n\nWhat cap5 is not: No multi-tenancy. No Redis/Kafka. No active HLS pipeline. No production platform manifests beyond Docker Compose. Frontend polls for status (no WebSocket push yet).`,
      },
    ],
  },
  {
    id: 'architecture',
    title: 'Architecture & Tech Stack',
    description: 'Runtime topology, technology stack, monorepo structure, and architecture decisions.',
    color: '#f97316',
    sections: [
      {
        heading: 'Runtime Topology',
        content: `User Browser → nginx (web-internal) serving the React SPA and proxying API requests.\n\nnginx routes /api/* → Fastify API (apps/web-api) — handles REST endpoints, auth, webhooks.\nnginx routes /cap5/* → MinIO/S3 — object storage for raw uploads, MP4s, thumbnails, VTT files.\n\nFastify API ↔ PostgreSQL — metadata, queue state, transcripts, AI outputs, idempotency keys, webhook events.\n\nWorker (apps/worker) → PostgreSQL (claim jobs), MinIO/S3 (download/upload), Media Server (transcode), Deepgram API (transcription), Groq API (AI enrichment).\n\nMedia Server (apps/media-server) — FFmpeg/ffprobe wrapper. Downloads raw from S3, transcodes, generates thumbnail, uploads artifacts. Sends webhook progress back to API.`,
      },
      {
        heading: 'Tech Stack',
        content: `Frontend: React 18, Vite 5, Tailwind CSS 3, Zustand 5, React Router 6, TypeScript.\n\nBackend: Fastify, Node.js 20, TypeScript, Zod validation, Pino logging, JWT/bcrypt.\n\nMedia & AI: FFmpeg, ffprobe, Deepgram Nova-2, Groq Llama 3.3 70B, WebVTT.\n\nInfrastructure: PostgreSQL, MinIO (S3-compatible), Docker Compose, nginx, Alpine Linux, pnpm workspaces.`,
      },
      {
        heading: 'Monorepo Structure',
        content: `apps/web — React/Vite frontend for library, recording, watch page, transcript edits, and review.\napps/web-api — Fastify REST API for videos, uploads, library, auth, provider status, and webhooks.\napps/worker — PostgreSQL-backed async worker that processes jobs.\napps/media-server — FFmpeg/ffprobe processing service.\npackages/config — Zod-validated environment schema (canonical env contract).\npackages/db — PostgreSQL pool + migrations (singleton per DATABASE_URL).\npackages/logger — Pino structured logging with secret redaction and context propagation.`,
      },
      {
        heading: 'Architecture Decisions',
        content: `ADR-001: PostgreSQL is the queue — FOR UPDATE SKIP LOCKED with leases, heartbeats, reclaim, and dead-lettering. No external broker needed.\n\nADR-002: Synchronous media orchestration — Worker calls media-server directly via POST /process.\n\nADR-003: Shared HMAC shape — Inbound and outbound webhooks use the same timestamped HMAC format.\n\nADR-004: Single-user JWT auth — Email/password with bcrypt, stateless HS256 JWT, httpOnly cookie transport.\n\nADR-005: Runtime naming is cap5 — S3 bucket defaults to cap5, object routing uses /cap5/..., webhook media type uses application/cap5-webhook+json.`,
      },
    ],
  },
  {
    id: 'pipeline',
    title: 'Processing Pipeline & AI',
    description: 'End-to-end video processing flow, media processing, AI providers, and upload strategies.',
    color: '#22c55e',
    sections: [
      {
        heading: 'End-to-End Pipeline',
        content: `Step 1 — Upload: Browser records screen or user uploads file. Single-part (≤100MB) or multipart (>100MB, 10MB chunks) signed S3 upload. Queues process_video.\n\nStep 2 — Process: Worker claims job. Media-server downloads raw from S3. FFmpeg transcodes to H.264/AAC MP4. Generates thumbnail. ffprobe extracts metadata. Uploads artifacts.\n\nStep 3 — Transcribe: Worker sends audio to Deepgram Nova-2. Returns segments with speaker diarization, timestamps, confidence. Stores transcript + WebVTT. Queues generate_ai.\n\nStep 4 — AI Enrich: Worker sends transcript to Groq Llama 3.3 70B. Generates title, summary, chapters, entities, action items, quotes. Multi-chunk synthesis for long transcripts.\n\nStep 5 — Deliver: Frontend polls GET /api/videos/:id/status. Renders video player, transcript, AI enrichments. Outbound webhooks fire at each milestone.`,
      },
      {
        heading: 'Media Processing',
        content: `FFmpeg normalization: ffmpeg -y -i <input> -map 0:v:0 -map 0:a:0? -c:v libx264 -preset veryfast -pix_fmt yuv420p -movflags +faststart -c:a aac -b:a 128k <output.mp4>\n\nThumbnail: ffmpeg -y -i <result.mp4> -vf thumbnail -frames:v 1 <thumb.jpg>\n\nProbe: ffprobe -v error -print_format json -show_streams -show_format <file>\n\nS3 key patterns: result at videos/<videoId>/result/result.mp4, thumbnail at videos/<videoId>/thumb/screen-capture.jpg, VTT at videos/<videoId>/transcript/transcript.vtt.`,
      },
      {
        heading: 'AI Providers',
        content: `Deepgram (Transcription): Model Nova-2. Features: smart_format, punctuate, utterances, diarize, detect_language. Output: segments with startSeconds, endSeconds, text, confidence, speaker. Fallback: extracts audio via FFmpeg first; falls back to full video if needed.\n\nGroq (AI Enrichment): Model Llama 3.3 70B Versatile. Temperature 0.3, JSON response format. Multi-chunk: transcripts >24K chars split by paragraph boundaries, processed individually, then synthesized. Outputs: title, summary, key_points, chapters (30s dedup, max 12), entities (set-deduplicated), action_items, quotes (max 5).`,
      },
      {
        heading: 'Upload Strategies',
        content: `Single-part (≤100MB): POST /api/videos → POST /api/uploads/signed → PUT to signed URL (XHR with progress) → POST /api/uploads/complete → queues process_video.\n\nMultipart (>100MB): POST /api/uploads/multipart/initiate → POST /api/uploads/multipart/presign-part (per 10MB chunk) → PUT each chunk (sequential, ETag tracking) → POST /api/uploads/multipart/complete (ETags array) → queues process_video. Optional abort via POST /api/uploads/multipart/abort.`,
      },
    ],
  },
  {
    id: 'internals',
    title: 'System Internals',
    description: 'Data model, PostgreSQL queue mechanics, state model, webhooks, and authentication.',
    color: '#a78bfa',
    sections: [
      {
        heading: 'Data Model',
        content: `videos — processing_phase, processing_phase_rank, transcription_status, ai_status, result_key, thumbnail_key, duration/width/height/fps, webhook_url, operator_notes, deleted_at.\n\nuploads — mode (singlepart|multipart), phase, raw_key, multipart_upload_id, etag_manifest.\n\njob_queue — job_type, status (queued/leased/running/done/dead), priority, payload, attempts/max_attempts, lease_token, locked_by, locked_until, run_after, last_error.\n\ntranscripts — provider, language, segments_json, speaker_labels_json, vtt_key.\n\nai_outputs — provider, model, title, summary, chapters_json, entities_json, action_items_json, quotes_json.\n\nwebhook_events — delivery_id, video_id, phase, progress, accepted/rejected.\n\nidempotency_keys — endpoint + key → cached response.`,
      },
      {
        heading: 'Queue & Worker',
        content: `Claiming: SELECT ... FROM job_queue WHERE status IN ('queued','leased') AND run_after <= now() AND attempts < max_attempts ORDER BY priority DESC, id ASC FOR UPDATE SKIP LOCKED LIMIT 1.\n\nLease lifecycle: 60s lease, 15s heartbeat (extends locked_until), 10s reclaim tick (batch size 25). Heartbeat loss logs job.heartbeat.lost. Health check on media-server before claiming process_video.\n\nRetry: exponential backoff LEAST(7200, 30 × 2^(attempts-1)) — 30s → 60s → 120s → ... capped at 2 hours. Fatal errors (401/403) skip straight to dead.\n\nJob priorities: process_video (100), transcribe_video (95), generate_ai (90), cleanup_artifacts (default), deliver_webhook (max 5 attempts).`,
      },
      {
        heading: 'Processing Phases',
        content: `processing_phase (monotonic rank): not_required (0) → queued (10) → downloading (20) → probing (30) → processing (40) → uploading (50) → generating_thumbnail (60) → complete (70) → failed (80) → cancelled (90).\n\ntranscription_status: not_started → queued → processing → complete | no_audio | skipped | failed.\n\nai_status: not_started → queued → processing → complete | skipped | failed.\n\nMedia processing, transcription, and AI are independent tracks — one can be complete while others are still running.`,
      },
      {
        heading: 'Webhooks',
        content: `Inbound: POST /api/webhooks/media-server/progress. HMAC-verified with MEDIA_SERVER_WEBHOOK_SECRET, timestamp skew enforcement, delivery deduplication, monotonic phase updates. All events recorded in webhook_events.\n\nOutbound: Events video.progress, video.transcription_complete, video.ai_complete. JSON POST to per-video webhookUrl with x-cap-timestamp, x-cap-signature, x-cap-delivery-id headers. Signed with OUTBOUND_WEBHOOK_SECRET (falls back to MEDIA_SERVER_WEBHOOK_SECRET). Max 5 attempts via deliver_webhook job.`,
      },
      {
        heading: 'Authentication',
        content: `First run: GET /api/auth/status returns setupRequired: true → POST /api/auth/setup creates initial account.\n\nLogin: POST /api/auth/login → sets httpOnly cap5_token cookie (Secure, SameSite=Strict). Validation: GET /api/auth/me on app load. Logout: POST /api/auth/logout clears cookie.\n\nSecurity: JWT HS256 (7-day lifetime), bcrypt password hashing, httpOnly cookies (no JS access), Idempotency-Key on all mutations, HMAC-signed webhooks, soft delete with 5-minute delayed cleanup_artifacts job.`,
      },
    ],
  },
];

const pipelineSteps = [
  { label: 'Upload', color: '#22d3ee', icon: '↑' },
  { label: 'Process', color: '#f97316', icon: '⚙' },
  { label: 'Transcribe', color: '#22c55e', icon: '💬' },
  { label: 'Enrich', color: '#a78bfa', icon: '🧠' },
  { label: 'Deliver', color: '#f472b6', icon: '▶' },
];

const stats = [
  { value: '4', label: 'Services' },
  { value: '3', label: 'Packages' },
  { value: '5', label: 'Job Types' },
  { value: '2', label: 'AI Providers' },
  { value: '7', label: 'Tables' },
];

export function DocsPage() {
  const [activeTab, setActiveTab] = useState('overview');
  const activeDeck = decks.find(d => d.id === activeTab) ?? decks[0];

  return (
    <div className="mx-auto max-w-5xl px-6 py-8">
      {/* Header */}
      <div className="mb-8">
        <h1 className="text-2xl font-bold tracking-tight" style={{ color: 'var(--text-primary)' }}>
          Documentation
        </h1>
        <p className="mt-1 text-sm" style={{ color: 'var(--text-secondary)' }}>
          Architecture, tech stack, pipeline, and system internals.
        </p>
      </div>

      {/* Stats row */}
      <div className="mb-8 flex gap-6">
        {stats.map(s => (
          <div key={s.label} className="text-center">
            <div className="text-2xl font-extrabold" style={{ color: 'var(--accent-blue)' }}>
              {s.value}
            </div>
            <div className="text-[11px] font-semibold uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>
              {s.label}
            </div>
          </div>
        ))}
      </div>

      {/* Pipeline mini-flow */}
      <div className="mb-8 flex items-center gap-3 overflow-x-auto rounded-lg border px-5 py-4"
        style={{ background: 'var(--surface-card)', borderColor: 'var(--border-primary)' }}>
        {pipelineSteps.map((step, i) => (
          <div key={step.label} className="flex items-center gap-3">
            <div className="flex items-center gap-2 rounded-md px-3 py-1.5"
              style={{ background: `${step.color}15`, border: `1px solid ${step.color}30` }}>
              <span className="text-sm">{step.icon}</span>
              <span className="text-xs font-semibold" style={{ color: step.color }}>{step.label}</span>
            </div>
            {i < pipelineSteps.length - 1 && (
              <span className="text-sm" style={{ color: 'var(--text-muted)' }}>→</span>
            )}
          </div>
        ))}
      </div>

      {/* Tab nav */}
      <div className="mb-6 flex gap-1 overflow-x-auto rounded-lg border p-1"
        style={{ background: 'var(--surface-card)', borderColor: 'var(--border-primary)' }}>
        {decks.map(deck => (
          <button
            key={deck.id}
            onClick={() => setActiveTab(deck.id)}
            className="flex-1 rounded-md px-4 py-2 text-xs font-semibold transition-colors"
            style={{
              background: activeTab === deck.id ? `${deck.color}20` : 'transparent',
              color: activeTab === deck.id ? deck.color : 'var(--text-secondary)',
              borderBottom: activeTab === deck.id ? `2px solid ${deck.color}` : '2px solid transparent',
            }}
          >
            {deck.title}
          </button>
        ))}
      </div>

      {/* Active deck content */}
      <div className="space-y-6">
        <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
          {activeDeck.description}
        </p>
        {activeDeck.sections.map(section => (
          <div
            key={section.heading}
            className="rounded-lg border p-6"
            style={{
              background: 'var(--surface-card)',
              borderColor: 'var(--border-primary)',
            }}
          >
            <h3
              className="mb-3 text-base font-semibold"
              style={{ color: activeDeck.color }}
            >
              {section.heading}
            </h3>
            <div className="text-sm leading-relaxed whitespace-pre-line" style={{ color: 'var(--text-secondary)' }}>
              {section.content}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
