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
 * Scope, precisely: this meta tag is inserted on construction (into the blank
 * document, which rrweb then discards) and again on every
 * "fullsnapshot-rebuilded" event. rrweb emits that event AFTER rebuild() has
 * built the whole DOM and after insertStyleRules, so any subresource the
 * snapshot itself references - img src, link href, srcset, font URLs - has
 * already been requested by the time these directives exist. What the tag
 * genuinely covers is everything the document does AFTER a rebuild: the
 * incremental mutations rrweb applies as playback advances.
 *
 * The real control is sandbox="allow-same-origin" with no allow-scripts,
 * which rrweb sets and which UNSAFE_replayCanvas: false keeps in place. The
 * outstanding hole - rebuild-time outbound requests to attacker-chosen hosts
 * from the Dashboard origin - is closed by stripping remote resource URLs
 * server-side, not here. See stillOpen in the review notes.
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
  const pendingGapRef: React.MutableRefObject<PendingJump | null> =
    useRef<PendingJump | null>(null);
  const isBuildingRef: React.MutableRefObject<boolean> = useRef<boolean>(false);
  const isExtendingRef: React.MutableRefObject<boolean> =
    useRef<boolean>(false);
  /*
   * Desired transport state, mirrored into refs.
   *
   * buildSegment is async and the effects that apply play/pause/speed bail
   * out while it runs, so the state captured when the build STARTED is
   * routinely stale by the time it finishes. Reading the refs at the end of
   * a build is what stops a viewer who pressed Play during the first fetch
   * from getting a "playing" button over a frozen stage.
   */
  const isPlayingRef: React.MutableRefObject<boolean> = useRef<boolean>(
    props.isPlaying,
  );
  const speedRef: React.MutableRefObject<number> = useRef<number>(props.speed);
  const skipInactiveRef: React.MutableRefObject<boolean> = useRef<boolean>(
    props.skipInactive,
  );
  /*
   * Set when rrweb emitted Finish while there was still footage to feed.
   * rrweb ends the cast whenever it drains its buffer, which with chunk
   * streaming happens any time a /chunks fetch loses the race with the
   * feed-ahead window. That is a stall, not the end of the recording.
   */
  const stalledRef: React.MutableRefObject<boolean> = useRef<boolean>(false);
  /*
   * Set once feeding has failed in a way no further attempt can fix. The
   * tick fires every 200ms and the fed range never advances after such a
   * failure, so without this the viewer would be handed the same error four
   * hundred times a minute.
   */
  const isFeedHaltedRef: React.MutableRefObject<boolean> =
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

  /*
   * Session offsets come from the manifest, never from event timestamps.
   *
   * An rrweb timestamp is a raw Date.now() from the end user's machine, and
   * the manifest's chunkStartOffsetMs is what the recorder computed against
   * its own session start. Subtracting the SERVER-CLAMPED start from a client
   * timestamp mixes the two clocks, so on any skewed device the playhead
   * would sit clockSkewMs away from the bands, markers and gaps the scrubber
   * draws from that same manifest.
   */
  const getChunkStartOffsetMs: (chunkIndex: number) => number = useCallback(
    (chunkIndex: number): number => {
      return loader.getEntry(chunkIndex)?.chunkStartOffsetMs ?? 0;
    },
    [loader],
  );

  const getChunkEndOffsetMs: (
    chunkIndex: number,
    fallbackMs: number,
  ) => number = useCallback(
    (chunkIndex: number, fallbackMs: number): number => {
      return loader.getEntry(chunkIndex)?.chunkEndOffsetMs ?? fallbackMs;
    },
    [loader],
  );

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
      isFeedHaltedRef.current = false;

      try {
        destroySegment();

        const anchorEvents: Array<SessionReplayRecordedEvent> | null =
          await loader.ensureChunk(anchorChunkIndex);

        if (generation !== generationRef.current) {
          return;
        }

        if (!anchorEvents || anchorEvents.length === 0) {
          onError(
            "This part of the recording could not be loaded. The chunk is present in the index but carried no events.",
          );
          return;
        }

        const events: Array<SessionReplayRecordedEvent> = [...anchorEvents];
        let lastFedChunkIndex: number = anchorChunkIndex;

        /*
         * rrweb 2.1.1 throws "Replayer need at least 2 events." out of its
         * constructor when liveMode is false and fewer than two events are
         * handed in. A one-event anchor is not exotic: it is exactly what
         * splitting an oversized FullSnapshot produces for the final part,
         * and that final part is the one carrying hasFullSnapshot. Pull
         * contiguous chunks forward until there are two, rather than letting
         * a library string reach the viewer.
         */
        while (events.length < 2) {
          const nextDecision: {
            chunkIndex: number;
            skippedGap: SessionReplayGap | null;
          } | null = loader.getNextChunk(lastFedChunkIndex);

          if (!nextDecision || nextDecision.skippedGap) {
            // Nothing contiguous left to borrow from.
            break;
          }

          const more: Array<SessionReplayRecordedEvent> | null =
            await loader.ensureChunk(nextDecision.chunkIndex);

          if (generation !== generationRef.current) {
            return;
          }

          if (!more || more.length === 0) {
            break;
          }

          events.push(...more);
          lastFedChunkIndex = nextDecision.chunkIndex;
        }

        if (events.length < 2) {
          onError(
            "This recording is too short to play. The only footage that survived is a single frame, which the player cannot render.",
          );
          return;
        }

        const baseOffsetMs: number = getChunkStartOffsetMs(anchorChunkIndex);

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
          speed: speedRef.current,
          skipInactive: skipInactiveRef.current,
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
          const live: Segment | null = segmentRef.current;

          /*
           * Only a Finish with nothing left to feed is the end of the tab.
           * Anything else is rrweb draining its buffer ahead of the next
           * chunk; sending END there would stop playback permanently,
           * because later addEvent calls append to a paused machine.
           */
          if (live && loader.getNextChunk(live.lastFedChunkIndex) !== null) {
            stalledRef.current = true;
            return;
          }

          stalledRef.current = false;
          onPlayingChange(false);
        });

        injectDocumentCsp(replayer);

        segmentRef.current = {
          anchorChunkIndex: anchorChunkIndex,
          baseOffsetMs: baseOffsetMs,
          lastFedChunkIndex: lastFedChunkIndex,
          fedUntilOffsetMs: getChunkEndOffsetMs(
            lastFedChunkIndex,
            baseOffsetMs,
          ),
          replayer: replayer,
        };

        stalledRef.current = false;
        onLoadedChunkIndexesChange(loader.getDecodedChunkIndexes());

        const withinSegment: number = Math.max(0, seekOffsetMs - baseOffsetMs);

        /*
         * The refs, not the values captured when this build started - the
         * viewer may have pressed Play or changed speed during the fetch.
         */
        replayer.setConfig({
          speed: speedRef.current,
          skipInactive: skipInactiveRef.current,
        });

        if (isPlayingRef.current) {
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
    /*
     * Transport state is read from refs above, so it is deliberately absent
     * here: including it would rebuild the Replayer - blanking the stage and
     * losing the playhead - every time the viewer changed speed.
     */
    [
      loader,
      replayerFactory,
      getChunkStartOffsetMs,
      getChunkEndOffsetMs,
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

      if (
        !segment ||
        isExtendingRef.current ||
        pendingGapRef.current ||
        isFeedHaltedRef.current
      ) {
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
        pendingGapRef.current = {
          gap: decision.skippedGap,
          shouldReport: true,
        };
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

        if (!events || events.length === 0) {
          /*
           * The chunk is in the manifest but did not come back decodable: a
           * TTL drop between manifest and read, a truncated response, the
           * server's byte clamp, or a corrupt frame decodeFrames skipped.
           *
           * lastFedChunkIndex MUST NOT advance here. Advancing would feed
           * chunk N+1 into a Replayer that never received N, and rrweb would
           * resolve those mutations against stale node ids and render a
           * plausible DOM the end user never saw. Re-anchor on the next full
           * snapshot instead, through the same path a real hole takes.
           */
          const recoveryAnchor: number | undefined = loader
            .getFullSnapshotChunkIndexes()
            .find((index: number): boolean => {
              return index >= decision.chunkIndex;
            });

          if (recoveryAnchor === undefined) {
            isFeedHaltedRef.current = true;
            onError(
              "The next part of this recording could not be loaded, and there is no later snapshot to resume from.",
            );
            return;
          }

          const from: number = live.lastFedChunkIndex;
          const missingMs: number = Math.max(
            0,
            getChunkStartOffsetMs(recoveryAnchor) -
              getChunkEndOffsetMs(from, getChunkStartOffsetMs(from)),
          );

          pendingGapRef.current = {
            gap: {
              fromIndex: from,
              toIndex: recoveryAnchor,
              missingMs: missingMs,
            },
            /*
             * Re-anchoring on the chunk that just failed is a retry of that
             * chunk, not a jump over anything, so there is nothing to tell
             * the viewer yet. If the retry fails too, buildSegment errors
             * loudly.
             */
            shouldReport: recoveryAnchor > decision.chunkIndex,
          };

          return;
        }

        for (const event of events) {
          live.replayer.addEvent(event);
        }

        live.lastFedChunkIndex = decision.chunkIndex;
        live.fedUntilOffsetMs = getChunkEndOffsetMs(
          decision.chunkIndex,
          live.fedUntilOffsetMs,
        );
        onLoadedChunkIndexesChange(loader.getDecodedChunkIndexes());

        /*
         * rrweb ended the cast while waiting for these events. Resume from
         * where it stopped now that there is more to play.
         */
        if (stalledRef.current && isPlayingRef.current) {
          stalledRef.current = false;
          live.replayer.play(live.replayer.getCurrentTime());
        }

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
    }, [
      loader,
      getChunkStartOffsetMs,
      getChunkEndOffsetMs,
      onLoadedChunkIndexesChange,
      onError,
    ]);

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

  /*
   * Live playback controls are applied to the existing Replayer, not rebuilt.
   * The refs are written FIRST and unconditionally, so a control changed
   * while a segment is still being built is still honoured when it lands.
   */
  useEffect(() => {
    speedRef.current = speed;
    skipInactiveRef.current = skipInactive;

    const segment: Segment | null = segmentRef.current;

    if (!segment) {
      return;
    }

    segment.replayer.setConfig({ speed: speed, skipInactive: skipInactive });
  }, [speed, skipInactive]);

  useEffect(() => {
    isPlayingRef.current = isPlaying;

    const segment: Segment | null = segmentRef.current;

    if (!segment || isBuildingRef.current) {
      return;
    }

    if (isPlaying) {
      stalledRef.current = false;
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

      const pending: PendingJump | null = pendingGapRef.current;

      /*
       * Only jump once the viewer has actually watched out the footage we
       * have. Jumping the moment the gap is discovered would cut the last
       * 30 seconds of real footage off the end of the segment.
       */
      if (pending && offsetMs >= segment.fedUntilOffsetMs - 100) {
        pendingGapRef.current = null;

        if (pending.shouldReport) {
          onGapCrossed(pending.gap);
        }

        loader.evictOutsideWindow(pending.gap.toIndex, EVICTION_RADIUS_CHUNKS);
        void buildSegment(
          pending.gap.toIndex,
          loader.getEntry(pending.gap.toIndex)?.chunkStartOffsetMs ?? offsetMs,
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
