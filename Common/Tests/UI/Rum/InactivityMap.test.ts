import { describe, expect, it } from "@jest/globals";
import {
  SESSION_REPLAY_IDLE_THRESHOLD_MS,
  SessionReplayChunkManifestEntry,
} from "../../../Types/Rum/SessionReplay";
import InactivityMap from "../../../../App/FeatureSet/Dashboard/src/Components/SessionReplay/Engine/InactivityMap";
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
