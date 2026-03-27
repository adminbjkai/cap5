import { useRecordingMachine } from "../hooks/useRecordingMachine";
import { formatBytes, formatDuration, formatEta } from "../lib/format";

export function RecordPage() {
  const {
    state,
    errorMessage,
    secondsElapsed,
    micEnabled,
    setMicEnabled,
    cameraEnabled,
    setCameraEnabled,
    microphones,
    selectedMicId,
    setSelectedMicId,
    previewUrl,
    sourceLabel,
    uploadProgress,
    videoId,
    jobId,
    retryAvailable,
    micLevel,
    unsupportedReason,
    stateLabelMap,
    cameraPreviewRef,
    startRecording,
    stopRecording,
    uploadAndProcess,
    downloadRecording,
    handleExistingFileSelection,
    resetAll,
  } = useRecordingMachine();

  const activeStep =
    state === "complete"
      ? 3
      : state === "preview" || state === "uploading" || state === "processing"
        ? 2
        : 1;

  return (
    <div className="space-y-5 animate-in fade-in duration-500">
      {/* ── Header card ──────────────────────────────────────────────────── */}
      <section className="workspace-card">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className="workspace-label">Capture studio</p>
            <h1 className="mt-1 text-2xl font-semibold tracking-tight">Record or upload</h1>
            <p className="mt-2 max-w-2xl text-sm text-hint">
              Capture a screen, tab, or window with microphone audio, then preview and hand it off to the processing pipeline.
            </p>
          </div>
          <div className="grid gap-2 sm:grid-cols-3">
            {[
              { id: 1, label: "Setup",   copy: "Choose sources" },
              { id: 2, label: "Preview", copy: "Review output" },
              { id: 3, label: "Upload",  copy: "Auto-queued" },
            ].map((step) => {
              const isActive   = activeStep === step.id;
              const isComplete = activeStep > step.id;
              return (
                <div key={step.id} className={`studio-step ${isActive ? "studio-step-active" : isComplete ? "studio-step-complete" : ""}`}>
                  <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-muted">Step {step.id}</p>
                  <p className="mt-1 text-sm font-semibold">{step.label}</p>
                  <p className="mt-1 text-xs text-muted">{step.copy}</p>
                </div>
              );
            })}
          </div>
        </div>
        {unsupportedReason ? <p className="panel-warning mt-4">{unsupportedReason}</p> : null}
        {errorMessage       ? <p className="panel-danger  mt-4">{errorMessage}</p>       : null}
      </section>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1.08fr)_minmax(0,0.92fr)]">
        {/* ── Controls card ──────────────────────────────────────────────── */}
        <section className="workspace-card animate-in fade-in slide-in-from-bottom-2 duration-500">
          <div className="mb-4 flex items-center justify-between gap-3">
            <div>
              <p className="workspace-label">Capture setup</p>
              <h2 className="text-xl font-semibold tracking-tight">Inputs and controls</h2>
            </div>
            <span className="status-chip">{stateLabelMap[state]}</span>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <label className="panel-subtle flex items-center justify-between">
              <span className="text-sm font-medium">Microphone</span>
              <input type="checkbox" checked={micEnabled} onChange={(e) => setMicEnabled(e.target.checked)} className="h-4 w-4" />
            </label>
            <label className="panel-subtle flex items-center justify-between">
              <span className="text-sm font-medium">Camera preview</span>
              <input type="checkbox" checked={cameraEnabled} onChange={(e) => setCameraEnabled(e.target.checked)} className="h-4 w-4" />
            </label>
          </div>

          <div className="mt-4 grid gap-4 lg:grid-cols-[minmax(0,1fr)_240px]">
            <div className="space-y-4">
              <div className="panel-subtle">
                <label htmlFor="micSelect" className="field-label">Microphone source</label>
                <select id="micSelect" value={selectedMicId} onChange={(e) => setSelectedMicId(e.target.value)} className="input-control" disabled={!micEnabled}>
                  {microphones.length === 0 ? <option value="">No microphone found</option> : null}
                  {microphones.map((mic) => (
                    <option key={mic.deviceId} value={mic.deviceId}>{mic.label}</option>
                  ))}
                </select>
              </div>

              <div className="panel-subtle">
                <div className="mb-2 flex items-center justify-between">
                  <span className="field-label mb-0">Mic confidence</span>
                  <span className="text-xs text-muted">{micEnabled ? `${micLevel}%` : "Off"}</span>
                </div>
                <div className="progress-track h-2 overflow-hidden rounded-full">
                  <div className="progress-active-bar h-full rounded-full transition-all duration-150" style={{ width: `${micEnabled ? micLevel : 0}%` }} />
                </div>
                <p className="mt-2 text-xs text-muted">Speak before recording to verify microphone activity.</p>
              </div>

              <div className="action-group pt-1">
                {state !== "recording" ? (
                  <button type="button" onClick={() => void startRecording()} className="btn-primary px-4 py-2 disabled:cursor-not-allowed disabled:opacity-60" disabled={state === "requesting_permissions" || !!unsupportedReason}>
                    {state === "requesting_permissions" ? "Requesting permissions..." : "Start capture"}
                  </button>
                ) : (
                  <button type="button" onClick={stopRecording} className="btn-tertiary px-4 py-2">Stop capture</button>
                )}
                <button type="button" onClick={resetAll} className="btn-secondary px-4 py-2">Reset</button>
              </div>
            </div>

            <div className="space-y-3">
              <div className="panel-subtle">
                <p className="field-label">Session</p>
                <div className="space-y-2 text-sm">
                  {([["State", stateLabelMap[state]], ["Timer", formatDuration(secondsElapsed)], ["Mic", micEnabled ? "On" : "Off"], ["Camera", cameraEnabled ? "On" : "Off"]] as [string, string][]).map(([label, value]) => (
                    <div key={label} className="flex items-center justify-between gap-3">
                      <span className="text-muted">{label}</span>
                      <span className="font-medium">{value}</span>
                    </div>
                  ))}
                </div>
              </div>
              {cameraEnabled ? (
                <div>
                  <p className="field-label">Camera preview</p>
                  <video ref={cameraPreviewRef} autoPlay muted playsInline className="video-frame max-h-48 rounded-lg" />
                </div>
              ) : null}
            </div>
          </div>
        </section>

        {/* ── Preview / upload card ─────────────────────────────────────── */}
        <section className="workspace-card animate-in fade-in slide-in-from-bottom-2 duration-500 delay-150 fill-mode-both">
          <div className="mb-4 flex items-center justify-between gap-3">
            <div>
              <p className="workspace-label">Preview and upload</p>
              <h2 className="text-xl font-semibold tracking-tight">Review before processing</h2>
            </div>
            {sourceLabel ? <span className="status-chip">{sourceLabel}</span> : null}
          </div>

          <div className="panel-subtle p-3">
            <label htmlFor="existingVideo" className="field-label">Use an existing local file</label>
            <input id="existingVideo" type="file" accept="video/*" className="input-control block" onChange={(e) => handleExistingFileSelection(e.currentTarget.files?.[0] ?? null)} />
          </div>

          {!previewUrl ? (
            <div className="panel-subtle mt-4 border-dashed">
              <p className="text-sm font-medium">No preview yet</p>
              <p className="mt-1 text-sm text-hint">Stop a recording or select a local video file to continue.</p>
            </div>
          ) : (
            <>
              <video controls src={previewUrl} className="video-frame mt-4 w-full rounded-lg" />
              <div className="mt-4 action-group">
                {sourceLabel === "Screen recording" && state === "preview" ? (
                  <span className="text-sm text-muted">Auto-uploading...</span>
                ) : (
                  <button type="button" onClick={() => void uploadAndProcess()} className="btn-primary px-4 py-2 disabled:cursor-not-allowed disabled:opacity-60" disabled={state === "uploading" || state === "processing"}>
                    {state === "uploading" ? "Uploading..." : state === "processing" ? "Queued for processing..." : "Upload and process"}
                  </button>
                )}
                {retryAvailable ? (
                  <button type="button" onClick={() => void uploadAndProcess()} className="btn-primary px-4 py-2">Retry upload</button>
                ) : null}
                <button type="button" onClick={downloadRecording} className="btn-secondary px-4 py-2">Save local copy</button>
              </div>
            </>
          )}

          {uploadProgress ? (
            <div className="panel-subtle mt-4 p-3 animate-in fade-in zoom-in-95 duration-300">
              <div className="mb-2 flex items-center justify-between gap-3">
                <p className="text-sm font-medium">Upload progress</p>
                <p className="text-sm font-semibold">{uploadProgress.progressPct}%</p>
              </div>
              <div className="progress-track mb-2 h-2 w-full rounded-full">
                <div className="progress-active-bar h-full rounded-full transition-all" style={{ width: `${Math.max(0, Math.min(100, uploadProgress.progressPct))}%` }} />
              </div>
              <p className="text-sm">{formatBytes(uploadProgress.loadedBytes)} / {formatBytes(uploadProgress.totalBytes)}</p>
              <p className="text-xs text-muted">Speed: {formatBytes(uploadProgress.speedBytesPerSec)}/s · ETA: {formatEta(uploadProgress.etaSeconds)}</p>
            </div>
          ) : null}

          {(videoId ?? jobId) ? (
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              {videoId ? <div className="panel-subtle"><p className="field-label">Video ID</p><p className="font-mono text-xs break-all">{videoId}</p></div> : null}
              {jobId   ? <div className="panel-subtle"><p className="field-label">Job ID</p><p className="font-mono text-xs break-all">{jobId}</p></div>   : null}
            </div>
          ) : null}
        </section>
      </div>
    </div>
  );
}
