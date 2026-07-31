import { SessionReplayChunkManifestEntry } from "../../../Types/Rum/SessionReplay";
import ChunkMath from "../../../Utils/Rum/ChunkMath";

type EntryOverrides = Partial<SessionReplayChunkManifestEntry>;

const makeEntry: (
  chunkIndex: number,
  overrides?: EntryOverrides,
) => SessionReplayChunkManifestEntry = (
  chunkIndex: number,
  overrides?: EntryOverrides,
): SessionReplayChunkManifestEntry => {
  return {
    chunkIndex: chunkIndex,
    tabId: "tab-1",
    chunkStartOffsetMs: chunkIndex * 15000,
    chunkEndOffsetMs: chunkIndex * 15000 + 15000,
    eventCount: 100,
    hasFullSnapshot: chunkIndex === 0,
    payloadBytes: 7000,
    ...overrides,
  };
};

describe("ChunkMath", () => {
  describe("findSeekAnchor", () => {
    it("returns the greatest anchor at or before the target", () => {
      expect(ChunkMath.findSeekAnchor([0, 4, 8, 12], 10)).toBe(8);
      expect(ChunkMath.findSeekAnchor([0, 4, 8, 12], 8)).toBe(8);
      expect(ChunkMath.findSeekAnchor([0, 4, 8, 12], 7)).toBe(4);
    });

    it("returns null when no anchor precedes the target", () => {
      /*
       * The caller must treat this as "cannot seek there", NOT as "start
       * from zero". rrweb resolves mutations against node ids from a
       * prior snapshot, so replaying without an anchor renders a
       * plausible DOM the user never saw.
       */
      expect(ChunkMath.findSeekAnchor([4, 8], 2)).toBeNull();
    });

    it("returns null for an empty anchor list", () => {
      expect(ChunkMath.findSeekAnchor([], 5)).toBeNull();
    });

    it("handles unsorted anchor lists, as returned by groupArray()", () => {
      expect(ChunkMath.findSeekAnchor([12, 0, 8, 4], 10)).toBe(8);
    });

    it("handles a single anchor", () => {
      expect(ChunkMath.findSeekAnchor([0], 0)).toBe(0);
      expect(ChunkMath.findSeekAnchor([0], 99)).toBe(0);
      expect(ChunkMath.findSeekAnchor([5], 0)).toBeNull();
    });

    it("agrees with a linear scan across many random cases", () => {
      /*
       * The binary search is the kind of code that is subtly wrong at the
       * boundaries and still passes hand-written cases, so it is checked
       * against an obviously-correct implementation.
       */
      for (let trial: number = 0; trial < 500; trial++) {
        const anchors: Array<number> = [];

        for (let i: number = 0; i < 20; i++) {
          if ((trial + i) % 3 === 0) {
            anchors.push(i);
          }
        }

        for (let target: number = 0; target < 20; target++) {
          const expected: number | null = anchors
            .filter((a: number): boolean => {
              return a <= target;
            })
            .reduce((max: number | null, a: number): number | null => {
              return max === null || a > max ? a : max;
            }, null);

          expect(ChunkMath.findSeekAnchor(anchors, target)).toBe(expected);
        }
      }
    });
  });

  describe("detectGaps", () => {
    it("reports no gaps for a contiguous sequence", () => {
      const entries: Array<SessionReplayChunkManifestEntry> = [0, 1, 2, 3].map(
        (i: number): SessionReplayChunkManifestEntry => {
          return makeEntry(i);
        },
      );

      expect(ChunkMath.detectGaps(entries)).toEqual([]);
    });

    it("reports a gap with the wall-clock time the viewer will not see", () => {
      const entries: Array<SessionReplayChunkManifestEntry> = [
        makeEntry(0),
        makeEntry(3),
      ];

      const gaps: ReturnType<typeof ChunkMath.detectGaps> =
        ChunkMath.detectGaps(entries);

      expect(gaps).toHaveLength(1);
      expect(gaps[0]?.fromIndex).toBe(0);
      expect(gaps[0]?.toIndex).toBe(3);
      /* chunk 0 ends at 15000ms, chunk 3 starts at 45000ms. */
      expect(gaps[0]?.missingMs).toBe(30000);
    });

    it("reports multiple gaps", () => {
      const entries: Array<SessionReplayChunkManifestEntry> = [
        makeEntry(0),
        makeEntry(2),
        makeEntry(5),
      ];

      expect(ChunkMath.detectGaps(entries)).toHaveLength(2);
    });

    it("handles out-of-order input", () => {
      const entries: Array<SessionReplayChunkManifestEntry> = [
        makeEntry(3),
        makeEntry(0),
      ];

      const gaps: ReturnType<typeof ChunkMath.detectGaps> =
        ChunkMath.detectGaps(entries);

      expect(gaps).toHaveLength(1);
      expect(gaps[0]?.fromIndex).toBe(0);
    });

    it("returns no gaps for zero or one entry", () => {
      expect(ChunkMath.detectGaps([])).toEqual([]);
      expect(ChunkMath.detectGaps([makeEntry(7)])).toEqual([]);
    });

    it("never reports a negative missing duration for overlapping offsets", () => {
      const entries: Array<SessionReplayChunkManifestEntry> = [
        makeEntry(0, { chunkEndOffsetMs: 60000 }),
        makeEntry(3, { chunkStartOffsetMs: 45000 }),
      ];

      expect(ChunkMath.detectGaps(entries)[0]?.missingMs).toBe(0);
    });
  });

  describe("findMissingChunkIndexes", () => {
    it("finds the set difference against a contiguous run", () => {
      expect(ChunkMath.findMissingChunkIndexes([0, 1, 3, 5], 5)).toEqual([
        2, 4,
      ]);
    });

    it("returns nothing when the run is complete", () => {
      expect(ChunkMath.findMissingChunkIndexes([0, 1, 2], 2)).toEqual([]);
    });

    it("is unaffected by duplicate deliveries", () => {
      /*
       * At-least-once delivery means the same chunk can arrive twice. A
       * counter-based implementation would drift; a set difference cannot.
       */
      expect(ChunkMath.findMissingChunkIndexes([0, 0, 1, 1, 1, 3], 3)).toEqual([
        2,
      ]);
    });

    it("reports everything missing when nothing arrived", () => {
      expect(ChunkMath.findMissingChunkIndexes([], 2)).toEqual([0, 1, 2]);
    });
  });

  describe("planChunkPage", () => {
    it("respects the chunk count cap", () => {
      const entries: Array<SessionReplayChunkManifestEntry> = Array.from(
        { length: 20 },
        (_unused: unknown, i: number): SessionReplayChunkManifestEntry => {
          return makeEntry(i);
        },
      );

      expect(ChunkMath.planChunkPage(entries, 0, 8, 8 * 1024 * 1024)).toEqual([
        0, 1, 2, 3, 4, 5, 6, 7,
      ]);
    });

    it("respects the byte cap even when under the count cap", () => {
      const entries: Array<SessionReplayChunkManifestEntry> = Array.from(
        { length: 8 },
        (_unused: unknown, i: number): SessionReplayChunkManifestEntry => {
          return makeEntry(i, { payloadBytes: 3 * 1024 * 1024 });
        },
      );

      const page: Array<number> = ChunkMath.planChunkPage(
        entries,
        0,
        8,
        8 * 1024 * 1024,
      );

      /*
       * Two 3MB chunks fit under the 8MB cap; a third would exceed it, so
       * the page closes at two even though the count cap allows eight.
       */
      expect(page).toEqual([0, 1]);
    });

    it("always returns at least one chunk so an oversized chunk cannot deadlock the player", () => {
      /*
       * If a single chunk exceeds the byte cap, returning an empty page
       * would stall playback forever. One oversized chunk is served
       * instead.
       */
      const entries: Array<SessionReplayChunkManifestEntry> = [
        makeEntry(0, { payloadBytes: 50 * 1024 * 1024 }),
      ];

      expect(ChunkMath.planChunkPage(entries, 0, 8, 1024)).toEqual([0]);
    });

    it("starts from the requested index", () => {
      const entries: Array<SessionReplayChunkManifestEntry> = Array.from(
        { length: 10 },
        (_unused: unknown, i: number): SessionReplayChunkManifestEntry => {
          return makeEntry(i);
        },
      );

      expect(ChunkMath.planChunkPage(entries, 6, 2, 8 * 1024 * 1024)).toEqual([
        6, 7,
      ]);
    });

    it("returns an empty page when nothing remains", () => {
      expect(ChunkMath.planChunkPage([makeEntry(0)], 5, 8, 1024)).toEqual([]);
    });

    it("skips over gaps rather than stopping at them", () => {
      const entries: Array<SessionReplayChunkManifestEntry> = [
        makeEntry(0),
        makeEntry(1),
        makeEntry(9),
      ];

      expect(ChunkMath.planChunkPage(entries, 0, 8, 8 * 1024 * 1024)).toEqual([
        0, 1, 9,
      ]);
    });
  });

  describe("getCoveredDurationMs", () => {
    it("sums the covered spans, excluding gaps", () => {
      const entries: Array<SessionReplayChunkManifestEntry> = [
        makeEntry(0),
        makeEntry(3),
      ];

      /* Two 15s chunks, despite spanning 60s of wall clock. */
      expect(ChunkMath.getCoveredDurationMs(entries)).toBe(30000);
    });

    it("returns zero for no entries", () => {
      expect(ChunkMath.getCoveredDurationMs([])).toBe(0);
    });

    it("ignores negative spans from malformed offsets", () => {
      const entries: Array<SessionReplayChunkManifestEntry> = [
        makeEntry(0, { chunkStartOffsetMs: 5000, chunkEndOffsetMs: 1000 }),
      ];

      expect(ChunkMath.getCoveredDurationMs(entries)).toBe(0);
    });
  });
});
