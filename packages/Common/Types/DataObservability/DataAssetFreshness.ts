import DataAssetKind, { doesDataAssetKindHoldRows } from "./DataAssetKind";

/*
 * WHETHER A TABLE IS AS FRESH AS IT USUALLY IS.
 *
 * The catalog shows every table as Fresh, Late or Unknown at a glance,
 * from two things the collection keeps: when the table last changed, and
 * how often it usually changes. A table is Late once it has gone twice its
 * usual interval without a change, and at least fifteen minutes past it,
 * so a table that changes every minute is not called late after a quiet
 * minute and one that loads nightly is called late the morning its load
 * does not come. Collection writes the same answer as a metric
 * (oneuptime.data.table.overdue_seconds), so the "Table Is Late" alert
 * fires exactly when the table turns Late on the page.
 */

export enum DataAssetFreshness {
  Fresh = "Fresh",
  Late = "Late",
  Unknown = "Unknown",
  // Views hold no rows of their own: their freshness is their sources'.
  NotApplicable = "Not Applicable",
}

// The least slack past the usual interval before a table is called late.
export const MIN_LATENESS_SLACK_IN_SECONDS: number = 15 * 60;

export interface DataAssetFreshnessResult {
  freshness: DataAssetFreshness;
  // When the table becomes late without a change; null when that cannot be said.
  lateAt: Date | null;
  // How long it has been late; 0 when it is not.
  overdueBySeconds: number;
}

export function getDataAssetFreshness(data: {
  kind: DataAssetKind | undefined | null;
  lastChangedAt: Date | undefined | null;
  updateIntervalInSeconds: number | undefined | null;
  now: Date;
}): DataAssetFreshnessResult {
  if (data.kind && !doesDataAssetKindHoldRows(data.kind)) {
    return {
      freshness: DataAssetFreshness.NotApplicable,
      lateAt: null,
      overdueBySeconds: 0,
    };
  }

  if (
    !data.lastChangedAt ||
    !data.updateIntervalInSeconds ||
    data.updateIntervalInSeconds <= 0
  ) {
    return {
      freshness: DataAssetFreshness.Unknown,
      lateAt: null,
      overdueBySeconds: 0,
    };
  }

  const allowedSeconds: number = Math.max(
    data.updateIntervalInSeconds * 2,
    data.updateIntervalInSeconds + MIN_LATENESS_SLACK_IN_SECONDS,
  );
  const lateAt: Date = new Date(
    new Date(data.lastChangedAt).getTime() + allowedSeconds * 1000,
  );
  const overdueBySeconds: number = Math.max(
    0,
    Math.floor((data.now.getTime() - lateAt.getTime()) / 1000),
  );

  return {
    freshness:
      overdueBySeconds > 0 ? DataAssetFreshness.Late : DataAssetFreshness.Fresh,
    lateAt,
    overdueBySeconds,
  };
}
