import { getAwsDocumentedMetricUnit } from "../../../../Types/Cloud/AwsMetricUnits";
import { CloudProvider } from "../../../../Types/Cloud/CloudPlatform";
import {
  AWS_DEFAULT_PERIOD_SECONDS,
  AWS_KEY_METRICS,
  AwsKeyMetric,
  AwsNamespaceKeyMetrics,
  AwsStatistic,
  getAwsKeyMetric,
  getAwsProbeMetricNames,
  getAwsStoredMetricName,
  isAwsKeyMetricSeries,
} from "../../../../Types/Cloud/CloudKeyMetrics";
import { CloudKeyMetricGroup } from "../../../../Types/Cloud/CloudKeyMetricGroup";
import {
  CLOUD_ADDED_METRIC_MAX_SPLIT_VALUES,
  CloudAddedMetric,
  CloudAddedMetricDimension,
  CloudAddedMetricScope,
} from "../../../../Types/Cloud/CloudAddedMetrics";
import { CloudMonitoredResource } from "../../../../Types/Cloud/CloudMonitoredResource";
import { isCloudReadingOfType } from "../../../../Types/Cloud/CloudReadingKeys";
import { getStreamedReadingSource } from "../CloudStreamReadings";
import {
  AwsStreamCoverage,
  NO_AWS_STREAM_COVERAGE,
  isAwsKeyMetricLeftToStream,
  isAwsNamespaceStreamedWhole,
} from "../../../../Types/CloudConnection/CloudStreamStack";
import {
  CloudConnectionAuthMethod,
  CloudConnectionDefinition,
  RESOURCE_COSTS_FIELD_KEY,
  getCloudConnectionAuthMethod,
  getCloudConnectionDefinition,
  isCloudConnectionResourceCostsOn,
  splitCloudConnectionList,
} from "../../../../Types/CloudConnection/CloudConnectionCatalog";
import { isAwsRoleArn } from "../../../../Types/CloudConnection/CloudConnectionPaste";
import { CloudConnectionSetupScope } from "../../../../Types/CloudConnection/CloudConnectionSetupCommands";
import {
  CloudConnectionFailureKind,
  CloudConnectionTestResult,
  countCloudConnectionValues,
} from "../../../../Types/CloudConnection/CloudConnectionTest";
import BadDataException from "../../../../Types/Exception/BadDataException";
import LlmProviderError from "../../LlmObservability/LlmProviderError";
import AwsSecurityHubClient from "../../SecurityEvent/Connectors/AwsSecurityHub/AwsSecurityHubClient";
import { Settled, mapWithConcurrency } from "../CloudConcurrency";
import {
  CloudMetricGroup,
  CloudMetricPoint,
  OtlpAttribute,
  buildMetricsPayloads,
  connectionResourceAttributes,
  countPayloadPoints,
  kvlistAttribute,
  resolveCloudResourceOf,
  stringAttribute,
} from "../CloudMetricPayload";
import {
  AWS_METRIC_DELAY_MS,
  MetricWindow,
  getMetricWindow,
  getMetricWindowPolicy,
} from "../CloudMetricWindows";
import {
  AwsAddedMetricUnitState,
  CLOUD_MAX_ORGANIZATION_ACCOUNTS,
  CloudConnectionPullState,
  CloudConnectionSettings,
  CloudConnector,
  CloudConnectorCallOptions,
  CloudAuditRecord,
  CloudChange,
  CloudChangesOptions,
  CloudChangesResult,
  CloudCostAccountOutcome,
  CloudCostsOptions,
  CloudCostsResult,
  CloudDiscoveredResource,
  CloudInventoryOptions,
  CloudInventoryResult,
  CloudReadBudget,
  CloudReadBudgetSpent,
  CloudReadOptions,
  CloudReadResult,
  CloudSavingsOptions,
  CloudSavingsResult,
  getCloudSecretValues,
  getOrganizationLimitWarning,
  keepsAuditRecords,
  orderLeastRecentlyRead,
  readCloudSetting,
} from "../CloudConnectorTypes";
import { AwsCredentials } from "./AwsApi";
import {
  describeAwsCostFailure,
  getAwsCostRegion,
  readAwsCostAndUsage,
  readAwsCostOptimizationHub,
} from "./AwsCosts";
import {
  CLOUD_COST_DEFAULT_CURRENCY,
  CloudCostState,
} from "../../../../Types/Cloud/CloudCost";
import {
  CLOUD_COMMITMENT_WINDOW_DAYS,
  CloudCommitmentSummary,
} from "../../../../Types/Cloud/CloudCommitments";
import { readAwsCommitments } from "./AwsCommitments";
import {
  AwsResourceCost,
  AwsResourcePlaces,
  describeAwsResourceCostFailure,
  getAwsResourceCostServices,
  getAwsResourceCostWindow,
  getCloudCostDays,
  getEarlierCostDay,
  isAwsResourceCostsDue,
  readAwsResourceCosts,
  splitAwsCostsByResource,
} from "./AwsResourceCosts";
import {
  AwsListedMetric,
  AwsMetricQuery,
  AwsMetricResult,
  MAX_QUERIES_PER_CALL,
  getMetricData,
  listMetrics,
} from "./AwsCloudWatch";
import {
  AWS_UNIT_PROBES_PER_READ,
  AwsUnitProbe,
  AwsUnitProbeAddition,
  buildAwsUnitProbeQueries,
  isAwsUnitProbeResult,
  planAwsUnitProbes,
  readAwsUnitProbe,
} from "./AwsAddedMetricUnits";
import { AWS_ALL_COMMERCIAL_REGIONS, validateAwsRegions } from "./AwsRegions";
import AwsServerIdentity, { AwsServerCredentials } from "./AwsServerIdentity";
import { AwsCredentialChainError } from "../../Aws/AwsDefaultCredentialChain";
import logger from "../../Logger";
import {
  AssumedRoleCache,
  AwsAssumedRole,
  AwsCallerIdentity,
  assumeRole,
  getCallerIdentity,
  getStsRegion,
} from "./AwsSts";
import { getNameTags } from "./AwsTagging";
import {
  AwsOrganizationAccount,
  listAwsOrganizationAccounts,
} from "./AwsOrganizations";
import { lookupAwsChanges, readAwsHealthEvents } from "./AwsChanges";
import {
  getChangePlace,
  getChangeWindowStart,
  getHealthWindowStart,
  isHealthPaused,
  keepNewChanges,
  markHealthRead,
  pauseHealth,
} from "../CloudChangeWindow";
import {
  AwsInventoryOutcome,
  getAwsAccountAlias,
  readAwsInventory,
} from "./AwsInventory";

/*
 * AMAZON WEB SERVICES: one AWS account, read from CloudWatch.
 *
 * Signs in with a role it assumes (OneUptime's own AWS identity, the
 * project's external id) or with an access key, then:
 *
 *   1. Sweeps for where resources are: every Region (once a day, when the
 *      connection names none) or the Regions in use (every hour), asking
 *      each namespace OneUptime reads (CloudKeyMetrics) whether its first
 *      key metric reported in the last three hours - one ListMetrics call
 *      per Region and namespace, and one more for each other metric a
 *      namespace probes with (getAwsProbeMetricNames: Amazon MQ's RabbitMQ
 *      brokers publish no CpuUtilization) until one is listed. A Region the
 *      account has not opted in to is skipped.
 *   2. For every Region and namespace in use: lists each key metric's
 *      series (ListMetrics), finds the resource each series is about with
 *      the ingest's own resolver, and keeps per resource the series with
 *      the fewest dimensions - the resource's own aggregate, not its
 *      per-target or per-zone splits.
 *   3. Reads those series' values since the last read (GetMetricData, one
 *      statistic each, 500 a call), each period from its own cursor - five
 *      minutes for most, an hour for a metric published a few times a day,
 *      a day for S3's storage - and builds the export the CloudWatch
 *      receivers send (Namespace and Dimensions on each datapoint, the
 *      account and Region on the resource).
 *   4. Names resources CloudWatch knows by an id (an EC2 instance, a
 *      volume) by their Name tag, every hour.
 *
 * A namespace whose metrics are published a few times a day (ACM's
 * DaysToExpiry, twice) is swept and listed whatever its last point's age
 * (isListedWhenQuiet): the last three hours' listing would hold a
 * certificate for a few hours after each point and lose it the rest of
 * the day.
 *
 * A resource is found once it reports a key metric: AWS has no free call
 * that lists everything an account holds.
 */

const PROVIDER_TITLE: string = "AWS";
const DAY_MS: number = 24 * 60 * 60 * 1000;
const HOUR_MS: number = 60 * 60 * 1000;
// Regions or Region-namespace pairs asked at once.
const CONCURRENCY: number = 8;
/*
 * A test looks in every Region for these, and counts every key namespace
 * of at most TEST_MAX_REGIONS of the Regions that have resources.
 */
const TEST_PROBE_NAMESPACES: Array<string> = [
  "AWS/EC2",
  "AWS/RDS",
  "AWS/Lambda",
  "AWS/ApplicationELB",
];
const TEST_MAX_REGIONS: number = 3;
// The most accounts of an organization one connection reads.
export const AWS_MAX_ORGANIZATION_ACCOUNTS: number =
  CLOUD_MAX_ORGANIZATION_ACCOUNTS;
// How often AWS Health is asked, and how long after a refusal it is not.
const HEALTH_INTERVAL_MS: number = 15 * 60 * 1000;
const HEALTH_PAUSE_MS: number = DAY_MS;
// CloudTrail Regions read at once for one account.
const CHANGE_REGION_CONCURRENCY: number = 4;

interface AwsSeries {
  metric: AwsListedMetric;
  keyMetric: AwsKeyMetric;
  resource: CloudMonitoredResource;
  // A metric a person added to the reads (CloudAddedMetrics), not a key metric.
  isAdded?: boolean | undefined;
  // The addition's key: what its unit is learned and kept by (#10077).
  addedKey?: string | undefined;
}

/*
 * An added metric (CloudAddedMetrics) as the read reads a key metric: with
 * its statistic, every five minutes, and never one a key-metric stream
 * carries (streamedSince null). Its group is not shown anywhere: a
 * resource's page lists an added metric under its own heading. Its unit is
 * the one its datapoints carry as the read learned it (`learnedUnit`,
 * #10077), else as they carried it when it was added (#9809), else the one
 * AWS documents for it; with none, it is stored with none, rather than as
 * CloudWatch's "None", which says the metric has no unit.
 */
export function toAwsAddedKeyMetric(
  metric: CloudAddedMetric,
  learnedUnit?: string | undefined,
): AwsKeyMetric {
  return {
    metricName: metric.name,
    statistic: metric.aggregation as AwsStatistic,
    unit:
      learnedUnit ||
      metric.unit ||
      getAwsDocumentedMetricUnit(metric.namespace || "", metric.name),
    group: CloudKeyMetricGroup.Traffic,
    periodSeconds: AWS_DEFAULT_PERIOD_SECONDS,
    streamedSince: null,
  };
}

/*
 * The additions one GetMetricData call reads, as a unit probe asks them
 * (#10077): each series of one, by its key and query, with the unit it is
 * believed to have without a probe - kept with it, else documented.
 */
function getAwsUnitProbeAdditions(data: {
  series: ReadonlyArray<AwsSeries>;
  added: ReadonlyArray<CloudAddedMetric>;
}): Array<AwsUnitProbeAddition> {
  const additions: Array<AwsUnitProbeAddition> = [];

  data.series.forEach((item: AwsSeries, index: number) => {
    if (!item.isAdded || !item.addedKey) {
      return;
    }

    const metric: CloudAddedMetric | undefined = data.added.find(
      (candidate: CloudAddedMetric): boolean => {
        return candidate.key === item.addedKey;
      },
    );

    additions.push({
      key: item.addedKey,
      queryId: `q${index}`,
      believedUnit: metric
        ? metric.unit ||
          getAwsDocumentedMetricUnit(metric.namespace || "", metric.name)
        : "",
      namespace: item.metric.namespace,
      metricName: item.metric.metricName,
      dimensions: item.metric.dimensions,
    });
  });

  return additions;
}

/*
 * The type-wide additions a read lists in a namespace like its key
 * metrics, each once - never one that is a key metric of it already.
 */
export function getAwsTypeAdditionsOfNamespace(data: {
  added: ReadonlyArray<CloudAddedMetric>;
  namespace: string;
}): Array<CloudAddedMetric> {
  const namespace: string = data.namespace.trim().toLowerCase();
  const seen: Set<string> = new Set<string>();

  return data.added.filter((metric: CloudAddedMetric): boolean => {
    const key: string = `${metric.resourceType.toLowerCase()}|${metric.name.toLowerCase()}`;

    if (
      metric.provider !== CloudProvider.AWS ||
      metric.scope !== CloudAddedMetricScope.Type ||
      (metric.namespace || "").trim().toLowerCase() !== namespace ||
      getAwsKeyMetric(namespace, metric.name) ||
      seen.has(key)
    ) {
      return false;
    }

    seen.add(key);
    return true;
  });
}

/*
 * The resources' own additions a read of this account reads: each in an
 * account, Region and namespace the read has resources in, on the series
 * the resource's listing found (its dimensions, kept with the addition) -
 * no listing call each read. A metric that is a key metric of its
 * namespace is read as one already.
 */
export function getAwsResourceAdditionsToRead(data: {
  added: ReadonlyArray<CloudAddedMetric>;
  accountId: string;
  activePairs: ReadonlyArray<string>;
}): Array<CloudAddedMetric> {
  const active: Set<string> = new Set<string>(
    data.activePairs.map((pair: string): string => {
      return pair.toLowerCase();
    }),
  );

  return data.added.filter((metric: CloudAddedMetric): boolean => {
    return (
      metric.provider === CloudProvider.AWS &&
      metric.scope === CloudAddedMetricScope.Resource &&
      Boolean(metric.namespace && metric.region && metric.dimensions?.length) &&
      (metric.accountId || "") === data.accountId &&
      active.has(`${metric.region}|${metric.namespace}`.toLowerCase()) &&
      !getAwsKeyMetric(metric.namespace || "", metric.name)
    );
  });
}

/*
 * THE SERIES AN ADDITION SPLIT BY A DIMENSION READS (#9808).
 *
 * CloudWatch keeps a series per combination of dimensions a metric is
 * published with: a load balancer's RequestCount under LoadBalancer alone,
 * and under LoadBalancer and AvailabilityZone, one per zone. An addition
 * split by a dimension reads the resource's own series with that one more,
 * a series per value - the values listed now, so a zone or a target group
 * added later is read from the next read - in the order of their values,
 * at most CLOUD_ADDED_METRIC_MAX_SPLIT_VALUES of them: each is a metric
 * GetMetricData bills.
 */
export function pickAwsSplitSeries(data: {
  listed: ReadonlyArray<AwsListedMetric>;
  // The resource's own series' dimensions, without the split.
  own: ReadonlyArray<CloudAddedMetricDimension>;
  splitBy: string;
}): Array<AwsListedMetric> {
  const valueOf: (metric: AwsListedMetric) => string = (
    metric: AwsListedMetric,
  ): string => {
    return (
      metric.dimensions.find((dimension: CloudAddedMetricDimension) => {
        return dimension.name === data.splitBy;
      })?.value || ""
    );
  };
  const seen: Set<string> = new Set<string>();

  return data.listed
    .filter((metric: AwsListedMetric): boolean => {
      const value: string = valueOf(metric);

      if (
        !value ||
        seen.has(value) ||
        metric.dimensions.length !== data.own.length + 1 ||
        !data.own.every((dimension: CloudAddedMetricDimension): boolean => {
          return metric.dimensions.some(
            (candidate: CloudAddedMetricDimension): boolean => {
              return (
                candidate.name === dimension.name &&
                candidate.value === dimension.value
              );
            },
          );
        })
      ) {
        return false;
      }

      seen.add(value);
      return true;
    })
    .sort((a: AwsListedMetric, b: AwsListedMetric): number => {
      const valueA: string = valueOf(a);
      const valueB: string = valueOf(b);

      return valueA < valueB ? -1 : valueA > valueB ? 1 : 0;
    })
    .slice(0, CLOUD_ADDED_METRIC_MAX_SPLIT_VALUES);
}

interface RegionNamespace {
  region: string;
  namespace: AwsNamespaceKeyMetrics;
}

function pairKey(region: string, namespace: string): string {
  return `${region}|${namespace}`;
}

function readPair(key: string): { region: string; namespace: string } | null {
  const index: number = key.indexOf("|");

  if (index <= 0) {
    return null;
  }

  return { region: key.slice(0, index), namespace: key.slice(index + 1) };
}

function isOlderThan(
  iso: string | undefined,
  ageMs: number,
  now: Date,
): boolean {
  const time: number = iso ? Date.parse(iso) : NaN;
  return !Number.isFinite(time) || now.getTime() - time >= ageMs;
}

// A listed series' dimensions, by name.
function dimensionsOf(metric: AwsListedMetric): Record<string, string> {
  const dimensions: Record<string, string> = {};

  for (const dimension of metric.dimensions) {
    dimensions[dimension.name] = dimension.value;
  }

  return dimensions;
}

/*
 * The series a read reads from CloudWatch: every one, but a key metric a
 * stream writes in the read's place (CloudStreamStack) - GetMetricData
 * bills each metric read. One a resource's health or headline is judged
 * from (CloudReadingKeys) is left to the stream too where its account and
 * Region's streamed readings are fresh (streamedReadingSources,
 * CloudStreamReadings: the read's statistic over its five minutes, from
 * the stream's minutes); elsewhere it is read, for the resource's
 * readings, and left out of what the read writes (CloudStreamedMetrics).
 */
export function getAwsSeriesToRead<
  T extends {
    metric: AwsListedMetric;
    keyMetric: AwsKeyMetric;
    resource: CloudMonitoredResource;
  },
>(data: {
  series: Array<T>;
  accountId: string;
  coverage: AwsStreamCoverage;
  streamedReadingSources?: ReadonlySet<string> | undefined;
}): Array<T> {
  if (data.coverage.size === 0) {
    return data.series;
  }

  return data.series.filter((entry: T): boolean => {
    if (
      !isAwsKeyMetricLeftToStream({
        coverage: data.coverage,
        accountId: data.accountId,
        region: entry.resource.region,
        namespace: entry.metric.namespace,
        metric: entry.keyMetric,
      })
    ) {
      return true;
    }

    return (
      isCloudReadingOfType({
        provider: CloudProvider.AWS,
        resourceType: entry.resource.resourceType,
        storedMetricName: getAwsStoredMetricName(
          entry.metric.namespace,
          entry.metric.metricName,
        ),
      }) &&
      !(data.streamedReadingSources || new Set<string>()).has(
        getStreamedReadingSource({
          accountId: data.accountId,
          region: entry.resource.region,
        }),
      )
    );
  });
}

/*
 * The Regions whose streams carry metrics a resource's health is judged
 * from, which the read read from CloudWatch all the same: their streamed
 * readings were not fresh (CloudStreamReadings) - a stream gone quiet, or
 * readings that could not be kept. Each once, in the order found.
 */
export function getAwsRegionsReadForStreamedHealth<
  T extends {
    metric: AwsListedMetric;
    keyMetric: AwsKeyMetric;
    resource: CloudMonitoredResource;
  },
>(data: {
  series: Array<T>;
  accountId: string;
  coverage: AwsStreamCoverage;
  streamedReadingSources?: ReadonlySet<string> | undefined;
}): Array<string> {
  const regions: Array<string> = [];

  if (data.coverage.size === 0) {
    return regions;
  }

  for (const entry of data.series) {
    const region: string = entry.resource.region;

    if (
      !regions.includes(region) &&
      isAwsKeyMetricLeftToStream({
        coverage: data.coverage,
        accountId: data.accountId,
        region,
        namespace: entry.metric.namespace,
        metric: entry.keyMetric,
      }) &&
      isCloudReadingOfType({
        provider: CloudProvider.AWS,
        resourceType: entry.resource.resourceType,
        storedMetricName: getAwsStoredMetricName(
          entry.metric.namespace,
          entry.metric.metricName,
        ),
      }) &&
      !(data.streamedReadingSources || new Set<string>()).has(
        getStreamedReadingSource({ accountId: data.accountId, region }),
      )
    ) {
      regions.push(region);
    }
  }

  return regions;
}

export default class AwsCloudConnector implements CloudConnector {
  public provider: CloudProvider = CloudProvider.AWS;

  private getDefinition(): CloudConnectionDefinition {
    return getCloudConnectionDefinition(CloudProvider.AWS)!;
  }

  public getAuthMethod(
    settings: CloudConnectionSettings,
  ): CloudConnectionAuthMethod {
    return getCloudConnectionAuthMethod(
      this.getDefinition(),
      settings.config["authMethod"],
    );
  }

  // The Regions the connection names, or none: every Region, swept daily.
  public getConfiguredRegions(
    settings: CloudConnectionSettings,
  ): Array<string> {
    return splitCloudConnectionList(
      readCloudSetting(settings.config, "regions"),
    ).map((region: string): string => {
      return region.toLowerCase();
    });
  }

  public validateSettings(settings: CloudConnectionSettings): void {
    const method: CloudConnectionAuthMethod = this.getAuthMethod(settings);

    if (method === CloudConnectionAuthMethod.AwsRole) {
      const roleArn: string = readCloudSetting(settings.config, "roleArn");

      if (!isAwsRoleArn(roleArn)) {
        throw new BadDataException(
          "Role ARN must be an IAM role ARN such as arn:aws:iam::123456789012:role/OneUptimeReadOnly.",
        );
      }

      if (!AwsServerIdentity.isConfigured()) {
        throw new BadDataException(
          "This OneUptime has no AWS identity to sign in to a role with. Connect with an access key instead.",
        );
      }
    } else {
      AwsSecurityHubClient.validateAccessKeyId(
        readCloudSetting(settings.config, "accessKeyId"),
      );

      if (!readCloudSetting(settings.secrets, "secretAccessKey")) {
        throw new BadDataException("Secret access key is required.");
      }
    }

    if (
      readCloudSetting(settings.config, "readScope") ===
        CloudConnectionSetupScope.Organization &&
      method !== CloudConnectionAuthMethod.AwsRole
    ) {
      throw new BadDataException(
        "An organization is read through a role in each account: sign in with an IAM role.",
      );
    }

    validateAwsRegions(this.getConfiguredRegions(settings));
  }

  private getStsRegion(settings: CloudConnectionSettings): string {
    return getStsRegion(this.getConfiguredRegions(settings));
  }

  /*
   * The credential every CloudWatch call is signed with: the access key, or
   * the assumed role's session (reused while it lasts). Every way into a
   * customer's account signs in here - a test, every read, a live read,
   * Data Security's reads and responses - and a role is signed in to only
   * once it is known to require the project's external id (AwsSts
   * assumeRole: a role that lets OneUptime in with any id is refused before
   * anything is read through it, #10405).
   */
  public async getCredentials(
    settings: CloudConnectionSettings,
    options: CloudConnectorCallOptions & {
      // The saved connection read, or tested; none for settings never saved.
      connectionId?: string | undefined;
      budget?: CloudReadBudget | undefined;
      /*
       * A test signs in and checks the role afresh: a role changed a minute
       * ago is tried as it is. A test of a saved connection keeps what the
       * check found for its reads, on every server (#10424).
       */
      noCache?: boolean | undefined;
    },
  ): Promise<AwsCredentials> {
    if (this.getAuthMethod(settings) !== CloudConnectionAuthMethod.AwsRole) {
      return {
        accessKeyId: readCloudSetting(settings.config, "accessKeyId"),
        secretAccessKey: readCloudSetting(settings.secrets, "secretAccessKey"),
      };
    }

    const roleArn: string = readCloudSetting(settings.config, "roleArn");
    const connectionId: string = options.connectionId || "test";
    const key: string = AssumedRoleCache.keyOf({
      projectId: settings.projectId,
      connectionId,
      roleArn,
    });

    if (!options.noCache) {
      // Only while a pass of the role's check holds, for every server.
      const cached: AwsCredentials | undefined =
        await AssumedRoleCache.get(key);

      if (cached) {
        return cached;
      }
    }

    const server: AwsServerCredentials =
      await AwsCloudConnector.getServerCredentials();
    let session: AwsAssumedRole;

    try {
      session = await assumeRole({
        transport: options.transport,
        credentials: server.credentials,
        roleArn,
        projectId: settings.projectId,
        connectionId,
        region: this.getStsRegion(settings),
        now: options.now,
        timeoutInMs: options.requestTimeoutInMs,
        sleep: options.sleep,
        budget: options.budget,
        noCache: options.noCache,
        // A test of a saved connection keeps what it found; of settings never saved, nothing.
        keepsVerdict: Boolean(options.connectionId),
      });
    } catch (error) {
      // The server's own credentials expired or are unknown: new ones next time.
      AwsServerIdentity.refusedBy({ source: server.source, error });
      throw error;
    }

    if (!options.noCache) {
      AssumedRoleCache.set(key, session);
    }

    return session.credentials;
  }

  /*
   * This OneUptime's own AWS identity, to sign in to a customer's role
   * with: its Cloud Connect key, or the server's own credentials. Without
   * one, the project is told so in words that name nothing of the server
   * (its role, its account, its agents), and the server's log says why.
   */
  public static async getServerCredentials(): Promise<AwsServerCredentials> {
    try {
      return await AwsServerIdentity.getCredentials();
    } catch (error) {
      if (!(error instanceof AwsCredentialChainError)) {
        throw error;
      }

      logger.warn(
        `Cloud connections: this OneUptime could not sign in to a customer's AWS role: it has no Cloud Connect access key (CLOUD_CONNECT_AWS_ACCESS_KEY_ID), and its own AWS credentials did not work. ${error.message}`,
      );

      throw new LlmProviderError({
        message: error.isRetryable
          ? "This OneUptime could not get its own AWS credentials just now, so it could not sign in to the role. It tries again on the next read."
          : "This OneUptime has no AWS identity to sign in to the role with: no Cloud Connect access key is set, and the server's own AWS credentials did not work. The server's log says why. Connect with an access key instead.",
        kind: error.isRetryable
          ? CloudConnectionFailureKind.Unavailable
          : CloudConnectionFailureKind.Settings,
      });
    }
  }

  private resolveSeries(data: {
    metric: AwsListedMetric;
    accountId: string;
    region: string;
  }): CloudMonitoredResource | null {
    return resolveCloudResourceOf({
      metricName: getAwsStoredMetricName(
        data.metric.namespace,
        data.metric.metricName,
      ),
      resourceAttributes: this.resourceAttributes({
        serviceName: "",
        connectionId: "",
        accountId: data.accountId,
        region: data.region,
      }),
      datapointAttributes: this.datapointAttributes(data.metric),
    });
  }

  private resourceAttributes(data: {
    serviceName: string;
    connectionId: string;
    accountId: string;
    region: string;
  }): Array<OtlpAttribute> {
    return [
      ...connectionResourceAttributes({
        serviceName: data.serviceName,
        connectionId: data.connectionId,
        cloudProvider: CloudProvider.AWS,
      }),
      stringAttribute("cloud.account.id", data.accountId),
      stringAttribute("cloud.region", data.region),
    ];
  }

  // Namespace, MetricName and the Dimensions kvlist, as the receivers write them.
  private datapointAttributes(metric: AwsListedMetric): Array<OtlpAttribute> {
    return [
      stringAttribute("Namespace", metric.namespace),
      stringAttribute("MetricName", metric.metricName),
      kvlistAttribute(
        "Dimensions",
        metric.dimensions.map(
          (dimension: { name: string; value: string }): OtlpAttribute => {
            return stringAttribute(dimension.name, dimension.value);
          },
        ),
      ),
    ];
  }

  // The namespaces read in a Region: all of them but those bound to another.
  private namespacesFor(region: string): Array<AwsNamespaceKeyMetrics> {
    return AWS_KEY_METRICS.filter(
      (namespace: AwsNamespaceKeyMetrics): boolean => {
        return !namespace.onlyRegion || namespace.onlyRegion === region;
      },
    );
  }

  /*
   * Does the namespace have a resource reporting its first key metric - or
   * any of its probe metrics, asked in turn until one is listed
   * (getAwsProbeMetricNames: an Amazon MQ broker's CPU is CpuUtilization on
   * ActiveMQ and SystemCpuUtilization on RabbitMQ).
   */
  private async hasResources(data: {
    region: string;
    namespace: AwsNamespaceKeyMetrics;
    credentials: AwsCredentials;
    options: CloudConnectorCallOptions;
    budget?: CloudReadBudget | undefined;
  }): Promise<boolean> {
    for (const metricName of getAwsProbeMetricNames(data.namespace)) {
      const listed: Array<AwsListedMetric> = await listMetrics(
        {
          transport: data.options.transport,
          credentials: data.credentials,
          region: data.region,
          now: data.options.now,
          timeoutInMs: data.options.requestTimeoutInMs,
          sleep: data.options.sleep,
          budget: data.budget,
        },
        {
          namespace: data.namespace.namespace,
          metricName,
          firstPageOnly: true,
          includeQuiet: data.namespace.isListedWhenQuiet,
        },
      );

      if (listed.length > 0) {
        return true;
      }
    }

    return false;
  }

  /*
   * Which Region-namespace pairs have resources, asked one ListMetrics page
   * each. A Region is asked once first: one that answers as an unknown
   * credential (not opted in) or cannot be reached is skipped after that
   * one call. A refused permission ends the sweep - it is the same in every
   * Region - and so does a spent budget.
   */
  private async sweep(data: {
    regions: Array<string>;
    namespaces?: Array<string> | undefined;
    credentials: AwsCredentials;
    options: CloudConnectorCallOptions;
    budget?: CloudReadBudget | undefined;
  }): Promise<{
    activePairs: Array<string>;
    reachedRegions: Array<string>;
    unreachableRegions: Array<string>;
  }> {
    const isStopping: (error: unknown) => boolean = (
      error: unknown,
    ): boolean => {
      return (
        error instanceof CloudReadBudgetSpent ||
        (error instanceof LlmProviderError &&
          error.kind === CloudConnectionFailureKind.Permission)
      );
    };

    const outcomes: Array<Settled<Array<string>>> = await mapWithConcurrency(
      data.regions,
      CONCURRENCY,
      async (region: string): Promise<Array<string>> => {
        const namespaces: Array<AwsNamespaceKeyMetrics> = this.namespacesFor(
          region,
        ).filter((namespace: AwsNamespaceKeyMetrics): boolean => {
          return (
            !data.namespaces || data.namespaces.includes(namespace.namespace)
          );
        });

        if (namespaces.length === 0) {
          return [];
        }

        const active: Array<string> = [];

        // The first namespace alone: is the Region there for this account.
        if (
          await this.hasResources({
            region,
            namespace: namespaces[0]!,
            credentials: data.credentials,
            options: data.options,
            budget: data.budget,
          })
        ) {
          active.push(pairKey(region, namespaces[0]!.namespace));
        }

        const rest: Array<Settled<boolean>> = await mapWithConcurrency(
          namespaces.slice(1),
          4,
          async (namespace: AwsNamespaceKeyMetrics): Promise<boolean> => {
            return await this.hasResources({
              region,
              namespace,
              credentials: data.credentials,
              options: data.options,
              budget: data.budget,
            });
          },
        );

        rest.forEach((outcome: Settled<boolean>, index: number) => {
          if (!outcome.ok) {
            if (isStopping(outcome.error)) {
              throw outcome.error;
            }

            // One namespace failing is not the Region failing.
            return;
          }

          if (outcome.value) {
            active.push(pairKey(region, namespaces[index + 1]!.namespace));
          }
        });

        return active;
      },
    );

    const activePairs: Array<string> = [];
    const reached: Array<string> = [];
    const unreachable: Array<string> = [];
    let firstError: unknown = undefined;

    outcomes.forEach((outcome: Settled<Array<string>>, index: number) => {
      if (outcome.ok) {
        reached.push(data.regions[index]!);
        activePairs.push(...outcome.value);
        return;
      }

      if (isStopping(outcome.error)) {
        throw outcome.error;
      }

      unreachable.push(data.regions[index]!);
      firstError = firstError || outcome.error;
    });

    // Not one Region answered: the credential itself is the problem.
    if (reached.length === 0 && firstError) {
      throw firstError;
    }

    return {
      activePairs,
      reachedRegions: reached,
      unreachableRegions: unreachable,
    };
  }

  /*
   * Every series of the key metrics of one Region and namespace, with the
   * resource it is about; per resource and metric only the series with
   * the fewest dimensions (several when they tie: an ElastiCache cluster's
   * nodes).
   */
  private async listSeries(data: {
    pair: RegionNamespace;
    accountId: string;
    credentials: AwsCredentials;
    options: CloudConnectorCallOptions;
    budget?: CloudReadBudget | undefined;
    /*
     * The namespace's type-wide additions (getAwsTypeAdditionsOfNamespace):
     * listed like its key metrics, each kept for the resources of its type.
     */
    addedMetrics?: Array<CloudAddedMetric> | undefined;
    // The units the read learned of them, by key (#10077).
    learnedUnits?: Record<string, AwsAddedMetricUnitState> | undefined;
  }): Promise<Array<AwsSeries>> {
    const kept: Map<string, Array<AwsSeries>> = new Map();
    const toList: Array<{
      keyMetric: AwsKeyMetric;
      // An addition's type: only its resources' series are kept.
      addedForType?: string | undefined;
      // An addition split by a dimension (#9808): its series of each value.
      splitBy?: string | undefined;
      addedKey?: string | undefined;
    }> = [
      ...data.pair.namespace.metrics.map(
        (keyMetric: AwsKeyMetric): { keyMetric: AwsKeyMetric } => {
          return { keyMetric };
        },
      ),
      ...(data.addedMetrics || []).map(
        (
          added: CloudAddedMetric,
        ): {
          keyMetric: AwsKeyMetric;
          addedForType: string;
          splitBy?: string | undefined;
          addedKey: string;
        } => {
          return {
            keyMetric: toAwsAddedKeyMetric(
              added,
              data.learnedUnits?.[added.key]?.unit,
            ),
            addedForType: added.resourceType.toLowerCase(),
            ...(added.splitBy ? { splitBy: added.splitBy } : {}),
            addedKey: added.key,
          };
        },
      ),
    ];
    // Per resource, a split addition's series, picked once all are listed.
    const splits: Map<
      string,
      {
        resource: CloudMonitoredResource;
        keyMetric: AwsKeyMetric;
        own: Array<CloudAddedMetricDimension>;
        splitBy: string;
        listed: Array<AwsListedMetric>;
        addedKey?: string | undefined;
      }
    > = new Map();

    for (const { keyMetric, addedForType, splitBy, addedKey } of toList) {
      const listed: Array<AwsListedMetric> = await listMetrics(
        {
          transport: data.options.transport,
          credentials: data.credentials,
          region: data.pair.region,
          now: data.options.now,
          timeoutInMs: data.options.requestTimeoutInMs,
          sleep: data.options.sleep,
          budget: data.budget,
        },
        {
          namespace: data.pair.namespace.namespace,
          metricName: keyMetric.metricName,
          includeQuiet: data.pair.namespace.isListedWhenQuiet,
        },
      );

      for (const metric of listed) {
        // A series the metric is not read from (AwsKeyMetric.onlyDimensionValues).
        if (!isAwsKeyMetricSeries(keyMetric, dimensionsOf(metric))) {
          continue;
        }

        if (splitBy) {
          /*
           * A split's series is one of the resource's own with the split
           * one more: it is the resource the series without it is about,
           * and its own series is the one of fewest dimensions.
           */
          const own: Array<CloudAddedMetricDimension> =
            metric.dimensions.filter(
              (dimension: CloudAddedMetricDimension): boolean => {
                return dimension.name !== splitBy;
              },
            );

          if (own.length === metric.dimensions.length || own.length === 0) {
            continue;
          }

          const resource: CloudMonitoredResource | null = this.resolveSeries({
            metric: { ...metric, dimensions: own },
            accountId: data.accountId,
            region: data.pair.region,
          });

          if (
            !resource ||
            resource.resourceType.toLowerCase() !== addedForType
          ) {
            continue;
          }

          const splitKey: string = `${resource.identityKey}|${keyMetric.metricName}`;
          const known:
            | {
                resource: CloudMonitoredResource;
                keyMetric: AwsKeyMetric;
                own: Array<CloudAddedMetricDimension>;
                splitBy: string;
                listed: Array<AwsListedMetric>;
                addedKey?: string | undefined;
              }
            | undefined = splits.get(splitKey);

          if (!known || own.length < known.own.length) {
            splits.set(splitKey, {
              resource,
              keyMetric,
              own,
              splitBy,
              listed: [metric],
              addedKey,
            });
          } else if (own.length === known.own.length) {
            known.listed.push(metric);
          }

          continue;
        }

        const resource: CloudMonitoredResource | null = this.resolveSeries({
          metric,
          accountId: data.accountId,
          region: data.pair.region,
        });

        if (
          !resource ||
          (addedForType !== undefined &&
            resource.resourceType.toLowerCase() !== addedForType)
        ) {
          continue;
        }

        const key: string = `${resource.identityKey}|${keyMetric.metricName}`;
        const existing: Array<AwsSeries> = kept.get(key) || [];
        const series: AwsSeries = {
          metric,
          keyMetric,
          resource,
          ...(addedForType !== undefined ? { isAdded: true } : {}),
          ...(addedKey ? { addedKey } : {}),
        };
        const fewest: number =
          existing.length > 0
            ? existing[0]!.metric.dimensions.length
            : Number.MAX_SAFE_INTEGER;

        if (metric.dimensions.length < fewest) {
          kept.set(key, [series]);
        } else if (metric.dimensions.length === fewest) {
          existing.push(series);
        }
      }
    }

    const all: Array<AwsSeries> = [];

    for (const series of kept.values()) {
      all.push(...series);
    }

    for (const split of splits.values()) {
      for (const metric of pickAwsSplitSeries({
        listed: split.listed,
        own: split.own,
        splitBy: split.splitBy,
      })) {
        all.push({
          metric,
          keyMetric: split.keyMetric,
          resource: split.resource,
          isAdded: true,
          ...(split.addedKey ? { addedKey: split.addedKey } : {}),
        });
      }
    }

    return all;
  }

  public async testConnection(
    settings: CloudConnectionSettings,
    options: CloudConnectorCallOptions & {
      // The saved connection tested, when it is one: its role's check is kept for its reads.
      connectionId?: string | undefined;
    },
  ): Promise<CloudConnectionTestResult> {
    const startedAt: number = Date.now();

    try {
      this.validateSettings(settings);

      const credentials: AwsCredentials = await this.getCredentials(settings, {
        ...options,
        noCache: true,
      });
      const identity: AwsCallerIdentity = await getCallerIdentity({
        transport: options.transport,
        credentials,
        region: this.getStsRegion(settings),
        now: options.now,
        timeoutInMs: options.requestTimeoutInMs,
      });

      // An organization: can the role list its accounts.
      let organizationAccounts: number | undefined = undefined;

      if (this.isOrganization(settings)) {
        organizationAccounts = (
          await listAwsOrganizationAccounts({
            transport: options.transport,
            credentials,
            region: this.getStsRegion(settings),
            now: options.now,
            timeoutInMs: options.requestTimeoutInMs,
            sleep: options.sleep,
          })
        ).length;
      }

      const configured: Array<string> = this.getConfiguredRegions(settings);
      const regions: Array<string> =
        configured.length > 0 ? configured : [...AWS_ALL_COMMERCIAL_REGIONS];

      // Where are resources: the common namespaces, in every Region.
      const probe: { activePairs: Array<string> } = await this.sweep({
        regions,
        namespaces: TEST_PROBE_NAMESPACES,
        credentials,
        options,
      });

      const activeRegions: Array<string> = Array.from(
        new Set(
          probe.activePairs.map((key: string): string => {
            return readPair(key)!.region;
          }),
        ),
      );
      const countedRegions: Array<string> = activeRegions.slice(
        0,
        TEST_MAX_REGIONS,
      );

      // What is there: every namespace's first key metric, in those Regions.
      const resources: Map<string, CloudMonitoredResource> = new Map();
      const countPairs: Array<RegionNamespace> = [];

      for (const region of countedRegions) {
        for (const namespace of this.namespacesFor(region)) {
          countPairs.push({ region, namespace });
        }
      }

      const counted: Array<Settled<Array<AwsListedMetric>>> =
        await mapWithConcurrency(
          countPairs,
          CONCURRENCY,
          async (pair: RegionNamespace): Promise<Array<AwsListedMetric>> => {
            return await listMetrics(
              {
                transport: options.transport,
                credentials,
                region: pair.region,
                now: options.now,
                timeoutInMs: options.requestTimeoutInMs,
                sleep: options.sleep,
              },
              {
                namespace: pair.namespace.namespace,
                metricName: pair.namespace.metrics[0]!.metricName,
                firstPageOnly: true,
                includeQuiet: pair.namespace.isListedWhenQuiet,
              },
            );
          },
        );

      counted.forEach(
        (outcome: Settled<Array<AwsListedMetric>>, index: number) => {
          if (!outcome.ok) {
            return;
          }

          for (const metric of outcome.value) {
            const resource: CloudMonitoredResource | null = this.resolveSeries({
              metric,
              accountId: identity.account,
              region: countPairs[index]!.region,
            });

            if (resource) {
              resources.set(resource.identityKey, resource);
            }
          }
        },
      );

      const found: Array<CloudMonitoredResource> = Array.from(
        resources.values(),
      );

      const organization: string =
        organizationAccounts === undefined
          ? ""
          : ` The organization has ${organizationAccounts} accounts; each is read through the role the StackSet puts in it.`;

      return {
        provider: CloudProvider.AWS,
        status: found.length > 0 ? "pass" : "warn",
        message:
          found.length > 0
            ? `Signed in to AWS account ${identity.account} and found ${found.length} resources reporting to CloudWatch.${organization}`
            : `Signed in to AWS account ${identity.account}, but found no resources reporting to CloudWatch in the last three hours.${organization}`,
        accounts: [identity.account],
        resourceCount: found.length,
        resourceTypes: countCloudConnectionValues(
          found.map((resource: CloudMonitoredResource): string => {
            return resource.resourceType;
          }),
        ).map((entry: { value: string; count: number }) => {
          return { type: entry.value, count: entry.count };
        }),
        regions: countCloudConnectionValues(
          found.map((resource: CloudMonitoredResource): string => {
            return resource.region;
          }),
        ).map((entry: { value: string; count: number }) => {
          return { region: entry.value, count: entry.count };
        }),
        isSample: true,
        durationMs: Date.now() - startedAt,
      };
    } catch (error) {
      return AwsCloudConnector.failedTest({
        error,
        settings,
        startedAt,
      });
    }
  }

  public static failedTest(data: {
    error: unknown;
    settings: CloudConnectionSettings;
    startedAt: number;
  }): CloudConnectionTestResult {
    if (data.error instanceof BadDataException) {
      return {
        provider: CloudProvider.AWS,
        status: "fail",
        message: data.error.message,
        failureKind: CloudConnectionFailureKind.Settings,
        durationMs: Date.now() - data.startedAt,
      };
    }

    const failure: LlmProviderError = LlmProviderError.from({
      error: data.error,
      step: "test",
      providerTitle: PROVIDER_TITLE,
      secretValues: getCloudSecretValues(data.settings),
    });

    return {
      provider: CloudProvider.AWS,
      status: "fail",
      message: failure.message,
      failureKind: failure.kind,
      durationMs: Date.now() - data.startedAt,
    };
  }

  public async read(
    settings: CloudConnectionSettings,
    options: CloudReadOptions,
  ): Promise<CloudReadResult> {
    const budget: CloudReadBudget = new CloudReadBudget({
      maxRequests: options.maxRequests,
      maxDurationMs: options.maxDurationMs,
    });

    if (this.isOrganization(settings)) {
      return await this.readOrganization(settings, options, budget);
    }

    return await this.readOneAccount(settings, options, budget);
  }

  // Whether the connection reads every account of an AWS Organization.
  public isOrganization(settings: CloudConnectionSettings): boolean {
    return (
      readCloudSetting(settings.config, "readScope") ===
        CloudConnectionSetupScope.Organization &&
      this.getAuthMethod(settings) === CloudConnectionAuthMethod.AwsRole
    );
  }

  /*
   * The settings a member account is read with: the same role, by name, in
   * that account - the one the organization's StackSet put there.
   */
  public settingsForAccount(
    settings: CloudConnectionSettings,
    accountId: string,
  ): CloudConnectionSettings {
    const roleArn: string = readCloudSetting(settings.config, "roleArn");
    const marker: string = ":role/";
    const index: number = roleArn.indexOf(marker);

    if (index < 0 || roleArn.includes(`::${accountId}:`)) {
      return settings;
    }

    const partition: string = roleArn.split(":")[1] || "aws";

    return {
      ...settings,
      config: {
        ...settings.config,
        roleArn: `arn:${partition}:iam::${accountId}:role/${roleArn.slice(
          index + marker.length,
        )}`,
      },
    };
  }

  /*
   * The organization's accounts: listed from its management account once a
   * day (or when none are known), and kept in the read state between.
   */
  private async getOrganizationAccounts(data: {
    settings: CloudConnectionSettings;
    options: CloudConnectorCallOptions & {
      connectionId?: string | undefined;
    };
    budget: CloudReadBudget;
    state: CloudConnectionPullState;
    now: Date;
  }): Promise<Array<{ id: string; name: string }>> {
    const known: Array<{ id: string; name: string }> =
      data.state.organizationAccounts || [];

    if (
      known.length > 0 &&
      !isOlderThan(data.state.organizationListedAt, DAY_MS, data.now)
    ) {
      return known;
    }

    const credentials: AwsCredentials = await this.getCredentials(
      data.settings,
      { ...data.options, budget: data.budget },
    );
    const listed: Array<AwsOrganizationAccount> =
      await listAwsOrganizationAccounts({
        transport: data.options.transport,
        credentials,
        region: this.getStsRegion(data.settings),
        now: data.options.now,
        timeoutInMs: data.options.requestTimeoutInMs,
        sleep: data.options.sleep,
        budget: data.budget,
      });

    const accounts: Array<{ id: string; name: string }> = listed
      .slice(0, AWS_MAX_ORGANIZATION_ACCOUNTS)
      .map((account: AwsOrganizationAccount) => {
        return { id: account.id, name: account.name };
      });

    data.state.organizationAccounts = accounts;
    data.state.organizationAccountCount = listed.length;
    data.state.organizationListedAt = data.now.toISOString();

    return accounts;
  }

  /*
   * Every account of the organization, one after another, each with its own
   * read state and the one budget of the read - the account read least
   * recently first, so a read that stops at its limit reaches the others
   * next time instead of starting over. An account whose role cannot be
   * signed in to - the StackSet has not reached it yet - is a warning, and
   * the others are read.
   */
  private async readOrganization(
    settings: CloudConnectionSettings,
    options: CloudReadOptions,
    budget: CloudReadBudget,
  ): Promise<CloudReadResult> {
    const now: Date = options.now ? options.now() : new Date();
    const state: CloudConnectionPullState = { ...options.state };
    const accounts: Array<{ id: string; name: string }> =
      await this.getOrganizationAccounts({
        settings,
        options,
        budget,
        state,
        now,
      });
    const previous: Record<string, CloudConnectionPullState> =
      state.accountStates || {};
    const accountStates: Record<string, CloudConnectionPullState> = {};
    const result: CloudReadResult = {
      accounts: [],
      resources: [],
      completelyListedAccounts: [],
      payloads: [],
      pointsWritten: 0,
      requestCount: 0,
      warnings: [],
      complete: true,
      nextState: state,
    };

    const tooMany: string | null = getOrganizationLimitWarning({
      total: state.organizationAccountCount || accounts.length,
      noun: "accounts",
    });

    if (tooMany) {
      result.warnings.push(tooMany);
    }

    for (const account of orderLeastRecentlyRead({
      accounts,
      readAt: (entry: { id: string }): string | undefined => {
        return previous[entry.id]?.metricsReadAt;
      },
    })) {
      const accountState: CloudConnectionPullState = previous[account.id] || {
        accounts: [account.id],
      };

      if (budget.isSpent()) {
        accountStates[account.id] = accountState;
        result.complete = false;
        continue;
      }

      try {
        const read: CloudReadResult = await this.readOneAccount(
          this.settingsForAccount(settings, account.id),
          { ...options, state: accountState },
          budget,
        );

        accountStates[account.id] = {
          ...read.nextState,
          metricsReadAt: now.toISOString(),
        };
        result.accounts.push(...read.accounts);
        result.resources.push(...read.resources);
        result.payloads.push(...read.payloads);
        result.pointsWritten += read.pointsWritten;
        result.warnings.push(
          ...read.warnings.map((warning: string): string => {
            return `${account.name || account.id}: ${warning}`;
          }),
        );
        result.complete = result.complete && read.complete;
      } catch (error) {
        if (error instanceof CloudReadBudgetSpent) {
          accountStates[account.id] = accountState;
          result.complete = false;
          continue;
        }

        // Tried: the others go first next time.
        accountStates[account.id] = {
          ...accountState,
          metricsReadAt: now.toISOString(),
        };

        result.warnings.push(
          error instanceof LlmProviderError &&
            (error.kind === CloudConnectionFailureKind.Authentication ||
              error.kind === CloudConnectionFailureKind.Permission)
            ? `Could not sign in to ${account.name || account.id} (${account.id}): its role is not there yet, or does not trust this OneUptime. The setup command's StackSet adds it to every account.`
            : `Could not read ${account.name || account.id} (${account.id}): ${
                error instanceof Error ? error.message : String(error)
              }`,
        );
      }
    }

    state.accountStates = accountStates;
    state.accounts = accounts.map((account: { id: string }): string => {
      return account.id;
    });
    result.requestCount = budget.getUsed();
    result.warnings = result.warnings.slice(0, 50);

    return result;
  }

  private async readOneAccount(
    settings: CloudConnectionSettings,
    options: CloudReadOptions,
    budget: CloudReadBudget,
  ): Promise<CloudReadResult> {
    const now: Date = options.now ? options.now() : new Date();
    const state: CloudConnectionPullState = { ...options.state };
    const warnings: Array<string> = [];

    const credentials: AwsCredentials = await this.getCredentials(settings, {
      ...options,
      connectionId: options.connectionId,
      budget,
    });

    const inventoryDue: boolean = isOlderThan(state.inventoryAt, HOUR_MS, now);
    let accounts: Array<string> = state.accounts || [];

    if (inventoryDue || accounts.length === 0) {
      const identity: AwsCallerIdentity = await getCallerIdentity({
        transport: options.transport,
        credentials,
        region: this.getStsRegion(settings),
        now: options.now,
        timeoutInMs: options.requestTimeoutInMs,
        budget,
      });
      accounts = [identity.account];
    }

    const accountId: string = accounts[0] || "";
    const configured: Array<string> = this.getConfiguredRegions(settings);
    const isAuto: boolean = configured.length === 0;
    let activePairs: Array<string> = state.activePairs || [];

    // 1. Where resources are.
    const fullSweepDue: boolean =
      isAuto && isOlderThan(state.fullSweepAt, DAY_MS, now);

    if (fullSweepDue || inventoryDue) {
      const activeRegions: Array<string> = Array.from(
        new Set(
          activePairs
            .map((key: string): string => {
              return readPair(key)?.region || "";
            })
            .filter((region: string): boolean => {
              return Boolean(region);
            }),
        ),
      );
      const regions: Array<string> = !isAuto
        ? configured
        : fullSweepDue
          ? [...AWS_ALL_COMMERCIAL_REGIONS]
          : activeRegions;

      let swept: {
        activePairs: Array<string>;
        unreachableRegions: Array<string>;
      } | null = null;

      try {
        swept =
          regions.length > 0
            ? await this.sweep({ regions, credentials, options, budget })
            : { activePairs: [], unreachableRegions: [] };
      } catch (error) {
        // Out of budget: the pairs found before stay, the sweep runs again.
        if (!(error instanceof CloudReadBudgetSpent)) {
          throw error;
        }
      }

      if (swept) {
        // Pairs of Regions not swept this time are kept as they were.
        activePairs = [
          ...activePairs.filter((key: string): boolean => {
            return !regions.includes(readPair(key)?.region || "");
          }),
          ...swept.activePairs,
        ];

        if (!isAuto && swept.unreachableRegions.length > 0) {
          warnings.push(
            `Could not read ${swept.unreachableRegions.join(", ")}: the Region is not enabled for the account, or could not be reached.`,
          );
        }

        if (fullSweepDue) {
          state.fullSweepAt = now.toISOString();
        }

        state.inventoryAt = now.toISOString();
      }
    }

    state.activePairs = activePairs;
    state.accounts = accounts;

    // 2. Each key metric's series, per Region and namespace in use.
    const pairs: Array<RegionNamespace> = [];

    for (const key of activePairs) {
      const pair: { region: string; namespace: string } | null = readPair(key);
      const namespace: AwsNamespaceKeyMetrics | undefined = pair
        ? AWS_KEY_METRICS.find((entry: AwsNamespaceKeyMetrics): boolean => {
            return entry.namespace === pair.namespace;
          })
        : undefined;

      if (pair && namespace) {
        pairs.push({ region: pair.region, namespace });
      }
    }

    const added: Array<CloudAddedMetric> = options.addedMetrics || [];
    /*
     * The units the reads learned of the additions (#10077), of the ones
     * that are still added: asked again in this read where that is due.
     */
    const units: Record<string, AwsAddedMetricUnitState> = {};

    for (const metric of added) {
      if (state.awsAddedMetricUnits?.[metric.key]) {
        units[metric.key] = state.awsAddedMetricUnits[metric.key]!;
      }
    }

    let unitProbesLeft: number = AWS_UNIT_PROBES_PER_READ;
    const listed: Array<Settled<Array<AwsSeries>>> = await mapWithConcurrency(
      pairs,
      CONCURRENCY,
      async (pair: RegionNamespace): Promise<Array<AwsSeries>> => {
        return await this.listSeries({
          pair,
          accountId,
          credentials,
          options,
          budget,
          addedMetrics: getAwsTypeAdditionsOfNamespace({
            added,
            namespace: pair.namespace.namespace,
          }),
          learnedUnits: units,
        });
      },
    );

    const series: Array<AwsSeries> = [];

    listed.forEach((outcome: Settled<Array<AwsSeries>>, index: number) => {
      if (outcome.ok) {
        series.push(...outcome.value);
        return;
      }

      if (outcome.error instanceof CloudReadBudgetSpent) {
        return;
      }

      if (
        outcome.error instanceof LlmProviderError &&
        (outcome.error.kind === CloudConnectionFailureKind.Permission ||
          outcome.error.kind === CloudConnectionFailureKind.Authentication)
      ) {
        throw outcome.error;
      }

      const pair: RegionNamespace = pairs[index]!;
      warnings.push(
        `Could not list ${pair.namespace.namespace} in ${pair.region}: ${
          outcome.error instanceof Error
            ? outcome.error.message
            : String(outcome.error)
        }`,
      );
    });

    // The resources' own additions, on the series their listing found.
    for (const metric of getAwsResourceAdditionsToRead({
      added,
      accountId,
      activePairs,
    })) {
      if (metric.splitBy) {
        // Split (#9808): its series of each value, as CloudWatch lists them now.
        try {
          series.push(
            ...(await this.listOwnSplitSeries({
              metric,
              accountId,
              credentials,
              options,
              budget,
              learnedUnit: units[metric.key]?.unit,
            })),
          );
        } catch (error) {
          if (error instanceof CloudReadBudgetSpent) {
            break;
          }

          if (
            error instanceof LlmProviderError &&
            (error.kind === CloudConnectionFailureKind.Permission ||
              error.kind === CloudConnectionFailureKind.Authentication)
          ) {
            throw error;
          }

          warnings.push(
            `Could not list ${metric.namespace} ${metric.name} in ${metric.region}: ${
              error instanceof Error ? error.message : String(error)
            }`,
          );
        }

        continue;
      }

      const listedMetric: AwsListedMetric = {
        namespace: metric.namespace!,
        metricName: metric.name,
        dimensions: (metric.dimensions || []).map(
          (dimension: CloudAddedMetricDimension) => {
            return { name: dimension.name, value: dimension.value };
          },
        ),
      };
      const resource: CloudMonitoredResource | null = this.resolveSeries({
        metric: listedMetric,
        accountId,
        region: metric.region!,
      });

      if (resource) {
        series.push({
          metric: listedMetric,
          keyMetric: toAwsAddedKeyMetric(metric, units[metric.key]?.unit),
          resource,
          isAdded: true,
          addedKey: metric.key,
        });
      }
    }

    const coverage: AwsStreamCoverage =
      options.awsStreamCoverage || NO_AWS_STREAM_COVERAGE;

    /*
     * 3. Their values since the last read, per period - but those of the
     * key metrics a stream writes, which are read only where a resource's
     * health is judged from them (getAwsSeriesToRead), and the added
     * metrics a stream of every metric writes already.
     */
    // Said only where the read was told the streams' readings: one that was not reads as it always has.
    const readForHealth: Array<string> = options.awsStreamedReadingSources
      ? getAwsRegionsReadForStreamedHealth({
          series,
          accountId,
          coverage,
          streamedReadingSources: options.awsStreamedReadingSources,
        })
      : [];

    if (readForHealth.length > 0) {
      warnings.push(
        `The streams sent no resource health from ${readForHealth.join(", ")} lately, so it was read from CloudWatch.`,
      );
    }

    const toRead: Array<AwsSeries> = getAwsSeriesToRead({
      series,
      accountId,
      coverage,
      streamedReadingSources: options.awsStreamedReadingSources,
    }).filter((entry: AwsSeries): boolean => {
      return !(
        entry.isAdded &&
        isAwsNamespaceStreamedWhole({
          coverage,
          accountId,
          region: entry.resource.region,
          namespace: entry.metric.namespace,
        })
      );
    });
    const cursors: Record<string, string> = { ...(state.cursors || {}) };
    const groups: Map<string, CloudMetricGroup> = new Map();
    // Every listed series' period, read or not: its cursor moves on either way.
    const periods: Array<number> = Array.from(
      new Set(
        series.map((entry: AwsSeries): number => {
          return entry.keyMetric.periodSeconds;
        }),
      ),
    ).sort((a: number, b: number): number => {
      return a - b;
    });

    for (const periodSeconds of periods) {
      if (budget.isSpent()) {
        break;
      }

      const window: MetricWindow | null = getMetricWindow({
        policy: getMetricWindowPolicy({
          periodSeconds,
          delayMs: AWS_METRIC_DELAY_MS,
        }),
        cursor: cursors[String(periodSeconds)],
        now,
      });

      if (!window) {
        continue;
      }

      const ofPeriod: Array<AwsSeries> = toRead.filter(
        (entry: AwsSeries): boolean => {
          return entry.keyMetric.periodSeconds === periodSeconds;
        },
      );

      /*
       * A stream writes every series of the period: nothing to read, and
       * the window is done - a stream that goes quiet is read from here,
       * never again from the hours it wrote.
       */
      if (ofPeriod.length === 0) {
        cursors[String(periodSeconds)] = window.end.toISOString();
        continue;
      }

      const byRegion: Map<string, Array<AwsSeries>> = new Map();

      for (const entry of ofPeriod) {
        const region: string = entry.resource.region;
        const list: Array<AwsSeries> = byRegion.get(region) || [];
        list.push(entry);
        byRegion.set(region, list);
      }

      const regionEntries: Array<[string, Array<AwsSeries>]> = Array.from(
        byRegion.entries(),
      );

      /*
       * The units of the additions the calls read, asked in those calls
       * where it is due (#10077): no call more, only a few queries.
       */
      const probesOf: Array<Array<AwsUnitProbe>> = [];

      for (const entry of regionEntries) {
        const probes: Array<AwsUnitProbe> = planAwsUnitProbes({
          additions: getAwsUnitProbeAdditions({ series: entry[1], added }),
          units,
          now,
          room: MAX_QUERIES_PER_CALL - entry[1].length,
          probesLeft: unitProbesLeft,
        });

        unitProbesLeft -= probes.length;
        probesOf.push(probes);
      }

      const read: Array<Settled<Array<AwsMetricResult>>> =
        await mapWithConcurrency(
          regionEntries,
          CONCURRENCY,
          async (
            entry: [string, Array<AwsSeries>],
            regionIndex: number,
          ): Promise<Array<AwsMetricResult>> => {
            return await getMetricData(
              {
                transport: options.transport,
                credentials,
                region: entry[0],
                now: options.now,
                timeoutInMs: options.requestTimeoutInMs,
                sleep: options.sleep,
                budget,
              },
              {
                queries: [
                  ...entry[1].map(
                    (item: AwsSeries, index: number): AwsMetricQuery => {
                      return {
                        id: `q${index}`,
                        namespace: item.metric.namespace,
                        metricName: item.metric.metricName,
                        dimensions: item.metric.dimensions,
                        statistic: item.keyMetric.statistic,
                        periodSeconds,
                      };
                    },
                  ),
                  ...(probesOf[regionIndex] || []).flatMap(
                    (probe: AwsUnitProbe): Array<AwsMetricQuery> => {
                      return buildAwsUnitProbeQueries(probe, periodSeconds);
                    },
                  ),
                ],
                startTime: window.start,
                endTime: window.end,
              },
            );
          },
        );

      /*
       * The window moves on only when every Region was read: a Region that
       * failed is read again from the same start next time, and a Region
       * that worked would then be written twice - so a partial window is
       * dropped whole and read again.
       */
      const allRead: boolean = read.every(
        (outcome: Settled<Array<AwsMetricResult>>): boolean => {
          return outcome.ok;
        },
      );

      if (!allRead) {
        for (const outcome of read) {
          if (!outcome.ok && !(outcome.error instanceof CloudReadBudgetSpent)) {
            if (
              outcome.error instanceof LlmProviderError &&
              (outcome.error.kind === CloudConnectionFailureKind.Permission ||
                outcome.error.kind ===
                  CloudConnectionFailureKind.Authentication)
            ) {
              throw outcome.error;
            }

            warnings.push(
              `Could not read metrics: ${
                outcome.error instanceof Error
                  ? outcome.error.message
                  : String(outcome.error)
              }`,
            );
          }
        }

        continue;
      }

      read.forEach(
        (outcome: Settled<Array<AwsMetricResult>>, regionIndex: number) => {
          if (!outcome.ok) {
            return;
          }

          const [region, regionSeries] = regionEntries[regionIndex]!;

          // What the calls' unit queries say of each addition's unit (#10077).
          for (const probe of probesOf[regionIndex] || []) {
            const before: string | undefined = units[probe.key]?.unit;

            units[probe.key] = readAwsUnitProbe({
              probe,
              results: outcome.value,
              state: units[probe.key],
              now,
            });

            const learned: string | undefined = units[probe.key]?.unit;

            // Learned now: this read's points are written with it.
            if (learned && learned !== before) {
              for (const item of regionSeries) {
                if (item.addedKey === probe.key) {
                  item.keyMetric = { ...item.keyMetric, unit: learned };
                }
              }
            }
          }

          for (const result of outcome.value) {
            // A unit query's answer is no series of the read's.
            if (isAwsUnitProbeResult(result.id) || !result.id.startsWith("q")) {
              continue;
            }

            const item: AwsSeries | undefined =
              regionSeries[Number(result.id.slice(1))];

            if (!item) {
              continue;
            }

            this.addToGroup({
              groups,
              serviceName: options.serviceName,
              connectionId: options.connectionId,
              accountId,
              region,
              item,
              points: result.timestamps.map(
                (time: number, position: number): CloudMetricPoint => {
                  return { timeMs: time, value: result.values[position]! };
                },
              ),
            });
          }
        },
      );

      cursors[String(periodSeconds)] = window.end.toISOString();
    }

    state.cursors = cursors;
    state.awsAddedMetricUnits = units;

    // 4. Names for resources known by an id.
    const names: Map<string, string> = new Map();

    if (inventoryDue && !budget.isSpent()) {
      const regions: Array<string> = Array.from(
        new Set(
          series.map((entry: AwsSeries): string => {
            return entry.resource.region;
          }),
        ),
      );

      const tagged: Array<Settled<Map<string, string>>> =
        await mapWithConcurrency(
          regions,
          CONCURRENCY,
          async (region: string): Promise<Map<string, string>> => {
            return await getNameTags({
              transport: options.transport,
              credentials,
              region,
              now: options.now,
              timeoutInMs: options.requestTimeoutInMs,
              sleep: options.sleep,
              budget,
            });
          },
        );

      let refused: boolean = false;

      for (const outcome of tagged) {
        if (outcome.ok) {
          for (const [arn, name] of outcome.value) {
            names.set(arn, name);
          }
        } else if (
          outcome.error instanceof LlmProviderError &&
          outcome.error.kind === CloudConnectionFailureKind.Permission
        ) {
          refused = true;
        }
      }

      if (refused) {
        warnings.push(
          "Resources keep their ids as names: the role or user may not call tag:GetResources. Run the setup command again to allow it.",
        );
      }
    }

    const resources: Map<string, CloudDiscoveredResource> = new Map();

    for (const entry of series) {
      if (!resources.has(entry.resource.identityKey)) {
        const name: string | undefined = names.get(
          entry.resource.providerResourceId.toLowerCase(),
        );

        resources.set(entry.resource.identityKey, {
          resource: entry.resource,
          displayName: name,
        });
      }
    }

    const metricGroups: Array<CloudMetricGroup> = Array.from(groups.values());

    if (budget.isSpent()) {
      warnings.push(
        "This read stopped at its limit and carries on within a minute. Name fewer Regions to read the account in one go.",
      );
    }

    return {
      accounts,
      resources: Array.from(resources.values()),
      completelyListedAccounts: [],
      payloads: buildMetricsPayloads(metricGroups),
      pointsWritten: countPayloadPoints(metricGroups),
      requestCount: budget.getUsed(),
      warnings,
      complete: !budget.isSpent(),
      nextState: state,
    };
  }

  /*
   * The account's inventory (AwsInventory): every resource of the
   * inventory's types in the Regions the connection names - or, naming
   * none, the Regions its metrics were found in - with the account's alias
   * as its name.
   */
  public async readInventory(
    settings: CloudConnectionSettings,
    options: CloudInventoryOptions,
  ): Promise<CloudInventoryResult> {
    if (!this.isOrganization(settings)) {
      return await this.readAccountInventory(settings, options, options.state);
    }

    /*
     * An organization: each account the last read reached, with the name
     * Organizations gives it, through its own role - the account listed
     * least recently first, so a listing that stops at its limit lists the
     * others next time.
     */
    const result: CloudInventoryResult = {
      accounts: [],
      items: [],
      completelyListed: [],
      warnings: [],
      complete: true,
    };
    const now: Date = options.now ? options.now() : new Date();
    const accountStates: Record<string, CloudConnectionPullState> =
      options.state.accountStates || {};

    for (const account of orderLeastRecentlyRead({
      accounts: options.state.organizationAccounts || [],
      readAt: (entry: { id: string }): string | undefined => {
        return accountStates[entry.id]?.inventoryReadAt;
      },
    })) {
      if (options.budget.isSpent()) {
        result.complete = false;
        break;
      }

      const accountState: CloudConnectionPullState = accountStates[
        account.id
      ] || {
        accounts: [account.id],
      };

      // Tried, whatever comes of it: the others go first next time.
      options.state.accountStates = {
        ...(options.state.accountStates || {}),
        [account.id]: { ...accountState, inventoryReadAt: now.toISOString() },
      };

      try {
        const listed: CloudInventoryResult = await this.readAccountInventory(
          this.settingsForAccount(settings, account.id),
          options,
          accountState,
        );

        result.accounts.push(
          ...listed.accounts.map(
            (entry: { accountId: string; name?: string | undefined }) => {
              return {
                accountId: entry.accountId,
                name: account.name || entry.name,
              };
            },
          ),
        );
        result.items.push(...listed.items);
        result.completelyListed.push(...listed.completelyListed);
        result.warnings.push(
          ...listed.warnings.map((warning: string): string => {
            return `${account.name || account.id}: ${warning}`;
          }),
        );
        result.complete = result.complete && listed.complete;
      } catch (error) {
        if (error instanceof CloudReadBudgetSpent) {
          // Not listed after all: it stays first in line.
          options.state.accountStates = {
            ...(options.state.accountStates || {}),
            [account.id]: accountState,
          };
          result.complete = false;
          break;
        }

        result.accounts.push({ accountId: account.id, name: account.name });

        if (
          !(
            error instanceof LlmProviderError &&
            (error.kind === CloudConnectionFailureKind.Authentication ||
              error.kind === CloudConnectionFailureKind.Permission)
          )
        ) {
          result.warnings.push(
            `Could not list the resources of ${account.name || account.id}: ${
              error instanceof Error ? error.message : String(error)
            }`,
          );
        }
      }
    }

    result.warnings = result.warnings.slice(0, 50);

    return result;
  }

  /*
   * The accounts a read of changes covers, each with the settings it is
   * signed in with and the Regions its activity is read in: the ones the
   * connection names, or the ones its metrics were found in - and the
   * partition's home Region always (us-east-1, us-gov-west-1, cn-north-1),
   * where IAM, CloudFront and Route 53 record theirs. An organization's
   * accounts come read least recently first, so a read that stops at its
   * limit reaches the others next time.
   */
  private getChangeAccounts(
    settings: CloudConnectionSettings,
    state: CloudConnectionPullState,
  ): Array<{
    accountId: string;
    name: string;
    settings: CloudConnectionSettings;
    regions: Array<string>;
  }> {
    const configured: Array<string> = this.getConfiguredRegions(settings);
    const homeRegion: string = this.getStsRegion(settings);
    const regionsOf: (
      accountState: CloudConnectionPullState,
    ) => Array<string> = (
      accountState: CloudConnectionPullState,
    ): Array<string> => {
      const active: Array<string> =
        configured.length > 0
          ? configured
          : (accountState.activePairs || [])
              .map((key: string): string => {
                return readPair(key)?.region || "";
              })
              .filter((region: string): boolean => {
                return Boolean(region);
              });

      return Array.from(new Set([...active, homeRegion]));
    };

    if (!this.isOrganization(settings)) {
      return [
        {
          accountId: state.accounts?.[0] || "",
          name: "",
          settings,
          regions: regionsOf(state),
        },
      ];
    }

    return orderLeastRecentlyRead({
      accounts: state.organizationAccounts || [],
      readAt: (account: { id: string }): string | undefined => {
        return state.accountStates?.[account.id]?.changesReadAt;
      },
    }).map((account: { id: string; name: string }) => {
      return {
        accountId: account.id,
        name: account.name,
        settings: this.settingsForAccount(settings, account.id),
        regions: regionsOf(state.accountStates?.[account.id] || {}),
      };
    });
  }

  // An organization's account's changes were read (or tried): the others go first next time.
  private markChangesRead(
    state: CloudConnectionPullState,
    accountId: string,
    now: Date,
  ): void {
    if (!accountId || !state.accountStates?.[accountId]) {
      return;
    }

    state.accountStates = {
      ...state.accountStates,
      [accountId]: {
        ...state.accountStates[accountId],
        changesReadAt: now.toISOString(),
      },
    };
  }

  /*
   * What changed in each account (CloudTrail, every Region it is read in)
   * since the last read, and - every 15 minutes - AWS Health's events about
   * it. A look back for an investigation reads only the accounts and
   * Regions it names, from its own start, and moves no cursor.
   *
   * CloudTrail lists newest first, five pages of fifty a Region at most:
   * a Region busier than that has its newest changes kept, and the read
   * says the older ones of that stretch were left out (CloudChangeWindow).
   */
  public async readChanges(
    settings: CloudConnectionSettings,
    options: CloudChangesOptions,
  ): Promise<CloudChangesResult> {
    const now: Date = options.now ? options.now() : new Date();
    const state: CloudConnectionPullState = options.state;
    const result: CloudChangesResult = {
      changes: [],
      warnings: [],
      complete: true,
    };
    const isLookBack: boolean = Boolean(options.since);
    const keepAudit: boolean = keepsAuditRecords(options);

    if (keepAudit) {
      result.auditRecords = [];
    }

    const isOrganization: boolean = this.isOrganization(settings);
    const homeRegion: string = this.getStsRegion(settings);
    let refusedTrail: boolean = false;
    const busyPlaces: Array<string> = [];
    const healthDue: boolean =
      !isLookBack && isOlderThan(state.healthReadAt, HEALTH_INTERVAL_MS, now);

    for (const account of this.getChangeAccounts(settings, state)) {
      const only:
        | { accountId: string; regions?: Array<string> | undefined }
        | undefined = options.only?.find(
        (entry: { accountId: string }): boolean => {
          return entry.accountId === account.accountId;
        },
      );

      if (options.only && !only) {
        continue;
      }

      if (options.budget.isSpent()) {
        result.complete = false;
        break;
      }

      let credentials: AwsCredentials;
      let accountId: string = account.accountId;

      try {
        credentials = await this.getCredentials(account.settings, {
          ...options,
          connectionId: options.connectionId,
          budget: options.budget,
        });

        if (!accountId) {
          accountId = (
            await getCallerIdentity({
              transport: options.transport,
              credentials,
              region: homeRegion,
              now: options.now,
              timeoutInMs: options.requestTimeoutInMs,
              budget: options.budget,
            })
          ).account;
        }
      } catch (error) {
        if (error instanceof CloudReadBudgetSpent) {
          result.complete = false;
          break;
        }

        // An organization's member without its role: the others are read.
        if (isOrganization && error instanceof LlmProviderError) {
          if (!isLookBack) {
            this.markChangesRead(state, account.accountId, now);
          }

          continue;
        }

        throw error;
      }

      const regions: Array<string> =
        only?.regions && only.regions.length > 0
          ? Array.from(new Set([...only.regions, homeRegion]))
          : account.regions;

      const outcomes: Array<
        Settled<{
          changes: Array<CloudChange>;
          complete: boolean;
          auditRecords: Array<CloudAuditRecord>;
        }>
      > = await mapWithConcurrency(
        regions,
        CHANGE_REGION_CONCURRENCY,
        async (
          region: string,
        ): Promise<{
          changes: Array<CloudChange>;
          complete: boolean;
          auditRecords: Array<CloudAuditRecord>;
        }> => {
          return await lookupAwsChanges({
            credentials,
            accountId,
            region,
            start: getChangeWindowStart({
              state,
              place: getChangePlace(accountId, region),
              now,
              since: options.since,
            }),
            end: now,
            options,
            budget: options.budget,
            keepAuditRecords: keepAudit,
          });
        },
      );

      for (let index: number = 0; index < outcomes.length; index++) {
        const outcome: Settled<{
          changes: Array<CloudChange>;
          complete: boolean;
          auditRecords: Array<CloudAuditRecord>;
        }> = outcomes[index]!;
        const region: string = regions[index]!;

        if (outcome.ok) {
          result.auditRecords?.push(...outcome.value.auditRecords);

          result.changes.push(
            ...keepNewChanges({
              state,
              place: getChangePlace(accountId, region),
              changes: outcome.value.changes,
              now,
              complete: outcome.value.complete,
              isLookBack,
              order: "newest-first",
            }),
          );

          if (!outcome.value.complete) {
            busyPlaces.push(
              account.name ? `${account.name}, ${region}` : region,
            );
          }

          continue;
        }

        result.complete = false;

        if (outcome.error instanceof CloudReadBudgetSpent) {
          continue;
        }

        if (
          outcome.error instanceof LlmProviderError &&
          outcome.error.kind === CloudConnectionFailureKind.Authentication
        ) {
          /*
           * The home Region is open to every account: a credential refused
           * there is refused. Anywhere else it is a Region the account has
           * not opted in to, which has nothing to read.
           */
          if (region === homeRegion && !isOrganization) {
            throw outcome.error;
          }

          continue;
        }

        if (
          outcome.error instanceof LlmProviderError &&
          outcome.error.kind === CloudConnectionFailureKind.Permission
        ) {
          refusedTrail = true;
          continue;
        }

        result.warnings.push(
          `Could not read what changed in ${account.name || accountId}, ${region}: ${
            outcome.error instanceof Error
              ? outcome.error.message
              : String(outcome.error)
          }`,
        );
      }

      if (
        healthDue &&
        !options.budget.isSpent() &&
        !isHealthPaused({ state, accountId, now })
      ) {
        try {
          const health: Array<CloudChange> | null = await readAwsHealthEvents({
            credentials,
            accountId,
            region: homeRegion,
            start: getHealthWindowStart({ state, accountId, now }),
            options,
            budget: options.budget,
          });

          if (health === null) {
            // Not on a support plan that includes AWS Health: asked again a day later.
            pauseHealth({ state, accountId, now, forMs: HEALTH_PAUSE_MS });
          } else {
            result.changes.push(
              ...keepNewChanges({
                state,
                place: getChangePlace(accountId, "health"),
                changes: health,
                now,
                complete: true,
                isLookBack,
              }),
            );
            markHealthRead({ state, accountId, now });
          }
        } catch (error) {
          if (
            error instanceof LlmProviderError &&
            error.kind === CloudConnectionFailureKind.Authentication &&
            !isOrganization
          ) {
            throw error;
          }

          // Health is a bonus: a refusal pauses it, any other failure waits for the next read.
          if (
            error instanceof LlmProviderError &&
            error.kind === CloudConnectionFailureKind.Permission
          ) {
            pauseHealth({ state, accountId, now, forMs: HEALTH_PAUSE_MS });
          }
        }
      }

      if (!isLookBack) {
        this.markChangesRead(state, accountId, now);
      }
    }

    if (healthDue) {
      state.healthReadAt = now.toISOString();
    }

    if (busyPlaces.length > 0) {
      result.warnings.push(
        `More changed in ${busyPlaces.slice(0, 5).join("; ")} than one read takes: the newest changes are kept, and some older ones were left out.`,
      );
    }

    if (refusedTrail) {
      result.warnings.push(
        "The role may not read CloudTrail (cloudtrail:LookupEvents). Run the setup command again to allow it.",
      );
    }

    return result;
  }

  /*
   * The accounts a read of costs or savings is about: the one account, or
   * every account of the organization the last read listed, with the
   * management account itself.
   */
  private getCostAccounts(
    settings: CloudConnectionSettings,
    state: CloudConnectionPullState,
  ): Array<string> {
    if (!this.isOrganization(settings)) {
      return [state.accounts?.[0] || ""];
    }

    return Array.from(
      new Set<string>(
        [
          ...(state.accounts || []),
          ...(state.organizationAccounts || []).map(
            (account: { id: string }): string => {
              return account.id;
            },
          ),
        ].filter((accountId: string): boolean => {
          return Boolean(accountId);
        }),
      ),
    );
  }

  /*
   * The credential and the account a read of costs or savings is signed
   * with: the connection's own - an organization's management account,
   * which reads every account's - and the account it is in, asked when no
   * read has said it yet.
   */
  private async getCostCredentials(
    settings: CloudConnectionSettings,
    options: CloudCostsOptions | CloudSavingsOptions,
  ): Promise<{ credentials: AwsCredentials; accounts: Array<string> }> {
    const credentials: AwsCredentials = await this.getCredentials(settings, {
      ...options,
      connectionId: options.connectionId,
      budget: options.budget,
    });
    let accounts: Array<string> = this.getCostAccounts(settings, options.state);

    if (!this.isOrganization(settings) && !accounts[0]) {
      accounts = [
        (
          await getCallerIdentity({
            transport: options.transport,
            credentials,
            region: this.getStsRegion(settings),
            now: options.now,
            timeoutInMs: options.requestTimeoutInMs,
            budget: options.budget,
          })
        ).account,
      ];
    }

    return { credentials, accounts };
  }

  private static outcomesOf(
    accounts: Array<string>,
    state: CloudCostState,
    message?: string | undefined,
  ): Array<CloudCostAccountOutcome> {
    return accounts.map((accountId: string): CloudCostAccountOutcome => {
      return message ? { accountId, state, message } : { accountId, state };
    });
  }

  /*
   * What the connection's accounts cost per day, from Cost Explorer: by
   * service and Region for one account, by account and service from an
   * organization's management account - one call for every account
   * (AwsCosts). A refused credential fails the read; anything else is the
   * accounts' outcome, said in words they can act on.
   */
  public async readCosts(
    settings: CloudConnectionSettings,
    options: CloudCostsOptions,
  ): Promise<CloudCostsResult> {
    const region: string | null = getAwsCostRegion(this.getStsRegion(settings));
    const isOrganization: boolean = this.isOrganization(settings);

    if (!region) {
      return {
        records: [],
        accounts: AwsCloudConnector.outcomesOf(
          this.getCostAccounts(settings, options.state),
          CloudCostState.NotSetUp,
          "A GovCloud account's costs are read from the standard AWS account it is billed through. Connect that account to see them.",
        ),
        warnings: [],
        complete: true,
      };
    }

    const { credentials, accounts } = await this.getCostCredentials(
      settings,
      options,
    );
    const now: Date = options.now ? options.now() : new Date();
    const resourceCostsOn: boolean = this.isResourceCostsOn(settings);
    // Costs per resource, when due: the days they are read for.
    const resourceWindow: { start: Date; end: Date } | null =
      resourceCostsOn &&
      isAwsResourceCostsDue({
        now,
        lastReadAt: options.state.resourceCostsReadAt,
      })
        ? getAwsResourceCostWindow({
            now,
            lastReadAt: options.state.resourceCostsReadAt,
          })
        : null;
    /*
     * The account's own figures cover every day the resources are read
     * for: they are split into the resources' costs and the rest. A first
     * read of the resources goes back further than a read of the costs.
     */
    const start: Date = resourceWindow
      ? getEarlierCostDay(options.start, resourceWindow.start)
      : options.start;

    try {
      const read: {
        records: Array<CloudCostsResult["records"][number]>;
        complete: boolean;
      } = await readAwsCostAndUsage({
        credentials,
        region,
        accountId: accounts[0] || "",
        groupByAccount: isOrganization,
        start,
        end: options.end,
        options,
        budget: options.budget,
      });

      if (!read.complete) {
        return {
          records: [],
          accounts: AwsCloudConnector.outcomesOf(
            accounts,
            CloudCostState.Failed,
            "The costs had more pages than one read takes: they are read again shortly.",
          ),
          warnings: [
            "The accounts' costs had more pages than one read takes: they are read again shortly.",
          ],
          complete: false,
        };
      }

      const seen: Set<string> = new Set<string>(accounts);

      for (const record of read.records) {
        seen.add(record.accountId);
      }

      const result: CloudCostsResult = {
        records: read.records,
        accounts: AwsCloudConnector.outcomesOf(
          Array.from(seen),
          CloudCostState.Reading,
        ),
        warnings: [],
        complete: true,
        ...(start.getTime() < options.start.getTime()
          ? { window: { start, end: options.end } }
          : {}),
      };

      if (resourceCostsOn) {
        await this.addResourceCosts({
          result,
          credentials,
          region,
          accounts: Array.from(seen),
          isOrganization,
          window: resourceWindow,
          options,
          now,
        });
      }

      return result;
    } catch (error) {
      if (
        error instanceof LlmProviderError &&
        error.kind === CloudConnectionFailureKind.Authentication
      ) {
        throw error;
      }

      const failure: { state: CloudCostState; message: string } =
        error instanceof CloudReadBudgetSpent
          ? {
              state: CloudCostState.Failed,
              message:
                "The read reached its limit before the costs: they are read again shortly.",
            }
          : describeAwsCostFailure({ error, what: "costs" });

      return {
        records: [],
        accounts: AwsCloudConnector.outcomesOf(
          accounts,
          failure.state,
          failure.message,
        ),
        warnings: [failure.message],
        complete: false,
      };
    }
  }

  // Whether the connection reads what each resource costs (its Costs per resource setting).
  public isResourceCostsOn(settings: CloudConnectionSettings): boolean {
    return isCloudConnectionResourceCostsOn(
      readCloudSetting(settings.config, RESOURCE_COSTS_FIELD_KEY),
    );
  }

  /*
   * The organization's management account - the one the connection's role
   * is in - whose Cost Explorer reads every account's commitments at once.
   */
  public getManagementAccountId(settings: CloudConnectionSettings): string {
    const roleArn: string = readCloudSetting(settings.config, "roleArn");
    const parts: Array<string> = roleArn.split(":");

    return parts.length >= 6 && parts[0] === "arn" ? parts[4] || "" : "";
  }

  /*
   * The resources' costs, laid over the account's own figures: read when
   * due (once a day) - the days read are split into each resource's cost
   * and the rest - and, on every other read, each day keeping what it was
   * split into before (splitAwsCostsByResource). Whether they could be read
   * goes on each account's summary; a refused credential fails the read.
   */
  private async addResourceCosts(data: {
    result: CloudCostsResult;
    credentials: AwsCredentials;
    region: string;
    accounts: Array<string>;
    isOrganization: boolean;
    window: { start: Date; end: Date } | null;
    options: CloudCostsOptions;
    now: Date;
  }): Promise<void> {
    const places: AwsResourcePlaces = new AwsResourcePlaces({
      knownResources: data.options.knownResources || [],
      onlyAccountId: data.isOrganization ? "" : data.accounts[0] || "",
    });
    const keepSplits: () => void = (): void => {
      data.result.records = splitAwsCostsByResource({
        records: data.result.records,
        resourceCosts: [],
        coveredDays: new Set<string>(),
        places,
      });
    };

    // Not due: every day keeps the resources it was split into.
    if (!data.window) {
      keepSplits();
      return;
    }

    try {
      const read: { costs: Array<AwsResourceCost>; complete: boolean } =
        await readAwsResourceCosts({
          credentials: data.credentials,
          region: data.region,
          services: getAwsResourceCostServices({
            records: data.result.records,
            start: data.window.start,
            end: data.window.end,
          }),
          start: data.window.start,
          end: data.window.end,
          options: data.options,
          budget: data.options.budget,
        });

      if (!read.complete) {
        const message: string =
          "The costs per resource had more pages than one read takes: the next read takes the last three days only.";

        keepSplits();
        data.result.warnings.push(message);
        data.result.resourceCosts = AwsCloudConnector.outcomesOf(
          data.accounts,
          CloudCostState.Failed,
          message,
        );
        // Read again tomorrow, over the last days only: it fits then.
        data.result.resourceCostsReadAt = data.now.toISOString();
        return;
      }

      data.result.records = splitAwsCostsByResource({
        records: data.result.records,
        resourceCosts: read.costs,
        coveredDays: getCloudCostDays(data.window),
        places,
      });
      data.result.resourceCosts = AwsCloudConnector.outcomesOf(
        data.accounts,
        CloudCostState.Reading,
      );
      data.result.resourceCostsReadAt = data.now.toISOString();
    } catch (error) {
      if (
        error instanceof LlmProviderError &&
        error.kind === CloudConnectionFailureKind.Authentication
      ) {
        throw error;
      }

      const failure: { state: CloudCostState; message: string } =
        describeAwsResourceCostFailure(error);

      keepSplits();
      data.result.warnings.push(failure.message);
      data.result.resourceCosts = AwsCloudConnector.outcomesOf(
        data.accounts,
        failure.state,
        failure.message,
      );
    }
  }

  /*
   * The ways to spend less in the connection's accounts, from Cost
   * Optimization Hub - an organization's every account from its management
   * account, else the one account's - and how much of the spend their
   * Savings Plans and Reserved Instances cover and how much of those is
   * used (AwsCommitments): an organization's at once, on its management
   * account.
   */
  public async readSavings(
    settings: CloudConnectionSettings,
    options: CloudSavingsOptions,
  ): Promise<CloudSavingsResult> {
    const region: string | null = getAwsCostRegion(this.getStsRegion(settings));

    if (!region) {
      const accounts: Array<string> = this.getCostAccounts(
        settings,
        options.state,
      );

      return {
        recommendations: [],
        accounts: AwsCloudConnector.outcomesOf(
          accounts,
          CloudCostState.NotSetUp,
          "A GovCloud account's recommendations are read from the standard AWS account it is billed through.",
        ),
        warnings: [],
        complete: true,
        commitments: accounts.slice(0, 1).map((accountId: string) => {
          return {
            accountId,
            summary: {
              state: CloudCostState.NotSetUp,
              message:
                "A GovCloud account's commitments are read from the standard AWS account it is billed through.",
              currency: CLOUD_COST_DEFAULT_CURRENCY,
              days: CLOUD_COMMITMENT_WINDOW_DAYS,
              kinds: [],
              readAt: (options.now ? options.now() : new Date()).toISOString(),
            },
          };
        }),
      };
    }

    const { credentials, accounts } = await this.getCostCredentials(
      settings,
      options,
    );
    const result: CloudSavingsResult = await this.readRecommendations({
      settings,
      options,
      credentials,
      region,
      accounts,
    });
    const isOrganization: boolean = this.isOrganization(settings);
    const commitments: CloudCommitmentSummary = await readAwsCommitments({
      credentials,
      region,
      options,
      budget: options.budget,
      now: options.now ? options.now() : new Date(),
      isOrganization,
    });
    const accountId: string =
      (isOrganization ? this.getManagementAccountId(settings) : "") ||
      accounts[0] ||
      "";

    if (accountId) {
      result.commitments = [{ accountId, summary: commitments }];
    }

    if (commitments.state !== CloudCostState.Reading && commitments.message) {
      result.warnings.push(commitments.message);
    }

    return result;
  }

  // Cost Optimization Hub's recommendations for the accounts read.
  private async readRecommendations(data: {
    settings: CloudConnectionSettings;
    options: CloudSavingsOptions;
    credentials: AwsCredentials;
    region: string;
    accounts: Array<string>;
  }): Promise<CloudSavingsResult> {
    const settings: CloudConnectionSettings = data.settings;
    const options: CloudSavingsOptions = data.options;
    const credentials: AwsCredentials = data.credentials;
    const region: string = data.region;
    const accounts: Array<string> = data.accounts;

    try {
      const read: {
        recommendations: CloudSavingsResult["recommendations"];
        complete: boolean;
      } = await readAwsCostOptimizationHub({
        credentials,
        region,
        options,
        budget: options.budget,
      });

      if (!read.complete) {
        return {
          recommendations: [],
          accounts: AwsCloudConnector.outcomesOf(
            accounts,
            CloudCostState.Failed,
            "There were more recommendations than one read takes: they are read again tomorrow.",
          ),
          warnings: [],
          complete: false,
        };
      }

      const known: Set<string> = new Set<string>(accounts);

      return {
        // Only the connection's accounts: a management account sees others.
        recommendations: read.recommendations.filter(
          (recommendation: CloudSavingsResult["recommendations"][number]) => {
            return this.isOrganization(settings)
              ? true
              : known.has(recommendation.accountId);
          },
        ),
        accounts: AwsCloudConnector.outcomesOf(
          this.isOrganization(settings)
            ? Array.from(
                new Set<string>([
                  ...accounts,
                  ...read.recommendations.map(
                    (
                      recommendation: CloudSavingsResult["recommendations"][number],
                    ): string => {
                      return recommendation.accountId;
                    },
                  ),
                ]),
              )
            : accounts,
          CloudCostState.Reading,
        ),
        warnings: [],
        complete: true,
      };
    } catch (error) {
      if (
        error instanceof LlmProviderError &&
        error.kind === CloudConnectionFailureKind.Authentication
      ) {
        throw error;
      }

      const failure: { state: CloudCostState; message: string } =
        error instanceof CloudReadBudgetSpent
          ? {
              state: CloudCostState.Failed,
              message:
                "The read reached its limit before the recommendations: they are read again tomorrow.",
            }
          : describeAwsCostFailure({ error, what: "savings" });

      return {
        recommendations: [],
        accounts: AwsCloudConnector.outcomesOf(
          accounts,
          failure.state,
          failure.message,
        ),
        warnings: [failure.message],
        complete: false,
      };
    }
  }

  private async readAccountInventory(
    settings: CloudConnectionSettings,
    options: CloudInventoryOptions,
    state: CloudConnectionPullState,
  ): Promise<CloudInventoryResult> {
    const credentials: AwsCredentials = await this.getCredentials(settings, {
      ...options,
      connectionId: options.connectionId,
      budget: options.budget,
    });

    let accountId: string = state.accounts?.[0] || "";

    if (!accountId) {
      const identity: AwsCallerIdentity = await getCallerIdentity({
        transport: options.transport,
        credentials,
        region: this.getStsRegion(settings),
        now: options.now,
        timeoutInMs: options.requestTimeoutInMs,
        budget: options.budget,
      });
      accountId = identity.account;
    }

    const configured: Array<string> = this.getConfiguredRegions(settings);
    const regions: Array<string> =
      configured.length > 0
        ? configured
        : Array.from(
            new Set(
              (state.activePairs || [])
                .map((key: string): string => {
                  return readPair(key)?.region || "";
                })
                .filter((region: string): boolean => {
                  return Boolean(region);
                }),
            ),
          );

    const outcome: AwsInventoryOutcome = await readAwsInventory({
      accountId,
      regions,
      homeRegion: this.getStsRegion(settings),
      credentials,
      options,
      budget: options.budget,
    });

    const alias: string = options.budget.isSpent()
      ? ""
      : await getAwsAccountAlias({
          credentials,
          region: this.getStsRegion(settings),
          options,
          budget: options.budget,
        }).catch((error: unknown): string => {
          if (error instanceof CloudReadBudgetSpent) {
            return "";
          }

          throw error;
        });

    return {
      accounts: [{ accountId, name: alias || undefined }],
      items: outcome.items,
      // Per Region: a Region the listing did not read keeps what it holds.
      completelyListed: outcome.completelyListed.map(
        (entry: { region: string; resourceTypes: Array<string> }) => {
          return {
            accountId,
            regions: [entry.region],
            resourceTypes: entry.resourceTypes,
          };
        },
      ),
      warnings: outcome.warnings,
      complete: outcome.complete && !options.budget.isSpent(),
    };
  }

  /*
   * A resource's own addition split by a dimension (#9808): the series
   * CloudWatch lists of it on the resource's dimensions, lately active,
   * that carry the split one more - a series per value, the first
   * CLOUD_ADDED_METRIC_MAX_SPLIT_VALUES by value.
   */
  private async listOwnSplitSeries(data: {
    metric: CloudAddedMetric;
    accountId: string;
    credentials: AwsCredentials;
    options: CloudReadOptions;
    budget: CloudReadBudget;
    learnedUnit?: string | undefined;
  }): Promise<Array<AwsSeries>> {
    const own: Array<CloudAddedMetricDimension> = (
      data.metric.dimensions || []
    ).map((dimension: CloudAddedMetricDimension) => {
      return { name: dimension.name, value: dimension.value };
    });
    const listed: Array<AwsListedMetric> = await listMetrics(
      {
        transport: data.options.transport,
        credentials: data.credentials,
        region: data.metric.region!,
        now: data.options.now,
        timeoutInMs: data.options.requestTimeoutInMs,
        sleep: data.options.sleep,
        budget: data.budget,
      },
      {
        namespace: data.metric.namespace!,
        metricName: data.metric.name,
        dimensions: own,
      },
    );
    const resource: CloudMonitoredResource | null = this.resolveSeries({
      metric: {
        namespace: data.metric.namespace!,
        metricName: data.metric.name,
        dimensions: own,
      },
      accountId: data.accountId,
      region: data.metric.region!,
    });

    if (!resource) {
      return [];
    }

    return pickAwsSplitSeries({
      listed,
      own,
      splitBy: data.metric.splitBy!,
    }).map((metric: AwsListedMetric): AwsSeries => {
      return {
        metric,
        keyMetric: toAwsAddedKeyMetric(data.metric, data.learnedUnit),
        resource,
        isAdded: true,
        addedKey: data.metric.key,
      };
    });
  }

  private addToGroup(data: {
    groups: Map<string, CloudMetricGroup>;
    serviceName: string;
    connectionId: string;
    accountId: string;
    region: string;
    item: AwsSeries;
    points: Array<CloudMetricPoint>;
  }): void {
    const key: string = `${data.accountId}|${data.region}`;
    let group: CloudMetricGroup | undefined = data.groups.get(key);

    if (!group) {
      group = {
        resourceAttributes: this.resourceAttributes({
          serviceName: data.serviceName,
          connectionId: data.connectionId,
          accountId: data.accountId,
          region: data.region,
        }),
        metrics: [],
      };
      data.groups.set(key, group);
    }

    const name: string = getAwsStoredMetricName(
      data.item.metric.namespace,
      data.item.metric.metricName,
    );
    let metric: CloudMetricGroup["metrics"][number] | undefined =
      group.metrics.find((candidate: { name: string }): boolean => {
        return candidate.name === name;
      });

    if (!metric) {
      metric = { name, unit: data.item.keyMetric.unit, datapointSets: [] };
      group.metrics.push(metric);
    }

    metric.datapointSets.push({
      attributes: this.datapointAttributes(data.item.metric),
      points: data.points,
    });
  }
}
