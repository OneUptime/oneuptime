import ProductKey, { PRODUCT_KEYS } from "./ProductKey";

/*
 * EVERY PRODUCT'S NAME AND CATEGORY, IN ENGLISH, WITHOUT REACT (#6815).
 *
 * The Dashboard's products menu (Utils/NavigationItems) names each product
 * through its own locale, under navbar.items.*Title, and groups them under
 * navbar.categories.*. The server and the Admin Dashboard need the same
 * names where there is no Dashboard locale: a refusal the API sends ("Status
 * Pages is switched off on this server"), Ask AI's words, and Admin
 * Dashboard > Settings > Products, which lists every product a server can
 * switch off. These are the menu's English words (Tests/Types/Product/
 * ProductCatalog pins them to the Dashboard's en.json), so a product has
 * one name wherever it is read - in the names #6817 decided: On-Call (not
 * On-Call Duty), Profiles, AI Insights and Ask AI, ahead of the menu while
 * #6817 renames it.
 *
 * Pure: the server, the Admin Dashboard and their tests read it.
 */

export const PRODUCT_TITLES: Readonly<Record<ProductKey, string>> = {
  [ProductKey.Monitors]: "Monitors",
  [ProductKey.Incidents]: "Incidents",
  [ProductKey.Alerts]: "Alerts",
  [ProductKey.OnCall]: "On-Call",
  [ProductKey.StatusPages]: "Status Pages",
  [ProductKey.ScheduledMaintenance]: "Scheduled Maintenance",
  [ProductKey.Slos]: "SLOs",
  [ProductKey.Logs]: "Logs",
  [ProductKey.Metrics]: "Metrics",
  [ProductKey.Traces]: "Traces",
  [ProductKey.Profiles]: "Profiles",
  [ProductKey.Exceptions]: "Exceptions",
  [ProductKey.Llm]: "AI / LLM",
  [ProductKey.DataObservability]: "Data Observability",
  [ProductKey.Topology]: "Topology",
  [ProductKey.SecurityEvents]: "Security Events",
  [ProductKey.DataSecurity]: "Data Security",
  [ProductKey.AIChat]: "Ask AI",
  [ProductKey.AIInsights]: "AI Insights",
  [ProductKey.Code]: "Code",
  [ProductKey.Inventory]: "Inventory",
  [ProductKey.Services]: "Services",
  [ProductKey.Databases]: "Databases",
  [ProductKey.Queues]: "Queues",
  [ProductKey.Rum]: "Real User Monitoring",
  [ProductKey.Hosts]: "Hosts",
  [ProductKey.Kubernetes]: "Kubernetes",
  [ProductKey.Docker]: "Docker",
  [ProductKey.DockerSwarm]: "Docker Swarm",
  [ProductKey.Podman]: "Podman",
  [ProductKey.Proxmox]: "Proxmox",
  [ProductKey.OpenStack]: "OpenStack",
  [ProductKey.VMware]: "VMware",
  [ProductKey.Ceph]: "Ceph",
  [ProductKey.StorageArrays]: "Storage Arrays",
  [ProductKey.Network]: "Network",
  [ProductKey.IoT]: "IoT",
  [ProductKey.Cloud]: "Cloud",
  [ProductKey.AppPlatforms]: "App Platforms",
  [ProductKey.Serverless]: "Serverless",
  [ProductKey.Dashboards]: "Dashboards",
  [ProductKey.Workflows]: "Workflows",
  [ProductKey.Runbooks]: "Runbooks",
  [ProductKey.Forms]: "Forms",
  [ProductKey.Users]: "Users",
  [ProductKey.Teams]: "Teams",
  [ProductKey.ProjectSettings]: "Project Settings",
};

export interface ProductCategory {
  // The menu's English title of the category.
  title: string;
  // Its products, in the menu's order.
  products: ReadonlyArray<ProductKey>;
}

// The menu's categories, in its order, each with its products.
export const PRODUCT_CATEGORIES: ReadonlyArray<ProductCategory> = [
  {
    title: "Essentials",
    products: [
      ProductKey.Monitors,
      ProductKey.Incidents,
      ProductKey.Alerts,
      ProductKey.OnCall,
      ProductKey.StatusPages,
      ProductKey.ScheduledMaintenance,
      ProductKey.Slos,
    ],
  },
  {
    title: "Observability",
    products: [
      ProductKey.Logs,
      ProductKey.Metrics,
      ProductKey.Traces,
      ProductKey.Profiles,
      ProductKey.Exceptions,
      ProductKey.Llm,
      ProductKey.DataObservability,
      ProductKey.Topology,
    ],
  },
  {
    title: "Security",
    products: [ProductKey.SecurityEvents, ProductKey.DataSecurity],
  },
  {
    title: "AI",
    products: [ProductKey.AIChat, ProductKey.AIInsights],
  },
  {
    title: "Code",
    products: [ProductKey.Code],
  },
  {
    title: "Resources",
    products: [
      ProductKey.Inventory,
      ProductKey.Services,
      ProductKey.Databases,
      ProductKey.Queues,
      ProductKey.Rum,
    ],
  },
  {
    title: "Infrastructure",
    products: [
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
    ],
  },
  {
    title: "Cloud",
    products: [
      ProductKey.Cloud,
      ProductKey.AppPlatforms,
      ProductKey.Serverless,
    ],
  },
  {
    title: "Dashboards & Automation",
    products: [
      ProductKey.Dashboards,
      ProductKey.Workflows,
      ProductKey.Runbooks,
      ProductKey.Forms,
    ],
  },
  {
    title: "Settings",
    products: [ProductKey.Users, ProductKey.Teams, ProductKey.ProjectSettings],
  },
];

// A product's English name, as the products menu says it.
export const getProductTitle: (product: ProductKey) => string = (
  product: ProductKey,
): string => {
  return PRODUCT_TITLES[product];
};

// Every product, once, in the menu's order: the categories cover them all.
export const CATALOG_PRODUCT_KEYS: ReadonlyArray<ProductKey> =
  PRODUCT_CATEGORIES.flatMap((category: ProductCategory) => {
    return [...category.products];
  });

// Whether the catalog lists every product once (its tests ask).
export const isCatalogComplete: () => boolean = (): boolean => {
  return (
    CATALOG_PRODUCT_KEYS.length === PRODUCT_KEYS.length &&
    PRODUCT_KEYS.every((product: ProductKey, index: number): boolean => {
      return CATALOG_PRODUCT_KEYS[index] === product;
    })
  );
};
