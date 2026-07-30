import ChunkMath from "Common/Utils/Rum/ChunkMath";
import {
  MAX_SESSION_REPLAY_CHUNKS_PER_READ,
  MAX_SESSION_REPLAY_READ_BYTES,
  SessionReplayChunkManifestEntry,
  SessionReplayGap,
} from "Common/Types/Rum/SessionReplay";

/*
 * Paging, decoding, eviction and gap-aware advancement for one tab of one
 * recorded session.
 *
 * Deliberately plain TypeScript with no React and no rrweb import. Two
 * reasons, both load-bearing:
 *
 *   1. It is the piece whose failure mode is not a crash but a lie - feed
 *      rrweb events across a hole in the chunk sequence and it either throws
 *      or, far worse, rebuilds a plausible DOM the end user never saw. That
 *      has to be exhaustively unit-testable without a browser.
 *   2. rrweb's Replayer is ~450KB raw in a bundle that does not minify. Only
 *      SessionReplayPlayer.tsx may reference it, and only behind a dynamic
 *      import.
 */

/*
 * Structural stand-in for rrweb's `eventWithTime`. Declared here rather than
 * imported so this module stays rrweb-free; the player casts on the way into
 * the Replayer.
 */
export interface SessionReplayRecordedEvent {
  type: number;
  timestamp: number;
  data: unknown;
}

/*
 * Fetches the raw concatenated chunk response. Injected rather than called
 * directly so tests can drive the loader with fixtures, and so the
 * authenticated transport lives in one place (SessionReplayPlayer.tsx).
 */
export type SessionReplayChunkFetcher = (request: {
  sessionId: string;
  tabId: string;
  chunkIndexes: Array<number>;
}) => Promise<ArrayBuffer>;

/* One chunk held in the decoded LRU. */
export interface DecodedChunk {
  chunkIndex: number;
  events: Array<SessionReplayRecordedEvent>;
  /*
   * Serialised size, used as a proxy for retained heap. The decoded object
   * graph is several times this, which is exactly why the byte budget below
   * is set far under the memory we are actually willing to spend.
   */
  approximateBytes: number;
}

/* Where playback may continue after a chunk, and what it costs to get there. */
export interface NextChunkDecision {
  chunkIndex: number;
  /*
   * Non-null when the sequence was not contiguous and playback had to jump
   * to a later full snapshot. The player MUST surface this - a silent jump
   * is the failure that destroys trust in the whole feature.
   */
  skippedGap: SessionReplayGap | null;
}

export interface ChunkLoaderOptions {
  sessionId: string;
  tabId: string;
  /* Manifest rows for THIS tab only. chunkIndex is minted per tab. */
  entries: Array<SessionReplayChunkManifestEntry>;
  fetcher: SessionReplayChunkFetcher;
  maxDecodedChunks?: number | undefined;
  maxDecodedBytes?: number | undefined;
}

/*
 * A 30-minute session is roughly 120 chunks. Holding them all parsed is
 * hundreds of megabytes of heap in a tab that also runs the whole Dashboard,
 * so the decoded set is capped on both count and size and evicted LRU.
 */
const DEFAULT_MAX_DECODED_CHUNKS: number = 24;
const DEFAULT_MAX_DECODED_BYTES: number = 24 * 1024 * 1024;

/* Bytes of framing ahead of each chunk's payload: u32 index + u32 length. */
const FRAME_HEADER_BYTES: number = 8;

export default class ChunkLoader {
  private readonly sessionId: string;
  private readonly tabId: string;
  private readonly fetcher: SessionReplayChunkFetcher;
  private readonly maxDecodedChunks: number;
  private readonly maxDecodedBytes: number;

  private readonly entries: Array<SessionReplayChunkManifestEntry>;
  private readonly entryByIndex: Map<number, SessionReplayChunkManifestEntry>;
  private readonly fullSnapshotChunkIndexes: Array<number>;
  private readonly gaps: Array<SessionReplayGap>;

  /*
   * Insertion order IS the LRU order: a hit deletes and re-sets the key, so
   * the least recently used entry is always the first one Map iteration
   * yields.
   */
  private readonly decoded: Map<number, DecodedChunk>;
  private decodedBytes: number;

  /* De-duplicates concurrent requests for the same page. */
  private readonly inFlight: Map<number, Promise<Array<number>>>;

  /*
   * Bumped by dispose(). Every await re-checks it, so a response that lands
   * after the player unmounted cannot repopulate the cache or fire a
   * setState through a callback that closed over a dead component.
   */
  private generation: number;

  public constructor(options: ChunkLoaderOptions) {
    this.sessionId = options.sessionId;
    this.tabId = options.tabId;
    this.fetcher = options.fetcher;
    this.maxDecodedChunks =
      options.maxDecodedChunks ?? DEFAULT_MAX_DECODED_CHUNKS;
    this.maxDecodedBytes = options.maxDecodedBytes ?? DEFAULT_MAX_DECODED_BYTES;

    this.entries = [...options.entries].sort(
      (
        a: SessionReplayChunkManifestEntry,
        b: SessionReplayChunkManifestEntry,
      ): number => {
        return a.chunkIndex - b.chunkIndex;
      },
    );

    this.entryByIndex = new Map<number, SessionReplayChunkManifestEntry>();
    for (const entry of this.entries) {
      this.entryByIndex.set(entry.chunkIndex, entry);
    }

    this.fullSnapshotChunkIndexes = this.entries
      .filter((entry: SessionReplayChunkManifestEntry): boolean => {
        return entry.hasFullSnapshot;
      })
      .map((entry: SessionReplayChunkManifestEntry): number => {
        return entry.chunkIndex;
      });

    this.gaps = ChunkMath.detectGaps(this.entries);

    this.decoded = new Map<number, DecodedChunk>();
    this.decodedBytes = 0;
    this.inFlight = new Map<number, Promise<Array<number>>>();
    this.generation = 0;
  }

  public getEntries(): Array<SessionReplayChunkManifestEntry> {
    return this.entries;
  }

  public getGaps(): Array<SessionReplayGap> {
    return this.gaps;
  }

  public getFullSnapshotChunkIndexes(): Array<number> {
    return this.fullSnapshotChunkIndexes;
  }

  public getTabId(): string {
    return this.tabId;
  }

  /*
   * Wall-clock length of the recording, gaps included. The scrubber draws
   * against this, and labels the gaps inside it.
   */
  public getDurationMs(): number {
    const last: SessionReplayChunkManifestEntry | undefined =
      this.entries[this.entries.length - 1];

    return last ? last.chunkEndOffsetMs : 0;
  }

  /* Footage that actually exists. Always <= getDurationMs(). */
  public getCoveredDurationMs(): number {
    return ChunkMath.getCoveredDurationMs(this.entries);
  }

  /*
   * The earliest chunk playback can start from. Not necessarily chunk 0: an
   * oversized full snapshot is split across parts and only the final part
   * carries hasFullSnapshot, and a session whose opening chunks were lost
   * still plays from its first checkout.
   */
  public getFirstPlayableChunkIndex(): number | null {
    return this.fullSnapshotChunkIndexes[0] ?? null;
  }

  /*
   * The greatest seek anchor at or before a target chunk. Returns null when
   * there is none, which the caller must treat as "cannot seek there", never
   * as "start from zero" - restarting from zero after a failed seek silently
   * shows the wrong part of the session.
   */
  public getSeekAnchor(targetChunkIndex: number): number | null {
    return ChunkMath.findSeekAnchor(
      this.fullSnapshotChunkIndexes,
      targetChunkIndex,
    );
  }

  /* The chunk covering an offset, or the nearest one at or before it. */
  public getChunkIndexForOffset(offsetMs: number): number | null {
    if (this.entries.length === 0) {
      return null;
    }

    let low: number = 0;
    let high: number = this.entries.length - 1;
    let best: number | null = null;

    while (low <= high) {
      const mid: number = Math.floor((low + high) / 2);
      const candidate: SessionReplayChunkManifestEntry | undefined =
        this.entries[mid];

      if (!candidate) {
        break;
      }

      if (candidate.chunkStartOffsetMs <= offsetMs) {
        best = candidate.chunkIndex;
        low = mid + 1;
      } else {
        high = mid - 1;
      }
    }

    /*
     * An offset before the first chunk resolves to the first chunk rather
     * than null: the recording simply starts later than the requested point.
     */
    return best ?? this.entries[0]?.chunkIndex ?? null;
  }

  public getEntry(
    chunkIndex: number,
  ): SessionReplayChunkManifestEntry | undefined {
    return this.entryByIndex.get(chunkIndex);
  }

  /*
   * Where playback goes after finishing a chunk.
   *
   * If the next index is present the answer is trivially that. If it is not,
   * we are at a hole, and the ONLY safe landing point is the next full
   * snapshot - rrweb resolves mutations against node ids established by a
   * prior snapshot, so applying the chunk after a hole either throws or
   * renders a DOM that never existed. Returning the next *present* chunk
   * would be exactly that bug.
   */
  public getNextChunk(afterChunkIndex: number): NextChunkDecision | null {
    const contiguous: number = afterChunkIndex + 1;

    if (this.entryByIndex.has(contiguous)) {
      return { chunkIndex: contiguous, skippedGap: null };
    }

    const anchor: number | undefined = this.fullSnapshotChunkIndexes.find(
      (index: number): boolean => {
        return index > afterChunkIndex;
      },
    );

    if (anchor === undefined) {
      // No snapshot remains: everything after this hole is unplayable.
      return null;
    }

    const previous: SessionReplayChunkManifestEntry | undefined =
      this.entryByIndex.get(afterChunkIndex);
    const next: SessionReplayChunkManifestEntry | undefined =
      this.entryByIndex.get(anchor);

    return {
      chunkIndex: anchor,
      skippedGap: {
        fromIndex: afterChunkIndex,
        toIndex: anchor,
        missingMs:
          previous && next
            ? Math.max(0, next.chunkStartOffsetMs - previous.chunkEndOffsetMs)
            : 0,
      },
    };
  }

  /* Already-decoded events for a chunk, refreshing its LRU position. */
  public getDecodedChunk(
    chunkIndex: number,
  ): Array<SessionReplayRecordedEvent> | null {
    const hit: DecodedChunk | undefined = this.decoded.get(chunkIndex);

    if (!hit) {
      return null;
    }

    this.decoded.delete(chunkIndex);
    this.decoded.set(chunkIndex, hit);

    return hit.events;
  }

  public isChunkDecoded(chunkIndex: number): boolean {
    return this.decoded.has(chunkIndex);
  }

  public getDecodedChunkIndexes(): Array<number> {
    return [...this.decoded.keys()].sort((a: number, b: number): number => {
      return a - b;
    });
  }

  /*
   * The indexes the next fetch would ask for, capped on both count and total
   * bytes. Exposed so the player can prefetch without duplicating the
   * planning rules.
   */
  public planPage(fromChunkIndex: number): Array<number> {
    return ChunkMath.planChunkPage(
      this.entries,
      fromChunkIndex,
      MAX_SESSION_REPLAY_CHUNKS_PER_READ,
      MAX_SESSION_REPLAY_READ_BYTES,
    );
  }

  /*
   * Fetch and decode one page starting at fromChunkIndex, skipping anything
   * already resident. Returns every index now decoded for that page - which
   * on a full cache hit means no request was made at all.
   */
  public async loadPage(fromChunkIndex: number): Promise<Array<number>> {
    const planned: Array<number> = this.planPage(fromChunkIndex);

    if (planned.length === 0) {
      return [];
    }

    const missing: Array<number> = planned.filter(
      (chunkIndex: number): boolean => {
        return !this.decoded.has(chunkIndex);
      },
    );

    if (missing.length === 0) {
      return planned;
    }

    const existing: Promise<Array<number>> | undefined =
      this.inFlight.get(fromChunkIndex);

    if (existing) {
      return existing;
    }

    const generationAtStart: number = this.generation;

    const request: Promise<Array<number>> = (async (): Promise<
      Array<number>
    > => {
      const buffer: ArrayBuffer = await this.fetcher({
        sessionId: this.sessionId,
        tabId: this.tabId,
        chunkIndexes: missing,
      });

      if (generationAtStart !== this.generation) {
        // Disposed while in flight. Drop the bytes on the floor.
        return [];
      }

      for (const frame of ChunkLoader.decodeFrames(buffer)) {
        this.admit(frame.chunkIndex, frame.events, frame.approximateBytes);
      }

      return planned;
    })();

    this.inFlight.set(fromChunkIndex, request);

    try {
      return await request;
    } finally {
      this.inFlight.delete(fromChunkIndex);
    }
  }

  /* Decoded events for one chunk, fetching its page first if needed. */
  public async ensureChunk(
    chunkIndex: number,
  ): Promise<Array<SessionReplayRecordedEvent> | null> {
    const cached: Array<SessionReplayRecordedEvent> | null =
      this.getDecodedChunk(chunkIndex);

    if (cached) {
      return cached;
    }

    if (!this.entryByIndex.has(chunkIndex)) {
      return null;
    }

    await this.loadPage(chunkIndex);

    return this.getDecodedChunk(chunkIndex);
  }

  /*
   * Warm the page after the one containing chunkIndex. Failures are
   * swallowed on purpose: a prefetch is an optimisation, and surfacing its
   * error would show the viewer a failure for footage they have not asked
   * for yet. The same page is re-requested, and its error surfaced, if
   * playback actually reaches it.
   */
  public async prefetchAfter(chunkIndex: number): Promise<void> {
    const page: Array<number> = this.planPage(chunkIndex);
    const last: number | undefined = page[page.length - 1];

    if (last === undefined) {
      return;
    }

    const nextPageStart: number = last + 1;

    if (!this.entryByIndex.has(nextPageStart)) {
      return;
    }

    try {
      await this.loadPage(nextPageStart);
    } catch {
      // Intentionally ignored - see comment above.
    }
  }

  /*
   * Drop everything outside a window around the playhead. Called on seek,
   * where the LRU alone would keep the pre-seek neighbourhood resident for
   * no reason.
   */
  public evictOutsideWindow(centerChunkIndex: number, radius: number): void {
    for (const chunkIndex of [...this.decoded.keys()]) {
      if (Math.abs(chunkIndex - centerChunkIndex) > radius) {
        this.evict(chunkIndex);
      }
    }
  }

  public getDecodedBytes(): number {
    return this.decodedBytes;
  }

  /*
   * Releases every decoded chunk and invalidates in-flight requests. Idempotent.
   */
  public dispose(): void {
    this.generation += 1;
    this.decoded.clear();
    this.inFlight.clear();
    this.decodedBytes = 0;
  }

  /*
   * Parse the concatenated chunk response: repeated
   * [u32 chunkIndex][u32 payloadLength][payloadLength bytes of UTF-8 JSON].
   *
   * Big-endian, matching the server writer. Payloads are the DECOMPRESSED
   * rrweb event array as JSON text - the chunk table stores it that way
   * because base64-of-gzip inflates 33% and hands ZSTD incompressible input.
   *
   * A frame whose JSON does not parse, or that is not an array, is skipped
   * rather than thrown on: one corrupt chunk out of a hundred should cost
   * the viewer a labelled gap, not the whole recording.
   */
  public static decodeFrames(buffer: ArrayBuffer): Array<DecodedChunk> {
    const view: DataView = new DataView(buffer);
    const bytes: Uint8Array = new Uint8Array(buffer);
    const decoder: TextDecoder = new TextDecoder("utf-8");
    const frames: Array<DecodedChunk> = [];

    let offset: number = 0;

    while (offset + FRAME_HEADER_BYTES <= buffer.byteLength) {
      const chunkIndex: number = view.getUint32(offset, false);
      const length: number = view.getUint32(offset + 4, false);
      const payloadStart: number = offset + FRAME_HEADER_BYTES;
      const payloadEnd: number = payloadStart + length;

      if (payloadEnd > buffer.byteLength) {
        // Truncated response. Everything decoded so far is still valid.
        break;
      }

      const text: string = decoder.decode(
        bytes.subarray(payloadStart, payloadEnd),
      );

      let events: Array<SessionReplayRecordedEvent> | null = null;

      try {
        const parsed: unknown = JSON.parse(text);
        events = Array.isArray(parsed)
          ? (parsed as Array<SessionReplayRecordedEvent>)
          : null;
      } catch {
        events = null;
      }

      if (events) {
        frames.push({
          chunkIndex: chunkIndex,
          events: events,
          approximateBytes: length,
        });
      }

      offset = payloadEnd;
    }

    return frames;
  }

  private admit(
    chunkIndex: number,
    events: Array<SessionReplayRecordedEvent>,
    approximateBytes: number,
  ): void {
    if (this.decoded.has(chunkIndex)) {
      this.evict(chunkIndex);
    }

    this.decoded.set(chunkIndex, {
      chunkIndex: chunkIndex,
      events: events,
      approximateBytes: approximateBytes,
    });
    this.decodedBytes += approximateBytes;

    /*
     * Evict oldest-first until back under both budgets. The chunk just
     * admitted is the most recently used, so it is the last candidate and
     * survives even when it alone exceeds the byte budget - a single
     * oversized snapshot must still be playable.
     */
    while (
      this.decoded.size > 1 &&
      (this.decoded.size > this.maxDecodedChunks ||
        this.decodedBytes > this.maxDecodedBytes)
    ) {
      const oldest: number | undefined = this.decoded.keys().next().value;

      if (oldest === undefined) {
        break;
      }

      this.evict(oldest);
    }
  }

  private evict(chunkIndex: number): void {
    const entry: DecodedChunk | undefined = this.decoded.get(chunkIndex);

    if (!entry) {
      return;
    }

    this.decoded.delete(chunkIndex);
    this.decodedBytes -= entry.approximateBytes;
  }
}
