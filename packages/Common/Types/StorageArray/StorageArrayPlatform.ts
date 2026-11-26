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
 * Still Pure Storage's alone, each a follow-up of #11000: the words and
 * charts of the shared kinds' pages (VolumeDetail and the rest chart Pure's
 * catalog ids, #11122), the Dashboard's setup guide steps
 * (Pages/StorageArray/Utils/DocumentationMarkdown.ts offers an agent config
 * once its steps and collector config are there, #11123), troubleshoot.sh's
 * probes (#11124), the storage array dashboard template (#11125), and a
 * platform's own kinds in Ask AI's page context and the topology (#11126).
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
  | "File Systems"
  // The alerts an array raises itself, read from the logs it sends.
  | "Array Alerts";

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
  aggregationType: MetricsAggregationType;
  rollingTime: RollingTime;
  fire: { filterType: FilterType; value: number };
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
}

/*
 * One alert template over the logs an array sends (its syslog), as data
 * (StorageArrayLogAlertTemplates builds the Logs monitor step): the lines
 * that open an alert, the attributes that tell one alert from another, and
 * the line that closes it. For a platform whose alerts arrive as logs
 * rather than as a metric (a PowerStore's): its agent parses the array's
 * records into log attributes, and these name them. Every attribute is
 * matched exactly; the builder adds the array's own name
 * (resource.storage.array.name) to both filters, so a monitor only ever
 * reads its array's lines. Its id is stored on every monitor made from it,
 * so it never changes once shipped.
 */
export interface StorageArrayLogAlertTemplateSpec {
  id: string;
  name: string;
  // One plain sentence: when it fires (see StorageArrayAlertTemplateSpec).
  summary: string;
  description: string;
  category: StorageArrayAlertTemplateCategory;
  severity: StorageArrayAlertTemplateSeverity;
  // The attributes a line that opens (or keeps open) an alert carries.
  attributes: Record<string, string>;
  // One OneUptime alert per value of these: the same on open and close.
  groupByAttributes: Array<string>;
  // The attributes of the line that closes a group's alert.
  resolvedByAttributes: Record<string, string>;
  // How far back each check looks for lines that open an alert.
  windowSeconds: number;
  incidentTitle: string;
  incidentDescription: string;
  criteriaName: string;
  criteriaDescription: string;
  // What the monitor's healthy state says.
  healthyDescription: string;
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
  metricName: string;
  attributes?: Record<string, string> | undefined;
  dimensionLabel: string;
  readDimension: string;
  writeDimension: string;
  readWarningUsec: number;
  writeWarningUsec: number | null;
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
   * For a platform whose parts are named within a chassis of their own (a
   * PowerStore's within each appliance): the title of a column, after the
   * name, showing each row's group (StorageArrayResource.groupName), so two
   * parts of one name read apart. A translation key.
   */
  groupColumnTitle?: string | undefined;
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
  /*
   * For an exporter that logs in to the array itself with a user and a
   * password (Dell's PowerStore exporter): the variable holding the user's
   * name. tokenVariable then holds the password, which only the exporter
   * reads. Unset for a read-only API token the collector sends.
   */
  userVariable?: string | undefined;
  tokenVariable: string;
  exampleEndpoint: string;
  // The exporter sidecar it needs; null for an endpoint the array serves.
  exporterService: string | null;
  // The array kind in sentences ("FlashArray").
  arrayNoun: string;
  /*
   * The files it runs with besides its collector config, shipped and served
   * next to it (an exporter's Dockerfile, a sidecar's config).
   */
  otherFiles?: ReadonlyArray<string> | undefined;
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
   * The agent's scrape jobs label their series `scrape_endpoint: <job>`. A
   * batch from one of these jobs is the complete list of its kinds, so a
   * kind whose last object was deleted counts 0. `all` and `metrics` (one
   * job scraping everything) complete every kind listed here; `array` (the
   * array's own endpoint) completes its list of open alerts.
   */
  scrapeEndpoints: Readonly<Record<string, ReadonlyArray<string>>>;

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
  /*
   * Its alert templates over the logs its arrays send, which Recommendations
   * offers beside those: Logs monitors, under the Array Alerts heading. For
   * a platform whose arrays report their own alerts as logs.
   */
  logAlertTemplates?: ReadonlyArray<StorageArrayLogAlertTemplateSpec> | undefined;
  resourceFilters: ReadonlyArray<StorageArrayResourceFilter>;

  // ---------------- Pages ----------------

  overview: StorageArrayOverview;
  insightsSections: ReadonlyArray<StorageArrayInsightsSection>;
  hardwareTables: ReadonlyArray<StorageArrayHardwareTable>;

  // ---------------- Agent ----------------

  agentConfigs: ReadonlyArray<StorageArrayAgentConfig>;
}
