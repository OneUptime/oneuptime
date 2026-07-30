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

export const REPLAY_SPEEDS: Array<number> = [1, 2, 4, 8];

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

const LANE_LABEL_CLASS: string =
  "w-24 shrink-0 text-[10px] font-medium uppercase tracking-wide text-gray-400";

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
      <div className="relative h-4 flex-1 rounded bg-gray-50">
        {props.markers.map(
          (marker: ReplayMarker, index: number): ReactElement => {
            return (
              <button
                key={`${marker.atMs}-${index}`}
                type="button"
                title={`${formatOffset(marker.atMs)} — ${marker.label}`}
                aria-label={`${props.label} at ${formatOffset(marker.atMs)}: ${
                  marker.label
                }`}
                className={`absolute top-0.5 h-3 w-1 -translate-x-1/2 rounded-sm ${props.colorClassName}`}
                style={{
                  left: `${toPercent(marker.atMs, props.durationMs)}%`,
                }}
                onClick={(): void => {
                  props.onSeek(marker.atMs);
                }}
              />
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
        isDraggingRef.current = true;
        /*
         * Capture the pointer so a drag that leaves the track still tracks -
         * without this, dragging past either end drops the gesture and the
         * playhead freezes mid-scrub.
         */
        event.currentTarget.setPointerCapture(event.pointerId);
        onSeek(offsetForClientX(event.clientX));
      },
      [offsetForClientX, onSeek],
    );

  const handlePointerMove: (event: React.PointerEvent<HTMLDivElement>) => void =
    useCallback(
      (event: React.PointerEvent<HTMLDivElement>): void => {
        const offsetMs: number = offsetForClientX(event.clientX);
        setHoverMs(offsetMs);

        if (isDraggingRef.current) {
          onSeek(offsetMs);
        }
      },
      [offsetForClientX, onSeek],
    );

  const handlePointerUp: (event: React.PointerEvent<HTMLDivElement>) => void =
    useCallback((event: React.PointerEvent<HTMLDivElement>): void => {
      isDraggingRef.current = false;

      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId);
      }
    }, []);

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

  const playheadPercent: number = toPercent(currentTimeMs, durationMs);

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

        <div className="inline-flex gap-1">
          {REPLAY_SPEEDS.map((speed: number): ReactElement => {
            const isActive: boolean = props.speed === speed;

            return (
              <button
                key={speed}
                type="button"
                className={`rounded-md px-2 py-1 text-xs font-medium ring-1 ring-inset transition-colors ${
                  isActive
                    ? "bg-indigo-100 text-indigo-800 ring-indigo-200"
                    : "bg-white text-gray-600 ring-gray-200 hover:bg-gray-50"
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

        <label className="inline-flex items-center gap-1.5 text-xs text-gray-600">
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

        <div className="ml-auto text-[10px] text-gray-400">
          Space play/pause · ←→ ±10s · , . ±1s
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
          aria-valuenow={Math.round(currentTimeMs)}
          aria-valuetext={formatOffset(currentTimeMs)}
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
              return (
                <div
                  key={`band-${index}`}
                  className="absolute inset-y-0 flex items-center justify-center overflow-hidden rounded-sm border border-dashed border-amber-400 bg-amber-50"
                  style={{ left: `${left}%`, width: `${width}%` }}
                  title={`Recording gap: ${formatMissing(
                    band.missingMs ?? band.endMs - band.startMs,
                  )}`}
                >
                  <span className="whitespace-nowrap px-1 text-[9px] font-medium text-amber-700">
                    {formatMissing(band.missingMs ?? band.endMs - band.startMs)}
                  </span>
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

      {hoverMs !== null && (
        <div className="mt-1 text-[10px] text-gray-400">
          Seek to {formatOffset(hoverMs)}
        </div>
      )}
    </div>
  );
};

export default ReplayScrubber;
