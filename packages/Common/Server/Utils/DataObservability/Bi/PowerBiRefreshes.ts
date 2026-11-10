import {
  DATA_DASHBOARD_REFRESH_WINDOW_DAYS,
  DataBiRefreshStatus,
  DataDashboardRefresh,
  DataDashboardRefreshHistory,
  getDataDashboardRefreshTime,
  MAX_DATA_DASHBOARD_REFRESHES,
} from "../../../../Types/DataObservability/DataDashboardActivity";
import { JSONObject } from "../../../../Types/JSON";
import BiRequestError from "./BiRequestError";

/*
 * HOW FRESH EACH POWER BI DATASET IS, FROM ITS REFRESHES.
 *
 *  - A dataset on a capacity (Premium, Premium Per User or Fabric) is in
 *    Power BI's admin list of refreshables (admin/capacities/refreshables):
 *    its last refresh with its error, and how many refreshes ran and failed
 *    in the seven days Power BI keeps. It needs nothing the workspace scans
 *    do not, and a request lists a thousand datasets, of 200 requests an
 *    hour.
 *  - A dataset on shared capacity is not in that list. Its refresh history
 *    (groups/{workspace}/datasets/{dataset}/refreshes) is shown only to those
 *    who may write the dataset, so it is read where the service principal is
 *    the workspace's Contributor, Member or Admin. A workspace that refuses
 *    is asked once a read, not once a dataset.
 *
 * Every part is read on its own: a list that fails leaves its datasets
 * unread, kept as they were, and says why; the rest is read all the same.
 */

export interface PowerBiRefreshTarget {
  datasetId: string;
  workspaceId: string;
  // Whether the dataset's workspace is on a capacity, so in the list of refreshables.
  onCapacity: boolean;
}

export interface PowerBiRefreshRead {
  /*
   * Each dataset read, by its id in lower case: its refreshes, or null when
   * it has none. A dataset not read is not here.
   */
  refreshes: Map<string, DataDashboardRefreshHistory | null>;
  warnings: Array<string>;
}

const REFRESHABLES_PAGE_SIZE: number = 1000;

// Refreshables listed at most: twenty requests.
const MAX_REFRESHABLES: number = 20_000;

// Refresh history read one dataset at a time, at most, in one read.
export const MAX_DATASET_HISTORY_READS: number = 1000;

// Power BI keeps sixty refreshes of a dataset at most.
const HISTORY_ENTRIES: number = 60;

// Errors of other kinds in a row before history stops being read.
const MAX_HISTORY_FAILURES: number = 5;

const MAX_ERROR_LENGTH: number = 500;
const MAX_ID_LENGTH: number = 100;
const DAY_IN_MS: number = 24 * 60 * 60 * 1000;
const HOUR_IN_MS: number = 60 * 60 * 1000;

function readText(
  value: unknown,
  maxLength: number = MAX_ERROR_LENGTH,
): string {
  return typeof value === "string" || typeof value === "number"
    ? String(value).trim().slice(0, maxLength)
    : "";
}

function readObject(value: unknown): JSONObject {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as JSONObject)
    : {};
}

function readArray(value: unknown): Array<unknown> {
  return Array.isArray(value) ? value : [];
}

function readTime(value: unknown): string | null {
  const at: number = Date.parse(readText(value, 100));

  return Number.isFinite(at) ? new Date(at).toISOString() : null;
}

function readCount(value: unknown): number | null {
  const count: number =
    typeof value === "number" ? value : Number(readText(value, 20) || NaN);

  return Number.isFinite(count) && count >= 0 ? Math.floor(count) : null;
}

function readStatus(value: unknown, hasEnded: boolean): DataBiRefreshStatus {
  switch (readText(value, 50).toLowerCase()) {
    case "completed":
      return DataBiRefreshStatus.Completed;
    case "failed":
      return DataBiRefreshStatus.Failed;
    case "cancelled":
    case "canceled":
      return DataBiRefreshStatus.Cancelled;
    case "disabled":
      return DataBiRefreshStatus.Disabled;
    case "notstarted":
    case "inprogress":
    case "running":
      return DataBiRefreshStatus.InProgress;
    case "unknown":
      // Power BI says Unknown while a refresh runs, and it has no end yet.
      return hasEnded
        ? DataBiRefreshStatus.Unknown
        : DataBiRefreshStatus.InProgress;
    default:
      return DataBiRefreshStatus.Unknown;
  }
}

/*
 * What went wrong, from a serviceExceptionJson: a JSON string (or object)
 * with an errorCode and, mostly, an errorDescription, or a REST error's
 * code, message and details. The code, then the first words meant for a
 * person.
 */
export function readPowerBiRefreshError(value: unknown): string | null {
  let error: JSONObject = readObject(value);

  if (typeof value === "string") {
    try {
      error = readObject(JSON.parse(value));
    } catch {
      return readText(value) || null;
    }
  }

  const nested: JSONObject = readObject(error["error"]);
  const pbiError: JSONObject = readObject(nested["pbi.error"]);
  const detail: string =
    readArray(pbiError["details"])
      .map((item: unknown): string => {
        return readText(readObject(readObject(item)["detail"])["value"]);
      })
      .find(Boolean) || "";
  const code: string =
    readText(error["errorCode"]) ||
    readText(nested["code"]) ||
    readText(pbiError["code"]);
  const message: string =
    readText(error["errorDescription"]) ||
    readText(error["message"]) ||
    readText(nested["message"]) ||
    detail;
  const text: string =
    code && message && code !== message
      ? `${code}: ${message}`
      : code || message;

  return text ? text.slice(0, MAX_ERROR_LENGTH) : null;
}

// One refresh, as Power BI's Refresh object says it.
export function readPowerBiRefresh(
  value: unknown,
): DataDashboardRefresh | null {
  const refresh: JSONObject = readObject(value);

  if (Object.keys(refresh).length === 0) {
    return null;
  }

  const startedAt: string | null = readTime(refresh["startTime"]);
  const endedAt: string | null = readTime(refresh["endTime"]);
  const status: DataBiRefreshStatus = readStatus(
    refresh["status"],
    endedAt !== null,
  );
  // The refresh's own error, or its last attempt's.
  const attempts: Array<unknown> = readArray(refresh["refreshAttempts"]);
  const error: string | null =
    readPowerBiRefreshError(refresh["serviceExceptionJson"]) ||
    attempts
      .map((attempt: unknown): string | null => {
        return readPowerBiRefreshError(
          readObject(attempt)["serviceExceptionJson"],
        );
      })
      .filter(Boolean)
      .pop() ||
    null;

  return {
    status,
    startedAt,
    endedAt,
    type: readText(refresh["refreshType"], 50) || null,
    error:
      status === DataBiRefreshStatus.Failed ||
      status === DataBiRefreshStatus.Cancelled
        ? error
        : null,
  };
}

function isRefresh(
  refresh: DataDashboardRefresh | null,
): refresh is DataDashboardRefresh {
  return refresh !== null;
}

function refreshTime(refresh: DataDashboardRefresh): number {
  const at: string | null = getDataDashboardRefreshTime(refresh);

  return at ? Date.parse(at) : 0;
}

// When a refresh started, or ended when that is all it says.
function startTime(refresh: DataDashboardRefresh): number {
  const at: number = Date.parse(refresh.startedAt || refresh.endedAt || "");

  return Number.isFinite(at) ? at : 0;
}

function newestFirst(a: DataDashboardRefresh, b: DataDashboardRefresh): number {
  return startTime(b) - startTime(a);
}

/*
 * A dataset's refresh history: the latest refresh, the latest ten, and how
 * many ran and failed in the last seven days. Null when it has none.
 */
export function summarizePowerBiRefreshes(
  values: Array<unknown>,
  now: Date,
): DataDashboardRefreshHistory | null {
  const refreshes: Array<DataDashboardRefresh> = values
    .map(readPowerBiRefresh)
    .filter(isRefresh)
    .sort(newestFirst);

  if (refreshes.length === 0) {
    return null;
  }

  const since: number =
    now.getTime() - DATA_DASHBOARD_REFRESH_WINDOW_DAYS * DAY_IN_MS;
  const recent: Array<DataDashboardRefresh> = refreshes.filter(
    (refresh: DataDashboardRefresh): boolean => {
      return startTime(refresh) >= since;
    },
  );

  return {
    last: refreshes[0]!,
    refreshCount: recent.length,
    failureCount: recent.filter((refresh: DataDashboardRefresh): boolean => {
      return refresh.status === DataBiRefreshStatus.Failed;
    }).length,
    refreshes: refreshes.slice(0, MAX_DATA_DASHBOARD_REFRESHES),
  };
}

// One of Power BI's refreshables: the dataset, its last refresh, and its counts over the seven days kept.
export function readPowerBiRefreshable(
  value: unknown,
): { datasetId: string; history: DataDashboardRefreshHistory } | null {
  const refreshable: JSONObject = readObject(value);
  const datasetId: string = readText(
    refreshable["id"],
    MAX_ID_LENGTH,
  ).toLowerCase();

  if (!datasetId) {
    return null;
  }

  const last: DataDashboardRefresh | null = readPowerBiRefresh(
    refreshable["lastRefresh"],
  );

  return {
    datasetId,
    history: {
      last,
      refreshCount: readCount(refreshable["refreshCount"]),
      failureCount: readCount(refreshable["refreshFailures"]),
      refreshes: last ? [last] : [],
    },
  };
}

const STATUS_RANK: Readonly<Record<DataBiRefreshStatus, number>> = {
  [DataBiRefreshStatus.Failed]: 0,
  [DataBiRefreshStatus.Cancelled]: 1,
  [DataBiRefreshStatus.Disabled]: 2,
  [DataBiRefreshStatus.Unknown]: 3,
  [DataBiRefreshStatus.InProgress]: 4,
  [DataBiRefreshStatus.Completed]: 5,
};

/*
 * The refreshes of several datasets, for a dashboard that charts them all:
 * its last refresh is the latest that failed, else the oldest - the data it
 * shows is only as fresh as that - and its counts are theirs added up.
 * Undefined while none of them was read; null when none has a refresh.
 */
export function combineRefreshHistories(
  histories: Array<DataDashboardRefreshHistory | null | undefined>,
): DataDashboardRefreshHistory | null | undefined {
  if (histories.length === 1) {
    return histories[0];
  }

  if (
    histories.length === 0 ||
    histories.every(
      (history: DataDashboardRefreshHistory | null | undefined): boolean => {
        return history === undefined;
      },
    )
  ) {
    return undefined;
  }

  const read: Array<DataDashboardRefreshHistory> = histories.filter(
    (
      history: DataDashboardRefreshHistory | null | undefined,
    ): history is DataDashboardRefreshHistory => {
      return Boolean(history);
    },
  );

  if (read.length === 0) {
    return null;
  }

  const lasts: Array<DataDashboardRefresh> = read
    .map(
      (history: DataDashboardRefreshHistory): DataDashboardRefresh | null => {
        return history.last;
      },
    )
    .filter(isRefresh);
  const last: DataDashboardRefresh | null =
    lasts.sort((a: DataDashboardRefresh, b: DataDashboardRefresh): number => {
      const rank: number = STATUS_RANK[a.status] - STATUS_RANK[b.status];

      if (rank !== 0) {
        return rank;
      }

      // The latest failure, or the oldest of the rest.
      return a.status === DataBiRefreshStatus.Failed
        ? refreshTime(b) - refreshTime(a)
        : refreshTime(a) - refreshTime(b);
    })[0] || null;
  const add: (
    pick: (history: DataDashboardRefreshHistory) => number | null,
  ) => number | null = (
    pick: (history: DataDashboardRefreshHistory) => number | null,
  ): number | null => {
    const counts: Array<number> = read
      .map(pick)
      .filter((count: number | null): count is number => {
        return count !== null;
      });

    return counts.length > 0
      ? counts.reduce((sum: number, count: number): number => {
          return sum + count;
        }, 0)
      : null;
  };

  return {
    last,
    refreshCount: add((history: DataDashboardRefreshHistory): number | null => {
      return history.refreshCount;
    }),
    failureCount: add((history: DataDashboardRefreshHistory): number | null => {
      return history.failureCount;
    }),
    refreshes: read
      .flatMap(
        (history: DataDashboardRefreshHistory): Array<DataDashboardRefresh> => {
          return history.refreshes;
        },
      )
      .sort(newestFirst)
      .slice(0, MAX_DATA_DASHBOARD_REFRESHES),
  };
}

function statusOf(error: unknown): number | null {
  return error instanceof BiRequestError ? error.statusCode : null;
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export async function readPowerBiRefreshes(data: {
  // A GET of a path of Power BI's REST API, answering its JSON.
  get: (path: string) => Promise<unknown>;
  datasets: Array<PowerBiRefreshTarget>;
  now: Date;
}): Promise<PowerBiRefreshRead> {
  const refreshes: Map<string, DataDashboardRefreshHistory | null> = new Map();
  const warnings: Array<string> = [];
  const targets: Map<string, PowerBiRefreshTarget> = new Map();

  for (const target of data.datasets) {
    const datasetId: string = target.datasetId.toLowerCase();

    if (datasetId && !targets.has(datasetId)) {
      targets.set(datasetId, { ...target, datasetId });
    }
  }

  if (targets.size === 0) {
    return { refreshes, warnings };
  }

  // Every refreshable dataset on a capacity, a thousand a request.
  const listed: Map<string, DataDashboardRefreshHistory> = new Map();
  let isListRead: boolean = false;

  try {
    for (let skip: number = 0; skip < MAX_REFRESHABLES; ) {
      const page: Array<unknown> = readArray(
        readObject(
          await data.get(
            `/admin/capacities/refreshables?$top=${REFRESHABLES_PAGE_SIZE}&$skip=${skip}`,
          ),
        )["value"],
      );

      for (const value of page) {
        const refreshable: {
          datasetId: string;
          history: DataDashboardRefreshHistory;
        } | null = readPowerBiRefreshable(value);

        if (refreshable) {
          listed.set(refreshable.datasetId, refreshable.history);
        }
      }

      skip += REFRESHABLES_PAGE_SIZE;

      if (page.length < REFRESHABLES_PAGE_SIZE) {
        break;
      }
    }

    isListRead = true;
  } catch (error) {
    warnings.push(
      `Refreshes of datasets on capacities were not read: ${messageOf(error)}`,
    );
  }

  const unlisted: Array<PowerBiRefreshTarget> = [];

  for (const [datasetId, target] of targets) {
    const history: DataDashboardRefreshHistory | undefined =
      listed.get(datasetId);

    if (history) {
      refreshes.set(datasetId, history);
    } else if (target.onCapacity) {
      // Not a refreshable: never refreshed, and no refresh scheduled.
      if (isListRead) {
        refreshes.set(datasetId, null);
      }
    } else {
      unlisted.push(target);
    }
  }

  /*
   * Shared capacity: each dataset's own history, where the workspace lets
   * the service principal read it. Past the most read at once, a read
   * starts where the hour puts it, so every dataset gets its turn.
   */
  const start: number =
    unlisted.length > MAX_DATASET_HISTORY_READS
      ? (Math.floor(data.now.getTime() / HOUR_IN_MS) *
          MAX_DATASET_HISTORY_READS) %
        unlisted.length
      : 0;
  const turn: Array<PowerBiRefreshTarget> = [
    ...unlisted.slice(start),
    ...unlisted.slice(0, start),
  ].slice(0, MAX_DATASET_HISTORY_READS);
  const refusedWorkspaces: Set<string> = new Set();
  let unreadDatasets: number = 0;
  let failuresInARow: number = 0;

  for (let index: number = 0; index < turn.length; index++) {
    const target: PowerBiRefreshTarget = turn[index]!;

    if (refusedWorkspaces.has(target.workspaceId)) {
      unreadDatasets++;
      continue;
    }

    try {
      const history: DataDashboardRefreshHistory | null =
        summarizePowerBiRefreshes(
          readArray(
            readObject(
              await data.get(
                `/groups/${encodeURIComponent(target.workspaceId)}/datasets/${encodeURIComponent(target.datasetId)}/refreshes?$top=${HISTORY_ENTRIES}`,
              ),
            )["value"],
          ),
          data.now,
        );

      refreshes.set(target.datasetId, history);
      failuresInARow = 0;
    } catch (error) {
      const status: number | null = statusOf(error);

      if (status === 401 || status === 403) {
        refusedWorkspaces.add(target.workspaceId);
        unreadDatasets++;
        continue;
      }

      // Gone since the scan, or not a dataset that refreshes.
      if (status === 404) {
        continue;
      }

      if (status === 429) {
        warnings.push(
          "Refreshes of datasets on shared capacity were not all read: Power BI asked for fewer requests, and the rest is read next hour.",
        );
        break;
      }

      failuresInARow++;

      if (failuresInARow >= MAX_HISTORY_FAILURES) {
        warnings.push(
          `Refreshes of datasets on shared capacity were not all read: ${messageOf(error)}`,
        );
        break;
      }
    }
  }

  if (refusedWorkspaces.size > 0) {
    warnings.push(
      `Refreshes of ${unreadDatasets} ${unreadDatasets === 1 ? "dataset" : "datasets"} on shared capacity were not read: Power BI shows a dataset's refreshes only to its workspace's Contributors, Members and Admins. Add the service principal to ${refusedWorkspaces.size === 1 ? "its workspace" : `those ${refusedWorkspaces.size} workspaces`} to read them.`,
    );
  }

  return { refreshes, warnings };
}
