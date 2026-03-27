import { beforeAll, describe, expect, it } from "vitest";

type SharedModule = typeof import("./shared.js");

let shared: SharedModule;

beforeAll(async () => {
  shared = await import("./shared.js");
});

describe("normalizeCursorTimestamp", () => {
  it("normalizes Date values to ISO strings for cursor encoding", () => {
    const value = new Date("2026-03-23T17:28:08.000Z");

    expect(shared.normalizeCursorTimestamp(value)).toBe("2026-03-23T17:28:08.000Z");
  });

  it("normalizes parseable strings to ISO strings", () => {
    expect(shared.normalizeCursorTimestamp("Mon Mar 23 2026 13:28:08 GMT-0400 (Eastern Daylight Time)")).toBe(
      "2026-03-23T17:28:08.000Z"
    );
  });

  it("returns null for invalid timestamps", () => {
    expect(shared.normalizeCursorTimestamp("not-a-date")).toBeNull();
  });
});

describe("library cursor helpers", () => {
  it("round-trips normalized cursor timestamps", () => {
    const createdAtIso = "2026-03-23T17:28:08.000Z";
    const id = "550e8400-e29b-41d4-a716-446655440000";

    const cursor = shared.encodeLibraryCursor(createdAtIso, id);

    expect(shared.decodeLibraryCursor(cursor)).toEqual({ createdAtIso, id });
  });
});

describe("structuredChaptersFromJson", () => {
  it("extracts ordered chapter timings from stored AI chapter rows", () => {
    expect(
      shared.structuredChaptersFromJson([
        { point: "Second section", startSeconds: 42 },
        { title: "Intro", start: 5, sentiment: "positive" }
      ])
    ).toEqual([
      { title: "Intro", seconds: 5, sentiment: "positive" },
      { title: "Second section", seconds: 42 }
    ]);
  });
});
