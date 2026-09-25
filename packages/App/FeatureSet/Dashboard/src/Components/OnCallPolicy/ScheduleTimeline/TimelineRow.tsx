import { GapBlock, OverriddenSegment, ShiftBar } from "./TimelineBar";
import { getTimelineColorForUserId } from "./TimelineColors";
import TimelineModel, {
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
  TimelineRange,
  TimelineViewMode,
} from "Common/Types/OnCallDutyPolicy/ScheduleTimelineLayout";
import Icon from "Common/UI/Components/Icon/Icon";
import React, { FunctionComponent, ReactElement, useMemo } from "react";

/*
 * One schedule's row: its name and "who is on call now" in the sticky
 * column, and its shifts, gaps and overridden-shift lane across the days.
 *
 * Memoized, because a month of a busy project is thousands of blocks and the
 * page re-renders for things most rows do not care about (a keystroke in the
 * search box, a group collapsing, the now-line moving on a week that is not
 * this one). Every prop is either a primitive or a value the grid keeps
 * referentially stable.
 */

export const ROW_HEIGHT_PX: number = 48;
export const ROW_WITH_OVERRIDES_HEIGHT_PX: number = 70;

/*
 * The schedule-name column. A CSS variable rather than a number so the
 * stylesheet can narrow it on a phone, where 264px would leave no room for
 * the days (see ScheduleTimeline.css).
 */
export const LABEL_COLUMN_WIDTH: string =
  "var(--oneuptime-schedule-timeline-label-width, 264px)";

export function getScheduleRoute(scheduleId: string): Route {
  return RouteUtil.populateRouteParams(
    RouteMap[PageMap.ON_CALL_DUTY_SCHEDULE_VIEW] as Route,
    { modelId: new ObjectID(scheduleId) },
  );
}

type RowBlock =
  | { kind: "gap"; positioned: PositionedInterval<TimeInterval> }
  | { kind: "shift"; positioned: PositionedInterval<TimelineShift> };

export interface ComponentProps {
  schedule: TimelineSchedule;
  range: TimelineRange;
  computedWindow: TimeInterval | null;
  // Only changes while "now" is inside the range; see TimelineGrid.
  now: Date;
  dayAreaWidth: number | null;
  highlightedUserId: string | null;
  onToggleHighlight: (userId: string) => void;
  use12HourFormat: boolean;
}

const TimelineRow: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const schedule: TimelineSchedule = props.schedule;

  /*
   * Gaps and shifts in one list, by start time, each shift followed by its
   * overridden-shift segment: tab order and screen-reader order then follow
   * the week, not "all gaps, then all shifts".
   */
  const layout: { blocks: Array<RowBlock>; hasOverrides: boolean } =
    useMemo(() => {
      const bars: Array<PositionedInterval<TimelineShift>> =
        ScheduleTimelineLayout.positionIntervals(schedule.shifts, props.range);

      const gaps: Array<PositionedInterval<TimeInterval>> =
        ScheduleTimelineLayout.positionIntervals(
          TimelineModel.getGaps(schedule, props.computedWindow),
          props.range,
        );

      const blocks: Array<RowBlock> = [
        ...gaps.map(
          (positioned: PositionedInterval<TimeInterval>): RowBlock => {
            return { kind: "gap", positioned };
          },
        ),
        ...bars.map(
          (positioned: PositionedInterval<TimelineShift>): RowBlock => {
            return { kind: "shift", positioned };
          },
        ),
      ].sort((a: RowBlock, b: RowBlock): number => {
        return (
          a.positioned.item.start.getTime() - b.positioned.item.start.getTime()
        );
      });

      return {
        blocks,
        hasOverrides: bars.some(
          (bar: PositionedInterval<TimelineShift>): boolean => {
            return bar.item.override !== null;
          },
        ),
      };
    }, [schedule, props.range, props.computedWindow]);

  const toPixels: (percent: number) => number | null = (
    percent: number,
  ): number | null => {
    return props.dayAreaWidth === null
      ? null
      : (percent / 100) * props.dayAreaWidth;
  };

  const renderSubline: () => ReactElement = (): ReactElement => {
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
              style={{
                backgroundColor: getTimelineColorForUserId(active.userId),
              }}
            />
            <span className="truncate font-medium text-gray-800">
              {active.userName}
            </span>
            <span className="max-sm:hidden shrink-0 text-gray-400 sm:inline">
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

  return (
    <div
      className="group relative flex border-b border-gray-100 last:border-b-0"
      style={{
        height: layout.hasOverrides
          ? ROW_WITH_OVERRIDES_HEIGHT_PX
          : ROW_HEIGHT_PX,
      }}
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
          {renderSubline()}
        </div>
      </div>

      <div className="relative min-w-0 flex-1 overflow-hidden">
        {layout.blocks.map((block: RowBlock) => {
          if (block.kind === "gap") {
            return (
              <GapBlock
                key={`gap-${block.positioned.item.start.getTime()}`}
                positioned={block.positioned}
                widthPx={toPixels(block.positioned.width)}
                timezone={props.range.timezone}
                use12HourFormat={props.use12HourFormat}
              />
            );
          }

          const bar: PositionedInterval<TimelineShift> = block.positioned;

          return (
            <React.Fragment key={bar.item.key}>
              <ShiftBar
                positioned={bar}
                widthPx={toPixels(bar.width)}
                scheduleName={schedule.name}
                timezone={props.range.timezone}
                use12HourFormat={props.use12HourFormat}
                now={props.now}
                highlightedUserId={props.highlightedUserId}
                onToggleHighlight={props.onToggleHighlight}
              />
              {bar.item.override !== null && (
                <OverriddenSegment
                  positioned={bar}
                  widthPx={toPixels(bar.width)}
                  timezone={props.range.timezone}
                  use12HourFormat={props.use12HourFormat}
                  highlightedUserId={props.highlightedUserId}
                />
              )}
            </React.Fragment>
          );
        })}
      </div>
    </div>
  );
};

export default React.memo(TimelineRow);
