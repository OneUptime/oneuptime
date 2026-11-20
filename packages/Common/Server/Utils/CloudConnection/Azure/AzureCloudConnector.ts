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
import {
  CLOUD_ADDED_METRIC_MAX_SPLIT_VALUES,
  CloudAddedMetric,
  CloudAddedMetricScope,
  getCloudAddedMetricsOfType,
} from "../../../../Types/Cloud/CloudAddedMetrics";
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
  orderLeastRecentlyRead,
  readCloudSetting,
} from "../CloudConnectorTypes";
import {
  AZURE_COST_MAX_PAGES,
  describeAzureCostFailure,
  readAzureAdvisor,
  readAzureCosts,
} from "./AzureCosts";
import { readAzureCommitments } from "./AzureCommitments";
import { AzureCostReader, AzureCostThrottled } from "./AzureCostManagement";
import {
  CloudCostState,
  getCloudCostResourceKey,
} from "../../../../Types/Cloud/CloudCost";
import { CloudCommitmentSummary } from "../../../../Types/Cloud/CloudCommitments";
import { CloudResourceMetricStatus } from "../../../../Types/Cloud/CloudResourceMetricCollection";
import AzureArm, {
  AzureMetricDefinition,
  AzureMetricDimensionValue,
  AzureResource,
  AzureSubscription,
} from "./AzureArm";
import {
  AzureMetricCallGroup,
  AzureMetricNotRead,
  AzureMetricPlace,
  AzureMetricReadResult,
  AzureMetricReader,
  AzureMetricRequest,
  AzureMetricResourceRead,
  isAzureUnsupportedMetricsRefusal,
} from "./AzureMetricReads";
import {
  describeAzureMetricNotRead,
  describeAzureMetricReadFailure,
  getNextAzureMetricStatus,
  isAzureMetricBatchOff,
  isAzureMetricUnsupportedNow,
  pruneAzureMetricStatuses,
  readAzureMetricBatchesOff,
  readAzureMetricStatuses,
  rememberAzureMetricBatchRefusals,
} from "./AzureMetricMemory";
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
 *      resource that has them since the last read, each metric with the
 *      aggregation its definition calls primary, at the finest grain it
 *      offers from a minute up - and, for the few metrics kept at five
 *      minutes at their finest that are marked as earning it (an App
 *      Service app's health check), in a five-minute call every 15 minutes
 *      (AzureReadGroup). A deprecated metric the type still reads for the
 *      monitors built on it rides in the same calls (retired). How the
 *      calls are made is AzureMetricReads': up to 20 metrics a call, of
 *      aggregations every one of them is served with, the resources of a
 *      subscription, Region and type in batches of 50 (metrics:getBatch),
 *      a few calls at once per subscription and Region, and what Azure is
 *      too busy for asked again after a wait. A metric the resource does
 *      not publish is left out, from its type's metric definitions - read
 *      once a day from up to three of its resources, of different kinds
 *      where the listing says, their key metrics together. Azure refuses a
 *      whole call that names a metric the resource does not publish, so a
 *      resource that publishes fewer than its type's (a vCore database, a
 *      Basic load balancer) is read again with its own definitions, kept a
 *      day. A metric Azure says it does not serve for a resource is not
 *      asked for again for a day; what a read could not read of a resource
 *      is kept for its pages to say (azureMetricStatus). A Service Bus or
 *      Event Hubs namespace's metrics are split by EntityName in that same
 *      one call: a series per queue, topic and event hub (up to
 *      AZURE_MAX_SPLIT_SERIES_PER_METRIC of each metric), never a call per
 *      queue - 50 queues cost what one does.
 *   3. Builds the export the azure_monitor receiver sends: the subscription
 *      on the resource, each resource's id, name, type, group and location
 *      on its datapoints, a split series' dimension as metadata_<name>
 *      (metadata_entityname, which files it on its queue or topic when it
 *      is ingested), metrics named azure_<metric>_<aggregation>.
 */

// What a read of one resource's metrics brought back, and what it was read with.
interface AzureResourceMetricsRead {
  read: AzureMetricResourceRead<SelectedMetric>;
  // Its type's selection, or its own.
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
  /*
   * Every aggregation its definition says Azure Monitor serves it with
   * (supportedAggregationTypes): a call asks for its metrics' aggregations
   * together, so only metrics served with each other's share one
   * (partitionAzureMetricCalls). Unknown: asked with its own alone.
   */
  supportedAggregations?: Array<string> | undefined;
  /*
   * A metric a person added to the reads (CloudAddedMetrics), after the
   * key metrics: read in their calls while a call has room, and one kept at
   * five minutes in the five-minute call, every 15 minutes.
   */
  isAdded?: boolean | undefined;
  /*
   * An addition read split by one of its dimensions (#9808): in a call of
   * its own, whose filter splits it alone, the busiest
   * CLOUD_ADDED_METRIC_MAX_SPLIT_VALUES values of it.
   */
  splitBy?: string | undefined;
}

/*
 * A selection with each addition's split as it is added now (#9808): a
 * selection is kept a day, an addition's split is read from the additions.
 */
export function applyAzureSplits(
  selected: Array<SelectedMetric>,
  added: ReadonlyArray<Pick<CloudAddedMetric, "name" | "splitBy">>,
): Array<SelectedMetric> {
  return selected.map((metric: SelectedMetric): SelectedMetric => {
    if (!metric.isAdded) {
      return metric;
    }

    const splitBy: string | undefined = added.find(
      (addition: Pick<CloudAddedMetric, "name">): boolean => {
        return addition.name.toLowerCase() === metric.name.toLowerCase();
      },
    )?.splitBy;
    const next: SelectedMetric = { ...metric };

    delete next.splitBy;

    if (splitBy) {
      next.splitBy = splitBy;
    }

    return next;
  });
}

// The aggregation a split read picks its busiest values by, as Azure Monitor's orderby names it.
export function getAzureSplitOrder(aggregation: string): string {
  const name: string = aggregation.trim().toLowerCase();

  return `${name === "total" ? "sum" : name || "average"} desc`;
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

// A resource read with its type's selection that Azure refused (AzureMetricReads).
export { isAzureUnsupportedMetricsRefusal };

/*
 * What a selection keeps of each metric, by release: from the second, the
 * aggregations it is served with (#10291). A selection kept by an older
 * release is read again, rather than its metrics asked a call per
 * aggregation for a day.
 */
const AZURE_SELECTION_VERSION: string = "2";

/*
 * A short fingerprint of a type's key metrics, and of the metrics added to
 * it: a definitions cache made for another list of them is read again, so a
 * release that adds metrics - or a person who adds one - reads them from
 * the next read, not a day later.
 */
export function getAzureKeyMetricsFingerprint(
  keyMetrics: AzureTypeKeyMetrics,
  added: ReadonlyArray<Pick<CloudAddedMetric, "name">> = [],
): string {
  let hash: number = 5381;
  const text: string = [
    `v${AZURE_SELECTION_VERSION}`,
    ...getAzureReadMetricNames(keyMetrics),
    ...added.map((metric: Pick<CloudAddedMetric, "name">): string => {
      return `+${metric.name}`;
    }),
  ]
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
 * The added metrics of a selection, in the order they were added, each
 * once and none that is a key metric of the type (it is read as one).
 */
function getAzureAddedNames(
  keyMetrics: AzureTypeKeyMetrics,
  added: ReadonlyArray<Pick<CloudAddedMetric, "name">>,
): Array<string> {
  const keyNames: Set<string> = new Set<string>(
    getAzureReadMetricNames(keyMetrics).map((name: string): string => {
      return name.toLowerCase();
    }),
  );
  const names: Array<string> = [];

  for (const metric of added) {
    const name: string = metric.name.toLowerCase();

    if (!keyNames.has(name) && !names.includes(name)) {
      names.push(name);
    }
  }

  return names;
}

/*
 * The selections of several resources of a type together, each metric
 * once (the first resource to publish it keeps its aggregation and grain),
 * in the catalog's order - its key metrics, then the deprecated ones it
 * still reads - at most AZURE_MAX_METRICS_PER_RESOURCE; then the metrics
 * added to the type (`added`), in the order they were added.
 */
export function mergeAzureSelections(
  keyMetrics: AzureTypeKeyMetrics,
  selections: Array<Array<SelectedMetric>>,
  added: ReadonlyArray<Pick<CloudAddedMetric, "name">> = [],
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

  for (const name of getAzureAddedNames(keyMetrics, added)) {
    const selected: SelectedMetric | undefined = byName.get(name);

    if (selected) {
      merged.push({ ...selected, isAdded: true });
    }
  }

  return merged;
}

/*
 * A resource's own additions (CloudAddedMetrics) as it is read with them,
 * after `selection`: each with the aggregation and grain its definition
 * gave when it was added, and none `selection` reads already.
 */
export function withAzureResourceAdditions(
  selection: Array<SelectedMetric>,
  added: ReadonlyArray<CloudAddedMetric>,
): Array<SelectedMetric> {
  const names: Set<string> = new Set<string>(
    selection.map((metric: SelectedMetric): string => {
      return metric.name.toLowerCase();
    }),
  );
  const merged: Array<SelectedMetric> = [...selection];

  for (const metric of added) {
    const name: string = metric.name.toLowerCase();
    const grain: string | undefined = metric.grain
      ? pickAzureGrain([metric.grain])
      : undefined;

    if (names.has(name) || !grain) {
      continue;
    }

    names.add(name);
    merged.push({
      name: metric.name,
      aggregation: metric.aggregation,
      grain,
      unit: metric.unit,
      isAdded: true,
    });
  }

  return merged;
}

// The additions of a resource that are its own, by its ARM id.
export function getAzureResourceAdditions(data: {
  added: ReadonlyArray<CloudAddedMetric>;
  armId: string;
  type: string;
}): Array<CloudAddedMetric> {
  const armId: string = data.armId.toLowerCase();
  const type: string = data.type.toLowerCase();

  return data.added.filter((metric: CloudAddedMetric): boolean => {
    return (
      metric.provider === CloudProvider.Azure &&
      metric.scope === CloudAddedMetricScope.Resource &&
      metric.resourceType.toLowerCase() === type &&
      (metric.azureResourceId || "").toLowerCase() === armId
    );
  });
}

// The additions read for every resource of a type.
export function getAzureTypeAdditions(data: {
  added: ReadonlyArray<CloudAddedMetric>;
  type: string;
}): Array<CloudAddedMetric> {
  return getCloudAddedMetricsOfType({
    added: data.added,
    resourceType: data.type,
  }).filter((metric: CloudAddedMetric): boolean => {
    return metric.provider === CloudProvider.Azure;
  });
}

// The metrics added to a resource: its type's, then its own (CloudAddedMetrics).
export function getAzureAdditionsOfResource(data: {
  added: ReadonlyArray<CloudAddedMetric>;
  armId: string;
  type: string;
}): Array<CloudAddedMetric> {
  return [
    ...getAzureTypeAdditions({ added: data.added, type: data.type }),
    ...getAzureResourceAdditions({
      added: data.added,
      armId: data.armId,
      type: data.type,
    }),
  ];
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
 * definition offers at five minutes at its finest - and for an added one
 * kept at five minutes, which a call of its own every read would cost a
 * call a resource each read - else its grain's.
 */
export function getAzureReadGroupKey(
  type: string,
  metric: SelectedMetric,
): string {
  return metric.grain.toUpperCase() === AZURE_FIVE_MINUTE_GRAIN &&
    (metric.isAdded || isAzureFiveMinuteKeyMetric(type, metric.name))
    ? AZURE_FIVE_MINUTE_CURSOR
    : metric.grain.toUpperCase();
}

/*
 * What a resource asks Azure Monitor for this read (AzureMetricReads): its
 * metrics by read group - each group whose window is due now - and by the
 * split an addition is read with (#9808), which its filter splits alone.
 * A Service Bus or Event Hubs namespace's are split by its entities. A
 * metric Azure said lately it does not serve for the resource is left out
 * until it is asked again (azureMetricStatus).
 */
export function buildAzureMetricRequest(data: {
  entry: {
    armId: string;
    subscriptionId: string;
    location: string;
    type: string;
  };
  selected: Array<SelectedMetric>;
  readGroups: Map<string, AzureReadGroup>;
  status?: CloudResourceMetricStatus | undefined;
  now: Date;
}): AzureMetricRequest<SelectedMetric> {
  // Its type's split: a Service Bus or Event Hubs namespace's, by its entities.
  const splitBy: string | undefined = getAzureKeyMetrics(
    data.entry.type,
  )?.splitByDimension;
  const groups: Map<string, AzureMetricCallGroup<SelectedMetric>> = new Map();

  for (const metric of data.selected) {
    if (
      isAzureMetricUnsupportedNow({
        status: data.status,
        metricName: metric.name,
        now: data.now,
      })
    ) {
      continue;
    }

    const key: string = getAzureReadGroupKey(data.entry.type, metric);
    const readGroup: AzureReadGroup | undefined = data.readGroups.get(key);

    // Nothing new of its grain yet, or not due: the next read reads it.
    if (!readGroup || !readGroup.window) {
      continue;
    }

    const orderBy: string | undefined = metric.splitBy
      ? getAzureSplitOrder(metric.aggregation)
      : undefined;
    const callKey: string = [key, metric.splitBy || "", orderBy || ""].join(
      "\n",
    );
    let group: AzureMetricCallGroup<SelectedMetric> | undefined =
      groups.get(callKey);

    if (!group) {
      group = {
        groupKey: key,
        grain: readGroup.grain,
        window: readGroup.window,
        metrics: [],
        // An added metric's split stops at its cap by design; a namespace's says so.
        reportsCapped: !metric.splitBy,
        /*
         * The split rides on the resource's own call, never a call per
         * queue: an addition's by its own dimension, a namespace's by its
         * entities.
         */
        ...(metric.splitBy
          ? {
              splitBy: metric.splitBy,
              top: CLOUD_ADDED_METRIC_MAX_SPLIT_VALUES,
              orderBy,
            }
          : splitBy
            ? { splitBy, top: AZURE_MAX_SPLIT_SERIES_PER_METRIC }
            : {}),
      };
      groups.set(callKey, group);
    }

    group.metrics.push(metric);
  }

  return {
    place: {
      armId: data.entry.armId,
      subscriptionId: data.entry.subscriptionId,
      region: data.entry.location,
      type: data.entry.type,
    },
    groups: Array.from(groups.values()),
  };
}

/*
 * The key metrics a resource type is read with, as its definitions allow:
 * in the catalog's order, then the deprecated ones it still reads for the
 * monitors built on them (retired), at most AZURE_MAX_METRICS_PER_RESOURCE;
 * then the metrics added to it (`added`, CloudAddedMetrics) its
 * definitions list, each with the aggregation it was added with when its
 * definition still offers it, else its primary one.
 */
export function selectAzureMetrics(
  keyMetrics: AzureTypeKeyMetrics,
  definitions: Array<AzureMetricDefinition>,
  added: ReadonlyArray<CloudAddedMetric> = [],
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
      ...getSupportedAggregations(definition),
    });

    if (selected.length >= AZURE_MAX_METRICS_PER_RESOURCE) {
      break;
    }
  }

  for (const name of getAzureAddedNames(keyMetrics, added)) {
    const definition: AzureMetricDefinition | undefined = byName.get(name);
    const grain: string | undefined = definition
      ? pickAzureGrain(definition.timeGrains)
      : undefined;

    if (!definition || !grain || !definition.primaryAggregationType) {
      continue;
    }

    const wanted: string | undefined = added.find(
      (metric: CloudAddedMetric): boolean => {
        return metric.name.toLowerCase() === name;
      },
    )?.aggregation;
    const supported: Array<string> = definition.supportedAggregationTypes || [];

    selected.push({
      name: definition.name,
      aggregation:
        wanted &&
        (supported.length === 0 ||
          supported.some((aggregation: string): boolean => {
            return aggregation.toLowerCase() === wanted.toLowerCase();
          }))
          ? wanted
          : definition.primaryAggregationType,
      grain,
      unit: definition.unit,
      ...getSupportedAggregations(definition),
      isAdded: true,
    });
  }

  return selected;
}

// The aggregations a definition says its metric is served with, when it says.
function getSupportedAggregations(
  definition: AzureMetricDefinition,
): Pick<SelectedMetric, "supportedAggregations"> {
  return definition.supportedAggregationTypes &&
    definition.supportedAggregationTypes.length > 0
    ? { supportedAggregations: [...definition.supportedAggregationTypes] }
    : {};
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
 * A subscription whose costs wait their turn: Cost Management's limits put
 * the read off - or the read's own limit stopped before it - and it may be
 * read from retryAt.
 */
export function getAzureQueuedCostOutcome(
  subscriptionId: string,
  retryAt: Date,
): CloudCostAccountOutcome {
  return {
    accountId: subscriptionId,
    state: CloudCostState.Queued,
    message: `Azure Cost Management limits how fast the tenant's costs are read: these are read from ${retryAt.toISOString()}.`,
    retryAt: retryAt.toISOString(),
  };
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

  // The connection's Resource Manager client: a resource's metric list reads through it too.
  public arm(
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
        const aggregations: Array<string> = Array.isArray(
          metric["aggregations"],
        )
          ? (metric["aggregations"] as Array<unknown>)
              .map((aggregation: unknown): string => {
                return typeof aggregation === "string" ? aggregation : "";
              })
              .filter((aggregation: string): boolean => {
                return Boolean(aggregation);
              })
          : [];

        return {
          name: String(metric["name"] || ""),
          unit: String(metric["unit"] || ""),
          aggregation: String(metric["aggregation"] || ""),
          grain: String(metric["grain"] || ""),
          ...(aggregations.length > 0
            ? { supportedAggregations: aggregations }
            : {}),
          ...(metric["added"] === true ? { isAdded: true } : {}),
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
          ...(metric.supportedAggregations &&
          metric.supportedAggregations.length > 0
            ? { aggregations: [...metric.supportedAggregations] }
            : {}),
          ...(metric.isAdded ? { added: true } : {}),
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
    // The metrics added to every resource of the type (CloudAddedMetrics).
    added?: Array<CloudAddedMetric> | undefined;
  }): Promise<Array<SelectedMetric>> {
    const keyMetrics: AzureTypeKeyMetrics | undefined = getAzureKeyMetrics(
      data.type,
    );

    if (!keyMetrics) {
      return [];
    }

    const added: Array<CloudAddedMetric> = data.added || [];
    const key: string = data.type.toLowerCase();
    const fingerprint: string = getAzureKeyMetricsFingerprint(
      keyMetrics,
      added,
    );
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
            added,
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
        mergeAzureSelections(keyMetrics, selections, added).length >=
        Math.min(
          getAzureReadMetricNames(keyMetrics).length,
          AZURE_MAX_METRICS_PER_RESOURCE,
        ) +
          getAzureAddedNames(keyMetrics, added).length
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
      added,
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
    // The metrics added to it: its type's and its own (CloudAddedMetrics).
    added?: Array<CloudAddedMetric> | undefined;
  }): Promise<Array<SelectedMetric>> {
    const selected: Array<SelectedMetric> = selectAzureMetrics(
      data.keyMetrics,
      await data.arm.getMetricDefinitions(data.entry.armId),
      data.added || [],
    );

    data.cache[data.entry.armId.toLowerCase()] = this.toCachedSelection({
      selected,
      fingerprint: getAzureKeyMetricsFingerprint(
        data.keyMetrics,
        data.added || [],
      ),
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

  // The paced Cost Management queries of one read (AzureCostManagement).
  private costReader(
    arm: AzureArm,
    options: CloudConnectorCallOptions & { budget: CloudReadBudget },
  ): AzureCostReader {
    return new AzureCostReader({
      arm,
      budget: options.budget,
      now: options.now,
      sleep: options.sleep,
    });
  }

  /*
   * What each subscription costs per day, by resource and service, from
   * Cost Management (AzureCosts), one subscription after another at the
   * pace the tenant's quotas allow (AzureCostManagement): the least
   * recently read first, so a read that stops part way reaches the others
   * next, and one never read in full over a first read's days. A
   * subscription Cost Management's limits put off - and every one after
   * it - is queued, with when it may be read; one that cannot be read says
   * why, and the others are read. A resource's Region is the one OneUptime
   * holds for it.
   */
  public async readCosts(
    settings: CloudConnectionSettings,
    options: CloudCostsOptions,
  ): Promise<CloudCostsResult> {
    try {
      const arm: AzureArm = this.arm(settings, options, options.budget);
      const costs: AzureCostReader = this.costReader(arm, options);
      const readAt: Record<string, string> =
        options.state.costAccountsReadAt || {};
      const only: Set<string> | null = options.accounts
        ? new Set<string>(
            options.accounts.map((accountId: string): string => {
              return accountId.trim().toLowerCase();
            }),
          )
        : null;
      const subscriptionIds: Array<string> = orderLeastRecentlyRead({
        accounts: (
          await this.getCostSubscriptions(arm, settings, options.state)
        ).filter((subscriptionId: string): boolean => {
          return !only || only.has(subscriptionId.toLowerCase());
        }),
        readAt: (subscriptionId: string): string | undefined => {
          return readAt[subscriptionId.toLowerCase()];
        },
      });
      const regionsByResource: Map<string, string> = new Map();

      for (const resource of options.knownResources || []) {
        if (resource.providerResourceId && resource.region) {
          regionsByResource.set(
            getCloudCostResourceKey("azure", resource.providerResourceId),
            resource.region,
          );
        }
      }

      const result: CloudCostsResult = {
        records: [],
        accounts: [],
        warnings: [],
        complete: true,
      };
      // When the subscriptions not reached may be read: set once one is put off.
      let putOffUntil: Date | null = null;
      let queued: number = 0;

      for (const subscriptionId of subscriptionIds) {
        if (putOffUntil) {
          result.accounts.push(
            getAzureQueuedCostOutcome(subscriptionId, putOffUntil),
          );
          queued++;
          continue;
        }

        // One the connection has never read in full goes back as far as a first read.
        const window: { start: Date; end: Date } =
          options.firstReadWindow && !readAt[subscriptionId.toLowerCase()]
            ? options.firstReadWindow
            : { start: options.start, end: options.end };

        try {
          const read: {
            records: CloudCostsResult["records"];
            complete: boolean;
          } = await readAzureCosts({
            costs,
            subscriptionId,
            start: window.start,
            end: window.end,
            regionsByResource,
          });

          if (read.complete) {
            result.records.push(...read.records);
            result.accounts.push({
              accountId: subscriptionId,
              state: CloudCostState.Reading,
              ...(window.start.getTime() !== options.start.getTime() ||
              window.end.getTime() !== options.end.getTime()
                ? { window }
                : {}),
            });
            continue;
          }

          const message: string = `The subscription's costs had more than ${AZURE_COST_MAX_PAGES} pages, more than one read takes: it keeps the costs it had.`;

          result.accounts.push({
            accountId: subscriptionId,
            state: CloudCostState.Failed,
            message,
          });
          result.warnings.push(message);
          result.complete = false;
        } catch (error) {
          if (
            error instanceof AzureCostThrottled ||
            error instanceof CloudReadBudgetSpent
          ) {
            /*
             * Cost Management's limits put it off until their time; the
             * read's own limit, until the next read.
             */
            putOffUntil =
              error instanceof AzureCostThrottled
                ? error.retryAt
                : new Date(costs.clock.nowMs());
            result.accounts.push(
              getAzureQueuedCostOutcome(subscriptionId, putOffUntil),
            );
            queued++;
            continue;
          }

          const failure: unknown = explainExpiredAzureSecret(error);

          if (
            failure instanceof LlmProviderError &&
            failure.kind === CloudConnectionFailureKind.Authentication
          ) {
            throw failure;
          }

          const described: { state: CloudCostState; message: string } =
            describeAzureCostFailure({ error, what: "costs" });

          result.accounts.push({
            accountId: subscriptionId,
            state: described.state,
            message: described.message,
          });
          result.warnings.push(described.message);
          result.complete = false;
        }
      }

      if (queued > 0 && putOffUntil) {
        result.complete = false;
        result.warnings.push(
          `Azure Cost Management limits how fast a tenant's costs are read: ${queued} ${
            queued === 1
              ? "subscription's costs are"
              : "subscriptions' costs are"
          } read from ${putOffUntil.toISOString()}, at the first read after it.`,
        );
      }

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

      result.commitments = await this.readCommitments({
        arm,
        options,
        subscriptionIds,
      });

      return result;
    } catch (error) {
      throw explainExpiredAzureSecret(error);
    }
  }

  /*
   * Each subscription's reservations and savings plans, from Cost
   * Management (AzureCommitments): one subscription after another at the
   * pace the tenant's quotas allow, the least recently read first. Once
   * Cost Management's limits - or the read's own - put one off, the rest
   * keep the figures they had and are read first next time. A subscription
   * that cannot be read says why.
   */
  private async readCommitments(data: {
    arm: AzureArm;
    options: CloudSavingsOptions;
    subscriptionIds: Array<string>;
  }): Promise<Array<{ accountId: string; summary: CloudCommitmentSummary }>> {
    const costs: AzureCostReader = this.costReader(data.arm, data.options);
    const now: Date = data.options.now ? data.options.now() : new Date();
    const readAt: Record<string, string> =
      data.options.state.azureCommitmentsReadAt || {};
    const commitments: Array<{
      accountId: string;
      summary: CloudCommitmentSummary;
    }> = [];

    for (const subscriptionId of orderLeastRecentlyRead({
      accounts: data.subscriptionIds,
      readAt: (subscriptionId: string): string | undefined => {
        return readAt[subscriptionId.toLowerCase()];
      },
    })) {
      try {
        commitments.push({
          accountId: subscriptionId,
          summary: await readAzureCommitments({ costs, subscriptionId, now }),
        });
        readAt[subscriptionId.toLowerCase()] = now.toISOString();
      } catch (error) {
        if (
          error instanceof AzureCostThrottled ||
          error instanceof CloudReadBudgetSpent
        ) {
          break;
        }

        throw explainExpiredAzureSecret(error);
      }
    }

    data.options.state.azureCommitmentsReadAt = Object.fromEntries(
      data.subscriptionIds
        .map((subscriptionId: string): [string, string | undefined] => {
          const key: string = subscriptionId.toLowerCase();
          return [key, readAt[key]];
        })
        .filter((entry: [string, string | undefined]): boolean => {
          return Boolean(entry[1]);
        }),
    ) as Record<string, string>;

    return commitments;
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
            added: getAzureTypeAdditions({
              added: options.addedMetrics || [],
              type: resources[0]!.type,
            }),
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
    // What earlier reads could not read of each resource, and the batches Azure refused.
    const statuses: Record<string, CloudResourceMetricStatus> =
      readAzureMetricStatuses(state.azureMetricStatus);
    const batchesOff: Record<string, string> = readAzureMetricBatchesOff({
      kept: state.azureMetricBatchesOff,
      now,
    });

    /*
     * Each resource's selection: its own when an earlier read found it
     * publishes fewer metrics than its type's, else the type's - with its
     * own additions, which its definitions listed when they were added.
     */
    const selections: Array<{
      selected: Array<SelectedMetric>;
      isOwn: boolean;
    }> = reading.map(
      (
        entry: AzureResourceToRead,
      ): { selected: Array<SelectedMetric>; isOwn: boolean } => {
        const added: Array<CloudAddedMetric> = getAzureAdditionsOfResource({
          added: options.addedMetrics || [],
          armId: entry.armId,
          type: entry.type,
        });
        const own: Array<SelectedMetric> | null = this.readCachedSelection({
          cached: resourceDefinitionsCache[entry.armId.toLowerCase()],
          fingerprint: getAzureKeyMetricsFingerprint(
            getAzureKeyMetrics(entry.type)!,
            added,
          ),
          now,
        });

        return {
          selected: applyAzureSplits(
            own ||
              withAzureResourceAdditions(
                selectedByType.get(entry.type.toLowerCase()) || [],
                getAzureResourceAdditions({
                  added: options.addedMetrics || [],
                  armId: entry.armId,
                  type: entry.type,
                }),
              ),
            added,
          ),
          isOwn: Boolean(own),
        };
      },
    );
    const requestOf: (
      entry: AzureResourceToRead,
      selected: Array<SelectedMetric>,
    ) => AzureMetricRequest<SelectedMetric> = (
      entry: AzureResourceToRead,
      selected: Array<SelectedMetric>,
    ): AzureMetricRequest<SelectedMetric> => {
      return buildAzureMetricRequest({
        entry,
        selected,
        readGroups,
        status: statuses[entry.armId.toLowerCase()],
        now,
      });
    };
    const reader: AzureMetricReader = new AzureMetricReader({
      arm,
      budget,
      sleep: options.sleep,
      random: options.random,
      canBatch: (place: AzureMetricPlace): boolean => {
        return !isAzureMetricBatchOff({ batchesOff, place });
      },
    });
    const firstRead: AzureMetricReadResult<SelectedMetric> = await reader.read(
      reading.map(
        (
          entry: AzureResourceToRead,
          index: number,
        ): AzureMetricRequest<SelectedMetric> => {
          return requestOf(entry, selections[index]!.selected);
        },
      ),
    );
    const reads: Array<AzureResourceMetricsRead> = reading.map(
      (
        _entry: AzureResourceToRead,
        index: number,
      ): AzureResourceMetricsRead => {
        return {
          read: firstRead.reads[index]!,
          selected: selections[index]!.selected,
        };
      },
    );
    const groupsRead: Set<string> = new Set<string>(firstRead.groupsRead);

    /*
     * A resource Azure refused its type's selection for publishes fewer
     * metrics: it is read again, a resource at a time, with its own
     * definitions - kept a day (getResourceSelection). What the first read
     * brought of it is dropped: the second reads all of it.
     */
    const refused: Array<number> = [];

    reads.forEach((item: AzureResourceMetricsRead, index: number) => {
      if (item.read.refusal !== undefined && !selections[index]!.isOwn) {
        refused.push(index);
      }
    });

    const reselected: Array<Settled<Array<SelectedMetric>>> =
      await mapWithConcurrency(
        refused,
        CONCURRENCY,
        async (index: number): Promise<Array<SelectedMetric>> => {
          const entry: AzureResourceToRead = reading[index]!;
          const added: Array<CloudAddedMetric> = getAzureAdditionsOfResource({
            added: options.addedMetrics || [],
            armId: entry.armId,
            type: entry.type,
          });

          return applyAzureSplits(
            await this.getResourceSelection({
              arm,
              entry,
              keyMetrics: getAzureKeyMetrics(entry.type)!,
              cache: resourceDefinitionsCache,
              now,
              added,
            }),
            added,
          );
        },
      );
    const again: Array<{ index: number; selected: Array<SelectedMetric> }> = [];

    reselected.forEach(
      (outcome: Settled<Array<SelectedMetric>>, position: number) => {
        const index: number = refused[position]!;

        if (outcome.ok) {
          again.push({ index, selected: outcome.value });
          return;
        }

        if (
          outcome.error instanceof LlmProviderError &&
          outcome.error.kind === CloudConnectionFailureKind.Authentication
        ) {
          throw outcome.error;
        }

        // Its own definitions could not be read: it is not read this time.
        const isCutShort: boolean =
          outcome.error instanceof CloudReadBudgetSpent;

        reads[index] = {
          selected: reads[index]!.selected,
          read: {
            place: reads[index]!.read.place,
            series: [],
            read: [],
            notRead: [],
            capped: [],
            answeredCalls: 0,
            isCutShort,
            ...(isCutShort ? {} : { failure: outcome.error }),
          },
        };
      },
    );

    if (again.length > 0) {
      const secondRead: AzureMetricReadResult<SelectedMetric> =
        await reader.read(
          again.map(
            (item: {
              index: number;
              selected: Array<SelectedMetric>;
            }): AzureMetricRequest<SelectedMetric> => {
              return requestOf(reading[item.index]!, item.selected);
            },
          ),
          { batch: false },
        );

      again.forEach(
        (
          item: { index: number; selected: Array<SelectedMetric> },
          position: number,
        ) => {
          reads[item.index] = {
            read: secondRead.reads[position]!,
            selected: item.selected,
          };
        },
      );

      for (const key of secondRead.groupsRead) {
        groupsRead.add(key);
      }
    }

    state.azureResourceMetricDefinitions = resourceDefinitionsCache;

    const groups: Map<string, CloudMetricGroup> = new Map();
    let failedResources: number = 0;
    let firstResourceFailure: unknown = undefined;
    // "metric|kind|code" -> what Azure Monitor answered, and of how many resources.
    const metricFailures: Map<
      string,
      { notRead: AzureMetricNotRead<SelectedMetric>; resources: number }
    > = new Map();
    // Resources with more queues and topics than a read reads.
    const cappedResources: Array<string> = [];

    reads.forEach((item: AzureResourceMetricsRead, index: number) => {
      const entry: AzureResourceToRead = reading[index]!;
      const read: AzureMetricResourceRead<SelectedMetric> = item.read;
      const failure: unknown = read.failure ?? read.refusal;
      const statusKey: string = entry.armId.toLowerCase();
      const status: CloudResourceMetricStatus | null = getNextAzureMetricStatus(
        {
          previous: statuses[statusKey],
          read,
          now,
        },
      );

      if (status) {
        statuses[statusKey] = status;
      } else {
        delete statuses[statusKey];
      }

      if (read.answeredCalls === 0 && failure !== undefined) {
        failedResources++;
        firstResourceFailure = firstResourceFailure ?? failure;
        return;
      }

      for (const notRead of read.notRead) {
        const key: string = [
          notRead.metric.name.toLowerCase(),
          notRead.kind,
          notRead.code,
        ].join("|");
        const known:
          | { notRead: AzureMetricNotRead<SelectedMetric>; resources: number }
          | undefined = metricFailures.get(key);

        metricFailures.set(key, {
          notRead: known?.notRead || notRead,
          resources: (known?.resources || 0) + 1,
        });
      }

      if (read.capped.length > 0) {
        cappedResources.push(entry.name);
      }

      for (const series of read.series) {
        const selected: SelectedMetric | undefined = item.selected.find(
          (metric: SelectedMetric): boolean => {
            return (
              metric.name.toLowerCase() === series.metricName.toLowerCase()
            );
          },
        );

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
          metric = {
            name,
            unit: selected.unit || series.unit,
            datapointSets: [],
          };
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
    });

    state.azureMetricStatus = pruneAzureMetricStatuses({ statuses, now });

    if (failedResources > 0) {
      warnings.push(
        `Could not read the metrics of ${failedResources} ${
          failedResources === 1 ? "resource" : "resources"
        } this time: ${describeAzureMetricReadFailure(firstResourceFailure)}`,
      );
    }

    for (const { notRead, resources } of metricFailures.values()) {
      warnings.push(describeAzureMetricNotRead({ notRead, resources, now }));
    }

    warnings.push(
      ...rememberAzureMetricBatchRefusals({
        batchesOff,
        refusals: firstRead.batchRefusals,
        signInFailure: firstRead.batchSignInFailure,
        now,
      }),
    );
    state.azureMetricBatchesOff = batchesOff;

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
     * A grain's window moves on once a call of it was answered: a resource
     * that failed misses that stretch rather than every other one being
     * written twice.
     */
    for (const key of groupsRead) {
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
