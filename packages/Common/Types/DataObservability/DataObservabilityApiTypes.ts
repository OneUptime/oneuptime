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
} = {
  overview: "/data-observability/overview",
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
};

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
