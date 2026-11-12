import PageMap from "../PageMap";
import RouteMap from "../RouteMap";
import Route from "Common/Types/API/Route";
import ProductKey from "Common/Types/Product/ProductKey";
import {
  ServerProductOffReason,
  ServerProductsOff,
} from "Common/Types/Product/ServerProducts";

/*
 * WHICH PRODUCT A DASHBOARD ADDRESS BELONGS TO (#6815).
 *
 * A product switched off on the server is gone from every menu, but an
 * address of it can still be opened: a bookmark, a link in an old email or
 * chat message, a page found in the browser's history. The Dashboard then
 * shows one page that says the product is switched off on this server and
 * who can switch it on (Components/ServerProducts/ServerProductOffPage),
 * instead of a broken or empty one - and Search leaves the product's pages
 * out.
 *
 * Every product's pages live under its own root (RouteMap's *_ROOT
 * entries): /dashboard/<project>/logs/..., /dashboard/<project>/ai/chat/...
 * A guided setup that makes records of a second product needs that one on
 * too: "Know when my website is down" pages the person through On-Call
 * Duty. Tests/Dashboard/ProductOfRouteCoverage holds every root of RouteMap
 * to a product here or to NOT_A_PRODUCT_ROOTS.
 */

// Each product's roots: its pages are these addresses and everything under them.
export const PRODUCT_ROOT_PAGES: Readonly<
  Partial<Record<ProductKey, ReadonlyArray<PageMap>>>
> = {
  [ProductKey.Monitors]: [PageMap.MONITORS_ROOT, PageMap.MONITOR_GROUPS_ROOT],
  [ProductKey.Incidents]: [PageMap.INCIDENTS_ROOT],
  [ProductKey.Alerts]: [PageMap.ALERTS_ROOT],
  [ProductKey.OnCall]: [PageMap.ON_CALL_DUTY_ROOT],
  [ProductKey.StatusPages]: [PageMap.STATUS_PAGES_ROOT],
  [ProductKey.ScheduledMaintenance]: [
    PageMap.SCHEDULED_MAINTENANCE_EVENTS_ROOT,
  ],
  [ProductKey.Slos]: [PageMap.SLOS_ROOT],
  [ProductKey.Logs]: [PageMap.LOGS_ROOT],
  [ProductKey.Metrics]: [PageMap.METRICS_ROOT],
  [ProductKey.Traces]: [PageMap.TRACES_ROOT],
  [ProductKey.Profiles]: [PageMap.PROFILES_ROOT],
  [ProductKey.Exceptions]: [PageMap.EXCEPTIONS_ROOT],
  [ProductKey.Llm]: [PageMap.LLM_ROOT],
  [ProductKey.DataObservability]: [PageMap.DATA_OBSERVABILITY_ROOT],
  [ProductKey.Topology]: [PageMap.TOPOLOGY_ROOT],
  [ProductKey.SecurityEvents]: [PageMap.SECURITY_EVENTS_ROOT],
  [ProductKey.DataSecurity]: [PageMap.DATA_SECURITY_ROOT],
  [ProductKey.AIChat]: [PageMap.AI_COPILOT],
  [ProductKey.AIInsights]: [PageMap.AI_INSIGHTS_ROOT],
  [ProductKey.Code]: [
    PageMap.CODE_ROOT,
    PageMap.MOVED_CODE_REPOSITORY_ROOT,
    PageMap.MOVED_AI_AGENT_TASKS_ROOT,
  ],
  [ProductKey.Inventory]: [PageMap.INVENTORY_ROOT],
  [ProductKey.Services]: [PageMap.SERVICE_ROOT],
  [ProductKey.Databases]: [PageMap.DATABASE_ROOT],
  [ProductKey.Queues]: [PageMap.MESSAGE_QUEUE_ROOT],
  [ProductKey.Rum]: [PageMap.RUM_ROOT],
  [ProductKey.Hosts]: [PageMap.HOST_ROOT],
  [ProductKey.Kubernetes]: [PageMap.KUBERNETES_ROOT],
  [ProductKey.Docker]: [PageMap.DOCKER_ROOT],
  [ProductKey.DockerSwarm]: [PageMap.DOCKER_SWARM_ROOT],
  [ProductKey.Podman]: [PageMap.PODMAN_ROOT],
  [ProductKey.Proxmox]: [PageMap.PROXMOX_ROOT],
  [ProductKey.OpenStack]: [PageMap.OPENSTACK_ROOT],
  [ProductKey.VMware]: [PageMap.VMWARE_ROOT],
  [ProductKey.Ceph]: [PageMap.CEPH_ROOT],
  [ProductKey.StorageArrays]: [PageMap.STORAGE_ARRAYS_ROOT],
  [ProductKey.Network]: [
    PageMap.NETWORK_DEVICE_ROOT,
    PageMap.NETWORK_SITE_ROOT,
  ],
  [ProductKey.IoT]: [PageMap.IOT_ROOT],
  [ProductKey.Cloud]: [PageMap.CLOUD_ROOT],
  [ProductKey.AppPlatforms]: [PageMap.APP_PLATFORMS_ROOT],
  [ProductKey.Serverless]: [PageMap.SERVERLESS_ROOT],
  [ProductKey.Dashboards]: [PageMap.DASHBOARDS_ROOT],
  [ProductKey.Workflows]: [PageMap.WORKFLOWS_ROOT],
  [ProductKey.Runbooks]: [PageMap.RUNBOOKS_ROOT],
  [ProductKey.Forms]: [PageMap.FORMS_ROOT],
};

/*
 * The roots of RouteMap that are no product's: the project's own pages
 * (Home, Settings, Users, Teams, User Settings), and Home's old lists,
 * forwarded to the products' lists, which are gated there.
 */
export const NOT_A_PRODUCT_ROOTS: ReadonlyArray<PageMap> = [
  PageMap.SETTINGS_ROOT,
  PageMap.USERS_ROOT,
  PageMap.TEAMS_ROOT,
  PageMap.USER_SETTINGS_ROOT,
  PageMap.MOVED_HOME_LISTS_ROOT,
  // A second root of a product above, under the same address.
  PageMap.EXCEPTIONS_VIEW_ROOT,
  PageMap.INVENTORY_VIEW_ROOT,
];

/*
 * The guided setups that make records of more than their own product, and
 * every product they need on. "Know when my website is down" creates a
 * monitor and the on-call policy that pages the person; "Send logs, metrics
 * and traces" ends in an alert on them, so it needs their products - and
 * telemetry ingestion.
 */
export const GUIDED_SETUP_PRODUCTS: Readonly<
  Partial<Record<PageMap, ReadonlyArray<ProductKey>>>
> = {
  [PageMap.MONITOR_GUIDED_SETUP]: [ProductKey.Monitors, ProductKey.OnCall],
  [PageMap.ON_CALL_DUTY_GUIDED_SETUP]: [ProductKey.OnCall],
  [PageMap.STATUS_PAGES_GUIDED_SETUP]: [ProductKey.StatusPages],
  [PageMap.SERVICES_GUIDED_SETUP]: [
    ProductKey.Services,
    ProductKey.Logs,
    ProductKey.Metrics,
    ProductKey.Traces,
  ],
};

// A route's path under its project: "logs" for /dashboard/:projectId/logs/*.
export const getPathUnderProject: (template: string) => string | null = (
  template: string,
): string | null => {
  const match: RegExpMatchArray | null = template.match(
    /^\/dashboard\/:projectId\/(.*)$/,
  );

  if (!match) {
    return null;
  }

  const path: string = (match[1] || "")
    .replace(/\/\*$/, "")
    .replace(/\/+$/, "");

  return path.length > 0 ? path : null;
};

interface ProductPath {
  path: string;
  product: ProductKey;
}

let productPaths: Array<ProductPath> | null = null;

// Every product's paths under a project, the longest first.
export const getProductPaths: () => Array<ProductPath> =
  (): Array<ProductPath> => {
    if (productPaths) {
      return productPaths;
    }

    const paths: Array<ProductPath> = [];

    for (const [product, pages] of Object.entries(PRODUCT_ROOT_PAGES) as Array<
      [ProductKey, ReadonlyArray<PageMap>]
    >) {
      for (const page of pages) {
        const route: Route | undefined = RouteMap[page];
        const path: string | null = route
          ? getPathUnderProject(route.toString())
          : null;

        if (path) {
          paths.push({ path: path, product: product });
        }
      }
    }

    productPaths = paths.sort((a: ProductPath, b: ProductPath): number => {
      return b.path.length - a.path.length;
    });

    return productPaths;
  };

// The address of a page under its project, or null outside a project.
const getAddressUnderProject: (pathname: string) => string | null = (
  pathname: string,
): string | null => {
  const match: RegExpMatchArray | null = (pathname || "").match(
    /^\/dashboard\/[^/]+\/(.*)$/,
  );

  if (!match) {
    return null;
  }

  return (match[1] || "").replace(/\/+$/, "");
};

// The product an address of the Dashboard belongs to, or null for none.
export const getProductOfPath: (pathname: string) => ProductKey | null = (
  pathname: string,
): ProductKey | null => {
  const address: string | null = getAddressUnderProject(pathname);

  if (address === null) {
    return null;
  }

  for (const productPath of getProductPaths()) {
    if (
      address === productPath.path ||
      address.startsWith(`${productPath.path}/`)
    ) {
      return productPath.product;
    }
  }

  return null;
};

// The product a page of RouteMap belongs to, or null for none.
export const getProductOfPage: (page: PageMap) => ProductKey | null = (
  page: PageMap,
): ProductKey | null => {
  const route: Route | undefined = RouteMap[page];

  return route ? getProductOfPath(route.toString()) : null;
};

// The guided setup an address opens, if it opens one.
const getGuidedSetupOfPath: (pathname: string) => PageMap | null = (
  pathname: string,
): PageMap | null => {
  const address: string | null = getAddressUnderProject(pathname);

  if (address === null) {
    return null;
  }

  for (const page of Object.keys(GUIDED_SETUP_PRODUCTS) as Array<PageMap>) {
    const route: Route | undefined = RouteMap[page];
    const path: string | null = route
      ? getPathUnderProject(route.toString())
      : null;

    if (path && address === path) {
      return page;
    }
  }

  return null;
};

// Every product an address needs on: its own, and a guided setup's others.
export const getProductsOfPath: (pathname: string) => Array<ProductKey> = (
  pathname: string,
): Array<ProductKey> => {
  const products: Array<ProductKey> = [];
  const own: ProductKey | null = getProductOfPath(pathname);

  if (own) {
    products.push(own);
  }

  const setup: PageMap | null = getGuidedSetupOfPath(pathname);

  for (const product of setup ? GUIDED_SETUP_PRODUCTS[setup] || [] : []) {
    if (!products.includes(product)) {
      products.push(product);
    }
  }

  return products;
};

export interface OffProductOfPath {
  product: ProductKey;
  reason: ServerProductOffReason;
  // The address's own product, when the one that is off is another it needs.
  pageProduct: ProductKey | null;
}

/*
 * The product switched off on the server that an address needs, with why -
 * its own first - or null when it needs none that is off.
 */
export const getOffProductOfPath: (data: {
  pathname: string;
  offOnServer: ServerProductsOff;
}) => OffProductOfPath | null = (data: {
  pathname: string;
  offOnServer: ServerProductsOff;
}): OffProductOfPath | null => {
  const products: Array<ProductKey> = getProductsOfPath(data.pathname);
  const pageProduct: ProductKey | null = getProductOfPath(data.pathname);

  for (const product of products) {
    const reason: ServerProductOffReason | undefined =
      data.offOnServer[product];

    if (reason) {
      return {
        product: product,
        reason: reason,
        pageProduct: pageProduct === product ? null : pageProduct,
      };
    }
  }

  return null;
};
