import React, {
  FunctionComponent,
  ReactElement,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { ReplaySignal } from "./Rail/ReplaySignalTypes";
import {
  REPLAY_TIMELINE_LANES,
  REPLAY_TIMELINE_LANE_LABELS,
  ReplayActivityBucket,
  ReplayMarkerCluster,
  ReplayTimelineLane,
  ReplayTimelineMarker,
  ReplayTimelineMarkerTone,
  ReplayTimelinePreview,
  ReplayTrackBand,
  buildHoverPreview,
  clampOffset,
  clusterMarkers,
  describeCluster,
  getMarkersForLane,
  markerSeekTarget,
  nudgeOffset,
  offsetToPercent,
} from "./ReplayTimelineMath";
import {
  REPLAY_KEY_SEEK_FINE_MS,
  ReplaySliderKeyAction,
  resolveReplaySliderKey,
} from "./ReplayKeyboardMap";
import {
  formatReplayOffset,
  formatReplayOffsetPrecise,
  formatReplayWallClock,
} from "./ReplayTimeFormat";

/*
 * The seekable track, the activity strip and three clustered marker lanes.
 *
 * Everything here is drawn from what ReplayTimelineMath computed; this
 * file owns pointer, wheel and slider-key handling and the palette. The
 * two expensive mistakes it exists to avoid are invisible in a screenshot:
 * seeking on every pointermove (each seek can rebuild the Replayer and
 * fetch chunks), and drawing a hole in the recording as blank track. A
 * drag previews locally and commits ONE seek on release; a gap is a
 * hatched, labelled, focusable band.
 */

export const REPLAY_TIMELINE_DEFAULT_WIDTH_PX: number = 1000;

export interface ReplayTimelineProps {
  durationMs: number;
  currentTimeMs: number;
  bands: Array<ReplayTrackBand>;
  /* Optional: the lane is omitted entirely when nothing was measured. */
  activity?: Array<ReplayActivityBucket> | undefined;
  markers: Array<ReplayTimelineMarker>;
  /* For the hover preview card: nearest route and signals within +-2s. */
  signals?: Array<ReplaySignal> | undefined;
  /* A rail row is being hovered: draw a ghost playhead at its offset. */
  ghostMs?: number | null | undefined;
  /* The rail's selected row, so its marker can carry aria-current. */
  selectedSignalId?: string | null | undefined;
  /* Session start, for the wall-clock line in the hover bubble. */
  startTimeUnixMs?: number | null | undefined;
  onSeek: (offsetMs: number) => void;
  onSelectSignal?: ((signalId: string) => void) | undefined;
  onHover?: ((offsetMs: number | null) => void) | undefined;
}

/*
 * gray-500 rather than gray-400: gray-400 on white is about 2.9:1, which
 * fails WCAG AA for text, and these labels are the only thing naming each
 * lane.
 */
const LANE_LABEL_CLASS: string =
  "w-20 shrink-0 text-[11px] font-medium uppercase tracking-wide text-gray-500";

const HATCH_AMBER: string =
  "repeating-linear-gradient(135deg, rgba(251,191,36,0.55) 0 3px, transparent 3px 7px)";
const HATCH_GRAY: string =
  "repeating-linear-gradient(135deg, rgba(156,163,175,0.45) 0 2px, transparent 2px 6px)";

/* Solid fill per tone; hollow markers use the matching ring. */
const TONE_CLASS: Record<ReplayTimelineMarkerTone, string> = {
  rose: "bg-rose-500 hover:bg-rose-600",
  "rose-outline":
    "bg-white ring-2 ring-inset ring-rose-500 hover:ring-rose-600",
  "rose-dot": "bg-rose-400 hover:bg-rose-500 rounded-full",
  amber: "bg-amber-500 hover:bg-amber-600",
  orange: "bg-orange-400 hover:bg-orange-500",
  sky: "bg-sky-400 hover:bg-sky-500",
  gray: "bg-gray-400 hover:bg-gray-500",
};

const HOLLOW_TONE_CLASS: Record<ReplayTimelineMarkerTone, string> = {
  rose: "bg-white ring-1 ring-inset ring-rose-500",
  "rose-outline": "bg-white ring-1 ring-inset ring-rose-500",
  "rose-dot": "bg-white ring-1 ring-inset ring-rose-400 rounded-full",
  amber: "bg-white ring-1 ring-inset ring-amber-500",
  orange: "bg-white ring-1 ring-inset ring-orange-400",
  sky: "bg-white ring-1 ring-inset ring-sky-400",
  gray: "bg-white ring-1 ring-inset ring-gray-400",
};

const PILL_TONE_CLASS: Record<ReplayTimelineMarkerTone, string> = {
  rose: "bg-rose-600 text-white",
  "rose-outline": "bg-rose-600 text-white",
  "rose-dot": "bg-rose-500 text-white",
  amber: "bg-amber-500 text-white",
  orange: "bg-orange-500 text-white",
  sky: "bg-sky-500 text-white",
  gray: "bg-gray-500 text-white",
};

/*
 * The bubble and the preview card are anchored at the hover percent and
 * pulled back inside the track near either edge, so the time is never
 * clipped at 0:00 or at the end.
 */
function edgeAwareTransform(percent: number): string {
  if (percent < 8) {
    return "translateX(0)";
  }

  if (percent > 92) {
    return "translateX(-100%)";
  }

  return "translateX(-50%)";
}

interface BandProps {
  band: ReplayTrackBand;
  durationMs: number;
}

const TrackBand: FunctionComponent<BandProps> = (
  props: BandProps,
): ReactElement => {
  const { band, durationMs } = props;
  const left: number = offsetToPercent(band.startMs, durationMs);
  const width: number = Math.max(
    0.4,
    offsetToPercent(band.endMs, durationMs) - left,
  );

  if (band.kind === "loaded" || band.kind === "available") {
    return (
      <div
        data-testid={
          band.kind === "loaded"
            ? "timeline-loaded-band"
            : "timeline-available-band"
        }
        aria-hidden="true"
        className={`absolute inset-y-1.5 rounded-sm ${
          band.kind === "loaded" ? "bg-indigo-400" : "bg-gray-300"
        }`}
        style={{ left: `${left}%`, width: `${width}%` }}
      />
    );
  }

  /*
   * The inline label is dropped on narrow bands rather than clipped to a
   * meaningless fragment ("18s missing" rendered as "18"). The hatch
   * still marks the stretch, and the accessible name still carries the
   * exact duration - on hover, on focus, and to a screen reader, which
   * a title on a non-focusable div never reached (finding 21).
   */
  const isWideEnoughForLabel: boolean = width >= 9;
  const isGap: boolean = band.kind === "gap";
  const isBackground: boolean = band.kind === "background-tab";
  const accessibleName: string = isGap
    ? `Recording gap: ${band.label}`
    : isBackground
      ? `Tab in background: ${band.label}`
      : `Idle: ${band.label}${
          band.fidelity === "coarse" ? " (estimated until the chunk loads)" : ""
        }`;

  return (
    <div
      data-testid={isGap ? "timeline-gap-band" : "timeline-idle-band"}
      data-kind={band.kind}
      data-fidelity={band.fidelity || "exact"}
      role="note"
      tabIndex={0}
      aria-label={accessibleName}
      title={accessibleName}
      className={`absolute inset-y-0 flex items-center justify-center overflow-hidden rounded-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 ${
        isGap
          ? "border border-dashed border-amber-400 bg-amber-50"
          : isBackground
            ? "border border-dotted border-gray-400 bg-gray-100"
            : "bg-gray-200"
      }`}
      style={{
        left: `${left}%`,
        width: `${width}%`,
        backgroundImage: isGap
          ? HATCH_AMBER
          : isBackground
            ? undefined
            : HATCH_GRAY,
      }}
    >
      {isWideEnoughForLabel && (
        <span
          className={`whitespace-nowrap px-1 text-[11px] font-medium ${
            isGap ? "text-amber-800" : "text-gray-600"
          }`}
        >
          {band.label}
        </span>
      )}
    </div>
  );
};

interface MarkerLaneProps {
  lane: ReplayTimelineLane;
  markers: Array<ReplayTimelineMarker>;
  durationMs: number;
  widthPx: number;
  selectedSignalId: string | null;
  onActivate: (marker: ReplayTimelineMarker) => void;
}

const MarkerLane: FunctionComponent<MarkerLaneProps> = (
  props: MarkerLaneProps,
): ReactElement => {
  const clusters: Array<ReplayMarkerCluster> = useMemo(() => {
    return clusterMarkers(props.markers, props.durationMs, props.widthPx);
  }, [props.markers, props.durationMs, props.widthPx]);

  return (
    <div className="flex items-center gap-2">
      <div className={LANE_LABEL_CLASS}>
        {REPLAY_TIMELINE_LANE_LABELS[props.lane]}
      </div>
      <div
        data-testid={`timeline-lane-${props.lane}`}
        className="relative h-5 flex-1 rounded bg-gray-50 ring-1 ring-inset ring-gray-100"
      >
        {clusters.map((cluster: ReplayMarkerCluster): ReactElement => {
          const first: ReplayTimelineMarker | undefined = cluster.markers[0];

          if (!first) {
            return <React.Fragment key={cluster.id} />;
          }

          const left: number = offsetToPercent(
            cluster.offsetMs,
            props.durationMs,
          );

          if (cluster.count > 1) {
            const spanWidth: number = Math.max(
              0,
              offsetToPercent(cluster.endOffsetMs, props.durationMs) - left,
            );
            const title: string = describeCluster(cluster);

            /*
             * A pill with the count, sitting at the first marker; the seek
             * lands there and the tooltip lists the first five. The span
             * line behind it shows how far the cluster stretches.
             */
            return (
              <React.Fragment key={cluster.id}>
                {spanWidth > 0.5 && (
                  <span
                    aria-hidden="true"
                    className="pointer-events-none absolute top-1/2 h-0.5 -translate-y-1/2 bg-gray-300"
                    style={{ left: `${left}%`, width: `${spanWidth}%` }}
                  />
                )}
                <button
                  type="button"
                  data-testid="timeline-marker-cluster"
                  data-lane={props.lane}
                  data-count={cluster.count}
                  title={title}
                  aria-label={`${cluster.count} ${
                    REPLAY_TIMELINE_LANE_LABELS[props.lane]
                  } markers from ${formatReplayOffset(cluster.offsetMs)} to ${formatReplayOffset(
                    cluster.endOffsetMs,
                  )}`}
                  className={`absolute top-1/2 flex h-4 min-w-[1.25rem] -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full px-1 text-[10px] font-semibold tabular-nums shadow-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 ${
                    PILL_TONE_CLASS[first.tone]
                  }`}
                  style={{ left: `${left}%` }}
                  onClick={(): void => {
                    props.onActivate(first);
                  }}
                >
                  {cluster.count}
                </button>
              </React.Fragment>
            );
          }

          const isSelected: boolean =
            Boolean(first.signalId) &&
            first.signalId === props.selectedSignalId;

          /*
           * The button is the HIT AREA and is deliberately wider than the
           * mark it draws. A 4px-wide target is close to unclickable, and
           * these are the primary way anyone navigates to the interesting
           * moment. Coarse and unanchored markers are hollow at half
           * opacity: the position is an estimate and the title says so.
           */
          return (
            <button
              key={cluster.id}
              type="button"
              data-testid="timeline-marker"
              data-lane={props.lane}
              data-fidelity={first.fidelity}
              data-hollow={first.isHollow ? "true" : "false"}
              data-signal-id={first.signalId || undefined}
              title={first.title}
              aria-label={first.title}
              aria-current={isSelected ? "true" : undefined}
              className={`group absolute inset-y-0 flex w-3.5 -translate-x-1/2 items-center justify-center rounded-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 ${
                first.isHollow ? "opacity-50 hover:opacity-100" : ""
              }`}
              style={{ left: `${left}%` }}
              onClick={(): void => {
                props.onActivate(first);
              }}
            >
              <span
                className={`h-3 w-1 rounded-sm transition-all group-hover:h-4 group-hover:w-1.5 ${
                  first.isHollow
                    ? HOLLOW_TONE_CLASS[first.tone]
                    : TONE_CLASS[first.tone]
                } ${isSelected ? "h-4 w-1.5 outline outline-2 outline-indigo-400" : ""}`}
              />
            </button>
          );
        })}
      </div>
    </div>
  );
};

const ReplayTimeline: FunctionComponent<ReplayTimelineProps> = (
  props: ReplayTimelineProps,
): ReactElement => {
  const trackRef: React.RefObject<HTMLDivElement> =
    useRef<HTMLDivElement>(null);
  const isDraggingRef: React.MutableRefObject<boolean> = useRef<boolean>(false);
  const activePointerIdRef: React.MutableRefObject<number | null> = useRef<
    number | null
  >(null);
  const [hoverMs, setHoverMs] = useState<number | null>(null);
  /*
   * Where the held pointer currently is. Rendered as the playhead while a
   * drag is in progress, committed with a single onSeek on release.
   */
  const [dragMs, setDragMs] = useState<number | null>(null);
  const dragMsRef: React.MutableRefObject<number> = useRef<number>(0);
  const [widthPx, setWidthPx] = useState<number>(
    REPLAY_TIMELINE_DEFAULT_WIDTH_PX,
  );

  const { durationMs, currentTimeMs, onSeek, onSelectSignal, onHover } = props;

  /* Refs the stable wheel listener reads, so it is registered once. */
  const currentTimeRef: React.MutableRefObject<number> =
    useRef<number>(currentTimeMs);
  const durationRef: React.MutableRefObject<number> =
    useRef<number>(durationMs);
  const onSeekRef: React.MutableRefObject<(offsetMs: number) => void> =
    useRef<(offsetMs: number) => void>(onSeek);

  currentTimeRef.current = currentTimeMs;
  durationRef.current = durationMs;
  onSeekRef.current = onSeek;

  /*
   * Pixel width only matters for clustering ("do these two ticks
   * overlap"); everything is positioned in percent. jsdom has no
   * ResizeObserver, so tests run at the default width.
   */
  useEffect(() => {
    const element: HTMLDivElement | null = trackRef.current;

    if (!element || typeof ResizeObserver === "undefined") {
      return;
    }

    const observer: ResizeObserver = new ResizeObserver(
      (entries: Array<ResizeObserverEntry>): void => {
        const entry: ResizeObserverEntry | undefined = entries[0];

        if (entry && entry.contentRect.width > 0) {
          setWidthPx(entry.contentRect.width);
        }
      },
    );

    observer.observe(element);

    return () => {
      observer.disconnect();
    };
  }, []);

  /*
   * Wheel nudges +-1s. Registered natively because React marks its wheel
   * listeners passive, and a passive listener cannot preventDefault - the
   * page would scroll under the track on every nudge.
   */
  useEffect(() => {
    const element: HTMLDivElement | null = trackRef.current;

    if (!element) {
      return;
    }

    const handleWheel: (event: WheelEvent) => void = (
      event: WheelEvent,
    ): void => {
      const primaryDelta: number =
        Math.abs(event.deltaY) >= Math.abs(event.deltaX)
          ? event.deltaY
          : event.deltaX;

      if (primaryDelta === 0) {
        return;
      }

      event.preventDefault();

      const direction: number = primaryDelta > 0 ? 1 : -1;

      onSeekRef.current(
        nudgeOffset(
          currentTimeRef.current,
          direction * REPLAY_KEY_SEEK_FINE_MS,
          durationRef.current,
        ),
      );
    };

    element.addEventListener("wheel", handleWheel, { passive: false });

    return () => {
      element.removeEventListener("wheel", handleWheel);
    };
  }, []);

  /*
   * Client X -> offset. Reading the rect on every move (rather than
   * caching it) keeps the drag correct when the page scrolls underneath a
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

      return clampOffset(ratio * durationMs, durationMs);
    },
    [durationMs],
  );

  const updateHover: (offsetMs: number | null) => void = useCallback(
    (offsetMs: number | null): void => {
      setHoverMs(offsetMs);

      if (onHover) {
        onHover(offsetMs);
      }
    },
    [onHover],
  );

  const handlePointerDown: (event: React.PointerEvent<HTMLDivElement>) => void =
    useCallback(
      (event: React.PointerEvent<HTMLDivElement>): void => {
        /*
         * Primary button and primary pointer only. A right-click opens
         * the context menu and must not seek; a second finger during a
         * pinch is not a scrub (finding 19).
         */
        if (event.button !== 0 || event.isPrimary === false) {
          return;
        }

        const offsetMs: number = offsetForClientX(event.clientX);

        isDraggingRef.current = true;
        activePointerIdRef.current = event.pointerId;
        dragMsRef.current = offsetMs;
        setDragMs(offsetMs);

        /*
         * Capture the pointer so a drag that leaves the track still
         * tracks - without this, dragging past either end drops the
         * gesture and the playhead freezes mid-scrub.
         */
        if (typeof event.currentTarget.setPointerCapture === "function") {
          event.currentTarget.setPointerCapture(event.pointerId);
        }
      },
      [offsetForClientX],
    );

  const handlePointerMove: (event: React.PointerEvent<HTMLDivElement>) => void =
    useCallback(
      (event: React.PointerEvent<HTMLDivElement>): void => {
        const offsetMs: number = offsetForClientX(event.clientX);
        updateHover(offsetMs);

        if (isDraggingRef.current) {
          // Local preview only. The seek is committed on release.
          dragMsRef.current = offsetMs;
          setDragMs(offsetMs);
        }
      },
      [offsetForClientX, updateHover],
    );

  const releasePointer: (event: React.PointerEvent<HTMLDivElement>) => boolean =
    useCallback((event: React.PointerEvent<HTMLDivElement>): boolean => {
      const wasDragging: boolean = isDraggingRef.current;
      isDraggingRef.current = false;
      activePointerIdRef.current = null;

      if (
        typeof event.currentTarget.hasPointerCapture === "function" &&
        event.currentTarget.hasPointerCapture(event.pointerId)
      ) {
        event.currentTarget.releasePointerCapture(event.pointerId);
      }

      setDragMs(null);

      return wasDragging;
    }, []);

  const handlePointerUp: (event: React.PointerEvent<HTMLDivElement>) => void =
    useCallback(
      (event: React.PointerEvent<HTMLDivElement>): void => {
        /*
         * A plain click is a pointerdown followed immediately by a
         * pointerup with no move, so this is also the path that makes
         * clicking the track seek. Exactly one onSeek per gesture.
         */
        if (releasePointer(event)) {
          onSeek(dragMsRef.current);
        }
      },
      [onSeek, releasePointer],
    );

  /*
   * A cancelled gesture (palm rejection, an OS edge swipe, the browser
   * taking the pointer for its own scroll) restores the old playhead
   * rather than seeking to wherever the finger happened to be.
   */
  const handlePointerCancel: (
    event: React.PointerEvent<HTMLDivElement>,
  ) => void = useCallback(
    (event: React.PointerEvent<HTMLDivElement>): void => {
      releasePointer(event);
      updateHover(null);
    },
    [releasePointer, updateHover],
  );

  const handlePointerLeave: () => void = useCallback((): void => {
    updateHover(null);
  }, [updateHover]);

  /*
   * Notice markers sit INSIDE the slider track, so without this a click on
   * one would start the track's own gesture on pointerdown, commit a seek
   * to the cursor on pointerup, and then seek AGAIN to marker - 1s on
   * click: two seeks (each a possible Replayer rebuild) for one press. The
   * button owns its pointer; the track never sees it.
   */
  const stopTrackGesture: (
    event: React.PointerEvent<HTMLButtonElement>,
  ) => void = useCallback(
    (event: React.PointerEvent<HTMLButtonElement>): void => {
      event.stopPropagation();
    },
    [],
  );

  /*
   * The WAI-ARIA slider keys, on the element itself, so they work whenever
   * the track has focus - including while the page-level shortcuts are
   * off. stopPropagation keeps the window listener from seeing the same
   * key and seeking twice.
   */
  const handleKeyDown: (event: React.KeyboardEvent<HTMLDivElement>) => void =
    useCallback(
      (event: React.KeyboardEvent<HTMLDivElement>): void => {
        const action: ReplaySliderKeyAction | null = resolveReplaySliderKey({
          key: event.key,
          shiftKey: event.shiftKey,
          altKey: event.altKey,
          ctrlKey: event.ctrlKey,
          metaKey: event.metaKey,
        });

        if (!action) {
          return;
        }

        event.preventDefault();
        event.stopPropagation();

        if (action.type === "seek-start") {
          onSeek(0);
        } else if (action.type === "seek-end") {
          onSeek(Math.max(0, durationMs));
        } else {
          onSeek(nudgeOffset(currentTimeMs, action.deltaMs, durationMs));
        }
      },
      [onSeek, currentTimeMs, durationMs],
    );

  const handleMarkerActivate: (marker: ReplayTimelineMarker) => void =
    useCallback(
      (marker: ReplayTimelineMarker): void => {
        /*
         * Land a second early so the viewer sees the cause, and select the
         * row in the rail so the two surfaces agree on what was clicked.
         */
        onSeek(markerSeekTarget(marker));

        if (marker.signalId && onSelectSignal) {
          onSelectSignal(marker.signalId);
        }
      },
      [onSeek, onSelectSignal],
    );

  const trackMarkers: Array<ReplayTimelineMarker> = useMemo(() => {
    return getMarkersForLane(props.markers, "track");
  }, [props.markers]);

  const preview: ReplayTimelinePreview | null = useMemo(() => {
    if (hoverMs === null) {
      return null;
    }

    return buildHoverPreview(props.signals || [], hoverMs);
  }, [hoverMs, props.signals]);

  const isActivityMeasured: boolean = Boolean(
    props.activity &&
      props.activity.some((bucket: ReplayActivityBucket) => {
        return bucket.isMeasured;
      }),
  );

  /*
   * While a drag is in progress the playhead follows the pointer even
   * though the player has not been told to seek yet, so the gesture feels
   * direct without costing a rebuild per pixel.
   */
  const playheadMs: number = dragMs ?? currentTimeMs;
  const playheadPercent: number = offsetToPercent(playheadMs, durationMs);
  const hoverPercent: number =
    hoverMs === null ? 0 : offsetToPercent(hoverMs, durationMs);
  const ghostPercent: number | null =
    props.ghostMs === null || props.ghostMs === undefined
      ? null
      : offsetToPercent(props.ghostMs, durationMs);
  const hoverWallClock: string | null =
    hoverMs === null
      ? null
      : formatReplayWallClock(props.startTimeUnixMs, hoverMs);

  return (
    <div data-testid="replay-timeline">
      {/* Activity strip: relative event density per chunk. */}
      {isActivityMeasured && props.activity && (
        <div className="mb-1 flex items-center gap-2">
          <div className={LANE_LABEL_CLASS}>Activity</div>
          <div
            data-testid="timeline-activity"
            aria-hidden="true"
            className="relative h-1.5 flex-1 overflow-hidden rounded-sm bg-gray-50"
          >
            {props.activity.map(
              (bucket: ReplayActivityBucket): ReactElement => {
                const left: number = offsetToPercent(
                  bucket.startMs,
                  durationMs,
                );
                const width: number = Math.max(
                  0.2,
                  offsetToPercent(bucket.endMs, durationMs) - left,
                );

                return (
                  <div
                    key={`activity-${bucket.chunkIndex}`}
                    className="absolute inset-y-0 bg-indigo-500"
                    style={{
                      left: `${left}%`,
                      width: `${width}%`,
                      opacity: 0.15 + 0.85 * bucket.intensity,
                    }}
                  />
                );
              },
            )}
          </div>
        </div>
      )}

      {/* The seekable track. */}
      <div className="flex items-center gap-2">
        <div className={LANE_LABEL_CLASS}>Recording</div>
        <div className="relative flex-1">
          {hoverMs !== null && dragMs === null && (
            <div
              className="pointer-events-none absolute bottom-full z-10 mb-1.5 flex flex-col items-start gap-1"
              style={{
                left: `${hoverPercent}%`,
                transform: edgeAwareTransform(hoverPercent),
              }}
            >
              {preview && (preview.route || preview.signals.length > 0) && (
                <div
                  data-testid="timeline-hover-preview"
                  className="max-w-[18rem] rounded-md border border-gray-200 bg-white px-2 py-1.5 text-[11px] text-gray-700 shadow-md"
                >
                  {preview.route && (
                    <div className="truncate font-medium text-gray-900">
                      {preview.route}
                    </div>
                  )}
                  {preview.signals.map((signal: ReplaySignal): ReactElement => {
                    return (
                      <div
                        key={signal.id}
                        data-testid="timeline-hover-preview-signal"
                        className="flex items-center gap-1.5 truncate"
                      >
                        <span className="font-mono tabular-nums text-gray-500">
                          {formatReplayOffset(signal.offsetMs)}
                        </span>
                        <span className="truncate">{signal.title}</span>
                      </div>
                    );
                  })}
                </div>
              )}
              <div
                data-testid="timeline-hover-time"
                className="rounded bg-gray-900 px-1.5 py-0.5 font-mono text-[11px] tabular-nums text-white shadow"
              >
                {formatReplayOffsetPrecise(hoverMs)}
                {hoverWallClock && (
                  <span className="ml-1.5 text-gray-300">{hoverWallClock}</span>
                )}
              </div>
            </div>
          )}

          <div
            ref={trackRef}
            data-testid="timeline-track"
            role="slider"
            tabIndex={0}
            aria-label="Replay position"
            aria-valuemin={0}
            aria-valuemax={Math.round(Math.max(0, durationMs))}
            aria-valuenow={Math.round(playheadMs)}
            aria-valuetext={`${formatReplayOffset(playheadMs)} of ${formatReplayOffset(
              durationMs,
            )}`}
            className="relative h-6 w-full cursor-pointer touch-none rounded bg-gray-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            onPointerCancel={handlePointerCancel}
            onPointerLeave={handlePointerLeave}
            onKeyDown={handleKeyDown}
          >
            {props.bands.map(
              (band: ReplayTrackBand, index: number): ReactElement => {
                return (
                  <TrackBand
                    key={`band-${band.kind}-${index}`}
                    band={band}
                    durationMs={durationMs}
                  />
                );
              },
            )}

            {/*
             * Notice markers: a fidelity notice that says a stretch is
             * unplayable, pinned to WHERE (finding 15), drawn as a small
             * triangle on the top edge of the track.
             */}
            {trackMarkers.map((marker: ReplayTimelineMarker): ReactElement => {
              return (
                <button
                  key={marker.id}
                  type="button"
                  data-testid="timeline-notice-marker"
                  title={marker.title}
                  aria-label={marker.title}
                  className="absolute top-0 z-10 h-2.5 w-3 -translate-x-1/2 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
                  style={{
                    left: `${offsetToPercent(marker.offsetMs, durationMs)}%`,
                  }}
                  onPointerDown={stopTrackGesture}
                  onPointerUp={stopTrackGesture}
                  onClick={(): void => {
                    handleMarkerActivate(marker);
                  }}
                >
                  <span
                    aria-hidden="true"
                    className="block h-0 w-0 border-l-[6px] border-r-[6px] border-t-[8px] border-l-transparent border-r-transparent border-t-amber-500"
                  />
                </button>
              );
            })}

            {hoverMs !== null && (
              <div
                data-testid="timeline-hover-guide"
                aria-hidden="true"
                className="pointer-events-none absolute inset-y-0 w-px bg-gray-500"
                style={{ left: `${hoverPercent}%` }}
              />
            )}

            {ghostPercent !== null && (
              <div
                data-testid="timeline-ghost-playhead"
                aria-hidden="true"
                className="pointer-events-none absolute inset-y-0 w-0.5 border-l-2 border-dashed border-indigo-400"
                style={{ left: `${ghostPercent}%` }}
              />
            )}

            <div
              data-testid="timeline-playhead"
              aria-hidden="true"
              className="pointer-events-none absolute inset-y-0 w-0.5 bg-gray-900"
              style={{ left: `${playheadPercent}%` }}
            >
              <span className="absolute left-1/2 top-1/2 h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-gray-900 ring-2 ring-white" />
            </div>
          </div>
        </div>
      </div>

      <div className="mt-1.5 space-y-1">
        {REPLAY_TIMELINE_LANES.map((lane: ReplayTimelineLane): ReactElement => {
          return (
            <MarkerLane
              key={lane}
              lane={lane}
              markers={getMarkersForLane(props.markers, lane)}
              durationMs={durationMs}
              widthPx={widthPx}
              selectedSignalId={props.selectedSignalId || null}
              onActivate={handleMarkerActivate}
            />
          );
        })}
      </div>

      {/*
       * The legend is rendered unconditionally: showing anything only while
       * hovering shifted every lane by a line the moment the pointer entered
       * the track, which made the thing you were aiming at move.
       */}
      <div className="mt-2 flex h-4 flex-wrap items-center gap-3 text-[11px] text-gray-500">
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
        <span className="inline-flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-sm bg-gray-200" />
          Idle
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-sm border border-dotted border-gray-400 bg-gray-100" />
          Tab in background
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-sm bg-white ring-1 ring-inset ring-gray-400" />
          Approximate
        </span>
      </div>
    </div>
  );
};

export default ReplayTimeline;
