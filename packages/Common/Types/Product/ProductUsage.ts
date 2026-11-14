import ProductKey, { PRODUCT_KEYS } from "./ProductKey";
import ActivationMilestone from "../Analytics/ActivationMilestone";

/*
 * WHAT A PROJECT USES (#6814).
 *
 * The products menu knows which products have something in them: those
 * come first in their category, and one you set up that has nothing in it
 * yet carries a quiet "Not set up". One request answers it for the whole
 * catalog (GET /project-products), and the server keeps the answer for a
 * few minutes per project (ProjectProductsService).
 *
 * A product has something in it when:
 *
 *   - its records exist (a monitor, a status page, a host, a dashboard -
 *     archived ones too), for the products in PRODUCTS_USED_BY_RECORDS;
 *   - its first data arrived, by the project's activation milestones
 *     (#6830), for the telemetry products in PRODUCT_USAGE_MILESTONES.
 *
 * The others - Chat, Inventory, AI / LLM, Data Observability, Security
 * Events, Data Security, App Platforms and Settings - are not answered: no
 * cheap question says whether they are in use, and no mark is better than a
 * wrong one.
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
];

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
