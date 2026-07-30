import {
  SessionReplayChunkManifestEntry,
  SessionReplayGap,
} from "../../Types/Rum/SessionReplay";

/*
 * Pure chunk-sequence arithmetic shared by the ingest finalizer and the
 * Dashboard player: seek-anchor selection, gap detection, and paging
 * windows.
 *
 * Kept free of any I/O so it can be exhaustively unit-tested, which
 * matters because the failure mode of getting this wrong is not a crash
 * — it is a player that renders a plausible DOM the user never saw.
 */

export default class ChunkMath {
  /*
   * The greatest full-snapshot chunk index at or before the target.
   *
   * Seeking cannot simply jump to the target chunk: rrweb resolves
   * mutations against node ids established by a prior snapshot, so
   * playback must restart from a snapshot boundary. Returns null when no
   * anchor exists at or before the target, which the caller must treat as
   * "cannot seek there" rather than "start from zero".
   *
   * anchors need not be sorted; they are copied and sorted here so
   * callers can pass a raw groupArray() result straight from ClickHouse.
   */
  public static findSeekAnchor(
    anchors: Array<number>,
    targetChunkIndex: number,
  ): number | null {
    if (anchors.length === 0) {
      return null;
    }

    const sorted: Array<number> = [...anchors].sort(
      (a: number, b: number): number => {
        return a - b;
      },
    );

    let low: number = 0;
    let high: number = sorted.length - 1;
    let best: number | null = null;

    while (low <= high) {
      const mid: number = Math.floor((low + high) / 2);
      const candidate: number | undefined = sorted[mid];

      if (candidate === undefined) {
        break;
      }

      if (candidate <= targetChunkIndex) {
        best = candidate;
        low = mid + 1;
      } else {
        high = mid - 1;
      }
    }

    return best;
  }

  /*
   * Holes in the chunk sequence for a single tab.
   *
   * A gap means chunks were lost — the browser was closed mid-flush, a
   * request 413'd, the byte budget cut in. Playback must jump forward to
   * the next full snapshot rather than applying mutations across the
   * hole, and the scrubber must draw the gap. Silently interpolating is
   * the failure that destroys trust in the whole feature.
   *
   * missingMs is measured from the end of the chunk before the gap to the
   * start of the chunk after it, so it reflects wall-clock time the
   * viewer will not see.
   */
  public static detectGaps(
    entries: Array<SessionReplayChunkManifestEntry>,
  ): Array<SessionReplayGap> {
    if (entries.length < 2) {
      return [];
    }

    const sorted: Array<SessionReplayChunkManifestEntry> = [...entries].sort(
      (
        a: SessionReplayChunkManifestEntry,
        b: SessionReplayChunkManifestEntry,
      ): number => {
        return a.chunkIndex - b.chunkIndex;
      },
    );

    const gaps: Array<SessionReplayGap> = [];

    for (let i: number = 1; i < sorted.length; i++) {
      const previous: SessionReplayChunkManifestEntry | undefined =
        sorted[i - 1];
      const current: SessionReplayChunkManifestEntry | undefined = sorted[i];

      if (!previous || !current) {
        continue;
      }

      if (current.chunkIndex === previous.chunkIndex + 1) {
        continue;
      }

      gaps.push({
        fromIndex: previous.chunkIndex,
        toIndex: current.chunkIndex,
        missingMs: Math.max(
          0,
          current.chunkStartOffsetMs - previous.chunkEndOffsetMs,
        ),
      });
    }

    return gaps;
  }

  /*
   * Chunk indexes missing from a contiguous 0..maxChunkIndex run.
   *
   * Used by the finalizer to record missingChunkCount without holding the
   * whole index list. Derived from the set difference rather than from a
   * counter, so a duplicate delivery cannot make it drift.
   */
  public static findMissingChunkIndexes(
    presentIndexes: Array<number>,
    maxChunkIndex: number,
  ): Array<number> {
    const present: Set<number> = new Set(presentIndexes);
    const missing: Array<number> = [];

    for (let i: number = 0; i <= maxChunkIndex; i++) {
      if (!present.has(i)) {
        missing.push(i);
      }
    }

    return missing;
  }

  /*
   * The next window of chunk indexes to fetch, bounded by both a count
   * cap and the total byte cap.
   *
   * Both caps are needed: a page of 8 tiny chunks is cheap, but 8 chunks
   * each holding a large full snapshot would be tens of megabytes in one
   * response. Always returns at least one index when any candidate
   * remains, so an oversized single chunk still loads rather than
   * deadlocking the player at a zero-length page.
   */
  public static planChunkPage(
    entries: Array<SessionReplayChunkManifestEntry>,
    fromChunkIndex: number,
    maxChunks: number,
    maxBytes: number,
  ): Array<number> {
    const candidates: Array<SessionReplayChunkManifestEntry> = entries
      .filter((entry: SessionReplayChunkManifestEntry): boolean => {
        return entry.chunkIndex >= fromChunkIndex;
      })
      .sort(
        (
          a: SessionReplayChunkManifestEntry,
          b: SessionReplayChunkManifestEntry,
        ): number => {
          return a.chunkIndex - b.chunkIndex;
        },
      );

    const page: Array<number> = [];
    let bytes: number = 0;

    for (const entry of candidates) {
      if (page.length >= maxChunks) {
        break;
      }

      if (page.length > 0 && bytes + entry.payloadBytes > maxBytes) {
        break;
      }

      page.push(entry.chunkIndex);
      bytes += entry.payloadBytes;
    }

    return page;
  }

  /*
   * Total duration a session actually covers, excluding gaps. Used to
   * label the player honestly when chunks were lost: a 5-minute session
   * missing 90 seconds should not present itself as 5 minutes of footage.
   */
  public static getCoveredDurationMs(
    entries: Array<SessionReplayChunkManifestEntry>,
  ): number {
    return entries.reduce(
      (total: number, entry: SessionReplayChunkManifestEntry): number => {
        return (
          total + Math.max(0, entry.chunkEndOffsetMs - entry.chunkStartOffsetMs)
        );
      },
      0,
    );
  }
}
