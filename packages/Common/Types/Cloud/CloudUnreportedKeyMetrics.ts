import { translationKey } from "../Translator";
import { CloudProvider } from "./CloudPlatform";
import {
  AWS_CLOUDWATCH_RESOURCE_RULES,
  AwsCloudWatchResourceRule,
} from "./CloudResourceCatalog";
import {
  AZURE_FIVE_MINUTE_READ_MINUTES,
  AwsKeyMetric,
  AwsNamespaceKeyMetrics,
  AzureKeyMetric,
  CloudKeyMetricCadence,
  GCP_KEY_METRICS,
  GcpKeyMetric,
  GcpTypeKeyMetrics,
  getAwsKeyMetricCadence,
  getAwsKeyMetrics,
  getAwsStoredMetricName,
  getAzureKeyMetricCadence,
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
import { CLOUD_CONNECTION_READ_INTERVALS } from "../CloudConnection/CloudConnectionCatalog";
import {
  CloudMetricNotRead,
  CloudMetricNotReadKind,
} from "./CloudResourceMetricCollection";

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
   * than the read's: an Azure metric kept at five minutes (300), at an
   * hour (3600) or at six hours (21600), an AWS metric published a few
   * times a day (3600) or once a day (86400).
   */
  intervalSeconds?: number | undefined;
  // How often it is read, where that is not every read: every 15 minutes.
  readEverySeconds?: number | undefined;
  // How often it comes (CloudKeyMetricCadence), set with intervalSeconds.
  cadence?: CloudKeyMetricCadence | undefined;
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

      const cadence: CloudKeyMetricCadence | undefined =
        getAwsKeyMetricCadence(metric);

      metrics.push({
        key: awsKeyOf(entry.namespace, metric.metricName),
        name: metric.metricName,
        namespace: entry.namespace,
        group: metric.group,
        rank,
        ...(metric.onlyWhen ? { onlyWhen: metric.onlyWhen } : {}),
        ...(cadence ? { intervalSeconds: metric.periodSeconds, cadence } : {}),
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

/*
 * An Azure key metric's points, by its mark (AzureKeyMetric.grain): how far
 * apart they are, and how often they are read - a five-minute one in a call
 * every 15 minutes, an hourly one once an hour, a six-hourly one every six.
 */
const AZURE_CADENCE_TIMING: Readonly<
  Partial<
    Record<
      CloudKeyMetricCadence,
      Pick<
        CloudResourceKeyMetric,
        "intervalSeconds" | "readEverySeconds" | "cadence"
      >
    >
  >
> = {
  [CloudKeyMetricCadence.FiveMinutes]: {
    intervalSeconds: 300,
    readEverySeconds: AZURE_FIVE_MINUTE_READ_MINUTES * 60,
    cadence: CloudKeyMetricCadence.FiveMinutes,
  },
  [CloudKeyMetricCadence.Hourly]: {
    intervalSeconds: 3600,
    readEverySeconds: 3600,
    cadence: CloudKeyMetricCadence.Hourly,
  },
  [CloudKeyMetricCadence.SixHourly]: {
    intervalSeconds: 21600,
    readEverySeconds: 21600,
    cadence: CloudKeyMetricCadence.SixHourly,
  },
};

function getAzureKeyMetricsOfResource(
  type: string,
): Array<CloudResourceKeyMetric> {
  return (getAzureKeyMetrics(type)?.metrics || []).map(
    (metric: AzureKeyMetric, rank: number): CloudResourceKeyMetric => {
      const cadence: CloudKeyMetricCadence | undefined =
        getAzureKeyMetricCadence(metric);

      return {
        key: metric.name.toLowerCase(),
        name: metric.name,
        group: metric.group,
        rank,
        ...(metric.onlyWhen ? { onlyWhen: metric.onlyWhen } : {}),
        ...(cadence ? AZURE_CADENCE_TIMING[cadence] : {}),
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
 * ---- When a key metric's points can be in a range ------------------------
 *
 * A key metric that comes every read is in any range that ends now. One
 * whose points come less often (its cadence) reaches a range only once its
 * newest point can be in it: an hourly one's is 2 to 3 hours old when it is
 * read, so the last hour holds none of it, and a list of that hour counted
 * it as not reported (#10026). It is counted only past its own interval and
 * delay.
 *
 * How old its newest point can be, before the read that brings the next -
 * the readings' holds say the same of a reading (CloudResourceHealth):
 *
 *   - five minutes: 9 to 14 minutes old when read (Azure Monitor's 4
 *     minutes on a whole five), in a call once a read's window holds 15
 *     minutes - every 15 or 20 minutes, or every read on a connection read
 *     every 30 or 60;
 *   - an hour, or six: two periods old when read (a window of an hour or
 *     more waits a whole period), three by the first read after the next
 *     is there;
 *   - a few times a day (ACM's DaysToExpiry, twice a day): up to 12 hours
 *     between two, read 2 to 3 hours after each, hourly;
 *   - once a day: 2.5 to 3.5 days old (CloudWatch's day, read 36 hours on).
 */
export const CLOUD_LONGEST_READ_INTERVAL_MINUTES: number = Math.max(
  ...CLOUD_CONNECTION_READ_INTERVALS,
);

const MINUTE_MS: number = 60 * 1000;
const HOUR_MS: number = 60 * MINUTE_MS;

export function getCloudKeyMetricNewestPointMaxAgeMs(data: {
  cadence: CloudKeyMetricCadence;
  // How often its connection reads; unknown: the longest a connection may wait.
  readIntervalInMinutes?: number | null | undefined;
}): number {
  const readMs: number =
    Math.max(
      1,
      Number(data.readIntervalInMinutes) || CLOUD_LONGEST_READ_INTERVAL_MINUTES,
    ) * MINUTE_MS;

  switch (data.cadence) {
    case CloudKeyMetricCadence.FiveMinutes: {
      // Its call waits for 15 minutes of it: the reads it takes to hold them.
      const callEveryMs: number =
        Math.ceil((AZURE_FIVE_MINUTE_READ_MINUTES * MINUTE_MS) / readMs) *
        readMs;

      return 14 * MINUTE_MS + callEveryMs;
    }
    case CloudKeyMetricCadence.Hourly:
      return 3 * HOUR_MS + readMs;
    case CloudKeyMetricCadence.SixHourly:
      return 18 * HOUR_MS + readMs;
    case CloudKeyMetricCadence.FewTimesADay:
      return 15 * HOUR_MS + readMs;
    case CloudKeyMetricCadence.Daily:
      return 84 * HOUR_MS + readMs;
    default:
      return 0;
  }
}

// A range a list read, in milliseconds.
export interface CloudKeyMetricRange {
  startMs: number;
  endMs: number;
}

/*
 * Whether the range holds a point of the metric for certain, as of `nowMs`:
 * always for one that comes every read. For one with a cadence, when the
 * range reaches now and back past its newest point's age (so its newest
 * point is in it), or when it holds a whole interval of the points that
 * are surely in by now. A range that only may hold one does not count it
 * as not reported.
 */
export function isCloudKeyMetricExpectedInRange(data: {
  metric: Pick<CloudResourceKeyMetric, "cadence" | "intervalSeconds">;
  range: CloudKeyMetricRange;
  nowMs: number;
  readIntervalInMinutes?: number | null | undefined;
}): boolean {
  if (!data.metric.cadence) {
    return true;
  }

  const maxAgeMs: number = getCloudKeyMetricNewestPointMaxAgeMs({
    cadence: data.metric.cadence,
    readIntervalInMinutes: data.readIntervalInMinutes,
  });
  const surelyInMs: number = data.nowMs - maxAgeMs;
  // A range that ends a minute ago reaches now: a list's "now" is its own.
  const reachesNow: boolean = data.range.endMs >= data.nowMs - MINUTE_MS;

  if (reachesNow && data.range.startMs <= surelyInMs) {
    return true;
  }

  return (
    Math.min(data.range.endMs, surelyInMs) - data.range.startMs >=
    (data.metric.intervalSeconds || 0) * 1000
  );
}

/*
 * The resource's key metrics none of `reportedMetricNames` is (the names
 * its metrics list found in its range), in their sections' order. With the
 * range, only those it holds a point of for certain
 * (isCloudKeyMetricExpectedInRange): the last hour does not count an
 * hourly one, whose newest point is older.
 */
export function getCloudUnreportedKeyMetrics(data: {
  provider: string | null | undefined;
  type: string | null | undefined;
  namespace?: string | null | undefined;
  reportedMetricNames: ReadonlyArray<string>;
  range?: CloudKeyMetricRange | undefined;
  // When the range was read; now unless said.
  nowMs?: number | undefined;
  // How often its connection reads; unknown: the longest a connection may wait.
  readIntervalInMinutes?: number | null | undefined;
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

  const nowMs: number = data.nowMs ?? Date.now();
  const range: CloudKeyMetricRange | undefined = data.range;

  return getCloudKeyMetricsOfResource(data).filter(
    (metric: CloudResourceKeyMetric): boolean => {
      return (
        !reported.has(metric.key) &&
        (!range ||
          isCloudKeyMetricExpectedInRange({
            metric,
            range,
            nowMs,
            readIntervalInMinutes: data.readIntervalInMinutes,
          }))
      );
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
  /*
   * Its cloud answered, when it was last asked, that it does not serve it
   * for this resource ("Sampling type is not found"): it is not asked for
   * again until `until` (CloudResourceMetricCollection).
   */
  NotServed = "not-served",
  // Its cloud was too busy to answer for it at the last read ("ServerBusy").
  CloudBusy = "cloud-busy",
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
  // CloudUnreportedReason.Cadence's: how often it comes, which its sentence says.
  cadence?: CloudKeyMetricCadence | undefined;
  fix?: CloudUnreportedFix | undefined;
  /*
   * What its cloud answered, in its own words, where a read kept it (a read
   * that failed, NotServed, CloudBusy) - shown after the reason, never in
   * its place.
   */
  error?: string | undefined;
  // Since when it has not been read (ISO), where a read kept it.
  since?: string | undefined;
  // NotServed's: when it is asked for again (ISO).
  until?: string | undefined;
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
  [CloudUnreportedReason.NotServed]: translationKey(
    "Its cloud answered that it does not serve this metric for this resource, so its connection stops asking for it for a day.",
  ),
  [CloudUnreportedReason.CloudBusy]: translationKey(
    "Its cloud was too busy to answer for it at the last read. The next read asks again.",
  ),
};

export const CLOUD_UNREPORTED_FIVE_MINUTES: string = translationKey(
  "It comes every 5 minutes and is read every 15 minutes.",
);
export const CLOUD_UNREPORTED_HOURLY: string = translationKey(
  "Azure Monitor keeps it by the hour, so it comes once an hour, 2 to 3 hours after the hour it measures.",
);
export const CLOUD_UNREPORTED_SIX_HOURLY: string = translationKey(
  "Azure Monitor keeps it in six-hour periods, so it comes every 6 hours, 12 to 18 hours after the period it measures.",
);
export const CLOUD_UNREPORTED_FEW_TIMES_A_DAY: string = translationKey(
  "Its cloud publishes it a few times a day, and it is read every hour.",
);
export const CLOUD_UNREPORTED_ONCE_A_DAY: string = translationKey(
  "Its cloud publishes it once a day.",
);

// How often a metric comes, as the sentence that says so.
const CLOUD_UNREPORTED_CADENCE_SENTENCES: Readonly<
  Record<CloudKeyMetricCadence, string>
> = {
  [CloudKeyMetricCadence.FiveMinutes]: CLOUD_UNREPORTED_FIVE_MINUTES,
  [CloudKeyMetricCadence.Hourly]: CLOUD_UNREPORTED_HOURLY,
  [CloudKeyMetricCadence.SixHourly]: CLOUD_UNREPORTED_SIX_HOURLY,
  [CloudKeyMetricCadence.FewTimesADay]: CLOUD_UNREPORTED_FEW_TIMES_A_DAY,
  [CloudKeyMetricCadence.Daily]: CLOUD_UNREPORTED_ONCE_A_DAY,
};

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
    if (entry.cadence) {
      return CLOUD_UNREPORTED_CADENCE_SENTENCES[entry.cadence];
    }

    // An answer from before reasons said their cadence: by the interval.
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
 * `resourceFailure` and `notRead`: what the connection's reads kept of
 * this resource (CloudResourceMetricCollection) - that none of its metrics
 * could be read, or what its cloud answered for this one - said with the
 * cloud's own words.
 */
export function explainCloudUnreportedKeyMetric(data: {
  metric: CloudResourceKeyMetric;
  // The resource's type, which a read's warning may name.
  type?: string | undefined;
  connection: CloudUnreportedConnectionState | null;
  isPublished?: boolean | null | undefined;
  isPublishedByType?: boolean | null | undefined;
  isLeftToStream?: boolean | undefined;
  resourceFailure?: { error: string; since: string } | null | undefined;
  notRead?: CloudMetricNotRead | null | undefined;
}): Array<CloudUnreportedReasonEntry> {
  const reasons: Array<CloudUnreportedReasonEntry> = [];
  const metric: CloudResourceKeyMetric = data.metric;
  const notRead: CloudMetricNotRead | null | undefined = data.notRead;

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
    data.connection.lastReadStatus !== "failed" &&
    data.resourceFailure
  ) {
    reasons.push({
      reason: CloudUnreportedReason.ReadFailed,
      fix: "cloud-connect",
      ...(data.resourceFailure.error
        ? { error: data.resourceFailure.error }
        : {}),
      since: data.resourceFailure.since,
    });
  } else if (
    data.connection.lastReadStatus !== "failed" &&
    notRead?.kind === CloudMetricNotReadKind.Unsupported
  ) {
    reasons.push({
      reason: CloudUnreportedReason.NotServed,
      ...(notRead.error ? { error: notRead.error } : {}),
      since: notRead.since,
      ...(notRead.until ? { until: notRead.until } : {}),
    });
  } else if (
    data.connection.lastReadStatus !== "failed" &&
    notRead?.kind === CloudMetricNotReadKind.Throttled
  ) {
    reasons.push({
      reason: CloudUnreportedReason.CloudBusy,
      ...(notRead.error ? { error: notRead.error } : {}),
      since: notRead.since,
    });
  } else if (
    data.connection.lastReadStatus !== "failed" &&
    notRead?.kind === CloudMetricNotReadKind.Failed
  ) {
    reasons.push({
      reason: CloudUnreportedReason.ReadFailed,
      fix: "cloud-connect",
      ...(notRead.error ? { error: notRead.error } : {}),
      since: notRead.since,
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
      ...(metric.cadence ? { cadence: metric.cadence } : {}),
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

  const cadence: unknown = raw["cadence"];

  if (
    typeof cadence === "string" &&
    (Object.values(CloudKeyMetricCadence) as Array<string>).includes(cadence)
  ) {
    entry.cadence = cadence as CloudKeyMetricCadence;
  }

  const fix: unknown = raw["fix"];

  if (fix === "cloud-connect" || fix === "ops-agent") {
    entry.fix = fix;
  }

  const error: unknown = raw["error"];

  if (typeof error === "string" && error.trim()) {
    entry.error = error;
  }

  for (const field of ["since", "until"] as const) {
    const value: unknown = raw[field];
    const time: number = typeof value === "string" ? Date.parse(value) : NaN;

    if (Number.isFinite(time)) {
      entry[field] = new Date(time).toISOString();
    }
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
