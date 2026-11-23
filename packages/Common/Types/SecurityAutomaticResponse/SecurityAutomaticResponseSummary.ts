import { SecurityAutomaticResponseOutcome } from "./SecurityAutomaticResponseOutcome";

/*
 * WHAT A POLICY'S PAGE SAYS OF IT (#10350): its trial run's summary, and
 * its time to block. Pure, from the policy's actions, so the server reads
 * the rows once and the rules are pinned in plain tests.
 *
 *   "In 7 days this would have challenged 1,283 addresses. None had
 *   signed-in users, and none were yours."
 */

// An action as the summaries read it.
export interface SecurityAutomaticResponseSummaryRow {
  value?: string | null | undefined;
  outcome?: SecurityAutomaticResponseOutcome | string | null | undefined;
  doubtSeenAt?: Date | string | null | undefined;
  appliedAt?: Date | string | null | undefined;
  timeToBlockInSeconds?: number | null | undefined;
}

// What a trial run would have done, address by address.
export interface SecurityAutomaticResponseTrialSummary {
  // The addresses it would have challenged or blocked.
  wouldActOn: number;
  // ...and that a signed-in user was seen from after, so it would have lifted the block.
  wouldHaveLifted: number;
  // The addresses it left alone: a signed-in user had used them.
  sparedSignedIn: number;
  // ...one of the project's own or protected addresses.
  sparedProtected: number;
  // ...OneUptime could not tell whether a signed-in user had.
  sparedCannotTell: number;
  // The times it would have stopped at the hourly limit, and paged.
  wouldHaveStopped: number;
}

function distinctValues(
  rows: ReadonlyArray<SecurityAutomaticResponseSummaryRow>,
  test: (row: SecurityAutomaticResponseSummaryRow) => boolean,
): number {
  const values: Set<string> = new Set();

  for (const row of rows) {
    if (row.value && test(row)) {
      values.add(row.value);
    }
  }

  return values.size;
}

// A trial run's actions, as its summary counts them: each address once.
export function summarizeSecurityAutomaticResponseTrial(
  rows: ReadonlyArray<SecurityAutomaticResponseSummaryRow>,
): SecurityAutomaticResponseTrialSummary {
  const isActed: (row: SecurityAutomaticResponseSummaryRow) => boolean = (
    row: SecurityAutomaticResponseSummaryRow,
  ): boolean => {
    return (
      row.outcome === SecurityAutomaticResponseOutcome.Challenged ||
      row.outcome === SecurityAutomaticResponseOutcome.Blocked
    );
  };

  return {
    wouldActOn: distinctValues(rows, isActed),
    wouldHaveLifted: distinctValues(
      rows,
      (row: SecurityAutomaticResponseSummaryRow): boolean => {
        return isActed(row) && Boolean(row.doubtSeenAt);
      },
    ),
    sparedSignedIn: distinctValues(
      rows,
      (row: SecurityAutomaticResponseSummaryRow): boolean => {
        return row.outcome === SecurityAutomaticResponseOutcome.SparedSignedIn;
      },
    ),
    sparedProtected: distinctValues(
      rows,
      (row: SecurityAutomaticResponseSummaryRow): boolean => {
        return row.outcome === SecurityAutomaticResponseOutcome.SparedProtected;
      },
    ),
    sparedCannotTell: distinctValues(
      rows,
      (row: SecurityAutomaticResponseSummaryRow): boolean => {
        return (
          row.outcome === SecurityAutomaticResponseOutcome.SparedCannotTell
        );
      },
    ),
    wouldHaveStopped: rows.filter(
      (row: SecurityAutomaticResponseSummaryRow): boolean => {
        return row.outcome === SecurityAutomaticResponseOutcome.StoppedAtLimit;
      },
    ).length,
  };
}

/*
 * The value at a percentile of the sorted values, by nearest rank: the
 * smallest value at least `percentile` percent of them are no greater
 * than. Null for no values.
 */
export function getPercentile(
  sortedValues: ReadonlyArray<number>,
  percentile: number,
): number | null {
  if (sortedValues.length === 0) {
    return null;
  }

  const rank: number = Math.ceil((percentile / 100) * sortedValues.length);

  return sortedValues[Math.min(sortedValues.length, Math.max(1, rank)) - 1]!;
}

// Time to block over a day, or over the whole window.
export interface SecurityAutomaticResponseTimeToBlockStats {
  count: number;
  p50InSeconds: number | null;
  p95InSeconds: number | null;
}

export interface SecurityAutomaticResponseTimeToBlockDay
  extends SecurityAutomaticResponseTimeToBlockStats {
  // The day, in UTC: "2026-11-22".
  day: string;
}

export interface SecurityAutomaticResponseTimeToBlock
  extends SecurityAutomaticResponseTimeToBlockStats {
  // Every day of the window, the oldest first; a day with no block has no percentiles.
  days: Array<SecurityAutomaticResponseTimeToBlockDay>;
}

// The 50th and 95th percentiles of some times to block.
export function getTimeToBlockStats(
  seconds: ReadonlyArray<number>,
): SecurityAutomaticResponseTimeToBlockStats {
  const sorted: Array<number> = seconds
    .filter((value: number): boolean => {
      return Number.isFinite(value) && value >= 0;
    })
    .sort((a: number, b: number): number => {
      return a - b;
    });

  return {
    count: sorted.length,
    p50InSeconds: getPercentile(sorted, 50),
    p95InSeconds: getPercentile(sorted, 95),
  };
}

function dayOf(time: number): string {
  return new Date(time).toISOString().slice(0, 10);
}

/*
 * Time to block over the `days` days to `now`, and day by day: each block
 * that took hold counts on the day it took hold.
 */
export function summarizeTimeToBlock(data: {
  rows: ReadonlyArray<SecurityAutomaticResponseSummaryRow>;
  now: Date;
  days: number;
}): SecurityAutomaticResponseTimeToBlock {
  const dayInMs: number = 24 * 60 * 60 * 1000;
  const today: number = Date.parse(`${dayOf(data.now.getTime())}T00:00:00Z`);
  const firstDay: number = today - (Math.max(1, data.days) - 1) * dayInMs;
  const byDay: Map<string, Array<number>> = new Map();
  const all: Array<number> = [];

  for (const row of data.rows) {
    if (
      row.timeToBlockInSeconds === null ||
      row.timeToBlockInSeconds === undefined ||
      !row.appliedAt
    ) {
      continue;
    }

    const appliedAt: number = new Date(row.appliedAt).getTime();

    if (!Number.isFinite(appliedAt) || appliedAt < firstDay) {
      continue;
    }

    const day: string = dayOf(appliedAt);
    byDay.set(day, [...(byDay.get(day) || []), row.timeToBlockInSeconds]);
    all.push(row.timeToBlockInSeconds);
  }

  const days: Array<SecurityAutomaticResponseTimeToBlockDay> = [];

  for (let time: number = firstDay; time <= today; time += dayInMs) {
    const day: string = dayOf(time);

    days.push({ day, ...getTimeToBlockStats(byDay.get(day) || []) });
  }

  return { ...getTimeToBlockStats(all), days };
}
