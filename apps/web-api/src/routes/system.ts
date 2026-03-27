/**
 * System routes:
 *   GET /api/system/provider-status — provider health summary
 *   GET /                           — dev UI (HTML)
 */

import type { FastifyInstance } from "fastify";
import {
  getSystemProviderStatus,
} from "../lib/shared.js";

const uiPublicBucketBase = `${(process.env.S3_PUBLIC_ENDPOINT ?? "http://localhost:9000").replace(/\/$/, "")}/${process.env.S3_BUCKET ?? "cap4"}`;

export async function systemRoutes(app: FastifyInstance) {
  // ------------------------------------------------------------------
  // Provider status
  // ------------------------------------------------------------------

  app.get("/api/system/provider-status", async (req, reply) => {
    try {
      return reply.send(await getSystemProviderStatus());
    } catch (error) {
      req.serviceLog?.info("web-api log", { event: "provider_status.unavailable", error: String(error) });
      return reply.code(503).send({ ok: false, error: "Provider status unavailable" });
    }
  });

  // ------------------------------------------------------------------
  // Root dev UI
  // ------------------------------------------------------------------

  app.get("/", async (_req, reply) => {
    const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>Cap4 Upload UI</title>
  <style>
    body{font-family:ui-sans-serif,system-ui,-apple-system,Segoe UI,Roboto,sans-serif;max-width:900px;margin:32px auto;padding:0 16px;color:#111}
    .card{border:1px solid #ddd;border-radius:10px;padding:16px}
    .row{display:flex;gap:8px;align-items:center;flex-wrap:wrap}
    button{padding:10px 14px;border-radius:8px;border:1px solid #111;background:#111;color:#fff;cursor:pointer}
    button:disabled{opacity:.5;cursor:not-allowed}
    pre{background:#f6f8fa;padding:12px;border-radius:8px;overflow:auto}
    .muted{color:#666;font-size:14px}
  </style>
</head>
<body>
  <h1>Cap4 Dev UI</h1>
  <p class="muted">Runs full upload flow: create video, request signed PUT, upload file, complete upload, poll status.</p>
  <div class="card">
    <div class="row">
      <input id="fileInput" type="file" accept="video/*" />
      <button id="startBtn">Upload + Process</button>
    </div>
    <p id="phase" class="muted">Phase: idle</p>
    <p id="progress" class="muted">Progress: 0%</p>
    <p id="videoIdText" class="muted">Video ID: -</p>
    <p id="jobIdText" class="muted">Job ID: -</p>
    <div id="links"></div>
    <pre id="log"></pre>
  </div>
  <script>
    const logEl = document.getElementById("log");
    const phaseEl = document.getElementById("phase");
    const progressEl = document.getElementById("progress");
    const videoIdTextEl = document.getElementById("videoIdText");
    const jobIdTextEl = document.getElementById("jobIdText");
    const linksEl = document.getElementById("links");
    const startBtn = document.getElementById("startBtn");
    const fileInput = document.getElementById("fileInput");
    const bucketBase = ${JSON.stringify(uiPublicBucketBase)};

    function appendLog(msg) {
      logEl.textContent += msg + "\\n";
      logEl.scrollTop = logEl.scrollHeight;
    }

    function encodeKey(key) {
      return key.split("/").map(encodeURIComponent).join("/");
    }

    async function postJson(path, body) {
      const res = await fetch(path, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Idempotency-Key": crypto.randomUUID() },
        body: JSON.stringify(body)
      });
      if (!res.ok) throw new Error(path + " failed: " + res.status + " " + await res.text());
      return res.json();
    }

    async function run() {
      const file = fileInput.files && fileInput.files[0];
      if (!file) {
        alert("Select a video file first.");
        return;
      }

      startBtn.disabled = true;
      linksEl.innerHTML = "";
      logEl.textContent = "";
      phaseEl.textContent = "Phase: starting";
      progressEl.textContent = "Progress: 0%";
      videoIdTextEl.textContent = "Video ID: -";
      jobIdTextEl.textContent = "Job ID: -";

      try {
        appendLog("1) POST /api/videos");
        const created = await postJson("/api/videos", {});
        const videoId = created.videoId;
        appendLog("videoId=" + videoId);
        videoIdTextEl.textContent = "Video ID: " + videoId;

        appendLog("2) POST /api/uploads/signed");
        const signed = await postJson("/api/uploads/signed", {
          videoId,
          contentType: file.type || "application/octet-stream"
        });
        appendLog("rawKey=" + signed.rawKey);

        appendLog("3) PUT file to signed URL");
        const putRes = await fetch(signed.putUrl, {
          method: "PUT",
          headers: { "Content-Type": file.type || "application/octet-stream" },
          body: file
        });
        if (!putRes.ok) throw new Error("PUT failed: " + putRes.status + " " + await putRes.text());

        appendLog("4) POST /api/uploads/complete");
        const completed = await postJson("/api/uploads/complete", { videoId });
        appendLog("jobId=" + completed.jobId);
        jobIdTextEl.textContent = "Job ID: " + completed.jobId;

        appendLog("5) Poll /api/videos/:id/status");
        while (true) {
          const statusRes = await fetch("/api/videos/" + encodeURIComponent(videoId) + "/status");
          if (!statusRes.ok) throw new Error("status failed: " + statusRes.status + " " + await statusRes.text());
          const status = await statusRes.json();

          phaseEl.textContent = "Phase: " + status.processingPhase;
          progressEl.textContent = "Progress: " + status.processingProgress + "%";

          if (status.processingPhase === "failed") {
            throw new Error(status.errorMessage || "processing failed");
          }

          if (status.processingPhase === "complete") {
            const resultUrl = bucketBase + "/" + encodeKey(status.resultKey);
            const thumbUrl = bucketBase + "/" + encodeKey(status.thumbnailKey);
            linksEl.innerHTML =
              '<p><a href="' + resultUrl + '" target="_blank" rel="noreferrer">Download result.mp4</a></p>' +
              '<p><a href="' + thumbUrl + '" target="_blank" rel="noreferrer">Download thumbnail.jpg</a></p>';
            appendLog("complete");
            break;
          }

          await new Promise((resolve) => setTimeout(resolve, 1000));
        }
      } catch (err) {
        appendLog("error: " + String(err));
      } finally {
        startBtn.disabled = false;
      }
    }

    startBtn.addEventListener("click", run);
  </script>
</body>
</html>`;

    return reply.type("text/html; charset=utf-8").send(html);
  });
}
