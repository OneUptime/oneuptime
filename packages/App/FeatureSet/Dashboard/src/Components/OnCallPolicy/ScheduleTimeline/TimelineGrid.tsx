import { TimelineGroup, TimelineSchedule } from "./TimelineModel";
import TimelineRow, { LABEL_COLUMN_WIDTH } from "./TimelineRow";
import IconProp from "Common/Types/Icon/IconProp";
import OneUptimeDate from "Common/Types/Date";
import ScheduleTimelineLayout, {
  PositionedInterval,
  TimeInterval,
  TimelineDay,
  TimelineRange,
  TimelineViewMode,
} from "Common/Types/OnCallDutyPolicy/ScheduleTimelineLayout";
import Icon from "Common/UI/Components/Icon/Icon";
import React, {
  FunctionComponent,
  ReactElement,
  RefObject,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

/*
 * The grid itself: a sticky header of days, a sticky column of schedule
 * names, and one row per schedule with its shifts laid out across the days.
 *
 * Layering, back to front: the day columns (gridlines, weekend and today
 * tint, and the hatched "outside the computable range" band), then the rows,
 * then the now-line, then the sticky name column - so a bar scrolled under
 * the name column disappears beneath it instead of drawing over it.
 */

export const WEEK_MIN_DAY_WIDTH_PX: number = 104;
export const MONTH_MIN_DAY_WIDTH_PX: number = 34;

/*
 * The day area's width in whole pixels. It only decides how much text fits
 * in a block, so resize bursts are coalesced into one update per frame and
 * sub-pixel changes are ignored - otherwise dragging a window edge would
 * re-render every row on every frame.
 */
function useElementWidth(ref: RefObject<HTMLElement | null>): number | null {
  const [width, setWidth] = useState<number | null>(null);

  useEffect(() => {
    const element: HTMLElement | null = ref.current;

    if (!element || typeof ResizeObserver === "undefined") {
      return;
    }

    let frame: number | null = null;

    const measure: () => void = (): void => {
      frame = null;
      const measured: number = Math.round(
        element.getBoundingClientRect().width,
      );
      setWidth(measured > 0 ? measured : null);
    };

    measure();

    const observer: ResizeObserver = new ResizeObserver(() => {
      if (frame === null) {
        frame = window.requestAnimationFrame(measure);
      }
    });

    observer.observe(element);

    return () => {
      observer.disconnect();

      if (frame !== null) {
        window.cancelAnimationFrame(frame);
      }
    };
  }, [ref]);

  return width;
}

export interface ComponentProps {
  range: TimelineRange;
  groups: Array<TimelineGroup>;
  now: Date;
  // The part of the range the server computed; null while nothing has.
  computedWindow: TimeInterval | null;
  /*
   * The window the server served. Outside it the grid is shaded "not
   * available" - even when it does not overlap the range at all, in which
   * case the whole range is shaded.
   */
  servedWindow: TimeInterval | null;
  showGroupHeaders: boolean;
  collapsedGroupKeys: Set<string>;
  onToggleGroup: (key: string) => void;
  highlightedUserId: string | null;
  onToggleHighlight: (userId: string) => void;
  // Replaces the rows (the loading skeleton).
  body?: ReactElement | undefined;
}

const TimelineGrid: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const dayAreaRef: RefObject<HTMLDivElement | null> =
    useRef<HTMLDivElement | null>(null);
  const dayAreaWidth: number | null = useElementWidth(dayAreaRef);

  // The probe builds an Intl.DateTimeFormat; once per grid, not per block.
  const use12HourFormat: boolean = useMemo(() => {
    return OneUptimeDate.getUserPrefers12HourFormat();
  }, []);

  const days: Array<TimelineDay> = props.range.days;
  const todayKey: string = ScheduleTimelineLayout.getDayKey(
    props.now,
    props.range.timezone,
  );

  const minDayWidth: number =
    props.range.mode === TimelineViewMode.Month
      ? MONTH_MIN_DAY_WIDTH_PX
      : WEEK_MIN_DAY_WIDTH_PX;

  const gridTemplateColumns: string = `repeat(${days.length}, minmax(0, 1fr))`;

  const nowIsVisible: boolean = ScheduleTimelineLayout.isWithinRange(
    props.now,
    props.range,
  );
  const nowPercent: number =
    ScheduleTimelineLayout.getFraction(props.now, props.range) * 100;

  /*
   * The "now" rows see. Past / active / future and "on call now" only change
   * while now is inside the range, so on any other week the minute tick does
   * not reach the rows at all. It is still re-read whenever the range
   * changes, so a value frozen on an earlier visit can never fall inside a
   * week the reader comes back to after the clock has moved on.
   */
  const nowTick: number = nowIsVisible ? props.now.getTime() : -1;
  const rowNow: Date = useMemo(() => {
    return props.now;
  }, [nowTick, props.range]);

  /*
   * The parts of the range the server would not compute (beyond the
   * look-back / look-ahead limits), drawn as a neutral band across every row.
   */
  const unavailable: Array<PositionedInterval<TimeInterval>> = useMemo(() => {
    if (!props.servedWindow) {
      return [];
    }

    return ScheduleTimelineLayout.positionIntervals(
      ScheduleTimelineLayout.computeGaps(
        [props.servedWindow],
        props.range.start,
        props.range.end,
      ),
      props.range,
    );
  }, [props.servedWindow, props.range]);

  const renderDayHeader: (day: TimelineDay) => ReactElement = (
    day: TimelineDay,
  ): ReactElement => {
    const isToday: boolean = day.key === todayKey;
    const isMonth: boolean = props.range.mode === TimelineViewMode.Month;

    return (
      <div
        key={day.key}
        data-testid="timeline-day-header"
        data-today={isToday ? "true" : "false"}
        className={`flex flex-col items-center justify-center border-r border-gray-200 py-2 last:border-r-0 ${
          day.isWeekend ? "bg-gray-50" : ""
        }`}
        title={day.key}
      >
        <span
          className={`text-[10px] font-semibold uppercase tracking-wider ${
            isToday ? "text-indigo-600" : "text-gray-400"
          }`}
        >
          {isMonth ? day.weekdayNarrow : day.weekdayShort}
        </span>
        <span
          className={`mt-0.5 inline-flex items-center justify-center rounded-full text-sm font-semibold ${
            isMonth ? "h-6 min-w-6 px-1" : "h-7 min-w-7 px-1.5"
          } ${isToday ? "bg-indigo-600 text-white" : "text-gray-800"}`}
        >
          {!isMonth && day.isFirstOfMonth
            ? `${day.monthShort} ${day.dayOfMonth}`
            : day.dayOfMonth}
        </span>
      </div>
    );
  };

  const renderGroupHeader: (group: TimelineGroup) => ReactElement = (
    group: TimelineGroup,
  ): ReactElement => {
    const isCollapsed: boolean = props.collapsedGroupKeys.has(group.key);

    return (
      <div
        key={`group-${group.key}`}
        className="relative flex border-b border-gray-200 bg-gray-50"
        data-testid="timeline-group-header"
      >
        <button
          type="button"
          onClick={() => {
            props.onToggleGroup(group.key);
          }}
          aria-expanded={!isCollapsed}
          className="sticky left-0 z-20 flex min-w-0 shrink-0 items-center gap-2 overflow-hidden border-r border-gray-200 bg-gray-50 px-3 py-2 text-left hover:bg-gray-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-indigo-500"
          style={{ width: LABEL_COLUMN_WIDTH }}
        >
          <Icon
            icon={isCollapsed ? IconProp.ChevronRight : IconProp.ChevronDown}
            className="h-3.5 w-3.5 shrink-0 text-gray-400"
          />
          <Icon
            icon={group.teamId ? IconProp.UserGroup : IconProp.Calendar}
            className="h-4 w-4 shrink-0 text-gray-400"
          />
          <span className="min-w-0 truncate text-xs font-semibold uppercase tracking-wide text-gray-700">
            {group.title}
          </span>
          <span className="shrink-0 rounded-full bg-white px-1.5 py-0.5 text-[10px] font-semibold text-gray-500 ring-1 ring-inset ring-gray-200">
            {group.schedules.length}
          </span>
          {group.isCurrentUserMember && (
            <span className="hidden shrink-0 rounded-full bg-indigo-50 px-1.5 py-0.5 text-[10px] font-semibold text-indigo-700 ring-1 ring-inset ring-indigo-200 sm:inline-flex">
              Your team
            </span>
          )}
        </button>
        <div className="flex-1" />
      </div>
    );
  };

  return (
    <div
      className="oneuptime-schedule-timeline-grid relative max-h-[75vh] overflow-auto rounded-lg border border-gray-200 bg-white"
      data-testid="schedule-timeline-grid"
    >
      <div
        className="relative"
        style={{
          minWidth: `calc(${LABEL_COLUMN_WIDTH} + ${days.length * minDayWidth}px)`,
        }}
      >
        <div className="sticky top-0 z-30 flex border-b border-gray-200 bg-white">
          <div
            className="sticky left-0 z-40 flex shrink-0 items-end border-r border-gray-200 bg-white px-4 py-2"
            style={{ width: LABEL_COLUMN_WIDTH }}
          >
            <span className="text-[11px] font-semibold uppercase tracking-wider text-gray-400">
              Schedule
            </span>
          </div>
          <div
            ref={dayAreaRef}
            className="relative grid min-w-0 flex-1"
            style={{ gridTemplateColumns }}
          >
            {days.map(renderDayHeader)}
            {nowIsVisible && (
              <div
                aria-hidden="true"
                className="pointer-events-none absolute bottom-0 h-2 w-2 -translate-x-1/2 translate-y-1/2 rounded-full bg-red-500 ring-2 ring-white"
                style={{ left: `${nowPercent}%` }}
              />
            )}
          </div>
        </div>

        <div className="relative">
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-y-0 right-0 grid"
            style={{ left: LABEL_COLUMN_WIDTH, gridTemplateColumns }}
          >
            {days.map((day: TimelineDay) => {
              return (
                <div
                  key={`column-${day.key}`}
                  className={`border-r border-gray-100 last:border-r-0 ${
                    day.key === todayKey
                      ? "oneuptime-schedule-timeline-today"
                      : day.isWeekend
                        ? "oneuptime-schedule-timeline-weekend"
                        : ""
                  }`}
                />
              );
            })}
          </div>

          {unavailable.length > 0 && (
            <div
              className="pointer-events-none absolute inset-y-0 right-0"
              style={{ left: LABEL_COLUMN_WIDTH }}
            >
              {unavailable.map((band: PositionedInterval<TimeInterval>) => {
                return (
                  <div
                    key={`unavailable-${band.item.start.getTime()}`}
                    data-testid="timeline-unavailable"
                    className="oneuptime-schedule-timeline-unavailable absolute inset-y-0"
                    style={{ left: `${band.left}%`, width: `${band.width}%` }}
                  />
                );
              })}
            </div>
          )}

          {props.body ||
            props.groups.map((group: TimelineGroup) => {
              const isCollapsed: boolean = props.collapsedGroupKeys.has(
                group.key,
              );

              return (
                <React.Fragment key={group.key}>
                  {props.showGroupHeaders &&
                    group.title !== null &&
                    renderGroupHeader(group)}
                  {!isCollapsed &&
                    group.schedules.map((schedule: TimelineSchedule) => {
                      return (
                        <TimelineRow
                          key={`${group.key}-${schedule.id}`}
                          schedule={schedule}
                          range={props.range}
                          computedWindow={props.computedWindow}
                          now={rowNow}
                          dayAreaWidth={dayAreaWidth}
                          highlightedUserId={props.highlightedUserId}
                          onToggleHighlight={props.onToggleHighlight}
                          use12HourFormat={use12HourFormat}
                        />
                      );
                    })}
                </React.Fragment>
              );
            })}

          {nowIsVisible && (
            <div
              className="pointer-events-none absolute inset-y-0 right-0 z-10"
              style={{ left: LABEL_COLUMN_WIDTH }}
            >
              <div
                data-testid="timeline-now-line"
                className="absolute inset-y-0 w-0.5 -translate-x-1/2 bg-red-500/80"
                style={{ left: `${nowPercent}%` }}
              />
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default TimelineGrid;
