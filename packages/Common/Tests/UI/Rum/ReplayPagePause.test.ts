import { describe, expect, it } from "@jest/globals";
import { SessionReplayChunkManifestEntry } from "../../../Types/Rum/SessionReplay";
import {
  readSessionReplayPauseReason,
  SessionReplayCustomEventTag,
  SessionReplayIdlePausedPayload,
  SessionReplayIdleResumedPayload,
} from "../../../Types/Rum/SessionReplayCustomEvents";
import ChunkLoader, {
  RRWEB_EVENT_TYPE_META,
  RRWEB_SOURCE_MOUSE_MOVE,
  SessionReplayRecordedEvent,
} from "../../../../App/FeatureSet/Dashboard/src/Components/SessionReplay/ChunkLoader";
import { ReplayTimelineEvent } from "../../../../App/FeatureSet/Dashboard/src/Components/SessionReplay/ReplayTimelineTypes";
import InactivityMap from "../../../../App/FeatureSet/Dashboard/src/Components/SessionReplay/Engine/InactivityMap";
import { ReplayIdleBand } from "../../../../App/FeatureSet/Dashboard/src/Components/SessionReplay/Engine/ReplayEngineTypes";
import {
  fromTimelineEvent,
  fromTimelineEvents,
} from "../../../../App/FeatureSet/Dashboard/src/Components/SessionReplay/Rail/ReplaySignals";
import { ReplaySignal } from "../../../../App/FeatureSet/Dashboard/src/Components/SessionReplay/Rail/ReplaySignalTypes";
import {
  describeIdleSkip,
  pausedBandExplanation,
  REPLAY_PAGE_PAUSED_BAND_EXPLANATION,
  REPLAY_PAUSED_BAND_EXPLANATION,
} from "../../../../App/FeatureSet/Dashboard/src/Components/SessionReplay/ReplayStageOverlays";
import {
  buildTrackBands,
  ReplayTrackBand,
} from "../../../../App/FeatureSet/Dashboard/src/Components/SessionReplay/ReplayTimelineMath";
import { shouldAutoSkipBand } from "../../../../App/FeatureSet/Dashboard/src/Components/SessionReplay/ReplayPlaybackIntent";

/*
 * Issue #7498: the page's own pause on the events rail, the timeline and
 * the stage.
 *
 * #6834 gave the browser recorder pause() and resume(): a page holds
 * recording while it shows what it does not want recorded, and OneUptime's
 * own Dashboard pauses on every page that is not a first-run page. A page
 * pause writes the idle pause's two markers, oneuptime.idle-paused and
 * oneuptime.idle-resumed, and its paused marker says reason "page". The
 * player read neither, and titled every such pause "Recording paused:
 * nobody touched the page" and its resume "Recording resumed after 1m
 * idle", while somebody was using the page all along.
 *
 * The recordings here are what RecorderPagePause.test.ts's scenario writes:
 * pause(), the visitor's input (which records nothing and resumes
 * nothing), resume(). The #6834 recorder wrote the reason on the paused
 * marker alone; this one repeats it on the resumed marker too, and the
 * player reads both, in whichever order their chunks arrive.
 */

const CHUNK_MS: number = 15_000;
const BASE_TS: number = 1_700_000_000_000;
// Paused at 30s, resumed at 90s: a minute the page held recording.
const PAUSED_AT_MS: number = 2 * CHUNK_MS;
const RESUMED_AT_MS: number = 90_000;
const PAUSED_AT_UNIX_MS: number = BASE_TS + PAUSED_AT_MS;
const RESUMED_AT_UNIX_MS: number = BASE_TS + RESUMED_AT_MS;

function makeEntry(
  chunkIndex: number,
  overrides?: Partial<SessionReplayChunkManifestEntry>,
): SessionReplayChunkManifestEntry {
  return {
    chunkIndex: chunkIndex,
    tabId: "tab-1",
    chunkStartOffsetMs: chunkIndex * CHUNK_MS,
    chunkEndOffsetMs: (chunkIndex + 1) * CHUNK_MS,
    eventCount: 10,
    hasFullSnapshot: chunkIndex === 0,
    payloadBytes: 4096,
    errorCount: 0,
    rageClickCount: 0,
    deadClickCount: 0,
    errorClickCount: 0,
    refreshRageCount: 0,
    routeCount: 0,
    ...overrides,
  };
}

// The chunk that resumed: a minute after the pause, on a snapshot.
function resumeEntry(chunkIndex: number): SessionReplayChunkManifestEntry {
  return makeEntry(chunkIndex, {
    hasFullSnapshot: true,
    chunkStartOffsetMs: RESUMED_AT_MS,
    chunkEndOffsetMs: RESUMED_AT_MS + CHUNK_MS,
  });
}

const ENTRIES: Array<SessionReplayChunkManifestEntry> = [
  makeEntry(0),
  makeEntry(1),
  resumeEntry(2),
];

function custom(
  tag: string,
  payload: unknown,
  timestamp: number,
): SessionReplayRecordedEvent {
  return { type: 5, timestamp: timestamp, data: { tag: tag, payload } };
}

function mouseMove(timestamp: number): SessionReplayRecordedEvent {
  return {
    type: 3,
    timestamp: timestamp,
    data: { source: RRWEB_SOURCE_MOUSE_MOVE },
  };
}

// What pause() writes at the end of the open chunk.
function pagePaused(): SessionReplayIdlePausedPayload {
  return {
    idleSinceUnixMs: PAUSED_AT_UNIX_MS,
    pausedAtUnixMs: PAUSED_AT_UNIX_MS,
    reason: "page",
  };
}

// Chunk 1: footage, then the paused marker that closes it.
function pausedChunk(
  payload: unknown = pagePaused(),
): Array<SessionReplayRecordedEvent> {
  return [
    mouseMove(BASE_TS + CHUNK_MS),
    custom(SessionReplayCustomEventTag.IdlePaused, payload, PAUSED_AT_UNIX_MS),
  ];
}

// Chunk 2: Meta and FullSnapshot at the resume, the marker behind them.
function resumedChunk(payload: unknown): Array<SessionReplayRecordedEvent> {
  return [
    {
      type: RRWEB_EVENT_TYPE_META,
      timestamp: RESUMED_AT_UNIX_MS,
      data: { href: "https://app.example.com/", width: 1440, height: 900 },
    },
    { type: 2, timestamp: RESUMED_AT_UNIX_MS + 1, data: {} },
    custom(
      SessionReplayCustomEventTag.IdleResumed,
      payload,
      RESUMED_AT_UNIX_MS + 2,
    ),
    mouseMove(RESUMED_AT_UNIX_MS + 500),
  ];
}

// The #6834 recorder's resumed marker: no reason.
const RESUMED_WITHOUT_REASON: SessionReplayIdleResumedPayload = {
  pausedAtUnixMs: PAUSED_AT_UNIX_MS,
  resumedAtUnixMs: RESUMED_AT_UNIX_MS,
};

// This recorder's: the reason again.
const RESUMED_BY_PAGE: SessionReplayIdleResumedPayload = {
  ...RESUMED_WITHOUT_REASON,
  reason: "page",
};

function encodeFrames(
  frames: Array<{ chunkIndex: number; body: string }>,
): ArrayBuffer {
  const encoder: TextEncoder = new TextEncoder();
  const encoded: Array<{ chunkIndex: number; bytes: Uint8Array }> = frames.map(
    (frame: { chunkIndex: number; body: string }) => {
      return {
        chunkIndex: frame.chunkIndex,
        bytes: encoder.encode(frame.body),
      };
    },
  );
  const total: number = encoded.reduce(
    (sum: number, frame: { chunkIndex: number; bytes: Uint8Array }) => {
      return sum + 8 + frame.bytes.length;
    },
    0,
  );
  const buffer: ArrayBuffer = new ArrayBuffer(total);
  const view: DataView = new DataView(buffer);
  const bytes: Uint8Array = new Uint8Array(buffer);
  let offset: number = 0;

  // Little-endian, as the /chunks route writes it (TelemetryAPI.ts).
  for (const frame of encoded) {
    view.setUint32(offset, frame.chunkIndex, true);
    view.setUint32(offset + 4, frame.bytes.length, true);
    bytes.set(frame.bytes, offset + 8);
    offset += 8 + frame.bytes.length;
  }

  return buffer;
}

// A loader over ENTRIES whose chunks hold `chunks`, fetched as asked.
function loaderOver(
  chunks: Record<number, Array<SessionReplayRecordedEvent>>,
): ChunkLoader {
  return new ChunkLoader({
    sessionId: "sess-1",
    tabId: "tab-1",
    entries: ENTRIES,
    fetcher: (request: { chunkIndexes: Array<number> }) => {
      return Promise.resolve(
        encodeFrames(
          request.chunkIndexes.map((chunkIndex: number) => {
            return {
              chunkIndex: chunkIndex,
              body: JSON.stringify(
                chunks[chunkIndex] ?? [
                  { type: 2, timestamp: BASE_TS, data: {} },
                  mouseMove(BASE_TS + 500),
                ],
              ),
            };
          }),
        ),
      );
    },
  });
}

function pauseRows(loader: ChunkLoader): Array<ReplayTimelineEvent> {
  return loader
    .getTimelineEvents()
    .filter((row: ReplayTimelineEvent): boolean => {
      return row.kind === "idle-pause";
    });
}

function titles(loader: ChunkLoader): Array<string> {
  return fromTimelineEvents(pauseRows(loader), {
    startTimeUnixMs: BASE_TS,
  }).map((signal: ReplaySignal): string => {
    return signal.title;
  });
}

// The paused bands an inactivity map draws from what the loader read.
function pausedBands(loader: ChunkLoader): Array<ReplayIdleBand> {
  const map: InactivityMap = new InactivityMap(loader.getPlayableEntries());

  for (const chunkIndex of loader.getExtractedChunkIndexes()) {
    const rows: Array<ReplayTimelineEvent> =
      loader.getTimelineEventsForChunk(chunkIndex) ?? [];

    map.admitChunk(chunkIndex, {
      activityIntervals: loader.getActivityIntervalsForChunk(chunkIndex) ?? [],
      visibilityEvents: rows,
      idlePauseEvents: rows,
    });
  }

  return map.getBands().filter((band: ReplayIdleBand): boolean => {
    return band.kind === "paused";
  });
}

describe("readSessionReplayPauseReason", () => {
  it("reads page, and nothing else, from either marker's payload", () => {
    expect(readSessionReplayPauseReason({ reason: "page" })).toBe("page");
    expect(readSessionReplayPauseReason(pagePaused())).toBe("page");
    expect(readSessionReplayPauseReason(RESUMED_BY_PAGE)).toBe("page");

    for (const value of [
      RESUMED_WITHOUT_REASON,
      { reason: "Page" },
      { reason: "timer" },
      { reason: ["page"] },
      { reason: null },
      "page",
      ["page"],
      null,
      undefined,
      42,
    ]) {
      expect(readSessionReplayPauseReason(value)).toBeUndefined();
    }
  });
});

describe("the page's pause, lifted from the recording", () => {
  it("gives both rows the reason when both markers say it", () => {
    const paused: Array<ReplayTimelineEvent> =
      ChunkLoader.extractTimelineEvents(
        ENTRIES[1] as SessionReplayChunkManifestEntry,
        pausedChunk(),
      );
    const resumed: Array<ReplayTimelineEvent> =
      ChunkLoader.extractTimelineEvents(
        resumeEntry(2),
        resumedChunk(RESUMED_BY_PAGE),
      ).filter((row: ReplayTimelineEvent): boolean => {
        return row.kind === "idle-pause";
      });

    expect(paused).toEqual([
      {
        id: "rec:1:0",
        kind: "idle-pause",
        chunkIndex: 1,
        offsetMs: PAUSED_AT_MS,
        idlePauseEdge: "paused",
        idleSinceUnixMs: PAUSED_AT_UNIX_MS,
        pausedAtUnixMs: PAUSED_AT_UNIX_MS,
        atUnixMs: PAUSED_AT_UNIX_MS,
        pauseReason: "page",
      },
    ]);
    expect(resumed).toEqual([
      expect.objectContaining({
        idlePauseEdge: "resumed",
        pausedAtUnixMs: PAUSED_AT_UNIX_MS,
        resumedAtUnixMs: RESUMED_AT_UNIX_MS,
        pausedAtOffsetMs: PAUSED_AT_MS,
        pauseReason: "page",
      }),
    ]);
  });

  it("gives an idle pause's rows no reason, as every older recording reads", () => {
    const rows: Array<ReplayTimelineEvent> = [
      ...ChunkLoader.extractTimelineEvents(
        ENTRIES[1] as SessionReplayChunkManifestEntry,
        pausedChunk({
          idleSinceUnixMs: BASE_TS + CHUNK_MS,
          pausedAtUnixMs: PAUSED_AT_UNIX_MS,
        }),
      ),
      ...ChunkLoader.extractTimelineEvents(
        resumeEntry(2),
        resumedChunk(RESUMED_WITHOUT_REASON),
      ),
    ].filter((row: ReplayTimelineEvent): boolean => {
      return row.kind === "idle-pause";
    });

    expect(rows).toHaveLength(2);

    for (const row of rows) {
      expect(row).not.toHaveProperty("pauseReason");
    }
  });

  it("keeps the reason of a marker whose stamps are malformed, and drops one it does not know", () => {
    const [malformed] = ChunkLoader.extractTimelineEvents(
      ENTRIES[1] as SessionReplayChunkManifestEntry,
      pausedChunk({ pausedAtUnixMs: "soon", reason: "page" }),
    );
    const [unknown] = ChunkLoader.extractTimelineEvents(
      ENTRIES[1] as SessionReplayChunkManifestEntry,
      pausedChunk({ ...pagePaused(), reason: "screensaver" }),
    );

    expect(malformed?.pauseReason).toBe("page");
    expect(malformed?.pausedAtUnixMs).toBeUndefined();
    expect(unknown?.pauseReason).toBeUndefined();
    expect(unknown?.pausedAtUnixMs).toBe(PAUSED_AT_UNIX_MS);
  });
});

describe("a resume the #6834 recorder wrote without the reason", () => {
  it("takes the reason of its paused marker, read first", async () => {
    const loader: ChunkLoader = loaderOver({
      1: pausedChunk(),
      2: resumedChunk(RESUMED_WITHOUT_REASON),
    });

    await loader.loadPage(0);

    expect(
      pauseRows(loader).map((row: ReplayTimelineEvent) => {
        return [row.idlePauseEdge, row.pauseReason];
      }),
    ).toEqual([
      ["paused", "page"],
      ["resumed", "page"],
    ]);
    expect(titles(loader)).toEqual([
      "Recording paused by the page",
      "Recording resumed by the page after 1m",
    ]);
  });

  it("takes it when the paused marker's chunk is read after it, and the rail and the bands follow", async () => {
    const loader: ChunkLoader = loaderOver({
      1: pausedChunk(),
      2: resumedChunk(RESUMED_WITHOUT_REASON),
    });

    // A seek past the pause: the resume's chunk first.
    await loader.loadPage(2);

    const versionBefore: number = loader.getTimelineVersion();

    expect(titles(loader)).toEqual(["Recording resumed after 1m idle"]);
    expect(pausedBands(loader)).toEqual([
      {
        startMs: PAUSED_AT_MS,
        endMs: RESUMED_AT_MS,
        kind: "paused",
        fidelity: "exact",
      },
    ]);

    await loader.loadPage(0);

    expect(loader.getTimelineVersion()).toBeGreaterThan(versionBefore);
    expect(titles(loader)).toEqual([
      "Recording paused by the page",
      "Recording resumed by the page after 1m",
    ]);
    expect(pausedBands(loader)).toEqual([
      {
        startMs: PAUSED_AT_MS,
        endMs: RESUMED_AT_MS,
        kind: "paused",
        fidelity: "exact",
        pauseReason: "page",
      },
    ]);
  });

  it("stays an idle resume when its paused marker gives no reason", async () => {
    const loader: ChunkLoader = loaderOver({
      1: pausedChunk({
        idleSinceUnixMs: BASE_TS + CHUNK_MS,
        pausedAtUnixMs: PAUSED_AT_UNIX_MS,
      }),
      2: resumedChunk(RESUMED_WITHOUT_REASON),
    });

    await loader.loadPage(2);
    await loader.loadPage(0);

    expect(titles(loader)).toEqual([
      "Recording paused: no input for 15s",
      "Recording resumed after 1m idle",
    ]);
    expect(pausedBands(loader)[0]).not.toHaveProperty("pauseReason");
  });

  it("is not given the reason of another pause", async () => {
    const loader: ChunkLoader = loaderOver({
      1: pausedChunk(),
      2: resumedChunk({
        // A resume of some other pause, a second later.
        pausedAtUnixMs: PAUSED_AT_UNIX_MS + 1000,
        resumedAtUnixMs: RESUMED_AT_UNIX_MS,
      }),
    });

    await loader.loadPage(0);

    expect(
      pauseRows(loader).map((row: ReplayTimelineEvent) => {
        return row.pauseReason;
      }),
    ).toEqual(["page", undefined]);
  });

  it("forgets what it paired when the loader is disposed", async () => {
    const loader: ChunkLoader = loaderOver({
      1: pausedChunk(),
      2: resumedChunk(RESUMED_WITHOUT_REASON),
    });

    await loader.loadPage(0);
    loader.dispose();

    expect(pauseRows(loader)).toEqual([]);
  });
});

describe("the rail's words for the page's pause", () => {
  function signalOf(row: Partial<ReplayTimelineEvent>): ReplaySignal {
    return fromTimelineEvent(
      {
        id: "rec:1:0",
        kind: "idle-pause",
        chunkIndex: 1,
        offsetMs: PAUSED_AT_MS,
        ...row,
      },
      { startTimeUnixMs: BASE_TS },
    );
  }

  it("says the page paused recording, with no idle length", () => {
    const paused: ReplaySignal = signalOf({
      idlePauseEdge: "paused",
      idleSinceUnixMs: PAUSED_AT_UNIX_MS,
      pausedAtUnixMs: PAUSED_AT_UNIX_MS,
      pauseReason: "page",
    });

    expect(paused.title).toBe("Recording paused by the page");
    expect(paused.title).not.toContain("nobody");
    expect(paused.detail).toEqual(
      expect.objectContaining({
        markerKind: "idle-pause",
        idlePauseEdge: "paused",
        idleForMs: null,
        pausedForMs: null,
        pauseReason: "page",
      }),
    );
  });

  it("never quotes an idle length for the page's pause, whatever its stamps", () => {
    // A page pause asked a minute after the last input still is not idle.
    expect(
      signalOf({
        idlePauseEdge: "paused",
        idleSinceUnixMs: PAUSED_AT_UNIX_MS - 60_000,
        pausedAtUnixMs: PAUSED_AT_UNIX_MS,
        pauseReason: "page",
      }).detail["idleForMs"],
    ).toBeNull();
  });

  it("says the page resumed recording, after how long, and never idle", () => {
    const resumed: ReplaySignal = signalOf({
      idlePauseEdge: "resumed",
      offsetMs: RESUMED_AT_MS,
      pausedAtUnixMs: PAUSED_AT_UNIX_MS,
      resumedAtUnixMs: PAUSED_AT_UNIX_MS + 23 * 60 * 1000,
      pausedAtOffsetMs: PAUSED_AT_MS,
      pauseReason: "page",
    });

    expect(resumed.title).toBe("Recording resumed by the page after 23m");
    expect(resumed.title).not.toContain("idle");
    expect(resumed.detail).toEqual(
      expect.objectContaining({
        idlePauseEdge: "resumed",
        idleForMs: null,
        pausedForMs: 23 * 60 * 1000,
        pauseReason: "page",
      }),
    );
  });

  it("drops the length, not the words, when the resume's stamps were missing", () => {
    expect(
      signalOf({ idlePauseEdge: "resumed", pauseReason: "page" }).title,
    ).toBe("Recording resumed by the page");
    expect(signalOf({ pauseReason: "page" }).title).toBe(
      "Recording paused by the page",
    );
  });

  it("words an idle pause as it always has", () => {
    expect(
      signalOf({
        idlePauseEdge: "paused",
        idleSinceUnixMs: PAUSED_AT_UNIX_MS - 5 * 60 * 1000,
        pausedAtUnixMs: PAUSED_AT_UNIX_MS,
      }).title,
    ).toBe("Recording paused: no input for 5m");
    expect(signalOf({ idlePauseEdge: "paused" }).title).toBe(
      "Recording paused: nobody touched the page",
    );
    expect(
      signalOf({
        idlePauseEdge: "resumed",
        pausedAtUnixMs: PAUSED_AT_UNIX_MS,
        resumedAtUnixMs: RESUMED_AT_UNIX_MS,
      }).title,
    ).toBe("Recording resumed after 1m idle");
    expect(signalOf({ idlePauseEdge: "resumed" }).title).toBe(
      "Recording resumed after an idle pause",
    );
    expect(signalOf({ idlePauseEdge: "paused" }).detail["pauseReason"]).toBe(
      null,
    );
  });

  it("gives no other marker a pause reason", () => {
    const hidden: ReplaySignal = fromTimelineEvent(
      {
        id: "rec:1:1",
        kind: "visibility",
        chunkIndex: 1,
        offsetMs: 0,
        visibilityState: "hidden",
        // Nothing reads this off a visibility row.
        pauseReason: "page",
      },
      { startTimeUnixMs: BASE_TS },
    );

    expect(hidden.detail["pauseReason"]).toBeNull();
    expect(hidden.title).toBe("Tab hidden");
  });
});

describe("the stretch the page paused through, on the timeline and the stage", () => {
  function band(pauseReason?: "page"): ReplayIdleBand {
    const value: ReplayIdleBand = {
      startMs: PAUSED_AT_MS,
      endMs: RESUMED_AT_MS,
      kind: "paused",
      fidelity: "exact",
    };

    if (pauseReason) {
      value.pauseReason = pauseReason;
    }

    return value;
  }

  it("is skipped on its own, like an idle pause", () => {
    // With the Skip idle toggle off, as it is by default.
    expect(shouldAutoSkipBand(band("page"), false)).toBe(true);
    expect(shouldAutoSkipBand(band(), false)).toBe(true);
  });

  it("says the page paused recording when playback jumps it", () => {
    expect(describeIdleSkip(band("page"))).toBe(
      "Skipped 1m: recording paused by the page",
    );
    expect(describeIdleSkip(band())).toBe(
      "Skipped 1m: recording paused while the page was idle",
    );
  });

  it("explains the chip by whose pause it was", () => {
    expect(pausedBandExplanation(band("page"))).toBe(
      REPLAY_PAGE_PAUSED_BAND_EXPLANATION,
    );
    expect(REPLAY_PAGE_PAUSED_BAND_EXPLANATION).toBe(
      "The page paused recording, so nothing was recorded until it resumed.",
    );
    expect(pausedBandExplanation(band())).toBe(REPLAY_PAUSED_BAND_EXPLANATION);
    expect(REPLAY_PAUSED_BAND_EXPLANATION).toContain("Nobody touched the page");
  });

  it("carries the reason onto the timeline's band, and no further", () => {
    const tracks: Array<ReplayTrackBand> = buildTrackBands({
      chunks: ENTRIES,
      loadedChunkIndexes: [0, 1, 2],
      idleBands: [
        band("page"),
        // An idle band never carries one, whatever it was handed.
        {
          startMs: 0,
          endMs: 10_000,
          kind: "idle",
          fidelity: "exact",
          pauseReason: "page",
        },
      ],
      durationMs: RESUMED_AT_MS + CHUNK_MS,
    });

    const paused: Array<ReplayTrackBand> = tracks.filter(
      (track: ReplayTrackBand): boolean => {
        return track.kind === "paused";
      },
    );
    const idle: Array<ReplayTrackBand> = tracks.filter(
      (track: ReplayTrackBand): boolean => {
        return track.kind === "idle";
      },
    );

    expect(paused).toHaveLength(1);
    expect(paused[0]?.pauseReason).toBe("page");
    expect(paused[0]?.label).toBe("1m paused");
    expect(idle[0]).not.toHaveProperty("pauseReason");
  });

  it("is the page's only when every pause merged into it was", () => {
    const entries: Array<SessionReplayChunkManifestEntry> = [
      makeEntry(0),
      makeEntry(1),
      makeEntry(2, { chunkStartOffsetMs: 100_000, chunkEndOffsetMs: 115_000 }),
      makeEntry(3, { chunkStartOffsetMs: 200_000, chunkEndOffsetMs: 215_000 }),
    ];
    const resumedRow: (
      chunkIndex: number,
      fromMs: number,
      toMs: number,
      pauseReason?: "page",
    ) => ReplayTimelineEvent = (
      chunkIndex: number,
      fromMs: number,
      toMs: number,
      pauseReason?: "page",
    ): ReplayTimelineEvent => {
      const row: ReplayTimelineEvent = {
        id: `rec:${chunkIndex}:0`,
        kind: "idle-pause",
        chunkIndex: chunkIndex,
        offsetMs: toMs,
        idlePauseEdge: "resumed",
        pausedAtOffsetMs: fromMs,
      };

      if (pauseReason) {
        row.pauseReason = pauseReason;
      }

      return row;
    };
    const bandsWith: (second: "page" | undefined) => Array<ReplayIdleBand> = (
      second: "page" | undefined,
    ): Array<ReplayIdleBand> => {
      const map: InactivityMap = new InactivityMap(entries);

      // Two pauses that overlap: one band.
      map.admitChunk(2, {
        activityIntervals: [],
        visibilityEvents: [],
        idlePauseEvents: [resumedRow(2, 30_000, 100_000, "page")],
      });
      map.admitChunk(3, {
        activityIntervals: [],
        visibilityEvents: [],
        idlePauseEvents: [resumedRow(3, 90_000, 200_000, second)],
      });

      return map.getBands().filter((value: ReplayIdleBand): boolean => {
        return value.kind === "paused";
      });
    };

    expect(bandsWith("page")).toEqual([
      {
        startMs: 30_000,
        endMs: 200_000,
        kind: "paused",
        fidelity: "exact",
        pauseReason: "page",
      },
    ]);
    expect(bandsWith(undefined)).toEqual([
      { startMs: 30_000, endMs: 200_000, kind: "paused", fidelity: "exact" },
    ]);
  });
});
