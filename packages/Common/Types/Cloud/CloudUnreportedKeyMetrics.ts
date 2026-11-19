import { translationKey } from "../Translator";
import { CloudProvider } from "./CloudPlatform";
import {
  AWS_CLOUDWATCH_RESOURCE_RULES,
  AwsCloudWatchResourceRule,
} from "./CloudResourceCatalog";
import {
  AWS_DEFAULT_PERIOD_SECONDS,
  AZURE_FIVE_MINUTE_GRAIN,
  AZURE_FIVE_MINUTE_READ_MINUTES,
  AwsKeyMetric,
  AwsNamespaceKeyMetrics,
  AzureKeyMetric,
  GCP_KEY_METRICS,
  GcpKeyMetric,
  GcpTypeKeyMetrics,
  getAwsKeyMetrics,
  getAwsStoredMetricName,
  getAzureKeyMetricOfStoredName,
  getAzureKeyMetrics,
  getAzureStoredMetricName,
  getGcpStoredMetricName,
  parseAwsStoredMetricName,
} from "./CloudKeyMetrics";
import {
  CloudKeyMetricGroup,
  getCloudKeyMetricGroupOrder,
} from "./CloudKeyMetricGroup";
import {
  CLOUD_KEY_METRIC_CONDITION_REASONS,
  CloudKeyMetricCondition,
} from "./CloudKeyMetricCondition";

/*
 * THE KEY METRICS A CLOUD RESOURCE DID NOT REPORT, AND WHY.
 *
 * A resource's Overview and Metrics tab list its key metrics in sections
 * (CloudKeyMetricGroup). A key metric the resource did not report in the
 * list's range used to be simply absent, so a person could not tell "this
 * does not apply to it" from "OneUptime is not reading it" (#9569). Each
 * section now counts the key metrics of the resource's type it did not
 * report, folded away; opened, each says since when - or that it never
 * did - and the likely reason, with what fixes it where something does.
 *
 *   - getCloudKeyMetricsOfResource: the key metrics a resource of a type
 *     reports, in their sections' order. An AWS resource's are its
 *     namespace's (an Application or a Network Load Balancer's), less those
 *     only other types of the namespace report (AwsKeyMetric.onlyTypes).
 *   - getCloudUnreportedKeyMetrics: those none of the reported names is.
 *   - explainCloudUnreportedKeyMetric: why, most likely first, from the
 *     catalog (a condition, an agent, how often it comes) and from what
 *     the server knows of the resource (its Azure metric definitions, its
 *     connection's stream and its last read).
 */

export interface CloudResourceKeyMetric {
  /*
   * Tells it from the resource's other key metrics, in lower case: an AWS
   * metric by its namespace and name ("aws/ec2|cpuutilization"), an Azure
   * one by its name, a Google Cloud one by the name it is stored under.
   */
  key: string;
  // The cloud's own name for it: "Percentage CPU", "CPUUtilization", a metric type.
  name: string;
  // AWS: the CloudWatch namespace it is published in.
  namespace?: string | undefined;
  group: CloudKeyMetricGroup;
  // Its place among its type's (or namespace's) key metrics.
  rank: number;
  // Only some resources of the type report it, and this is when.
  onlyWhen?: CloudKeyMetricCondition | undefined;
  /*
   * The seconds between two of its points, where they are further apart
   * than the read's: an Azure metric kept at five minutes (300), an AWS
   * metric published a few times a day (3600) or once a day (86400).
   */
  intervalSeconds?: number | undefined;
  // How often it is read, where that is not every read: every 15 minutes.
  readEverySeconds?: number | undefined;
  // Who reports it when the cloud does not itself: the Ops Agent on a VM.
  reportedBy?: string | undefined;
  /*
   * The names it may be stored under, in lower case (as ingest stores
   * them): an Azure metric's with each aggregation it may be read with.
   */
  storedNames: Array<string>;
}

// The aggregations an Azure metric may be read, and so stored, with.
const AZURE_AGGREGATIONS: ReadonlyArray<string> = [
  "average",
  "total",
  "maximum",
  "minimum",
  "count",
];

function awsKeyOf(namespace: string, metricName: string): string {
  return `${namespace.trim().toLowerCase()}|${metricName.trim().toLowerCase()}`;
}

// The namespaces a resource of an AWS type is read from, with key metrics.
function getAwsNamespacesOfType(type: string): Array<AwsNamespaceKeyMetrics> {
  const wanted: string = type.trim().toLowerCase();
  const namespaces: Array<AwsNamespaceKeyMetrics> = [];

  for (const rule of AWS_CLOUDWATCH_RESOURCE_RULES as ReadonlyArray<AwsCloudWatchResourceRule>) {
    const entry: AwsNamespaceKeyMetrics | undefined = getAwsKeyMetrics(
      rule.namespace,
    );

    if (
      entry &&
      rule.type.toLowerCase() === wanted &&
      !namespaces.includes(entry)
    ) {
      namespaces.push(entry);
    }
  }

  return namespaces;
}

function isAwsMetricOfType(metric: AwsKeyMetric, type: string): boolean {
  const wanted: string = type.trim().toLowerCase();

  return (
    !wanted ||
    !metric.onlyTypes ||
    metric.onlyTypes.some((onlyType: string): boolean => {
      return onlyType.toLowerCase() === wanted;
    })
  );
}

function getAwsKeyMetricsOfResource(data: {
  type: string;
  namespace: string;
}): Array<CloudResourceKeyMetric> {
  const own: AwsNamespaceKeyMetrics | undefined = data.namespace
    ? getAwsKeyMetrics(data.namespace)
    : undefined;
  const namespaces: Array<AwsNamespaceKeyMetrics> = own
    ? [own]
    : getAwsNamespacesOfType(data.type);
  const metrics: Array<CloudResourceKeyMetric> = [];

  for (const entry of namespaces) {
    entry.metrics.forEach((metric: AwsKeyMetric, rank: number) => {
      if (!isAwsMetricOfType(metric, data.type)) {
        return;
      }

      metrics.push({
        key: awsKeyOf(entry.namespace, metric.metricName),
        name: metric.metricName,
        namespace: entry.namespace,
        group: metric.group,
        rank,
        ...(metric.onlyWhen ? { onlyWhen: metric.onlyWhen } : {}),
        ...(metric.periodSeconds > AWS_DEFAULT_PERIOD_SECONDS
          ? { intervalSeconds: metric.periodSeconds }
          : {}),
        storedNames: [
          getAwsStoredMetricName(
            entry.namespace,
            metric.metricName,
          ).toLowerCase(),
        ],
      });
    });
  }

  return metrics;
}

function getAzureKeyMetricsOfResource(
  type: string,
): Array<CloudResourceKeyMetric> {
  return (getAzureKeyMetrics(type)?.metrics || []).map(
    (metric: AzureKeyMetric, rank: number): CloudResourceKeyMetric => {
      const isFiveMinutes: boolean = metric.grain === AZURE_FIVE_MINUTE_GRAIN;

      return {
        key: metric.name.toLowerCase(),
        name: metric.name,
        group: metric.group,
        rank,
        ...(metric.onlyWhen ? { onlyWhen: metric.onlyWhen } : {}),
        ...(isFiveMinutes
          ? {
              intervalSeconds: 300,
              readEverySeconds: AZURE_FIVE_MINUTE_READ_MINUTES * 60,
            }
          : {}),
        storedNames: AZURE_AGGREGATIONS.map((aggregation: string): string => {
          return getAzureStoredMetricName(metric.name, aggregation);
        }),
      };
    },
  );
}

function getGcpKeyMetricsOfResource(
  type: string,
): Array<CloudResourceKeyMetric> {
  const wanted: string = type.trim().toLowerCase();
  const entry: GcpTypeKeyMetrics | undefined = GCP_KEY_METRICS.find(
    (candidate: GcpTypeKeyMetrics): boolean => {
      return candidate.resourceType.toLowerCase() === wanted;
    },
  );

  return (entry?.metrics || []).map(
    (metric: GcpKeyMetric, rank: number): CloudResourceKeyMetric => {
      const stored: string = getGcpStoredMetricName(metric);

      return {
        key: stored.toLowerCase(),
        name: stored,
        group: metric.group,
        rank,
        ...(metric.onlyWhen ? { onlyWhen: metric.onlyWhen } : {}),
        ...(metric.reportedBy ? { reportedBy: metric.reportedBy } : {}),
        storedNames: [stored.toLowerCase()],
      };
    },
  );
}

/*
 * The key metrics a resource of this provider and type reports, by their
 * sections' order and then their place in the type. `namespace` is an AWS
 * resource's CloudWatch namespace, from its telemetry attributes: an
 * Elastic Load Balancing v2 load balancer is an Application or a Network
 * one, and reports only that namespace's. Without it, every namespace its
 * type is read from.
 */
export function getCloudKeyMetricsOfResource(data: {
  provider: string | null | undefined;
  type: string | null | undefined;
  namespace?: string | null | undefined;
}): Array<CloudResourceKeyMetric> {
  const type: string = (data.type || "").trim();
  let metrics: Array<CloudResourceKeyMetric> = [];

  switch ((data.provider || "").trim().toLowerCase()) {
    case CloudProvider.AWS:
      metrics = getAwsKeyMetricsOfResource({
        type,
        namespace: (data.namespace || "").trim(),
      });
      break;
    case CloudProvider.Azure:
      metrics = getAzureKeyMetricsOfResource(type);
      break;
    case CloudProvider.GCP:
      metrics = getGcpKeyMetricsOfResource(type);
      break;
    default:
      metrics = [];
  }

  return metrics.sort(
    (a: CloudResourceKeyMetric, b: CloudResourceKeyMetric): number => {
      const byGroup: number =
        getCloudKeyMetricGroupOrder(a.group) -
        getCloudKeyMetricGroupOrder(b.group);

      return byGroup !== 0 ? byGroup : a.rank - b.rank;
    },
  );
}

/*
 * The key (CloudResourceKeyMetric.key) of the key metric a stored metric
 * name is, for a resource of this provider and type, whatever its case or
 * the aggregation it was read with; null for any other name.
 */
export function getCloudKeyMetricKeyOfStoredName(data: {
  provider: string | null | undefined;
  type: string | null | undefined;
  metricName: string | null | undefined;
}): string | null {
  const metricName: string = (data.metricName || "").trim();

  if (!metricName) {
    return null;
  }

  switch ((data.provider || "").trim().toLowerCase()) {
    case CloudProvider.AWS: {
      const parsed: { namespace: string; metricName: string } | null =
        parseAwsStoredMetricName(metricName);
      const entry: AwsNamespaceKeyMetrics | undefined = parsed
        ? getAwsKeyMetrics(parsed.namespace)
        : undefined;
      const metric: AwsKeyMetric | undefined = entry?.metrics.find(
        (candidate: AwsKeyMetric): boolean => {
          return (
            candidate.metricName.toLowerCase() ===
            parsed!.metricName.toLowerCase()
          );
        },
      );

      return entry && metric
        ? awsKeyOf(entry.namespace, metric.metricName)
        : null;
    }
    case CloudProvider.Azure: {
      const name: string | null = getAzureKeyMetricOfStoredName(
        data.type || "",
        metricName,
      );

      return name ? name.toLowerCase() : null;
    }
    case CloudProvider.GCP: {
      const wanted: string = metricName.toLowerCase();

      return GCP_KEY_METRICS.some((entry: GcpTypeKeyMetrics): boolean => {
        return entry.metrics.some((metric: GcpKeyMetric): boolean => {
          return getGcpStoredMetricName(metric).toLowerCase() === wanted;
        });
      })
        ? wanted
        : null;
    }
    default:
      return null;
  }
}

/*
 * The resource's key metrics none of `reportedMetricNames` is (the names
 * its metrics list found in its range), in their sections' order.
 */
export function getCloudUnreportedKeyMetrics(data: {
  provider: string | null | undefined;
  type: string | null | undefined;
  namespace?: string | null | undefined;
  reportedMetricNames: ReadonlyArray<string>;
}): Array<CloudResourceKeyMetric> {
  const reported: Set<string> = new Set<string>();

  for (const metricName of data.reportedMetricNames) {
    const key: string | null = getCloudKeyMetricKeyOfStoredName({
      provider: data.provider,
      type: data.type,
      metricName,
    });

    if (key) {
      reported.add(key);
    }
  }

  return getCloudKeyMetricsOfResource(data).filter(
    (metric: CloudResourceKeyMetric): boolean => {
      return !reported.has(metric.key);
    },
  );
}

/*
 * ---- Why -----------------------------------------------------------------
 */

export enum CloudUnreportedReason {
  // No cloud connection reads the resource: a collector sent its metrics.
  NoConnection = "no-connection",
  ConnectionOff = "connection-off",
  // The connection may not read it: its last read was refused.
  NoPermission = "no-permission",
  // The connection's last read failed, or could not read this metric.
  ReadFailed = "read-failed",
  // Azure: this resource's own metric definitions do not list it.
  NotPublished = "not-published",
  // Only an agent on the resource reports it: the Ops Agent on a VM.
  NeedsAgent = "needs-agent",
  // The catalog's condition (CloudKeyMetricCondition).
  Condition = "condition",
  /*
   * Azure: the metric definitions of the resources of its type OneUptime
   * read do not list it: this one likely does not publish it either.
   */
  NotPublishedByType = "not-published-by-type",
  // The connection's stream sends it in place of the read, and none came.
  Streamed = "streamed",
  // It comes less often than the list's range may hold.
  Cadence = "cadence",
}

// Where a reason's fix is: Cloud > Connect, or the Ops Agent's install guide.
export type CloudUnreportedFix = "cloud-connect" | "ops-agent";

export interface CloudUnreportedReasonEntry {
  reason: CloudUnreportedReason;
  // CloudUnreportedReason.Condition's condition.
  condition?: CloudKeyMetricCondition | undefined;
  // CloudUnreportedReason.Cadence's: the metric's interval and read cadence.
  intervalSeconds?: number | undefined;
  readEverySeconds?: number | undefined;
  fix?: CloudUnreportedFix | undefined;
}

/*
 * Each reason in English, a key of the Dashboard's locale files - but a
 * condition's and a cadence's, which say more (getCloudUnreportedReasonText).
 */
export const CLOUD_UNREPORTED_REASON_SENTENCES: Readonly<
  Record<
    Exclude<
      CloudUnreportedReason,
      CloudUnreportedReason.Condition | CloudUnreportedReason.Cadence
    >,
    string
  >
> = {
  [CloudUnreportedReason.NoConnection]: translationKey(
    "No cloud connection reads this resource, so OneUptime reads none of its key metrics.",
  ),
  [CloudUnreportedReason.ConnectionOff]: translationKey(
    "Its cloud connection is turned off.",
  ),
  [CloudUnreportedReason.NoPermission]: translationKey(
    "Its cloud connection was refused when it last read the account: it may be missing a permission.",
  ),
  [CloudUnreportedReason.ReadFailed]: translationKey(
    "Its cloud connection could not read it the last time.",
  ),
  [CloudUnreportedReason.NotPublished]: translationKey(
    "This resource does not publish it.",
  ),
  [CloudUnreportedReason.NeedsAgent]: translationKey(
    "Only the Ops Agent on the VM reports it.",
  ),
  [CloudUnreportedReason.NotPublishedByType]: translationKey(
    "The resources of its type OneUptime checked do not publish it.",
  ),
  [CloudUnreportedReason.Streamed]: translationKey(
    "Its cloud connection's stream sends it, and none has arrived for this resource yet.",
  ),
};

export const CLOUD_UNREPORTED_FIVE_MINUTES: string = translationKey(
  "It comes every 5 minutes and is read every 15 minutes.",
);
export const CLOUD_UNREPORTED_FEW_TIMES_A_DAY: string = translationKey(
  "Its cloud publishes it a few times a day, and it is read every hour.",
);
export const CLOUD_UNREPORTED_ONCE_A_DAY: string = translationKey(
  "Its cloud publishes it once a day.",
);

// What a reason's link says, in English.
export const CLOUD_UNREPORTED_FIX_LABELS: Readonly<
  Record<CloudUnreportedFix, string>
> = {
  "cloud-connect": translationKey("Open Cloud > Connect"),
  "ops-agent": translationKey("Install the Ops Agent"),
};

// A reason as a sentence in English: a key of the locale files.
export function getCloudUnreportedReasonText(
  entry: CloudUnreportedReasonEntry,
): string {
  if (entry.reason === CloudUnreportedReason.Condition) {
    return entry.condition
      ? CLOUD_KEY_METRIC_CONDITION_REASONS[entry.condition]
      : "";
  }

  if (entry.reason === CloudUnreportedReason.Cadence) {
    const interval: number = entry.intervalSeconds || 0;

    if (interval >= 86400) {
      return CLOUD_UNREPORTED_ONCE_A_DAY;
    }

    return interval >= 3600
      ? CLOUD_UNREPORTED_FEW_TIMES_A_DAY
      : CLOUD_UNREPORTED_FIVE_MINUTES;
  }

  return CLOUD_UNREPORTED_REASON_SENTENCES[entry.reason];
}

// What the server knows of the resource's connection, for the reasons.
export interface CloudUnreportedConnectionState {
  isEnabled: boolean;
  // The last read's outcome and its warnings, as its summary keeps them.
  lastReadStatus?: "success" | "partial" | "failed" | undefined;
  lastReadFailureKind?: string | undefined;
  lastReadWarnings?: ReadonlyArray<string> | undefined;
}

/*
 * Whether one of the last read's warnings is about this metric, by the
 * sentences the reads write: Azure's "Azure Monitor could not read
 * <metric> of 3 resources" and "Could not read which metrics <type>
 * publishes", AWS's "Could not list <namespace> in <region>". A metric's
 * name is matched with what the sentence puts around it: Azure's names
 * hold spaces, so "Percentage CPU" is no word of "Percentage CPU Credits".
 */
export function isCloudReadWarningAbout(data: {
  warning: string;
  metric: CloudResourceKeyMetric;
  type?: string | undefined;
}): boolean {
  const text: string = data.warning.toLowerCase();
  const name: string = data.metric.name.toLowerCase();
  const namespace: string = (data.metric.namespace || "").toLowerCase();
  const type: string = (data.type || "").toLowerCase();

  return (
    (Boolean(name) && text.includes(`could not read ${name} of `)) ||
    (Boolean(namespace) && text.includes(`could not list ${namespace} in `)) ||
    (Boolean(type) &&
      text.includes(`could not read which metrics ${type} publishes`))
  );
}

/*
 * Why the resource likely did not report the key metric, most likely
 * first. `connection` is null when no cloud connection reads it (a
 * collector sends its metrics). `isPublished`: Azure, whether its own
 * metric definitions list the metric - null when OneUptime does not know.
 * `isPublishedByType`: whether the definitions its type was read with do.
 */
export function explainCloudUnreportedKeyMetric(data: {
  metric: CloudResourceKeyMetric;
  // The resource's type, which a read's warning may name.
  type?: string | undefined;
  connection: CloudUnreportedConnectionState | null;
  isPublished?: boolean | null | undefined;
  isPublishedByType?: boolean | null | undefined;
  isLeftToStream?: boolean | undefined;
}): Array<CloudUnreportedReasonEntry> {
  const reasons: Array<CloudUnreportedReasonEntry> = [];
  const metric: CloudResourceKeyMetric = data.metric;

  if (!data.connection) {
    reasons.push({
      reason: CloudUnreportedReason.NoConnection,
      fix: "cloud-connect",
    });
  } else if (!data.connection.isEnabled) {
    reasons.push({
      reason: CloudUnreportedReason.ConnectionOff,
      fix: "cloud-connect",
    });
  } else if (
    data.connection.lastReadStatus === "failed" &&
    (data.connection.lastReadFailureKind === "permission" ||
      data.connection.lastReadFailureKind === "authentication")
  ) {
    reasons.push({
      reason: CloudUnreportedReason.NoPermission,
      fix: "cloud-connect",
    });
  } else if (
    data.connection.lastReadStatus === "failed" ||
    (data.connection.lastReadWarnings || []).some((warning: string) => {
      return isCloudReadWarningAbout({ warning, metric, type: data.type });
    })
  ) {
    reasons.push({
      reason: CloudUnreportedReason.ReadFailed,
      fix: "cloud-connect",
    });
  }

  if (data.isPublished === false) {
    reasons.push({ reason: CloudUnreportedReason.NotPublished });
  }

  if (metric.reportedBy) {
    reasons.push({
      reason: CloudUnreportedReason.NeedsAgent,
      fix: "ops-agent",
    });
  }

  if (metric.onlyWhen) {
    reasons.push({
      reason: CloudUnreportedReason.Condition,
      condition: metric.onlyWhen,
    });
  }

  if (data.isPublished !== false && data.isPublishedByType === false) {
    reasons.push({ reason: CloudUnreportedReason.NotPublishedByType });
  }

  if (data.isLeftToStream) {
    reasons.push({
      reason: CloudUnreportedReason.Streamed,
      fix: "cloud-connect",
    });
  }

  if (metric.intervalSeconds) {
    reasons.push({
      reason: CloudUnreportedReason.Cadence,
      intervalSeconds: metric.intervalSeconds,
      ...(metric.readEverySeconds
        ? { readEverySeconds: metric.readEverySeconds }
        : {}),
    });
  }

  return reasons;
}

/*
 * ---- What the server answers ---------------------------------------------
 */

// How far back "since when" is looked for.
export const CLOUD_UNREPORTED_LOOK_BACK_DAYS: number = 30;

export interface CloudUnreportedKeyMetricReport {
  key: string;
  name: string;
  /*
   * When the resource last reported it within the look-back, as an ISO
   * time; null when it did not.
   */
  lastReportedAt: string | null;
  /*
   * With lastReportedAt null: true when the look-back holds the resource's
   * whole life, so it never reported it; false when it is older, so it did
   * not in the last CLOUD_UNREPORTED_LOOK_BACK_DAYS.
   */
  isNeverReported: boolean;
  reasons: Array<CloudUnreportedReasonEntry>;
}

// A reason entry read from an answer, or null.
function readReasonEntry(value: unknown): CloudUnreportedReasonEntry | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const raw: Record<string, unknown> = value as Record<string, unknown>;
  const reason: unknown = raw["reason"];

  if (
    typeof reason !== "string" ||
    !(Object.values(CloudUnreportedReason) as Array<string>).includes(reason)
  ) {
    return null;
  }

  const entry: CloudUnreportedReasonEntry = {
    reason: reason as CloudUnreportedReason,
  };
  const condition: unknown = raw["condition"];

  if (
    typeof condition === "string" &&
    (Object.values(CloudKeyMetricCondition) as Array<string>).includes(
      condition,
    )
  ) {
    entry.condition = condition as CloudKeyMetricCondition;
  }

  for (const field of ["intervalSeconds", "readEverySeconds"] as const) {
    const seconds: unknown = raw[field];

    if (typeof seconds === "number" && Number.isFinite(seconds)) {
      entry[field] = seconds;
    }
  }

  const fix: unknown = raw["fix"];

  if (fix === "cloud-connect" || fix === "ops-agent") {
    entry.fix = fix;
  }

  return entry;
}

// The server's answer, read defensively: unknown entries are dropped.
export function readCloudUnreportedKeyMetricReports(
  value: unknown,
): Array<CloudUnreportedKeyMetricReport> {
  const list: unknown =
    value && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)["metrics"]
      : value;

  if (!Array.isArray(list)) {
    return [];
  }

  const reports: Array<CloudUnreportedKeyMetricReport> = [];

  for (const item of list) {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      continue;
    }

    const raw: Record<string, unknown> = item as Record<string, unknown>;
    const key: unknown = raw["key"];
    const name: unknown = raw["name"];

    if (typeof key !== "string" || !key || typeof name !== "string") {
      continue;
    }

    const lastReportedAt: unknown = raw["lastReportedAt"];
    const time: number =
      typeof lastReportedAt === "string" ? Date.parse(lastReportedAt) : NaN;

    reports.push({
      key,
      name,
      lastReportedAt: Number.isFinite(time)
        ? new Date(time).toISOString()
        : null,
      isNeverReported: raw["isNeverReported"] === true,
      reasons: (Array.isArray(raw["reasons"]) ? raw["reasons"] : [])
        .map(readReasonEntry)
        .filter(
          (
            entry: CloudUnreportedReasonEntry | null,
          ): entry is CloudUnreportedReasonEntry => {
            return entry !== null;
          },
        ),
    });
  }

  return reports;
}
