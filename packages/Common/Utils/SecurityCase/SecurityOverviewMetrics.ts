import { StateListRow } from "../StateOrder";
import SecurityCasePriorities from "./SecurityCasePriorities";
import SecurityCaseStatuses from "./SecurityCaseStatuses";
import AggregationInterval from "../../Types/BaseDatabase/AggregationInterval";
import AggregationIntervalUtil from "../../Types/BaseDatabase/AggregationIntervalUtil";
import OneUptimeDate from "../../Types/Date";
import SecurityCaseVerdict from "../../Types/SecurityCase/SecurityCaseVerdict";
import SecurityDetectionSource, {
  SECURITY_DETECTION_SOURCES,
} from "../../Types/SecurityCase/SecurityDetectionSource";
import Timezone from "../../Types/Timezone";
import TimezoneAlias from "../../Types/TimezoneAlias";

/*
 * The security overview's numbers, worked out from rows of cases and
 * detections. Pure, so the dashboard's figures are tested apart from the
 * database, and the server and the tests agree on what "mean time to
 * close" means:
 *
 *  - Time to acknowledge: from a case opening to somebody taking it on
 *    (assigning a person, or moving it to a status that counts as
 *    acknowledged).
 *  - Time to contain: from opening to a status that counts as contained.
 *  - Time to close: from opening to a status that counts as closed.
 *
 * Each mean is over the cases opened in the window that got that far; a
 * case still waiting does not drag the mean either way (the open counts say
 * how many are waiting).
 *
 * Priorities and statuses are the project's own: counted by id, in the
 * project's order, and read by what each counts as (SecurityCasePriorities,
 * SecurityCaseStatuses), never by name.
 */

export interface OverviewCaseRow {
  createdAt: Date;
  // The ids of the case's priority and status.
  priorityId: string | undefined;
  statusId: string | undefined;
  verdict?: SecurityCaseVerdict | string | undefined | null;
  assignedToUserId?: string | undefined | null;
  assignedToTeamId?: string | undefined | null;
  acknowledgedAt?: Date | undefined | null;
  containedAt?: Date | undefined | null;
  closedAt?: Date | undefined | null;
  mitreTactics?: Array<string> | undefined | null;
}

export interface OverviewDetectionRow {
  firstSeenAt: Date;
  source: SecurityDetectionSource | string | undefined;
  ruleName?: string | undefined | null;
  detectionRuleId?: string | undefined | null;
  fireCount?: number | undefined;
}

export interface DayCount {
  /*
   * YYYY-MM-DD: a day of the reader's calendar, in the zone the overview
   * was asked for (issue #7925), or a UTC day when it named none.
   */
  day: string;
  total: number;
  byKey: Record<string, number>;
}

// A day of a calendar: its YYYY-MM-DD, and the instants it starts and ends.
export interface CalendarDay {
  day: string;
  startMs: number;
  endMs: number;
}

export interface RuleCount {
  ruleName: string;
  detectionRuleId: string | null;
  count: number;
}

export interface TacticCount {
  tacticId: string;
  count: number;
}

export interface SecurityOverviewMetrics {
  openCases: number;
  unassignedOpenCases: number;
  // By priority id, every priority of the project's, most urgent first.
  openByPriority: Record<string, number>;
  // By status id, every status a case is open in, in the project's order.
  openByStatus: Record<string, number>;
  // Open cases at or above the critical priority.
  criticalOpenCases: number;
  // Open cases at or above the high priority, below the critical one.
  highOpenCases: number;
  casesOpenedInWindow: number;
  casesClosedInWindow: number;
  verdictsInWindow: Record<string, number>;
  meanTimeToAcknowledgeInMinutes: number | null;
  meanTimeToContainInMinutes: number | null;
  meanTimeToCloseInMinutes: number | null;
  casesOpenedPerDay: Array<DayCount>;
  detectionsPerDay: Array<DayCount>;
  detectionsInWindow: number;
  topRules: Array<RuleCount>;
  topTactics: Array<TacticCount>;
}

const MINUTE_IN_MS: number = 60 * 1000;

export function utcDay(date: Date): string {
  return date.toISOString().slice(0, 10);
}

// The zone the days are cut in, by its current name: UTC when none is given.
function calendarZoneOf(timezone: Timezone | undefined): Timezone {
  return timezone ? TimezoneAlias.getCanonicalTimezone(timezone) : Timezone.UTC;
}

/*
 * The day `date` falls on in `timezone`, as YYYY-MM-DD: the reader's own day
 * where the overview was asked in their zone, the UTC day where it was not.
 * In New York a case opened at 20:00 on 4 November is on 4 November, not on
 * the 5th, which is the UTC day it falls on.
 */
export function dayInTimezone(
  date: Date,
  timezone?: Timezone | undefined,
): string {
  if (!timezone) {
    return utcDay(date);
  }

  return OneUptimeDate.getDateAsCustomFormattedStringInTimezone({
    date: date,
    format: "YYYY-MM-DD",
    timezone: calendarZoneOf(timezone),
  });
}

/*
 * Every day from the one `start` falls on to the one `end` falls on, in
 * `timezone` (UTC's when none is given), oldest first, with the instants
 * each starts and ends at. Each day starts where the one before it ends
 * (AggregationIntervalUtil.getBucketEnd, as the server's day buckets are
 * walked): 23 or 25 hours on where the clocks change, so no day is drawn
 * twice, and none is skipped.
 */
export function calendarDaysBetween(
  start: Date,
  end: Date,
  timezone?: Timezone | undefined,
): Array<CalendarDay> {
  const zone: Timezone = calendarZoneOf(timezone);
  const days: Array<CalendarDay> = [];
  const lastMs: number = end.getTime();
  let startMs: number = OneUptimeDate.getStartOfDay(start, zone).getTime();

  // Bounded: a window is never more than a year of days.
  for (
    let index: number = 0;
    index < 400 && Number.isFinite(startMs);
    index++
  ) {
    const endMs: number = AggregationIntervalUtil.getBucketEnd({
      bucketStart: new Date(startMs),
      interval: AggregationInterval.Day,
      timezone: zone,
    }).getTime();

    days.push({
      day: dayInTimezone(new Date(startMs), zone),
      startMs: startMs,
      endMs: endMs,
    });

    if (!(endMs <= lastMs)) {
      break;
    }

    startMs = endMs;
  }

  return days;
}

/*
 * The last `count` days of the reader's calendar, in `timezone` (UTC's when
 * none is given), oldest first and today's the last: "the last 30 days" of
 * a chart of a bar a day, each bar a whole day. The first starts at the
 * reader's midnight `count` - 1 days before today's, stepped in that zone.
 * Read from `now` - 30 x 24 hours instead, the Security overview drew 31
 * bars, the first holding only the part of its day after that instant
 * (issue #8474).
 */
export function getLastCalendarDays(
  now: Date,
  count: number,
  timezone?: Timezone | undefined,
): Array<CalendarDay> {
  const days: number = Math.max(1, Math.trunc(count) || 1);

  return calendarDaysBetween(
    OneUptimeDate.addRemoveDays(now, -(days - 1), calendarZoneOf(timezone)),
    now,
    timezone,
  ).slice(-days);
}

/*
 * Every day from the day of `start` to the day of `end`, oldest first: the
 * reader's days in `timezone`, UTC's when none is given.
 */
export function daysBetween(
  start: Date,
  end: Date,
  timezone?: Timezone | undefined,
): Array<string> {
  return calendarDaysBetween(start, end, timezone).map(
    (day: CalendarDay): string => {
      return day.day;
    },
  );
}

/*
 * The day of `days` (oldest first, one after another) that `date` falls in,
 * or undefined when it is before the first or from the end of the last.
 */
export function findCalendarDay(
  days: ReadonlyArray<CalendarDay>,
  date: Date,
): CalendarDay | undefined {
  const ms: number = new Date(date).getTime();
  let low: number = 0;
  let high: number = days.length - 1;

  while (low <= high) {
    const middle: number = Math.floor((low + high) / 2);
    const day: CalendarDay = days[middle]!;

    if (ms < day.startMs) {
      high = middle - 1;
    } else if (ms >= day.endMs) {
      low = middle + 1;
    } else {
      return day;
    }
  }

  return undefined;
}

function emptyCounts(keys: ReadonlyArray<string>): Record<string, number> {
  const counts: Record<string, number> = {};

  for (const key of keys) {
    counts[key] = 0;
  }

  return counts;
}

function meanMinutes(durationsInMs: Array<number>): number | null {
  const valid: Array<number> = durationsInMs.filter(
    (value: number): boolean => {
      return Number.isFinite(value) && value >= 0;
    },
  );

  if (valid.length === 0) {
    return null;
  }

  const total: number = valid.reduce((sum: number, value: number): number => {
    return sum + value;
  }, 0);

  return Math.round(total / valid.length / MINUTE_IN_MS);
}

function durationsTo(
  rows: Array<OverviewCaseRow>,
  pick: (row: OverviewCaseRow) => Date | undefined | null,
): Array<number> {
  const durations: Array<number> = [];

  for (const row of rows) {
    const reachedAt: Date | undefined | null = pick(row);

    if (reachedAt) {
      durations.push(
        new Date(reachedAt).getTime() - new Date(row.createdAt).getTime(),
      );
    }
  }

  return durations;
}

// The ids of the rows, in the order given.
function idsOf(rows: Array<StateListRow>): Array<string> {
  return rows.map((row: StateListRow): string => {
    return row.id;
  });
}

export function computeSecurityOverviewMetrics(data: {
  // The project's case priorities and statuses: models or their JSON.
  priorities: ReadonlyArray<unknown>;
  statuses: ReadonlyArray<unknown>;
  // Every open case (whenever it opened), for the queue's counts.
  openCases: Array<OverviewCaseRow>;
  // Every case opened in the window, for the mean times and the trend.
  casesInWindow: Array<OverviewCaseRow>;
  // Every detection first seen in the detection window.
  detectionsInWindow: Array<OverviewDetectionRow>;
  windowStart: Date;
  detectionWindowStart: Date;
  now: Date;
  topLimit?: number | undefined;
  /*
   * The zone the reader's days are in (the page's, issue #7925): each case
   * and detection counts on the day it happened there, and the bars walk
   * those days. Undefined - an older Dashboard, a zone the list does not
   * name - is UTC's days, as before.
   */
  timezone?: Timezone | undefined;
}): SecurityOverviewMetrics {
  const topLimit: number = data.topLimit || 8;

  const priorityIds: Array<string> = idsOf(
    SecurityCasePriorities.toRows(SecurityCasePriorities.sort(data.priorities)),
  );
  const openStatusIds: Array<string> = SecurityCaseStatuses.getOpenStatusIds(
    data.statuses,
  );

  const openByPriority: Record<string, number> = emptyCounts(priorityIds);
  const openByStatus: Record<string, number> = emptyCounts(openStatusIds);
  let unassignedOpenCases: number = 0;
  let criticalOpenCases: number = 0;
  let highOpenCases: number = 0;

  for (const row of data.openCases) {
    if (row.priorityId && openByPriority[row.priorityId] !== undefined) {
      openByPriority[row.priorityId]!++;
    }

    if (row.statusId && openByStatus[row.statusId] !== undefined) {
      openByStatus[row.statusId]!++;
    }

    if (SecurityCasePriorities.isCritical(data.priorities, row.priorityId)) {
      criticalOpenCases++;
    } else if (
      SecurityCasePriorities.isUrgent(data.priorities, row.priorityId)
    ) {
      highOpenCases++;
    }

    if (!row.assignedToUserId) {
      unassignedOpenCases++;
    }
  }

  const verdictsInWindow: Record<string, number> = emptyCounts(
    Object.values(SecurityCaseVerdict),
  );
  let casesClosedInWindow: number = 0;

  for (const row of data.casesInWindow) {
    if (SecurityCaseStatuses.isClosed(data.statuses, row.statusId)) {
      casesClosedInWindow++;

      const verdict: string = row.verdict || SecurityCaseVerdict.Undetermined;

      if (verdictsInWindow[verdict] !== undefined) {
        verdictsInWindow[verdict]!++;
      }
    }
  }

  const caseDays: Array<CalendarDay> = calendarDaysBetween(
    data.windowStart,
    data.now,
    data.timezone,
  );
  const casesPerDay: Map<string, DayCount> = new Map();

  for (const { day } of caseDays) {
    casesPerDay.set(day, {
      day,
      total: 0,
      byKey: emptyCounts(priorityIds),
    });
  }

  const tacticCounts: Map<string, number> = new Map();

  for (const row of data.casesInWindow) {
    const openedOn: CalendarDay | undefined = findCalendarDay(
      caseDays,
      new Date(row.createdAt),
    );
    const bucket: DayCount | undefined = openedOn
      ? casesPerDay.get(openedOn.day)
      : undefined;

    if (bucket) {
      bucket.total++;

      if (row.priorityId && bucket.byKey[row.priorityId] !== undefined) {
        bucket.byKey[row.priorityId]!++;
      }
    }

    for (const tactic of row.mitreTactics || []) {
      tacticCounts.set(tactic, (tacticCounts.get(tactic) || 0) + 1);
    }
  }

  const detectionDays: Array<CalendarDay> = calendarDaysBetween(
    data.detectionWindowStart,
    data.now,
    data.timezone,
  );
  const detectionsPerDay: Map<string, DayCount> = new Map();

  for (const { day } of detectionDays) {
    detectionsPerDay.set(day, {
      day,
      total: 0,
      byKey: emptyCounts(SECURITY_DETECTION_SOURCES),
    });
  }

  const ruleCounts: Map<string, RuleCount> = new Map();

  for (const row of data.detectionsInWindow) {
    const firstSeenOn: CalendarDay | undefined = findCalendarDay(
      detectionDays,
      new Date(row.firstSeenAt),
    );
    const bucket: DayCount | undefined = firstSeenOn
      ? detectionsPerDay.get(firstSeenOn.day)
      : undefined;

    if (bucket) {
      bucket.total++;

      if (row.source && bucket.byKey[row.source] !== undefined) {
        bucket.byKey[row.source]!++;
      }
    }

    const ruleName: string = (row.ruleName || "").trim();

    if (ruleName) {
      const key: string = row.detectionRuleId || `name:${ruleName}`;
      const known: RuleCount | undefined = ruleCounts.get(key);

      if (known) {
        known.count++;
      } else {
        ruleCounts.set(key, {
          ruleName,
          detectionRuleId: row.detectionRuleId || null,
          count: 1,
        });
      }
    }
  }

  return {
    openCases: data.openCases.length,
    unassignedOpenCases,
    openByPriority,
    openByStatus,
    criticalOpenCases,
    highOpenCases,
    casesOpenedInWindow: data.casesInWindow.length,
    casesClosedInWindow,
    verdictsInWindow,
    meanTimeToAcknowledgeInMinutes: meanMinutes(
      durationsTo(data.casesInWindow, (row: OverviewCaseRow) => {
        return row.acknowledgedAt;
      }),
    ),
    meanTimeToContainInMinutes: meanMinutes(
      durationsTo(data.casesInWindow, (row: OverviewCaseRow) => {
        return row.containedAt;
      }),
    ),
    meanTimeToCloseInMinutes: meanMinutes(
      durationsTo(data.casesInWindow, (row: OverviewCaseRow) => {
        return row.closedAt;
      }),
    ),
    casesOpenedPerDay: caseDays.map(({ day }: CalendarDay): DayCount => {
      return casesPerDay.get(day)!;
    }),
    detectionsPerDay: detectionDays.map(({ day }: CalendarDay): DayCount => {
      return detectionsPerDay.get(day)!;
    }),
    detectionsInWindow: data.detectionsInWindow.length,
    topRules: Array.from(ruleCounts.values())
      .sort((a: RuleCount, b: RuleCount): number => {
        return b.count - a.count || a.ruleName.localeCompare(b.ruleName);
      })
      .slice(0, topLimit),
    topTactics: Array.from(tacticCounts.entries())
      .map(([tacticId, count]: [string, number]): TacticCount => {
        return { tacticId, count };
      })
      .sort((a: TacticCount, b: TacticCount): number => {
        return b.count - a.count || a.tacticId.localeCompare(b.tacticId);
      })
      .slice(0, topLimit),
  };
}

/*
 * A duration for a person: "45 min", "3 h 20 min", "2 d 4 h". Null (nothing
 * measured yet) reads as a dash.
 */
export function formatDurationInMinutes(minutes: number | null): string {
  if (minutes === null || !Number.isFinite(minutes)) {
    return "—";
  }

  const total: number = Math.max(0, Math.round(minutes));

  if (total < 60) {
    return `${total}\u00A0min`;
  }

  const hours: number = Math.floor(total / 60);
  const restMinutes: number = total % 60;

  if (hours < 24) {
    return restMinutes > 0
      ? `${hours}\u00A0h ${restMinutes}\u00A0min`
      : `${hours}\u00A0h`;
  }

  const days: number = Math.floor(hours / 24);
  const restHours: number = hours % 24;

  return restHours > 0
    ? `${days}\u00A0d ${restHours}\u00A0h`
    : `${days}\u00A0d`;
}
