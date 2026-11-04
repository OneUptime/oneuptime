import { PluralTemplate, translationKey } from "../Translator";
import { CloudSavingKind } from "./CloudCost";
import {
  getAwsStoredMetricName,
  getAzureStoredMetricName,
} from "./CloudKeyMetrics";
import { CloudProvider } from "./CloudPlatform";

/*
 * RIGHT-SIZING A CLOUD RESOURCE FROM ONEUPTIME'S OWN READINGS OF ITS CPU AND
 * MEMORY.
 *
 * Each cloud has a recommender of its own (AWS Cost Optimization Hub, Azure
 * Advisor, Google Cloud's Recommender), read once a day as ways to spend
 * less. Many resources have none: a recommender that is not turned on, a
 * type it does not cover (an ElastiCache cluster, an App Service plan, a
 * Cloud SQL instance a recommender has nothing to say of), a resource too
 * new for it. For those, OneUptime works it out itself, from the metrics
 * its cloud connection reads of them, as its Kubernetes right-sizing does
 * for workloads (Types/Kubernetes/KubernetesRightSizing): what to change,
 * why, and what it would save once its cost is known.
 *
 * The rules, for the sizes a cloud doubles from one to the next:
 *
 *   - Over-provisioned: the size half as big (or a quarter) would still
 *     have room - its CPU's 95th percentile at most 60% and its highest
 *     reading at most 100% of the smaller size, and its memory's peak at
 *     most 70% of it, when its memory is read. A size is never cut more
 *     than twice (to a quarter) at once.
 *   - Under-provisioned: its CPU's 95th percentile at 85% or more, or its
 *     memory's peak at 90% or more: the size twice as big.
 *   - Right-sized: neither.
 *
 * Over a window of 14 days, and only once it has at least 6 days and 288
 * readings: a quiet weekend or a nightly batch alone never sizes it. A
 * memory that is not read as a share (EC2 without the CloudWatch agent, a
 * database that reports the memory left) sizes by CPU only, and says so.
 *
 * What a change saves is its share of what the resource cost a day, over
 * the days its cloud billed it in the last 30, made a month: a size half as
 * big costs half as much on every cloud's list price. A database's bill
 * also holds its storage, so for those it is "up to". Burstable sizes (t3,
 * B-series, e2-micro) are sized by their CPU credits, never here.
 *
 * Shared by the server (a cloud connection's daily read writes the
 * over-provisioned as ways to spend less) and the Dashboard (a resource's
 * Overview). React-free and server-safe.
 */

// The days the readings are taken from.
export const CLOUD_RIGHT_SIZING_WINDOW_DAYS: number = 14;

// The least history a resource is sized from: almost a week.
export const CLOUD_RIGHT_SIZING_MIN_OBSERVED_HOURS: number = 6 * 24;

// And at least a day of five-minute readings.
export const CLOUD_RIGHT_SIZING_MIN_SAMPLES: number = 288;

// The 95th percentile of CPU a smaller size may run at.
export const CLOUD_RIGHT_SIZING_CPU_TARGET_PERCENT: number = 60;

// The highest CPU reading a smaller size may reach.
export const CLOUD_RIGHT_SIZING_CPU_PEAK_PERCENT: number = 100;

// The memory peak a smaller size may run at.
export const CLOUD_RIGHT_SIZING_MEMORY_TARGET_PERCENT: number = 70;

// A 95th percentile of CPU from which a size is too small.
export const CLOUD_RIGHT_SIZING_CPU_HOT_PERCENT: number = 85;

// A memory peak from which a size is too small.
export const CLOUD_RIGHT_SIZING_MEMORY_HOT_PERCENT: number = 90;

// A size is cut at most twice at once: to a quarter.
export const CLOUD_RIGHT_SIZING_MAX_STEPS_DOWN: number = 2;

// The days in a month, on average: what a day's cost is made a month by.
export const CLOUD_DAYS_IN_AVERAGE_MONTH: number = 365.25 / 12;

// The source a right-sizing OneUptime worked out is kept as.
export const CLOUD_SAVINGS_SOURCE_ONEUPTIME: string = "OneUptime";

/*
 * What a right-sizing OneUptime worked out is kept as among the ways to
 * spend less: "oneuptime-rightsize:<the resource's id>".
 */
export const CLOUD_RIGHT_SIZING_RECOMMENDATION_PREFIX: string =
  "oneuptime-rightsize:";

export function getCloudRightSizingRecommendationId(
  cloudResourceId: string,
): string {
  return `${CLOUD_RIGHT_SIZING_RECOMMENDATION_PREFIX}${cloudResourceId}`;
}

export function isCloudRightSizingRecommendationId(
  recommendationId: string | null | undefined,
): boolean {
  return (recommendationId || "").startsWith(
    CLOUD_RIGHT_SIZING_RECOMMENDATION_PREFIX,
  );
}

/*
 * The kinds of a cloud's recommendation that speak for a resource's size: a
 * resource its cloud's recommender would resize, stop or move to a newer
 * generation is left to it. A commitment says nothing of one resource.
 */
export const CLOUD_SIZE_RECOMMENDATION_KINDS: ReadonlyArray<CloudSavingKind> = [
  CloudSavingKind.Rightsize,
  CloudSavingKind.Idle,
  CloudSavingKind.Upgrade,
];

// Whether a recommendation is a cloud recommender's word on a resource's size.
export function isRecommenderSizeRecommendation(data: {
  kind: string | null | undefined;
  recommendationId: string | null | undefined;
}): boolean {
  return (
    !isCloudRightSizingRecommendationId(data.recommendationId) &&
    CLOUD_SIZE_RECOMMENDATION_KINDS.includes(data.kind as CloudSavingKind)
  );
}

/*
 * ---------------------------------------------------------------------------
 * The resources it sizes
 * ---------------------------------------------------------------------------
 */

// How a cloud names its sizes, and so how one is a step from another.
export enum CloudSizeLadder {
  // m5.2xlarge, db.r6g.xlarge, cache.r6g.large.
  Aws = "aws",
  // Standard_D8s_v5 - and a flexible server's SKU, Standard_D4ds_v4.
  AzureVm = "azure-vm",
  // An App Service plan's SKU: P1v3, S2.
  AzureAppServicePlan = "azure-app-service-plan",
  // n2-standard-16, n2-custom-8-32768.
  GcpMachine = "gcp-machine",
  // db-custom-4-16384, db-n1-standard-4.
  GcpCloudSql = "gcp-cloud-sql",
}

// A metric a resource is sized from, as its readings are stored.
export interface CloudRightSizingMetric {
  // The stored names it may arrive under, in lower case.
  names: Array<string>;
  // What a reading is multiplied by to read as a percent (100 for a 0-1 ratio).
  toPercent: number;
}

export interface CloudRightSizingProfile {
  provider: CloudProvider;
  // The type, as CloudResourceCatalog spells it.
  type: string;
  // The inventory property its size is read from (CloudResource.cloudProperties).
  sizeProperty: string;
  ladder: CloudSizeLadder;
  cpu: CloudRightSizingMetric;
  // Its memory, as a share used; null when its cloud reports none.
  memory: CloudRightSizingMetric | null;
  // Why its memory is not read, when it is not: said beside a smaller size.
  memoryNotRead?: string | undefined;
  // Whether its bill holds more than its size (a database's storage).
  billHoldsMoreThanSize: boolean;
}

// An Azure Monitor metric under each aggregation it may be stored with.
function azureStoredNames(metricName: string): Array<string> {
  return ["Average", "Maximum", "Minimum", "Total"].map(
    (aggregation: string): string => {
      return getAzureStoredMetricName(metricName, aggregation);
    },
  );
}

function awsStoredName(namespace: string, metricName: string): Array<string> {
  return [getAwsStoredMetricName(namespace, metricName).toLowerCase()];
}

export const MEMORY_NEEDS_CLOUDWATCH_AGENT: string = translationKey(
  "CloudWatch reads an instance's memory only with its agent. Check it uses less than half its memory before you change its size.",
);
export const MEMORY_REPORTED_AS_FREE: string = translationKey(
  "Its cloud reports the memory left, not the share used. Check it uses less than half its memory before you change its size.",
);
export const MEMORY_NEEDS_OPS_AGENT: string = translationKey(
  "Cloud Monitoring reads an instance's memory only with the Ops Agent. Check it uses less than half its memory before you change its size.",
);
export const MEMORY_NOT_REPORTED: string = translationKey(
  "No memory readings came in over these days. Check it uses less than half its memory before you change its size.",
);

export const CLOUD_RIGHT_SIZING_PROFILES: ReadonlyArray<CloudRightSizingProfile> =
  [
    {
      provider: CloudProvider.AWS,
      type: "AWS::EC2::Instance",
      sizeProperty: "InstanceType",
      ladder: CloudSizeLadder.Aws,
      cpu: { names: awsStoredName("AWS/EC2", "CPUUtilization"), toPercent: 1 },
      memory: null,
      memoryNotRead: MEMORY_NEEDS_CLOUDWATCH_AGENT,
      billHoldsMoreThanSize: false,
    },
    {
      provider: CloudProvider.AWS,
      type: "AWS::RDS::DBInstance",
      sizeProperty: "DBInstanceClass",
      ladder: CloudSizeLadder.Aws,
      cpu: { names: awsStoredName("AWS/RDS", "CPUUtilization"), toPercent: 1 },
      memory: null,
      memoryNotRead: MEMORY_REPORTED_AS_FREE,
      billHoldsMoreThanSize: true,
    },
    {
      provider: CloudProvider.AWS,
      type: "AWS::ElastiCache::CacheCluster",
      sizeProperty: "CacheNodeType",
      ladder: CloudSizeLadder.Aws,
      cpu: {
        names: awsStoredName("AWS/ElastiCache", "CPUUtilization"),
        toPercent: 1,
      },
      memory: {
        names: awsStoredName(
          "AWS/ElastiCache",
          "DatabaseMemoryUsagePercentage",
        ),
        toPercent: 1,
      },
      billHoldsMoreThanSize: false,
    },
    {
      provider: CloudProvider.AWS,
      type: "AWS::ElastiCache::ReplicationGroup",
      sizeProperty: "CacheNodeType",
      ladder: CloudSizeLadder.Aws,
      cpu: {
        names: awsStoredName("AWS/ElastiCache", "CPUUtilization"),
        toPercent: 1,
      },
      memory: {
        names: awsStoredName(
          "AWS/ElastiCache",
          "DatabaseMemoryUsagePercentage",
        ),
        toPercent: 1,
      },
      billHoldsMoreThanSize: false,
    },
    {
      provider: CloudProvider.Azure,
      type: "Microsoft.Compute/virtualMachines",
      sizeProperty: "vmSize",
      ladder: CloudSizeLadder.AzureVm,
      cpu: { names: azureStoredNames("Percentage CPU"), toPercent: 1 },
      memory: null,
      memoryNotRead: MEMORY_REPORTED_AS_FREE,
      billHoldsMoreThanSize: false,
    },
    {
      provider: CloudProvider.Azure,
      type: "Microsoft.DBforPostgreSQL/flexibleServers",
      sizeProperty: "skuName",
      ladder: CloudSizeLadder.AzureVm,
      cpu: { names: azureStoredNames("cpu_percent"), toPercent: 1 },
      memory: { names: azureStoredNames("memory_percent"), toPercent: 1 },
      billHoldsMoreThanSize: true,
    },
    {
      provider: CloudProvider.Azure,
      type: "Microsoft.DBforMySQL/flexibleServers",
      sizeProperty: "skuName",
      ladder: CloudSizeLadder.AzureVm,
      cpu: { names: azureStoredNames("cpu_percent"), toPercent: 1 },
      memory: { names: azureStoredNames("memory_percent"), toPercent: 1 },
      billHoldsMoreThanSize: true,
    },
    {
      provider: CloudProvider.Azure,
      type: "Microsoft.Web/serverfarms",
      sizeProperty: "skuName",
      ladder: CloudSizeLadder.AzureAppServicePlan,
      cpu: { names: azureStoredNames("CpuPercentage"), toPercent: 1 },
      memory: { names: azureStoredNames("MemoryPercentage"), toPercent: 1 },
      billHoldsMoreThanSize: false,
    },
    {
      provider: CloudProvider.GCP,
      type: "gce_instance",
      sizeProperty: "machineType",
      ladder: CloudSizeLadder.GcpMachine,
      cpu: {
        names: ["compute.googleapis.com/instance/cpu/utilization"],
        toPercent: 100,
      },
      memory: null,
      memoryNotRead: MEMORY_NEEDS_OPS_AGENT,
      billHoldsMoreThanSize: false,
    },
    {
      provider: CloudProvider.GCP,
      type: "cloudsql_database",
      sizeProperty: "settings.tier",
      ladder: CloudSizeLadder.GcpCloudSql,
      cpu: {
        names: ["cloudsql.googleapis.com/database/cpu/utilization"],
        toPercent: 100,
      },
      memory: {
        names: ["cloudsql.googleapis.com/database/memory/utilization"],
        toPercent: 100,
      },
      billHoldsMoreThanSize: true,
    },
  ];

const PROFILES_BY_TYPE: ReadonlyMap<string, CloudRightSizingProfile> = new Map(
  CLOUD_RIGHT_SIZING_PROFILES.map(
    (profile: CloudRightSizingProfile): [string, CloudRightSizingProfile] => {
      return [`${profile.provider}|${profile.type.toLowerCase()}`, profile];
    },
  ),
);

// How a resource of this type is sized; null for a type that is not.
export function getCloudRightSizingProfile(
  provider: string | null | undefined,
  type: string | null | undefined,
): CloudRightSizingProfile | null {
  return (
    PROFILES_BY_TYPE.get(
      `${(provider || "").trim().toLowerCase()}|${(type || "").trim().toLowerCase()}`,
    ) || null
  );
}

/*
 * A resource's size, from what its inventory keeps: "m5.2xlarge",
 * "Standard_D8s_v5", "n2-standard-16" (a Compute Engine machine type is
 * kept as its URL: the last part is its name). Null when none is kept.
 */
export function readCloudResourceSize(
  profile: CloudRightSizingProfile,
  properties: unknown,
): string | null {
  if (
    !properties ||
    typeof properties !== "object" ||
    Array.isArray(properties)
  ) {
    return null;
  }

  const value: unknown = (properties as Record<string, unknown>)[
    profile.sizeProperty
  ];

  if (typeof value !== "string") {
    return null;
  }

  const text: string = value.trim();
  const lastSlash: number = text.lastIndexOf("/");
  const name: string = (
    lastSlash >= 0 ? text.slice(lastSlash + 1) : text
  ).trim();

  return name.length > 0 && name.length <= 100 ? name : null;
}

/*
 * ---------------------------------------------------------------------------
 * Sizes, and the size a step from them
 * ---------------------------------------------------------------------------
 */

export interface CloudSizeSteps {
  // Whether the size is one this ladder knows.
  isKnown: boolean;
  // A size sized by CPU credits (t3, B-series, e2-micro): never sized here.
  isBurstable: boolean;
  // The size half as big, and twice as big, when there is one.
  smaller: string | null;
  larger: string | null;
}

const NOT_SIZED: CloudSizeSteps = {
  isKnown: false,
  isBurstable: false,
  smaller: null,
  larger: null,
};

/*
 * AWS: "[db.|cache.]<family>.<size>". Each of these sizes is half the next
 * in every family that has both - the 2x chain from large up, and the
 * pairs the families that leave it keep (12xlarge and 24xlarge, 9xlarge and
 * 18xlarge). A size outside them (3xlarge, metal) is not stepped from.
 */
const AWS_SIZE: RegExp = /^((?:db|cache)\.)?([a-z][a-z0-9-]*)\.([a-z0-9-]+)$/;
const AWS_BURSTABLE_FAMILY: RegExp = /^t\d/;
const AWS_HALF_OF: Readonly<Record<string, string>> = {
  xlarge: "large",
  "2xlarge": "xlarge",
  "4xlarge": "2xlarge",
  "8xlarge": "4xlarge",
  "16xlarge": "8xlarge",
  "32xlarge": "16xlarge",
  "24xlarge": "12xlarge",
  "48xlarge": "24xlarge",
  "18xlarge": "9xlarge",
};
// Twice each, and a medium's large (every family with a medium has one).
const AWS_TWICE_OF: Readonly<Record<string, string>> = {
  ...Object.fromEntries(
    Object.entries(AWS_HALF_OF).map(([larger, smaller]: [string, string]) => {
      return [smaller, larger];
    }),
  ),
  medium: "large",
};
const AWS_KNOWN_SIZES: ReadonlySet<string> = new Set<string>([
  "nano",
  "micro",
  "small",
  "medium",
  ...Object.keys(AWS_HALF_OF),
  ...Object.values(AWS_HALF_OF),
  "3xlarge",
  "6xlarge",
  "10xlarge",
  "56xlarge",
  "96xlarge",
  "112xlarge",
]);

function awsSteps(size: string): CloudSizeSteps {
  const match: RegExpMatchArray | null = size.toLowerCase().match(AWS_SIZE);

  if (!match) {
    return NOT_SIZED;
  }

  const prefix: string = match[1] || "";
  const family: string = match[2] || "";
  const step: string = match[3] || "";

  if (!AWS_KNOWN_SIZES.has(step)) {
    return NOT_SIZED;
  }

  if (AWS_BURSTABLE_FAMILY.test(family)) {
    return { isKnown: true, isBurstable: true, smaller: null, larger: null };
  }

  const smaller: string | undefined = AWS_HALF_OF[step];
  const larger: string | undefined = AWS_TWICE_OF[step];

  return {
    isKnown: true,
    isBurstable: false,
    smaller: smaller ? `${prefix}${family}.${smaller}` : null,
    larger: larger ? `${prefix}${family}.${larger}` : null,
  };
}

/*
 * Azure: "Standard_<series><vCPUs><features>_v<version>", the vCPUs halved
 * or doubled within their chain: D, E, F, L and the confidential DC and EC
 * series, from the generations whose number is the vCPU count (D and E from
 * v3, F and L from v2). Constrained sizes (E16-4s_v5) and other series are
 * not stepped from; B-series is burstable.
 */
const AZURE_VM_SIZE: RegExp = /^standard_([a-z]+)(\d+)([a-z]*)_v(\d+)$/i;
const AZURE_BURSTABLE_SIZE: RegExp = /^standard_b\d/i;
const AZURE_VM_HALF_OF: Readonly<Record<number, number>> = {
  4: 2,
  8: 4,
  16: 8,
  32: 16,
  64: 32,
  96: 48,
};
const AZURE_VM_TWICE_OF: Readonly<Record<number, number>> = {
  2: 4,
  4: 8,
  8: 16,
  16: 32,
  32: 64,
  48: 96,
};
const AZURE_VM_SERIES_FROM_VERSION: Readonly<Record<string, number>> = {
  d: 3,
  e: 3,
  dc: 3,
  ec: 5,
  f: 2,
  l: 2,
};

function azureVmSteps(size: string): CloudSizeSteps {
  if (AZURE_BURSTABLE_SIZE.test(size)) {
    return { isKnown: true, isBurstable: true, smaller: null, larger: null };
  }

  const match: RegExpMatchArray | null = size.match(AZURE_VM_SIZE);

  if (!match) {
    return NOT_SIZED;
  }

  const series: string = match[1] || "";
  const vcpus: number = Number(match[2]);
  const features: string = match[3] || "";
  const version: number = Number(match[4]);
  const fromVersion: number | undefined =
    AZURE_VM_SERIES_FROM_VERSION[series.toLowerCase()];

  if (fromVersion === undefined || version < fromVersion) {
    return NOT_SIZED;
  }

  const smaller: number | undefined = AZURE_VM_HALF_OF[vcpus];
  const larger: number | undefined = AZURE_VM_TWICE_OF[vcpus];

  if (smaller === undefined && larger === undefined) {
    return NOT_SIZED;
  }

  const name: (count: number) => string = (count: number): string => {
    return `Standard_${series}${count}${features}_v${version}`;
  };

  return {
    isKnown: true,
    isBurstable: false,
    smaller: smaller !== undefined ? name(smaller) : null,
    larger: larger !== undefined ? name(larger) : null,
  };
}

/*
 * An App Service plan's SKU: each tier's sizes double from one to the next
 * (S1, S2, S3; P0v3 to P3v3; P1mv3 to P5mv3). Free, Shared, Elastic and
 * consumption plans are not stepped from.
 */
const APP_SERVICE_PLAN_TIERS: ReadonlyArray<ReadonlyArray<string>> = [
  ["B1", "B2", "B3"],
  ["S1", "S2", "S3"],
  ["P1v2", "P2v2", "P3v2"],
  ["P0v3", "P1v3", "P2v3", "P3v3"],
  ["P1mv3", "P2mv3", "P3mv3", "P4mv3", "P5mv3"],
  ["I1v2", "I2v2", "I3v2"],
];

function appServicePlanSteps(size: string): CloudSizeSteps {
  const wanted: string = size.trim().toLowerCase();

  for (const tier of APP_SERVICE_PLAN_TIERS) {
    const index: number = tier.findIndex((sku: string): boolean => {
      return sku.toLowerCase() === wanted;
    });

    if (index >= 0) {
      return {
        isKnown: true,
        isBurstable: false,
        smaller: index > 0 ? tier[index - 1]! : null,
        larger: index < tier.length - 1 ? tier[index + 1]! : null,
      };
    }
  }

  return NOT_SIZED;
}

/*
 * Compute Engine: "<family>-<standard|highmem|highcpu>-<vCPUs>", the vCPUs
 * halved or doubled within what the family offers, and custom machine types
 * ("<family>-custom-<vCPUs>-<MB>") halved or doubled whole. Shared-core
 * types (e2-micro, f1-micro, g1-small) are burstable.
 */
const GCP_PREDEFINED_TYPE: RegExp =
  /^([a-z][a-z0-9]*)-(standard|highmem|highcpu)-(\d+)$/;
const GCP_CUSTOM_TYPE: RegExp = /^([a-z][a-z0-9]*)-custom-(\d+)-(\d+)$/;
const GCP_SHARED_CORE_TYPES: ReadonlySet<string> = new Set<string>([
  "e2-micro",
  "e2-small",
  "e2-medium",
  "f1-micro",
  "g1-small",
]);
// The vCPU counts each family offers on the 2x chain: [smallest, largest].
const GCP_FAMILY_VCPUS: Readonly<Record<string, [number, number]>> = {
  n1: [1, 64],
  n2: [2, 128],
  n2d: [2, 128],
  n4: [2, 64],
  e2: [2, 32],
  t2d: [1, 32],
  c2d: [2, 32],
};
const GCP_CUSTOM_FAMILY_VCPUS: Readonly<Record<string, [number, number]>> = {
  n1: [2, 64],
  n2: [2, 80],
  n2d: [2, 96],
  e2: [2, 32],
};

function isPowerOfTwo(value: number): boolean {
  return Number.isInteger(value) && value > 0 && (value & (value - 1)) === 0;
}

function gcpMachineSteps(size: string): CloudSizeSteps {
  const name: string = size.trim().toLowerCase();

  if (GCP_SHARED_CORE_TYPES.has(name)) {
    return { isKnown: true, isBurstable: true, smaller: null, larger: null };
  }

  const predefined: RegExpMatchArray | null = name.match(GCP_PREDEFINED_TYPE);

  if (predefined) {
    const family: string = predefined[1] || "";
    const kind: string = predefined[2] || "";
    const vcpus: number = Number(predefined[3]);
    const range: [number, number] | undefined = GCP_FAMILY_VCPUS[family];

    if (
      !range ||
      !isPowerOfTwo(vcpus) ||
      vcpus < range[0] ||
      vcpus > range[1]
    ) {
      return NOT_SIZED;
    }

    // e2's high-memory types stop at 16 vCPUs.
    const largest: number =
      family === "e2" && kind === "highmem" ? 16 : range[1];

    return {
      isKnown: true,
      isBurstable: false,
      smaller: vcpus / 2 >= range[0] ? `${family}-${kind}-${vcpus / 2}` : null,
      larger: vcpus * 2 <= largest ? `${family}-${kind}-${vcpus * 2}` : null,
    };
  }

  const custom: RegExpMatchArray | null = name.match(GCP_CUSTOM_TYPE);

  if (custom) {
    const family: string = custom[1] || "";
    const vcpus: number = Number(custom[2]);
    const megabytes: number = Number(custom[3]);
    const range: [number, number] | undefined = GCP_CUSTOM_FAMILY_VCPUS[family];

    if (!range || vcpus % 2 !== 0 || megabytes % 256 !== 0) {
      return NOT_SIZED;
    }

    // Half of each, still whole vCPUs in twos and memory in 256 MB steps.
    const canHalve: boolean =
      vcpus / 2 >= range[0] && (vcpus / 2) % 2 === 0 && megabytes % 512 === 0;

    return {
      isKnown: true,
      isBurstable: false,
      smaller: canHalve
        ? `${family}-custom-${vcpus / 2}-${megabytes / 2}`
        : null,
      larger:
        vcpus * 2 <= range[1]
          ? `${family}-custom-${vcpus * 2}-${megabytes * 2}`
          : null,
    };
  }

  return NOT_SIZED;
}

/*
 * Cloud SQL: "db-custom-<vCPUs>-<MB>" halved or doubled whole (one vCPU, or
 * an even number of them), and the older "db-n1-standard-<vCPUs>" and
 * "db-n1-highmem-<vCPUs>" on the 2x chain. Shared-core tiers (db-f1-micro,
 * db-g1-small) are burstable.
 */
const CLOUD_SQL_CUSTOM_TIER: RegExp = /^db-custom-(\d+)-(\d+)$/;
const CLOUD_SQL_N1_TIER: RegExp = /^db-n1-(standard|highmem)-(\d+)$/;
const CLOUD_SQL_SHARED_TIERS: ReadonlySet<string> = new Set<string>([
  "db-f1-micro",
  "db-g1-small",
]);
const CLOUD_SQL_MAX_VCPUS: number = 96;

function isCloudSqlVcpuCount(vcpus: number): boolean {
  return vcpus === 1 || (vcpus >= 2 && vcpus % 2 === 0);
}

function cloudSqlSteps(size: string): CloudSizeSteps {
  const tier: string = size.trim().toLowerCase();

  if (CLOUD_SQL_SHARED_TIERS.has(tier)) {
    return { isKnown: true, isBurstable: true, smaller: null, larger: null };
  }

  const custom: RegExpMatchArray | null = tier.match(CLOUD_SQL_CUSTOM_TIER);

  if (custom) {
    const vcpus: number = Number(custom[1]);
    const megabytes: number = Number(custom[2]);

    if (!isCloudSqlVcpuCount(vcpus) || megabytes % 256 !== 0) {
      return NOT_SIZED;
    }

    const canHalve: boolean =
      vcpus >= 2 && isCloudSqlVcpuCount(vcpus / 2) && megabytes % 512 === 0;

    return {
      isKnown: true,
      isBurstable: false,
      smaller: canHalve ? `db-custom-${vcpus / 2}-${megabytes / 2}` : null,
      larger:
        vcpus * 2 <= CLOUD_SQL_MAX_VCPUS
          ? `db-custom-${vcpus * 2}-${megabytes * 2}`
          : null,
    };
  }

  const n1: RegExpMatchArray | null = tier.match(CLOUD_SQL_N1_TIER);

  if (n1) {
    const kind: string = n1[1] || "";
    const vcpus: number = Number(n1[2]);

    if (!isPowerOfTwo(vcpus) || vcpus > 64) {
      return NOT_SIZED;
    }

    return {
      isKnown: true,
      isBurstable: false,
      smaller: vcpus >= 2 ? `db-n1-${kind}-${vcpus / 2}` : null,
      larger: vcpus * 2 <= 64 ? `db-n1-${kind}-${vcpus * 2}` : null,
    };
  }

  return NOT_SIZED;
}

// The sizes a step from this one, along its ladder.
export function getCloudSizeSteps(
  ladder: CloudSizeLadder,
  size: string | null | undefined,
): CloudSizeSteps {
  const name: string = (size || "").trim();

  if (!name) {
    return NOT_SIZED;
  }

  switch (ladder) {
    case CloudSizeLadder.Aws:
      return awsSteps(name);
    case CloudSizeLadder.AzureVm:
      return azureVmSteps(name);
    case CloudSizeLadder.AzureAppServicePlan:
      return appServicePlanSteps(name);
    case CloudSizeLadder.GcpMachine:
      return gcpMachineSteps(name);
    case CloudSizeLadder.GcpCloudSql:
      return cloudSqlSteps(name);
    default:
      return NOT_SIZED;
  }
}

/*
 * ---------------------------------------------------------------------------
 * The verdict
 * ---------------------------------------------------------------------------
 */

export enum CloudRightSizingVerdict {
  // A smaller size would do: money on the table.
  Overprovisioned = "overprovisioned",
  // Its size runs out: a larger one would keep up.
  Underprovisioned = "underprovisioned",
  RightSized = "right-sized",
  // Too few readings yet to say.
  NotEnoughHistory = "not-enough-history",
  // Not sized here: its size is not known, burstable, or on no ladder.
  NotSized = "not-sized",
}

export enum CloudRightSizingSkipReason {
  SizeNotKnown = "size-not-known",
  Burstable = "burstable",
  SizeNotOnLadder = "size-not-on-ladder",
}

// What OneUptime's readings say of a resource's use, over the window.
export interface CloudUsageObservation {
  // The 95th percentile of its CPU readings, in percent.
  cpuP95Percent: number | null;
  // Its highest CPU reading, in percent.
  cpuMaxPercent: number | null;
  // Its highest memory reading, as a percent used; null when not read.
  memoryPeakPercent: number | null;
  // How many CPU readings there are.
  samples: number;
  // From its first reading in the window to the window's end.
  observedHours: number;
}

// What it cost a day, over the days its cloud billed it in the last 30.
export interface CloudResourceDailyCost {
  amount: number;
  currency: string;
  // The days billed, 1 to 30.
  days: number;
}

export interface CloudRightSizing {
  verdict: CloudRightSizingVerdict;
  skipReason?: CloudRightSizingSkipReason | undefined;
  currentSize: string | null;
  // The size to change to: null when there is none to name.
  recommendedSize: string | null;
  /*
   * How many times smaller (over-provisioned: 2 or 4) or larger
   * (under-provisioned: 2) the recommended size is; 1 with no change.
   */
  factor: number;
  // The readings it was judged from, in percent.
  cpuP95Percent: number | null;
  cpuMaxPercent: number | null;
  memoryPeakPercent: number | null;
  // Whether its memory was read: when not, it was sized by CPU only.
  isMemoryRead: boolean;
  memoryNotRead?: string | undefined;
  observedDays: number;
  samples: number;
  // The readings at the recommended size.
  projectedCpuP95Percent: number | null;
  projectedMemoryPeakPercent: number | null;
  // What it costs a month, at its last 30 days' daily cost; null when not known.
  monthlyCost: number | null;
  currency: string | null;
  // What the change saves a month (over-provisioned) - 0 when not known.
  monthlySavings: number;
  // What the change adds a month (under-provisioned) - 0 when not known.
  monthlyIncrease: number;
  // Whether its bill holds more than its size: the saving is "up to".
  isSavingUpperBound: boolean;
}

function finite(value: number | null | undefined): number | null {
  return value === null || value === undefined || !Number.isFinite(value)
    ? null
    : Math.max(0, value);
}

function roundMoney(amount: number): number {
  return Math.round(amount * 100) / 100;
}

// Whether a size this many times smaller still has room.
function fitsSmaller(data: {
  factor: number;
  cpuP95: number;
  cpuMax: number | null;
  memoryPeak: number | null;
}): boolean {
  if (data.cpuP95 * data.factor > CLOUD_RIGHT_SIZING_CPU_TARGET_PERCENT) {
    return false;
  }

  if (
    data.cpuMax !== null &&
    data.cpuMax * data.factor > CLOUD_RIGHT_SIZING_CPU_PEAK_PERCENT
  ) {
    return false;
  }

  if (
    data.memoryPeak !== null &&
    data.memoryPeak * data.factor > CLOUD_RIGHT_SIZING_MEMORY_TARGET_PERCENT
  ) {
    return false;
  }

  return true;
}

/*
 * One resource's right-sizing, from its type, its size, OneUptime's
 * readings of it and, when its cloud bills it by name, what it costs.
 */
export function buildCloudRightSizing(data: {
  profile: CloudRightSizingProfile;
  size: string | null;
  observation: CloudUsageObservation;
  dailyCost?: CloudResourceDailyCost | null | undefined;
}): CloudRightSizing {
  const cpuP95: number | null = finite(data.observation.cpuP95Percent);
  const cpuMax: number | null = finite(data.observation.cpuMaxPercent);
  const memoryPeak: number | null = data.profile.memory
    ? finite(data.observation.memoryPeakPercent)
    : null;
  const samples: number = Math.max(
    0,
    Math.floor(Number(data.observation.samples) || 0),
  );
  const observedHours: number = Math.max(
    0,
    Number(data.observation.observedHours) || 0,
  );
  const cost: CloudResourceDailyCost | null =
    data.dailyCost &&
    Number.isFinite(data.dailyCost.amount) &&
    data.dailyCost.amount > 0 &&
    data.dailyCost.days > 0
      ? data.dailyCost
      : null;
  const monthlyCost: number | null = cost
    ? roundMoney(cost.amount * CLOUD_DAYS_IN_AVERAGE_MONTH)
    : null;

  const result: CloudRightSizing = {
    verdict: CloudRightSizingVerdict.NotSized,
    currentSize: data.size,
    recommendedSize: null,
    factor: 1,
    cpuP95Percent: cpuP95,
    cpuMaxPercent: cpuMax,
    memoryPeakPercent: memoryPeak,
    isMemoryRead: memoryPeak !== null,
    /*
     * Why it is sized by CPU only: its cloud reports no share of memory
     * used, or - for a type whose cloud does - none came in.
     */
    memoryNotRead:
      memoryPeak === null
        ? data.profile.memory
          ? MEMORY_NOT_REPORTED
          : data.profile.memoryNotRead || MEMORY_REPORTED_AS_FREE
        : undefined,
    observedDays: Math.floor(observedHours / 24),
    samples,
    projectedCpuP95Percent: null,
    projectedMemoryPeakPercent: null,
    monthlyCost,
    currency: cost ? cost.currency : null,
    monthlySavings: 0,
    monthlyIncrease: 0,
    isSavingUpperBound: data.profile.billHoldsMoreThanSize,
  };

  if (!data.size) {
    return { ...result, skipReason: CloudRightSizingSkipReason.SizeNotKnown };
  }

  const steps: CloudSizeSteps = getCloudSizeSteps(
    data.profile.ladder,
    data.size,
  );

  if (steps.isBurstable) {
    return { ...result, skipReason: CloudRightSizingSkipReason.Burstable };
  }

  if (!steps.isKnown) {
    return {
      ...result,
      skipReason: CloudRightSizingSkipReason.SizeNotOnLadder,
    };
  }

  if (
    cpuP95 === null ||
    samples < CLOUD_RIGHT_SIZING_MIN_SAMPLES ||
    observedHours < CLOUD_RIGHT_SIZING_MIN_OBSERVED_HOURS
  ) {
    return { ...result, verdict: CloudRightSizingVerdict.NotEnoughHistory };
  }

  const isHot: boolean =
    cpuP95 >= CLOUD_RIGHT_SIZING_CPU_HOT_PERCENT ||
    (memoryPeak !== null &&
      memoryPeak >= CLOUD_RIGHT_SIZING_MEMORY_HOT_PERCENT);

  if (isHot) {
    return {
      ...result,
      verdict: CloudRightSizingVerdict.Underprovisioned,
      recommendedSize: steps.larger,
      factor: steps.larger ? 2 : 1,
      projectedCpuP95Percent: steps.larger ? cpuP95 / 2 : null,
      projectedMemoryPeakPercent:
        steps.larger && memoryPeak !== null ? memoryPeak / 2 : null,
      monthlyIncrease: steps.larger && monthlyCost !== null ? monthlyCost : 0,
    };
  }

  // The smallest size along the ladder that still has room, at most a quarter.
  let recommended: string | null = null;
  let factor: number = 1;
  let current: CloudSizeSteps = steps;

  for (
    let step: number = 1;
    step <= CLOUD_RIGHT_SIZING_MAX_STEPS_DOWN;
    step++
  ) {
    if (
      !current.smaller ||
      !fitsSmaller({ factor: factor * 2, cpuP95, cpuMax, memoryPeak })
    ) {
      break;
    }

    recommended = current.smaller;
    factor = factor * 2;
    current = getCloudSizeSteps(data.profile.ladder, current.smaller);
  }

  if (!recommended) {
    /*
     * Room to spare at half its size, but no smaller size to name: still
     * over-provisioned, said without a change to make.
     */
    if (
      !steps.smaller &&
      fitsSmaller({ factor: 2, cpuP95, cpuMax, memoryPeak })
    ) {
      return { ...result, verdict: CloudRightSizingVerdict.Overprovisioned };
    }

    return { ...result, verdict: CloudRightSizingVerdict.RightSized };
  }

  return {
    ...result,
    verdict: CloudRightSizingVerdict.Overprovisioned,
    recommendedSize: recommended,
    factor,
    projectedCpuP95Percent: cpuP95 * factor,
    projectedMemoryPeakPercent:
      memoryPeak !== null ? memoryPeak * factor : null,
    monthlySavings:
      monthlyCost !== null ? roundMoney(monthlyCost * (1 - 1 / factor)) : 0,
  };
}

// Whether a right-sizing has a change to make.
export function hasCloudRightSizingChange(sizing: CloudRightSizing): boolean {
  return (
    (sizing.verdict === CloudRightSizingVerdict.Overprovisioned ||
      sizing.verdict === CloudRightSizingVerdict.Underprovisioned) &&
    Boolean(sizing.recommendedSize)
  );
}

/*
 * ---------------------------------------------------------------------------
 * Reading the readings
 * ---------------------------------------------------------------------------
 */

/*
 * The 95th percentile of a set of readings, as ClickHouse's quantileExact
 * reads it (the reading at or above 95% of the others): for a resource's
 * page and the tests, which work from readings rather than a query.
 */
export function getCloudReadingsP95(readings: Array<number>): number | null {
  const values: Array<number> = readings
    .filter((value: number): boolean => {
      return Number.isFinite(value);
    })
    .sort((a: number, b: number): number => {
      return a - b;
    });

  if (values.length === 0) {
    return null;
  }

  const index: number = Math.min(
    values.length - 1,
    Math.floor(0.95 * values.length),
  );

  return values[index]!;
}

/*
 * What a right-sizing kept among the ways to spend less holds besides its
 * change: the readings that made it, so Savings says why in the reader's
 * language (CloudCostRecommendation.evidence).
 */
export interface CloudRightSizingEvidence {
  cpuP95Percent: number | null;
  cpuMaxPercent: number | null;
  memoryPeakPercent: number | null;
  observedDays: number;
  factor: number;
  isSavingUpperBound: boolean;
}

export function toCloudRightSizingEvidence(
  sizing: CloudRightSizing,
): CloudRightSizingEvidence {
  const round: (value: number | null) => number | null = (
    value: number | null,
  ): number | null => {
    return value === null ? null : Math.round(value * 10) / 10;
  };

  return {
    cpuP95Percent: round(sizing.cpuP95Percent),
    cpuMaxPercent: round(sizing.cpuMaxPercent),
    memoryPeakPercent: round(sizing.memoryPeakPercent),
    observedDays: sizing.observedDays,
    factor: sizing.factor,
    isSavingUpperBound: sizing.isSavingUpperBound,
  };
}

function readPercent(value: unknown): number | null {
  if (value === null || value === undefined || value === "") {
    return null;
  }
  const number: number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : null;
}

// Stored evidence, read back: null when there is none or it is malformed.
export function readCloudRightSizingEvidence(
  value: unknown,
): CloudRightSizingEvidence | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const record: Record<string, unknown> = value as Record<string, unknown>;
  const cpuP95Percent: number | null = readPercent(record["cpuP95Percent"]);
  const observedDays: number = Math.max(
    0,
    Math.floor(Number(record["observedDays"]) || 0),
  );

  if (cpuP95Percent === null || observedDays <= 0) {
    return null;
  }

  const factor: number = Number(record["factor"]);

  return {
    cpuP95Percent,
    cpuMaxPercent: readPercent(record["cpuMaxPercent"]),
    memoryPeakPercent: readPercent(record["memoryPeakPercent"]),
    observedDays,
    factor: Number.isFinite(factor) && factor >= 1 ? factor : 1,
    isSavingUpperBound: record["isSavingUpperBound"] === true,
  };
}

/*
 * ---------------------------------------------------------------------------
 * Words
 * ---------------------------------------------------------------------------
 */

export const RIGHT_SIZING_TITLE: string = translationKey("Right-sizing");

export const CLOUD_RIGHT_SIZING_VERDICT_LABELS: Readonly<
  Record<CloudRightSizingVerdict, string>
> = {
  [CloudRightSizingVerdict.Overprovisioned]: translationKey("Over-provisioned"),
  [CloudRightSizingVerdict.Underprovisioned]:
    translationKey("Under-provisioned"),
  [CloudRightSizingVerdict.RightSized]: translationKey("Right-sized"),
  [CloudRightSizingVerdict.NotEnoughHistory]: translationKey(
    "Not enough readings yet",
  ),
  [CloudRightSizingVerdict.NotSized]: translationKey("Not sized"),
};

// What to change to, by how much smaller or larger it is.
export const RIGHT_SIZING_HALF_SIZE: string = translationKey(
  "A size half as big would do.",
);
export const RIGHT_SIZING_QUARTER_SIZE: string = translationKey(
  "A size a quarter as big would do.",
);
export const RIGHT_SIZING_TWICE_SIZE: string = translationKey(
  "A size twice as big would keep up.",
);
export const RIGHT_SIZING_NO_SMALLER_SIZE: string = translationKey(
  "It has room to spare, and already has the smallest size of its family.",
);
export const RIGHT_SIZING_NO_LARGER_SIZE: string = translationKey(
  "It runs out of room, and already has the largest size of its family that OneUptime names.",
);
export const RIGHT_SIZING_FITS: string = translationKey(
  "Its size fits what it uses.",
);

// Why: what the readings say, over the days read (6 to 14).
export const RIGHT_SIZING_CPU_READ: PluralTemplate = {
  one: translationKey(
    "95% of the time over the last {{count}} day, its CPU was at or under {{p95}}, and never above {{max}}.",
  ),
  other: translationKey(
    "95% of the time over the last {{count}} days, its CPU was at or under {{p95}}, and never above {{max}}.",
  ),
};
export const RIGHT_SIZING_MEMORY_READ: string = translationKey(
  "Its memory peaked at {{memory}}.",
);
export const RIGHT_SIZING_AT_NEW_SIZE: string = translationKey(
  "At {{size}}, its CPU would be at or under {{p95}} 95% of the time.",
);
export const RIGHT_SIZING_AT_NEW_SIZE_WITH_MEMORY: string = translationKey(
  "At {{size}}, its CPU would be at or under {{p95}} 95% of the time, and its memory would peak at {{memory}}.",
);

// What it would save, or cost: a month at its cost of the last 30 days.
export const RIGHT_SIZING_SAVES: string = translationKey(
  "About {{amount}} a month less, at its cost over the last 30 days.",
);
export const RIGHT_SIZING_SAVES_UP_TO: string = translationKey(
  "Up to {{amount}} a month less, at its cost over the last 30 days: its bill also holds its storage, which stays.",
);
export const RIGHT_SIZING_COSTS_MORE: string = translationKey(
  "About {{amount}} a month more, at its cost over the last 30 days.",
);
export const RIGHT_SIZING_SAVING_NOT_KNOWN: string = translationKey(
  "What it would save is said once its cloud bills it by name.",
);

// Not enough readings: how far it has come.
export const RIGHT_SIZING_LEARNING: string = translationKey(
  "Right-sizing needs {{needed}} days of its CPU readings. It has {{read}} so far.",
);

// What the readings are, as the card's figures name them.
export const RIGHT_SIZING_CPU_P95_LABEL: string = translationKey(
  "CPU (95th percentile)",
);
export const RIGHT_SIZING_CPU_MAX_LABEL: string =
  translationKey("CPU (highest)");
export const RIGHT_SIZING_MEMORY_PEAK_LABEL: string =
  translationKey("Memory (highest)");
export const RIGHT_SIZING_DAYS_READ_LABEL: string = translationKey("Days read");
export const RIGHT_SIZING_NOT_READ: string = translationKey("Not read");
