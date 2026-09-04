import React, {
  FunctionComponent,
  ReactElement,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import Icon from "Common/UI/Components/Icon/Icon";
import IconProp from "Common/Types/Icon/IconProp";

/*
 * Hand-built five-lane replay timeline.
 *
 * There is no slider, timeline or player component anywhere in
 * Common/UI/Components, and rrweb-player is a Svelte component that does not
 * belong in this build pipeline. The drag/hover math is modelled on
 * Common/UI/Components/TelemetryViewer/components/TelemetryHistogram.tsx and
 * the structural approach (pure divs plus a keyboard handler) on
 * Components/Profiles/FlamegraphView.tsx.
 *
 * The lanes exist so a viewer can answer "where did it go wrong" without
 * scrubbing blind, and - critically - so a hole in the recording is drawn as
 * a labelled band rather than silently skipped.
 */

export enum ReplayBandState {
  /* Decoded and resident. Seeking here is instant. */
  Loaded = "loaded",
  /* Present on the server, not yet fetched. */
  Available = "available",
  /* Never arrived. Playback cannot cross it. */
  Missing = "missing",
}

export interface ReplayBand {
  startMs: number;
  endMs: number;
  state: ReplayBandState;
  /* Only meaningful for Missing bands. */
  missingMs?: number | undefined;
}

export interface ReplayMarker {
  atMs: number;
  label: string;
}

/*
 * Sub-1x speeds exist for the moments engineers actually scrub for: a
 * flash of wrong UI, a race visible for three frames. 0.5x/0.25x is how
 * you see it; 8x is how you find it.
 */
export const REPLAY_SPEEDS: Array<number> = [0.25, 0.5, 1, 2, 4, 8];

export interface ReplayScrubberProps {
  durationMs: number;
  currentTimeMs: number;
  isPlaying: boolean;
  speed: number;
  skipInactive: boolean;

  /* Lane 1: chunk / buffer state, including the missing bands. */
  bands: Array<ReplayBand>;
  /* Lane 2 */
  frustrationMarkers: Array<ReplayMarker>;
  /* Lane 3 */
  errorMarkers: Array<ReplayMarker>;
  /* Lane 4: 4xx / 5xx responses only. 2xx noise would make the lane useless. */
  networkMarkers: Array<ReplayMarker>;
  /* Lane 5 */
  routeMarkers: Array<ReplayMarker>;

  onSeek: (offsetMs: number) => void;
  onPlayPauseToggle: () => void;
  onSpeedChange: (speed: number) => void;
  onSkipInactiveChange: (skipInactive: boolean) => void;
  /* Disabled when there is no error after the playhead. */
  onJumpToNextError: () => void;

  /* Keyboard shortcuts are suppressed while the player is not the focus. */
  areShortcutsEnabled?: boolean | undefined;
}

function formatOffset(offsetMs: number): string {
  const clamped: number = Math.max(0, Math.round(offsetMs / 1000));
  const minutes: number = Math.floor(clamped / 60);
  const seconds: number = clamped % 60;

  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

function formatMissing(missingMs: number): string {
  const seconds: number = Math.round(missingMs / 1000);

  if (seconds < 60) {
    return `${seconds}s missing`;
  }

  return `${Math.round(seconds / 60)}m missing`;
}

/*
 * Percentage helpers. Every band and marker is positioned in percent rather
 * than pixels so the lanes stay aligned across container resizes without a
 * ResizeObserver.
 */
function toPercent(valueMs: number, durationMs: number): number {
  if (durationMs <= 0) {
    return 0;
  }

  return Math.min(100, Math.max(0, (valueMs / durationMs) * 100));
}

/*
 * gray-500 rather than gray-400: gray-400 on white is about 2.9:1, which
 * fails WCAG AA for text. These labels are the only thing naming each lane,
 * so they have to be readable rather than decorative.
 */
const LANE_LABEL_CLASS: string =
  "w-24 shrink-0 text-[11px] font-medium uppercase tracking-wide text-gray-500";

interface MarkerLaneProps {
  label: string;
  markers: Array<ReplayMarker>;
  durationMs: number;
  colorClassName: string;
  onSeek: (offsetMs: number) => void;
}

const MarkerLane: FunctionComponent<MarkerLaneProps> = (
  props: MarkerLaneProps,
): ReactElement => {
  return (
    <div className="flex items-center gap-2">
      <div className={LANE_LABEL_CLASS}>{props.label}</div>
      <div className="relative h-5 flex-1 rounded bg-gray-50 ring-1 ring-inset ring-gray-100">
        {props.markers.map(
          (marker: ReplayMarker, index: number): ReactElement => {
            /*
             * The button is the HIT AREA and is deliberately wider than the
             * mark it draws. A 4px-wide target is close to unclickable, and
             * these are the primary way anyone navigates to the interesting
             * moment in a recording. The visible bar stays thin so a cluster
             * of markers is still legible as separate events.
             */
            return (
              <button
                key={`${marker.atMs}-${index}`}
                type="button"
                title={`${formatOffset(marker.atMs)} — ${marker.label}`}
                aria-label={`${props.label} at ${formatOffset(marker.atMs)}: ${
                  marker.label
                }`}
                className="group absolute inset-y-0 flex w-3.5 -translate-x-1/2 items-center justify-center rounded-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
                style={{
                  left: `${toPercent(marker.atMs, props.durationMs)}%`,
                }}
                onClick={(): void => {
                  props.onSeek(marker.atMs);
                }}
              >
                <span
                  className={`h-3 w-1 rounded-sm transition-all group-hover:h-4 group-hover:w-1.5 ${props.colorClassName}`}
                />
              </button>
            );
          },
        )}
      </div>
    </div>
  );
};

const ReplayScrubber: FunctionComponent<ReplayScrubberProps> = (
  props: ReplayScrubberProps,
): ReactElement => {
  const trackRef: React.RefObject<HTMLDivElement> =
    useRef<HTMLDivElement>(null);
  const isDraggingRef: React.MutableRefObject<boolean> = useRef<boolean>(false);
  const [hoverMs, setHoverMs] = useState<number | null>(null);
  /*
   * Where the held pointer currently is. Rendered as the playhead while a
   * drag is in progress, and committed with a single onSeek on release.
   *
   * A drag must NOT seek continuously. Every onSeek bumps the player's seek
   * token, and a target on the far side of a snapshot anchor - a few pixels
   * on a 30-minute recording - makes ReplayStage destroy the Replayer, drop
   * the decoded LRU and POST to /chunks. One drag across the timeline would
   * be dozens of teardowns and dozens of authenticated fetches.
   */
  const [dragMs, setDragMs] = useState<number | null>(null);
  const dragMsRef: React.MutableRefObject<number> = useRef<number>(0);

  const {
    durationMs,
    currentTimeMs,
    onSeek,
    onPlayPauseToggle,
    areShortcutsEnabled,
  } = props;

  /*
   * Client X -> offset. Reading the rect on every move (rather than caching
   * it) is what keeps the drag correct when the page scrolls underneath a
   * held pointer.
   */
  const offsetForClientX: (clientX: number) => number = useCallback(
    (clientX: number): number => {
      const element: HTMLDivElement | null = trackRef.current;

      if (!element || durationMs <= 0) {
        return 0;
      }

      const rect: DOMRect = element.getBoundingClientRect();

      if (rect.width <= 0) {
        return 0;
      }

      const ratio: number = (clientX - rect.left) / rect.width;

      return Math.min(durationMs, Math.max(0, ratio * durationMs));
    },
    [durationMs],
  );

  const handlePointerDown: (event: React.PointerEvent<HTMLDivElement>) => void =
    useCallback(
      (event: React.PointerEvent<HTMLDivElement>): void => {
        const offsetMs: number = offsetForClientX(event.clientX);

        isDraggingRef.current = true;
        dragMsRef.current = offsetMs;
        setDragMs(offsetMs);
        /*
         * Capture the pointer so a drag that leaves the track still tracks -
         * without this, dragging past either end drops the gesture and the
         * playhead freezes mid-scrub.
         */
        event.currentTarget.setPointerCapture(event.pointerId);
      },
      [offsetForClientX],
    );

  const handlePointerMove: (event: React.PointerEvent<HTMLDivElement>) => void =
    useCallback(
      (event: React.PointerEvent<HTMLDivElement>): void => {
        const offsetMs: number = offsetForClientX(event.clientX);
        setHoverMs(offsetMs);

        if (isDraggingRef.current) {
          // Local preview only. The seek is committed on release.
          dragMsRef.current = offsetMs;
          setDragMs(offsetMs);
        }
      },
      [offsetForClientX],
    );

  const handlePointerUp: (event: React.PointerEvent<HTMLDivElement>) => void =
    useCallback(
      (event: React.PointerEvent<HTMLDivElement>): void => {
        const wasDragging: boolean = isDraggingRef.current;
        isDraggingRef.current = false;

        if (event.currentTarget.hasPointerCapture(event.pointerId)) {
          event.currentTarget.releasePointerCapture(event.pointerId);
        }

        setDragMs(null);

        /*
         * A plain click is a pointerdown followed immediately by a pointerup
         * with no move, so this is also the path that makes clicking the
         * track seek. Exactly one onSeek per gesture, either way.
         */
        if (wasDragging) {
          onSeek(dragMsRef.current);
        }
      },
      [onSeek],
    );

  useEffect(() => {
    if (areShortcutsEnabled === false) {
      return;
    }

    const handler: (event: KeyboardEvent) => void = (
      event: KeyboardEvent,
    ): void => {
      const target: EventTarget | null = event.target;

      /*
       * Never steal keys from a text field. Space in particular is a normal
       * character, and a global handler that swallows it makes every filter
       * box on the page feel broken.
       */
      if (target instanceof HTMLElement) {
        const tag: string = target.tagName.toLowerCase();

        if (
          tag === "input" ||
          tag === "textarea" ||
          tag === "select" ||
          target.isContentEditable
        ) {
          return;
        }

        /*
         * Nor from anything Space is supposed to activate. Without this a
         * keyboard-only user cannot press "Session details", a speed button,
         * a tab or a marker: the focused control never gets its Space
         * because this handler preventDefaults it into a play/pause toggle.
         */
        if (target.closest("button, a, [role='button'], [role='checkbox']")) {
          return;
        }
      }

      switch (event.key) {
        case " ":
          event.preventDefault();
          onPlayPauseToggle();
          break;
        case "ArrowLeft":
          event.preventDefault();
          onSeek(Math.max(0, currentTimeMs - 10000));
          break;
        case "ArrowRight":
          event.preventDefault();
          onSeek(Math.min(durationMs, currentTimeMs + 10000));
          break;
        case ",":
          event.preventDefault();
          onSeek(Math.max(0, currentTimeMs - 1000));
          break;
        case ".":
          event.preventDefault();
          onSeek(Math.min(durationMs, currentTimeMs + 1000));
          break;
        default:
          break;
      }
    };

    window.addEventListener("keydown", handler);

    return () => {
      window.removeEventListener("keydown", handler);
    };
  }, [
    areShortcutsEnabled,
    currentTimeMs,
    durationMs,
    onSeek,
    onPlayPauseToggle,
  ]);

  const hasErrorAhead: boolean = useMemo(() => {
    return props.errorMarkers.some((marker: ReplayMarker): boolean => {
      return marker.atMs > currentTimeMs;
    });
  }, [props.errorMarkers, currentTimeMs]);

  /*
   * While a drag is in progress the playhead follows the pointer even though
   * the player has not been told to seek yet, so the gesture still feels
   * direct without costing a Replayer rebuild per pixel.
   */
  const playheadMs: number = dragMs ?? currentTimeMs;
  const playheadPercent: number = toPercent(playheadMs, durationMs);

  return (
    <div className="rounded-lg border border-gray-200 bg-white p-3">
      {/* Controls */}
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <button
          type="button"
          className="inline-flex h-8 w-8 items-center justify-center rounded-md bg-indigo-600 text-white hover:bg-indigo-700"
          onClick={onPlayPauseToggle}
          aria-label={props.isPlaying ? "Pause (Space)" : "Play (Space)"}
          title={props.isPlaying ? "Pause (Space)" : "Play (Space)"}
        >
          <Icon
            icon={props.isPlaying ? IconProp.Pause : IconProp.Play}
            className="h-4 w-4"
          />
        </button>

        <div className="font-mono text-xs tabular-nums text-gray-700">
          {formatOffset(currentTimeMs)} / {formatOffset(durationMs)}
        </div>

        {/*
         * One segmented control rather than four separate ring-1 buttons.
         * These are mutually exclusive values of a single setting, and four
         * outlined pills read as four unrelated actions.
         */}
        <div
          role="group"
          aria-label="Playback speed"
          className="inline-flex overflow-hidden rounded-md ring-1 ring-inset ring-gray-300"
        >
          {REPLAY_SPEEDS.map((speed: number, index: number): ReactElement => {
            const isActive: boolean = props.speed === speed;

            return (
              <button
                key={speed}
                type="button"
                aria-pressed={isActive}
                className={`px-2.5 py-1 text-xs font-medium tabular-nums transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-indigo-500 ${
                  index > 0 ? "border-l border-gray-300" : ""
                } ${
                  isActive
                    ? "bg-indigo-600 text-white"
                    : "bg-white text-gray-700 hover:bg-gray-50"
                }`}
                onClick={(): void => {
                  props.onSpeedChange(speed);
                }}
              >
                {speed}x
              </button>
            );
          })}
        </div>

        {/*
         * Off by default; see DEFAULT_SKIP_INACTIVE. The title says what it
         * costs, because "why did the recording jump" is otherwise a
         * mystery a viewer has no way to connect back to this checkbox.
         */}
        <label
          className="inline-flex items-center gap-1.5 text-xs text-gray-600"
          title="Fast-forward through stretches with no user interaction. Playback jumps rather than showing every idle second."
        >
          <input
            type="checkbox"
            className="h-3.5 w-3.5 rounded border-gray-300"
            checked={props.skipInactive}
            onChange={(event: React.ChangeEvent<HTMLInputElement>): void => {
              props.onSkipInactiveChange(event.target.checked);
            }}
          />
          Skip inactivity
        </label>

        <button
          type="button"
          disabled={!hasErrorAhead}
          className={`inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium ring-1 ring-inset transition-colors ${
            hasErrorAhead
              ? "bg-white text-rose-700 ring-rose-200 hover:bg-rose-50"
              : "cursor-not-allowed bg-gray-50 text-gray-300 ring-gray-200"
          }`}
          onClick={props.onJumpToNextError}
        >
          <Icon icon={IconProp.Alert} className="h-3 w-3" />
          Next error
        </button>

        <div className="ml-auto text-[11px] text-gray-500">
          <kbd className="font-sans font-medium">Space</kbd> play/pause ·{" "}
          <kbd className="font-sans font-medium">←→</kbd> ±10s ·{" "}
          <kbd className="font-sans font-medium">, .</kbd> ±1s
        </div>
      </div>

      {/* Lane 1: chunk / buffer state, plus the seekable track. */}
      <div className="flex items-center gap-2">
        <div className={LANE_LABEL_CLASS}>Recording</div>
        <div
          ref={trackRef}
          role="slider"
          tabIndex={0}
          aria-label="Replay position"
          aria-valuemin={0}
          aria-valuemax={Math.round(durationMs)}
          aria-valuenow={Math.round(playheadMs)}
          aria-valuetext={formatOffset(playheadMs)}
          className="relative h-6 flex-1 cursor-pointer touch-none rounded bg-gray-100"
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerUp}
          onPointerLeave={(): void => {
            setHoverMs(null);
          }}
        >
          {props.bands.map((band: ReplayBand, index: number): ReactElement => {
            const left: number = toPercent(band.startMs, durationMs);
            const width: number = Math.max(
              0.4,
              toPercent(band.endMs, durationMs) - left,
            );

            /*
             * A missing band is drawn with a hatch and its own label rather
             * than simply left blank. An unexplained blank reads as "nothing
             * happened"; the whole point is that something happened and we
             * do not have it.
             */
            if (band.state === ReplayBandState.Missing) {
              const missingLabel: string = formatMissing(
                band.missingMs ?? band.endMs - band.startMs,
              );

              /*
               * The inline label is dropped on narrow gaps rather than being
               * clipped to a meaningless fragment ("18s missing" rendered as
               * "18"). The hatch pattern still marks the gap and the title
               * still gives the exact duration on hover.
               */
              const isWideEnoughForLabel: boolean = width >= 9;

              return (
                <div
                  key={`band-${index}`}
                  className="absolute inset-y-0 flex items-center justify-center overflow-hidden rounded-sm border border-dashed border-amber-400 bg-amber-50"
                  style={{ left: `${left}%`, width: `${width}%` }}
                  title={`Recording gap: ${missingLabel}`}
                >
                  {isWideEnoughForLabel && (
                    <span className="whitespace-nowrap px-1 text-[11px] font-medium text-amber-800">
                      {missingLabel}
                    </span>
                  )}
                </div>
              );
            }

            return (
              <div
                key={`band-${index}`}
                className={`absolute inset-y-1 rounded-sm ${
                  band.state === ReplayBandState.Loaded
                    ? "bg-indigo-400"
                    : "bg-gray-300"
                }`}
                style={{ left: `${left}%`, width: `${width}%` }}
              />
            );
          })}

          {hoverMs !== null && (
            <div
              className="pointer-events-none absolute inset-y-0 w-px bg-gray-400"
              style={{ left: `${toPercent(hoverMs, durationMs)}%` }}
            />
          )}

          <div
            className="pointer-events-none absolute inset-y-0 w-0.5 bg-gray-900"
            style={{ left: `${playheadPercent}%` }}
          />
        </div>
      </div>

      <div className="mt-1.5 space-y-1">
        <MarkerLane
          label="Frustration"
          markers={props.frustrationMarkers}
          durationMs={durationMs}
          colorClassName="bg-amber-500 hover:bg-amber-600"
          onSeek={onSeek}
        />
        <MarkerLane
          label="Errors"
          markers={props.errorMarkers}
          durationMs={durationMs}
          colorClassName="bg-rose-500 hover:bg-rose-600"
          onSeek={onSeek}
        />
        <MarkerLane
          label="4xx / 5xx"
          markers={props.networkMarkers}
          durationMs={durationMs}
          colorClassName="bg-orange-400 hover:bg-orange-500"
          onSeek={onSeek}
        />
        <MarkerLane
          label="Route changes"
          markers={props.routeMarkers}
          durationMs={durationMs}
          colorClassName="bg-sky-400 hover:bg-sky-500"
          onSeek={onSeek}
        />
      </div>

      {/*
       * A legend, and the hover readout, share one always-present row.
       *
       * The row is rendered unconditionally: showing the hover hint only while
       * hovering shifted every lane above it by a line the moment the pointer
       * entered the track, which made the thing you were aiming at move.
       */}
      <div className="mt-2 flex h-4 items-center gap-3 text-[11px] text-gray-500">
        <span className="inline-flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-sm bg-indigo-400" />
          Loaded
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-sm bg-gray-300" />
          Not yet loaded
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-sm border border-dashed border-amber-400 bg-amber-50" />
          Gap
        </span>

        {hoverMs !== null && (
          <span className="ml-auto font-mono tabular-nums text-gray-600">
            Seek to {formatOffset(hoverMs)}
          </span>
        )}
      </div>
    </div>
  );
};

export default ReplayScrubber;
