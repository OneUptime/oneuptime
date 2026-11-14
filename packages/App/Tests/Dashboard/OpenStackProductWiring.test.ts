import { describe, expect, test } from "@jest/globals";
import { isOpenStackCountable } from "Common/Types/OpenStack/OpenStackCounts";
import { OpenStackResourceKind } from "Common/Types/OpenStack/OpenStackResourceKind";
import fs from "fs";
import path from "path";
import {
  InstallScriptEntry,
  InstallScriptName,
  getInstallScriptEntry,
} from "Common/Types/InstallScripts/InstallScripts";
import {
  OPENSTACK_ACCESS_RULES_FILE,
  OPENSTACK_AGENT_CONTAINER,
  OPENSTACK_AGENT_IDENTITY_CONFIG,
  OPENSTACK_AGENT_INSTALL_DIR,
  OPENSTACK_CONNECT_METHODS,
  OPENSTACK_EXAMPLE_CLOUD_NAME,
  OPENSTACK_EXPORTER_CONTAINER,
  OPENSTACK_MONITORING_ROLE,
  OPENSTACK_POLICY_FILES,
  OpenStackConnectMethod,
  getOpenStackInstallScriptCommand,
  getOpenStackSetupGuide,
} from "../../FeatureSet/Dashboard/src/Pages/OpenStack/Utils/DocumentationMarkdown";
import {
  SETUP_GUIDE_API_KEY_PLACEHOLDER,
  SetupGuideContent,
  SetupGuideOption,
  SetupGuideStep,
  SetupGuideStepVariant,
  getSetupGuideCodeBlocks,
  getSetupGuideMarkdown,
} from "../../FeatureSet/Dashboard/src/Components/SetupGuide/SetupGuide";
import OPENSTACK_CLOUD_SHOWCASE from "../../FeatureSet/Dashboard/src/Components/OpenStack/OpenStackCloudShowcase";
import {
  RouteAttributes,
  pageRoutesIn,
  routeMapPath,
  routesAt,
} from "../Helpers/PageRoutes";

/*
 * js-yaml from Common/node_modules, as OpenTelemetryCollectorExampleDocs.test.ts loads it
 * and for the same reason: Common declares js-yaml 4, App declares no YAML parser.
 */
interface JsYamlModule {
  load: (text: string) => unknown;
}

/* eslint-disable @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires */
const yaml: JsYamlModule = require(
  path.resolve(
    __dirname,
    "..",
    "..",
    "..",
    "Common",
    "node_modules",
    "js-yaml",
  ),
);
/* eslint-enable @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires */

/*
 * The OpenStack product is a lazy-loaded route group built on the shape of the
 * VMware and Proxmox ones. Every piece of that wiring fails silently rather than
 * loudly:
 *
 *   - a missing navbar entry hides the product rather than erroring,
 *   - a route declared in PageMap but never mounted renders a blank page,
 *   - a side menu link with no route is reachable, and 404s,
 *   - a locale missing the nav key shows the raw key string,
 *   - a guide that names the wrong identity attribute registers no cloud at all.
 *
 * This merge is the product area alone: Topology, Insights, Recommendations, AI
 * and the part pages come in later issues. Their PageMap and RouteMap entries stay
 * for those issues to use, and nothing may link to them until then.
 *
 * Source-level on purpose, as VMwareProductWiring.test.ts is: the App suite cannot
 * import the Dashboard's route modules. Whitespace is squashed so Prettier can
 * reflow without making these brittle.
 */

const DASHBOARD_SRC: string = path.join(
  __dirname,
  "..",
  "..",
  "FeatureSet",
  "Dashboard",
  "src",
);

const REPO_ROOT: string = path.join(__dirname, "..", "..", "..", "..");
const AGENT_DIR: string = path.join(REPO_ROOT, "agents", "OpenStackAgent");

type ReadSourceFunction = (...segments: Array<string>) => string;

const readSource: ReadSourceFunction = (...segments: Array<string>): string => {
  return fs.readFileSync(path.join(DASHBOARD_SRC, ...segments), "utf8");
};

type SquashFunction = (source: string) => string;

const squash: SquashFunction = (source: string): string => {
  return source.replace(/\s+/g, " ");
};

/** All whitespace removed, for assertions Prettier would otherwise reflow. */
const dense: SquashFunction = (source: string): string => {
  return source.replace(/\s+/g, "");
};

const stripComments: SquashFunction = (source: string): string => {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, " ")
    .replace(/(^|[^:])\/\/[^\n]*/g, "$1");
};

// Every PageMap key a page of this merge lives at, mounted and linked.
const MOUNTED_VIEW_PAGES: ReadonlyArray<[string, string]> = [
  ["Index.tsx", "OPENSTACK_CLOUD_VIEW"],
  ["AI/Insights.tsx", "OPENSTACK_CLOUD_VIEW_AI_INSIGHTS"],
  ["AI/Logs.tsx", "OPENSTACK_CLOUD_VIEW_AI_LOGS"],
  ["AI/Agent.tsx", "OPENSTACK_CLOUD_VIEW_AI_AGENT"],
  ["Recommendations.tsx", "OPENSTACK_CLOUD_VIEW_RECOMMENDATIONS"],
  ["Capacity.tsx", "OPENSTACK_CLOUD_VIEW_CAPACITY"],
  ["Spend.tsx", "OPENSTACK_CLOUD_VIEW_SPEND"],
  ["StatusPages.tsx", "OPENSTACK_CLOUD_VIEW_STATUS_PAGES"],
  ["Services.tsx", "OPENSTACK_CLOUD_VIEW_SERVICES"],
  ["ServiceDetail.tsx", "OPENSTACK_CLOUD_VIEW_SERVICE_DETAIL"],
  ["Hypervisors.tsx", "OPENSTACK_CLOUD_VIEW_HYPERVISORS"],
  ["HypervisorDetail.tsx", "OPENSTACK_CLOUD_VIEW_HYPERVISOR_DETAIL"],
  ["Instances.tsx", "OPENSTACK_CLOUD_VIEW_INSTANCES"],
  ["InstanceDetail.tsx", "OPENSTACK_CLOUD_VIEW_INSTANCE_DETAIL"],
  ["AvailabilityZones.tsx", "OPENSTACK_CLOUD_VIEW_AVAILABILITY_ZONES"],
  [
    "AvailabilityZoneDetail.tsx",
    "OPENSTACK_CLOUD_VIEW_AVAILABILITY_ZONE_DETAIL",
  ],
  ["Aggregates.tsx", "OPENSTACK_CLOUD_VIEW_AGGREGATES"],
  ["AggregateDetail.tsx", "OPENSTACK_CLOUD_VIEW_AGGREGATE_DETAIL"],
  ["Flavors.tsx", "OPENSTACK_CLOUD_VIEW_FLAVORS"],
  ["FlavorDetail.tsx", "OPENSTACK_CLOUD_VIEW_FLAVOR_DETAIL"],
  ["Networks.tsx", "OPENSTACK_CLOUD_VIEW_NETWORKS"],
  ["NetworkDetail.tsx", "OPENSTACK_CLOUD_VIEW_NETWORK_DETAIL"],
  ["Subnets.tsx", "OPENSTACK_CLOUD_VIEW_SUBNETS"],
  ["SubnetDetail.tsx", "OPENSTACK_CLOUD_VIEW_SUBNET_DETAIL"],
  ["Routers.tsx", "OPENSTACK_CLOUD_VIEW_ROUTERS"],
  ["RouterDetail.tsx", "OPENSTACK_CLOUD_VIEW_ROUTER_DETAIL"],
  ["FloatingIps.tsx", "OPENSTACK_CLOUD_VIEW_FLOATING_IPS"],
  ["FloatingIpDetail.tsx", "OPENSTACK_CLOUD_VIEW_FLOATING_IP_DETAIL"],
  ["BareMetalNodes.tsx", "OPENSTACK_CLOUD_VIEW_BARE_METAL_NODES"],
  ["BareMetalNodeDetail.tsx", "OPENSTACK_CLOUD_VIEW_BARE_METAL_NODE_DETAIL"],
  ["NetworkAgents.tsx", "OPENSTACK_CLOUD_VIEW_NETWORK_AGENTS"],
  ["NetworkAgentDetail.tsx", "OPENSTACK_CLOUD_VIEW_NETWORK_AGENT_DETAIL"],
  ["Volumes.tsx", "OPENSTACK_CLOUD_VIEW_VOLUMES"],
  ["VolumeDetail.tsx", "OPENSTACK_CLOUD_VIEW_VOLUME_DETAIL"],
  ["Snapshots.tsx", "OPENSTACK_CLOUD_VIEW_SNAPSHOTS"],
  ["StoragePools.tsx", "OPENSTACK_CLOUD_VIEW_STORAGE_POOLS"],
  ["StoragePoolDetail.tsx", "OPENSTACK_CLOUD_VIEW_STORAGE_POOL_DETAIL"],
  ["Images.tsx", "OPENSTACK_CLOUD_VIEW_IMAGES"],
  ["ImageDetail.tsx", "OPENSTACK_CLOUD_VIEW_IMAGE_DETAIL"],
  ["Stacks.tsx", "OPENSTACK_CLOUD_VIEW_STACKS"],
  ["StackDetail.tsx", "OPENSTACK_CLOUD_VIEW_STACK_DETAIL"],
  ["Shares.tsx", "OPENSTACK_CLOUD_VIEW_SHARES"],
  ["ShareDetail.tsx", "OPENSTACK_CLOUD_VIEW_SHARE_DETAIL"],
  ["LoadBalancers.tsx", "OPENSTACK_CLOUD_VIEW_LOAD_BALANCERS"],
  ["LoadBalancerDetail.tsx", "OPENSTACK_CLOUD_VIEW_LOAD_BALANCER_DETAIL"],
  [
    "LoadBalancerPoolDetail.tsx",
    "OPENSTACK_CLOUD_VIEW_LOAD_BALANCER_POOL_DETAIL",
  ],
  ["AmphoraDetail.tsx", "OPENSTACK_CLOUD_VIEW_AMPHORA_DETAIL"],
  ["DnsZones.tsx", "OPENSTACK_CLOUD_VIEW_DNS_ZONES"],
  ["DnsZoneDetail.tsx", "OPENSTACK_CLOUD_VIEW_DNS_ZONE_DETAIL"],
  ["ObjectContainers.tsx", "OPENSTACK_CLOUD_VIEW_OBJECT_CONTAINERS"],
  ["ObjectContainerDetail.tsx", "OPENSTACK_CLOUD_VIEW_OBJECT_CONTAINER_DETAIL"],
  ["DatabaseInstances.tsx", "OPENSTACK_CLOUD_VIEW_DATABASE_INSTANCES"],
  [
    "DatabaseInstanceDetail.tsx",
    "OPENSTACK_CLOUD_VIEW_DATABASE_INSTANCE_DETAIL",
  ],
  ["ContainerClusters.tsx", "OPENSTACK_CLOUD_VIEW_CONTAINER_CLUSTERS"],
  [
    "ContainerClusterDetail.tsx",
    "OPENSTACK_CLOUD_VIEW_CONTAINER_CLUSTER_DETAIL",
  ],
  ["Projects.tsx", "OPENSTACK_CLOUD_VIEW_PROJECTS"],
  ["ProjectDetail.tsx", "OPENSTACK_CLOUD_VIEW_PROJECT_DETAIL"],
  ["Domains.tsx", "OPENSTACK_CLOUD_VIEW_DOMAINS"],
  ["ControlPlane.tsx", "OPENSTACK_CLOUD_VIEW_CONTROL_PLANE"],
  [
    "ControlPlaneDependency.tsx",
    "OPENSTACK_CLOUD_VIEW_CONTROL_PLANE_DEPENDENCY",
  ],
  ["Topology.tsx", "OPENSTACK_CLOUD_VIEW_TOPOLOGY"],
  ["Metrics.tsx", "OPENSTACK_CLOUD_VIEW_METRICS"],
  ["Logs.tsx", "OPENSTACK_CLOUD_VIEW_LOGS"],
  ["Traces.tsx", "OPENSTACK_CLOUD_VIEW_TRACES"],
  ["Checks.tsx", "OPENSTACK_CLOUD_VIEW_CHECKS"],
  ["Incidents.tsx", "OPENSTACK_CLOUD_VIEW_INCIDENTS"],
  ["Alerts.tsx", "OPENSTACK_CLOUD_VIEW_ALERTS"],
  ["ScheduledMaintenance.tsx", "OPENSTACK_CLOUD_VIEW_SCHEDULED_MAINTENANCE"],
  ["Owners.tsx", "OPENSTACK_CLOUD_VIEW_OWNERS"],
  ["Feed.tsx", "OPENSTACK_CLOUD_VIEW_FEED"],
  ["AuditLogs.tsx", "OPENSTACK_CLOUD_VIEW_AUDIT_LOGS"],
  ["Settings.tsx", "OPENSTACK_CLOUD_VIEW_SETTINGS"],
  ["Delete.tsx", "OPENSTACK_CLOUD_VIEW_DELETE"],
  ["Documentation.tsx", "OPENSTACK_CLOUD_VIEW_DOCUMENTATION"],
];

// Product-level pages, under Pages/OpenStack/Layout.tsx.
const PRODUCT_PAGES: ReadonlyArray<[Array<string>, string]> = [
  [["Clouds.tsx"], "OPENSTACK_CLOUDS"],
  [["Documentation.tsx"], "OPENSTACK_DOCUMENTATION"],
  [["Archived.tsx"], "OPENSTACK_ARCHIVED"],
  [["Settings", "OwnerRules.tsx"], "OPENSTACK_SETTINGS_OWNER_RULES"],
  [["Settings", "LabelRules.tsx"], "OPENSTACK_SETTINGS_LABEL_RULES"],
];

const VIEW_PAGE_KEYS: ReadonlyArray<string> = MOUNTED_VIEW_PAGES.map(
  (entry: [string, string]): string => {
    return entry[1];
  },
);

const PRODUCT_PAGE_KEYS: ReadonlyArray<string> = PRODUCT_PAGES.map(
  (entry: [Array<string>, string]): string => {
    return entry[1];
  },
);

const EVERY_PAGE_KEY: ReadonlyArray<string> = [
  "OPENSTACK_ROOT",
  ...VIEW_PAGE_KEYS,
  ...PRODUCT_PAGE_KEYS,
  "OPENSTACK_SETTINGS_OWNER_RULE_VIEW",
  "OPENSTACK_SETTINGS_LABEL_RULE_VIEW",
];

function linkedPageKeysOf(source: string): Array<string> {
  const keys: Set<string> = new Set<string>();
  const pattern: RegExp = /RouteMap\[\s*PageMap\.(OPENSTACK_[A-Z_]+)\s*\]/g;
  for (const match of source.matchAll(pattern)) {
    keys.add(match[1] as string);
  }
  return Array.from(keys);
}

function walk(directory: string): Array<string> {
  const out: Array<string> = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const absolute: string = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      out.push(...walk(absolute));
    } else if (entry.name.endsWith(".ts") || entry.name.endsWith(".tsx")) {
      out.push(absolute);
    }
  }
  return out;
}

const OWN_FILES: Array<string> = [
  ...walk(path.join(DASHBOARD_SRC, "Pages", "OpenStack")),
  ...walk(path.join(DASHBOARD_SRC, "Components", "OpenStack")),
  path.join(DASHBOARD_SRC, "Routes", "OpenStackRoutes.tsx"),
  path.join(DASHBOARD_SRC, "Utils", "Breadcrumbs", "OpenStackBreadcrumbs.ts"),
];

describe("PageMap and RouteMap declare the product", () => {
  const pageMap: string = readSource("Utils", "PageMap.ts");
  const routeMap: string = squash(readSource("Utils", "RouteMap.ts"));

  test.each(EVERY_PAGE_KEY)("%s is declared and has a URL", (key: string) => {
    expect(pageMap).toContain(`${key} = "${key}"`);
    expect(routeMap).toContain(`[PageMap.${key}]: new Route(`);
  });

  test("no Proxmox word became an OpenStack page", () => {
    for (const leftover of [
      "OPENSTACK_CLOUD_VIEW_NODES",
      "OPENSTACK_CLOUD_VIEW_NODE_DETAIL",
      "OPENSTACK_CLOUD_VIEW_GUESTS",
      "OPENSTACK_CLOUD_VIEW_GUEST_DETAIL",
      "OPENSTACK_CLOUD_VIEW_STORAGE =",
      "OPENSTACK_CLOUD_VIEW_STORAGE_DETAIL",
    ]) {
      expect(pageMap).not.toContain(leftover);
    }
  });

  test("Proxmox keeps every route it had", () => {
    /*
     * The script that added OpenStack's siblings wrote some of them over
     * Proxmox's entries. A route gone from RouteMap renders a blank page.
     */
    for (const key of [
      "PROXMOX_CLUSTER_VIEW_NODE_DETAIL",
      "PROXMOX_CLUSTER_VIEW_GUESTS",
      "PROXMOX_CLUSTER_VIEW_GUEST_DETAIL",
      "PROXMOX_CLUSTER_VIEW_STORAGE",
      "PROXMOX_CLUSTER_VIEW_STORAGE_DETAIL",
      "PROXMOX_CLUSTER_VIEW_INSIGHTS",
    ]) {
      expect(routeMap).toContain(`[PageMap.${key}]: new Route(`);
    }
  });

  test("the product is mounted at /openstack", () => {
    expect(routeMap).toContain("/openstack/*");
  });

  test.each([
    ["OPENSTACK_CLOUD_VIEW_SERVICES", "services"],
    ["OPENSTACK_CLOUD_VIEW_HYPERVISORS", "hypervisors"],
    ["OPENSTACK_CLOUD_VIEW_INSTANCES", "instances"],
    ["OPENSTACK_CLOUD_VIEW_FLAVORS", "flavors"],
    ["OPENSTACK_CLOUD_VIEW_NETWORKS", "networks"],
    ["OPENSTACK_CLOUD_VIEW_ROUTERS", "routers"],
    ["OPENSTACK_CLOUD_VIEW_FLOATING_IPS", "floating-ips"],
    ["OPENSTACK_CLOUD_VIEW_VOLUMES", "volumes"],
    ["OPENSTACK_CLOUD_VIEW_STORAGE_POOLS", "storage-pools"],
    ["OPENSTACK_CLOUD_VIEW_IMAGES", "images"],
    ["OPENSTACK_CLOUD_VIEW_PROJECTS", "projects"],
    ["OPENSTACK_CLOUD_VIEW_AVAILABILITY_ZONES", "availability-zones"],
    ["OPENSTACK_CLOUD_VIEW_AGGREGATES", "aggregates"],
    ["OPENSTACK_CLOUD_VIEW_SUBNETS", "subnets"],
    ["OPENSTACK_CLOUD_VIEW_NETWORK_AGENTS", "network-agents"],
    ["OPENSTACK_CLOUD_VIEW_SNAPSHOTS", "snapshots"],
  ])("%s lives at OpenStack's own word, %s", (key: string, segment: string) => {
    expect(dense(routeMap)).toContain(
      `[PageMap.${key}]:\`\${RouteParams.ModelID}/${segment}\``,
    );
  });
});

describe("every page of this merge is mounted, and nothing else is", () => {
  const routes: string = readSource("Routes", "OpenStackRoutes.tsx");
  const routeCode: string = stripComments(routes);

  test.each(MOUNTED_VIEW_PAGES)(
    "Pages/OpenStack/View/%s exists and is routed for %s",
    (file: string, key: string) => {
      expect(
        fs.existsSync(
          path.join(DASHBOARD_SRC, "Pages", "OpenStack", "View", file),
        ),
      ).toBe(true);
      expect(routeCode).toContain(
        `from "../Pages/OpenStack/View/${file.replace(/\.tsx$/, "")}"`,
      );
      expect(dense(routeCode)).toContain(`RouteMap[PageMap.${key}]`);
    },
  );

  test.each(PRODUCT_PAGES)(
    "Pages/OpenStack/%s exists and is routed for %s",
    (segments: Array<string>, key: string) => {
      expect(
        fs.existsSync(
          path.join(DASHBOARD_SRC, "Pages", "OpenStack", ...segments),
        ),
      ).toBe(true);
      expect(routeCode).toContain(
        `from "../Pages/OpenStack/${segments.join("/").replace(/\.tsx$/, "")}"`,
      );
      expect(dense(routeCode)).toContain(`RouteMap[PageMap.${key}]`);
    },
  );

  test("no page of a later issue, or of Proxmox's, is imported", () => {
    for (const page of [
      "Insights",
      "Nodes",
      "NodeDetail",
      "Guests",
      "GuestDetail",
      'Storage"',
      "StorageDetail",
    ]) {
      expect(routeCode).not.toContain(`/OpenStack/View/${page}`);
    }
  });

  test("the cloud view renders the Overview by default", () => {
    // Otherwise a link to /openstack/:id lands on a blank layout.
    expect(
      pageRoutesIn(path.join(DASHBOARD_SRC, "Routes", "OpenStackRoutes.tsx")),
    ).toContainEqual({
      index: "true",
      element:
        "<OpenStackCloudOverview {...props} pageRoute={RouteMap[PageMap.OPENSTACK_CLOUD_VIEW] as Route} />",
    });
  });

  test("no View page on disk is left unrouted", () => {
    const onDisk: Array<string> = [
      ...fs
        .readdirSync(path.join(DASHBOARD_SRC, "Pages", "OpenStack", "View"))
        .filter((file: string): boolean => {
          return (
            file.endsWith(".tsx") &&
            file !== "Layout.tsx" &&
            file !== "SideMenu.tsx"
          );
        }),
      ...fs
        .readdirSync(
          path.join(DASHBOARD_SRC, "Pages", "OpenStack", "View", "AI"),
        )
        .map((file: string): string => {
          return `AI/${file}`;
        }),
    ].sort();

    expect(onDisk).toEqual(
      MOUNTED_VIEW_PAGES.map((entry: [string, string]): string => {
        return entry[0];
      }).sort(),
    );
  });

  test("AllRoutes exports the product", () => {
    expect(readSource("Routes", "AllRoutes.tsx")).toContain(
      'export { default as OpenStackRoutes } from "./OpenStackRoutes";',
    );
  });

  test("App.tsx gives OpenStack a route of its own, and leaves Proxmox's whole", () => {
    const routes: Array<RouteAttributes> = pageRoutesIn(
      path.join(DASHBOARD_SRC, "App.tsx"),
    );

    expect(dense(readSource("App.tsx"))).toContain(
      'lazy(()=>{returnimport("./Routes/OpenStackRoutes");})',
    );
    expect(routesAt(routes, routeMapPath("OPENSTACK_ROOT"))).toEqual([
      {
        path: routeMapPath("OPENSTACK_ROOT"),
        element: "<OpenStackRoutes {...commonPageProps} />",
      },
    ]);
    expect(routesAt(routes, routeMapPath("PROXMOX_ROOT"))).toEqual([
      {
        path: routeMapPath("PROXMOX_ROOT"),
        element: "<ProxmoxRoutes {...commonPageProps} />",
      },
    ]);
  });
});

/*
 * A route below a cloud's layout has to match all that is left of the address, so one that takes fewer
 * segments than its address has never matches and its page is blank. Only in the real app: the E2E
 * fixture mounts each page at its whole address, and a live run is what found this.
 */
describe("a page's route is as deep as its address", () => {
  const routeMap: string = readSource("Utils", "RouteMap.ts");
  const mounted: Array<[string, number]> = Array.from(
    stripComments(readSource("Routes", "OpenStackRoutes.tsx")).matchAll(
      /getLastPathForKey\(\s*PageMap\.([A-Z_]+)(?:,\s*(\d+))?,?\s*\)/g,
    ),
  ).map((match: RegExpMatchArray): [string, number] => {
    return [match[1]!, Number(match[2] || 1)];
  });

  test("the routes are found, so the checks below check something", () => {
    expect(mounted.length).toBeGreaterThan(70);
    expect(mounted).toContainEqual([
      "OPENSTACK_CLOUD_VIEW_HYPERVISOR_DETAIL",
      2,
    ]);
  });

  test.each(mounted)("%s takes %d", (key: string, count: number) => {
    const below: string | undefined = new RegExp(
      `\\[PageMap\\.${key}\\]:\\s*\`\\$\\{RouteParams\\.ModelID\\}/([^\`]+)\``,
    ).exec(routeMap)?.[1];

    // Only the product's own Documentation isn't below a cloud, and it is one segment.
    expect(count).toBe(below ? below.split("/").length : 1);
  });
});

describe("the side menus have no dead links", () => {
  const routes: string = stripComments(
    readSource("Routes", "OpenStackRoutes.tsx"),
  );

  test.each([
    ["the product menu", ["Pages", "OpenStack", "SideMenu.tsx"]],
    ["the cloud menu", ["Pages", "OpenStack", "View", "SideMenu.tsx"]],
  ])("%s links only to mounted pages", (_name: string, file: Array<string>) => {
    const links: Array<string> = linkedPageKeysOf(
      stripComments(readSource(...file)),
    );

    expect(links.length).toBeGreaterThan(3);
    for (const key of links) {
      expect(dense(routes)).toContain(`RouteMap[PageMap.${key}]`);
    }
  });

  test("the product menu links to the list, archive, docs and rules", () => {
    const sideMenu: string = dense(
      readSource("Pages", "OpenStack", "SideMenu.tsx"),
    );

    for (const key of PRODUCT_PAGE_KEYS) {
      expect(sideMenu).toContain(`RouteMap[PageMap.${key}]asRoute`);
    }
  });

  test("the cloud menu's sections are the product's, in order", () => {
    const sideMenu: string = stripComments(
      readSource("Pages", "OpenStack", "View", "SideMenu.tsx"),
    );
    const titles: Array<string> = Array.from(
      sideMenu.matchAll(/<SideMenuSection title="([^"]+)"/g),
    ).map((match: RegExpMatchArray): string => {
      return match[1] as string;
    });

    expect(titles).toEqual([
      "Basic",
      "AI",
      "Control Plane",
      "Compute",
      "Bare Metal",
      "Network",
      "Storage",
      "Orchestration",
      "Tenancy",
      "Telemetry",
      "Activity",
      "Advanced",
    ]);
  });

  test("the cloud menu reaches every page but the guide the Overview links to", () => {
    const sideMenu: string = dense(
      readSource("Pages", "OpenStack", "View", "SideMenu.tsx"),
    );

    for (const key of VIEW_PAGE_KEYS) {
      /*
       * The guide is linked from the Overview, a part's page from its row, and one thing
       * the cloud stands on from its line on the Control Plane card.
       */
      if (
        key === "OPENSTACK_CLOUD_VIEW_DOCUMENTATION" ||
        key === "OPENSTACK_CLOUD_VIEW_CONTROL_PLANE_DEPENDENCY" ||
        key.endsWith("_DETAIL")
      ) {
        continue;
      }
      expect(sideMenu).toContain(`RouteMap[PageMap.${key}]asRoute`);
    }
    expect(
      dense(readSource("Pages", "OpenStack", "View", "Index.tsx")),
    ).toContain("RouteMap[PageMap.OPENSTACK_CLOUD_VIEW_DOCUMENTATION]asRoute");
    expect(
      dense(
        readSource("Components", "OpenStack", "OpenStackControlPlaneCard.tsx"),
      ),
    ).toContain("routes.getDependencyRoute(dependency)");
    expect(
      dense(
        readSource("Components", "OpenStack", "Part", "OpenStackPartRoutes.ts"),
      ),
    ).toContain("PageMap.OPENSTACK_CLOUD_VIEW_CONTROL_PLANE_DEPENDENCY");
  });

  test("the badges come from the inventory summary, under the same names", () => {
    const layout: string = squash(
      readSource("Pages", "OpenStack", "View", "Layout.tsx"),
    );
    const sideMenu: string = squash(
      readSource("Pages", "OpenStack", "View", "SideMenu.tsx"),
    );
    const reader: string = squash(
      readSource("Pages", "OpenStack", "Utils", "OpenStackResourceUtils.ts"),
    );

    expect(reader).toContain(
      '.addRoute("/openstack-resource/inventory-summary/")',
    );
    // Of the region being read, so a badge never says what a page beneath it doesn't.
    expect(layout).toContain("fetchOpenStackInventorySummary(modelId, region)");
    for (const [summaryKey, countKey] of [
      ["serviceCount", "services"],
      ["hypervisorCount", "hypervisors"],
      ["instanceCount", "instances"],
      ["networkCount", "networks"],
      ["routerCount", "routers"],
      ["floatingIpCount", "floatingIps"],
      ["volumeCount", "volumes"],
      ["projectCount", "projects"],
      ["stackCount", "stacks"],
      ["containerClusterCount", "containerClusters"],
      ["shareCount", "shares"],
      ["databaseInstanceCount", "databases"],
      ["objectContainerCount", "objectContainers"],
      ["dnsZoneCount", "dnsZones"],
    ] as Array<[string, string]>) {
      expect(reader).toContain(`${summaryKey}: readNumber("${summaryKey}")`);
      expect(layout).toContain(`${countKey}: summary.${summaryKey}`);
      expect(sideMenu).toContain(`badge={counts.${countKey}}`);
    }
  });

  test("the activity counts scope by the openStackClouds relation", () => {
    const sideMenu: string = squash(
      readSource("Pages", "OpenStack", "View", "SideMenu.tsx"),
    );

    expect(sideMenu).toContain(
      "openStackClouds: new Includes([props.modelId])",
    );
    expect(sideMenu).not.toContain("proxmoxClusters");
  });
});

describe("a service a cloud may not run", () => {
  const sideMenu: string = squash(
    readSource("Pages", "OpenStack", "View", "SideMenu.tsx"),
  );

  test.each([
    ["Stacks", "runsHeat"],
    ["Shares", "runsManila"],
    ["Databases", "runsTrove"],
    ["Object Storage", "runsSwift"],
    ["DNS Zones", "runsDesignate"],
    ["Kubernetes Clusters", "runsMagnum"],
  ])(
    "%s is in the menu only for a cloud that runs it",
    (title: string, flag: string) => {
      const entry: number = sideMenu.indexOf(`title: "${title}"`);
      expect(entry).toBeGreaterThan(0);
      expect(
        sideMenu.substring(0, entry).lastIndexOf(`{${flag} ? (`),
      ).toBeGreaterThan(0);
    },
  );

  test("the section itself only for a cloud that runs one of them", () => {
    const section: number = sideMenu.indexOf(
      '<SideMenuSection title="Orchestration">',
    );
    expect(sideMenu.substring(section - 30, section)).toContain(
      "runsHeat || runsMagnum ? (",
    );
  });

  test("what it runs is from its rows, in the region being read, never a setting", () => {
    expect(
      squash(readSource("Pages", "OpenStack", "View", "Layout.tsx")),
    ).toContain("optionalServices: summary.optionalServices");
    expect(
      squash(
        fs.readFileSync(
          path.join(
            REPO_ROOT,
            "packages",
            "App",
            "FeatureSet",
            "Dashboard",
            "src",
            "Pages",
            "OpenStack",
            "Utils",
            "OpenStackResourceUtils.ts",
          ),
          "utf8",
        ),
      ),
    ).toContain("optionalServices: getOpenStackOptionalServicesOf(services)");
  });
});

describe("a page's limited view notice", () => {
  /*
   * The notice counts the page's rows by project, so a kind that can't be counted fails its
   * whole read: the request is refused and the notice never shows. Only a live stack showed it.
   */
  test("is only given a kind that can be counted by project", () => {
    const viewFolder: string = path.join(
      __dirname,
      "../../FeatureSet/Dashboard/src/Pages/OpenStack/View",
    );
    const kinds: Set<string> = new Set<string>();

    for (const file of fs.readdirSync(viewFolder)) {
      if (!file.endsWith(".tsx")) {
        continue;
      }

      const source: string = fs.readFileSync(
        path.join(viewFolder, file),
        "utf8",
      );

      for (const match of source.matchAll(
        /<OpenStackLimitedViewNotice\b[^>]*?kind=\{OpenStackResourceKind\.([A-Za-z]+)\}/g,
      )) {
        kinds.add(match[1] as string);
      }
    }

    expect(kinds.size).toBeGreaterThan(5);

    for (const kind of kinds) {
      expect({
        kind,
        isCountable: isOpenStackCountable(
          OpenStackResourceKind[kind as keyof typeof OpenStackResourceKind],
          "project",
        ),
      }).toEqual({ kind, isCountable: true });
    }
  });
});

describe("every page has a breadcrumb trail", () => {
  const breadcrumbs: string = squash(
    readSource("Utils", "Breadcrumbs", "OpenStackBreadcrumbs.ts"),
  );

  test.each(
    EVERY_PAGE_KEY.filter((key: string): boolean => {
      return key !== "OPENSTACK_ROOT";
    }),
  )("%s has a trail", (key: string) => {
    expect(breadcrumbs).toContain(`PageMap.${key}`);
  });

  test("the trails use OpenStack's words", () => {
    expect(breadcrumbs).toContain('"View Cloud"');
    expect(breadcrumbs).toContain('"Hypervisors"');
    expect(breadcrumbs).not.toContain('"Nodes"');
    expect(breadcrumbs).not.toContain('"Guests"');
  });

  test("the barrel exports the module, and both layouts read it", () => {
    expect(readSource("Utils", "Breadcrumbs", "index.ts")).toContain(
      './OpenStackBreadcrumbs"',
    );
    expect(readSource("Pages", "OpenStack", "Layout.tsx")).toContain(
      "getOpenStackBreadcrumbs(path)",
    );
    expect(readSource("Pages", "OpenStack", "View", "Layout.tsx")).toContain(
      "getOpenStackBreadcrumbs(path)",
    );
  });
});

describe("the navbar link exists and is not commented out", () => {
  const navBarRaw: string = readSource("Utils", "NavigationItems.tsx");
  const navBar: string = squash(navBarRaw);

  test("there is a live OpenStack entry", () => {
    expect(squash(stripComments(navBarRaw))).toContain(
      't("navbar.items.openstackTitle", "OpenStack")',
    );
    expect(dense(navBarRaw)).toContain('t("navbar.items.openstackDescription"');
  });

  test("the entry routes to the product", () => {
    expect(navBar).toContain("RouteMap[PageMap.OPENSTACK_CLOUDS] as Route");
    expect(navBar).toContain("activeRoute: RouteMap[PageMap.OPENSTACK_CLOUDS]");
  });

  test("the entry uses the neutral icon, and none of Proxmox's words", () => {
    const start: number = navBar.indexOf('t("navbar.items.openstackTitle"');
    const entry: string = navBar.slice(start, start + 700);

    expect(entry).toContain("icon: IconProp.Cloud");
    expect(entry).not.toContain('"pve"');
    expect(entry).not.toContain('"lxc"');
    expect(entry).not.toContain("nodes and guests");
  });
});

describe("the locale keys", () => {
  const LOCALES_DIR: string = path.join(DASHBOARD_SRC, "Locales");
  const english: Record<string, any> = JSON.parse(
    fs.readFileSync(path.join(LOCALES_DIR, "en.json"), "utf8"),
  );
  const items: Record<string, string> = english["navbar"]["items"];

  test("English carries the nav keys the entry reads", () => {
    /*
     * The other sixteen languages come with the translation pass, which also
     * adds their placeholders (npm run i18n:extract). i18next shows a missing
     * nested key as the key itself, so the entry's own English is what is pinned.
     */
    expect(items["openstackTitle"]).toBe("OpenStack");
    expect(items["openstackDescription"]).toBe(
      "Monitor OpenStack clouds, services, hypervisors and instances.",
    );
    expect(squash(readSource("Utils", "NavigationItems.tsx"))).toContain(
      '"Monitor OpenStack clouds, services, hypervisors and instances."',
    );
  });

  test("the keys sit after VMware's, which stay right after Proxmox's", () => {
    const lines: Array<string> = fs
      .readFileSync(path.join(LOCALES_DIR, "en.json"), "utf8")
      .split("\n");
    const vmware: number = lines.findIndex((line: string): boolean => {
      return line.includes('"vmwareDescription":');
    });

    expect(lines[vmware + 1]).toContain('"openstackTitle": "OpenStack"');
    expect(lines[vmware + 2]).toContain('"openstackDescription":');
  });
});

describe("the neutral icon, until the trademark check (#5751)", () => {
  test.each(
    [
      ...OWN_FILES,
      path.join(DASHBOARD_SRC, "Utils", "NavigationItems.tsx"),
      path.join(
        DASHBOARD_SRC,
        "Components",
        "AffectedResources",
        "AffectedResourcesPicker.tsx",
      ),
      path.join(
        DASHBOARD_SRC,
        "Components",
        "AffectedResources",
        "AffectedResourcesDisplay.tsx",
      ),
      path.join(
        DASHBOARD_SRC,
        "Components",
        "AffectedResources",
        "buildAffectedResourcesFacet.ts",
      ),
      path.join(
        DASHBOARD_SRC,
        "Components",
        "Inventory",
        "InventoryTypeCatalog.ts",
      ),
      path.join(
        DASHBOARD_SRC,
        "Components",
        "CommandPalette",
        "PageSearchIndex.ts",
      ),
    ].map((file: string): string => {
      return path.relative(DASHBOARD_SRC, file);
    }),
  )("%s has no IconProp.OpenStack", (relative: string) => {
    expect(
      fs.readFileSync(path.join(DASHBOARD_SRC, relative), "utf8"),
    ).not.toContain("IconProp.OpenStack");
  });

  test("the showcase draws the same icon", () => {
    expect(OPENSTACK_CLOUD_SHOWCASE.icon).toBe("Cloud");
  });
});

/*
 * A Ceph cluster is a Proxmox page's word, and nothing a Proxmox clone should carry here. A
 * Cinder pool's link to the Ceph product is the one real exception, in the two files whose
 * whole job it is, and they need one word for it: the ID of the cluster an operator chose.
 * Any other Ceph identifier, in these two or anywhere else, is still a leftover.
 */
const CEPH_LINK_IDENTIFIER: string = "cephClusterId";
const CEPH_LINK_FILES: ReadonlyArray<string> = [
  path.join(
    "Components",
    "OpenStack",
    "Part",
    "OpenStackStoragePoolCephCard.tsx",
  ),
  path.join("Pages", "OpenStack", "Utils", "OpenStackLinkReads.ts"),
];

function withoutTheCephLink(relative: string, source: string): string {
  return CEPH_LINK_FILES.includes(relative)
    ? source.replace(new RegExp(`\\b${CEPH_LINK_IDENTIFIER}\\b`, "g"), "")
    : source;
}

describe("no Proxmox concept leaked into the OpenStack pages", () => {
  test("there are OpenStack sources to scan", () => {
    expect(OWN_FILES.length).toBeGreaterThan(30);
  });

  test("the two files that link a pool to Ceph are scanned, and still need the word", () => {
    const scanned: Array<string> = OWN_FILES.map((file: string): string => {
      return path.relative(DASHBOARD_SRC, file);
    });
    for (const relative of CEPH_LINK_FILES) {
      expect(scanned).toContain(relative);
      expect(readSource(relative)).toContain(CEPH_LINK_IDENTIFIER);
    }
  });

  test("the exception is that one word, and takes nothing else with it", () => {
    const cephCard: string = CEPH_LINK_FILES[0] as string;
    expect(
      withoutTheCephLink(cephCard, "cephClusterId cephClusterName"),
    ).toContain("cephCluster");
    expect(
      withoutTheCephLink(cephCard, "const cephClusterId: CephCluster"),
    ).toContain("CephCluster");
    expect(
      withoutTheCephLink(
        path.join("Pages", "OpenStack", "View", "Index.tsx"),
        "cephClusterId",
      ),
    ).toContain("cephCluster");
  });

  test.each(
    OWN_FILES.map((file: string): string => {
      return path.relative(DASHBOARD_SRC, file);
    }),
  )("%s carries no Proxmox identifiers", (relative: string) => {
    const source: string = withoutTheCephLink(
      relative,
      stripComments(
        fs.readFileSync(path.join(DASHBOARD_SRC, relative), "utf8"),
      ),
    );

    // A storage pool's page names the Ceph cluster behind it, which is no leak: it means to.
    const mayNameCeph: boolean =
      relative.endsWith("OpenStackStoragePoolCephCard.tsx") ||
      relative.endsWith("OpenStackUsageReads.ts");

    for (const forbidden of [
      "ProxmoxCluster",
      "proxmoxCluster",
      "PROXMOX_",
      "pve_",
      "pveVersion",
      "pve-",
      ...(mayNameCeph ? [] : ["cephCluster", "CephCluster"]),
      "QEMU",
      "isBackedUp",
      "A OpenStack",
      " a OpenStack",
    ]) {
      expect(source).not.toContain(forbidden);
    }
  });

  test("every telemetry page scopes on the openstack.cloud.name resource attribute", () => {
    for (const file of ["Metrics.tsx", "Logs.tsx"]) {
      expect(readSource("Pages", "OpenStack", "View", file)).toContain(
        '"resource.openstack.cloud.name"',
      );
    }
  });

  test("the pages use openstack- prefixed preference keys", () => {
    expect(readSource("Pages", "OpenStack", "Clouds.tsx")).toContain(
      'userPreferencesKey="openstack-clouds-table"',
    );
    expect(readSource("Pages", "OpenStack", "Archived.tsx")).toContain(
      'userPreferencesKey="openstack-archived-table"',
    );
  });
});

describe("the All Clouds list", () => {
  const clouds: string = squash(readSource("Pages", "OpenStack", "Clouds.tsx"));

  test("counts regions, hypervisors and instances", () => {
    expect(clouds).toContain("regionCount: true");
    expect(clouds).toContain("hypervisorCount: true");
    expect(clouds).toContain("instanceCount: true");
  });
});

describe("the inventory lists read on the server", () => {
  const list: string = readSource(
    "Components",
    "OpenStack",
    "OpenStackResourceList.tsx",
  );

  test("the generic list queries by cloud and kind, a page at a time", () => {
    const code: string = dense(stripComments(list));

    expect(code).toContain("<ModelTable<OpenStackResource>");
    expect(code).toContain("openStackCloudId:props.openStackCloudId");
    expect(code).toContain("kind:props.kind");
    // Nothing reads every row of a kind and hands the table an array.
    expect(code).not.toContain("disablePagination");
    expect(code).not.toContain("LIMIT_PER_PROJECT");
  });

  test("Projects.tsx lists through it, and says why it can be empty", () => {
    const page: string = readSource(
      "Pages",
      "OpenStack",
      "View",
      "Projects.tsx",
    );

    expect(page).toContain("<OpenStackResourceList");
    expect(page).toContain("emptyTitle=");
    expect(page).toContain("emptyDescription=");
    expect(page).not.toContain("ResourceTable");
    expect(page).not.toContain("LIMIT_PER_PROJECT");
  });

  /*
   * A kind's list is one component, because a list on a part's page has to read the same
   * as the page of its own: the instances on a hypervisor are the Instances list, narrowed.
   */
  test.each([
    ["Hypervisors.tsx", "OpenStackHypervisorList"],
    ["Instances.tsx", "OpenStackInstanceList"],
    ["Flavors.tsx", "OpenStackFlavorList"],
    ["Networks.tsx", "OpenStackNetworkList"],
    ["Subnets.tsx", "OpenStackSubnetList"],
    ["Routers.tsx", "OpenStackRouterList"],
    ["FloatingIps.tsx", "OpenStackFloatingIpList"],
    ["NetworkAgents.tsx", "OpenStackNetworkAgentList"],
    ["Volumes.tsx", "OpenStackVolumeList"],
    ["StoragePools.tsx", "OpenStackStoragePoolList"],
    ["Images.tsx", "OpenStackImageList"],
    ["Snapshots.tsx", "OpenStackSnapshotList"],
    ["Snapshots.tsx", "OpenStackBackupList"],
  ])(
    "%s lists through %s, which reads on the server and says why it can be empty",
    (file: string, listName: string) => {
      const page: string = readSource("Pages", "OpenStack", "View", file);
      expect(page).toContain(`<${listName}`);
      expect(page).not.toContain("ResourceTable");
      expect(page).not.toContain("LIMIT_PER_PROJECT");

      const lists: string = readSource(
        "Components",
        "OpenStack",
        "OpenStackLists.tsx",
      );
      const start: number = lists.indexOf(`export const ${listName}:`);
      expect(start).toBeGreaterThan(-1);
      const next: number = lists.indexOf("export const ", start + 1);
      const own: string = lists.slice(start, next === -1 ? undefined : next);
      expect(own).toContain("<OpenStackResourceList");
      expect(own).toContain("emptyTitle=");
      expect(own).toContain("emptyDescription=");
    },
  );

  test("the Services page reads every service and worker at once, because it groups them", () => {
    const page: string = readSource(
      "Pages",
      "OpenStack",
      "View",
      "Services.tsx",
    );
    const reads: string = dense(
      readSource("Pages", "OpenStack", "Utils", "OpenStackOverviewReads.ts"),
    );

    /*
     * What needs someone first can't be put first in a list holding a page of it. There
     * are few of these even on a large cloud, and one more than a read holds says so.
     */
    expect(page).toContain("fetchOpenStackServiceRows");
    expect(page).toContain("getOpenStackServiceGroups");
    expect(page).toContain("rows.leftOut");
    expect(reads).toContain("kind:kind");
    expect(reads).toContain("limit:OPENSTACK_WORKERS_READ_WHOLE");
    expect(reads).toContain("read(OpenStackResourceKind.Api)");
    expect(reads).toContain("read(OpenStackResourceKind.Service)");
    expect(reads).not.toContain("read(OpenStackResourceKind.Instance)");
  });

  test("the Overview and the lists say allocated, never CPU or usage", () => {
    const hypervisors: string = readSource(
      "Components",
      "OpenStack",
      "OpenStackLists.tsx",
    );
    const overview: string = readSource(
      "Pages",
      "OpenStack",
      "View",
      "Index.tsx",
    );

    for (const title of [
      'title: "vCPUs Allocated"',
      'title: "Memory Allocated"',
      'title: "Disk Allocated"',
    ]) {
      expect(hypervisors).toContain(title);
    }
    for (const title of [
      'title="vCPUs allocated"',
      'title="Memory allocated"',
      'title="Storage used"',
    ]) {
      expect(overview).toContain(title);
    }
    for (const source of [hypervisors, overview]) {
      expect(source).not.toMatch(/title(=|: )"CPU"/);
      expect(source).not.toMatch(/title(=|: )"[^"]*[Uu]sage[^"]*"/);
    }
  });

  test("the Overview's verdict is the rules', on the card every product uses", () => {
    const code: string = stripComments(
      readSource("Pages", "OpenStack", "View", "Index.tsx"),
    );

    expect(code).toContain("getOpenStackAttentionItems({");
    expect(code).toContain("getOpenStackHealth(items)");
    expect(code).toContain("<NeedsAttentionCard");
    // Nothing on the page judges for itself: a bar's colour is the same rules' too.
    expect(code).toContain("hasOpenStackHostPastAllocationLine(rows, kind)");
    expect(code).toContain("getOpenStackPoolTone(fullestPoolPercent)");
  });

  test("the Overview asks nothing current of a cloud that has stopped reporting", () => {
    const code: string = dense(
      stripComments(readSource("Pages", "OpenStack", "View", "Index.tsx")),
    );

    expect(code).toContain(
      "constloadReads:()=>void=():void=>{if(!isConnectedRef.current){",
    );
  });

  test("a read of a region can't land after the reader has left it", () => {
    const code: string = dense(
      stripComments(readSource("Pages", "OpenStack", "View", "Index.tsx")),
    );

    expect(code).toContain("sequence!==summarySequence.current");
    expect(code).toContain("sequence===consumersSequence.current");
    expect(code).toContain("sequence!==healthSequence.current");
  });

  test.each([
    ["region-summaries", "OpenStackOverviewReads.ts"],
    ["top-consumers", "OpenStackOverviewReads.ts"],
    ["needs-attention", "OpenStackOverviewReads.ts"],
    ["inventory-summary", "OpenStackResourceUtils.ts"],
  ])(
    "the Overview's read of %s is one the server answers, for a region when it's given one",
    (route: string, reader: string) => {
      const api: string = fs.readFileSync(
        path.join(
          REPO_ROOT,
          "packages",
          "Common",
          "Server",
          "API",
          "OpenStackResourceAPI.ts",
        ),
        "utf8",
      );

      expect(readSource("Pages", "OpenStack", "Utils", reader)).toContain(
        `/openstack-resource/${route}/`,
      );
      // Registered by name, or at the head of a path of its own.
      expect(stripComments(api)).toMatch(
        new RegExp(`"${route}"|/${route}/:cloudId`),
      );
    },
  );

  test("a cloud with nothing reported shows the guide, not zeros", () => {
    const overview: string = squash(
      readSource("Pages", "OpenStack", "View", "Index.tsx"),
    );

    expect(overview).toContain("isOpenStackInventoryEmpty(summary)");
    expect(overview).toContain("<OpenStackDocumentationCard");
    // And a failed read says so, with Try again.
    expect(overview).toContain("<ResourcePartReadError");
    expect(overview).toContain("onRetry={");
  });
});

describe("the setup guide is true for agents/OpenStackAgent", () => {
  const URL: string = "https://oneuptime.example.com";
  const KEY: string = "tik_secret_123";

  const METHODS: Array<OpenStackConnectMethod> = OPENSTACK_CONNECT_METHODS.map(
    (option: SetupGuideOption<OpenStackConnectMethod>) => {
      return option.key;
    },
  );

  const guideFor: (
    method: OpenStackConnectMethod,
    cloudName?: string,
  ) => SetupGuideContent = (
    method: OpenStackConnectMethod,
    cloudName?: string,
  ): SetupGuideContent => {
    return getOpenStackSetupGuide({
      oneuptimeUrl: URL,
      apiKey: KEY,
      hasApiKey: true,
      method: method,
      cloudName: cloudName,
    });
  };

  const collectorConfig: string = fs.readFileSync(
    path.join(AGENT_DIR, "otel-collector-config.yaml"),
    "utf8",
  );
  const compose: string = fs.readFileSync(
    path.join(AGENT_DIR, "docker-compose.yml"),
    "utf8",
  );

  test("the identity lines it shows are the shipped config's", () => {
    /*
     * Ingest registers the cloud from openstack.cloud.name. A guide that tells a
     * reader anything else registers nothing, and says so nowhere.
     */
    for (const line of OPENSTACK_AGENT_IDENTITY_CONFIG.split("\n")) {
      expect(collectorConfig).toContain(line.trimEnd());
    }

    const shipped: any = yaml.load(collectorConfig);
    const shown: any = yaml.load(OPENSTACK_AGENT_IDENTITY_CONFIG);

    expect(shown.processors.resource.attributes).toEqual(
      shipped.processors.resource.attributes,
    );
  });

  test("the version it reports is the one the Dashboard calls current", () => {
    /*
     * The config reports this as the cloud's Agent Version, and the Dashboard puts
     * a sign beside an agent that reports less than AgentKind.ts says is current.
     */
    const shipped: any = yaml.load(collectorConfig);
    const reported: string = shipped.processors.resource.attributes.find(
      (attribute: { key: string }): boolean => {
        return attribute.key === "oneuptime.agent.version";
      },
    ).value;

    expect(
      squash(readSource("Components", "AgentVersion", "AgentKind.ts")),
    ).toContain(`OPENSTACK_AGENT_VERSION: string = "${reported}"`);
  });

  test("every variable the agent reads is documented", () => {
    const names: Set<string> = new Set<string>();
    for (const match of compose.matchAll(/\$\{([A-Z_]+)[:}-]/g)) {
      names.add(match[1] as string);
    }

    expect(names.size).toBeGreaterThan(4);

    for (const method of METHODS) {
      const text: string = getSetupGuideMarkdown(guideFor(method));
      for (const name of names) {
        expect(text).toContain(`\`${name}\``);
      }
    }
  });

  test("the containers it names are the shipped compose file's", () => {
    expect(compose).toContain(`container_name: ${OPENSTACK_AGENT_CONTAINER}`);
    expect(compose).toContain(
      `container_name: ${OPENSTACK_EXPORTER_CONTAINER}`,
    );
  });

  test("the install directory is the install script's", () => {
    const script: string = fs.readFileSync(
      path.join(AGENT_DIR, "install.sh"),
      "utf8",
    );

    expect(script).toContain(
      `DEFAULT_INSTALL_DIR="${OPENSTACK_AGENT_INSTALL_DIR}"`,
    );
  });

  test("every file it downloads is served at /install/openstack-agent", () => {
    const entry: InstallScriptEntry | null = getInstallScriptEntry(
      InstallScriptName.OpenStackAgent,
    );
    const pattern: RegExp =
      /https:\/\/oneuptime\.example\.com\/install\/openstack-agent\/([A-Za-z0-9._/-]+)/g;

    expect(entry).toBeDefined();

    let seen: number = 0;
    for (const method of METHODS) {
      const text: string = getSetupGuideMarkdown(guideFor(method));
      for (const match of text.matchAll(pattern)) {
        seen++;
        expect(entry!.files).toContain(match[1]);
        // And the file is in the folder the App image serves it from.
        expect(fs.existsSync(path.join(AGENT_DIR, match[1] as string))).toBe(
          true,
        );
      }
    }
    expect(seen).toBeGreaterThan(5);
  });

  test("the access files it names exist", () => {
    expect(
      fs.existsSync(
        path.join(AGENT_DIR, "access", OPENSTACK_ACCESS_RULES_FILE),
      ),
    ).toBe(true);
    for (const file of OPENSTACK_POLICY_FILES) {
      const policy: string = fs.readFileSync(
        path.join(AGENT_DIR, "access", "policy", file),
        "utf8",
      );
      expect(policy).toContain(OPENSTACK_MONITORING_ROLE);
    }
  });

  test("the install command is the one the product publishes", () => {
    expect(
      getOpenStackInstallScriptCommand({
        oneuptimeUrl: URL,
        apiKey: SETUP_GUIDE_API_KEY_PLACEHOLDER,
        hasApiKey: false,
      }),
    ).toBe(
      `curl -fsSL ${URL}/install/openstack-agent -o install.sh && bash install.sh`,
    );
  });

  test("the reader's URL, key and cloud name are in the command", () => {
    const command: string = getOpenStackInstallScriptCommand({
      oneuptimeUrl: URL,
      apiKey: KEY,
      hasApiKey: true,
      cloudName: "prod-eu",
    });

    expect(command).toContain(`ONEUPTIME_URL=${URL}`);
    expect(command).toContain(`ONEUPTIME_TELEMETRY_INGESTION_KEY=${KEY}`);
    expect(command).toContain("OPENSTACK_CLOUD_NAME=prod-eu");
    expect(command).toContain("bash install.sh");
  });

  test("a placeholder key never reaches the command, or the script's .env", () => {
    const command: string = getOpenStackInstallScriptCommand({
      oneuptimeUrl: URL,
      apiKey: SETUP_GUIDE_API_KEY_PLACEHOLDER,
      hasApiKey: false,
    });

    expect(command).not.toContain(SETUP_GUIDE_API_KEY_PLACEHOLDER);
    expect(command).not.toContain("ONEUPTIME_TELEMETRY_INGESTION_KEY");
  });

  test("no credential is ever put on a command line", () => {
    for (const method of METHODS) {
      for (const block of getSetupGuideCodeBlocks(guideFor(method))) {
        expect(block).not.toMatch(/OPENSTACK_APPLICATION_CREDENTIAL_SECRET=/);
        expect(block).not.toMatch(/OS_APPLICATION_CREDENTIAL_SECRET=/);
      }
    }
  });

  test("it says plainly that OpenStack has no global read-only role", () => {
    for (const method of METHODS) {
      const step: SetupGuideStep = guideFor(method).steps[0] as SetupGuideStep;

      expect(step.description).toContain(
        "OpenStack has no global read-only role",
      );
    }
  });

  test("it names the three levels of #5721, and leads with Full view", () => {
    const step: SetupGuideStep = guideFor("install-script")
      .steps[0] as SetupGuideStep;
    const variants: Array<SetupGuideStepVariant> = step.variants || [];

    expect(
      variants.map((variant: SetupGuideStepVariant): string => {
        return variant.label;
      }),
    ).toEqual(["Full view", "Infrastructure only", "Project view"]);

    expect(variants[0]!.markdown).toContain("--access-rules");
    expect(variants[0]!.markdown).toContain("Recommended");
    expect(variants[1]!.markdown).toContain(OPENSTACK_MONITORING_ROLE);
    expect(variants[2]!.markdown).toContain("`reader`");
    // Each says what it leaves out.
    expect(variants[1]!.markdown).toContain(
      "appear only for the projects the role is assigned on",
    );
    expect(variants[2]!.markdown).toContain("no infrastructure");
  });

  test("a credential that can write says so", () => {
    const step: SetupGuideStep = guideFor("install-script")
      .steps[0] as SetupGuideStep;

    expect(step.variants![0]!.markdown).toContain(
      "plain admin application credential, which can write",
    );
  });

  test("a known cloud's name goes in every command, and only then", () => {
    const known: string = getSetupGuideMarkdown(
      guideFor("docker-compose", "prod-eu"),
    );
    const unknown: string = getSetupGuideMarkdown(guideFor("docker-compose"));

    expect(known).toContain("OPENSTACK_CLOUD_NAME=prod-eu");
    expect(known).not.toContain(OPENSTACK_EXAMPLE_CLOUD_NAME);
    expect(unknown).toContain(
      `OPENSTACK_CLOUD_NAME=${OPENSTACK_EXAMPLE_CLOUD_NAME}`,
    );
  });

  test("the Compose guide starts the exporter it says it does", () => {
    const text: string = getSetupGuideMarkdown(guideFor("docker-compose"));

    expect(compose).toContain('profiles: ["openstack-exporter"]');
    expect(text).toContain("COMPOSE_PROFILES=openstack-exporter");
    expect(text).toContain("OPENSTACK_EXPORTER_CLOUDS=[RegionOne]");
    expect(text).toContain("auth_type: v3applicationcredential");
  });

  test("the credential it makes expires a year after the guide is read", () => {
    const step: SetupGuideStep = getOpenStackSetupGuide({
      oneuptimeUrl: URL,
      apiKey: KEY,
      hasApiKey: true,
      method: "install-script",
      now: new Date("2026-11-04T10:30:00.000Z"),
    }).steps[0] as SetupGuideStep;

    for (const variant of step.variants || []) {
      expect(variant.markdown).toContain("--expiration 2027-11-04T10:30:00");
    }
  });

  test("the Compose guide gives clouds.yaml to the user the exporter runs as", () => {
    const text: string = getSetupGuideMarkdown(guideFor("docker-compose"));

    expect(compose).toContain("OPENSTACK_EXPORTER_USER:-65532:65532");
    expect(text).toContain("sudo chown 65532:65532 clouds.yaml");
    expect(text).toContain("sudo chmod 600 clouds.yaml");
  });

  test("it leaves Proxmox's words behind", () => {
    for (const method of METHODS) {
      const text: string = getSetupGuideMarkdown(guideFor(method));

      for (const forbidden of [
        "pveum",
        "PVE_",
        "pve-exporter",
        "PVEAuditor",
        "proxmox",
        "Proxmox",
        "guest",
        "native push",
      ]) {
        expect(text).not.toContain(forbidden);
      }
    }
  });
});

describe("the showcase speaks OpenStack", () => {
  const words: string = JSON.stringify(OPENSTACK_CLOUD_SHOWCASE);

  test("in its own words", () => {
    for (const word of ["hypervisor", "instance", "nova-compute"]) {
      expect(words).toContain(word);
    }
  });

  test("with nothing of Proxmox's, and nothing this merge does not ship", () => {
    for (const word of [
      "Proxmox",
      "pve",
      "VM 101",
      "LXC",
      "guests",
      "Backup",
      "Replication",
      // Alerts come with #5729, and the AI with #5746.
      "Recommended monitors",
      "AI agent",
    ]) {
      expect(words).not.toContain(word);
    }
  });
});
