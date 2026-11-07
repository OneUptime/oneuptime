import Dictionary from "../Dictionary";
import ObjectID from "../ObjectID";
import FilterCondition from "../Filter/FilterCondition";
import MetricsAggregationType from "../Metrics/MetricsAggregationType";
import MetricQueryConfigData from "../Metrics/MetricQueryConfigData";
import MetricFormulaConfigData from "../Metrics/MetricFormulaConfigData";
import RollingTime from "../RollingTime/RollingTime";
import { CloudProvider } from "../Cloud/CloudPlatform";
import {
  AWS_DEFAULT_PERIOD_SECONDS,
  AwsKeyMetric,
  AwsStatistic,
  HOURLY_PERIOD_SECONDS,
  getAwsKeyMetrics,
  getAwsStoredMetricName,
  getAzureStoredMetricName,
} from "../Cloud/CloudKeyMetrics";
import {
  CLOUD_AVAILABILITY_LOW_PERCENT,
  CLOUD_BACKLOG_AGE_SECONDS,
  CLOUD_CPU_HIGH_PERCENT,
  CLOUD_FAILED_SHARE_WARNING_PERCENT,
  CLOUD_HEALTH_MIN_REQUESTS,
  CLOUD_MEMORY_HIGH_PERCENT,
  CLOUD_STORAGE_HIGH_PERCENT,
  CloudResourceReadings,
  getCloudReadingKey,
} from "../Cloud/CloudResourceHealth";
import { AWS_CLOUDWATCH_NAMESPACE_ATTRIBUTE } from "../Cloud/CloudMonitoredResource";
import MonitorStep from "./MonitorStep";
import MonitorCriteria from "./MonitorCriteria";
import MonitorCriteriaInstance from "./MonitorCriteriaInstance";
import { EvaluateOverTimeType, FilterType } from "./CriteriaFilter";
import MonitorType from "./MonitorType";
import {
  AdditionalCriteriaFilterSpec,
  buildHealthyCriteriaInstance,
  buildUnhealthyCriteriaInstance,
  getRecoveryFilterType,
} from "./Recommendation/RecommendationCriteriaBuilder";

/*
 * THE MONITORS ONEUPTIME RECOMMENDS FOR A CLOUD RESOURCE.
 *
 * A cloud connection (Cloud > Connect) reads a few key metrics of every
 * resource in an account (CloudKeyMetrics) - an instance's status checks
 * and CPU, a load balancer's requests and 5xx, a function's errors and
 * throttles, a queue's oldest message - and the health rules judge their
 * newest values on the resource's page (CloudResourceHealth). These are the
 * same signals as monitors: one template per thing people most need to be
 * told about on each kind of resource, each a plain Metrics monitor over
 * the metrics its connection already reads, on the thresholds the health
 * rules judge by. A resource's Recommendations tab offers them, and an
 * account's offers each to every resource of its type at once.
 *
 * WHAT A MONITOR READS
 *
 * Only the key metrics a connection reads - so a recommended monitor costs
 * no extra call to the cloud - by the name and attributes they are stored
 * under: a CloudWatch metric as amazonaws.com/aws/<namespace>/<metric>, an
 * Azure Monitor metric as azure_<metric>_<aggregation>, a Cloud Monitoring
 * metric by its type, every name lower case as ingest stores it. Each query
 * is filtered on the resource's own telemetry attributes
 * (CloudResource.telemetryAttributes: the CloudWatch namespace, identity
 * dimensions, account and region; the Azure resource id; the Cloud
 * Monitoring resource type and labels), so it watches that resource and no
 * other, and names the resource in its event scope (eventScope
 * .cloudResourceId), so its charts draw the resource's own incidents,
 * alerts and changes and the server knows the monitor is about it
 * (MonitorStepResourceIdentity: its incidents and alerts land on the
 * resource, and a maintenance event holding the resource silences it).
 *
 * An Azure metric is stored with the aggregation its definition calls
 * primary, which only the read knows: the template reads the name the
 * resource's own reading of it was stored under
 * (CloudResourceReading.metric; a read keeps a reading of every metric a
 * template reads, getCloudAlertTemplateReadingKeys). So a resource a
 * connection reads is offered an Azure template once its readings name
 * each metric the template reads - a monitor made before would read a
 * name nothing is stored under, and never fire. A resource a collector
 * reports instead (its azure_monitor receiver writes every aggregation) is
 * read under the aggregation Azure documents for the metric.
 *
 * WINDOWS, AND READ-ONLY OR STREAMED ACCOUNTS
 *
 * A monitor reads the points whose own times fall in its window, and a
 * cloud's points arrive late:
 *
 *   - AWS, read-only: a connection reads every 10 minutes the five-minute
 *     periods CloudWatch finished 10 minutes before (CloudMetricWindows),
 *     each stamped with its period's start, so the newest point is 15 to
 *     30 minutes old. A 30-minute window always holds one to three of them.
 *   - AWS, streamed (CloudStream): Amazon Data Firehose delivers every
 *     minute within a few minutes, so the same window holds most of thirty
 *     one-minute points and a monitor fires 15 to 25 minutes sooner.
 *   - Azure and Google Cloud: read every 5 minutes, four minutes behind, a
 *     minute a point: a 15-minute window holds five to ten of them.
 *
 * So every AWS template reads 30 minutes, every Azure and Google Cloud one
 * 15 (CLOUD_ALERT_WINDOWS), and each is evaluated every five minutes
 * (CLOUD_ALERT_MONITORING_INTERVAL), as often as its points can change: a
 * monitor evaluated every minute would read the same points four times out
 * of five, and cost five times the queries.
 *
 * A metric its cloud publishes a few times a day is the exception: ACM
 * publishes a certificate's DaysToExpiry twice a day, and the connection
 * reads it once an hour (CloudKeyMetrics), so a 30-minute window would
 * hold nothing most of the day. Its template reads the last 2 days
 * (CLOUD_SLOW_METRIC_WINDOW), which hold four readings or so and still one
 * when a read or two were missed, and is evaluated once an hour
 * (CLOUD_SLOW_METRIC_MONITORING_INTERVAL), as often as a reading can come.
 * A stream changes nothing there: the key metrics' stream leaves it to
 * the connection's hourly read (CloudStreamTemplate), and a stream of every
 * metric brings the same two readings a day an hour or two sooner.
 *
 * HOW A WINDOW IS JUDGED
 *
 *   - A level (CPU, memory, storage, latency, availability, health): a
 *     point at a time. A level that must hold to matter is sustained - every
 *     point in the window at the line (AllValues) - and clears below a dead
 *     band; a broken state (failing status checks, a tunnel down, a cluster
 *     in red) fires on its first point and clears once a whole window has
 *     none; an age (the oldest message waiting) only grows while a message
 *     waits, so one point at the line is the wait.
 *   - A countdown (the days a certificate has left): every reading of the
 *     window at or under the line, which is the window's largest at or under
 *     it (Maximum Value) - so the renewed certificate's first reading clears
 *     it at once, where the window still holds the days before the renewal -
 *     or no reading at all: ACM stops publishing a certificate that expired.
 *   - A count (errors, throttles, failed runs or deliveries) and a share of
 *     two counts (failed requests over requests): the window read whole, as
 *     one value (MonitorStepMetricMonitor.aggregatesWholeWindow). A
 *     read-only AWS account writes a Sum metric once per five-minute period
 *     and a streamed one once a minute, so a point is five times bigger on
 *     one than the other, and CloudWatch writes no point at all for a period
 *     with no failure: compared a point at a time, a threshold would read a
 *     fifth of the count on a streamed account, and a share would read only
 *     the periods that failed. Totalled over the window, both connections
 *     read the same count and the same share. A count fires on its first
 *     failure; a share at 5% of requests failing, once the window held 20
 *     (CLOUD_HEALTH_MIN_REQUESTS) - except a function's, whose
 *     invocations a nightly job or a queue handler makes a few at a time.
 *
 * The thresholds are the health rules' wherever a rule judges the metric
 * (CloudResourceHealth: 95% CPU or memory on a database, a cache or a
 * broker, 90% storage, 5% of requests failing, availability under 99.9%,
 * an hour's backlog), so a resource whose monitor fires reads Degraded or
 * Unhealthy on its page too; and 90% CPU where no rule judges it (an
 * instance, a VM, a container service). Each is a starting point a team
 * retunes on the monitor.
 *
 * Pure and isomorphic: the catalog, the Dashboard, the docs' facts and the
 * tests read it.
 */

export type CloudAlertTemplateCategory =
  | "Availability"
  | "Errors"
  | "Throttling"
  | "Latency"
  | "Utilization"
  | "Storage"
  | "Backlog";

export type CloudAlertTemplateSeverity = "Critical" | "Warning";

/*
 * How a template judges its window (see HOW A WINDOW IS JUDGED above):
 *   - sustained: every point in the window at the line;
 *   - breakage: the first point at the line, cleared by a whole window
 *     without one;
 *   - age: the first point at the line, cleared below a dead band;
 *   - countdown: every point in the window at or under the line, or none at
 *     all, cleared by the first point above it;
 *   - total: the window's count, read whole;
 *   - share: the share of the window's requests that failed, read whole.
 */
export type CloudAlertMeasure =
  | "sustained"
  | "breakage"
  | "age"
  | "countdown"
  | "total"
  | "share";

// The window each cloud's monitors read (see WINDOWS above).
export const CLOUD_ALERT_WINDOWS: Readonly<Record<CloudProvider, RollingTime>> =
  {
    [CloudProvider.AWS]: RollingTime.Past30Minutes,
    [CloudProvider.Azure]: RollingTime.Past15Minutes,
    [CloudProvider.GCP]: RollingTime.Past15Minutes,
  };

// How often a recommended cloud monitor is evaluated: every five minutes.
export const CLOUD_ALERT_MONITORING_INTERVAL: string = "*/5 * * * *";

/*
 * A template over a metric its cloud publishes a few times a day, which
 * the connection reads once an hour (an AWS key metric whose period is an
 * hour or more: ACM's DaysToExpiry): the last 2 days, evaluated once an
 * hour (see WINDOWS above).
 */
export const CLOUD_SLOW_METRIC_WINDOW: RollingTime = RollingTime.Past2Days;
export const CLOUD_SLOW_METRIC_MONITORING_INTERVAL: string = "0 * * * *";

/*
 * The service each cloud's numbers come from, by its own name - a product
 * name, the same in every language.
 */
export const CLOUD_MONITORING_SERVICE_NAMES: Readonly<
  Record<CloudProvider, string>
> = {
  [CloudProvider.AWS]: "Amazon CloudWatch",
  [CloudProvider.Azure]: "Azure Monitor",
  [CloudProvider.GCP]: "Google Cloud Monitoring",
};

// A cloud's monitoring service, or nothing for a cloud OneUptime does not read.
export function getCloudMonitoringServiceName(
  provider: string | null | undefined,
): string | undefined {
  const key: string = (provider || "").trim().toLowerCase();

  return (CLOUD_MONITORING_SERVICE_NAMES as Record<string, string>)[key];
}

// CPU a compute resource (an instance, a VM, a container service) may hold.
export const CLOUD_COMPUTE_CPU_HIGH_PERCENT: number = 90;

// Free storage an RDS instance should keep: 100 - CLOUD_STORAGE_HIGH_PERCENT.
export const CLOUD_RDS_FREE_STORAGE_LOW_PERCENT: number =
  100 - CLOUD_STORAGE_HIGH_PERCENT;

// Responses slower than this on average, held for the window, are slow.
export const CLOUD_SLOW_RESPONSE_SECONDS: number = 1;

// Where an RDS instance's allocated storage is kept (its inventory, GiB).
export const CLOUD_ALLOCATED_STORAGE_PROPERTY: string = "AllocatedStorage";

/*
 * The share of an RDS instance's connection limit its connections may hold:
 * AWS's own recommended alarm says 90 to 95% of the limit, and the lower
 * end leaves room for the limit, which is the class's default as worked
 * out (RdsConnectionLimits), to be a little high.
 */
export const CLOUD_CONNECTIONS_HIGH_PERCENT: number = 90;

/*
 * The days a certificate may have left before it is said: ACM renews a
 * certificate it issued 45 to 60 days before it expires, and says so when
 * it cannot - first at 30 days, then at 15, 7, 3 and 1. A certificate at 30
 * is one ACM could not renew (imported, not in use, or its validation
 * gone), with a month left to fix it.
 */
export const CLOUD_CERTIFICATE_EXPIRY_DAYS: number = 30;

const GIB: number = 1024 * 1024 * 1024;

export type AzureAggregation = "average" | "total" | "maximum" | "minimum";

/*
 * One metric a template reads, as its cloud names it. AWS: the CloudWatch
 * namespace and metric of one of its key metrics, whose statistic and
 * unit the read uses. Azure: the Azure Monitor metric name and the
 * aggregation Azure documents for it. Google Cloud: the metric type.
 */
export interface CloudAlertMetric {
  provider: CloudProvider;
  metricName: string;
  namespace?: string | undefined;
  azureAggregation?: AzureAggregation | undefined;
  // How a minute's points fold into one value (or the window's, read whole).
  aggregationType: MetricsAggregationType;
  // The unit the alert text writes the values in.
  legendUnit?: string | undefined;
  // How it reads in a description: "CPUUtilization (Average)".
  label: string;
}

export interface CloudAlertQuery {
  alias: string;
  metric: CloudAlertMetric;
}

/*
 * A formula over the template's queries, compared instead of a query: a
 * share of two counts, or a ratio made a percent.
 */
export interface CloudAlertFormula {
  alias: string;
  formula: string;
  legendUnit?: string | undefined;
  title: string;
}

/*
 * Everything a template's monitor is built from: what is known of the one
 * resource it watches.
 */
export interface CloudAlertTemplateArgs {
  // The CloudResource row's id: named in each query's event scope.
  cloudResourceId: string;
  /*
   * The stored attributes that select the resource's metrics
   * (CloudResource.telemetryAttributes). A template is never offered for a
   * resource without them (getCloudAlertTemplatesFor): a query filtered on
   * nothing would read the metric of every resource in the project.
   */
  telemetryAttributes: Dictionary<string>;
  // Its readings: the names its Azure metrics are stored under.
  readings?: CloudResourceReadings | null | undefined;
  // An RDS instance's allocated storage, in GiB.
  allocatedStorageGiB?: number | null | undefined;
  // An RDS instance's connection limit (RdsConnectionLimits).
  connectionLimit?: number | null | undefined;
  onlineMonitorStatusId: ObjectID;
  offlineMonitorStatusId: ObjectID;
  defaultIncidentSeverityId: ObjectID;
  defaultAlertSeverityId: ObjectID;
  monitorName: string;
}

// What is known of a resource that decides which templates apply to it.
export interface CloudAlertTemplateContext {
  provider?: string | null | undefined;
  resourceType?: string | null | undefined;
  telemetryAttributes?: Dictionary<string> | null | undefined;
  allocatedStorageGiB?: number | null | undefined;
  // An RDS instance's connection limit (RdsConnectionLimits).
  connectionLimit?: number | null | undefined;
  // Its readings: the names its Azure metrics are stored under.
  readings?: CloudResourceReadings | null | undefined;
  /*
   * Whether a cloud connection reads it (CloudResource.cloudConnectionId):
   * then its Azure metrics are stored under the aggregation the read
   * picked, which only its readings say (see the header).
   */
  isReadByConnection?: boolean | null | undefined;
}

export interface CloudAlertTemplate {
  // "cloud-<cloud>-<service>-<what>": stable, and unique in the catalog.
  id: string;
  name: string;
  // One plain sentence: when it fires, with its threshold and window.
  summary: string;
  description: string;
  category: CloudAlertTemplateCategory;
  severity: CloudAlertTemplateSeverity;
  // Always Metrics; carried per template the way the other libraries do.
  monitorType: MonitorType;
  provider: CloudProvider;
  // The resource types it is for, as CloudResourceCatalog spells them.
  resourceTypes: Array<string>;
  measure: CloudAlertMeasure;
  rollingTime: RollingTime;
  monitoringInterval: string;
  /*
   * Whether an AWS account that streams its metrics (CloudStream) is read
   * better by it: every AWS template sees each minute within minutes
   * instead of 15 to 30 minutes late, so it fires sooner; none of Azure's
   * or Google Cloud's, which are read a minute at a time already.
   */
  isBetterStreamed: boolean;
  queries: Array<CloudAlertQuery>;
  formula?: CloudAlertFormula | undefined;
  // What the breach compares: a query's alias, or the formula's.
  comparedAlias: string;
  filterType: FilterType;
  // In the compared value's own unit; for RDS storage, worked out per resource.
  threshold: number;
  // "at or above 90%": the comparison in words.
  thresholdLabel: string;
  // A second comparison the breach needs too (a share's request floor).
  minimumRequests?: { alias: string; value: number; label: string } | undefined;
  // What it needs to know of the resource besides its attributes.
  requiresAllocatedStorage?: boolean | undefined;
  /*
   * Its line is a share of the instance's own connection limit
   * (RdsConnectionLimits): offered once that is known.
   */
  requiresConnectionLimit?: boolean | undefined;
  /*
   * Offered only to a resource that reports its metric, whoever reads it:
   * a metric of one tier of a service, which the others never send (an
   * Azure SQL database's DTUs, on the DTU purchasing model only). Without
   * it a monitor on a vCore database would watch a metric nobody sends.
   */
  requiresReading?: boolean | undefined;
  incidentDescription: string;
  getMonitorStep: (args: CloudAlertTemplateArgs) => MonitorStep;
}

/*
 * ---------------------------------------------------------------------------
 * Metrics
 * ---------------------------------------------------------------------------
 */

const AWS_STATISTIC_AGGREGATION: Readonly<
  Record<AwsStatistic, MetricsAggregationType>
> = {
  Average: MetricsAggregationType.Avg,
  Sum: MetricsAggregationType.Sum,
  Maximum: MetricsAggregationType.Max,
  Minimum: MetricsAggregationType.Min,
};

// A CloudWatch unit as the alert text writes it.
const AWS_UNIT_LEGENDS: Readonly<Record<string, string>> = {
  Percent: "%",
  Seconds: "s",
  Milliseconds: "ms",
  Bytes: "B",
};

// The key metric a connection reads, or undefined (a test holds there is one).
export function getAwsKeyMetricOf(
  namespace: string,
  metricName: string,
): AwsKeyMetric | undefined {
  return getAwsKeyMetrics(namespace)?.metrics.find(
    (metric: AwsKeyMetric): boolean => {
      return metric.metricName === metricName;
    },
  );
}

function awsMetric(namespace: string, metricName: string): CloudAlertMetric {
  const keyMetric: AwsKeyMetric | undefined = getAwsKeyMetricOf(
    namespace,
    metricName,
  );
  const statistic: AwsStatistic = keyMetric?.statistic || "Average";

  return {
    provider: CloudProvider.AWS,
    namespace: namespace,
    metricName: metricName,
    aggregationType: AWS_STATISTIC_AGGREGATION[statistic],
    legendUnit: keyMetric ? AWS_UNIT_LEGENDS[keyMetric.unit] : undefined,
    label: `${metricName} (${statistic})`,
  };
}

function azureMetric(data: {
  metricName: string;
  aggregation: AzureAggregation;
  aggregationType: MetricsAggregationType;
  legendUnit?: string | undefined;
}): CloudAlertMetric {
  return {
    provider: CloudProvider.Azure,
    metricName: data.metricName,
    azureAggregation: data.aggregation,
    aggregationType: data.aggregationType,
    legendUnit: data.legendUnit,
    label: data.metricName,
  };
}

function gcpMetric(data: {
  metricType: string;
  aggregationType: MetricsAggregationType;
  legendUnit?: string | undefined;
}): CloudAlertMetric {
  return {
    provider: CloudProvider.GCP,
    metricName: data.metricType,
    aggregationType: data.aggregationType,
    legendUnit: data.legendUnit,
    label: data.metricType,
  };
}

/*
 * The key a metric's readings are kept under (getCloudReadingKey): an Azure
 * metric's without its aggregation, so a reading of it says which one its
 * name ends with.
 */
export function getCloudAlertMetricReadingKey(
  metric: CloudAlertMetric,
): string | null {
  return getCloudReadingKey(metric.provider, getFallbackStoredName(metric));
}

function getFallbackStoredName(metric: CloudAlertMetric): string {
  switch (metric.provider) {
    case CloudProvider.AWS:
      return getAwsStoredMetricName(
        metric.namespace || "",
        metric.metricName,
      ).toLowerCase();
    case CloudProvider.Azure:
      return getAzureStoredMetricName(
        metric.metricName,
        metric.azureAggregation || "average",
      );
    default:
      return metric.metricName.toLowerCase();
  }
}

/*
 * The name a metric is stored under for this resource: an AWS or Google
 * Cloud metric's is fixed by its name; an Azure metric's ends with the
 * aggregation the resource's own reading of it was stored with
 * (CloudResourceReading.metric), or Azure's documented one before it has a
 * reading. Lower case, as ingest stores every name.
 */
export function getCloudAlertStoredMetricName(data: {
  metric: CloudAlertMetric;
  readings?: CloudResourceReadings | null | undefined;
}): string {
  if (data.metric.provider === CloudProvider.Azure) {
    const key: string | null = getCloudAlertMetricReadingKey(data.metric);
    const read: string | undefined = key
      ? data.readings?.[key]?.metric
      : undefined;

    if (read && read.trim()) {
      return read.trim().toLowerCase();
    }
  }

  return getFallbackStoredName(data.metric);
}

/*
 * ---------------------------------------------------------------------------
 * Building a template's monitor
 * ---------------------------------------------------------------------------
 */

function buildQuery(data: {
  query: CloudAlertQuery;
  args: CloudAlertTemplateArgs;
  title: string;
}): MetricQueryConfigData {
  const title: string = `${data.title} - ${data.query.metric.label}`;

  return {
    metricAliasData: {
      metricVariable: data.query.alias,
      title: title,
      description: title,
      legend: title,
      legendUnit: data.query.metric.legendUnit,
    },
    metricQueryData: {
      filterData: {
        metricName: getCloudAlertStoredMetricName({
          metric: data.query.metric,
          readings: data.args.readings,
        }),
        attributes: { ...data.args.telemetryAttributes },
        aggegationType: data.query.metric.aggregationType,
        aggregateBy: {},
      },
    },
    /*
     * The resource, by its row: its charts draw its own incidents, alerts
     * and changes, and the server reads which resource the monitor is
     * about (MonitorStepResourceIdentity).
     */
    eventScope: { cloudResourceId: data.args.cloudResourceId },
  };
}

function buildFormula(formula: CloudAlertFormula): MetricFormulaConfigData {
  return {
    metricAliasData: {
      metricVariable: formula.alias,
      title: formula.title,
      description: formula.title,
      legend: formula.title,
      legendUnit: formula.legendUnit,
    },
    metricFormulaData: {
      metricFormula: formula.formula,
    },
  };
}

// A count of connections in a criteria's words, as its other numbers are written: "1,521".
function formatConnections(count: number): string {
  return count.toLocaleString("en-US");
}

// An RDS instance's connection limit, when it is a usable one: a positive number.
function readConnectionLimit(value: unknown): number | null {
  const limit: number = Number(value);

  return Number.isFinite(limit) && limit > 0 ? limit : null;
}

/*
 * The line of a template whose threshold is a share of an RDS instance's
 * connection limit: 90% of it, in whole connections.
 */
export function getCloudConnectionsThreshold(connectionLimit: number): number {
  return Math.floor((connectionLimit * CLOUD_CONNECTIONS_HIGH_PERCENT) / 100);
}

/*
 * The breach's threshold for one resource: RDS storage is a share of its
 * own, and so are its connections.
 */
function getThreshold(
  template: CloudAlertTemplate,
  args: CloudAlertTemplateArgs,
): number {
  if (template.requiresConnectionLimit) {
    const limit: number | null = readConnectionLimit(args.connectionLimit);

    return limit === null
      ? template.threshold
      : getCloudConnectionsThreshold(limit);
  }

  if (!template.requiresAllocatedStorage) {
    return template.threshold;
  }

  const allocatedGiB: number = Number(args.allocatedStorageGiB);

  if (!Number.isFinite(allocatedGiB) || allocatedGiB <= 0) {
    return template.threshold;
  }

  return Math.round(
    allocatedGiB * GIB * (CLOUD_RDS_FREE_STORAGE_LOW_PERCENT / 100),
  );
}

function describeCriteria(
  template: CloudAlertTemplate,
  args: CloudAlertTemplateArgs,
): string {
  const minutes: string = template.rollingTime
    .replace("Past ", "")
    .trim()
    .toLowerCase();
  const limit: number | null = template.requiresConnectionLimit
    ? readConnectionLimit(args.connectionLimit)
    : null;

  switch (template.measure) {
    case "breakage":
      return `Triggers on the first reading ${template.thresholdLabel} in the past ${minutes}.`;
    case "age":
      return `Triggers when a reading is ${template.thresholdLabel}.`;
    case "countdown":
      return `Triggers when every reading of the past ${minutes} is ${template.thresholdLabel}, or the past ${minutes} hold no reading.`;
    case "total":
      return `Triggers when the past ${minutes} hold ${template.thresholdLabel}.`;
    case "share":
      return `Triggers when ${template.thresholdLabel} of the requests in the past ${minutes} failed${
        template.minimumRequests ? `, ${template.minimumRequests.label}` : ""
      }.`;
    default:
      return `Triggers when every reading of the past ${minutes} is ${template.thresholdLabel}${
        limit === null
          ? ""
          : ` (${formatConnections(getCloudConnectionsThreshold(limit))} of ${formatConnections(limit)} connections)`
      }.`;
  }
}

function buildCriteria(
  template: CloudAlertTemplate,
  args: CloudAlertTemplateArgs,
): MonitorCriteria {
  const threshold: number = getThreshold(template, args);
  const isWhole: boolean =
    template.measure === "total" || template.measure === "share";
  const isFirstPoint: boolean =
    isWhole || template.measure === "breakage" || template.measure === "age";
  /*
   * A countdown is read by its largest reading: "every reading at or under
   * the line" on the firing side, "one above it" on the healthy side - so a
   * renewal clears it with its first reading (see HOW A WINDOW IS JUDGED).
   */
  const isCountdown: boolean = template.measure === "countdown";

  const minimumRequests: AdditionalCriteriaFilterSpec | undefined =
    template.minimumRequests
      ? {
          metricAlias: template.minimumRequests.alias,
          filterType: FilterType.GreaterThanOrEqualTo,
          value: template.minimumRequests.value,
        }
      : undefined;

  const unhealthy: MonitorCriteriaInstance = buildUnhealthyCriteriaInstance({
    offlineMonitorStatusId: args.offlineMonitorStatusId,
    incidentSeverityId: args.defaultIncidentSeverityId,
    alertSeverityId: args.defaultAlertSeverityId,
    monitorName: args.monitorName,
    metricAlias: template.comparedAlias,
    filterType: template.filterType,
    value: threshold,
    incidentTitle: `[Cloud] ${template.name} - ${args.monitorName}`,
    incidentDescription: template.incidentDescription,
    criteriaName: `${template.name} - ${template.thresholdLabel}`,
    criteriaDescription: describeCriteria(template, args),
    resourceNoun: "cloud resource",
    /*
     * A broken state, an age, and a window read whole fire on a point; a
     * level must hold for the whole window; a countdown is its window's
     * largest reading (see HOW A WINDOW IS JUDGED).
     */
    metricAggregationType: isCountdown
      ? EvaluateOverTimeType.MaximumValue
      : isFirstPoint
        ? EvaluateOverTimeType.AnyValue
        : EvaluateOverTimeType.AllValues,
    additionalFilters: minimumRequests ? [minimumRequests] : undefined,
    filterCondition: minimumRequests ? FilterCondition.All : undefined,
    /*
     * A countdown that stops is the thing it counts down to: ACM stops
     * publishing a certificate's days once it expires, so an empty window
     * fires too, and the incident stays open past the expiry.
     */
    triggerOnNoData: isCountdown ? true : undefined,
  });

  /*
   * Recovery: the complement. A window read whole has one value, which an
   * empty window - no failure, no request - reads as zero; a broken state
   * clears once every point of a window is whole again; a level below its
   * dead band; a share, as soon as it is under the line or the window held
   * too few requests to judge; a countdown with its first reading above the
   * line (a count of days only rises when it is renewed: no dead band).
   */
  const healthy: MonitorCriteriaInstance = buildHealthyCriteriaInstance({
    onlineMonitorStatusId: args.onlineMonitorStatusId,
    metricAlias: template.comparedAlias,
    filterType: getRecoveryFilterType(template.filterType),
    value: threshold,
    recoveryValue:
      isWhole || template.measure === "breakage" || isCountdown
        ? threshold
        : undefined,
    isBinaryMetric: template.measure === "breakage",
    metricAggregationType: isCountdown
      ? EvaluateOverTimeType.MaximumValue
      : isWhole
        ? EvaluateOverTimeType.AnyValue
        : EvaluateOverTimeType.AllValues,
    treatNoDataAsZero: isWhole,
    additionalFilters: minimumRequests
      ? [
          {
            metricAlias: minimumRequests.metricAlias,
            filterType: getRecoveryFilterType(minimumRequests.filterType),
            value: minimumRequests.value,
          },
        ]
      : undefined,
    filterCondition: minimumRequests ? FilterCondition.Any : undefined,
  });

  const criteria: MonitorCriteria = new MonitorCriteria();
  criteria.data = { monitorCriteriaInstanceArray: [unhealthy, healthy] };

  return criteria;
}

function buildMonitorStep(
  template: CloudAlertTemplate,
  args: CloudAlertTemplateArgs,
): MonitorStep {
  const step: MonitorStep = MonitorStep.getDefaultMonitorStep({
    monitorName: args.monitorName,
    monitorType: MonitorType.Metrics,
    onlineMonitorStatusId: args.onlineMonitorStatusId,
    offlineMonitorStatusId: args.offlineMonitorStatusId,
    defaultIncidentSeverityId: args.defaultIncidentSeverityId,
    defaultAlertSeverityId: args.defaultAlertSeverityId,
  });

  step.setMetricMonitor({
    rollingTime: template.rollingTime,
    metricViewConfig: {
      queryConfigs: template.queries.map(
        (query: CloudAlertQuery): MetricQueryConfigData => {
          return buildQuery({ query, args, title: template.name });
        },
      ),
      formulaConfigs: template.formula ? [buildFormula(template.formula)] : [],
    },
    ...(template.measure === "total" || template.measure === "share"
      ? { aggregatesWholeWindow: true }
      : {}),
  });

  step.setMonitorCriteria(buildCriteria(template, args));

  return step;
}

/*
 * ---------------------------------------------------------------------------
 * Declaring templates
 * ---------------------------------------------------------------------------
 */

type TemplateSpec = Omit<
  CloudAlertTemplate,
  | "monitorType"
  | "rollingTime"
  | "monitoringInterval"
  | "isBetterStreamed"
  | "getMonitorStep"
>;

/*
 * Whether a template reads a metric its cloud publishes a few times a day:
 * an AWS key metric the connection reads once an hour or less often
 * (CloudKeyMetrics' periodSeconds). Its window and its schedule follow the
 * metric (see WINDOWS above), and a stream makes it no sooner that matters.
 */
export function isCloudSlowMetricTemplate(data: {
  provider: CloudProvider;
  queries: Array<CloudAlertQuery>;
}): boolean {
  return (
    data.provider === CloudProvider.AWS &&
    data.queries.length > 0 &&
    data.queries.every((query: CloudAlertQuery): boolean => {
      const periodSeconds: number =
        getAwsKeyMetricOf(query.metric.namespace || "", query.metric.metricName)
          ?.periodSeconds || AWS_DEFAULT_PERIOD_SECONDS;

      return periodSeconds >= HOURLY_PERIOD_SECONDS;
    })
  );
}

function define(spec: TemplateSpec): CloudAlertTemplate {
  const isSlow: boolean = isCloudSlowMetricTemplate(spec);
  const template: CloudAlertTemplate = {
    ...spec,
    monitorType: MonitorType.Metrics,
    rollingTime: isSlow
      ? CLOUD_SLOW_METRIC_WINDOW
      : CLOUD_ALERT_WINDOWS[spec.provider],
    monitoringInterval: isSlow
      ? CLOUD_SLOW_METRIC_MONITORING_INTERVAL
      : CLOUD_ALERT_MONITORING_INTERVAL,
    isBetterStreamed: spec.provider === CloudProvider.AWS && !isSlow,
    getMonitorStep: (args: CloudAlertTemplateArgs): MonitorStep => {
      return buildMonitorStep(template, args);
    },
  };

  return template;
}

// The alias of a template's one query.
const VALUE: string = "value";
const FAILED: string = "failed";
const SECOND_FAILED: string = "failed_second";
const REQUESTS: string = "requests";
const SHARE: string = "failed_share";
const PERCENT: string = "percent";

// A level held at or above a line for the whole window.
function sustainedAtOrAbove(data: {
  id: string;
  name: string;
  summary: string;
  description: string;
  category: CloudAlertTemplateCategory;
  severity?: CloudAlertTemplateSeverity | undefined;
  provider: CloudProvider;
  resourceTypes: Array<string>;
  metric: CloudAlertMetric;
  threshold: number;
  thresholdLabel: string;
  incidentDescription: string;
}): CloudAlertTemplate {
  return define({
    id: data.id,
    name: data.name,
    summary: data.summary,
    description: data.description,
    category: data.category,
    severity: data.severity || "Warning",
    provider: data.provider,
    resourceTypes: data.resourceTypes,
    measure: "sustained",
    queries: [{ alias: VALUE, metric: data.metric }],
    comparedAlias: VALUE,
    filterType: FilterType.GreaterThanOrEqualTo,
    threshold: data.threshold,
    thresholdLabel: data.thresholdLabel,
    incidentDescription: data.incidentDescription,
  });
}

/*
 * A Google Cloud utilization (0 to 1) made a percent by a formula, so its
 * threshold reads as the health rules' do, whatever unit its metric was
 * registered with.
 */
function gcpPercentAtOrAbove(data: {
  id: string;
  name: string;
  summary: string;
  description: string;
  category: CloudAlertTemplateCategory;
  resourceTypes: Array<string>;
  metricType: string;
  threshold: number;
  thresholdLabel: string;
  incidentDescription: string;
}): CloudAlertTemplate {
  return define({
    id: data.id,
    name: data.name,
    summary: data.summary,
    description: data.description,
    category: data.category,
    severity: "Warning",
    provider: CloudProvider.GCP,
    resourceTypes: data.resourceTypes,
    measure: "sustained",
    queries: [
      {
        alias: VALUE,
        metric: gcpMetric({
          metricType: data.metricType,
          aggregationType: MetricsAggregationType.Avg,
        }),
      },
    ],
    formula: {
      alias: PERCENT,
      formula: `$${VALUE} * 100`,
      legendUnit: "%",
      title: `${data.name} (%)`,
    },
    comparedAlias: PERCENT,
    filterType: FilterType.GreaterThanOrEqualTo,
    threshold: data.threshold,
    thresholdLabel: data.thresholdLabel,
    incidentDescription: data.incidentDescription,
  });
}

// A count's window total of at least one.
function anyInWindow(data: {
  id: string;
  name: string;
  summary: string;
  description: string;
  category: CloudAlertTemplateCategory;
  provider: CloudProvider;
  resourceTypes: Array<string>;
  metrics: Array<CloudAlertMetric>;
  thresholdLabel: string;
  incidentDescription: string;
}): CloudAlertTemplate {
  const [first, second] = data.metrics;

  return define({
    id: data.id,
    name: data.name,
    summary: data.summary,
    description: data.description,
    category: data.category,
    severity: "Warning",
    provider: data.provider,
    resourceTypes: data.resourceTypes,
    measure: "total",
    queries: [
      { alias: FAILED, metric: first! },
      ...(second ? [{ alias: SECOND_FAILED, metric: second }] : []),
    ],
    /*
     * Two counts (a table's read and write throttles) are added up, each
     * read whole; a count with no point in the window reads as zero
     * (MetricWholeWindow), so either one alone is enough.
     */
    formula: second
      ? {
          alias: "total",
          formula: `$${FAILED} + $${SECOND_FAILED}`,
          title: data.name,
        }
      : undefined,
    comparedAlias: second ? "total" : FAILED,
    filterType: FilterType.GreaterThanOrEqualTo,
    threshold: 1,
    thresholdLabel: data.thresholdLabel,
    incidentDescription: data.incidentDescription,
  });
}

/*
 * The share of a window's requests that failed: the failed requests (one
 * count, or two added up) over the requests, both read whole.
 */
function failedShare(data: {
  id: string;
  name: string;
  summary: string;
  description: string;
  provider: CloudProvider;
  resourceTypes: Array<string>;
  failed: Array<CloudAlertMetric>;
  requests: CloudAlertMetric;
  // Judged whatever the count of requests (a function's invocations).
  withoutRequestFloor?: boolean | undefined;
  incidentDescription: string;
}): CloudAlertTemplate {
  const [first, second] = data.failed;
  const failed: string = second
    ? `($${FAILED} + $${SECOND_FAILED})`
    : `$${FAILED}`;

  return define({
    id: data.id,
    name: data.name,
    summary: data.summary,
    description: data.description,
    category: "Errors",
    severity: "Warning",
    provider: data.provider,
    resourceTypes: data.resourceTypes,
    measure: "share",
    queries: [
      { alias: FAILED, metric: first! },
      ...(second ? [{ alias: SECOND_FAILED, metric: second }] : []),
      { alias: REQUESTS, metric: data.requests },
    ],
    formula: {
      alias: SHARE,
      formula: `${failed} / $${REQUESTS} * 100`,
      legendUnit: "%",
      title: `${data.name} (% of requests)`,
    },
    comparedAlias: SHARE,
    filterType: FilterType.GreaterThanOrEqualTo,
    threshold: CLOUD_FAILED_SHARE_WARNING_PERCENT,
    thresholdLabel: `${CLOUD_FAILED_SHARE_WARNING_PERCENT}% or more`,
    minimumRequests: data.withoutRequestFloor
      ? undefined
      : {
          alias: REQUESTS,
          value: CLOUD_HEALTH_MIN_REQUESTS,
          label: `of at least ${CLOUD_HEALTH_MIN_REQUESTS} requests`,
        },
    incidentDescription: data.incidentDescription,
  });
}

/*
 * A broken state: a reading at or above `fires` (failing checks, a cluster
 * in red) or below it (a tunnel, a health check, a VM that reads 0 when it
 * is down).
 */
function breakage(data: {
  id: string;
  name: string;
  summary: string;
  description: string;
  provider: CloudProvider;
  resourceTypes: Array<string>;
  metric: CloudAlertMetric;
  firesBelow?: boolean | undefined;
  threshold?: number | undefined;
  thresholdLabel: string;
  incidentDescription: string;
}): CloudAlertTemplate {
  return define({
    id: data.id,
    name: data.name,
    summary: data.summary,
    description: data.description,
    category: "Availability",
    severity: "Critical",
    provider: data.provider,
    resourceTypes: data.resourceTypes,
    measure: "breakage",
    queries: [{ alias: VALUE, metric: data.metric }],
    comparedAlias: VALUE,
    filterType: data.firesBelow
      ? FilterType.LessThan
      : FilterType.GreaterThanOrEqualTo,
    threshold: data.threshold ?? 1,
    thresholdLabel: data.thresholdLabel,
    incidentDescription: data.incidentDescription,
  });
}

// A level that should stay high (availability, health): sustained below a line.
function sustainedBelow(data: {
  id: string;
  name: string;
  summary: string;
  description: string;
  provider: CloudProvider;
  resourceTypes: Array<string>;
  metric: CloudAlertMetric;
  threshold: number;
  thresholdLabel: string;
  incidentDescription: string;
}): CloudAlertTemplate {
  return define({
    id: data.id,
    name: data.name,
    summary: data.summary,
    description: data.description,
    category: "Availability",
    severity: "Warning",
    provider: data.provider,
    resourceTypes: data.resourceTypes,
    measure: "sustained",
    queries: [{ alias: VALUE, metric: data.metric }],
    comparedAlias: VALUE,
    filterType: FilterType.LessThan,
    threshold: data.threshold,
    thresholdLabel: data.thresholdLabel,
    incidentDescription: data.incidentDescription,
  });
}

// An age at or above an hour: the oldest message, consumers behind.
function ageAtOrAbove(data: {
  id: string;
  name: string;
  summary: string;
  description: string;
  provider: CloudProvider;
  resourceTypes: Array<string>;
  metric: CloudAlertMetric;
  // In the metric's own unit.
  threshold: number;
  incidentDescription: string;
}): CloudAlertTemplate {
  return define({
    id: data.id,
    name: data.name,
    summary: data.summary,
    description: data.description,
    category: "Backlog",
    severity: "Warning",
    provider: data.provider,
    resourceTypes: data.resourceTypes,
    measure: "age",
    queries: [{ alias: VALUE, metric: data.metric }],
    comparedAlias: VALUE,
    filterType: FilterType.GreaterThanOrEqualTo,
    threshold: data.threshold,
    thresholdLabel: "an hour or more",
    incidentDescription: data.incidentDescription,
  });
}

const AWS: CloudProvider = CloudProvider.AWS;
const AZURE: CloudProvider = CloudProvider.Azure;

/*
 * Where each AWS template's numbers come from, for its description, and that
 * it works better streamed (isBetterStreamed): a read-only account's points
 * are 15 to 30 minutes old when CloudWatch publishes them.
 */
const READ_FROM_CLOUDWATCH: string =
  "Read from Amazon CloudWatch by the account's connection, or streamed through Amazon Data Firehose: works better streamed, whose metrics arrive within minutes, so it fires sooner.";
/*
 * Where a template over a metric published a few times a day reads it
 * (isCloudSlowMetricTemplate): a stream carries each reading sooner, and
 * the monitor reads the same readings either way.
 */
const READ_SLOWLY_FROM_CLOUDWATCH: string =
  "Read from Amazon CloudWatch by the account's connection once an hour, whether or not the account streams its metrics: a stream would not make it fire sooner.";
const READ_FROM_AZURE_MONITOR: string =
  "Read from Azure Monitor by the subscription's connection.";
const READ_FROM_CLOUD_MONITORING: string =
  "Read from Google Cloud Monitoring by the project's connection.";

const ON_PAGE_TOO: string = "The resource's page says it too, as its health.";

function awsShareDescription(metrics: string): string {
  return `Fires when 5% or more of the requests of the past 30 minutes failed, of at least 20 requests: ${metrics}, each totalled over the window, so a read-only and a streamed account read the same share. ${READ_FROM_CLOUDWATCH}`;
}

/*
 * ---------------------------------------------------------------------------
 * AWS
 * ---------------------------------------------------------------------------
 */

const AWS_TEMPLATES: Array<CloudAlertTemplate> = [
  breakage({
    id: "cloud-aws-ec2-status-check-failed",
    name: "Status Checks Failing",
    summary: "The instance or the host it runs on fails a status check.",
    description: `Fires on the first reading of StatusCheckFailed (Maximum) at 1: the instance, or the AWS host under it, failed a status check. Clears once 30 minutes pass without a failure. ${READ_FROM_CLOUDWATCH} ${ON_PAGE_TOO}`,
    provider: AWS,
    resourceTypes: ["AWS::EC2::Instance"],
    metric: awsMetric("AWS/EC2", "StatusCheckFailed"),
    thresholdLabel: "at 1",
    incidentDescription:
      "The instance failed an EC2 status check. A failed system check is a problem with the AWS host it runs on: stop and start the instance to move it to another host. A failed instance check is the instance's own: look at its console output and system log for a kernel panic, a full disk or a network configuration it cannot reach.",
  }),
  sustainedAtOrAbove({
    id: "cloud-aws-ec2-high-cpu",
    name: "High CPU",
    summary: "CPU stays at 90% or more for 30 minutes.",
    description: `Fires when every reading of CPUUtilization (Average) in the past 30 minutes is at or above 90%. A busy instance is often doing its work: this says it has no headroom left. ${READ_FROM_CLOUDWATCH}`,
    category: "Utilization",
    provider: AWS,
    resourceTypes: ["AWS::EC2::Instance"],
    metric: awsMetric("AWS/EC2", "CPUUtilization"),
    threshold: CLOUD_COMPUTE_CPU_HIGH_PERCENT,
    thresholdLabel: `at or above ${CLOUD_COMPUTE_CPU_HIGH_PERCENT}%`,
    incidentDescription:
      "The instance's CPU stayed at 90% or more for 30 minutes. Look for a process that runs away or for traffic that grew, then scale out behind its load balancer, or move it to a larger instance type. A burstable instance (T family) that ran out of CPU credits is held at its baseline.",
  }),
  sustainedAtOrAbove({
    id: "cloud-aws-elb-unhealthy-hosts",
    name: "Unhealthy Hosts",
    summary:
      "A host behind the load balancer fails its health check for 30 minutes.",
    description: `Fires when every reading of UnHealthyHostCount (Maximum) in the past 30 minutes is 1 or more: an instance behind the classic load balancer keeps failing its health check, and gets no traffic. ${READ_FROM_CLOUDWATCH} ${ON_PAGE_TOO}`,
    category: "Availability",
    provider: AWS,
    resourceTypes: ["AWS::ElasticLoadBalancing::LoadBalancer"],
    metric: awsMetric("AWS/ELB", "UnHealthyHostCount"),
    threshold: 1,
    thresholdLabel: "1 or more",
    incidentDescription:
      "A host behind the load balancer failed its health check for 30 minutes and gets no traffic. Open the load balancer's instances in the AWS console to see which one and why, and check the instance, its security group and the health check's path.",
  }),
  failedShare({
    id: "cloud-aws-elb-server-errors",
    name: "Server Errors",
    summary: "5% or more of requests fail with a 5xx error in 30 minutes.",
    description: awsShareDescription(
      "HTTPCode_Backend_5XX (Sum) over RequestCount (Sum)",
    ),
    provider: AWS,
    resourceTypes: ["AWS::ElasticLoadBalancing::LoadBalancer"],
    failed: [awsMetric("AWS/ELB", "HTTPCode_Backend_5XX")],
    requests: awsMetric("AWS/ELB", "RequestCount"),
    incidentDescription:
      "The instances behind the load balancer answered 5% or more of its requests with a server error. Look at the applications' logs and at what changed on them.",
  }),
  sustainedAtOrAbove({
    id: "cloud-aws-elb-slow-responses",
    name: "Slow Responses",
    summary: "Responses take a second or more on average for 30 minutes.",
    description: `Fires when every reading of Latency (Average) in the past 30 minutes is 1 second or more. ${READ_FROM_CLOUDWATCH}`,
    category: "Latency",
    provider: AWS,
    resourceTypes: ["AWS::ElasticLoadBalancing::LoadBalancer"],
    metric: awsMetric("AWS/ELB", "Latency"),
    threshold: CLOUD_SLOW_RESPONSE_SECONDS,
    thresholdLabel: "1 second or more",
    incidentDescription:
      "The load balancer's responses took a second or more on average for 30 minutes. Look at the instances behind it: their CPU, their databases and what changed on them.",
  }),
  failedShare({
    id: "cloud-aws-alb-server-errors",
    name: "Server Errors",
    summary: "5% or more of requests fail with a 5xx error in 30 minutes.",
    description: awsShareDescription(
      "HTTPCode_Target_5XX_Count and HTTPCode_ELB_5XX_Count (Sum) over RequestCount (Sum)",
    ),
    provider: AWS,
    resourceTypes: ["AWS::ElasticLoadBalancingV2::LoadBalancer"],
    failed: [
      awsMetric("AWS/ApplicationELB", "HTTPCode_Target_5XX_Count"),
      awsMetric("AWS/ApplicationELB", "HTTPCode_ELB_5XX_Count"),
    ],
    requests: awsMetric("AWS/ApplicationELB", "RequestCount"),
    incidentDescription:
      "The load balancer, or the targets behind it, answered 5% or more of its requests with a server error. Errors from the targets are their own: look at their logs. A 502, 503 or 504 from the load balancer itself means no healthy target answered in time.",
  }),
  sustainedAtOrAbove({
    id: "cloud-aws-alb-slow-responses",
    name: "Slow Responses",
    summary: "Targets take a second or more on average for 30 minutes.",
    description: `Fires when every reading of TargetResponseTime (Average) in the past 30 minutes is 1 second or more. ${READ_FROM_CLOUDWATCH}`,
    category: "Latency",
    provider: AWS,
    resourceTypes: ["AWS::ElasticLoadBalancingV2::LoadBalancer"],
    metric: awsMetric("AWS/ApplicationELB", "TargetResponseTime"),
    threshold: CLOUD_SLOW_RESPONSE_SECONDS,
    thresholdLabel: "1 second or more",
    incidentDescription:
      "The targets behind the load balancer took a second or more on average to respond for 30 minutes. Look at the targets: their CPU, their databases and what changed on them.",
  }),
  anyInWindow({
    id: "cloud-aws-natgateway-port-allocation-errors",
    name: "Out of Ports",
    summary: "The gateway runs out of ports for new connections.",
    description: `Fires when ErrorPortAllocation (Sum), totalled over the past 30 minutes, is 1 or more: the NAT gateway could not open a connection for lack of source ports. ${READ_FROM_CLOUDWATCH} ${ON_PAGE_TOO}`,
    category: "Errors",
    provider: AWS,
    resourceTypes: ["AWS::EC2::NatGateway"],
    metrics: [awsMetric("AWS/NATGateway", "ErrorPortAllocation")],
    thresholdLabel: "1 port allocation error or more",
    incidentDescription:
      "The NAT gateway ran out of source ports for new connections to one destination. Spread the traffic over more destinations, add a second NAT gateway, or add secondary IP addresses to this one.",
  }),
  breakage({
    id: "cloud-aws-vpn-tunnels-down",
    name: "VPN Tunnels Down",
    summary: "Both tunnels of the VPN connection are down.",
    description: `Fires on the first reading of TunnelState (Maximum, of both tunnels) under 1: no tunnel of the Site-to-Site VPN connection is up. Clears once both stay up for 30 minutes. ${READ_FROM_CLOUDWATCH} ${ON_PAGE_TOO}`,
    provider: AWS,
    resourceTypes: ["AWS::EC2::VPNConnection"],
    metric: awsMetric("AWS/VPN", "TunnelState"),
    firesBelow: true,
    thresholdLabel: "under 1",
    incidentDescription:
      "Both tunnels of the Site-to-Site VPN connection are down, so the network behind it is unreachable. Check the customer gateway device on your side - its IKE and IPsec settings, its public address and its logs - and the tunnel details in the AWS console.",
  }),
  sustainedAtOrAbove({
    id: "cloud-aws-cloudfront-server-errors",
    name: "Server Errors",
    summary: "5% or more of requests fail with a 5xx error for 30 minutes.",
    description: `Fires when every reading of 5xxErrorRate (Average, in percent) in the past 30 minutes is at or above 5%. CloudFront publishes the share itself, so it is read a point at a time. ${READ_FROM_CLOUDWATCH} ${ON_PAGE_TOO}`,
    category: "Errors",
    provider: AWS,
    resourceTypes: ["AWS::CloudFront::Distribution"],
    metric: awsMetric("AWS/CloudFront", "5xxErrorRate"),
    threshold: CLOUD_FAILED_SHARE_WARNING_PERCENT,
    thresholdLabel: `at or above ${CLOUD_FAILED_SHARE_WARNING_PERCENT}%`,
    incidentDescription:
      "The distribution answered 5% or more of its requests with a server error for 30 minutes. Look at its origins: whether they answer, how fast, and what changed on them.",
  }),
  breakage({
    id: "cloud-aws-route53-health-check-failing",
    name: "Health Check Failing",
    summary: "The health check reports its endpoint unhealthy.",
    description: `Fires on the first reading of HealthCheckStatus (Minimum) under 1: Route 53's checkers found the endpoint unhealthy. Clears once it stays healthy for 30 minutes. ${READ_FROM_CLOUDWATCH} ${ON_PAGE_TOO}`,
    provider: AWS,
    resourceTypes: ["AWS::Route53::HealthCheck"],
    metric: awsMetric("AWS/Route53", "HealthCheckStatus"),
    firesBelow: true,
    thresholdLabel: "under 1",
    incidentDescription:
      "The Route 53 health check reports its endpoint unhealthy, so a failover record routes away from it. Open the endpoint the check watches and the check's latest failure reason in the AWS console.",
  }),
  sustainedAtOrAbove({
    id: "cloud-aws-efs-io-limit",
    name: "Near Its I/O Limit",
    summary: "The file system stays at 95% of its I/O limit for 30 minutes.",
    description: `Fires when every reading of PercentIOLimit (Average) in the past 30 minutes is at or above 95%. ${READ_FROM_CLOUDWATCH} ${ON_PAGE_TOO}`,
    category: "Utilization",
    provider: AWS,
    resourceTypes: ["AWS::EFS::FileSystem"],
    metric: awsMetric("AWS/EFS", "PercentIOLimit"),
    threshold: 95,
    thresholdLabel: "at or above 95%",
    incidentDescription:
      "The General Purpose file system is at 95% of its I/O limit, so its clients' reads and writes slow down. Move the workload to a Max I/O or an Elastic throughput file system, or spread it over more file systems.",
  }),
  sustainedAtOrAbove({
    id: "cloud-aws-ecs-high-cpu",
    name: "High CPU",
    summary: "CPU stays at 90% or more of what it reserves for 30 minutes.",
    description: `Fires when every reading of CPUUtilization (Average) in the past 30 minutes is at or above 90% of the CPU its tasks reserve. ${READ_FROM_CLOUDWATCH}`,
    category: "Utilization",
    provider: AWS,
    resourceTypes: ["AWS::ECS::Service", "AWS::ECS::Cluster"],
    metric: awsMetric("AWS/ECS", "CPUUtilization"),
    threshold: CLOUD_COMPUTE_CPU_HIGH_PERCENT,
    thresholdLabel: `at or above ${CLOUD_COMPUTE_CPU_HIGH_PERCENT}%`,
    incidentDescription:
      "The service's tasks used 90% or more of the CPU they reserve for 30 minutes. Scale the service out, or give its task definition more CPU.",
  }),
  sustainedAtOrAbove({
    id: "cloud-aws-ecs-high-memory",
    name: "High Memory",
    summary: "Memory stays at 95% or more of what it reserves for 30 minutes.",
    description: `Fires when every reading of MemoryUtilization (Average) in the past 30 minutes is at or above 95% of the memory its tasks reserve: a task that passes its hard limit is stopped. ${READ_FROM_CLOUDWATCH} ${ON_PAGE_TOO}`,
    category: "Utilization",
    provider: AWS,
    resourceTypes: ["AWS::ECS::Service", "AWS::ECS::Cluster"],
    metric: awsMetric("AWS/ECS", "MemoryUtilization"),
    threshold: CLOUD_MEMORY_HIGH_PERCENT,
    thresholdLabel: `at or above ${CLOUD_MEMORY_HIGH_PERCENT}%`,
    incidentDescription:
      "The service's tasks used 95% or more of the memory they reserve for 30 minutes; a task that passes its hard limit is stopped and replaced. Look for a leak, then give the task definition more memory.",
  }),
  failedShare({
    id: "cloud-aws-lambda-errors",
    name: "Function Errors",
    summary: "5% or more of its invocations fail in 30 minutes.",
    description: `Fires when Errors (Sum) is 5% or more of Invocations (Sum), each totalled over the past 30 minutes, however few the invocations: a nightly job or a queue handler is invoked a few times an hour, and fails as surely as a busy function. Totalled, a read-only and a streamed account read the same share. ${READ_FROM_CLOUDWATCH} ${ON_PAGE_TOO}`,
    provider: AWS,
    resourceTypes: ["AWS::Lambda::Function"],
    failed: [awsMetric("AWS/Lambda", "Errors")],
    requests: awsMetric("AWS/Lambda", "Invocations"),
    withoutRequestFloor: true,
    incidentDescription:
      "5% or more of the function's invocations failed. Its log group in CloudWatch Logs - or its Logs tab, when the account streams its logs - has each failure's error and stack trace.",
  }),
  anyInWindow({
    id: "cloud-aws-lambda-throttles",
    name: "Function Throttled",
    summary: "Invocations are throttled at the function's concurrency limit.",
    description: `Fires when Throttles (Sum), totalled over the past 30 minutes, is 1 or more: an invocation was refused because the function, or the account's Region, reached its concurrency limit. ${READ_FROM_CLOUDWATCH} ${ON_PAGE_TOO}`,
    category: "Throttling",
    provider: AWS,
    resourceTypes: ["AWS::Lambda::Function"],
    metrics: [awsMetric("AWS/Lambda", "Throttles")],
    thresholdLabel: "1 throttled invocation or more",
    incidentDescription:
      "Invocations of the function were throttled: it, or the Region's account limit, ran out of concurrency. Raise its reserved concurrency, ask AWS to raise the account's limit, or slow down what calls it.",
  }),
  anyInWindow({
    id: "cloud-aws-states-executions-failed",
    name: "Executions Failed",
    summary: "An execution of the state machine fails.",
    description: `Fires when ExecutionsFailed (Sum), totalled over the past 30 minutes, is 1 or more. ${READ_FROM_CLOUDWATCH} ${ON_PAGE_TOO}`,
    category: "Errors",
    provider: AWS,
    resourceTypes: ["AWS::StepFunctions::StateMachine"],
    metrics: [awsMetric("AWS/States", "ExecutionsFailed")],
    thresholdLabel: "1 failed execution or more",
    incidentDescription:
      "An execution of the state machine failed. Its execution history in the Step Functions console names the state that failed and the error it raised.",
  }),
  sustainedAtOrAbove({
    id: "cloud-aws-rds-high-cpu",
    name: "High CPU",
    summary: "CPU stays at 95% or more for 30 minutes.",
    description: `Fires when every reading of CPUUtilization (Average) in the past 30 minutes is at or above 95%. ${READ_FROM_CLOUDWATCH} ${ON_PAGE_TOO}`,
    category: "Utilization",
    provider: AWS,
    resourceTypes: ["AWS::RDS::DBInstance", "AWS::RDS::DBCluster"],
    metric: awsMetric("AWS/RDS", "CPUUtilization"),
    threshold: CLOUD_CPU_HIGH_PERCENT,
    thresholdLabel: `at or above ${CLOUD_CPU_HIGH_PERCENT}%`,
    incidentDescription:
      "The database's CPU stayed at 95% or more for 30 minutes, so its queries queue. Performance Insights names the queries that use it; add an index, move reads to a replica, or scale the instance class up.",
  }),
  define({
    id: "cloud-aws-rds-low-storage",
    name: "Low Free Storage",
    summary:
      "Free storage stays under 10% of what is allocated for 30 minutes.",
    description: `Fires when every reading of FreeStorageSpace (Average) in the past 30 minutes is under 10% of the instance's allocated storage, as its inventory lists it - the health rules' 90% full. Offered once the account's inventory has listed the instance. ${READ_FROM_CLOUDWATCH} ${ON_PAGE_TOO}`,
    category: "Storage",
    severity: "Warning",
    provider: AWS,
    resourceTypes: ["AWS::RDS::DBInstance"],
    measure: "sustained",
    queries: [
      { alias: VALUE, metric: awsMetric("AWS/RDS", "FreeStorageSpace") },
    ],
    comparedAlias: VALUE,
    filterType: FilterType.LessThan,
    // Replaced by 10% of the instance's own storage (getThreshold).
    threshold: 0,
    thresholdLabel: `under ${CLOUD_RDS_FREE_STORAGE_LOW_PERCENT}% of its allocated storage`,
    requiresAllocatedStorage: true,
    incidentDescription:
      "The database has less than 10% of its allocated storage free; a database that runs out goes read-only. Turn on storage autoscaling or raise its allocated storage, and look for what grew: tables, indexes, logs or temporary files.",
  }),
  define({
    id: "cloud-aws-rds-connections-near-limit",
    name: "Connections Near the Limit",
    summary:
      "Connections stay at 90% or more of the instance's limit for 30 minutes.",
    description: `Fires when every reading of DatabaseConnections (Average) in the past 30 minutes is at or above ${CLOUD_CONNECTIONS_HIGH_PERCENT}% of the instance's connection limit: past the limit, new connections are refused. The limit is the default max_connections of its class and engine, as RDS works it out from the class's memory: about 60 on a db.t3.micro running MySQL, about 1,700 on a db.r6g.large running PostgreSQL. If the instance's parameter group sets max_connections, change the threshold to ${CLOUD_CONNECTIONS_HIGH_PERCENT}% of that. Offered for MySQL, MariaDB, PostgreSQL and Aurora once the account's inventory lists the instance's class and engine. ${READ_FROM_CLOUDWATCH}`,
    category: "Utilization",
    severity: "Warning",
    provider: AWS,
    resourceTypes: ["AWS::RDS::DBInstance"],
    measure: "sustained",
    queries: [
      { alias: VALUE, metric: awsMetric("AWS/RDS", "DatabaseConnections") },
    ],
    comparedAlias: VALUE,
    filterType: FilterType.GreaterThanOrEqualTo,
    // Replaced by 90% of the instance's own connection limit (getThreshold).
    threshold: 0,
    thresholdLabel: `at or above ${CLOUD_CONNECTIONS_HIGH_PERCENT}% of its connection limit`,
    requiresConnectionLimit: true,
    incidentDescription:
      "The database held 90% or more of the connections it allows for 30 minutes; past its limit, new connections are refused with a too-many-connections error. Look for clients that open connections without closing or pooling them, put RDS Proxy in front of it, or move it to a class with more memory. If its parameter group sets max_connections, that number is the limit: check it, and change this monitor's threshold to match.",
  }),
  sustainedAtOrAbove({
    id: "cloud-aws-docdb-high-cpu",
    name: "High CPU",
    summary: "CPU stays at 95% or more for 30 minutes.",
    description: `Fires when every reading of CPUUtilization (Average) in the past 30 minutes is at or above 95%. ${READ_FROM_CLOUDWATCH} ${ON_PAGE_TOO}`,
    category: "Utilization",
    provider: AWS,
    resourceTypes: ["AWS::DocDB::DBInstance", "AWS::DocDB::DBCluster"],
    metric: awsMetric("AWS/DocDB", "CPUUtilization"),
    threshold: CLOUD_CPU_HIGH_PERCENT,
    thresholdLabel: `at or above ${CLOUD_CPU_HIGH_PERCENT}%`,
    incidentDescription:
      "The DocumentDB instance's CPU stayed at 95% or more for 30 minutes. Its profiler names the operations that use it; add an index, read from a replica, or scale the instance class up.",
  }),
  anyInWindow({
    id: "cloud-aws-dynamodb-throttled",
    name: "Requests Throttled",
    summary: "Reads or writes of the table are throttled.",
    description: `Fires when ReadThrottleEvents and WriteThrottleEvents (Sum), totalled over the past 30 minutes, add up to 1 or more: requests passed the table's provisioned capacity, or a partition's. ${READ_FROM_CLOUDWATCH} ${ON_PAGE_TOO}`,
    category: "Throttling",
    provider: AWS,
    resourceTypes: ["AWS::DynamoDB::Table"],
    metrics: [
      awsMetric("AWS/DynamoDB", "ReadThrottleEvents"),
      awsMetric("AWS/DynamoDB", "WriteThrottleEvents"),
    ],
    thresholdLabel: "1 throttled request or more",
    incidentDescription:
      "Requests to the table were throttled. Raise its provisioned capacity, turn on auto scaling or on-demand capacity, or spread a hot partition key's load.",
  }),
  sustainedAtOrAbove({
    id: "cloud-aws-elasticache-high-cpu",
    name: "High CPU",
    summary: "CPU stays at 95% or more for 30 minutes.",
    description: `Fires when every reading of CPUUtilization (Average) in the past 30 minutes is at or above 95%. ${READ_FROM_CLOUDWATCH} ${ON_PAGE_TOO}`,
    category: "Utilization",
    provider: AWS,
    resourceTypes: [
      "AWS::ElastiCache::CacheCluster",
      "AWS::ElastiCache::ReplicationGroup",
    ],
    metric: awsMetric("AWS/ElastiCache", "CPUUtilization"),
    threshold: CLOUD_CPU_HIGH_PERCENT,
    thresholdLabel: `at or above ${CLOUD_CPU_HIGH_PERCENT}%`,
    incidentDescription:
      "The cache's CPU stayed at 95% or more for 30 minutes, so its commands slow down. Look for expensive commands in its slow log, then scale it up or out.",
  }),
  sustainedAtOrAbove({
    id: "cloud-aws-elasticache-high-memory",
    name: "High Memory",
    summary: "Memory stays at 95% or more for 30 minutes.",
    description: `Fires when every reading of DatabaseMemoryUsagePercentage (Average) in the past 30 minutes is at or above 95%: the cache evicts keys, or refuses writes. ${READ_FROM_CLOUDWATCH} ${ON_PAGE_TOO}`,
    category: "Utilization",
    provider: AWS,
    resourceTypes: [
      "AWS::ElastiCache::CacheCluster",
      "AWS::ElastiCache::ReplicationGroup",
    ],
    metric: awsMetric("AWS/ElastiCache", "DatabaseMemoryUsagePercentage"),
    threshold: CLOUD_MEMORY_HIGH_PERCENT,
    thresholdLabel: `at or above ${CLOUD_MEMORY_HIGH_PERCENT}%`,
    incidentDescription:
      "The cache used 95% or more of its memory for 30 minutes: it evicts keys, or refuses writes if its eviction policy is noeviction. Set expiries on what can expire, or scale it up or out.",
  }),
  sustainedAtOrAbove({
    id: "cloud-aws-redshift-disk-full",
    name: "Disk Nearly Full",
    summary: "Disk use stays at 90% or more for 30 minutes.",
    description: `Fires when every reading of PercentageDiskSpaceUsed (Average) in the past 30 minutes is at or above 90%. ${READ_FROM_CLOUDWATCH} ${ON_PAGE_TOO}`,
    category: "Storage",
    provider: AWS,
    resourceTypes: ["AWS::Redshift::Cluster"],
    metric: awsMetric("AWS/Redshift", "PercentageDiskSpaceUsed"),
    threshold: CLOUD_STORAGE_HIGH_PERCENT,
    thresholdLabel: `at or above ${CLOUD_STORAGE_HIGH_PERCENT}%`,
    incidentDescription:
      "The cluster's disks are 90% full or more; queries that spill to disk fail once they fill. Vacuum and drop what is not needed, or resize the cluster.",
  }),
  sustainedAtOrAbove({
    id: "cloud-aws-redshift-high-cpu",
    name: "High CPU",
    summary: "CPU stays at 95% or more for 30 minutes.",
    description: `Fires when every reading of CPUUtilization (Average) in the past 30 minutes is at or above 95%. ${READ_FROM_CLOUDWATCH} ${ON_PAGE_TOO}`,
    category: "Utilization",
    provider: AWS,
    resourceTypes: ["AWS::Redshift::Cluster"],
    metric: awsMetric("AWS/Redshift", "CPUUtilization"),
    threshold: CLOUD_CPU_HIGH_PERCENT,
    thresholdLabel: `at or above ${CLOUD_CPU_HIGH_PERCENT}%`,
    incidentDescription:
      "The cluster's CPU stayed at 95% or more for 30 minutes, so its queries queue. Look at the longest-running queries in its query monitoring, then tune them or resize the cluster.",
  }),
  breakage({
    id: "cloud-aws-opensearch-cluster-red",
    name: "Cluster Status Red",
    summary: "The search domain's cluster status turns red.",
    description: `Fires on the first reading of ClusterStatus.red (Maximum) at 1: a primary shard of an index is not allocated, so its data cannot be searched or written. Clears once the status stays out of red for 30 minutes. ${READ_FROM_CLOUDWATCH} ${ON_PAGE_TOO}`,
    provider: AWS,
    resourceTypes: ["AWS::OpenSearchService::Domain"],
    metric: awsMetric("AWS/ES", "ClusterStatus.red"),
    thresholdLabel: "at 1",
    incidentDescription:
      "The domain's cluster status is red: a primary shard is unassigned. A node that failed, or disks that are full, are the usual causes; the domain's health in the AWS console names them.",
  }),
  sustainedAtOrAbove({
    id: "cloud-aws-opensearch-high-cpu",
    name: "High CPU",
    summary: "CPU stays at 95% or more for 30 minutes.",
    description: `Fires when every reading of CPUUtilization (Average) in the past 30 minutes is at or above 95%. ${READ_FROM_CLOUDWATCH} ${ON_PAGE_TOO}`,
    category: "Utilization",
    provider: AWS,
    resourceTypes: ["AWS::OpenSearchService::Domain"],
    metric: awsMetric("AWS/ES", "CPUUtilization"),
    threshold: CLOUD_CPU_HIGH_PERCENT,
    thresholdLabel: `at or above ${CLOUD_CPU_HIGH_PERCENT}%`,
    incidentDescription:
      "The domain's CPU stayed at 95% or more for 30 minutes, so its searches and indexing slow down. Look at its slow logs, then add data nodes or move to a larger instance type.",
  }),
  ageAtOrAbove({
    id: "cloud-aws-sqs-oldest-message",
    name: "Oldest Message Waiting",
    summary: "The oldest message in the queue waits an hour or more.",
    description: `Fires on the first reading of ApproximateAgeOfOldestMessage (Maximum) at 3600 seconds or more: nothing has taken a message for an hour, or consumers fall behind. Clears once it is under 3240 seconds again. ${READ_FROM_CLOUDWATCH} ${ON_PAGE_TOO}`,
    provider: AWS,
    resourceTypes: ["AWS::SQS::Queue"],
    metric: awsMetric("AWS/SQS", "ApproximateAgeOfOldestMessage"),
    threshold: CLOUD_BACKLOG_AGE_SECONDS,
    incidentDescription:
      "A message has waited in the queue for an hour or more. Check that its consumers run and keep up - a consumer that fails on one message leaves it to come back again and again - and give poison messages a dead-letter queue.",
  }),
  anyInWindow({
    id: "cloud-aws-sns-notifications-failed",
    name: "Deliveries Failed",
    summary: "A notification of the topic cannot be delivered.",
    description: `Fires when NumberOfNotificationsFailed (Sum), totalled over the past 30 minutes, is 1 or more. ${READ_FROM_CLOUDWATCH} ${ON_PAGE_TOO}`,
    category: "Errors",
    provider: AWS,
    resourceTypes: ["AWS::SNS::Topic"],
    metrics: [awsMetric("AWS/SNS", "NumberOfNotificationsFailed")],
    thresholdLabel: "1 failed delivery or more",
    incidentDescription:
      "SNS could not deliver a notification of the topic to a subscriber. Turn on the topic's delivery status logs to see which endpoint refused it and why.",
  }),
  ageAtOrAbove({
    id: "cloud-aws-kinesis-consumers-behind",
    name: "Consumers Falling Behind",
    summary: "The stream's consumers fall an hour or more behind.",
    description: `Fires on the first reading of GetRecords.IteratorAgeMilliseconds (Maximum) at 3,600,000 milliseconds or more: the oldest record a consumer read was an hour old. Records past the stream's retention are lost. ${READ_FROM_CLOUDWATCH} ${ON_PAGE_TOO}`,
    provider: AWS,
    resourceTypes: ["AWS::Kinesis::Stream"],
    metric: awsMetric("AWS/Kinesis", "GetRecords.IteratorAgeMilliseconds"),
    threshold: CLOUD_BACKLOG_AGE_SECONDS * 1000,
    incidentDescription:
      "The stream's consumers are an hour or more behind; records older than the stream's retention are lost. Scale the consumers out, or add shards so more of them read at once.",
  }),
  sustainedBelow({
    id: "cloud-aws-firehose-deliveries-failing",
    name: "Deliveries Failing",
    summary: "Fewer than 99% of records reach S3 for 30 minutes.",
    description: `Fires when every reading of DeliveryToS3.Success (Average, the share of records delivered, 0 to 1) in the past 30 minutes is under 0.99. ${READ_FROM_CLOUDWATCH} ${ON_PAGE_TOO}`,
    provider: AWS,
    resourceTypes: ["AWS::KinesisFirehose::DeliveryStream"],
    metric: awsMetric("AWS/Firehose", "DeliveryToS3.Success"),
    threshold: 0.99,
    thresholdLabel: "under 0.99",
    incidentDescription:
      "The Firehose stream failed to deliver some records to S3; it retries, then backs them up to its error prefix. Its error logs name the cause: a bucket policy, a KMS key or a transformation function.",
  }),
  failedShare({
    id: "cloud-aws-apigateway-server-errors",
    name: "Server Errors",
    summary: "5% or more of requests fail with a 5xx error in 30 minutes.",
    description: awsShareDescription("5XXError (Sum) over Count (Sum)"),
    provider: AWS,
    resourceTypes: ["AWS::ApiGateway::RestApi"],
    failed: [awsMetric("AWS/ApiGateway", "5XXError")],
    requests: awsMetric("AWS/ApiGateway", "Count"),
    incidentDescription:
      "The API answered 5% or more of its requests with a server error. Its execution logs name the integration that failed: a function that threw, a backend that timed out, or a mapping that broke.",
  }),
  sustainedAtOrAbove({
    id: "cloud-aws-apigateway-slow-responses",
    name: "Slow Responses",
    summary: "Requests take a second or more on average for 30 minutes.",
    description: `Fires when every reading of Latency (Average) in the past 30 minutes is 1,000 milliseconds or more. ${READ_FROM_CLOUDWATCH}`,
    category: "Latency",
    provider: AWS,
    resourceTypes: ["AWS::ApiGateway::RestApi", "AWS::ApiGatewayV2::Api"],
    metric: awsMetric("AWS/ApiGateway", "Latency"),
    threshold: CLOUD_SLOW_RESPONSE_SECONDS * 1000,
    thresholdLabel: "1,000 milliseconds or more",
    incidentDescription:
      "The API's requests took a second or more on average for 30 minutes. Most of it is its integrations' time: look at the functions or backends behind it.",
  }),
  anyInWindow({
    id: "cloud-aws-events-failed-invocations",
    name: "Failed Invocations",
    summary: "The rule fails to invoke one of its targets.",
    description: `Fires when FailedInvocations (Sum), totalled over the past 30 minutes, is 1 or more: an event matched the rule, and EventBridge could not deliver it to a target. ${READ_FROM_CLOUDWATCH} ${ON_PAGE_TOO}`,
    category: "Errors",
    provider: AWS,
    resourceTypes: ["AWS::Events::Rule"],
    metrics: [awsMetric("AWS/Events", "FailedInvocations")],
    thresholdLabel: "1 failed invocation or more",
    incidentDescription:
      "EventBridge could not invoke a target of the rule. Check the target still exists and that the rule's role may invoke it; give the target a dead-letter queue to keep the events it misses.",
  }),
  sustainedAtOrAbove({
    id: "cloud-aws-amazonmq-high-cpu",
    name: "High CPU",
    summary: "The broker's CPU stays at 95% or more for 30 minutes.",
    description: `Fires when every reading of CpuUtilization (Average) in the past 30 minutes is at or above 95%. ${READ_FROM_CLOUDWATCH} ${ON_PAGE_TOO}`,
    category: "Utilization",
    provider: AWS,
    resourceTypes: ["AWS::AmazonMQ::Broker"],
    metric: awsMetric("AWS/AmazonMQ", "CpuUtilization"),
    threshold: CLOUD_CPU_HIGH_PERCENT,
    thresholdLabel: `at or above ${CLOUD_CPU_HIGH_PERCENT}%`,
    incidentDescription:
      "The broker's CPU stayed at 95% or more for 30 minutes, so messages wait. Look for queues that pile up and consumers that fell behind, or move it to a larger instance type.",
  }),
  breakage({
    id: "cloud-aws-msk-no-active-controller",
    name: "No Active Controller",
    summary: "The Kafka cluster has no active controller.",
    description: `Fires on the first reading of ActiveControllerCount (Maximum, of every broker) under 1: no broker is the cluster's controller, so partitions cannot change leader. Clears once one stays elected for 30 minutes. ${READ_FROM_CLOUDWATCH} ${ON_PAGE_TOO}`,
    provider: AWS,
    resourceTypes: ["AWS::MSK::Cluster"],
    metric: awsMetric("AWS/Kafka", "ActiveControllerCount"),
    firesBelow: true,
    thresholdLabel: "under 1",
    incidentDescription:
      "The MSK cluster has no active controller, so its partitions cannot elect leaders and its brokers' metadata stops changing. Check the brokers' health in the AWS console and their ZooKeeper or KRaft connections.",
  }),
  define({
    id: "cloud-aws-acm-certificate-expiring",
    name: "Certificate Expiring",
    summary: `The certificate expires in ${CLOUD_CERTIFICATE_EXPIRY_DAYS} days or fewer.`,
    description: `Fires when every reading of DaysToExpiry (Minimum) in the past 2 days is ${CLOUD_CERTIFICATE_EXPIRY_DAYS} or fewer, or the past 2 days hold none: ACM publishes it twice a day, and stops once the certificate expires. ACM renews the certificates it issued 45 to 60 days before they expire, so one with ${CLOUD_CERTIFICATE_EXPIRY_DAYS} days left is imported, not in use, or failing its validation, with a month to fix it. Clears with the first reading after it is renewed or imported again. ${READ_SLOWLY_FROM_CLOUDWATCH}`,
    category: "Availability",
    severity: "Warning",
    provider: AWS,
    resourceTypes: ["AWS::CertificateManager::Certificate"],
    measure: "countdown",
    queries: [
      {
        alias: VALUE,
        metric: awsMetric("AWS/CertificateManager", "DaysToExpiry"),
      },
    ],
    comparedAlias: VALUE,
    filterType: FilterType.LessThanOrEqualTo,
    threshold: CLOUD_CERTIFICATE_EXPIRY_DAYS,
    thresholdLabel: `${CLOUD_CERTIFICATE_EXPIRY_DAYS} days or fewer`,
    incidentDescription:
      "The certificate expires in 30 days or fewer, or ACM stopped publishing its days to expiry because it expired. ACM never renews an imported certificate: import the renewed one over it, which keeps its ARN. One ACM issued renews only while it is in use and its domains still validate: its renewal status in the ACM console says why it did not, and a DNS-validated one needs its CNAME records in place. A certificate deleted on purpose stops being read too: then delete this monitor.",
  }),
];

/*
 * ---------------------------------------------------------------------------
 * Azure
 * ---------------------------------------------------------------------------
 */

function azurePercent(
  metricName: string,
  aggregation: AzureAggregation = "average",
): CloudAlertMetric {
  return azureMetric({
    metricName,
    aggregation,
    aggregationType: MetricsAggregationType.Avg,
    legendUnit: "%",
  });
}

function azureCount(metricName: string): CloudAlertMetric {
  return azureMetric({
    metricName,
    aggregation: "total",
    aggregationType: MetricsAggregationType.Sum,
  });
}

function azureShareDescription(metrics: string): string {
  return `Fires when 5% or more of the requests of the past 15 minutes failed, of at least 20 requests: ${metrics}, each totalled over the window. ${READ_FROM_AZURE_MONITOR}`;
}

const AZURE_TEMPLATES: Array<CloudAlertTemplate> = [
  breakage({
    id: "cloud-azure-vm-unavailable",
    name: "VM Unavailable",
    summary: "The virtual machine stops being available.",
    description: `Fires on the first reading of VmAvailabilityMetric under 1: Azure found the virtual machine unavailable - stopped, rebooting, or on a host that failed. Clears once it stays available for 15 minutes. ${READ_FROM_AZURE_MONITOR} ${ON_PAGE_TOO}`,
    provider: AZURE,
    resourceTypes: ["Microsoft.Compute/virtualMachines"],
    metric: azureMetric({
      metricName: "VmAvailabilityMetric",
      aggregation: "average",
      aggregationType: MetricsAggregationType.Min,
    }),
    firesBelow: true,
    thresholdLabel: "under 1",
    incidentDescription:
      "The virtual machine is unavailable. Its Resource Health in the Azure portal says why: a planned update, a reboot, a stop, or a failure of the host under it.",
  }),
  sustainedAtOrAbove({
    id: "cloud-azure-vm-high-cpu",
    name: "High CPU",
    summary: "CPU stays at 90% or more for 15 minutes.",
    description: `Fires when every reading of Percentage CPU in the past 15 minutes is at or above 90%. A busy VM is often doing its work: this says it has no headroom left. ${READ_FROM_AZURE_MONITOR}`,
    category: "Utilization",
    provider: AZURE,
    resourceTypes: [
      "Microsoft.Compute/virtualMachines",
      "Microsoft.Compute/virtualMachineScaleSets",
    ],
    metric: azurePercent("Percentage CPU"),
    threshold: CLOUD_COMPUTE_CPU_HIGH_PERCENT,
    thresholdLabel: `at or above ${CLOUD_COMPUTE_CPU_HIGH_PERCENT}%`,
    incidentDescription:
      "The virtual machine's CPU stayed at 90% or more for 15 minutes. Look for a process that runs away or for traffic that grew, then scale out or move to a larger size. A B-series VM that ran out of CPU credits is held at its baseline.",
  }),
  failedShare({
    id: "cloud-azure-appservice-server-errors",
    name: "Server Errors",
    summary: "5% or more of requests fail with a 5xx error in 15 minutes.",
    description: azureShareDescription("Http5xx over Requests"),
    provider: AZURE,
    resourceTypes: ["Microsoft.Web/sites"],
    failed: [azureCount("Http5xx")],
    requests: azureCount("Requests"),
    incidentDescription:
      "The app answered 5% or more of its requests with a server error. Its application logs, or Application Insights, name the errors; look at what was deployed last.",
  }),
  sustainedAtOrAbove({
    id: "cloud-azure-appservice-slow-responses",
    name: "Slow Responses",
    summary: "Responses take a second or more on average for 15 minutes.",
    description: `Fires when every reading of HttpResponseTime (Average) in the past 15 minutes is 1 second or more. ${READ_FROM_AZURE_MONITOR}`,
    category: "Latency",
    provider: AZURE,
    resourceTypes: ["Microsoft.Web/sites"],
    metric: azureMetric({
      metricName: "HttpResponseTime",
      aggregation: "average",
      aggregationType: MetricsAggregationType.Avg,
      legendUnit: "s",
    }),
    threshold: CLOUD_SLOW_RESPONSE_SECONDS,
    thresholdLabel: "1 second or more",
    incidentDescription:
      "The app's responses took a second or more on average for 15 minutes. Look at its plan's CPU and memory, and at the databases and services it calls.",
  }),
  sustainedAtOrAbove({
    id: "cloud-azure-appserviceplan-high-cpu",
    name: "High CPU",
    summary: "The plan's CPU stays at 90% or more for 15 minutes.",
    description: `Fires when every reading of CpuPercentage in the past 15 minutes is at or above 90%, across the plan's instances. ${READ_FROM_AZURE_MONITOR}`,
    category: "Utilization",
    provider: AZURE,
    resourceTypes: ["Microsoft.Web/serverfarms"],
    metric: azurePercent("CpuPercentage"),
    threshold: CLOUD_COMPUTE_CPU_HIGH_PERCENT,
    thresholdLabel: `at or above ${CLOUD_COMPUTE_CPU_HIGH_PERCENT}%`,
    incidentDescription:
      "The App Service plan's instances used 90% or more of their CPU for 15 minutes, which slows every app on it. Scale the plan out, or up to a larger tier.",
  }),
  sustainedAtOrAbove({
    id: "cloud-azure-appserviceplan-high-memory",
    name: "High Memory",
    summary: "The plan's memory stays at 95% or more for 15 minutes.",
    description: `Fires when every reading of MemoryPercentage in the past 15 minutes is at or above 95%, across the plan's instances. ${READ_FROM_AZURE_MONITOR} ${ON_PAGE_TOO}`,
    category: "Utilization",
    provider: AZURE,
    resourceTypes: ["Microsoft.Web/serverfarms"],
    metric: azurePercent("MemoryPercentage"),
    threshold: CLOUD_MEMORY_HIGH_PERCENT,
    thresholdLabel: `at or above ${CLOUD_MEMORY_HIGH_PERCENT}%`,
    incidentDescription:
      "The App Service plan's instances used 95% or more of their memory for 15 minutes; apps on it restart when it runs out. Look for an app that leaks, then scale the plan out or up.",
  }),
  sustainedAtOrAbove({
    id: "cloud-azure-sql-storage-full",
    name: "Storage Nearly Full",
    summary: "Storage use stays at 90% or more for 15 minutes.",
    description: `Fires when every reading of storage_percent in the past 15 minutes is at or above 90% of the database's, the pool's or the server's maximum size. ${READ_FROM_AZURE_MONITOR} ${ON_PAGE_TOO}`,
    category: "Storage",
    provider: AZURE,
    resourceTypes: [
      "Microsoft.Sql/servers/databases",
      "Microsoft.Sql/servers/elasticpools",
      "Microsoft.DBforPostgreSQL/flexibleServers",
      "Microsoft.DBforMySQL/flexibleServers",
    ],
    metric: azurePercent("storage_percent"),
    threshold: CLOUD_STORAGE_HIGH_PERCENT,
    thresholdLabel: `at or above ${CLOUD_STORAGE_HIGH_PERCENT}%`,
    incidentDescription:
      "The database is 90% full or more; once full it refuses writes. Raise its maximum size or storage, turn on storage autogrow where it has one, and look for what grew.",
  }),
  sustainedAtOrAbove({
    id: "cloud-azure-sql-high-cpu",
    name: "High CPU",
    summary: "CPU stays at 95% or more for 15 minutes.",
    description: `Fires when every reading of cpu_percent in the past 15 minutes is at or above 95%. ${READ_FROM_AZURE_MONITOR} ${ON_PAGE_TOO}`,
    category: "Utilization",
    provider: AZURE,
    resourceTypes: [
      "Microsoft.Sql/servers/databases",
      "Microsoft.Sql/servers/elasticpools",
      "Microsoft.DBforPostgreSQL/flexibleServers",
      "Microsoft.DBforMySQL/flexibleServers",
    ],
    metric: azurePercent("cpu_percent"),
    threshold: CLOUD_CPU_HIGH_PERCENT,
    thresholdLabel: `at or above ${CLOUD_CPU_HIGH_PERCENT}%`,
    incidentDescription:
      "The database's CPU stayed at 95% or more for 15 minutes, so its queries queue. Query Performance Insight names the queries that use it; add an index, or scale up its compute.",
  }),
  sustainedAtOrAbove({
    id: "cloud-azure-sql-sessions-high",
    name: "Sessions Near the Limit",
    summary: "Sessions stay at 90% or more of the limit for 15 minutes.",
    description: `Fires when every reading of sessions_percent in the past 15 minutes is at or above 90% of the database's limit; past it, new connections are refused. ${READ_FROM_AZURE_MONITOR} ${ON_PAGE_TOO}`,
    category: "Utilization",
    provider: AZURE,
    resourceTypes: ["Microsoft.Sql/servers/databases"],
    metric: azurePercent("sessions_percent"),
    threshold: 90,
    thresholdLabel: "at or above 90%",
    incidentDescription:
      "The database holds 90% or more of the sessions its service tier allows; past it, new connections are refused. Look for clients that do not close their connections or pool them, or move to a higher tier.",
  }),
  anyInWindow({
    id: "cloud-azure-sql-failed-connections",
    name: "Failed Connections",
    summary: "Connections to the database fail with a system error.",
    description: `Fires when connection_failed, totalled over the past 15 minutes, is 1 or more: Azure SQL refused a connection for a reason of its own, not a wrong password. ${READ_FROM_AZURE_MONITOR} ${ON_PAGE_TOO}`,
    category: "Errors",
    provider: AZURE,
    resourceTypes: ["Microsoft.Sql/servers/databases"],
    metrics: [azureCount("connection_failed")],
    thresholdLabel: "1 failed connection or more",
    incidentDescription:
      "Connections to the database failed with a system error. Its Resource Health in the Azure portal says whether Azure saw a problem; transient failures during a failover clear by themselves.",
  }),
  define({
    id: "cloud-azure-sql-dtu-high",
    name: "DTU Usage High",
    summary: "DTU use stays at 95% or more for 15 minutes.",
    description: `Fires when every reading of dtu_consumption_percent in the past 15 minutes is at or above 95% of the database's DTUs: its queries wait for CPU, data or log I/O. Offered to a database on the DTU purchasing model, which is the one that reports it. ${READ_FROM_AZURE_MONITOR} ${ON_PAGE_TOO}`,
    category: "Utilization",
    severity: "Warning",
    provider: AZURE,
    resourceTypes: ["Microsoft.Sql/servers/databases"],
    measure: "sustained",
    queries: [
      { alias: VALUE, metric: azurePercent("dtu_consumption_percent") },
    ],
    comparedAlias: VALUE,
    filterType: FilterType.GreaterThanOrEqualTo,
    threshold: 95,
    thresholdLabel: "at or above 95%",
    requiresReading: true,
    incidentDescription:
      "The database used 95% or more of its DTUs for 15 minutes, so its queries wait. Query Performance Insight names the queries that use them; tune them, or move the database to a larger service objective.",
  }),
  anyInWindow({
    id: "cloud-azure-sql-deadlocks",
    name: "Deadlocks",
    summary: "Queries of the database deadlock.",
    description: `Fires when deadlock, totalled over the past 15 minutes, is 1 or more: two transactions held what the other needed, and Azure SQL ended one of them. ${READ_FROM_AZURE_MONITOR} ${ON_PAGE_TOO}`,
    category: "Errors",
    provider: AZURE,
    resourceTypes: ["Microsoft.Sql/servers/databases"],
    metrics: [azureCount("deadlock")],
    thresholdLabel: "1 deadlock or more",
    incidentDescription:
      "Transactions of the database deadlocked, and Azure SQL rolled one of each pair back. The deadlock graphs in Extended Events name the queries and the locks; access tables in the same order, keep transactions short, or add the index the queries scan for.",
  }),
  sustainedAtOrAbove({
    id: "cloud-azure-sqlmi-high-cpu",
    name: "High CPU",
    summary: "The managed instance's CPU stays at 95% or more for 15 minutes.",
    description: `Fires when every reading of avg_cpu_percent in the past 15 minutes is at or above 95%. ${READ_FROM_AZURE_MONITOR} ${ON_PAGE_TOO}`,
    category: "Utilization",
    provider: AZURE,
    resourceTypes: ["Microsoft.Sql/managedInstances"],
    metric: azurePercent("avg_cpu_percent"),
    threshold: CLOUD_CPU_HIGH_PERCENT,
    thresholdLabel: `at or above ${CLOUD_CPU_HIGH_PERCENT}%`,
    incidentDescription:
      "The managed instance's CPU stayed at 95% or more for 15 minutes. Query Store names the queries that use it; tune them, or add vCores.",
  }),
  sustainedAtOrAbove({
    id: "cloud-azure-flexible-server-high-memory",
    name: "High Memory",
    summary: "Memory stays at 95% or more for 15 minutes.",
    description: `Fires when every reading of memory_percent in the past 15 minutes is at or above 95%. ${READ_FROM_AZURE_MONITOR} ${ON_PAGE_TOO}`,
    category: "Utilization",
    provider: AZURE,
    resourceTypes: [
      "Microsoft.DBforPostgreSQL/flexibleServers",
      "Microsoft.DBforMySQL/flexibleServers",
    ],
    metric: azurePercent("memory_percent"),
    threshold: CLOUD_MEMORY_HIGH_PERCENT,
    thresholdLabel: `at or above ${CLOUD_MEMORY_HIGH_PERCENT}%`,
    incidentDescription:
      "The server used 95% or more of its memory for 15 minutes; past it, the engine swaps or is restarted. Look at its connections and its largest queries, or move to a size with more memory.",
  }),
  anyInWindow({
    id: "cloud-azure-postgresql-failed-connections",
    name: "Failed Connections",
    summary: "Connections to the server fail.",
    description: `Fires when connections_failed, totalled over the past 15 minutes, is 1 or more. ${READ_FROM_AZURE_MONITOR} ${ON_PAGE_TOO}`,
    category: "Errors",
    provider: AZURE,
    resourceTypes: ["Microsoft.DBforPostgreSQL/flexibleServers"],
    metrics: [azureCount("connections_failed")],
    thresholdLabel: "1 failed connection or more",
    incidentDescription:
      "Connections to the PostgreSQL server failed. A client with a wrong password or one the firewall does not let in fails every time: the server's logs name it. Failures during a restart or a failover clear by themselves.",
  }),
  anyInWindow({
    id: "cloud-azure-mysql-aborted-connections",
    name: "Connections Aborted",
    summary: "Attempts to connect to the server fail.",
    description: `Fires when aborted_connections, totalled over the past 15 minutes, is 1 or more: a client could not connect, for a wrong password, a database it may not use or a handshake that timed out. ${READ_FROM_AZURE_MONITOR} ${ON_PAGE_TOO}`,
    category: "Errors",
    provider: AZURE,
    resourceTypes: ["Microsoft.DBforMySQL/flexibleServers"],
    metrics: [azureCount("aborted_connections")],
    thresholdLabel: "1 aborted connection or more",
    incidentDescription:
      "Attempts to connect to the MySQL server were aborted. A client with a wrong password, or one connecting to a database it may not use, fails every time: the server's error log names it. Attempts that time out point at the network or at a server that is too busy.",
  }),
  sustainedAtOrAbove({
    id: "cloud-azure-cosmos-request-units",
    name: "Request Units at the Limit",
    summary: "Request units stay at their limit for 15 minutes.",
    description: `Fires when every reading of NormalizedRUConsumption in the past 15 minutes is at 100%: the account's busiest partition uses all its throughput, so its requests are throttled with 429s. ${READ_FROM_AZURE_MONITOR} ${ON_PAGE_TOO}`,
    category: "Throttling",
    provider: AZURE,
    resourceTypes: ["Microsoft.DocumentDB/databaseAccounts"],
    metric: azureMetric({
      metricName: "NormalizedRUConsumption",
      aggregation: "maximum",
      aggregationType: MetricsAggregationType.Max,
      legendUnit: "%",
    }),
    threshold: 100,
    thresholdLabel: "at 100%",
    incidentDescription:
      "A partition of the Cosmos DB account used all its request units for 15 minutes, so requests to it are throttled. Raise the throughput, turn on autoscale, or pick a partition key that spreads the load.",
  }),
  sustainedAtOrAbove({
    id: "cloud-azure-redis-server-load",
    name: "High Server Load",
    summary: "Server load stays at 90% or more for 15 minutes.",
    description: `Fires when every reading of serverLoad in the past 15 minutes is at or above 90%: the cache's threads are busy and its commands slow down. ${READ_FROM_AZURE_MONITOR} ${ON_PAGE_TOO}`,
    category: "Utilization",
    provider: AZURE,
    resourceTypes: ["Microsoft.Cache/redis"],
    metric: azurePercent("serverLoad", "maximum"),
    threshold: 90,
    thresholdLabel: "at or above 90%",
    incidentDescription:
      "The cache's server load stayed at 90% or more for 15 minutes, so its commands time out. Look for expensive commands, then scale it up or cluster it.",
  }),
  sustainedAtOrAbove({
    id: "cloud-azure-redis-high-memory",
    name: "High Memory",
    summary: "Memory stays at 95% or more for 15 minutes.",
    description: `Fires when every reading of usedmemorypercentage in the past 15 minutes is at or above 95%: the cache evicts keys, or refuses writes. ${READ_FROM_AZURE_MONITOR} ${ON_PAGE_TOO}`,
    category: "Utilization",
    provider: AZURE,
    resourceTypes: ["Microsoft.Cache/redis"],
    metric: azurePercent("usedmemorypercentage", "maximum"),
    threshold: CLOUD_MEMORY_HIGH_PERCENT,
    thresholdLabel: `at or above ${CLOUD_MEMORY_HIGH_PERCENT}%`,
    incidentDescription:
      "The cache used 95% or more of its memory for 15 minutes. Set expiries on what can expire, or scale it to a larger size.",
  }),
  sustainedBelow({
    id: "cloud-azure-availability-low",
    name: "Availability Low",
    summary: "Availability stays under 99.9% for 15 minutes.",
    description: `Fires when every reading of Availability in the past 15 minutes is under 99.9%: requests to the account or the vault fail for reasons of Azure's own. ${READ_FROM_AZURE_MONITOR} ${ON_PAGE_TOO}`,
    provider: AZURE,
    resourceTypes: [
      "Microsoft.Storage/storageAccounts",
      "Microsoft.KeyVault/vaults",
    ],
    metric: azurePercent("Availability"),
    threshold: CLOUD_AVAILABILITY_LOW_PERCENT,
    thresholdLabel: `under ${CLOUD_AVAILABILITY_LOW_PERCENT}%`,
    incidentDescription:
      "Requests failed for 15 minutes for reasons of Azure's own. Its Resource Health and Service Health in the Azure portal say whether Azure is working on it.",
  }),
  anyInWindow({
    id: "cloud-azure-messaging-dead-lettered",
    name: "Messages Dead-Lettered",
    summary: "A message is moved to a dead-letter queue.",
    description: `Fires when DeadletteredMessages (Average) is 1 or more at any reading in the past 15 minutes: a message could not be processed, or expired, and waits in a dead-letter queue until someone looks at it. ${READ_FROM_AZURE_MONITOR} ${ON_PAGE_TOO}`,
    category: "Backlog",
    provider: AZURE,
    resourceTypes: ["Microsoft.ServiceBus/namespaces"],
    metrics: [
      azureMetric({
        metricName: "DeadletteredMessages",
        aggregation: "average",
        aggregationType: MetricsAggregationType.Max,
      }),
    ],
    thresholdLabel: "1 dead-lettered message or more",
    incidentDescription:
      "Messages of the namespace sit in a dead-letter queue: a consumer could not process them, or they expired. Read the dead-letter reason on the messages, fix the cause, then resubmit or remove them.",
  }),
  anyInWindow({
    id: "cloud-azure-messaging-server-errors",
    name: "Server Errors",
    summary: "The namespace answers a request with a server error.",
    description: `Fires when ServerErrors, totalled over the past 15 minutes, is 1 or more. ${READ_FROM_AZURE_MONITOR} ${ON_PAGE_TOO}`,
    category: "Errors",
    provider: AZURE,
    resourceTypes: [
      "Microsoft.ServiceBus/namespaces",
      "Microsoft.EventHub/namespaces",
    ],
    metrics: [azureCount("ServerErrors")],
    thresholdLabel: "1 server error or more",
    incidentDescription:
      "The namespace answered requests with a server error of its own. Its Resource Health in the Azure portal says whether Azure saw a problem; clients should retry.",
  }),
  anyInWindow({
    id: "cloud-azure-messaging-throttled",
    name: "Requests Throttled",
    summary: "Requests to the namespace are throttled.",
    description: `Fires when ThrottledRequests, totalled over the past 15 minutes, is 1 or more: the namespace passed what its tier, units or partitions allow. ${READ_FROM_AZURE_MONITOR} ${ON_PAGE_TOO}`,
    category: "Throttling",
    provider: AZURE,
    resourceTypes: [
      "Microsoft.ServiceBus/namespaces",
      "Microsoft.EventHub/namespaces",
    ],
    metrics: [azureCount("ThrottledRequests")],
    thresholdLabel: "1 throttled request or more",
    incidentDescription:
      "Requests to the namespace were throttled. Add messaging or throughput units, turn on auto-inflate, or move to a higher tier.",
  }),
  anyInWindow({
    id: "cloud-azure-containerapp-restarts",
    name: "Replicas Restarting",
    summary: "A replica of the container app restarts.",
    description: `Fires when RestartCount, totalled over the past 15 minutes, is 1 or more: a replica crashed, or failed its health probes and was restarted. ${READ_FROM_AZURE_MONITOR} ${ON_PAGE_TOO}`,
    category: "Availability",
    provider: AZURE,
    resourceTypes: ["Microsoft.App/containerApps"],
    metrics: [azureCount("RestartCount")],
    thresholdLabel: "1 restart or more",
    incidentDescription:
      "A replica of the container app restarted. Its console and system logs say whether it crashed, ran out of memory or failed its health probes.",
  }),
  sustainedBelow({
    id: "cloud-azure-loadbalancer-data-path",
    name: "Data Path Availability Low",
    summary: "The load balancer's data path stays under 99.9% for 15 minutes.",
    description: `Fires when every reading of VipAvailability in the past 15 minutes is under 99.9%: Azure's probes through the load balancer's frontend fail. ${READ_FROM_AZURE_MONITOR} ${ON_PAGE_TOO}`,
    provider: AZURE,
    resourceTypes: ["Microsoft.Network/loadBalancers"],
    metric: azurePercent("VipAvailability"),
    threshold: CLOUD_AVAILABILITY_LOW_PERCENT,
    thresholdLabel: `under ${CLOUD_AVAILABILITY_LOW_PERCENT}%`,
    incidentDescription:
      "The load balancer's data path is not fully available: traffic through its frontend fails. Its Resource Health in the Azure portal says whether Azure saw a problem.",
  }),
  sustainedBelow({
    id: "cloud-azure-loadbalancer-health-probes",
    name: "Health Probes Failing",
    summary: "Backends fail their health probes for 15 minutes.",
    description: `Fires when every reading of DipAvailability in the past 15 minutes is under 100%: some of the load balancer's backends fail its health probe, and get no traffic. ${READ_FROM_AZURE_MONITOR} ${ON_PAGE_TOO}`,
    provider: AZURE,
    resourceTypes: ["Microsoft.Network/loadBalancers"],
    metric: azurePercent("DipAvailability"),
    threshold: 100,
    thresholdLabel: "under 100%",
    incidentDescription:
      "Backends of the load balancer failed its health probe for 15 minutes. Check that they answer on the probe's port and path, and that a network security group lets the probe in.",
  }),
  sustainedAtOrAbove({
    id: "cloud-azure-appgateway-unhealthy-hosts",
    name: "Unhealthy Hosts",
    summary: "A backend of the gateway is unhealthy for 15 minutes.",
    description: `Fires when every reading of UnhealthyHostCount in the past 15 minutes is 1 or more. ${READ_FROM_AZURE_MONITOR} ${ON_PAGE_TOO}`,
    category: "Availability",
    provider: AZURE,
    resourceTypes: ["Microsoft.Network/applicationGateways"],
    metric: azureMetric({
      metricName: "UnhealthyHostCount",
      aggregation: "average",
      aggregationType: MetricsAggregationType.Max,
    }),
    threshold: 1,
    thresholdLabel: "1 or more",
    incidentDescription:
      "A backend of the application gateway failed its health probe for 15 minutes and gets no traffic. The gateway's backend health in the Azure portal names it and the probe's answer.",
  }),
  failedShare({
    id: "cloud-azure-appgateway-failed-requests",
    name: "Failed Requests",
    summary: "5% or more of the gateway's requests fail in 15 minutes.",
    description: azureShareDescription("FailedRequests over TotalRequests"),
    provider: AZURE,
    resourceTypes: ["Microsoft.Network/applicationGateways"],
    failed: [azureCount("FailedRequests")],
    requests: azureCount("TotalRequests"),
    incidentDescription:
      "The application gateway failed 5% or more of its requests. Look at its backend health and its access logs for the status codes it returned.",
  }),
  breakage({
    id: "cloud-azure-public-ip-ddos",
    name: "Under DDoS Attack",
    summary: "Azure reports the public IP address under a DDoS attack.",
    description: `Fires on the first reading of IfUnderDDoSAttack at 1: Azure DDoS Protection detected an attack on the address and mitigates it. Clears once 15 minutes pass without one. ${READ_FROM_AZURE_MONITOR} ${ON_PAGE_TOO}`,
    provider: AZURE,
    resourceTypes: ["Microsoft.Network/publicIPAddresses"],
    metric: azureMetric({
      metricName: "IfUnderDDoSAttack",
      aggregation: "maximum",
      aggregationType: MetricsAggregationType.Max,
    }),
    thresholdLabel: "at 1",
    incidentDescription:
      "Azure DDoS Protection reports the public IP address under attack and mitigates it. Its mitigation reports and flow logs show the traffic; check that the services behind it still answer.",
  }),
  sustainedBelow({
    id: "cloud-azure-firewall-health",
    name: "Firewall Health Degraded",
    summary: "The firewall's health stays under 100% for 15 minutes.",
    description: `Fires when every reading of FirewallHealth in the past 15 minutes is under 100%. ${READ_FROM_AZURE_MONITOR} ${ON_PAGE_TOO}`,
    provider: AZURE,
    resourceTypes: ["Microsoft.Network/azureFirewalls"],
    metric: azurePercent("FirewallHealth"),
    threshold: 100,
    thresholdLabel: "under 100%",
    incidentDescription:
      "The Azure Firewall reports itself less than fully healthy, usually because it runs out of SNAT ports. Its health status reason in the Azure portal names the cause; add public IP addresses or a NAT gateway.",
  }),
  sustainedAtOrAbove({
    id: "cloud-azure-firewall-snat-ports",
    name: "SNAT Ports Running Out",
    summary: "SNAT port use stays at 95% or more for 15 minutes.",
    description: `Fires when every reading of SNATPortUtilization in the past 15 minutes is at or above 95%. ${READ_FROM_AZURE_MONITOR} ${ON_PAGE_TOO}`,
    category: "Utilization",
    provider: AZURE,
    resourceTypes: ["Microsoft.Network/azureFirewalls"],
    metric: azurePercent("SNATPortUtilization"),
    threshold: 95,
    thresholdLabel: "at or above 95%",
    incidentDescription:
      "The firewall used 95% or more of its SNAT ports for 15 minutes; past it, outbound connections fail. Add public IP addresses to it, or put a NAT gateway on its subnet.",
  }),
  sustainedBelow({
    id: "cloud-azure-nat-gateway-data-path",
    name: "Data Path Availability Low",
    summary: "The NAT gateway's data path stays under 99.9% for 15 minutes.",
    description: `Fires when every reading of DatapathAvailability in the past 15 minutes is under 99.9%. ${READ_FROM_AZURE_MONITOR} ${ON_PAGE_TOO}`,
    provider: AZURE,
    resourceTypes: ["Microsoft.Network/natGateways"],
    metric: azurePercent("DatapathAvailability"),
    threshold: CLOUD_AVAILABILITY_LOW_PERCENT,
    thresholdLabel: `under ${CLOUD_AVAILABILITY_LOW_PERCENT}%`,
    incidentDescription:
      "The NAT gateway's data path is not fully available, so outbound connections from its subnets fail. Its Resource Health in the Azure portal says whether Azure saw a problem.",
  }),
  sustainedAtOrAbove({
    id: "cloud-azure-cdn-server-errors",
    name: "Server Errors",
    summary: "5% or more of requests fail with a 5xx error for 15 minutes.",
    description: `Fires when every reading of Percentage5XX in the past 15 minutes is at or above 5%. ${READ_FROM_AZURE_MONITOR} ${ON_PAGE_TOO}`,
    category: "Errors",
    provider: AZURE,
    resourceTypes: ["Microsoft.Cdn/profiles"],
    metric: azurePercent("Percentage5XX"),
    threshold: CLOUD_FAILED_SHARE_WARNING_PERCENT,
    thresholdLabel: `at or above ${CLOUD_FAILED_SHARE_WARNING_PERCENT}%`,
    incidentDescription:
      "The profile answered 5% or more of its requests with a server error for 15 minutes. Look at its origins: whether they answer, how fast, and what changed on them.",
  }),
  sustainedAtOrAbove({
    id: "cloud-azure-apim-capacity",
    name: "Capacity High",
    summary: "The gateway's capacity stays at 90% or more for 15 minutes.",
    description: `Fires when every reading of Capacity in the past 15 minutes is at or above 90%. ${READ_FROM_AZURE_MONITOR} ${ON_PAGE_TOO}`,
    category: "Utilization",
    provider: AZURE,
    resourceTypes: ["Microsoft.ApiManagement/service"],
    metric: azurePercent("Capacity"),
    threshold: 90,
    thresholdLabel: "at or above 90%",
    incidentDescription:
      "The API Management gateway used 90% or more of its capacity for 15 minutes, so its requests slow down. Add units, or turn on autoscale.",
  }),
  failedShare({
    id: "cloud-azure-ai-services-errors",
    name: "Errors",
    summary: "5% or more of the calls fail in 15 minutes.",
    description: azureShareDescription("TotalErrors over TotalCalls"),
    provider: AZURE,
    resourceTypes: ["Microsoft.CognitiveServices/accounts"],
    failed: [azureCount("TotalErrors")],
    requests: azureCount("TotalCalls"),
    incidentDescription:
      "5% or more of the calls to the account failed: refused by its rate limits, or failed on Azure's side. Its metrics split by status code say which.",
  }),
  anyInWindow({
    id: "cloud-azure-logic-runs-failed",
    name: "Runs Failed",
    summary: "A run of the logic app fails.",
    description: `Fires when RunsFailed, totalled over the past 15 minutes, is 1 or more. ${READ_FROM_AZURE_MONITOR} ${ON_PAGE_TOO}`,
    category: "Errors",
    provider: AZURE,
    resourceTypes: ["Microsoft.Logic/workflows"],
    metrics: [azureCount("RunsFailed")],
    thresholdLabel: "1 failed run or more",
    incidentDescription:
      "A run of the logic app failed. Its run history in the Azure portal names the action that failed and the error it returned.",
  }),
  anyInWindow({
    id: "cloud-azure-data-factory-runs-failed",
    name: "Pipeline Runs Failed",
    summary: "A pipeline run of the data factory fails.",
    description: `Fires when PipelineFailedRuns, totalled over the past 15 minutes, is 1 or more. ${READ_FROM_AZURE_MONITOR} ${ON_PAGE_TOO}`,
    category: "Errors",
    provider: AZURE,
    resourceTypes: ["Microsoft.DataFactory/factories"],
    metrics: [azureCount("PipelineFailedRuns")],
    thresholdLabel: "1 failed run or more",
    incidentDescription:
      "A pipeline run of the data factory failed. Its monitoring in Data Factory Studio names the activity that failed and the error it raised.",
  }),
];

/*
 * ---------------------------------------------------------------------------
 * Google Cloud
 * ---------------------------------------------------------------------------
 */

const GCP_TEMPLATES: Array<CloudAlertTemplate> = [
  gcpPercentAtOrAbove({
    id: "cloud-gcp-compute-high-cpu",
    name: "High CPU",
    summary: "CPU stays at 90% or more for 15 minutes.",
    description: `Fires when every reading of compute.googleapis.com/instance/cpu/utilization (0 to 1, made a percent) in the past 15 minutes is at or above 90%. A busy VM is often doing its work: this says it has no headroom left. ${READ_FROM_CLOUD_MONITORING}`,
    category: "Utilization",
    resourceTypes: ["gce_instance"],
    metricType: "compute.googleapis.com/instance/cpu/utilization",
    threshold: CLOUD_COMPUTE_CPU_HIGH_PERCENT,
    thresholdLabel: `at or above ${CLOUD_COMPUTE_CPU_HIGH_PERCENT}%`,
    incidentDescription:
      "The VM's CPU stayed at 90% or more for 15 minutes. Look for a process that runs away or for traffic that grew, then add VMs to its group or move it to a larger machine type.",
  }),
  gcpPercentAtOrAbove({
    id: "cloud-gcp-cloudsql-disk-full",
    name: "Disk Nearly Full",
    summary: "Disk use stays at 90% or more for 15 minutes.",
    description: `Fires when every reading of cloudsql.googleapis.com/database/disk/utilization (0 to 1, made a percent) in the past 15 minutes is at or above 90%. ${READ_FROM_CLOUD_MONITORING} ${ON_PAGE_TOO}`,
    category: "Storage",
    resourceTypes: ["cloudsql_database"],
    metricType: "cloudsql.googleapis.com/database/disk/utilization",
    threshold: CLOUD_STORAGE_HIGH_PERCENT,
    thresholdLabel: `at or above ${CLOUD_STORAGE_HIGH_PERCENT}%`,
    incidentDescription:
      "The Cloud SQL instance's disk is 90% full or more; a full disk takes it offline. Turn on automatic storage increases, or raise its storage, and look for what grew.",
  }),
  gcpPercentAtOrAbove({
    id: "cloud-gcp-cloudsql-high-cpu",
    name: "High CPU",
    summary: "CPU stays at 95% or more for 15 minutes.",
    description: `Fires when every reading of cloudsql.googleapis.com/database/cpu/utilization (0 to 1, made a percent) in the past 15 minutes is at or above 95%. ${READ_FROM_CLOUD_MONITORING} ${ON_PAGE_TOO}`,
    category: "Utilization",
    resourceTypes: ["cloudsql_database"],
    metricType: "cloudsql.googleapis.com/database/cpu/utilization",
    threshold: CLOUD_CPU_HIGH_PERCENT,
    thresholdLabel: `at or above ${CLOUD_CPU_HIGH_PERCENT}%`,
    incidentDescription:
      "The Cloud SQL instance's CPU stayed at 95% or more for 15 minutes. Query Insights names the queries that use it; add an index, or give it more vCPUs.",
  }),
  gcpPercentAtOrAbove({
    id: "cloud-gcp-cloudsql-high-memory",
    name: "High Memory",
    summary: "Memory stays at 95% or more for 15 minutes.",
    description: `Fires when every reading of cloudsql.googleapis.com/database/memory/utilization (0 to 1, made a percent) in the past 15 minutes is at or above 95%. ${READ_FROM_CLOUD_MONITORING} ${ON_PAGE_TOO}`,
    category: "Utilization",
    resourceTypes: ["cloudsql_database"],
    metricType: "cloudsql.googleapis.com/database/memory/utilization",
    threshold: CLOUD_MEMORY_HIGH_PERCENT,
    thresholdLabel: `at or above ${CLOUD_MEMORY_HIGH_PERCENT}%`,
    incidentDescription:
      "The Cloud SQL instance used 95% or more of its memory for 15 minutes; past it, the database engine is restarted. Look at its connections and its largest queries, or give it more memory.",
  }),
  sustainedAtOrAbove({
    id: "cloud-gcp-lb-slow-responses",
    name: "Slow Responses",
    summary: "The 95th percentile of responses takes a second or more.",
    description: `Fires when every reading of loadbalancing.googleapis.com/https/total_latencies (the 95th percentile, in milliseconds) in the past 15 minutes is 1,000 milliseconds or more. ${READ_FROM_CLOUD_MONITORING}`,
    category: "Latency",
    provider: CloudProvider.GCP,
    resourceTypes: ["https_lb_rule"],
    metric: gcpMetric({
      metricType: "loadbalancing.googleapis.com/https/total_latencies",
      aggregationType: MetricsAggregationType.Max,
      legendUnit: "ms",
    }),
    threshold: CLOUD_SLOW_RESPONSE_SECONDS * 1000,
    thresholdLabel: "1,000 milliseconds or more",
    incidentDescription:
      "One response in twenty through the load balancer took a second or more, for 15 minutes. Look at its backends: their health, their CPU and what changed on them.",
  }),
  ageAtOrAbove({
    id: "cloud-gcp-pubsub-oldest-message",
    name: "Oldest Message Waiting",
    summary: "The subscription's oldest message waits an hour or more.",
    description: `Fires on the first reading of pubsub.googleapis.com/subscription/oldest_unacked_message_age at 3600 seconds or more: nothing acknowledged a message for an hour, or subscribers fall behind. ${READ_FROM_CLOUD_MONITORING} ${ON_PAGE_TOO}`,
    provider: CloudProvider.GCP,
    resourceTypes: ["pubsub_subscription"],
    metric: gcpMetric({
      metricType:
        "pubsub.googleapis.com/subscription/oldest_unacked_message_age",
      aggregationType: MetricsAggregationType.Max,
      legendUnit: "s",
    }),
    threshold: CLOUD_BACKLOG_AGE_SECONDS,
    incidentDescription:
      "A message has waited on the subscription for an hour or more without being acknowledged. Check that its subscribers run and keep up, and give it a dead-letter topic for messages that fail every time.",
  }),
  gcpPercentAtOrAbove({
    id: "cloud-gcp-redis-high-memory",
    name: "High Memory",
    summary: "Memory stays at 95% or more for 15 minutes.",
    description: `Fires when every reading of redis.googleapis.com/stats/memory/usage_ratio (0 to 1, made a percent) in the past 15 minutes is at or above 95%. ${READ_FROM_CLOUD_MONITORING} ${ON_PAGE_TOO}`,
    category: "Utilization",
    resourceTypes: ["redis_instance"],
    metricType: "redis.googleapis.com/stats/memory/usage_ratio",
    threshold: CLOUD_MEMORY_HIGH_PERCENT,
    thresholdLabel: `at or above ${CLOUD_MEMORY_HIGH_PERCENT}%`,
    incidentDescription:
      "The Memorystore instance used 95% or more of its memory for 15 minutes: it evicts keys, or refuses writes. Set expiries on what can expire, or scale it up.",
  }),
  gcpPercentAtOrAbove({
    id: "cloud-gcp-spanner-high-cpu",
    name: "High CPU",
    summary: "CPU stays at 90% or more for 15 minutes.",
    description: `Fires when every reading of spanner.googleapis.com/instance/cpu/utilization (0 to 1, made a percent) in the past 15 minutes is at or above 90%. ${READ_FROM_CLOUD_MONITORING} ${ON_PAGE_TOO}`,
    category: "Utilization",
    resourceTypes: ["spanner_instance"],
    metricType: "spanner.googleapis.com/instance/cpu/utilization",
    threshold: 90,
    thresholdLabel: "at or above 90%",
    incidentDescription:
      "The Spanner instance's CPU stayed at 90% or more for 15 minutes, so its transactions slow down. Add compute capacity, or turn on autoscaling.",
  }),
];

const CLOUD_ALERT_TEMPLATES: ReadonlyArray<CloudAlertTemplate> = [
  ...AWS_TEMPLATES,
  ...AZURE_TEMPLATES,
  ...GCP_TEMPLATES,
];

/*
 * ---------------------------------------------------------------------------
 * Looking templates up
 * ---------------------------------------------------------------------------
 */

export function getAllCloudAlertTemplates(): Array<CloudAlertTemplate> {
  return [...CLOUD_ALERT_TEMPLATES];
}

export function getCloudAlertTemplate(
  id: string,
): CloudAlertTemplate | undefined {
  return CLOUD_ALERT_TEMPLATES.find((template: CloudAlertTemplate): boolean => {
    return template.id === id;
  });
}

function isTypeOf(
  template: CloudAlertTemplate,
  data: {
    provider: string;
    resourceType: string;
  },
): boolean {
  if (template.provider !== data.provider) {
    return false;
  }

  const wanted: string = data.resourceType.trim().toLowerCase();

  return template.resourceTypes.some((type: string): boolean => {
    return type.toLowerCase() === wanted;
  });
}

// Every template of a cloud and resource type, whatever the resource knows.
export function getCloudAlertTemplatesForType(data: {
  provider: string | null | undefined;
  resourceType: string | null | undefined;
}): Array<CloudAlertTemplate> {
  const provider: string = (data.provider || "").trim().toLowerCase();
  const resourceType: string = (data.resourceType || "").trim();

  if (!provider || !resourceType) {
    return [];
  }

  return CLOUD_ALERT_TEMPLATES.filter((template: CloudAlertTemplate) => {
    return isTypeOf(template, { provider, resourceType });
  });
}

// The attributes that select a resource's metrics, or none: only text values.
export function readCloudTelemetryAttributes(
  value: unknown,
): Dictionary<string> {
  const attributes: Dictionary<string> = {};

  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return attributes;
  }

  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
    if (key && typeof raw === "string" && raw.trim()) {
      attributes[key] = raw;
    }
  }

  return attributes;
}

// An RDS instance's allocated storage in GiB, from its inventory, or null.
export function readAllocatedStorageGiB(properties: unknown): number | null {
  if (!properties || typeof properties !== "object") {
    return null;
  }

  const raw: unknown = (properties as Record<string, unknown>)[
    CLOUD_ALLOCATED_STORAGE_PROPERTY
  ];

  if (raw === null || raw === undefined || raw === "") {
    return null;
  }

  const value: number = Number(raw);

  return Number.isFinite(value) && value > 0 ? value : null;
}

/*
 * The templates that apply to ONE resource: its cloud's and its type's, once
 * its metrics' attributes are recorded - and, for an AWS type read from
 * more than one CloudWatch namespace (an ALB and an NLB are one type), the
 * ones of the namespace its metrics come from. An RDS instance's storage
 * template waits for the inventory to list its allocated storage, and its
 * connections template for a connection limit (RdsConnectionLimits).
 */
export function getCloudAlertTemplatesFor(
  context: CloudAlertTemplateContext,
): Array<CloudAlertTemplate> {
  const attributes: Dictionary<string> = readCloudTelemetryAttributes(
    context.telemetryAttributes,
  );

  if (Object.keys(attributes).length === 0) {
    return [];
  }

  const namespace: string = (
    attributes[AWS_CLOUDWATCH_NAMESPACE_ATTRIBUTE] || ""
  ).toLowerCase();

  return getCloudAlertTemplatesForType({
    provider: context.provider,
    resourceType: context.resourceType,
  }).filter((template: CloudAlertTemplate): boolean => {
    if (template.provider === CloudProvider.AWS) {
      const reads: boolean = template.queries.every(
        (query: CloudAlertQuery): boolean => {
          return (query.metric.namespace || "").toLowerCase() === namespace;
        },
      );

      if (!reads) {
        return false;
      }
    }

    if (template.requiresAllocatedStorage) {
      const allocated: number = Number(context.allocatedStorageGiB);

      if (!(Number.isFinite(allocated) && allocated > 0)) {
        return false;
      }
    }

    if (
      template.requiresConnectionLimit &&
      readConnectionLimit(context.connectionLimit) === null
    ) {
      return false;
    }

    if (
      template.provider === CloudProvider.Azure &&
      (context.isReadByConnection || template.requiresReading) &&
      !template.queries.every((query: CloudAlertQuery): boolean => {
        return hasStoredNameReading({
          metric: query.metric,
          readings: context.readings,
          needsName: context.isReadByConnection === true,
        });
      })
    ) {
      return false;
    }

    return true;
  });
}

/*
 * Whether a resource's readings hold one of the metric: with the name it is
 * stored under, when the read decides that name (an Azure metric read by a
 * connection). A reading written before readings kept their names has
 * none: the template waits for the next read.
 */
function hasStoredNameReading(data: {
  metric: CloudAlertMetric;
  readings?: CloudResourceReadings | null | undefined;
  needsName: boolean;
}): boolean {
  const key: string | null = getCloudAlertMetricReadingKey(data.metric);
  const reading: CloudResourceReadings[string] | undefined = key
    ? data.readings?.[key]
    : undefined;

  if (!reading) {
    return false;
  }

  return !data.needsName || Boolean(reading.metric && reading.metric.trim());
}

/*
 * The readings a read keeps of a resource of this type so its templates
 * read the right names: every metric an Azure template of the type reads
 * (an AWS or Google Cloud metric's name is fixed, and needs none). Keys as
 * getCloudReadingKey makes them.
 */
export function getCloudAlertTemplateReadingKeys(data: {
  provider: string | null | undefined;
  resourceType: string | null | undefined;
}): ReadonlySet<string> {
  return (
    getReadingKeysByType().get(
      `${(data.provider || "").trim().toLowerCase()}|${(data.resourceType || "")
        .trim()
        .toLowerCase()}`,
    ) || NO_READING_KEYS
  );
}

const NO_READING_KEYS: ReadonlySet<string> = new Set<string>();

let readingKeysByType: Map<string, Set<string>> | null = null;

// Built once: a read asks it for every datapoint it writes.
function getReadingKeysByType(): Map<string, Set<string>> {
  if (readingKeysByType) {
    return readingKeysByType;
  }

  const byType: Map<string, Set<string>> = new Map<string, Set<string>>();

  for (const template of CLOUD_ALERT_TEMPLATES) {
    if (template.provider !== CloudProvider.Azure) {
      continue;
    }

    for (const type of template.resourceTypes) {
      const typeKey: string = `${template.provider}|${type.toLowerCase()}`;
      const keys: Set<string> = byType.get(typeKey) || new Set<string>();

      for (const query of template.queries) {
        const key: string | null = getCloudAlertMetricReadingKey(query.metric);

        if (key) {
          keys.add(key);
        }
      }

      byType.set(typeKey, keys);
    }
  }

  readingKeysByType = byType;

  return byType;
}

// The resource types some template is for, of one cloud or every cloud.
export function getCloudResourceTypesWithAlertTemplates(
  provider?: string | undefined,
): Array<string> {
  const types: Array<string> = [];

  for (const template of CLOUD_ALERT_TEMPLATES) {
    if (provider && template.provider !== provider) {
      continue;
    }

    for (const type of template.resourceTypes) {
      if (!types.includes(type)) {
        types.push(type);
      }
    }
  }

  return types;
}
