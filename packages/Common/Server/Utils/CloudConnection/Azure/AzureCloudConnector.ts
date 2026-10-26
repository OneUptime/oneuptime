import { CloudProvider } from "../../../../Types/Cloud/CloudPlatform";
import {
  AZURE_MAX_METRICS_PER_RESOURCE,
  AzureTypeKeyMetrics,
  getAzureKeyMetrics,
  getAzureStoredMetricName,
} from "../../../../Types/Cloud/CloudKeyMetrics";
import { CloudMonitoredResource } from "../../../../Types/Cloud/CloudMonitoredResource";
import {
  AZURE_RESOURCE_TYPES,
  CloudResourceTypeDescriptor,
  getCloudResourceTypeDescriptor,
} from "../../../../Types/Cloud/CloudResourceCatalog";
import {
  AZURE_SECRET_EXPIRES_AT_KEY,
  splitCloudConnectionList,
} from "../../../../Types/CloudConnection/CloudConnectionCatalog";
import {
  CloudConnectionFailureKind,
  CloudConnectionTestResult,
  countCloudConnectionValues,
} from "../../../../Types/CloudConnection/CloudConnectionTest";
import BadDataException from "../../../../Types/Exception/BadDataException";
import { JSONObject, JSONValue } from "../../../../Types/JSON";
import EntraTokenClient, {
  MicrosoftCloud,
} from "../../LlmObservability/Connectors/Microsoft/EntraTokenClient";
import LlmProviderError from "../../LlmObservability/LlmProviderError";
import { Settled, mapWithConcurrency } from "../CloudConcurrency";
import {
  CloudMetricGroup,
  OtlpAttribute,
  buildMetricsPayloads,
  connectionResourceAttributes,
  countPayloadPoints,
  resolveCloudResourceOf,
  stringAttribute,
} from "../CloudMetricPayload";
import {
  AZURE_METRIC_DELAY_MS,
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
  CloudInventoryItem,
  CloudInventoryOptions,
  CloudInventoryResult,
  CloudKnownResource,
  CloudReadBudget,
  CloudReadBudgetSpent,
  CloudReadOptions,
  CloudReadResult,
  getCloudSecretValues,
  readCloudSetting,
} from "../CloudConnectorTypes";
import AzureArm, {
  AzureMetricDefinition,
  AzureMetricSeries,
  AzureResource,
  AzureSubscription,
} from "./AzureArm";
import {
  buildAzureInventoryItem,
  buildAzureInventoryQuery,
} from "./AzureInventory";
import { readAzureActivityEvent } from "./AzureChanges";
import {
  getChangePlace,
  getChangeWindowStart,
  keepNewChanges,
} from "../CloudChangeWindow";

/*
 * MICROSOFT AZURE: every subscription an app registration may read, from
 * Azure Resource Manager and Azure Monitor.
 *
 *   1. Every hour, lists each subscription's resources (Resource Manager,
 *      a page of a thousand a call) and keeps the types OneUptime knows
 *      (CloudResourceCatalog) - virtual machines, App Service, SQL, storage,
 *      Key Vault, Service Bus and the rest, not network interfaces or
 *      alert rules. A subscription listed to its last page is complete: a
 *      resource it no longer lists is gone, and is archived.
 *   2. Every read, reads the key metrics (CloudKeyMetrics) of each
 *      resource that has them since the last read: one Azure Monitor call
 *      per resource, each metric with the aggregation its definition calls
 *      primary, at the finest grain it offers from a minute up. A metric
 *      the resource does not publish is left out, from its type's metric
 *      definitions (read once a day).
 *   3. Builds the export the azure_monitor receiver sends: the subscription
 *      on the resource, each resource's id, name, type, group and location
 *      on its datapoints, metrics named azure_<metric>_<aggregation>.
 */

const PROVIDER_TITLE: string = "Azure";
const HOUR_MS: number = 60 * 60 * 1000;
const DAY_MS: number = 24 * HOUR_MS;
const CONCURRENCY: number = 8;
// Subscriptions read at most, and resources whose metrics a read reads.
export const AZURE_MAX_SUBSCRIPTIONS: number = 50;
export const AZURE_MAX_RESOURCES_WITH_METRICS: number = 2000;
// A test lists the first page of at most this many subscriptions.
const TEST_MAX_SUBSCRIPTIONS: number = 3;
const MAX_SUBSCRIPTION_IDS: number = 100;

// Azure Monitor's time grains, as seconds.
const GRAIN_SECONDS: Record<string, number> = {
  PT1M: 60,
  PT5M: 300,
  PT15M: 900,
  PT30M: 1800,
  PT1H: 3600,
  PT6H: 21600,
  PT12H: 43200,
  P1D: 86400,
};

interface AzureResourceToRead {
  resource: CloudMonitoredResource;
  armId: string;
  name: string;
  type: string;
  resourceGroup: string;
  location: string;
  subscriptionId: string;
}

interface SelectedMetric {
  name: string;
  aggregation: string;
  grain: string;
  unit: string;
}

// The finest grain from a minute up, of those a definition lists.
export function pickAzureGrain(grains: Array<string>): string | undefined {
  let best: string | undefined = undefined;

  for (const grain of grains) {
    const seconds: number | undefined = GRAIN_SECONDS[grain.toUpperCase()];

    if (
      seconds !== undefined &&
      (best === undefined || seconds < GRAIN_SECONDS[best]!)
    ) {
      best = grain.toUpperCase();
    }
  }

  return best;
}

/*
 * The key metrics a resource type is read with, as its definitions allow:
 * in the catalog's order, at most AZURE_MAX_METRICS_PER_RESOURCE.
 */
export function selectAzureMetrics(
  keyMetrics: AzureTypeKeyMetrics,
  definitions: Array<AzureMetricDefinition>,
): Array<SelectedMetric> {
  const byName: Map<string, AzureMetricDefinition> = new Map();

  for (const definition of definitions) {
    byName.set(definition.name.toLowerCase(), definition);
  }

  const selected: Array<SelectedMetric> = [];

  for (const name of keyMetrics.metrics) {
    const definition: AzureMetricDefinition | undefined = byName.get(
      name.toLowerCase(),
    );
    const grain: string | undefined = definition
      ? pickAzureGrain(definition.timeGrains)
      : undefined;

    if (!definition || !grain || !definition.primaryAggregationType) {
      continue;
    }

    selected.push({
      name: definition.name,
      aggregation: definition.primaryAggregationType,
      grain,
      unit: definition.unit,
    });

    if (selected.length >= AZURE_MAX_METRICS_PER_RESOURCE) {
      break;
    }
  }

  return selected;
}

function isOlderThan(
  iso: string | undefined,
  ageMs: number,
  now: Date,
): boolean {
  const time: number = iso ? Date.parse(iso) : NaN;
  return !Number.isFinite(time) || now.getTime() - time >= ageMs;
}

// How long before a client secret expires a read starts saying so.
export const AZURE_SECRET_EXPIRY_WARNING_DAYS: number = 30;

/*
 * A read's warning that the app's client secret expires soon, from the
 * expiry its setup command printed (AZURE_SECRET_EXPIRES_AT_KEY) - or null
 * when it does not expire within AZURE_SECRET_EXPIRY_WARNING_DAYS, or the
 * connection was made before the command printed it.
 */
export function getAzureSecretExpiryWarning(data: {
  settings: CloudConnectionSettings;
  now: Date;
}): string | null {
  const expiresAt: number = Date.parse(
    readCloudSetting(data.settings.config, AZURE_SECRET_EXPIRES_AT_KEY),
  );

  if (!Number.isFinite(expiresAt)) {
    return null;
  }

  const daysLeft: number = Math.floor(
    (expiresAt - data.now.getTime()) / (24 * 60 * 60 * 1000),
  );

  if (daysLeft > AZURE_SECRET_EXPIRY_WARNING_DAYS || daysLeft < 0) {
    return null;
  }

  return `The app's client secret expires on ${new Date(expiresAt)
    .toISOString()
    .slice(
      0,
      10,
    )}. Run the setup command again and paste what it prints before then, or reading stops.`;
}

/*
 * Microsoft Entra refuses an expired client secret with AADSTS7000222: said
 * as what it is and what to do, rather than as a refused credential.
 */
export function explainExpiredAzureSecret(error: unknown): unknown {
  if (
    error instanceof LlmProviderError &&
    `${error.responseBody || ""} ${error.message}`.includes("AADSTS7000222")
  ) {
    return new LlmProviderError({
      message:
        "The app's client secret has expired. Run the setup command again and paste what it prints.",
      kind: CloudConnectionFailureKind.Authentication,
      statusCode: error.statusCode,
      responseBody: error.responseBody,
    });
  }

  return error;
}

export default class AzureCloudConnector implements CloudConnector {
  public provider: CloudProvider = CloudProvider.Azure;

  public getSubscriptionIds(settings: CloudConnectionSettings): Array<string> {
    return splitCloudConnectionList(
      readCloudSetting(settings.config, "subscriptionIds"),
    );
  }

  public validateSettings(settings: CloudConnectionSettings): void {
    EntraTokenClient.validateTenantId(
      readCloudSetting(settings.config, "tenantId"),
    );
    EntraTokenClient.validateGuid(
      readCloudSetting(settings.config, "clientId"),
      "Application (client) ID",
    );
    EntraTokenClient.resolveCloud(
      readCloudSetting(settings.config, "cloud") || "public",
    );

    if (!readCloudSetting(settings.secrets, "clientSecret")) {
      throw new BadDataException("Client secret is required.");
    }

    const subscriptionIds: Array<string> = this.getSubscriptionIds(settings);

    if (subscriptionIds.length > MAX_SUBSCRIPTION_IDS) {
      throw new BadDataException(
        `Subscriptions can list at most ${MAX_SUBSCRIPTION_IDS} subscriptions.`,
      );
    }

    for (const subscriptionId of subscriptionIds) {
      EntraTokenClient.validateGuid(subscriptionId, "Each subscription");
    }
  }

  private arm(
    settings: CloudConnectionSettings,
    options: CloudConnectorCallOptions,
    budget?: CloudReadBudget | undefined,
  ): AzureArm {
    return new AzureArm({
      tenantId: readCloudSetting(settings.config, "tenantId"),
      clientId: readCloudSetting(settings.config, "clientId"),
      clientSecret: readCloudSetting(settings.secrets, "clientSecret"),
      cloud: EntraTokenClient.resolveCloud(
        readCloudSetting(settings.config, "cloud") || "public",
      ) as MicrosoftCloud,
      transport: options.transport,
      requestTimeoutInMs: options.requestTimeoutInMs,
      budget,
    });
  }

  /*
   * The subscriptions to read: the ones the connection names, or every
   * enabled one the app may read.
   */
  private async getSubscriptions(
    arm: AzureArm,
    settings: CloudConnectionSettings,
  ): Promise<Array<AzureSubscription>> {
    const named: Array<string> = this.getSubscriptionIds(settings);

    if (named.length > 0) {
      return named.map((subscriptionId: string): AzureSubscription => {
        return { subscriptionId, displayName: subscriptionId, state: "" };
      });
    }

    return (await arm.listSubscriptions()).filter(
      (subscription: AzureSubscription): boolean => {
        const state: string = subscription.state.toLowerCase();
        return state !== "disabled" && state !== "deleted";
      },
    );
  }

  // The resource as the ingest will file its metrics.
  private toMonitored(data: {
    armId: string;
    name: string;
    type: string;
    resourceGroup: string;
    location: string;
    subscriptionId: string;
  }): CloudMonitoredResource | null {
    return resolveCloudResourceOf({
      metricName: "azure_inventory",
      resourceAttributes: this.resourceAttributes({
        serviceName: "",
        connectionId: "",
        subscriptionId: data.subscriptionId,
        tenantId: "",
      }),
      datapointAttributes: this.datapointAttributes({ ...data, grain: "" }),
    });
  }

  private resourceAttributes(data: {
    serviceName: string;
    connectionId: string;
    subscriptionId: string;
    tenantId: string;
  }): Array<OtlpAttribute> {
    const attributes: Array<OtlpAttribute> = [
      ...connectionResourceAttributes({
        serviceName: data.serviceName,
        connectionId: data.connectionId,
        cloudProvider: CloudProvider.Azure,
      }),
      stringAttribute("azuremonitor.subscription_id", data.subscriptionId),
    ];

    if (data.tenantId) {
      attributes.push(stringAttribute("azuremonitor.tenant_id", data.tenantId));
    }

    return attributes;
  }

  // The azure_monitor receiver's datapoint attributes.
  private datapointAttributes(data: {
    armId: string;
    name: string;
    type: string;
    resourceGroup: string;
    location: string;
    grain: string;
  }): Array<OtlpAttribute> {
    const attributes: Array<OtlpAttribute> = [
      stringAttribute("azuremonitor.resource_id", data.armId),
      stringAttribute("name", data.name),
      stringAttribute("type", data.type),
      stringAttribute("resource_group", data.resourceGroup),
    ];

    if (data.location) {
      attributes.push(stringAttribute("location", data.location));
    }

    if (data.grain) {
      attributes.push(stringAttribute("timegrain", data.grain));
    }

    return attributes;
  }

  private fromArm(
    resource: AzureResource,
    subscriptionId: string,
  ): AzureResourceToRead | null {
    // Only the types OneUptime knows: not every NIC, alert rule and extension.
    if (!getCloudResourceTypeDescriptor(CloudProvider.Azure, resource.type)) {
      return null;
    }

    const resourceGroup: string = this.resourceGroupOf(resource.id);
    const monitored: CloudMonitoredResource | null = this.toMonitored({
      armId: resource.id,
      name: resource.name,
      type: resource.type,
      resourceGroup,
      location: resource.location,
      subscriptionId,
    });

    if (!monitored) {
      return null;
    }

    return {
      resource: monitored,
      armId: resource.id,
      name: resource.name,
      type: monitored.resourceType,
      resourceGroup,
      location: resource.location,
      subscriptionId,
    };
  }

  private fromKnown(known: CloudKnownResource): AzureResourceToRead | null {
    const monitored: CloudMonitoredResource | null = this.toMonitored({
      armId: known.providerResourceId,
      name: known.name,
      type: known.resourceType,
      resourceGroup: known.resourceGroup,
      location: known.region,
      subscriptionId: known.accountId,
    });

    if (!monitored) {
      return null;
    }

    return {
      resource: monitored,
      armId: known.providerResourceId,
      name: monitored.name,
      type: monitored.resourceType,
      resourceGroup: monitored.resourceGroup,
      location: monitored.region,
      subscriptionId: monitored.accountId,
    };
  }

  // The resource group segment of an ARM id ("" when it has none).
  private resourceGroupOf(id: string): string {
    const segments: Array<string> = id.split("/");

    for (let index: number = 0; index < segments.length - 1; index++) {
      if (segments[index]!.toLowerCase() === "resourcegroups") {
        return segments[index + 1] || "";
      }
    }

    return "";
  }

  public async testConnection(
    settings: CloudConnectionSettings,
    options: CloudConnectorCallOptions,
  ): Promise<CloudConnectionTestResult> {
    const startedAt: number = Date.now();

    try {
      this.validateSettings(settings);

      const arm: AzureArm = this.arm(settings, options);
      const subscriptions: Array<AzureSubscription> =
        await this.getSubscriptions(arm, settings);

      if (subscriptions.length === 0) {
        return {
          provider: CloudProvider.Azure,
          status: "warn",
          message:
            "Signed in, but the app may read no subscription. Give it the Monitoring Reader role on a subscription.",
          failureKind: CloudConnectionFailureKind.Permission,
          accounts: [],
          resourceCount: 0,
          durationMs: Date.now() - startedAt,
        };
      }

      const listed: Array<Settled<Array<AzureResource>>> =
        await mapWithConcurrency(
          subscriptions.slice(0, TEST_MAX_SUBSCRIPTIONS),
          TEST_MAX_SUBSCRIPTIONS,
          async (
            subscription: AzureSubscription,
          ): Promise<Array<AzureResource>> => {
            return await arm.listResources(subscription.subscriptionId, {
              firstPageOnly: true,
            });
          },
        );

      const found: Array<AzureResourceToRead> = [];
      let firstError: unknown = undefined;

      listed.forEach(
        (outcome: Settled<Array<AzureResource>>, index: number) => {
          if (!outcome.ok) {
            firstError = firstError || outcome.error;
            return;
          }

          for (const resource of outcome.value) {
            const toRead: AzureResourceToRead | null = this.fromArm(
              resource,
              subscriptions[index]!.subscriptionId,
            );

            if (toRead) {
              found.push(toRead);
            }
          }
        },
      );

      if (firstError && found.length === 0) {
        throw firstError;
      }

      const names: Array<string> = subscriptions.map(
        (subscription: AzureSubscription): string => {
          return subscription.displayName || subscription.subscriptionId;
        },
      );

      return {
        provider: CloudProvider.Azure,
        status: found.length > 0 ? "pass" : "warn",
        message:
          found.length > 0
            ? `Signed in and found ${found.length} resources in ${subscriptions.length} subscriptions.`
            : `Signed in to ${subscriptions.length} subscriptions, but found no resources OneUptime reads in them.`,
        accounts: names,
        resourceCount: found.length,
        resourceTypes: countCloudConnectionValues(
          found.map((entry: AzureResourceToRead): string => {
            return entry.type;
          }),
        ).map((entry: { value: string; count: number }) => {
          return { type: entry.value, count: entry.count };
        }),
        regions: countCloudConnectionValues(
          found.map((entry: AzureResourceToRead): string => {
            return entry.location;
          }),
        ).map((entry: { value: string; count: number }) => {
          return { region: entry.value, count: entry.count };
        }),
        isSample:
          subscriptions.length > TEST_MAX_SUBSCRIPTIONS ||
          listed.some((outcome: Settled<Array<AzureResource>>): boolean => {
            return outcome.ok && outcome.value.length >= 1000;
          }),
        durationMs: Date.now() - startedAt,
      };
    } catch (error) {
      return AzureCloudConnector.failedTest({ error, settings, startedAt });
    }
  }

  public static failedTest(data: {
    error: unknown;
    settings: CloudConnectionSettings;
    startedAt: number;
  }): CloudConnectionTestResult {
    if (data.error instanceof BadDataException) {
      return {
        provider: CloudProvider.Azure,
        status: "fail",
        message: data.error.message,
        failureKind: CloudConnectionFailureKind.Settings,
        durationMs: Date.now() - data.startedAt,
      };
    }

    const failure: LlmProviderError = LlmProviderError.from({
      error: explainExpiredAzureSecret(data.error),
      step: "test",
      providerTitle: PROVIDER_TITLE,
      secretValues: getCloudSecretValues(data.settings),
    });

    return {
      provider: CloudProvider.Azure,
      status: "fail",
      message: failure.message,
      failureKind: failure.kind,
      durationMs: Date.now() - data.startedAt,
    };
  }

  /*
   * A resource type's metric definitions: the cached ones while they are a
   * day old at most, else the first resource's, read now.
   */
  private async getDefinitions(data: {
    arm: AzureArm;
    type: string;
    sampleResourceId: string;
    cache: JSONObject;
    now: Date;
  }): Promise<Array<AzureMetricDefinition>> {
    const key: string = data.type.toLowerCase();
    const cached: JSONValue | undefined = data.cache[key];

    if (cached && typeof cached === "object" && !Array.isArray(cached)) {
      const entry: JSONObject = cached as JSONObject;

      if (!isOlderThan(entry["at"] as string | undefined, DAY_MS, data.now)) {
        return ((entry["metrics"] as Array<JSONObject> | undefined) || []).map(
          (metric: JSONObject): AzureMetricDefinition => {
            return {
              name: String(metric["name"] || ""),
              unit: String(metric["unit"] || ""),
              primaryAggregationType: String(metric["aggregation"] || ""),
              timeGrains: [String(metric["grain"] || "")],
            };
          },
        );
      }
    }

    const definitions: Array<AzureMetricDefinition> =
      await data.arm.getMetricDefinitions(data.sampleResourceId);

    const keyMetrics: AzureTypeKeyMetrics | undefined = getAzureKeyMetrics(
      data.type,
    );
    const selected: Array<SelectedMetric> = keyMetrics
      ? selectAzureMetrics(keyMetrics, definitions)
      : [];

    // Only what is read is kept: the selected metrics, each with its grain.
    data.cache[key] = {
      at: data.now.toISOString(),
      metrics: selected.map((metric: SelectedMetric): JSONObject => {
        return {
          name: metric.name,
          unit: metric.unit,
          aggregation: metric.aggregation,
          grain: metric.grain,
        };
      }),
    };

    return definitions;
  }

  /*
   * What changed in each subscription since the last read, and Azure's
   * Service Health and Resource Health events about it: one Activity Log
   * read per subscription (AzureChanges). A look back for an investigation
   * reads only the subscriptions it names and moves no cursor.
   */
  public async readChanges(
    settings: CloudConnectionSettings,
    options: CloudChangesOptions,
  ): Promise<CloudChangesResult> {
    try {
      return await this.readActivity(settings, options);
    } catch (error) {
      throw explainExpiredAzureSecret(error);
    }
  }

  private async readActivity(
    settings: CloudConnectionSettings,
    options: CloudChangesOptions,
  ): Promise<CloudChangesResult> {
    const now: Date = options.now ? options.now() : new Date();
    const arm: AzureArm = this.arm(settings, options, options.budget);
    const result: CloudChangesResult = {
      changes: [],
      warnings: [],
      complete: true,
    };
    const isLookBack: boolean = Boolean(options.since);
    let subscriptionIds: Array<string> =
      options.state.accounts && options.state.accounts.length > 0
        ? options.state.accounts
        : (await this.getSubscriptions(arm, settings)).map(
            (subscription: AzureSubscription): string => {
              return subscription.subscriptionId;
            },
          );

    if (options.only) {
      const wanted: Set<string> = new Set(
        options.only.map((entry: { accountId: string }): string => {
          return entry.accountId.toLowerCase();
        }),
      );
      subscriptionIds = subscriptionIds.filter((id: string): boolean => {
        return wanted.has(id.toLowerCase());
      });
    }

    let refused: boolean = false;

    const outcomes: Array<Settled<Array<CloudChange>>> =
      await mapWithConcurrency(
        subscriptionIds.slice(0, AZURE_MAX_SUBSCRIPTIONS),
        CONCURRENCY,
        async (subscriptionId: string): Promise<Array<CloudChange>> => {
          const events: Array<JSONObject> = await arm.listActivityLog({
            subscriptionId,
            start: getChangeWindowStart({
              state: options.state,
              place: getChangePlace(subscriptionId, ""),
              now,
              since: options.since,
            }),
            end: now,
          });

          return events
            .map((event: JSONObject): CloudChange | null => {
              return readAzureActivityEvent({ event, subscriptionId });
            })
            .filter((change: CloudChange | null): boolean => {
              return change !== null;
            }) as Array<CloudChange>;
        },
      );

    outcomes.forEach((outcome: Settled<Array<CloudChange>>, index: number) => {
      const subscriptionId: string = subscriptionIds[index]!;

      if (outcome.ok) {
        result.changes.push(
          ...keepNewChanges({
            state: options.state,
            place: getChangePlace(subscriptionId, ""),
            changes: outcome.value,
            now,
            complete: true,
            isLookBack,
          }),
        );
        return;
      }

      result.complete = false;

      if (outcome.error instanceof CloudReadBudgetSpent) {
        return;
      }

      if (
        outcome.error instanceof LlmProviderError &&
        outcome.error.kind === CloudConnectionFailureKind.Authentication
      ) {
        throw outcome.error;
      }

      if (
        outcome.error instanceof LlmProviderError &&
        outcome.error.kind === CloudConnectionFailureKind.Permission
      ) {
        refused = true;
        return;
      }

      result.warnings.push(
        `Could not read what changed in subscription ${subscriptionId}: ${
          outcome.error instanceof Error
            ? outcome.error.message
            : String(outcome.error)
        }`,
      );
    });

    if (refused) {
      result.warnings.push(
        "The app may not read a subscription's Activity Log. Give it the Monitoring Reader role on it.",
      );
    }

    return result;
  }

  /*
   * The subscriptions' inventory (AzureInventory): one Resource Graph query
   * over the subscriptions read, with each subscription named as Azure
   * names it.
   */
  public async readInventory(
    settings: CloudConnectionSettings,
    options: CloudInventoryOptions,
  ): Promise<CloudInventoryResult> {
    try {
      return await this.listInventory(settings, options);
    } catch (error) {
      throw explainExpiredAzureSecret(error);
    }
  }

  private async listInventory(
    settings: CloudConnectionSettings,
    options: CloudInventoryOptions,
  ): Promise<CloudInventoryResult> {
    const arm: AzureArm = this.arm(settings, options, options.budget);
    const subscriptions: Array<AzureSubscription> = (
      await this.getSubscriptions(arm, settings)
    ).slice(0, AZURE_MAX_SUBSCRIPTIONS);
    const subscriptionIds: Array<string> = subscriptions.map(
      (subscription: AzureSubscription): string => {
        return subscription.subscriptionId;
      },
    );
    const names: Map<string, string> = new Map();

    for (const subscription of subscriptions) {
      if (
        subscription.displayName &&
        subscription.displayName !== subscription.subscriptionId
      ) {
        names.set(
          subscription.subscriptionId.toLowerCase(),
          subscription.displayName,
        );
      }
    }

    // Subscriptions the connection names are named by listing them once.
    if (names.size === 0 && subscriptionIds.length > 0) {
      try {
        for (const subscription of await arm.listSubscriptions()) {
          if (subscription.displayName) {
            names.set(
              subscription.subscriptionId.toLowerCase(),
              subscription.displayName,
            );
          }
        }
      } catch (error) {
        if (error instanceof CloudReadBudgetSpent) {
          throw error;
        }
      }
    }

    const listing: { rows: Array<JSONObject>; complete: boolean } =
      subscriptionIds.length > 0
        ? await arm.queryResourceGraph({
            subscriptionIds,
            query: buildAzureInventoryQuery(),
          })
        : { rows: [], complete: true };

    const items: Array<CloudInventoryItem> = [];

    for (const row of listing.rows) {
      const item: CloudInventoryItem | null = buildAzureInventoryItem(row);

      if (item) {
        items.push(item);
      }
    }

    const knownTypes: Array<string> = AZURE_RESOURCE_TYPES.map(
      (descriptor: CloudResourceTypeDescriptor): string => {
        return descriptor.type;
      },
    );

    return {
      accounts: subscriptionIds.map((subscriptionId: string) => {
        return {
          accountId: subscriptionId,
          name: names.get(subscriptionId.toLowerCase()),
        };
      }),
      items,
      completelyListed: listing.complete
        ? subscriptionIds.map((subscriptionId: string) => {
            return { accountId: subscriptionId, resourceTypes: knownTypes };
          })
        : [],
      warnings: listing.complete
        ? []
        : [
            "The subscriptions have more resources than one inventory lists: the rest are listed next time.",
          ],
      complete: listing.complete,
    };
  }

  public async read(
    settings: CloudConnectionSettings,
    options: CloudReadOptions,
  ): Promise<CloudReadResult> {
    try {
      const result: CloudReadResult = await this.readSubscriptions(
        settings,
        options,
      );
      const expiry: string | null = getAzureSecretExpiryWarning({
        settings,
        now: options.now ? options.now() : new Date(),
      });

      if (expiry) {
        result.warnings.unshift(expiry);
      }

      return result;
    } catch (error) {
      throw explainExpiredAzureSecret(error);
    }
  }

  private async readSubscriptions(
    settings: CloudConnectionSettings,
    options: CloudReadOptions,
  ): Promise<CloudReadResult> {
    const now: Date = options.now ? options.now() : new Date();
    const budget: CloudReadBudget = new CloudReadBudget({
      maxRequests: options.maxRequests,
      maxDurationMs: options.maxDurationMs,
    });
    const state: CloudConnectionPullState = { ...options.state };
    const warnings: Array<string> = [];
    const arm: AzureArm = this.arm(settings, options, budget);
    const tenantId: string = readCloudSetting(settings.config, "tenantId");
    const toRead: Map<string, AzureResourceToRead> = new Map();
    const completelyListedAccounts: Array<string> = [];
    let accounts: Array<string> = state.accounts || [];

    // 1. The resources: listed every hour, else the ones the connection holds.
    if (isOlderThan(state.inventoryAt, HOUR_MS, now)) {
      let subscriptions: Array<AzureSubscription> = await this.getSubscriptions(
        arm,
        settings,
      );

      if (subscriptions.length > AZURE_MAX_SUBSCRIPTIONS) {
        warnings.push(
          `The app may read ${subscriptions.length} subscriptions; the first ${AZURE_MAX_SUBSCRIPTIONS} are read. Name the ones to read under Subscriptions.`,
        );
        subscriptions = subscriptions.slice(0, AZURE_MAX_SUBSCRIPTIONS);
      }

      if (subscriptions.length === 0) {
        throw new LlmProviderError({
          message:
            "The app may read no subscription. Give it the Monitoring Reader role on a subscription.",
          kind: CloudConnectionFailureKind.Permission,
        });
      }

      const listed: Array<Settled<Array<AzureResource>>> =
        await mapWithConcurrency(
          subscriptions,
          4,
          async (
            subscription: AzureSubscription,
          ): Promise<Array<AzureResource>> => {
            return await arm.listResources(subscription.subscriptionId);
          },
        );

      let listedAny: boolean = false;
      let firstError: unknown = undefined;

      listed.forEach(
        (outcome: Settled<Array<AzureResource>>, index: number) => {
          const subscriptionId: string = subscriptions[index]!.subscriptionId;

          if (!outcome.ok) {
            if (outcome.error instanceof CloudReadBudgetSpent) {
              return;
            }

            firstError = firstError || outcome.error;
            warnings.push(
              `Could not list the resources of subscription ${subscriptionId}: ${
                outcome.error instanceof Error
                  ? outcome.error.message
                  : String(outcome.error)
              }`,
            );
            return;
          }

          listedAny = true;
          completelyListedAccounts.push(subscriptionId);

          for (const resource of outcome.value) {
            const entry: AzureResourceToRead | null = this.fromArm(
              resource,
              subscriptionId,
            );

            if (entry) {
              toRead.set(entry.resource.identityKey, entry);
            }
          }
        },
      );

      if (!listedAny && firstError) {
        throw firstError;
      }

      accounts = subscriptions.map(
        (subscription: AzureSubscription): string => {
          return subscription.subscriptionId;
        },
      );
      state.inventoryAt = now.toISOString();
    } else {
      for (const known of options.knownResources || []) {
        const entry: AzureResourceToRead | null = this.fromKnown(known);

        if (entry) {
          toRead.set(entry.resource.identityKey, entry);
        }
      }
    }

    state.accounts = accounts;

    // 2. Their key metrics since the last read.
    const withMetrics: Array<AzureResourceToRead> = Array.from(
      toRead.values(),
    ).filter((entry: AzureResourceToRead): boolean => {
      return Boolean(getAzureKeyMetrics(entry.type));
    });

    if (withMetrics.length > AZURE_MAX_RESOURCES_WITH_METRICS) {
      warnings.push(
        `${withMetrics.length} resources have metrics; the metrics of the first ${AZURE_MAX_RESOURCES_WITH_METRICS} are read. Name fewer subscriptions to read the rest.`,
      );
    }

    const reading: Array<AzureResourceToRead> = withMetrics.slice(
      0,
      AZURE_MAX_RESOURCES_WITH_METRICS,
    );
    const definitionsCache: JSONObject = {
      ...((state.azureMetricDefinitions as JSONObject | undefined) || {}),
    };
    const selectedByType: Map<string, Array<SelectedMetric>> = new Map();

    for (const entry of reading) {
      const key: string = entry.type.toLowerCase();

      if (selectedByType.has(key) || budget.isSpent()) {
        continue;
      }

      try {
        const definitions: Array<AzureMetricDefinition> =
          await this.getDefinitions({
            arm,
            type: entry.type,
            sampleResourceId: entry.armId,
            cache: definitionsCache,
            now,
          });

        selectedByType.set(
          key,
          selectAzureMetrics(getAzureKeyMetrics(entry.type)!, definitions),
        );
      } catch (error) {
        if (error instanceof CloudReadBudgetSpent) {
          break;
        }

        selectedByType.set(key, []);
        warnings.push(
          `Could not read which metrics ${entry.type} publishes: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    }

    state.azureMetricDefinitions = definitionsCache;

    const cursors: Record<string, string> = { ...(state.cursors || {}) };
    const windows: Map<string, MetricWindow | null> = new Map();

    for (const grain of Object.keys(GRAIN_SECONDS)) {
      windows.set(
        grain,
        getMetricWindow({
          policy: getMetricWindowPolicy({
            periodSeconds: GRAIN_SECONDS[grain]!,
            delayMs: AZURE_METRIC_DELAY_MS,
          }),
          cursor: cursors[String(GRAIN_SECONDS[grain])],
          now,
        }),
      );
    }

    const groups: Map<string, CloudMetricGroup> = new Map();
    const grainsRead: Set<string> = new Set<string>();
    let failedResources: number = 0;

    const outcomes: Array<
      Settled<Array<AzureMetricSeries & { grain: string }>>
    > = await mapWithConcurrency(
      reading,
      CONCURRENCY,
      async (
        entry: AzureResourceToRead,
      ): Promise<Array<AzureMetricSeries & { grain: string }>> => {
        const selected: Array<SelectedMetric> =
          selectedByType.get(entry.type.toLowerCase()) || [];
        const byGrain: Map<string, Array<SelectedMetric>> = new Map();

        for (const metric of selected) {
          const list: Array<SelectedMetric> = byGrain.get(metric.grain) || [];
          list.push(metric);
          byGrain.set(metric.grain, list);
        }

        const series: Array<AzureMetricSeries & { grain: string }> = [];

        for (const [grain, metrics] of byGrain) {
          const window: MetricWindow | null | undefined = windows.get(grain);

          if (!window) {
            continue;
          }

          const read: Array<AzureMetricSeries> = await arm.getMetrics({
            resourceId: entry.armId,
            metrics,
            interval: grain,
            start: window.start,
            end: window.end,
          });

          grainsRead.add(grain);

          for (const item of read) {
            const unit: string =
              metrics.find((metric: SelectedMetric): boolean => {
                return (
                  metric.name.toLowerCase() === item.metricName.toLowerCase()
                );
              })?.unit || item.unit;

            series.push({ ...item, unit, grain });
          }
        }

        return series;
      },
    );

    outcomes.forEach(
      (
        outcome: Settled<Array<AzureMetricSeries & { grain: string }>>,
        index: number,
      ) => {
        const entry: AzureResourceToRead = reading[index]!;

        if (!outcome.ok) {
          if (
            outcome.error instanceof LlmProviderError &&
            outcome.error.kind === CloudConnectionFailureKind.Authentication
          ) {
            throw outcome.error;
          }

          if (!(outcome.error instanceof CloudReadBudgetSpent)) {
            failedResources++;
          }

          return;
        }

        for (const series of outcome.value) {
          const selected: SelectedMetric | undefined = (
            selectedByType.get(entry.type.toLowerCase()) || []
          ).find((metric: SelectedMetric): boolean => {
            return (
              metric.name.toLowerCase() === series.metricName.toLowerCase()
            );
          });

          if (!selected) {
            continue;
          }

          const groupKey: string = entry.subscriptionId.toLowerCase();
          let group: CloudMetricGroup | undefined = groups.get(groupKey);

          if (!group) {
            group = {
              resourceAttributes: this.resourceAttributes({
                serviceName: options.serviceName,
                connectionId: options.connectionId,
                subscriptionId: entry.subscriptionId,
                tenantId,
              }),
              metrics: [],
            };
            groups.set(groupKey, group);
          }

          const name: string = getAzureStoredMetricName(
            selected.name,
            selected.aggregation,
          );
          let metric: CloudMetricGroup["metrics"][number] | undefined =
            group.metrics.find((candidate: { name: string }): boolean => {
              return candidate.name === name;
            });

          if (!metric) {
            metric = { name, unit: series.unit, datapointSets: [] };
            group.metrics.push(metric);
          }

          metric.datapointSets.push({
            attributes: this.datapointAttributes({
              armId: entry.armId,
              name: entry.name,
              type: entry.type,
              resourceGroup: entry.resourceGroup,
              location: entry.location,
              grain: series.grain,
            }),
            points: series.points,
          });
        }
      },
    );

    if (failedResources > 0) {
      warnings.push(
        `Could not read the metrics of ${failedResources} resources this time.`,
      );
    }

    /*
     * A grain's window moves on once it was read: a resource that failed
     * misses that stretch rather than every other one being written twice.
     */
    for (const grain of grainsRead) {
      const window: MetricWindow | null | undefined = windows.get(grain);

      if (window) {
        cursors[String(GRAIN_SECONDS[grain])] = window.end.toISOString();
      }
    }

    state.cursors = cursors;

    const metricGroups: Array<CloudMetricGroup> = Array.from(groups.values());

    if (budget.isSpent()) {
      warnings.push(
        "This read stopped at its limit and carries on within a minute.",
      );
    }

    return {
      accounts,
      resources: Array.from(toRead.values()).map(
        (entry: AzureResourceToRead): CloudDiscoveredResource => {
          return { resource: entry.resource };
        },
      ),
      completelyListedAccounts: budget.isSpent()
        ? []
        : completelyListedAccounts,
      payloads: buildMetricsPayloads(metricGroups),
      pointsWritten: countPayloadPoints(metricGroups),
      requestCount: budget.getUsed(),
      warnings,
      complete: !budget.isSpent(),
      nextState: state,
    };
  }
}
