import ProductKey, { PRODUCT_KEYS } from "./ProductKey";
import ActivationMilestone from "../Analytics/ActivationMilestone";

/*
 * WHAT A PROJECT USES (#6814).
 *
 * The products menu knows which products have something in them: those
 * come first in their category, and one you set up that has nothing in it
 * yet carries a quiet "Not set up". One request answers it for the whole
 * catalog (GET /project-products), and the server keeps the answer for a
 * few minutes per project, or until a product's first record or first data
 * changes it (ProjectProductsService, ProjectUsageCache).
 *
 * A product has something in it when:
 *
 *   - its records exist (a monitor, a status page, a host, a dashboard -
 *     archived ones too), for the products in PRODUCTS_USED_BY_RECORDS;
 *     a few count only the records their first page counts (#7325): the
 *     inventory's items, App Platforms' environments, the databases and
 *     buckets Data Observability watches, the data stores Data Security
 *     scans - none archived - and the sources Security Events reads, on;
 *   - its first data arrived, by the project's activation milestones
 *     (#6830), for the telemetry products in PRODUCT_USAGE_MILESTONES - and
 *     AI / LLM, once its first AI call arrived.
 *
 * The others - Chat and Settings - are not answered: there is nothing to
 * set up in them, and no mark is better than a wrong one.
 *
 * Pure: the server, the Dashboard and their tests read it.
 */

export enum ProductUsage {
  // Something is in it: records, or data that arrived.
  InUse = "in_use",
  // Nothing in it yet, and it is something you set up ("Not set up").
  NotSetUp = "not_set_up",
  /*
   * Nothing in it yet, and nothing to set up: no incidents is good news,
   * not a step left undone. No mark.
   */
  NothingYet = "nothing_yet",
}

export const isProductUsage: (value: unknown) => value is ProductUsage = (
  value: unknown,
): value is ProductUsage => {
  return (
    value === ProductUsage.InUse ||
    value === ProductUsage.NotSetUp ||
    value === ProductUsage.NothingYet
  );
};

// The telemetry products, in use once their first data arrived.
export const PRODUCT_USAGE_MILESTONES: Readonly<
  Partial<Record<ProductKey, ReadonlyArray<ActivationMilestone>>>
> = {
  [ProductKey.Logs]: [ActivationMilestone.FirstLogsReceived],
  [ProductKey.Metrics]: [ActivationMilestone.FirstMetricsReceived],
  [ProductKey.Traces]: [ActivationMilestone.FirstTracesReceived],
  [ProductKey.Profiles]: [ActivationMilestone.FirstProfilesReceived],
  [ProductKey.Exceptions]: [ActivationMilestone.FirstExceptionsReceived],
  // The map of services is drawn from their traces.
  [ProductKey.Topology]: [ActivationMilestone.FirstTracesReceived],
  // Conversations lists the AI calls apps and AI tools send.
  [ProductKey.Llm]: [ActivationMilestone.FirstLlmCallsReceived],
};

/*
 * The products in use once one of their records exists. The server says
 * which record each one counts (ProjectProductsService), the one its own
 * first page counts to show its first-run explanation.
 */
export const PRODUCTS_USED_BY_RECORDS: ReadonlyArray<ProductKey> = [
  ProductKey.Monitors,
  ProductKey.Incidents,
  ProductKey.Alerts,
  ProductKey.OnCall,
  ProductKey.StatusPages,
  ProductKey.ScheduledMaintenance,
  ProductKey.Slos,
  ProductKey.AIInsights,
  ProductKey.Code,
  ProductKey.Services,
  ProductKey.Databases,
  ProductKey.Queues,
  ProductKey.Rum,
  ProductKey.Hosts,
  ProductKey.Kubernetes,
  ProductKey.Docker,
  ProductKey.DockerSwarm,
  ProductKey.Podman,
  ProductKey.Proxmox,
  ProductKey.OpenStack,
  ProductKey.VMware,
  ProductKey.Ceph,
  ProductKey.StorageArrays,
  ProductKey.Network,
  ProductKey.IoT,
  ProductKey.Cloud,
  ProductKey.Serverless,
  ProductKey.Dashboards,
  ProductKey.Workflows,
  ProductKey.Runbooks,
  ProductKey.Forms,
  // Counted by some of their records only (ProjectProductsService).
  ProductKey.DataObservability,
  ProductKey.SecurityEvents,
  ProductKey.DataSecurity,
  ProductKey.Inventory,
  ProductKey.AppPlatforms,
];

/*
 * The tables beside the products' main records (ProductOfTable) whose
 * records a product counts to say it is in use (#7325) - the records its
 * first page counts. A first one created, or the last one deleted, changes
 * what the project uses (ProjectUsageCache). ProjectProductsService holds
 * the exact rule of each, which a test holds this to.
 */
export const PRODUCT_USAGE_TABLES: Readonly<
  Record<string, ReadonlyArray<ProductKey>>
> = {
  InventoryItem: [ProductKey.Inventory],
  CloudResource: [ProductKey.AppPlatforms],
  DataStore: [ProductKey.DataObservability, ProductKey.DataSecurity],
  SecurityEventConnection: [ProductKey.SecurityEvents],
  SecurityLogSource: [ProductKey.SecurityEvents],
  SecurityTelemetrySource: [ProductKey.SecurityEvents],
};

// The products a table's records count for, beside its main record's.
export const getProductsCountingTable: (
  tableName: string | null | undefined,
) => ReadonlyArray<ProductKey> = (
  tableName: string | null | undefined,
): ReadonlyArray<ProductKey> => {
  if (
    !tableName ||
    !Object.prototype.hasOwnProperty.call(PRODUCT_USAGE_TABLES, tableName)
  ) {
    return [];
  }

  return PRODUCT_USAGE_TABLES[tableName] || [];
};

/*
 * The products with nothing to set up, where having nothing is no step left
 * undone: what happens to a project (incidents, alerts, maintenance windows)
 * or what OneUptime AI finds by itself (insights).
 */
export const PRODUCTS_WITHOUT_SET_UP: ReadonlyArray<ProductKey> = [
  ProductKey.Incidents,
  ProductKey.Alerts,
  ProductKey.ScheduledMaintenance,
  ProductKey.AIInsights,
];

// Every product the answer covers, in the menu's order.
export const PRODUCTS_WITH_KNOWN_USAGE: ReadonlyArray<ProductKey> =
  PRODUCT_KEYS.filter((product: ProductKey): boolean => {
    return (
      PRODUCTS_USED_BY_RECORDS.includes(product) ||
      PRODUCT_USAGE_MILESTONES[product] !== undefined
    );
  });

// What a product's answer is, once it is known whether it has anything.
export const toProductUsage: (data: {
  product: ProductKey;
  hasSomething: boolean;
}) => ProductUsage = (data: {
  product: ProductKey;
  hasSomething: boolean;
}): ProductUsage => {
  if (data.hasSomething) {
    return ProductUsage.InUse;
  }

  return PRODUCTS_WITHOUT_SET_UP.includes(data.product)
    ? ProductUsage.NothingYet
    : ProductUsage.NotSetUp;
};

// Whether the telemetry product's first data arrived, by the milestones.
export const isUsedByMilestones: (data: {
  product: ProductKey;
  reached: ReadonlyArray<ActivationMilestone> | Set<ActivationMilestone>;
}) => boolean | null = (data: {
  product: ProductKey;
  reached: ReadonlyArray<ActivationMilestone> | Set<ActivationMilestone>;
}): boolean | null => {
  const milestones: ReadonlyArray<ActivationMilestone> | undefined =
    PRODUCT_USAGE_MILESTONES[data.product];

  if (!milestones) {
    return null;
  }

  const reached: Set<ActivationMilestone> =
    data.reached instanceof Set ? data.reached : new Set(data.reached);

  return milestones.some((milestone: ActivationMilestone): boolean => {
    return reached.has(milestone);
  });
};

// The products the answer says are in use, in the menu's order.
export const getProductsInUse: (
  usage: Readonly<Partial<Record<ProductKey, ProductUsage>>>,
) => Array<ProductKey> = (
  usage: Readonly<Partial<Record<ProductKey, ProductUsage>>>,
): Array<ProductKey> => {
  return PRODUCT_KEYS.filter((product: ProductKey): boolean => {
    return usage[product] === ProductUsage.InUse;
  });
};
