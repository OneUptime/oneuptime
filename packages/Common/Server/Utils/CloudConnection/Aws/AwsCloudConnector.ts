import { CloudProvider } from "../../../../Types/Cloud/CloudPlatform";
import {
  AWS_KEY_METRICS,
  AwsKeyMetric,
  AwsNamespaceKeyMetrics,
  getAwsStoredMetricName,
} from "../../../../Types/Cloud/CloudKeyMetrics";
import { CloudMonitoredResource } from "../../../../Types/Cloud/CloudMonitoredResource";
import {
  CloudConnectionAuthMethod,
  CloudConnectionDefinition,
  getCloudConnectionAuthMethod,
  getCloudConnectionDefinition,
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
  CloudConnectionPullState,
  CloudConnectionSettings,
  CloudConnector,
  CloudConnectorCallOptions,
  CloudChange,
  CloudChangesOptions,
  CloudChangesResult,
  CloudDiscoveredResource,
  CloudInventoryOptions,
  CloudInventoryResult,
  CloudReadBudget,
  CloudReadBudgetSpent,
  CloudReadOptions,
  CloudReadResult,
  getCloudSecretValues,
  readCloudSetting,
} from "../CloudConnectorTypes";
import { AwsCredentials } from "./AwsApi";
import {
  AwsListedMetric,
  AwsMetricQuery,
  AwsMetricResult,
  getMetricData,
  listMetrics,
} from "./AwsCloudWatch";
import { AWS_ALL_COMMERCIAL_REGIONS, validateAwsRegions } from "./AwsRegions";
import AwsServerIdentity from "./AwsServerIdentity";
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
  keepNewChanges,
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
 *      per Region and namespace. A Region the account has not opted in to
 *      is skipped.
 *   2. For every Region and namespace in use: lists each key metric's
 *      series (ListMetrics), finds the resource each series is about with
 *      the ingest's own resolver, and keeps per resource the series with
 *      the fewest dimensions - the resource's own aggregate, not its
 *      per-target or per-zone splits.
 *   3. Reads those series' values since the last read (GetMetricData, one
 *      statistic each, 500 a call) and builds the export the CloudWatch
 *      receivers send (Namespace and Dimensions on each datapoint, the
 *      account and Region on the resource).
 *   4. Names resources CloudWatch knows by an id (an EC2 instance, a
 *      volume) by their Name tag, every hour.
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
export const AWS_MAX_ORGANIZATION_ACCOUNTS: number = 50;
// How often AWS Health is asked, and how long after a refusal it is not.
const HEALTH_INTERVAL_MS: number = 15 * 60 * 1000;
const HEALTH_PAUSE_MS: number = DAY_MS;
// CloudTrail Regions read at once for one account.
const CHANGE_REGION_CONCURRENCY: number = 4;

interface AwsSeries {
  metric: AwsListedMetric;
  keyMetric: AwsKeyMetric;
  resource: CloudMonitoredResource;
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
   * the assumed role's session (reused while it lasts).
   */
  public async getCredentials(
    settings: CloudConnectionSettings,
    options: CloudConnectorCallOptions & {
      connectionId?: string | undefined;
      budget?: CloudReadBudget | undefined;
      // A test signs in afresh: a role changed a minute ago is tried as it is.
      noCache?: boolean | undefined;
    },
  ): Promise<AwsCredentials> {
    if (this.getAuthMethod(settings) !== CloudConnectionAuthMethod.AwsRole) {
      return {
        accessKeyId: readCloudSetting(settings.config, "accessKeyId"),
        secretAccessKey: readCloudSetting(settings.secrets, "secretAccessKey"),
      };
    }

    const serverCredentials: AwsCredentials | null =
      AwsServerIdentity.getCredentials();

    if (!serverCredentials) {
      throw new LlmProviderError({
        message:
          "This OneUptime has no AWS identity to sign in to the role with any more (CLOUD_CONNECT_AWS_ACCESS_KEY_ID). Connect with an access key instead.",
        kind: CloudConnectionFailureKind.Settings,
      });
    }

    const roleArn: string = readCloudSetting(settings.config, "roleArn");
    const connectionId: string = options.connectionId || "test";
    const key: string = AssumedRoleCache.keyOf({
      projectId: settings.projectId,
      connectionId,
      roleArn,
    });

    if (!options.noCache) {
      const cached: AwsCredentials | undefined = AssumedRoleCache.get(key);

      if (cached) {
        return cached;
      }
    }

    const session: AwsAssumedRole = await assumeRole({
      transport: options.transport,
      credentials: serverCredentials,
      roleArn,
      projectId: settings.projectId,
      connectionId,
      region: this.getStsRegion(settings),
      now: options.now,
      timeoutInMs: options.requestTimeoutInMs,
      budget: options.budget,
    });

    if (!options.noCache) {
      AssumedRoleCache.set(key, session);
    }

    return session.credentials;
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

  // Does the namespace have a resource reporting its first key metric.
  private async hasResources(data: {
    region: string;
    namespace: AwsNamespaceKeyMetrics;
    credentials: AwsCredentials;
    options: CloudConnectorCallOptions;
    budget?: CloudReadBudget | undefined;
  }): Promise<boolean> {
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
        metricName: data.namespace.metrics[0]!.metricName,
        firstPageOnly: true,
      },
    );

    return listed.length > 0;
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
  }): Promise<Array<AwsSeries>> {
    const kept: Map<string, Array<AwsSeries>> = new Map();

    for (const keyMetric of data.pair.namespace.metrics) {
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
        },
      );

      for (const metric of listed) {
        const resource: CloudMonitoredResource | null = this.resolveSeries({
          metric,
          accountId: data.accountId,
          region: data.pair.region,
        });

        if (!resource) {
          continue;
        }

        const key: string = `${resource.identityKey}|${keyMetric.metricName}`;
        const existing: Array<AwsSeries> = kept.get(key) || [];
        const series: AwsSeries = { metric, keyMetric, resource };
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

    return all;
  }

  public async testConnection(
    settings: CloudConnectionSettings,
    options: CloudConnectorCallOptions,
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
    data.state.organizationListedAt = data.now.toISOString();

    return accounts;
  }

  /*
   * Every account of the organization, one after another, each with its own
   * read state and the one budget of the read. An account whose role cannot
   * be signed in to - the StackSet has not reached it yet - is a warning,
   * and the others are read.
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

    for (const account of accounts) {
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

        accountStates[account.id] = read.nextState;
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
        accountStates[account.id] = accountState;

        if (error instanceof CloudReadBudgetSpent) {
          result.complete = false;
          continue;
        }

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

    // 3. Their values since the last read, per period.
    const cursors: Record<string, string> = { ...(state.cursors || {}) };
    const groups: Map<string, CloudMetricGroup> = new Map();
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

      const ofPeriod: Array<AwsSeries> = series.filter(
        (entry: AwsSeries): boolean => {
          return entry.keyMetric.periodSeconds === periodSeconds;
        },
      );

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

      const read: Array<Settled<Array<AwsMetricResult>>> =
        await mapWithConcurrency(
          regionEntries,
          CONCURRENCY,
          async (
            entry: [string, Array<AwsSeries>],
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
                queries: entry[1].map(
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

          for (const result of outcome.value) {
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
     * Organizations gives it, through its own role.
     */
    const result: CloudInventoryResult = {
      accounts: [],
      items: [],
      completelyListed: [],
      warnings: [],
      complete: true,
    };

    for (const account of options.state.organizationAccounts || []) {
      if (options.budget.isSpent()) {
        result.complete = false;
        break;
      }

      try {
        const listed: CloudInventoryResult = await this.readAccountInventory(
          this.settingsForAccount(settings, account.id),
          options,
          options.state.accountStates?.[account.id] || {
            accounts: [account.id],
          },
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
   * connection names, or the ones its metrics were found in - and
   * us-east-1 always, where IAM, CloudFront and Route 53 record theirs.
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

      return Array.from(new Set([...active, "us-east-1"]));
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

    return (state.organizationAccounts || []).map(
      (account: { id: string; name: string }) => {
        return {
          accountId: account.id,
          name: account.name,
          settings: this.settingsForAccount(settings, account.id),
          regions: regionsOf(state.accountStates?.[account.id] || {}),
        };
      },
    );
  }

  /*
   * What changed in each account (CloudTrail, every Region it is read in)
   * since the last read, and - every 15 minutes - AWS Health's events about
   * it. A look back for an investigation reads only the accounts and
   * Regions it names, from its own start, and moves no cursor.
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
    const isOrganization: boolean = this.isOrganization(settings);
    let refusedTrail: boolean = false;
    const healthDue: boolean =
      !isLookBack &&
      isOlderThan(state.healthReadAt, HEALTH_INTERVAL_MS, now) &&
      !(
        state.healthPausedUntil &&
        Date.parse(state.healthPausedUntil) > now.getTime()
      );
    let healthRefused: boolean = false;

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
              region: this.getStsRegion(settings),
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
          continue;
        }

        throw error;
      }

      const regions: Array<string> =
        only?.regions && only.regions.length > 0
          ? Array.from(new Set([...only.regions, "us-east-1"]))
          : account.regions;

      const outcomes: Array<
        Settled<{ changes: Array<CloudChange>; complete: boolean }>
      > = await mapWithConcurrency(
        regions,
        CHANGE_REGION_CONCURRENCY,
        async (
          region: string,
        ): Promise<{ changes: Array<CloudChange>; complete: boolean }> => {
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
          });
        },
      );

      for (let index: number = 0; index < outcomes.length; index++) {
        const outcome: Settled<{
          changes: Array<CloudChange>;
          complete: boolean;
        }> = outcomes[index]!;
        const region: string = regions[index]!;

        if (outcome.ok) {
          result.changes.push(
            ...keepNewChanges({
              state,
              place: getChangePlace(accountId, region),
              changes: outcome.value.changes,
              now,
              complete: outcome.value.complete,
              isLookBack,
            }),
          );
          result.complete = result.complete && outcome.value.complete;
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
           * us-east-1 is open to every account: a credential refused there
           * is refused. Anywhere else it is a Region the account has not
           * opted in to, which has nothing to read.
           */
          if (region === "us-east-1" && !isOrganization) {
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

      if (healthDue && !healthRefused && !options.budget.isSpent()) {
        try {
          const health: Array<CloudChange> | null = await readAwsHealthEvents({
            credentials,
            accountId,
            start: new Date(
              Math.max(
                Date.parse(state.healthReadAt || "") || 0,
                now.getTime() - DAY_MS,
              ),
            ),
            options,
            budget: options.budget,
          });

          if (health === null) {
            healthRefused = true;
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
          }
        } catch (error) {
          if (
            error instanceof LlmProviderError &&
            error.kind === CloudConnectionFailureKind.Authentication &&
            !isOrganization
          ) {
            throw error;
          }

          // Health is a bonus: a refusal or a failure is not the read's.
          if (!(error instanceof CloudReadBudgetSpent)) {
            healthRefused =
              error instanceof LlmProviderError &&
              error.kind === CloudConnectionFailureKind.Permission;
          }
        }
      }
    }

    if (healthDue) {
      state.healthReadAt = now.toISOString();

      if (healthRefused) {
        state.healthPausedUntil = new Date(
          now.getTime() + HEALTH_PAUSE_MS,
        ).toISOString();
      }
    }

    if (refusedTrail) {
      result.warnings.push(
        "The role may not read CloudTrail (cloudtrail:LookupEvents). Run the setup command again to allow it.",
      );
    }

    return result;
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
      completelyListed:
        outcome.completelyListedTypes.length > 0
          ? [{ accountId, resourceTypes: outcome.completelyListedTypes }]
          : [],
      warnings: outcome.warnings,
      complete: outcome.complete && !options.budget.isSpent(),
    };
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
