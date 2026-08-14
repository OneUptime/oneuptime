import { getColorForUserId, getUserInitials } from "./LayerUserColors";
import {
  formatDurationFromSeconds,
  formatRelativeStart,
  formatShiftDuration,
  formatShiftInstant,
} from "./LayerSummary";
import Dictionary from "Common/Types/Dictionary";
import IconProp from "Common/Types/Icon/IconProp";
import OneUptimeDate from "Common/Types/Date";
import {
  CoverageGap,
  OnCallShift,
  ScheduleCoverageState,
  ScheduleCoverageStatus,
} from "Common/Types/OnCallDutyPolicy/ScheduleShiftUtil";
import Icon from "Common/UI/Components/Icon/Icon";
import React, { FunctionComponent, ReactElement } from "react";

export interface UserInfo {
  name: string;
  email: string;
}

/*
 * Holes shorter than this are real (the detector reports anything above the
 * engine's own ±1s seams) but too small to be worth a warning row each, so they
 * are collapsed into a single count. This is a DISPLAY threshold — it never
 * hides a gap from the coverage percentage or the gap count.
 */
const SHORT_GAP_SECONDS: number = 60;

// How many full-size gap warnings to list before collapsing the rest into a count.
const MAX_SHOWN_GAPS: number = 3;

export interface ComponentProps {
  /*
   * Coverage shifts of the combined schedule (already override-applied),
   * sorted by start, computed over [now, windowEnd].
   */
  shifts: Array<OnCallShift>;
  now: Date;
  windowEnd: Date;
  timezone?: string | undefined;
  /*
   * userId -> display info for everyone who can appear (schedule users +
   * override substitutes).
   */
  userById: Dictionary<UserInfo>;
  /*
   * Pre-computed coverage state from ScheduleShiftUtil.getCoverageState. Passed
   * in rather than derived here so this component and the calendar grid beside
   * it can never disagree about whether the schedule is covered.
   */
  coverage: ScheduleCoverageState;
  // Link to the layers tab, offered as the remedy when no users are assigned.
  layersPageLink?: ReactElement | undefined;
}

const FinalScheduleSummary: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const getName: (userId: string) => string = (userId: string): string => {
    const info: UserInfo | undefined = props.userById[userId];
    return info?.name || info?.email || "Unknown user";
  };

  const getInitials: (userId: string) => string = (userId: string): string => {
    const info: UserInfo | undefined = props.userById[userId];
    return getUserInitials(info?.name || "", info?.email || "");
  };

  const current: OnCallShift | null = props.coverage.current;
  const next: OnCallShift | null = props.coverage.next;
  const gaps: Array<CoverageGap> = props.coverage.gaps;

  /*
   * Split the gaps into ones worth their own warning row and sub-minute slivers
   * (typically layers whose restriction windows are misaligned by seconds).
   * Both are counted in the coverage strip; only the first kind gets a row.
   */
  const notableGaps: Array<CoverageGap> = gaps.filter((gap: CoverageGap) => {
    return (
      OneUptimeDate.getDifferenceInSeconds(gap.end, gap.start) >=
      SHORT_GAP_SECONDS
    );
  });
  const shortGapCount: number = gaps.length - notableGaps.length;

  const upcoming: Array<OnCallShift> = props.shifts
    .filter((shift: OnCallShift) => {
      // future shifts only (the current one is already shown in the hero card)
      return props.now.getTime() < shift.start.getTime();
    })
    /*
     * Drop the first future shift: it is exactly what the "Up next" hero card
     * already shows (getCurrentAndNextShift picks the earliest future shift as
     * `next`), so listing it again here would render the same hand-off twice.
     */
    .slice(1, 7);

  const getAvatar: (userId: string, sizeClass: string) => ReactElement = (
    userId: string,
    sizeClass: string,
  ): ReactElement => {
    return (
      <span
        className={`inline-flex flex-shrink-0 items-center justify-center rounded-full font-semibold text-white ${sizeClass}`}
        style={{ backgroundColor: getColorForUserId(userId) }}
      >
        {getInitials(userId)}
      </span>
    );
  };

  /*
   * The remedy shown under "nobody is on call" depends on WHY nobody is on
   * call. Telling someone to "widen a layer's active hours" when the real
   * problem is that no user is assigned to any layer sends them to the wrong
   * screen entirely.
   */
  const getNoCoverageRemedy: () => ReactElement = (): ReactElement => {
    if (props.coverage.status === ScheduleCoverageStatus.NoUsers) {
      return (
        <p className="mt-1 text-xs text-amber-700">
          No users are assigned to any layer in this schedule, so nobody will
          ever be paged and every alert routed here will go unanswered.
          {props.layersPageLink ? (
            <> Add users on the {props.layersPageLink}.</>
          ) : null}
        </p>
      );
    }

    return (
      <p className="mt-1 text-xs text-amber-700">
        Add a 24/7 fallback layer, or widen a layer&apos;s active hours, to
        close this gap.
      </p>
    );
  };

  const getNowCard: () => ReactElement = (): ReactElement => {
    if (!current) {
      return (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-4">
          <div className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-amber-700">
            <Icon icon={IconProp.Alert} className="h-3.5 w-3.5" />
            On call right now
          </div>
          <div className="mt-2 text-sm font-medium text-amber-800">
            No one is currently on call in this schedule.
          </div>
          {getNoCoverageRemedy()}
        </div>
      );
    }

    return (
      <div className="rounded-xl border border-indigo-200 bg-indigo-50/60 p-4">
        <div className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-indigo-700">
          <span className="relative flex h-2 w-2">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-indigo-400 opacity-75" />
            <span className="relative inline-flex h-2 w-2 rounded-full bg-indigo-500" />
          </span>
          On call right now
        </div>
        <div className="mt-2.5 flex items-center gap-3">
          {getAvatar(current.userId, "h-10 w-10 text-sm")}
          <div className="min-w-0">
            <div className="truncate text-base font-semibold text-gray-900">
              {getName(current.userId)}
            </div>
            <div className="text-xs text-gray-500">
              Until {formatShiftInstant(current.end, props.timezone)}
              <span className="ml-1 text-gray-400">
                ({formatShiftDuration(props.now, current.end)} left)
              </span>
            </div>
          </div>
        </div>
      </div>
    );
  };

  const getNextCard: () => ReactElement = (): ReactElement => {
    if (!next) {
      return (
        <div className="rounded-xl border border-gray-200 bg-white p-4">
          <div className="text-xs font-semibold uppercase tracking-wide text-gray-400">
            Up next
          </div>
          <div className="mt-2 text-sm text-gray-500">
            No further hand-offs scheduled in the coming weeks.
          </div>
        </div>
      );
    }

    return (
      <div className="rounded-xl border border-gray-200 bg-white p-4">
        <div className="text-xs font-semibold uppercase tracking-wide text-gray-400">
          Up next
        </div>
        <div className="mt-2.5 flex items-center gap-3">
          {getAvatar(next.userId, "h-10 w-10 text-sm")}
          <div className="min-w-0">
            <div className="truncate text-base font-semibold text-gray-900">
              {getName(next.userId)}
            </div>
            <div className="text-xs text-gray-500">
              Starts {formatShiftInstant(next.start, props.timezone)}
              <span className="ml-1 text-gray-400">
                ({formatRelativeStart(next.start, props.now)})
              </span>
            </div>
          </div>
        </div>
      </div>
    );
  };

  /*
   * A single always-present line stating how much of the window is covered.
   * Unlike the gap rows below it, this renders even at 100% coverage — so
   * "fully covered" is an explicit statement rather than the absence of a
   * warning, which is indistinguishable from a screen that failed to load.
   */
  const getCoverageStrip: () => ReactElement = (): ReactElement => {
    const percent: number = Math.round(props.coverage.coverageRatio * 100);
    const isFullyCovered: boolean = props.coverage.gaps.length === 0;
    const windowDays: number = Math.max(
      1,
      Math.round(
        OneUptimeDate.getDifferenceInSeconds(props.windowEnd, props.now) /
          86400,
      ),
    );

    /*
     * Round-to-100 would claim full coverage for a schedule with a tiny hole,
     * which is the exact misreport this whole screen exists to prevent.
     */
    const displayPercent: number =
      !isFullyCovered && percent >= 100 ? 99 : percent;

    return (
      <div
        className={`flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-lg border px-3 py-2 text-xs ${
          isFullyCovered
            ? "border-green-200 bg-green-50 text-green-800"
            : "border-amber-200 bg-amber-50 text-amber-800"
        }`}
      >
        <span className="inline-flex items-center gap-1.5 font-semibold">
          <Icon
            icon={isFullyCovered ? IconProp.CheckCircle : IconProp.Alert}
            className="h-3.5 w-3.5"
          />
          {isFullyCovered
            ? `Fully covered for the next ${windowDays} days`
            : `${displayPercent}% covered over the next ${windowDays} days`}
        </span>
        {!isFullyCovered && (
          <span>
            {formatDurationFromSeconds(props.coverage.uncoveredSeconds)}{" "}
            uncovered across{" "}
            {props.coverage.gaps.length === 1
              ? "1 gap"
              : `${props.coverage.gaps.length} gaps`}
          </span>
        )}
      </div>
    );
  };

  const getGapWarnings: () => ReactElement = (): ReactElement => {
    /*
     * Show only the nearest few gaps so a heavily-restricted schedule does not
     * produce a wall of warnings; the coverage strip above already carries the
     * full total, so collapsing the tail here loses nothing.
     */
    const shownGaps: Array<CoverageGap> = notableGaps.slice(0, MAX_SHOWN_GAPS);
    const remaining: number = notableGaps.length - shownGaps.length;

    return (
      <div className="space-y-2">
        {shownGaps.map((gap: CoverageGap, i: number) => {
          return (
            <div
              key={`gap-${i}`}
              className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800"
            >
              <Icon
                icon={IconProp.Alert}
                className="mt-0.5 h-3.5 w-3.5 flex-shrink-0 text-amber-500"
              />
              <span>
                <span className="font-semibold">Coverage gap:</span> no one is
                on call from {formatShiftInstant(gap.start, props.timezone)} to{" "}
                {formatShiftInstant(gap.end, props.timezone)}
                <span className="ml-1 text-amber-600">
                  ({formatShiftDuration(gap.start, gap.end)})
                </span>
                .
              </span>
            </div>
          );
        })}
        {remaining > 0 && (
          <div className="text-xs text-amber-700">
            + {remaining} more coverage {remaining === 1 ? "gap" : "gaps"} in
            the coming weeks.
          </div>
        )}
        {shortGapCount > 0 && (
          <div className="text-xs text-amber-700">
            + {shortGapCount} coverage {shortGapCount === 1 ? "gap" : "gaps"}{" "}
            shorter than a minute, usually caused by layers whose active hours
            are misaligned by a few seconds.
          </div>
        )}
      </div>
    );
  };

  const getUpcomingList: () => ReactElement = (): ReactElement => {
    return (
      <div>
        <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-400">
          Upcoming hand-offs
        </div>
        <ol className="space-y-2">
          {upcoming.map((shift: OnCallShift, index: number) => {
            return (
              <li
                key={`upcoming-${index}`}
                className="flex items-center gap-3 rounded-lg border border-gray-200 bg-white px-3 py-2.5"
              >
                {getAvatar(shift.userId, "h-7 w-7 text-[10px]")}
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-semibold text-gray-900">
                    {getName(shift.userId)}
                  </div>
                  <div className="mt-0.5 text-xs text-gray-500">
                    {formatShiftInstant(shift.start, props.timezone)}
                    <span className="mx-1 text-gray-300">&rarr;</span>
                    {formatShiftInstant(shift.end, props.timezone)}
                  </div>
                </div>
                <div className="flex flex-shrink-0 flex-col items-end gap-0.5">
                  <span className="rounded-md bg-gray-50 px-2 py-0.5 text-[11px] font-medium text-gray-600 ring-1 ring-inset ring-gray-200">
                    {formatShiftDuration(shift.start, shift.end)}
                  </span>
                  <span className="text-[11px] font-medium text-gray-400">
                    {formatRelativeStart(shift.start, props.now)}
                  </span>
                </div>
              </li>
            );
          })}
        </ol>
      </div>
    );
  };

  const hasAnyShifts: boolean = props.shifts.length > 0;

  return (
    <div className="mb-4 space-y-4">
      <div className="grid gap-3 sm:grid-cols-2">
        {getNowCard()}
        {getNextCard()}
      </div>

      {getCoverageStrip()}

      {gaps.length > 0 && getGapWarnings()}

      {hasAnyShifts && upcoming.length > 0 && getUpcomingList()}
    </div>
  );
};

export default FinalScheduleSummary;
