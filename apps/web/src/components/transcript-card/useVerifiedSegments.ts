import { useEffect, useMemo, useState } from "react";

const STORAGE_PREFIX = "cap5:verified-segments:";
const LEGACY_STORAGE_PREFIX = "cap4:verified-segments:";

function readStoredSegmentSet(storageKey: string, legacyStorageKey: string): Set<number> {
  try {
    const stored = localStorage.getItem(storageKey);
    if (stored) return new Set(JSON.parse(stored) as number[]);

    const legacyStored = localStorage.getItem(legacyStorageKey);
    if (!legacyStored) return new Set();

    localStorage.setItem(storageKey, legacyStored);
    return new Set(JSON.parse(legacyStored) as number[]);
  } catch {
    return new Set();
  }
}

export function useVerifiedSegments(videoId: string | undefined) {
  const storageKey = useMemo(
    () => `${STORAGE_PREFIX}${videoId ?? "unknown"}`,
    [videoId]
  );
  const legacyStorageKey = useMemo(
    () => `${LEGACY_STORAGE_PREFIX}${videoId ?? "unknown"}`,
    [videoId]
  );

  const [verifiedSegments, setVerifiedSegments] = useState<Set<number>>(() => {
    return readStoredSegmentSet(storageKey, legacyStorageKey);
  });

  useEffect(() => {
    setVerifiedSegments(readStoredSegmentSet(storageKey, legacyStorageKey));
  }, [legacyStorageKey, storageKey]);

  useEffect(() => {
    if (verifiedSegments.size === 0) {
      try {
        localStorage.removeItem(storageKey);
      } catch {
        /* ignore */
      }
      return;
    }

    try {
      localStorage.setItem(storageKey, JSON.stringify(Array.from(verifiedSegments)));
    } catch {
      /* quota exceeded */
    }
  }, [storageKey, verifiedSegments]);

  return { verifiedSegments, setVerifiedSegments };
}
