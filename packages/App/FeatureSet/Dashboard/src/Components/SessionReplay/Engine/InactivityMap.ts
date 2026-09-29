import {
  SESSION_REPLAY_ACTIVE_CHUNK_MIN_EVENTS,
  SESSION_REPLAY_IDLE_THRESHOLD_MS,
  SessionReplayChunkManifestEntry,
} from "Common/Types/Rum/SessionReplay";
import ChunkMath from "Common/Utils/Rum/ChunkMath";
import {
  ReplayActivityInterval,
  ReplayTimelineEvent,
} from "../ReplayTimelineTypes";
import { ReplayIdleBand } from "./ReplayEngineTypes";

/*
 * Where the user was doing nothing, on the session clock.
 *
 * Two fidelities, deliberately. The manifest alone says how many events
 * each 15s chunk carries, which is enough to hatch "probably idle" bands
 * before a single chunk is decoded - so the lane is never blank at t=0.
 * Once a chunk is decoded its activity intervals (rrweb MouseMove /
 * MouseInteraction / Scroll / Input / TouchMove / Drag plus the recorder's
 * route, click and frustration events) replace the guess with exact
 * edges. Bands whose every edge came from decoded footage are "exact";
 * the rest stay "coarse" and the timeline draws them lighter.
 *
 * A hidden tab (oneuptime.visibility) is not idleness - the user was
 * elsewhere, not reading - so those spans come out as "background-tab"
 * bands, drawn differently, and idle bands are cut around them.
 *
 * Pure: no rrweb, no React, no I/O. The engine feeds it and reads bands
 * out; the timeline draws them; IDLE_SKIP jumps over them. rrweb's own
 * skipInactive only scans the events it has been fed, which on a
 * chunk-streamed player is at most 30s ahead, so a 3-minute idle stretch
 * would play out in full. This map knows the whole session up front.
 */

export interface InactivityMapOptions {
  /* Silence at least this long is a band. */
  thresholdMs?: number | undefined;
  /* Chunks with fewer events are provisionally idle before decode. */
  activeChunkMinEvents?: number | undefined;
}

/* What one decoded chunk contributes. */
export interface InactivityChunkEvidence {
  activityIntervals: Array<ReplayActivityInterval>;
  /* The chunk's visibility rows, if any; other kinds are ignored. */
  visibilityEvents: Array<ReplayTimelineEvent>;
}

interface VisibilityPoint {
  offsetMs: number;
  state: "hidden" | "visible";
}

export default class InactivityMap {
  private readonly thresholdMs: number;
  private readonly activeChunkMinEvents: number;
  private entries: Array<SessionReplayChunkManifestEntry>;
  private readonly evidence: Map<number, InactivityChunkEvidence>;
  private cachedBands: Array<ReplayIdleBand> | null;

  public constructor(
    entries: Array<SessionReplayChunkManifestEntry>,
    options?: InactivityMapOptions,
  ) {
    this.thresholdMs = options?.thresholdMs ?? SESSION_REPLAY_IDLE_THRESHOLD_MS;
    this.activeChunkMinEvents =
      options?.activeChunkMinEvents ?? SESSION_REPLAY_ACTIVE_CHUNK_MIN_EVENTS;
    this.entries = InactivityMap.normaliseEntries(entries);
    this.evidence = new Map<number, InactivityChunkEvidence>();
    this.cachedBands = null;
  }

  private static normaliseEntries(
    entries: Array<SessionReplayChunkManifestEntry>,
  ): Array<SessionReplayChunkManifestEntry> {
    const byIndex: Map<number, SessionReplayChunkManifestEntry> = new Map<
      number,
      SessionReplayChunkManifestEntry
    >();

    for (const entry of entries) {
      if (!ChunkMath.isTerminatorEntry(entry)) {
        byIndex.set(entry.chunkIndex, entry);
      }
    }

    return [...byIndex.values()].sort(
      (
        a: SessionReplayChunkManifestEntry,
        b: SessionReplayChunkManifestEntry,
      ): number => {
        return a.chunkIndex - b.chunkIndex;
      },
    );
  }

  /* Live sessions: more manifest rows arrived. Evidence is kept. */
  public appendEntries(entries: Array<SessionReplayChunkManifestEntry>): void {
    this.entries = InactivityMap.normaliseEntries([
      ...this.entries,
      ...entries,
    ]);
    this.cachedBands = null;
  }

  /* Replace the manifest wholesale (tab switch). Evidence is dropped. */
  public setEntries(entries: Array<SessionReplayChunkManifestEntry>): void {
    this.entries = InactivityMap.normaliseEntries(entries);
    this.evidence.clear();
    this.cachedBands = null;
  }

  /*
   * A chunk was decoded: its guess becomes fact. Idempotent per chunk -
   * re-admitting after eviction is free and changes nothing.
   */
  public admitChunk(
    chunkIndex: number,
    evidence: InactivityChunkEvidence,
  ): void {
    if (this.evidence.has(chunkIndex)) {
      return;
    }

    this.evidence.set(chunkIndex, {
      activityIntervals: [...evidence.activityIntervals].sort(
        (a: ReplayActivityInterval, b: ReplayActivityInterval): number => {
          return a.startMs - b.startMs;
        },
      ),
      visibilityEvents: evidence.visibilityEvents.filter(
        (event: ReplayTimelineEvent): boolean => {
          return event.kind === "visibility";
        },
      ),
    });
    this.cachedBands = null;
  }

  public hasEvidence(chunkIndex: number): boolean {
    return this.evidence.has(chunkIndex);
  }

  public getBands(): Array<ReplayIdleBand> {
    if (!this.cachedBands) {
      this.cachedBands = InactivityMap.computeBands(
        this.entries,
        this.evidence,
        this.thresholdMs,
        this.activeChunkMinEvents,
      );
    }

    return this.cachedBands;
  }

  /*
   * The band the playhead is inside, if any. `minRemainingMs` lets the
   * skipper ignore a band it has nearly left - jumping 300ms is a hitch,
   * not a skip.
   */
  public findBandAt(
    offsetMs: number,
    minRemainingMs: number = 0,
  ): ReplayIdleBand | null {
    for (const band of this.getBands()) {
      if (band.startMs > offsetMs) {
        break;
      }

      if (offsetMs < band.endMs && band.endMs - offsetMs >= minRemainingMs) {
        return band;
      }
    }

    return null;
  }

  /* Total idle time (both kinds), for "idle 40%" style copy. */
  public getIdleMs(): number {
    return this.getBands().reduce(
      (total: number, band: ReplayIdleBand): number => {
        return total + (band.endMs - band.startMs);
      },
      0,
    );
  }

  /*
   * The whole computation, pure and exported for tests.
   *
   * Walks the chunks in order carrying "when did the user last do
   * something". A decoded chunk answers exactly from its intervals; an
   * undecoded chunk with enough events counts as active for its whole
   * span (edges approximate); an undecoded chunk with too few events is
   * silence that keeps the run going. A hole in the chunk sequence ends
   * the run: missing footage is a gap band, never an idle one.
   */
  public static computeBands(
    entries: Array<SessionReplayChunkManifestEntry>,
    evidence: Map<number, InactivityChunkEvidence>,
    thresholdMs: number,
    activeChunkMinEvents: number,
  ): Array<ReplayIdleBand> {
    const sorted: Array<SessionReplayChunkManifestEntry> =
      InactivityMap.normaliseEntries(entries);

    if (sorted.length === 0) {
      return [];
    }

    const idle: Array<ReplayIdleBand> = [];

    let lastActivityMs: number = sorted[0]?.chunkStartOffsetMs ?? 0;
    /* True while the run's START edge came from a guess. */
    let runIsCoarse: boolean = false;
    let previous: SessionReplayChunkManifestEntry | null = null;

    const closeRun: (endMs: number, endIsCoarse: boolean) => void = (
      endMs: number,
      endIsCoarse: boolean,
    ): void => {
      if (endMs - lastActivityMs >= thresholdMs) {
        idle.push({
          startMs: lastActivityMs,
          endMs: endMs,
          kind: "idle",
          fidelity: runIsCoarse || endIsCoarse ? "coarse" : "exact",
        });
      }
    };

    for (const entry of sorted) {
      if (previous && entry.chunkIndex !== previous.chunkIndex + 1) {
        /* A hole. Close the run at the footage's edge and restart after it. */
        closeRun(previous.chunkEndOffsetMs, !evidence.has(previous.chunkIndex));
        lastActivityMs = entry.chunkStartOffsetMs;
        runIsCoarse = false;
      }

      const known: InactivityChunkEvidence | undefined = evidence.get(
        entry.chunkIndex,
      );

      if (known) {
        for (const interval of known.activityIntervals) {
          closeRun(interval.startMs, false);
          lastActivityMs = Math.max(lastActivityMs, interval.endMs);
          runIsCoarse = false;
        }
      } else if (entry.eventCount >= activeChunkMinEvents) {
        /*
         * Active but undecoded: the user did something somewhere in these
         * 15 seconds. Both edges of any band touching it are guesses.
         */
        closeRun(entry.chunkStartOffsetMs, true);
        lastActivityMs = Math.max(lastActivityMs, entry.chunkEndOffsetMs);
        runIsCoarse = true;
      } else {
        /* Provisionally idle: the run continues, now on a guess. */
        runIsCoarse = true;
      }

      previous = entry;
    }

    if (previous) {
      closeRun(previous.chunkEndOffsetMs, !evidence.has(previous.chunkIndex));
    }

    const background: Array<ReplayIdleBand> = InactivityMap.computeBackground(
      sorted,
      evidence,
      thresholdMs,
    );

    const trimmed: Array<ReplayIdleBand> = [];

    for (const band of idle) {
      trimmed.push(
        ...InactivityMap.subtract(band, background).filter(
          (piece: ReplayIdleBand): boolean => {
            return piece.endMs - piece.startMs >= thresholdMs;
          },
        ),
      );
    }

    return [...trimmed, ...background].sort(
      (a: ReplayIdleBand, b: ReplayIdleBand): number => {
        return a.startMs - b.startMs;
      },
    );
  }

  /*
   * hidden -> visible pairs from the decoded chunks' visibility rows. A
   * hidden with no visible after it runs to the end of the footage: the
   * user never came back before the tab closed.
   */
  private static computeBackground(
    sorted: Array<SessionReplayChunkManifestEntry>,
    evidence: Map<number, InactivityChunkEvidence>,
    thresholdMs: number,
  ): Array<ReplayIdleBand> {
    const points: Array<VisibilityPoint> = [];

    for (const entry of sorted) {
      const known: InactivityChunkEvidence | undefined = evidence.get(
        entry.chunkIndex,
      );

      if (!known) {
        continue;
      }

      for (const event of known.visibilityEvents) {
        if (
          event.visibilityState === "hidden" ||
          event.visibilityState === "visible"
        ) {
          points.push({
            offsetMs: event.offsetMs,
            state: event.visibilityState,
          });
        }
      }
    }

    points.sort((a: VisibilityPoint, b: VisibilityPoint): number => {
      return a.offsetMs - b.offsetMs;
    });

    const endMs: number = sorted[sorted.length - 1]?.chunkEndOffsetMs ?? 0;
    const bands: Array<ReplayIdleBand> = [];
    let hiddenSince: number | null = null;

    for (const point of points) {
      if (point.state === "hidden") {
        if (hiddenSince === null) {
          hiddenSince = point.offsetMs;
        }
      } else if (hiddenSince !== null) {
        if (point.offsetMs - hiddenSince >= thresholdMs) {
          bands.push({
            startMs: hiddenSince,
            endMs: point.offsetMs,
            kind: "background-tab",
            fidelity: "exact",
          });
        }

        hiddenSince = null;
      }
    }

    if (hiddenSince !== null && endMs - hiddenSince >= thresholdMs) {
      bands.push({
        startMs: hiddenSince,
        endMs: endMs,
        kind: "background-tab",
        fidelity: "exact",
      });
    }

    return bands;
  }

  /* Cut `others` out of `band`, returning the surviving pieces in order. */
  private static subtract(
    band: ReplayIdleBand,
    others: Array<ReplayIdleBand>,
  ): Array<ReplayIdleBand> {
    let pieces: Array<ReplayIdleBand> = [band];

    for (const other of others) {
      const next: Array<ReplayIdleBand> = [];

      for (const piece of pieces) {
        if (other.endMs <= piece.startMs || other.startMs >= piece.endMs) {
          next.push(piece);
          continue;
        }

        if (other.startMs > piece.startMs) {
          next.push({ ...piece, endMs: other.startMs });
        }

        if (other.endMs < piece.endMs) {
          next.push({ ...piece, startMs: other.endMs });
        }
      }

      pieces = next;
    }

    return pieces;
  }
}
