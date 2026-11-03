import { translationKey } from "../Translator";
import {
  AWS_DEFAULT_PERIOD_SECONDS,
  AwsKeyMetric,
  GCP_ALIGNMENT_PERIOD_SECONDS,
  getAwsKeyMetrics,
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
 *     memory or 90% of its storage, failed executions, runs, deliveries or
 *     connections, dead-lettered messages, a queue whose oldest message
 *     waits an hour, availability under 99.9%.
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
export const CLOUD_AVAILABILITY_LOW_PERCENT: number = 99.9;
export const CLOUD_AVAILABILITY_DOWN_PERCENT: number = 90;
// A queue's oldest message, or a stream's consumers, this far behind.
export const CLOUD_BACKLOG_AGE_SECONDS: number = 60 * 60;

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

    readings[key.toLowerCase()] = { value: number, time: time.toISOString() };
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
const GIB: number = 1024 * 1024 * 1024;

/*
 * A database's storage, from what is free (FreeStorageSpace, bytes) and
 * what was allocated (the inventory's AllocatedStorage, GiB). Without the
 * allocation there is nothing to compare with, and nothing is said.
 */
function storageFromFreeBytes(key: string): CloudHealthRule {
  return {
    readings: [key],
    evaluate: (reader: CloudReadingReader): CloudHealthFinding | null => {
      const free: number | null = reader.value(key);
      const allocatedGib: number | null = reader.property(
        RDS_ALLOCATED_STORAGE_PROPERTY,
      );

      if (free === null || allocatedGib === null || allocatedGib <= 0) {
        return null;
      }

      const used: number = Math.max(
        0,
        Math.min(100, 100 - (free / (allocatedGib * GIB)) * 100),
      );

      if (used >= CLOUD_STORAGE_FULL_PERCENT) {
        return critical(percentText(REASON_STORAGE_FULL, used));
      }

      return used >= CLOUD_STORAGE_HIGH_PERCENT
        ? warning(percentText(REASON_STORAGE_FULL, used))
        : null;
    },
  };
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
    types: ["AWS::ApiGateway::RestApi", "AWS::ApiGatewayV2::Api"],
    rules: [
      failedShare({
        failures: ["aws/apigateway/5xxerror"],
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
    rules: [failsWhenZero("aws/kafka/activecontrollercount", REASON_NO_CONTROLLER)],
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
 *   - perSecond: a rate the cloud already gives per second.
 */
export type CloudHeadlineFormat =
  | "percent"
  | "ratio"
  | "bytes"
  | "count"
  | "seconds"
  | "milliseconds"
  | "perPeriod"
  | "perSecond";

export interface CloudHeadlineReading {
  key: string;
  // The tile's title, in English: looked up in the reader's language.
  label: string;
  format: CloudHeadlineFormat;
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
): CloudHeadlineReading {
  return { key, label, format };
}

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

export const CLOUD_HEADLINE_READINGS: ReadonlyArray<CloudHeadlineTypeReadings> =
  [
    {
      provider: AWS,
      types: ["AWS::EC2::Instance"],
      readings: [headline("aws/ec2/cpuutilization", HEADLINE_CPU, "percent")],
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
      types: ["AWS::ElasticLoadBalancingV2::LoadBalancer"],
      readings: [
        headline(
          "aws/applicationelb/requestcount",
          HEADLINE_REQUESTS,
          "perPeriod",
        ),
        headline(
          "aws/applicationelb/targetresponsetime",
          HEADLINE_RESPONSE_TIME,
          "seconds",
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
      ],
    },
    {
      provider: AWS,
      types: ["AWS::RDS::DBInstance"],
      readings: [
        headline("aws/rds/cpuutilization", HEADLINE_CPU, "percent"),
        headline("aws/rds/freestoragespace", HEADLINE_FREE_STORAGE, "bytes"),
        headline("aws/rds/databaseconnections", HEADLINE_CONNECTIONS, "count"),
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
      types: [
        "AWS::ElastiCache::CacheCluster",
        "AWS::ElastiCache::ReplicationGroup",
        "AWS::ElastiCache::ServerlessCache",
      ],
      readings: [
        headline("aws/elasticache/cpuutilization", HEADLINE_CPU, "percent"),
        headline(
          "aws/elasticache/databasememoryusagepercentage",
          HEADLINE_MEMORY,
          "percent",
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
      ],
    },
    {
      provider: AWS,
      types: ["AWS::ApiGateway::RestApi", "AWS::ApiGatewayV2::Api"],
      readings: [
        headline("aws/apigateway/count", HEADLINE_REQUESTS, "perPeriod"),
        headline("aws/apigateway/latency", HEADLINE_LATENCY, "milliseconds"),
      ],
    },
    {
      provider: AZURE,
      types: [
        "Microsoft.Compute/virtualMachines",
        "Microsoft.Compute/virtualMachineScaleSets",
      ],
      readings: [headline("percentage_cpu", HEADLINE_CPU, "percent")],
    },
    {
      provider: AZURE,
      types: ["Microsoft.Web/sites"],
      readings: [
        headline("requests", HEADLINE_REQUESTS, "count"),
        headline("httpresponsetime", HEADLINE_RESPONSE_TIME, "seconds"),
      ],
    },
    {
      provider: AZURE,
      types: ["Microsoft.Web/serverfarms"],
      readings: [
        headline("cpupercentage", HEADLINE_CPU, "percent"),
        headline("memorypercentage", HEADLINE_MEMORY, "percent"),
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
      readings: [headline("availability", HEADLINE_AVAILABILITY, "percent")],
    },
    {
      provider: GCP,
      types: ["gce_instance"],
      readings: [
        headline(
          "compute.googleapis.com/instance/cpu/utilization",
          HEADLINE_CPU,
          "ratio",
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
      ],
    },
    {
      provider: GCP,
      types: ["cloud_run_revision"],
      readings: [
        headline("run.googleapis.com/request_count", HEADLINE_REQUESTS, "perSecond"),
        headline(
          "run.googleapis.com/request_latencies",
          HEADLINE_LATENCY,
          "milliseconds",
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

const HEADLINES_BY_TYPE: ReadonlyMap<string, Array<CloudHeadlineReading>> =
  (() => {
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
 * The seconds one datapoint of a reading covers: the period its metric is
 * read at (CloudKeyMetrics) - five minutes for most of CloudWatch's, a day
 * for S3's storage, a minute on Google Cloud and Azure. A sum over that
 * period is drawn per minute.
 */
export function getCloudReadingPeriodSeconds(
  provider: string,
  key: string,
): number {
  if ((provider || "").toLowerCase() !== CloudProvider.AWS) {
    return GCP_ALIGNMENT_PERIOD_SECONDS;
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
    keys.add(reading.key);
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
