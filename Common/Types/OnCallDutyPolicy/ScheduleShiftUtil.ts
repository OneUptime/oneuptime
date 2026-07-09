import CalendarEvent from "../Calendar/CalendarEvent";
import OneUptimeDate from "../Date";

/*
 * Turns the low-level calendar events produced by LayerUtil into the
 * human-readable "shifts" the on-call schedule summaries render — e.g.
 * "Alice is on call from Mon 9:00 AM to Tue 9:00 AM".
 *
 * LayerUtil emits one CalendarEvent per contiguous coverage segment. A single
 * rotation turn can therefore be split into several events (a daily 9-5
 * restriction produces one event per day), and the merged multi-layer schedule
 * interleaves events from different users/layers. These helpers collapse those
 * raw segments back into the shifts a human thinks in, and surface the gaps
 * where nobody is on call.
 *
 * Everything here is pure and timezone-agnostic: it operates on the absolute
 * instants already resolved by LayerUtil (which itself resolves restriction
 * wall-clock windows in the schedule's timezone). Rendering code decides which
 * timezone to display those instants in.
 */

// The identity of the on-call person for an event. LayerUtil stores the user id
// in CalendarEvent.title before the UI relabels it, so callers pass the events
// straight through from getEvents/getMultiLayerEvents.
export interface OnCallShift {
  userId: string;
  start: Date;
  end: Date;
  /*
   * Total ACTIVE on-call seconds inside this shift, i.e. the sum of the covered
   * segments' durations. For a contiguous shift this equals end - start. For a
   * turn merged across off-hours (mergeAcrossGaps), it is the real time on call,
   * which is smaller than the wall-clock span — so the summary can show honest
   * coverage ("40h across the week") instead of the misleading span ("4d 8h").
   */
  coverageSeconds: number;
}

export interface CoverageGap {
  start: Date;
  end: Date;
}

export interface CurrentAndNextShift {
  current: OnCallShift | null;
  next: OnCallShift | null;
}

/*
 * Two coverage segments are considered part of the same continuous shift when
 * the gap between them is below this threshold. LayerUtil starts each following
 * segment exactly one second after the previous one ends, so anything within a
 * couple of minutes is "touching"; anything larger is a genuine off-hours gap
 * (a restriction window closing, a rotation with no fallback layer, etc.).
 */
const CONTIGUITY_TOLERANCE_SECONDS: number = 90;

export default class ScheduleShiftUtil {
  /*
   * Collapse raw coverage events into shifts.
   *
   * - mergeAcrossGaps = false (default): only merges segments that actually
   *   touch, so genuine off-hours gaps remain visible. This is what the "final
   *   schedule" summary uses so it can honestly show when nobody is on call.
   * - mergeAcrossGaps = true: merges every consecutive run of the same user
   *   into a single turn, absorbing the within-turn off-hours gaps. This is what
   *   the per-layer rotation summary uses so "Alice: Mon -> Fri" reads as one
   *   rotation turn instead of five separate day rows. The turn's coverageSeconds
   *   still reflects only the real active on-call time (e.g. 5x8h, not the full
   *   Mon->Fri wall-clock span), and the summary shows the layer's active-hours
   *   window as context.
   */
  public static groupEventsIntoShifts(
    events: Array<CalendarEvent>,
    options?: { mergeAcrossGaps?: boolean | undefined } | undefined,
  ): Array<OnCallShift> {
    if (!events || events.length === 0) {
      return [];
    }

    const mergeAcrossGaps: boolean = Boolean(options?.mergeAcrossGaps);

    // Work on a copy sorted by start time; never mutate the caller's array.
    const sorted: Array<CalendarEvent> = [...events]
      .filter((event: CalendarEvent) => {
        return (
          Boolean(event.title) && Boolean(event.start) && Boolean(event.end)
        );
      })
      .sort((a: CalendarEvent, b: CalendarEvent) => {
        if (OneUptimeDate.isBefore(a.start, b.start)) {
          return -1;
        }
        if (OneUptimeDate.isAfter(a.start, b.start)) {
          return 1;
        }
        return 0;
      });

    const shifts: Array<OnCallShift> = [];

    for (const event of sorted) {
      const userId: string = event.title;
      const eventSeconds: number = OneUptimeDate.getDifferenceInSeconds(
        event.end,
        event.start,
      );
      const last: OnCallShift | undefined = shifts[shifts.length - 1];

      const sameUser: boolean = Boolean(last) && last!.userId === userId;

      const isContiguous: boolean =
        Boolean(last) &&
        OneUptimeDate.getDifferenceInSeconds(last!.end, event.start) <=
          CONTIGUITY_TOLERANCE_SECONDS &&
        OneUptimeDate.isOnOrBefore(last!.end, event.end);

      /*
       * Extend the previous shift when it belongs to the same user AND either we
       * are merging whole turns, or the two segments physically touch. Only
       * extend the end forward — never pull it backwards — so overlapping
       * segments (possible after the multi-layer priority merge) can't shrink a
       * shift. Accumulate each merged segment's own duration into coverageSeconds
       * so a turn merged across off-hours reports its real active time on call.
       */
      if (last && sameUser && (mergeAcrossGaps || isContiguous)) {
        if (OneUptimeDate.isAfter(event.end, last.end)) {
          last.end = event.end;
        }
        last.coverageSeconds += eventSeconds;
        continue;
      }

      shifts.push({
        userId,
        start: event.start,
        end: event.end,
        coverageSeconds: eventSeconds,
      });
    }

    return shifts;
  }

  /*
   * The shift that contains `now` (the person on call right now) and the first
   * shift that starts after `now` (up next). Either can be null: `current` is
   * null when nobody is on call at this instant (a coverage gap), and `next` is
   * null when the computed window does not reach far enough to include another
   * shift.
   */
  public static getCurrentAndNextShift(
    shifts: Array<OnCallShift>,
    now: Date,
  ): CurrentAndNextShift {
    let current: OnCallShift | null = null;
    let next: OnCallShift | null = null;

    for (const shift of shifts) {
      const hasStarted: boolean = OneUptimeDate.isOnOrBefore(shift.start, now);
      const hasNotEnded: boolean = OneUptimeDate.isAfter(shift.end, now);

      if (hasStarted && hasNotEnded) {
        current = shift;
        continue;
      }

      if (OneUptimeDate.isAfter(shift.start, now)) {
        if (!next || OneUptimeDate.isBefore(shift.start, next.start)) {
          next = shift;
        }
      }
    }

    return { current, next };
  }

  /*
   * Periods inside [windowStart, windowEnd] during which no shift provides
   * coverage. Includes a leading gap (from windowStart until the first shift
   * begins) and gaps between consecutive shifts. Trailing time after the last
   * shift is intentionally NOT reported as a gap: the summary window is finite,
   * so "nothing scheduled past the window" is an artifact of the window, not a
   * real coverage hole.
   *
   * `shifts` are assumed sorted by start (as returned by groupEventsIntoShifts).
   */
  public static getCoverageGaps(
    shifts: Array<OnCallShift>,
    windowStart: Date,
    windowEnd: Date,
  ): Array<CoverageGap> {
    const gaps: Array<CoverageGap> = [];

    if (OneUptimeDate.isOnOrAfter(windowStart, windowEnd)) {
      return gaps;
    }

    // A gap only "counts" when it is longer than the contiguity tolerance, so
    // the one-second boundaries LayerUtil leaves between segments never show up
    // as spurious coverage holes.
    const isRealGap: (start: Date, end: Date) => boolean = (
      start: Date,
      end: Date,
    ): boolean => {
      return (
        OneUptimeDate.isAfter(end, start) &&
        OneUptimeDate.getDifferenceInSeconds(end, start) >
          CONTIGUITY_TOLERANCE_SECONDS
      );
    };

    if (shifts.length === 0) {
      if (isRealGap(windowStart, windowEnd)) {
        gaps.push({ start: windowStart, end: windowEnd });
      }
      return gaps;
    }

    // Leading gap: nobody on call from the window start until the first shift.
    const firstShift: OnCallShift = shifts[0]!;
    if (
      OneUptimeDate.isAfter(firstShift.start, windowStart) &&
      isRealGap(windowStart, firstShift.start)
    ) {
      gaps.push({ start: windowStart, end: firstShift.start });
    }

    // `coveredUntil` tracks the furthest point covered so far. Shifts can
    // overlap (multi-layer merges), so we advance it monotonically and only
    // record a gap when the next shift starts strictly after it.
    let coveredUntil: Date = firstShift.end;

    for (let i: number = 1; i < shifts.length; i++) {
      const shift: OnCallShift = shifts[i]!;

      if (
        OneUptimeDate.isAfter(shift.start, coveredUntil) &&
        isRealGap(coveredUntil, shift.start)
      ) {
        gaps.push({ start: coveredUntil, end: shift.start });
      }

      if (OneUptimeDate.isAfter(shift.end, coveredUntil)) {
        coveredUntil = shift.end;
      }
    }

    return gaps;
  }
}
