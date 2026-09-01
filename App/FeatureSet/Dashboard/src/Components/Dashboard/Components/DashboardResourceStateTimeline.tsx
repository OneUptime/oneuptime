import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import Route from "Common/Types/API/Route";
import Navigation from "Common/UI/Utils/Navigation";
import getHoverCardPosition, {
  HoverCardPosition,
  HoverCardTriggerRect,
} from "../Utils/HoverCardPosition";

/*
 * A Grafana / Zabbix style "state timeline": one lane per resource, and inside
 * each lane a run of coloured bars showing which state it was in, and for how
 * long, across the dashboard's selected time range.
 *
 * Everything here is positioned in PERCENTAGES supplied by the caller — the
 * component never measures itself. That is deliberate: the arithmetic that
 * decides where a bar starts and how wide it is is the part worth testing, so
 * it lives in a pure util (Common/Utils/Monitor/MonitorStateTimelineUtil), and
 * this file is left as presentation that renders identically at any width.
 */

export interface StateTimelineTooltipDetail {
  label: string;
  value: string;
}

export interface StateTimelineSegment {
  /** Unique within its row. */
  id: string;
  /** Status name, shown in the hover card's header. */
  label: string;
  color: string;
  /** 0-100, left edge as a percentage of the visible range. */
  startPercent: number;
  /** 0-100, width as a percentage of the visible range. */
  widthPercent: number;
  tooltipDetails: Array<StateTimelineTooltipDetail>;
}

export interface StateTimelineRow {
  id: string;
  label: string;
  route?: Route | undefined;
  segments: Array<StateTimelineSegment>;
  /** Short text at the right of the lane, e.g. an uptime percentage. */
  trailingLabel?: string | undefined;
  /** Screen-reader summary of the whole lane. */
  ariaLabel: string;
}

export interface StateTimelineAxisTick {
  label: string;
  percent: number;
}

export interface StateTimelineLegendItem {
  label: string;
  color: string;
}

export interface DashboardResourceStateTimelineProps {
  rows: Array<StateTimelineRow>;
  axisTicks: Array<StateTimelineAxisTick>;
  legend?: Array<StateTimelineLegendItem> | undefined;
  /** Shown inside an otherwise-empty lane. */
  noDataLabel: string;
}

const TOOLTIP_WIDTH: number = 240;
const TOOLTIP_OFFSET: number = 8;
const LANE_HEIGHT_IN_PX: number = 18;

/*
 * A bar narrower than this is invisible and unhoverable, so a brief outage
 * inside a long window would vanish entirely — the single most important thing
 * this widget exists to show. Short segments are widened to it; they overlap
 * their neighbour by a hair rather than disappear.
 */
const MIN_SEGMENT_WIDTH_IN_PX: number = 2;

/*
 * Segments are absolutely positioned siblings, so without this the LAST one in
 * the lane paints over every earlier one it overlaps — which is exactly the
 * pixels the min-width above just bought a brief outage. Stacking them
 * narrowest-on-top makes the widening real for both painting and hit testing,
 * and it costs nothing when nothing overlaps. widthPercent is 0-100, so this
 * is always a non-negative integer and a wider bar can never outrank a
 * narrower one.
 */
type GetSegmentZIndexFunction = (widthPercent: number) => number;

const getSegmentZIndex: GetSegmentZIndexFunction = (
  widthPercent: number,
): number => {
  return Math.max(0, Math.round(100 - widthPercent));
};

interface TooltipState {
  rowLabel: string;
  segment: StateTimelineSegment;
  rect: HoverCardTriggerRect;
}

interface SegmentBarProps {
  rowLabel: string;
  segment: StateTimelineSegment;
  onHoverStart: (state: TooltipState) => void;
  onHoverEnd: () => void;
}

const SegmentBar: FunctionComponent<SegmentBarProps> = (
  props: SegmentBarProps,
): ReactElement => {
  const { rowLabel, segment, onHoverStart, onHoverEnd } = props;

  const ref: React.RefObject<HTMLDivElement> = useRef<HTMLDivElement>(null);

  const onMouseEnter: () => void = (): void => {
    if (!ref.current) {
      return;
    }

    const rect: DOMRect = ref.current.getBoundingClientRect();

    onHoverStart({
      rowLabel: rowLabel,
      segment: segment,
      rect: {
        left: rect.left,
        top: rect.top,
        width: rect.width,
        height: rect.height,
      },
    });
  };

  return (
    <div
      ref={ref}
      data-testid="state-timeline-segment"
      aria-hidden={true}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onHoverEnd}
      className="absolute top-0 bottom-0 transition-opacity duration-100 hover:opacity-80"
      style={{
        left: `${segment.startPercent}%`,
        width: `${segment.widthPercent}%`,
        minWidth: `${MIN_SEGMENT_WIDTH_IN_PX}px`,
        zIndex: getSegmentZIndex(segment.widthPercent),
        backgroundColor: segment.color,
      }}
    />
  );
};

const StateTimelineTooltip: FunctionComponent<{ state: TooltipState }> = ({
  state,
}: {
  state: TooltipState;
}): ReactElement => {
  const [position, setPosition] = useState<HoverCardPosition>({
    left: 0,
    top: 0,
    placement: "above",
  });

  const ref: React.RefObject<HTMLDivElement> = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    setPosition(
      getHoverCardPosition({
        rect: state.rect,
        cardWidth: TOOLTIP_WIDTH,
        // 100 is the first-pass guess, before the card has ever been laid out.
        cardHeight: ref.current?.offsetHeight || 100,
        viewportWidth: window.innerWidth,
        viewportHeight: window.innerHeight,
        offset: TOOLTIP_OFFSET,
      }),
    );
  }, [state.rect.left, state.rect.top, state.rect.width, state.rect.height]);

  return (
    <div
      ref={ref}
      role="tooltip"
      className="fixed z-50 pointer-events-none rounded-lg border border-gray-200 bg-white shadow-xl"
      style={{
        left: `${position.left}px`,
        top: `${position.top}px`,
        width: `${TOOLTIP_WIDTH}px`,
      }}
    >
      <div className="px-3 py-2 border-b border-gray-100 flex items-center gap-2">
        <span
          className="inline-block w-2.5 h-2.5 rounded-full flex-shrink-0"
          style={{ backgroundColor: state.segment.color }}
        ></span>
        <span className="text-xs font-semibold text-gray-800 truncate">
          {state.rowLabel}
        </span>
      </div>
      {state.segment.tooltipDetails.length > 0 && (
        <div className="px-3 py-2 space-y-1">
          {state.segment.tooltipDetails.map(
            (detail: StateTimelineTooltipDetail, index: number) => {
              return (
                <div
                  key={index}
                  className="flex items-center justify-between gap-2 text-xs"
                >
                  <span className="text-gray-400">{detail.label}</span>
                  <span className="font-medium text-gray-700 truncate">
                    {detail.value}
                  </span>
                </div>
              );
            },
          )}
        </div>
      )}
    </div>
  );
};

const DashboardResourceStateTimeline: FunctionComponent<
  DashboardResourceStateTimelineProps
> = (props: DashboardResourceStateTimelineProps): ReactElement => {
  const [tooltipState, setTooltipState] = useState<TooltipState | null>(null);

  const onHoverEnd: () => void = (): void => {
    setTooltipState(null);
  };

  /*
   * React dispatches no mouseleave for an element it unmounts, so a refresh
   * tick that drops the hovered bar (the window slid, an event fell out of
   * range) would otherwise leave its fixed-position card pinned to the screen
   * for good. Hovering is not cleared on every refresh — only when the bar
   * under the pointer is actually gone — so a card over a bar that survived
   * the refresh does not flicker.
   */
  useEffect(() => {
    setTooltipState((current: TooltipState | null): TooltipState | null => {
      if (!current) {
        return current;
      }

      const stillRendered: boolean = props.rows.some(
        (row: StateTimelineRow) => {
          return row.segments.some((segment: StateTimelineSegment) => {
            return segment.id === current.segment.id;
          });
        },
      );

      return stillRendered ? current : null;
    });
  }, [props.rows]);

  /*
   * Decided once for the whole widget, not per lane: if only the lanes that
   * HAVE a trailing label reserved room for one, a monitor with no history
   * would get a wider track than the monitor above it and the bars would stop
   * lining up down the column.
   */
  const hasTrailingLabels: boolean = props.rows.some(
    (row: StateTimelineRow) => {
      return row.trailingLabel !== undefined;
    },
  );

  type GetLaneFunction = (row: StateTimelineRow) => ReactElement;

  const getLane: GetLaneFunction = (row: StateTimelineRow): ReactElement => {
    const isClickable: boolean = Boolean(row.route);

    const onLabelClick: () => void = (): void => {
      if (row.route) {
        Navigation.navigate(row.route);
      }
    };

    return (
      <div
        key={row.id}
        data-testid="state-timeline-row"
        className="flex items-center gap-2 px-2 py-1 group"
      >
        <div
          className="flex-shrink-0 truncate text-xs text-gray-700"
          style={{ width: "34%", maxWidth: "180px", minWidth: "64px" }}
          title={row.label}
        >
          {isClickable ? (
            <span
              role="button"
              tabIndex={0}
              onClick={onLabelClick}
              onKeyDown={(event: React.KeyboardEvent) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  onLabelClick();
                }
              }}
              className="cursor-pointer hover:underline group-hover:text-blue-600"
            >
              {row.label}
            </span>
          ) : (
            <span>{row.label}</span>
          )}
        </div>

        <div
          role="img"
          data-testid="state-timeline-lane"
          aria-label={row.ariaLabel}
          className="relative flex-1 rounded-sm overflow-hidden bg-gray-100"
          style={{ height: `${LANE_HEIGHT_IN_PX}px` }}
        >
          {row.segments.length === 0 ? (
            <span
              data-testid="state-timeline-no-data"
              className="absolute inset-0 flex items-center justify-center text-[10px] text-gray-400"
            >
              {props.noDataLabel}
            </span>
          ) : (
            row.segments.map((segment: StateTimelineSegment) => {
              return (
                <SegmentBar
                  key={segment.id}
                  rowLabel={row.label}
                  segment={segment}
                  onHoverStart={setTooltipState}
                  onHoverEnd={onHoverEnd}
                />
              );
            })
          )}
        </div>

        {hasTrailingLabels && (
          <div
            data-testid="state-timeline-trailing-label"
            className="flex-shrink-0 text-[10px] text-gray-500 tabular-nums text-right w-12"
          >
            {row.trailingLabel ?? ""}
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="h-full w-full flex flex-col">
      {/*
       * The axis lives INSIDE the scrolling container, stuck to its bottom.
       * As a sibling it would be laid out against a containing block wider by
       * the scrollbar, and its 34%-plus-flex-1 split would no longer line up
       * with the lanes' — so every tick would sit a few pixels away from the
       * instant it names, on exactly the tall widgets where the axis matters.
       */}
      <div className="flex-1 overflow-y-auto overflow-x-hidden py-1">
        {props.rows.map(getLane)}

        {props.axisTicks.length > 0 && (
          <div className="sticky bottom-0 flex items-center gap-2 px-2 pt-1 pb-1 bg-white">
            <div
              className="flex-shrink-0"
              style={{ width: "34%", maxWidth: "180px", minWidth: "64px" }}
            ></div>
            <div className="relative flex-1 h-4">
              {props.axisTicks.map(
                (tick: StateTimelineAxisTick, index: number) => {
                  /*
                   * The first and last labels are anchored to their edge rather
                   * than centred on it, so neither is clipped by the lane.
                   */
                  const isFirst: boolean = index === 0;
                  const isLast: boolean = index === props.axisTicks.length - 1;

                  let transform: string = "translateX(-50%)";
                  if (isFirst) {
                    transform = "translateX(0)";
                  } else if (isLast) {
                    transform = "translateX(-100%)";
                  }

                  return (
                    <span
                      key={index}
                      data-testid="state-timeline-axis-tick"
                      className="absolute top-0 text-[10px] text-gray-400 whitespace-nowrap tabular-nums"
                      style={{
                        left: `${tick.percent}%`,
                        transform: transform,
                      }}
                    >
                      {tick.label}
                    </span>
                  );
                },
              )}
            </div>
            {hasTrailingLabels && <div className="flex-shrink-0 w-12"></div>}
          </div>
        )}
      </div>

      {props.legend && props.legend.length > 0 && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 pb-2 pt-1 border-t border-gray-100 bg-gray-50/50">
          {props.legend.map((item: StateTimelineLegendItem, index: number) => {
            return (
              <div
                key={index}
                data-testid="state-timeline-legend-item"
                className="flex items-center gap-1.5"
              >
                <span
                  className="inline-block w-2 h-2 rounded-full"
                  style={{ backgroundColor: item.color }}
                ></span>
                <span className="text-[10px] text-gray-500">{item.label}</span>
              </div>
            );
          })}
        </div>
      )}

      {tooltipState && <StateTimelineTooltip state={tooltipState} />}
    </div>
  );
};

export default DashboardResourceStateTimeline;
