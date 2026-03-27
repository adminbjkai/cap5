import { useEffect, useRef, useState, type ChangeEvent } from "react";

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

export function NotesPanel({ videoId }: { videoId: string }) {
  const storageKey = `${STORAGE_PREFIX}${videoId}`;
  const [notes, setNotes] = useState(() => loadStoredNotes(videoId));
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const saveTimer = useRef<number | null>(null);

  const handleChange = (event: ChangeEvent<HTMLTextAreaElement>) => {
    const value = event.target.value;
    setNotes(value);
    if (saveTimer.current) window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => {
      try {
        localStorage.setItem(storageKey, value);
      } catch {
        // Ignore localStorage quota and availability issues.
      }
      setSavedAt(Date.now());
    }, 600);
  };

  useEffect(() => {
    setNotes(loadStoredNotes(videoId));
    setSavedAt(null);
  }, [videoId]);

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
      {savedAt && (
        <p className="mt-1.5 text-[11px] text-muted select-none">
          Saved locally
        </p>
      )}
    </div>
  );
}
