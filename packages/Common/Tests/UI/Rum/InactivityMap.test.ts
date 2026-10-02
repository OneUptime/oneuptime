import { describe, expect, it } from "@jest/globals";
import {
  SESSION_REPLAY_IDLE_THRESHOLD_MS,
  SessionReplayChunkManifestEntry,
} from "../../../Types/Rum/SessionReplay";
import InactivityMap, {
  InactivityChunkEvidence,
} from "../../../../App/FeatureSet/Dashboard/src/Components/SessionReplay/Engine/InactivityMap";
import { ReplayIdleBand } from "../../../../App/FeatureSet/Dashboard/src/Components/SessionReplay/Engine/ReplayEngineTypes";
import { ReplayTimelineEvent } from "../../../../App/FeatureSet/Dashboard/src/Components/SessionReplay/ReplayTimelineTypes";

/*
 * The idle map is what makes "Skip idle" honest: rrweb's own skipInactive
 * only scans the events it has been fed, which on a chunk-streamed player
 * is at most 30s ahead, so a three-minute idle stretch used to play out in
 * full with the toggle on. These pin the two fidelities (coarse from the
 * manifest, exact from decoded footage), the refinement on admit, the 5s
 * threshold, and that a hidden tab is a different thing from idleness.
 */

const CHUNK_MS: number = 15000;

function makeEntry(
  chunkIndex: number,
  eventCount: number = 10,
): SessionReplayChunkManifestEntry {
  return {
    chunkIndex: chunkIndex,
    tabId: "tab-1",
    chunkStartOffsetMs: chunkIndex * CHUNK_MS,
    chunkEndOffsetMs: (chunkIndex + 1) * CHUNK_MS,
    eventCount: eventCount,
    hasFullSnapshot: chunkIndex === 0,
    payloadBytes: 4096,
    errorCount: 0,
    rageClickCount: 0,
    deadClickCount: 0,
    errorClickCount: 0,
    refreshRageCount: 0,
    routeCount: 0,
  };
}

function visibility(
  chunkIndex: number,
  offsetMs: number,
  state: "hidden" | "visible",
): ReplayTimelineEvent {
  return {
    id: `rec:${chunkIndex}:${offsetMs}`,
    kind: "visibility",
    chunkIndex: chunkIndex,
    offsetMs: offsetMs,
    visibilityState: state,
  };
}

/* Six chunks; 2, 3 and 4 carry nothing the user did. */
const entries: Array<SessionReplayChunkManifestEntry> = [
  makeEntry(0),
  makeEntry(1),
  makeEntry(2, 1),
  makeEntry(3, 1),
  makeEntry(4, 1),
  makeEntry(5),
];

describe("InactivityMap coarse bands", () => {
  it("hatches provisionally idle chunks from the manifest alone, so the lane is never blank at t=0", () => {
    const map: InactivityMap = new InactivityMap(entries);

    expect(map.getBands()).toEqual([
      {
        startMs: 2 * CHUNK_MS,
        endMs: 5 * CHUNK_MS,
        kind: "idle",
        fidelity: "coarse",
      },
    ]);
  });

  it("uses the 5s threshold from the shared constant", () => {
    expect(SESSION_REPLAY_IDLE_THRESHOLD_MS).toBe(5000);

    const map: InactivityMap = new InactivityMap([makeEntry(0), makeEntry(1)], {
      thresholdMs: SESSION_REPLAY_IDLE_THRESHOLD_MS,
    });

    /* Two active chunks, no silence anywhere. */
    expect(map.getBands()).toEqual([]);
  });

  it("never draws an idle band across a hole in the chunk sequence", () => {
    /*
     * Chunks 2-4 are MISSING, not quiet. That stretch is a gap band on the
     * timeline (drawn by the loader's gaps), and calling it idle would tell
     * the viewer the user sat still through footage that was lost.
     */
    const map: InactivityMap = new InactivityMap([
      makeEntry(0),
      makeEntry(1),
      makeEntry(5),
    ]);

    expect(map.getBands()).toEqual([]);
  });

  it("treats a trailing run of quiet chunks as idle to the end of the footage", () => {
    const map: InactivityMap = new InactivityMap([
      makeEntry(0),
      makeEntry(1, 1),
      makeEntry(2, 1),
    ]);

    expect(map.getBands()).toEqual([
      {
        startMs: CHUNK_MS,
        endMs: 3 * CHUNK_MS,
        kind: "idle",
        fidelity: "coarse",
      },
    ]);
  });

  it("ignores terminator rows, which carry the close time and no footage", () => {
    const map: InactivityMap = new InactivityMap([
      makeEntry(0),
      makeEntry(1, 0),
    ]);

    expect(map.getBands()).toEqual([]);
  });
});

describe("InactivityMap exact bands", () => {
  it("replaces the guess with exact edges once a chunk's activity is known", () => {
    const map: InactivityMap = new InactivityMap(entries);

    /* The user moved the mouse 10s into chunk 2. */
    map.admitChunk(2, {
      activityIntervals: [
        {
          startMs: 2 * CHUNK_MS + 10000,
          endMs: 2 * CHUNK_MS + 11000,
          chunkIndex: 2,
        },
      ],
      visibilityEvents: [],
    });

    const bands: Array<ReplayIdleBand> = map.getBands();

    expect(bands).toEqual([
      /* From the end of undecoded-but-active chunk 1 to that mouse move. */
      {
        startMs: 2 * CHUNK_MS,
        endMs: 2 * CHUNK_MS + 10000,
        kind: "idle",
        fidelity: "coarse",
      },
      /* From the mouse move through the quiet chunks to active chunk 5. */
      {
        startMs: 2 * CHUNK_MS + 11000,
        endMs: 5 * CHUNK_MS,
        kind: "idle",
        fidelity: "coarse",
      },
    ]);
  });

  it("marks a band exact only when every edge came from decoded footage", () => {
    const map: InactivityMap = new InactivityMap([
      makeEntry(0),
      makeEntry(1),
      makeEntry(2),
    ]);

    map.admitChunk(0, {
      activityIntervals: [{ startMs: 0, endMs: 2000, chunkIndex: 0 }],
      visibilityEvents: [],
    });
    map.admitChunk(1, {
      activityIntervals: [
        { startMs: CHUNK_MS + 9000, endMs: CHUNK_MS + 9500, chunkIndex: 1 },
      ],
      visibilityEvents: [],
    });
    map.admitChunk(2, {
      activityIntervals: [
        {
          startMs: 2 * CHUNK_MS + 100,
          endMs: 3 * CHUNK_MS - 100,
          chunkIndex: 2,
        },
      ],
      visibilityEvents: [],
    });

    expect(map.getBands()).toEqual([
      {
        startMs: 2000,
        endMs: CHUNK_MS + 9000,
        kind: "idle",
        fidelity: "exact",
      },
      {
        startMs: CHUNK_MS + 9500,
        endMs: 2 * CHUNK_MS + 100,
        kind: "idle",
        fidelity: "exact",
      },
    ]);
  });

  it("does not band a silence shorter than the threshold", () => {
    const map: InactivityMap = new InactivityMap([makeEntry(0)]);

    map.admitChunk(0, {
      activityIntervals: [
        { startMs: 0, endMs: 1000, chunkIndex: 0 },
        { startMs: 5999, endMs: 6000, chunkIndex: 0 },
        { startMs: 11000, endMs: CHUNK_MS, chunkIndex: 0 },
      ],
      visibilityEvents: [],
    });

    expect(map.getBands()).toEqual([
      { startMs: 6000, endMs: 11000, kind: "idle", fidelity: "exact" },
    ]);
  });

  it("is idempotent per chunk: re-admitting after eviction changes nothing", () => {
    const map: InactivityMap = new InactivityMap(entries);

    map.admitChunk(2, {
      activityIntervals: [
        {
          startMs: 2 * CHUNK_MS + 10000,
          endMs: 2 * CHUNK_MS + 11000,
          chunkIndex: 2,
        },
      ],
      visibilityEvents: [],
    });

    const first: Array<ReplayIdleBand> = map.getBands();

    map.admitChunk(2, { activityIntervals: [], visibilityEvents: [] });

    expect(map.getBands()).toBe(first);
    expect(map.hasEvidence(2)).toBe(true);
    expect(map.hasEvidence(3)).toBe(false);
  });
});

describe("InactivityMap background tabs", () => {
  it("classifies a hidden-tab span separately and cuts idle bands around it", () => {
    const map: InactivityMap = new InactivityMap(entries);

    map.admitChunk(2, {
      activityIntervals: [],
      visibilityEvents: [visibility(2, 2 * CHUNK_MS + 1000, "hidden")],
    });
    map.admitChunk(3, {
      activityIntervals: [],
      visibilityEvents: [visibility(3, 3 * CHUNK_MS + 5000, "visible")],
    });

    expect(map.getBands()).toEqual([
      /* The 1s before the tab was hidden is below threshold: dropped. */
      {
        startMs: 2 * CHUNK_MS + 1000,
        endMs: 3 * CHUNK_MS + 5000,
        kind: "background-tab",
        fidelity: "exact",
      },
      {
        startMs: 3 * CHUNK_MS + 5000,
        endMs: 5 * CHUNK_MS,
        kind: "idle",
        fidelity: "coarse",
      },
    ]);
  });

  it("runs a hidden span to the end of the footage when the tab never came back", () => {
    const map: InactivityMap = new InactivityMap([makeEntry(0), makeEntry(1)]);

    map.admitChunk(1, {
      activityIntervals: [],
      visibilityEvents: [visibility(1, CHUNK_MS + 2000, "hidden")],
    });

    expect(map.getBands()).toContainEqual({
      startMs: CHUNK_MS + 2000,
      endMs: 2 * CHUNK_MS,
      kind: "background-tab",
      fidelity: "exact",
    });
  });
});

describe("InactivityMap lookups", () => {
  it("finds the band under the playhead, honouring a minimum remaining length", () => {
    const map: InactivityMap = new InactivityMap(entries);

    expect(map.findBandAt(CHUNK_MS)).toBeNull();
    expect(map.findBandAt(2 * CHUNK_MS)?.startMs).toBe(2 * CHUNK_MS);
    expect(map.findBandAt(4 * CHUNK_MS + 14000)?.kind).toBe("idle");
    /* 1s left in the band is not worth a jump. */
    expect(map.findBandAt(4 * CHUNK_MS + 14000, 1500)).toBeNull();
    expect(map.findBandAt(5 * CHUNK_MS)).toBeNull();
  });

  it("sums idle time for the 'idle 40%' copy", () => {
    const map: InactivityMap = new InactivityMap(entries);

    expect(map.getIdleMs()).toBe(3 * CHUNK_MS);
  });

  it("grows with appended manifest rows and keeps its evidence", () => {
    const map: InactivityMap = new InactivityMap([makeEntry(0), makeEntry(1)]);

    map.admitChunk(1, {
      activityIntervals: [
        { startMs: CHUNK_MS, endMs: CHUNK_MS + 500, chunkIndex: 1 },
      ],
      visibilityEvents: [],
    });

    map.appendEntries([makeEntry(2, 1), makeEntry(3, 1)]);

    expect(map.hasEvidence(1)).toBe(true);
    expect(map.getBands()).toEqual([
      {
        startMs: CHUNK_MS + 500,
        endMs: 4 * CHUNK_MS,
        kind: "idle",
        fidelity: "coarse",
      },
    ]);
  });
});

/*
 * The idle pause (issue #4208): after SESSION_REPLAY_IDLE_PAUSE_MS without
 * input the recorder stops capturing, and the next input resumes the same
 * tab in the next chunk on a fresh snapshot. The manifest only shows a jump
 * in time between two consecutive chunks; the oneuptime.idle-resumed row
 * that opens the resuming chunk names both ends of the stretch nobody
 * recorded. These pin how that stretch becomes a "paused" band, how idle
 * and background-tab bands give way to it, and that a recording without
 * the markers gets exactly the bands it always did.
 */

/* A chunk with explicit edges, so a pause can open a hole in the clock. */
function makeTimedEntry(
  chunkIndex: number,
  startMs: number,
  endMs: number,
  eventCount: number = 10,
): SessionReplayChunkManifestEntry {
  return {
    ...makeEntry(chunkIndex, eventCount),
    chunkStartOffsetMs: startMs,
    chunkEndOffsetMs: endMs,
  };
}

const CLIENT_CLOCK_MS: number = 1_700_000_000_000;

/* The resumed row the ChunkLoader lifts out of the resuming chunk. */
function resumedRow(
  chunkIndex: number,
  pausedAtOffsetMs: number | undefined,
  resumedAtOffsetMs: number,
): ReplayTimelineEvent {
  const row: ReplayTimelineEvent = {
    id: "rec:" + chunkIndex + ":resumed",
    kind: "idle-pause",
    chunkIndex: chunkIndex,
    offsetMs: resumedAtOffsetMs,
    idlePauseEdge: "resumed",
  };

  if (pausedAtOffsetMs !== undefined) {
    row.pausedAtOffsetMs = pausedAtOffsetMs;
    row.pausedAtUnixMs = CLIENT_CLOCK_MS + pausedAtOffsetMs;
    row.resumedAtUnixMs = CLIENT_CLOCK_MS + resumedAtOffsetMs;
  }

  return row;
}

function pausedRow(chunkIndex: number, offsetMs: number): ReplayTimelineEvent {
  return {
    id: "rec:" + chunkIndex + ":paused",
    kind: "idle-pause",
    chunkIndex: chunkIndex,
    offsetMs: offsetMs,
    idlePauseEdge: "paused",
    idleSinceUnixMs: CLIENT_CLOCK_MS + offsetMs - 300_000,
    pausedAtUnixMs: CLIENT_CLOCK_MS + offsetMs,
  };
}

function hasPausedBand(bands: Array<ReplayIdleBand>): boolean {
  return bands.some((band: ReplayIdleBand): boolean => {
    return band.kind === "paused";
  });
}

/*
 * 0-15s and 15-30s of footage, then nothing recorded until 90s, then
 * 90-105s and 105-120s. Chunk 1 ends on the pause, chunk 2 opens on the
 * resume: consecutive indexes, a minute apart on the clock.
 */
const PAUSE_START_MS: number = 30_000;
const PAUSE_END_MS: number = 90_000;

const pausedEntries: Array<SessionReplayChunkManifestEntry> = [
  makeTimedEntry(0, 0, 15_000),
  makeTimedEntry(1, 15_000, PAUSE_START_MS),
  makeTimedEntry(2, PAUSE_END_MS, 105_000),
  makeTimedEntry(3, 105_000, 120_000),
];

/* Every chunk decoded: activity until 16s, then from just after the resume. */
function admitPausedSession(
  map: InactivityMap,
  options?: {
    chunk1Visibility?: Array<ReplayTimelineEvent>;
    chunk2Visibility?: Array<ReplayTimelineEvent>;
    firstInputAfterResumeMs?: number;
    chunk2IdlePause?: Array<ReplayTimelineEvent>;
  },
): void {
  const firstInputMs: number =
    options?.firstInputAfterResumeMs ?? PAUSE_END_MS + 500;

  map.admitChunk(0, {
    activityIntervals: [{ startMs: 1000, endMs: 14_000, chunkIndex: 0 }],
    visibilityEvents: [],
  });
  map.admitChunk(1, {
    activityIntervals: [{ startMs: 15_000, endMs: 16_000, chunkIndex: 1 }],
    visibilityEvents: options?.chunk1Visibility ?? [],
    idlePauseEvents: [pausedRow(1, PAUSE_START_MS)],
  });
  map.admitChunk(2, {
    activityIntervals: [
      { startMs: firstInputMs, endMs: 104_000, chunkIndex: 2 },
    ],
    visibilityEvents: options?.chunk2Visibility ?? [],
    idlePauseEvents: options?.chunk2IdlePause ?? [
      resumedRow(2, PAUSE_START_MS, PAUSE_END_MS),
    ],
  });
  map.admitChunk(3, {
    activityIntervals: [{ startMs: 105_000, endMs: 119_000, chunkIndex: 3 }],
    visibilityEvents: [],
  });
}

const PAUSED_BAND: ReplayIdleBand = {
  startMs: PAUSE_START_MS,
  endMs: PAUSE_END_MS,
  kind: "paused",
  fidelity: "exact",
};

describe("InactivityMap paused bands", () => {
  it("draws the unrecorded stretch from an idle-resumed row alone", () => {
    /*
     * Only the resuming chunk is decoded: the chunk holding the
     * idle-paused marker is not, and need not be - the resume carries the
     * pause's start.
     */
    const map: InactivityMap = new InactivityMap(pausedEntries);

    map.admitChunk(2, {
      activityIntervals: [
        { startMs: PAUSE_END_MS + 500, endMs: 104_500, chunkIndex: 2 },
      ],
      visibilityEvents: [],
      idlePauseEvents: [resumedRow(2, PAUSE_START_MS, PAUSE_END_MS)],
    });

    expect(map.getBands()).toEqual([PAUSED_BAND]);
  });

  it("draws nothing for an idle-paused row the user never came back from", () => {
    /*
     * The recording simply ends at the pause marker: there is nothing
     * after it to skip to, and nothing unrecorded INSIDE the footage.
     */
    const entries: Array<SessionReplayChunkManifestEntry> = [
      makeTimedEntry(0, 0, 15_000),
      makeTimedEntry(1, 15_000, PAUSE_START_MS),
    ];
    const withMarker: InactivityMap = new InactivityMap(entries);
    const withoutMarker: InactivityMap = new InactivityMap(entries);

    for (const map of [withMarker, withoutMarker]) {
      map.admitChunk(0, {
        activityIntervals: [{ startMs: 1000, endMs: 14_000, chunkIndex: 0 }],
        visibilityEvents: [],
      });
    }

    withMarker.admitChunk(1, {
      activityIntervals: [{ startMs: 15_000, endMs: 16_000, chunkIndex: 1 }],
      visibilityEvents: [],
      idlePauseEvents: [pausedRow(1, PAUSE_START_MS)],
    });
    withoutMarker.admitChunk(1, {
      activityIntervals: [{ startMs: 15_000, endMs: 16_000, chunkIndex: 1 }],
      visibilityEvents: [],
    });

    expect(withMarker.getBands()).toEqual(withoutMarker.getBands());
    expect(hasPausedBand(withMarker.getBands())).toBe(false);
    /* The recorded idleness before the pause stays an idle band. */
    expect(withMarker.getBands()).toEqual([
      {
        startMs: 16_000,
        endMs: PAUSE_START_MS,
        kind: "idle",
        fidelity: "exact",
      },
    ]);
  });

  it("cuts the idle run around the pause, keeping the recorded idleness before it", () => {
    const map: InactivityMap = new InactivityMap(pausedEntries);

    admitPausedSession(map);

    /*
     * The run from 16s to the first input after the resume (90.5s) would
     * have been one 74.5s idle band. The 14s before the pause are footage
     * of a page nobody touched; the minute after is not footage at all;
     * and the half second between the resume and the first input is below
     * the threshold, so it is dropped rather than drawn as a sliver.
     */
    expect(map.getBands()).toEqual([
      {
        startMs: 16_000,
        endMs: PAUSE_START_MS,
        kind: "idle",
        fidelity: "exact",
      },
      PAUSED_BAND,
    ]);
  });

  it("keeps the idle stretch after a resume when the user came back and sat still", () => {
    const map: InactivityMap = new InactivityMap(pausedEntries);

    /* One input resumed capture; the next one came ten seconds later. */
    admitPausedSession(map, {
      firstInputAfterResumeMs: PAUSE_END_MS + 10_000,
    });

    expect(map.getBands()).toEqual([
      {
        startMs: 16_000,
        endMs: PAUSE_START_MS,
        kind: "idle",
        fidelity: "exact",
      },
      PAUSED_BAND,
      {
        startMs: PAUSE_END_MS,
        endMs: PAUSE_END_MS + 10_000,
        kind: "idle",
        fidelity: "exact",
      },
    ]);
  });

  it("stops a background-tab band where the pause began instead of running through it", () => {
    /*
     * The tab went into the background at 20s and the recorder paused at
     * 30s. The visible event comes right after the resume, at 90s, so the
     * hidden span in the stream is 20s-90s - but the tab being hidden is
     * only known up to the moment capture stopped.
     */
    const map: InactivityMap = new InactivityMap(pausedEntries);

    admitPausedSession(map, {
      chunk1Visibility: [visibility(1, 20_000, "hidden")],
      chunk2Visibility: [visibility(2, PAUSE_END_MS, "visible")],
    });

    expect(map.getBands()).toEqual([
      /* The 4s of idleness before the tab was hidden is below threshold. */
      {
        startMs: 20_000,
        endMs: PAUSE_START_MS,
        kind: "background-tab",
        fidelity: "exact",
      },
      PAUSED_BAND,
    ]);
  });

  it("drops a background-tab piece left shorter than the threshold by the pause", () => {
    /*
     * Hidden three seconds before the pause: what is left of the hidden
     * span is no band, exactly as a three-second hidden span never was,
     * and the idle run before it stands.
     */
    const map: InactivityMap = new InactivityMap(pausedEntries);

    admitPausedSession(map, {
      chunk1Visibility: [visibility(1, 27_000, "hidden")],
      chunk2Visibility: [visibility(2, PAUSE_END_MS, "visible")],
    });

    expect(map.getBands()).toEqual([
      {
        startMs: 16_000,
        endMs: PAUSE_START_MS,
        kind: "idle",
        fidelity: "exact",
      },
      PAUSED_BAND,
    ]);
  });

  it("never lets two kinds claim the same moment", () => {
    const map: InactivityMap = new InactivityMap(pausedEntries);

    admitPausedSession(map, {
      chunk1Visibility: [visibility(1, 20_000, "hidden")],
      chunk2Visibility: [visibility(2, PAUSE_END_MS, "visible")],
      firstInputAfterResumeMs: PAUSE_END_MS + 8000,
    });

    const bands: Array<ReplayIdleBand> = map.getBands();

    expect(bands.length).toBeGreaterThanOrEqual(3);

    for (let i: number = 1; i < bands.length; i++) {
      expect(bands[i]!.startMs).toBeGreaterThanOrEqual(bands[i - 1]!.endMs);
    }
  });

  it("ignores a resumed row that carries no valid pause", () => {
    /*
     * ChunkLoader keeps a malformed marker's row (resume before pause,
     * stamps that are not numbers) but gives it no pausedAtOffsetMs. Such
     * a row - and a defensively-built one whose pause starts after its
     * own resume, or at NaN, or that claims to be the paused edge - draws
     * nothing, and the bands are those of a recording without the marker.
     */
    const malformedRows: Array<Array<ReplayTimelineEvent>> = [
      [resumedRow(2, undefined, PAUSE_END_MS)],
      [
        {
          ...resumedRow(2, PAUSE_START_MS, PAUSE_END_MS),
          pausedAtOffsetMs: PAUSE_END_MS + 1,
        },
      ],
      [
        {
          ...resumedRow(2, PAUSE_START_MS, PAUSE_END_MS),
          pausedAtOffsetMs: Number.NaN,
        },
      ],
      [
        {
          ...resumedRow(2, PAUSE_START_MS, PAUSE_END_MS),
          idlePauseEdge: "paused",
        },
      ],
    ];

    const reference: InactivityMap = new InactivityMap(pausedEntries);

    admitPausedSession(reference, { chunk2IdlePause: [] });

    for (const rows of malformedRows) {
      const map: InactivityMap = new InactivityMap(pausedEntries);

      admitPausedSession(map, { chunk2IdlePause: rows });

      expect(map.getBands()).toEqual(reference.getBands());
      expect(hasPausedBand(map.getBands())).toBe(false);
    }

    /* Without the pause the run is one idle band through the stretch. */
    expect(reference.getBands()).toEqual([
      {
        startMs: 16_000,
        endMs: PAUSE_END_MS + 500,
        kind: "idle",
        fidelity: "exact",
      },
    ]);
  });

  it("reads idle-pause rows only from idlePauseEvents, and only rows of that kind", () => {
    const map: InactivityMap = new InactivityMap(pausedEntries);

    map.admitChunk(2, {
      activityIntervals: [],
      /* An idle-pause row in the wrong list is not evidence of a pause. */
      visibilityEvents: [resumedRow(2, PAUSE_START_MS, PAUSE_END_MS)],
      /* And a visibility row in this one is ignored too. */
      idlePauseEvents: [visibility(2, PAUSE_END_MS, "hidden")],
    });

    expect(hasPausedBand(map.getBands())).toBe(false);
  });

  it("gives a recording without markers exactly the bands it always had", () => {
    /*
     * Evidence from before the idle pause existed has no idlePauseEvents
     * at all. Leaving it out, passing an empty list, and passing only
     * other kinds of rows must all agree, band for band.
     */
    const evidenceFor: (
      variant: "absent" | "empty" | "other-kinds",
    ) => Map<number, InactivityChunkEvidence> = (
      variant: "absent" | "empty" | "other-kinds",
    ): Map<number, InactivityChunkEvidence> => {
      const evidence: Map<number, InactivityChunkEvidence> = new Map<
        number,
        InactivityChunkEvidence
      >();
      const chunk2: InactivityChunkEvidence = {
        activityIntervals: [
          {
            startMs: 2 * CHUNK_MS + 10000,
            endMs: 2 * CHUNK_MS + 11000,
            chunkIndex: 2,
          },
        ],
        visibilityEvents: [visibility(2, 2 * CHUNK_MS + 12_000, "hidden")],
      };

      if (variant === "empty") {
        chunk2.idlePauseEvents = [];
      } else if (variant === "other-kinds") {
        chunk2.idlePauseEvents = [
          visibility(2, 2 * CHUNK_MS + 12_000, "hidden"),
        ];
      }

      evidence.set(2, chunk2);
      evidence.set(3, {
        activityIntervals: [],
        visibilityEvents: [visibility(3, 3 * CHUNK_MS + 9000, "visible")],
      });

      return evidence;
    };

    const absent: Array<ReplayIdleBand> = InactivityMap.computeBands(
      entries,
      evidenceFor("absent"),
      SESSION_REPLAY_IDLE_THRESHOLD_MS,
      4,
    );

    expect(
      InactivityMap.computeBands(
        entries,
        evidenceFor("empty"),
        SESSION_REPLAY_IDLE_THRESHOLD_MS,
        4,
      ),
    ).toEqual(absent);
    expect(
      InactivityMap.computeBands(
        entries,
        evidenceFor("other-kinds"),
        SESSION_REPLAY_IDLE_THRESHOLD_MS,
        4,
      ),
    ).toEqual(absent);

    /* And those are the same bands the map drew before pauses existed. */
    expect(absent).toEqual([
      {
        startMs: 2 * CHUNK_MS,
        endMs: 2 * CHUNK_MS + 10000,
        kind: "idle",
        fidelity: "coarse",
      },
      {
        startMs: 2 * CHUNK_MS + 12_000,
        endMs: 3 * CHUNK_MS + 9000,
        kind: "background-tab",
        fidelity: "exact",
      },
      {
        startMs: 3 * CHUNK_MS + 9000,
        endMs: 5 * CHUNK_MS,
        kind: "idle",
        fidelity: "coarse",
      },
    ]);
  });

  it("does not band a pause shorter than the threshold", () => {
    /*
     * The user came back three seconds after the pause began: like a
     * three-second hidden tab, that is no band, and the idle run carries
     * on through it as it would have without the marker.
     */
    const shortEntries: Array<SessionReplayChunkManifestEntry> = [
      makeTimedEntry(0, 0, 15_000),
      makeTimedEntry(1, 15_000, PAUSE_START_MS),
      makeTimedEntry(2, PAUSE_START_MS + 3000, 48_000),
    ];
    const map: InactivityMap = new InactivityMap(shortEntries);

    map.admitChunk(0, {
      activityIntervals: [{ startMs: 1000, endMs: 14_000, chunkIndex: 0 }],
      visibilityEvents: [],
    });
    map.admitChunk(1, {
      activityIntervals: [{ startMs: 15_000, endMs: 16_000, chunkIndex: 1 }],
      visibilityEvents: [],
    });
    map.admitChunk(2, {
      activityIntervals: [
        { startMs: PAUSE_START_MS + 3500, endMs: 47_000, chunkIndex: 2 },
      ],
      visibilityEvents: [],
      idlePauseEvents: [resumedRow(2, PAUSE_START_MS, PAUSE_START_MS + 3000)],
    });

    expect(map.getBands()).toEqual([
      {
        startMs: 16_000,
        endMs: PAUSE_START_MS + 3500,
        kind: "idle",
        fidelity: "exact",
      },
    ]);
  });

  it("merges overlapping pauses and clamps one that began before zero", () => {
    const timedEntries: Array<SessionReplayChunkManifestEntry> = [
      makeTimedEntry(0, 60_000, 75_000),
      makeTimedEntry(1, 90_000, 105_000),
    ];
    const map: InactivityMap = new InactivityMap(timedEntries);

    map.admitChunk(0, {
      activityIntervals: [{ startMs: 60_500, endMs: 74_000, chunkIndex: 0 }],
      visibilityEvents: [],
      idlePauseEvents: [resumedRow(0, -5000, 60_000)],
    });
    map.admitChunk(1, {
      activityIntervals: [{ startMs: 90_500, endMs: 104_000, chunkIndex: 1 }],
      visibilityEvents: [],
      /* Two rows for one pause, overlapping: one band. */
      idlePauseEvents: [
        resumedRow(1, 75_000, 90_000),
        resumedRow(1, 80_000, 88_000),
      ],
    });

    expect(
      map.getBands().filter((band: ReplayIdleBand): boolean => {
        return band.kind === "paused";
      }),
    ).toEqual([
      { startMs: 0, endMs: 60_000, kind: "paused", fidelity: "exact" },
      { startMs: 75_000, endMs: 90_000, kind: "paused", fidelity: "exact" },
    ]);
  });

  it("finds the paused band under the playhead, honouring the minimum remaining", () => {
    const map: InactivityMap = new InactivityMap(pausedEntries);

    admitPausedSession(map);

    expect(map.findBandAt(PAUSE_START_MS)?.kind).toBe("paused");
    expect(map.findBandAt(60_000)?.kind).toBe("paused");
    expect(map.findBandAt(29_000)?.kind).toBe("idle");
    /*
     * A skip lands one second short of the band's end; the 1.5s rule is
     * what stops the next tick from finding the same band again.
     */
    expect(map.findBandAt(PAUSE_END_MS - 1000, 1500)).toBeNull();
    expect(map.findBandAt(PAUSE_END_MS - 2000, 1500)?.kind).toBe("paused");
    expect(map.findBandAt(PAUSE_END_MS)).toBeNull();
  });

  it("counts a paused stretch as idle time", () => {
    const map: InactivityMap = new InactivityMap(pausedEntries);

    admitPausedSession(map);

    expect(map.getIdleMs()).toBe(
      PAUSE_START_MS - 16_000 + (PAUSE_END_MS - PAUSE_START_MS),
    );
  });

  it("keeps a paused band through re-admission and drops it on a tab switch", () => {
    const map: InactivityMap = new InactivityMap(pausedEntries);

    admitPausedSession(map);

    const first: Array<ReplayIdleBand> = map.getBands();

    map.admitChunk(2, { activityIntervals: [], visibilityEvents: [] });

    expect(map.getBands()).toBe(first);
    expect(hasPausedBand(first)).toBe(true);

    map.setEntries(pausedEntries);

    expect(hasPausedBand(map.getBands())).toBe(false);
  });
});
