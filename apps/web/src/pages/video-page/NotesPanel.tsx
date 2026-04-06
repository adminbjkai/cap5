import { useEffect, useRef, useState, type ChangeEvent } from "react";

type NotesPanelProps = {
  videoId: string;
  initialNotes: string;
  onSave: (notes: string) => Promise<boolean>;
};

const STORAGE_PREFIX = "cap5:notes:";
const LEGACY_STORAGE_PREFIX = "cap4:notes:";

function loadStoredNotes(videoId: string): string {
  const storageKey = `${STORAGE_PREFIX}${videoId}`;
  const legacyStorageKey = `${LEGACY_STORAGE_PREFIX}${videoId}`;

  try {
    const stored = localStorage.getItem(storageKey);
    if (stored !== null) return stored;

    const legacyStored = localStorage.getItem(legacyStorageKey);
    if (legacyStored === null) return "";

    localStorage.setItem(storageKey, legacyStored);
    return legacyStored;
  } catch {
    return "";
  }
}

export function NotesPanel({ videoId, initialNotes, onSave }: NotesPanelProps) {
  const storageKey = `${STORAGE_PREFIX}${videoId}`;
  const [notes, setNotes] = useState(initialNotes || loadStoredNotes(videoId));
  const [saveMessage, setSaveMessage] = useState<string | null>(null);
  const saveTimer = useRef<number | null>(null);
  const latestRequestId = useRef(0);

  const persistLocal = (value: string) => {
    try {
      localStorage.setItem(storageKey, value);
    } catch {
      // Ignore localStorage quota and availability issues.
    }
  };

  const scheduleSave = (value: string) => {
    if (saveTimer.current) window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(async () => {
      const requestId = ++latestRequestId.current;
      persistLocal(value);
      const ok = await onSave(value);
      if (requestId !== latestRequestId.current) return;
      setSaveMessage(ok ? "Saved to app" : "Local fallback only");
      window.setTimeout(() => setSaveMessage(null), 1500);
    }, 700);
  };

  const handleChange = (event: ChangeEvent<HTMLTextAreaElement>) => {
    const value = event.target.value;
    setNotes(value);
    scheduleSave(value);
  };

  useEffect(() => {
    const localNotes = loadStoredNotes(videoId);
    const nextNotes = initialNotes || localNotes;
    setNotes(nextNotes);
    setSaveMessage(null);

    if (!initialNotes && localNotes) {
      void onSave(localNotes);
    } else if (initialNotes) {
      persistLocal(initialNotes);
    }
  }, [videoId, initialNotes]);

  useEffect(() => () => {
    if (saveTimer.current) window.clearTimeout(saveTimer.current);
  }, []);

  return (
    <div className="flex h-full flex-col px-3 py-3">
      <textarea
        value={notes}
        onChange={handleChange}
        placeholder="Your private notes about this video…"
        className="notes-textarea flex-1 min-h-0"
        style={{ minHeight: "200px" }}
        spellCheck
      />
      {saveMessage && (
        <p className="mt-1.5 text-[11px] text-muted select-none">
          {saveMessage}
        </p>
      )}
    </div>
  );
}
