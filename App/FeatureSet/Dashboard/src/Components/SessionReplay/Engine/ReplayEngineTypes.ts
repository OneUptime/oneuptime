import {
  SessionReplayChunkManifestEntry,
  SessionReplayGap,
} from "Common/Types/Rum/SessionReplay";
import ChunkLoader, { SessionReplayRecordedEvent } from "../ChunkLoader";

/*
 * Contract for the rrweb-free playback engine (Engine/ReplayEngine.ts).
 *
 * Types only, plus derivePhase, the one pure table the UI and the engine
 * must agree on. The engine is a state machine over two independent
 * axes - what the viewer WANTS (intent) and what the footage CAN do
 * (buffer) - and the phase the UI shows is derived from the pair, never
 * stored. That is what makes "Play does nothing" impossible by
 * construction: there is no state in which intent is playing and the UI
 * shows a dead paused button, because paused is only ever derived from
 * intent === "paused".
 *
 * This file never imports rrweb. ReplayerLike is the structural subset of
 * rrweb's Replayer the engine touches; SessionReplayPlayer.tsx, the one
 * file allowed to import the package (dynamically), hands in a factory
 * that casts on the way in.
 */

/* What the viewer asked for. Survives rebuilds, tab switches and stalls. */
export type ReplayIntent = "paused" | "playing";

/*
 * What the footage can do right now.
 *
 *   empty       nothing loaded yet (before the first LOAD lands)
 *   building    a Replayer is being constructed or fed for a seek/load
 *   ok          the fed range covers the playhead with headroom
 *   stalled     playback ran out of fed footage; more exists (EXTEND)
 *   gap-pending the next chunk sits past a hole; a gap jump is queued
 *   halted      a chunk fetch failed for good; RETRY is the way out
 *   ended       the last chunk played out
 */
export type ReplayBufferState =
  | "empty"
  | "building"
  | "ok"
  | "stalled"
  | "gap-pending"
  | "halted"
  | "ended";

/* What the UI shows. Derived: see derivePhase. */
export type ReplayPhase =
  | "loading"
  | "seeking"
  | "buffering"
  | "paused"
  | "playing"
  | "ended"
  | "error";

/*
 * The phase-derivation table from the design, as a pure function so the
 * engine, the overlays and the tests share one copy.
 *
 *   empty                -> loading
 *   building + paused    -> seeking
 *   building + playing   -> buffering
 *   ok + paused          -> paused
 *   ok + playing         -> playing
 *   stalled + playing    -> buffering
 *   stalled + paused     -> paused
 *   gap-pending + *      -> as ok (playing until the fed range runs out,
 *                           then the engine jumps and rebuilds)
 *   ended                -> ended
 *   halted               -> error (retryable)
 */
export function derivePhase(
  buffer: ReplayBufferState,
  intent: ReplayIntent,
): ReplayPhase {
  switch (buffer) {
    case "empty":
      return "loading";
    case "building":
      return intent === "playing" ? "buffering" : "seeking";
    case "ok":
    case "gap-pending":
      return intent === "playing" ? "playing" : "paused";
    case "stalled":
      return intent === "playing" ? "buffering" : "paused";
    case "ended":
      return "ended";
    case "halted":
      return "error";
    default: {
      /* Exhaustiveness: a new buffer state must be added to the table. */
      const unreachable: never = buffer;
      return unreachable;
    }
  }
}

/* A stretch the viewer can skip: no input, or the tab was hidden. */
export interface ReplayIdleBand {
  startMs: number;
  endMs: number;
  /*
   * "idle" = no user input for >= SESSION_REPLAY_IDLE_THRESHOLD_MS;
   * "background-tab" = oneuptime.visibility hidden span, drawn differently.
   */
  kind: "idle" | "background-tab";
  /*
   * Coarse bands come from manifest eventCount alone and may be refined
   * once the chunk is decoded; exact bands come from decoded events.
   */
  fidelity: "coarse" | "exact";
}

export interface ReplayFedRange {
  fromMs: number;
  toMs: number;
}

export interface ReplayRecordedSize {
  width: number;
  height: number;
}

export interface ReplayEngineError {
  /* Domain copy, never a bare rrweb or HTTP string. */
  message: string;
  retryable: boolean;
}

/*
 * Everything the UI renders from. Published at most every 33ms while
 * playing; immutable per publish so React can compare by reference.
 */
export interface ReplayEngineSnapshot {
  phase: ReplayPhase;
  intent: ReplayIntent;
  buffer: ReplayBufferState;
  /*
   * Session-clock playhead. Never decreases except on SEEK, and during a
   * rebuild reports the seek TARGET (pendingSeekMs), never 0.
   */
  currentTimeMs: number;
  durationMs: number;
  speed: number;
  /* Stored intent only; rrweb's own skipInactive is never set true. */
  skipInactive: boolean;
  /* What has been fed into the live Replayer, on the session clock. */
  fedRange: ReplayFedRange | null;
  loadedChunkIndexes: Array<number>;
  activeTabId: string;
  /* From the last rrweb Meta/resize event; null before the first frame. */
  recordedSize: ReplayRecordedSize | null;
  /* When the current buffering started, for the 300ms grace and 8s retry hint. */
  bufferingSinceMs: number | null;
  /* The hole most recently crossed, for the interstitial toast. */
  lastGap: SessionReplayGap | null;
  /* The idle band most recently skipped, for the toast. */
  lastIdleSkip: ReplayIdleBand | null;
  error: ReplayEngineError | null;
  /* Target of an in-flight seek, so the clock reports where it is going. */
  pendingSeekMs: number | null;
  /* Increments on every LOAD/TAB_SWITCH/DISPOSE; stale async work checks it. */
  generation: number;
}

/*
 * Every event the engine accepts. All synchronous and idempotent: sending
 * PLAY twice is one play, TICK with nothing to do is a no-op, DISPOSE
 * after DISPOSE is safe.
 */
export type ReplayEngineEvent =
  /* Build a Replayer from `anchorChunkIndex` and land at `targetMs`. */
  | { type: "LOAD"; anchorChunkIndex: number; targetMs: number }
  | { type: "PLAY" }
  | { type: "PAUSE" }
  /*
   * token is monotonic so seeking twice to the same offset (clicking the
   * same marker again) still re-seeks; an offset alone cannot say that.
   */
  | { type: "SEEK"; offsetMs: number; token: number }
  | { type: "SET_SPEED"; speed: number }
  | { type: "SET_SKIP_INACTIVE"; enabled: boolean }
  /* Clock tick; nowMs is the deps.now() reading so tests can drive it. */
  | { type: "TICK"; nowMs: number }
  /* Feed the next contiguous chunk, or queue a gap jump. */
  | { type: "EXTEND" }
  /* rrweb's "finish" fired: stalled + EXTEND if more exists, else ended. */
  | { type: "RRWEB_FINISH" }
  /* A chunk fetch gave up after its retries. */
  | { type: "CHUNK_FAILED"; chunkIndex: number; message: string }
  | { type: "RETRY" }
  /* New loader for the target tab; the playhead is preserved when covered. */
  | { type: "TAB_SWITCH"; tabId: string; loader: ChunkLoader }
  /* Live sessions: manifest entries appended, bands recomputed, no rebuild. */
  | { type: "APPEND_ENTRIES"; entries: Array<SessionReplayChunkManifestEntry> }
  | { type: "DISPOSE" }
  /* The playhead entered an idle band with skipInactive on. */
  | { type: "IDLE_SKIP"; band: ReplayIdleBand };

export type ReplayEngineEventType = ReplayEngineEvent["type"];

export type ReplayEngineListener = (snapshot: ReplayEngineSnapshot) => void;

export interface ReplayEngineApi {
  dispatch: (event: ReplayEngineEvent) => void;
  /* Returns the unsubscribe function. Shaped for useSyncExternalStore. */
  subscribe: (listener: ReplayEngineListener) => () => void;
  getSnapshot: () => ReplayEngineSnapshot;
  /* Mount the Replayer's wrapper into the stage's container. */
  attach: (container: HTMLElement) => void;
  detach: () => void;
  dispose: () => void;
}

/*
 * Structural subset of rrweb's Replayer that the engine uses. Declared
 * rather than imported so this module stays rrweb-free; the factory casts
 * on the way in. Identical to the interface ReplayStage.tsx carried, moved
 * here so the stage can import it and drop its own copy.
 */
export interface ReplayerLike {
  readonly iframe: HTMLIFrameElement;
  readonly wrapper: HTMLElement;
  play: (timeOffsetMs?: number) => void;
  pause: (timeOffsetMs?: number) => void;
  destroy: () => void;
  addEvent: (event: SessionReplayRecordedEvent) => void;
  getCurrentTime: () => number;
  setConfig: (config: Record<string, unknown>) => void;
  on: (event: string, handler: (payload: unknown) => void) => unknown;
}

export type ReplayerFactory = (
  events: Array<SessionReplayRecordedEvent>,
  config: Record<string, unknown>,
) => ReplayerLike;

/* Handle for a scheduled callback; opaque so tests can use integers. */
export type ReplayScheduleHandle = unknown;

/*
 * Everything the engine needs from the outside, injected so tests drive
 * it synchronously with a fake clock and a fake Replayer.
 */
export interface ReplayEngineDeps {
  loader: ChunkLoader;
  createReplayer: ReplayerFactory;
  /* Monotonic milliseconds, e.g. performance.now(). */
  now: () => number;
  /* setTimeout-shaped; the engine schedules its own ticks through it. */
  schedule: (callback: () => void, delayMs: number) => ReplayScheduleHandle;
  cancel: (handle: ReplayScheduleHandle) => void;
}

/*
 * Timing constants the engine and its tests share. Named here rather than
 * in the engine so the overlays can quote the same numbers in copy.
 */

/* Buffering is not shown before this, so a fast fetch never flashes a pill. */
export const REPLAY_BUFFERING_GRACE_MS: number = 300;

/* After this long buffering, the pill offers Retry. */
export const REPLAY_BUFFERING_RETRY_HINT_MS: number = 8 * 1000;

/* Feed-ahead floor; the engine uses max(this, 20000 * speed). */
export const REPLAY_FEED_AHEAD_MIN_MS: number = 30 * 1000;

/* Beyond this much contiguous footage a seek rebuilds instead of feeding. */
export const REPLAY_FEED_FORWARD_MAX_MS: number = 90 * 1000;

/* Chunk fetch timeout and retry backoffs (2 retries). */
export const REPLAY_CHUNK_FETCH_TIMEOUT_MS: number = 15 * 1000;
export const REPLAY_CHUNK_RETRY_DELAYS_MS: ReadonlyArray<number> = [500, 2000];

/* Snapshot publish throttle while playing. */
export const REPLAY_SNAPSHOT_PUBLISH_INTERVAL_MS: number = 33;

/* Tick cadence when paused, and when the document is hidden. */
export const REPLAY_PAUSED_TICK_MS: number = 250;
export const REPLAY_HIDDEN_TICK_MS: number = 100;

/* PLAY at or past duration minus this rewinds to 0 first. */
export const REPLAY_REWIND_THRESHOLD_MS: number = 250;

/* Above this anchor payload the old Replayer is destroyed before rebuild. */
export const REPLAY_HOLD_LAST_FRAME_MAX_BYTES: number = 4 * 1024 * 1024;

/* Last-resort watchdog: asserted never to fire in fixture scenarios. */
export const REPLAY_WATCHDOG_MS: number = 1500;
