import { create } from "zustand";
import type { JobStatusResponse, VideoStatusResponse } from "../lib/api";
import type { RailTab } from "../pages/video-page/shared";

/* ── State shape ─────────────────────────────────────────────────────────── */
export interface VideoStore {
  // Core data
  status: VideoStatusResponse | null;
  jobStatus: JobStatusResponse | null;
  loading: boolean;
  errorMessage: string | null;
  consecutivePollFailures: number;
  lastUpdatedAt: string | null;

  // Player state
  playbackTimeSeconds: number;
  videoDurationSeconds: number;
  seekRequest: { seconds: number; requestId: number } | null;

  // UI feedback
  copyFeedback: string | null;

  // Title editing
  isTitleEditing: boolean;
  titleDraft: string;
  isSavingTitle: boolean;
  titleSaveMessage: string | null;

  // Retry / delete
  isRetrying: boolean;
  retryMessage: string | null;
  isDeleteDialogOpen: boolean;
  isDeleting: boolean;
  isDeleted: boolean;
  deleteError: string | null;
  isSummaryExpanded: boolean;

  // Rail tabs
  railTab: RailTab;
  renderedRailTab: RailTab;
  outgoingRailTab: RailTab | null;

  // Actions
  setStatus: (status: VideoStatusResponse | null) => void;
  setJobStatus: (jobStatus: JobStatusResponse | null) => void;
  setLoading: (loading: boolean) => void;
  setErrorMessage: (msg: string | null) => void;
  setConsecutivePollFailures: (n: number | ((prev: number) => number)) => void;
  setLastUpdatedAt: (ts: string | null) => void;
  setPlaybackTimeSeconds: (t: number) => void;
  setVideoDurationSeconds: (d: number) => void;
  setSeekRequest: (req: { seconds: number; requestId: number } | null | ((prev: { seconds: number; requestId: number } | null) => { seconds: number; requestId: number })) => void;
  setCopyFeedback: (msg: string | null) => void;
  setIsTitleEditing: (v: boolean) => void;
  setTitleDraft: (v: string) => void;
  setIsSavingTitle: (v: boolean) => void;
  setTitleSaveMessage: (msg: string | null) => void;
  setIsRetrying: (v: boolean) => void;
  setRetryMessage: (msg: string | null) => void;
  setIsDeleteDialogOpen: (v: boolean) => void;
  setIsDeleting: (v: boolean) => void;
  setIsDeleted: (v: boolean) => void;
  setDeleteError: (msg: string | null) => void;
  setIsSummaryExpanded: (v: boolean | ((prev: boolean) => boolean)) => void;
  setRailTab: (tab: RailTab) => void;
  setRenderedRailTab: (tab: RailTab) => void;
  setOutgoingRailTab: (tab: RailTab | null) => void;
}

export const useVideoStore = create<VideoStore>((set) => ({
  // Core data
  status: null,
  jobStatus: null,
  loading: false,
  errorMessage: null,
  consecutivePollFailures: 0,
  lastUpdatedAt: null,

  // Player
  playbackTimeSeconds: 0,
  videoDurationSeconds: 0,
  seekRequest: null,

  // UI feedback
  copyFeedback: null,

  // Title editing
  isTitleEditing: false,
  titleDraft: "",
  isSavingTitle: false,
  titleSaveMessage: null,

  // Retry / delete
  isRetrying: false,
  retryMessage: null,
  isDeleteDialogOpen: false,
  isDeleting: false,
  isDeleted: false,
  deleteError: null,
  isSummaryExpanded: false,

  // Rail tabs
  railTab: "transcript",
  renderedRailTab: "transcript",
  outgoingRailTab: null,

  // Actions
  setStatus: (status) => set({ status }),
  setJobStatus: (jobStatus) => set({ jobStatus }),
  setLoading: (loading) => set({ loading }),
  setErrorMessage: (errorMessage) => set({ errorMessage }),
  setConsecutivePollFailures: (n) =>
    set((s) => ({ consecutivePollFailures: typeof n === "function" ? n(s.consecutivePollFailures) : n })),
  setLastUpdatedAt: (lastUpdatedAt) => set({ lastUpdatedAt }),
  setPlaybackTimeSeconds: (playbackTimeSeconds) => set({ playbackTimeSeconds }),
  setVideoDurationSeconds: (videoDurationSeconds) => set({ videoDurationSeconds }),
  setSeekRequest: (req) =>
    set((s) => ({ seekRequest: typeof req === "function" ? req(s.seekRequest) : req })),
  setCopyFeedback: (copyFeedback) => set({ copyFeedback }),
  setIsTitleEditing: (isTitleEditing) => set({ isTitleEditing }),
  setTitleDraft: (titleDraft) => set({ titleDraft }),
  setIsSavingTitle: (isSavingTitle) => set({ isSavingTitle }),
  setTitleSaveMessage: (titleSaveMessage) => set({ titleSaveMessage }),
  setIsRetrying: (isRetrying) => set({ isRetrying }),
  setRetryMessage: (retryMessage) => set({ retryMessage }),
  setIsDeleteDialogOpen: (isDeleteDialogOpen) => set({ isDeleteDialogOpen }),
  setIsDeleting: (isDeleting) => set({ isDeleting }),
  setIsDeleted: (isDeleted) => set({ isDeleted }),
  setDeleteError: (deleteError) => set({ deleteError }),
  setIsSummaryExpanded: (v) =>
    set((s) => ({ isSummaryExpanded: typeof v === "function" ? v(s.isSummaryExpanded) : v })),
  setRailTab: (railTab) => set({ railTab }),
  setRenderedRailTab: (renderedRailTab) => set({ renderedRailTab }),
  setOutgoingRailTab: (outgoingRailTab) => set({ outgoingRailTab }),
}));

/* ── Typed selectors ─────────────────────────────────────────────────────── */
export const selectStatus = (s: VideoStore) => s.status;
export const selectLoading = (s: VideoStore) => s.loading;
export const selectRailTab = (s: VideoStore) => s.railTab;
export const selectPlaybackTimeSeconds = (s: VideoStore) => s.playbackTimeSeconds;
export const selectSeekRequest = (s: VideoStore) => s.seekRequest;
export const selectIsSummaryExpanded = (s: VideoStore) => s.isSummaryExpanded;
export const selectIsDeleteDialogOpen = (s: VideoStore) => s.isDeleteDialogOpen;
export const selectTitleDraft = (s: VideoStore) => s.titleDraft;
export const selectIsTitleEditing = (s: VideoStore) => s.isTitleEditing;
