/*
 * HOW LONG A PERSON WAS ON CALL IN A RANGE: what User On-Call Time
 * (On-Call → Reports) adds up from their on-call time logs
 * (OnCallDutyPolicyTimeLog), each a stint from when they went on call to
 * when they came off.
 *
 *   - A stint counts only inside the range: it is cut at the range's start
 *     and end. A stint that ended before the range starts, or starts after
 *     it ends, counts nothing. The report used to cut such a stint into a
 *     period that ends before it starts, and count its length all the same:
 *     every stint someone had before the range made their time in it
 *     longer, by the time from that stint's end to the range's start
 *     (#11023). Ending the stints deleted policies had left open made
 *     every one of them such a stint.
 *   - A stint still going on (no end) counts up to now.
 *   - Time on call through two policies at once counts once: a person's
 *     stints that overlap are merged before they are added up.
 *
 * Whole minutes, each merged stretch rounded down, as the report always
 * counted them.
 */

// One stint on call: when it started, and when it ended (none while it goes on).
export interface OnCallStint {
  startsAt: Date;
  endsAt?: Date | null | undefined;
}

// The range a report adds up, from its start to its end.
export interface OnCallTimeRange {
  startsAt: Date;
  endsAt: Date;
}

// A stretch of time on call, in milliseconds since 1970.
interface Stretch {
  start: number;
  end: number;
}

const MILLISECONDS_IN_A_MINUTE: number = 60 * 1000;

/*
 * The stretches the stints cover inside the range, merged where they
 * overlap or touch, in order: what the person was on call for in it.
 */
export function getOnCallStretchesInRange(data: {
  stints: ReadonlyArray<OnCallStint>;
  range: OnCallTimeRange;
  now: Date;
}): Array<OnCallTimeRange> {
  const rangeStart: number = data.range.startsAt.getTime();
  const rangeEnd: number = data.range.endsAt.getTime();

  // Each stint cut to the range; one with nothing left in it counts nothing.
  const stretches: Array<Stretch> = [];

  for (const stint of data.stints) {
    // A stint still going on counts up to now.
    const stintEnd: Date = stint.endsAt || data.now;

    const start: number = Math.max(stint.startsAt.getTime(), rangeStart);
    const end: number = Math.min(stintEnd.getTime(), rangeEnd);

    if (!(end > start)) {
      continue;
    }

    stretches.push({ start, end });
  }

  stretches.sort((a: Stretch, b: Stretch): number => {
    return a.start - b.start;
  });

  // Merge overlapping time periods: time on call through two policies at once counts once.
  const merged: Array<Stretch> = [];

  for (const stretch of stretches) {
    const last: Stretch | undefined = merged[merged.length - 1];

    if (last && stretch.start <= last.end) {
      last.end = Math.max(last.end, stretch.end);
      continue;
    }

    merged.push({ start: stretch.start, end: stretch.end });
  }

  return merged.map((stretch: Stretch): OnCallTimeRange => {
    return {
      startsAt: new Date(stretch.start),
      endsAt: new Date(stretch.end),
    };
  });
}

// The person's whole minutes on call in the range, from their stints.
export function getMinutesOnCallInRange(data: {
  stints: ReadonlyArray<OnCallStint>;
  range: OnCallTimeRange;
  now: Date;
}): number {
  let minutes: number = 0;

  for (const stretch of getOnCallStretchesInRange(data)) {
    minutes += Math.floor(
      (stretch.endsAt.getTime() - stretch.startsAt.getTime()) /
        MILLISECONDS_IN_A_MINUTE,
    );
  }

  return minutes;
}
