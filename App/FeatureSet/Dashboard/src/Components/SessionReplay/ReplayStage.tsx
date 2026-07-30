import React, {
  FunctionComponent,
  ReactElement,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { SessionReplayGap } from "Common/Types/Rum/SessionReplay";
import ChunkLoader, { SessionReplayRecordedEvent } from "./ChunkLoader";

/*
 * The playback surface: the sandboxed iframe, the rrweb Replayer lifecycle,
 * and the chunk-feeding state machine that refuses to cross a gap.
 *
 * This file never imports rrweb. The Replayer constructor is handed in as
 * `replayerFactory` by SessionReplayPlayer.tsx, which is the single file
 * allowed to reference the package and does so only behind a dynamic
 * import(). Common/UI/esbuild-config.js hardcodes minify:false, so one
 * accidental top-level import here would put ~450KB of Replayer into the
 * shared chunk for every user who never opens a replay.
 */

/*
 * Structural subset of rrweb's Replayer that this component uses. Declared
 * rather than imported for the reason above; the factory casts on the way in.
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

export interface ReplaySeekRequest {
  offsetMs: number;
  /*
   * Monotonic token. Seeking twice to the same offset (clicking the same
   * error marker again after drifting away) must still re-seek, and an
   * offset alone cannot express that.
   */
  token: number;
}

export interface ReplayStageProps {
  loader: ChunkLoader;
  replayerFactory: ReplayerFactory;
  /* Server-clamped session start, so event timestamps map to session offsets. */
  sessionStartUnixMs: number;
  isPlaying: boolean;
  speed: number;
  skipInactive: boolean;
  seekRequest: ReplaySeekRequest | null;
  onTimeUpdate: (offsetMs: number) => void;
  onPlayingChange: (isPlaying: boolean) => void;
  /* Fired when playback had to jump a hole. Never silent. */
  onGapCrossed: (gap: SessionReplayGap) => void;
  onLoadedChunkIndexesChange: (chunkIndexes: Array<number>) => void;
  onError: (message: string) => void;
}

/*
 * The Content-Security-Policy injected INSIDE the replay document.
 *
 * Belt and braces on top of sandbox="allow-same-origin": the recording is
 * arbitrary HTML authored by a customer's end users, and the parent document
 * is the OneUptime Dashboard with the operator's session cookie. Note there
 * is no 'unsafe-inline' for script and no host source anywhere - the replayed
 * page must not be able to fetch, phone home, or run.
 */
const REPLAY_DOCUMENT_CSP: string =
  "script-src 'none'; default-src 'none'; img-src data: blob:; " +
  "style-src 'unsafe-inline'; font-src data:; media-src 'none'; connect-src 'none'";

/*
 * The subset of rrweb/dist/style.css the player actually needs, inlined.
 *
 * Importing the package stylesheet would pull a CSS file into the lazily
 * loaded chunk, and the shared esbuild config has no CSS handling wired for
 * dynamically imported chunks. These four rules are the ones without which
 * the cursor and the stage are mispositioned; the mouse-tail canvas is
 * disabled outright (mouseTail: false) so its rules are not needed.
 */
const REPLAY_STAGE_CSS: string = `
.oneuptime-replay-stage .replayer-wrapper { position: relative; transform-origin: top left; }
.oneuptime-replay-stage .replayer-wrapper iframe { border: none; background: #ffffff; }
.oneuptime-replay-stage .replayer-mouse { position: absolute; width: 20px; height: 20px; border-radius: 100%; background: rgba(73,80,246,0.45); box-shadow: 0 0 0 2px rgba(73,80,246,0.8); transition: left 0.05s linear, top 0.05s linear; pointer-events: none; }
.oneuptime-replay-stage .replayer-mouse.active { background: rgba(73,80,246,0.85); }
`;

/* Playback clock resolution. Fine enough for a scrubber, cheap enough to run. */
const TICK_INTERVAL_MS: number = 200;

/*
 * How far ahead of the playhead the fed range is kept. One flush interval is
 * 15s, so 30s is two chunks of headroom - enough to absorb a slow /chunks
 * response without stalling, small enough that seeking away does not waste a
 * large fetch.
 */
const FEED_AHEAD_MS: number = 30 * 1000;

/* Chunks either side of the playhead kept decoded after a seek. */
const EVICTION_RADIUS_CHUNKS: number = 8;

interface Segment {
  anchorChunkIndex: number;
  /* Session offset of the first event fed into this Replayer instance. */
  baseOffsetMs: number;
  lastFedChunkIndex: number;
  /* End of the fed range, in session offset. */
  fedUntilOffsetMs: number;
  replayer: ReplayerLike;
}

const ReplayStage: FunctionComponent<ReplayStageProps> = (
  props: ReplayStageProps,
): ReactElement => {
  const containerRef: React.RefObject<HTMLDivElement> =
    useRef<HTMLDivElement>(null);
  const segmentRef: React.MutableRefObject<Segment | null> =
    useRef<Segment | null>(null);
  /*
   * A gap discovered while extending the fed range. Held rather than acted on
   * immediately: the viewer should watch out the footage that exists before
   * being told the next stretch is missing.
   */
  const pendingGapRef: React.MutableRefObject<SessionReplayGap | null> =
    useRef<SessionReplayGap | null>(null);
  const isBuildingRef: React.MutableRefObject<boolean> = useRef<boolean>(false);
  const isExtendingRef: React.MutableRefObject<boolean> =
    useRef<boolean>(false);
  /*
   * Bumped by every rebuild and by unmount. An await that resumes against a
   * stale generation must not touch the DOM or the current segment.
   */
  const generationRef: React.MutableRefObject<number> = useRef<number>(0);
  const lastSeekTokenRef: React.MutableRefObject<number> = useRef<number>(-1);
  const [recordedSize, setRecordedSize] = useState<{
    width: number;
    height: number;
  } | null>(null);

  const {
    loader,
    replayerFactory,
    sessionStartUnixMs,
    isPlaying,
    speed,
    skipInactive,
    seekRequest,
    onTimeUpdate,
    onPlayingChange,
    onGapCrossed,
    onLoadedChunkIndexesChange,
    onError,
  } = props;

  const destroySegment: () => void = useCallback((): void => {
    const segment: Segment | null = segmentRef.current;

    if (!segment) {
      return;
    }

    segmentRef.current = null;

    try {
      segment.replayer.destroy();
    } catch {
      /*
       * destroy() removes its wrapper from the root. If React already
       * unmounted the root, that throws and there is nothing left to clean
       * up - swallowing it is correct, rethrowing would break unmount.
       */
    }
  }, []);

  /* Re-applied after every full-snapshot rebuild, which replaces <head>. */
  const injectDocumentCsp: (replayer: ReplayerLike) => void = useCallback(
    (replayer: ReplayerLike): void => {
      const doc: Document | null = replayer.iframe.contentDocument;

      if (!doc) {
        return;
      }

      const head: HTMLHeadElement | null = doc.head;

      if (!head) {
        return;
      }

      if (head.querySelector("meta[data-oneuptime-replay-csp]")) {
        return;
      }

      const meta: HTMLMetaElement = doc.createElement("meta");
      meta.setAttribute("http-equiv", "Content-Security-Policy");
      meta.setAttribute("content", REPLAY_DOCUMENT_CSP);
      meta.setAttribute("data-oneuptime-replay-csp", "true");
      head.insertBefore(meta, head.firstChild);
    },
    [],
  );

  /*
   * Build (or rebuild) the Replayer anchored at a full-snapshot chunk.
   *
   * Every seek that leaves the current segment goes through here rather than
   * through replayer.play(offset): rrweb resolves mutations against node ids
   * from a prior snapshot, so a Replayer can only render forward from the
   * snapshot it was constructed on.
   */
  const buildSegment: (
    anchorChunkIndex: number,
    seekOffsetMs: number,
  ) => Promise<void> = useCallback(
    async (anchorChunkIndex: number, seekOffsetMs: number): Promise<void> => {
      const container: HTMLDivElement | null = containerRef.current;

      if (!container) {
        return;
      }

      generationRef.current += 1;
      const generation: number = generationRef.current;
      isBuildingRef.current = true;
      pendingGapRef.current = null;

      try {
        destroySegment();

        const events: Array<SessionReplayRecordedEvent> | null =
          await loader.ensureChunk(anchorChunkIndex);

        if (generation !== generationRef.current) {
          return;
        }

        const first: SessionReplayRecordedEvent | undefined = events?.[0];

        if (!events || events.length === 0 || !first) {
          onError(
            "This part of the recording could not be loaded. The chunk is present in the index but carried no events.",
          );
          return;
        }

        const baseOffsetMs: number = first.timestamp - sessionStartUnixMs;

        const replayer: ReplayerLike = replayerFactory(events, {
          root: container,
          liveMode: false,
          mouseTail: false,
          /*
           * Canvas replay is never enabled here. rrweb implements it by
           * dropping the strict sandbox for "allow-same-origin allow-scripts",
           * which is script execution inside a document built from
           * attacker-influenceable HTML on the Dashboard's own origin.
           */
          UNSAFE_replayCanvas: false,
          blockClass: "oneuptime-block",
          useVirtualDom: true,
          speed: speed,
          skipInactive: skipInactive,
          showWarning: false,
          showDebug: false,
        });

        replayer.on("fullsnapshot-rebuilded", (): void => {
          injectDocumentCsp(replayer);
        });

        replayer.on("resize", (payload: unknown): void => {
          const size: { width?: unknown; height?: unknown } =
            (payload as { width?: unknown; height?: unknown }) || {};
          const width: number = Number(size.width);
          const height: number = Number(size.height);

          if (isFinite(width) && isFinite(height) && width > 0 && height > 0) {
            setRecordedSize({ width: width, height: height });
          }
        });

        replayer.on("finish", (): void => {
          onPlayingChange(false);
        });

        injectDocumentCsp(replayer);

        const lastEvent: SessionReplayRecordedEvent | undefined =
          events[events.length - 1];

        segmentRef.current = {
          anchorChunkIndex: anchorChunkIndex,
          baseOffsetMs: baseOffsetMs,
          lastFedChunkIndex: anchorChunkIndex,
          fedUntilOffsetMs: lastEvent
            ? lastEvent.timestamp - sessionStartUnixMs
            : baseOffsetMs,
          replayer: replayer,
        };

        onLoadedChunkIndexesChange(loader.getDecodedChunkIndexes());

        const withinSegment: number = Math.max(0, seekOffsetMs - baseOffsetMs);

        if (isPlaying) {
          replayer.play(withinSegment);
        } else {
          replayer.pause(withinSegment);
        }
      } catch (err) {
        if (generation === generationRef.current) {
          onError(
            err instanceof Error
              ? err.message
              : "The recording could not be loaded.",
          );
        }
      } finally {
        if (generation === generationRef.current) {
          isBuildingRef.current = false;
        }
      }
    },
    [
      loader,
      replayerFactory,
      sessionStartUnixMs,
      speed,
      skipInactive,
      isPlaying,
      destroySegment,
      injectDocumentCsp,
      onError,
      onPlayingChange,
      onLoadedChunkIndexesChange,
    ],
  );

  /*
   * Push the next contiguous chunk into the live Replayer, or record the gap
   * that stops us. Never feeds across a hole - that is the whole contract of
   * this component.
   */
  const extendFedRange: () => Promise<void> =
    useCallback(async (): Promise<void> => {
      const segment: Segment | null = segmentRef.current;

      if (!segment || isExtendingRef.current || pendingGapRef.current) {
        return;
      }

      const decision: {
        chunkIndex: number;
        skippedGap: SessionReplayGap | null;
      } | null = loader.getNextChunk(segment.lastFedChunkIndex);

      if (!decision) {
        // End of the recording for this tab.
        return;
      }

      if (decision.skippedGap) {
        pendingGapRef.current = decision.skippedGap;
        return;
      }

      isExtendingRef.current = true;
      const generation: number = generationRef.current;

      try {
        const events: Array<SessionReplayRecordedEvent> | null =
          await loader.ensureChunk(decision.chunkIndex);

        if (generation !== generationRef.current) {
          return;
        }

        const live: Segment | null = segmentRef.current;

        if (!live || live !== segment) {
          return;
        }

        if (events) {
          for (const event of events) {
            live.replayer.addEvent(event);
          }

          const lastEvent: SessionReplayRecordedEvent | undefined =
            events[events.length - 1];

          if (lastEvent) {
            live.fedUntilOffsetMs = lastEvent.timestamp - sessionStartUnixMs;
          }
        }

        live.lastFedChunkIndex = decision.chunkIndex;
        onLoadedChunkIndexesChange(loader.getDecodedChunkIndexes());

        void loader.prefetchAfter(decision.chunkIndex);
      } catch (err) {
        if (generation === generationRef.current) {
          onError(
            err instanceof Error
              ? err.message
              : "The next part of this recording could not be loaded.",
          );
        }
      } finally {
        isExtendingRef.current = false;
      }
    }, [loader, sessionStartUnixMs, onLoadedChunkIndexesChange, onError]);

  /* Initial mount: anchor on the first playable chunk. */
  useEffect(() => {
    const first: number | null = loader.getFirstPlayableChunkIndex();

    if (first === null) {
      onError(
        "This session has no full DOM snapshot, so it cannot be played. Every chunk that could anchor playback is missing.",
      );
      return;
    }

    void buildSegment(first, 0);

    return () => {
      generationRef.current += 1;
      destroySegment();
    };
    /*
     * Deliberately keyed on the loader alone, not on buildSegment. That
     * callback closes over speed, skipInactive and isPlaying, so a full
     * dependency list would tear down and rebuild the Replayer - blanking
     * the stage and losing the playhead - every time the viewer changed
     * speed.
     */
  }, [loader]);

  /* Live playback controls are applied to the existing Replayer, not rebuilt. */
  useEffect(() => {
    const segment: Segment | null = segmentRef.current;

    if (!segment) {
      return;
    }

    segment.replayer.setConfig({ speed: speed, skipInactive: skipInactive });
  }, [speed, skipInactive]);

  useEffect(() => {
    const segment: Segment | null = segmentRef.current;

    if (!segment || isBuildingRef.current) {
      return;
    }

    if (isPlaying) {
      segment.replayer.play(segment.replayer.getCurrentTime());
    } else {
      segment.replayer.pause();
    }
  }, [isPlaying]);

  /* Seeks. */
  useEffect(() => {
    if (!seekRequest || seekRequest.token === lastSeekTokenRef.current) {
      return;
    }

    lastSeekTokenRef.current = seekRequest.token;

    const targetChunkIndex: number | null = loader.getChunkIndexForOffset(
      seekRequest.offsetMs,
    );

    if (targetChunkIndex === null) {
      return;
    }

    const anchor: number | null = loader.getSeekAnchor(targetChunkIndex);

    if (anchor === null) {
      /*
       * No snapshot at or before the target. Refusing is correct: restarting
       * from zero would silently show a different part of the session than
       * the one the viewer asked for.
       */
      onError(
        "There is no full snapshot before that point, so it cannot be played. Try a later position.",
      );
      return;
    }

    const segment: Segment | null = segmentRef.current;

    /*
     * Stay inside the current segment when the target is already rendered
     * into it - one checkout interval of footage is typically 60s, and
     * rebuilding for a 5-second nudge would blank the stage for no reason.
     */
    if (
      segment &&
      segment.anchorChunkIndex === anchor &&
      seekRequest.offsetMs >= segment.baseOffsetMs &&
      seekRequest.offsetMs <= segment.fedUntilOffsetMs
    ) {
      const within: number = seekRequest.offsetMs - segment.baseOffsetMs;

      if (isPlaying) {
        segment.replayer.play(within);
      } else {
        segment.replayer.pause(within);
      }

      return;
    }

    loader.evictOutsideWindow(anchor, EVICTION_RADIUS_CHUNKS);
    void buildSegment(anchor, seekRequest.offsetMs);
  }, [seekRequest, loader, isPlaying, buildSegment, onError]);

  /* Clock, feed-ahead, and the gap jump. */
  useEffect(() => {
    const timer: ReturnType<typeof setInterval> = setInterval((): void => {
      const segment: Segment | null = segmentRef.current;

      if (!segment) {
        return;
      }

      const offsetMs: number =
        segment.baseOffsetMs + segment.replayer.getCurrentTime();

      onTimeUpdate(offsetMs);

      if (offsetMs + FEED_AHEAD_MS >= segment.fedUntilOffsetMs) {
        void extendFedRange();
      }

      const gap: SessionReplayGap | null = pendingGapRef.current;

      /*
       * Only jump once the viewer has actually watched out the footage we
       * have. Jumping the moment the gap is discovered would cut the last
       * 30 seconds of real footage off the end of the segment.
       */
      if (gap && offsetMs >= segment.fedUntilOffsetMs - 100) {
        pendingGapRef.current = null;
        onGapCrossed(gap);
        loader.evictOutsideWindow(gap.toIndex, EVICTION_RADIUS_CHUNKS);
        void buildSegment(
          gap.toIndex,
          loader.getEntry(gap.toIndex)?.chunkStartOffsetMs ?? offsetMs,
        );
      }
    }, TICK_INTERVAL_MS);

    return () => {
      clearInterval(timer);
    };
  }, [onTimeUpdate, extendFedRange, onGapCrossed, buildSegment, loader]);

  /*
   * Scale the recorded viewport down to fit the stage. rrweb renders at the
   * end user's real pixel dimensions, which are routinely wider than the
   * Dashboard's content column.
   */
  useEffect(() => {
    const container: HTMLDivElement | null = containerRef.current;
    const segment: Segment | null = segmentRef.current;

    if (!container || !segment || !recordedSize) {
      return;
    }

    const available: number = container.clientWidth;

    if (available <= 0) {
      return;
    }

    const scale: number = Math.min(1, available / recordedSize.width);
    segment.replayer.wrapper.style.transform = `scale(${scale})`;
    container.style.height = `${Math.round(recordedSize.height * scale)}px`;
  }, [recordedSize]);

  return (
    <div className="oneuptime-replay-stage w-full overflow-hidden rounded-lg border border-gray-200 bg-gray-50">
      <style>{REPLAY_STAGE_CSS}</style>
      <div ref={containerRef} className="w-full" />
    </div>
  );
};

export default ReplayStage;
