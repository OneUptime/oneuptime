import {
  getColorForUserId,
  getUserInitials,
} from "../OnCallScheduleLayer/LayerUserColors";
import { OVERRIDE_TITLE_MARKER } from "../OnCallScheduleLayer/OverridePresentation";
import { TimelineShift } from "./TimelineModel";
import ScheduleTimelineLayout, {
  PositionedInterval,
  TimeInterval,
} from "Common/Types/OnCallDutyPolicy/ScheduleTimelineLayout";
import Tooltip from "Common/UI/Components/Tooltip/Tooltip";
import React, { FunctionComponent, ReactElement } from "react";

/*
 * The three kinds of block a timeline row draws: a shift (who is on call),
 * a gap (nobody is), and - on the thin lane under a row that has overrides -
 * the shift somebody else is covering. Geometry comes in as a
 * PositionedInterval (percent of the day area) plus the pixel width the
 * caller measured, which only decides how much text fits.
 */

// Below these widths (px) a block drops its avatar, then its text.
export const BAR_AVATAR_MIN_WIDTH_PX: number = 96;
export const BAR_TEXT_MIN_WIDTH_PX: number = 40;
export const GAP_TEXT_MIN_WIDTH_PX: number = 110;

// Unknown width (no ResizeObserver, first paint): assume there is room.
function fits(widthPx: number | null, minimum: number): boolean {
  return widthPx === null || widthPx >= minimum;
}

function getCornerRadius(data: {
  continuesBefore: boolean;
  continuesAfter: boolean;
}): string {
  const left: string = data.continuesBefore ? "2px" : "6px";
  const right: string = data.continuesAfter ? "2px" : "6px";
  return `${left} ${right} ${right} ${left}`;
}

export interface ShiftBarProps {
  positioned: PositionedInterval<TimelineShift>;
  widthPx: number | null;
  scheduleName: string;
  timezone: string;
  now: Date;
  // Another user is highlighted: fade this bar unless it is theirs.
  highlightedUserId: string | null;
  onToggleHighlight: (userId: string) => void;
}

export const ShiftBar: FunctionComponent<ShiftBarProps> = (
  props: ShiftBarProps,
): ReactElement => {
  const shift: TimelineShift = props.positioned.item;
  const color: string = getColorForUserId(shift.userId);
  const isActive: boolean =
    shift.start.getTime() <= props.now.getTime() &&
    shift.end.getTime() > props.now.getTime();
  const isPast: boolean = shift.end.getTime() <= props.now.getTime();
  const isHighlighted: boolean = props.highlightedUserId === shift.userId;
  const isDimmed: boolean = props.highlightedUserId !== null && !isHighlighted;

  const interval: string = ScheduleTimelineLayout.formatInterval({
    start: shift.start,
    end: shift.end,
    timezone: props.timezone,
  });
  const duration: string = ScheduleTimelineLayout.formatDuration(
    shift.end.getTime() - shift.start.getTime(),
  );

  const label: string = shift.override
    ? `${OVERRIDE_TITLE_MARKER} ${shift.userName}`
    : shift.userName;

  // Too narrow for text: no padding either, or a sliver renders 16px wide.
  const hasText: boolean = fits(props.widthPx, BAR_TEXT_MIN_WIDTH_PX);

  const ariaLabel: string = [
    `${shift.userName} on call for ${props.scheduleName}`,
    interval,
    shift.override ? `covering for ${shift.override.originalUserName}` : "",
    isActive ? "on call now" : "",
  ]
    .filter(Boolean)
    .join(", ");

  let opacity: number = 1;

  if (isDimmed) {
    opacity = 0.18;
  } else if (isPast && !isHighlighted) {
    opacity = 0.55;
  }

  const background: string = ScheduleTimelineLayout.withAlpha(
    color,
    isActive || isHighlighted ? 0.32 : 0.18,
  );

  const tooltip: ReactElement = (
    <div className="min-w-[240px] max-w-[320px] p-1 text-left">
      <div className="flex items-center gap-2">
        <span
          className="inline-block h-2.5 w-2.5 shrink-0 rounded-full"
          style={{ backgroundColor: color }}
        />
        <span className="truncate text-sm font-semibold text-gray-900">
          {shift.userName}
        </span>
        {isActive && (
          <span className="ml-auto shrink-0 rounded-full bg-green-50 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-green-700 ring-1 ring-inset ring-green-200">
            On call now
          </span>
        )}
      </div>
      <div className="mt-1 truncate text-xs text-gray-500">
        {props.scheduleName}
        {shift.layerName ? ` · ${shift.layerName}` : ""}
      </div>
      <div className="mt-2 text-xs font-medium text-gray-700">{interval}</div>
      <div className="text-xs text-gray-500">{duration}</div>
      {shift.override && (
        <div className="mt-2 rounded-md bg-indigo-50 px-2 py-1.5 text-xs text-indigo-800">
          Covering for{" "}
          <span className="font-semibold">
            {shift.override.originalUserName}
          </span>
          {shift.override.isPolicyScoped
            ? " through a policy-scoped override."
            : " through an override."}
        </div>
      )}
      <div className="mt-2 border-t border-gray-100 pt-1.5 text-[11px] text-gray-400">
        {isHighlighted
          ? "Click to clear the highlight."
          : `Click to highlight every shift of ${shift.userName}.`}
      </div>
    </div>
  );

  return (
    <Tooltip lazy={true} interactive={false} richContent={tooltip}>
      <button
        type="button"
        data-testid="timeline-shift-bar"
        data-user-id={shift.userId}
        data-active={isActive ? "true" : "false"}
        data-override={shift.override ? "true" : "false"}
        aria-label={ariaLabel}
        aria-pressed={isHighlighted}
        onClick={() => {
          props.onToggleHighlight(shift.userId);
        }}
        className={`absolute top-[9px] flex h-[30px] items-center gap-1.5 overflow-hidden text-left text-xs font-medium text-gray-900 transition-[opacity,box-shadow] duration-150 hover:z-10 focus:z-10 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 ${
          hasText ? "px-1.5" : "px-0"
        }`}
        style={{
          left: `${props.positioned.left}%`,
          width: `max(calc(${props.positioned.width}% - 2px), 3px)`,
          marginLeft: "1px",
          opacity,
          backgroundColor: background,
          backgroundImage: shift.override
            ? `repeating-linear-gradient(135deg, ${ScheduleTimelineLayout.withAlpha(
                color,
                0.16,
              )} 0 5px, transparent 5px 10px)`
            : undefined,
          border: `1px solid ${ScheduleTimelineLayout.withAlpha(color, 0.5)}`,
          borderLeft: props.positioned.continuesBefore
            ? `1px dashed ${ScheduleTimelineLayout.withAlpha(color, 0.6)}`
            : `${hasText ? 3 : 2}px solid ${color}`,
          borderRadius: getCornerRadius(props.positioned),
          boxShadow: isHighlighted
            ? `0 0 0 2px ${ScheduleTimelineLayout.withAlpha(color, 0.55)}`
            : isActive
              ? `0 1px 3px ${ScheduleTimelineLayout.withAlpha(color, 0.35)}`
              : undefined,
        }}
      >
        {fits(props.widthPx, BAR_AVATAR_MIN_WIDTH_PX) && (
          <span
            aria-hidden="true"
            className="inline-flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-full text-[9px] font-bold"
            style={{
              backgroundColor: color,
              color: ScheduleTimelineLayout.getContrastTextColor(color),
            }}
          >
            {getUserInitials(shift.userName, "")}
          </span>
        )}
        {hasText && <span className="truncate">{label}</span>}
      </button>
    </Tooltip>
  );
};

export interface GapBlockProps {
  positioned: PositionedInterval<TimeInterval>;
  widthPx: number | null;
  timezone: string;
}

/*
 * A stretch where nobody is on call. Hatched amber rather than left blank,
 * so "we computed this and nobody is there" never reads as "nothing loaded".
 */
export const GapBlock: FunctionComponent<GapBlockProps> = (
  props: GapBlockProps,
): ReactElement => {
  const gap: TimeInterval = props.positioned.item;

  const interval: string = ScheduleTimelineLayout.formatInterval({
    start: gap.start,
    end: gap.end,
    timezone: props.timezone,
  });
  const duration: string = ScheduleTimelineLayout.formatDuration(
    gap.end.getTime() - gap.start.getTime(),
  );

  const tooltip: ReactElement = (
    <div className="max-w-[300px] p-1 text-left">
      <div className="text-sm font-semibold text-amber-800">No one on call</div>
      <div className="mt-1 text-xs font-medium text-gray-700">{interval}</div>
      <div className="text-xs text-gray-500">{duration}</div>
      <div className="mt-2 text-xs text-gray-500">
        Alerts that escalate to this schedule during this time will not page
        anyone.
      </div>
    </div>
  );

  return (
    <Tooltip lazy={true} interactive={false} richContent={tooltip}>
      <div
        data-testid="timeline-gap"
        tabIndex={0}
        aria-label={`No one on call, ${interval}`}
        className={`oneuptime-schedule-timeline-gap absolute top-[9px] flex h-[30px] items-center overflow-hidden focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-500 ${
          fits(props.widthPx, GAP_TEXT_MIN_WIDTH_PX) ? "px-2" : "px-0"
        }`}
        style={{
          left: `${props.positioned.left}%`,
          width: `max(calc(${props.positioned.width}% - 2px), 2px)`,
          marginLeft: "1px",
          borderRadius: getCornerRadius(props.positioned),
        }}
      >
        {fits(props.widthPx, GAP_TEXT_MIN_WIDTH_PX) && (
          <span className="truncate text-[11px] font-semibold text-amber-800">
            No one on call
          </span>
        )}
      </div>
    </Tooltip>
  );
};

export interface OverriddenSegmentProps {
  positioned: PositionedInterval<TimelineShift>;
  widthPx: number | null;
  timezone: string;
  highlightedUserId: string | null;
}

/*
 * On the lane under a row: whose shift an override replaced, struck through,
 * directly beneath the substitute's bar. The bar itself can only show who IS
 * paged; this is the one place the row says who would have been.
 */
export const OverriddenSegment: FunctionComponent<OverriddenSegmentProps> = (
  props: OverriddenSegmentProps,
): ReactElement => {
  const shift: TimelineShift = props.positioned.item;

  if (!shift.override) {
    return <></>;
  }

  const originalColor: string = getColorForUserId(
    shift.override.originalUserId,
  );

  const isDimmed: boolean =
    props.highlightedUserId !== null &&
    props.highlightedUserId !== shift.userId &&
    props.highlightedUserId !== shift.override.originalUserId;

  const tooltip: ReactElement = (
    <div className="max-w-[300px] p-1 text-left text-xs text-gray-600">
      <div className="text-sm font-semibold text-gray-900">
        {shift.override.originalUserName}&apos;s shift, overridden
      </div>
      <div className="mt-1">
        <span className="font-medium text-gray-800">{shift.userName}</span> is
        covering{" "}
        {ScheduleTimelineLayout.formatInterval({
          start: shift.start,
          end: shift.end,
          timezone: props.timezone,
        })}
        .
      </div>
      <div className="mt-1 text-gray-500">
        Override window:{" "}
        {ScheduleTimelineLayout.formatInterval({
          start: shift.override.start,
          end: shift.override.end,
          timezone: props.timezone,
        })}
      </div>
    </div>
  );

  return (
    <Tooltip lazy={true} interactive={false} richContent={tooltip}>
      <div
        data-testid="timeline-overridden-segment"
        tabIndex={0}
        aria-label={`${shift.override.originalUserName}'s shift, covered by ${shift.userName}`}
        className={`absolute top-[46px] flex h-[18px] items-center gap-1 overflow-hidden rounded text-[11px] text-gray-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 ${
          fits(props.widthPx, BAR_TEXT_MIN_WIDTH_PX) ? "px-1.5" : "px-0"
        }`}
        style={{
          left: `${props.positioned.left}%`,
          width: `max(calc(${props.positioned.width}% - 2px), 3px)`,
          marginLeft: "1px",
          opacity: isDimmed ? 0.25 : 1,
          border: `1px dashed ${ScheduleTimelineLayout.withAlpha(originalColor, 0.55)}`,
          backgroundImage: `repeating-linear-gradient(135deg, ${ScheduleTimelineLayout.withAlpha(
            originalColor,
            0.14,
          )} 0 4px, transparent 4px 8px)`,
        }}
      >
        {fits(props.widthPx, BAR_TEXT_MIN_WIDTH_PX) && (
          <span className="truncate">
            <span className="line-through decoration-gray-400">
              {shift.override.originalUserName}
            </span>{" "}
            <span className="text-gray-400">(overridden)</span>
          </span>
        )}
      </div>
    </Tooltip>
  );
};
