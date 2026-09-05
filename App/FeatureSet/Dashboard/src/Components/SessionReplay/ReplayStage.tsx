import React, {
  CSSProperties,
  FunctionComponent,
  ReactElement,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import {
  ReplayEngine,
  ReplayEngineListener,
  ReplayEngineReplayerEvent,
  ReplayEngineSnapshot,
  ReplayRecordedSize,
  ReplayerLike,
} from "./Engine/ReplayEngineTypes";

/*
 * The playback surface, as a thin React binding over the engine.
 *
 * Everything about WHAT plays (chunk feeding, seeks, stalls, gaps, idle
 * skips) lives in Engine/ReplayEngine.ts and is tested there without a
 * DOM. This component owns only what needs one: mounting the engine's
 * host element, measuring the box and scaling the picture to fit it,
 * reserving the recorded aspect before the first frame, the phone frame
 * for mobile recordings, the CSP meta injected into every rebuilt replay
 * document, the touch ring, and the cursor/trail styles.
 *
 * This file never imports rrweb. The Replayer is constructed by the
 * engine through a factory that SessionReplayPlayer.tsx - the single file
 * allowed to reference the package, behind a dynamic import() - hands in.
 */

export type ReplayStageFit = "contain" | "actual";

export interface ReplayStageProps {
  engine: ReplayEngine;
  /*
   * The recorded viewport from the manifest header. Reserves the stage's
   * aspect ratio before rrweb reports its first Meta, so the layout below
   * the stage does not jump when the first frame lands.
   */
  viewportWidth?: number | null | undefined;
  viewportHeight?: number | null | undefined;
  /* Native fullscreen: the height bound becomes 100vh instead of 70vh. */
  isTheater?: boolean | undefined;
  /* "contain" (Fit) scales to fit both axes; "actual" is 1:1 in a scroll box. */
  fit?: ReplayStageFit | undefined;
  /* Draw the phone frame. Defaults to "recorded width below 600px". */
  isMobile?: boolean | undefined;
  /* The scale in force, for the "1440x900 -> 62%" chip. */
  onScaleChange?: ((scale: number) => void) | undefined;
  className?: string | undefined;
}

/* Contain-fit bounds, from the design: 70vh normally, 100vh in theater. */
export const REPLAY_STAGE_MAX_HEIGHT_VH: number = 70;
export const REPLAY_STAGE_THEATER_MAX_HEIGHT_VH: number = 100;
export const REPLAY_STAGE_MIN_HEIGHT_REM: number = 24;

/* Recordings narrower than this get the phone-shaped frame. */
export const REPLAY_STAGE_MOBILE_MAX_WIDTH_PX: number = 600;

/* rrweb draws a 28px ring where a TouchStart landed. */
export const REPLAY_STAGE_TOUCH_RING_PX: number = 28;
const TOUCH_RING_LIFETIME_MS: number = 700;

/* Fallback aspect before any size is known. */
const DEFAULT_ASPECT: ReplayRecordedSize = { width: 16, height: 9 };

/*
 * The Content-Security-Policy injected INSIDE the replay document.
 *
 * Scope, precisely: this meta tag is inserted on construction (into the
 * blank document, which rrweb then discards) and again on every
 * "fullsnapshot-rebuilded" event. rrweb emits that event AFTER rebuild()
 * has built the whole DOM and after insertStyleRules, so any subresource
 * the snapshot itself references - img src, link href, srcset, font URLs
 * - has already been requested by the time these directives exist. What
 * the tag genuinely covers is everything the document does AFTER a
 * rebuild: the incremental mutations rrweb applies as playback advances.
 *
 * The real control is sandbox="allow-same-origin" with no allow-scripts,
 * which rrweb sets and which UNSAFE_replayCanvas: false keeps in place.
 *
 * What is NOT closed here, stated plainly so nobody reads this comment as
 * a guarantee: rebuild-time outbound requests to hosts the recorded page
 * referenced still leave the viewer's browser from the Dashboard origin.
 * The referrer meta below stops the replay URL (with the session id)
 * riding along on them; removing them entirely needs the recorded
 * resource URLs neutralised at ingest, which is tracked as a follow-up
 * and is not something this component can do after the fact.
 */
export const REPLAY_DOCUMENT_CSP: string =
  "script-src 'none'; default-src 'none'; img-src data: blob:; " +
  "style-src 'unsafe-inline'; font-src data:; media-src 'none'; connect-src 'none'";

/*
 * The subset of rrweb/dist/style.css the player actually needs, inlined.
 *
 * Importing the package stylesheet would pull a CSS file into the lazily
 * loaded chunk, and the shared esbuild config has no CSS handling wired for
 * dynamically imported chunks. These are the rules without which the
 * cursor, its trail and the stage are mispositioned.
 *
 * The pointer rules are not decoration. rrweb records mouse movement, but
 * a replay draws no system cursor of its own, so without a visible pointer
 * a recording of somebody hunting around a page reads as a still image
 * with occasional mutations. The cursor is drawn large, ringed and
 * animated between samples (mousemove is sampled every 100ms, so the
 * transition is what turns eight positions a second into a movement), and
 * the tail canvas draws the path it took to get there.
 *
 * The transition duration is a CSS variable the stage sets from the
 * playback speed (80ms / speed): at 8x rrweb casts a sample every 12.5ms,
 * and a fixed 80ms transition would leave the pointer permanently behind
 * the click ripple and the DOM change it caused.
 *
 * The .active ripple is rrweb's click affordance: the class lands on the
 * cursor for the length of a MouseInteraction, and without a rule for it a
 * click is invisible on playback.
 */
export const REPLAY_STAGE_CSS: string = `
.oneuptime-replay-stage .oneuptime-replay-host { position: relative; transform-origin: top left; }
.oneuptime-replay-stage .replayer-wrapper { position: absolute; top: 0; left: 0; transform-origin: top left; }
.oneuptime-replay-stage .replayer-wrapper iframe { border: none; background: #ffffff; }
.oneuptime-replay-stage .replayer-mouse { position: absolute; width: 20px; height: 20px; border-radius: 100%; background: rgba(73,80,246,0.35); box-shadow: 0 0 0 2px rgba(73,80,246,0.9), 0 1px 6px rgba(15,23,42,0.35); transition: left var(--oneuptime-replay-cursor-ms, 80ms) linear, top var(--oneuptime-replay-cursor-ms, 80ms) linear; pointer-events: none; z-index: 2147483647; }
.oneuptime-replay-stage .replayer-mouse::after { content: ""; display: inline-block; width: 20px; height: 20px; border-radius: 100%; background: rgba(73,80,246,0.4); transform: translate(-50%, -50%); opacity: 0; }
.oneuptime-replay-stage .replayer-mouse.active::after { animation: oneuptime-replay-click 0.4s ease-in-out 1; }
.oneuptime-replay-stage .replayer-mouse-tail { position: absolute; pointer-events: none; top: 0; left: 0; z-index: 2147483646; }
.oneuptime-replay-stage .oneuptime-replay-touch-ring { position: absolute; width: ${REPLAY_STAGE_TOUCH_RING_PX}px; height: ${REPLAY_STAGE_TOUCH_RING_PX}px; margin-left: -${REPLAY_STAGE_TOUCH_RING_PX / 2}px; margin-top: -${REPLAY_STAGE_TOUCH_RING_PX / 2}px; border-radius: 100%; border: 3px solid rgba(73,80,246,0.9); box-shadow: 0 0 0 2px rgba(255,255,255,0.7); pointer-events: none; z-index: 2147483647; animation: oneuptime-replay-touch 0.6s ease-out 1 forwards; }
@keyframes oneuptime-replay-click { 0% { opacity: 0.6; transform: translate(-50%, -50%) scale(0.4); } 100% { opacity: 0; transform: translate(-50%, -50%) scale(3); } }
@keyframes oneuptime-replay-touch { 0% { opacity: 0.9; transform: scale(0.6); } 100% { opacity: 0; transform: scale(1.8); } }
`;

/*
 * Contain-fit: the largest scale at which the whole recorded viewport fits
 * the box on both axes. Not capped at 1: theater on a wide display, and
 * phone recordings on any display, are meant to grow. An unmeasured box
 * (jsdom, or a container that is display:none) keeps the picture at 1:1
 * rather than collapsing it to nothing.
 */
export function computeContainScale(
  containerWidth: number,
  containerHeight: number,
  recorded: ReplayRecordedSize,
): number {
  if (
    !(containerWidth > 0) ||
    !(containerHeight > 0) ||
    !(recorded.width > 0) ||
    !(recorded.height > 0)
  ) {
    return 1;
  }

  return Math.min(
    containerWidth / recorded.width,
    containerHeight / recorded.height,
  );
}

/*
 * Re-applied after every full-snapshot rebuild, which replaces <head>.
 * Exported so the test can pin it against a fake Replayer.
 */
export function injectDocumentCsp(replayer: ReplayerLike): void {
  const doc: Document | null = replayer.iframe.contentDocument;

  if (!doc) {
    return;
  }

  const head: HTMLHeadElement | null = doc.head;

  if (!head) {
    return;
  }

  if (!head.querySelector("meta[data-oneuptime-replay-csp]")) {
    const meta: HTMLMetaElement = doc.createElement("meta");
    meta.setAttribute("http-equiv", "Content-Security-Policy");
    meta.setAttribute("content", REPLAY_DOCUMENT_CSP);
    meta.setAttribute("data-oneuptime-replay-csp", "true");
    head.insertBefore(meta, head.firstChild);
  }

  if (!head.querySelector("meta[data-oneuptime-replay-referrer]")) {
    const referrer: HTMLMetaElement = doc.createElement("meta");
    referrer.setAttribute("name", "referrer");
    referrer.setAttribute("content", "no-referrer");
    referrer.setAttribute("data-oneuptime-replay-referrer", "true");
    head.insertBefore(referrer, head.firstChild);
  }
}

interface TouchRing {
  id: number;
  x: number;
  y: number;
}

interface BoxSize {
  width: number;
  height: number;
}

const ReplayStage: FunctionComponent<ReplayStageProps> = (
  props: ReplayStageProps,
): ReactElement => {
  const { engine } = props;
  const fit: ReplayStageFit = props.fit ?? "contain";
  const isTheater: boolean = props.isTheater ?? false;

  /* Wrapped so a method-based engine keeps its `this`. */
  const subscribe: (listener: ReplayEngineListener) => () => void = useCallback(
    (listener: ReplayEngineListener): (() => void) => {
      return engine.subscribe(listener);
    },
    [engine],
  );
  const getSnapshot: () => ReplayEngineSnapshot =
    useCallback((): ReplayEngineSnapshot => {
      return engine.getSnapshot();
    }, [engine]);

  const snapshot: ReplayEngineSnapshot = useSyncExternalStore(
    subscribe,
    getSnapshot,
    getSnapshot,
  );

  const outerRef: React.RefObject<HTMLDivElement> =
    useRef<HTMLDivElement>(null);
  const mountRef: React.RefObject<HTMLDivElement> =
    useRef<HTMLDivElement>(null);

  const [boxSize, setBoxSize] = useState<BoxSize | null>(null);
  const [touchRings, setTouchRings] = useState<Array<TouchRing>>([]);
  const ringIdRef: React.MutableRefObject<number> = useRef<number>(0);

  /*
   * The recorded size: rrweb's Meta once it has cast one, the header's
   * viewport before that. Both are "what the end user's window was".
   */
  const recorded: ReplayRecordedSize | null =
    useMemo((): ReplayRecordedSize | null => {
      if (snapshot.recordedSize) {
        return snapshot.recordedSize;
      }

      if (
        props.viewportWidth &&
        props.viewportHeight &&
        props.viewportWidth > 0 &&
        props.viewportHeight > 0
      ) {
        return { width: props.viewportWidth, height: props.viewportHeight };
      }

      return null;
    }, [snapshot.recordedSize, props.viewportWidth, props.viewportHeight]);

  const isMobile: boolean =
    props.isMobile ??
    (recorded !== null && recorded.width < REPLAY_STAGE_MOBILE_MAX_WIDTH_PX);

  /* Mount the engine's host into this stage; unmount on the way out. */
  useEffect(() => {
    const mount: HTMLDivElement | null = mountRef.current;

    if (!mount) {
      return;
    }

    engine.attach(mount);

    return () => {
      engine.detach();
    };
  }, [engine]);

  /* CSP + iframe title on every (re)built document; touch rings. */
  useEffect(() => {
    const timers: Set<ReturnType<typeof setTimeout>> = new Set<
      ReturnType<typeof setTimeout>
    >();

    const unsubscribe: () => void = engine.onReplayer(
      (event: ReplayEngineReplayerEvent): void => {
        if (
          event.type === "created" ||
          event.type === "fullsnapshot-rebuilded"
        ) {
          injectDocumentCsp(event.replayer);

          try {
            event.replayer.iframe.title = "Recorded page";
          } catch {
            // A destroyed iframe has nothing to name.
          }
          return;
        }

        if (event.type === "touch") {
          ringIdRef.current += 1;
          const ring: TouchRing = {
            id: ringIdRef.current,
            x: event.x,
            y: event.y,
          };

          setTouchRings((current: Array<TouchRing>): Array<TouchRing> => {
            return [...current, ring];
          });

          const timer: ReturnType<typeof setTimeout> = setTimeout((): void => {
            timers.delete(timer);
            setTouchRings((current: Array<TouchRing>): Array<TouchRing> => {
              return current.filter((candidate: TouchRing): boolean => {
                return candidate.id !== ring.id;
              });
            });
          }, TOUCH_RING_LIFETIME_MS);

          timers.add(timer);
        }
      },
    );

    return () => {
      unsubscribe();

      for (const timer of timers) {
        clearTimeout(timer);
      }
    };
  }, [engine]);

  /*
   * Measure the box. Recomputed on CONTAINER resizes too, not only when
   * the recorded size changes: entering theater, collapsing the sidebar or
   * resizing the window all change the available space, and a stale scale
   * either crops the recording or leaves it postage-stamped.
   */
  useEffect(() => {
    const outer: HTMLDivElement | null = outerRef.current;

    if (!outer) {
      return;
    }

    const measure: () => void = (): void => {
      const width: number = outer.clientWidth;
      const height: number = outer.clientHeight;

      setBoxSize((current: BoxSize | null): BoxSize | null => {
        if (current && current.width === width && current.height === height) {
          return current;
        }

        return { width: width, height: height };
      });
    };

    measure();

    let observer: ResizeObserver | null = null;

    if (typeof ResizeObserver !== "undefined") {
      observer = new ResizeObserver((): void => {
        measure();
      });
      observer.observe(outer);
    }

    window.addEventListener("resize", measure);

    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, [isTheater, fit]);

  const scale: number = useMemo((): number => {
    if (fit === "actual" || !recorded || !boxSize) {
      return 1;
    }

    return computeContainScale(boxSize.width, boxSize.height, recorded);
  }, [fit, recorded, boxSize]);

  const { onScaleChange } = props;

  useEffect(() => {
    onScaleChange?.(scale);
  }, [scale, onScaleChange]);

  /*
   * The engine's host holds every Replayer wrapper (old and new during a
   * hold-last-frame rebuild), so scaling the host moves both together.
   */
  useEffect(() => {
    const host: HTMLElement | null = engine.getHostElement();

    if (!host) {
      return;
    }

    if (recorded) {
      host.style.width = `${recorded.width}px`;
      host.style.height = `${recorded.height}px`;
    }

    host.style.transformOrigin = "top left";
    host.style.transform = scale === 1 ? "" : `scale(${scale})`;
  }, [engine, recorded, scale]);

  const aspect: ReplayRecordedSize = recorded ?? DEFAULT_ASPECT;
  const scaledWidth: number = Math.round(aspect.width * scale);
  const scaledHeight: number = Math.round(aspect.height * scale);

  const frameStyle: CSSProperties =
    fit === "actual"
      ? {
          position: "relative",
          width: `${aspect.width}px`,
          height: `${aspect.height}px`,
        }
      : {
          position: "absolute",
          left: `${Math.max(
            0,
            Math.round(((boxSize?.width ?? scaledWidth) - scaledWidth) / 2),
          )}px`,
          top: `${Math.max(
            0,
            Math.round(((boxSize?.height ?? scaledHeight) - scaledHeight) / 2),
          )}px`,
          width: `${scaledWidth}px`,
          height: `${scaledHeight}px`,
        };

  const outerStyle: CSSProperties & Record<string, string> = {
    minHeight: `${REPLAY_STAGE_MIN_HEIGHT_REM}rem`,
    maxHeight: `${
      isTheater
        ? REPLAY_STAGE_THEATER_MAX_HEIGHT_VH
        : REPLAY_STAGE_MAX_HEIGHT_VH
    }vh`,
    /* Aspect reserved from the recorded viewport before the first frame. */
    aspectRatio: `${aspect.width} / ${aspect.height}`,
    "--oneuptime-replay-cursor-ms": `${Math.max(
      16,
      Math.round(80 / Math.max(0.25, snapshot.speed)),
    )}ms`,
  };

  const isBusy: boolean =
    snapshot.phase === "loading" ||
    snapshot.phase === "seeking" ||
    snapshot.phase === "buffering";

  return (
    <div
      ref={outerRef}
      data-testid="replay-stage"
      data-replay-phase={snapshot.phase}
      data-replay-fit={fit}
      data-replay-frame={isMobile ? "phone" : "desktop"}
      role="region"
      aria-label="Session replay"
      aria-busy={isBusy}
      className={`oneuptime-replay-stage relative w-full bg-gray-900 ${
        fit === "actual" ? "overflow-auto" : "overflow-hidden"
      } ${isTheater ? "" : "rounded-lg border border-gray-800"} ${
        props.className ?? ""
      }`}
      style={outerStyle}
    >
      <style>{REPLAY_STAGE_CSS}</style>
      {/*
       * The engine phase, as one word, for assistive tech and the E2E
       * hooks. aria-live so a screen-reader user hears "buffering",
       * "ended" or "error" when the picture changes state - the visible
       * overlays are drawn by the player shell and are not announced.
       */}
      <span
        data-testid="replay-phase"
        className="sr-only"
        aria-live="polite"
        aria-atomic="true"
      >
        {snapshot.phase}
      </span>
      <div
        data-testid="replay-stage-frame"
        className={
          isMobile
            ? "overflow-hidden rounded-xl ring-8 ring-gray-800 bg-black"
            : "bg-white"
        }
        style={frameStyle}
      >
        <div ref={mountRef} className="absolute inset-0" />
        {touchRings.map((ring: TouchRing): ReactElement => {
          return (
            <div
              key={ring.id}
              data-testid="replay-touch-ring"
              className="oneuptime-replay-touch-ring"
              style={{
                left: `${Math.round(ring.x * scale)}px`,
                top: `${Math.round(ring.y * scale)}px`,
              }}
            />
          );
        })}
      </div>
    </div>
  );
};

export default ReplayStage;
