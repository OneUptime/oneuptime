import { describe, expect, it } from "@jest/globals";
import {
  REPLAY_BUFFERING_GRACE_MS,
  REPLAY_BUFFERING_RETRY_HINT_MS,
  REPLAY_CHUNK_RETRY_DELAYS_MS,
  REPLAY_FEED_AHEAD_MIN_MS,
  REPLAY_FEED_FORWARD_MAX_MS,
  REPLAY_REWIND_THRESHOLD_MS,
  ReplayBufferState,
  ReplayEngineEvent,
  ReplayEngineEventType,
  ReplayIntent,
  ReplayPhase,
  derivePhase,
} from "../../../../App/FeatureSet/Dashboard/src/Components/SessionReplay/Engine/ReplayEngineTypes";

/*
 * derivePhase is the table that makes "Play does nothing" impossible: the
 * UI never stores a phase, it derives one from (buffer, intent). Every
 * cell of the table is pinned here so the engine, the overlays and the
 * controls cannot drift on what a state looks like.
 */

const BUFFER_STATES: Array<ReplayBufferState> = [
  "empty",
  "building",
  "ok",
  "stalled",
  "gap-pending",
  "halted",
  "ended",
];

const INTENTS: Array<ReplayIntent> = ["paused", "playing"];

describe("derivePhase", () => {
  it("matches the design's phase table cell for cell", () => {
    const table: Array<[ReplayBufferState, ReplayIntent, ReplayPhase]> = [
      ["empty", "paused", "loading"],
      ["empty", "playing", "loading"],
      ["building", "paused", "seeking"],
      ["building", "playing", "buffering"],
      ["ok", "paused", "paused"],
      ["ok", "playing", "playing"],
      ["stalled", "paused", "paused"],
      ["stalled", "playing", "buffering"],
      ["gap-pending", "paused", "paused"],
      ["gap-pending", "playing", "playing"],
      ["halted", "paused", "error"],
      ["halted", "playing", "error"],
      ["ended", "paused", "ended"],
      ["ended", "playing", "ended"],
    ];

    for (const [buffer, intent, phase] of table) {
      expect(derivePhase(buffer, intent)).toBe(phase);
    }
  });

  it("is total: every (buffer, intent) pair yields a phase", () => {
    const phases: Array<ReplayPhase> = [
      "loading",
      "seeking",
      "buffering",
      "paused",
      "playing",
      "ended",
      "error",
    ];

    for (const buffer of BUFFER_STATES) {
      for (const intent of INTENTS) {
        expect(phases).toContain(derivePhase(buffer, intent));
      }
    }
  });

  it("never shows 'paused' while the viewer wants to play - the invariant behind 'Play does nothing'", () => {
    for (const buffer of BUFFER_STATES) {
      expect(derivePhase(buffer, "playing")).not.toBe("paused");
    }
  });

  it("never shows 'playing' or 'buffering' while the viewer wants to pause", () => {
    for (const buffer of BUFFER_STATES) {
      expect(derivePhase(buffer, "paused")).not.toBe("playing");
      expect(derivePhase(buffer, "paused")).not.toBe("buffering");
    }
  });

  it("intent does not matter for the terminal buffer states", () => {
    for (const buffer of [
      "empty",
      "halted",
      "ended",
    ] as Array<ReplayBufferState>) {
      expect(derivePhase(buffer, "paused")).toBe(
        derivePhase(buffer, "playing"),
      );
    }
  });
});

describe("ReplayEngineEvent", () => {
  it("covers every event in the design, by discriminant", () => {
    /*
     * Compile-time: each literal must satisfy the union. Runtime: the
     * list of discriminants is the design's list, in full.
     */
    const events: Array<ReplayEngineEvent> = [
      { type: "LOAD", anchorChunkIndex: 0, targetMs: 0 },
      { type: "PLAY" },
      { type: "PAUSE" },
      { type: "SEEK", offsetMs: 42000, token: 1 },
      { type: "SET_SPEED", speed: 2 },
      { type: "SET_SKIP_INACTIVE", enabled: true },
      { type: "TICK", nowMs: 1000 },
      { type: "EXTEND" },
      { type: "RRWEB_FINISH" },
      { type: "CHUNK_FAILED", chunkIndex: 3, message: "timed out" },
      { type: "RETRY" },
      { type: "APPEND_ENTRIES", entries: [] },
      { type: "DISPOSE" },
      {
        type: "IDLE_SKIP",
        band: { startMs: 1000, endMs: 9000, kind: "idle", fidelity: "exact" },
      },
    ];

    const types: Array<ReplayEngineEventType> = events.map(
      (event: ReplayEngineEvent): ReplayEngineEventType => {
        return event.type;
      },
    );

    /* TAB_SWITCH needs a ChunkLoader instance; its discriminant is pinned by name. */
    const tabSwitch: ReplayEngineEventType = "TAB_SWITCH";
    types.push(tabSwitch);

    expect([...types].sort()).toEqual(
      [
        "LOAD",
        "PLAY",
        "PAUSE",
        "SEEK",
        "SET_SPEED",
        "SET_SKIP_INACTIVE",
        "TICK",
        "EXTEND",
        "RRWEB_FINISH",
        "CHUNK_FAILED",
        "RETRY",
        "TAB_SWITCH",
        "APPEND_ENTRIES",
        "DISPOSE",
        "IDLE_SKIP",
      ].sort(),
    );
  });
});

describe("engine timing constants", () => {
  it("carry the numbers the design specifies", () => {
    expect(REPLAY_BUFFERING_GRACE_MS).toBe(300);
    expect(REPLAY_BUFFERING_RETRY_HINT_MS).toBe(8000);
    expect(REPLAY_FEED_AHEAD_MIN_MS).toBe(30000);
    expect(REPLAY_FEED_FORWARD_MAX_MS).toBe(90000);
    expect(REPLAY_REWIND_THRESHOLD_MS).toBe(250);
    expect([...REPLAY_CHUNK_RETRY_DELAYS_MS]).toEqual([500, 2000]);
  });
});
