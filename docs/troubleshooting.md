# Troubleshooting

## API won’t start

Check:

- `.env` exists
- `DATABASE_URL` is valid
- `MEDIA_SERVER_WEBHOOK_SECRET` is at least 32 chars
- `DEEPGRAM_API_KEY` and `GROQ_API_KEY` are set

The config package throws on invalid env, so startup failures are usually explicit.

## Upload completes but processing never starts

Check:

- `POST /api/uploads/complete` returned a `jobId`
- worker is running
- `GET /api/jobs/:id`
- `job_queue` row is not stuck in `dead`

## Media processing fails

Likely causes:

- media-server cannot reach S3/MinIO
- FFmpeg/ffprobe missing or failing
- bad/corrupt source file

Checks:

- `curl http://localhost:3100/health`
- media-server logs
- `videos.error_message`
- `job_queue.last_error`

## Transcript never appears

Check:

- `videos.transcription_status`
- Deepgram key/config
- whether `process_video` marked the asset as `no_audio`
- worker logs for `job.transcribe.*`

## AI output never appears

Check:

- `videos.ai_status`
- Groq credentials
- transcript exists and is non-empty
- worker logs for `job.ai.*`

## Webhooks rejected

Inbound media-server webhook failures usually mean:

- missing required headers
- bad timestamp skew
- bad HMAC signature
- invalid `videoId`/phase payload

Review `webhook_events` and API logs.

## Retry button does nothing useful

`POST /api/videos/:id/retry` only resets matching active/dead transcription and AI jobs. It does not recreate an upload or rerun a fully completed media processing stage.

## Dev UI mismatch

Remember there are two app modes:

- nginx-served built app on `:8022`
- Vite dev app on `:5173`

If code changes don’t show up, make sure you’re looking at the right one.
