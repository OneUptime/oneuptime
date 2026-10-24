import { StateListRow } from "../StateOrder";
import SecurityCasePriorities from "./SecurityCasePriorities";
import SecurityCaseStatuses from "./SecurityCaseStatuses";
import SecurityCaseVerdict from "../../Types/SecurityCase/SecurityCaseVerdict";
import SecurityDetectionSource, {
  SECURITY_DETECTION_SOURCES,
} from "../../Types/SecurityCase/SecurityDetectionSource";

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
  // YYYY-MM-DD, UTC.
  day: string;
  total: number;
  byKey: Record<string, number>;
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

// Every UTC day from the day of `start` to the day of `end`, oldest first.
export function daysBetween(start: Date, end: Date): Array<string> {
  const days: Array<string> = [];
  const cursor: Date = new Date(
    Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate()),
  );
  const last: string = utcDay(end);

  // Bounded: a window is never more than a year of days.
  for (let index: number = 0; index < 400; index++) {
    const day: string = utcDay(cursor);
    days.push(day);

    if (day >= last) {
      break;
    }

    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }

  return days;
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

  const caseDays: Array<string> = daysBetween(data.windowStart, data.now);
  const casesPerDay: Map<string, DayCount> = new Map();

  for (const day of caseDays) {
    casesPerDay.set(day, {
      day,
      total: 0,
      byKey: emptyCounts(priorityIds),
    });
  }

  const tacticCounts: Map<string, number> = new Map();

  for (const row of data.casesInWindow) {
    const bucket: DayCount | undefined = casesPerDay.get(
      utcDay(new Date(row.createdAt)),
    );

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

  const detectionDays: Array<string> = daysBetween(
    data.detectionWindowStart,
    data.now,
  );
  const detectionsPerDay: Map<string, DayCount> = new Map();

  for (const day of detectionDays) {
    detectionsPerDay.set(day, {
      day,
      total: 0,
      byKey: emptyCounts(SECURITY_DETECTION_SOURCES),
    });
  }

  const ruleCounts: Map<string, RuleCount> = new Map();

  for (const row of data.detectionsInWindow) {
    const bucket: DayCount | undefined = detectionsPerDay.get(
      utcDay(new Date(row.firstSeenAt)),
    );

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
    casesOpenedPerDay: caseDays.map((day: string): DayCount => {
      return casesPerDay.get(day)!;
    }),
    detectionsPerDay: detectionDays.map((day: string): DayCount => {
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
    return `${total} min`;
  }

  const hours: number = Math.floor(total / 60);
  const restMinutes: number = total % 60;

  if (hours < 24) {
    return restMinutes > 0 ? `${hours} h ${restMinutes} min` : `${hours} h`;
  }

  const days: number = Math.floor(hours / 24);
  const restHours: number = hours % 24;

  return restHours > 0 ? `${days} d ${restHours} h` : `${days} d`;
}
