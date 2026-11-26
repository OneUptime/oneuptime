import { WatchedTablePricing } from "../Billing/PayAsYouGoPricing";
import { SkippedTableRead } from "./SkippedTables";
import { DataCheckAlertCondition } from "./DataCheckType";
import { DataCircuitBreakerReason } from "./DataCircuitBreaker";
import {
  DataAttentionItem,
  DataAttentionKind,
  DataCheckHealthAnswer,
  DataObservabilitySetup,
} from "./DataObservabilityAttention";
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
  attentionCount: string;
  issues: string;
  stores: string;
  connectStore: string;
  collectNow: (dataStoreId: string) => string;
  checkAlert: (dataCheckId: string) => string;
  checkRunNow: (dataCheckId: string) => string;
  checkHealth: string;
  dataProductSync: (dataProductId: string) => string;
  dataProductBadge: (dataProductId: string) => string;
  dataProductBadgeReset: (dataProductId: string) => string;
  reconciliationSync: (reconciliationId: string) => string;
  reconciliationRunNow: (reconciliationId: string) => string;
  checkSuggest: string;
  checkApply: string;
  alertExplanation: (alertId: string) => string;
  alertFeedback: (alertId: string) => string;
  alertLineage: (alertId: string) => string;
  quality: string;
  watchedTables: string;
  storeWatch: (dataStoreId: string) => string;
  tableFreshness: string;
  biSync: (dataBiConnectionId: string) => string;
  biRefreshAlert: (dataBiConnectionId: string) => string;
  tableDashboards: string;
  tableLineage: string;
  tableLineageAnswer: string;
  pipelineLineage: string;
  lineageExpand: string;
  lineageMap: string;
  tableSensitivity: string;
  tableErrors: string;
  aiAppTables: string;
  databaseServerStores: string;
  storagePaths: string;
  storagePathsSave: (dataStoreId: string) => string;
  sourceSuggestions: string;
  spendSummary: string;
  circuitBreaker: string;
  pipelineCircuitBreaker: (dataPipelineId: string) => string;
  storeSettings: (dataStoreId: string) => string;
  storeUpdate: (dataStoreId: string) => string;
  storeRemove: (dataStoreId: string) => string;
  storeDelete: (dataStoreId: string) => string;
  databaseAgents: string;
} = {
  overview: "/data-observability/overview",
  /*
   * How many things need someone now, counted, never listed: the count
   * beside Overview in the menu, on every Data Observability page.
   */
  attentionCount: "/data-observability/attention/count",
  // A page of what needs someone, worst first, filtered: the Issues page.
  issues: "/data-observability/issues",
  // Why a data alert most likely happened, and what depends on it.
  alertExplanation: (alertId: string): string => {
    return `/data-observability/alerts/${alertId}/explanation`;
  },
  alertFeedback: (alertId: string): string => {
    return `/data-observability/alerts/${alertId}/feedback`;
  },
  // The lineage around a data alert, with the ways to its cause and to the alerts it caused.
  alertLineage: (alertId: string): string => {
    return `/data-observability/alerts/${alertId}/lineage`;
  },
  // How well Data Observability is working for the project.
  quality: "/data-observability/quality",
  watchedTables: "/data-observability/watched-tables",
  // Starts or stops reading a database: one nobody watches costs nothing.
  storeWatch: (dataStoreId: string): string => {
    return `/data-observability/stores/${dataStoreId}/watch`;
  },
  stores: "/data-observability/stores",
  connectStore: "/data-observability/stores/connect",
  // The databases the project knows of that nobody has connected.
  sourceSuggestions: "/data-observability/stores/suggestions",
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
  // How each of some checks stands now: passing, failing (its alert open), or could not run.
  checkHealth: "/data-observability/checks/health",
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
  // Makes the project's checks match a file in its repository.
  checkApply: "/data-observability/checks/apply",
  // Whether a table is fresh, as one answer: what the MCP server's tool asks.
  tableFreshness: "/data-observability/tables/freshness",
  // Reads a BI tool's dashboards now, and says how it went.
  biSync: (dataBiConnectionId: string): string => {
    return `/data-observability/bi-connections/${dataBiConnectionId}/sync`;
  },
  // Makes the BI tool's monitor on failed refreshes match it: made, kept or removed.
  biRefreshAlert: (dataBiConnectionId: string): string => {
    return `/data-observability/bi-connections/${dataBiConnectionId}/refresh-alert`;
  },
  // The dashboards built on a table, and on the tables built from it.
  tableDashboards: "/data-observability/tables/dashboards",
  // A table's lineage several steps each way, with how each table is now: what its Lineage tab draws.
  tableLineage: "/data-observability/tables/lineage",
  // A table's lineage told in words, problems first, by its name: what the MCP server's lineage tool asks.
  tableLineageAnswer: "/data-observability/tables/lineage/answer",
  // A pipeline's lineage: the tables it reads and writes, with how each is now: what its page draws.
  pipelineLineage: "/data-observability/pipelines/lineage",
  // The next tables a card of a lineage diagram does not draw: what pressing its count asks.
  lineageExpand: "/data-observability/lineage/expand",
  // Every flow the project has seen, newest first: who writes and reads which tables, and what feeds what. What the Lineage Map draws.
  lineageMap: "/data-observability/lineage/map",
  // What Data Security knows each of a table's columns holds.
  tableSensitivity: "/data-observability/tables/sensitivity",
  // The errors in the services that write a table, naming it.
  tableErrors: "/data-observability/tables/errors",
  // The late tables that AI apps read from.
  aiAppTables: "/data-observability/tables/ai-apps",
  // The databases a Database product server holds, with how their tables are.
  databaseServerStores: "/data-observability/stores/of-database-server",
  // The buckets a cloud connection found, and which of their paths are watched.
  storagePaths: "/data-observability/storage-paths",
  storagePathsSave: (dataStoreId: string): string => {
    return `/data-observability/storage-paths/${dataStoreId}`;
  },
  // What the project's warehouses spent over the last day: by team, by table, and where it is wasted.
  spendSummary: "/data-observability/spend/summary",
  /*
   * Should a pipeline run, given the tables it reads? Go, or stop with why
   * (DataCircuitBreaker): what a pipeline step asks before it runs, with a
   * project API key.
   */
  circuitBreaker: "/data-observability/circuit-breaker",
  // How a pipeline's circuit breaker stands: what its page shows.
  pipelineCircuitBreaker: (dataPipelineId: string): string => {
    return `/data-observability/pipelines/${dataPipelineId}/circuit-breaker`;
  },
  /*
   * A database's settings (#11147): how it is connected - never its
   * connection string - what else uses it, and what the caller may change.
   */
  storeSettings: (dataStoreId: string): string => {
    return `/data-observability/stores/${dataStoreId}/settings`;
  },
  // Renames a database, or changes how it is reached: a new login, another probe or Database Agent.
  storeUpdate: (dataStoreId: string): string => {
    return `/data-observability/stores/${dataStoreId}/update`;
  },
  // Data Observability stops reading a database and forgets its tables; Data Security keeps it.
  storeRemove: (dataStoreId: string): string => {
    return `/data-observability/stores/${dataStoreId}/remove`;
  },
  // Deletes a database from OneUptime: what Data Observability and Data Security keep of it too.
  storeDelete: (dataStoreId: string): string => {
    return `/data-observability/stores/${dataStoreId}/delete`;
  },
  // The Database Agents a database can be read through, with whether each can now (#11148).
  databaseAgents: "/data-observability/database-agents",
};

/*
 * How a pipeline's circuit breaker stands (DataCircuitBreaker.readState):
 * whether a late table stops it, when it was last asked, and since when it
 * has stopped the pipeline and why - each reason about a table its reader
 * may read.
 */
export interface DataPipelineCircuitBreakerState {
  dataPipelineId: string;
  stopsOnLateTables: boolean;
  // When it was last asked, ISO 8601; null before it ever was.
  checkedAt: string | null;
  // Since when it has stopped the pipeline, ISO 8601; null while it says go.
  stoppedAt: string | null;
  reasons: Array<DataCircuitBreakerReason>;
}

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
  // Views and viewers in the last 28 days, and the latest view; null where its tool does not say.
  viewCount?: number | null;
  viewerCount?: number | null;
  lastViewedAt?: string | null;
  // How the last refresh of its data went (a DataBiRefreshStatus), when, and a failed one's error.
  lastRefreshStatus?: string | null;
  lastRefreshAt?: string | null;
  lastRefreshError?: string | null;
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

export interface DataObservabilityBiRefreshAlertResponse {
  // The BI tool's monitor on failed refreshes, or null when it has none.
  monitorId: string | null;
}

export enum DataObservabilityCollector {
  // OneUptime's workers, with the connection string saved on the store.
  OneUptime = "OneUptime",
  // A probe in the customer's network, with the connection string in its environment.
  Probe = "Probe",
  /*
   * A Database Agent that already reaches the database (#11148), with the
   * logins of its own environment: it reads the catalog and runs the checks
   * with statements it builds itself (Utils/DataObservability/DatabaseAgent).
   */
  DatabaseAgent = "DatabaseAgent",
}

/*
 * Whether a Database Agent can read a database for Data Observability now,
 * and when it cannot, what stands in the way: each is said where the agent
 * is chosen and on the database's page, with the step that fixes it.
 */
export enum DataObservabilityAgentState {
  // On, connected, of an engine it reads.
  Ready = "Ready",
  // The database server has no Database Agent of its own registered.
  NoAgent = "NoAgent",
  // Its agent has not been heard from for a while.
  Offline = "Offline",
  // Its agent is older than Data Observability's agent work: it needs an update.
  NeedsUpdate = "NeedsUpdate",
  // Its agent's own setting leaves Data Observability off (ONEUPTIME_DATA_OBSERVABILITY).
  TurnedOff = "TurnedOff",
  // Its engine is not one the agent reads for Data Observability yet.
  EngineNotSupported = "EngineNotSupported",
}

// How many tables a project watches, and what they cost it.
export interface DataObservabilityWatchedTables {
  // False where nothing is billed, as on a self-hosted install: there is nothing to say.
  isBilled: boolean;
  // True once the install has named a price. Before that, the cost is only what it would be.
  isCharging: boolean;
  tableCount: number;
  monthlyCostInUSD: number;
  pricing: WatchedTablePricing;
  // False for a project with no way to pay that has used its free tables.
  canAddTables: boolean;
}

export interface DataObservabilityStoreSummary {
  dataStoreId: string;
  name: string;
  kind: string;
  isTableHealthEnabled: boolean;
  collector: DataObservabilityCollector;
  probeName: string | null;
  /*
   * A database read through a Database Agent (#11148): the database server
   * it reports as, and whether its agent can read the database now. Left
   * out for the other collectors, and by an older server.
   */
  databaseServerName?: string | null | undefined;
  agentState?: DataObservabilityAgentState | null | undefined;
  // Collected, Failed, or null before the first collection.
  status: string | null;
  message: string | null;
  collectedAt: string | null;
  /*
   * When the last collection ended, collected or failed: what Collect Now
   * waits to pass the time it asked (requestedAt). Null for a store not
   * collected since the server began keeping it; left out by an older one.
   */
  attemptedAt?: string | null | undefined;
  assetCount: number;
  lateAssetCount: number;
  // The monitors on, scoped to the whole database: its recommended alerts, or its own.
  alertMonitorCount: number;
  /*
   * The tables the database keeps refusing, skipped until their next try
   * (#9541): a Dataverse table the app may not read, or one Dataverse
   * cannot count or describe. Empty when none is; left out by an older
   * server.
   */
  skippedTables?: Array<DataObservabilitySkippedTable> | undefined;
}

// One table a database keeps refusing, as the database's page lists it.
export interface DataObservabilitySkippedTable {
  table: string;
  // What is not read of it.
  read: SkippedTableRead;
  // The database's answer, in its own words.
  reason: string;
  // When it is asked again, ISO 8601.
  nextTryAt: string;
}

export interface DataObservabilityOverviewAsset {
  dataAssetId: string;
  assetKey: string;
  // Its database: whether that database's alerts are on says whether anyone is told.
  dataStoreId?: string | null | undefined;
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
  /*
   * What needs someone now, worst first (DataObservabilityAttention), at most
   * MAX_DATA_ATTENTION_ITEMS of them; attentionCount is how many in all.
   */
  attention: Array<DataAttentionItem>;
  attentionCount: number;
  // Checks whose alert is open, that the reader may see.
  failingCheckCount: number;
  // How far the project has set Data Observability up: the Overview's first steps.
  setup: DataObservabilitySetup;
}

// How many things need someone now: what the menu's count beside Overview says.
export interface DataObservabilityAttentionCountResponse {
  count: number;
}

// Whether anyone has been told of an item: an alert about it is open, or none is.
export enum DataObservabilityIssueAlertFilter {
  Open = "open",
  None = "none",
}

// The owner filter's value for the items that can have owners and have none.
export const DATA_OBSERVABILITY_NO_OWNER_FILTER: string = "none";

export interface DataObservabilityIssuesRequest {
  // Only these kinds; every kind when left out.
  kinds?: Array<DataAttentionKind> | undefined;
  // One database's: the database itself, and its tables and checks.
  dataStoreId?: string | undefined;
  /*
   * Whose: an owner's key ("user:<id>" or "team:<id>"), or
   * DATA_OBSERVABILITY_NO_OWNER_FILTER for what can have owners and has none.
   */
  owner?: string | undefined;
  alert?: DataObservabilityIssueAlertFilter | undefined;
  skip?: number | undefined;
  limit?: number | undefined;
}

// Someone who owns at least one of the items: what the owner filter offers.
export interface DataObservabilityIssueOwner {
  // "user:<id>" or "team:<id>".
  key: string;
  kind: "user" | "team";
  id: string;
  name: string;
}

export interface DataObservabilityIssuesResponse {
  // This page of the items that match, worst first.
  items: Array<DataAttentionItem>;
  // How many match the filters.
  count: number;
  // How many need someone in all, whatever the filters.
  totalCount: number;
  skip: number;
  limit: number;
  // The databases: the database filter's choices, and whether each one's alerts are on.
  stores: Array<DataObservabilityStoreSummary>;
  // Everyone who owns one of the items, for the owner filter.
  owners: Array<DataObservabilityIssueOwner>;
}

// The most items one page of Issues holds, and how many it holds when not asked.
export const MAX_DATA_OBSERVABILITY_ISSUES_PAGE: number = 100;
export const DEFAULT_DATA_OBSERVABILITY_ISSUES_PAGE: number = 25;

export interface DataObservabilityCheckHealthRequest {
  // The checks to answer for: the page of a list, at most MAX_CHECK_HEALTH_IDS.
  dataCheckIds: Array<string>;
}

export interface DataObservabilityCheckHealthResponse {
  // By check id; a check not found in the project is left out.
  checks: { [dataCheckId: string]: DataCheckHealthAnswer };
}

// The most checks one status answer covers: more than a page of any list.
export const MAX_CHECK_HEALTH_IDS: number = 200;

// How far back the Overview counts schema changes.
export const SCHEMA_CHANGE_WINDOW_IN_DAYS: number = 7;

export interface DataObservabilityConnectStoreRequest {
  // A store the project already knows of takes the connection, rather than a new one.
  dataStoreId?: string | undefined;
  name: string;
  kind: string;
  // Saved on the store, for OneUptime's workers; or leave it out and name a probe.
  connectionString?: string | undefined;
  probeId?: string | undefined;
  probeConnectionVariable?: string | undefined;
  // Or a database server whose Database Agent reads the database, and which of its databases (#11148).
  databaseServerId?: string | undefined;
  databaseName?: string | undefined;
}

/*
 * HOW A DATABASE IS REACHED, AS ITS SETTINGS SHOW IT (#11147).
 *
 * Never the connection string: only whether one is saved. A probe's
 * variable names where the probe holds it; a Database Agent's database
 * says which of its server's databases it reads.
 */
export interface DataObservabilityStoreConnection {
  collector: DataObservabilityCollector;
  hasConnectionString: boolean;
  probe: { id: string; name: string } | null;
  probeConnectionVariable: string | null;
  databaseServer: { id: string; name: string } | null;
  databaseName: string | null;
  // For a Database Agent, whether it can read the database now.
  agentState: DataObservabilityAgentState | null;
}

/*
 * What else uses a database, for the confirmations of Remove and Delete
 * (#11147): taking it away says what breaks first. Data Observability's
 * part goes with either; Data Security's only with Delete.
 */
export interface DataObservabilityStoreUses {
  // Data Observability: its tables and their history, their checks, and the monitors on it.
  tableCount: number;
  checkCount: number;
  monitorCount: number;
  // Data Security: what its scans found and keep of it.
  isContentScanned: boolean;
  findingCount: number;
  // Every issue of it, open or closed: the history Delete takes with it.
  issueCount: number;
  scanCount: number;
  ownerCount: number;
  hasRecordOfProcessing: boolean;
  /*
   * How Data Security came to list it: "Data Observability" when it was
   * connected here, a discovery's name when Data Security found it (it is
   * found again while it still exists there), "Manual" when someone added
   * it in Data Security.
   */
  foundFrom: string | null;
}

export interface DataObservabilityStoreSettings {
  dataStoreId: string;
  name: string;
  kind: string;
  isTableHealthEnabled: boolean;
  connection: DataObservabilityStoreConnection;
  uses: DataObservabilityStoreUses;
  /*
   * Whether Data Security relies on the database: it found or added it, or
   * holds something of it. Then only someone who may delete Data
   * Security's data stores deletes it.
   */
  isDataSecurityRelyingOnIt: boolean;
  // What the caller may do here: rename it, change how it is reached, remove it, delete it.
  canEdit: boolean;
  /*
   * Why the caller may not change the connection Data Security samples
   * with, when they may not (a Database Agent stays open to them); null
   * when they may.
   */
  connectionRefusal: DataObservabilityStoreRefusal | null;
  canRemove: boolean;
  // Why the caller may not delete it, when they may not; null when they may.
  deleteRefusal: DataObservabilityStoreRefusal | null;
}

// Why a database's settings refuse a change, worded by the page that draws it.
export enum DataObservabilityStoreRefusal {
  // The caller may not connect databases to Data Observability.
  NotPermitted = "NotPermitted",
  // Data Security samples its content with this connection.
  DataSecuritySamplesIt = "DataSecuritySamplesIt",
  // Data Security relies on the database: only its admins delete it.
  DataSecurityReliesOnIt = "DataSecurityReliesOnIt",
}

// A database's new name, or its new way in: either, or both.
export interface DataObservabilityStoreUpdateRequest {
  name?: string | undefined;
  connection?:
    | {
        collector: DataObservabilityCollector;
        // OneUptime connects: a new connection string, or none to keep the saved one.
        connectionString?: string | undefined;
        probeId?: string | undefined;
        probeConnectionVariable?: string | undefined;
        databaseServerId?: string | undefined;
        databaseName?: string | undefined;
      }
    | undefined;
}

/*
 * A database server with a Database Agent of its own, as Connect a Database
 * and a database's settings offer it (#11148): whether its agent can read a
 * database for Data Observability now, and the engine it reports.
 */
export interface DataObservabilityDatabaseAgent {
  databaseServerId: string;
  name: string;
  // The engine its collector reports (db.system.name), when it has said.
  engine: string | null;
  // The Data Observability engine a database read through it is collected as.
  kind: string | null;
  state: DataObservabilityAgentState;
  agentVersion: string | null;
  // Whether the agent runs the project's Custom SQL and Failing Rows checks: only when its owner turned it on.
  runsCustomSql: boolean;
}

/*
 * Collect Now's answer: when the server asked for the collection, by its
 * own clock, so the page knows the collection it asked for has ended once
 * the store's attemptedAt passes it.
 */
export interface DataObservabilityCollectNowResponse {
  requestedAt: string;
}

export interface DataObservabilityConnectStoreResponse {
  dataStoreId: string;
}

// Where the project first heard of a database nobody has connected.
export enum DataObservabilitySourceOrigin {
  Traces = "Traces",
  DatabaseMonitoring = "Database Monitoring",
  CloudAccount = "Cloud Account",
  // Read by a BI tool's dashboards (DataBiLineageSummary): offered from Tables Matched.
  BiTool = "BI Tool",
  // Removed from Data Observability, and kept by Data Security (#11147).
  Removed = "Removed",
}

export interface DataObservabilitySourceSuggestion {
  // Stable across visits: what a dismissal remembers.
  id: string;
  // The store connecting fills in; none for a kind connecting makes a new store for.
  dataStoreId: string | null;
  name: string;
  // The engine to preselect, when the suggestion can tell.
  kind: string | null;
  origin: DataObservabilitySourceOrigin;
  // A connection string to start from, with placeholders for its user and password.
  connectionExample: string | null;
  // Whether Data Security keeps a connection string for it, which connecting may keep.
  hasSavedConnection?: boolean | undefined;
  // The database server Database Monitoring found it on, whose Database Agent may read it (#11148).
  databaseServerId?: string | null | undefined;
}

// What applying a file of checks did, or would do on a dry run: each named "table: check".
export interface DataObservabilityCheckApplyResult {
  isDryRun: boolean;
  created: Array<string>;
  updated: Array<string>;
  unchanged: Array<string>;
  removed: Array<string>;
  // Any at all, and nothing was applied.
  errors: Array<string>;
  // What was applied, but did not all go through: a check saved whose alert could not be set up.
  warnings: Array<string>;
}

export interface DataObservabilityTableErrorException {
  id: string;
  type: string;
  message: string;
  serviceName: string;
  count: number;
  lastSeenAt: string | null;
}

export interface DataObservabilityTableErrorLog {
  time: string;
  severity: string;
  body: string;
  serviceName: string;
}

// The errors in the services that write a table, that name it.
export interface DataObservabilityTableErrors {
  services: Array<string>;
  exceptions: Array<DataObservabilityTableErrorException>;
  logs: Array<DataObservabilityTableErrorLog>;
}

// A late table an AI app reads from.
export interface DataObservabilityAiAppTable {
  dataAssetId: string;
  table: string;
  serviceName: string;
  lastChangedAt: string | null;
}

// A bucket a cloud connection found, and which of its paths are watched like tables.
export interface DataObservabilityStoragePathStore {
  dataStoreId: string;
  name: string;
  kind: string;
  watchedPaths: string;
  status: string | null;
  message: string | null;
  collectedAt: string | null;
}
