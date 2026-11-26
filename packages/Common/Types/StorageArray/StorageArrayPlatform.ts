import type IconProp from "../Icon/IconProp";
import type MetricsAggregationType from "../Metrics/MetricsAggregationType";
import type RollingTime from "../RollingTime/RollingTime";
import { FilterType } from "../Monitor/CriteriaFilter";
import type {
  StorageArrayResourceFilters,
  StorageArrayResourceScope,
} from "../Monitor/MonitorStepStorageArrayMonitor";
import StorageArrayResourceKind from "./StorageArrayResourceKind";
import type StorageSystem from "./StorageSystem";

/*
 * ONE STORAGE PLATFORM, AS STORAGE ARRAYS KNOWS IT (#11000).
 *
 * Storage Arrays' data model is vendor-neutral: an array keeps its capacity,
 * alerts and hardware health (StorageArray), its inventory is a list of
 * volumes, hosts, drives and the rest with the same columns
 * (StorageArrayResource), and an array of a platform OneUptime does not know
 * is still discovered and listed under the `storage.system` its agent
 * stamped. What is platform-specific is how metrics become that model, which
 * metrics to watch, and how the pages read the platform. That is all here,
 * one StorageArrayPlatform per platform.
 *
 * ADDING A PLATFORM (NetApp ONTAP, Dell PowerStore, ...) touches no other
 * platform's files:
 *
 *   1. Common/Types/StorageArray/Platforms/<Vendor>/<Product>/: its
 *      StorageArrayPlatform (this interface), its metric catalog and its
 *      alert template specs. Add one line to
 *      Platforms/StorageArrayPlatforms.ts.
 *   2. Common/Server/Utils/Telemetry/StorageArray/<Vendor>/: its extractor,
 *      which turns one of its datapoints into inventory rows and snapshot
 *      state (StorageArrayExtractor). Add one line to
 *      StorageArray/StorageArrayExtractors.ts.
 *   3. agents/StorageArrayAgent/: its collector config, and one line in
 *      install.sh's PLATFORMS table, from which the script builds its menu,
 *      the .env it writes, the files it downloads and the compose profiles
 *      it stops. Its agentConfigs here say the same, for the setup guide
 *      (StorageArrayAgentPlatforms.test.ts holds the two in step). A sidecar
 *      exporter is a service with its own compose profile in
 *      docker-compose.yml. Every OneUptime serves the config once it is in
 *      the agent's files in Common/Types/InstallScripts/InstallScripts.ts.
 *   4. Its row in the supported platforms table of
 *      Docs/Content/<lang>/telemetry/storage-arrays.md.
 *
 * What a kind's pages say and chart is the platform's too (kindPages,
 * #11122): the shared kinds' lists and part pages read their words, their
 * columns and their charts from the array's platform, and a kind only one
 * platform has is listed and drawn from its kindPages alone.
 *
 * Still Pure Storage's alone, each a follow-up of #11000: the Dashboard's
 * setup guide steps (Pages/StorageArray/Utils/DocumentationMarkdown.ts
 * offers an agent config once its steps and collector config are there,
 * #11123), troubleshoot.sh's probes (#11124), the storage array dashboard
 * template (#11125), and a platform's own kinds in Ask AI's page context
 * and the topology (#11126).
 *
 * Everything that reads a platform - ingest, the metric catalog, alert
 * templates, Recommendations, the criteria evaluator, the pages, the setup
 * guide's platform picker - reads it from StorageArrayPlatformRegistry. A
 * guard test (StorageArrayVendorNamesGuard) fails on a vendor's metric name
 * anywhere outside its own folders, so no platform's names leak into shared
 * code; StorageArrayAcmePlatform.test.ts registers a made-up platform in a
 * test alone and follows it from ingest to its tabs, counts, monitor
 * template and alert.
 *
 * Every word a person reads (labels, descriptions) is an English
 * translation key: wrap it in translationKey(), and the Dashboard's
 * i18n:extract finds it here (Platforms/ is one of its source roots).
 *
 * This file and every platform definition import only modules that never
 * lead back to the registry (enums, types and this file): the registry
 * imports the platforms, so a platform that imported a reader of the
 * registry would close an import cycle that breaks in some load orders.
 * StorageArrayPlatformImportsGuard.test.ts holds them to it.
 */

/*
 * The statuses a platform writes for a part (a hardware component, drive,
 * controller, network interface, replica link), lowercased, by what they
 * mean: a critical one makes the array's health Critical, a warning one
 * Warning (StorageArraySnapshotScan, the pages' StorageArrayHealth). A
 * status in neither list is never a problem by itself.
 */
export interface StorageArrayComponentStatuses {
  critical: ReadonlyArray<string>;
  warning: ReadonlyArray<string>;
  /*
   * The words that mean all is well (green on the pages), beside the
   * shared ones (ok, healthy, ready, enabled, online, replicating).
   */
  healthy?: ReadonlyArray<string> | undefined;
}

/*
 * The words every platform so far uses. A platform whose parts report in
 * other words declares its own lists.
 */
export const STORAGE_ARRAY_COMPONENT_STATUSES: StorageArrayComponentStatuses = {
  critical: ["critical", "failed", "missing", "unhealthy"],
  warning: ["degraded", "unknown", "unrecognized", "not ready"],
};

/*
 * One metric a platform's monitors can watch (StorageArrayMetricCatalog
 * re-exports these types; they live here so a platform's catalog imports
 * no reader of the registry).
 */
export type StorageArrayMetricCategory =
  | "Array Health"
  | "Capacity"
  | "Performance"
  | "Volumes"
  | "Hosts"
  | "Replication"
  | "Hardware"
  | "File Systems"
  | "Buckets";

export interface StorageArrayMetricDefinition {
  id: string;
  friendlyName: string;
  description: string;
  metricName: string;
  /*
   * Datapoint label filters that make the series mean what friendlyName
   * says. A platform that puts several quantities on ONE metric name (Pure
   * tells read, write, queue and SAN latency apart only by a `dimension`
   * label) pins the one this entry means, so aggregating never mixes them.
   */
  attributes?: Record<string, string> | undefined;
  category: StorageArrayMetricCategory;
  // The platforms that export this metric.
  storageSystems: Array<StorageSystem>;
  defaultAggregation: MetricsAggregationType;
  defaultResourceScope: StorageArrayResourceScope;
  /*
   * The datapoint label naming the object, when this metric does not use
   * the one its scope normally does on its platform (objectLabels): a
   * replica link series names its pod `local_pod`, say.
   */
  objectLabel?: string | undefined;
  unit?: string;
}

/*
 * The unit of a platform's series whose exporter declares none (NetApp
 * Harvest writes no UNIT lines): a regular expression over the metric's
 * name and the unit it means, spelled as the catalogs spell units. The
 * first rule whose pattern matches wins; "" means a number with no unit
 * (a state, a label series). StorageArrayMetricUnitUtil reads them.
 */
export interface StorageArrayUnitRule {
  pattern: string;
  unit: string;
}

/*
 * The kinds whose status decides the array's hardware health, unless a
 * platform names its own: physical parts, not their network ports.
 */
export const STORAGE_ARRAY_HARDWARE_KINDS: ReadonlyArray<string> = [
  StorageArrayResourceKind.Hardware,
  StorageArrayResourceKind.Drive,
  StorageArrayResourceKind.Controller,
];

/*
 * A kind of object only this platform has (StorageArrayResourceKind lists
 * the shared ones), with the words its tab, counts and lists use. Every
 * label is a translation key.
 */
export interface StorageArrayKindDefinition {
  kind: string;
  singularLabel: string;
  pluralLabel: string;
  // How a count of them reads: { one: "{{count}} aggregate", other: ... }.
  countLabel: { one: string; other: string };
  icon: IconProp;
  // What its tab's table lists, and what it says while it lists nothing.
  description: string;
  noItemsMessage: string;
}

/*
 * Which kind of inventory object a metric family's object label names, for
 * an incident's Affected Resources (MonitorCriteriaEvaluator): a metric
 * whose name starts with `prefix` names an object of `kind`, or no
 * inventory object at all (null: a volume group, say). The first family
 * that matches wins, so list a narrower prefix before a wider one.
 */
export interface StorageArrayMetricFamily {
  prefix: string;
  kind: string | null;
}

/*
 * One alert template, as data (StorageArrayAlertTemplates builds the
 * monitor step): one query, one threshold that fires and one that
 * recovers. Its id is stored on every monitor made from it, so it never
 * changes once shipped.
 */
export type StorageArrayAlertTemplateCategory =
  | "Availability"
  | "Array Health"
  | "Capacity"
  | "Performance"
  | "Hardware"
  | "Hosts"
  | "Replication"
  | "File Systems";

export type StorageArrayAlertTemplateSeverity = "Critical" | "Warning";

export interface StorageArrayAlertTemplateSpec {
  id: string;
  name: string;
  /*
   * One plain sentence: when the template fires, with its threshold and
   * window, without metric names. The picker and a resource's
   * Recommendations list show it on the card; `description` (how it is
   * computed, and its caveats) is shown once a template is picked.
   */
  summary: string;
  description: string;
  category: StorageArrayAlertTemplateCategory;
  severity: StorageArrayAlertTemplateSeverity;
  metricAlias: string;
  metricName: string;
  attributes?: Record<string, string> | undefined;
  groupByAttributeKey?: string | undefined;
  /*
   * The labels that scope the object's name, where it is unique only
   * within them: an ONTAP volume within its svm (two SVMs can each have a
   * vol1), a port within its node. Grouped by after groupByAttributeKey,
   * so each is one incident.
   */
  scopeAttributeKeys?: ReadonlyArray<string> | undefined;
  aggregationType: MetricsAggregationType;
  rollingTime: RollingTime;
  fire: {
    filterType: FilterType;
    value: number;
    /*
     * Fire on any reading of the window past the line, for an event that is
     * a series for a moment only (an ONTAP EMS event, exported for the one
     * poll that collected it). Otherwise every reading of the window must
     * be past it, which waits for the series to cover the window.
     */
    onAnyReading?: boolean | undefined;
  };
  recover: {
    filterType: FilterType;
    value: number;
    isBinaryMetric?: boolean | undefined;
    treatNoDataAsZero?: boolean | undefined;
  };
  incidentTitle: string;
  incidentDescription: string;
  criteriaName: string;
  criteriaDescription: string;
  /*
   * A template whose line is relative to another series of the same
   * object, not a number: a NetApp SnapMirror relationship's lag against
   * its schedule. The monitor reads this second series too, grouped like
   * the first, and its criteria read the quotient (the first query's value
   * over this one's, per object) under `formulaAlias`; fire and recover
   * are its lines.
   */
  ratioTo?: StorageArrayAlertTemplateRatio | undefined;
}

export interface StorageArrayAlertTemplateRatio {
  metricAlias: string;
  metricName: string;
  attributes?: Record<string, string> | undefined;
  aggregationType: MetricsAggregationType;
  // The quotient's alias: what the criteria and the incident's figure name.
  formulaAlias: string;
  // Its unit, for the criteria's figures ("" for a plain ratio).
  unit?: string | undefined;
}

/*
 * Recovery for a state-in-a-label series (an open alert, a failed part):
 * the series exists only while the object is in that state, so the monitor
 * recovers once it is gone (no data counts as 0).
 */
export const STORAGE_ARRAY_RECOVER_WHEN_ABSENT: StorageArrayAlertTemplateSpec["recover"] =
  {
    filterType: FilterType.EqualTo,
    value: 0,
    treatNoDataAsZero: true,
  };

/*
 * The series every scrape of every endpoint exports (an identity series,
 * value 1), which "Array Stopped Reporting" counts: a window with none is
 * the array gone silent. Every platform has one; its template id is the
 * one a new storage array monitor opens on.
 */
export interface StorageArrayHeartbeat {
  templateId: string;
  metricName: string;
}

/*
 * One card of an array's Resource Usage page: catalog metric ids drawn
 * together; the per-object ones split by the label that names the object.
 */
export interface StorageArrayInsightsSection {
  key: string;
  title: string;
  description: string;
  icon: IconProp;
  metricIds: Array<string>;
  groupByObject?: boolean | undefined;
}

/*
 * The Overview's Golden Signals: read and write drawn together on one
 * panel each, then capacity used, by catalog id.
 */
export interface StorageArrayGoldenCharts {
  readLatency: string;
  writeLatency: string;
  readIops: string;
  writeIops: string;
  readBandwidth: string;
  writeBandwidth: string;
  capacityUsed: string;
  // What the capacity panel's (i) says: a translation key.
  capacityUsedDescription: string;
}

/*
 * The array's latest average latency, as its latency alerts read it: the
 * newest reading of `metricName` per value of `dimensionLabel` among the
 * series that carry `attributes`. Its health turns Warning past the lines
 * its High Read and Write Latency alerts fire at; null where the platform
 * has no such alert.
 */
export interface StorageArrayLatencyReading {
  /*
   * Read and write latency on one metric, told apart by a label (Pure's
   * dimension label): the newest reading per value of `dimensionLabel`.
   */
  metricName?: string | undefined;
  attributes?: Record<string, string> | undefined;
  dimensionLabel?: string | undefined;
  readDimension?: string | undefined;
  writeDimension?: string | undefined;
  /*
   * Or each on a metric of its own (NetApp's cluster read and write
   * latency): the newest reading of each.
   */
  readMetricName?: string | undefined;
  writeMetricName?: string | undefined;
  readWarningUsec: number;
  writeWarningUsec: number | null;
}

/*
 * A series whose every datapoint at 1 is a problem the platform reports
 * open, worded by its labels (NetApp's broken disks alerts series: one
 * series per broken disk, while it is broken). The ingest counts them as
 * the array's open alerts, by severity, and the Overview's Active Alerts
 * card lists them. A platform whose open alerts are one series with a
 * summary label each (Pure's) uses overview.alertMetricName instead.
 */
export interface StorageArrayOpenProblemSeries {
  metricName: string;
  /*
   * What the card says about one: a translation key whose {{slots}} are
   * labels of the series ("Disk {{disk}} is broken").
   */
  summary: string;
  // The labels that make one problem one row, however many scrapes carry it.
  keyLabels: ReadonlyArray<string>;
  // The label naming the part it is about, shown beside it.
  componentLabel?: string | undefined;
  // The label holding its severity, and the values that make it critical.
  severityLabel?: string | undefined;
  criticalSeverities: ReadonlyArray<string>;
}

/*
 * A reading the inventory has no column for, newest per object: the
 * newest value of `metricName` per value of `labelAttribute`, among the
 * series that carry `attributes`.
 */
export interface StorageArrayLatestReading {
  metricName: string;
  attributes?: Record<string, string> | undefined;
  labelAttribute: string;
}

export interface StorageArrayOverview {
  goldenCharts?: StorageArrayGoldenCharts | undefined;
  // One series per open alert the array raised (value 1), with labels.
  alertMetricName?: string | undefined;
  /*
   * Or the open problems the platform reports on series of their own, each
   * worded by its labels (StorageArrayOpenProblemSeries).
   */
  openProblems?: ReadonlyArray<StorageArrayOpenProblemSeries> | undefined;
  /*
   * What the Active Alerts card says when the alert details cannot be read
   * (where the vendor's own console lists them): a translation key.
   */
  alertDetailsUnavailable?: string | undefined;
  /*
   * The inventory counts the hero shows, in order. `showWhenZero` false
   * hides a count of 0 (no pods is not worth a chip).
   */
  countChips: Array<{ kind: string; showWhenZero: boolean }>;
  /*
   * The last golden tile: the count of `kind`, with the count of
   * `sublabelKind` under it, and the Storage Arrays list's Inventory column.
   */
  inventoryTile?: { kind: string; sublabelKind?: string | undefined };
  // The counts the Storage Arrays list's Inventory column shows, in order.
  listCounts: Array<string>;
  // The kind the Slowest and Largest lists rank.
  topKind?: string | undefined;
  latency?: StorageArrayLatencyReading | undefined;
  // Each file system's share of its size still free, 0 to 1.
  fileSystemFreeSpace?: StorageArrayLatestReading | undefined;
}

/*
 * One table of an array's Hardware tab. The Dashboard draws a kind's
 * columns; `layout` picks another set for a kind a platform reports
 * differently (a FlashBlade's parts carry a slot and a health, not a
 * temperature). Words are translation keys.
 */
export type StorageArrayHardwareTableLayout = "default" | "slot-and-health";

export interface StorageArrayHardwareTable {
  kind: string;
  layout: StorageArrayHardwareTableLayout;
  // The table's id: it keys the columns a person chose to show. Never change it.
  tableId: string;
  description: string;
  noItemsMessage: string;
  /*
   * What the table is called, where the kind's own words do not fit this
   * platform's parts (a NetApp controller is a node). Translation keys.
   */
  words?:
    | { title: string; singularName: string; pluralName: string }
    | undefined;
  /*
   * Only the parts whose componentType is one of these: one kind split
   * into tables (a NetApp cluster's shelves apart from their sensors).
   */
  componentTypes?: ReadonlyArray<string> | undefined;
  /*
   * The table's columns, where the Dashboard's for the kind do not fit
   * what this platform reports about it (StorageArrayKindColumn).
   */
  columns?: ReadonlyArray<StorageArrayKindColumn> | undefined;
}

/*
 * A deployment of this platform that runs on hardware its vendor or cloud
 * runs for it (Amazon FSx for NetApp ONTAP), named by the osName its
 * extractor writes: it reports none of `kinds`, so its Hardware tab leaves
 * their tables out and says `note` instead. A translation key.
 */
export interface StorageArrayManagedDeployment {
  osName: string;
  kinds: ReadonlyArray<string>;
  note: string;
}

/*
 * ---------------------------------------------------------------------
 * WHAT A KIND'S PAGES SAY AND DRAW ON THIS PLATFORM (#11122).
 *
 * The pages of the kinds platforms share (Volumes, Hosts, Replication,
 * Directories, File Systems, Buckets and their part pages) are shared
 * code; what they say about a platform's objects, and which of its metrics
 * they chart, are the platform's (StorageArrayPlatform.kindPages). A kind
 * only one platform has (NetApp's aggregates) is listed and drawn from its
 * kindPages entry alone: the list's columns, the part page's details and
 * charts. Every word is a translation key.
 * ---------------------------------------------------------------------
 */

// The columns of an inventory row a page can show.
export type StorageArrayRowColumn =
  | "name"
  | "status"
  | "statusDetail"
  | "componentType"
  | "model"
  | "firmwareVersion"
  | "groupName"
  | "capacityBytes"
  | "usedBytes"
  | "dataReductionRatio"
  | "readLatencyUsec"
  | "writeLatencyUsec"
  | "readIops"
  | "writeIops"
  | "readBytesPerSec"
  | "writeBytesPerSec"
  | "temperatureCelsius"
  | "replicationLagMs"
  | "connectionCount";

// How a value reads (StorageArrayResourceUtils formats each).
export type StorageArrayValueFormat =
  | "text"
  | "status"
  | "bytes"
  | "bytesPerSec"
  | "percent"
  | "ratio"
  | "latencyUsec"
  | "iops"
  | "perSec"
  | "durationMs"
  | "durationSeconds"
  | "count"
  | "celsius"
  | "speedMbps"
  | "boolean";

/*
 * One value of an inventory row: one of its columns, or a key of its
 * details (what the extractor keeps that has no column).
 */
export interface StorageArrayRowValue {
  column?: StorageArrayRowColumn | undefined;
  detail?: string | undefined;
  format: StorageArrayValueFormat;
}

/*
 * One column of a list a platform draws itself (after the name, which
 * every list starts with):
 *   - status: the part's state by the rules, coloured, with why;
 *   - usage: how full it is, the shared storage bar of capacityBytes and
 *     usedBytes, amber and red at the platform's capacity lines;
 *   - lag: its replication lag, amber past its rule;
 *   - latency / iops / bandwidth / performance: the shared tables' read
 *     and write columns of each;
 *   - value: any other value of the row;
 *   - lastSeen: when the row was last reported (hidden at first).
 */
export type StorageArrayKindColumn =
  | { type: "status"; title: string; description?: string | undefined }
  | {
      type: "usage";
      title: string;
      description: string;
      /*
       * Where its bar turns amber and red, in percent used: the lines of
       * the platform's alerts for the kind (default 80 and 90, the
       * array's capacity lines).
       */
      warningPercent?: number | undefined;
      criticalPercent?: number | undefined;
    }
  | { type: "lag"; title: string; description: string }
  | { type: "latency" }
  | { type: "iops" }
  | { type: "bandwidth" }
  | { type: "performance" }
  | {
      type: "value";
      // Unique among the list's columns: it keys the viewer's choices.
      id: string;
      title: string;
      description?: string | undefined;
      value: StorageArrayRowValue;
      hiddenByDefault?: boolean | undefined;
    }
  | { type: "lastSeen" };

// One fact of a part page's Details card, shown once the array reported it.
export interface StorageArrayKindField {
  title: string;
  description?: string | undefined;
  value: StorageArrayRowValue;
}

/*
 * One chart of a part page's Metrics tab: a metric of the platform's
 * catalog, scoped to the part (StorageArrayKindPart.labels).
 */
export interface StorageArrayPartChart {
  metricId: string;
  // What its line is called ("Read"); the metric's own name when absent.
  legend?: string | undefined;
  // Drawn on the chart before it (read and write latency on one panel).
  overlayWithPreviousQuery?: boolean | undefined;
}

/*
 * A datapoint label that names the part on the platform's series, and
 * which of the row's values it carries: a FlashArray volume's `name` is
 * its externalId; a NetApp volume is its `volume` (its name) in its `svm`
 * (its groupName), since two SVMs can each have a vol1; a NetApp LUN's
 * `lun` is a key of its details.
 */
export interface StorageArrayPartLabel {
  label: string;
  from: "externalId" | "name" | "groupName" | { detail: string };
}

// The part page of a kind: what it charts and says.
export interface StorageArrayKindPart {
  labels: ReadonlyArray<StorageArrayPartLabel>;
  charts: ReadonlyArray<StorageArrayPartChart>;
  // The Metrics card's description, and the Details card's.
  metricsDescription: string;
  detailsDescription: string;
  /*
   * What the page says while the inventory has no such part, a template
   * with {{name}}; the page's own words when absent.
   */
  notReportedMessage?: string | undefined;
  // The Storage card's description, for a kind whose page draws one.
  storageDescription?: string | undefined;
  /*
   * The Details card's facts, for a kind the platform draws itself; a
   * shared kind's page has facts of its own when this is absent.
   */
  fields?: ReadonlyArray<StorageArrayKindField> | undefined;
  /*
   * The platform's alert templates that watch parts of this kind, which
   * the part page offers to turn on: their card's words and the ids.
   */
  alerts?:
    | {
        title: string;
        description: string;
        templateIds: ReadonlyArray<string>;
      }
    | undefined;
}

export interface StorageArrayKindPage {
  /*
   * What the kind's list holds, and what it says while it holds nothing. A
   * kind only this platform has says it in its kindDefinition instead.
   */
  description?: string | undefined;
  noItemsMessage?: string | undefined;
  /*
   * The list's columns, for a kind the platform draws itself; a shared
   * kind's page has columns of its own when this is absent.
   */
  columns?: ReadonlyArray<StorageArrayKindColumn> | undefined;
  // Its parts' own page, when it has one.
  part?: StorageArrayKindPart | undefined;
  /*
   * What the Overview's inventory tile of this kind says, and its Largest
   * list, where the shared words do not fit the platform (a NetApp
   * volume's size is not flash after data reduction).
   */
  tileDescription?: string | undefined;
  topLists?:
    | {
        largestDescription: string;
        largestTooltip: string;
      }
    | undefined;
}

/*
 * One object filter a storage array monitor offers on this platform, with
 * what it filters on in this platform's terms: a translation key.
 */
export interface StorageArrayResourceFilter {
  key: keyof StorageArrayResourceFilters;
  description: string;
}

/*
 * One way the Storage Array Agent reads an array of this platform: one
 * collector config (agents/StorageArrayAgent), and the line for it in
 * agents/StorageArrayAgent/platforms.list (StorageArrayAgentPlatformsList
 * holds the two in step). It is an option of the setup guide's platform
 * picker.
 */
export interface StorageArrayAgentConfig {
  // The setup guide's option key, and the list's first field.
  key: string;
  label: string;
  description: string;
  badge?: string | undefined;
  collectorConfigFile: string;
  // The compose profile that starts its sidecar exporter; empty for none.
  composeProfile: string;
  endpointVariable: string;
  tokenVariable: string;
  exampleEndpoint: string;
  // The exporter sidecar it needs; null for an endpoint the array serves.
  exporterService: string | null;
  // The array kind in sentences ("FlashArray").
  arrayNoun: string;
  /*
   * The .env variable holding the read-only user's name, for a platform
   * that logs in with a user and a password (NetApp ONTAP, through
   * Harvest): its tokenVariable then holds the password. Absent for one
   * that authenticates with an API token alone.
   */
  userVariable?: string | undefined;
  // The name the guide and install.sh suggest for that user.
  exampleUser?: string | undefined;
  /*
   * The files besides its collector config that its exporter reads
   * (NetApp Harvest's netapp-harvest*.yml), shipped next to install.sh and
   * downloaded with it.
   */
  extraFiles?: ReadonlyArray<string> | undefined;
}

export interface StorageArrayPlatform {
  // ---------------- Identity ----------------

  /*
   * The value the agent stamps in `storage.system` and
   * StorageArray.storageSystem stores: vendor.product, lowercase.
   */
  storageSystem: string;
  displayName: string;
  shortName: string;
  vendorName: string;
  // Other spellings an agent may stamp, lowercase (StorageSystemUtil.normalize).
  aliases: ReadonlyArray<string>;

  // ---------------- Ingest ----------------

  /*
   * The prefix every metric of this platform's exporter starts with, when
   * it has one: the scan reads such a metric for this platform even when
   * the agent stamped no `storage.system`. Leave it out for an exporter
   * whose names carry no vendor prefix (NetApp Harvest's volume_*): only a
   * batch whose `storage.system` names this platform is read for it.
   */
  metricPrefix?: string | undefined;
  /*
   * The metric names the scan reads into the inventory and the snapshot.
   * Every other series stays in ClickHouse alone, for the charts.
   */
  snapshotMetricNames: ReadonlyArray<string>;
  /*
   * The units of its series, for an exporter that declares none
   * (StorageArrayUnitRule): the ingest records them, so every chart and
   * monitor of one of its series reads it in its unit.
   */
  unitRules?: ReadonlyArray<StorageArrayUnitRule> | undefined;
  /*
   * The agent's scrape jobs label their series `scrape_endpoint: <job>`. A
   * batch from one of these jobs is the complete list of its kinds, so a
   * kind whose last object was deleted counts 0. `all` and `metrics` (one
   * job scraping everything) complete every kind listed here; `array` (the
   * array's own endpoint) completes its list of open alerts.
   */
  scrapeEndpoints: Readonly<Record<string, ReadonlyArray<string>>>;
  /*
   * Or the kinds whose complete list its exporter itself says a batch
   * carries, object by object (NetApp Harvest's metadata series), which
   * its extractor marks complete: a platform whose one scrape job holds
   * every object, read or not.
   */
  exporterCompletedKinds?: ReadonlyArray<string> | undefined;

  // ---------------- Inventory ----------------

  // The kinds an array of this platform reports, in the order of its tabs.
  kinds: ReadonlyArray<string>;
  // Its own kinds' words: any kind not in StorageArrayResourceKind.
  kindDefinitions?: ReadonlyArray<StorageArrayKindDefinition> | undefined;
  // The kinds whose status decides hardware health (default: physical parts).
  hardwareKinds?: ReadonlyArray<string> | undefined;
  metricFamilies: ReadonlyArray<StorageArrayMetricFamily>;
  componentStatuses: StorageArrayComponentStatuses;
  /*
   * The datapoint label that names one object of each scope on this
   * platform: what a monitor's object filter equality-filters and a
   * per-object template groups by (getStorageArrayObjectLabel).
   */
  objectLabels: Readonly<Partial<Record<StorageArrayResourceScope, string>>>;
  /*
   * Its deployments that run on hardware their vendor or cloud runs
   * (StorageArrayManagedDeployment): Amazon FSx for NetApp ONTAP.
   */
  managedDeployments?: ReadonlyArray<StorageArrayManagedDeployment> | undefined;

  // ---------------- Monitoring ----------------

  /*
   * Its metric catalog (StorageArrayMetricCatalog): what its metric picker
   * offers, the units monitors read and the charts' labels. Ids are stored
   * on dashboards, so they never change once shipped.
   */
  metrics: ReadonlyArray<StorageArrayMetricDefinition>;
  heartbeat: StorageArrayHeartbeat;
  // Its alert templates, which are also what Recommendations offers.
  alertTemplates: ReadonlyArray<StorageArrayAlertTemplateSpec>;
  resourceFilters: ReadonlyArray<StorageArrayResourceFilter>;

  // ---------------- Pages ----------------

  overview: StorageArrayOverview;
  insightsSections: ReadonlyArray<StorageArrayInsightsSection>;
  hardwareTables: ReadonlyArray<StorageArrayHardwareTable>;
  /*
   * What each kind's pages say and chart on this platform, by kind
   * (StorageArrayKindPage, #11122). A shared kind without one reads its
   * pages' own words and charts; a kind only this platform has without one
   * is listed with the inventory's generic columns and has no part page.
   */
  kindPages?:
    | Readonly<Partial<Record<string, StorageArrayKindPage>>>
    | undefined;

  // ---------------- Agent ----------------

  agentConfigs: ReadonlyArray<StorageArrayAgentConfig>;
}
