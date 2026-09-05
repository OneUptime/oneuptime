import { afterEach, describe, expect, it } from "@jest/globals";
import { SessionReplayChunkManifestEntry } from "../../../Types/Rum/SessionReplay";
import ChunkLoader, {
  RRWEB_EVENT_TYPE_FULL_SNAPSHOT,
  RRWEB_EVENT_TYPE_INCREMENTAL,
  RRWEB_EVENT_TYPE_META,
  SessionReplayChunkFetchRequest,
  SessionReplayRecordedEvent,
} from "../../../../App/FeatureSet/Dashboard/src/Components/SessionReplay/ChunkLoader";
import { createReplayEngine } from "../../../../App/FeatureSet/Dashboard/src/Components/SessionReplay/Engine/ReplayEngine";
import {
  REPLAY_FEED_AHEAD_MIN_MS,
  ReplayEngine,
  ReplayEngineSnapshot,
  ReplayScheduleHandle,
  ReplayerLike,
} from "../../../../App/FeatureSet/Dashboard/src/Components/SessionReplay/Engine/ReplayEngineTypes";

/*
 * The engine is the piece whose failure mode is a lie rather than a crash:
 * feed rrweb a chunk whose predecessor never arrived and it resolves those
 * mutations against stale node ids, rendering a DOM the end user never
 * saw; stop on a Finish that was only a stall and Play does nothing.
 *
 * These tests drive it with a real ChunkLoader over fixture bytes, a fake
 * Replayer, an injected clock and a recording scheduler, so every state
 * transition is pinned without rrweb, a network, React or a browser.
 * Every scenario the old ReplayStage.test.tsx covered is ported here
 * one-for-one, followed by the invariants (a)-(g) from the design.
 *
 * It lives in Common for the same reason ChunkLoader.test.ts does: the
 * logic is Dashboard code, but nothing about it needs the Dashboard build.
 */

const CHUNK_MS: number = 15000;

/* Deliberately nothing like a session offset: these are raw client clocks. */
const CLIENT_CLOCK_BASE_MS: number = 1700000000000;

function makeEntry(
  chunkIndex: number,
  options?: {
    hasFullSnapshot?: boolean;
    eventCount?: number;
    payloadBytes?: number;
  },
): SessionReplayChunkManifestEntry {
  return {
    chunkIndex: chunkIndex,
    tabId: "tab-1",
    chunkStartOffsetMs: chunkIndex * CHUNK_MS,
    chunkEndOffsetMs: (chunkIndex + 1) * CHUNK_MS,
    eventCount: options?.eventCount ?? 10,
    hasFullSnapshot: options?.hasFullSnapshot ?? false,
    payloadBytes: options?.payloadBytes ?? 4096,
    errorCount: 0,
    rageClickCount: 0,
    deadClickCount: 0,
    errorClickCount: 0,
    refreshRageCount: 0,
    routeCount: 0,
  };
}

function eventsFor(
  chunkIndex: number,
  count: number,
): Array<SessionReplayRecordedEvent> {
  const events: Array<SessionReplayRecordedEvent> = [];

  for (let i: number = 0; i < count; i++) {
    events.push({
      type:
        chunkIndex === 0 && i === 0
          ? RRWEB_EVENT_TYPE_META
          : chunkIndex === 0 && i === 1
            ? RRWEB_EVENT_TYPE_FULL_SNAPSHOT
            : RRWEB_EVENT_TYPE_INCREMENTAL,
      timestamp: CLIENT_CLOCK_BASE_MS + chunkIndex * CHUNK_MS + i,
      data:
        chunkIndex === 0 && i === 0
          ? { href: "https://app.example.com/", width: 1440, height: 900 }
          : { chunkIndex: chunkIndex, sequence: i },
    });
  }

  return events;
}

/* [u32 chunkIndex][u32 length][payload], little-endian, as the server writes. */
function encodeFrames(
  frames: Array<{
    chunkIndex: number;
    events: Array<SessionReplayRecordedEvent>;
  }>,
): ArrayBuffer {
  const encoder: TextEncoder = new TextEncoder();
  const encoded: Array<{ chunkIndex: number; bytes: Uint8Array }> = frames.map(
    (frame: {
      chunkIndex: number;
      events: Array<SessionReplayRecordedEvent>;
    }): { chunkIndex: number; bytes: Uint8Array } => {
      return {
        chunkIndex: frame.chunkIndex,
        bytes: encoder.encode(JSON.stringify(frame.events)),
      };
    },
  );

  const totalBytes: number = encoded.reduce(
    (total: number, frame: { bytes: Uint8Array }): number => {
      return total + 8 + frame.bytes.length;
    },
    0,
  );

  const buffer: ArrayBuffer = new ArrayBuffer(totalBytes);
  const view: DataView = new DataView(buffer);
  const bytes: Uint8Array = new Uint8Array(buffer);
  let offset: number = 0;

  for (const frame of encoded) {
    view.setUint32(offset, frame.chunkIndex, true);
    view.setUint32(offset + 4, frame.bytes.length, true);
    bytes.set(frame.bytes, offset + 8);
    offset += 8 + frame.bytes.length;
  }

  return buffer;
}

/*
 * Stand-in for rrweb's Replayer. Records everything the engine does to it,
 * and mimics the two behaviours the engine depends on: the clock advances
 * only while playing, and the first play/pause rebuilds the snapshot
 * (rrweb casts the FullSnapshot synchronously on the first transport call).
 */
class FakeReplayer implements ReplayerLike {
  public readonly iframe: HTMLIFrameElement;
  public readonly wrapper: HTMLElement;
  public readonly initialEvents: Array<SessionReplayRecordedEvent>;
  public readonly constructorConfig: Record<string, unknown>;
  public readonly added: Array<SessionReplayRecordedEvent> = [];
  public readonly playOffsets: Array<number | undefined> = [];
  public readonly pauseOffsets: Array<number | undefined> = [];
  public readonly configs: Array<Record<string, unknown>> = [];
  public readonly handlers: Map<string, Array<(payload: unknown) => void>> =
    new Map<string, Array<(payload: unknown) => void>>();
  public isDestroyed: boolean = false;
  public isPlaying: boolean = false;
  public currentTimeMs: number = 0;
  public autoRebuild: boolean = true;
  public addEventError: Error | null = null;
  private hasRebuilt: boolean = false;

  public constructor(
    events: Array<SessionReplayRecordedEvent>,
    config?: Record<string, unknown>,
  ) {
    this.initialEvents = events;
    this.constructorConfig = config ?? {};
    this.iframe = document.createElement("iframe");
    this.wrapper = document.createElement("div");
  }

  public play(timeOffsetMs?: number): void {
    this.playOffsets.push(timeOffsetMs);

    if (timeOffsetMs !== undefined) {
      this.currentTimeMs = timeOffsetMs;
    }

    this.isPlaying = true;
    this.rebuildOnce();
  }

  public pause(timeOffsetMs?: number): void {
    this.pauseOffsets.push(timeOffsetMs);

    if (timeOffsetMs !== undefined) {
      this.currentTimeMs = timeOffsetMs;
    }

    this.isPlaying = false;
    this.rebuildOnce();
  }

  public destroy(): void {
    this.isDestroyed = true;
    this.isPlaying = false;
  }

  public addEvent(event: SessionReplayRecordedEvent): void {
    if (this.addEventError) {
      throw this.addEventError;
    }

    this.added.push(event);
  }

  public getCurrentTime(): number {
    return this.currentTimeMs;
  }

  public setConfig(config: Record<string, unknown>): void {
    this.configs.push(config);
  }

  public on(event: string, handler: (payload: unknown) => void): unknown {
    const list: Array<(payload: unknown) => void> =
      this.handlers.get(event) ?? [];
    list.push(handler);
    this.handlers.set(event, list);
    return this;
  }

  public emit(event: string, payload?: unknown): void {
    for (const handler of this.handlers.get(event) ?? []) {
      handler(payload);
    }
  }

  /* Wall clock passed; rrweb's clock follows only while playing. */
  public advance(ms: number, speed: number): void {
    if (this.isPlaying && !this.isDestroyed) {
      this.currentTimeMs += ms * speed;
    }
  }

  private rebuildOnce(): void {
    if (this.autoRebuild && !this.hasRebuilt) {
      this.hasRebuilt = true;
      this.emit("fullsnapshot-rebuilded", undefined);
    }
  }
}

interface HarnessOptions {
  entries: Array<SessionReplayChunkManifestEntry>;
  eventsPerChunk?: number;
  /* Per-chunk override of the events the "server" returns. */
  eventsForChunk?: (chunkIndex: number) => Array<SessionReplayRecordedEvent>;
  /* Chunk indexes the server "loses" - present in the manifest, absent from the response. */
  omitChunkIndexes?: Array<number>;
  deferFetch?: boolean;
  /* Requests containing any of these indexes reject (until `healFetch`). */
  failChunkIndexes?: Array<number>;
  /* Requests containing any of these indexes never resolve. */
  hangChunkIndexes?: Array<number>;
  autoRebuild?: boolean;
  fetchTimeoutMs?: number;
  retryDelaysMs?: Array<number>;
  headerViewport?: { width: number; height: number } | null;
  /*
   * document.hidden. While it answers true the fake Replayers' clocks are
   * frozen too, because rrweb only advances its timer inside a
   * requestAnimationFrame callback and browsers suspend those in a
   * background tab.
   */
  isDocumentHidden?: () => boolean;
}

interface Harness {
  loader: ChunkLoader;
  engine: ReplayEngine;
  replayers: Array<FakeReplayer>;
  requests: Array<Array<number>>;
  signals: Array<AbortSignal>;
  snapshots: Array<ReplayEngineSnapshot>;
  scheduled: Array<{ callback: () => void; delayMs: number }>;
  resolveFetch: () => void;
  /*
   * Release only the deferred request that carries this chunk. Ordering
   * two in-flight fetches against each other is the only way to reproduce
   * one feeding loop being retired while another is mid-await.
   */
  releaseFetch: (chunkIndex: number) => void;
  healFetch: () => void;
  now: () => number;
  /* Advance the wall clock AND every playing fake Replayer, then TICK. */
  tick: (ms: number) => Promise<void>;
  live: () => FakeReplayer;
  snapshot: () => ReplayEngineSnapshot;
}

const harnesses: Array<Harness> = [];

function makeHarness(options: HarnessOptions): Harness {
  const replayers: Array<FakeReplayer> = [];
  const requests: Array<Array<number>> = [];
  const signals: Array<AbortSignal> = [];
  const snapshots: Array<ReplayEngineSnapshot> = [];
  const scheduled: Array<{ callback: () => void; delayMs: number }> = [];
  const pending: Array<{ chunkIndexes: Array<number>; resolve: () => void }> =
    [];
  const omitted: Set<number> = new Set<number>(options.omitChunkIndexes ?? []);
  const failing: Set<number> = new Set<number>(options.failChunkIndexes ?? []);
  const hanging: Set<number> = new Set<number>(options.hangChunkIndexes ?? []);
  let clock: number = 10_000;

  const loader: ChunkLoader = new ChunkLoader({
    sessionId: "sess-1",
    tabId: "tab-1",
    entries: options.entries,
    fetchTimeoutMs: options.fetchTimeoutMs ?? 2000,
    retryDelaysMs: options.retryDelaysMs ?? [1, 1],
    fetcher: (
      request: SessionReplayChunkFetchRequest,
    ): Promise<ArrayBuffer> => {
      requests.push([...request.chunkIndexes]);

      if (request.signal) {
        signals.push(request.signal);
      }

      if (
        request.chunkIndexes.some((chunkIndex: number): boolean => {
          return hanging.has(chunkIndex);
        })
      ) {
        return new Promise<ArrayBuffer>((): void => {
          // Never resolves: the timeout is what ends it.
        });
      }

      if (
        request.chunkIndexes.some((chunkIndex: number): boolean => {
          return failing.has(chunkIndex);
        })
      ) {
        return Promise.reject(
          new Error("Could not load recording data (HTTP 503)."),
        );
      }

      const buffer: ArrayBuffer = encodeFrames(
        request.chunkIndexes
          .filter((chunkIndex: number): boolean => {
            return !omitted.has(chunkIndex);
          })
          .map(
            (
              chunkIndex: number,
            ): {
              chunkIndex: number;
              events: Array<SessionReplayRecordedEvent>;
            } => {
              return {
                chunkIndex: chunkIndex,
                events: options.eventsForChunk
                  ? options.eventsForChunk(chunkIndex)
                  : eventsFor(chunkIndex, options.eventsPerChunk ?? 2),
              };
            },
          ),
      );

      if (!options.deferFetch) {
        return Promise.resolve(buffer);
      }

      const requested: Array<number> = [...request.chunkIndexes];

      return new Promise<ArrayBuffer>((resolve: (b: ArrayBuffer) => void) => {
        pending.push({
          chunkIndexes: requested,
          resolve: (): void => {
            resolve(buffer);
          },
        });
      });
    },
  });

  const engine: ReplayEngine = createReplayEngine(
    {
      loader: loader,
      createReplayer: (
        events: Array<SessionReplayRecordedEvent>,
        config: Record<string, unknown>,
      ): ReplayerLike => {
        const replayer: FakeReplayer = new FakeReplayer(events, config);
        replayer.autoRebuild = options.autoRebuild ?? true;
        replayers.push(replayer);
        return replayer;
      },
      now: (): number => {
        return clock;
      },
      schedule: (
        callback: () => void,
        delayMs: number,
      ): ReplayScheduleHandle => {
        scheduled.push({ callback: callback, delayMs: delayMs });
        return scheduled.length;
      },
      cancel: (): void => {
        // Recorded callbacks are never run; tests drive TICK themselves.
      },
      isDocumentHidden: options.isDocumentHidden,
    },
    {
      tabId: "tab-1",
      headerViewport: options.headerViewport ?? null,
    },
  );

  engine.subscribe((snapshot: ReplayEngineSnapshot): void => {
    snapshots.push(snapshot);
  });

  const harness: Harness = {
    loader: loader,
    engine: engine,
    replayers: replayers,
    requests: requests,
    signals: signals,
    snapshots: snapshots,
    scheduled: scheduled,
    resolveFetch: (): void => {
      const waiting: Array<{
        chunkIndexes: Array<number>;
        resolve: () => void;
      }> = [...pending];
      pending.length = 0;

      for (const request of waiting) {
        request.resolve();
      }
    },
    releaseFetch: (chunkIndex: number): void => {
      const matching: Array<{
        chunkIndexes: Array<number>;
        resolve: () => void;
      }> = pending.filter(
        (request: {
          chunkIndexes: Array<number>;
          resolve: () => void;
        }): boolean => {
          return request.chunkIndexes.includes(chunkIndex);
        },
      );

      for (const request of matching) {
        pending.splice(pending.indexOf(request), 1);
        request.resolve();
      }
    },
    healFetch: (): void => {
      failing.clear();
      hanging.clear();
    },
    now: (): number => {
      return clock;
    },
    tick: async (ms: number): Promise<void> => {
      clock += ms;
      const speed: number = engine.getSnapshot().speed;
      /* rrweb's clock rides requestAnimationFrame, which a hidden tab suspends. */
      const isHidden: boolean = options.isDocumentHidden?.() ?? false;

      for (const replayer of replayers) {
        replayer.advance(isHidden ? 0 : ms, speed);
      }

      engine.dispatch({ type: "TICK", nowMs: clock });
      await flush();
    },
    live: (): FakeReplayer => {
      const candidates: Array<FakeReplayer> = replayers.filter(
        (replayer: FakeReplayer): boolean => {
          return !replayer.isDestroyed;
        },
      );
      const last: FakeReplayer | undefined = candidates[candidates.length - 1];

      if (!last) {
        throw new Error("No live Replayer");
      }

      return last;
    },
    snapshot: (): ReplayEngineSnapshot => {
      return engine.getSnapshot();
    },
  };

  harnesses.push(harness);

  return harness;
}

/* Lets every queued microtask and zero-delay timer (the awaits inside the engine and loader) run. */
async function flush(): Promise<void> {
  for (let i: number = 0; i < 6; i++) {
    await new Promise<void>((resolve: () => void) => {
      setTimeout(resolve, 0);
    });
  }
}

/*
 * Waits for a condition the engine reaches through REAL timers (the chunk
 * fetch timeout and its retry backoffs are setTimeout-driven).
 *
 * Sleeping for a fixed span instead - which this suite used to do - races
 * the machine: eight jest workers on a loaded box can leave the event loop
 * starved past any budget picked to look generous, so the assertion fails
 * on CI and passes on a quiet laptop, which is the worst kind of test.
 * Polling for the outcome keeps the timing real while making the wait
 * depend on the engine's progress rather than on the wall clock.
 */
async function waitUntil(
  predicate: () => boolean,
  timeoutMs: number = 5000,
): Promise<void> {
  const deadline: number = Date.now() + timeoutMs;

  while (!predicate()) {
    if (Date.now() > deadline) {
      throw new Error(
        `waitUntil: condition still false after ${timeoutMs}ms of real time`,
      );
    }

    await new Promise<void>((resolve: () => void) => {
      setTimeout(resolve, 5);
    });
  }

  await flush();
}

async function loadAndFlush(
  harness: Harness,
  anchor: number,
  targetMs: number,
): Promise<void> {
  harness.engine.dispatch({
    type: "LOAD",
    anchorChunkIndex: anchor,
    targetMs: targetMs,
  });
  await flush();
}

function dataOf(events: Array<SessionReplayRecordedEvent>): Array<unknown> {
  return events.map((event: SessionReplayRecordedEvent): unknown => {
    return event.data;
  });
}

afterEach(() => {
  /*
   * (g) The watchdog is a backstop, not a mechanism: if any scenario in
   * this file needed it, the state machine has a hole the scenario should
   * have pinned directly.
   */
  const finished: Array<Harness> = [...harnesses];
  /*
   * Cleared before the assertion, not after: a harness left in the list by
   * a throwing expectation would be re-asserted (and re-disposed) in the
   * NEXT test's afterEach, reporting one failure as two.
   */
  harnesses.length = 0;

  for (const harness of finished) {
    harness.engine.dispose();
  }

  for (const harness of finished) {
    expect(harness.engine.getDiagnostics().watchdogFireCount).toBe(0);
  }
});

describe("ReplayEngine chunk feeding", () => {
  it("feeds the contiguous next chunk into the live Replayer", async () => {
    const harness: Harness = makeHarness({
      entries: [
        makeEntry(0, { hasFullSnapshot: true }),
        makeEntry(1),
        makeEntry(2),
        makeEntry(3),
      ],
    });

    await loadAndFlush(harness, 0, 0);

    expect(harness.replayers.length).toBe(1);

    /*
     * The priority pair (0 and 1) is decoded before the Replayer exists,
     * so chunk 1 rides in the constructor; the fed range says so.
     */
    expect(harness.snapshot().fedRange).toEqual({
      fromMs: 0,
      toMs: 2 * CHUNK_MS,
    });
    expect(harness.snapshot().loadedChunkIndexes).toEqual([0, 1]);

    /* The feed-ahead window (30s) is now exactly used up: the tick extends. */
    await harness.tick(16);

    expect(dataOf(harness.replayers[0]!.added)).toEqual([
      { chunkIndex: 2, sequence: 0 },
      { chunkIndex: 2, sequence: 1 },
    ]);
    expect(harness.snapshot().loadedChunkIndexes).toEqual([0, 1, 2]);
    expect(harness.snapshot().lastGap).toBeNull();
    expect(harness.snapshot().error).toBeNull();
  });

  it("never treats a chunk that failed to decode as fed", async () => {
    /*
     * The regression this whole file exists for. Chunk 1 is in the manifest
     * but the response does not carry it. Advancing lastFedChunkIndex anyway
     * would make the next tick feed chunk 2 into a Replayer that never
     * received 1 - a silent jump rendered as though it were continuous
     * footage, which is the one failure the design forbids outright.
     */
    const harness: Harness = makeHarness({
      entries: [
        makeEntry(0, { hasFullSnapshot: true }),
        makeEntry(1),
        makeEntry(2, { hasFullSnapshot: true }),
        makeEntry(3),
      ],
      omitChunkIndexes: [1],
    });

    await loadAndFlush(harness, 0, 0);
    harness.engine.dispatch({ type: "PLAY" });

    expect(harness.replayers.length).toBe(1);

    // Discover the failure.
    await harness.tick(16);

    // Nothing from chunk 2 may have reached the first Replayer.
    expect(harness.replayers[0]!.added).toEqual([]);
    expect(harness.snapshot().buffer).toBe("gap-pending");
    expect(harness.snapshot().phase).toBe("playing");

    // Play out the footage we do have, which is what releases the jump.
    harness.replayers[0]!.currentTimeMs = CHUNK_MS;
    await harness.tick(16);

    expect(harness.snapshot().lastGap).toEqual({
      fromIndex: 0,
      toIndex: 2,
      missingMs: CHUNK_MS,
    });
    expect(harness.replayers[0]!.added).toEqual([]);
    expect(harness.replayers[0]!.isDestroyed).toBe(true);

    // Playback resumed by re-anchoring on the next full snapshot, not by guessing.
    expect(harness.replayers.length).toBe(2);
    expect(dataOf(harness.replayers[1]!.initialEvents)).toEqual(
      expect.arrayContaining([
        { chunkIndex: 2, sequence: 0 },
        { chunkIndex: 2, sequence: 1 },
      ]),
    );
    /* The viewer pressed Play; the jump must not land paused. */
    expect(harness.snapshot().intent).toBe("playing");
    expect(harness.replayers[1]!.playOffsets.length).toBeGreaterThan(0);
  });

  it("halts, retryable, rather than skipping when nothing can anchor after a failed chunk", async () => {
    const harness: Harness = makeHarness({
      entries: [makeEntry(0, { hasFullSnapshot: true }), makeEntry(1)],
      omitChunkIndexes: [1],
    });

    await loadAndFlush(harness, 0, 0);
    await harness.tick(16);

    expect(harness.replayers[0]!.added).toEqual([]);
    expect(harness.snapshot().phase).toBe("error");
    expect(harness.snapshot().error?.message).toContain("no later snapshot");
    expect(harness.snapshot().error?.retryable).toBe(true);

    /*
     * And it stops trying. The tick runs many times a second and the fed
     * range can never advance past this, so retrying would re-POST /chunks
     * for footage that is not coming back.
     */
    const requestsAfterFailure: number = harness.requests.length;
    await harness.tick(250);
    await harness.tick(250);
    await harness.tick(250);

    expect(harness.snapshot().phase).toBe("error");
    expect(harness.requests.length).toBe(requestsAfterFailure);
  });

  it("(a) advances lastFedChunkIndex only after addEvent took the events", async () => {
    const harness: Harness = makeHarness({
      entries: [
        makeEntry(0, { hasFullSnapshot: true }),
        makeEntry(1),
        makeEntry(2),
        makeEntry(3),
      ],
    });

    await loadAndFlush(harness, 0, 0);
    expect(harness.engine.getDiagnostics().lastFedChunkIndex).toBe(1);

    harness.replayers[0]!.addEventError = new Error("node 42 not found");
    await harness.tick(16);

    expect(harness.engine.getDiagnostics().lastFedChunkIndex).toBe(1);
    expect(harness.snapshot().fedRange?.toMs).toBe(2 * CHUNK_MS);
    expect(harness.snapshot().phase).toBe("error");
    expect(harness.snapshot().error?.retryable).toBe(true);
  });

  it("treats a zero-event closing chunk as the end, not as a broken chunk", async () => {
    /*
     * The recorder closes a tab with an empty chunk that carries the close
     * time. It is a terminator, not footage: playing past chunk 1 ends the
     * recording cleanly instead of raising "could not be loaded".
     */
    const harness: Harness = makeHarness({
      entries: [
        makeEntry(0, { hasFullSnapshot: true }),
        makeEntry(1),
        makeEntry(2, { eventCount: 0 }),
      ],
    });

    await loadAndFlush(harness, 0, 0);
    harness.engine.dispatch({ type: "PLAY" });

    expect(harness.snapshot().durationMs).toBe(2 * CHUNK_MS);

    await harness.tick(16);
    harness.live().emit("finish");

    expect(harness.snapshot().phase).toBe("ended");
    expect(harness.snapshot().error).toBeNull();
    expect(harness.snapshot().currentTimeMs).toBe(2 * CHUNK_MS);
  });
});

describe("ReplayEngine Replayer construction", () => {
  it("borrows the next contiguous chunk when the anchor has a single event", async () => {
    /*
     * rrweb 2.1.1 throws "Replayer need at least 2 events." out of its
     * constructor whenever liveMode is false and fewer than two events are
     * passed. A one-event anchor is exactly what splitting an oversized
     * FullSnapshot produces for its final part - the part that carries
     * hasFullSnapshot.
     */
    const harness: Harness = makeHarness({
      entries: [makeEntry(0, { hasFullSnapshot: true }), makeEntry(1)],
      eventsPerChunk: 1,
    });

    await loadAndFlush(harness, 0, 0);

    expect(harness.snapshot().error).toBeNull();
    expect(harness.replayers.length).toBe(1);
    expect(harness.replayers[0]!.initialEvents.length).toBeGreaterThanOrEqual(
      2,
    );
  });

  it("gives a domain message when a single event is all there is", async () => {
    const harness: Harness = makeHarness({
      entries: [makeEntry(0, { hasFullSnapshot: true })],
      eventsPerChunk: 1,
    });

    await loadAndFlush(harness, 0, 0);

    expect(harness.replayers.length).toBe(0);
    expect(harness.snapshot().phase).toBe("error");
    expect(harness.snapshot().error?.message).toContain("too short to play");
    // Never rrweb's own string.
    expect(harness.snapshot().error?.message).not.toContain(
      "Replayer need at least",
    );
  });

  it("synthesises a Meta event for an anchor that is a lone FullSnapshot", async () => {
    /*
     * rrweb creates its iframe hidden and the ONLY thing that shows it is
     * a Meta event. The recorder puts an oversized FullSnapshot alone in
     * its chunk, with the Meta in the previous one, so every anchor on a
     * large-DOM page used to play as an empty grey box with a moving clock.
     */
    const harness: Harness = makeHarness({
      entries: [makeEntry(0), makeEntry(1, { hasFullSnapshot: true })],
      eventsForChunk: (
        chunkIndex: number,
      ): Array<SessionReplayRecordedEvent> => {
        if (chunkIndex === 0) {
          return [
            {
              type: RRWEB_EVENT_TYPE_META,
              timestamp: CLIENT_CLOCK_BASE_MS,
              data: {
                href: "https://app.example.com/big",
                width: 1920,
                height: 1080,
              },
            },
            {
              type: RRWEB_EVENT_TYPE_INCREMENTAL,
              timestamp: CLIENT_CLOCK_BASE_MS + 10,
              data: { source: 1 },
            },
          ];
        }

        return [
          {
            type: RRWEB_EVENT_TYPE_FULL_SNAPSHOT,
            timestamp: CLIENT_CLOCK_BASE_MS + CHUNK_MS,
            data: { node: {} },
          },
        ];
      },
    });

    await loadAndFlush(harness, 1, CHUNK_MS);

    expect(harness.snapshot().error).toBeNull();
    expect(harness.replayers.length).toBe(1);

    const first: SessionReplayRecordedEvent | undefined =
      harness.replayers[0]!.initialEvents[0];

    expect(first?.type).toBe(RRWEB_EVENT_TYPE_META);
    /* Dimensions come from the previous chunk's real Meta, not a guess. */
    expect(first?.data).toEqual(
      expect.objectContaining({ width: 1920, height: 1080 }),
    );
    expect(first?.timestamp).toBeLessThanOrEqual(
      harness.replayers[0]!.initialEvents[1]!.timestamp,
    );
  });

  it("falls back to the header viewport for the synthesised Meta", async () => {
    const harness: Harness = makeHarness({
      entries: [makeEntry(3, { hasFullSnapshot: true }), makeEntry(4)],
      headerViewport: { width: 390, height: 844 },
      eventsForChunk: (
        chunkIndex: number,
      ): Array<SessionReplayRecordedEvent> => {
        return [
          {
            type:
              chunkIndex === 3
                ? RRWEB_EVENT_TYPE_FULL_SNAPSHOT
                : RRWEB_EVENT_TYPE_INCREMENTAL,
            timestamp: CLIENT_CLOCK_BASE_MS + chunkIndex * CHUNK_MS,
            data: {},
          },
        ];
      },
    });

    await loadAndFlush(harness, 3, 3 * CHUNK_MS);

    const first: SessionReplayRecordedEvent | undefined =
      harness.replayers[0]!.initialEvents[0];

    expect(first?.type).toBe(RRWEB_EVENT_TYPE_META);
    expect(first?.data).toEqual(
      expect.objectContaining({ width: 390, height: 844 }),
    );
  });
});

describe("ReplayEngine playback clock", () => {
  it("reports offsets from the manifest, not from end-user event timestamps", async () => {
    /*
     * Event timestamps are raw Date.now() values from the recorded machine.
     * Deriving the segment base from them puts the playhead clockSkewMs away
     * from the bands and markers, which come from the manifest.
     */
    const harness: Harness = makeHarness({
      entries: [
        makeEntry(0),
        makeEntry(1),
        makeEntry(2, { hasFullSnapshot: true }),
      ],
    });

    await loadAndFlush(harness, 2, 2 * CHUNK_MS);

    harness.replayers[0]!.currentTimeMs = 5000;
    await harness.tick(0);

    // Chunk 2 starts at 30000ms into the session.
    expect(harness.snapshot().currentTimeMs).toBe(35000);
  });

  it("(b) never moves the clock backwards except on SEEK", async () => {
    const harness: Harness = makeHarness({
      entries: [
        makeEntry(0, { hasFullSnapshot: true }),
        makeEntry(1),
        makeEntry(2),
        makeEntry(3),
      ],
    });

    await loadAndFlush(harness, 0, 0);
    harness.engine.dispatch({ type: "PLAY" });

    for (let i: number = 0; i < 20; i++) {
      await harness.tick(500);
    }

    /* A stall in the middle: rrweb drains, the engine extends, playback resumes. */
    harness.live().emit("finish");
    await flush();

    for (let i: number = 0; i < 10; i++) {
      await harness.tick(500);
    }

    let previous: number = -1;

    for (const snapshot of harness.snapshots) {
      expect(snapshot.currentTimeMs).toBeGreaterThanOrEqual(previous);
      previous = snapshot.currentTimeMs;
    }
  });

  it("(c) reports the seek target during a rebuild, never 0", async () => {
    const harness: Harness = makeHarness({
      entries: [
        makeEntry(0, { hasFullSnapshot: true }),
        makeEntry(1),
        makeEntry(2, { hasFullSnapshot: true }),
        makeEntry(3),
      ],
      deferFetch: true,
    });

    harness.engine.dispatch({ type: "LOAD", anchorChunkIndex: 0, targetMs: 0 });
    harness.resolveFetch();
    await flush();
    harness.resolveFetch();
    await flush();

    expect(harness.replayers.length).toBe(1);

    const target: number = 2 * CHUNK_MS + 4000;
    const publishedBeforeSeek: number = harness.snapshots.length;
    harness.engine.dispatch({ type: "SEEK", offsetMs: target, token: 1 });

    /* The fetch for chunk 2 is still in flight: this is the rebuild window. */
    expect(harness.snapshot().phase).toBe("seeking");
    expect(harness.snapshot().currentTimeMs).toBe(target);
    expect(harness.snapshot().pendingSeekMs).toBe(target);

    await harness.tick(250);
    expect(harness.snapshot().currentTimeMs).toBe(target);

    harness.resolveFetch();
    await flush();
    harness.resolveFetch();
    await flush();

    expect(harness.snapshot().phase).toBe("paused");
    expect(harness.snapshot().currentTimeMs).toBe(target);
    expect(harness.snapshot().pendingSeekMs).toBeNull();
    expect(harness.replayers[1]!.pauseOffsets).toEqual([4000]);

    /* Every snapshot published from the seek onward carries the target. */
    for (const snapshot of harness.snapshots.slice(publishedBeforeSeek)) {
      expect(snapshot.currentTimeMs).toBe(target);
    }
  });
});

describe("ReplayEngine transport state", () => {
  it("honours a Play pressed while the first chunk is still loading", async () => {
    const harness: Harness = makeHarness({
      entries: [makeEntry(0, { hasFullSnapshot: true }), makeEntry(1)],
      deferFetch: true,
    });

    harness.engine.dispatch({ type: "LOAD", anchorChunkIndex: 0, targetMs: 0 });
    await flush();
    expect(harness.replayers.length).toBe(0);
    expect(harness.snapshot().phase).toBe("seeking");

    // The viewer presses Play while the fetch is still in flight.
    harness.engine.dispatch({ type: "PLAY" });
    expect(harness.snapshot().phase).toBe("buffering");

    harness.resolveFetch();
    await flush();

    expect(harness.replayers.length).toBe(1);
    expect(harness.replayers[0]!.playOffsets).toEqual([0]);
    expect(harness.replayers[0]!.pauseOffsets).toEqual([]);
    expect(harness.snapshot().phase).toBe("playing");
  });

  it("applies a Play pressed after the Replayer already exists", async () => {
    /*
     * The plain case, and the one the reported "Play does nothing" was
     * about. Anything that leaves the intent and the applied state out of
     * step - a rebuild, an error, a Replayer swapped between the press and
     * the apply - used to leave the button saying "playing" over a stage
     * that was not. Here the phase is DERIVED from the intent, so the
     * button and the stage cannot disagree.
     */
    const harness: Harness = makeHarness({
      entries: [makeEntry(0, { hasFullSnapshot: true }), makeEntry(1)],
    });

    await loadAndFlush(harness, 0, 0);

    expect(harness.replayers.length).toBe(1);
    expect(harness.replayers[0]!.playOffsets).toEqual([]);
    expect(harness.snapshot().phase).toBe("paused");

    harness.engine.dispatch({ type: "PLAY" });

    expect(harness.replayers[0]!.playOffsets).toEqual([0]);
    expect(harness.snapshot().phase).toBe("playing");

    /* Idempotent: a second PLAY does not restart rrweb's timer. */
    harness.engine.dispatch({ type: "PLAY" });
    expect(harness.replayers[0]!.playOffsets).toEqual([0]);

    harness.engine.dispatch({ type: "PAUSE" });

    /*
     * Pausing is applied to the SAME Replayer, not by rebuilding one. The
     * leading 0 is the build's own pause(withinSegment); the undefined is
     * this press, which pauses in place rather than seeking.
     */
    expect(harness.replayers.length).toBe(1);
    expect(harness.replayers[0]!.pauseOffsets).toEqual([0, undefined]);
    expect(harness.snapshot().phase).toBe("paused");
  });

  it("does not re-issue play on a rebuild that already applied the intent", async () => {
    /*
     * A rebuild - a seek across a snapshot anchor, or a gap jump - applies
     * the current transport state itself. Re-asserting it afterwards would
     * restart rrweb's timer at the same offset on every one of them.
     */
    const harness: Harness = makeHarness({
      entries: [
        makeEntry(0, { hasFullSnapshot: true }),
        makeEntry(1),
        makeEntry(2, { hasFullSnapshot: true }),
        makeEntry(3),
      ],
    });

    await loadAndFlush(harness, 0, 0);
    harness.engine.dispatch({ type: "PLAY" });

    expect(harness.replayers.length).toBe(1);
    expect(harness.replayers[0]!.playOffsets).toEqual([0]);

    /* Seek into chunk 2, which anchors a new segment. */
    harness.engine.dispatch({
      type: "SEEK",
      offsetMs: 2 * CHUNK_MS + 1000,
      token: 1,
    });
    await flush();

    expect(harness.replayers.length).toBe(2);
    expect(harness.replayers[1]!.playOffsets).toEqual([1000]);
  });

  it("(d) turns a Finish with footage left into a stall and extends immediately", async () => {
    /*
     * rrweb emits Finish whenever it drains what it has been given, which
     * with chunk streaming is a stall rather than the end. The old stage
     * waited for the next 200ms tick (or the next press of Play) to fetch;
     * the engine fetches NOW, and the phase says "buffering" meanwhile so
     * the frozen picture is explained.
     */
    const harness: Harness = makeHarness({
      entries: [
        makeEntry(0, { hasFullSnapshot: true }),
        makeEntry(1),
        makeEntry(2),
      ],
      deferFetch: true,
    });

    harness.engine.dispatch({ type: "LOAD", anchorChunkIndex: 0, targetMs: 0 });
    harness.engine.dispatch({ type: "PLAY" });
    harness.resolveFetch();
    await flush();

    expect(harness.replayers.length).toBe(1);
    expect(harness.replayers[0]!.added).toEqual([]);

    /* The stall: rrweb ran out of events while more chunks exist. */
    harness.replayers[0]!.emit("finish");

    expect(harness.snapshot().intent).toBe("playing");
    expect(harness.snapshot().buffer).toBe("stalled");
    expect(harness.snapshot().phase).toBe("buffering");
    expect(harness.snapshot().bufferingSinceMs).toBe(harness.now());

    /* The page fetch that loadFirst queued lands. */
    harness.resolveFetch();
    await flush();

    expect(harness.replayers[0]!.added.length).toBeGreaterThan(0);
    /* And it resumed the cast rather than only topping the buffer up. */
    expect(harness.replayers[0]!.playOffsets.length).toBeGreaterThan(1);
    expect(harness.snapshot().phase).toBe("playing");
    expect(harness.snapshot().bufferingSinceMs).toBeNull();
  });

  it("kicks a fetch immediately when Play resumes a paused stall", async () => {
    const harness: Harness = makeHarness({
      entries: [
        makeEntry(0, { hasFullSnapshot: true }),
        makeEntry(1),
        makeEntry(2),
      ],
      deferFetch: true,
    });

    harness.engine.dispatch({ type: "LOAD", anchorChunkIndex: 0, targetMs: 0 });
    harness.engine.dispatch({ type: "PLAY" });
    harness.resolveFetch();
    await flush();

    harness.replayers[0]!.emit("finish");
    harness.engine.dispatch({ type: "PAUSE" });

    expect(harness.snapshot().phase).toBe("paused");
    expect(harness.replayers[0]!.added).toEqual([]);

    const requestsBefore: number = harness.requests.length;
    harness.engine.dispatch({ type: "PLAY" });

    expect(harness.snapshot().phase).toBe("buffering");
    expect(harness.requests.length).toBeGreaterThanOrEqual(requestsBefore);

    harness.resolveFetch();
    await flush();

    expect(harness.replayers[0]!.added.length).toBeGreaterThan(0);
    expect(harness.replayers[0]!.playOffsets.length).toBeGreaterThan(1);
    expect(harness.snapshot().phase).toBe("playing");
  });

  it("rewinds to the first playable moment when Play is pressed at the end", async () => {
    const harness: Harness = makeHarness({
      entries: [makeEntry(0, { hasFullSnapshot: true }), makeEntry(1)],
    });

    await loadAndFlush(harness, 0, 0);
    harness.engine.dispatch({ type: "PLAY" });
    harness.replayers[0]!.currentTimeMs = 2 * CHUNK_MS;
    await harness.tick(0);
    harness.replayers[0]!.emit("finish");

    expect(harness.snapshot().phase).toBe("ended");
    expect(harness.snapshot().intent).toBe("paused");

    harness.engine.dispatch({ type: "PLAY" });
    await flush();

    /* Same anchor, inside the fed range: no rebuild, play(0). */
    expect(harness.replayers.length).toBe(1);
    expect(
      harness.replayers[0]!.playOffsets[
        harness.replayers[0]!.playOffsets.length - 1
      ],
    ).toBe(0);
    expect(harness.snapshot().phase).toBe("playing");
    expect(harness.snapshot().currentTimeMs).toBe(0);
  });
});

describe("ReplayEngine Replayer configuration", () => {
  it("draws the pointer trail, so recorded mouse movement is visible", async () => {
    const harness: Harness = makeHarness({
      entries: [makeEntry(0, { hasFullSnapshot: true })],
    });

    await loadAndFlush(harness, 0, 0);

    const config: Record<string, unknown> =
      harness.replayers[0]!.constructorConfig;

    expect(config["mouseTail"]).not.toBe(false);
    expect(config["mouseTail"]).toEqual(
      expect.objectContaining({ lineWidth: expect.any(Number) }),
    );
  });

  it("bounds how fast rrweb may fast-forward and uses the virtual DOM", async () => {
    const harness: Harness = makeHarness({
      entries: [makeEntry(0, { hasFullSnapshot: true })],
    });

    await loadAndFlush(harness, 0, 0);

    const config: Record<string, unknown> =
      harness.replayers[0]!.constructorConfig;

    expect(config["maxSpeed"]).toBe(8);
    expect(config["useVirtualDom"]).toBe(true);
  });

  it("never enables canvas replay, which would drop the iframe sandbox", async () => {
    const harness: Harness = makeHarness({
      entries: [makeEntry(0, { hasFullSnapshot: true })],
    });

    await loadAndFlush(harness, 0, 0);

    expect(harness.replayers[0]!.constructorConfig["UNSAFE_replayCanvas"]).toBe(
      false,
    );
  });

  it("(f) never sets rrweb's own skipInactive, even when the viewer turns skip-idle on", async () => {
    const harness: Harness = makeHarness({
      entries: [makeEntry(0, { hasFullSnapshot: true }), makeEntry(1)],
    });

    harness.engine.dispatch({ type: "SET_SKIP_INACTIVE", enabled: true });
    await loadAndFlush(harness, 0, 0);
    harness.engine.dispatch({ type: "SET_SPEED", speed: 4 });

    expect(harness.snapshot().skipInactive).toBe(true);
    expect(harness.replayers[0]!.constructorConfig["skipInactive"]).toBe(false);

    for (const config of harness.replayers[0]!.configs) {
      expect(config["skipInactive"]).not.toBe(true);
    }
  });

  it("raises the feed-ahead window with the speed", async () => {
    const harness: Harness = makeHarness({
      entries: [makeEntry(0, { hasFullSnapshot: true })],
    });

    expect(harness.snapshot().feedAheadMs).toBe(REPLAY_FEED_AHEAD_MIN_MS);

    harness.engine.dispatch({ type: "SET_SPEED", speed: 8 });
    expect(harness.snapshot().feedAheadMs).toBe(160000);

    harness.engine.dispatch({ type: "SET_SPEED", speed: 1 });
    expect(harness.snapshot().feedAheadMs).toBe(REPLAY_FEED_AHEAD_MIN_MS);

    await loadAndFlush(harness, 0, 0);
    harness.engine.dispatch({ type: "SET_SPEED", speed: 2 });

    expect(harness.replayers[0]!.configs).toContainEqual({ speed: 2 });
  });
});

describe("ReplayEngine finish handling", () => {
  it("does not stop playback when rrweb drains its buffer mid-recording", async () => {
    const harness: Harness = makeHarness({
      entries: [
        makeEntry(0, { hasFullSnapshot: true }),
        makeEntry(1),
        makeEntry(2),
      ],
    });

    await loadAndFlush(harness, 0, 0);
    harness.engine.dispatch({ type: "PLAY" });

    const finish: Array<(payload: unknown) => void> | undefined =
      harness.replayers[0]!.handlers.get("finish");

    expect(finish).toBeDefined();

    harness.replayers[0]!.emit("finish");

    /*
     * There is still footage to feed, so this Finish is a stall waiting on
     * /chunks. Reporting it as "not playing" would stop the session for good:
     * later addEvent calls append to a machine that has already ended.
     */
    expect(harness.snapshot().intent).toBe("playing");
    expect(harness.snapshot().phase).not.toBe("ended");
  });

  it("stops playback when the recording genuinely ends", async () => {
    const harness: Harness = makeHarness({
      entries: [makeEntry(0, { hasFullSnapshot: true })],
    });

    await loadAndFlush(harness, 0, 0);
    harness.engine.dispatch({ type: "PLAY" });
    harness.replayers[0]!.emit("finish");

    expect(harness.snapshot().phase).toBe("ended");
    expect(harness.snapshot().intent).toBe("paused");
  });

  it("ignores a Finish from a Replayer that has been retired", async () => {
    /*
     * rrweb schedules Finish 50ms after the last cast and destroy() does
     * not cancel it. Without the identity guard a retired Replayer's
     * Finish landed in the NEW segment and paused it, so a quarter of gap
     * jumps used to land with the button reading Play.
     */
    const harness: Harness = makeHarness({
      entries: [
        makeEntry(0, { hasFullSnapshot: true }),
        makeEntry(1),
        makeEntry(2, { hasFullSnapshot: true }),
      ],
    });

    await loadAndFlush(harness, 0, 0);
    harness.engine.dispatch({ type: "PLAY" });
    harness.engine.dispatch({ type: "SEEK", offsetMs: 2 * CHUNK_MS, token: 1 });
    await flush();

    expect(harness.replayers.length).toBe(2);

    const before: ReplayEngineSnapshot = harness.snapshot();
    harness.replayers[0]!.emit("finish");

    expect(harness.snapshot().intent).toBe(before.intent);
    expect(harness.snapshot().buffer).toBe(before.buffer);
    expect(harness.snapshot().phase).toBe("playing");
  });
});

describe("ReplayEngine seeks", () => {
  it("feeds forward into the live Replayer for a seek ahead of the fed range (case 2)", async () => {
    /*
     * ArrowRight three times, or a marker 40s ahead inside a 60s checkout
     * interval, used to destroy the Replayer, drop the decoded LRU,
     * re-fetch and rebuild from the snapshot - a blank stage for a small
     * forward seek that a video player would treat as instantaneous.
     */
    const harness: Harness = makeHarness({
      entries: Array.from(
        { length: 8 },
        (_unused: unknown, index: number): SessionReplayChunkManifestEntry => {
          return makeEntry(index, { hasFullSnapshot: index === 0 });
        },
      ),
    });

    await loadAndFlush(harness, 0, 0);
    expect(harness.snapshot().fedRange?.toMs).toBe(2 * CHUNK_MS);

    const target: number = 4 * CHUNK_MS + 1000;
    harness.engine.dispatch({ type: "SEEK", offsetMs: target, token: 1 });

    expect(harness.snapshot().phase).toBe("seeking");
    expect(harness.snapshot().currentTimeMs).toBe(target);

    await flush();

    expect(harness.replayers.length).toBe(1);

    const fedFirstEvents: Array<unknown> = dataOf(
      harness.replayers[0]!.added,
    ).filter((data: unknown): boolean => {
      return (data as { sequence: number }).sequence === 0;
    });

    /* Chunks 2, 3 and 4 in order reached the target... */
    expect(fedFirstEvents.slice(0, 3)).toEqual([
      { chunkIndex: 2, sequence: 0 },
      { chunkIndex: 3, sequence: 0 },
      { chunkIndex: 4, sequence: 0 },
    ]);
    expect(harness.replayers[0]!.pauseOffsets).toEqual([0, target]);
    expect(harness.snapshot().phase).toBe("paused");
    /* ...and the feeder kept its 30s of headroom past the new playhead. */
    expect(harness.snapshot().fedRange?.toMs).toBeGreaterThanOrEqual(
      5 * CHUNK_MS,
    );
    expect(harness.snapshot().fedRange?.toMs).toBeGreaterThanOrEqual(
      target + REPLAY_FEED_AHEAD_MIN_MS,
    );
  });

  it("rebuilds instead of feeding when the seek is more than 90s past the fed range", async () => {
    const harness: Harness = makeHarness({
      entries: Array.from(
        { length: 12 },
        (_unused: unknown, index: number): SessionReplayChunkManifestEntry => {
          return makeEntry(index, { hasFullSnapshot: index === 0 });
        },
      ),
    });

    await loadAndFlush(harness, 0, 0);

    /* fedUntil is 30s; 9 * 15s = 135s is 105s past it. */
    harness.engine.dispatch({ type: "SEEK", offsetMs: 9 * CHUNK_MS, token: 1 });
    await flush();

    expect(harness.replayers.length).toBe(2);
    expect(harness.snapshot().currentTimeMs).toBe(9 * CHUNK_MS);
  });

  it("seeks within the fed range without a rebuild and clears a stall", async () => {
    const harness: Harness = makeHarness({
      entries: [
        makeEntry(0, { hasFullSnapshot: true }),
        makeEntry(1),
        makeEntry(2),
      ],
      deferFetch: true,
    });

    harness.engine.dispatch({ type: "LOAD", anchorChunkIndex: 0, targetMs: 0 });
    harness.engine.dispatch({ type: "PLAY" });
    harness.resolveFetch();
    await flush();

    harness.replayers[0]!.emit("finish");
    expect(harness.snapshot().buffer).toBe("stalled");

    /* Back into footage rrweb already holds. */
    harness.engine.dispatch({ type: "SEEK", offsetMs: 5000, token: 1 });

    expect(harness.replayers.length).toBe(1);
    expect(harness.replayers[0]!.playOffsets).toContain(5000);
    expect(harness.snapshot().buffer).toBe("ok");
    expect(harness.snapshot().phase).toBe("playing");
    expect(harness.snapshot().currentTimeMs).toBe(5000);
  });

  it("clamps a seek before the first snapshot onto the earliest playable moment with a notice", async () => {
    /*
     * Whenever chunk 0 cannot anchor - the oversized-snapshot layout, or a
     * session whose opening chunks were lost - pressing Play at the end,
     * ArrowLeft to the start, or a ?t=0 link used to show a red "no full
     * snapshot before that point" banner and nothing played.
     */
    const harness: Harness = makeHarness({
      entries: [
        makeEntry(0),
        makeEntry(1, { hasFullSnapshot: true }),
        makeEntry(2),
      ],
    });

    await loadAndFlush(harness, 1, CHUNK_MS);
    harness.engine.dispatch({ type: "SEEK", offsetMs: 0, token: 1 });
    await flush();

    expect(harness.snapshot().error).toBeNull();
    expect(harness.snapshot().phase).toBe("paused");
    expect(harness.snapshot().currentTimeMs).toBe(CHUNK_MS);
    expect(harness.snapshot().notice?.kind).toBe("seek-clamped");
    expect(harness.snapshot().notice?.message).toContain("0:15");
    expect(harness.snapshot().notice?.landedAtMs).toBe(CHUNK_MS);
    expect(harness.replayers.length).toBe(1);
    expect(harness.snapshot().earliestPlayableMs).toBe(CHUNK_MS);
  });

  it("re-seeks when the same offset arrives with a new token, and ignores a repeated token", async () => {
    const harness: Harness = makeHarness({
      entries: [makeEntry(0, { hasFullSnapshot: true }), makeEntry(1)],
    });

    await loadAndFlush(harness, 0, 0);

    harness.engine.dispatch({ type: "SEEK", offsetMs: 3000, token: 7 });
    harness.engine.dispatch({ type: "SEEK", offsetMs: 3000, token: 7 });
    harness.engine.dispatch({ type: "SEEK", offsetMs: 3000, token: 8 });

    expect(harness.replayers[0]!.pauseOffsets).toEqual([0, 3000, 3000]);
  });
});

describe("ReplayEngine idle skipping", () => {
  const idleEntries: Array<SessionReplayChunkManifestEntry> = Array.from(
    { length: 8 },
    (_unused: unknown, index: number): SessionReplayChunkManifestEntry => {
      return makeEntry(index, {
        hasFullSnapshot: index === 0,
        eventCount: index >= 2 && index <= 5 ? 1 : 10,
      });
    },
  );

  it("publishes coarse idle bands from the manifest before any chunk is decoded", () => {
    const harness: Harness = makeHarness({ entries: idleEntries });

    expect(harness.snapshot().idleBands).toEqual([
      {
        startMs: 2 * CHUNK_MS,
        endMs: 6 * CHUNK_MS,
        kind: "idle",
        fidelity: "coarse",
      },
    ]);
  });

  it("jumps to the end of an idle band, feeding until it is fed, and never touches rrweb's skipInactive", async () => {
    const harness: Harness = makeHarness({
      entries: idleEntries,
      eventsForChunk: (
        chunkIndex: number,
      ): Array<SessionReplayRecordedEvent> => {
        /* Idle chunks carry only a heartbeat mutation; active ones a mousemove. */
        return [
          ...eventsFor(chunkIndex, 1),
          {
            type: RRWEB_EVENT_TYPE_INCREMENTAL,
            timestamp: CLIENT_CLOCK_BASE_MS + chunkIndex * CHUNK_MS + 500,
            data: { source: chunkIndex >= 2 && chunkIndex <= 5 ? 0 : 1 },
          },
        ];
      },
    });

    harness.engine.dispatch({ type: "SET_SKIP_INACTIVE", enabled: true });
    await loadAndFlush(harness, 0, 0);
    harness.engine.dispatch({ type: "PLAY" });

    /* Play into the band. */
    harness.live().currentTimeMs = 2 * CHUNK_MS + 1000;
    await harness.tick(16);
    await flush();

    const skip: ReplayEngineSnapshot = harness.snapshot();

    expect(skip.lastIdleSkip?.kind).toBe("idle");
    expect(skip.lastIdleSkip?.startMs).toBeLessThanOrEqual(2 * CHUNK_MS + 1000);
    /*
     * Landed one second before the band ends, on the live Replayer.
     *
     * The band ends where activity actually RESUMES - chunk 6's mousemove
     * at +500ms, from that chunk's decoded events - not at the chunk
     * boundary the manifest guesses. The loader had already decoded it in
     * the first page, so the map is exact here even though playback has
     * not fed that far.
     */
    expect(harness.replayers.length).toBe(1);
    expect(skip.lastIdleSkip?.endMs).toBe(6 * CHUNK_MS + 500);
    expect(skip.lastIdleSkip?.fidelity).toBe("exact");
    expect(harness.replayers[0]!.playOffsets).toContain(
      6 * CHUNK_MS + 500 - 1000,
    );
    expect(skip.currentTimeMs).toBe(6 * CHUNK_MS + 500 - 1000);
    expect(skip.fedRange?.toMs).toBeGreaterThanOrEqual(6 * CHUNK_MS);

    for (const config of harness.replayers[0]!.configs) {
      expect(config["skipInactive"]).not.toBe(true);
    }
    expect(harness.replayers[0]!.constructorConfig["skipInactive"]).toBe(false);
  });

  it("does not skip while the toggle is off", async () => {
    const harness: Harness = makeHarness({ entries: idleEntries });

    await loadAndFlush(harness, 0, 0);
    harness.engine.dispatch({ type: "PLAY" });
    harness.live().currentTimeMs = 2 * CHUNK_MS + 1000;
    await harness.tick(16);

    expect(harness.snapshot().lastIdleSkip).toBeNull();
    /* Still inside the band: the 16ms tick moved the clock, nothing jumped. */
    expect(harness.snapshot().currentTimeMs).toBeGreaterThanOrEqual(
      2 * CHUNK_MS + 1000,
    );
    expect(harness.snapshot().currentTimeMs).toBeLessThan(2 * CHUNK_MS + 2000);
  });
});

describe("ReplayEngine tabs and live sessions", () => {
  it("preserves the session-clock playhead across a tab switch when the target tab covers it", async () => {
    const harness: Harness = makeHarness({
      entries: [
        makeEntry(0, { hasFullSnapshot: true }),
        makeEntry(1),
        makeEntry(2),
      ],
    });

    await loadAndFlush(harness, 0, 0);
    harness.replayers[0]!.currentTimeMs = 20000;
    await harness.tick(0);
    expect(harness.snapshot().currentTimeMs).toBe(20000);

    const second: ChunkLoader = new ChunkLoader({
      sessionId: "sess-1",
      tabId: "tab-2",
      entries: [
        { ...makeEntry(0, { hasFullSnapshot: true }), tabId: "tab-2" },
        { ...makeEntry(1), tabId: "tab-2" },
        { ...makeEntry(2), tabId: "tab-2" },
      ],
      fetcher: (
        request: SessionReplayChunkFetchRequest,
      ): Promise<ArrayBuffer> => {
        return Promise.resolve(
          encodeFrames(
            request.chunkIndexes.map(
              (
                chunkIndex: number,
              ): {
                chunkIndex: number;
                events: Array<SessionReplayRecordedEvent>;
              } => {
                return {
                  chunkIndex: chunkIndex,
                  events: eventsFor(chunkIndex, 2),
                };
              },
            ),
          ),
        );
      },
    });

    harness.engine.dispatch({
      type: "TAB_SWITCH",
      tabId: "tab-2",
      loader: second,
    });
    await flush();

    expect(harness.replayers.length).toBe(2);
    expect(harness.replayers[0]!.isDestroyed).toBe(true);
    expect(harness.replayers[1]!.pauseOffsets).toEqual([20000]);
    expect(harness.snapshot().activeTabId).toBe("tab-2");
    expect(harness.snapshot().currentTimeMs).toBe(20000);
  });

  it("turns an ended tab back into a stall when new manifest rows arrive", async () => {
    const harness: Harness = makeHarness({
      entries: [makeEntry(0, { hasFullSnapshot: true }), makeEntry(1)],
    });

    await loadAndFlush(harness, 0, 0);
    harness.engine.dispatch({ type: "PLAY" });
    harness.replayers[0]!.emit("finish");

    expect(harness.snapshot().phase).toBe("ended");

    harness.engine.dispatch({
      type: "APPEND_ENTRIES",
      entries: [makeEntry(2)],
    });

    expect(harness.snapshot().durationMs).toBe(3 * CHUNK_MS);
    expect(harness.snapshot().buffer).toBe("stalled");
    expect(harness.replayers.length).toBe(1);

    harness.engine.dispatch({ type: "PLAY" });
    await flush();

    /* Continues, no rewind, no rebuild. */
    expect(harness.replayers.length).toBe(1);
    expect(dataOf(harness.replayers[0]!.added)).toContainEqual({
      chunkIndex: 2,
      sequence: 0,
    });
    expect(harness.snapshot().phase).toBe("playing");
  });
});

describe("ReplayEngine failure handling", () => {
  it("(e) gives up after the retries, halts retryable, and does not hammer the API", async () => {
    const harness: Harness = makeHarness({
      entries: [
        makeEntry(0, { hasFullSnapshot: true }),
        makeEntry(1),
        makeEntry(2),
        makeEntry(3),
      ],
      failChunkIndexes: [2],
    });

    await loadAndFlush(harness, 0, 0);
    expect(harness.replayers.length).toBe(1);

    /* Chunk 2 is needed: the tick asks for it, three attempts fail. */
    await harness.tick(16);
    await flush();

    expect(harness.snapshot().phase).toBe("error");
    expect(harness.snapshot().error?.retryable).toBe(true);
    expect(harness.snapshot().error?.message).toContain("0:30");
    expect(harness.snapshot().error?.message).toContain("3 attempts");

    const requestsAfterHalt: number = harness.requests.length;

    for (let i: number = 0; i < 5; i++) {
      await harness.tick(250);
    }

    expect(harness.requests.length).toBe(requestsAfterHalt);
  });

  it("times out a hung fetch, retries twice, and RETRY rebuilds at the same anchor", async () => {
    const harness: Harness = makeHarness({
      entries: [makeEntry(0, { hasFullSnapshot: true }), makeEntry(1)],
      hangChunkIndexes: [0],
      fetchTimeoutMs: 5,
    });

    harness.engine.dispatch({ type: "LOAD", anchorChunkIndex: 0, targetMs: 0 });
    harness.engine.dispatch({ type: "PLAY" });

    /*
     * Three attempts have to time out (5ms each) with their two retry
     * backoffs before the engine halts; wait for the halt itself rather
     * than for a span of wall clock.
     */
    await waitUntil((): boolean => {
      return harness.snapshot().phase === "error";
    });

    expect(harness.snapshot().phase).toBe("error");
    expect(harness.snapshot().error?.retryable).toBe(true);
    expect(harness.snapshot().error?.message).toContain("did not respond");
    expect(harness.requests.length).toBe(3);
    expect(harness.replayers.length).toBe(0);

    harness.healFetch();
    harness.engine.dispatch({ type: "RETRY" });
    await flush();

    expect(harness.replayers.length).toBe(1);
    expect(harness.snapshot().error).toBeNull();
    /* The intent survived the failure. */
    expect(harness.snapshot().phase).toBe("playing");
    expect(harness.replayers[0]!.playOffsets).toEqual([0]);
  });

  it("(e) aborts in-flight fetches on DISPOSE and drops a late response", async () => {
    const harness: Harness = makeHarness({
      entries: [makeEntry(0, { hasFullSnapshot: true }), makeEntry(1)],
      deferFetch: true,
    });

    harness.engine.dispatch({ type: "LOAD", anchorChunkIndex: 0, targetMs: 0 });
    await flush();

    expect(harness.signals.length).toBeGreaterThan(0);
    expect(harness.signals[0]!.aborted).toBe(false);

    harness.engine.dispose();

    expect(harness.signals[0]!.aborted).toBe(true);

    harness.resolveFetch();
    await flush();

    expect(harness.replayers.length).toBe(0);
    expect(harness.loader.getDecodedChunkIndexes()).toEqual([]);
  });

  it("halts without retry when the tab has no snapshot at all", async () => {
    const harness: Harness = makeHarness({
      entries: [makeEntry(0), makeEntry(1)],
    });

    harness.engine.dispatch({ type: "SEEK", offsetMs: 0, token: 1 });

    expect(harness.snapshot().phase).toBe("error");
    expect(harness.snapshot().error?.retryable).toBe(false);
    expect(harness.snapshot().error?.message).toContain("no full DOM snapshot");
  });
});

describe("ReplayEngine hold-last-frame rebuilds", () => {
  const entries: Array<SessionReplayChunkManifestEntry> = [
    makeEntry(0, { hasFullSnapshot: true }),
    makeEntry(1),
    makeEntry(2, { hasFullSnapshot: true }),
    makeEntry(3),
  ];

  it("keeps the old Replayer visible until the new one has rebuilt its snapshot, then destroys exactly one", async () => {
    const harness: Harness = makeHarness({
      entries: entries,
      autoRebuild: false,
    });

    await loadAndFlush(harness, 0, 0);
    harness.engine.dispatch({ type: "SEEK", offsetMs: 2 * CHUNK_MS, token: 1 });
    await flush();

    expect(harness.replayers.length).toBe(2);
    expect(harness.replayers[0]!.isDestroyed).toBe(false);
    expect(harness.replayers[0]!.wrapper.style.pointerEvents).toBe("none");
    expect(harness.engine.getDiagnostics().isHoldingLastFrame).toBe(true);

    harness.replayers[1]!.emit("fullsnapshot-rebuilded");

    expect(harness.replayers[0]!.isDestroyed).toBe(true);
    expect(harness.replayers[1]!.isDestroyed).toBe(false);
    expect(harness.engine.getDiagnostics().isHoldingLastFrame).toBe(false);
    expect(harness.engine.getDiagnostics().replayersDestroyed).toBe(1);
  });

  it("destroys the old Replayer eagerly when the anchor payload is over 4MB", async () => {
    const heavy: Array<SessionReplayChunkManifestEntry> = entries.map(
      (
        entry: SessionReplayChunkManifestEntry,
      ): SessionReplayChunkManifestEntry => {
        return entry.chunkIndex === 2
          ? { ...entry, payloadBytes: 5 * 1024 * 1024 }
          : entry;
      },
    );
    const harness: Harness = makeHarness({
      entries: heavy,
      autoRebuild: false,
    });

    await loadAndFlush(harness, 0, 0);
    harness.engine.dispatch({ type: "SEEK", offsetMs: 2 * CHUNK_MS, token: 1 });

    expect(harness.replayers[0]!.isDestroyed).toBe(true);
    expect(harness.engine.getDiagnostics().isHoldingLastFrame).toBe(false);
  });

  it("drops the held frame on the scheduler's fallback if no rebuild is ever reported", async () => {
    const harness: Harness = makeHarness({
      entries: entries,
      autoRebuild: false,
    });

    await loadAndFlush(harness, 0, 0);
    harness.engine.dispatch({ type: "SEEK", offsetMs: 2 * CHUNK_MS, token: 1 });
    await flush();

    const fallback: { callback: () => void; delayMs: number } | undefined =
      harness.scheduled.find((entry: { delayMs: number }): boolean => {
        return entry.delayMs === 2000;
      });

    expect(fallback).toBeDefined();
    fallback!.callback();

    expect(harness.replayers[0]!.isDestroyed).toBe(true);
  });
});

describe("ReplayEngine gaps", () => {
  it("reports the hole it crossed and keeps playing after the jump", async () => {
    const harness: Harness = makeHarness({
      entries: [
        makeEntry(0, { hasFullSnapshot: true }),
        makeEntry(1),
        makeEntry(4, { hasFullSnapshot: true }),
        makeEntry(5),
      ],
    });

    await loadAndFlush(harness, 0, 0);
    harness.engine.dispatch({ type: "PLAY" });

    await harness.tick(16);
    expect(harness.snapshot().buffer).toBe("gap-pending");
    expect(harness.snapshot().phase).toBe("playing");

    /* Footage runs out: rrweb finishes, and the jump happens now. */
    harness.live().emit("finish");
    await flush();

    expect(harness.snapshot().lastGap).toEqual({
      fromIndex: 1,
      toIndex: 4,
      missingMs: 2 * CHUNK_MS,
    });
    expect(harness.replayers.length).toBe(2);
    expect(harness.snapshot().phase).toBe("playing");
    expect(harness.snapshot().currentTimeMs).toBe(4 * CHUNK_MS);
    expect(harness.snapshot().loadedChunkIndexes).toEqual([4, 5]);
  });

  it("holds the last frame before a hole while paused, and jumps only once Play resumes", async () => {
    const harness: Harness = makeHarness({
      entries: [
        makeEntry(0, { hasFullSnapshot: true }),
        makeEntry(1),
        makeEntry(4, { hasFullSnapshot: true }),
        makeEntry(5),
      ],
    });

    await loadAndFlush(harness, 0, 0);
    harness.engine.dispatch({ type: "PLAY" });
    await harness.tick(16);
    expect(harness.snapshot().buffer).toBe("gap-pending");

    /* The viewer pauses on the very last frame before the hole. */
    harness.engine.dispatch({ type: "PAUSE" });
    harness.engine.dispatch({ type: "SEEK", offsetMs: 2 * CHUNK_MS, token: 1 });
    await flush();

    /* Paused ticks must not swap the picture from under them. */
    await harness.tick(250);
    await harness.tick(250);

    expect(harness.replayers.length).toBe(1);
    expect(harness.snapshot().phase).toBe("paused");
    expect(harness.snapshot().lastGap).toBeNull();
    expect(harness.snapshot().currentTimeMs).toBe(2 * CHUNK_MS);

    /* Play resumes the cast; rrweb drains and finishes; NOW the jump. */
    harness.engine.dispatch({ type: "PLAY" });
    harness.live().emit("finish");
    await flush();

    expect(harness.replayers.length).toBe(2);
    expect(harness.snapshot().lastGap?.toIndex).toBe(4);
    expect(harness.snapshot().phase).toBe("playing");
    expect(harness.snapshot().currentTimeMs).toBe(4 * CHUNK_MS);
  });

  it("publishes the fed range as the seekable band, not the decoded cache", async () => {
    const harness: Harness = makeHarness({
      entries: [
        makeEntry(0, { hasFullSnapshot: true }),
        makeEntry(1),
        makeEntry(2),
      ],
    });

    await loadAndFlush(harness, 0, 0);
    harness.loader.evictOutsideWindow(99, 0);

    expect(harness.loader.getDecodedChunkIndexes()).toEqual([]);
    /* rrweb still holds 0 and 1; the band must say so. */
    expect(harness.snapshot().loadedChunkIndexes).toEqual([0, 1]);
  });
});

describe("ReplayEngine transport economy", () => {
  it("plays a session longer than the decoded cache without fetching anything twice", async () => {
    /*
     * The engine half of the 12x amplification: prefetching two pages past
     * every fed chunk asked for more footage than the cache could hold, so
     * each admit evicted a chunk that had been downloaded and not yet fed
     * and the feed loop fetched it back. Over a 60-chunk session that was
     * 95 page requests instead of nine, and the refetch on the critical
     * path is exactly the periodic stall this overhaul set out to remove.
     */
    const entries: Array<SessionReplayChunkManifestEntry> = Array.from(
      { length: 60 },
      (_unused: unknown, index: number): SessionReplayChunkManifestEntry => {
        return makeEntry(index, { hasFullSnapshot: index === 0 });
      },
    );

    const harness: Harness = makeHarness({ entries: entries });

    await loadAndFlush(harness, 0, 0);
    harness.engine.dispatch({ type: "PLAY" });

    /* 15 minutes of playback, five seconds of wall clock at a time. */
    for (let step: number = 0; step < 185; step++) {
      await harness.tick(5000);
    }

    expect(harness.snapshot().error).toBeNull();
    expect(harness.snapshot().currentTimeMs).toBeGreaterThan(50 * CHUNK_MS);

    const timesRequested: Map<number, number> = new Map<number, number>();

    for (const request of harness.requests) {
      for (const chunkIndex of request) {
        timesRequested.set(
          chunkIndex,
          (timesRequested.get(chunkIndex) ?? 0) + 1,
        );
      }
    }

    const refetched: Array<number> = [...timesRequested.entries()]
      .filter((pair: [number, number]): boolean => {
        return pair[1] > 1;
      })
      .map((pair: [number, number]): number => {
        return pair[0];
      });

    expect(refetched).toEqual([]);
    /* Nine page-aligned reads cover 60 chunks; anything more is churn. */
    expect(harness.requests.length).toBeLessThanOrEqual(10);
  });

  it("feeds every chunk into rrweb exactly once when a seek retires a feeding loop mid-fetch", async () => {
    /*
     * A retired loop still runs its finally when the fetch it was awaiting
     * lands. Clearing isExtending there cleared it for the loop that had
     * REPLACED it, so the next tick started a second loop on the same
     * segment and both fed every chunk from then on: duplicate mutations,
     * inputs and clicks cast into rrweb, and its event array growing at
     * twice the rate. Nothing reported it, because lastFedChunkIndex
     * advanced normally.
     */
    const entries: Array<SessionReplayChunkManifestEntry> = Array.from(
      { length: 40 },
      (_unused: unknown, index: number): SessionReplayChunkManifestEntry => {
        return makeEntry(index, {
          hasFullSnapshot: index === 0 || index === 32,
        });
      },
    );

    const harness: Harness = makeHarness({
      entries: entries,
      deferFetch: true,
    });

    harness.engine.dispatch({ type: "LOAD", anchorChunkIndex: 0, targetMs: 0 });
    await flush();

    /* The priority pair lands; the rest of its page goes on the wire. */
    harness.releaseFetch(0);
    await flush();

    harness.engine.dispatch({ type: "PLAY" });
    await harness.tick(16);

    /* Loop A is now awaiting [2..7]. */
    expect(harness.loader.isChunkInFlight(2)).toBe(true);

    harness.engine.dispatch({
      type: "SEEK",
      offsetMs: 32 * CHUNK_MS + 1000,
      token: 1,
    });
    await flush();

    /* The rebuild's own priority pair, which loop B will feed from. */
    harness.releaseFetch(32);
    await flush();

    expect(harness.replayers.length).toBe(2);

    /* Loop B starts and blocks on the next page. */
    await harness.tick(16);
    expect(harness.loader.isChunkInFlight(34)).toBe(true);

    /*
     * Only NOW does the retired loop's await resolve. It is waiting on the
     * page it asked for and on the page the first prefetch put on the wire.
     */
    harness.releaseFetch(2);
    harness.releaseFetch(8);
    await flush();

    /* The tick that used to start a second loop on the live segment. */
    await harness.tick(16);
    harness.releaseFetch(34);
    await flush();
    await harness.tick(16);
    await flush();

    const live: FakeReplayer = harness.live();
    const seen: Map<string, number> = new Map<string, number>();

    for (const event of live.added) {
      const key: string = JSON.stringify(event.data);
      seen.set(key, (seen.get(key) ?? 0) + 1);
    }

    const duplicated: Array<string> = [...seen.entries()]
      .filter((pair: [string, number]): boolean => {
        return pair[1] > 1;
      })
      .map((pair: [string, number]): string => {
        return pair[0];
      });

    expect(duplicated).toEqual([]);
    expect(live.added.length).toBeGreaterThan(0);
  });
});

describe("ReplayEngine seeking past a hole", () => {
  it("recovers from a seek made while a gap jump is queued instead of buffering for ever", async () => {
    /*
     * Chunk 3 is in the manifest but comes back empty, so a gap jump is
     * queued. A seek past it looked reachable - isContiguousRange answers
     * from the manifest, which still lists chunk 3 - so the engine went to
     * "building" and asked the feeding loop to reach it, and the feeding
     * loop refuses to run while a gap is pending. The result was an
     * endless buffering pill with error null, a Retry that does nothing
     * (RETRY only acts on "halted") and a Play that moves nothing.
     */
    const entries: Array<SessionReplayChunkManifestEntry> = Array.from(
      { length: 20 },
      (_unused: unknown, index: number): SessionReplayChunkManifestEntry => {
        return makeEntry(index, {
          hasFullSnapshot: index === 0 || index === 5,
        });
      },
    );

    const harness: Harness = makeHarness({
      entries: entries,
      omitChunkIndexes: [3],
    });

    await loadAndFlush(harness, 0, 0);
    harness.engine.dispatch({ type: "PLAY" });

    /* Feed forward until chunk 3 comes back empty. */
    for (let step: number = 0; step < 4; step++) {
      await harness.tick(5000);
    }

    expect(harness.snapshot().buffer).toBe("gap-pending");

    harness.engine.dispatch({
      type: "SEEK",
      offsetMs: 4 * CHUNK_MS + 500,
      token: 1,
    });
    await flush();

    const afterSeek: ReplayEngineSnapshot = harness.snapshot();

    expect(afterSeek.buffer).not.toBe("building");
    expect(afterSeek.pendingSeekMs).toBeNull();
    expect(afterSeek.error).toBeNull();
    expect(afterSeek.phase).not.toBe("buffering");

    /*
     * And it keeps its promise: the footage before the hole plays out and
     * the jump lands on the next snapshot, rather than sitting still.
     */
    for (let step: number = 0; step < 4; step++) {
      await harness.tick(5000);
      await flush();
    }

    expect(harness.snapshot().lastGap?.toIndex).toBe(5);
    expect(harness.snapshot().currentTimeMs).toBeGreaterThanOrEqual(
      5 * CHUNK_MS,
    );
    expect(harness.snapshot().phase).toBe("playing");
  });
});

describe("ReplayEngine in a hidden tab", () => {
  it("does not run the watchdog while the document is hidden", async () => {
    /*
     * rrweb's clock only advances inside a requestAnimationFrame callback
     * and browsers suspend those in a background tab, so getCurrentTime()
     * CANNOT move while the tab is hidden. Reading that as a stall fired
     * the watchdog every 1.5s for as long as the viewer was away, each
     * time re-applying every event since the last snapshot synchronously,
     * and left watchdogFireCount - which the diagnostic reports as a
     * number that should be zero - in the hundreds.
     */
    let hidden: boolean = false;

    const harness: Harness = makeHarness({
      entries: [
        makeEntry(0, { hasFullSnapshot: true }),
        makeEntry(1),
        makeEntry(2),
        makeEntry(3),
        makeEntry(4),
      ],
      isDocumentHidden: (): boolean => {
        return hidden;
      },
    });

    await loadAndFlush(harness, 0, 0);
    harness.engine.dispatch({ type: "PLAY" });
    await harness.tick(16);

    const live: FakeReplayer = harness.live();
    const playsBeforeHiding: number = live.playOffsets.length;

    hidden = true;

    /* Six seconds away: four watchdog windows with a frozen clock. */
    for (let step: number = 0; step < 30; step++) {
      await harness.tick(200);
    }

    expect(harness.engine.getDiagnostics().watchdogFireCount).toBe(0);
    expect(live.playOffsets.length).toBe(playsBeforeHiding);
    expect(harness.snapshot().phase).toBe("playing");

    /* Coming back does not fire it either: the window starts again. */
    hidden = false;
    await harness.tick(200);

    expect(harness.engine.getDiagnostics().watchdogFireCount).toBe(0);
  });
});

describe("ReplayEngine idle skipping over decoded footage", () => {
  it("stops at a click in a chunk the manifest calls idle", async () => {
    /*
     * A chunk carrying one click, one mutation and one mousemove batch is
     * below the "active" event count, so the manifest guess folded it into
     * the surrounding silence and the skip jumped a whole minute past the
     * click - the exact moment the viewer turned the toggle on to reach.
     * The loader had already decoded that chunk in its first page; the
     * engine only admitted evidence for chunks playback had FED, so it
     * never looked.
     */
    const entries: Array<SessionReplayChunkManifestEntry> = Array.from(
      { length: 12 },
      (_unused: unknown, index: number): SessionReplayChunkManifestEntry => {
        return makeEntry(index, {
          hasFullSnapshot: index === 0,
          /* Chunk 6 is the one with the click, and still looks idle. */
          eventCount: index >= 2 && index <= 9 ? (index === 6 ? 3 : 1) : 10,
        });
      },
    );

    const harness: Harness = makeHarness({
      entries: entries,
      eventsForChunk: (
        chunkIndex: number,
      ): Array<SessionReplayRecordedEvent> => {
        const events: Array<SessionReplayRecordedEvent> = eventsFor(
          chunkIndex,
          1,
        );

        if (chunkIndex === 6) {
          events.push({
            type: RRWEB_EVENT_TYPE_INCREMENTAL,
            timestamp: CLIENT_CLOCK_BASE_MS + 6 * CHUNK_MS + 500,
            data: { source: 2, type: 2, x: 40, y: 60 },
          });
        }

        return events;
      },
    });

    harness.engine.dispatch({ type: "SET_SKIP_INACTIVE", enabled: true });
    await loadAndFlush(harness, 0, 0);
    harness.engine.dispatch({ type: "PLAY" });

    harness.live().currentTimeMs = 2 * CHUNK_MS + 1000;
    await harness.tick(16);
    await flush();

    const skip: ReplayEngineSnapshot = harness.snapshot();

    /* Landed one second before the click, never past it. */
    expect(skip.currentTimeMs).toBe(6 * CHUNK_MS + 500 - 1000);
    expect(skip.currentTimeMs).toBeLessThan(6 * CHUNK_MS + 500);
    expect(skip.lastIdleSkip?.endMs).toBe(6 * CHUNK_MS + 500);
    expect(skip.error).toBeNull();
  });
});

describe("ReplayEngine long playthroughs", () => {
  /* 60-second chunks, each its own snapshot: the recorder's checkout cadence. */
  const WIDE_CHUNK_MS: number = 60 * 1000;

  function wideEntry(chunkIndex: number): SessionReplayChunkManifestEntry {
    return {
      ...makeEntry(chunkIndex, { hasFullSnapshot: true }),
      chunkStartOffsetMs: chunkIndex * WIDE_CHUNK_MS,
      chunkEndOffsetMs: (chunkIndex + 1) * WIDE_CHUNK_MS,
    };
  }

  it("re-anchors on a snapshot once one Replayer holds too much footage", async () => {
    /*
     * rrweb never drops an event it has been given, so a viewer who lets a
     * long session play straight through held every parsed event of it and
     * every stall resume re-applied all of them synchronously. Past the
     * bound, the next snapshot the PLAYHEAD reaches is a free place to
     * start again: nothing is skipped, and the old Replayer goes with its
     * events.
     */
    const harness: Harness = makeHarness({
      entries: Array.from(
        { length: 14 },
        (_unused: unknown, index: number): SessionReplayChunkManifestEntry => {
          return wideEntry(index);
        },
      ),
    });

    await loadAndFlush(harness, 0, 0);
    harness.engine.dispatch({ type: "PLAY" });

    let beforeMs: number = 0;

    for (
      let step: number = 0;
      step < 80 && harness.engine.getDiagnostics().replayersCreated < 2;
      step++
    ) {
      beforeMs = harness.snapshot().currentTimeMs;
      await harness.tick(10000);
    }

    expect(harness.engine.getDiagnostics().replayersCreated).toBe(2);

    const after: ReplayEngineSnapshot = harness.snapshot();

    /* Nothing was skipped, and nothing was reported as missing. */
    expect(after.currentTimeMs).toBeGreaterThanOrEqual(beforeMs);
    expect(after.lastGap).toBeNull();
    expect(after.error).toBeNull();
    expect(after.notice ?? null).toBeNull();

    /* The new segment starts at a snapshot at or before the playhead. */
    expect(after.fedRange?.fromMs).toBeGreaterThan(0);
    expect(after.fedRange?.fromMs).toBeLessThanOrEqual(after.currentTimeMs);
    expect(after.currentTimeMs - (after.fedRange?.fromMs ?? 0)).toBeLessThan(
      2 * WIDE_CHUNK_MS,
    );

    /* And the old one, with everything it was holding, is gone. */
    expect(harness.replayers[0]!.isDestroyed).toBe(true);

    await harness.tick(10000);
    await flush();

    expect(harness.snapshot().phase).toBe("playing");
  });

  it("leaves a short session on one Replayer", async () => {
    const harness: Harness = makeHarness({
      entries: Array.from(
        { length: 4 },
        (_unused: unknown, index: number): SessionReplayChunkManifestEntry => {
          return wideEntry(index);
        },
      ),
    });

    await loadAndFlush(harness, 0, 0);
    harness.engine.dispatch({ type: "PLAY" });

    for (let step: number = 0; step < 20; step++) {
      await harness.tick(10000);
    }

    expect(harness.engine.getDiagnostics().replayersCreated).toBe(1);
  });
});
