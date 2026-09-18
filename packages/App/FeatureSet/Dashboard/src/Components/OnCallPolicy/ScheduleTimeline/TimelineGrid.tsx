import { getColorForUserId } from "../OnCallScheduleLayer/LayerUserColors";
import { GapBlock, OverriddenSegment, ShiftBar } from "./TimelineBar";
import TimelineModel, {
  TimelineGroup,
  TimelineSchedule,
  TimelineShift,
} from "./TimelineModel";
import AppLink from "../../AppLink/AppLink";
import PageMap from "../../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../../Utils/RouteMap";
import Route from "Common/Types/API/Route";
import IconProp from "Common/Types/Icon/IconProp";
import ObjectID from "Common/Types/ObjectID";
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

/*
 * The schedule-name column. A CSS variable rather than a number so the
 * stylesheet can narrow it on a phone, where 264px would leave no room for
 * the days (see ScheduleTimeline.css).
 */
export const LABEL_COLUMN_WIDTH: string =
  "var(--oneuptime-schedule-timeline-label-width, 264px)";
export const WEEK_MIN_DAY_WIDTH_PX: number = 104;
export const MONTH_MIN_DAY_WIDTH_PX: number = 34;
export const ROW_HEIGHT_PX: number = 48;
export const ROW_WITH_OVERRIDES_HEIGHT_PX: number = 70;

function useElementWidth(ref: RefObject<HTMLElement | null>): number | null {
  const [width, setWidth] = useState<number | null>(null);

  useEffect(() => {
    const element: HTMLElement | null = ref.current;

    if (!element || typeof ResizeObserver === "undefined") {
      return;
    }

    const measure: () => void = (): void => {
      const measured: number = element.getBoundingClientRect().width;
      setWidth(measured > 0 ? measured : null);
    };

    measure();

    const observer: ResizeObserver = new ResizeObserver(() => {
      measure();
    });

    observer.observe(element);

    return () => {
      observer.disconnect();
    };
  }, [ref]);

  return width;
}

export function getScheduleRoute(scheduleId: string): Route {
  return RouteUtil.populateRouteParams(
    RouteMap[PageMap.ON_CALL_DUTY_SCHEDULE_VIEW] as Route,
    { modelId: new ObjectID(scheduleId) },
  );
}

export interface ComponentProps {
  range: TimelineRange;
  groups: Array<TimelineGroup>;
  now: Date;
  // The part of the range the server computed; null while nothing has.
  computedWindow: TimeInterval | null;
  showGroupHeaders: boolean;
  collapsedGroupKeys: Set<string>;
  onToggleGroup: (key: string) => void;
  highlightedUserId: string | null;
  onToggleHighlight: (userId: string) => void;
  // Replaces the rows (skeletons, "no match" message).
  body?: ReactElement | undefined;
}

const TimelineGrid: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const dayAreaRef: RefObject<HTMLDivElement | null> =
    useRef<HTMLDivElement | null>(null);
  const dayAreaWidth: number | null = useElementWidth(dayAreaRef);

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
   * The parts of the range the server would not compute (beyond the
   * look-back / look-ahead limits), drawn as a neutral band across every row.
   */
  const unavailable: Array<PositionedInterval<TimeInterval>> =
    props.computedWindow
      ? ScheduleTimelineLayout.positionIntervals(
          ScheduleTimelineLayout.computeGaps(
            [props.computedWindow],
            props.range.start,
            props.range.end,
          ),
          props.range,
        )
      : [];

  const toPixels: (percent: number) => number | null = (
    percent: number,
  ): number | null => {
    return dayAreaWidth === null ? null : (percent / 100) * dayAreaWidth;
  };

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
          className="sticky left-0 z-20 flex shrink-0 items-center gap-2 border-r border-gray-200 bg-gray-50 px-3 py-2 text-left hover:bg-gray-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-indigo-500"
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
          <span className="truncate text-xs font-semibold uppercase tracking-wide text-gray-700">
            {group.title}
          </span>
          <span className="shrink-0 rounded-full bg-white px-1.5 py-0.5 text-[10px] font-semibold text-gray-500 ring-1 ring-inset ring-gray-200">
            {group.schedules.length}
          </span>
          {group.isCurrentUserMember && (
            <span className="shrink-0 rounded-full bg-indigo-50 px-1.5 py-0.5 text-[10px] font-semibold text-indigo-700 ring-1 ring-inset ring-indigo-200">
              Your team
            </span>
          )}
        </button>
        <div className="flex-1" />
      </div>
    );
  };

  const renderSubline: (schedule: TimelineSchedule) => ReactElement = (
    schedule: TimelineSchedule,
  ): ReactElement => {
    const nowIsComputed: boolean = Boolean(
      props.computedWindow &&
        ScheduleTimelineLayout.isWithinRange(props.now, props.computedWindow),
    );

    if (nowIsComputed) {
      const active: TimelineShift | null = TimelineModel.getOnCallNow(
        schedule,
        props.now,
      );

      if (active) {
        return (
          <span
            className="flex min-w-0 items-center gap-1.5"
            data-testid="timeline-on-call-now"
            title={`${active.userName} is on call now`}
          >
            <span className="relative flex h-2 w-2 shrink-0">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-green-400 opacity-60" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-green-500" />
            </span>
            <span
              className="inline-block h-2 w-2 shrink-0 rounded-sm"
              style={{ backgroundColor: getColorForUserId(active.userId) }}
            />
            <span className="truncate font-medium text-gray-800">
              {active.userName}
            </span>
            <span className="hidden shrink-0 text-gray-400 sm:inline">
              on call now
            </span>
          </span>
        );
      }

      return (
        <span
          className="flex items-center gap-1 font-medium text-amber-700"
          data-testid="timeline-uncovered-now"
        >
          <Icon icon={IconProp.Alert} className="h-3.5 w-3.5 shrink-0" />
          No one on call now
        </span>
      );
    }

    const people: number = TimelineModel.countPeople(
      schedule,
      props.computedWindow,
    );

    const period: string =
      props.range.mode === TimelineViewMode.Month ? "month" : "week";

    return (
      <span className="truncate text-gray-500">
        {people === 0
          ? `No one on call this ${period}`
          : `${people} ${people === 1 ? "person" : "people"} on call this ${period}`}
      </span>
    );
  };

  const renderRow: (
    schedule: TimelineSchedule,
    groupKey: string,
  ) => ReactElement = (
    schedule: TimelineSchedule,
    groupKey: string,
  ): ReactElement => {
    const bars: Array<PositionedInterval<TimelineShift>> =
      ScheduleTimelineLayout.positionIntervals(schedule.shifts, props.range);

    const gaps: Array<PositionedInterval<TimeInterval>> =
      ScheduleTimelineLayout.positionIntervals(
        TimelineModel.getGaps(schedule, props.computedWindow),
        props.range,
      );

    const overridden: Array<PositionedInterval<TimelineShift>> = bars.filter(
      (bar: PositionedInterval<TimelineShift>) => {
        return bar.item.override !== null;
      },
    );

    const height: number =
      overridden.length > 0 ? ROW_WITH_OVERRIDES_HEIGHT_PX : ROW_HEIGHT_PX;

    return (
      <div
        key={`${groupKey}-${schedule.id}`}
        className="group relative flex border-b border-gray-100 last:border-b-0"
        style={{ height }}
        data-testid="timeline-schedule-row"
        data-schedule-id={schedule.id}
      >
        <div
          className="sticky left-0 z-20 flex shrink-0 flex-col justify-center border-r border-gray-200 bg-white px-4 group-hover:bg-gray-50"
          style={{ width: LABEL_COLUMN_WIDTH }}
        >
          <div className="flex min-w-0 items-center gap-1.5">
            <AppLink
              to={getScheduleRoute(schedule.id)}
              className="min-w-0 truncate text-sm font-medium text-gray-900 hover:text-indigo-600 hover:underline"
            >
              {schedule.name}
            </AppLink>
            {schedule.isCurrentUserOnRoster && (
              <span
                className="shrink-0 rounded bg-indigo-50 px-1 py-px text-[10px] font-semibold uppercase tracking-wide text-indigo-700 ring-1 ring-inset ring-indigo-200"
                title="You are on this schedule's roster"
              >
                You
              </span>
            )}
          </div>
          <div className="mt-0.5 flex min-w-0 items-center text-xs">
            {renderSubline(schedule)}
          </div>
        </div>

        <div className="relative min-w-0 flex-1 overflow-hidden">
          {gaps.map((gap: PositionedInterval<TimeInterval>) => {
            return (
              <GapBlock
                key={`gap-${gap.item.start.getTime()}`}
                positioned={gap}
                widthPx={toPixels(gap.width)}
                timezone={props.range.timezone}
              />
            );
          })}
          {bars.map((bar: PositionedInterval<TimelineShift>) => {
            return (
              <ShiftBar
                key={bar.item.key}
                positioned={bar}
                widthPx={toPixels(bar.width)}
                scheduleName={schedule.name}
                timezone={props.range.timezone}
                now={props.now}
                highlightedUserId={props.highlightedUserId}
                onToggleHighlight={props.onToggleHighlight}
              />
            );
          })}
          {overridden.map((bar: PositionedInterval<TimelineShift>) => {
            return (
              <OverriddenSegment
                key={`overridden-${bar.item.key}`}
                positioned={bar}
                widthPx={toPixels(bar.width)}
                timezone={props.range.timezone}
                highlightedUserId={props.highlightedUserId}
              />
            );
          })}
        </div>
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
                      return renderRow(schedule, group.key);
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
