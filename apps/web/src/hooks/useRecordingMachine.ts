import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  completeUpload,
  createVideo,
  requestSignedUpload,
  uploadMultipart,
  uploadToSignedUrl,
  type UploadProgress,
} from "../lib/api";
import { upsertRecentSession } from "../lib/sessions";

/* ── Types ───────────────────────────────────────────────────────────────── */
export type RecorderState =
  | "idle"
  | "requesting_permissions"
  | "ready"
  | "recording"
  | "stopping"
  | "preview"
  | "uploading"
  | "processing"
  | "complete"
  | "error";

export type MicrophoneDevice = {
  deviceId: string;
  label: string;
};

type UploadAttemptContext = {
  videoId: string;
};

const MULTIPART_UPLOAD_THRESHOLD_BYTES = 100 * 1024 * 1024;

function stopStream(stream: MediaStream | null) {
  if (!stream) return;
  for (const track of stream.getTracks()) track.stop();
}

function pickSupportedMimeType(): string {
  if (typeof MediaRecorder === "undefined") return "video/webm";
  const candidates = ["video/webm;codecs=vp8,opus", "video/webm;codecs=vp9,opus", "video/webm"];
  for (const candidate of candidates) {
    if (MediaRecorder.isTypeSupported(candidate)) return candidate;
  }
  return "video/webm";
}

/* ── Hook ────────────────────────────────────────────────────────────────── */
export function useRecordingMachine() {
  const navigate = useNavigate();

  const [state, setState] = useState<RecorderState>("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [secondsElapsed, setSecondsElapsed] = useState(0);
  const [micEnabled, setMicEnabled] = useState(true);
  const [cameraEnabled, setCameraEnabled] = useState(false);
  const [microphones, setMicrophones] = useState<MicrophoneDevice[]>([]);
  const [selectedMicId, setSelectedMicId] = useState<string>("");
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [recordedBlob, setRecordedBlob] = useState<Blob | null>(null);
  const [sourceLabel, setSourceLabel] = useState<string | null>(null);
  const [uploadProgress, setUploadProgress] = useState<UploadProgress | null>(null);
  const [videoId, setVideoId] = useState<string | null>(null);
  const [jobId, setJobId] = useState<number | null>(null);
  const [retryAvailable, setRetryAvailable] = useState(false);
  const [micLevel, setMicLevel] = useState(0);

  const lastProgressUpdateRef = useRef<number>(0);
  const [uploadContext, setUploadContext] = useState<UploadAttemptContext | null>(null);
  const autoUploadTriggeredRef = useRef(false);
  const cameraPreviewRef = useRef<HTMLVideoElement | null>(null);
  const displayStreamRef = useRef<MediaStream | null>(null);
  const micStreamRef = useRef<MediaStream | null>(null);
  const cameraStreamRef = useRef<MediaStream | null>(null);
  const recorderStreamRef = useRef<MediaStream | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const micAnalyserRef = useRef<AnalyserNode | null>(null);
  const micAnalyserDataRef = useRef<Uint8Array<ArrayBuffer> | null>(null);
  const micMeterAnimationRef = useRef<number | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<number | null>(null);
  const startedAtMsRef = useRef<number | null>(null);
  const finalizedRef = useRef(false);

  const stateLabelMap: Record<RecorderState, string> = {
    idle: "Idle",
    requesting_permissions: "Requesting permissions",
    ready: "Ready",
    recording: "Recording",
    stopping: "Stopping",
    preview: "Preview",
    uploading: "Uploading",
    processing: "Processing",
    complete: "Complete",
    error: "Needs attention",
  };

  const unsupportedReason = useMemo(() => {
    if (typeof window === "undefined") return null;
    if (!navigator.mediaDevices?.getDisplayMedia) return "Screen recording is not supported in this browser.";
    if (!navigator.mediaDevices?.getUserMedia) return "Microphone access is not supported in this browser.";
    if (typeof MediaRecorder === "undefined") return "MediaRecorder is not supported in this browser.";
    return null;
  }, []);

  const refreshMicrophones = useCallback(async () => {
    if (!navigator.mediaDevices?.enumerateDevices) return;
    const devices = await navigator.mediaDevices.enumerateDevices();
    const mics = devices
      .filter((d) => d.kind === "audioinput")
      .map((d, i) => ({ deviceId: d.deviceId, label: d.label || `Microphone ${i + 1}` }));
    setMicrophones(mics);
    if (!selectedMicId && mics.length > 0) setSelectedMicId(mics[0]!.deviceId);
  }, [selectedMicId]);

  const clearTimer = useCallback(() => {
    if (timerRef.current !== null) {
      window.clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const resetLocalPreview = useCallback(() => {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setPreviewUrl(null);
    setRecordedBlob(null);
    setSourceLabel(null);
    setSecondsElapsed(0);
    setUploadProgress(null);
    setVideoId(null);
    setJobId(null);
    setRetryAvailable(false);
    setUploadContext(null);
  }, [previewUrl]);

  const stopCameraPreview = useCallback(() => {
    stopStream(cameraStreamRef.current);
    cameraStreamRef.current = null;
    if (cameraPreviewRef.current) cameraPreviewRef.current.srcObject = null;
  }, []);

  const cleanupRecordingResources = useCallback(() => {
    clearTimer();
    if (micMeterAnimationRef.current !== null) {
      window.cancelAnimationFrame(micMeterAnimationRef.current);
      micMeterAnimationRef.current = null;
    }
    micAnalyserRef.current = null;
    micAnalyserDataRef.current = null;
    setMicLevel(0);
    stopStream(displayStreamRef.current);
    stopStream(micStreamRef.current);
    stopStream(recorderStreamRef.current);
    displayStreamRef.current = null;
    micStreamRef.current = null;
    recorderStreamRef.current = null;
    mediaRecorderRef.current = null;
    if (audioContextRef.current) {
      void audioContextRef.current.close();
      audioContextRef.current = null;
    }
  }, [clearTimer]);

  const finalizeRecording = useCallback(
    (recorderMimeType: string) => {
      if (finalizedRef.current) return;
      finalizedRef.current = true;
      cleanupRecordingResources();
      const blob = new Blob(chunksRef.current, { type: recorderMimeType || "video/webm" });
      if (blob.size === 0) {
        setState("error");
        setErrorMessage("Recording stopped before data was captured. Try again and share a tab/window for at least a moment.");
        return;
      }
      const nextPreviewUrl = URL.createObjectURL(blob);
      setRecordedBlob(blob);
      setPreviewUrl(nextPreviewUrl);
      setSourceLabel("Screen recording");
      setState("preview");
      setErrorMessage(null);
      setRetryAvailable(false);
    },
    [cleanupRecordingResources],
  );

  const requestPermissionWarmup = useCallback(async () => {
    if (!navigator.mediaDevices?.getUserMedia) return;
    try {
      const temp = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
      stopStream(temp);
      await refreshMicrophones();
    } catch {
      // Best-effort preflight only.
    }
  }, [refreshMicrophones]);

  const startRecording = useCallback(async () => {
    if (unsupportedReason) {
      setState("error");
      setErrorMessage(unsupportedReason);
      return;
    }
    resetLocalPreview();
    setState("requesting_permissions");
    setErrorMessage(null);
    finalizedRef.current = false;

    try {
      await requestPermissionWarmup();
      const displayStream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true });
      displayStreamRef.current = displayStream;

      let micStream: MediaStream | null = null;
      if (micEnabled) {
        micStream = await navigator.mediaDevices.getUserMedia({
          audio: selectedMicId ? { deviceId: { exact: selectedMicId } } : true,
          video: false,
        });
        micStreamRef.current = micStream;
      }

      const composedStream = new MediaStream();
      const videoTrack = displayStream.getVideoTracks()[0];
      if (!videoTrack) throw new Error("No video track available from screen capture.");
      composedStream.addTrack(videoTrack);

      const sourceStreams: MediaStream[] = [];
      if (displayStream.getAudioTracks().length > 0) sourceStreams.push(displayStream);
      if (micStream && micStream.getAudioTracks().length > 0) sourceStreams.push(micStream);

      if (sourceStreams.length > 0) {
        const audioContext = new AudioContext();
        audioContextRef.current = audioContext;
        const destination = audioContext.createMediaStreamDestination();

        if (micStream && micStream.getAudioTracks().length > 0) {
          const analyser = audioContext.createAnalyser();
          analyser.fftSize = 2048;
          analyser.smoothingTimeConstant = 0.86;
          const analyserSource = audioContext.createMediaStreamSource(micStream);
          analyserSource.connect(analyser);
          micAnalyserRef.current = analyser;
          micAnalyserDataRef.current = new Uint8Array(new ArrayBuffer(analyser.frequencyBinCount));
        }

        for (const sourceStream of sourceStreams) {
          const source = audioContext.createMediaStreamSource(sourceStream);
          source.connect(destination);
        }
        const mixedTrack = destination.stream.getAudioTracks()[0];
        if (mixedTrack) composedStream.addTrack(mixedTrack);
      }

      recorderStreamRef.current = composedStream;
      const recorder = new MediaRecorder(composedStream, { mimeType: pickSupportedMimeType() });
      mediaRecorderRef.current = recorder;
      chunksRef.current = [];

      recorder.ondataavailable = (event) => {
        if (event.data && event.data.size > 0) chunksRef.current.push(event.data);
      };
      recorder.onerror = () => {
        setState("error");
        setErrorMessage("Recording failed unexpectedly. Try again, and if this repeats, refresh the page.");
      };
      recorder.onstop = () => finalizeRecording(recorder.mimeType || "video/webm");

      const handleNativeStop = () => {
        if (recorder.state === "recording") {
          setState("stopping");
          recorder.stop();
        }
      };
      for (const track of displayStream.getTracks()) {
        track.addEventListener("ended", handleNativeStop, { once: true });
      }

      startedAtMsRef.current = Date.now();
      clearTimer();
      timerRef.current = window.setInterval(() => {
        const startedAt = startedAtMsRef.current;
        if (!startedAt) return;
        setSecondsElapsed((Date.now() - startedAt) / 1000);
      }, 200);

      const animateMicMeter = () => {
        const analyser = micAnalyserRef.current;
        const data = micAnalyserDataRef.current;
        if (!analyser || !data) {
          setMicLevel(0);
          micMeterAnimationRef.current = window.requestAnimationFrame(animateMicMeter);
          return;
        }
        analyser.getByteTimeDomainData(data);
        let sumSquares = 0;
        for (let i = 0; i < data.length; i += 1) {
          const normalized = (data[i]! - 128) / 128;
          sumSquares += normalized * normalized;
        }
        const rms = Math.sqrt(sumSquares / data.length);
        setMicLevel(Math.max(0, Math.min(100, Math.round(rms * 240))));
        micMeterAnimationRef.current = window.requestAnimationFrame(animateMicMeter);
      };
      if (micEnabled) micMeterAnimationRef.current = window.requestAnimationFrame(animateMicMeter);

      recorder.start(250);
      setState("recording");
    } catch (error) {
      cleanupRecordingResources();
      setState("error");
      const nextError =
        error instanceof DOMException && (error.name === "NotAllowedError" || error.name === "SecurityError")
          ? "Permission was denied. Allow screen sharing and microphone access in your browser, then try again."
          : error instanceof DOMException && error.name === "NotFoundError"
            ? "No capture source or microphone was found. Connect a microphone or pick a shareable tab/window."
            : error instanceof Error
              ? error.message
              : "Unable to start recording. Try again.";
      setErrorMessage(nextError);
    }
  }, [unsupportedReason, resetLocalPreview, requestPermissionWarmup, micEnabled, selectedMicId, cleanupRecordingResources, clearTimer, finalizeRecording]);

  const stopRecording = useCallback(() => {
    const recorder = mediaRecorderRef.current;
    if (!recorder || recorder.state !== "recording") return;
    setState("stopping");
    recorder.stop();
  }, []);

  const uploadAndProcess = useCallback(async () => {
    if (!recordedBlob) return;
    setState("uploading");
    setErrorMessage(null);

    try {
      let activeVideoId = uploadContext?.videoId ?? null;
      if (!activeVideoId) {
        const created = await createVideo();
        activeVideoId = created.videoId;
        setUploadContext({ videoId: activeVideoId });
      }
      setVideoId(activeVideoId);

      const contentType = recordedBlob.type || "application/octet-stream";
      const onProgress = (progress: UploadProgress) => {
        const now = Date.now();
        if (now - lastProgressUpdateRef.current > 200 || progress.progressPct >= 100) {
          setUploadProgress(progress);
          lastProgressUpdateRef.current = now;
        }
      };

      let nextJobId: number | null = null;
      if (recordedBlob.size > MULTIPART_UPLOAD_THRESHOLD_BYTES) {
        nextJobId = await uploadMultipart(activeVideoId, recordedBlob, contentType, onProgress);
      } else {
        const signed = await requestSignedUpload(activeVideoId, contentType);
        await uploadToSignedUrl(signed.putUrl, recordedBlob, contentType, onProgress);
        setState("processing");
        const completed = await completeUpload(activeVideoId);
        nextJobId = completed.jobId;
      }

      setState("processing");
      setJobId(nextJobId);

      upsertRecentSession({
        videoId: activeVideoId,
        jobId: nextJobId ?? undefined,
        createdAt: new Date().toISOString(),
        processingPhase: "queued",
        processingProgress: 5,
      });

      setState("complete");
      setRetryAvailable(false);
      navigate(nextJobId ? `/video/${activeVideoId}?jobId=${nextJobId}` : `/video/${activeVideoId}`);
    } catch (error) {
      setState("error");
      setRetryAvailable(true);
      setErrorMessage(
        error instanceof Error
          ? `Upload failed. Check your connection and retry without re-recording. Details: ${error.message}`
          : "Upload failed. Check your connection and retry without re-recording.",
      );
    }
  }, [recordedBlob, navigate, uploadContext]);

  const downloadRecording = useCallback(() => {
    if (!previewUrl) return;
    const a = document.createElement("a");
    a.href = previewUrl;
    a.download = `cap-recording-${new Date().toISOString().replace(/[:.]/g, "-")}.webm`;
    a.click();
  }, [previewUrl]);

  const handleExistingFileSelection = useCallback(
    (file: File | null) => {
      if (!file) return;
      if (previewUrl) URL.revokeObjectURL(previewUrl);
      const nextPreviewUrl = URL.createObjectURL(file);
      setRecordedBlob(file);
      setPreviewUrl(nextPreviewUrl);
      setSourceLabel(file.name);
      setState("preview");
      setErrorMessage(null);
      setRetryAvailable(false);
      setUploadContext(null);
    },
    [previewUrl],
  );

  const resetAll = useCallback(() => {
    cleanupRecordingResources();
    setState("idle");
    setErrorMessage(null);
    resetLocalPreview();
  }, [cleanupRecordingResources, resetLocalPreview]);

  /* ── Side-effects ────────────────────────────────────────────────────── */
  useEffect(() => { void refreshMicrophones(); }, [refreshMicrophones]);

  useEffect(() => { if (!micEnabled) setMicLevel(0); }, [micEnabled]);

  useEffect(() => {
    return () => {
      cleanupRecordingResources();
      stopCameraPreview();
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    };
  }, [cleanupRecordingResources, stopCameraPreview, previewUrl]);

  useEffect(() => {
    if (!cameraEnabled || state === "recording" || state === "stopping") {
      stopCameraPreview();
      return;
    }
    let cancelled = false;
    const startPreview = async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
        if (cancelled) { stopStream(stream); return; }
        cameraStreamRef.current = stream;
        if (cameraPreviewRef.current) cameraPreviewRef.current.srcObject = stream;
      } catch {
        if (!cancelled) {
          setErrorMessage("Camera preview unavailable. You can continue without camera preview.");
          setCameraEnabled(false);
        }
      }
    };
    void startPreview();
    return () => { cancelled = true; stopCameraPreview(); };
  }, [cameraEnabled, state, stopCameraPreview]);

  // Auto-upload screen recordings immediately after capture
  useEffect(() => {
    if (state === "preview" && recordedBlob && sourceLabel === "Screen recording" && !autoUploadTriggeredRef.current) {
      autoUploadTriggeredRef.current = true;
      void uploadAndProcess();
    }
    if (state !== "preview") autoUploadTriggeredRef.current = false;
  }, [state, recordedBlob, sourceLabel, uploadAndProcess]);

  return {
    // state
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
    recordedBlob,
    sourceLabel,
    uploadProgress,
    videoId,
    jobId,
    retryAvailable,
    micLevel,
    unsupportedReason,
    stateLabelMap,
    cameraPreviewRef,
    // actions
    startRecording,
    stopRecording,
    uploadAndProcess,
    downloadRecording,
    handleExistingFileSelection,
    resetAll,
  };
}
