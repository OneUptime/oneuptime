import Route from "Common/Types/API/Route";
import { translationKey } from "Common/UI/Utils/TranslateTemplate";
import PageMap from "../../Utils/PageMap";
import { ResourceShowcase } from "../ResourceShowcase/ResourceShowcase";

/*
 * HOW EVERY PRODUCT EXPLAINS ITSELF.
 *
 * A product's first page says what the product does while the project has
 * nothing in it yet, the way an empty resource list does (ResourceShowcase):
 * a pitch, the steps to a first result with the first one as the button,
 * a drawn example of what the page shows once it is in use, and a link to
 * the product's documentation. Once there is something in it, the same
 * explanation is one click away: "About" beside the page's title
 * (ProductAboutButton) opens it in a dialog.
 *
 *   ┌ eyebrow · title · description      ┐ ┌ example: the page in use  ┐
 *   │ 1 first step  2 next  3 result     │ │ stats, a chart, rows      │
 *   └ [ first step ]  Documentation      ┘ └ (and what it raised)      ┘
 *
 * Every product of the products menu (Utils/NavigationItems) has an entry
 * here, keyed by the page the menu opens; a test holds the two lists
 * together. The resources keep the showcases they had (a Kubernetes
 * cluster's, a host's), and the other products describe theirs in
 * ./Showcases. Which page draws what:
 *
 *   - a list (Monitors, Incidents, Status Pages ...): its empty table, and
 *     the showcase under it with the list's own Create button
 *     (ProductShowcase), until the first record;
 *   - telemetry (Logs, Traces, Metrics, Exceptions, Profiles): the showcase
 *     over the explorer until the project's first telemetry arrives, its
 *     button the setup guide that waits for that data
 *     (TelemetryFirstRunShowcase);
 *   - a product with get-started steps of its own (Network, Security
 *     Events, Data Security, Code, AI / LLM): the showcase under those
 *     steps, as the explanation, without steps or a button of its own.
 *
 * React-free, so App's tests read every product's words.
 */

export enum ProductKey {
  Monitors = "monitors",
  Incidents = "incidents",
  Alerts = "alerts",
  OnCall = "on-call",
  StatusPages = "status-pages",
  ScheduledMaintenance = "scheduled-maintenance",
  Slos = "slos",
  Logs = "logs",
  Metrics = "metrics",
  Traces = "traces",
  Profiles = "profiles",
  Exceptions = "exceptions",
  Llm = "llm",
  DataObservability = "data-observability",
  Topology = "topology",
  SecurityEvents = "security-events",
  DataSecurity = "data-security",
  AIInsights = "ai-insights",
  Code = "code",
  Inventory = "inventory",
  Services = "services",
  Databases = "databases",
  Queues = "queues",
  Rum = "rum",
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
  Cloud = "cloud",
  AppPlatforms = "app-platforms",
  Serverless = "serverless",
  Dashboards = "dashboards",
  Workflows = "workflows",
  Runbooks = "runbooks",
  Forms = "forms",
}

export interface ProductOnboarding {
  // The page the products menu opens for the product.
  page: PageMap;
  /*
   * English translation key: the product's name, as the About dialog's
   * title says it ("Monitors").
   */
  name: string;
  showcase: ResourceShowcase;
  // The product's documentation: a page of the docs (/docs/...).
  docsRoute: Route;
}

/*
 * The products menu entries with no first page of their own to explain:
 * each opens something that is not a product page.
 */
export const PRODUCTS_WITHOUT_ONBOARDING: Record<string, string> = {
  [PageMap.HOME]: "The project's home page, not a product.",
  [PageMap.AI_COPILOT]:
    "Opens the Ask AI panel over the current page; it has no page of its own.",
  [PageMap.USERS]: "Project settings: who is in the project.",
  [PageMap.TEAMS]: "Project settings: the project's teams.",
  [PageMap.SETTINGS]: "Project settings.",
  [PageMap.USER_SETTINGS]: "Your own settings: notifications, profile and more.",
};

// What a screen reader hears for a product's example.
export const PRODUCT_EXAMPLE_DESCRIPTION: string = translationKey(
  "An example of what this page shows once it is in use.",
);

// The About button beside a product page's title, and its dialog.
export const PRODUCT_ABOUT_TEXT: string = translationKey("About");
