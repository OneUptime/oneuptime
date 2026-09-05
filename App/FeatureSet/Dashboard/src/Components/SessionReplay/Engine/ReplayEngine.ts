import {
  SessionReplayChunkManifestEntry,
  SessionReplayGap,
} from "Common/Types/Rum/SessionReplay";
import ChunkMath from "Common/Utils/Rum/ChunkMath";
import ChunkLoader, {
  ChunkLoadError,
  NextChunkDecision,
  RRWEB_EVENT_TYPE_INCREMENTAL,
  RRWEB_EVENT_TYPE_META,
  RRWEB_MOUSE_INTERACTION_TOUCH_START,
  RRWEB_SOURCE_MOUSE_INTERACTION,
  SessionReplayRecordedEvent,
} from "../ChunkLoader";
import {
  IDLE_SKIP_MIN_REMAINING_MS,
  computeFeedAheadMs,
  computePrefetchPagesAhead,
  getIdleSkipTargetMs,
  shouldRewindBeforePlay,
} from "../ReplayPlaybackIntent";
import {
  ReplayActivityInterval,
  ReplayTimelineEvent,
} from "../ReplayTimelineTypes";
import InactivityMap from "./InactivityMap";
import {
  REPLAY_FEED_FORWARD_MAX_MS,
  REPLAY_HIDDEN_TICK_MS,
  REPLAY_HOLD_LAST_FRAME_MAX_BYTES,
  REPLAY_PAUSED_TICK_MS,
  REPLAY_SNAPSHOT_PUBLISH_INTERVAL_MS,
  REPLAY_WATCHDOG_MS,
  ReplayBufferState,
  ReplayEngine,
  ReplayEngineDeps,
  ReplayEngineDiagnostics,
  ReplayEngineError,
  ReplayEngineEvent,
  ReplayEngineListener,
  ReplayEngineNotice,
  ReplayEngineOptions,
  ReplayEngineReplayerEvent,
  ReplayEngineReplayerListener,
  ReplayEngineSnapshot,
  ReplayIdleBand,
  ReplayIntent,
  ReplayRecordedSize,
  ReplayScheduleHandle,
  ReplayerLike,
  derivePhase,
} from "./ReplayEngineTypes";

/*
 * The playback engine: an rrweb-free, React-free state machine over two
 * axes - what the viewer WANTS (intent) and what the footage CAN do
 * (buffer) - with the phase the UI shows derived from the pair.
 *
 * Everything that used to be refs and effects inside ReplayStage.tsx is a
 * field and an event here, which is what makes "Play does nothing"
 * impossible by construction: there is no state in which intent is
 * playing and the UI shows a dead paused button, because paused is only
 * ever derived from intent === "paused". It is also what makes the whole
 * thing testable with a fake Replayer, a fake clock and a fixture loader,
 * synchronously, without a DOM.
 *
 * Invariants pinned by Common/Tests/UI/Rum/ReplayEngine.test.ts:
 *   (a) lastFedChunkIndex advances only AFTER addEvent succeeded;
 *   (b) currentTimeMs never decreases except on SEEK;
 *   (c) a rebuild reports the seek target, never 0;
 *   (d) rrweb's Finish never ends playback while getNextChunk is non-null;
 *   (e) every fetch is generation-guarded and abortable;
 *   (f) rrweb's own skipInactive is never set true;
 *   (g) the 1.5s watchdog is a backstop that never fires in the fixtures.
 *
 * Snapshot fields the UI reads (see ReplayEngineTypes.ReplayEngineSnapshot):
 * phase/intent/buffer, currentTimeMs, durationMs, speed, skipInactive,
 * fedRange, loadedChunkIndexes (the FED range, not the decoded LRU),
 * activeTabId, recordedSize, bufferingSinceMs, lastGap, lastIdleSkip,
 * error, pendingSeekMs, generation, notice, idleBands, feedAheadMs,
 * earliestPlayableMs.
 */

/* Chunks either side of the playhead kept decoded after a seek. */
const EVICTION_RADIUS_CHUNKS: number = 8;

/* A gap jump fires this close to the end of the fed range. */
const GAP_JUMP_LEAD_MS: number = 100;

/* Ticks while playing when no requestAnimationFrame is injected. */
const PLAYING_TICK_FALLBACK_MS: number = 16;

/*
 * If the new Replayer never reports a rebuilt snapshot (it always does in
 * practice), the held frame is dropped after this long anyway.
 */
const HOLDOVER_FALLBACK_MS: number = 2000;

/* Stand-in viewport when nothing in the recording says otherwise. */
const DEFAULT_VIEWPORT: ReplayRecordedSize = { width: 1280, height: 720 };

interface Segment {
  anchorChunkIndex: number;
  /* Session offset of the first event fed into this Replayer instance. */
  baseOffsetMs: number;
  lastFedChunkIndex: number;
  /* End of the fed range, in session offset. */
  fedUntilOffsetMs: number;
  replayer: ReplayerLike;
  /*
   * The transport state actually APPLIED to this Replayer, as opposed to
   * the intent. Re-issuing play() at the same offset restarts rrweb's
   * timer for nothing, so PLAY/PAUSE only act when this differs.
   */
  appliedIntent: ReplayIntent | null;
}

/*
 * A rebuild the tick loop still has to perform.
 *
 * `shouldReport` separates the two reasons we re-anchor: a genuine hole in
 * the chunk sequence, which the viewer MUST be told about, and a re-anchor
 * onto the very chunk that failed to decode, which is a retry and crossed
 * nothing. Reporting the retry as "0s of missing recording" would train
 * people to ignore the notice that matters.
 */
interface PendingJump {
  gap: SessionReplayGap;
  shouldReport: boolean;
}

/* A seek that is being reached by feeding forward into the live Replayer. */
interface FeedGoal {
  targetMs: number;
}

interface TickHandle {
  kind: "frame" | "timer";
  handle: ReplayScheduleHandle;
}

function formatOffset(ms: number): string {
  const total: number = Math.max(0, Math.round(ms / 1000));
  const minutes: number = Math.floor(total / 60);
  const seconds: number = total % 60;

  return `${minutes}:${seconds < 10 ? "0" : ""}${seconds}`;
}

class ReplayEngineMachine implements ReplayEngine {
  private readonly deps: ReplayEngineDeps;
  private loader: ChunkLoader;
  private inactivity: InactivityMap;
  private readonly headerViewport: ReplayRecordedSize | null;

  private readonly host: HTMLElement | null;
  private container: HTMLElement | null;

  private readonly listeners: Set<ReplayEngineListener>;
  private readonly replayerListeners: Set<ReplayEngineReplayerListener>;

  private intent: ReplayIntent;
  private buffer: ReplayBufferState;
  private generation: number;
  private speed: number;
  private skipInactive: boolean;
  private feedAheadMs: number;

  private currentTimeMs: number;
  private durationMs: number;
  private pendingSeekMs: number | null;
  private lastSeekToken: number;

  private segment: Segment | null;
  private holdover: Segment | null;
  private holdoverTimer: ReplayScheduleHandle | null;
  private pendingGap: PendingJump | null;
  private feedGoal: FeedGoal | null;
  private isExtending: boolean;

  private error: ReplayEngineError | null;
  private notice: ReplayEngineNotice | null;
  private lastGap: SessionReplayGap | null;
  private lastIdleSkip: ReplayIdleBand | null;
  private recordedSize: ReplayRecordedSize | null;
  private bufferingSinceMs: number | null;
  private activeTabId: string;
  private idleBands: Array<ReplayIdleBand>;
  private loadedChunkIndexes: Array<number>;

  private tickHandle: TickHandle | null;
  private lastPublishAtMs: number;
  private snapshot: ReplayEngineSnapshot;

  private watchdogLastTimeMs: number;
  private watchdogLastAdvanceAtMs: number;
  private watchdogFireCount: number;
  private replayersCreated: number;
  private replayersDestroyed: number;

  private isDisposed: boolean;

  public constructor(deps: ReplayEngineDeps, options: ReplayEngineOptions) {
    this.deps = deps;
    this.loader = deps.loader;
    this.inactivity = new InactivityMap(deps.loader.getPlayableEntries());
    this.headerViewport = options.headerViewport ?? null;

    this.host =
      typeof document !== "undefined" ? document.createElement("div") : null;

    if (this.host) {
      this.host.className = "oneuptime-replay-host";
      this.host.style.position = "relative";
    }

    this.container = null;

    this.listeners = new Set<ReplayEngineListener>();
    this.replayerListeners = new Set<ReplayEngineReplayerListener>();

    this.intent = "paused";
    this.buffer = "empty";
    this.generation = 0;
    this.speed = options.initialSpeed ?? 1;
    this.skipInactive = options.initialSkipInactive ?? false;
    this.feedAheadMs = computeFeedAheadMs(this.speed);

    this.currentTimeMs = 0;
    this.durationMs = deps.loader.getDurationMs();
    this.pendingSeekMs = null;
    this.lastSeekToken = Number.NEGATIVE_INFINITY;

    this.segment = null;
    this.holdover = null;
    this.holdoverTimer = null;
    this.pendingGap = null;
    this.feedGoal = null;
    this.isExtending = false;

    this.error = null;
    this.notice = null;
    this.lastGap = null;
    this.lastIdleSkip = null;
    this.recordedSize = null;
    this.bufferingSinceMs = null;
    this.activeTabId = options.tabId;
    this.idleBands = this.inactivity.getBands();
    this.loadedChunkIndexes = [];

    this.tickHandle = null;
    this.lastPublishAtMs = Number.NEGATIVE_INFINITY;

    this.watchdogLastTimeMs = -1;
    this.watchdogLastAdvanceAtMs = 0;
    this.watchdogFireCount = 0;
    this.replayersCreated = 0;
    this.replayersDestroyed = 0;

    this.isDisposed = false;

    this.snapshot = this.buildSnapshot();

    /*
     * Bound so callers can hand them straight to useSyncExternalStore
     * (`useSyncExternalStore(engine.subscribe, engine.getSnapshot)`)
     * without losing `this`.
     */
    this.dispatch = this.dispatch.bind(this);
    this.subscribe = this.subscribe.bind(this);
    this.getSnapshot = this.getSnapshot.bind(this);
    this.onReplayer = this.onReplayer.bind(this);
  }

  /* ---- Public API ---- */

  public dispatch(event: ReplayEngineEvent): void {
    if (this.isDisposed && event.type !== "DISPOSE") {
      return;
    }

    switch (event.type) {
      case "LOAD":
        this.startLoad(event.anchorChunkIndex, event.targetMs);
        break;
      case "PLAY":
        this.onPlay();
        break;
      case "PAUSE":
        this.onPause();
        break;
      case "SEEK":
        this.onSeek(event.offsetMs, event.token);
        break;
      case "SET_SPEED":
        this.onSetSpeed(event.speed);
        break;
      case "SET_SKIP_INACTIVE":
        this.skipInactive = event.enabled;
        this.publish();
        break;
      case "TICK":
        this.onTick(event.nowMs);
        return;
      case "EXTEND":
        void this.runExtend(this.generation);
        break;
      case "RRWEB_FINISH":
        this.onFinish();
        break;
      case "CHUNK_FAILED":
        this.halt({ message: event.message, retryable: true });
        break;
      case "RETRY":
        this.onRetry();
        break;
      case "TAB_SWITCH":
        this.onTabSwitch(event.tabId, event.loader);
        break;
      case "APPEND_ENTRIES":
        this.onAppendEntries(event.entries);
        break;
      case "IDLE_SKIP":
        this.onIdleSkip(event.band);
        break;
      case "DISPOSE":
        this.dispose();
        return;
      default: {
        const unreachable: never = event;
        return unreachable;
      }
    }

    this.rescheduleTick();
  }

  public subscribe(listener: ReplayEngineListener): () => void {
    this.listeners.add(listener);

    return (): void => {
      this.listeners.delete(listener);
    };
  }

  public getSnapshot(): ReplayEngineSnapshot {
    return this.snapshot;
  }

  public onReplayer(listener: ReplayEngineReplayerListener): () => void {
    this.replayerListeners.add(listener);

    return (): void => {
      this.replayerListeners.delete(listener);
    };
  }

  public getHostElement(): HTMLElement | null {
    return this.host;
  }

  public getDiagnostics(): ReplayEngineDiagnostics {
    return {
      watchdogFireCount: this.watchdogFireCount,
      replayersCreated: this.replayersCreated,
      replayersDestroyed: this.replayersDestroyed,
      generation: this.generation,
      anchorChunkIndex: this.segment?.anchorChunkIndex ?? null,
      lastFedChunkIndex: this.segment?.lastFedChunkIndex ?? null,
      isHoldingLastFrame: this.holdover !== null,
      isAttached: this.container !== null,
    };
  }

  public attach(container: HTMLElement): void {
    this.container = container;

    if (this.host && this.host.parentElement !== container) {
      container.appendChild(this.host);
    }
  }

  public detach(): void {
    if (this.host && this.host.parentElement) {
      this.host.parentElement.removeChild(this.host);
    }

    this.container = null;
  }

  public dispose(): void {
    if (this.isDisposed) {
      return;
    }

    this.isDisposed = true;
    this.generation += 1;
    this.cancelTick();
    this.destroyHoldover();

    if (this.segment) {
      this.destroyReplayer(this.segment.replayer);
      this.segment = null;
    }

    this.detach();
    this.loader.dispose();
    this.publish();
    this.listeners.clear();
    this.replayerListeners.clear();
  }

  /* ---- LOAD ---- */

  private startLoad(anchorChunkIndex: number, targetMs: number): void {
    const entry: SessionReplayChunkManifestEntry | undefined =
      this.loader.getEntry(anchorChunkIndex);

    if (!entry) {
      this.halt({
        message:
          "The part of the recording that should anchor playback is missing from the index.",
        retryable: false,
      });
      return;
    }

    this.generation += 1;
    const generation: number = this.generation;

    this.pendingGap = null;
    this.feedGoal = null;
    this.isExtending = false;
    this.error = null;
    /* (c) The clock reports where playback is GOING, never 0. */
    this.pendingSeekMs = targetMs;
    this.currentTimeMs = targetMs;
    this.buffer = "building";

    if (this.intent === "playing" && this.bufferingSinceMs === null) {
      this.bufferingSinceMs = this.deps.now();
    }

    /*
     * Hold the last frame: the old Replayer stays visible, dimmed, until
     * the new one has rebuilt its snapshot. Above 4MB of anchor payload the
     * old one goes eagerly instead, so heap never doubles on a huge DOM.
     */
    this.retireSegment(entry.payloadBytes > REPLAY_HOLD_LAST_FRAME_MAX_BYTES);
    this.publish();

    void this.build(anchorChunkIndex, targetMs, generation);
  }

  private async build(
    anchorChunkIndex: number,
    targetMs: number,
    generation: number,
  ): Promise<void> {
    try {
      await this.loader.loadFirst(anchorChunkIndex);

      if (generation !== this.generation) {
        return;
      }

      const anchorEvents: Array<SessionReplayRecordedEvent> | null =
        this.loader.getDecodedChunk(anchorChunkIndex);

      if (!anchorEvents || anchorEvents.length === 0) {
        this.onAnchorDecodeFailure(anchorChunkIndex, targetMs);
        return;
      }

      const events: Array<SessionReplayRecordedEvent> = [...anchorEvents];

      /*
       * rrweb creates its iframe hidden and only shows it on a Meta event.
       * An anchor holding a lone oversized FullSnapshot has its Meta in
       * the PREVIOUS chunk, so without this the stage plays as a blank
       * grey box with a moving clock.
       */
      if (
        !events.some((event: SessionReplayRecordedEvent): boolean => {
          return event.type === RRWEB_EVENT_TYPE_META;
        })
      ) {
        events.unshift(
          this.synthesizeMeta(anchorChunkIndex, events[0]?.timestamp ?? 0),
        );
      }

      let lastFedChunkIndex: number = anchorChunkIndex;
      this.refineInactivity(anchorChunkIndex);

      /*
       * Feed every contiguous chunk that is ALREADY decoded, so a seek that
       * lands 40s past its anchor does not cast the anchor, finish, stall
       * and rebuild. Only await a fetch when rrweb's two-event minimum is
       * not met ("Replayer need at least 2 events." must never reach the
       * viewer); everything else streams in through EXTEND.
       */
      for (;;) {
        const next: NextChunkDecision | null =
          this.loader.getNextChunk(lastFedChunkIndex);

        if (!next || next.skippedGap) {
          break;
        }

        let more: Array<SessionReplayRecordedEvent> | null =
          this.loader.getDecodedChunk(next.chunkIndex);

        if (!more) {
          if (events.length >= 2) {
            break;
          }

          more = await this.loader.ensureChunk(next.chunkIndex);

          if (generation !== this.generation) {
            return;
          }

          if (!more || more.length === 0) {
            break;
          }
        } else if (
          events.length >= 2 &&
          this.chunkEndMs(lastFedChunkIndex) >= targetMs + this.feedAheadMs
        ) {
          break;
        }

        events.push(...more);
        lastFedChunkIndex = next.chunkIndex;
        this.refineInactivity(next.chunkIndex);
      }

      if (events.length < 2) {
        this.halt({
          message:
            "This recording is too short to play. The only footage that survived is a single frame, which the player cannot render.",
          retryable: false,
        });
        return;
      }

      const baseOffsetMs: number = this.chunkStartMs(anchorChunkIndex);
      const replayer: ReplayerLike = this.deps.createReplayer(
        events,
        this.buildReplayerConfig(),
      );
      this.replayersCreated += 1;

      const segment: Segment = {
        anchorChunkIndex: anchorChunkIndex,
        baseOffsetMs: baseOffsetMs,
        lastFedChunkIndex: lastFedChunkIndex,
        fedUntilOffsetMs: this.chunkEndMs(lastFedChunkIndex),
        replayer: replayer,
        appliedIntent: null,
      };

      this.registerHandlers(replayer);
      this.segment = segment;
      this.updateLoadedChunkIndexes();
      this.emitReplayerEvent({ type: "created", replayer: replayer });

      if (targetMs <= segment.fedUntilOffsetMs) {
        this.landAt(targetMs);
      } else {
        /* Case 2 of SEEK, from a cold start: feed forward, then land. */
        this.feedGoal = { targetMs: targetMs };
        void this.runExtend(generation);
      }

      void this.loader
        .prefetchAhead(lastFedChunkIndex, computePrefetchPagesAhead(this.speed))
        .catch((): void => {
          // Prefetch failures surface when playback reaches the chunk.
        });

      this.publish();
    } catch (err) {
      if (generation !== this.generation) {
        return;
      }

      this.halt(this.describeLoadFailure(err));
    }
  }

  private buildReplayerConfig(): Record<string, unknown> {
    return {
      root: this.host ?? undefined,
      liveMode: false,
      /*
       * The pointer trail. rrweb draws it on a canvas layered over the
       * replay iframe, using the same mousemove samples the cursor is
       * positioned from. Without it a viewer sees a dot teleporting eight
       * times a second and cannot tell deliberate movement from a jump.
       */
      mouseTail: {
        duration: 800,
        lineCap: "round",
        lineWidth: 3,
        strokeStyle: "rgba(73, 80, 246, 0.5)",
      },
      /*
       * Canvas replay is never enabled here. rrweb implements it by
       * dropping the strict sandbox for "allow-same-origin allow-scripts",
       * which is script execution inside a document built from
       * attacker-influenceable HTML on the Dashboard's own origin.
       */
      UNSAFE_replayCanvas: false,
      blockClass: "oneuptime-block",
      useVirtualDom: true,
      speed: this.speed,
      /*
       * (f) ALWAYS false. rrweb's skipping only scans the events it has
       * been fed, which here is at most the feed-ahead window, so it
       * cannot skip a real idle stretch and DOES outrun the loader. The
       * engine skips from the InactivityMap instead (IDLE_SKIP).
       */
      skipInactive: false,
      /*
       * Bounds rrweb's own fast-forward, which is never triggered with
       * skipInactive false but is kept at the top of the manual speed
       * control so nothing can ever sprint faster than the loader.
       */
      maxSpeed: 8,
      showWarning: false,
      showDebug: false,
    };
  }

  private registerHandlers(replayer: ReplayerLike): void {
    /*
     * Every handler checks that the emitting instance is still the live
     * segment. rrweb schedules Finish 50ms after the last cast and
     * destroy() does not cancel it, so a retired Replayer's Finish would
     * otherwise land in the NEW segment and pause or re-stall it.
     */
    const isLive: () => boolean = (): boolean => {
      return this.segment?.replayer === replayer;
    };

    replayer.on("fullsnapshot-rebuilded", (): void => {
      if (!isLive()) {
        return;
      }

      this.destroyHoldover();
      this.emitReplayerEvent({
        type: "fullsnapshot-rebuilded",
        replayer: replayer,
      });
    });

    replayer.on("resize", (payload: unknown): void => {
      if (!isLive()) {
        return;
      }

      const size: { width?: unknown; height?: unknown } =
        (payload as { width?: unknown; height?: unknown }) || {};
      const width: number = Number(size.width);
      const height: number = Number(size.height);

      if (isFinite(width) && isFinite(height) && width > 0 && height > 0) {
        this.recordedSize = { width: width, height: height };
        this.publish();
      }
    });

    replayer.on("finish", (): void => {
      if (!isLive()) {
        return;
      }

      this.dispatch({ type: "RRWEB_FINISH" });
    });

    replayer.on("event-cast", (payload: unknown): void => {
      if (!isLive()) {
        return;
      }

      const event: { type?: unknown; data?: unknown } =
        (payload as { type?: unknown; data?: unknown }) || {};

      if (event.type !== RRWEB_EVENT_TYPE_INCREMENTAL) {
        return;
      }

      const data: {
        source?: unknown;
        type?: unknown;
        x?: unknown;
        y?: unknown;
      } =
        (event.data as {
          source?: unknown;
          type?: unknown;
          x?: unknown;
          y?: unknown;
        }) || {};

      if (
        data.source === RRWEB_SOURCE_MOUSE_INTERACTION &&
        data.type === RRWEB_MOUSE_INTERACTION_TOUCH_START &&
        typeof data.x === "number" &&
        typeof data.y === "number"
      ) {
        this.emitReplayerEvent({ type: "touch", x: data.x, y: data.y });
      }
    });
  }

  /*
   * A Meta event for an anchor that has none: dimensions from the previous
   * chunk's Meta when it is decoded, else the header viewport, else the
   * last size rrweb reported, else a sane default. The href comes from the
   * manifest row so the URL bar is right even before the next route event.
   */
  private synthesizeMeta(
    anchorChunkIndex: number,
    timestamp: number,
  ): SessionReplayRecordedEvent {
    let size: ReplayRecordedSize | null = null;
    let href: string = this.loader.getEntry(anchorChunkIndex)?.url ?? "";

    const previous: Array<SessionReplayRecordedEvent> | null =
      this.loader.getDecodedChunk(anchorChunkIndex - 1);

    if (previous) {
      for (let i: number = previous.length - 1; i >= 0; i--) {
        const candidate: SessionReplayRecordedEvent | undefined = previous[i];

        if (candidate?.type !== RRWEB_EVENT_TYPE_META) {
          continue;
        }

        const data: { width?: unknown; height?: unknown; href?: unknown } =
          (candidate.data as {
            width?: unknown;
            height?: unknown;
            href?: unknown;
          }) || {};

        if (
          typeof data.width === "number" &&
          typeof data.height === "number" &&
          data.width > 0 &&
          data.height > 0
        ) {
          size = { width: data.width, height: data.height };

          if (!href && typeof data.href === "string") {
            href = data.href;
          }
          break;
        }
      }
    }

    if (!size) {
      const rows: Array<ReplayTimelineEvent> | null =
        this.loader.getTimelineEventsForChunk(anchorChunkIndex - 1);
      const navigation: ReplayTimelineEvent | undefined = rows
        ?.filter((row: ReplayTimelineEvent): boolean => {
          return row.kind === "navigation" && Boolean(row.viewportWidth);
        })
        .pop();

      if (navigation?.viewportWidth && navigation.viewportHeight) {
        size = {
          width: navigation.viewportWidth,
          height: navigation.viewportHeight,
        };
      }
    }

    const resolved: ReplayRecordedSize =
      size ?? this.headerViewport ?? this.recordedSize ?? DEFAULT_VIEWPORT;

    return {
      type: RRWEB_EVENT_TYPE_META,
      timestamp: timestamp,
      data: { href: href, width: resolved.width, height: resolved.height },
    };
  }

  /*
   * The anchor came back empty: a TTL drop between manifest and read, a
   * truncated response, or a corrupt frame. Resume from the next snapshot
   * and report the footage that was crossed; halt (retryable) when there
   * is none.
   */
  private onAnchorDecodeFailure(
    anchorChunkIndex: number,
    targetMs: number,
  ): void {
    const next: number | null = ChunkMath.findNextAnchorAfter(
      this.loader.getFullSnapshotChunkIndexes(),
      anchorChunkIndex,
    );

    if (next === null) {
      this.halt({
        message:
          "This part of the recording could not be loaded: the chunk is listed in the index but came back empty, and there is no later snapshot to resume from.",
        retryable: true,
      });
      return;
    }

    const nextStartMs: number = this.chunkStartMs(next);

    if (targetMs < nextStartMs) {
      this.lastGap = {
        fromIndex: anchorChunkIndex,
        toIndex: next,
        missingMs: Math.max(
          0,
          nextStartMs - this.chunkStartMs(anchorChunkIndex),
        ),
      };
    }

    this.startLoad(next, Math.max(targetMs, nextStartMs));
  }

  /* Apply the intent at a moment inside the fed range. */
  private landAt(targetMs: number): void {
    const segment: Segment | null = this.segment;

    if (!segment) {
      return;
    }

    const within: number = Math.max(0, targetMs - segment.baseOffsetMs);

    segment.replayer.setConfig({ speed: this.speed });

    if (this.intent === "playing") {
      segment.replayer.play(within);
      segment.appliedIntent = "playing";
    } else {
      segment.replayer.pause(within);
      segment.appliedIntent = "paused";
    }

    /* A hole queued ahead of this segment is still ahead of it after a seek. */
    this.buffer = this.pendingGap ? "gap-pending" : "ok";
    this.pendingSeekMs = null;
    this.feedGoal = null;
    this.bufferingSinceMs = null;
    this.currentTimeMs = Math.max(segment.baseOffsetMs, targetMs);
    this.resetWatchdog();
  }

  /* ---- Feeding ---- */

  /*
   * The one feeding loop. Runs until the fed range has enough headroom (or
   * reaches a feed goal), one chunk per iteration, and never lets the
   * chunk index advance before addEvent has taken the events (a).
   */
  private async runExtend(generation: number): Promise<void> {
    if (this.isExtending) {
      return;
    }

    this.isExtending = true;

    try {
      for (;;) {
        if (generation !== this.generation || this.isDisposed) {
          return;
        }

        const segment: Segment | null = this.segment;

        if (!segment || this.buffer === "halted" || this.pendingGap) {
          return;
        }

        const goal: FeedGoal | null = this.feedGoal;
        const needsMore: boolean = goal
          ? segment.fedUntilOffsetMs < goal.targetMs
          : this.buffer === "stalled" ||
            this.currentTimeMs + this.feedAheadMs >= segment.fedUntilOffsetMs;

        if (!needsMore) {
          return;
        }

        const decision: NextChunkDecision | null = this.loader.getNextChunk(
          segment.lastFedChunkIndex,
        );

        if (!decision) {
          /* Nothing left in this tab. A goal past the end lands at the end. */
          if (goal) {
            this.landAt(Math.min(goal.targetMs, segment.fedUntilOffsetMs));
            this.publish();
          }
          return;
        }

        if (decision.skippedGap) {
          this.queueGap({ gap: decision.skippedGap, shouldReport: true }, goal);
          return;
        }

        let events: Array<SessionReplayRecordedEvent> | null = null;

        try {
          events = await this.loader.ensureChunk(decision.chunkIndex);
        } catch (err) {
          if (generation === this.generation) {
            this.halt(this.describeLoadFailure(err));
          }
          return;
        }

        if (generation !== this.generation || this.segment !== segment) {
          return;
        }

        if (!events || events.length === 0) {
          /*
           * In the manifest but not decodable. lastFedChunkIndex MUST NOT
           * advance: feeding N+1 into a Replayer that never saw N renders
           * a plausible DOM the user never saw. Re-anchor on the next
           * snapshot through the same path a real hole takes.
           */
          const recovery: number | null = ChunkMath.findNextAnchorAfter(
            this.loader.getFullSnapshotChunkIndexes(),
            decision.chunkIndex - 1,
          );

          if (recovery === null) {
            this.halt({
              message:
                "The next part of this recording could not be loaded, and there is no later snapshot to resume from.",
              retryable: true,
            });
            return;
          }

          const from: number = segment.lastFedChunkIndex;

          this.queueGap(
            {
              gap: {
                fromIndex: from,
                toIndex: recovery,
                missingMs: Math.max(
                  0,
                  this.chunkStartMs(recovery) - this.chunkEndMs(from),
                ),
              },
              /*
               * Re-anchoring on the chunk that just failed is a retry, not
               * a jump over anything, so there is nothing to tell the
               * viewer yet. If the retry fails too, LOAD halts loudly.
               */
              shouldReport: recovery > decision.chunkIndex,
            },
            goal,
          );
          return;
        }

        try {
          for (const event of events) {
            segment.replayer.addEvent(event);
          }
        } catch (err) {
          /*
           * rrweb refused the events. Nothing advanced, so nothing can be
           * fed past a chunk the Replayer never took; RETRY rebuilds.
           */
          this.halt({
            message: `Footage from ${formatOffset(
              this.chunkStartMs(decision.chunkIndex),
            )} could not be applied to the player${
              err instanceof Error && err.message ? `: ${err.message}` : "."
            }`,
            retryable: true,
          });
          return;
        }

        /* (a) Only now. */
        segment.lastFedChunkIndex = decision.chunkIndex;
        segment.fedUntilOffsetMs = this.chunkEndMs(decision.chunkIndex);
        this.refineInactivity(decision.chunkIndex);
        this.updateLoadedChunkIndexes();

        const liveGoal: FeedGoal | null = this.feedGoal;

        if (liveGoal && segment.fedUntilOffsetMs >= liveGoal.targetMs) {
          this.landAt(liveGoal.targetMs);
        } else if (this.buffer === "stalled" && !liveGoal) {
          /*
           * rrweb ended the cast while waiting for these events. Resume
           * from where it stopped now that there is more to play.
           */
          if (this.intent === "playing") {
            segment.replayer.play(segment.replayer.getCurrentTime());
            segment.appliedIntent = "playing";
          }

          this.buffer = "ok";
          this.bufferingSinceMs = null;
          this.resetWatchdog();
        }

        void this.loader
          .prefetchAhead(
            segment.lastFedChunkIndex,
            computePrefetchPagesAhead(this.speed),
          )
          .catch((): void => {
            // Prefetch failures surface when playback reaches the chunk.
          });

        this.publish();
      }
    } finally {
      this.isExtending = false;
    }
  }

  /*
   * A hole (or an undecodable chunk) ahead of the fed range. Held rather
   * than acted on immediately: the viewer should watch out the footage
   * that exists before being told the next stretch is missing. Stalled
   * playback has nothing left to watch, so it jumps now; a feed goal past
   * the hole rebuilds at the goal's own anchor.
   */
  private queueGap(pending: PendingJump, goal: FeedGoal | null): void {
    this.pendingGap = pending;

    if (goal) {
      const targetChunk: number | null = this.loader.getChunkIndexForOffset(
        goal.targetMs,
      );
      const anchor: number | null =
        targetChunk === null ? null : this.loader.getSeekAnchor(targetChunk);

      if (anchor !== null && anchor !== this.segment?.anchorChunkIndex) {
        this.loader.evictOutsideWindow(anchor, EVICTION_RADIUS_CHUNKS);
        this.startLoad(anchor, goal.targetMs);
        return;
      }

      /* The goal sits inside the hole itself: land at the footage's edge. */
      this.feedGoal = null;

      if (this.segment) {
        this.landAt(this.segment.fedUntilOffsetMs);
      }
    }

    if (this.buffer === "stalled") {
      this.performGapJump();
      return;
    }

    if (this.buffer === "ok") {
      this.buffer = "gap-pending";
    }

    this.publish();
  }

  private performGapJump(): void {
    const pending: PendingJump | null = this.pendingGap;

    if (!pending) {
      return;
    }

    this.pendingGap = null;

    if (pending.shouldReport) {
      this.lastGap = pending.gap;
    }

    this.loader.evictOutsideWindow(pending.gap.toIndex, EVICTION_RADIUS_CHUNKS);
    this.startLoad(pending.gap.toIndex, this.chunkStartMs(pending.gap.toIndex));
  }

  /* ---- Events ---- */

  private onPlay(): void {
    this.intent = "playing";

    const segment: Segment | null = this.segment;

    switch (this.buffer) {
      case "ok":
      case "gap-pending": {
        if (segment && segment.appliedIntent !== "playing") {
          segment.replayer.play(segment.replayer.getCurrentTime());
          segment.appliedIntent = "playing";
          this.resetWatchdog();
        }
        break;
      }
      case "stalled": {
        /*
         * rrweb has drained everything it was given. Resume the cast and
         * fetch NOW rather than on the next tick: the first thing the
         * viewer sees after pressing Play must not be a frozen stage.
         */
        if (segment) {
          segment.replayer.play(segment.replayer.getCurrentTime());
          segment.appliedIntent = "playing";
        }

        if (this.bufferingSinceMs === null) {
          this.bufferingSinceMs = this.deps.now();
        }

        void this.runExtend(this.generation);
        break;
      }
      case "ended": {
        /*
         * At the end, Play means "again": rrweb has nothing after the
         * playhead and would Finish immediately, flipping the button and
         * back with the picture never moving.
         */
        if (shouldRewindBeforePlay(this.currentTimeMs, this.durationMs)) {
          this.performSeek(0, REPLAY_FEED_FORWARD_MAX_MS);
        } else {
          this.performSeek(this.currentTimeMs, REPLAY_FEED_FORWARD_MAX_MS);
        }
        return;
      }
      case "building": {
        /* The build reads the intent when it lands. */
        if (this.bufferingSinceMs === null) {
          this.bufferingSinceMs = this.deps.now();
        }
        break;
      }
      case "empty":
      case "halted":
        /* LOAD / RETRY apply the intent when footage exists. */
        break;
      default: {
        const unreachable: never = this.buffer;
        return unreachable;
      }
    }

    this.publish();
  }

  private onPause(): void {
    this.intent = "paused";
    this.bufferingSinceMs = null;

    const segment: Segment | null = this.segment;

    if (segment && segment.appliedIntent === "playing") {
      segment.replayer.pause();
      segment.appliedIntent = "paused";
    }

    this.publish();
  }

  private onSeek(offsetMs: number, token: number): void {
    if (token === this.lastSeekToken) {
      return;
    }

    this.lastSeekToken = token;
    this.performSeek(offsetMs, REPLAY_FEED_FORWARD_MAX_MS);
  }

  /*
   * SEEK resolution:
   *   1. inside the fed range of the same anchor: play/pause(within);
   *   2. same anchor, ahead, reachable through contiguous chunks and
   *      within maxFeedForwardMs: feed forward, then case 1, no teardown;
   *   3. otherwise evict around the new anchor and LOAD.
   * A target before the first snapshot is clamped onto it with a notice,
   * never refused and never restarted from zero.
   */
  private performSeek(requestedMs: number, maxFeedForwardMs: number): void {
    this.notice = null;

    const earliest: number | null = this.loader.getEarliestPlayableOffsetMs();

    if (earliest === null) {
      this.halt({
        message:
          "This session has no full DOM snapshot, so it cannot be played. Every chunk that could anchor playback is missing.",
        retryable: false,
      });
      return;
    }

    const targetMs: number = ChunkMath.clampSeekOffset(
      requestedMs,
      earliest,
      this.durationMs,
    );

    if (requestedMs < earliest) {
      this.notice = {
        kind: "seek-clamped",
        message: `No snapshot before ${formatOffset(
          Math.max(0, requestedMs),
        )}; the earliest playable moment is ${formatOffset(earliest)}.`,
        requestedMs: requestedMs,
        landedAtMs: earliest,
      };
    }

    const targetChunk: number | null =
      this.loader.getChunkIndexForOffset(targetMs);
    const anchor: number | null =
      (targetChunk === null ? null : this.loader.getSeekAnchor(targetChunk)) ??
      this.loader.getFirstPlayableChunkIndex();

    if (anchor === null) {
      return;
    }

    this.pendingSeekMs = targetMs;
    this.currentTimeMs = targetMs;
    this.error = null;

    const segment: Segment | null = this.segment;

    if (
      segment &&
      segment.anchorChunkIndex === anchor &&
      this.buffer !== "halted" &&
      this.buffer !== "empty"
    ) {
      if (
        targetMs >= segment.baseOffsetMs &&
        targetMs <= segment.fedUntilOffsetMs
      ) {
        /* Case 1. Also clears a stall: the target is already fed. */
        this.landAt(targetMs);
        this.publish();
        return;
      }

      if (
        targetMs > segment.fedUntilOffsetMs &&
        targetMs - segment.fedUntilOffsetMs <= maxFeedForwardMs &&
        targetChunk !== null &&
        this.loader.isContiguousRange(
          segment.lastFedChunkIndex + 1,
          targetChunk,
        )
      ) {
        /* Case 2. */
        this.buffer = "building";
        this.feedGoal = { targetMs: targetMs };

        if (this.intent === "playing" && this.bufferingSinceMs === null) {
          this.bufferingSinceMs = this.deps.now();
        }

        this.publish();
        void this.runExtend(this.generation);
        return;
      }
    }

    /* Case 3. */
    this.loader.evictOutsideWindow(anchor, EVICTION_RADIUS_CHUNKS);
    this.startLoad(anchor, targetMs);
  }

  private onSetSpeed(speed: number): void {
    if (!isFinite(speed) || speed <= 0) {
      return;
    }

    this.speed = speed;
    this.feedAheadMs = computeFeedAheadMs(speed);
    this.segment?.replayer.setConfig({ speed: speed });
    this.publish();
  }

  private onTick(nowMs: number): void {
    const segment: Segment | null = this.segment;

    if (
      segment &&
      (this.buffer === "ok" ||
        this.buffer === "gap-pending" ||
        this.buffer === "stalled")
    ) {
      const reported: number =
        segment.baseOffsetMs + segment.replayer.getCurrentTime();

      /* (b) Monotonic between seeks. */
      if (reported > this.currentTimeMs) {
        this.currentTimeMs = reported;
      }

      this.runWatchdog(nowMs, segment);

      if (
        this.pendingGap &&
        this.intent === "playing" &&
        this.currentTimeMs >= segment.fedUntilOffsetMs - GAP_JUMP_LEAD_MS
      ) {
        /*
         * Only jump once the viewer has actually watched out the footage
         * we have. Jumping the moment the gap is discovered would cut the
         * last 30 seconds of real footage off the end of the segment; and
         * jumping while PAUSED would swap the picture under a viewer who
         * stopped to look at the last frame before the hole. Play resumes
         * the cast, rrweb finishes, and RRWEB_FINISH performs the jump.
         */
        this.performGapJump();
        this.rescheduleTick();
        return;
      }

      if (
        !this.pendingGap &&
        !this.isExtending &&
        this.currentTimeMs + this.feedAheadMs >= segment.fedUntilOffsetMs
      ) {
        void this.runExtend(this.generation);
      }

      if (
        this.skipInactive &&
        this.intent === "playing" &&
        this.buffer === "ok" &&
        !this.feedGoal
      ) {
        const band: ReplayIdleBand | null = this.inactivity.findBandAt(
          this.currentTimeMs,
          IDLE_SKIP_MIN_REMAINING_MS,
        );

        if (band) {
          this.onIdleSkip(band);
          this.rescheduleTick();
          return;
        }
      }
    }

    if (nowMs - this.lastPublishAtMs >= REPLAY_SNAPSHOT_PUBLISH_INTERVAL_MS) {
      this.lastPublishAtMs = nowMs;
      this.publish();
    }
  }

  /*
   * (g) Last-resort backstop. Playing, footage fed, and yet the clock has
   * not moved for 1.5s: nudge rrweb and top the buffer up. Every fixture
   * scenario asserts this never fires; it exists for the browser cases
   * nobody has reproduced yet.
   */
  private runWatchdog(nowMs: number, segment: Segment): void {
    if (this.intent !== "playing" || this.buffer !== "ok") {
      this.watchdogLastTimeMs = this.currentTimeMs;
      this.watchdogLastAdvanceAtMs = nowMs;
      return;
    }

    if (this.currentTimeMs !== this.watchdogLastTimeMs) {
      this.watchdogLastTimeMs = this.currentTimeMs;
      this.watchdogLastAdvanceAtMs = nowMs;
      return;
    }

    if (nowMs - this.watchdogLastAdvanceAtMs < REPLAY_WATCHDOG_MS) {
      return;
    }

    this.watchdogFireCount += 1;
    this.watchdogLastAdvanceAtMs = nowMs;
    segment.replayer.play(segment.replayer.getCurrentTime());
    segment.appliedIntent = "playing";
    void this.runExtend(this.generation);
  }

  private resetWatchdog(): void {
    this.watchdogLastTimeMs = this.currentTimeMs;
    this.watchdogLastAdvanceAtMs = this.deps.now();
  }

  private onFinish(): void {
    const segment: Segment | null = this.segment;

    if (!segment) {
      return;
    }

    if (this.pendingGap) {
      /* Nothing left to watch before the hole: jump now. */
      this.performGapJump();
      return;
    }

    if (this.loader.getNextChunk(segment.lastFedChunkIndex) !== null) {
      /*
       * (d) Only a Finish with nothing left to feed is the end of the tab.
       * Anything else is rrweb draining its buffer ahead of the next
       * chunk: a stall, answered with an immediate EXTEND.
       */
      this.buffer = "stalled";

      if (this.intent === "playing" && this.bufferingSinceMs === null) {
        this.bufferingSinceMs = this.deps.now();
      }

      this.publish();
      void this.runExtend(this.generation);
      return;
    }

    this.buffer = "ended";
    this.intent = "paused";
    segment.appliedIntent = "paused";
    this.bufferingSinceMs = null;
    this.currentTimeMs = Math.max(
      this.currentTimeMs,
      Math.min(this.durationMs, segment.fedUntilOffsetMs),
    );
    this.publish();
  }

  private onRetry(): void {
    if (this.buffer !== "halted") {
      return;
    }

    const anchor: number | null =
      this.segment?.anchorChunkIndex ??
      this.holdover?.anchorChunkIndex ??
      this.anchorForOffset(this.currentTimeMs);

    if (anchor === null) {
      return;
    }

    this.startLoad(anchor, this.currentTimeMs);
  }

  private onTabSwitch(tabId: string, loader: ChunkLoader): void {
    if (loader === this.loader) {
      return;
    }

    this.generation += 1;
    this.destroyHoldover();

    if (this.segment) {
      this.destroyReplayer(this.segment.replayer);
      this.segment = null;
    }

    /* The engine owns the loaders it is handed; the old one is finished. */
    this.loader.dispose();
    this.loader = loader;
    this.activeTabId = tabId;
    this.durationMs = loader.getDurationMs();
    this.inactivity = new InactivityMap(loader.getPlayableEntries());
    this.idleBands = this.inactivity.getBands();
    this.pendingGap = null;
    this.feedGoal = null;
    this.isExtending = false;
    this.error = null;
    this.notice = null;
    this.recordedSize = null;
    this.buffer = "empty";
    this.updateLoadedChunkIndexes();

    const earliest: number | null = loader.getEarliestPlayableOffsetMs();

    if (earliest === null) {
      this.halt({
        message: "No footage is stored for this tab.",
        retryable: false,
      });
      return;
    }

    /* The session-clock playhead is preserved when the target tab covers it. */
    const covered: boolean =
      this.currentTimeMs >= earliest && this.currentTimeMs <= this.durationMs;

    this.performSeek(
      covered ? this.currentTimeMs : earliest,
      REPLAY_FEED_FORWARD_MAX_MS,
    );
  }

  private onAppendEntries(
    entries: Array<SessionReplayChunkManifestEntry>,
  ): void {
    const added: number = this.loader.appendEntries(entries);
    this.durationMs = this.loader.getDurationMs();
    this.inactivity.appendEntries(entries);
    this.idleBands = this.inactivity.getBands();

    /*
     * A tab that had ended may have grown: it is a stall again, and the
     * next PLAY resumes rather than rewinding.
     */
    if (
      added > 0 &&
      this.buffer === "ended" &&
      this.segment &&
      this.loader.getNextChunk(this.segment.lastFedChunkIndex) !== null
    ) {
      this.buffer = "stalled";
    }

    this.publish();
  }

  private onIdleSkip(band: ReplayIdleBand): void {
    const targetMs: number = getIdleSkipTargetMs(band);

    if (targetMs <= this.currentTimeMs) {
      return;
    }

    this.lastIdleSkip = band;
    /*
     * Feeding across an idle band is cheap - idle chunks are nearly empty -
     * so the forward-feed cap is raised to cover it rather than tearing
     * the Replayer down for a stretch of nothing.
     */
    this.performSeek(
      targetMs,
      Math.max(
        REPLAY_FEED_FORWARD_MAX_MS,
        band.endMs - band.startMs + this.feedAheadMs,
      ),
    );
  }

  /* ---- Housekeeping ---- */

  private halt(error: ReplayEngineError): void {
    this.buffer = "halted";
    this.error = error;
    this.feedGoal = null;
    this.pendingSeekMs = null;
    this.bufferingSinceMs = null;
    this.publish();
  }

  private describeLoadFailure(err: unknown): ReplayEngineError {
    if (err instanceof ChunkLoadError) {
      const first: number | undefined = err.chunkIndexes[0];
      const fromMs: number =
        first === undefined ? this.currentTimeMs : this.chunkStartMs(first);
      const where: string = `Footage from ${formatOffset(fromMs)}`;

      if (err.isTimeout) {
        return {
          message: `${where} did not arrive: the server did not respond in time on any of ${err.attempts} attempts.`,
          retryable: true,
        };
      }

      return {
        message: `${where} could not be fetched after ${err.attempts} attempts. ${err.message}`,
        retryable: true,
      };
    }

    return {
      message:
        err instanceof Error && err.message
          ? `The recording could not be loaded. ${err.message}`
          : "The recording could not be loaded.",
      retryable: true,
    };
  }

  private anchorForOffset(offsetMs: number): number | null {
    const chunk: number | null = this.loader.getChunkIndexForOffset(offsetMs);

    if (chunk === null) {
      return this.loader.getFirstPlayableChunkIndex();
    }

    return (
      this.loader.getSeekAnchor(chunk) ??
      this.loader.getFirstPlayableChunkIndex()
    );
  }

  private chunkStartMs(chunkIndex: number): number {
    return this.loader.getEntry(chunkIndex)?.chunkStartOffsetMs ?? 0;
  }

  private chunkEndMs(chunkIndex: number): number {
    const entry: SessionReplayChunkManifestEntry | undefined =
      this.loader.getEntry(chunkIndex);

    return entry?.chunkEndOffsetMs ?? this.chunkStartMs(chunkIndex);
  }

  /* Hand a decoded chunk's evidence to the idle map (idempotent). */
  private refineInactivity(chunkIndex: number): void {
    if (this.inactivity.hasEvidence(chunkIndex)) {
      return;
    }

    const intervals: Array<ReplayActivityInterval> | null =
      this.loader.getActivityIntervalsForChunk(chunkIndex);
    const rows: Array<ReplayTimelineEvent> | null =
      this.loader.getTimelineEventsForChunk(chunkIndex);

    if (!intervals || !rows) {
      return;
    }

    this.inactivity.admitChunk(chunkIndex, {
      activityIntervals: intervals,
      visibilityEvents: rows,
    });
    this.idleBands = this.inactivity.getBands();
  }

  /*
   * (12) The seekable band is what rrweb HOLDS - anchor..lastFed - not the
   * decoded LRU, which evicts on budget and on every cross-anchor seek
   * while the fed events stay perfectly playable inside the Replayer.
   */
  private updateLoadedChunkIndexes(): void {
    const segment: Segment | null = this.segment;

    if (!segment) {
      this.loadedChunkIndexes = [];
      return;
    }

    const indexes: Array<number> = [];

    for (
      let index: number = segment.anchorChunkIndex;
      index <= segment.lastFedChunkIndex;
      index++
    ) {
      if (this.loader.hasPlayableEntry(index)) {
        indexes.push(index);
      }
    }

    this.loadedChunkIndexes = indexes;
  }

  private retireSegment(eager: boolean): void {
    const segment: Segment | null = this.segment;

    if (!segment) {
      return;
    }

    this.segment = null;
    this.destroyHoldover();

    if (eager) {
      this.destroyReplayer(segment.replayer);
      return;
    }

    this.holdover = segment;

    try {
      segment.replayer.pause();
      segment.replayer.wrapper.style.pointerEvents = "none";
      segment.replayer.wrapper.style.opacity = "0.6";
    } catch {
      // A wrapper that is already gone has nothing to dim.
    }

    this.holdoverTimer = this.deps.schedule((): void => {
      this.holdoverTimer = null;
      this.destroyHoldover();
    }, HOLDOVER_FALLBACK_MS);
  }

  private destroyHoldover(): void {
    if (this.holdoverTimer !== null) {
      this.deps.cancel(this.holdoverTimer);
      this.holdoverTimer = null;
    }

    const holdover: Segment | null = this.holdover;

    if (!holdover) {
      return;
    }

    this.holdover = null;
    this.destroyReplayer(holdover.replayer);
  }

  private destroyReplayer(replayer: ReplayerLike): void {
    this.replayersDestroyed += 1;

    try {
      replayer.destroy();
    } catch {
      /*
       * destroy() removes its wrapper from the root. If React already
       * unmounted the root, that throws and there is nothing left to clean
       * up - swallowing it is correct, rethrowing would break unmount.
       */
    }

    this.emitReplayerEvent({ type: "destroyed", replayer: replayer });
  }

  private emitReplayerEvent(event: ReplayEngineReplayerEvent): void {
    for (const listener of [...this.replayerListeners]) {
      listener(event);
    }
  }

  /* ---- Ticking ---- */

  private cancelTick(): void {
    const handle: TickHandle | null = this.tickHandle;

    if (!handle) {
      return;
    }

    this.tickHandle = null;

    if (handle.kind === "frame" && this.deps.cancelFrame) {
      this.deps.cancelFrame(handle.handle);
    } else {
      this.deps.cancel(handle.handle);
    }
  }

  /*
   * requestAnimationFrame while playing, 250ms while paused, 10Hz when the
   * document is hidden (rAF does not fire there, and 10Hz keeps the
   * feed-ahead honest for a viewer who tabbed away mid-playback).
   */
  private rescheduleTick(): void {
    this.cancelTick();

    if (this.isDisposed || this.buffer === "empty") {
      return;
    }

    const run: () => void = (): void => {
      this.tickHandle = null;

      if (this.isDisposed) {
        return;
      }

      this.onTick(this.deps.now());
      this.rescheduleTick();
    };

    const hidden: boolean = this.deps.isDocumentHidden?.() ?? false;
    const playing: boolean =
      this.intent === "playing" &&
      (this.buffer === "ok" || this.buffer === "gap-pending");

    if (playing && !hidden && this.deps.frame) {
      this.tickHandle = { kind: "frame", handle: this.deps.frame(run) };
      return;
    }

    const delayMs: number = hidden
      ? REPLAY_HIDDEN_TICK_MS
      : playing
        ? PLAYING_TICK_FALLBACK_MS
        : REPLAY_PAUSED_TICK_MS;

    this.tickHandle = {
      kind: "timer",
      handle: this.deps.schedule(run, delayMs),
    };
  }

  /* ---- Snapshot ---- */

  private buildSnapshot(): ReplayEngineSnapshot {
    const segment: Segment | null = this.segment;

    return {
      phase: derivePhase(this.buffer, this.intent),
      intent: this.intent,
      buffer: this.buffer,
      currentTimeMs: this.currentTimeMs,
      durationMs: this.durationMs,
      speed: this.speed,
      skipInactive: this.skipInactive,
      fedRange: segment
        ? { fromMs: segment.baseOffsetMs, toMs: segment.fedUntilOffsetMs }
        : null,
      loadedChunkIndexes: this.loadedChunkIndexes,
      activeTabId: this.activeTabId,
      recordedSize: this.recordedSize,
      bufferingSinceMs: this.bufferingSinceMs,
      lastGap: this.lastGap,
      lastIdleSkip: this.lastIdleSkip,
      error: this.error,
      pendingSeekMs: this.pendingSeekMs,
      generation: this.generation,
      notice: this.notice,
      idleBands: this.idleBands,
      feedAheadMs: this.feedAheadMs,
      earliestPlayableMs: this.loader.getEarliestPlayableOffsetMs(),
    };
  }

  private publish(): void {
    this.snapshot = this.buildSnapshot();

    for (const listener of [...this.listeners]) {
      listener(this.snapshot);
    }
  }
}

/*
 * The factory. SessionReplayPlayer.tsx builds the deps (loader, the rrweb
 * factory from its dynamic import, performance.now, setTimeout,
 * requestAnimationFrame) and hands the engine to ReplayStage, the
 * controls, the timeline and the rail through useSyncExternalStore.
 */
export function createReplayEngine(
  deps: ReplayEngineDeps,
  options: ReplayEngineOptions,
): ReplayEngine {
  return new ReplayEngineMachine(deps, options);
}

/*
 * Browser-backed deps: what the player passes outside of tests. Kept here
 * so the choice of clock and scheduler is made once.
 */
export function createBrowserReplayEngineDeps(
  loader: ChunkLoader,
  createReplayer: ReplayEngineDeps["createReplayer"],
): ReplayEngineDeps {
  const hasPerformance: boolean =
    typeof performance !== "undefined" && typeof performance.now === "function";

  return {
    loader: loader,
    createReplayer: createReplayer,
    now: (): number => {
      return hasPerformance ? performance.now() : Date.now();
    },
    schedule: (callback: () => void, delayMs: number): ReplayScheduleHandle => {
      return setTimeout(callback, delayMs);
    },
    cancel: (handle: ReplayScheduleHandle): void => {
      clearTimeout(handle as ReturnType<typeof setTimeout>);
    },
    frame:
      typeof requestAnimationFrame === "function"
        ? (callback: () => void): ReplayScheduleHandle => {
            return requestAnimationFrame(callback);
          }
        : undefined,
    cancelFrame:
      typeof cancelAnimationFrame === "function"
        ? (handle: ReplayScheduleHandle): void => {
            cancelAnimationFrame(handle as number);
          }
        : undefined,
    isDocumentHidden: (): boolean => {
      return typeof document !== "undefined" && document.hidden === true;
    },
  };
}

export default ReplayEngineMachine;
