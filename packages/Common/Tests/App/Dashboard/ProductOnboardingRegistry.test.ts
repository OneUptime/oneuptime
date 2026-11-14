// UX rule: Docs/ux/README.md#a-products-first-page
import { describe, expect, test } from "@jest/globals";
import * as fs from "fs";
import * as path from "path";
import {
  OnboardedProductKey,
  PRODUCTS_WITHOUT_ONBOARDING,
  PRODUCT_ABOUT_TEXT,
  PRODUCT_EXAMPLE_DESCRIPTION,
  ProductKey,
  ProductOnboarding,
} from "../../../../App/FeatureSet/Dashboard/src/Components/ProductOnboarding/ProductOnboarding";
import { RESOURCE_SHOWCASE_DOCS_TEXT } from "../../../../App/FeatureSet/Dashboard/src/Components/ResourceShowcase/ResourceShowcaseCard";
import { PRODUCT_ONBOARDINGS } from "../../../../App/FeatureSet/Dashboard/src/Components/ProductOnboarding/ProductOnboardings";
import {
  ResourceShowcase,
  ShowcaseFeature,
  ShowcaseRow,
  ShowcaseStat,
  ShowcaseStatus,
  ShowcaseValue,
  isShowcaseFigure,
} from "../../../../App/FeatureSet/Dashboard/src/Components/ResourceShowcase/ResourceShowcase";
import {
  TELEMETRY_FIRST_RUNS,
  TELEMETRY_SETUP_DESCRIPTION,
} from "../../../../App/FeatureSet/Dashboard/src/Components/ProductOnboarding/TelemetryFirstRunShowcase";
import CEPH_CLUSTER_SHOWCASE from "../../../../App/FeatureSet/Dashboard/src/Components/Ceph/CephClusterShowcase";
import CLOUD_ENVIRONMENT_SHOWCASE from "../../../../App/FeatureSet/Dashboard/src/Components/Cloud/CloudEnvironmentShowcase";
import CLOUD_SHOWCASE from "../../../../App/FeatureSet/Dashboard/src/Components/Cloud/CloudShowcase";
import DATABASE_SHOWCASE from "../../../../App/FeatureSet/Dashboard/src/Components/DatabaseServer/DatabaseShowcase";
import DOCKER_HOST_SHOWCASE from "../../../../App/FeatureSet/Dashboard/src/Components/Docker/DockerHostShowcase";
import DOCKER_SWARM_CLUSTER_SHOWCASE from "../../../../App/FeatureSet/Dashboard/src/Components/DockerSwarm/DockerSwarmClusterShowcase";
import HOST_SHOWCASE from "../../../../App/FeatureSet/Dashboard/src/Components/Host/HostShowcase";
import IOT_FLEET_SHOWCASE from "../../../../App/FeatureSet/Dashboard/src/Components/IoT/IoTFleetShowcase";
import KUBERNETES_CLUSTER_SHOWCASE from "../../../../App/FeatureSet/Dashboard/src/Components/Kubernetes/KubernetesClusterShowcase";
import MESSAGE_QUEUE_SHOWCASE from "../../../../App/FeatureSet/Dashboard/src/Components/MessageQueue/MessageQueueShowcase";
import OPENSTACK_CLOUD_SHOWCASE from "../../../../App/FeatureSet/Dashboard/src/Components/OpenStack/OpenStackCloudShowcase";
import PODMAN_HOST_SHOWCASE from "../../../../App/FeatureSet/Dashboard/src/Components/Podman/PodmanHostShowcase";
import PROXMOX_CLUSTER_SHOWCASE from "../../../../App/FeatureSet/Dashboard/src/Components/Proxmox/ProxmoxClusterShowcase";
import RUM_APPLICATION_SHOWCASE from "../../../../App/FeatureSet/Dashboard/src/Components/Rum/RumApplicationShowcase";
import SERVERLESS_FUNCTION_SHOWCASE from "../../../../App/FeatureSet/Dashboard/src/Components/Serverless/ServerlessFunctionShowcase";
import STORAGE_ARRAY_SHOWCASE from "../../../../App/FeatureSet/Dashboard/src/Components/StorageArray/StorageArrayShowcase";
import VMWARE_VCENTER_SHOWCASE from "../../../../App/FeatureSet/Dashboard/src/Components/VMware/VMwareVCenterShowcase";

/*
 * EVERY PRODUCT EXPLAINS ITSELF (#6430).
 *
 * The products menu (Utils/NavigationItems) is the list of products, and
 * Components/ProductOnboarding the list of their explanations: what each
 * product does, its first steps, an example of it in use and its
 * documentation. This suite holds the two lists together - a product added
 * to the menu without an explanation fails here - and holds each
 * explanation to what the pages draw:
 *
 *   - every entry is complete, in words a translator can find, and links a
 *     documentation page that exists;
 *   - every product's layout draws "How it works" (ProductAboutButton)
 *     beside its title, for its own product;
 *   - every product's first page draws its explanation while it is empty
 *     (or, for a resource, the showcase it already had).
 *
 * The pages are read as text: what they render is the components' own
 * suites' business (ProductOnboarding.test.tsx).
 */

const DASHBOARD_SRC: string = path.join(
  __dirname,
  "../../../../App/FeatureSet/Dashboard/src",
);
const DOCS: string = path.join(__dirname, "../../../../App/FeatureSet/Docs");

function read(relativePath: string): string {
  return fs.readFileSync(path.join(DASHBOARD_SRC, relativePath), "utf8");
}

const ONBOARDINGS: Array<[OnboardedProductKey, ProductOnboarding]> =
  Object.entries(PRODUCT_ONBOARDINGS) as Array<
    [OnboardedProductKey, ProductOnboarding]
  >;

// The products of the products menu, by the page each one opens.
const MENU_ROUTE_PATTERN: RegExp =
  /route:\s*RouteUtil\.populateRouteParams\(\s*RouteMap\[PageMap\.(\w+)\]/g;

function getMenuPages(): Array<string> {
  const source: string = read("Utils/NavigationItems.tsx");
  const pages: Array<string> = [];

  for (const match of source.matchAll(MENU_ROUTE_PATTERN)) {
    pages.push(match[1] as string);
  }

  return pages;
}

// The resources: the showcase their empty list already drew is their explanation.
const RESOURCE_SHOWCASES: Partial<Record<ProductKey, ResourceShowcase>> = {
  [ProductKey.Hosts]: HOST_SHOWCASE,
  [ProductKey.Kubernetes]: KUBERNETES_CLUSTER_SHOWCASE,
  [ProductKey.Docker]: DOCKER_HOST_SHOWCASE,
  [ProductKey.DockerSwarm]: DOCKER_SWARM_CLUSTER_SHOWCASE,
  [ProductKey.Podman]: PODMAN_HOST_SHOWCASE,
  [ProductKey.Proxmox]: PROXMOX_CLUSTER_SHOWCASE,
  [ProductKey.OpenStack]: OPENSTACK_CLOUD_SHOWCASE,
  [ProductKey.VMware]: VMWARE_VCENTER_SHOWCASE,
  [ProductKey.Ceph]: CEPH_CLUSTER_SHOWCASE,
  [ProductKey.StorageArrays]: STORAGE_ARRAY_SHOWCASE,
  [ProductKey.IoT]: IOT_FLEET_SHOWCASE,
  [ProductKey.Databases]: DATABASE_SHOWCASE,
  [ProductKey.Queues]: MESSAGE_QUEUE_SHOWCASE,
  [ProductKey.Rum]: RUM_APPLICATION_SHOWCASE,
  [ProductKey.Serverless]: SERVERLESS_FUNCTION_SHOWCASE,
  [ProductKey.Cloud]: CLOUD_SHOWCASE,
  [ProductKey.AppPlatforms]: CLOUD_ENVIRONMENT_SHOWCASE,
};

const isResource: (product: ProductKey) => boolean = (
  product: ProductKey,
): boolean => {
  return RESOURCE_SHOWCASES[product] !== undefined;
};

// Each product's layout: the one file that draws its page title.
const LAYOUTS: Record<OnboardedProductKey, string> = {
  [ProductKey.Monitors]: "Pages/Monitor/Layout.tsx",
  [ProductKey.Incidents]: "Pages/Incidents/Layout.tsx",
  [ProductKey.Alerts]: "Pages/Alerts/Layout.tsx",
  [ProductKey.OnCall]: "Pages/OnCallDuty/Layout.tsx",
  [ProductKey.StatusPages]: "Pages/StatusPages/Layout.tsx",
  [ProductKey.ScheduledMaintenance]:
    "Pages/ScheduledMaintenanceEvents/Layout.tsx",
  [ProductKey.Slos]: "Pages/Slo/Layout.tsx",
  [ProductKey.Logs]: "Pages/Logs/Layout.tsx",
  [ProductKey.Metrics]: "Pages/Metrics/Layout.tsx",
  [ProductKey.Traces]: "Pages/Traces/Layout.tsx",
  [ProductKey.Profiles]: "Pages/Profiles/Layout.tsx",
  [ProductKey.Exceptions]: "Pages/Exceptions/Layout.tsx",
  [ProductKey.Llm]: "Pages/Llm/Layout.tsx",
  [ProductKey.DataObservability]: "Pages/DataObservability/Layout.tsx",
  [ProductKey.Topology]: "Pages/Inventory/Layout.tsx",
  [ProductKey.SecurityEvents]: "Pages/SecurityEvents/Layout.tsx",
  [ProductKey.DataSecurity]: "Pages/DataSecurity/Layout.tsx",
  [ProductKey.AIInsights]: "Pages/AIInsights/Layout.tsx",
  [ProductKey.Code]: "Pages/Code/Layout.tsx",
  [ProductKey.Inventory]: "Pages/Inventory/Layout.tsx",
  [ProductKey.Services]: "Pages/Service/Layout.tsx",
  [ProductKey.Databases]: "Pages/Database/Layout.tsx",
  [ProductKey.Queues]: "Pages/MessageQueue/Layout.tsx",
  [ProductKey.Rum]: "Pages/Rum/Layout.tsx",
  [ProductKey.Hosts]: "Pages/Host/Layout.tsx",
  [ProductKey.Kubernetes]: "Pages/Kubernetes/Layout.tsx",
  [ProductKey.Docker]: "Pages/Docker/Layout.tsx",
  [ProductKey.DockerSwarm]: "Pages/DockerSwarm/Layout.tsx",
  [ProductKey.Podman]: "Pages/Podman/Layout.tsx",
  [ProductKey.Proxmox]: "Pages/Proxmox/Layout.tsx",
  [ProductKey.OpenStack]: "Pages/OpenStack/Layout.tsx",
  [ProductKey.VMware]: "Pages/VMware/Layout.tsx",
  [ProductKey.Ceph]: "Pages/Ceph/Layout.tsx",
  [ProductKey.StorageArrays]: "Pages/StorageArray/Layout.tsx",
  [ProductKey.Network]: "Pages/Network/Layout.tsx",
  [ProductKey.IoT]: "Pages/IoT/Layout.tsx",
  [ProductKey.Cloud]: "Pages/Cloud/Layout.tsx",
  [ProductKey.AppPlatforms]: "Pages/AppPlatforms/Layout.tsx",
  [ProductKey.Serverless]: "Pages/Serverless/Layout.tsx",
  [ProductKey.Dashboards]: "Pages/Dashboards/Layout.tsx",
  [ProductKey.Workflows]: "Pages/Workflow/Layout.tsx",
  [ProductKey.Runbooks]: "Pages/Runbook/Layout.tsx",
  [ProductKey.Forms]: "Pages/Forms/Layout.tsx",
};

/*
 * Each product's first page, and what in it draws the explanation: the
 * product's own showcase (a list's, a telemetry explorer's, an overview's),
 * or the resource's showcase it already drew.
 */
const FIRST_PAGES: Record<
  OnboardedProductKey,
  { file: string; draws: string }
> = {
  [ProductKey.Monitors]: {
    file: "Pages/Monitor/Monitors.tsx",
    draws: "product: ProductKey.Monitors,",
  },
  [ProductKey.Incidents]: {
    file: "Pages/Incidents/Incidents.tsx",
    draws: "product: ProductKey.Incidents,",
  },
  [ProductKey.Alerts]: {
    file: "Pages/Alerts/Alerts.tsx",
    draws: "product: ProductKey.Alerts,",
  },
  [ProductKey.ScheduledMaintenance]: {
    file: "Pages/ScheduledMaintenanceEvents/ScheduledMaintenanceEvents.tsx",
    draws: "product: ProductKey.ScheduledMaintenance,",
  },
  [ProductKey.OnCall]: {
    file: "Pages/OnCallDuty/OnCallDutyPolicies.tsx",
    draws: "product={ProductKey.OnCall}",
  },
  [ProductKey.StatusPages]: {
    file: "Pages/StatusPages/StatusPages.tsx",
    draws: "product={ProductKey.StatusPages}",
  },
  [ProductKey.Slos]: {
    file: "Pages/Slo/Slos.tsx",
    draws: "product={ProductKey.Slos}",
  },
  [ProductKey.Services]: {
    file: "Pages/Service/Services.tsx",
    draws: "product={ProductKey.Services}",
  },
  [ProductKey.Dashboards]: {
    file: "Pages/Dashboards/Dashboards.tsx",
    draws: "product={ProductKey.Dashboards}",
  },
  [ProductKey.Workflows]: {
    file: "Pages/Workflow/Workflows.tsx",
    draws: "product={ProductKey.Workflows}",
  },
  [ProductKey.Runbooks]: {
    file: "Pages/Runbook/Runbooks.tsx",
    draws: "product={ProductKey.Runbooks}",
  },
  [ProductKey.Forms]: {
    file: "Pages/Forms/Forms.tsx",
    draws: "product={ProductKey.Forms}",
  },
  [ProductKey.Logs]: {
    file: "Pages/Logs/Index.tsx",
    // Around its explorer, whose first steps it waits for.
    draws: "<TelemetryFirstRunShowcase product={ProductKey.Logs}>",
  },
  [ProductKey.Traces]: {
    file: "Pages/Traces/Index.tsx",
    // Around its explorer, whose first steps it waits for.
    draws: "<TelemetryFirstRunShowcase product={ProductKey.Traces}>",
  },
  [ProductKey.Metrics]: {
    file: "Pages/Metrics/Index.tsx",
    // Around its explorer, whose first steps it waits for.
    draws: "<TelemetryFirstRunShowcase product={ProductKey.Metrics}>",
  },
  [ProductKey.Profiles]: {
    file: "Pages/Profiles/Index.tsx",
    // Around its explorer, whose first steps it waits for.
    draws: "<TelemetryFirstRunShowcase product={ProductKey.Profiles}>",
  },
  [ProductKey.Exceptions]: {
    file: "Pages/Exceptions/Unresolved.tsx",
    // Around its explorer, whose first steps it waits for.
    draws: "<TelemetryFirstRunShowcase product={ProductKey.Exceptions}>",
  },
  [ProductKey.Topology]: {
    file: "Pages/Topology/TopologyPage.tsx",
    draws: "<TelemetryFirstRunShowcase product={ProductKey.Topology} />",
  },
  [ProductKey.Llm]: {
    file: "Components/LlmConversations/LlmConversationsView.tsx",
    draws: "product={ProductKey.Llm}",
  },
  [ProductKey.DataObservability]: {
    file: "Pages/DataObservability/Overview.tsx",
    draws: "product={ProductKey.DataObservability}",
  },
  [ProductKey.SecurityEvents]: {
    file: "Pages/SecurityEvents/Overview.tsx",
    draws: "product={ProductKey.SecurityEvents}",
  },
  [ProductKey.DataSecurity]: {
    file: "Pages/DataSecurity/Overview.tsx",
    draws: "product={ProductKey.DataSecurity}",
  },
  [ProductKey.AIInsights]: {
    file: "Pages/AIInsights/Insights.tsx",
    draws: "product={ProductKey.AIInsights}",
  },
  [ProductKey.Code]: {
    file: "Pages/Code/Code.tsx",
    draws: "product={ProductKey.Code}",
  },
  [ProductKey.Inventory]: {
    file: "Pages/Inventory/Overview.tsx",
    draws: "product={ProductKey.Inventory}",
  },
  [ProductKey.Network]: {
    file: "Pages/NetworkDevice/Overview.tsx",
    draws: "product={ProductKey.Network}",
  },
  [ProductKey.Hosts]: { file: "Pages/Host/Hosts.tsx", draws: "HOST_SHOWCASE" },
  [ProductKey.Kubernetes]: {
    file: "Pages/Kubernetes/Clusters.tsx",
    draws: "KUBERNETES_CLUSTER_SHOWCASE",
  },
  [ProductKey.Docker]: {
    file: "Pages/Docker/Hosts.tsx",
    draws: "DOCKER_HOST_SHOWCASE",
  },
  [ProductKey.DockerSwarm]: {
    file: "Pages/DockerSwarm/Clusters.tsx",
    draws: "DOCKER_SWARM_CLUSTER_SHOWCASE",
  },
  [ProductKey.Podman]: {
    file: "Pages/Podman/Hosts.tsx",
    draws: "PODMAN_HOST_SHOWCASE",
  },
  [ProductKey.Proxmox]: {
    file: "Pages/Proxmox/Clusters.tsx",
    draws: "PROXMOX_CLUSTER_SHOWCASE",
  },
  [ProductKey.OpenStack]: {
    file: "Pages/OpenStack/Clouds.tsx",
    draws: "OPENSTACK_CLOUD_SHOWCASE",
  },
  [ProductKey.VMware]: {
    file: "Pages/VMware/VCenters.tsx",
    draws: "VMWARE_VCENTER_SHOWCASE",
  },
  [ProductKey.Ceph]: {
    file: "Pages/Ceph/Clusters.tsx",
    draws: "CEPH_CLUSTER_SHOWCASE",
  },
  [ProductKey.StorageArrays]: {
    file: "Pages/StorageArray/StorageArrays.tsx",
    draws: "STORAGE_ARRAY_SHOWCASE",
  },
  [ProductKey.IoT]: {
    file: "Pages/IoT/Fleets.tsx",
    draws: "IOT_FLEET_SHOWCASE",
  },
  [ProductKey.Databases]: {
    file: "Pages/Database/Databases.tsx",
    draws: "DATABASE_SHOWCASE",
  },
  [ProductKey.Queues]: {
    file: "Pages/MessageQueue/MessageQueues.tsx",
    draws: "MESSAGE_QUEUE_SHOWCASE",
  },
  [ProductKey.Rum]: {
    file: "Pages/Rum/RumApplications.tsx",
    draws: "RUM_APPLICATION_SHOWCASE",
  },
  [ProductKey.Serverless]: {
    file: "Pages/Serverless/ServerlessFunctions.tsx",
    draws: "SERVERLESS_FUNCTION_SHOWCASE",
  },
  [ProductKey.Cloud]: {
    file: "Pages/Cloud/Overview.tsx",
    draws: "CLOUD_SHOWCASE",
  },
  [ProductKey.AppPlatforms]: {
    file: "Pages/AppPlatforms/Overview.tsx",
    draws: "CLOUD_ENVIRONMENT_SHOWCASE",
  },
};

// The lists: each draws its explanation under its own empty table.
const LISTS_UNDER_A_TABLE: Array<OnboardedProductKey> = [
  ProductKey.Monitors,
  ProductKey.Incidents,
  ProductKey.Alerts,
  ProductKey.ScheduledMaintenance,
  ProductKey.OnCall,
  ProductKey.StatusPages,
  ProductKey.Slos,
  ProductKey.Services,
  ProductKey.Dashboards,
  ProductKey.Workflows,
  ProductKey.Runbooks,
  ProductKey.Forms,
];

// The pages whose own words say what their product is for: the lists, and Code.
const UNDER_THEIR_PAGES_OWN_WORDS: Array<OnboardedProductKey> = [
  ...LISTS_UNDER_A_TABLE,
  ProductKey.Code,
];

// What draws the showcase of a list whose first step is a page of its own.
const CREATE_PAGE_FIRST_RUN: string =
  "Components/ProductOnboarding/UseCreatePageFirstRun.tsx";

// A product's key as the code names it: ProductKey.StatusPages.
function keyName(product: ProductKey): string {
  return Object.keys(ProductKey)[
    Object.values(ProductKey).indexOf(product)
  ] as string;
}

// The words a showcase draws, each an English translation key.
function getShowcaseWords(showcase: ResourceShowcase): Array<string> {
  return [
    showcase.eyebrow,
    showcase.title,
    showcase.description,
    ...showcase.highlights,
    ...(showcase.steps || []),
    ...showcase.features.flatMap((feature: ShowcaseFeature): Array<string> => {
      return [feature.title, feature.description];
    }),
    showcase.preview.subtitle,
    ...(showcase.preview.badge ? [showcase.preview.badge] : []),
    ...(showcase.preview.description ? [showcase.preview.description] : []),
    ...showcase.preview.stats.map((stat: ShowcaseStat): string => {
      return stat.label;
    }),
    showcase.preview.chart.label,
    ...(showcase.preview.chart.range ? [showcase.preview.chart.range] : []),
    ...showcase.preview.rows.map((row: ShowcaseRow): string => {
      return row.detail;
    }),
    ...(showcase.preview.alert
      ? [showcase.preview.alert.title, showcase.preview.alert.description]
      : []),
  ];
}

/*
 * A row's state is a word ("Degraded"), or a figure ({ milliseconds: 120 })
 * written the reader's way when it is drawn, as a stat's value is: the
 * words are the ones a translator finds.
 */
function getRowStateWords(showcase: ResourceShowcase): Array<string> {
  const words: Array<string> = [];

  for (const row of showcase.preview.rows) {
    if (!isShowcaseFigure(row.statusText)) {
      words.push(row.statusText);
    }
  }

  return words;
}

const EN: Record<string, string> = JSON.parse(
  read("Locales/en.json"),
) as Record<string, string>;

const I18N: string = path.join(DASHBOARD_SRC, "../i18n");

// Every language the Dashboard ships besides English.
const LOCALES: Array<string> = fs
  .readdirSync(path.join(DASHBOARD_SRC, "Locales"))
  .filter((file: string): boolean => {
    return file.endsWith(".json") && file !== "en.json";
  })
  .map((file: string): string => {
    return file.replace(/\.json$/, "");
  })
  .sort();

const GLOBAL_SAME_AS_ENGLISH: Array<string> = JSON.parse(
  fs.readFileSync(path.join(I18N, "SameAsEnglish.json"), "utf8"),
) as Array<string>;

/*
 * The words the products' explanations add: the products' own showcases,
 * the How it works button and its dialog, and the telemetry products' first
 * step, link and setup dialog's line. The resources' showcases are their
 * lists' words, translated with those lists.
 */
function getProductWords(): Array<string> {
  const words: Set<string> = new Set<string>([
    PRODUCT_ABOUT_TEXT,
    PRODUCT_EXAMPLE_DESCRIPTION,
    RESOURCE_SHOWCASE_DOCS_TEXT,
    TELEMETRY_SETUP_DESCRIPTION,
  ]);

  for (const [product, onboarding] of ONBOARDINGS) {
    words.add(onboarding.name);
    if (isResource(product)) {
      continue;
    }
    for (const word of getShowcaseWords(onboarding.showcase)) {
      words.add(word);
    }
    for (const word of getRowStateWords(onboarding.showcase)) {
      words.add(word);
    }
  }

  for (const firstRun of Object.values(TELEMETRY_FIRST_RUNS)) {
    words.add(firstRun.startText);
    words.add(firstRun.viewText);
  }

  return [...words];
}

describe("every product of the products menu explains itself", () => {
  const menuPages: Array<string> = getMenuPages();

  test("the products menu is read: its products and its settings", () => {
    // Not vacuous: the menu's 45 or so entries were found.
    expect(menuPages.length).toBeGreaterThan(40);
    expect(menuPages).toEqual(
      expect.arrayContaining(["MONITORS", "LOGS", "KUBERNETES_CLUSTERS"]),
    );
  });

  test("each product the menu opens has an explanation, and each explanation is a product of the menu", () => {
    const explained: Array<string> = ONBOARDINGS.map(
      ([, onboarding]: [ProductKey, ProductOnboarding]): string => {
        return onboarding.page;
      },
    );
    const needingOne: Array<string> = menuPages.filter(
      (page: string): boolean => {
        return PRODUCTS_WITHOUT_ONBOARDING[page] === undefined;
      },
    );

    expect([...explained].sort()).toEqual([...needingOne].sort());
    // One explanation per product: no page twice.
    expect(new Set(explained).size).toBe(explained.length);
  });

  test("the entries without an explanation are in the menu, each with its reason", () => {
    for (const [page, reason] of Object.entries(PRODUCTS_WITHOUT_ONBOARDING)) {
      expect(menuPages).toContain(page);
      expect(reason.length).toBeGreaterThan(10);
    }
  });

  test("a resource's explanation is the showcase its empty list already draws", () => {
    for (const [product, showcase] of Object.entries(RESOURCE_SHOWCASES)) {
      expect(PRODUCT_ONBOARDINGS[product as OnboardedProductKey].showcase).toBe(
        showcase,
      );
    }
  });
});

describe("each explanation is complete", () => {
  test.each(ONBOARDINGS)(
    "%s: a pitch, how to start, an example, and a documentation page that exists",
    (product: OnboardedProductKey, onboarding: ProductOnboarding) => {
      const showcase: ResourceShowcase = onboarding.showcase;

      expect(onboarding.name.trim()).not.toBe("");
      expect(showcase.title.trim()).not.toBe("");
      expect(showcase.description.trim()).not.toBe("");

      if (isResource(product)) {
        // A resource says how setup goes in its highlights.
        expect(showcase.highlights.length).toBeGreaterThan(0);
      } else {
        // A product says how to start: two to four steps.
        const steps: Array<string> = showcase.steps || [];
        expect(steps.length).toBeGreaterThanOrEqual(2);
        expect(steps.length).toBeLessThanOrEqual(4);
        // Said once each, short enough for one line of the pitch.
        expect(new Set(steps).size).toBe(steps.length);
        for (const step of steps) {
          expect(step.length).toBeLessThanOrEqual(70);
        }
        // A product's example is read as one sentence, its own.
        expect(showcase.preview.description).toBe(PRODUCT_EXAMPLE_DESCRIPTION);
      }

      // The example: four tiles, a chart and three or four rows.
      expect(showcase.preview.stats).toHaveLength(4);
      expect(showcase.preview.chart.values.length).toBeGreaterThan(4);
      expect(showcase.preview.rows.length).toBeGreaterThanOrEqual(3);
      expect(showcase.preview.rows.length).toBeLessThanOrEqual(4);

      // The documentation: a page of the docs, in its navigation and on disk.
      const docsPath: string = onboarding.docsRoute.toString();
      expect(docsPath.startsWith("/docs/")).toBe(true);
      expect(
        fs.readFileSync(path.join(DOCS, "Utils/Nav.ts"), "utf8"),
      ).toContain(`url: "${docsPath}"`);
      expect(
        fs.existsSync(
          path.join(DOCS, "Content/en", `${docsPath.replace("/docs/", "")}.md`),
        ),
      ).toBe(true);
    },
  );

  /*
   * A product's guide (#6821) is one of the docs' guides: a page of the
   * Guides group, marked as a guide in the nav, on disk, and not the page
   * its documentation link opens.
   */
  test("a product's guide is a guide of the docs, besides its documentation", () => {
    const nav: string = fs.readFileSync(
      path.join(DOCS, "Utils/Nav.ts"),
      "utf8",
    );
    const guided: Array<string> = [];

    for (const [product, onboarding] of ONBOARDINGS) {
      if (!onboarding.guideRoute) {
        continue;
      }

      const guidePath: string = onboarding.guideRoute.toString();

      guided.push(product);
      expect(guidePath).toMatch(/^\/docs\/guides\/[a-z-]+$/);
      expect(guidePath).not.toBe(onboarding.docsRoute.toString());
      expect(nav).toContain(`url: "${guidePath}",\n        isGuide: true,`);
      expect(
        fs.existsSync(
          path.join(
            DOCS,
            "Content/en",
            `${guidePath.replace("/docs/", "")}.md`,
          ),
        ),
      ).toBe(true);
    }

    // The jobs that have a guide today; each new guide adds its product.
    expect(guided).toEqual(
      expect.arrayContaining([
        ProductKey.Monitors,
        ProductKey.OnCall,
        ProductKey.StatusPages,
      ]),
    );
  });

  test("a product's words are English translation keys a translator finds in en.json", () => {
    const missing: Array<string> = [];

    for (const [product, onboarding] of ONBOARDINGS) {
      const words: Array<string> = [
        onboarding.name,
        ...(isResource(product) ? [] : getShowcaseWords(onboarding.showcase)),
      ];

      for (const word of words) {
        if (EN[word] === undefined) {
          missing.push(`${product}: ${word}`);
        }
      }

      if (!isResource(product)) {
        for (const word of getRowStateWords(onboarding.showcase)) {
          if (EN[word] === undefined) {
            missing.push(`${product}: ${word}`);
          }
        }
      }
    }

    expect(missing).toEqual([]);
  });

  test.each(LOCALES)(
    "%s: a product's words read in that language",
    (locale: string) => {
      const translations: Record<string, unknown> = JSON.parse(
        read(`Locales/${locale}.json`),
      ) as Record<string, unknown>;
      const progress: { sameAsEnglish?: Array<string> } = JSON.parse(
        fs.readFileSync(path.join(I18N, `Progress/${locale}.json`), "utf8"),
      ) as { sameAsEnglish?: Array<string> };
      const sameAsEnglish: Set<string> = new Set<string>([
        ...GLOBAL_SAME_AS_ENGLISH,
        ...(progress.sameAsEnglish || []),
      ]);
      const untranslated: Array<string> = [];

      for (const word of getProductWords()) {
        const value: unknown = translations[word];
        if (
          typeof value !== "string" ||
          value.trim() === "" ||
          (value === word && !sameAsEnglish.has(word))
        ) {
          untranslated.push(word);
        }
      }

      expect(untranslated).toEqual([]);
    },
  );

  test("an example names no real company and no project of ours", () => {
    for (const [product, onboarding] of ONBOARDINGS) {
      if (isResource(product)) {
        continue;
      }
      const preview: string = JSON.stringify(onboarding.showcase.preview);
      expect(preview.toLowerCase()).not.toContain("oneuptime");
      // Addresses are the reserved example domain.
      for (const match of preview.matchAll(/[\w-]+\.(com|net|org|io)\b/g)) {
        expect(match[0]).toMatch(/example\.com$/);
      }
    }
  });

  /*
   * The Dashboard's "Uptime" is how long a host or a device has run (a
   * Proxmox node's, a network device's), and most languages translate it
   * so: German "Laufzeit", Japanese "稼働時間", Chinese "运行时间". Over a
   * share of time up it would read "runtime 99.98%"; that is Availability.
   */
  test("an example's share of time up is its availability, not its uptime", () => {
    const uptimes: Array<string> = [];

    for (const [product, onboarding] of ONBOARDINGS) {
      if (isResource(product)) {
        continue;
      }
      for (const stat of onboarding.showcase.preview.stats) {
        if (stat.label === "Uptime") {
          uptimes.push(
            `${product}: ${stat.label} ${JSON.stringify(stat.value)}`,
          );
        }
      }
      if (onboarding.showcase.preview.chart.label === "Uptime") {
        uptimes.push(`${product}: its chart`);
      }
    }

    expect(uptimes).toEqual([]);
  });
});

/*
 * AN EXAMPLE'S NUMBERS ARE FIGURES (#6535).
 *
 * A number written as text in an example ("1,284", "99.98%", "184 ms") is
 * drawn as written in every language, and "1,284" reads as one point two
 * eight four to a German, Spanish or French reader. A figure is written the
 * reader's way when it is drawn (formatShowcaseFigure). Text is left to what
 * is not a number to be written: a code ("SEV 1", "P2", an HTTP status
 * "200"), a term the software shows ("CrashLoopBackOff"). A clock is a
 * figure too ({ clock: "00:21:07" }): a Persian page writes it "۰۰:۲۱:۰۷".
 */

const DIGIT_PATTERN: RegExp = /\d/;

// The issue's patterns: "1,284" and "99.98".
const THOUSANDS_COMMA_PATTERN: RegExp = /\d,\d{3}/;
const DECIMAL_POINT_PATTERN: RegExp = /\d\.\d/;

// The stats whose value is a code, written as the software writes it.
const CODE_STAT_LABELS: Array<string> = ["Status Code", "Severity"];

// The stat values and row states of `showcase` that are numbers written as text.
function getNumbersWrittenAsText(showcase: ResourceShowcase): Array<string> {
  const found: Array<string> = [];
  const check: (
    where: string,
    value: ShowcaseValue,
    isCode: boolean,
  ) => void = (where: string, value: ShowcaseValue, isCode: boolean): void => {
    if (isShowcaseFigure(value) || !DIGIT_PATTERN.test(value)) {
      return;
    }
    if (isCode) {
      return;
    }
    found.push(`${where}: ${value}`);
  };

  for (const stat of showcase.preview.stats) {
    check(stat.label, stat.value, CODE_STAT_LABELS.includes(stat.label));
  }
  for (const row of showcase.preview.rows) {
    check(row.name, row.statusText, false);
  }

  return found;
}

describe("an example's numbers are written in the reader's language", () => {
  test.each(ONBOARDINGS)(
    "%s: its example's numbers are figures, not English text",
    (_product: OnboardedProductKey, onboarding: ProductOnboarding) => {
      expect(getNumbersWrittenAsText(onboarding.showcase)).toEqual([]);
    },
  );

  test("the guard finds a number or a clock written as text, and leaves codes and words", () => {
    const showcase: ResourceShowcase = {
      ...PRODUCT_ONBOARDINGS[ProductKey.StatusPages].showcase,
      preview: {
        ...PRODUCT_ONBOARDINGS[ProductKey.StatusPages].showcase.preview,
        stats: [
          { label: "Subscribers", value: "1,284" },
          { label: "Availability", value: "99.98%" },
          { label: "Severity", value: "SEV 1" },
          { label: "Duration", value: "00:21:07" },
          { label: "Queries", value: "482k" },
          { label: "Burn rate", value: "0.4x" },
          { label: "Spend", value: "$4,120" },
          { label: "OSDs up", value: "11/12" },
          { label: "Pods", value: 248 },
          { label: "CPU", value: { percent: 63 } },
          { label: "Window", value: { clock: "02:00:00" } },
        ],
        rows: [
          {
            name: "checkout-api",
            detail: "Server",
            status: ShowcaseStatus.Healthy,
            statusText: "120 ms",
          },
          {
            name: "payments",
            detail: "Server",
            status: ShowcaseStatus.Critical,
            statusText: "CrashLoopBackOff",
          },
          {
            name: "orders",
            detail: "Server",
            status: ShowcaseStatus.Healthy,
            statusText: { milliseconds: 120 },
          },
        ],
      },
    };

    expect(getNumbersWrittenAsText(showcase)).toEqual([
      "Subscribers: 1,284",
      "Availability: 99.98%",
      "Duration: 00:21:07",
      "Queries: 482k",
      "Burn rate: 0.4x",
      "Spend: $4,120",
      "OSDs up: 11/12",
      "checkout-api: 120 ms",
    ]);
  });

  test("the issue's own patterns find nothing either: no thousands comma, no decimal point", () => {
    const written: Array<string> = [];

    for (const [product, onboarding] of ONBOARDINGS) {
      for (const value of [
        ...onboarding.showcase.preview.stats.map(
          (stat: ShowcaseStat): ShowcaseValue => {
            return stat.value;
          },
        ),
        ...onboarding.showcase.preview.rows.map(
          (row: ShowcaseRow): ShowcaseValue => {
            return row.statusText;
          },
        ),
      ]) {
        if (
          typeof value === "string" &&
          (THOUSANDS_COMMA_PATTERN.test(value) ||
            DECIMAL_POINT_PATTERN.test(value))
        ) {
          written.push(`${product}: ${value}`);
        }
      }
    }

    expect(written).toEqual([]);
  });
});

describe("the explanation is where each product is", () => {
  test.each(ONBOARDINGS)(
    "%s: How it works sits beside its page's title",
    (product: OnboardedProductKey) => {
      const layout: string = read(LAYOUTS[product]);
      const about: RegExp = new RegExp(
        `titleRight=\\{\\s*<ProductAboutButton\\s+product=\\{[^}]*ProductKey\\.${
          Object.keys(ProductKey)[Object.values(ProductKey).indexOf(product)]
        }\\b`,
      );

      expect(layout).toMatch(about);
    },
  );

  test.each(ONBOARDINGS)(
    "%s: its first page draws it while there is nothing yet",
    (product: OnboardedProductKey) => {
      const firstPage: { file: string; draws: string } = FIRST_PAGES[product];

      expect(read(firstPage.file)).toContain(firstPage.draws);
    },
  );

  /*
   * Under an empty list the table says what the list is for ("No monitors
   * yet" and the card's description), and under Code's connect card the
   * card says what Code does: the showcase does not say it a second time.
   * Its title, steps, example and documentation follow; About, with no
   * table above it, says it all.
   */
  test.each(UNDER_THEIR_PAGES_OWN_WORDS)(
    "%s: under the page's own words, its showcase leaves its description to them",
    (product: OnboardedProductKey) => {
      const firstPage: { file: string; draws: string } = FIRST_PAGES[product];
      const source: string = read(firstPage.file);

      if (firstPage.draws.startsWith("product: ")) {
        // A list whose first step is a page of its own (useCreatePageFirstRun).
        expect(read(CREATE_PAGE_FIRST_RUN)).toMatch(
          /<ProductShowcase\s+product=\{data\.product\}[^>]*?hidesDescription=\{true\}/,
        );
        return;
      }

      const start: number = source.indexOf(
        `product={ProductKey.${keyName(product)}}`,
      );
      const element: string = source.slice(
        source.lastIndexOf("<ProductShowcase", start),
        source.indexOf("/>", start),
      );

      expect(element.startsWith("<ProductShowcase")).toBe(true);
      expect(element).toContain("hidesDescription={true}");
    },
  );

  test("a showcase drawn alone says what its product is for", () => {
    for (const [product] of ONBOARDINGS) {
      if (UNDER_THEIR_PAGES_OWN_WORDS.includes(product)) {
        continue;
      }

      const source: string = read(FIRST_PAGES[product].file);

      expect({ product, hides: source.includes("hidesDescription") }).toEqual({
        product,
        hides: false,
      });
    }
  });

  test("a telemetry product's button is its first step, and its setup guide waits for that telemetry", () => {
    for (const [product, firstRun] of Object.entries(TELEMETRY_FIRST_RUNS)) {
      const steps: Array<string> =
        PRODUCT_ONBOARDINGS[product as OnboardedProductKey].showcase.steps ||
        [];

      expect(steps[0]).toBe(firstRun.startText);
      expect(firstRun.viewPage.startsWith("SERVICE_VIEW")).toBe(true);
    }
  });
});
