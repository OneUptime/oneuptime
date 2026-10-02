import OneUptimeDate from "../../Types/Date";
import useClockTick from "./UseClockTick";

/*
 * ---------------------------------------------------------------------------
 * How long something has lasted, counting up while it is still going on
 * ---------------------------------------------------------------------------
 *
 * Every status and state timeline (monitors, incidents, alerts, their
 * episodes, scheduled maintenance, network sites) shows a duration per row.
 * A finished row is start to end. A row with no end is the state that is in
 * effect right now, and its duration is start to NOW - which used to be read
 * once, at render, so it sat still until the page was reloaded.
 *
 * useLiveDuration is the one place that works the duration out for both kinds
 * of row, so a live row and a finished one are worded identically by
 * construction. Only a live row ticks: useClockTick is switched off for a
 * finished one, so a table of fifty finished rows arms no timers at all, and
 * the second-by-second re-render stays inside the one cell that uses this.
 */

// A start or end as a row may hold it: a Date, an ISO string, or nothing.
export type LiveDurationDate = Date | string | null | undefined;

export interface UseLiveDurationProps {
  // When the state began. Without one there is no duration to show.
  startDate: LiveDurationDate;
  // When it ended. Absent means it is still in effect and still counting.
  endDate?: LiveDurationDate | undefined;
}

export interface LiveDuration {
  // Started and not ended: the duration counts up once a second.
  isLive: boolean;
  /*
   * Whole seconds from the start to the end, or to now while live. Never
   * negative: a start a little ahead of this browser's clock reads as zero
   * until the clock catches up. Null when there is no start.
   */
  durationInSeconds: number | null;
  // The timelines' wording, e.g. "2 mins 54 secs". Empty when there is no start.
  formattedDuration: string;
}

/*
 * The one duration the timelines' wording leaves blank. A live row is zero
 * seconds old for its whole first second, and a blank cell there reads as
 * "unknown" rather than "just started".
 */
export const ZERO_DURATION_TEXT: string = "0 secs";

export type ParseLiveDurationDateFunction = (
  date: LiveDurationDate,
) => Date | null;

// A usable Date, or null for a missing or unparseable value.
export const parseLiveDurationDate: ParseLiveDurationDateFunction = (
  date: LiveDurationDate,
): Date | null => {
  if (!date) {
    return null;
  }

  const parsed: Date = OneUptimeDate.fromString(date);

  if (isNaN(parsed.getTime())) {
    return null;
  }

  return parsed;
};

export type FormatDurationInSecondsFunction = (seconds: number) => string;

// "2 mins 54 secs" - OneUptimeDate's wording, which the finished rows use.
export const formatDurationInSeconds: FormatDurationInSecondsFunction = (
  seconds: number,
): string => {
  if (!isFinite(seconds) || seconds <= 0) {
    return ZERO_DURATION_TEXT;
  }

  return OneUptimeDate.secondsToFormattedFriendlyTimeString(
    Math.floor(seconds),
  );
};

export interface GetLiveDurationData extends UseLiveDurationProps {
  // What "now" is for a live row. Unused once the row has an end.
  now: Date;
}

export type GetLiveDurationFunction = (
  data: GetLiveDurationData,
) => LiveDuration;

/*
 * The duration at one instant, with no clock of its own: what the hook
 * renders on every tick, and what a CSV export writes for the same row.
 */
export const getLiveDuration: GetLiveDurationFunction = (
  data: GetLiveDurationData,
): LiveDuration => {
  const startDate: Date | null = parseLiveDurationDate(data.startDate);

  if (!startDate) {
    return {
      isLive: false,
      durationInSeconds: null,
      formattedDuration: "",
    };
  }

  const endDate: Date | null = parseLiveDurationDate(data.endDate);

  const durationInSeconds: number = Math.max(
    0,
    OneUptimeDate.getSecondsBetweenTwoDates(startDate, endDate || data.now),
  );

  return {
    isLive: !endDate,
    durationInSeconds: durationInSeconds,
    formattedDuration: formatDurationInSeconds(durationInSeconds),
  };
};

export type UseLiveDurationFunction = (
  props: UseLiveDurationProps,
) => LiveDuration;

/**
 * The duration from `startDate` to `endDate`, or - while there is no end -
 * to now, re-read on every second boundary.
 *
 * The ticking stops on its own when an end date arrives (the next refresh of
 * the row brings one in) and when the component using it unmounts.
 */
const useLiveDuration: UseLiveDurationFunction = (
  props: UseLiveDurationProps,
): LiveDuration => {
  const isRunning: boolean =
    Boolean(parseLiveDurationDate(props.startDate)) &&
    !parseLiveDurationDate(props.endDate);

  const now: Date = useClockTick(true, { isEnabled: isRunning });

  return getLiveDuration({
    startDate: props.startDate,
    endDate: props.endDate,
    now: now,
  });
};

export default useLiveDuration;
