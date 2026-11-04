import { DataCheckAlertCondition } from "./DataCheckType";
/*
 * WHAT DATA OBSERVABILITY'S OWN ROUTES ANSWER (Server/API/DataObservabilityAPI).
 *
 * Every table has its CRUD route from BaseAPI (/data-asset). These answer
 * what is worked out on request: the Overview's figures, the stores whose
 * tables are watched with how their last collection went, Collect Now, and
 * connecting a database from Data Observability itself.
 */

export const DATA_OBSERVABILITY_API_ROUTES: {
  overview: string;
  stores: string;
  connectStore: string;
  collectNow: (dataStoreId: string) => string;
  checkAlert: (dataCheckId: string) => string;
  checkRunNow: (dataCheckId: string) => string;
  dataProductSync: (dataProductId: string) => string;
  dataProductBadge: (dataProductId: string) => string;
  dataProductBadgeReset: (dataProductId: string) => string;
  reconciliationSync: (reconciliationId: string) => string;
  reconciliationRunNow: (reconciliationId: string) => string;
  checkSuggest: string;
  alertExplanation: (alertId: string) => string;
  alertFeedback: (alertId: string) => string;
  quality: string;
  tableFreshness: string;
  biSync: (dataBiConnectionId: string) => string;
  tableDashboards: string;
  spendSummary: string;
} = {
  overview: "/data-observability/overview",
  // Why a data alert most likely happened, and what depends on it.
  alertExplanation: (alertId: string): string => {
    return `/data-observability/alerts/${alertId}/explanation`;
  },
  alertFeedback: (alertId: string): string => {
    return `/data-observability/alerts/${alertId}/feedback`;
  },
  // How well Data Observability is working for the project.
  quality: "/data-observability/quality",
  stores: "/data-observability/stores",
  connectStore: "/data-observability/stores/connect",
  collectNow: (dataStoreId: string): string => {
    return `/data-observability/stores/${dataStoreId}/collect-now`;
  },
  // Makes the check's monitor match its alert condition.
  checkAlert: (dataCheckId: string): string => {
    return `/data-observability/checks/${dataCheckId}/alert`;
  },
  // Runs the check at its store's very next collection.
  checkRunNow: (dataCheckId: string): string => {
    return `/data-observability/checks/${dataCheckId}/run-now`;
  },
  // Makes the data product's monitor and SLO match it.
  dataProductSync: (dataProductId: string): string => {
    return `/data-observability/data-products/${dataProductId}/sync`;
  },
  // The data product's "data as of" badge (GET, no sign-in: ?token= is its secret).
  dataProductBadge: (dataProductId: string): string => {
    return `/data-observability/data-products/${dataProductId}/badge`;
  },
  // A new secret for the badge: every badge embedded with the old one stops working.
  dataProductBadgeReset: (dataProductId: string): string => {
    return `/data-observability/data-products/${dataProductId}/badge/reset`;
  },
  // Makes the reconciliation's two checks and its monitor match it.
  reconciliationSync: (reconciliationId: string): string => {
    return `/data-observability/reconciliations/${reconciliationId}/sync`;
  },
  // Reads both sides at their stores' very next collections, together.
  reconciliationRunNow: (reconciliationId: string): string => {
    return `/data-observability/reconciliations/${reconciliationId}/run-now`;
  },
  // A rule in a sentence, written as a Custom SQL check by OneUptime AI, to review.
  checkSuggest: "/data-observability/checks/suggest",
  // Whether a table is fresh, as one answer: what the MCP server's tool asks.
  tableFreshness: "/data-observability/tables/freshness",
  // Reads a BI tool's dashboards now, and says how it went.
  biSync: (dataBiConnectionId: string): string => {
    return `/data-observability/bi-connections/${dataBiConnectionId}/sync`;
  },
  // The dashboards built on a table, and on the tables built from it.
  tableDashboards: "/data-observability/tables/dashboards",
  // What the project's warehouses spent over the last day: by team, by table, and where it is wasted.
  spendSummary: "/data-observability/spend/summary",
};

export interface DataObservabilitySpendTable {
  dataAssetId: string;
  table: string;
  database: string;
  credits: number | null;
  bytesBilled: number | null;
  // Unread for 90 days: what writing it spends, nobody uses.
  isUnused: boolean;
}

export interface DataObservabilitySpendSummary {
  credits: number;
  bytesBilled: number;
  jobCount: number;
  failingJobCount: number;
  // Jobs whose every table has gone unread for 90 days, and what they spent.
  unusedJobCount: number;
  unusedCredits: number;
  unusedBytesBilled: number;
  // By the team a job's tag names, else whoever runs it.
  byTeam: Array<{
    team: string;
    credits: number;
    bytesBilled: number;
    jobCount: number;
  }>;
  topTables: Array<DataObservabilitySpendTable>;
}

export interface DataObservabilityBiSyncResponse {
  dashboardCount: number;
  matchedTableCount: number;
  error: string | null;
}

export interface DataObservabilityTableDashboard {
  dataDashboardId: string;
  name: string;
  url: string | null;
  tool: string;
  folder: string | null;
  owner: string | null;
  // The table built from this one that the dashboard reads; null when it reads this one.
  via: { dataAssetId: string; table: string } | null;
}

export interface DataObservabilityCheckSuggestRequest {
  dataAssetId: string;
  sentence: string;
}

// A check OneUptime AI wrote from a sentence: shown to be read, never saved by itself.
export interface DataObservabilityCheckSuggestion {
  name: string;
  customSql: string;
  alertCondition: DataCheckAlertCondition;
  alertThreshold: number;
  explanation: string;
}

export interface DataObservabilityReconciliationSyncResponse {
  sourceDataCheckId: string;
  targetDataCheckId: string;
  monitorId: string;
}

export interface DataObservabilityDataProductSyncResponse {
  monitorId: string;
  serviceLevelObjectiveId: string;
}

export interface DataObservabilityDataProductBadgeResetResponse {
  badgeToken: string;
}

export interface DataObservabilityCheckAlertResponse {
  // The check's monitor, or null when it has no alert.
  monitorId: string | null;
}

export enum DataObservabilityCollector {
  // OneUptime's workers, with the connection string saved on the store.
  OneUptime = "OneUptime",
  // A probe in the customer's network, with the connection string in its environment.
  Probe = "Probe",
}

export interface DataObservabilityStoreSummary {
  dataStoreId: string;
  name: string;
  kind: string;
  isTableHealthEnabled: boolean;
  collector: DataObservabilityCollector;
  probeName: string | null;
  // Collected, Failed, or null before the first collection.
  status: string | null;
  message: string | null;
  collectedAt: string | null;
  assetCount: number;
  lateAssetCount: number;
}

export interface DataObservabilityOverviewAsset {
  dataAssetId: string;
  assetKey: string;
  dataStoreName: string;
  lastChangedAt: string | null;
  updateIntervalInSeconds: number | null;
  overdueBySeconds: number;
}

export interface DataObservabilityOverviewChange {
  dataAssetId: string;
  assetKey: string;
  dataStoreName: string;
  eventType: string;
  feedInfoInMarkdown: string;
  postedAt: string | null;
}

export interface DataObservabilityOverview {
  storeCount: number;
  assetCount: number;
  lateAssetCount: number;
  droppedAssetCount: number;
  // Tables nobody has read for 90 days (DataAssetReads), and what they hold.
  unusedAssetCount: number;
  unusedSizeInBytes: number;
  schemaChangeCount: number;
  failingStoreCount: number;
  // The tables most overdue, worst first.
  lateAssets: Array<DataObservabilityOverviewAsset>;
  // The latest schema changes, newest first.
  recentChanges: Array<DataObservabilityOverviewChange>;
  stores: Array<DataObservabilityStoreSummary>;
}

// How far back the Overview counts schema changes.
export const SCHEMA_CHANGE_WINDOW_IN_DAYS: number = 7;

export interface DataObservabilityConnectStoreRequest {
  name: string;
  kind: string;
  // Saved on the store, for OneUptime's workers; or leave it out and name a probe.
  connectionString?: string | undefined;
  probeId?: string | undefined;
  probeConnectionVariable?: string | undefined;
}

export interface DataObservabilityConnectStoreResponse {
  dataStoreId: string;
}
