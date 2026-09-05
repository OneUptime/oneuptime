import ChunkMath from "Common/Utils/Rum/ChunkMath";
import {
  MAX_SESSION_REPLAY_CHUNKS_PER_READ,
  MAX_SESSION_REPLAY_READ_BYTES,
  SESSION_REPLAY_IDLE_THRESHOLD_MS,
  SessionReplayChunkManifestEntry,
  SessionReplayGap,
} from "Common/Types/Rum/SessionReplay";
import {
  SESSION_REPLAY_RRWEB_CUSTOM_EVENT_TYPE,
  SessionReplayCustomEventTag,
  SessionReplayErrorKind,
  SessionReplayFrustrationKind,
  SessionReplayPerformanceBudgetKind,
  SessionReplayRouteKind,
  SessionReplayVisibilityState,
  isSessionReplayClickDroppedPayload,
  isSessionReplayClickPayload,
  isSessionReplayCustomDroppedPayload,
  isSessionReplayCustomPayload,
  isSessionReplayIdentifyPayload,
  isSessionReplayPerformanceBudgetPayload,
  isSessionReplayTagsPayload,
  isSessionReplayVisibilityPayload,
  isSessionReplayWebVitalPayload,
} from "Common/Types/Rum/SessionReplayCustomEvents";
import {
  REPLAY_TIMELINE_EXTRACTION_CAPS,
  ReplayActivityInterval,
  ReplayTimelineEvent,
  ReplayTimelineEventKind,
  ReplayTimelineExtractionStats,
  makeEmptyExtractionStats,
} from "./ReplayTimelineTypes";
import { makeRecordingSignalId } from "./Rail/ReplaySignalTypes";

/*
 * Paging, decoding, eviction and gap-aware advancement for one tab of one
 * recorded session, plus the signal extraction that turns the rrweb stream
 * into rail rows and activity bands.
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
 * The timeline row types now live in ReplayTimelineTypes.ts; re-exported so
 * older importers keep compiling for one release.
 */
export type { ReplayTimelineEvent, ReplayTimelineEventKind };

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
 *
 * `signal` is the loader's abort signal: it fires on dispose and on the
 * fetch timeout. A transport that ignores it still works - the loader
 * races the promise against the signal itself - but one that forwards it
 * to fetch() frees the connection too.
 */
export interface SessionReplayChunkFetchRequest {
  sessionId: string;
  tabId: string;
  chunkIndexes: Array<number>;
  signal?: AbortSignal;
}

export type SessionReplayChunkFetcher = (
  request: SessionReplayChunkFetchRequest,
) => Promise<ArrayBuffer>;

/*
 * rrweb's event type and incremental-source numbering, as rrweb 2.1.1
 * defines them. Named here (not imported) so this module stays rrweb-free;
 * the values are pinned by the loader tests against the recorder's fixtures.
 */
export const RRWEB_EVENT_TYPE_FULL_SNAPSHOT: number = 2;
export const RRWEB_EVENT_TYPE_INCREMENTAL: number = 3;
export const RRWEB_EVENT_TYPE_META: number = 4;

export const RRWEB_SOURCE_MOUSE_MOVE: number = 1;
export const RRWEB_SOURCE_MOUSE_INTERACTION: number = 2;
export const RRWEB_SOURCE_SCROLL: number = 3;
export const RRWEB_SOURCE_INPUT: number = 5;
export const RRWEB_SOURCE_TOUCH_MOVE: number = 6;
export const RRWEB_SOURCE_DRAG: number = 12;

export const RRWEB_MOUSE_INTERACTION_CLICK: number = 2;
export const RRWEB_MOUSE_INTERACTION_DBL_CLICK: number = 4;
export const RRWEB_MOUSE_INTERACTION_TOUCH_START: number = 7;

/*
 * Incremental sources that mean the user was doing something. Mutations
 * are excluded on purpose: a page animating on its own is not activity,
 * and counting it would hide every idle stretch on a page with a spinner.
 */
const ACTIVITY_SOURCES: ReadonlySet<number> = new Set<number>([
  RRWEB_SOURCE_MOUSE_MOVE,
  RRWEB_SOURCE_MOUSE_INTERACTION,
  RRWEB_SOURCE_SCROLL,
  RRWEB_SOURCE_INPUT,
  RRWEB_SOURCE_TOUCH_MOVE,
  RRWEB_SOURCE_DRAG,
]);

const FALLBACK_CLICK_INTERACTIONS: ReadonlySet<number> = new Set<number>([
  RRWEB_MOUSE_INTERACTION_CLICK,
  RRWEB_MOUSE_INTERACTION_DBL_CLICK,
  RRWEB_MOUSE_INTERACTION_TOUCH_START,
]);

/* Custom tags that count as user activity for the idle map. */
const ACTIVITY_KINDS: ReadonlySet<ReplayTimelineEventKind> =
  new Set<ReplayTimelineEventKind>(["route", "click", "frustration"]);

const TAG_TO_KIND: Record<string, ReplayTimelineEventKind> = {
  [SessionReplayCustomEventTag.Console]: "console",
  [SessionReplayCustomEventTag.Network]: "network",
  [SessionReplayCustomEventTag.Route]: "route",
  [SessionReplayCustomEventTag.Error]: "error",
  [SessionReplayCustomEventTag.Frustration]: "frustration",
  [SessionReplayCustomEventTag.Performance]: "performance",
  [SessionReplayCustomEventTag.Click]: "click",
  [SessionReplayCustomEventTag.ClickDropped]: "click-dropped",
  [SessionReplayCustomEventTag.Visibility]: "visibility",
  [SessionReplayCustomEventTag.Custom]: "custom",
  [SessionReplayCustomEventTag.CustomDropped]: "custom-dropped",
  [SessionReplayCustomEventTag.Identify]: "identify",
  [SessionReplayCustomEventTag.Tags]: "tags",
};

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

/* What one chunk's decode yields for the rail and the idle map. */
export interface ChunkExtraction {
  events: Array<ReplayTimelineEvent>;
  activityIntervals: Array<ReplayActivityInterval>;
}

/*
 * Thrown by loadPage/ensureChunk once every retry is spent. Carries what
 * the engine needs to say something specific: which chunks, how many
 * tries, and whether it was the viewer leaving (aborted) rather than the
 * network failing.
 */
export class ChunkLoadError extends Error {
  public readonly chunkIndexes: Array<number>;
  public readonly attempts: number;
  public readonly isAborted: boolean;
  public readonly isTimeout: boolean;

  public constructor(options: {
    message: string;
    chunkIndexes: Array<number>;
    attempts: number;
    isAborted: boolean;
    isTimeout: boolean;
  }) {
    super(options.message);
    this.name = "ChunkLoadError";
    this.chunkIndexes = options.chunkIndexes;
    this.attempts = options.attempts;
    this.isAborted = options.isAborted;
    this.isTimeout = options.isTimeout;
  }
}

export interface ChunkLoaderOptions {
  sessionId: string;
  tabId: string;
  /* Manifest rows for THIS tab only. chunkIndex is minted per tab. */
  entries: Array<SessionReplayChunkManifestEntry>;
  fetcher: SessionReplayChunkFetcher;
  maxDecodedChunks?: number | undefined;
  maxDecodedBytes?: number | undefined;
  /* Per attempt. Tests shrink it; the product uses the engine constant. */
  fetchTimeoutMs?: number | undefined;
  /* Back-off before each retry; length = number of retries. */
  retryDelaysMs?: ReadonlyArray<number> | undefined;
}

/*
 * A 30-minute session is roughly 120 chunks. Holding them all parsed is
 * hundreds of megabytes of heap in a tab that also runs the whole Dashboard,
 * so the decoded set is capped on both count and size and evicted LRU.
 */
const DEFAULT_MAX_DECODED_CHUNKS: number = 24;
const DEFAULT_MAX_DECODED_BYTES: number = 24 * 1024 * 1024;

/*
 * One attempt may take this long before it is abandoned and retried. 15s
 * is generous for an 8MB page on a slow link and short enough that a hung
 * connection does not read as a frozen player.
 */
export const DEFAULT_CHUNK_FETCH_TIMEOUT_MS: number = 15 * 1000;
export const DEFAULT_CHUNK_RETRY_DELAYS_MS: ReadonlyArray<number> = [500, 2000];

/* Bytes of framing ahead of each chunk's payload: u32 index + u32 length. */
const FRAME_HEADER_BYTES: number = 8;

interface TimelineChunkRecord {
  events: Array<ReplayTimelineEvent>;
  activityIntervals: Array<ReplayActivityInterval>;
}

export default class ChunkLoader {
  private readonly sessionId: string;
  private readonly tabId: string;
  private readonly fetcher: SessionReplayChunkFetcher;
  private readonly maxDecodedChunks: number;
  private readonly maxDecodedBytes: number;
  private readonly fetchTimeoutMs: number;
  private readonly retryDelaysMs: ReadonlyArray<number>;

  /* Every manifest row, terminators included, sorted by index. */
  private entries: Array<SessionReplayChunkManifestEntry>;
  /* Rows that carry footage. Everything playback-related reads these. */
  private playableEntries: Array<SessionReplayChunkManifestEntry>;
  private entryByIndex: Map<number, SessionReplayChunkManifestEntry>;
  private playableIndexes: Set<number>;
  private fullSnapshotChunkIndexes: Array<number>;
  private gaps: Array<SessionReplayGap>;

  /*
   * Insertion order IS the LRU order: a hit deletes and re-sets the key, so
   * the least recently used entry is always the first one Map iteration
   * yields.
   */
  private readonly decoded: Map<number, DecodedChunk>;
  private decodedBytes: number;

  /*
   * Rail rows and activity intervals extracted from each decoded chunk.
   * Deliberately OUTSIDE the LRU: they are a few hundred bytes per chunk,
   * and evicting them with the payloads would blank the rail and the idle
   * lane for footage the viewer already watched. Bounded per kind instead.
   */
  private readonly timeline: Map<number, TimelineChunkRecord>;
  private countsByKind: Partial<Record<ReplayTimelineEventKind, number>>;
  private readonly truncatedKinds: Set<ReplayTimelineEventKind>;

  /*
   * In-flight requests keyed by CHUNK INDEX, not page start. A page planned
   * from index 10 while [9..16] is on the wire must wait for that request,
   * not issue a second one for [10..17].
   */
  private readonly inFlightByChunk: Map<number, Promise<void>>;
  private readonly controllers: Set<AbortController>;

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
    this.fetchTimeoutMs =
      options.fetchTimeoutMs ?? DEFAULT_CHUNK_FETCH_TIMEOUT_MS;
    this.retryDelaysMs = options.retryDelaysMs ?? DEFAULT_CHUNK_RETRY_DELAYS_MS;

    this.entries = [];
    this.playableEntries = [];
    this.entryByIndex = new Map<number, SessionReplayChunkManifestEntry>();
    this.playableIndexes = new Set<number>();
    this.fullSnapshotChunkIndexes = [];
    this.gaps = [];
    this.rebuildIndex(options.entries);

    this.decoded = new Map<number, DecodedChunk>();
    this.decodedBytes = 0;
    this.inFlightByChunk = new Map<number, Promise<void>>();
    this.controllers = new Set<AbortController>();
    this.generation = 0;
    this.timeline = new Map<number, TimelineChunkRecord>();
    this.countsByKind = {};
    this.truncatedKinds = new Set<ReplayTimelineEventKind>();
  }

  /* ---- Manifest ---- */

  private rebuildIndex(entries: Array<SessionReplayChunkManifestEntry>): void {
    const byIndex: Map<number, SessionReplayChunkManifestEntry> = new Map<
      number,
      SessionReplayChunkManifestEntry
    >();

    for (const entry of entries) {
      byIndex.set(entry.chunkIndex, entry);
    }

    this.entries = [...byIndex.values()].sort(
      (
        a: SessionReplayChunkManifestEntry,
        b: SessionReplayChunkManifestEntry,
      ): number => {
        return a.chunkIndex - b.chunkIndex;
      },
    );
    this.entryByIndex = byIndex;

    this.playableEntries = this.entries.filter(
      (entry: SessionReplayChunkManifestEntry): boolean => {
        return !ChunkMath.isTerminatorEntry(entry);
      },
    );
    this.playableIndexes = new Set<number>(
      this.playableEntries.map(
        (entry: SessionReplayChunkManifestEntry): number => {
          return entry.chunkIndex;
        },
      ),
    );

    this.fullSnapshotChunkIndexes = this.playableEntries
      .filter((entry: SessionReplayChunkManifestEntry): boolean => {
        return entry.hasFullSnapshot;
      })
      .map((entry: SessionReplayChunkManifestEntry): number => {
        return entry.chunkIndex;
      });

    /*
     * Over ALL rows: an empty chunk between two real ones is present, not
     * missing, so it must not read as a hole on the timeline.
     */
    this.gaps = ChunkMath.detectGaps(this.entries);
  }

  /*
   * Live sessions: the manifest is re-fetched every 30s and new rows are
   * appended. Nothing decoded is touched; a row that re-appears with
   * different counters replaces the old one. Returns how many indexes are
   * new, so the caller can tell "nothing happened" from "footage grew".
   */
  public appendEntries(
    entries: Array<SessionReplayChunkManifestEntry>,
  ): number {
    let added: number = 0;

    for (const entry of entries) {
      if (!this.entryByIndex.has(entry.chunkIndex)) {
        added += 1;
      }
    }

    this.rebuildIndex([...this.entries, ...entries]);

    return added;
  }

  public getEntries(): Array<SessionReplayChunkManifestEntry> {
    return this.entries;
  }

  /* Rows with footage: terminators (eventCount 0) excluded. */
  public getPlayableEntries(): Array<SessionReplayChunkManifestEntry> {
    return this.playableEntries;
  }

  /* The recorder's end-of-tab / cut-short markers, if the manifest has any. */
  public getTerminatorEntries(): Array<SessionReplayChunkManifestEntry> {
    return this.entries.filter(
      (entry: SessionReplayChunkManifestEntry): boolean => {
        return ChunkMath.isTerminatorEntry(entry);
      },
    );
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

  public getSessionId(): string {
    return this.sessionId;
  }

  /*
   * Wall-clock length of the FOOTAGE, gaps included, terminators excluded.
   * The recorder stamps its closing marker with the tab-close time, which
   * can sit minutes past the last frame; a scrubber that ran to it would
   * never reach "the end", so Play-at-end could never rewind.
   */
  public getDurationMs(): number {
    const last: SessionReplayChunkManifestEntry | undefined =
      this.playableEntries[this.playableEntries.length - 1];

    return last ? last.chunkEndOffsetMs : 0;
  }

  /* When the recorder says the tab actually ended, markers included. */
  public getRecordedEndMs(): number {
    const last: SessionReplayChunkManifestEntry | undefined =
      this.entries[this.entries.length - 1];

    return last ? last.chunkEndOffsetMs : 0;
  }

  /* Footage that actually exists. Always <= getDurationMs(). */
  public getCoveredDurationMs(): number {
    return ChunkMath.getCoveredDurationMs(this.playableEntries);
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

  /* Session offset of the first playable moment, or null with no anchor. */
  public getEarliestPlayableOffsetMs(): number | null {
    const first: number | null = this.getFirstPlayableChunkIndex();

    if (first === null) {
      return null;
    }

    return this.entryByIndex.get(first)?.chunkStartOffsetMs ?? null;
  }

  /*
   * The greatest seek anchor at or before a target chunk. Returns null when
   * there is none, which the caller must treat as "clamp to the first
   * playable moment and say so", never as "start from zero silently".
   */
  public getSeekAnchor(targetChunkIndex: number): number | null {
    return ChunkMath.findSeekAnchor(
      this.fullSnapshotChunkIndexes,
      targetChunkIndex,
    );
  }

  /* The playable chunk covering an offset, or the nearest one at or before it. */
  public getChunkIndexForOffset(offsetMs: number): number | null {
    if (this.playableEntries.length === 0) {
      return null;
    }

    let low: number = 0;
    let high: number = this.playableEntries.length - 1;
    let best: number | null = null;

    while (low <= high) {
      const mid: number = Math.floor((low + high) / 2);
      const candidate: SessionReplayChunkManifestEntry | undefined =
        this.playableEntries[mid];

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
    return best ?? this.playableEntries[0]?.chunkIndex ?? null;
  }

  public getEntry(
    chunkIndex: number,
  ): SessionReplayChunkManifestEntry | undefined {
    return this.entryByIndex.get(chunkIndex);
  }

  public hasPlayableEntry(chunkIndex: number): boolean {
    return this.playableIndexes.has(chunkIndex);
  }

  /*
   * True when every chunk from fromChunkIndex to toChunkIndex can be fed
   * in order into a live Replayer. Terminators in the middle are skipped
   * over by getNextChunk, so they count as present here.
   */
  public isContiguousRange(
    fromChunkIndex: number,
    toChunkIndex: number,
  ): boolean {
    return ChunkMath.isContiguousRange(
      new Set<number>(this.entryByIndex.keys()),
      fromChunkIndex,
      toChunkIndex,
    );
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
   *
   * Terminator rows are stepped over: an empty chunk between two real ones
   * means nothing happened, not that footage is missing, and a trailing one
   * means the tab ended - which is `null` here, never an error.
   */
  public getNextChunk(afterChunkIndex: number): NextChunkDecision | null {
    let contiguous: number = afterChunkIndex + 1;

    while (
      this.entryByIndex.has(contiguous) &&
      !this.playableIndexes.has(contiguous)
    ) {
      contiguous += 1;
    }

    if (this.playableIndexes.has(contiguous)) {
      return { chunkIndex: contiguous, skippedGap: null };
    }

    const anchor: number | null = ChunkMath.findNextAnchorAfter(
      this.fullSnapshotChunkIndexes,
      afterChunkIndex,
    );

    if (anchor === null) {
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

  /* ---- Decoded cache ---- */

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

  public isChunkInFlight(chunkIndex: number): boolean {
    return this.inFlightByChunk.has(chunkIndex);
  }

  public getDecodedChunkIndexes(): Array<number> {
    return [...this.decoded.keys()].sort((a: number, b: number): number => {
      return a - b;
    });
  }

  /*
   * The indexes the next fetch would ask for, capped on both count and total
   * bytes. Exposed so the engine can prefetch without duplicating the
   * planning rules.
   */
  public planPage(fromChunkIndex: number): Array<number> {
    return ChunkMath.planChunkPage(
      this.playableEntries,
      fromChunkIndex,
      MAX_SESSION_REPLAY_CHUNKS_PER_READ,
      MAX_SESSION_REPLAY_READ_BYTES,
    );
  }

  /*
   * Fetch and decode one page starting at fromChunkIndex, skipping anything
   * already resident or already on the wire. Returns every index that is
   * ACTUALLY decoded for that page, which on a full cache hit means no
   * request was made at all.
   *
   * Returning what was asked for rather than what came back would make a
   * partial response indistinguishable from a complete one, and the player
   * would feed chunk N+1 into a Replayer that never received N.
   */
  public async loadPage(fromChunkIndex: number): Promise<Array<number>> {
    const planned: Array<number> = this.planPage(fromChunkIndex);

    return this.loadIndexes(planned);
  }

  /*
   * The first paint's request: the anchor and one neighbour, on the wire
   * before rrweb has finished downloading, with the full page following
   * right behind (not awaited, errors deferred to whoever needs the
   * footage). Resolves when the priority pair is decoded.
   */
  public async loadFirst(anchorChunkIndex: number): Promise<Array<number>> {
    const priority: Array<number> = ChunkMath.planPriorityPage(
      this.playableIndexes,
      anchorChunkIndex,
    );

    if (priority.length === 0) {
      return [];
    }

    const decoded: Array<number> = await this.loadIndexes(priority);

    /*
     * Fill out the page the anchor belongs to, after the pair has landed
     * so the two requests do not compete for the same connection. A
     * failure here surfaces later, through the fetch playback makes when
     * it actually reaches the chunk.
     */
    void this.loadPage(anchorChunkIndex).catch((): void => {
      // Intentionally ignored - see comment above.
    });

    return decoded;
  }

  private async loadIndexes(planned: Array<number>): Promise<Array<number>> {
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

    const waits: Set<Promise<void>> = new Set<Promise<void>>();
    const toFetch: Array<number> = [];

    for (const chunkIndex of missing) {
      const inFlight: Promise<void> | undefined =
        this.inFlightByChunk.get(chunkIndex);

      if (inFlight) {
        waits.add(inFlight);
      } else {
        toFetch.push(chunkIndex);
      }
    }

    if (toFetch.length > 0) {
      waits.add(this.startRequest(toFetch));
    }

    await Promise.all([...waits]);

    return planned.filter((chunkIndex: number): boolean => {
      return this.decoded.has(chunkIndex);
    });
  }

  private startRequest(chunkIndexes: Array<number>): Promise<void> {
    const generationAtStart: number = this.generation;

    const request: Promise<void> = (async (): Promise<void> => {
      const buffer: ArrayBuffer | null = await this.fetchWithRetry(
        chunkIndexes,
        generationAtStart,
      );

      if (buffer === null || generationAtStart !== this.generation) {
        // Disposed while in flight. Drop the bytes on the floor.
        return;
      }

      for (const frame of ChunkLoader.decodeFrames(buffer)) {
        this.admit(frame.chunkIndex, frame.events, frame.approximateBytes);
      }
    })();

    for (const chunkIndex of chunkIndexes) {
      this.inFlightByChunk.set(chunkIndex, request);
    }

    const cleanup: () => void = (): void => {
      for (const chunkIndex of chunkIndexes) {
        if (this.inFlightByChunk.get(chunkIndex) === request) {
          this.inFlightByChunk.delete(chunkIndex);
        }
      }
    };

    /*
     * Both branches clean up; the rejection is re-thrown to every awaiter
     * (loadIndexes awaits this same promise), so it is never unhandled.
     */
    return request.then(cleanup, (err: unknown): void => {
      cleanup();
      throw err;
    });
  }

  /*
   * One logical fetch: up to 1 + retries attempts, each bounded by the
   * timeout and abortable through dispose(). The race against the signal
   * is what makes the timeout real even when the injected transport never
   * looks at `signal`.
   *
   * Resolves null when dispose() cut it short: the viewer left, nobody is
   * waiting for these bytes, and an error would only reach a component
   * that has already unmounted.
   */
  private async fetchWithRetry(
    chunkIndexes: Array<number>,
    generationAtStart: number,
  ): Promise<ArrayBuffer | null> {
    const maxAttempts: number = 1 + this.retryDelaysMs.length;
    let lastMessage: string = "";
    let lastWasTimeout: boolean = false;

    for (let attempt: number = 1; attempt <= maxAttempts; attempt++) {
      const controller: AbortController = new AbortController();
      this.controllers.add(controller);

      let timedOut: boolean = false;
      const timeout: ReturnType<typeof setTimeout> = setTimeout((): void => {
        timedOut = true;
        controller.abort();
      }, this.fetchTimeoutMs);

      try {
        return await ChunkLoader.raceWithAbort(
          this.fetcher({
            sessionId: this.sessionId,
            tabId: this.tabId,
            chunkIndexes: chunkIndexes,
            signal: controller.signal,
          }),
          controller.signal,
        );
      } catch (err) {
        if (generationAtStart !== this.generation) {
          return null;
        }

        lastWasTimeout = timedOut;
        lastMessage = timedOut
          ? `no response within ${Math.round(this.fetchTimeoutMs / 1000)}s`
          : err instanceof Error && err.message
            ? err.message
            : "the request failed";
      } finally {
        clearTimeout(timeout);
        this.controllers.delete(controller);
      }

      const delayMs: number | undefined = this.retryDelaysMs[attempt - 1];

      if (delayMs !== undefined && attempt < maxAttempts) {
        await ChunkLoader.sleep(delayMs);

        if (generationAtStart !== this.generation) {
          return null;
        }
      }
    }

    throw new ChunkLoadError({
      message: `Could not fetch ${ChunkLoader.describeChunkRange(
        chunkIndexes,
      )} after ${maxAttempts} attempts (${lastMessage}).`,
      chunkIndexes: chunkIndexes,
      attempts: maxAttempts,
      isAborted: false,
      isTimeout: lastWasTimeout,
    });
  }

  private static describeChunkRange(chunkIndexes: Array<number>): string {
    const first: number | undefined = chunkIndexes[0];
    const last: number | undefined = chunkIndexes[chunkIndexes.length - 1];

    if (first === undefined || last === undefined) {
      return "footage";
    }

    return first === last ? `chunk ${first}` : `chunks ${first} to ${last}`;
  }

  private static raceWithAbort<T>(
    promise: Promise<T>,
    signal: AbortSignal,
  ): Promise<T> {
    if (signal.aborted) {
      return Promise.reject(new Error("aborted"));
    }

    return new Promise<T>(
      (resolve: (value: T) => void, reject: (reason: unknown) => void) => {
        const onAbort: () => void = (): void => {
          reject(new Error("aborted"));
        };

        signal.addEventListener("abort", onAbort, { once: true });

        promise.then(
          (value: T): void => {
            signal.removeEventListener("abort", onAbort);
            resolve(value);
          },
          (err: unknown): void => {
            signal.removeEventListener("abort", onAbort);
            reject(err);
          },
        );
      },
    );
  }

  private static sleep(ms: number): Promise<void> {
    return new Promise<void>((resolve: () => void) => {
      setTimeout(resolve, ms);
    });
  }

  /*
   * Decoded events for one chunk, fetching its page first if needed.
   * Resolves null for a chunk that is not playable footage (absent, or a
   * terminator) and for one the response did not carry; throws
   * ChunkLoadError once the transport has given up.
   */
  public async ensureChunk(
    chunkIndex: number,
  ): Promise<Array<SessionReplayRecordedEvent> | null> {
    const cached: Array<SessionReplayRecordedEvent> | null =
      this.getDecodedChunk(chunkIndex);

    if (cached) {
      return cached;
    }

    if (!this.playableIndexes.has(chunkIndex)) {
      return null;
    }

    await this.loadPage(chunkIndex);

    return this.getDecodedChunk(chunkIndex);
  }

  /*
   * Warm up to `pages` pages of footage past a chunk, planned from the
   * first chunk after it that is neither decoded nor already on the wire,
   * so consecutive calls after consecutive feeds settle into clean
   * page-aligned requests instead of one single-chunk POST per feed.
   *
   * Failures are swallowed on purpose: a prefetch is an optimisation, and
   * surfacing its error would show the viewer a failure for footage they
   * have not asked for yet. The same page is re-requested, and its error
   * surfaced, if playback actually reaches it.
   */
  public async prefetchAhead(
    afterChunkIndex: number,
    pages: number,
  ): Promise<void> {
    let cursor: number = afterChunkIndex;

    for (let page: number = 0; page < pages; page++) {
      const start: number | null = this.findNextUnloadedIndex(cursor);

      if (start === null) {
        return;
      }

      const planned: Array<number> = this.planPage(start);
      const last: number | undefined = planned[planned.length - 1];

      if (last === undefined) {
        return;
      }

      try {
        await this.loadIndexes(planned);
      } catch {
        // Intentionally ignored - see comment above.
        return;
      }

      cursor = last;
    }
  }

  /* Kept for older callers: one page after the one containing chunkIndex. */
  public async prefetchAfter(chunkIndex: number): Promise<void> {
    await this.prefetchAhead(chunkIndex, 1);
  }

  private findNextUnloadedIndex(afterChunkIndex: number): number | null {
    for (const entry of this.playableEntries) {
      if (entry.chunkIndex <= afterChunkIndex) {
        continue;
      }

      if (
        !this.decoded.has(entry.chunkIndex) &&
        !this.inFlightByChunk.has(entry.chunkIndex)
      ) {
        return entry.chunkIndex;
      }
    }

    return null;
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
   * Releases every decoded chunk, aborts in-flight requests and invalidates
   * their results. Idempotent.
   */
  public dispose(): void {
    this.generation += 1;

    for (const controller of [...this.controllers]) {
      controller.abort();
    }

    this.controllers.clear();
    this.decoded.clear();
    this.inFlightByChunk.clear();
    this.decodedBytes = 0;
    this.timeline.clear();
    this.countsByKind = {};
    this.truncatedKinds.clear();
  }

  /* ---- Wire format ---- */

  /*
   * Parse the concatenated chunk response: repeated
   * [u32 chunkIndex][u32 payloadLength][payloadLength bytes of UTF-8 JSON].
   *
   * LITTLE-endian, matching the server writer: the /chunks route in
   * Common/Server/API/TelemetryAPI.ts frames each payload with
   * headerBuffer.writeUInt32LE(...). Reading these as big-endian turns a
   * chunkIndex of 3 into 50331648 and a length of 4096 into 16, so every
   * frame after the first is misaligned and the whole response decodes to
   * nothing. Payloads are the DECOMPRESSED
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
      const chunkIndex: number = view.getUint32(offset, true);
      const length: number = view.getUint32(offset + 4, true);
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

  /* ---- Signals ---- */

  /*
   * Every extracted event across every chunk seen so far, in timeline
   * order. Grows as playback fetches pages - the rail labels itself
   * accordingly rather than implying full-session coverage up front.
   */
  public getTimelineEvents(): Array<ReplayTimelineEvent> {
    const chunkIndexes: Array<number> = [...this.timeline.keys()].sort(
      (a: number, b: number): number => {
        return a - b;
      },
    );

    const all: Array<ReplayTimelineEvent> = [];

    for (const chunkIndex of chunkIndexes) {
      const record: TimelineChunkRecord | undefined =
        this.timeline.get(chunkIndex);

      if (record) {
        all.push(...record.events);
      }
    }

    /* Stable sort: ties keep chunk order, then extraction order. */
    return all.sort(
      (a: ReplayTimelineEvent, b: ReplayTimelineEvent): number => {
        return a.offsetMs - b.offsetMs;
      },
    );
  }

  public getTimelineEventsForChunk(
    chunkIndex: number,
  ): Array<ReplayTimelineEvent> | null {
    return this.timeline.get(chunkIndex)?.events ?? null;
  }

  /* Chunk indexes whose signals have been extracted (decoded at least once). */
  public getExtractedChunkIndexes(): Array<number> {
    return [...this.timeline.keys()].sort((a: number, b: number): number => {
      return a - b;
    });
  }

  public getExtractionStats(): ReplayTimelineExtractionStats {
    const stats: ReplayTimelineExtractionStats = makeEmptyExtractionStats();
    stats.countsByKind = { ...this.countsByKind };
    stats.truncatedKinds = [...this.truncatedKinds];
    stats.activityIntervals = this.getActivityIntervals();

    return stats;
  }

  /* True once any kind hit its cap. The rail says which via the stats. */
  public areTimelineEventsTruncated(): boolean {
    return this.truncatedKinds.size > 0;
  }

  public getActivityIntervals(): Array<ReplayActivityInterval> {
    const all: Array<ReplayActivityInterval> = [];

    for (const chunkIndex of this.getExtractedChunkIndexes()) {
      const record: TimelineChunkRecord | undefined =
        this.timeline.get(chunkIndex);

      if (record) {
        all.push(...record.activityIntervals);
      }
    }

    return all;
  }

  public getActivityIntervalsForChunk(
    chunkIndex: number,
  ): Array<ReplayActivityInterval> | null {
    return this.timeline.get(chunkIndex)?.activityIntervals ?? null;
  }

  /*
   * Lift the recorder's type-5 custom events out of one chunk's stream.
   * Kept as a thin wrapper over extractChunk for older callers and tests.
   */
  public static extractTimelineEvents(
    entry: SessionReplayChunkManifestEntry,
    events: Array<SessionReplayRecordedEvent>,
  ): Array<ReplayTimelineEvent> {
    return ChunkLoader.extractChunk(entry, events).events;
  }

  /*
   * One pass over a decoded chunk: every recorder custom tag becomes a row,
   * rrweb's Meta becomes a "navigation" row, MouseInteraction clicks become
   * "click" rows ONLY when the chunk carries no oneuptime.click (recordings
   * that predate the click recorder), and every user-input source becomes
   * an activity point for the idle map.
   *
   * Pure and defensive: payload fields are read one by one because the
   * events cross a wire and a version boundary - an unrecognised shape
   * costs that one event, never the chunk. Ids are rec:<chunk>:<ordinal>
   * with the ordinal assigned here, before any cap, so a row keeps its id
   * across eviction and re-admission.
   */
  public static extractChunk(
    entry: SessionReplayChunkManifestEntry,
    events: Array<SessionReplayRecordedEvent>,
  ): ChunkExtraction {
    const extracted: Array<ReplayTimelineEvent> = [];
    const activityPoints: Array<number> = [];
    const fallbackClicks: Array<{ offsetMs: number; x: number; y: number }> =
      [];
    let hasLabelledClicks: boolean = false;

    /*
     * Event timestamps are RAW client clocks. The first event's timestamp
     * anchors the chunk, so within-chunk deltas map onto the timeline
     * offset the manifest assigns the chunk - exact to the recorder's own
     * clock, clamped so a skewed event cannot escape its chunk's window.
     */
    const firstTimestamp: number = events[0]?.timestamp ?? 0;

    const toOffsetMs: (timestamp: unknown) => number = (
      timestamp: unknown,
    ): number => {
      return Math.min(
        entry.chunkEndOffsetMs,
        Math.max(
          entry.chunkStartOffsetMs,
          entry.chunkStartOffsetMs +
            (typeof timestamp === "number" ? timestamp - firstTimestamp : 0),
        ),
      );
    };

    for (const event of events) {
      if (!event || typeof event !== "object") {
        continue;
      }

      const data: Record<string, unknown> | null =
        event.data && typeof event.data === "object"
          ? (event.data as Record<string, unknown>)
          : null;

      if (!data) {
        continue;
      }

      const offsetMs: number = toOffsetMs(event.timestamp);

      if (event.type === RRWEB_EVENT_TYPE_META) {
        const href: unknown = data["href"];
        const row: ReplayTimelineEvent = {
          id: "",
          kind: "navigation",
          chunkIndex: entry.chunkIndex,
          offsetMs: offsetMs,
          to: typeof href === "string" ? href : "",
        };

        const width: unknown = data["width"];
        const height: unknown = data["height"];

        if (ChunkLoader.isPositive(width) && ChunkLoader.isPositive(height)) {
          row.viewportWidth = width;
          row.viewportHeight = height;
        }

        extracted.push(row);
        continue;
      }

      if (event.type === RRWEB_EVENT_TYPE_INCREMENTAL) {
        const source: unknown = data["source"];

        if (typeof source === "number" && ACTIVITY_SOURCES.has(source)) {
          activityPoints.push(offsetMs);
        }

        if (source === RRWEB_SOURCE_MOUSE_INTERACTION) {
          const interaction: unknown = data["type"];
          const x: unknown = data["x"];
          const y: unknown = data["y"];

          if (
            typeof interaction === "number" &&
            FALLBACK_CLICK_INTERACTIONS.has(interaction) &&
            typeof x === "number" &&
            typeof y === "number"
          ) {
            fallbackClicks.push({ offsetMs: offsetMs, x: x, y: y });
          }
        }

        continue;
      }

      if (event.type !== SESSION_REPLAY_RRWEB_CUSTOM_EVENT_TYPE) {
        continue;
      }

      const kind: ReplayTimelineEventKind | undefined =
        TAG_TO_KIND[String(data["tag"])];

      if (!kind) {
        continue;
      }

      const payload: Record<string, unknown> =
        data["payload"] && typeof data["payload"] === "object"
          ? (data["payload"] as Record<string, unknown>)
          : {};

      const row: ReplayTimelineEvent = {
        id: "",
        kind: kind,
        chunkIndex: entry.chunkIndex,
        offsetMs: offsetMs,
      };

      ChunkLoader.fillRow(row, kind, payload);

      if (kind === "click") {
        hasLabelledClicks = true;
      }

      if (ACTIVITY_KINDS.has(kind)) {
        activityPoints.push(offsetMs);
      }

      extracted.push(row);
    }

    /*
     * Fallback rows only for recordings without the click recorder: with
     * labelled clicks present, the rrweb-derived ones would double every
     * click in the rail.
     */
    if (!hasLabelledClicks) {
      for (const click of fallbackClicks) {
        extracted.push({
          id: "",
          kind: "click",
          chunkIndex: entry.chunkIndex,
          offsetMs: click.offsetMs,
          x: click.x,
          y: click.y,
        });
      }
    }

    extracted.sort((a: ReplayTimelineEvent, b: ReplayTimelineEvent): number => {
      return a.offsetMs - b.offsetMs;
    });

    extracted.forEach((row: ReplayTimelineEvent, ordinal: number): void => {
      row.id = makeRecordingSignalId(entry.chunkIndex, ordinal);
    });

    return {
      events: extracted,
      activityIntervals: ChunkLoader.buildActivityIntervals(
        entry.chunkIndex,
        activityPoints,
      ),
    };
  }

  private static isPositive(value: unknown): value is number {
    return typeof value === "number" && Number.isFinite(value) && value > 0;
  }

  /*
   * Activity points closer than the idle threshold belong to one stretch of
   * doing something; a wider silence between two points is exactly an idle
   * candidate, left for the map to measure across chunk boundaries.
   */
  private static buildActivityIntervals(
    chunkIndex: number,
    points: Array<number>,
  ): Array<ReplayActivityInterval> {
    if (points.length === 0) {
      return [];
    }

    const sorted: Array<number> = [...points].sort(
      (a: number, b: number): number => {
        return a - b;
      },
    );

    const intervals: Array<ReplayActivityInterval> = [];
    let start: number = sorted[0] ?? 0;
    let end: number = start;

    for (const point of sorted) {
      if (point - end < SESSION_REPLAY_IDLE_THRESHOLD_MS) {
        end = point;
      } else {
        intervals.push({ startMs: start, endMs: end, chunkIndex: chunkIndex });
        start = point;
        end = point;
      }
    }

    intervals.push({ startMs: start, endMs: end, chunkIndex: chunkIndex });

    return intervals;
  }

  private static fillRow(
    row: ReplayTimelineEvent,
    kind: ReplayTimelineEventKind,
    payload: Record<string, unknown>,
  ): void {
    const readString: (key: string) => string | undefined = (
      key: string,
    ): string | undefined => {
      const value: unknown = payload[key];
      return typeof value === "string" && value ? value : undefined;
    };

    const readNumber: (key: string) => number | undefined = (
      key: string,
    ): number | undefined => {
      const value: unknown = payload[key];
      return typeof value === "number" && Number.isFinite(value)
        ? value
        : undefined;
    };

    const readStringMap: (key: string) => Record<string, string> | undefined = (
      key: string,
    ): Record<string, string> | undefined => {
      const value: unknown = payload[key];

      if (!value || typeof value !== "object" || Array.isArray(value)) {
        return undefined;
      }

      const map: Record<string, string> = {};

      for (const [mapKey, mapValue] of Object.entries(
        value as Record<string, unknown>,
      )) {
        if (typeof mapValue === "string") {
          map[mapKey] = mapValue;
        }
      }

      return map;
    };

    const atUnixMs: number | undefined =
      readNumber("atUnixMs") ?? readNumber("occurredAtUnixMs");

    if (atUnixMs !== undefined) {
      row.atUnixMs = atUnixMs;
    }

    switch (kind) {
      case "console": {
        row.level = readString("level") ?? "log";
        row.message = readString("message") ?? "";
        break;
      }
      case "network": {
        row.method = readString("method") ?? "GET";
        row.url = readString("url") ?? "";
        row.status = readNumber("status") ?? 0;
        row.durationMs = readNumber("durationMs") ?? 0;
        row.responseBytes = readNumber("responseBytes") ?? 0;

        const requestBytes: number | undefined = readNumber("requestBytes");
        const traceId: string | undefined = readString("traceId");
        const initiator: string | undefined = readString("initiator");

        if (requestBytes !== undefined) {
          row.requestBytes = requestBytes;
        }

        if (typeof payload["isError"] === "boolean") {
          row.isError = payload["isError"];
        }

        /*
         * Assigned conditionally rather than as `traceId: undefined`:
         * exactOptionalPropertyTypes makes those two different types, and
         * a row with the key present but empty would render a dead link.
         */
        if (traceId) {
          row.traceId = traceId;
        }

        if (initiator === "fetch" || initiator === "xhr") {
          row.initiator = initiator;
        }
        break;
      }
      case "route": {
        row.from = readString("from") ?? "";
        row.to = readString("to") ?? "";

        const routeKind: string | undefined = readString("kind");

        if (
          routeKind === "pushState" ||
          routeKind === "replaceState" ||
          routeKind === "popstate" ||
          routeKind === "hashchange"
        ) {
          row.routeKind = routeKind as SessionReplayRouteKind;
        }
        break;
      }
      case "error": {
        row.message = readString("message") ?? "";
        row.source = readString("source") ?? "";

        const errorKind: string | undefined = readString("kind");
        const lineNumber: number | undefined = readNumber("lineNumber");
        const columnNumber: number | undefined = readNumber("columnNumber");
        const stack: string | undefined = readString("stack");

        if (errorKind === "error" || errorKind === "unhandledrejection") {
          row.errorKind = errorKind as SessionReplayErrorKind;
        }

        if (lineNumber !== undefined) {
          row.lineNumber = lineNumber;
        }

        if (columnNumber !== undefined) {
          row.columnNumber = columnNumber;
        }

        if (stack) {
          row.stack = stack;
        }
        break;
      }
      case "frustration": {
        const frustrationKind: string | undefined = readString("kind");

        if (
          frustrationKind === "rage-click" ||
          frustrationKind === "dead-click" ||
          frustrationKind === "error-click" ||
          frustrationKind === "refresh-rage"
        ) {
          row.frustrationKind = frustrationKind as SessionReplayFrustrationKind;
        }

        const x: number | undefined = readNumber("x");
        const y: number | undefined = readNumber("y");
        const clickCount: number | undefined = readNumber("clickCount");
        const reloadCount: number | undefined = readNumber("reloadCount");

        if (x !== undefined && y !== undefined) {
          row.x = x;
          row.y = y;
        }

        if (clickCount !== undefined) {
          row.clickCount = clickCount;
        }

        if (reloadCount !== undefined) {
          row.reloadCount = reloadCount;
        }
        break;
      }
      case "performance": {
        if (isSessionReplayWebVitalPayload(payload)) {
          row.performanceKind = "web-vital";
          row.metric = payload.metric;
          row.value = payload.value;
          row.rating = payload.rating;

          if (payload.url) {
            row.url = payload.url;
          }
        } else if (isSessionReplayPerformanceBudgetPayload(payload)) {
          row.performanceKind = payload.kind;
          row.durationMs = payload.durationMs;
          row.budgetMs = payload.budgetMs;

          if (payload.url) {
            row.url = payload.url;
          }
        } else {
          /* Unknown shape from a newer recorder: keep what can be read. */
          const performanceKind: string | undefined = readString("kind");
          const durationMs: number | undefined = readNumber("durationMs");
          const budgetMs: number | undefined = readNumber("budgetMs");
          const url: string | undefined = readString("url");

          if (
            performanceKind === "lcp" ||
            performanceKind === "long-task" ||
            performanceKind === "slow-request"
          ) {
            row.performanceKind =
              performanceKind as SessionReplayPerformanceBudgetKind;
          }

          if (durationMs !== undefined) {
            row.durationMs = durationMs;
          }

          if (budgetMs !== undefined) {
            row.budgetMs = budgetMs;
          }

          if (url) {
            row.url = url;
          }
        }
        break;
      }
      case "click": {
        if (isSessionReplayClickPayload(payload)) {
          row.selector = payload.selector;
          row.x = payload.x;
          row.y = payload.y;

          if (payload.text) {
            row.text = payload.text;
          }
        } else {
          const selector: string | undefined = readString("selector");
          const text: string | undefined = readString("text");
          const x: number | undefined = readNumber("x");
          const y: number | undefined = readNumber("y");

          if (selector) {
            row.selector = selector;
          }

          if (text) {
            row.text = text;
          }

          if (x !== undefined && y !== undefined) {
            row.x = x;
            row.y = y;
          }
        }
        break;
      }
      case "visibility": {
        if (isSessionReplayVisibilityPayload(payload)) {
          row.visibilityState = payload.state;
        } else {
          const state: string | undefined = readString("state");

          if (state === "hidden" || state === "visible") {
            row.visibilityState = state as SessionReplayVisibilityState;
          }
        }
        break;
      }
      case "custom": {
        if (isSessionReplayCustomPayload(payload)) {
          row.name = payload.name;

          if (payload.properties) {
            row.properties = payload.properties;
          }
        } else {
          row.name = readString("name") ?? "";

          const properties: Record<string, string> | undefined =
            readStringMap("properties");

          if (properties) {
            row.properties = properties;
          }
        }
        break;
      }
      case "identify": {
        row.hasTraits = isSessionReplayIdentifyPayload(payload)
          ? payload.hasTraits
          : payload["hasTraits"] === true;
        break;
      }
      case "tags": {
        row.tags = isSessionReplayTagsPayload(payload)
          ? payload.tags
          : readStringMap("tags") ?? {};
        break;
      }
      case "click-dropped": {
        row.droppedCount = isSessionReplayClickDroppedPayload(payload)
          ? payload.count
          : readNumber("count") ?? 0;
        break;
      }
      case "custom-dropped": {
        row.droppedCount = isSessionReplayCustomDroppedPayload(payload)
          ? payload.count
          : readNumber("count") ?? 0;
        break;
      }
      case "navigation": {
        /* Produced from rrweb Meta, never from a custom tag. */
        break;
      }
      default: {
        const unreachable: never = kind;
        return unreachable;
      }
    }
  }

  private extractAndStoreTimelineEvents(
    chunkIndex: number,
    events: Array<SessionReplayRecordedEvent>,
  ): void {
    /*
     * A re-fetched chunk (evicted then needed again) re-runs extraction
     * with identical input; keeping the first result makes re-admission
     * free and the cap arithmetic stable.
     */
    if (this.timeline.has(chunkIndex)) {
      return;
    }

    const entry: SessionReplayChunkManifestEntry | undefined =
      this.entryByIndex.get(chunkIndex);

    if (!entry) {
      return;
    }

    const extraction: ChunkExtraction = ChunkLoader.extractChunk(entry, events);

    /*
     * Per-kind caps: a page that logs in a loop cannot push every other
     * kind out of the map. Oldest rows are kept because the viewer reads
     * a session front to back.
     */
    const kept: Array<ReplayTimelineEvent> = [];

    for (const row of extraction.events) {
      const count: number = this.countsByKind[row.kind] ?? 0;
      const cap: number = REPLAY_TIMELINE_EXTRACTION_CAPS[row.kind];

      if (count >= cap) {
        this.truncatedKinds.add(row.kind);
        continue;
      }

      this.countsByKind[row.kind] = count + 1;
      kept.push(row);
    }

    this.timeline.set(chunkIndex, {
      events: kept,
      activityIntervals: extraction.activityIntervals,
    });
  }

  private admit(
    chunkIndex: number,
    events: Array<SessionReplayRecordedEvent>,
    approximateBytes: number,
  ): void {
    this.extractAndStoreTimelineEvents(chunkIndex, events);

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
