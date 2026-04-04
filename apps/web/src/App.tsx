import { useEffect, useMemo, useState } from "react";
import { useEventBusEmit } from "./lib/eventBus";
import { Navigate, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import { AppShell } from "./components/AppShell";
import { CommandPalette, type CommandPaletteAction } from "./components/CommandPalette";
import { ShortcutsOverlay } from "./components/ShortcutsOverlay";
import { useKeyboardShortcuts } from "./hooks/useKeyboardShortcuts";
import { getLibraryVideos, type LibraryVideoCard } from "./lib/api";
import { AuthProvider, useAuth } from "./lib/auth-context";
import { HomePage } from "./pages/HomePage";
import { RecordPage } from "./pages/RecordPage";
import { VideoPage } from "./pages/VideoPage";
import { LoginPage } from "./pages/LoginPage";
import { Spinner } from "./components/ui/Spinner";

function AppContent() {
  const navigate = useNavigate();
  const location = useLocation();
  const emitEvent = useEventBusEmit();
  const auth = useAuth();
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [paletteVideos, setPaletteVideos] = useState<LibraryVideoCard[]>([]);

  useEffect(() => {
    if (!paletteOpen || !auth.authenticated) return;
    void (async () => {
      try {
        const response = await getLibraryVideos({ limit: 100, sort: "created_desc" });
        setPaletteVideos(response.items);
      } catch {
        setPaletteVideos([]);
      }
    })();
  }, [paletteOpen, auth.authenticated]);

  const commandActions = useMemo<CommandPaletteAction[]>(() => {
    const baseActions: CommandPaletteAction[] = [
      {
        id: "go-home",
        title: "Go to Home",
        subtitle: "Open your video library",
        keywords: ["home", "library", "dashboard"],
        onSelect: () => navigate("/"),
      },
      {
        id: "go-record",
        title: "Go to Record",
        subtitle: "Start or upload a recording",
        keywords: ["record", "upload", "new"],
        onSelect: () => navigate("/record"),
      },
      {
        id: "upload",
        title: "Upload New Video",
        subtitle: "Open the record/upload page",
        keywords: ["upload", "new video", "import"],
        onSelect: () => navigate("/record"),
      },
      {
        id: "delete-current",
        title: "Delete Current Video",
        subtitle: "Open delete confirmation on the active video page",
        keywords: ["delete", "remove", "video"],
        onSelect: () => emitEvent("cap5:request-delete-active-video", undefined),
      },
    ];

    const videoActions = paletteVideos.slice(0, 40).map<CommandPaletteAction>((video) => ({
      id: `open-video-${video.videoId}`,
      title: video.displayTitle || "Untitled recording",
      subtitle: "Open video",
      keywords: ["video", "open", video.videoId],
      onSelect: () => navigate(`/video/${video.videoId}`),
    }));

    return [...baseActions, ...videoActions];
  }, [navigate, paletteVideos, emitEvent]);

  useKeyboardShortcuts({
    onToggleCommandPalette: () => {
      setPaletteOpen((open) => !open);
      setShortcutsOpen(false);
    },
    onToggleShortcutsOverlay: () => {
      setShortcutsOpen((open) => !open);
      setPaletteOpen(false);
    },
    onEscape: () => {
      if (paletteOpen) {
        setPaletteOpen(false);
        return;
      }
      if (shortcutsOpen) {
        setShortcutsOpen(false);
        return;
      }
      emitEvent("cap5:escape", undefined);
    },
    onGoHome: () => navigate("/"),
    onGoRecord: () => navigate("/record"),
  });

  useEffect(() => {
    setPaletteOpen(false);
    setShortcutsOpen(false);
  }, [location.pathname]);

  // Show loading spinner while checking auth
  if (!auth.checked) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-app">
        <Spinner size="lg" />
      </div>
    );
  }

  // Show login page if not authenticated
  if (!auth.authenticated) {
    return <LoginPage />;
  }

  return (
    <AppShell
      overlays={
        <>
          <CommandPalette open={paletteOpen} actions={commandActions} onClose={() => setPaletteOpen(false)} />
          <ShortcutsOverlay open={shortcutsOpen} onClose={() => setShortcutsOpen(false)} />
        </>
      }
    >
      <Routes>
        <Route path="/" element={<HomePage />} />
        <Route path="/record" element={<RecordPage />} />
        <Route path="/video/:videoId" element={<VideoPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </AppShell>
  );
}

export function App() {
  return (
    <AuthProvider>
      <AppContent />
    </AuthProvider>
  );
}
