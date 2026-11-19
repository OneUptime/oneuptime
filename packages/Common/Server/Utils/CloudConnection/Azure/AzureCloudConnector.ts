import { CloudProvider } from "../../../../Types/Cloud/CloudPlatform";
import {
  AZURE_DIMENSION_ATTRIBUTE_PREFIX,
  AZURE_FIVE_MINUTE_GRAIN,
  AZURE_FIVE_MINUTE_READ_MINUTES,
  AZURE_MAX_METRICS_PER_RESOURCE,
  AZURE_MAX_SPLIT_SERIES_PER_METRIC,
  AzureTypeKeyMetrics,
  getAzureKeyMetrics,
  getAzureReadMetricNames,
  getAzureStoredMetricName,
  isAzureFiveMinuteKeyMetric,
} from "../../../../Types/Cloud/CloudKeyMetrics";
import { CloudMonitoredResource } from "../../../../Types/Cloud/CloudMonitoredResource";
import {
  AZURE_RESOURCE_TYPES,
  CloudResourceTypeDescriptor,
  getCloudResourceTypeDescriptor,
  isInventoryOnlyCloudResourceType,
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
  CloudAuditRecord,
  CloudChange,
  CloudChangesOptions,
  CloudChangesResult,
  CloudCostAccountOutcome,
  CloudCostsOptions,
  CloudCostsResult,
  CloudDiscoveredResource,
  CloudInventoryItem,
  CloudInventoryOptions,
  CloudInventoryResult,
  CloudKnownResource,
  CloudReadBudget,
  CloudReadBudgetSpent,
  CloudReadOptions,
  CloudReadResult,
  CloudSavingsOptions,
  CloudSavingsResult,
  getCloudSecretValues,
  keepsAuditRecords,
  readCloudSetting,
} from "../CloudConnectorTypes";
import {
  describeAzureCostFailure,
  readAzureAdvisor,
  readAzureCosts,
} from "./AzureCosts";
import { readAzureCommitments } from "./AzureCommitments";
import {
  CloudCostState,
  getCloudCostResourceKey,
} from "../../../../Types/Cloud/CloudCost";
import { CloudCommitmentSummary } from "../../../../Types/Cloud/CloudCommitments";
import AzureArm, {
  AzureMetricDefinition,
  AzureMetricDimensionValue,
  AzureMetricFailure,
  AzureMetricSeries,
  AzureMetricsAnswer,
  AzureResource,
  AzureSubscription,
} from "./AzureArm";
import {
  AZURE_INVENTORY_ONLY_QUERY_TYPES,
  AZURE_SUBNET_TYPE,
  buildAzureInventoryItems,
  buildAzureInventoryQuery,
  buildAzureSubnetQuery,
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
 *      per resource, up to 20 metrics in it, each metric with the
 *      aggregation its definition calls primary, at the finest grain it
 *      offers from a minute up - and, for the few metrics kept at five
 *      minutes at their finest that are marked as earning it (an App
 *      Service app's health check), a five-minute call of its own every 15
 *      minutes (AzureReadGroup). A deprecated metric the type still reads
 *      for the monitors built on it rides in the same calls (retired). A
 *      metric the resource does not publish is
 *      left out, from its type's metric definitions - read once a day from
 *      up to three of its resources, of different kinds where the listing
 *      says, their key metrics together. Azure refuses a whole call that
 *      names a metric the resource does not publish, so a resource that
 *      publishes fewer than its type's (a vCore database, a Basic load
 *      balancer) is read again with its own definitions, kept a day. A
 *      Service Bus or Event Hubs
 *      namespace's metrics are split by EntityName in that same one call:
 *      a series per queue, topic and event hub (up to
 *      AZURE_MAX_SPLIT_SERIES_PER_METRIC of each metric), never a call per
 *      queue - 50 queues cost what one does.
 *   3. Builds the export the azure_monitor receiver sends: the subscription
 *      on the resource, each resource's id, name, type, group and location
 *      on its datapoints, a split series' dimension as metadata_<name>
 *      (metadata_entityname, which files it on its queue or topic when it
 *      is ingested), metrics named azure_<metric>_<aggregation>.
 */

// What a read of one resource's metrics brought back.
interface AzureResourceMetricsRead {
  series: Array<AzureMetricSeries & { grain: string }>;
  failures: Array<AzureMetricFailure>;
  capped: Array<string>;
  // What it was read with: its type's selection, or its own.
  selected: Array<SelectedMetric>;
}

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
  /*
   * Resource Manager's kind of the resource, when this read listed it: a
   * database's "v12.0,user,vcore", a site's "functionapp,linux", an AI
   * account's "OpenAI". Resources of one type and different kinds publish
   * different metrics, so a type's definitions are read from resources of
   * different kinds (getTypeSelection).
   */
  kind?: string | undefined;
}

export interface SelectedMetric {
  name: string;
  aggregation: string;
  grain: string;
  unit: string;
}

/*
 * How many resources of a type its metric definitions are read from, of
 * different kinds where the listing says: their key metrics together are
 * the type's selection.
 */
export const AZURE_DEFINITION_SAMPLES: number = 3;

/*
 * Resources at most whose own metric definitions a connection keeps (see
 * isAzureUnsupportedMetricsRefusal): the oldest give way.
 */
export const AZURE_MAX_RESOURCE_DEFINITIONS: number = 500;

/*
 * Azure Monitor refuses a whole metrics call that names a metric the
 * resource does not publish - 400, "Failed to find metric configuration
 * for provider: Microsoft.Sql, resource Type: servers/databases, metric:
 * dtu_consumption_percent, Valid metrics: ..." - rather than answering the
 * others. A type's selection is read from a few of its resources, and
 * another of the type can publish fewer: a vCore database has no DTUs, a
 * Basic load balancer no metrics at all, a Language account none of an
 * Azure OpenAI account's. Such a resource is read with its own definitions
 * instead (readSubscriptions).
 */
export function isAzureUnsupportedMetricsRefusal(error: unknown): boolean {
  if (!(error instanceof LlmProviderError) || error.statusCode !== 400) {
    return false;
  }

  const text: string =
    `${error.responseBody || ""} ${error.message}`.toLowerCase();

  return (
    text.includes("failed to find metric configuration") ||
    text.includes("valid metrics:")
  );
}

/*
 * A short fingerprint of a type's key metrics: a definitions cache made for
 * another list of them is read again, so a release that adds metrics reads
 * them from its first read, not a day later.
 */
export function getAzureKeyMetricsFingerprint(
  keyMetrics: AzureTypeKeyMetrics,
): string {
  let hash: number = 5381;
  const text: string = getAzureReadMetricNames(keyMetrics)
    .map((name: string): string => {
      return name.toLowerCase();
    })
    .join("|");

  for (let index: number = 0; index < text.length; index++) {
    hash = ((hash << 5) + hash + text.charCodeAt(index)) | 0;
  }

  return (hash >>> 0).toString(16);
}

/*
 * The selections of several resources of a type together, each metric
 * once (the first resource to publish it keeps its aggregation and grain),
 * in the catalog's order - its key metrics, then the deprecated ones it
 * still reads - at most AZURE_MAX_METRICS_PER_RESOURCE.
 */
export function mergeAzureSelections(
  keyMetrics: AzureTypeKeyMetrics,
  selections: Array<Array<SelectedMetric>>,
): Array<SelectedMetric> {
  const byName: Map<string, SelectedMetric> = new Map();

  for (const selection of selections) {
    for (const metric of selection) {
      const key: string = metric.name.toLowerCase();

      if (!byName.has(key)) {
        byName.set(key, metric);
      }
    }
  }

  const merged: Array<SelectedMetric> = [];

  for (const name of getAzureReadMetricNames(keyMetrics)) {
    const selected: SelectedMetric | undefined = byName.get(name.toLowerCase());

    if (selected) {
      merged.push(selected);
    }

    if (merged.length >= AZURE_MAX_METRICS_PER_RESOURCE) {
      break;
    }
  }

  return merged;
}

/*
 * The resources of a type whose definitions are read: one of each kind
 * the listing named first, then any others, AZURE_DEFINITION_SAMPLES at
 * most.
 */
export function pickAzureDefinitionSamples<
  T extends { kind?: string | undefined },
>(resources: Array<T>): Array<T> {
  const picked: Array<T> = [];
  const kinds: Set<string> = new Set<string>();

  for (const resource of resources) {
    const kind: string = (resource.kind || "").trim().toLowerCase();

    if (picked.length < AZURE_DEFINITION_SAMPLES && !kinds.has(kind)) {
      kinds.add(kind);
      picked.push(resource);
    }
  }

  for (const resource of resources) {
    if (picked.length >= AZURE_DEFINITION_SAMPLES) {
      break;
    }

    if (!picked.includes(resource)) {
      picked.push(resource);
    }
  }

  return picked;
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
 * HOW OFTEN EACH OF A RESOURCE'S METRICS IS READ.
 *
 * One Azure Monitor call asks for one grain, and each call is billed as a
 * read. A resource's metrics are read in a call per grain, each when its
 * grain's window has something new (CloudMetricWindows): its minute
 * metrics every read, an hourly one once an hour. A key metric marked as
 * kept at five minutes beside its type's minute metrics (AzureKeyMetric.
 * grain) is read in a five-minute call of its own every
 * AZURE_FIVE_MINUTE_READ_MINUTES, three points a call - a third of a call
 * a resource for each five minutes, where reading it with every read would
 * cost one. Its window has a cursor of its own, so a type whose only grain
 * is five minutes (a Static Web App) is still read every read.
 */
export interface AzureReadGroup {
  // The grain its calls ask for.
  grain: string;
  // Where its window is kept in the connection's state (cursors).
  cursorKey: string;
  // What it reads now: null when nothing new is there yet, or it is not due.
  window: MetricWindow | null;
}

// The five-minute call's cursor: five minutes, read every 15 ("300/900").
export const AZURE_FIVE_MINUTE_CURSOR: string = `${GRAIN_SECONDS[AZURE_FIVE_MINUTE_GRAIN]}/${AZURE_FIVE_MINUTE_READ_MINUTES * 60}`;

// Every grain's read group, and the five-minute one's, as of `now`.
export function getAzureReadGroups(data: {
  cursors: Record<string, string>;
  now: Date;
}): Map<string, AzureReadGroup> {
  const groups: Map<string, AzureReadGroup> = new Map();

  for (const grain of Object.keys(GRAIN_SECONDS)) {
    const cursorKey: string = String(GRAIN_SECONDS[grain]);

    groups.set(grain, {
      grain,
      cursorKey,
      window: getMetricWindow({
        policy: getMetricWindowPolicy({
          periodSeconds: GRAIN_SECONDS[grain]!,
          delayMs: AZURE_METRIC_DELAY_MS,
        }),
        cursor: data.cursors[cursorKey],
        now: data.now,
      }),
    });
  }

  groups.set(AZURE_FIVE_MINUTE_CURSOR, {
    grain: AZURE_FIVE_MINUTE_GRAIN,
    cursorKey: AZURE_FIVE_MINUTE_CURSOR,
    window: getMetricWindow({
      policy: getMetricWindowPolicy({
        periodSeconds: GRAIN_SECONDS[AZURE_FIVE_MINUTE_GRAIN]!,
        delayMs: AZURE_METRIC_DELAY_MS,
        readEveryMs: AZURE_FIVE_MINUTE_READ_MINUTES * 60 * 1000,
      }),
      cursor: data.cursors[AZURE_FIVE_MINUTE_CURSOR],
      now: data.now,
    }),
  });

  return groups;
}

/*
 * The read group a selected metric of the type is read in: the
 * five-minute call's for a metric marked as read at five minutes that its
 * definition offers at five minutes at its finest, else its grain's.
 */
export function getAzureReadGroupKey(
  type: string,
  metric: SelectedMetric,
): string {
  return metric.grain.toUpperCase() === AZURE_FIVE_MINUTE_GRAIN &&
    isAzureFiveMinuteKeyMetric(type, metric.name)
    ? AZURE_FIVE_MINUTE_CURSOR
    : metric.grain.toUpperCase();
}

/*
 * The key metrics a resource type is read with, as its definitions allow:
 * in the catalog's order, then the deprecated ones it still reads for the
 * monitors built on them (retired), at most AZURE_MAX_METRICS_PER_RESOURCE.
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

  for (const name of getAzureReadMetricNames(keyMetrics)) {
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
      sleep: options.sleep,
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

  /*
   * The azure_monitor receiver's datapoint attributes, with a split
   * series' dimension values as it names them (metadata_entityname).
   */
  private datapointAttributes(data: {
    armId: string;
    name: string;
    type: string;
    resourceGroup: string;
    location: string;
    grain: string;
    dimensions?: Array<AzureMetricDimensionValue> | undefined;
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

    for (const dimension of data.dimensions || []) {
      attributes.push(
        stringAttribute(
          `${AZURE_DIMENSION_ATTRIBUTE_PREFIX}${dimension.name}`,
          dimension.value,
        ),
      );
    }

    return attributes;
  }

  private fromArm(
    resource: AzureResource,
    subscriptionId: string,
  ): AzureResourceToRead | null {
    /*
     * Only the types OneUptime reads metrics of: not every NIC, alert rule
     * and extension, nor a network security group, which publishes none
     * and is listed by the inventory alone (#9375).
     */
    if (
      !getCloudResourceTypeDescriptor(CloudProvider.Azure, resource.type) ||
      isInventoryOnlyCloudResourceType(CloudProvider.Azure, resource.type)
    ) {
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
      kind: resource.kind,
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
   * A cached selection (a type's, or one resource's own): its metrics while
   * it is a day old at most - or older, when `keepStale` (a read that did
   * not list resources, which leaves a type's refresh to the next that does
   * and so knows their kinds) - and made for the type's key metrics as they
   * are now. Null when it has to be read again.
   */
  private readCachedSelection(data: {
    cached: JSONValue | undefined;
    fingerprint: string;
    now: Date;
    keepStale?: boolean | undefined;
  }): Array<SelectedMetric> | null {
    if (
      !data.cached ||
      typeof data.cached !== "object" ||
      Array.isArray(data.cached)
    ) {
      return null;
    }

    const entry: JSONObject = data.cached as JSONObject;

    if (
      entry["of"] !== data.fingerprint ||
      (!data.keepStale &&
        isOlderThan(entry["at"] as string | undefined, DAY_MS, data.now))
    ) {
      return null;
    }

    return ((entry["metrics"] as Array<JSONObject> | undefined) || []).map(
      (metric: JSONObject): SelectedMetric => {
        return {
          name: String(metric["name"] || ""),
          unit: String(metric["unit"] || ""),
          aggregation: String(metric["aggregation"] || ""),
          grain: String(metric["grain"] || ""),
        };
      },
    );
  }

  // A selection as the connection's state keeps it: only what is read.
  private toCachedSelection(data: {
    selected: Array<SelectedMetric>;
    fingerprint: string;
    now: Date;
  }): JSONObject {
    return {
      at: data.now.toISOString(),
      of: data.fingerprint,
      metrics: data.selected.map((metric: SelectedMetric): JSONObject => {
        return {
          name: metric.name,
          unit: metric.unit,
          aggregation: metric.aggregation,
          grain: metric.grain,
        };
      }),
    };
  }

  /*
   * The key metrics a resource type is read with: the cached selection
   * while it holds (readCachedSelection), else its definitions read now
   * from a few of its resources, of different kinds where the listing says
   * (pickAzureDefinitionSamples), their selections together. A resource
   * that publishes fewer of them is read with its own (readSubscriptions).
   */
  private async getTypeSelection(data: {
    arm: AzureArm;
    type: string;
    resources: Array<AzureResourceToRead>;
    cache: JSONObject;
    now: Date;
    isListing: boolean;
  }): Promise<Array<SelectedMetric>> {
    const keyMetrics: AzureTypeKeyMetrics | undefined = getAzureKeyMetrics(
      data.type,
    );

    if (!keyMetrics) {
      return [];
    }

    const key: string = data.type.toLowerCase();
    const fingerprint: string = getAzureKeyMetricsFingerprint(keyMetrics);
    const cached: Array<SelectedMetric> | null = this.readCachedSelection({
      cached: data.cache[key],
      fingerprint,
      now: data.now,
      keepStale: !data.isListing,
    });

    if (cached) {
      return cached;
    }

    const selections: Array<Array<SelectedMetric>> = [];
    let firstError: unknown = undefined;

    for (const sample of pickAzureDefinitionSamples(data.resources)) {
      try {
        selections.push(
          selectAzureMetrics(
            keyMetrics,
            await data.arm.getMetricDefinitions(sample.armId),
          ),
        );
      } catch (error) {
        if (error instanceof CloudReadBudgetSpent) {
          throw error;
        }

        firstError = firstError || error;
      }

      // Every metric found: the other samples would add nothing.
      if (
        mergeAzureSelections(keyMetrics, selections).length >=
        Math.min(
          getAzureReadMetricNames(keyMetrics).length,
          AZURE_MAX_METRICS_PER_RESOURCE,
        )
      ) {
        break;
      }
    }

    if (selections.length === 0 && firstError) {
      throw firstError;
    }

    const selected: Array<SelectedMetric> = mergeAzureSelections(
      keyMetrics,
      selections,
    );

    data.cache[key] = this.toCachedSelection({
      selected,
      fingerprint,
      now: data.now,
    });

    return selected;
  }

  /*
   * A resource's own selection, read from its own definitions and kept in
   * `cache` (the connection's azureResourceMetricDefinitions) a day, by its
   * lowercased ARM id: AZURE_MAX_RESOURCE_DEFINITIONS of them at most, the
   * oldest dropped first.
   */
  private async getResourceSelection(data: {
    arm: AzureArm;
    entry: AzureResourceToRead;
    keyMetrics: AzureTypeKeyMetrics;
    cache: JSONObject;
    now: Date;
  }): Promise<Array<SelectedMetric>> {
    const selected: Array<SelectedMetric> = selectAzureMetrics(
      data.keyMetrics,
      await data.arm.getMetricDefinitions(data.entry.armId),
    );

    data.cache[data.entry.armId.toLowerCase()] = this.toCachedSelection({
      selected,
      fingerprint: getAzureKeyMetricsFingerprint(data.keyMetrics),
      now: data.now,
    });

    const keys: Array<string> = Object.keys(data.cache);

    if (keys.length > AZURE_MAX_RESOURCE_DEFINITIONS) {
      const byAge: Array<string> = keys.sort((a: string, b: string): number => {
        const at: (key: string) => string = (key: string): string => {
          return String((data.cache[key] as JSONObject | undefined)?.["at"]);
        };

        return at(a) < at(b) ? -1 : at(a) > at(b) ? 1 : 0;
      });

      for (const old of byAge.slice(
        0,
        keys.length - AZURE_MAX_RESOURCE_DEFINITIONS,
      )) {
        delete data.cache[old];
      }
    }

    return selected;
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
    const keepAudit: boolean = keepsAuditRecords(options);

    if (keepAudit) {
      result.auditRecords = [];
    }

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

    const busy: Array<string> = [];

    const outcomes: Array<
      Settled<{
        changes: Array<CloudChange>;
        complete: boolean;
        auditRecords: Array<CloudAuditRecord>;
      }>
    > = await mapWithConcurrency(
      subscriptionIds.slice(0, AZURE_MAX_SUBSCRIPTIONS),
      CONCURRENCY,
      async (
        subscriptionId: string,
      ): Promise<{
        changes: Array<CloudChange>;
        complete: boolean;
        auditRecords: Array<CloudAuditRecord>;
      }> => {
        const listed: { events: Array<JSONObject>; complete: boolean } =
          await arm.listActivityLog({
            subscriptionId,
            start: getChangeWindowStart({
              state: options.state,
              place: getChangePlace(subscriptionId, ""),
              now,
              since: options.since,
            }),
            end: now,
          });

        return {
          changes: listed.events
            .map((event: JSONObject): CloudChange | null => {
              return readAzureActivityEvent({ event, subscriptionId });
            })
            .filter((change: CloudChange | null): boolean => {
              return change !== null;
            }) as Array<CloudChange>,
          complete: listed.complete,
          // The events whole, for Security Events' Cloud audit logs.
          auditRecords: keepAudit
            ? listed.events.map((event: JSONObject): CloudAuditRecord => {
                return { accountId: subscriptionId, record: event };
              })
            : [],
        };
      },
    );

    outcomes.forEach(
      (
        outcome: Settled<{
          changes: Array<CloudChange>;
          complete: boolean;
          auditRecords: Array<CloudAuditRecord>;
        }>,
        index: number,
      ) => {
        const subscriptionId: string = subscriptionIds[index]!;

        if (outcome.ok) {
          result.auditRecords?.push(...outcome.value.auditRecords);

          result.changes.push(
            ...keepNewChanges({
              state: options.state,
              place: getChangePlace(subscriptionId, ""),
              changes: outcome.value.changes,
              now,
              complete: outcome.value.complete,
              isLookBack,
              // The Activity Log lists newest first.
              order: "newest-first",
            }),
          );

          if (!outcome.value.complete) {
            busy.push(subscriptionId);
          }

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
      },
    );

    if (busy.length > 0) {
      result.warnings.push(
        `More changed in subscription ${busy.slice(0, 5).join(", ")} than one read takes: the newest changes are kept, and some older ones were left out.`,
      );
    }

    if (refused) {
      result.warnings.push(
        "The app may not read a subscription's Activity Log. Give it the Monitoring Reader role on it.",
      );
    }

    return result;
  }

  // The subscriptions a read of costs or savings is about, as the reads find them.
  private async getCostSubscriptions(
    arm: AzureArm,
    settings: CloudConnectionSettings,
    state: CloudConnectionPullState,
  ): Promise<Array<string>> {
    const subscriptionIds: Array<string> =
      state.accounts && state.accounts.length > 0
        ? state.accounts
        : (await this.getSubscriptions(arm, settings)).map(
            (subscription: AzureSubscription): string => {
              return subscription.subscriptionId;
            },
          );

    return subscriptionIds.slice(0, AZURE_MAX_SUBSCRIPTIONS);
  }

  /*
   * What each subscription costs per day, by resource and service, from
   * Cost Management (AzureCosts), side by side. A resource's Region is the
   * one OneUptime holds for it. A subscription that cannot be read says
   * why; the others are read.
   */
  public async readCosts(
    settings: CloudConnectionSettings,
    options: CloudCostsOptions,
  ): Promise<CloudCostsResult> {
    try {
      const arm: AzureArm = this.arm(settings, options, options.budget);
      const subscriptionIds: Array<string> = await this.getCostSubscriptions(
        arm,
        settings,
        options.state,
      );
      const regionsByResource: Map<string, string> = new Map();

      for (const resource of options.knownResources || []) {
        if (resource.providerResourceId && resource.region) {
          regionsByResource.set(
            getCloudCostResourceKey("azure", resource.providerResourceId),
            resource.region,
          );
        }
      }

      const outcomes: Array<
        Settled<{ records: CloudCostsResult["records"]; complete: boolean }>
      > = await mapWithConcurrency(
        subscriptionIds,
        // Cost Management is quick to throttle: two at a time.
        2,
        async (
          subscriptionId: string,
        ): Promise<{
          records: CloudCostsResult["records"];
          complete: boolean;
        }> => {
          return await readAzureCosts({
            arm,
            subscriptionId,
            start: options.start,
            end: options.end,
            regionsByResource,
          });
        },
      );

      const result: CloudCostsResult = {
        records: [],
        accounts: [],
        warnings: [],
        complete: true,
      };

      outcomes.forEach(
        (
          outcome: Settled<{
            records: CloudCostsResult["records"];
            complete: boolean;
          }>,
          index: number,
        ): void => {
          const subscriptionId: string = subscriptionIds[index]!;

          if (outcome.ok && outcome.value.complete) {
            result.records.push(...outcome.value.records);
            result.accounts.push({
              accountId: subscriptionId,
              state: CloudCostState.Reading,
            });
            return;
          }

          if (!outcome.ok) {
            const failure: unknown = explainExpiredAzureSecret(outcome.error);

            if (
              failure instanceof LlmProviderError &&
              failure.kind === CloudConnectionFailureKind.Authentication
            ) {
              throw failure;
            }
          }

          const described: { state: CloudCostState; message: string } =
            outcome.ok
              ? {
                  state: CloudCostState.Failed,
                  message:
                    "The subscription's costs had more pages than one read takes: they are read again shortly.",
                }
              : outcome.error instanceof CloudReadBudgetSpent
                ? {
                    state: CloudCostState.Failed,
                    message:
                      "The read reached its limit before these costs: they are read again shortly.",
                  }
                : describeAzureCostFailure({
                    error: outcome.error,
                    what: "costs",
                  });

          result.accounts.push({
            accountId: subscriptionId,
            state: described.state,
            message: described.message,
          } as CloudCostAccountOutcome);
          result.warnings.push(described.message);
          result.complete = false;
        },
      );

      return result;
    } catch (error) {
      throw explainExpiredAzureSecret(error);
    }
  }

  /*
   * The ways to spend less in each subscription, from Azure Advisor
   * (AzureCosts), and how much of its spend its reservations and savings
   * plans cover and how much of them is used, from Cost Management
   * (AzureCommitments).
   */
  public async readSavings(
    settings: CloudConnectionSettings,
    options: CloudSavingsOptions,
  ): Promise<CloudSavingsResult> {
    try {
      const arm: AzureArm = this.arm(settings, options, options.budget);
      const subscriptionIds: Array<string> = await this.getCostSubscriptions(
        arm,
        settings,
        options.state,
      );

      const outcomes: Array<
        Settled<{
          recommendations: CloudSavingsResult["recommendations"];
          complete: boolean;
        }>
      > = await mapWithConcurrency(
        subscriptionIds,
        CONCURRENCY,
        async (
          subscriptionId: string,
        ): Promise<{
          recommendations: CloudSavingsResult["recommendations"];
          complete: boolean;
        }> => {
          return await readAzureAdvisor({ arm, subscriptionId });
        },
      );

      const result: CloudSavingsResult = {
        recommendations: [],
        accounts: [],
        warnings: [],
        complete: true,
      };

      outcomes.forEach(
        (
          outcome: Settled<{
            recommendations: CloudSavingsResult["recommendations"];
            complete: boolean;
          }>,
          index: number,
        ): void => {
          const subscriptionId: string = subscriptionIds[index]!;

          if (outcome.ok && outcome.value.complete) {
            result.recommendations.push(...outcome.value.recommendations);
            result.accounts.push({
              accountId: subscriptionId,
              state: CloudCostState.Reading,
            });
            return;
          }

          if (!outcome.ok) {
            const failure: unknown = explainExpiredAzureSecret(outcome.error);

            if (
              failure instanceof LlmProviderError &&
              failure.kind === CloudConnectionFailureKind.Authentication
            ) {
              throw failure;
            }
          }

          const described: { state: CloudCostState; message: string } =
            outcome.ok
              ? {
                  state: CloudCostState.Failed,
                  message:
                    "There were more recommendations than one read takes: they are read again tomorrow.",
                }
              : describeAzureCostFailure({
                  error: outcome.error,
                  what: "savings",
                });

          result.accounts.push({
            accountId: subscriptionId,
            state: described.state,
            message: described.message,
          });
          result.warnings.push(described.message);
          result.complete = false;
        },
      );

      // Cost Management is quick to throttle: two subscriptions at a time.
      const now: Date = options.now ? options.now() : new Date();
      const commitments: Array<Settled<CloudCommitmentSummary>> =
        await mapWithConcurrency(
          subscriptionIds,
          2,
          async (subscriptionId: string): Promise<CloudCommitmentSummary> => {
            return await readAzureCommitments({ arm, subscriptionId, now });
          },
        );

      result.commitments = [];

      commitments.forEach(
        (outcome: Settled<CloudCommitmentSummary>, index: number): void => {
          if (!outcome.ok) {
            const failure: unknown = explainExpiredAzureSecret(outcome.error);

            if (
              failure instanceof LlmProviderError &&
              failure.kind === CloudConnectionFailureKind.Authentication
            ) {
              throw failure;
            }

            return;
          }

          result.commitments!.push({
            accountId: subscriptionIds[index]!,
            summary: outcome.value,
          });
        },
      );

      return result;
    } catch (error) {
      throw explainExpiredAzureSecret(error);
    }
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
    const readable: Array<AzureSubscription> = await this.getSubscriptions(
      arm,
      settings,
    );
    const subscriptions: Array<AzureSubscription> = readable.slice(
      0,
      AZURE_MAX_SUBSCRIPTIONS,
    );
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

    /*
     * The subnets, out of their virtual networks (#9375). A query that
     * fails leaves them unlisted - never taken for gone - and the rest of
     * the inventory as it is.
     */
    let subnets: { rows: Array<JSONObject>; complete: boolean } = {
      rows: [],
      complete: subscriptionIds.length === 0,
    };
    const subnetWarnings: Array<string> = [];

    if (subscriptionIds.length > 0) {
      try {
        subnets = await arm.queryResourceGraph({
          subscriptionIds,
          query: buildAzureSubnetQuery(),
        });
      } catch (error) {
        if (
          error instanceof CloudReadBudgetSpent ||
          (error instanceof LlmProviderError &&
            error.kind === CloudConnectionFailureKind.Authentication)
        ) {
          throw error;
        }

        subnetWarnings.push(
          `Could not list the subnets: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    }

    // Read together: a VM runs where its interfaces do, a pool's balancer sends to them.
    const items: Array<CloudInventoryItem> = buildAzureInventoryItems([
      ...listing.rows,
      ...subnets.rows,
    ]);

    const knownTypes: Array<string> = [
      ...AZURE_RESOURCE_TYPES.map(
        (descriptor: CloudResourceTypeDescriptor): string => {
          return descriptor.type;
        },
      ),
      ...AZURE_INVENTORY_ONLY_QUERY_TYPES,
      ...(subnets.complete ? [AZURE_SUBNET_TYPE] : []),
    ];

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
      warnings: [
        ...(readable.length > AZURE_MAX_SUBSCRIPTIONS
          ? [
              `The app may read ${readable.length} subscriptions: the first ${AZURE_MAX_SUBSCRIPTIONS} are listed. Name the ones to read under Subscriptions.`,
            ]
          : []),
        ...(listing.complete
          ? []
          : [
              "The subscriptions have more resources than one inventory lists: the rest are listed next time.",
            ]),
        ...subnetWarnings,
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
    // Resources read with their own definitions (isAzureUnsupportedMetricsRefusal).
    const resourceDefinitionsCache: JSONObject = {
      ...((state.azureResourceMetricDefinitions as JSONObject | undefined) ||
        {}),
    };
    const selectedByType: Map<string, Array<SelectedMetric>> = new Map();
    const readingByType: Map<string, Array<AzureResourceToRead>> = new Map();

    for (const entry of reading) {
      const key: string = entry.type.toLowerCase();
      const list: Array<AzureResourceToRead> = readingByType.get(key) || [];
      list.push(entry);
      readingByType.set(key, list);
    }

    for (const [key, resources] of readingByType) {
      if (budget.isSpent()) {
        break;
      }

      try {
        selectedByType.set(
          key,
          await this.getTypeSelection({
            arm,
            type: resources[0]!.type,
            resources,
            cache: definitionsCache,
            now,
            isListing: completelyListedAccounts.length > 0,
          }),
        );
      } catch (error) {
        if (error instanceof CloudReadBudgetSpent) {
          break;
        }

        selectedByType.set(key, []);
        warnings.push(
          `Could not read which metrics ${resources[0]!.type} publishes: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    }

    state.azureMetricDefinitions = definitionsCache;

    const cursors: Record<string, string> = { ...(state.cursors || {}) };
    const readGroups: Map<string, AzureReadGroup> = getAzureReadGroups({
      cursors,
      now,
    });

    const groups: Map<string, CloudMetricGroup> = new Map();
    const readGroupsRead: Set<string> = new Set<string>();
    let failedResources: number = 0;
    // "metric|code" -> how many resources Azure Monitor could not read it of.
    const metricFailures: Map<
      string,
      { failure: AzureMetricFailure; resources: number }
    > = new Map();
    // Resources with more queues and topics than a read reads.
    const cappedResources: Array<string> = [];

    // One resource's metrics with a selection, read afresh: nothing kept of an earlier try.
    const readResource: (
      entry: AzureResourceToRead,
      selected: Array<SelectedMetric>,
    ) => Promise<AzureResourceMetricsRead> = async (
      entry: AzureResourceToRead,
      selected: Array<SelectedMetric>,
    ): Promise<AzureResourceMetricsRead> => {
      const splitBy: string | undefined = getAzureKeyMetrics(
        entry.type,
      )?.splitByDimension;
      const byGroup: Map<string, Array<SelectedMetric>> = new Map();

      for (const metric of selected) {
        const key: string = getAzureReadGroupKey(entry.type, metric);
        const list: Array<SelectedMetric> = byGroup.get(key) || [];
        list.push(metric);
        byGroup.set(key, list);
      }

      const read: AzureResourceMetricsRead = {
        series: [],
        failures: [],
        capped: [],
        selected,
      };

      for (const [key, metrics] of byGroup) {
        const group: AzureReadGroup | undefined = readGroups.get(key);

        // Nothing new of its grain yet, or not due: the next read reads it.
        if (!group || !group.window) {
          continue;
        }

        const answer: AzureMetricsAnswer = await arm.getMetrics({
          resourceId: entry.armId,
          metrics,
          interval: group.grain,
          start: group.window.start,
          end: group.window.end,
          ...(splitBy
            ? { splitBy, top: AZURE_MAX_SPLIT_SERIES_PER_METRIC }
            : {}),
        });

        readGroupsRead.add(key);
        read.failures.push(...answer.failures);
        read.capped.push(...answer.capped);

        for (const item of answer.series) {
          const unit: string =
            metrics.find((metric: SelectedMetric): boolean => {
              return (
                metric.name.toLowerCase() === item.metricName.toLowerCase()
              );
            })?.unit || item.unit;

          read.series.push({ ...item, unit, grain: group.grain });
        }
      }

      return read;
    };

    const outcomes: Array<Settled<AzureResourceMetricsRead>> =
      await mapWithConcurrency(
        reading,
        CONCURRENCY,
        async (
          entry: AzureResourceToRead,
        ): Promise<AzureResourceMetricsRead> => {
          const keyMetrics: AzureTypeKeyMetrics = getAzureKeyMetrics(
            entry.type,
          )!;
          /*
           * The resource's own selection when an earlier read found it
           * publishes fewer metrics than its type's, else the type's.
           */
          const own: Array<SelectedMetric> | null = this.readCachedSelection({
            cached: resourceDefinitionsCache[entry.armId.toLowerCase()],
            fingerprint: getAzureKeyMetricsFingerprint(keyMetrics),
            now,
          });

          try {
            return await readResource(
              entry,
              own || selectedByType.get(entry.type.toLowerCase()) || [],
            );
          } catch (error) {
            if (own || !isAzureUnsupportedMetricsRefusal(error)) {
              throw error;
            }

            // It publishes fewer than its type's selection: read it with its own.
            return await readResource(
              entry,
              await this.getResourceSelection({
                arm,
                entry,
                keyMetrics,
                cache: resourceDefinitionsCache,
                now,
              }),
            );
          }
        },
      );

    state.azureResourceMetricDefinitions = resourceDefinitionsCache;

    outcomes.forEach(
      (outcome: Settled<AzureResourceMetricsRead>, index: number) => {
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

        for (const failure of outcome.value.failures) {
          const key: string = `${failure.metricName.toLowerCase()}|${failure.code}`;
          const known:
            | { failure: AzureMetricFailure; resources: number }
            | undefined = metricFailures.get(key);

          metricFailures.set(key, {
            failure: known?.failure || failure,
            resources: (known?.resources || 0) + 1,
          });
        }

        if (outcome.value.capped.length > 0) {
          cappedResources.push(entry.name);
        }

        for (const series of outcome.value.series) {
          const selected: SelectedMetric | undefined =
            outcome.value.selected.find((metric: SelectedMetric): boolean => {
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
              dimensions: series.dimensions,
            }),
            points: series.points,
          });
        }
      },
    );

    if (failedResources > 0) {
      warnings.push(
        `Could not read the metrics of ${failedResources} ${
          failedResources === 1 ? "resource" : "resources"
        } this time.`,
      );
    }

    for (const { failure, resources } of metricFailures.values()) {
      warnings.push(
        `Azure Monitor could not read ${failure.metricName} of ${resources} ${
          resources === 1 ? "resource" : "resources"
        }: ${failure.message || failure.code}`,
      );
    }

    /*
     * Shown under the connection's status on Cloud > Connect, as the
     * queue's Broker metrics card tells its reader to look there: which
     * namespaces, and the way to read the rest.
     */
    if (cappedResources.length > 0) {
      const max: string =
        AZURE_MAX_SPLIT_SERIES_PER_METRIC.toLocaleString("en-US");
      // "a", "a and b", "a, b and c", "a, b, c and 2 more".
      const named: Array<string> = cappedResources.slice(0, 3);
      const more: number = cappedResources.length - named.length;
      const names: string =
        more > 0
          ? `${named.join(", ")} and ${more} more`
          : named.length > 1
            ? `${named.slice(0, -1).join(", ")} and ${named[named.length - 1]}`
            : named[0]!;

      warnings.push(
        cappedResources.length === 1
          ? `${names} has ${max} or more queues, topics or event hubs: a read takes the metrics of ${max} of them. The collector's azure_monitor receiver can read the rest.`
          : `${names} have ${max} or more queues, topics or event hubs each: a read takes the metrics of ${max} of each. The collector's azure_monitor receiver can read the rest.`,
      );
    }

    /*
     * A grain's window moves on once it was read: a resource that failed
     * misses that stretch rather than every other one being written twice.
     */
    for (const key of readGroupsRead) {
      const group: AzureReadGroup | undefined = readGroups.get(key);

      if (group?.window) {
        cursors[group.cursorKey] = group.window.end.toISOString();
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
