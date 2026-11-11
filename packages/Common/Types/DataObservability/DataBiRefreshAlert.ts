import {
  DataBiRefreshStatus,
  DataDashboardRefresh,
  DataDashboardRefreshHistory,
  getDataDashboardRefreshTime,
  readDataBiRefreshStatus,
} from "./DataDashboardActivity";

/*
 * A POWER BI DATASET WHOSE REFRESH FAILED, UNTIL A LATER ONE COMPLETES.
 *
 * A refresh is not a pipeline run. A dataset whose refresh failed goes on
 * showing the data of its last completed refresh until a later refresh
 * completes, however long that takes: a failed refresh is a state, not an
 * event. So it opens one alert, which stays open until a later refresh
 * completes - not for an hour, as a failed run's does.
 *
 *  - Each hourly read (DataBiSync) keeps on the BI tool the datasets whose
 *    latest finished refresh failed or was cancelled. A refresh still
 *    running, or a dataset whose refreshes were not read this time, changes
 *    nothing: the dataset stays as it was until a refresh finishes. One that
 *    completes is kept an hour more, as recovered. One gone from the tool,
 *    or with no refresh at all, is not kept.
 *  - Every five minutes (DataBiRefreshCheck), each dataset kept writes
 *    oneuptime.data.bi.refresh_failed - 1 while it is failing, 0 the hour
 *    after it recovered - which the tool's monitor reads
 *    (DataBiRefreshMonitorStep): one alert per dataset, resolved once a
 *    later refresh completes.
 */

export enum DataBiMetricName {
  // 1 while a dataset's latest finished refresh failed or was cancelled, 0 the hour after a later one completed.
  RefreshFailed = "oneuptime.data.bi.refresh_failed",
}

export const DataBiAttribute: {
  readonly ConnectionId: string;
  readonly ConnectionName: string;
  readonly DatasetId: string;
  readonly DatasetName: string;
  readonly Workspace: string;
} = {
  ConnectionId: "oneuptime.data.bi.connection.id",
  ConnectionName: "oneuptime.data.bi.connection.name",
  DatasetId: "oneuptime.data.bi.dataset.id",
  DatasetName: "oneuptime.data.bi.dataset.name",
  Workspace: "oneuptime.data.bi.workspace.name",
};

export interface DataBiMetricDefinition {
  name: DataBiMetricName;
  description: string;
  unit: string;
}

export const DATA_BI_METRICS: ReadonlyArray<DataBiMetricDefinition> = [
  {
    name: DataBiMetricName.RefreshFailed,
    description:
      "1 while a Power BI dataset's last refresh failed or was cancelled, 0 for the hour after a later refresh completed.",
    unit: "",
  },
];

// How long a dataset that recovered goes on writing 0, so its monitor sees it recover.
export const DATA_BI_REFRESH_RECOVERY_WINDOW_IN_MS: number = 60 * 60 * 1000;

// The most datasets kept on one BI tool.
export const MAX_DATA_BI_FAILED_REFRESHES: number = 2_000;

const MAX_TEXT_LENGTH: number = 500;
const MAX_ID_LENGTH: number = 100;

// What one read says of a dataset behind the tool's dashboards (Power BI).
export interface DataBiDatasetRead {
  // Its id, in lower case.
  datasetId: string;
  name: string;
  // Its workspace's name.
  workspace: string | null;
  // Its refreshes: null when it has none, undefined when they were not read.
  refresh: DataDashboardRefreshHistory | null | undefined;
}

// A dataset whose refresh failed, kept on its BI tool (DataBiConnection.failedRefreshes).
export interface DataBiFailedRefresh {
  // Its id, in lower case.
  datasetId: string;
  datasetName: string;
  workspace: string | null;
  // How its latest finished refresh went: Failed or Cancelled.
  status: DataBiRefreshStatus;
  // When that refresh ended, or started when that is all Power BI says.
  failedAt: string | null;
  error: string | null;
  // When a read found a later refresh completed; null while it is failing.
  recoveredAt: string | null;
}

function readObject(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function readText(
  value: unknown,
  maxLength: number = MAX_TEXT_LENGTH,
): string | null {
  return typeof value === "string" && value.trim()
    ? value.trim().slice(0, maxLength)
    : null;
}

function readTime(value: unknown): string | null {
  const text: string | null = readText(value);

  return text && !Number.isNaN(Date.parse(text)) ? text : null;
}

// A refresh that ended without completing: it failed, or was cancelled.
export function isDataBiRefreshFailure(status: DataBiRefreshStatus): boolean {
  return (
    status === DataBiRefreshStatus.Failed ||
    status === DataBiRefreshStatus.Cancelled
  );
}

// A refresh that ended one way or the other: completed, failed or cancelled.
export function isDataBiRefreshFinished(status: DataBiRefreshStatus): boolean {
  return (
    status === DataBiRefreshStatus.Completed || isDataBiRefreshFailure(status)
  );
}

function refreshTime(refresh: DataDashboardRefresh): number {
  const at: number = Date.parse(getDataDashboardRefreshTime(refresh) || "");

  return Number.isFinite(at) ? at : 0;
}

/*
 * The dataset's latest refresh that finished - the one its data is as fresh
 * as, or failed to be - or null when none did: one still running, or
 * Disabled or Unknown, says nothing of how the last one went.
 */
export function getLatestFinishedRefresh(
  history: DataDashboardRefreshHistory | null | undefined,
): DataDashboardRefresh | null {
  if (!history) {
    return null;
  }

  const finished: Array<DataDashboardRefresh> = [
    ...(history.last ? [history.last] : []),
    ...history.refreshes,
  ].filter((refresh: DataDashboardRefresh): boolean => {
    return isDataBiRefreshFinished(refresh.status);
  });

  return (
    finished.sort((a: DataDashboardRefresh, b: DataDashboardRefresh) => {
      return refreshTime(b) - refreshTime(a);
    })[0] || null
  );
}

/*
 * The datasets kept after a read: each read with a finished refresh as that
 * refresh says - failing, or recovered when one that was failing completed -
 * and each not read, or with no refresh finished since, as it was. A dataset
 * that recovered over an hour ago, one with no refresh, and one no longer
 * behind the tool's dashboards are not kept.
 */
export function getNextFailedRefreshes(data: {
  previous: Array<DataBiFailedRefresh>;
  datasets: Array<DataBiDatasetRead>;
  now: Date;
}): Array<DataBiFailedRefresh> {
  const previous: Map<string, DataBiFailedRefresh> = new Map(
    data.previous.map(
      (refresh: DataBiFailedRefresh): [string, DataBiFailedRefresh] => {
        return [refresh.datasetId, refresh];
      },
    ),
  );
  const next: Array<DataBiFailedRefresh> = [];
  const seen: Set<string> = new Set();

  for (const dataset of data.datasets) {
    const datasetId: string = dataset.datasetId.toLowerCase();

    if (!datasetId || seen.has(datasetId)) {
      continue;
    }

    seen.add(datasetId);

    const kept: DataBiFailedRefresh | undefined = previous.get(datasetId);
    // As it was, by the name and workspace it has now.
    const asItWas: DataBiFailedRefresh | null = kept
      ? {
          ...kept,
          datasetName: dataset.name || kept.datasetName,
          workspace: dataset.workspace || kept.workspace,
        }
      : null;

    if (dataset.refresh === null) {
      continue;
    }

    const finished: DataDashboardRefresh | null =
      dataset.refresh === undefined
        ? null
        : getLatestFinishedRefresh(dataset.refresh);

    if (!finished) {
      if (asItWas) {
        next.push(asItWas);
      }

      continue;
    }

    if (isDataBiRefreshFailure(finished.status)) {
      next.push({
        datasetId,
        datasetName: dataset.name || datasetId,
        workspace: dataset.workspace,
        status: finished.status,
        failedAt: getDataDashboardRefreshTime(finished),
        error: finished.error,
        recoveredAt: null,
      });
      continue;
    }

    // Completed: one that was failing has recovered, and is kept an hour more.
    if (asItWas) {
      next.push({
        ...asItWas,
        recoveredAt: asItWas.recoveredAt || data.now.toISOString(),
      });
    }
  }

  return next
    .filter((refresh: DataBiFailedRefresh): boolean => {
      return getDataBiRefreshFailedValue(refresh, data.now) !== null;
    })
    .slice(0, MAX_DATA_BI_FAILED_REFRESHES);
}

/*
 * What a dataset kept writes now: 1 while it is failing, 0 for the hour after
 * it recovered, and nothing after that.
 */
export function getDataBiRefreshFailedValue(
  refresh: DataBiFailedRefresh,
  now: Date,
): number | null {
  if (!refresh.recoveredAt) {
    return 1;
  }

  const sinceRecovery: number = now.getTime() - Date.parse(refresh.recoveredAt);

  return Number.isFinite(sinceRecovery) &&
    sinceRecovery < DATA_BI_REFRESH_RECOVERY_WINDOW_IN_MS
    ? 0
    : null;
}

// The datasets kept on a BI tool, read strictly: anything that does not fit is left out.
export function readDataBiFailedRefreshes(
  value: unknown,
): Array<DataBiFailedRefresh> {
  if (!Array.isArray(value)) {
    return [];
  }

  const refreshes: Array<DataBiFailedRefresh> = [];
  const seen: Set<string> = new Set();

  for (const item of value) {
    const refresh: Record<string, unknown> | null = readObject(item);
    const datasetId: string | undefined = readText(
      refresh?.["datasetId"],
      MAX_ID_LENGTH,
    )?.toLowerCase();
    const status: DataBiRefreshStatus | null = readDataBiRefreshStatus(
      refresh?.["status"],
    );

    if (
      !refresh ||
      !datasetId ||
      seen.has(datasetId) ||
      !status ||
      !isDataBiRefreshFailure(status)
    ) {
      continue;
    }

    seen.add(datasetId);
    refreshes.push({
      datasetId,
      datasetName: readText(refresh["datasetName"]) || datasetId,
      workspace: readText(refresh["workspace"]),
      status,
      failedAt: readTime(refresh["failedAt"]),
      error: readText(refresh["error"]),
      recoveredAt: readTime(refresh["recoveredAt"]),
    });
  }

  return refreshes.slice(0, MAX_DATA_BI_FAILED_REFRESHES);
}
