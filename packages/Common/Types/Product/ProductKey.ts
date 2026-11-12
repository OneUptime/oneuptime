/*
 * EVERY ENTRY OF THE PRODUCTS MENU, BY A NAME THAT NEVER CHANGES (#6814).
 *
 * The products menu (the Dashboard's Utils/NavigationItems) lists 47
 * entries: 43 products, Chat (Ask AI) and the three entries of Settings.
 * Each carries one of these values as its `key`, so the menu, Search, Home,
 * Project Settings > Products and the server name a product the same way in
 * every language - a title is translated, a key is not.
 *
 * A key is stored - in Project.productSettings (the products a project
 * hides) and UserProjectPreference.pinnedProducts (the products a person
 * pinned) - and sent to product analytics. Never rename one, and never
 * reuse one for another product. A product added to the menu gets a new
 * value here, at the end of its category in PRODUCT_KEYS.
 *
 * The first 43 are the products that explain themselves
 * (Components/ProductOnboarding, ONBOARDED_PRODUCT_KEYS): the same values
 * the "How it works" registry always used. Chat, Users, Teams and Project
 * Settings have no first page to explain.
 *
 * Pure: the server, the Dashboard and their tests read it.
 */
enum ProductKey {
  // Essentials.
  Monitors = "monitors",
  Incidents = "incidents",
  Alerts = "alerts",
  OnCall = "on-call",
  StatusPages = "status-pages",
  ScheduledMaintenance = "scheduled-maintenance",
  Slos = "slos",
  // Observability.
  Logs = "logs",
  Metrics = "metrics",
  Traces = "traces",
  Profiles = "profiles",
  Exceptions = "exceptions",
  Llm = "llm",
  DataObservability = "data-observability",
  Topology = "topology",
  // Security.
  SecurityEvents = "security-events",
  DataSecurity = "data-security",
  // AI.
  AIChat = "ai-chat",
  AIInsights = "ai-insights",
  // Code.
  Code = "code",
  // Resources.
  Inventory = "inventory",
  Services = "services",
  Databases = "databases",
  Queues = "queues",
  Rum = "rum",
  // Infrastructure.
  Hosts = "hosts",
  Kubernetes = "kubernetes",
  Docker = "docker",
  DockerSwarm = "docker-swarm",
  Podman = "podman",
  Proxmox = "proxmox",
  OpenStack = "openstack",
  VMware = "vmware",
  Ceph = "ceph",
  StorageArrays = "storage-arrays",
  Network = "network",
  IoT = "iot",
  // Cloud.
  Cloud = "cloud",
  AppPlatforms = "app-platforms",
  Serverless = "serverless",
  // Dashboards & Automation.
  Dashboards = "dashboards",
  Workflows = "workflows",
  Runbooks = "runbooks",
  Forms = "forms",
  // Settings.
  Users = "users",
  Teams = "teams",
  ProjectSettings = "project-settings",
}

export default ProductKey;

// Every key, in the order the products menu lists its entries.
export const PRODUCT_KEYS: ReadonlyArray<ProductKey> = [
  ProductKey.Monitors,
  ProductKey.Incidents,
  ProductKey.Alerts,
  ProductKey.OnCall,
  ProductKey.StatusPages,
  ProductKey.ScheduledMaintenance,
  ProductKey.Slos,
  ProductKey.Logs,
  ProductKey.Metrics,
  ProductKey.Traces,
  ProductKey.Profiles,
  ProductKey.Exceptions,
  ProductKey.Llm,
  ProductKey.DataObservability,
  ProductKey.Topology,
  ProductKey.SecurityEvents,
  ProductKey.DataSecurity,
  ProductKey.AIChat,
  ProductKey.AIInsights,
  ProductKey.Code,
  ProductKey.Inventory,
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
  ProductKey.AppPlatforms,
  ProductKey.Serverless,
  ProductKey.Dashboards,
  ProductKey.Workflows,
  ProductKey.Runbooks,
  ProductKey.Forms,
  ProductKey.Users,
  ProductKey.Teams,
  ProductKey.ProjectSettings,
];

/*
 * The menu's entries that are not products with a first page of their own
 * to explain: Chat opens the Ask AI panel, and Users, Teams and Project
 * Settings are the project's settings.
 */
export type NotOnboardedProductKey =
  | ProductKey.AIChat
  | ProductKey.Users
  | ProductKey.Teams
  | ProductKey.ProjectSettings;

// The products that explain themselves (the "How it works" registry).
export type OnboardedProductKey = Exclude<ProductKey, NotOnboardedProductKey>;

export const NOT_ONBOARDED_PRODUCT_KEYS: ReadonlyArray<NotOnboardedProductKey> =
  [
    ProductKey.AIChat,
    ProductKey.Users,
    ProductKey.Teams,
    ProductKey.ProjectSettings,
  ];

export const ONBOARDED_PRODUCT_KEYS: ReadonlyArray<OnboardedProductKey> =
  PRODUCT_KEYS.filter((key: ProductKey): key is OnboardedProductKey => {
    return !(NOT_ONBOARDED_PRODUCT_KEYS as ReadonlyArray<ProductKey>).includes(
      key,
    );
  });

export const isProductKey: (value: unknown) => value is ProductKey = (
  value: unknown,
): value is ProductKey => {
  return (
    typeof value === "string" &&
    (PRODUCT_KEYS as ReadonlyArray<string>).includes(value)
  );
};

/*
 * The products a stored or sent list names: each known key once, in the
 * order the list gives them, anything else left out. A value that is not a
 * list holds none.
 */
export const parseProductKeys: (value: unknown) => Array<ProductKey> = (
  value: unknown,
): Array<ProductKey> => {
  if (!Array.isArray(value)) {
    return [];
  }

  const keys: Array<ProductKey> = [];

  for (const item of value) {
    if (isProductKey(item) && !keys.includes(item)) {
      keys.push(item);
    }
  }

  return keys;
};

// The same keys, in the products menu's order.
export const sortProductKeys: (
  keys: ReadonlyArray<ProductKey>,
) => Array<ProductKey> = (
  keys: ReadonlyArray<ProductKey>,
): Array<ProductKey> => {
  return PRODUCT_KEYS.filter((key: ProductKey): boolean => {
    return keys.includes(key);
  });
};
