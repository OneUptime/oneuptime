import Tooltip from "../Tooltip/Tooltip";
import {
  CLUSTER_ZOOM_PADDING_RATIO,
  DEFAULT_BAND_WIDTH_PX,
  getNextStatusTimelineMarkIndex,
  getStatusTimelineContinuationMask,
  getStatusTimelineTicks,
  getStatusTimelineZoomWindow,
  getVisibleStatusTimelineTickIndexes,
  ResolvedStatusTimelineEntry,
  StatusTimelineBandGap,
  StatusTimelineBandLayout,
  StatusTimelineBandMark,
  StatusTimelineGapKind,
  StatusTimelineTick,
  StatusTimelineWindow,
} from "./StatusTimelineLayout";
import {
  formatStatusTimelineDateRange,
  formatStatusTimelineRange,
  formatStatusTimelineShortDate,
  formatStatusTimelineShortDateTime,
  formatStatusTimelineTickLabel,
  StatusTimelineClock,
} from "./StatusTimelineTime";
import { formatDurationInSeconds } from "../../Utils/UseLiveDuration";
import { Translator, translationKey } from "../../Utils/TranslateTemplate";
import useTranslator from "../../Utils/UseTranslator";
import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";

/*
 * The band: time along one axis, every status a segment whose place and
 * length are when it began and how long it lasted (StatusTimelineLayout).
 *
 * Every mark is a button, so the band is not mouse-only: it is one tab stop
 * (a roving tabindex), the arrow keys move along it, Home and End go to its
 * ends, and each mark says what it is - "Offline, Oct 9, 07:26 – 07:27, 38
 * secs". Choosing an entry shows it in the list under the band; choosing a
 * cluster of short entries zooms the band to them. With a mouse, dragging
 * across the band zooms to the stretch dragged over.
 */

// A stretch with no status says what it is in words from this wide (px).
const GAP_LABEL_MIN_WIDTH_PX: number = 180;

// A drag shorter than this, in CSS pixels, is a click, not a zoom.
export const DRAG_TO_ZOOM_THRESHOLD_PX: number = 6;

export interface ComponentProps {
  layout: StatusTimelineBandLayout;
  entriesById: Map<string, ResolvedStatusTimelineEntry>;
  window: StatusTimelineWindow;
  now: Date;
  clock: StatusTimelineClock;
  // The window ends at now: the axis says "Now" at its right end.
  isAtNow: boolean;
  // The entry chosen (in the band or the list), and the one pointed at.
  selectedEntryId: string | null;
  highlightedEntryId: string | null;
  // The band's measured width, reported so the layout fits it.
  onWidthChange: (widthPx: number) => void;
  widthPx: number;
  /*
   * An entry was chosen. `byKeyboard` when it was chosen with Enter or
   * Space, so focus can follow it to the list.
   */
  onSelectEntry: (entryId: string, byKeyboard: boolean) => void;
  onHighlightEntry: (entryId: string | null) => void;
  // Zoom to a stretch of time: a cluster, or a drag across the band.
  onZoom?: ((window: StatusTimelineWindow) => void) | undefined;
  ariaLabel: string;
  // What the band says over the time whose changes are not loaded.
  notLoadedLabel?: string | undefined;
  // Load them, from where the band says they are missing.
  onLoadOlder?: (() => void) | undefined;
  isLoadingOlder?: boolean | undefined;
}

// Where a mark's own words come from: one entry, or several.
const getMarkLabel: (data: {
  mark: StatusTimelineBandMark;
  entry: ResolvedStatusTimelineEntry | undefined;
  clock: StatusTimelineClock;
  translator: Translator;
}) => string = (data: {
  mark: StatusTimelineBandMark;
  entry: ResolvedStatusTimelineEntry | undefined;
  clock: StatusTimelineClock;
  translator: Translator;
}): string => {
  const { mark, entry, clock, translator } = data;

  if (mark.isCluster) {
    return translator.translateTemplate(
      "{{count}} changes from {{start}} to {{end}}. Zoom in to see them.",
      {
        count: mark.entryIds.length.toString(),
        ...formatStatusTimelineDateRange({
          startsAt: mark.start,
          endsAt: mark.end,
          clock: clock,
        }),
      },
    );
  }

  if (!entry) {
    return "";
  }

  const duration: string = formatDurationInSeconds(
    Math.floor(
      ((entry.listEnd ? entry.listEnd.getTime() : clock.now.getTime()) -
        entry.startsAt.getTime()) /
        1000,
    ),
  );

  if (!entry.listEnd) {
    return translator.translateTemplate(
      "{{status}}, since {{start}}, {{duration}} so far. Currently Active.",
      {
        status: entry.name,
        start: formatStatusTimelineShortDateTime(entry.startsAt, clock),
        duration: duration,
      },
    );
  }

  return translator.translateTemplate(
    "{{status}}, {{start}} – {{end}}, {{duration}}",
    {
      status: entry.name,
      ...formatStatusTimelineDateRange({
        startsAt: entry.startsAt,
        endsAt: entry.listEnd,
        clock: clock,
      }),
      duration: duration,
    },
  );
};

const MarkTooltipContent: FunctionComponent<{
  mark: StatusTimelineBandMark;
  entry: ResolvedStatusTimelineEntry | undefined;
  clock: StatusTimelineClock;
}> = (props: {
  mark: StatusTimelineBandMark;
  entry: ResolvedStatusTimelineEntry | undefined;
  clock: StatusTimelineClock;
}): ReactElement => {
  const translator: Translator = useTranslator();

  if (props.mark.isCluster || !props.entry) {
    return (
      <div className="max-w-[16rem] p-1 text-left text-xs text-gray-700">
        <div className="flex items-center gap-2">
          <span
            className="inline-block h-2.5 w-2.5 shrink-0 rounded-full"
            style={{ backgroundColor: props.mark.color }}
            aria-hidden="true"
          ></span>
          <span className="font-semibold text-gray-900">
            {translator.translatePlural(
              {
                one: "{{count}} change",
                other: "{{count}} changes",
              },
              props.mark.entryIds.length,
            )}
          </span>
        </div>
        <div className="mt-1 font-medium tabular-nums text-gray-700">
          {translator.translateTemplate(
            "{{start}} – {{end}}",
            formatStatusTimelineDateRange({
              startsAt: props.mark.start,
              endsAt: props.mark.end,
              clock: props.clock,
            }),
          )}
        </div>
        <div className="text-gray-500">
          {translator.translateText(
            "Too close together to tell apart here. Click to zoom in.",
          )}
        </div>
      </div>
    );
  }

  const entry: ResolvedStatusTimelineEntry = props.entry;
  const end: Date = entry.listEnd || props.clock.now;
  const duration: string = formatDurationInSeconds(
    Math.floor((end.getTime() - entry.startsAt.getTime()) / 1000),
  );
  const range: { start: string; end: string } | null = entry.listEnd
    ? formatStatusTimelineRange({
        startsAt: entry.startsAt,
        endsAt: entry.listEnd,
        clock: props.clock,
      })
    : null;

  return (
    <div className="max-w-[16rem] p-1 text-left text-xs text-gray-700">
      <div className="flex items-center gap-2">
        <span
          className="inline-block h-2.5 w-2.5 shrink-0 rounded-full"
          style={{ backgroundColor: entry.color }}
          aria-hidden="true"
        ></span>
        <span className="truncate font-semibold text-gray-900">
          {entry.name}
        </span>
      </div>
      <div className="mt-1 font-medium tabular-nums text-gray-700">
        {range
          ? translator.translateTemplate("{{day}}, {{start}} – {{end}}", {
              day: formatStatusTimelineShortDate(entry.startsAt, props.clock),
              start: range.start,
              end: range.end,
            })
          : translator.translateTemplate("Since {{start}}", {
              start: formatStatusTimelineShortDateTime(
                entry.startsAt,
                props.clock,
              ),
            })}
      </div>
      <div className="tabular-nums text-gray-500">
        {entry.listEnd
          ? duration
          : translator.translateTemplate("{{duration}} so far", {
              duration: duration,
            })}
      </div>
    </div>
  );
};

/*
 * The band's own corners are rounded; what is drawn at its ends rounds its
 * outer corners to match (the band does not clip what it holds).
 */
const getEdgeRounding: (left: number, width: number) => string = (
  left: number,
  width: number,
): string => {
  const touchesStart: boolean = left <= 0.01;
  const touchesEnd: boolean = left + width >= 99.99;

  if (touchesStart && touchesEnd) {
    return "rounded-md";
  }

  if (touchesStart) {
    return "rounded-l-md";
  }

  if (touchesEnd) {
    return "rounded-r-md";
  }

  return "";
};

const getContinuationMaskStyle: (data: {
  mark: StatusTimelineBandMark;
  widthPx: number;
}) => React.CSSProperties = (data: {
  mark: StatusTimelineBandMark;
  widthPx: number;
}): React.CSSProperties => {
  const mask: string | null = getStatusTimelineContinuationMask({
    continuesBefore: data.mark.continuesBefore && !data.mark.isWidened,
    continuesAfter: data.mark.continuesAfter && !data.mark.isWidened,
    widthPx: (data.mark.width / 100) * data.widthPx,
  });

  return mask ? { maskImage: mask, WebkitMaskImage: mask } : {};
};

const GAP_TEXT: Record<StatusTimelineGapKind, string> = {
  [StatusTimelineGapKind.NoData]: translationKey("No status recorded"),
  [StatusTimelineGapKind.NotLoaded]: translationKey("Older changes not loaded"),
  [StatusTimelineGapKind.Future]: translationKey("Not happened yet"),
};

const StatusTimelineBand: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const bandRef: React.MutableRefObject<HTMLDivElement | null> =
    useRef<HTMLDivElement | null>(null);
  const markRefs: React.MutableRefObject<Array<HTMLButtonElement | null>> =
    useRef<Array<HTMLButtonElement | null>>([]);

  const marks: Array<StatusTimelineBandMark> = props.layout.marks;

  /*
   * Until it has been measured (the first paint), the band is the width the
   * layout assumed: labels and fades are judged at that width too.
   */
  const widthPx: number =
    props.widthPx > 0 ? props.widthPx : DEFAULT_BAND_WIDTH_PX;

  // The band's width, so the layout knows how wide a pixel of time is.
  useLayoutEffect(() => {
    const element: HTMLDivElement | null = bandRef.current;

    if (!element) {
      return;
    }

    const report: () => void = (): void => {
      const width: number = element.getBoundingClientRect().width;

      if (width > 0) {
        props.onWidthChange(Math.round(width));
      }
    };

    report();

    if (typeof ResizeObserver === "undefined") {
      return;
    }

    const observer: ResizeObserver = new ResizeObserver(() => {
      report();
    });

    observer.observe(element);

    return () => {
      observer.disconnect();
    };
  }, []);

  /*
   * The mark that holds the band's one tab stop: the chosen entry's, else
   * the newest (the right end, where a reader looks first).
   */
  const selectedIndex: number = props.selectedEntryId
    ? marks.findIndex((mark: StatusTimelineBandMark): boolean => {
        return mark.entryIds.includes(props.selectedEntryId!);
      })
    : -1;
  const [focusIndex, setFocusIndex] = useState<number | null>(null);
  const activeIndex: number =
    focusIndex !== null && focusIndex < marks.length
      ? focusIndex
      : selectedIndex >= 0
        ? selectedIndex
        : marks.length - 1;

  useEffect(() => {
    if (focusIndex !== null && focusIndex >= marks.length) {
      setFocusIndex(null);
    }
  }, [marks.length]);

  // ---- drag to zoom ------------------------------------------------------
  const dragRef: React.MutableRefObject<{
    pointerId: number;
    startX: number;
    currentX: number;
    isDragging: boolean;
  } | null> = useRef<{
    pointerId: number;
    startX: number;
    currentX: number;
    isDragging: boolean;
  } | null>(null);
  const suppressClickRef: React.MutableRefObject<boolean> =
    useRef<boolean>(false);
  const [dragBox, setDragBox] = useState<{
    left: number;
    width: number;
  } | null>(null);

  const getBandX: (clientX: number) => number = (clientX: number): number => {
    const rect: DOMRect | undefined = bandRef.current?.getBoundingClientRect();

    if (!rect || rect.width <= 0) {
      return 0;
    }

    return Math.min(Math.max(clientX - rect.left, 0), rect.width);
  };

  const onPointerDown: (event: React.PointerEvent<HTMLDivElement>) => void = (
    event: React.PointerEvent<HTMLDivElement>,
  ): void => {
    // A finger scrolls the page; a mouse or a pen can drag to zoom.
    if (!props.onZoom || event.pointerType === "touch" || event.button !== 0) {
      return;
    }

    const x: number = getBandX(event.clientX);
    dragRef.current = {
      pointerId: event.pointerId,
      startX: x,
      currentX: x,
      isDragging: false,
    };
  };

  const onPointerMove: (event: React.PointerEvent<HTMLDivElement>) => void = (
    event: React.PointerEvent<HTMLDivElement>,
  ): void => {
    const drag: {
      pointerId: number;
      startX: number;
      currentX: number;
      isDragging: boolean;
    } | null = dragRef.current;

    if (!drag || drag.pointerId !== event.pointerId) {
      return;
    }

    // The button was let go outside the window: abandon the drag.
    if (event.buttons === 0) {
      dragRef.current = null;
      setDragBox(null);
      return;
    }

    drag.currentX = getBandX(event.clientX);

    if (
      !drag.isDragging &&
      Math.abs(drag.currentX - drag.startX) >= DRAG_TO_ZOOM_THRESHOLD_PX
    ) {
      drag.isDragging = true;

      try {
        bandRef.current?.setPointerCapture(event.pointerId);
      } catch {
        // A pointer that is already gone cannot be captured; the drag goes on.
      }
    }

    if (drag.isDragging) {
      const width: number = bandRef.current?.getBoundingClientRect().width || 1;
      const from: number = Math.min(drag.startX, drag.currentX);
      const to: number = Math.max(drag.startX, drag.currentX);

      setDragBox({
        left: (from / width) * 100,
        width: ((to - from) / width) * 100,
      });
    }
  };

  const onPointerUp: (event: React.PointerEvent<HTMLDivElement>) => void = (
    event: React.PointerEvent<HTMLDivElement>,
  ): void => {
    const drag: {
      pointerId: number;
      startX: number;
      currentX: number;
      isDragging: boolean;
    } | null = dragRef.current;

    dragRef.current = null;

    if (!drag || drag.pointerId !== event.pointerId) {
      return;
    }

    setDragBox(null);

    if (!drag.isDragging || !props.onZoom) {
      return;
    }

    // The click that ends a drag is not a choice of the mark under it.
    suppressClickRef.current = true;
    window.setTimeout(() => {
      suppressClickRef.current = false;
    }, 0);

    const width: number = bandRef.current?.getBoundingClientRect().width || 1;
    const span: number =
      props.window.end.getTime() - props.window.start.getTime();
    const from: number = Math.min(drag.startX, drag.currentX) / width;
    const to: number = Math.max(drag.startX, drag.currentX) / width;

    props.onZoom({
      start: new Date(props.window.start.getTime() + from * span),
      end: new Date(props.window.start.getTime() + to * span),
    });
  };

  // ---- keyboard ----------------------------------------------------------
  const onMarkKeyDown: (event: React.KeyboardEvent, index: number) => void = (
    event: React.KeyboardEvent,
    index: number,
  ): void => {
    if (event.key === "Escape" && props.selectedEntryId) {
      event.preventDefault();
      props.onSelectEntry("", false);
      return;
    }

    const next: number | null = getNextStatusTimelineMarkIndex({
      key: event.key,
      currentIndex: index,
      markCount: marks.length,
    });

    if (next === null) {
      return;
    }

    event.preventDefault();
    setFocusIndex(next);
    markRefs.current[next]?.focus();
  };

  const chooseMark: (
    mark: StatusTimelineBandMark,
    byKeyboard: boolean,
  ) => void = (mark: StatusTimelineBandMark, byKeyboard: boolean): void => {
    if (suppressClickRef.current) {
      return;
    }

    if (mark.isCluster) {
      if (props.onZoom) {
        props.onZoom(
          getStatusTimelineZoomWindow({
            start: mark.start,
            end: mark.end,
            now: props.now,
            paddingRatio: CLUSTER_ZOOM_PADDING_RATIO,
          }),
        );
      }
      return;
    }

    const entryId: string | undefined = mark.entryIds[0];

    if (entryId) {
      props.onSelectEntry(entryId, byKeyboard);
    }
  };

  /*
   * ---- the axis ----------------------------------------------------------
   * Where the band begins, so the first tick is never the reader's only bearing.
   */
  const isShortWindow: boolean =
    props.window.end.getTime() - props.window.start.getTime() <
    24 * 60 * 60 * 1000;
  const startLabel: string = isShortWindow
    ? formatStatusTimelineShortDateTime(props.window.start, props.clock)
    : formatStatusTimelineShortDate(props.window.start, props.clock);
  const nowLabel: string = translator.translateText("Now") || "Now";

  // The ticks whose labels fit between the two ends' and each other.
  const allTicks: Array<StatusTimelineTick> = getStatusTimelineTicks({
    window: props.window,
    widthPx: widthPx,
    timezone: props.clock.timezone,
  });
  const tickLabels: Array<string> = allTicks.map(
    (tick: StatusTimelineTick): string => {
      return formatStatusTimelineTickLabel(tick, props.clock);
    },
  );
  const ticks: Array<{ tick: StatusTimelineTick; label: string }> =
    getVisibleStatusTimelineTickIndexes({
      ticks: allTicks.map((tick: StatusTimelineTick, index: number) => {
        return { left: tick.left, label: tickLabels[index] || "" };
      }),
      widthPx: widthPx,
      startLabel: startLabel,
      endLabel: props.isAtNow ? nowLabel : undefined,
    }).map((index: number) => {
      return { tick: allTicks[index]!, label: tickLabels[index] || "" };
    });

  const focusedEntryIds: Array<string> = [
    props.selectedEntryId || "",
    props.highlightedEntryId || "",
  ].filter(Boolean);

  const isDimmingOthers: boolean = focusedEntryIds.length > 0;

  /*
   * Left to right in every language: time runs left to right along the
   * band, as it does along every chart's axis, and its marks are placed by
   * their share of the window from the left. On a right-to-left page the
   * axis's "Now" and its first date would otherwise swap ends while the
   * marks stayed put.
   */
  return (
    <div data-testid="status-timeline-band-area" dir="ltr">
      <div
        ref={bandRef}
        role="group"
        aria-label={props.ariaLabel}
        data-testid="status-timeline-band"
        data-width={props.widthPx}
        /*
         * Not overflow-hidden: a focused mark's ring is drawn outside it,
         * above and below the band. The marks at the band's ends round
         * their own outer corners instead (getEdgeRounding).
         */
        className="relative h-9 w-full touch-pan-y select-none rounded-md bg-gray-100"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={() => {
          dragRef.current = null;
          setDragBox(null);
        }}
        onPointerLeave={() => {
          props.onHighlightEntry(null);
        }}
      >
        {props.layout.gaps.map((gap: StatusTimelineBandGap): ReactElement => {
          const text: string =
            gap.kind === StatusTimelineGapKind.NotLoaded && props.notLoadedLabel
              ? props.notLoadedLabel
              : translator.translateText(GAP_TEXT[gap.kind]) ||
                GAP_TEXT[gap.kind];
          const gapWidthPx: number = (gap.width / 100) * widthPx;

          /*
           * Time with no status is the band's own empty track, finely
           * striped so it never reads as a status, and saying in words
           * what it is where there is room for them.
           */
          return (
            <Tooltip key={gap.key} text={text} lazy={true} interactive={false}>
              <div
                data-testid="status-timeline-gap"
                data-kind={gap.kind}
                className={`absolute inset-y-0 flex items-center justify-center overflow-hidden ${getEdgeRounding(
                  gap.left,
                  gap.width,
                )}`}
                style={{
                  left: `${gap.left}%`,
                  width: `${gap.width}%`,
                  backgroundImage:
                    gap.kind === StatusTimelineGapKind.Future
                      ? undefined
                      : "repeating-linear-gradient(135deg, rgba(156, 163, 175, 0.28) 0, rgba(156, 163, 175, 0.28) 1px, transparent 1px, transparent 6px)",
                }}
              >
                {gapWidthPx >= GAP_LABEL_MIN_WIDTH_PX &&
                  gap.kind !== StatusTimelineGapKind.Future && (
                    <span
                      className="flex min-w-0 items-center gap-2 px-2 text-xs text-gray-600"
                      data-testid="status-timeline-gap-label"
                    >
                      <span className="truncate">{text}</span>
                      {gap.kind === StatusTimelineGapKind.NotLoaded &&
                        props.onLoadOlder && (
                          <button
                            type="button"
                            className="shrink-0 rounded font-medium text-indigo-600 hover:text-indigo-800 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
                            data-testid="status-timeline-gap-load-older"
                            disabled={props.isLoadingOlder}
                            onPointerDown={(event: React.PointerEvent) => {
                              // A press here is not the start of a drag.
                              event.stopPropagation();
                            }}
                            onClick={props.onLoadOlder}
                          >
                            {props.isLoadingOlder
                              ? translator.translateText("Loading…")
                              : translator.translateText("Load")}
                          </button>
                        )}
                    </span>
                  )}
              </div>
            </Tooltip>
          );
        })}
        {marks.map((mark: StatusTimelineBandMark, index: number) => {
          const entry: ResolvedStatusTimelineEntry | undefined = mark.isCluster
            ? undefined
            : props.entriesById.get(mark.entryIds[0] || "");
          const label: string = getMarkLabel({
            mark,
            entry,
            clock: props.clock,
            translator,
          });
          const isFocused: boolean = mark.entryIds.some(
            (id: string): boolean => {
              return focusedEntryIds.includes(id);
            },
          );
          const isSelected: boolean = Boolean(
            props.selectedEntryId &&
              mark.entryIds.includes(props.selectedEntryId),
          );

          return (
            <Tooltip
              key={mark.key}
              lazy={true}
              interactive={false}
              isTriggerAlreadyDescribed={true}
              richContent={
                <MarkTooltipContent
                  mark={mark}
                  entry={entry}
                  clock={props.clock}
                />
              }
            >
              <button
                ref={(element: HTMLButtonElement | null) => {
                  markRefs.current[index] = element;
                }}
                type="button"
                tabIndex={index === activeIndex ? 0 : -1}
                aria-label={label}
                aria-pressed={mark.isCluster ? undefined : isSelected}
                data-testid={
                  mark.isCluster
                    ? "status-timeline-cluster"
                    : "status-timeline-segment"
                }
                data-entry-ids={mark.entryIds.join(",")}
                data-ongoing={mark.isOngoing ? "true" : "false"}
                data-widened={mark.isWidened ? "true" : "false"}
                className={`absolute inset-y-0 cursor-pointer transition-opacity duration-150 focus:outline-none focus-visible:z-30 focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2 ${getEdgeRounding(
                  mark.left,
                  mark.width,
                )} ${mark.isWidened ? "z-10" : ""} ${
                  isSelected ? "z-20" : ""
                } ${
                  isDimmingOthers && !isFocused ? "opacity-40" : "opacity-100"
                }`}
                style={{
                  left: `${mark.left}%`,
                  width: `${mark.width}%`,
                  backgroundColor: mark.color,
                  backgroundImage: mark.isCluster
                    ? "repeating-linear-gradient(90deg, rgba(255, 255, 255, 0.45) 0, rgba(255, 255, 255, 0.45) 1px, transparent 1px, transparent 3px)"
                    : undefined,
                  /*
                   * A blip's edges stay crisp against the colour around it:
                   * a hairline in the card's own colour, in either theme.
                   */
                  boxShadow: mark.isWidened
                    ? "0 0 0 1px var(--ou-surface-primary, #ffffff)"
                    : undefined,
                  /*
                   * A status that began before the band does, or runs on
                   * past its end, fades out at that edge: it continues.
                   */
                  ...getContinuationMaskStyle({
                    mark: mark,
                    widthPx: widthPx,
                  }),
                }}
                onFocus={() => {
                  setFocusIndex(index);
                }}
                onMouseEnter={() => {
                  if (!mark.isCluster) {
                    props.onHighlightEntry(mark.entryIds[0] || null);
                  }
                }}
                onMouseLeave={() => {
                  props.onHighlightEntry(null);
                }}
                onKeyDown={(event: React.KeyboardEvent) => {
                  onMarkKeyDown(event, index);
                }}
                onClick={(event: React.MouseEvent<HTMLButtonElement>) => {
                  // detail is 0 for a click made with Enter or Space.
                  chooseMark(mark, event.detail === 0);
                }}
              >
                {mark.isWidened && (
                  /*
                   * A blip is drawn only a few pixels wide, too narrow to
                   * aim at: a little either side of it answers a click
                   * too. It is drawn above its neighbours (z-10), so there
                   * the blip, not the long status beside it, is chosen.
                   */
                  <span
                    aria-hidden="true"
                    data-testid="status-timeline-mark-hit-area"
                    className="absolute inset-y-0 -left-1.5 -right-1.5"
                  ></span>
                )}
              </button>
            </Tooltip>
          );
        })}
        {dragBox && (
          <div
            data-testid="status-timeline-drag-box"
            aria-hidden="true"
            className="pointer-events-none absolute inset-y-0 z-30 border-x-2 border-indigo-500"
            style={{
              left: `${dragBox.left}%`,
              width: `${dragBox.width}%`,
              backgroundColor: "rgba(99, 102, 241, 0.2)",
            }}
          ></div>
        )}
      </div>
      {/* Under the chosen entry: a bar marking it, as the list does. */}
      <div className="relative h-1" aria-hidden="true">
        {selectedIndex >= 0 && marks[selectedIndex] && (
          <div
            data-testid="status-timeline-selection"
            className="absolute top-0.5 h-0.5 rounded-full bg-gray-900"
            style={{
              left: `${marks[selectedIndex]!.left}%`,
              width: `max(${marks[selectedIndex]!.width}%, 4px)`,
            }}
          ></div>
        )}
      </div>
      <div
        className="relative mt-0.5 h-4 text-xs text-gray-500"
        aria-hidden="true"
        data-testid="status-timeline-axis"
      >
        {ticks.map(
          (shown: {
            tick: StatusTimelineTick;
            label: string;
          }): ReactElement => {
            return (
              <span
                key={shown.tick.at.getTime()}
                data-testid="status-timeline-tick"
                className={`absolute top-0 -translate-x-1/2 whitespace-nowrap tabular-nums ${
                  shown.tick.isDayStart ? "font-medium text-gray-700" : ""
                }`}
                style={{ left: `${shown.tick.left}%` }}
              >
                {shown.label}
              </span>
            );
          },
        )}
        <span
          data-testid="status-timeline-start"
          className="absolute left-0 top-0 whitespace-nowrap tabular-nums"
        >
          {startLabel}
        </span>
        {props.isAtNow && (
          <span
            data-testid="status-timeline-now"
            className="absolute right-0 top-0 whitespace-nowrap font-medium text-gray-700"
          >
            {nowLabel}
          </span>
        )}
      </div>
    </div>
  );
};

export default StatusTimelineBand;
