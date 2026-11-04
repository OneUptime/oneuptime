import { DataObservabilityMetricName } from "./DataObservabilityMetric";

/*
 * WHAT PEOPLE SAY ABOUT A DATA ALERT, AND WHAT IT IS WORTH.
 *
 * Whoever handles a data alert can say it was useful, expected (a planned
 * backfill), or not an issue at all. The last retunes what raised it, so the
 * same thing stays quiet next time. Together with whether its likely cause
 * was the real one, how late it was seen, and whether people had to report a
 * problem before OneUptime did, this is how the product measures itself.
 */

export enum DataAlertFeedback {
  Useful = "Useful",
  Expected = "Expected",
  NotAnIssue = "Not an Issue",
}

export const DATA_ALERT_FEEDBACK_VALUES: ReadonlyArray<DataAlertFeedback> = [
  DataAlertFeedback.Useful,
  DataAlertFeedback.Expected,
  DataAlertFeedback.NotAnIssue,
];

export function isNoiseFeedback(
  feedback: DataAlertFeedback | string | null | undefined,
): boolean {
  return (
    feedback === DataAlertFeedback.Expected ||
    feedback === DataAlertFeedback.NotAnIssue
  );
}

// How far one "not an issue" moves a table's usual interval, and its allowed row-count change.
export const LATE_FEEDBACK_INTERVAL_FACTOR: number = 1.5;
export const ROW_COUNT_TOLERANCE_START_PERCENT: number = 50;
export const ROW_COUNT_TOLERANCE_STEP_PERCENT: number = 15;
export const ROW_COUNT_TOLERANCE_MAX_PERCENT: number = 95;

export interface DataAlertRetune {
  updateIntervalInSeconds?: number | undefined;
  rowCountChangeTolerancePercent?: number | undefined;
}

/*
 * What "not an issue" changes for the table an alert is about, by what the
 * alert measured. "Expected" changes nothing: it was one planned event, and
 * the next one like it should still be raised. A late table's usual interval
 * grows, and keeps learning from there, so the change fades if the table
 * goes back to its old rhythm.
 */
export function planDataAlertRetune(data: {
  feedback: DataAlertFeedback;
  metricName: string | null;
  updateIntervalInSeconds: number | null | undefined;
  rowCountChangeTolerancePercent: number | null | undefined;
}): DataAlertRetune | null {
  if (data.feedback !== DataAlertFeedback.NotAnIssue) {
    return null;
  }

  if (
    data.metricName === DataObservabilityMetricName.OverdueSeconds &&
    data.updateIntervalInSeconds
  ) {
    return {
      updateIntervalInSeconds: Math.ceil(
        data.updateIntervalInSeconds * LATE_FEEDBACK_INTERVAL_FACTOR,
      ),
    };
  }

  if (data.metricName === DataObservabilityMetricName.RowCountChangePercent) {
    return {
      rowCountChangeTolerancePercent: Math.min(
        ROW_COUNT_TOLERANCE_MAX_PERCENT,
        (data.rowCountChangeTolerancePercent ||
          ROW_COUNT_TOLERANCE_START_PERCENT) + ROW_COUNT_TOLERANCE_STEP_PERCENT,
      ),
    };
  }

  return null;
}

// A row-count change inside what the table was told to tolerate counts as none.
export function applyRowCountTolerance(
  changePercent: number,
  tolerancePercent: number | null | undefined,
): number {
  return tolerancePercent && Math.abs(changePercent) <= tolerancePercent
    ? 0
    : changePercent;
}

// One alert, as the measures read it.
export interface DataAlertOutcome {
  feedback: DataAlertFeedback | string | null;
  // A person acknowledged or resolved it.
  hadPersonAction: boolean;
  isCauseConfirmed: boolean | null;
  detectedAfterInSeconds: number | null;
  // It started acknowledged, as a consequence of an alert upstream: not an issue of its own.
  isConsequence: boolean;
}

export interface DataObservabilityQuality {
  windowInDays: number;
  issueCount: number;
  // Issues a person acted on or called useful, less those called noise, per week.
  usefulIssuesPerWeek: number;
  // Share of issues not called noise.
  precisionPercent: number | null;
  // Share of tables read at the last day's collections.
  coveragePercent: number | null;
  // Share of problems people reported that OneUptime had already raised.
  caughtFirstPercent: number | null;
  medianTimeToDetectInSeconds: number | null;
  // Share of answered issues whose likely cause was the real one.
  causeFoundPercent: number | null;
}

function percent(part: number, whole: number): number | null {
  return whole > 0 ? Math.round((part / whole) * 1000) / 10 : null;
}

function median(values: Array<number>): number | null {
  if (values.length === 0) {
    return null;
  }

  const sorted: Array<number> = [...values].sort((a: number, b: number) => {
    return a - b;
  });
  const middle: number = Math.floor(sorted.length / 2);

  return sorted.length % 2 === 1
    ? sorted[middle]!
    : Math.round((sorted[middle - 1]! + sorted[middle]!) / 2);
}

export function summarizeDataQuality(data: {
  windowInDays: number;
  outcomes: Array<DataAlertOutcome>;
  reports: Array<{ wasCaughtFirst: boolean }>;
  tableCount: number;
  collectedTableCount: number;
}): DataObservabilityQuality {
  const issues: Array<DataAlertOutcome> = data.outcomes.filter(
    (outcome: DataAlertOutcome): boolean => {
      return !outcome.isConsequence;
    },
  );
  const noise: number = issues.filter((issue: DataAlertOutcome): boolean => {
    return isNoiseFeedback(issue.feedback);
  }).length;
  const useful: number = issues.filter((issue: DataAlertOutcome): boolean => {
    return (
      !isNoiseFeedback(issue.feedback) &&
      (issue.hadPersonAction || issue.feedback === DataAlertFeedback.Useful)
    );
  }).length;
  const answered: Array<DataAlertOutcome> = issues.filter(
    (issue: DataAlertOutcome): boolean => {
      return issue.isCauseConfirmed !== null;
    },
  );

  return {
    windowInDays: data.windowInDays,
    issueCount: issues.length,
    usefulIssuesPerWeek:
      Math.round((useful / (data.windowInDays / 7)) * 10) / 10,
    precisionPercent: percent(issues.length - noise, issues.length),
    coveragePercent: percent(data.collectedTableCount, data.tableCount),
    caughtFirstPercent: percent(
      data.reports.filter((report: { wasCaughtFirst: boolean }): boolean => {
        return report.wasCaughtFirst;
      }).length,
      data.reports.length,
    ),
    medianTimeToDetectInSeconds: median(
      issues
        .map((issue: DataAlertOutcome): number | null => {
          return issue.detectedAfterInSeconds;
        })
        .filter((seconds: number | null): seconds is number => {
          return seconds !== null;
        }),
    ),
    causeFoundPercent: percent(
      answered.filter((issue: DataAlertOutcome): boolean => {
        return issue.isCauseConfirmed === true;
      }).length,
      answered.length,
    ),
  };
}

// WHY AN ALERT MOST LIKELY HAPPENED: what the facts next to it say, most telling first.
export enum DataAlertCauseKind {
  UpstreamAlert = "Upstream Alert",
  FailedRun = "Failed Run",
  Deploy = "Deploy",
  FailingWrites = "Failing Writes",
  SchemaChange = "Schema Change",
  Database = "Database",
}

const CAUSE_ORDER: ReadonlyArray<DataAlertCauseKind> = [
  DataAlertCauseKind.UpstreamAlert,
  DataAlertCauseKind.FailedRun,
  DataAlertCauseKind.Deploy,
  DataAlertCauseKind.FailingWrites,
  DataAlertCauseKind.SchemaChange,
  DataAlertCauseKind.Database,
];

export interface DataAlertLikelyCause {
  kind: DataAlertCauseKind;
  title: string;
  detail?: string | undefined;
  at?: string | undefined;
}

export interface DataAlertImpactItem {
  name: string;
  // How many things depend on this one in turn.
  dependents: number;
}

export interface DataAlertExplanation {
  causes: Array<DataAlertLikelyCause>;
  impact: {
    tables: Array<DataAlertImpactItem>;
    dashboards: Array<string>;
    services: Array<string>;
    people: Array<string>;
  };
  feedback: string | null;
  isCauseConfirmed: boolean | null;
}

// Most telling kind first, and the latest of a kind first: a deploy an hour before beats one a day before.
export function rankLikelyCauses(
  causes: Array<DataAlertLikelyCause>,
): Array<DataAlertLikelyCause> {
  return [...causes].sort(
    (a: DataAlertLikelyCause, b: DataAlertLikelyCause): number => {
      const byKind: number =
        CAUSE_ORDER.indexOf(a.kind) - CAUSE_ORDER.indexOf(b.kind);

      if (byKind !== 0) {
        return byKind;
      }

      return (b.at || "").localeCompare(a.at || "");
    },
  );
}
