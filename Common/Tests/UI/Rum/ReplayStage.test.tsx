import "@testing-library/jest-dom";
import { act, render } from "@testing-library/react";
/*
 * The Dashboard has its own copy of react, so a component imported from there
 * would otherwise call hooks on a DIFFERENT React instance than the one
 * react-dom renders with, and every useRef throws "Cannot read properties of
 * null".
 *
 * That is resolved in Common's jest moduleNameMapper, which pins react and
 * react-dom to this project's single copy for every importer. It deliberately
 * is NOT a jest.mock of an absolute path into
 * App/FeatureSet/Dashboard/node_modules: that path only exists once the
 * Dashboard has been installed, so it worked locally and broke the Common Test
 * CI job, which installs Common alone.
 */
import * as React from "react";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  jest,
} from "@jest/globals";
import {
  SessionReplayChunkManifestEntry,
  SessionReplayGap,
} from "../../../Types/Rum/SessionReplay";
import ChunkLoader, {
  SessionReplayRecordedEvent,
} from "../../../../App/FeatureSet/Dashboard/src/Components/SessionReplay/ChunkLoader";
import ReplayStage, {
  ReplayerLike,
} from "../../../../App/FeatureSet/Dashboard/src/Components/SessionReplay/ReplayStage";

/*
 * ReplayStage is the component whose failure mode is a lie rather than a
 * crash: feed rrweb a chunk whose predecessor never arrived and it resolves
 * those mutations against stale node ids, rendering a DOM the end user never
 * saw. These tests drive it with a real ChunkLoader over fixture bytes and a
 * fake Replayer, so the feeding state machine is pinned without rrweb, a
 * network or a browser.
 *
 * It lives in Common for the same reason ChunkLoader.test.ts does: the logic
 * is Dashboard code, but nothing about it needs the Dashboard build.
 */

const CHUNK_MS: number = 15000;
const TICK_MS: number = 200;

/* Deliberately nothing like a session offset: these are raw client clocks. */
const CLIENT_CLOCK_BASE_MS: number = 1700000000000;

function makeEntry(
  chunkIndex: number,
  options?: { hasFullSnapshot?: boolean },
): SessionReplayChunkManifestEntry {
  return {
    chunkIndex: chunkIndex,
    tabId: "tab-1",
    chunkStartOffsetMs: chunkIndex * CHUNK_MS,
    chunkEndOffsetMs: (chunkIndex + 1) * CHUNK_MS,
    eventCount: 2,
    hasFullSnapshot: options?.hasFullSnapshot ?? false,
    payloadBytes: 4096,
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
      type: chunkIndex === 0 && i === 0 ? 2 : 3,
      timestamp: CLIENT_CLOCK_BASE_MS + chunkIndex * CHUNK_MS + i,
      data: { chunkIndex: chunkIndex, sequence: i },
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
 * Stand-in for rrweb's Replayer. Records everything the stage does to it, so
 * a test can assert on what WAS fed as well as on what was not.
 */
class FakeReplayer implements ReplayerLike {
  public readonly iframe: HTMLIFrameElement;
  public readonly wrapper: HTMLElement;
  public readonly initialEvents: Array<SessionReplayRecordedEvent>;
  /* The config the stage constructed this Replayer with. */
  public readonly constructorConfig: Record<string, unknown>;
  public readonly added: Array<SessionReplayRecordedEvent> = [];
  public readonly playOffsets: Array<number | undefined> = [];
  public readonly pauseOffsets: Array<number | undefined> = [];
  public readonly configs: Array<Record<string, unknown>> = [];
  public readonly handlers: Map<string, (payload: unknown) => void> = new Map<
    string,
    (payload: unknown) => void
  >();
  public isDestroyed: boolean = false;
  public currentTimeMs: number = 0;

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
  }

  public pause(timeOffsetMs?: number): void {
    this.pauseOffsets.push(timeOffsetMs);
  }

  public destroy(): void {
    this.isDestroyed = true;
  }

  public addEvent(event: SessionReplayRecordedEvent): void {
    this.added.push(event);
  }

  public getCurrentTime(): number {
    return this.currentTimeMs;
  }

  public setConfig(config: Record<string, unknown>): void {
    this.configs.push(config);
  }

  public on(event: string, handler: (payload: unknown) => void): unknown {
    this.handlers.set(event, handler);
    return this;
  }
}

interface Harness {
  loader: ChunkLoader;
  replayers: Array<FakeReplayer>;
  gaps: Array<SessionReplayGap>;
  errors: Array<string>;
  playingChanges: Array<boolean>;
  timeUpdates: Array<number>;
  requests: Array<Array<number>>;
}

function makeHarness(options: {
  entries: Array<SessionReplayChunkManifestEntry>;
  eventsPerChunk?: number;
  /* Chunk indexes the server "loses" - present in the manifest, absent from the response. */
  omitChunkIndexes?: Array<number>;
  deferFetch?: boolean;
}): Harness & { resolveFetch: () => void } {
  const replayers: Array<FakeReplayer> = [];
  const gaps: Array<SessionReplayGap> = [];
  const errors: Array<string> = [];
  const playingChanges: Array<boolean> = [];
  const timeUpdates: Array<number> = [];
  const requests: Array<Array<number>> = [];
  const pending: Array<() => void> = [];

  const omitted: Set<number> = new Set<number>(options.omitChunkIndexes ?? []);

  const loader: ChunkLoader = new ChunkLoader({
    sessionId: "sess-1",
    tabId: "tab-1",
    entries: options.entries,
    fetcher: (request: {
      sessionId: string;
      tabId: string;
      chunkIndexes: Array<number>;
    }): Promise<ArrayBuffer> => {
      requests.push([...request.chunkIndexes]);

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
                events: eventsFor(chunkIndex, options.eventsPerChunk ?? 2),
              };
            },
          ),
      );

      if (!options.deferFetch) {
        return Promise.resolve(buffer);
      }

      return new Promise<ArrayBuffer>((resolve: (b: ArrayBuffer) => void) => {
        pending.push((): void => {
          resolve(buffer);
        });
      });
    },
  });

  return {
    loader: loader,
    replayers: replayers,
    gaps: gaps,
    errors: errors,
    playingChanges: playingChanges,
    timeUpdates: timeUpdates,
    requests: requests,
    resolveFetch: (): void => {
      const waiting: Array<() => void> = [...pending];
      pending.length = 0;

      for (const resolve of waiting) {
        resolve();
      }
    },
  };
}

function renderStage(
  harness: Harness,
  props?: { isPlaying?: boolean },
): {
  rerender: (isPlaying: boolean) => void;
  seek: (offsetMs: number) => void;
} {
  let seekRequest: { offsetMs: number; token: number } | null = null;
  let seekToken: number = 0;
  let latestIsPlaying: boolean = props?.isPlaying ?? false;

  const element: (isPlaying: boolean) => React.ReactElement = (
    isPlaying: boolean,
  ): React.ReactElement => {
    return (
      <ReplayStage
        loader={harness.loader}
        replayerFactory={(
          events: Array<SessionReplayRecordedEvent>,
          config: Record<string, unknown>,
        ): ReplayerLike => {
          const replayer: FakeReplayer = new FakeReplayer(events, config);
          harness.replayers.push(replayer);
          return replayer;
        }}
        isPlaying={isPlaying}
        speed={1}
        skipInactive={false}
        seekRequest={seekRequest}
        onTimeUpdate={(offsetMs: number): void => {
          harness.timeUpdates.push(offsetMs);
        }}
        onPlayingChange={(isNowPlaying: boolean): void => {
          harness.playingChanges.push(isNowPlaying);
        }}
        onGapCrossed={(gap: SessionReplayGap): void => {
          harness.gaps.push(gap);
        }}
        onLoadedChunkIndexesChange={(): void => {
          // Not asserted here; the loader's own tests cover it.
        }}
        onError={(message: string): void => {
          harness.errors.push(message);
        }}
      />
    );
  };

  const result: { rerender: (ui: React.ReactElement) => void } = render(
    element(props?.isPlaying ?? false),
  );

  return {
    rerender: (isPlaying: boolean): void => {
      latestIsPlaying = isPlaying;
      result.rerender(element(isPlaying));
    },
    seek: (offsetMs: number): void => {
      seekToken++;
      seekRequest = { offsetMs: offsetMs, token: seekToken };
      result.rerender(element(latestIsPlaying));
    },
  };
}

/* Lets every queued microtask (the awaits inside the stage) run to completion. */
async function flush(): Promise<void> {
  await act(async (): Promise<void> => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
}

async function tick(times: number): Promise<void> {
  for (let i: number = 0; i < times; i++) {
    await act(async (): Promise<void> => {
      jest.advanceTimersByTime(TICK_MS);
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });
  }
}

beforeEach(() => {
  jest.useFakeTimers();
});

afterEach(() => {
  jest.useRealTimers();
});

describe("ReplayStage chunk feeding", () => {
  it("feeds the contiguous next chunk into the live Replayer", async () => {
    const harness: Harness = makeHarness({
      entries: [makeEntry(0, { hasFullSnapshot: true }), makeEntry(1)],
    });

    renderStage(harness);
    await flush();

    expect(harness.replayers.length).toBe(1);

    await tick(2);

    const fed: Array<unknown> = harness.replayers[0]!.added.map(
      (event: SessionReplayRecordedEvent): unknown => {
        return event.data;
      },
    );

    expect(fed).toEqual([
      { chunkIndex: 1, sequence: 0 },
      { chunkIndex: 1, sequence: 1 },
    ]);
    expect(harness.gaps).toEqual([]);
    expect(harness.errors).toEqual([]);
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

    renderStage(harness);
    await flush();

    expect(harness.replayers.length).toBe(1);

    // Discover the failure.
    await tick(2);

    // Nothing from chunk 2 may have reached the first Replayer.
    expect(harness.replayers[0]!.added).toEqual([]);

    // Play out the footage we do have, which is what releases the jump.
    harness.replayers[0]!.currentTimeMs = CHUNK_MS;
    await tick(2);

    expect(harness.gaps).toEqual([
      { fromIndex: 0, toIndex: 2, missingMs: CHUNK_MS },
    ]);
    expect(harness.replayers[0]!.added).toEqual([]);
    expect(harness.replayers[0]!.isDestroyed).toBe(true);

    // Playback resumed by re-anchoring on the next full snapshot, not by guessing.
    expect(harness.replayers.length).toBe(2);
    expect(
      harness.replayers[1]!.initialEvents.map(
        (event: SessionReplayRecordedEvent): unknown => {
          return event.data;
        },
      ),
    ).toEqual([
      { chunkIndex: 2, sequence: 0 },
      { chunkIndex: 2, sequence: 1 },
    ]);
  });

  it("errors rather than skipping when nothing can anchor after a failed chunk", async () => {
    const harness: Harness = makeHarness({
      entries: [makeEntry(0, { hasFullSnapshot: true }), makeEntry(1)],
      omitChunkIndexes: [1],
    });

    renderStage(harness);
    await flush();
    await tick(2);

    expect(harness.replayers[0]!.added).toEqual([]);
    expect(harness.errors.length).toBe(1);
    expect(harness.errors[0]).toContain("no later snapshot");

    /*
     * And it stops trying. The tick runs five times a second and the fed
     * range can never advance past this, so retrying would re-POST /chunks
     * for footage that is not coming back.
     */
    const requestsAfterFailure: number = harness.requests.length;
    await tick(5);

    expect(harness.errors.length).toBe(1);
    expect(harness.requests.length).toBe(requestsAfterFailure);
  });
});

describe("ReplayStage Replayer construction", () => {
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

    renderStage(harness);
    await flush();

    expect(harness.errors).toEqual([]);
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

    renderStage(harness);
    await flush();

    expect(harness.replayers.length).toBe(0);
    expect(harness.errors.length).toBe(1);
    expect(harness.errors[0]).toContain("too short to play");
    // Never rrweb's own string.
    expect(harness.errors[0]).not.toContain("Replayer need at least");
  });
});

describe("ReplayStage playback clock", () => {
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

    renderStage(harness);
    await flush();

    harness.replayers[0]!.currentTimeMs = 5000;
    await tick(1);

    // Chunk 2 starts at 30000ms into the session.
    expect(harness.timeUpdates[harness.timeUpdates.length - 1]).toBe(35000);
  });
});

describe("ReplayStage transport state", () => {
  it("honours a Play pressed while the first chunk is still loading", async () => {
    const harness: Harness & { resolveFetch: () => void } = makeHarness({
      entries: [makeEntry(0, { hasFullSnapshot: true }), makeEntry(1)],
      deferFetch: true,
    });

    const stage: { rerender: (isPlaying: boolean) => void } = renderStage(
      harness,
      { isPlaying: false },
    );

    await flush();
    expect(harness.replayers.length).toBe(0);

    // The viewer presses Play while the fetch is still in flight.
    act((): void => {
      stage.rerender(true);
    });

    harness.resolveFetch();
    await flush();

    expect(harness.replayers.length).toBe(1);
    expect(harness.replayers[0]!.playOffsets).toEqual([0]);
    expect(harness.replayers[0]!.pauseOffsets).toEqual([]);
  });

  it("applies a Play pressed after the Replayer already exists", async () => {
    /*
     * The plain case, and the one the reported "Play does nothing" was
     * about. The stage holds its live Replayer in a REF, so the effect that
     * applies play/pause cannot see one appear; it only re-runs when
     * isPlaying changes. Anything that leaves the intent and the applied
     * state out of step - a rebuild, an error, a Replayer swapped between
     * the press and the apply - used to leave the button saying "playing"
     * over a stage that was not.
     */
    const harness: Harness = makeHarness({
      entries: [makeEntry(0, { hasFullSnapshot: true }), makeEntry(1)],
    });

    const stage: { rerender: (isPlaying: boolean) => void } = renderStage(
      harness,
      { isPlaying: false },
    );

    await flush();

    expect(harness.replayers.length).toBe(1);
    expect(harness.replayers[0]!.playOffsets).toEqual([]);

    act((): void => {
      stage.rerender(true);
    });

    expect(harness.replayers[0]!.playOffsets).toEqual([0]);

    act((): void => {
      stage.rerender(false);
    });

    /*
     * Pausing is applied to the SAME Replayer, not by rebuilding one. The
     * leading 0 is the build's own pause(withinSegment); the undefined is
     * this press, which pauses in place rather than seeking.
     */
    expect(harness.replayers.length).toBe(1);
    expect(harness.replayers[0]!.pauseOffsets).toEqual([0, undefined]);
  });

  it("does not re-issue play on a rebuild that already applied the intent", async () => {
    /*
     * A rebuild - a seek across a snapshot anchor, or a gap jump - applies
     * the current transport state itself. Re-asserting it afterwards would
     * restart rrweb's timer at the same offset on every one of them, for
     * nothing, so the re-assert has to be able to tell "the build already
     * did this" from "the viewer changed their mind while it ran".
     */
    const harness: Harness = makeHarness({
      entries: [
        makeEntry(0, { hasFullSnapshot: true }),
        makeEntry(1),
        makeEntry(2, { hasFullSnapshot: true }),
        makeEntry(3),
      ],
    });

    const stage: {
      rerender: (isPlaying: boolean) => void;
      seek: (offsetMs: number) => void;
    } = renderStage(harness, { isPlaying: true });

    await flush();

    expect(harness.replayers.length).toBe(1);
    expect(harness.replayers[0]!.playOffsets).toEqual([0]);

    /* Seek into chunk 2, which anchors a new segment. */
    act((): void => {
      stage.seek(2 * CHUNK_MS + 1000);
    });

    await flush();

    expect(harness.replayers.length).toBe(2);
    expect(harness.replayers[1]!.playOffsets).toEqual([1000]);
  });

  it("kicks a fetch immediately when Play resumes a stalled recording", async () => {
    /*
     * rrweb emits Finish whenever it drains what it has been given, which
     * with chunk streaming is a stall rather than the end. If the viewer
     * pauses there and presses Play again, waiting for the next 200ms tick
     * to decide it is time to fetch means the first thing they see after
     * pressing Play is a frozen stage.
     */
    const harness: Harness = makeHarness({
      entries: [
        makeEntry(0, { hasFullSnapshot: true }),
        makeEntry(1),
        makeEntry(2),
      ],
    });

    const stage: { rerender: (isPlaying: boolean) => void } = renderStage(
      harness,
      { isPlaying: true },
    );

    await flush();

    /* The stall: rrweb ran out of events while more chunks exist. */
    act((): void => {
      harness.replayers[0]!.handlers.get("finish")!(undefined);
    });

    expect(harness.playingChanges).toEqual([]);

    act((): void => {
      stage.rerender(false);
    });

    /*
     * No clock has been advanced in this test, so nothing has been fed yet:
     * anything that lands below is the press doing it, not a tick.
     */
    expect(harness.replayers[0]!.added).toEqual([]);

    act((): void => {
      stage.rerender(true);
    });

    await flush();

    expect(harness.replayers[0]!.added.length).toBeGreaterThan(0);
    /* And it resumed the cast rather than only topping the buffer up. */
    expect(harness.replayers[0]!.playOffsets.length).toBeGreaterThan(1);
  });
});

describe("ReplayStage Replayer configuration", () => {
  it("draws the pointer trail, so recorded mouse movement is visible", async () => {
    /*
     * rrweb records mousemove either way; what it does NOT do is draw a
     * system cursor. With the tail off, a viewer sees a dot at eight
     * positions a second and cannot tell deliberate movement from a jump -
     * which is what "mouse movement is not rendered during playback"
     * describes.
     */
    const harness: Harness = makeHarness({
      entries: [makeEntry(0, { hasFullSnapshot: true })],
    });

    renderStage(harness);
    await flush();

    const config: Record<string, unknown> =
      harness.replayers[0]!.constructorConfig;

    expect(config["mouseTail"]).not.toBe(false);
    expect(config["mouseTail"]).toEqual(
      expect.objectContaining({ lineWidth: expect.any(Number) }),
    );
  });

  it("bounds how fast skip-inactive may fast-forward", async () => {
    /*
     * rrweb's own default maxSpeed is 360x, which is far faster than this
     * player can be fed: events arrive one 15-second chunk at a time over
     * an authenticated fetch, so a 360x sprint drains the fed range in
     * milliseconds and lands in the stalled state again and again. Capping
     * it at the top of the manual speed control keeps skipping useful and
     * never faster than the loader can keep up with.
     */
    const harness: Harness = makeHarness({
      entries: [makeEntry(0, { hasFullSnapshot: true })],
    });

    renderStage(harness);
    await flush();

    const maxSpeed: unknown =
      harness.replayers[0]!.constructorConfig["maxSpeed"];

    expect(typeof maxSpeed).toBe("number");
    expect(maxSpeed as number).toBeLessThanOrEqual(8);
    expect(maxSpeed as number).toBeGreaterThan(1);
  });

  it("never enables canvas replay, which would drop the iframe sandbox", async () => {
    const harness: Harness = makeHarness({
      entries: [makeEntry(0, { hasFullSnapshot: true })],
    });

    renderStage(harness);
    await flush();

    expect(harness.replayers[0]!.constructorConfig["UNSAFE_replayCanvas"]).toBe(
      false,
    );
  });
});

describe("ReplayStage finish handling", () => {
  it("does not stop playback when rrweb drains its buffer mid-recording", async () => {
    const harness: Harness = makeHarness({
      entries: [
        makeEntry(0, { hasFullSnapshot: true }),
        makeEntry(1),
        makeEntry(2),
      ],
    });

    renderStage(harness, { isPlaying: true });
    await flush();

    const finish: ((payload: unknown) => void) | undefined =
      harness.replayers[0]!.handlers.get("finish");

    expect(finish).toBeDefined();

    act((): void => {
      finish!(undefined);
    });

    /*
     * There is still footage to feed, so this Finish is a stall waiting on
     * /chunks. Reporting it as "not playing" would stop the session for good:
     * later addEvent calls append to a machine that has already ended.
     */
    expect(harness.playingChanges).toEqual([]);
  });

  it("stops playback when the recording genuinely ends", async () => {
    const harness: Harness = makeHarness({
      entries: [makeEntry(0, { hasFullSnapshot: true })],
    });

    renderStage(harness, { isPlaying: true });
    await flush();

    act((): void => {
      harness.replayers[0]!.handlers.get("finish")!(undefined);
    });

    expect(harness.playingChanges).toEqual([false]);
  });
});
