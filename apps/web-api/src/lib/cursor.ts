/**
 * Cursor encoding/decoding for pagination.
 */

export function normalizeCursorTimestamp(value: string | Date): string | null {
  if (value instanceof Date) {
    return Number.isFinite(value.getTime()) ? value.toISOString() : null;
  }

  if (typeof value !== "string") return null;
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) return null;
  return new Date(parsed).toISOString();
}

export function encodeLibraryCursor(createdAtIso: string, id: string): string {
  return Buffer.from(`${createdAtIso}|${id}`, "utf8").toString("base64url");
}

export function decodeLibraryCursor(cursor: string): { createdAtIso: string; id: string } | null {
  try {
    const decoded = Buffer.from(cursor, "base64url").toString("utf8");
    const [createdAtIso, id] = decoded.split("|");
    if (!createdAtIso || !id) return null;
    const parsedDate = Date.parse(createdAtIso);
    if (!Number.isFinite(parsedDate)) return null;
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)) return null;
    return { createdAtIso, id };
  } catch {
    return null;
  }
}
