/*
 * HOW A BI DASHBOARD IS USED, AND HOW FRESH ITS DATA IS.
 *
 * Read from its tool with its dashboards (DataBiSync): how often people
 * opened it in the last 28 days and who, and the latest refreshes of the
 * data it charts. Power BI says both: views from its activity log, and
 * refreshes from its datasets' refresh history. What is kept as JSON on a
 * dashboard is read back through the readers below, which take anything and
 * return what fits.
 */

// The days a dashboard's views are counted over: as far back as Power BI's activity log reads.
export const DATA_DASHBOARD_USAGE_WINDOW_DAYS: number = 28;

// The days a dataset's refreshes are counted over: as long as Power BI keeps them.
export const DATA_DASHBOARD_REFRESH_WINDOW_DAYS: number = 7;

// The people listed as who views a dashboard most.
export const MAX_DATA_DASHBOARD_TOP_VIEWERS: number = 10;

// The latest refreshes kept with a dashboard.
export const MAX_DATA_DASHBOARD_REFRESHES: number = 10;

const MAX_TEXT_LENGTH: number = 500;

export enum DataBiRefreshStatus {
  Completed = "Completed",
  Failed = "Failed",
  Cancelled = "Cancelled",
  // Turned off before it ran (Power BI's selective refresh).
  Disabled = "Disabled",
  InProgress = "In Progress",
  Unknown = "Unknown",
}

export const DATA_BI_REFRESH_STATUSES: ReadonlyArray<DataBiRefreshStatus> =
  Object.values(DataBiRefreshStatus);

export interface DataDashboardViewer {
  // As the tool names them: an email address, mostly.
  viewer: string;
  // Views in the last 28 days.
  views: number;
  lastViewedAt: string;
}

// Who views a dashboard most, kept with it (DataDashboard.usageSummary).
export interface DataDashboardUsageSummary {
  /*
   * When the views counted start, while that is well inside the 28 days:
   * the tool's views were first read then, and the days before are still
   * being read.
   */
  since: string | null;
  topViewers: Array<DataDashboardViewer>;
}

export interface DataDashboardRefresh {
  status: DataBiRefreshStatus;
  startedAt: string | null;
  endedAt: string | null;
  // How it was started, as the tool says: Scheduled, OnDemand, ViaApi...
  type: string | null;
  error: string | null;
}

// The refreshes of the data a dashboard charts, kept with it (DataDashboard.refreshHistory).
export interface DataDashboardRefreshHistory {
  /*
   * The refresh the dashboard's data is as fresh as: its dataset's latest,
   * or, across several datasets, the latest that failed, else the oldest.
   */
  last: DataDashboardRefresh | null;
  // Refreshes in the last seven days, and how many failed; null where the tool does not say.
  refreshCount: number | null;
  failureCount: number | null;
  // The latest, newest first.
  refreshes: Array<DataDashboardRefresh>;
}

function readObject(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function readText(value: unknown): string | null {
  return typeof value === "string" && value.trim()
    ? value.trim().slice(0, MAX_TEXT_LENGTH)
    : null;
}

function readCount(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? Math.floor(value)
    : null;
}

function readTime(value: unknown): string | null {
  const text: string | null = readText(value);

  return text && !Number.isNaN(Date.parse(text)) ? text : null;
}

export function readDataBiRefreshStatus(
  value: unknown,
): DataBiRefreshStatus | null {
  return (DATA_BI_REFRESH_STATUSES as ReadonlyArray<unknown>).includes(value)
    ? (value as DataBiRefreshStatus)
    : null;
}

export function readDataDashboardRefresh(
  value: unknown,
): DataDashboardRefresh | null {
  const refresh: Record<string, unknown> | null = readObject(value);
  const status: DataBiRefreshStatus | null = readDataBiRefreshStatus(
    refresh?.["status"],
  );

  if (!refresh || !status) {
    return null;
  }

  return {
    status,
    startedAt: readTime(refresh["startedAt"]),
    endedAt: readTime(refresh["endedAt"]),
    type: readText(refresh["type"]),
    error: readText(refresh["error"]),
  };
}

export function readDataDashboardRefreshHistory(
  value: unknown,
): DataDashboardRefreshHistory | null {
  const history: Record<string, unknown> | null = readObject(value);

  if (!history) {
    return null;
  }

  return {
    last: readDataDashboardRefresh(history["last"]),
    refreshCount: readCount(history["refreshCount"]),
    failureCount: readCount(history["failureCount"]),
    refreshes: (Array.isArray(history["refreshes"]) ? history["refreshes"] : [])
      .map(readDataDashboardRefresh)
      .filter((refresh: DataDashboardRefresh | null): boolean => {
        return refresh !== null;
      })
      .slice(0, MAX_DATA_DASHBOARD_REFRESHES) as Array<DataDashboardRefresh>,
  };
}

export function readDataDashboardUsageSummary(
  value: unknown,
): DataDashboardUsageSummary | null {
  const summary: Record<string, unknown> | null = readObject(value);

  if (!summary) {
    return null;
  }

  const topViewers: Array<DataDashboardViewer> = [];

  for (const item of Array.isArray(summary["topViewers"])
    ? summary["topViewers"]
    : []) {
    const viewer: Record<string, unknown> | null = readObject(item);
    const name: string | null = readText(viewer?.["viewer"]);
    const views: number | null = readCount(viewer?.["views"]);
    const lastViewedAt: string | null = readTime(viewer?.["lastViewedAt"]);

    if (name && views !== null && lastViewedAt) {
      topViewers.push({ viewer: name, views, lastViewedAt });
    }
  }

  return {
    since: readTime(summary["since"]),
    topViewers: topViewers.slice(0, MAX_DATA_DASHBOARD_TOP_VIEWERS),
  };
}

// The time a refresh is known by: when it ended, or when it started while it runs.
export function getDataDashboardRefreshTime(
  refresh: DataDashboardRefresh | null,
): string | null {
  return refresh ? refresh.endedAt || refresh.startedAt : null;
}
