import { translationKey } from "../Translator";
import {
  StorageUsage,
  StorageUsageThresholds,
  getStorageUsage,
} from "../../Utils/Storage/StorageUsage";
import {
  AWS_DEFAULT_PERIOD_SECONDS,
  AZURE_FIVE_MINUTE_GRAIN,
  AZURE_FIVE_MINUTE_READ_MINUTES,
  AZURE_HOURLY_GRAIN,
  AZURE_KEY_METRICS,
  AZURE_SIX_HOURLY_GRAIN,
  AwsKeyMetric,
  GCP_ALIGNMENT_PERIOD_SECONDS,
  GCP_OPS_AGENT_INSTALL_URL,
  getAwsKeyMetrics,
  getAzureStoredMetricName,
} from "./CloudKeyMetrics";
import { CloudProvider } from "./CloudPlatform";

/*
 * WHAT ON A CLOUD RESOURCE NEEDS SOMEONE, AND HOW BAD IT IS.
 *
 * Every read of a cloud connection reads a few key metrics of each resource
 * (CloudKeyMetrics). The read keeps the newest of the ones that say whether
 * a resource is well - and the ones its page leads with - on the resource's
 * record (CloudResource.cloudReadings), and these rules judge them. One set
 * of rules for every place that says it: the Cloud Overview's and an
 * account's Needs attention, the All Resources and an account's Resources
 * lists, a resource's own hero, and the server, which stores each verdict's
 * severity (CloudResource.healthSeverity) so a page reads only what needs
 * attention instead of every resource of every account.
 *
 *   Critical - broken, or about to be:
 *     an instance failing its status checks, a VM or a VPN that is down, a
 *     Route 53 health check that fails, half or more of a load balancer's,
 *     a function's or an API's requests failing, a database or a cluster
 *     out of storage (95% full), a search cluster in red, a public address
 *     under a DDoS attack.
 *   Warning - needs a look soon:
 *     unhealthy hosts behind a load balancer, 5% or more of requests
 *     failing, throttling, a database or a cache at 95% of its CPU or
 *     memory or 90% of its storage, a Compute Engine VM at 95% of its
 *     memory or 90% of a disk (as its Ops Agent reports them), failed
 *     executions, runs, deliveries or connections, dead-lettered messages,
 *     a queue whose oldest message waits an hour, availability under 99.9%.
 *
 * What is never a problem by itself: a busy virtual machine (an instance at
 * 100% CPU is doing its work - as on a host, its status checks say when it
 * stops), a resource no rule speaks for (a bucket, a network), and a quiet
 * resource - "Not reporting" says that. A resource whose readings are older
 * than an hour is not judged: what it reported last is no longer the truth.
 *
 * Each reading is the value of its metric's newest datapoint in a read, as
 * the cloud aggregates it (CloudKeyMetrics: an average, a maximum, a sum
 * over the period). A rule that divides two readings - failed requests by
 * requests - divides two of one period only.
 *
 * The words are English, marked as keys of the Dashboard's locales and
 * looked up where they are drawn. React-free and server-safe: the read, the
 * API and App tests call it.
 */

// Readings written longer ago than this are not judged.
export const CLOUD_READINGS_STALE_MS: number = 60 * 60 * 1000;

/*
 * Requests a period must hold before the share that failed means anything:
 * two failures of the three requests a quiet test endpoint gets are not an
 * outage.
 */
export const CLOUD_HEALTH_MIN_REQUESTS: number = 20;

export const CLOUD_FAILED_SHARE_WARNING_PERCENT: number = 5;
export const CLOUD_FAILED_SHARE_CRITICAL_PERCENT: number = 50;
export const CLOUD_CPU_HIGH_PERCENT: number = 95;
export const CLOUD_MEMORY_HIGH_PERCENT: number = 95;
export const CLOUD_STORAGE_HIGH_PERCENT: number = 90;
export const CLOUD_STORAGE_FULL_PERCENT: number = 95;
/*
 * Where a cloud store's bar turns amber and red (StorageUsageBar): the
 * lines above, at them, as the storage rules read them.
 */
export const CLOUD_STORAGE_USAGE_THRESHOLDS: StorageUsageThresholds = {
  warningPercent: CLOUD_STORAGE_HIGH_PERCENT,
  criticalPercent: CLOUD_STORAGE_FULL_PERCENT,
};
export const CLOUD_AVAILABILITY_LOW_PERCENT: number = 99.9;
/*
 * An Elastic Beanstalk environment's EnvironmentHealth, as enhanced health
 * reporting writes it: 0 OK, 1 Info, 5 Unknown, 10 No data, 15 Warning,
 * 20 Degraded, 25 Severe. Degraded is a warning, Severe critical.
 */
export const CLOUD_BEANSTALK_HEALTH_DEGRADED: number = 20;
export const CLOUD_BEANSTALK_HEALTH_SEVERE: number = 25;
/*
 * The share of a WAF web ACL's requests it may block before someone looks:
 * half of them is an attack, or a rule turning real users away.
 */
export const CLOUD_BLOCKED_SHARE_WARNING_PERCENT: number = 50;
export const CLOUD_AVAILABILITY_DOWN_PERCENT: number = 90;
// A queue's oldest message, or a stream's consumers, this far behind.
export const CLOUD_BACKLOG_AGE_SECONDS: number = 60 * 60;
/*
 * An App Service app's Health check, as Azure Monitor reports it
 * (HealthCheckStatus): the share of its instances whose health check
 * passes. Under 100 an instance was deemed unhealthy, and is out of the
 * load balancer; under half, App Service keeps unhealthy instances in it
 * (WEBSITE_HEALTHCHECK_MAXUNHEALTHYWORKERPERCENT, 50 by default), so some
 * requests reach one: critical.
 */
export const APP_SERVICE_HEALTH_CHECK_KEY: string = "healthcheckstatus";
export const CLOUD_HEALTH_CHECK_CRITICAL_PERCENT: number = 50;

export enum CloudHealthSeverity {
  Critical = "critical",
  Warning = "warning",
}

export type CloudHealthTone = "positive" | "warning" | "danger" | "neutral";

export type CloudHealthState =
  | "healthy"
  | "degraded"
  | "unhealthy"
  | "not-reporting"
  // Reporting, with nothing to judge: no rule for its type, or no reading lately.
  | "reporting";

/*
 * One reason or status word, as an English template and its values. A
 * count-dependent one carries its "one" form and the count; `text` is then
 * its general form.
 */
export interface CloudHealthText {
  text: string;
  values?: Record<string, string> | undefined;
  plural?: { one: string; count: number } | undefined;
}

// One reading: the value of the metric's newest datapoint, and its time.
export interface CloudResourceReading {
  value: number;
  // ISO time of the datapoint.
  time: string;
  /*
   * The name the metric is stored under, where the key leaves part of it
   * out: an Azure metric's stored name ends with the aggregation its
   * definition calls primary (getAzureStoredMetricName), which only the
   * read knows, while its key does not say it (getCloudReadingKey). A
   * monitor of the metric reads that name (CloudAlertTemplates). Absent
   * for AWS and Google Cloud, whose keys give the whole name, and on
   * readings written before it was kept.
   */
  metric?: string | undefined;
}

// Readings by key (getCloudReadingKey): "aws/ec2/statuscheckfailed".
export type CloudResourceReadings = Record<string, CloudResourceReading>;

/*
 * A resource as the rules read it: the CloudResource columns, from Postgres
 * on the server or from ModelAPI in the Dashboard.
 */
export interface CloudHealthRow {
  cloudProvider?: string | null | undefined;
  cloudResourceType?: string | null | undefined;
  otelCollectorStatus?: string | null | undefined;
  cloudReadings?: unknown;
  cloudReadingsAt?: Date | string | null | undefined;
  // What the inventory says of it: a database's allocated storage.
  cloudProperties?: unknown;
}

export interface CloudHealthAssessment {
  state: CloudHealthState;
  severity: CloudHealthSeverity | null;
  // The word the lists and the hero show.
  status: CloudHealthText;
  tone: CloudHealthTone;
  // Why it needs attention, the most urgent first. Empty when it does not.
  reasons: Array<CloudHealthText>;
  isReporting: boolean;
  // Whether its readings are recent enough to judge.
  hasFreshReadings: boolean;
  /*
   * Whether a rule had what it reads: "Healthy" means checked and well,
   * "Reporting" that nothing was there to check.
   */
  isChecked: boolean;
}

/*
 * ---------------------------------------------------------------------------
 * Words
 * ---------------------------------------------------------------------------
 */

export const CLOUD_STATUS_HEALTHY: string = translationKey("Healthy");
export const CLOUD_STATUS_DEGRADED: string = translationKey("Degraded");
export const CLOUD_STATUS_UNHEALTHY: string = translationKey("Unhealthy");
export const CLOUD_STATUS_NOT_REPORTING: string =
  translationKey("Not reporting");
export const CLOUD_STATUS_REPORTING: string = translationKey("Reporting");

export const REASON_STATUS_CHECKS_FAILING: string = translationKey(
  "Failing its status checks",
);
export const REASON_NOT_AVAILABLE: string = translationKey("Not available");
export const REASON_TUNNELS_DOWN: string = translationKey("VPN tunnels down");
export const REASON_HEALTH_CHECK_FAILING: string = translationKey(
  "Health check failing",
);
export const REASON_REQUESTS_FAILED: string = translationKey(
  "{{percent}} of requests failed",
);
export const REASON_INVOCATIONS_FAILED: string = translationKey(
  "{{percent}} of invocations failed",
);
export const REASON_UNHEALTHY_HOSTS: { one: string; other: string } = {
  one: translationKey("{{count}} unhealthy host"),
  other: translationKey("{{count}} unhealthy hosts"),
};
export const REASON_THROTTLED: string = translationKey("Throttled");
export const REASON_CPU_HIGH: string = translationKey("CPU at {{percent}}");
export const REASON_MEMORY_USED: string = translationKey(
  "Memory {{percent}} used",
);
export const REASON_STORAGE_FULL: string = translationKey("{{percent}} full");
export const REASON_DTU_HIGH: string = translationKey("DTUs at {{percent}}");
export const REASON_REQUEST_UNITS_HIGH: string = translationKey(
  "Request units at {{percent}}",
);
export const REASON_SERVER_LOAD_HIGH: string = translationKey(
  "Server load at {{percent}}",
);
export const REASON_SESSIONS_HIGH: string = translationKey(
  "Sessions at {{percent}}",
);
export const REASON_CAPACITY_HIGH: string = translationKey(
  "Capacity at {{percent}}",
);
export const REASON_PORTS_HIGH: string = translationKey(
  "SNAT ports at {{percent}}",
);
export const REASON_IO_LIMIT: string = translationKey(
  "I/O at {{percent}} of its limit",
);
export const REASON_AVAILABILITY_LOW: string = translationKey(
  "Availability {{percent}}",
);
export const REASON_PROBES_FAILING: string = translationKey(
  "Health probes {{percent}} up",
);
export const REASON_FIREWALL_HEALTH: string = translationKey(
  "Firewall health {{percent}}",
);
export const REASON_PORT_ALLOCATION_ERRORS: string = translationKey(
  "Out of ports for new connections",
);
export const REASON_CLUSTER_RED: string = translationKey("Cluster status red");
export const REASON_NO_CONTROLLER: string = translationKey(
  "No active controller",
);
export const REASON_DDOS: string = translationKey("Under a DDoS attack");
/*
 * A wait, said in whole hours under two days and in days after: each its
 * own count-dependent sentence, so every language says its unit itself.
 */
export interface CloudBacklogReason {
  hours: { one: string; other: string };
  days: { one: string; other: string };
}
export const REASON_OLDEST_MESSAGE_WAITING: CloudBacklogReason = {
  hours: {
    one: translationKey("Oldest message waiting {{count}} hour"),
    other: translationKey("Oldest message waiting {{count}} hours"),
  },
  days: {
    one: translationKey("Oldest message waiting {{count}} day"),
    other: translationKey("Oldest message waiting {{count}} days"),
  },
};
export const REASON_CONSUMERS_BEHIND: CloudBacklogReason = {
  hours: {
    one: translationKey("Consumers {{count}} hour behind"),
    other: translationKey("Consumers {{count}} hours behind"),
  },
  days: {
    one: translationKey("Consumers {{count}} day behind"),
    other: translationKey("Consumers {{count}} days behind"),
  },
};
export const REASON_DELIVERIES_FAILING: string = translationKey(
  "Some deliveries failed",
);
export const REASON_FAILED_EXECUTIONS: { one: string; other: string } = {
  one: translationKey("{{count}} failed execution"),
  other: translationKey("{{count}} failed executions"),
};
export const REASON_FAILED_RUNS: { one: string; other: string } = {
  one: translationKey("{{count}} failed run"),
  other: translationKey("{{count}} failed runs"),
};
export const REASON_FAILED_DELIVERIES: { one: string; other: string } = {
  one: translationKey("{{count}} failed delivery"),
  other: translationKey("{{count}} failed deliveries"),
};
export const REASON_FAILED_INVOCATIONS: { one: string; other: string } = {
  one: translationKey("{{count}} failed invocation"),
  other: translationKey("{{count}} failed invocations"),
};
export const REASON_FAILED_CONNECTIONS: { one: string; other: string } = {
  one: translationKey("{{count}} failed connection"),
  other: translationKey("{{count}} failed connections"),
};
export const REASON_DEADLOCKS: { one: string; other: string } = {
  one: translationKey("{{count}} deadlock"),
  other: translationKey("{{count}} deadlocks"),
};
export const REASON_DEAD_LETTERED: { one: string; other: string } = {
  one: translationKey("{{count}} dead-lettered message"),
  other: translationKey("{{count}} dead-lettered messages"),
};
export const REASON_SERVER_ERRORS: { one: string; other: string } = {
  one: translationKey("{{count}} server error"),
  other: translationKey("{{count}} server errors"),
};
export const REASON_UNHEALTHY_ENDPOINTS: { one: string; other: string } = {
  one: translationKey("{{count}} unhealthy endpoint"),
  other: translationKey("{{count}} unhealthy endpoints"),
};
export const REASON_SHORT_OF_DESIRED_CAPACITY: {
  one: string;
  other: string;
} = {
  one: translationKey("{{count}} instance short of desired capacity"),
  other: translationKey("{{count}} instances short of desired capacity"),
};
export const REASON_PACKETS_DROPPED_OUTSIDE_RULES: {
  one: string;
  other: string;
} = {
  one: translationKey("{{count}} packet dropped outside its rules"),
  other: translationKey("{{count}} packets dropped outside its rules"),
};
export const REASON_REQUESTS_BLOCKED: string = translationKey(
  "{{percent}} of requests blocked",
);
export const REASON_ENVIRONMENT_HEALTH_DEGRADED: string = translationKey(
  "Environment health degraded",
);
export const REASON_ENVIRONMENT_HEALTH_SEVERE: string = translationKey(
  "Environment health severe",
);
export const REASON_RESTARTS: { one: string; other: string } = {
  one: translationKey("{{count}} restart"),
  other: translationKey("{{count}} restarts"),
};

/*
 * ---------------------------------------------------------------------------
 * Reading keys
 * ---------------------------------------------------------------------------
 */

// The aggregations the azure_monitor receiver ends a stored name with.
const AZURE_AGGREGATION_SUFFIXES: ReadonlyArray<string> = [
  "_average",
  "_total",
  "_maximum",
  "_minimum",
  "_count",
];

const AWS_STORED_PREFIX: string = "amazonaws.com/";
const AZURE_STORED_PREFIX: string = "azure_";

/*
 * The key a metric's readings are kept and judged under, from the name its
 * metrics are stored with (CloudKeyMetrics):
 *
 *   - AWS: the namespace and the metric, without "amazonaws.com/":
 *     amazonaws.com/AWS/EC2/StatusCheckFailed -> aws/ec2/statuscheckfailed;
 *   - Azure: the metric without "azure_" and its aggregation, so a metric
 *     reads the same whichever aggregation its definition calls primary:
 *     azure_percentage_cpu_average -> percentage_cpu;
 *   - Google Cloud: the metric type itself.
 *
 * Lower case, as the ingest stores names. Null for a name of another cloud.
 */
export function getCloudReadingKey(
  provider: string,
  storedMetricName: string,
): string | null {
  const name: string = (storedMetricName || "").trim().toLowerCase();

  if (!name) {
    return null;
  }

  switch ((provider || "").toLowerCase()) {
    case CloudProvider.AWS:
      return name.startsWith(AWS_STORED_PREFIX)
        ? name.slice(AWS_STORED_PREFIX.length)
        : null;
    case CloudProvider.Azure: {
      if (!name.startsWith(AZURE_STORED_PREFIX)) {
        return null;
      }

      const rest: string = name.slice(AZURE_STORED_PREFIX.length);

      for (const suffix of AZURE_AGGREGATION_SUFFIXES) {
        if (rest.endsWith(suffix) && rest.length > suffix.length) {
          return rest.slice(0, rest.length - suffix.length);
        }
      }

      return rest;
    }
    case CloudProvider.GCP:
      return name.includes(".googleapis.com/") ? name : null;
    default:
      return null;
  }
}

/*
 * ---------------------------------------------------------------------------
 * Reading the row
 * ---------------------------------------------------------------------------
 */

export function toCloudDate(value: unknown): Date | null {
  if (value === null || value === undefined || value === "") {
    return null;
  }
  const date: Date = value instanceof Date ? value : new Date(String(value));
  return isNaN(date.getTime()) ? null : date;
}

/*
 * Stored readings, read back: a reading whose value is not a finite number
 * or whose time is not a time is left out.
 */
export function readCloudResourceReadings(
  value: unknown,
): CloudResourceReadings {
  const readings: CloudResourceReadings = {};

  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return readings;
  }

  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
      continue;
    }

    const record: Record<string, unknown> = raw as Record<string, unknown>;
    const number: number = Number(record["value"]);
    const time: Date | null = toCloudDate(record["time"]);

    if (
      record["value"] === null ||
      record["value"] === "" ||
      !Number.isFinite(number) ||
      !time
    ) {
      continue;
    }

    const metric: unknown = record["metric"];

    readings[key.toLowerCase()] = {
      value: number,
      time: time.toISOString(),
      ...(typeof metric === "string" && metric.trim()
        ? { metric: metric.trim() }
        : {}),
    };
  }

  return readings;
}

function readProperty(properties: unknown, path: string): number | null {
  if (!properties || typeof properties !== "object") {
    return null;
  }

  const value: unknown = (properties as Record<string, unknown>)[path];

  if (value === null || value === undefined || value === "") {
    return null;
  }

  const number: number = Number(value);
  return Number.isFinite(number) ? number : null;
}

// A percent as a reason writes it: whole, with its sign ("96%"); "99.5%" below 100.
export function formatCloudPercent(percent: number): string {
  if (percent < 100 && percent > 99 && Math.round(percent) === 100) {
    return `${Math.floor(percent * 10) / 10}%`;
  }
  return `${Math.round(percent)}%`;
}

/*
 * A wait of at least an hour as its reason says it: whole hours under two
 * days ("Oldest message waiting 3 hours"), whole days after.
 */
export function getCloudBacklogText(
  reason: CloudBacklogReason,
  seconds: number,
): CloudHealthText {
  const hours: number = Math.max(1, Math.floor(seconds / 3600));
  const isDays: boolean = hours >= 48;
  const count: number = isDays ? Math.floor(hours / 24) : hours;
  const forms: { one: string; other: string } = isDays
    ? reason.days
    : reason.hours;

  return {
    text: forms.other,
    values: { count: String(count) },
    plural: { one: forms.one, count },
  };
}

/*
 * ---------------------------------------------------------------------------
 * The rules
 * ---------------------------------------------------------------------------
 */

interface CloudHealthFinding {
  severity: CloudHealthSeverity;
  reason: CloudHealthText;
}

/*
 * What a rule reads its readings through: a reading's value, or null when
 * the read did not bring it. `aligned` reads one only when it is of the
 * same period as another - a sum the cloud writes only when it is not zero
 * (5xx responses) is zero for a period it is missing from.
 */
interface CloudReadingReader {
  value: (key: string) => number | null;
  aligned: (key: string, withKey: string) => number;
  property: (path: string) => number | null;
}

interface CloudHealthRule {
  // The readings it judges: kept by the read for the rule's types.
  readings: Array<string>;
  evaluate: (reader: CloudReadingReader) => CloudHealthFinding | null;
}

interface CloudHealthTypeRules {
  provider: CloudProvider;
  // The resource types they apply to, as CloudResourceCatalog spells them.
  types: Array<string>;
  rules: Array<CloudHealthRule>;
}

function critical(reason: CloudHealthText): CloudHealthFinding {
  return { severity: CloudHealthSeverity.Critical, reason };
}

function warning(reason: CloudHealthText): CloudHealthFinding {
  return { severity: CloudHealthSeverity.Warning, reason };
}

function countText(
  forms: { one: string; other: string },
  count: number,
): CloudHealthText {
  const rounded: number = Math.max(1, Math.round(count));
  return {
    text: forms.other,
    values: { count: String(rounded) },
    plural: { one: forms.one, count: rounded },
  };
}

function percentText(text: string, percent: number): CloudHealthText {
  return { text, values: { percent: formatCloudPercent(percent) } };
}

// Critical while the reading is above zero: a check that fails, a tunnel down.
function failsWhenAboveZero(key: string, reason: string): CloudHealthRule {
  return {
    readings: [key],
    evaluate: (reader: CloudReadingReader): CloudHealthFinding | null => {
      const value: number | null = reader.value(key);
      return value !== null && value > 0 ? critical({ text: reason }) : null;
    },
  };
}

// Critical while the reading is zero: a health check or a tunnel that is up reads 1.
function failsWhenZero(key: string, reason: string): CloudHealthRule {
  return {
    readings: [key],
    evaluate: (reader: CloudReadingReader): CloudHealthFinding | null => {
      const value: number | null = reader.value(key);
      return value !== null && value <= 0 ? critical({ text: reason }) : null;
    },
  };
}

// A warning while the reading is above zero, said as a word.
function warnsWhenAboveZero(key: string, reason: string): CloudHealthRule {
  return {
    readings: [key],
    evaluate: (reader: CloudReadingReader): CloudHealthFinding | null => {
      const value: number | null = reader.value(key);
      return value !== null && value > 0 ? warning({ text: reason }) : null;
    },
  };
}

// A warning while the reading counts something, said with its count.
function warnsOnCount(
  key: string,
  forms: { one: string; other: string },
): CloudHealthRule {
  return {
    readings: [key],
    evaluate: (reader: CloudReadingReader): CloudHealthFinding | null => {
      const value: number | null = reader.value(key);
      return value !== null && value >= 0.5
        ? warning(countText(forms, value))
        : null;
    },
  };
}

// A warning while any of the readings is above zero ("Throttled").
function warnsWhenAnyAboveZero(
  keys: Array<string>,
  reason: string,
): CloudHealthRule {
  return {
    readings: keys,
    evaluate: (reader: CloudReadingReader): CloudHealthFinding | null => {
      return keys.some((key: string): boolean => {
        const value: number | null = reader.value(key);
        return value !== null && value > 0;
      })
        ? warning({ text: reason })
        : null;
    },
  };
}

/*
 * A percent reading at or above its bands: a warning from `warnAt`, critical
 * from `criticalAt` (none when absent). `scale` turns a ratio (Google
 * Cloud's 0 to 1) into a percent.
 */
function percentAtOrAbove(data: {
  key: string;
  reason: string;
  warnAt: number;
  criticalAt?: number | undefined;
  scale?: number | undefined;
}): CloudHealthRule {
  return {
    readings: [data.key],
    evaluate: (reader: CloudReadingReader): CloudHealthFinding | null => {
      const raw: number | null = reader.value(data.key);

      if (raw === null) {
        return null;
      }

      const percent: number = raw * (data.scale || 1);

      if (data.criticalAt !== undefined && percent >= data.criticalAt) {
        return critical(percentText(data.reason, percent));
      }

      return percent >= data.warnAt
        ? warning(percentText(data.reason, percent))
        : null;
    },
  };
}

// A percent reading that should stay high: availability, health.
function percentBelow(data: {
  key: string;
  reason: string;
  warnBelow: number;
  criticalBelow?: number | undefined;
}): CloudHealthRule {
  return {
    readings: [data.key],
    evaluate: (reader: CloudReadingReader): CloudHealthFinding | null => {
      const percent: number | null = reader.value(data.key);

      if (percent === null) {
        return null;
      }

      if (data.criticalBelow !== undefined && percent < data.criticalBelow) {
        return critical(percentText(data.reason, percent));
      }

      return percent < data.warnBelow
        ? warning(percentText(data.reason, percent))
        : null;
    },
  };
}

/*
 * The share of a period's requests that failed: the failures (each a sum
 * the cloud may leave out when it is zero) over the requests of the same
 * period, once the period held CLOUD_HEALTH_MIN_REQUESTS of them.
 */
function failedShare(data: {
  failures: Array<string>;
  total: string;
  reason: string;
}): CloudHealthRule {
  return {
    readings: [...data.failures, data.total],
    evaluate: (reader: CloudReadingReader): CloudHealthFinding | null => {
      const total: number | null = reader.value(data.total);

      if (total === null || total < CLOUD_HEALTH_MIN_REQUESTS) {
        return null;
      }

      let failed: number = 0;

      for (const key of data.failures) {
        failed += reader.aligned(key, data.total);
      }

      const percent: number = Math.min(100, (failed / total) * 100);

      if (percent >= CLOUD_FAILED_SHARE_CRITICAL_PERCENT) {
        return critical(percentText(data.reason, percent));
      }

      return percent >= CLOUD_FAILED_SHARE_WARNING_PERCENT
        ? warning(percentText(data.reason, percent))
        : null;
    },
  };
}

// A share the cloud already writes as a percent (CloudFront's 5xx error rate).
function failedPercent(key: string, reason: string): CloudHealthRule {
  return percentAtOrAbove({
    key,
    reason,
    warnAt: CLOUD_FAILED_SHARE_WARNING_PERCENT,
    criticalAt: CLOUD_FAILED_SHARE_CRITICAL_PERCENT,
  });
}

// A wait at or above CLOUD_BACKLOG_AGE_SECONDS, read in `secondsPerUnit`.
function backlogAge(data: {
  key: string;
  reason: CloudBacklogReason;
  secondsPerUnit: number;
}): CloudHealthRule {
  return {
    readings: [data.key],
    evaluate: (reader: CloudReadingReader): CloudHealthFinding | null => {
      const value: number | null = reader.value(data.key);

      if (value === null) {
        return null;
      }

      const seconds: number = value * data.secondsPerUnit;

      return seconds >= CLOUD_BACKLOG_AGE_SECONDS
        ? warning(getCloudBacklogText(data.reason, seconds))
        : null;
    },
  };
}

const RDS_ALLOCATED_STORAGE_PROPERTY: string = "AllocatedStorage";
const RDS_FREE_STORAGE_READING: string = "aws/rds/freestoragespace";
const GIB: number = 1024 * 1024 * 1024;

/*
 * A database's storage, from what is free (FreeStorageSpace, bytes) and
 * what was allocated (the inventory's AllocatedStorage, GiB), as the shared
 * storage reading reads it - the one its page draws (getCloudResourceStorage)
 * and its rule judges. Without both there is nothing to compare.
 */
export function getCloudDatabaseStorageUsage(data: {
  freeBytes: number | null;
  allocatedGib: number | null;
}): StorageUsage | null {
  if (
    data.freeBytes === null ||
    data.allocatedGib === null ||
    data.allocatedGib <= 0
  ) {
    return null;
  }
  return getStorageUsage(
    { capacity: data.allocatedGib * GIB, available: data.freeBytes },
    CLOUD_STORAGE_USAGE_THRESHOLDS,
  );
}

/*
 * A database's storage past the storage lines. Without the allocation there
 * is nothing to compare with, and nothing is said.
 */
function storageFromFreeBytes(key: string): CloudHealthRule {
  return {
    readings: [key],
    evaluate: (reader: CloudReadingReader): CloudHealthFinding | null => {
      const usage: StorageUsage | null = getCloudDatabaseStorageUsage({
        freeBytes: reader.value(key),
        allocatedGib: reader.property(RDS_ALLOCATED_STORAGE_PROPERTY),
      });

      if (!usage) {
        return null;
      }

      if (usage.usedPercent >= CLOUD_STORAGE_FULL_PERCENT) {
        return critical(percentText(REASON_STORAGE_FULL, usage.usedPercent));
      }

      return usage.usedPercent >= CLOUD_STORAGE_HIGH_PERCENT
        ? warning(percentText(REASON_STORAGE_FULL, usage.usedPercent))
        : null;
    },
  };
}

/*
 * ---------------------------------------------------------------------------
 * A resource's storage, as its page draws it (#9648)
 * ---------------------------------------------------------------------------
 *
 * Where its cloud says how big a store is - an RDS database's allocated
 * storage, an EBS volume's or an Azure managed disk's size - its page draws
 * it with the shared storage bar. A database's free space is in its
 * metrics, so it reads how full it is. How much of a disk is used is known
 * only inside the machine it is attached to (the guest's filesystem), so a
 * disk's page says its size and says so, never an empty bar. An Aurora
 * instance keeps its data in its cluster's volume, which grows as it needs:
 * it has no allocation to fill.
 */
export interface CloudResourceStorage {
  // How full it is, where its cloud says what is free.
  usage: StorageUsage | null;
  // Its size, whatever is known of what it holds.
  capacityBytes: number;
  // English, looked up where it is drawn: why there is no reading.
  noUsageText?: string | undefined;
}

export const CLOUD_DISK_USAGE_INSIDE_GUEST: string = translationKey(
  "How much of it is used is known only inside the machine it is attached to.",
);
export const CLOUD_STORAGE_NOT_REPORTED: string =
  translationKey("Not reported");

// A disk's size as its inventory keeps it, in GiB, by its type.
const CLOUD_DISK_SIZE_GIB_PROPERTIES: Record<string, string> = {
  "AWS::EC2::Volume": "Size",
  "Microsoft.Compute/disks": "diskSizeGB",
};

export function getCloudResourceStorage(data: {
  type: string;
  properties: unknown;
  readings: CloudResourceReadings;
}): CloudResourceStorage | null {
  if (data.type === "AWS::RDS::DBInstance") {
    const engine: string = String(
      ((data.properties || {}) as Record<string, unknown>)["Engine"] || "",
    );
    if (engine.toLowerCase().startsWith("aurora")) {
      return null;
    }
    const allocatedGib: number | null = readProperty(
      data.properties,
      RDS_ALLOCATED_STORAGE_PROPERTY,
    );
    if (allocatedGib === null || allocatedGib <= 0) {
      return null;
    }
    const usage: StorageUsage | null = getCloudDatabaseStorageUsage({
      freeBytes: data.readings[RDS_FREE_STORAGE_READING]?.value ?? null,
      allocatedGib: allocatedGib,
    });
    return {
      usage: usage,
      capacityBytes: allocatedGib * GIB,
      noUsageText: usage ? undefined : CLOUD_STORAGE_NOT_REPORTED,
    };
  }

  const sizeProperty: string | undefined =
    CLOUD_DISK_SIZE_GIB_PROPERTIES[data.type];
  if (sizeProperty) {
    const sizeGib: number | null = readProperty(data.properties, sizeProperty);
    if (sizeGib === null || sizeGib <= 0) {
      return null;
    }
    return {
      usage: null,
      capacityBytes: sizeGib * GIB,
      noUsageText: CLOUD_DISK_USAGE_INSIDE_GUEST,
    };
  }

  return null;
}

function storagePercent(key: string, scale?: number): CloudHealthRule {
  return percentAtOrAbove({
    key,
    reason: REASON_STORAGE_FULL,
    warnAt: CLOUD_STORAGE_HIGH_PERCENT,
    criticalAt: CLOUD_STORAGE_FULL_PERCENT,
    scale,
  });
}

function cpuHigh(key: string, scale?: number): CloudHealthRule {
  return percentAtOrAbove({
    key,
    reason: REASON_CPU_HIGH,
    warnAt: CLOUD_CPU_HIGH_PERCENT,
    scale,
  });
}

function memoryHigh(key: string, scale?: number): CloudHealthRule {
  return percentAtOrAbove({
    key,
    reason: REASON_MEMORY_USED,
    warnAt: CLOUD_MEMORY_HIGH_PERCENT,
    scale,
  });
}

function availability(key: string, reason?: string): CloudHealthRule {
  return percentBelow({
    key,
    reason: reason || REASON_AVAILABILITY_LOW,
    warnBelow: CLOUD_AVAILABILITY_LOW_PERCENT,
    criticalBelow: CLOUD_AVAILABILITY_DOWN_PERCENT,
  });
}

const AWS: CloudProvider = CloudProvider.AWS;
const AZURE: CloudProvider = CloudProvider.Azure;
const GCP: CloudProvider = CloudProvider.GCP;

/*
 * A Compute Engine VM's memory and disks, as the Ops Agent on it reports
 * them (CloudKeyMetrics): the share of each in use, 0 to 100.
 */
export const GCP_OPS_AGENT_MEMORY_KEY: string =
  "agent.googleapis.com/memory/percent_used";
export const GCP_OPS_AGENT_DISK_KEY: string =
  "agent.googleapis.com/disk/percent_used";

/*
 * Readings of a metric a resource reports as several series of one time,
 * one for each part of it - the Ops Agent's disk use, a series for each of
 * a VM's disks - that read as the highest of them: the fullest disk is the
 * one its rule judges and its page leads with. Any other metric's reading
 * is its first series of the newest time, or, split by a dimension, their
 * sum (CloudResourceReadings).
 */
const CLOUD_READINGS_OF_THEIR_HIGHEST_SERIES: ReadonlySet<string> =
  new Set<string>([`${GCP}|${GCP_OPS_AGENT_DISK_KEY}`]);

export function isCloudReadingTheHighestOfItsSeries(
  provider: string,
  key: string,
): boolean {
  return CLOUD_READINGS_OF_THEIR_HIGHEST_SERIES.has(
    `${(provider || "").toLowerCase()}|${(key || "").toLowerCase()}`,
  );
}

export const CLOUD_HEALTH_RULES: ReadonlyArray<CloudHealthTypeRules> = [
  // ---- AWS ----------------------------------------------------------------
  {
    provider: AWS,
    types: ["AWS::EC2::Instance"],
    rules: [
      failsWhenAboveZero(
        "aws/ec2/statuscheckfailed",
        REASON_STATUS_CHECKS_FAILING,
      ),
    ],
  },
  {
    provider: AWS,
    types: ["AWS::ElasticLoadBalancing::LoadBalancer"],
    rules: [
      warnsOnCount("aws/elb/unhealthyhostcount", REASON_UNHEALTHY_HOSTS),
      failedShare({
        failures: ["aws/elb/httpcode_backend_5xx"],
        total: "aws/elb/requestcount",
        reason: REASON_REQUESTS_FAILED,
      }),
    ],
  },
  {
    provider: AWS,
    types: ["AWS::ElasticLoadBalancingV2::LoadBalancer"],
    rules: [
      failedShare({
        failures: [
          "aws/applicationelb/httpcode_target_5xx_count",
          "aws/applicationelb/httpcode_elb_5xx_count",
        ],
        total: "aws/applicationelb/requestcount",
        reason: REASON_REQUESTS_FAILED,
      }),
    ],
  },
  {
    provider: AWS,
    types: ["AWS::EC2::NatGateway"],
    rules: [
      warnsWhenAboveZero(
        "aws/natgateway/errorportallocation",
        REASON_PORT_ALLOCATION_ERRORS,
      ),
    ],
  },
  {
    provider: AWS,
    types: ["AWS::EC2::VPNConnection"],
    rules: [failsWhenZero("aws/vpn/tunnelstate", REASON_TUNNELS_DOWN)],
  },
  {
    provider: AWS,
    types: ["AWS::CloudFront::Distribution"],
    rules: [
      failedPercent("aws/cloudfront/5xxerrorrate", REASON_REQUESTS_FAILED),
    ],
  },
  {
    provider: AWS,
    types: ["AWS::Route53::HealthCheck"],
    rules: [
      failsWhenZero(
        "aws/route53/healthcheckstatus",
        REASON_HEALTH_CHECK_FAILING,
      ),
    ],
  },
  {
    provider: AWS,
    types: ["AWS::EFS::FileSystem"],
    rules: [
      percentAtOrAbove({
        key: "aws/efs/percentiolimit",
        reason: REASON_IO_LIMIT,
        warnAt: 95,
      }),
    ],
  },
  {
    provider: AWS,
    types: ["AWS::ECS::Service", "AWS::ECS::Cluster"],
    rules: [memoryHigh("aws/ecs/memoryutilization")],
  },
  {
    provider: AWS,
    types: ["AWS::Lambda::Function"],
    rules: [
      failedShare({
        failures: ["aws/lambda/errors"],
        total: "aws/lambda/invocations",
        reason: REASON_INVOCATIONS_FAILED,
      }),
      warnsWhenAboveZero("aws/lambda/throttles", REASON_THROTTLED),
    ],
  },
  {
    provider: AWS,
    types: ["AWS::StepFunctions::StateMachine"],
    rules: [
      warnsOnCount("aws/states/executionsfailed", REASON_FAILED_EXECUTIONS),
    ],
  },
  {
    provider: AWS,
    types: ["AWS::RDS::DBInstance"],
    rules: [
      storageFromFreeBytes("aws/rds/freestoragespace"),
      cpuHigh("aws/rds/cpuutilization"),
    ],
  },
  {
    provider: AWS,
    types: ["AWS::RDS::DBCluster"],
    rules: [cpuHigh("aws/rds/cpuutilization")],
  },
  {
    provider: AWS,
    types: ["AWS::DocDB::DBInstance", "AWS::DocDB::DBCluster"],
    rules: [cpuHigh("aws/docdb/cpuutilization")],
  },
  {
    provider: AWS,
    types: ["AWS::DynamoDB::Table"],
    rules: [
      warnsWhenAnyAboveZero(
        ["aws/dynamodb/readthrottleevents", "aws/dynamodb/writethrottleevents"],
        REASON_THROTTLED,
      ),
    ],
  },
  {
    provider: AWS,
    types: [
      "AWS::ElastiCache::CacheCluster",
      "AWS::ElastiCache::ReplicationGroup",
      "AWS::ElastiCache::ServerlessCache",
    ],
    rules: [
      cpuHigh("aws/elasticache/cpuutilization"),
      memoryHigh("aws/elasticache/databasememoryusagepercentage"),
    ],
  },
  {
    provider: AWS,
    types: ["AWS::Redshift::Cluster"],
    rules: [
      storagePercent("aws/redshift/percentagediskspaceused"),
      cpuHigh("aws/redshift/cpuutilization"),
    ],
  },
  {
    provider: AWS,
    types: ["AWS::OpenSearchService::Domain"],
    rules: [
      failsWhenAboveZero("aws/es/clusterstatus.red", REASON_CLUSTER_RED),
      cpuHigh("aws/es/cpuutilization"),
    ],
  },
  {
    provider: AWS,
    types: ["AWS::SQS::Queue"],
    rules: [
      backlogAge({
        key: "aws/sqs/approximateageofoldestmessage",
        reason: REASON_OLDEST_MESSAGE_WAITING,
        secondsPerUnit: 1,
      }),
    ],
  },
  {
    provider: AWS,
    types: ["AWS::SNS::Topic"],
    rules: [
      warnsOnCount(
        "aws/sns/numberofnotificationsfailed",
        REASON_FAILED_DELIVERIES,
      ),
    ],
  },
  {
    provider: AWS,
    types: ["AWS::Kinesis::Stream"],
    rules: [
      backlogAge({
        key: "aws/kinesis/getrecords.iteratoragemilliseconds",
        reason: REASON_CONSUMERS_BEHIND,
        secondsPerUnit: 0.001,
      }),
    ],
  },
  {
    provider: AWS,
    types: ["AWS::KinesisFirehose::DeliveryStream"],
    rules: [
      {
        readings: ["aws/firehose/deliverytos3.success"],
        evaluate: (reader: CloudReadingReader): CloudHealthFinding | null => {
          const value: number | null = reader.value(
            "aws/firehose/deliverytos3.success",
          );
          // The share of records delivered, 0 to 1: under 99% some failed.
          return value !== null && value < 0.99
            ? warning({ text: REASON_DELIVERIES_FAILING })
            : null;
        },
      },
    ],
  },
  {
    provider: AWS,
    types: ["AWS::ApiGateway::RestApi"],
    rules: [
      failedShare({
        failures: ["aws/apigateway/5xxerror"],
        total: "aws/apigateway/count",
        reason: REASON_REQUESTS_FAILED,
      }),
    ],
  },
  {
    // An HTTP API counts its server errors as 5xx, a REST API as 5XXError.
    provider: AWS,
    types: ["AWS::ApiGatewayV2::Api"],
    rules: [
      failedShare({
        failures: ["aws/apigateway/5xx"],
        total: "aws/apigateway/count",
        reason: REASON_REQUESTS_FAILED,
      }),
    ],
  },
  {
    provider: AWS,
    types: ["AWS::Events::Rule"],
    rules: [
      warnsOnCount("aws/events/failedinvocations", REASON_FAILED_INVOCATIONS),
    ],
  },
  {
    provider: AWS,
    types: ["AWS::AmazonMQ::Broker"],
    rules: [cpuHigh("aws/amazonmq/cpuutilization")],
  },
  {
    provider: AWS,
    types: ["AWS::MSK::Cluster"],
    rules: [
      failsWhenZero("aws/kafka/activecontrollercount", REASON_NO_CONTROLLER),
    ],
  },
  /*
   * The types read since #9567 (#9692): each judged by what its key
   * metrics say of it being well.
   */
  {
    provider: AWS,
    types: ["AWS::AppRunner::Service"],
    rules: [
      failedShare({
        failures: ["aws/apprunner/5xxstatusresponses"],
        total: "aws/apprunner/requests",
        reason: REASON_REQUESTS_FAILED,
      }),
    ],
  },
  {
    /*
     * An accelerator with no healthy endpoint sends its traffic nowhere; one
     * with some unhealthy sends it to fewer.
     */
    provider: AWS,
    types: ["AWS::GlobalAccelerator::Accelerator"],
    rules: [
      failsWhenZero(
        "aws/globalaccelerator/healthyendpointcount",
        REASON_NOT_AVAILABLE,
      ),
      warnsOnCount(
        "aws/globalaccelerator/unhealthyendpointcount",
        REASON_UNHEALTHY_ENDPOINTS,
      ),
    ],
  },
  {
    provider: AWS,
    types: ["AWS::ElasticBeanstalk::Environment"],
    rules: [
      {
        readings: ["aws/elasticbeanstalk/environmenthealth"],
        evaluate: (reader: CloudReadingReader): CloudHealthFinding | null => {
          const health: number | null = reader.value(
            "aws/elasticbeanstalk/environmenthealth",
          );

          if (health !== null && health >= CLOUD_BEANSTALK_HEALTH_SEVERE) {
            return critical({ text: REASON_ENVIRONMENT_HEALTH_SEVERE });
          }

          return health !== null && health >= CLOUD_BEANSTALK_HEALTH_DEGRADED
            ? warning({ text: REASON_ENVIRONMENT_HEALTH_DEGRADED })
            : null;
        },
      },
    ],
  },
  {
    /*
     * A group with fewer instances in service than it wants, in one period:
     * a whole instance short, so a period half spent launching one is not.
     */
    provider: AWS,
    types: ["AWS::AutoScaling::AutoScalingGroup"],
    rules: [
      {
        readings: [
          "aws/autoscaling/groupinserviceinstances",
          "aws/autoscaling/groupdesiredcapacity",
        ],
        evaluate: (reader: CloudReadingReader): CloudHealthFinding | null => {
          const desired: number | null = reader.value(
            "aws/autoscaling/groupdesiredcapacity",
          );
          const inService: number | null = reader.value(
            "aws/autoscaling/groupinserviceinstances",
          );

          if (desired === null || inService === null) {
            return null;
          }

          // Two periods' readings say nothing of each other.
          if (
            inService > 0 &&
            reader.aligned(
              "aws/autoscaling/groupinserviceinstances",
              "aws/autoscaling/groupdesiredcapacity",
            ) !== inService
          ) {
            return null;
          }

          const short: number = Math.floor(desired - inService);

          return short >= 1
            ? warning(countText(REASON_SHORT_OF_DESIRED_CAPACITY, short))
            : null;
        },
      },
    ],
  },
  {
    /*
     * A web ACL blocking half its requests or more, once it blocked
     * CLOUD_HEALTH_MIN_REQUESTS of them: an attack, or a rule turning real
     * users away - a quiet ACL's few blocked scans are neither. Its requests
     * are what it allowed and what it blocked; each is published only when
     * it is not zero. Its recommended monitor judges the same.
     */
    provider: AWS,
    types: ["AWS::WAFv2::WebACL"],
    rules: [
      {
        readings: ["aws/wafv2/allowedrequests", "aws/wafv2/blockedrequests"],
        evaluate: (reader: CloudReadingReader): CloudHealthFinding | null => {
          const blocked: number | null = reader.value(
            "aws/wafv2/blockedrequests",
          );

          if (blocked === null) {
            return null;
          }

          const total: number =
            blocked +
            reader.aligned(
              "aws/wafv2/allowedrequests",
              "aws/wafv2/blockedrequests",
            );

          if (blocked < CLOUD_HEALTH_MIN_REQUESTS) {
            return null;
          }

          const percent: number = Math.min(100, (blocked / total) * 100);

          return percent >= CLOUD_BLOCKED_SHARE_WARNING_PERCENT
            ? warning(percentText(REASON_REQUESTS_BLOCKED, percent))
            : null;
        },
      },
    ],
  },
  {
    // An endpoint's invocations of each production variant, added up.
    provider: AWS,
    types: ["AWS::SageMaker::Endpoint"],
    rules: [
      failedShare({
        failures: ["aws/sagemaker/invocation5xxerrors"],
        total: "aws/sagemaker/invocations",
        reason: REASON_INVOCATIONS_FAILED,
      }),
    ],
  },
  {
    /*
     * A firewall drops what its rules say to; OtherDroppedPackets are the
     * packets it dropped for anything else - throttled by traffic it could
     * not keep up with, among others.
     */
    provider: AWS,
    types: ["AWS::NetworkFirewall::Firewall"],
    rules: [
      warnsOnCount(
        "aws/networkfirewall/otherdroppedpackets",
        REASON_PACKETS_DROPPED_OUTSIDE_RULES,
      ),
    ],
  },
  {
    // A user pool's sign-ins, token refreshes or sign-ups turned away for its quota.
    provider: AWS,
    types: ["AWS::Cognito::UserPool"],
    rules: [
      warnsWhenAnyAboveZero(
        [
          "aws/cognito/signinthrottles",
          "aws/cognito/tokenrefreshthrottles",
          "aws/cognito/signupthrottles",
        ],
        REASON_THROTTLED,
      ),
    ],
  },
  {
    provider: AWS,
    types: ["AWS::AppSync::GraphQLApi"],
    rules: [warnsOnCount("aws/appsync/5xxerror", REASON_SERVER_ERRORS)],
  },
  // ---- Azure --------------------------------------------------------------
  {
    provider: AZURE,
    types: ["Microsoft.Compute/virtualMachines"],
    rules: [failsWhenZero("vmavailabilitymetric", REASON_NOT_AVAILABLE)],
  },
  {
    provider: AZURE,
    types: ["Microsoft.Web/sites"],
    rules: [
      failedShare({
        failures: ["http5xx"],
        total: "requests",
        reason: REASON_REQUESTS_FAILED,
      }),
      /*
       * Its Health check (#9740): the share of its instances whose health
       * check passes, 100 while all do. Azure counts an instance failing
       * only once it is deemed unhealthy - by default 10 failed pings, a
       * minute apart - and takes it out of the load balancer then, up to
       * half of them: past half, unhealthy instances still take requests.
       */
      percentBelow({
        key: APP_SERVICE_HEALTH_CHECK_KEY,
        reason: REASON_HEALTH_CHECK_FAILING,
        warnBelow: 100,
        criticalBelow: CLOUD_HEALTH_CHECK_CRITICAL_PERCENT,
      }),
    ],
  },
  {
    // A site's deployment slot (#6793), judged by its own answers as a site is.
    provider: AZURE,
    types: ["Microsoft.Web/sites/slots"],
    rules: [
      failedShare({
        failures: ["http5xx"],
        total: "requests",
        reason: REASON_REQUESTS_FAILED,
      }),
    ],
  },
  {
    provider: AZURE,
    types: ["Microsoft.Web/serverfarms"],
    rules: [memoryHigh("memorypercentage")],
  },
  {
    provider: AZURE,
    types: ["Microsoft.Sql/servers/databases"],
    rules: [
      storagePercent("storage_percent"),
      cpuHigh("cpu_percent"),
      percentAtOrAbove({
        key: "dtu_consumption_percent",
        reason: REASON_DTU_HIGH,
        warnAt: 95,
      }),
      percentAtOrAbove({
        key: "sessions_percent",
        reason: REASON_SESSIONS_HIGH,
        warnAt: 90,
      }),
      warnsOnCount("connection_failed", REASON_FAILED_CONNECTIONS),
      warnsOnCount("deadlock", REASON_DEADLOCKS),
    ],
  },
  {
    provider: AZURE,
    types: ["Microsoft.Sql/servers/elasticpools"],
    rules: [storagePercent("storage_percent"), cpuHigh("cpu_percent")],
  },
  {
    provider: AZURE,
    types: ["Microsoft.Sql/managedInstances"],
    rules: [cpuHigh("avg_cpu_percent")],
  },
  {
    provider: AZURE,
    types: ["Microsoft.DBforPostgreSQL/flexibleServers"],
    rules: [
      storagePercent("storage_percent"),
      cpuHigh("cpu_percent"),
      memoryHigh("memory_percent"),
      warnsOnCount("connections_failed", REASON_FAILED_CONNECTIONS),
    ],
  },
  {
    provider: AZURE,
    types: ["Microsoft.DBforMySQL/flexibleServers"],
    rules: [
      storagePercent("storage_percent"),
      cpuHigh("cpu_percent"),
      memoryHigh("memory_percent"),
      warnsOnCount("aborted_connections", REASON_FAILED_CONNECTIONS),
    ],
  },
  {
    provider: AZURE,
    types: ["Microsoft.DocumentDB/databaseAccounts"],
    rules: [
      percentAtOrAbove({
        key: "normalizedruconsumption",
        reason: REASON_REQUEST_UNITS_HIGH,
        warnAt: 100,
      }),
    ],
  },
  {
    provider: AZURE,
    types: ["Microsoft.Cache/redis"],
    rules: [
      percentAtOrAbove({
        key: "serverload",
        reason: REASON_SERVER_LOAD_HIGH,
        warnAt: 90,
      }),
      memoryHigh("usedmemorypercentage"),
    ],
  },
  {
    provider: AZURE,
    types: ["Microsoft.Storage/storageAccounts", "Microsoft.KeyVault/vaults"],
    rules: [availability("availability")],
  },
  {
    provider: AZURE,
    types: ["Microsoft.ServiceBus/namespaces"],
    rules: [
      warnsOnCount("deadletteredmessages", REASON_DEAD_LETTERED),
      warnsOnCount("servererrors", REASON_SERVER_ERRORS),
      warnsWhenAboveZero("throttledrequests", REASON_THROTTLED),
    ],
  },
  {
    provider: AZURE,
    types: ["Microsoft.EventHub/namespaces"],
    rules: [
      warnsOnCount("servererrors", REASON_SERVER_ERRORS),
      warnsWhenAboveZero("throttledrequests", REASON_THROTTLED),
    ],
  },
  {
    provider: AZURE,
    types: ["Microsoft.App/containerApps"],
    rules: [warnsOnCount("restartcount", REASON_RESTARTS)],
  },
  {
    provider: AZURE,
    types: ["Microsoft.Network/loadBalancers"],
    rules: [
      availability("vipavailability"),
      percentBelow({
        key: "dipavailability",
        reason: REASON_PROBES_FAILING,
        warnBelow: 100,
        criticalBelow: 50,
      }),
    ],
  },
  {
    provider: AZURE,
    types: ["Microsoft.Network/applicationGateways"],
    rules: [
      warnsOnCount("unhealthyhostcount", REASON_UNHEALTHY_HOSTS),
      failedShare({
        failures: ["failedrequests"],
        total: "totalrequests",
        reason: REASON_REQUESTS_FAILED,
      }),
    ],
  },
  {
    provider: AZURE,
    types: ["Microsoft.Network/publicIPAddresses"],
    rules: [failsWhenAboveZero("ifunderddosattack", REASON_DDOS)],
  },
  {
    provider: AZURE,
    types: ["Microsoft.Network/azureFirewalls"],
    rules: [
      percentBelow({
        key: "firewallhealth",
        reason: REASON_FIREWALL_HEALTH,
        warnBelow: 100,
        criticalBelow: 50,
      }),
      percentAtOrAbove({
        key: "snatportutilization",
        reason: REASON_PORTS_HIGH,
        warnAt: 95,
      }),
    ],
  },
  {
    provider: AZURE,
    types: ["Microsoft.Network/natGateways"],
    rules: [availability("datapathavailability")],
  },
  {
    provider: AZURE,
    types: ["Microsoft.Cdn/profiles"],
    rules: [failedPercent("percentage5xx", REASON_REQUESTS_FAILED)],
  },
  {
    provider: AZURE,
    types: ["Microsoft.ApiManagement/service"],
    rules: [
      percentAtOrAbove({
        key: "capacity",
        reason: REASON_CAPACITY_HIGH,
        warnAt: 90,
      }),
    ],
  },
  {
    provider: AZURE,
    types: ["Microsoft.CognitiveServices/accounts"],
    rules: [
      failedShare({
        failures: ["totalerrors"],
        total: "totalcalls",
        reason: REASON_REQUESTS_FAILED,
      }),
    ],
  },
  {
    provider: AZURE,
    types: ["Microsoft.Logic/workflows"],
    rules: [warnsOnCount("runsfailed", REASON_FAILED_RUNS)],
  },
  {
    provider: AZURE,
    types: ["Microsoft.DataFactory/factories"],
    rules: [warnsOnCount("pipelinefailedruns", REASON_FAILED_RUNS)],
  },
  // ---- Google Cloud -------------------------------------------------------
  {
    /*
     * How full a VM's memory and disks are, which only the Ops Agent on it
     * reports: a VM without it is not judged by them. Its disks' reading is
     * the fullest of them (CLOUD_READINGS_OF_THEIR_HIGHEST_SERIES).
     */
    provider: GCP,
    types: ["gce_instance"],
    rules: [
      memoryHigh(GCP_OPS_AGENT_MEMORY_KEY),
      storagePercent(GCP_OPS_AGENT_DISK_KEY),
    ],
  },
  {
    provider: GCP,
    types: ["cloudsql_database"],
    rules: [
      storagePercent("cloudsql.googleapis.com/database/disk/utilization", 100),
      cpuHigh("cloudsql.googleapis.com/database/cpu/utilization", 100),
      memoryHigh("cloudsql.googleapis.com/database/memory/utilization", 100),
    ],
  },
  {
    provider: GCP,
    types: ["pubsub_subscription"],
    rules: [
      backlogAge({
        key: "pubsub.googleapis.com/subscription/oldest_unacked_message_age",
        reason: REASON_OLDEST_MESSAGE_WAITING,
        secondsPerUnit: 1,
      }),
    ],
  },
  {
    provider: GCP,
    types: ["redis_instance"],
    rules: [memoryHigh("redis.googleapis.com/stats/memory/usage_ratio", 100)],
  },
  {
    provider: GCP,
    types: ["spanner_instance"],
    rules: [
      percentAtOrAbove({
        key: "spanner.googleapis.com/instance/cpu/utilization",
        reason: REASON_CPU_HIGH,
        warnAt: 90,
        scale: 100,
      }),
    ],
  },
];

/*
 * ---------------------------------------------------------------------------
 * What a resource's page leads with
 * ---------------------------------------------------------------------------
 */

/*
 * How a headline reading is drawn:
 *   - percent: the value is a percent ("37%");
 *   - ratio: the value is 0 to 1, drawn as a percent;
 *   - bytes: a size ("12.4 GB");
 *   - count: a whole number of things (connections, hosts, messages);
 *   - seconds / milliseconds: a time, drawn in ms or s;
 *   - perPeriod: a sum over the cloud's period (five minutes on AWS),
 *     drawn per minute;
 *   - perSecond: a rate the cloud already gives per second;
 *   - bytesPerPeriod: bytes summed over the period (traffic), drawn as a
 *     size per minute;
 *   - bytesPerSecond / bitsPerSecond: a rate of bytes, or of bits, the
 *     cloud gives per second, drawn as a size per second.
 */
export type CloudHeadlineFormat =
  | "percent"
  | "ratio"
  | "bytes"
  | "count"
  | "seconds"
  | "milliseconds"
  | "perPeriod"
  | "perSecond"
  | "bytesPerPeriod"
  | "bytesPerSecond"
  | "bitsPerSecond";

/*
 * What a headline needs that its cloud does not report by itself, said in
 * its tile while the last read did not bring it - "Needs the Ops Agent",
 * with the provider's own instructions a click away - rather than "Not
 * reported". English words, looked up in the reader's language.
 */
export interface CloudHeadlineRequirement {
  // Drawn in place of the value.
  note: string;
  // The tile's (i): what it needs, and when it shows once it has it.
  description: string;
  // Where to get it: the provider's own instructions.
  link: { url: string; label: string };
}

export interface CloudHeadlineReading {
  key: string;
  // The tile's title, in English: looked up in the reader's language.
  label: string;
  format: CloudHeadlineFormat;
  /*
   * Only some resources of the type report it: a DTU database's DTUs, a
   * Network Load Balancer's flows, a function app's executions. Its page
   * says nothing of it when the last read did not bring it.
   */
  onlySome?: boolean | undefined;
  /*
   * Readings the tile reads, in order, when the resource has none of `key`:
   * a Cosmos DB account's latency is its direct-mode requests', else its
   * gateway-mode ones' - each client connects one way or the other.
   */
  fallbackKeys?: Array<string> | undefined;
  // What it needs to be reported at all, said while it is not.
  needs?: CloudHeadlineRequirement | undefined;
}

interface CloudHeadlineTypeReadings {
  provider: CloudProvider;
  types: Array<string>;
  readings: Array<CloudHeadlineReading>;
}

function headline(
  key: string,
  label: string,
  format: CloudHeadlineFormat,
  options: {
    onlySome?: boolean;
    fallbackKeys?: Array<string>;
    needs?: CloudHeadlineRequirement;
  } = {},
): CloudHeadlineReading {
  return {
    key,
    label,
    format,
    ...(options.onlySome ? { onlySome: true } : {}),
    ...(options.fallbackKeys ? { fallbackKeys: options.fallbackKeys } : {}),
    ...(options.needs ? { needs: options.needs } : {}),
  };
}

// The keys a headline reads, in order: its own, then its fallbacks.
export function getCloudHeadlineReadingKeys(
  headlineReading: CloudHeadlineReading,
): Array<string> {
  return [headlineReading.key, ...(headlineReading.fallbackKeys || [])];
}

/*
 * The reading a headline shows of a resource's readings, and its key: the
 * first of its keys the resource has (getCloudHeadlineReadingKeys). Null when it
 * has none of them.
 */
export function getCloudHeadlineReadingOf(
  headlineReading: CloudHeadlineReading,
  readings: CloudResourceReadings,
): { key: string; reading: CloudResourceReading } | null {
  for (const key of getCloudHeadlineReadingKeys(headlineReading)) {
    const reading: CloudResourceReading | undefined = readings[key];

    if (reading) {
      return { key, reading };
    }
  }

  return null;
}

/*
 * The formats of a level - how much, how many, how long, right now - which
 * every read of a resource that reports the metric brings. A sum or a rate
 * over the period may be left out when it is zero (CloudWatch writes no 5xx
 * count for a period without one), so a missing one says nothing.
 */
const CLOUD_LEVEL_FORMATS: ReadonlySet<CloudHeadlineFormat> =
  new Set<CloudHeadlineFormat>([
    "percent",
    "ratio",
    "bytes",
    "count",
    "seconds",
    "milliseconds",
  ]);

/*
 * Whether a fresh read that did not bring this reading says something: a
 * level every resource of the type reports, so its page says "Not
 * reported" rather than leaving it out without a word.
 */
export function isCloudHeadlineExpected(
  headline: CloudHeadlineReading,
): boolean {
  return !headline.onlySome && CLOUD_LEVEL_FORMATS.has(headline.format);
}

/*
 * A VM's memory and disk use, which Google Cloud reads only from the Ops
 * Agent on the VM: what its tiles say while the last read brought neither.
 */
export const HEADLINE_NEEDS_OPS_AGENT: string = translationKey(
  "Needs the Ops Agent",
);
export const HEADLINE_NEEDS_OPS_AGENT_DESCRIPTION: string = translationKey(
  "Google Cloud reads a VM's memory and disk use only from the Ops Agent on it. Once the agent runs, they show here within an hour.",
);
export const HEADLINE_INSTALL_OPS_AGENT: string = translationKey(
  "Install the Ops Agent",
);

const NEEDS_OPS_AGENT: CloudHeadlineRequirement = {
  note: HEADLINE_NEEDS_OPS_AGENT,
  description: HEADLINE_NEEDS_OPS_AGENT_DESCRIPTION,
  link: { url: GCP_OPS_AGENT_INSTALL_URL, label: HEADLINE_INSTALL_OPS_AGENT },
};

export const HEADLINE_CPU: string = translationKey("CPU");
export const HEADLINE_MEMORY: string = translationKey("Memory");
export const HEADLINE_STORAGE_USED: string = translationKey("Storage used");
export const HEADLINE_FREE_STORAGE: string = translationKey("Free storage");
export const HEADLINE_CONNECTIONS: string = translationKey("Connections");
export const HEADLINE_REQUESTS: string = translationKey("Requests");
export const HEADLINE_INVOCATIONS: string = translationKey("Invocations");
export const HEADLINE_ERRORS: string = translationKey("Errors");
export const HEADLINE_LATENCY: string = translationKey("Latency");
export const HEADLINE_RESPONSE_TIME: string = translationKey("Response time");
export const HEADLINE_DURATION: string = translationKey("Duration");
export const HEADLINE_MESSAGES_WAITING: string =
  translationKey("Messages waiting");
export const HEADLINE_OLDEST_MESSAGE: string = translationKey("Oldest message");
export const HEADLINE_UNHEALTHY_HOSTS: string =
  translationKey("Unhealthy hosts");
export const HEADLINE_AVAILABILITY: string = translationKey("Availability");
export const HEADLINE_SERVER_LOAD: string = translationKey("Server load");
export const HEADLINE_NETWORK_IN: string = translationKey("Network in");
export const HEADLINE_NETWORK_OUT: string = translationKey("Network out");
export const HEADLINE_DISK_READ: string = translationKey("Disk read");
export const HEADLINE_DISK_WRITE: string = translationKey("Disk write");
export const HEADLINE_FREE_MEMORY: string = translationKey("Free memory");
export const HEADLINE_TRAFFIC: string = translationKey("Traffic");
export const HEADLINE_THROUGHPUT: string = translationKey("Throughput");
export const HEADLINE_HEALTHY_BACKENDS: string =
  translationKey("Healthy backends");
export const HEADLINE_MESSAGES_IN: string = translationKey("Messages in");
export const HEADLINE_MESSAGES_OUT: string = translationKey("Messages out");
export const HEADLINE_DEAD_LETTERED: string = translationKey(
  "Dead-lettered messages",
);
export const HEADLINE_PODS_READY: string = translationKey("Pods ready");
export const HEADLINE_RESTARTS: string = translationKey("Restarts");
export const HEADLINE_REQUEST_UNITS: string = translationKey("Request units");
export const HEADLINE_SESSIONS: string = translationKey("Sessions");
export const HEADLINE_READ_OPERATIONS: string =
  translationKey("Read operations");
export const HEADLINE_WRITE_OPERATIONS: string =
  translationKey("Write operations");
export const HEADLINE_READ_LATENCY: string = translationKey("Read latency");
export const HEADLINE_WRITE_LATENCY: string = translationKey("Write latency");
export const HEADLINE_INSTANCES: string = translationKey("Instances");
export const HEADLINE_CAPACITY: string = translationKey("Capacity");
export const HEADLINE_RUNS: string = translationKey("Runs");
export const HEADLINE_FAILED_RUNS: string = translationKey("Failed runs");
export const HEADLINE_HEALTH: string = translationKey("Health");
export const HEADLINE_THROTTLED: string = translationKey("Throttled");
export const HEADLINE_QUEUE_LENGTH: string = translationKey("Queue length");
export const HEADLINE_PORTS_USED: string = translationKey(
  "Outbound ports used",
);
export const HEADLINE_HEALTHY_ENDPOINTS: string =
  translationKey("Healthy endpoints");
export const HEADLINE_UNHEALTHY_ENDPOINTS: string = translationKey(
  "Unhealthy endpoints",
);
export const HEADLINE_ALLOWED_REQUESTS: string =
  translationKey("Allowed requests");
export const HEADLINE_BLOCKED_REQUESTS: string =
  translationKey("Blocked requests");
export const HEADLINE_PACKETS_RECEIVED: string =
  translationKey("Packets received");
export const HEADLINE_PACKETS_DROPPED: string =
  translationKey("Packets dropped");
export const HEADLINE_SIGN_INS: string = translationKey("Sign-ins");
// A Cosmos DB account's storage: its data, its indexes, its documents.
export const HEADLINE_DATA_SIZE: string = translationKey("Data size");
export const HEADLINE_INDEX_SIZE: string = translationKey("Index size");
export const HEADLINE_DOCUMENTS: string = translationKey("Documents");

/*
 * What each type's page leads with, in the order its tiles are drawn: what
 * a person reads first about one of its kind - a machine's CPU, memory,
 * network and disks; a database's CPU, storage and connections; a load
 * balancer's traffic and backends; an app's requests, response time and
 * errors - from the key metrics its connection reads (CloudKeyMetrics).
 */
export const CLOUD_HEADLINE_READINGS: ReadonlyArray<CloudHeadlineTypeReadings> =
  [
    // ---- AWS --------------------------------------------------------------
    {
      provider: AWS,
      types: ["AWS::EC2::Instance"],
      readings: [
        headline("aws/ec2/cpuutilization", HEADLINE_CPU, "percent"),
        headline("aws/ec2/networkin", HEADLINE_NETWORK_IN, "bytesPerPeriod"),
        headline("aws/ec2/networkout", HEADLINE_NETWORK_OUT, "bytesPerPeriod"),
      ],
    },
    {
      provider: AWS,
      types: ["AWS::EC2::Volume"],
      readings: [
        headline(
          "aws/ebs/volumereadops",
          HEADLINE_READ_OPERATIONS,
          "perPeriod",
        ),
        headline(
          "aws/ebs/volumewriteops",
          HEADLINE_WRITE_OPERATIONS,
          "perPeriod",
        ),
        headline("aws/ebs/volumequeuelength", HEADLINE_QUEUE_LENGTH, "count"),
      ],
    },
    {
      provider: AWS,
      types: ["AWS::EC2::NatGateway"],
      readings: [
        headline(
          "aws/natgateway/activeconnectioncount",
          HEADLINE_CONNECTIONS,
          "count",
        ),
        headline(
          "aws/natgateway/bytesouttodestination",
          HEADLINE_TRAFFIC,
          "bytesPerPeriod",
        ),
      ],
    },
    {
      provider: AWS,
      types: ["AWS::ElasticLoadBalancing::LoadBalancer"],
      readings: [
        headline("aws/elb/requestcount", HEADLINE_REQUESTS, "perPeriod"),
        headline("aws/elb/latency", HEADLINE_LATENCY, "seconds"),
        headline(
          "aws/elb/unhealthyhostcount",
          HEADLINE_UNHEALTHY_HOSTS,
          "count",
        ),
      ],
    },
    {
      provider: AWS,
      /*
       * An Application Load Balancer and a Network Load Balancer are one
       * type: each reports its own namespace's metrics, never the other's.
       */
      types: ["AWS::ElasticLoadBalancingV2::LoadBalancer"],
      readings: [
        headline(
          "aws/applicationelb/requestcount",
          HEADLINE_REQUESTS,
          "perPeriod",
          { onlySome: true },
        ),
        headline(
          "aws/applicationelb/targetresponsetime",
          HEADLINE_RESPONSE_TIME,
          "seconds",
          { onlySome: true },
        ),
        headline(
          "aws/applicationelb/httpcode_target_5xx_count",
          HEADLINE_ERRORS,
          "perPeriod",
          { onlySome: true },
        ),
        headline(
          "aws/networkelb/activeflowcount",
          HEADLINE_CONNECTIONS,
          "count",
          { onlySome: true },
        ),
        headline(
          "aws/networkelb/processedbytes",
          HEADLINE_TRAFFIC,
          "bytesPerPeriod",
          { onlySome: true },
        ),
      ],
    },
    {
      provider: AWS,
      types: ["AWS::CloudFront::Distribution"],
      readings: [
        headline("aws/cloudfront/requests", HEADLINE_REQUESTS, "perPeriod"),
        headline("aws/cloudfront/5xxerrorrate", HEADLINE_ERRORS, "percent"),
        headline(
          "aws/cloudfront/bytesdownloaded",
          HEADLINE_TRAFFIC,
          "bytesPerPeriod",
        ),
      ],
    },
    {
      provider: AWS,
      types: ["AWS::ECS::Service", "AWS::ECS::Cluster"],
      readings: [
        headline("aws/ecs/cpuutilization", HEADLINE_CPU, "percent"),
        headline("aws/ecs/memoryutilization", HEADLINE_MEMORY, "percent"),
      ],
    },
    {
      provider: AWS,
      types: ["AWS::Lambda::Function"],
      readings: [
        headline("aws/lambda/invocations", HEADLINE_INVOCATIONS, "perPeriod"),
        headline("aws/lambda/errors", HEADLINE_ERRORS, "perPeriod"),
        headline("aws/lambda/duration", HEADLINE_DURATION, "milliseconds"),
        headline("aws/lambda/throttles", HEADLINE_THROTTLED, "perPeriod"),
      ],
    },
    {
      provider: AWS,
      types: ["AWS::StepFunctions::StateMachine"],
      readings: [
        headline("aws/states/executionsstarted", HEADLINE_RUNS, "perPeriod"),
        headline(
          "aws/states/executionsfailed",
          HEADLINE_FAILED_RUNS,
          "perPeriod",
        ),
        headline("aws/states/executiontime", HEADLINE_DURATION, "milliseconds"),
      ],
    },
    {
      provider: AWS,
      types: ["AWS::RDS::DBInstance"],
      readings: [
        headline("aws/rds/cpuutilization", HEADLINE_CPU, "percent"),
        // An Aurora instance keeps its data in its cluster's volume.
        headline("aws/rds/freestoragespace", HEADLINE_FREE_STORAGE, "bytes", {
          onlySome: true,
        }),
        headline("aws/rds/databaseconnections", HEADLINE_CONNECTIONS, "count"),
        headline("aws/rds/freeablememory", HEADLINE_FREE_MEMORY, "bytes"),
        headline("aws/rds/readlatency", HEADLINE_READ_LATENCY, "seconds"),
        headline("aws/rds/writelatency", HEADLINE_WRITE_LATENCY, "seconds"),
      ],
    },
    {
      provider: AWS,
      types: ["AWS::RDS::DBCluster"],
      readings: [
        headline("aws/rds/cpuutilization", HEADLINE_CPU, "percent"),
        headline("aws/rds/databaseconnections", HEADLINE_CONNECTIONS, "count"),
      ],
    },
    {
      provider: AWS,
      types: ["AWS::DocDB::DBInstance", "AWS::DocDB::DBCluster"],
      readings: [
        headline("aws/docdb/cpuutilization", HEADLINE_CPU, "percent"),
        headline(
          "aws/docdb/databaseconnections",
          HEADLINE_CONNECTIONS,
          "count",
        ),
        headline("aws/docdb/freeablememory", HEADLINE_FREE_MEMORY, "bytes"),
      ],
    },
    {
      provider: AWS,
      types: ["AWS::Redshift::Cluster"],
      readings: [
        headline("aws/redshift/cpuutilization", HEADLINE_CPU, "percent"),
        headline(
          "aws/redshift/percentagediskspaceused",
          HEADLINE_STORAGE_USED,
          "percent",
        ),
        headline(
          "aws/redshift/databaseconnections",
          HEADLINE_CONNECTIONS,
          "count",
        ),
      ],
    },
    {
      provider: AWS,
      types: [
        "AWS::ElastiCache::CacheCluster",
        "AWS::ElastiCache::ReplicationGroup",
        "AWS::ElastiCache::ServerlessCache",
      ],
      readings: [
        headline("aws/elasticache/cpuutilization", HEADLINE_CPU, "percent"),
        // Redis and Valkey say how full they are; Memcached does not.
        headline(
          "aws/elasticache/databasememoryusagepercentage",
          HEADLINE_MEMORY,
          "percent",
          { onlySome: true },
        ),
        headline(
          "aws/elasticache/currconnections",
          HEADLINE_CONNECTIONS,
          "count",
        ),
      ],
    },
    {
      provider: AWS,
      types: ["AWS::SQS::Queue"],
      readings: [
        headline(
          "aws/sqs/approximatenumberofmessagesvisible",
          HEADLINE_MESSAGES_WAITING,
          "count",
        ),
        headline(
          "aws/sqs/approximateageofoldestmessage",
          HEADLINE_OLDEST_MESSAGE,
          "seconds",
        ),
        headline(
          "aws/sqs/numberofmessagessent",
          HEADLINE_MESSAGES_IN,
          "perPeriod",
        ),
      ],
    },
    {
      provider: AWS,
      types: ["AWS::SNS::Topic"],
      readings: [
        headline(
          "aws/sns/numberofmessagespublished",
          HEADLINE_MESSAGES_IN,
          "perPeriod",
        ),
        headline(
          "aws/sns/numberofnotificationsfailed",
          HEADLINE_ERRORS,
          "perPeriod",
        ),
      ],
    },
    {
      provider: AWS,
      types: ["AWS::ApiGateway::RestApi"],
      readings: [
        headline("aws/apigateway/count", HEADLINE_REQUESTS, "perPeriod"),
        headline("aws/apigateway/latency", HEADLINE_LATENCY, "milliseconds"),
        headline("aws/apigateway/5xxerror", HEADLINE_ERRORS, "perPeriod"),
      ],
    },
    {
      // An HTTP API's server errors are its 5xx.
      provider: AWS,
      types: ["AWS::ApiGatewayV2::Api"],
      readings: [
        headline("aws/apigateway/count", HEADLINE_REQUESTS, "perPeriod"),
        headline("aws/apigateway/latency", HEADLINE_LATENCY, "milliseconds"),
        headline("aws/apigateway/5xx", HEADLINE_ERRORS, "perPeriod"),
      ],
    },
    {
      provider: AWS,
      types: ["AWS::AmazonMQ::Broker"],
      readings: [
        headline("aws/amazonmq/cpuutilization", HEADLINE_CPU, "percent"),
      ],
    },
    /*
     * The types read since #9567 (#9692). An Elastic Beanstalk
     * environment's one free metric is a health code (0 OK to 25 Severe),
     * which its page's status already says in words: it has no tile.
     */
    {
      provider: AWS,
      types: ["AWS::AppRunner::Service"],
      readings: [
        headline("aws/apprunner/requests", HEADLINE_REQUESTS, "perPeriod"),
        headline(
          "aws/apprunner/requestlatency",
          HEADLINE_RESPONSE_TIME,
          "milliseconds",
        ),
        headline(
          "aws/apprunner/5xxstatusresponses",
          HEADLINE_ERRORS,
          "perPeriod",
        ),
        headline("aws/apprunner/cpuutilization", HEADLINE_CPU, "percent"),
        headline("aws/apprunner/memoryutilization", HEADLINE_MEMORY, "percent"),
      ],
    },
    {
      provider: AWS,
      types: ["AWS::GlobalAccelerator::Accelerator"],
      readings: [
        headline(
          "aws/globalaccelerator/healthyendpointcount",
          HEADLINE_HEALTHY_ENDPOINTS,
          "count",
        ),
        headline(
          "aws/globalaccelerator/unhealthyendpointcount",
          HEADLINE_UNHEALTHY_ENDPOINTS,
          "count",
        ),
        headline(
          "aws/globalaccelerator/newflowcount",
          HEADLINE_CONNECTIONS,
          "perPeriod",
        ),
        headline(
          "aws/globalaccelerator/processedbytesin",
          HEADLINE_NETWORK_IN,
          "bytesPerPeriod",
        ),
        headline(
          "aws/globalaccelerator/processedbytesout",
          HEADLINE_NETWORK_OUT,
          "bytesPerPeriod",
        ),
      ],
    },
    {
      provider: AWS,
      types: ["AWS::AutoScaling::AutoScalingGroup"],
      readings: [
        headline(
          "aws/autoscaling/groupinserviceinstances",
          HEADLINE_INSTANCES,
          "count",
        ),
        headline(
          "aws/autoscaling/groupdesiredcapacity",
          HEADLINE_CAPACITY,
          "count",
        ),
      ],
    },
    {
      provider: AWS,
      types: ["AWS::WAFv2::WebACL"],
      readings: [
        headline(
          "aws/wafv2/allowedrequests",
          HEADLINE_ALLOWED_REQUESTS,
          "perPeriod",
        ),
        headline(
          "aws/wafv2/blockedrequests",
          HEADLINE_BLOCKED_REQUESTS,
          "perPeriod",
        ),
      ],
    },
    {
      provider: AWS,
      types: ["AWS::SageMaker::Endpoint"],
      readings: [
        headline(
          "aws/sagemaker/invocations",
          HEADLINE_INVOCATIONS,
          "perPeriod",
        ),
        headline(
          "aws/sagemaker/invocation5xxerrors",
          HEADLINE_ERRORS,
          "perPeriod",
        ),
      ],
    },
    {
      provider: AWS,
      types: ["AWS::NetworkFirewall::Firewall"],
      readings: [
        headline(
          "aws/networkfirewall/receivedpackets",
          HEADLINE_PACKETS_RECEIVED,
          "perPeriod",
        ),
        headline(
          "aws/networkfirewall/droppedpackets",
          HEADLINE_PACKETS_DROPPED,
          "perPeriod",
        ),
      ],
    },
    {
      provider: AWS,
      types: ["AWS::Cognito::UserPool"],
      readings: [
        headline("aws/cognito/signinsuccesses", HEADLINE_SIGN_INS, "perPeriod"),
        headline(
          "aws/cognito/signinthrottles",
          HEADLINE_THROTTLED,
          "perPeriod",
        ),
      ],
    },
    {
      provider: AWS,
      types: ["AWS::AppSync::GraphQLApi"],
      readings: [
        headline("aws/appsync/latency", HEADLINE_LATENCY, "milliseconds"),
        headline("aws/appsync/5xxerror", HEADLINE_ERRORS, "perPeriod"),
      ],
    },
    // ---- Azure ------------------------------------------------------------
    {
      provider: AZURE,
      types: ["Microsoft.Compute/virtualMachines"],
      readings: [
        headline("percentage_cpu", HEADLINE_CPU, "percent"),
        headline("available_memory_bytes", HEADLINE_FREE_MEMORY, "bytes"),
        headline("network_in_total", HEADLINE_NETWORK_IN, "bytesPerPeriod"),
        headline("network_out_total", HEADLINE_NETWORK_OUT, "bytesPerPeriod"),
        headline("disk_read_bytes", HEADLINE_DISK_READ, "bytesPerPeriod"),
        headline("disk_write_bytes", HEADLINE_DISK_WRITE, "bytesPerPeriod"),
        // 1 while the machine is up: drawn as a share of the minute.
        headline("vmavailabilitymetric", HEADLINE_AVAILABILITY, "ratio"),
      ],
    },
    {
      provider: AZURE,
      types: ["Microsoft.Compute/virtualMachineScaleSets"],
      readings: [
        headline("percentage_cpu", HEADLINE_CPU, "percent"),
        headline("available_memory_bytes", HEADLINE_FREE_MEMORY, "bytes"),
        headline("network_in_total", HEADLINE_NETWORK_IN, "bytesPerPeriod"),
        headline("network_out_total", HEADLINE_NETWORK_OUT, "bytesPerPeriod"),
      ],
    },
    {
      provider: AZURE,
      types: ["Microsoft.Compute/disks"],
      readings: [
        headline(
          "composite_disk_read_bytes/sec",
          HEADLINE_DISK_READ,
          "bytesPerSecond",
        ),
        headline(
          "composite_disk_write_bytes/sec",
          HEADLINE_DISK_WRITE,
          "bytesPerSecond",
        ),
        headline(
          "composite_disk_read_operations/sec",
          HEADLINE_READ_OPERATIONS,
          "perSecond",
        ),
        headline(
          "composite_disk_write_operations/sec",
          HEADLINE_WRITE_OPERATIONS,
          "perSecond",
        ),
      ],
    },
    {
      provider: AZURE,
      types: ["Microsoft.Web/sites"],
      readings: [
        headline("requests", HEADLINE_REQUESTS, "count"),
        headline("httpresponsetime", HEADLINE_RESPONSE_TIME, "seconds"),
        headline("http5xx", HEADLINE_ERRORS, "perPeriod"),
        /*
         * The share of its instances its Health check finds healthy, every
         * 5 minutes (#9740). Only an app with a Health check path set
         * reports it.
         */
        headline(APP_SERVICE_HEALTH_CHECK_KEY, HEADLINE_HEALTH, "percent", {
          onlySome: true,
        }),
        headline("memoryworkingset", HEADLINE_MEMORY, "bytes"),
        // Only a function app runs functions.
        headline("functionexecutioncount", HEADLINE_INVOCATIONS, "perPeriod", {
          onlySome: true,
        }),
        /*
         * What its files take of its plan's storage, every six hours and
         * kept between them (#10026), with how old it is. A new
         * connection's first is 12 hours away, and an app whose metric
         * definitions do not list it never sends one: never "Not reported".
         */
        headline("filesystemusage", HEADLINE_STORAGE_USED, "bytes", {
          onlySome: true,
        }),
      ],
    },
    {
      // A site's deployment slot (#6793): what its own page leads with, as a site's.
      provider: AZURE,
      types: ["Microsoft.Web/sites/slots"],
      readings: [
        headline("requests", HEADLINE_REQUESTS, "count"),
        headline("httpresponsetime", HEADLINE_RESPONSE_TIME, "seconds"),
        headline("http5xx", HEADLINE_ERRORS, "perPeriod"),
        headline("memoryworkingset", HEADLINE_MEMORY, "bytes"),
      ],
    },
    {
      provider: AZURE,
      types: ["Microsoft.Web/serverfarms"],
      readings: [
        headline("cpupercentage", HEADLINE_CPU, "percent"),
        headline("memorypercentage", HEADLINE_MEMORY, "percent"),
        headline("httpqueuelength", HEADLINE_QUEUE_LENGTH, "count"),
      ],
    },
    {
      provider: AZURE,
      types: ["Microsoft.App/containerApps"],
      readings: [
        headline("requests", HEADLINE_REQUESTS, "perPeriod"),
        headline("workingsetbytes", HEADLINE_MEMORY, "bytes"),
        headline("restartcount", HEADLINE_RESTARTS, "perPeriod"),
      ],
    },
    {
      provider: AZURE,
      types: ["Microsoft.ContainerService/managedClusters"],
      readings: [
        headline("node_cpu_usage_percentage", HEADLINE_CPU, "percent"),
        headline(
          "node_memory_working_set_percentage",
          HEADLINE_MEMORY,
          "percent",
        ),
        headline("kube_pod_status_ready", HEADLINE_PODS_READY, "count"),
      ],
    },
    {
      provider: AZURE,
      types: [
        "Microsoft.Sql/servers/databases",
        "Microsoft.Sql/servers/elasticpools",
      ],
      readings: [
        headline("cpu_percent", HEADLINE_CPU, "percent"),
        headline("storage_percent", HEADLINE_STORAGE_USED, "percent"),
      ],
    },
    {
      provider: AZURE,
      types: ["Microsoft.Sql/servers/databases"],
      readings: [headline("sessions_percent", HEADLINE_SESSIONS, "percent")],
    },
    {
      provider: AZURE,
      types: [
        "Microsoft.DBforPostgreSQL/flexibleServers",
        "Microsoft.DBforMySQL/flexibleServers",
      ],
      readings: [
        headline("cpu_percent", HEADLINE_CPU, "percent"),
        headline("memory_percent", HEADLINE_MEMORY, "percent"),
        headline("storage_percent", HEADLINE_STORAGE_USED, "percent"),
        headline("active_connections", HEADLINE_CONNECTIONS, "count"),
      ],
    },
    {
      provider: AZURE,
      types: ["Microsoft.DocumentDB/databaseAccounts"],
      readings: [
        /*
         * What it stores, first (#9740): its data, its indexes and its
         * documents, every container's together - DataUsageV2, IndexUsageV2
         * and DocumentCountV2, which Azure Monitor keeps at five minutes,
         * kept between their reads.
         */
        headline("datausagev2", HEADLINE_DATA_SIZE, "bytes"),
        headline("indexusagev2", HEADLINE_INDEX_SIZE, "bytes"),
        headline("documentcountv2", HEADLINE_DOCUMENTS, "count"),
        headline("totalrequests", HEADLINE_REQUESTS, "perPeriod"),
        headline("normalizedruconsumption", HEADLINE_REQUEST_UNITS, "percent"),
        /*
         * The server's latency of its direct-mode requests - the API for
         * NoSQL's and Table's SDKs connect directly by default - else of its
         * gateway-mode ones, the only way MongoDB, Cassandra and Gremlin
         * clients connect. ServerSideLatency, which Microsoft deprecates
         * for these two, is no longer read for it.
         */
        headline("serversidelatencydirect", HEADLINE_LATENCY, "milliseconds", {
          fallbackKeys: ["serversidelatencygateway"],
        }),
      ],
    },
    {
      provider: AZURE,
      types: ["Microsoft.Cache/redis"],
      readings: [
        headline("serverload", HEADLINE_SERVER_LOAD, "percent"),
        headline("usedmemorypercentage", HEADLINE_MEMORY, "percent"),
        headline("connectedclients", HEADLINE_CONNECTIONS, "count"),
      ],
    },
    {
      provider: AZURE,
      types: ["Microsoft.Storage/storageAccounts"],
      readings: [
        headline("availability", HEADLINE_AVAILABILITY, "percent"),
        headline("transactions", HEADLINE_REQUESTS, "perPeriod"),
        headline("successe2elatency", HEADLINE_LATENCY, "milliseconds"),
        /*
         * Kept at an hour at its finest, and read once an hour: held
         * between those reads, its tile says how old it is (#9982).
         */
        headline("usedcapacity", HEADLINE_STORAGE_USED, "bytes"),
      ],
    },
    {
      provider: AZURE,
      types: ["Microsoft.KeyVault/vaults"],
      readings: [
        headline("availability", HEADLINE_AVAILABILITY, "percent"),
        headline("serviceapihit", HEADLINE_REQUESTS, "perPeriod"),
        headline("serviceapilatency", HEADLINE_LATENCY, "milliseconds"),
      ],
    },
    {
      provider: AZURE,
      types: ["Microsoft.ServiceBus/namespaces"],
      readings: [
        headline("incomingmessages", HEADLINE_MESSAGES_IN, "perPeriod"),
        headline("outgoingmessages", HEADLINE_MESSAGES_OUT, "perPeriod"),
        headline("activemessages", HEADLINE_MESSAGES_WAITING, "count"),
        headline("deadletteredmessages", HEADLINE_DEAD_LETTERED, "count"),
      ],
    },
    {
      provider: AZURE,
      types: ["Microsoft.EventHub/namespaces"],
      readings: [
        headline("incomingmessages", HEADLINE_MESSAGES_IN, "perPeriod"),
        headline("outgoingmessages", HEADLINE_MESSAGES_OUT, "perPeriod"),
      ],
    },
    {
      provider: AZURE,
      types: ["Microsoft.Network/loadBalancers"],
      readings: [
        // Data path availability: the load balancer's own frontends.
        headline("vipavailability", HEADLINE_AVAILABILITY, "percent"),
        // Health probe status: the share of its backends answering.
        headline("dipavailability", HEADLINE_HEALTHY_BACKENDS, "percent"),
        headline("bytecount", HEADLINE_TRAFFIC, "bytesPerPeriod"),
      ],
    },
    {
      provider: AZURE,
      types: ["Microsoft.Network/applicationGateways"],
      readings: [
        headline("totalrequests", HEADLINE_REQUESTS, "perPeriod"),
        headline(
          "applicationgatewaytotaltime",
          HEADLINE_RESPONSE_TIME,
          "milliseconds",
        ),
        headline("failedrequests", HEADLINE_ERRORS, "perPeriod"),
        headline("unhealthyhostcount", HEADLINE_UNHEALTHY_HOSTS, "count"),
        headline("throughput", HEADLINE_THROUGHPUT, "bytesPerSecond"),
      ],
    },
    {
      provider: AZURE,
      types: ["Microsoft.Network/publicIPAddresses"],
      readings: [
        headline("vipavailability", HEADLINE_AVAILABILITY, "percent"),
        headline("bytecount", HEADLINE_TRAFFIC, "bytesPerPeriod"),
      ],
    },
    {
      provider: AZURE,
      types: ["Microsoft.Network/azureFirewalls"],
      readings: [
        headline("firewallhealth", HEADLINE_HEALTH, "percent"),
        headline("throughput", HEADLINE_THROUGHPUT, "bitsPerSecond"),
        headline("snatportutilization", HEADLINE_PORTS_USED, "percent"),
      ],
    },
    {
      provider: AZURE,
      types: ["Microsoft.Network/natGateways"],
      readings: [
        headline("datapathavailability", HEADLINE_AVAILABILITY, "percent"),
        headline("bytecount", HEADLINE_TRAFFIC, "bytesPerPeriod"),
        headline("snatconnectioncount", HEADLINE_CONNECTIONS, "perPeriod"),
      ],
    },
    {
      provider: AZURE,
      types: ["Microsoft.Cdn/profiles"],
      readings: [
        headline("requestcount", HEADLINE_REQUESTS, "perPeriod"),
        headline("percentage5xx", HEADLINE_ERRORS, "percent"),
        headline("totallatency", HEADLINE_LATENCY, "milliseconds"),
      ],
    },
    {
      provider: AZURE,
      types: ["Microsoft.ApiManagement/service"],
      readings: [
        headline("requests", HEADLINE_REQUESTS, "perPeriod"),
        headline("duration", HEADLINE_RESPONSE_TIME, "milliseconds"),
        headline("capacity", HEADLINE_CAPACITY, "percent"),
      ],
    },
    {
      provider: AZURE,
      types: ["Microsoft.CognitiveServices/accounts"],
      readings: [
        headline("totalcalls", HEADLINE_REQUESTS, "perPeriod"),
        headline("totalerrors", HEADLINE_ERRORS, "perPeriod"),
        headline("latency", HEADLINE_LATENCY, "milliseconds"),
      ],
    },
    {
      provider: AZURE,
      types: ["Microsoft.Logic/workflows"],
      readings: [
        headline("runsstarted", HEADLINE_RUNS, "perPeriod"),
        headline("runsfailed", HEADLINE_FAILED_RUNS, "perPeriod"),
        headline("runlatency", HEADLINE_DURATION, "seconds"),
      ],
    },
    // ---- Google Cloud -----------------------------------------------------
    {
      provider: GCP,
      types: ["gce_instance"],
      readings: [
        headline(
          "compute.googleapis.com/instance/cpu/utilization",
          HEADLINE_CPU,
          "ratio",
        ),
        /*
         * How full its memory and its fullest disk are, from the Ops Agent
         * on it: a VM without the agent says so in their tiles.
         */
        headline(GCP_OPS_AGENT_MEMORY_KEY, HEADLINE_MEMORY, "percent", {
          needs: NEEDS_OPS_AGENT,
        }),
        headline(GCP_OPS_AGENT_DISK_KEY, HEADLINE_STORAGE_USED, "percent", {
          needs: NEEDS_OPS_AGENT,
        }),
        headline(
          "compute.googleapis.com/instance/network/received_bytes_count",
          HEADLINE_NETWORK_IN,
          "bytesPerSecond",
        ),
        headline(
          "compute.googleapis.com/instance/network/sent_bytes_count",
          HEADLINE_NETWORK_OUT,
          "bytesPerSecond",
        ),
      ],
    },
    {
      provider: GCP,
      types: ["cloudsql_database"],
      readings: [
        headline(
          "cloudsql.googleapis.com/database/cpu/utilization",
          HEADLINE_CPU,
          "ratio",
        ),
        headline(
          "cloudsql.googleapis.com/database/memory/utilization",
          HEADLINE_MEMORY,
          "ratio",
        ),
        headline(
          "cloudsql.googleapis.com/database/disk/utilization",
          HEADLINE_STORAGE_USED,
          "ratio",
        ),
        headline(
          "cloudsql.googleapis.com/database/network/connections",
          HEADLINE_CONNECTIONS,
          "count",
        ),
      ],
    },
    {
      provider: GCP,
      types: ["gcs_bucket"],
      readings: [
        // Sampled far less often than it is read: a read may not bring it.
        headline(
          "storage.googleapis.com/storage/total_bytes",
          HEADLINE_STORAGE_USED,
          "bytes",
          { onlySome: true },
        ),
        headline(
          "storage.googleapis.com/api/request_count",
          HEADLINE_REQUESTS,
          "perSecond",
        ),
      ],
    },
    {
      provider: GCP,
      types: ["https_lb_rule"],
      readings: [
        headline(
          "loadbalancing.googleapis.com/https/request_count",
          HEADLINE_REQUESTS,
          "perSecond",
        ),
        headline(
          "loadbalancing.googleapis.com/https/total_latencies",
          HEADLINE_LATENCY,
          "milliseconds",
        ),
      ],
    },
    {
      provider: GCP,
      types: ["cloud_run_revision"],
      readings: [
        headline(
          "run.googleapis.com/request_count",
          HEADLINE_REQUESTS,
          "perSecond",
        ),
        headline(
          "run.googleapis.com/request_latencies",
          HEADLINE_LATENCY,
          "milliseconds",
        ),
        headline(
          "run.googleapis.com/container/instance_count",
          HEADLINE_INSTANCES,
          "count",
        ),
      ],
    },
    {
      provider: GCP,
      types: ["cloud_function"],
      readings: [
        headline(
          "cloudfunctions.googleapis.com/function/execution_count",
          HEADLINE_INVOCATIONS,
          "perSecond",
        ),
      ],
    },
    {
      provider: GCP,
      types: ["pubsub_subscription"],
      readings: [
        headline(
          "pubsub.googleapis.com/subscription/num_undelivered_messages",
          HEADLINE_MESSAGES_WAITING,
          "count",
        ),
        headline(
          "pubsub.googleapis.com/subscription/oldest_unacked_message_age",
          HEADLINE_OLDEST_MESSAGE,
          "seconds",
        ),
      ],
    },
    {
      provider: GCP,
      types: ["pubsub_topic"],
      readings: [
        /*
         * The messages published, each minute: the count of the topic's
         * message sizes, as Google says to count them now that it
         * deprecates topic/send_message_operation_count.
         */
        headline(
          "pubsub.googleapis.com/topic/message_sizes_count",
          HEADLINE_MESSAGES_IN,
          "perPeriod",
        ),
      ],
    },
    {
      provider: GCP,
      types: ["redis_instance"],
      readings: [
        headline(
          "redis.googleapis.com/stats/memory/usage_ratio",
          HEADLINE_MEMORY,
          "ratio",
        ),
        headline(
          "redis.googleapis.com/clients/connected",
          HEADLINE_CONNECTIONS,
          "count",
        ),
      ],
    },
    {
      provider: GCP,
      types: ["spanner_instance"],
      readings: [
        headline(
          "spanner.googleapis.com/instance/cpu/utilization",
          HEADLINE_CPU,
          "ratio",
        ),
      ],
    },
    {
      provider: GCP,
      types: ["cloud_tasks_queue"],
      readings: [
        headline(
          "cloudtasks.googleapis.com/queue/depth",
          HEADLINE_MESSAGES_WAITING,
          "count",
        ),
      ],
    },
  ];

/*
 * ---------------------------------------------------------------------------
 * Looking things up
 * ---------------------------------------------------------------------------
 */

function typeKey(provider: string, type: string): string {
  return `${(provider || "").toLowerCase()}|${(type || "").trim().toLowerCase()}`;
}

const RULES_BY_TYPE: ReadonlyMap<string, Array<CloudHealthRule>> = (() => {
  const map: Map<string, Array<CloudHealthRule>> = new Map();

  for (const entry of CLOUD_HEALTH_RULES) {
    for (const type of entry.types) {
      const key: string = typeKey(entry.provider, type);
      map.set(key, [...(map.get(key) || []), ...entry.rules]);
    }
  }

  return map;
})();

const HEADLINES_BY_TYPE: ReadonlyMap<
  string,
  Array<CloudHeadlineReading>
> = (() => {
  const map: Map<string, Array<CloudHeadlineReading>> = new Map();

  for (const entry of CLOUD_HEADLINE_READINGS) {
    for (const type of entry.types) {
      const key: string = typeKey(entry.provider, type);
      map.set(key, [...(map.get(key) || []), ...entry.readings]);
    }
  }

  return map;
})();

/*
 * ---------------------------------------------------------------------------
 * Readings read less often than every read (#9740)
 * ---------------------------------------------------------------------------
 *
 * A resource's readings are what its last read brought (CloudResourceReadings).
 * An Azure key metric Azure Monitor keeps at five minutes (AzureKeyMetric.
 * grain: an App Service app's health check, a Cosmos DB account's storage)
 * is read in a call of its own every AZURE_FIVE_MINUTE_READ_MINUTES - in one
 * read of three - one it keeps at an hour (a Storage account's used
 * capacity, #9982) once an hour, and one it keeps at six hours (an App
 * Service app's file system, #10026) every six hours, so its reading, and a
 * rule or a tile that reads it, would come and go. A read that brings no value of such a
 * reading keeps the one before while its datapoint is younger than the
 * reading's hold, and drops it after, so a metric that stops still goes
 * stale; the resource's page says how old it is. A reading every read
 * brings is never kept: a read that did not bring it says something
 * (CloudHeadlineTiles' "Not reported").
 */

// Azure Monitor's five-minute grain, as seconds a point covers.
export const AZURE_FIVE_MINUTE_READING_PERIOD_SECONDS: number = 5 * 60;

/*
 * How long a five-minute reading is kept: twice the 15 minutes between its
 * calls, and the 10 minutes its newest point is old when it is read. A
 * call reads once its window holds 15 minutes, so a connection read every
 * 5 or 15 minutes brings it every 15, one read every 10 every 20 minutes;
 * its newest point is 9 to 14 minutes old when it is read (Azure Monitor's
 * 4 minutes behind, on a whole period), so up to 34 minutes old before the
 * next call. Under CLOUD_READINGS_STALE_MS: a kept reading never outlives
 * the resource's readings.
 */
export const AZURE_FIVE_MINUTE_READING_HOLD_MS: number =
  (2 * AZURE_FIVE_MINUTE_READ_MINUTES + 10) * 60 * 1000;

// Azure Monitor's hourly grain, as seconds a point covers.
export const AZURE_HOURLY_READING_PERIOD_SECONDS: number = 60 * 60;

/*
 * How long an hourly reading is kept (#9982), by its datapoint's age. An
 * hour's point is asked for once the hour after it has passed
 * (CloudMetricWindows: an hourly window waits a whole period for Azure
 * Monitor to publish it), so it is 2 hours old when it is read, and the
 * next one comes an hour later, at the first read after it is there: up
 * to 3 hours old then, plus the minutes between two reads of the
 * connection - an hour at most. A bound of its own beside
 * CLOUD_READINGS_STALE_MS, which says when a resource's readings as a whole
 * are too old: a storage account's other readings come every read. One
 * that stops coming is dropped after it, so its tile says "Not reported".
 */
export const AZURE_HOURLY_READING_HOLD_MS: number = 4 * 60 * 60 * 1000;

// Azure Monitor's six-hour grain, as seconds a point covers.
export const AZURE_SIX_HOURLY_READING_PERIOD_SECONDS: number = 6 * 60 * 60;

/*
 * How long a six-hourly reading is kept (#10026: an App Service app's
 * FileSystemUsage), by its datapoint's age, the way an hourly one is. Six
 * hours' point is asked for once the six hours after them have passed
 * (CloudMetricWindows: a window of an hour or more waits a whole period
 * for Azure Monitor to publish it), so it is 12 hours old when it is read,
 * and the next one comes six hours later, at the first read after it is
 * there: up to 18 hours old then, plus the minutes between two reads of
 * the connection - an hour at most. One that stops coming is dropped
 * after it, so its tile goes.
 */
export const AZURE_SIX_HOURLY_READING_HOLD_MS: number = 19 * 60 * 60 * 1000;

// What a reading read less often than every read is read at, and kept for.
interface SlowCloudReading {
  holdMs: number;
  periodSeconds: number;
}

const SLOW_GRAINS: ReadonlyMap<string, SlowCloudReading> = new Map<
  string,
  SlowCloudReading
>([
  [
    AZURE_FIVE_MINUTE_GRAIN,
    {
      holdMs: AZURE_FIVE_MINUTE_READING_HOLD_MS,
      periodSeconds: AZURE_FIVE_MINUTE_READING_PERIOD_SECONDS,
    },
  ],
  [
    AZURE_HOURLY_GRAIN,
    {
      holdMs: AZURE_HOURLY_READING_HOLD_MS,
      periodSeconds: AZURE_HOURLY_READING_PERIOD_SECONDS,
    },
  ],
  [
    AZURE_SIX_HOURLY_GRAIN,
    {
      holdMs: AZURE_SIX_HOURLY_READING_HOLD_MS,
      periodSeconds: AZURE_SIX_HOURLY_READING_PERIOD_SECONDS,
    },
  ],
]);

// "<provider>|<type>|<reading key>" of every reading read less often than every read.
const SLOW_READINGS: ReadonlyMap<string, SlowCloudReading> = (() => {
  const slow: Map<string, SlowCloudReading> = new Map<
    string,
    SlowCloudReading
  >();

  for (const entry of AZURE_KEY_METRICS) {
    for (const metric of entry.metrics) {
      const reading: SlowCloudReading | undefined = metric.grain
        ? SLOW_GRAINS.get(metric.grain)
        : undefined;

      if (!reading) {
        continue;
      }

      // Its key leaves its aggregation out, so any one makes it.
      const key: string | null = getCloudReadingKey(
        CloudProvider.Azure,
        getAzureStoredMetricName(metric.name, "average"),
      );

      if (key) {
        slow.set(`${typeKey(CloudProvider.Azure, entry.type)}|${key}`, reading);
      }
    }
  }

  return slow;
})();

function getSlowCloudReading(data: {
  provider: string;
  type: string;
  key: string;
}): SlowCloudReading | undefined {
  return SLOW_READINGS.get(
    `${typeKey(data.provider, data.type)}|${(data.key || "").toLowerCase()}`,
  );
}

function isSlowCloudReading(data: {
  provider: string;
  type: string;
  key: string;
}): boolean {
  return Boolean(getSlowCloudReading(data));
}

/*
 * How long a reading is kept after the last read that brought it, by its
 * datapoint's age: AZURE_FIVE_MINUTE_READING_HOLD_MS for an Azure key metric
 * read at five minutes, AZURE_HOURLY_READING_HOLD_MS for one read once an
 * hour, AZURE_SIX_HOURLY_READING_HOLD_MS for one read every six hours, null
 * for a reading every read brings.
 */
export function getCloudReadingHoldMs(data: {
  provider: string;
  type: string;
  key: string;
}): number | null {
  return getSlowCloudReading(data)?.holdMs ?? null;
}

/*
 * A resource's readings as a read writes them: what the read brought, and of
 * the readings it had, each one read less often than every read that this
 * read did not bring, while its datapoint is younger than its hold - with
 * its own time, so its page says how old it is. Of a reading both have, the
 * newer.
 */
export function withHeldCloudReadings(data: {
  provider: string;
  type: string;
  // What the resource's row held before this read.
  previous: CloudResourceReadings;
  // What this read brought.
  current: CloudResourceReadings;
  now: Date;
}): CloudResourceReadings {
  const readings: CloudResourceReadings = { ...data.current };

  for (const [key, reading] of Object.entries(data.previous)) {
    const holdMs: number | null = getCloudReadingHoldMs({
      provider: data.provider,
      type: data.type,
      key,
    });
    const timeMs: number = Date.parse(reading.time);

    if (holdMs === null || !Number.isFinite(timeMs)) {
      continue;
    }

    const known: CloudResourceReading | undefined = readings[key];

    if (known) {
      // A read's own reading stands, unless the one kept is newer.
      if (Date.parse(known.time) < timeMs) {
        readings[key] = reading;
      }

      continue;
    }

    if (data.now.getTime() - timeMs < holdMs) {
      readings[key] = reading;
    }
  }

  return readings;
}

/*
 * How old a reading read less often than every read is, for its page to
 * say: null for one every read brings, whose age is the read's.
 */
export function getCloudReadingAgeMs(data: {
  provider: string;
  type: string;
  key: string;
  reading: CloudResourceReading;
  now: Date;
}): number | null {
  const timeMs: number = Date.parse(data.reading.time);

  if (!isSlowCloudReading(data) || !Number.isFinite(timeMs)) {
    return null;
  }

  return Math.max(0, data.now.getTime() - timeMs);
}

/*
 * The seconds one datapoint of a reading covers: the period its metric is
 * read at (CloudKeyMetrics) - five minutes for most of CloudWatch's, a day
 * for S3's storage, a minute on Google Cloud and Azure, but five for an
 * Azure key metric read at five minutes (with its resource's type). A sum
 * over that period is drawn per minute.
 */
export function getCloudReadingPeriodSeconds(
  provider: string,
  key: string,
  type?: string | undefined,
): number {
  if ((provider || "").toLowerCase() !== CloudProvider.AWS) {
    return (
      (type
        ? getSlowCloudReading({ provider, type, key })?.periodSeconds
        : undefined) || GCP_ALIGNMENT_PERIOD_SECONDS
    );
  }

  const parts: Array<string> = (key || "").split("/");

  if (parts.length < 3) {
    return AWS_DEFAULT_PERIOD_SECONDS;
  }

  const namespace: string = `${parts[0]}/${parts[1]}`;
  const metricName: string = parts.slice(2).join("/");
  const metric: AwsKeyMetric | undefined = getAwsKeyMetrics(
    namespace,
  )?.metrics.find((candidate: AwsKeyMetric): boolean => {
    return candidate.metricName.toLowerCase() === metricName;
  });

  return metric?.periodSeconds || AWS_DEFAULT_PERIOD_SECONDS;
}

// Whether any rule speaks for the type: "Healthy" is only said of those.
export function hasCloudHealthRules(provider: string, type: string): boolean {
  return (RULES_BY_TYPE.get(typeKey(provider, type)) || []).length > 0;
}

// What a resource's page leads with, in order: empty for most types.
export function getCloudHeadlineReadings(
  provider: string,
  type: string,
): Array<CloudHeadlineReading> {
  return HEADLINES_BY_TYPE.get(typeKey(provider, type)) || [];
}

/*
 * The readings a read keeps for a resource of the type: what its rules
 * judge and what its page leads with. Empty for a type that has neither,
 * so the read keeps nothing of it.
 */
export function getCloudReadingKeysForType(
  provider: string,
  type: string,
): ReadonlySet<string> {
  const keys: Set<string> = new Set<string>();

  for (const rule of RULES_BY_TYPE.get(typeKey(provider, type)) || []) {
    for (const reading of rule.readings) {
      keys.add(reading);
    }
  }

  for (const reading of getCloudHeadlineReadings(provider, type)) {
    for (const key of getCloudHeadlineReadingKeys(reading)) {
      keys.add(key);
    }
  }

  return keys;
}

const SEVERITY_ORDER: Record<CloudHealthSeverity, number> = {
  [CloudHealthSeverity.Critical]: 0,
  [CloudHealthSeverity.Warning]: 1,
};

/*
 * What the rules find in a resource's readings, the most urgent first:
 * every finding of its type's rules, each once. Nothing for a type no rule
 * speaks for.
 */
export function findCloudHealthProblems(data: {
  provider: string;
  type: string;
  readings: CloudResourceReadings;
  properties?: unknown;
}): { findings: Array<CloudHealthFinding>; isChecked: boolean } {
  const rules: Array<CloudHealthRule> =
    RULES_BY_TYPE.get(typeKey(data.provider, data.type)) || [];

  const reader: CloudReadingReader = {
    value: (key: string): number | null => {
      const reading: CloudResourceReading | undefined = data.readings[key];
      return reading ? reading.value : null;
    },
    aligned: (key: string, withKey: string): number => {
      const reading: CloudResourceReading | undefined = data.readings[key];
      const other: CloudResourceReading | undefined = data.readings[withKey];

      if (!reading || !other) {
        return 0;
      }

      return Date.parse(reading.time) === Date.parse(other.time)
        ? reading.value
        : 0;
    },
    property: (path: string): number | null => {
      return readProperty(data.properties, path);
    },
  };

  let isChecked: boolean = false;
  const findings: Array<CloudHealthFinding> = [];

  for (const rule of rules) {
    if (
      rule.readings.some((key: string): boolean => {
        return Boolean(data.readings[key]);
      })
    ) {
      isChecked = true;
    }

    const finding: CloudHealthFinding | null = rule.evaluate(reader);

    if (finding) {
      findings.push(finding);
    }
  }

  findings.sort((a: CloudHealthFinding, b: CloudHealthFinding): number => {
    return SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity];
  });

  return { findings, isChecked };
}

/*
 * The severity the server stores with a resource's readings
 * (CloudResource.healthSeverity): the worst of what its rules find, null
 * when they find nothing.
 */
export function getCloudHealthSeverity(data: {
  provider: string;
  type: string;
  readings: CloudResourceReadings;
  properties?: unknown;
}): CloudHealthSeverity | null {
  const { findings } = findCloudHealthProblems(data);
  return findings.length > 0 ? findings[0]!.severity : null;
}

export function isCloudResourceReporting(row: CloudHealthRow): boolean {
  const status: string = (row.otelCollectorStatus || "").toLowerCase();
  return status === "connected";
}

// Whether the readings were written within CLOUD_READINGS_STALE_MS.
export function hasFreshCloudReadings(
  row: CloudHealthRow,
  now: Date = new Date(),
): boolean {
  const writtenAt: Date | null = toCloudDate(row.cloudReadingsAt);

  if (!writtenAt) {
    return false;
  }

  return now.getTime() - writtenAt.getTime() <= CLOUD_READINGS_STALE_MS;
}

/*
 * A resource's health, as every page says it:
 *
 *   - Not reporting: neither listed nor reporting lately - nothing it
 *     reported last is judged;
 *   - Unhealthy / Degraded: what its rules find in fresh readings;
 *   - Healthy: its rules had fresh readings and found nothing;
 *   - Reporting: there was nothing to judge - no rule for its type, or no
 *     reading lately.
 */
export function assessCloudResourceHealth(
  row: CloudHealthRow,
  options: { now?: Date | undefined } = {},
): CloudHealthAssessment {
  const now: Date = options.now || new Date();
  const isReporting: boolean = isCloudResourceReporting(row);
  const hasFreshReadings: boolean = hasFreshCloudReadings(row, now);

  if (!isReporting) {
    return {
      state: "not-reporting",
      severity: null,
      status: { text: CLOUD_STATUS_NOT_REPORTING },
      tone: "neutral",
      reasons: [],
      isReporting,
      hasFreshReadings,
      isChecked: false,
    };
  }

  const reporting: CloudHealthAssessment = {
    state: "reporting",
    severity: null,
    status: { text: CLOUD_STATUS_REPORTING },
    tone: "positive",
    reasons: [],
    isReporting,
    hasFreshReadings,
    isChecked: false,
  };

  if (!hasFreshReadings) {
    return reporting;
  }

  const { findings, isChecked } = findCloudHealthProblems({
    provider: row.cloudProvider || "",
    type: row.cloudResourceType || "",
    readings: readCloudResourceReadings(row.cloudReadings),
    properties: row.cloudProperties,
  });

  if (findings.length > 0) {
    const severity: CloudHealthSeverity = findings[0]!.severity;
    const isCritical: boolean = severity === CloudHealthSeverity.Critical;

    return {
      state: isCritical ? "unhealthy" : "degraded",
      severity,
      status: {
        text: isCritical ? CLOUD_STATUS_UNHEALTHY : CLOUD_STATUS_DEGRADED,
      },
      tone: isCritical ? "danger" : "warning",
      reasons: findings.map((finding: CloudHealthFinding): CloudHealthText => {
        return finding.reason;
      }),
      isReporting,
      hasFreshReadings,
      isChecked: true,
    };
  }

  if (!isChecked) {
    return reporting;
  }

  return {
    state: "healthy",
    severity: null,
    status: { text: CLOUD_STATUS_HEALTHY },
    tone: "positive",
    reasons: [],
    isReporting,
    hasFreshReadings,
    isChecked: true,
  };
}
