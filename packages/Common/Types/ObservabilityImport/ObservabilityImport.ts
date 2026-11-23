import DashboardBaseComponent from "../Dashboard/DashboardComponents/DashboardBaseComponent";
import DashboardVariable from "../Dashboard/DashboardVariable";
import DashboardViewConfig from "../Dashboard/DashboardViewConfig";
import LogSeverity from "../Log/LogSeverity";
import MetricsAggregationType from "../Metrics/MetricsAggregationType";
import {
  AnomalyDetectionSensitivity,
  FilterType,
  EvaluateOverTimeType,
  NoDataPolicy,
} from "../Monitor/CriteriaFilter";
import RollingTime from "../RollingTime/RollingTime";

/*
 * BRINGING DASHBOARDS AND ALERTS OVER FROM GRAFANA, PROMETHEUS AND DATADOG
 * (issue #7697), IN ONEUPTIME'S WORDS.
 *
 * A person pastes or uploads what the other tool exports - a Grafana
 * dashboard's JSON, a Datadog dashboard's or monitors' export, a Prometheus
 * rule file, Grafana's alert rules - and OneUptime reads it in the browser
 * (Utils/ObservabilityImport), says item by item what it becomes and how
 * exactly, and only then creates anything, through the same create the
 * forms use.
 *
 * Every item is one of three:
 *
 *   - Exact: it reads the same data and shows it the same way;
 *   - Approximate: it is created, and its notes say plainly what differs;
 *   - NotConverted: nothing is created for it, and its notes say why.
 *
 * Nothing is guessed silently: a conversion that assumes something says
 * so in a note, and a note of kind Approximation makes its item
 * approximate. A query no rule here converts may be offered to OneUptime
 * AI (aiCandidate), whose answer the person reviews before it is used.
 */

export enum ImportItemStatus {
  Exact = "Exact",
  Approximate = "Approximate",
  NotConverted = "NotConverted",
}

export enum ImportNoteKind {
  // Something differs from the source: the item is approximate.
  Approximation = "Approximation",
  // Worth knowing, and nothing differs.
  Info = "Info",
  // Why nothing is created for the item.
  Reason = "Reason",
}

/*
 * One thing said about an item. `text` is an English sentence that is also
 * its key in the Dashboard's locales (translationKey), with {{placeholders}}
 * filled from `values`: names, queries and numbers from the file, drawn as
 * written.
 */
export interface ImportNote {
  kind: ImportNoteKind;
  text: string;
  values?: Record<string, string> | undefined;
}

// What a source file is, as OneUptime read it.
export enum ImportSourceKind {
  GrafanaDashboard = "GrafanaDashboard",
  DatadogDashboard = "DatadogDashboard",
  PrometheusRules = "PrometheusRules",
  GrafanaAlertRules = "GrafanaAlertRules",
  DatadogMonitors = "DatadogMonitors",
}

// The query languages a query arrives in, which OneUptime AI may convert.
export enum ImportQueryLanguage {
  PromQL = "PromQL",
  Datadog = "Datadog",
}

/*
 * A query no rule converted, which OneUptime AI may try: the query as the
 * file writes it, in its language, and the dashboard variables it may name.
 * Sent only when the person asks, and nothing but these.
 */
export interface ImportAiCandidate {
  language: ImportQueryLanguage;
  query: string;
  // The dashboard's variable names, so a query keeps naming them.
  variableNames: Array<string>;
  /*
   * Which query of which item it is (`<item key>:<query id>`): the answer,
   * once the person uses it, is handed back to the conversion under this
   * key (ImportQueryOverrides), which converts the item again with it.
   */
  targetKey?: string | undefined;
  // Whether the query is a monitor's, which must return an instant vector.
  isForMonitor?: boolean | undefined;
}

/*
 * Queries the person had OneUptime AI convert and chose to use, by their
 * candidate's targetKey: the conversion reads each in place of the query
 * the file holds.
 */
export type ImportQueryOverrides = ReadonlyMap<string, string>;

export const NO_QUERY_OVERRIDES: ImportQueryOverrides = new Map<
  string,
  string
>();

/*
 * What a query became: the PromQL OneUptime runs, and how it was reached.
 */
export interface ConvertedQuery {
  status: ImportItemStatus;
  promQL: string;
  notes: Array<ImportNote>;
  aiCandidate?: ImportAiCandidate | undefined;
}

// ---------------------------------------------------------------- dashboards

/*
 * One panel or widget of the source dashboard and what it becomes. A panel
 * that is not converted keeps its title and type, so the preview can say
 * which one it was.
 */
export interface DashboardImportItem {
  // Unique within the plan, in the source's order.
  key: string;
  title: string;
  // The source's own name for the panel's type ("timeseries", "query_value").
  sourceType: string;
  status: ImportItemStatus;
  notes: Array<ImportNote>;
  // The widget made from it; undefined when not converted.
  component?: DashboardBaseComponent | undefined;
  // The queries the widget runs, as converted, for the preview.
  queries: Array<ConvertedQuery>;
  /*
   * The query OneUptime AI may convert, for a panel whose only problem is
   * a query no rule converted.
   */
  aiCandidate?: ImportAiCandidate | undefined;
}

// A dashboard variable and what it was in the source.
export interface DashboardImportVariable {
  key: string;
  sourceName: string;
  sourceType: string;
  status: ImportItemStatus;
  notes: Array<ImportNote>;
  variable?: DashboardVariable | undefined;
  /*
   * True when the source picks the variable's first value on its own
   * (Grafana does, for a variable with no "All"): the preview looks the
   * project's values up and starts the variable on the first.
   */
  startsOnFirstValue?: boolean | undefined;
  // The metric whose values a variable lists, when the source names one.
  valuesOfMetric?: string | undefined;
}

export interface DashboardImportPlan {
  source: ImportSourceKind;
  title: string;
  description: string;
  items: Array<DashboardImportItem>;
  variables: Array<DashboardImportVariable>;
  // Notes about the whole dashboard.
  notes: Array<ImportNote>;
  // Board-wide defaults read from the source.
  viewConfigDefaults: Pick<
    DashboardViewConfig,
    "timeRange" | "refreshInterval"
  >;
}

// ------------------------------------------------------------------- alerts

/*
 * What a severity in the source means, read from its label or threshold:
 * the project's own severities are ranked, and these pick one by rank.
 */
export enum ImportedAlertSeverity {
  Critical = "Critical",
  Warning = "Warning",
}

/*
 * One alert rule or monitor of the source, and the monitor it becomes:
 * most often a Metrics monitor with one PromQL step, judged series by
 * series (ImportedAlertRuleKind).
 */
export interface AlertImportItem {
  key: string;
  name: string;
  // Where it sits in the source: a rule group, a folder.
  group: string;
  sourceType: string;
  status: ImportItemStatus;
  notes: Array<ImportNote>;
  // The rule, converted; undefined when not converted.
  rule?: ImportedAlertRule | undefined;
  aiCandidate?: ImportAiCandidate | undefined;
  // False for a rule the source has paused or switched off: it starts unticked.
  isEnabledInSource: boolean;
}

/*
 * The monitor an imported rule becomes, by what it reads:
 *
 *   - PromQL: a Metrics monitor whose step is one PromQL expression - every
 *     rule of Prometheus and Grafana, and Datadog's metric monitors,
 *     forecasts among them (issue #10325);
 *   - MetricQuery: a Metrics monitor whose step reads one metric with the
 *     query builder. An anomaly condition compares a metric with its own
 *     history, which a PromQL expression does not keep (issue #10325);
 *   - LogCount: a Logs monitor, which counts the logs its filters match in
 *     its window - Datadog's log monitors (issue #10324).
 */
export enum ImportedAlertRuleKind {
  PromQL = "PromQL",
  MetricQuery = "MetricQuery",
  LogCount = "LogCount",
}

/*
 * One metric, read the way the monitor form's query builder reads it: by
 * its stored name, narrowed to exact attribute values, its data points
 * combined with the aggregation, one series per value of the group-by keys.
 */
export interface ImportedMetricQuery {
  metricName: string;
  attributes: Record<string, string>;
  aggregation: MetricsAggregationType;
  groupByAttributeKeys: Array<string>;
}

/*
 * The logs a Logs monitor counts: exact attribute values, text the body
 * contains, the severities, one count per value of the group-by keys.
 * `searchText` says the same in the log search's words, for the preview.
 */
export interface ImportedLogQuery {
  attributes: Record<string, string>;
  bodyContains: string;
  severityTexts: Array<LogSeverity>;
  groupByAttributes: Array<string>;
  searchText: string;
}

export interface ImportedAlertRule {
  // What the monitor reads (ImportedAlertRuleKind); PromQL when left out.
  kind?: ImportedAlertRuleKind | undefined;
  // The PromQL each check evaluates, without the comparison; "" for the others.
  promQL: string;
  // The metric a MetricQuery rule reads.
  metricQuery?: ImportedMetricQuery | undefined;
  // The logs a LogCount rule counts.
  logQuery?: ImportedLogQuery | undefined;
  filterType: FilterType;
  // The value compared with; not read by the anomaly conditions.
  threshold: number;
  rollingTime: RollingTime;
  // A LogCount rule's window, in seconds: a Logs monitor counts over one.
  windowInSeconds?: number | undefined;
  aggregation: EvaluateOverTimeType;
  // The anomaly conditions' sensitivity (AnomalouslyHigh and the others).
  anomalySensitivity?: AnomalyDetectionSensitivity | undefined;
  // How far ahead the forecast conditions look, in hours.
  forecastHorizonInHours?: number | undefined;
  onNoData: NoDataPolicy;
  severity: ImportedAlertSeverity;
  // What an opened alert or incident is called and says.
  title: string;
  description: string;
  // The monitor's own description.
  monitorDescription: string;
}

export interface AlertImportPlan {
  source: ImportSourceKind;
  items: Array<AlertImportItem>;
  notes: Array<ImportNote>;
}

// The most items one import reads, so a preview stays quick to read.
export const IMPORT_MAX_ITEMS: number = 500;

// The most text one import reads: larger than any real export.
export const IMPORT_MAX_TEXT_LENGTH: number = 10 * 1024 * 1024;

export class ImportStatusUtil {
  // The status notes make: approximate once any note is an approximation.
  public static fromNotes(
    notes: ReadonlyArray<ImportNote>,
    base: ImportItemStatus = ImportItemStatus.Exact,
  ): ImportItemStatus {
    if (base === ImportItemStatus.NotConverted) {
      return base;
    }

    return notes.some((note: ImportNote): boolean => {
      return note.kind === ImportNoteKind.Approximation;
    })
      ? ImportItemStatus.Approximate
      : base;
  }

  // The worse of two statuses: not converted, then approximate, then exact.
  public static worse(
    a: ImportItemStatus,
    b: ImportItemStatus,
  ): ImportItemStatus {
    const rank: Record<ImportItemStatus, number> = {
      [ImportItemStatus.Exact]: 0,
      [ImportItemStatus.Approximate]: 1,
      [ImportItemStatus.NotConverted]: 2,
    };

    return rank[a] >= rank[b] ? a : b;
  }

  // How many items are in each status, for the preview's summary.
  public static count(
    statuses: ReadonlyArray<ImportItemStatus>,
  ): Record<ImportItemStatus, number> {
    const counts: Record<ImportItemStatus, number> = {
      [ImportItemStatus.Exact]: 0,
      [ImportItemStatus.Approximate]: 0,
      [ImportItemStatus.NotConverted]: 0,
    };

    for (const status of statuses) {
      counts[status] += 1;
    }

    return counts;
  }
}
