import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import "@testing-library/jest-dom";
import { cleanup } from "@testing-library/react";
import * as React from "react";
import { FunctionComponent, ReactElement } from "react";
import fs from "fs";
import path from "path";
import CephSideMenu from "../../../../App/FeatureSet/Dashboard/src/Pages/Ceph/View/SideMenu";
import DatabaseSideMenu from "../../../../App/FeatureSet/Dashboard/src/Pages/Database/View/SideMenu";
import DockerSideMenu from "../../../../App/FeatureSet/Dashboard/src/Pages/Docker/View/SideMenu";
import DockerSwarmSideMenu from "../../../../App/FeatureSet/Dashboard/src/Pages/DockerSwarm/View/SideMenu";
import HostSideMenu from "../../../../App/FeatureSet/Dashboard/src/Pages/Host/View/SideMenu";
import PodmanSideMenu from "../../../../App/FeatureSet/Dashboard/src/Pages/Podman/View/SideMenu";
import ProxmoxSideMenu from "../../../../App/FeatureSet/Dashboard/src/Pages/Proxmox/View/SideMenu";
import VMwareSideMenu from "../../../../App/FeatureSet/Dashboard/src/Pages/VMware/View/SideMenu";
import { getCephBreadcrumbs } from "../../../../App/FeatureSet/Dashboard/src/Utils/Breadcrumbs/CephBreadcrumbs";
import { getDatabaseBreadcrumbs } from "../../../../App/FeatureSet/Dashboard/src/Utils/Breadcrumbs/DatabaseBreadcrumbs";
import { getDockerBreadcrumbs } from "../../../../App/FeatureSet/Dashboard/src/Utils/Breadcrumbs/DockerBreadcrumbs";
import { getDockerSwarmBreadcrumbs } from "../../../../App/FeatureSet/Dashboard/src/Utils/Breadcrumbs/DockerSwarmBreadcrumbs";
import { getHostBreadcrumbs } from "../../../../App/FeatureSet/Dashboard/src/Utils/Breadcrumbs/HostBreadcrumbs";
import { getPodmanBreadcrumbs } from "../../../../App/FeatureSet/Dashboard/src/Utils/Breadcrumbs/PodmanBreadcrumbs";
import { getProxmoxBreadcrumbs } from "../../../../App/FeatureSet/Dashboard/src/Utils/Breadcrumbs/ProxmoxBreadcrumbs";
import { getVMwareBreadcrumbs } from "../../../../App/FeatureSet/Dashboard/src/Utils/Breadcrumbs/VMwareBreadcrumbs";
import { getResourceAiAgentDescriptor } from "../../../../App/FeatureSet/Dashboard/src/Components/ResourceAiAgent/ResourceAiAgentDescriptors";
import PageMap from "../../../../App/FeatureSet/Dashboard/src/Utils/PageMap";
import RouteMap, {
  CephRoutePath,
  DatabaseRoutePath,
  DockerRoutePath,
  DockerSwarmRoutePath,
  HostRoutePath,
  PodmanRoutePath,
  ProxmoxRoutePath,
  RouteUtil,
  VMwareRoutePath,
} from "../../../../App/FeatureSet/Dashboard/src/Utils/RouteMap";
import Dictionary from "../../../Types/Dictionary";
import Link from "../../../Types/Link";
import ListResult from "../../../Types/BaseDatabase/ListResult";
import ObjectID from "../../../Types/ObjectID";
import AiResourceType, {
  ALL_AI_RESOURCE_TYPES,
} from "../../../Types/ResourceAiAgent/AiResourceType";
import SideMenuItem from "../../../UI/Components/SideMenu/SideMenuItem";
import ModelAPI from "../../../UI/Utils/ModelAPI/ModelAPI";
import {
  MenuLink,
  PROJECT_ID,
  goTo,
  iconCountIn,
  linksIn,
  renderMenu,
  sectionTitlesInOrder,
} from "./SideMenuHarness";

jest.mock("react-i18next", () => {
  return {
    useTranslation: () => {
      return {
        t: (value: string): string => {
          return value;
        },
      };
    },
  };
});

// The recommendation badge fetch is unrelated to the AI section.
jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Recommendations/RecommendationsSideMenuItem",
  () => {
    return {
      __esModule: true,
      default: (props: { link: Link }): ReactElement => {
        return <SideMenuItem link={props.link} />;
      },
    };
  },
);

// No unresolved states: the Activity badges never reach for a count.
jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Utils/IncidentState",
  () => {
    return {
      __esModule: true,
      default: {
        getUnresolvedIncidentStates: () => {
          return Promise.resolve([]);
        },
      },
    };
  },
);

jest.mock("../../../../App/FeatureSet/Dashboard/src/Utils/AlertState", () => {
  return {
    __esModule: true,
    default: {
      getUnresolvedAlertStates: () => {
        return Promise.resolve([]);
      },
    },
  };
});

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Utils/ScheduledMaintenanceState",
  () => {
    return {
      __esModule: true,
      default: {
        getActiveScheduledMaintenanceStates: () => {
          return Promise.resolve([]);
        },
      },
    };
  },
);

/*
 * Every resource a resource AI agent serves gets the Kubernetes cluster's
 * AI section: an "AI" side-menu section right after its first section,
 * holding "Insights" (what AI investigated and changed) and "AI agent" (the
 * resource's AI agent and what AI may do), on the routes :id/ai/insights
 * and :id/ai/agent nested under the resource's view, with "AI" trails.
 * Where a resource already had a metrics page called "Insights" (Docker
 * Swarm, Proxmox, VMware, Ceph), that page is "Resource Usage" now — same
 * route — so each menu has exactly one "Insights" and the LightBulb belongs
 * to AI alone.
 */

const MODEL_ID: ObjectID = new ObjectID("44444444-0000-4000-8000-000000000004");

const DASHBOARD_SRC: string = path.resolve(
  __dirname,
  "../../../../App/FeatureSet/Dashboard/src",
);

interface ResourceCase {
  type: AiResourceType;
  // The folder under Pages/ and the Routes/<name>Routes.tsx file.
  directory: string;
  routesFile: string;
  // The URL segment after the project, and the route dictionary.
  base: string;
  routePath: Dictionary<string>;
  prefix: string;
  menu: FunctionComponent<{ modelId: ObjectID }>;
  firstSection: string;
  breadcrumbs: (path: string) => Array<Link> | undefined;
  trail: Array<string>;
  // The page key of a metrics page titled "Insights" before the AI section.
  metricsInsights: PageMap | null;
}

const CASES: Array<ResourceCase> = [
  {
    type: AiResourceType.DockerHost,
    directory: "Docker",
    routesFile: "DockerRoutes.tsx",
    base: "docker",
    routePath: DockerRoutePath,
    prefix: "DOCKER_HOST_VIEW",
    menu: DockerSideMenu,
    firstSection: "Basic",
    breadcrumbs: getDockerBreadcrumbs,
    trail: ["Project", "Docker", "View Host"],
    metricsInsights: null,
  },
  {
    type: AiResourceType.PodmanHost,
    directory: "Podman",
    routesFile: "PodmanRoutes.tsx",
    base: "podman",
    routePath: PodmanRoutePath,
    prefix: "PODMAN_HOST_VIEW",
    menu: PodmanSideMenu,
    firstSection: "Basic",
    breadcrumbs: getPodmanBreadcrumbs,
    trail: ["Project", "Podman", "View Host"],
    metricsInsights: null,
  },
  {
    type: AiResourceType.DockerSwarmCluster,
    directory: "DockerSwarm",
    routesFile: "DockerSwarmRoutes.tsx",
    base: "docker-swarm",
    routePath: DockerSwarmRoutePath,
    prefix: "DOCKER_SWARM_CLUSTER_VIEW",
    menu: DockerSwarmSideMenu,
    firstSection: "Overview",
    breadcrumbs: getDockerSwarmBreadcrumbs,
    trail: ["Project", "DockerSwarm", "View Cluster"],
    metricsInsights: PageMap.DOCKER_SWARM_CLUSTER_VIEW_INSIGHTS,
  },
  {
    type: AiResourceType.ProxmoxCluster,
    directory: "Proxmox",
    routesFile: "ProxmoxRoutes.tsx",
    base: "proxmox",
    routePath: ProxmoxRoutePath,
    prefix: "PROXMOX_CLUSTER_VIEW",
    menu: ProxmoxSideMenu,
    firstSection: "Basic",
    breadcrumbs: getProxmoxBreadcrumbs,
    trail: ["Project", "Proxmox", "View Cluster"],
    metricsInsights: PageMap.PROXMOX_CLUSTER_VIEW_INSIGHTS,
  },
  {
    type: AiResourceType.VMwareVCenter,
    directory: "VMware",
    routesFile: "VMwareRoutes.tsx",
    base: "vmware",
    routePath: VMwareRoutePath,
    prefix: "VMWARE_VCENTER_VIEW",
    menu: VMwareSideMenu,
    firstSection: "Basic",
    breadcrumbs: getVMwareBreadcrumbs,
    trail: ["Project", "VMware", "View vCenter"],
    metricsInsights: PageMap.VMWARE_VCENTER_VIEW_INSIGHTS,
  },
  {
    type: AiResourceType.CephCluster,
    directory: "Ceph",
    routesFile: "CephRoutes.tsx",
    base: "ceph",
    routePath: CephRoutePath,
    prefix: "CEPH_CLUSTER_VIEW",
    menu: CephSideMenu,
    firstSection: "Basic",
    breadcrumbs: getCephBreadcrumbs,
    trail: ["Project", "Ceph", "View Cluster"],
    metricsInsights: PageMap.CEPH_CLUSTER_VIEW_INSIGHTS,
  },
  {
    type: AiResourceType.DatabaseServer,
    directory: "Database",
    routesFile: "DatabaseRoutes.tsx",
    base: "databases",
    routePath: DatabaseRoutePath,
    prefix: "DATABASE_SERVER_VIEW",
    menu: DatabaseSideMenu,
    firstSection: "Basic",
    breadcrumbs: getDatabaseBreadcrumbs,
    trail: ["Project", "Databases", "View Database"],
    metricsInsights: null,
  },
  {
    type: AiResourceType.Host,
    directory: "Host",
    routesFile: "HostRoutes.tsx",
    base: "host",
    routePath: HostRoutePath,
    prefix: "HOST_VIEW",
    menu: HostSideMenu,
    firstSection: "Basic",
    breadcrumbs: getHostBreadcrumbs,
    trail: ["Project", "Hosts", "View Host"],
    metricsInsights: null,
  },
];

function insightsKey(item: ResourceCase): PageMap {
  return `${item.prefix}_AI_INSIGHTS` as PageMap;
}

function agentKey(item: ResourceCase): PageMap {
  return `${item.prefix}_AI_AGENT` as PageMap;
}

/*
 * A real resource path, built from the pattern rather than with
 * populateRouteParams, which fills the project id from whatever the
 * previous test left in the address bar.
 */
function resourceRoute(page: PageMap): string {
  return RouteMap[page]!.toString()
    .replace(":projectId", PROJECT_ID)
    .replace(":id", MODEL_ID.toString());
}

function readSource(...segments: Array<string>): string {
  return fs.readFileSync(path.join(DASHBOARD_SRC, ...segments), "utf8");
}

function titlesOf(links: Array<MenuLink>): Array<string> {
  return links.map((link: MenuLink): string => {
    return link.title;
  });
}

async function renderResourceMenu(item: ResourceCase): Promise<void> {
  goTo(resourceRoute(`${item.prefix}` as PageMap));
  const Menu: FunctionComponent<{ modelId: ObjectID }> = item.menu;
  await renderMenu(<Menu modelId={MODEL_ID} />);
}

beforeEach(() => {
  jest.spyOn(ModelAPI, "getList").mockResolvedValue({
    data: [],
    count: 0,
    skip: 0,
    limit: 0,
  } as ListResult<never>);
  jest.spyOn(ModelAPI, "count").mockResolvedValue(0);
  jest.spyOn(ModelAPI, "getItem").mockResolvedValue(null);
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

test("every resource type a resource AI agent serves is wired here", () => {
  expect(
    CASES.map((item: ResourceCase): AiResourceType => {
      return item.type;
    }),
  ).toEqual([...ALL_AI_RESOURCE_TYPES]);
});

describe.each(CASES)("$type", (item: ResourceCase) => {
  describe("PageMap and RouteMap", () => {
    test("declare the two AI pages", () => {
      expect(PageMap[insightsKey(item) as keyof typeof PageMap]).toBe(
        insightsKey(item),
      );
      expect(PageMap[agentKey(item) as keyof typeof PageMap]).toBe(
        agentKey(item),
      );
    });

    test("nest them under the resource: :id/ai/insights and :id/ai/agent", () => {
      expect(item.routePath[insightsKey(item)]).toBe(":id/ai/insights");
      expect(item.routePath[agentKey(item)]).toBe(":id/ai/agent");
      expect(RouteMap[insightsKey(item)]!.toString()).toBe(
        `/dashboard/:projectId/${item.base}/:id/ai/insights`,
      );
      expect(RouteMap[agentKey(item)]!.toString()).toBe(
        `/dashboard/:projectId/${item.base}/:id/ai/agent`,
      );
      // The view's own route stays where it was.
      expect(RouteMap[item.prefix]!.toString()).toBe(
        `/dashboard/:projectId/${item.base}/:id`,
      );
    });

    test("register as children of the view taking the last two segments", () => {
      expect(RouteUtil.getLastPathForKey(insightsKey(item), 2)).toBe(
        "ai/insights",
      );
      expect(RouteUtil.getLastPathForKey(agentKey(item), 2)).toBe("ai/agent");
    });

    test("are the pages the descriptor links to", () => {
      expect(getResourceAiAgentDescriptor(item.type).insightsPage).toBe(
        insightsKey(item),
      );
      expect(getResourceAiAgentDescriptor(item.type).agentPage).toBe(
        agentKey(item),
      );
    });
  });

  describe("the routes file", () => {
    const source: string = readSource("Routes", item.routesFile);
    const dense: string = source.replace(/\s+/g, "");

    test("imports the thin AI pages", () => {
      expect(source).toContain(
        `from "../Pages/${item.directory}/View/AI/Insights"`,
      );
      expect(source).toContain(
        `from "../Pages/${item.directory}/View/AI/Agent"`,
      );
    });

    test("mounts both, two segments deep, with their page routes", () => {
      for (const key of [insightsKey(item), agentKey(item)]) {
        expect(dense).toMatch(
          new RegExp(`getLastPathForKey\\(PageMap\\.${key},2,?\\)`),
        );
        expect(dense).toContain(`RouteMap[PageMap.${key}]asRoute`);
      }
    });

    test("mounts them inside the resource's view layout", () => {
      const layoutAt: number = source.indexOf("ViewLayout {...props} />}");
      expect(layoutAt).toBeGreaterThan(-1);
      expect(source.indexOf(`PageMap.${insightsKey(item)},`)).toBeGreaterThan(
        layoutAt,
      );
    });
  });

  describe("the thin pages", () => {
    test.each([
      ["Agent.tsx", "ResourceAiAgentPage"],
      ["Insights.tsx", "ResourceAiInsightsPage"],
    ])(
      "%s renders %s for this resource type",
      (file: string, component: string) => {
        const source: string = readSource(
          "Pages",
          item.directory,
          "View",
          "AI",
          file,
        );
        expect(source).toContain(
          `from "../../../../Components/ResourceAiAgent/${component}"`,
        );
        expect(source).toMatch(
          new RegExp(
            `getResourceAiAgentDescriptor\\(\\s*AiResourceType\\.${item.type},?\\s*\\)`,
          ),
        );
        expect(source).toContain(`<${component}`);
      },
    );
  });

  describe("the breadcrumbs", () => {
    function crumbTitles(page: PageMap): Array<string> {
      goTo(resourceRoute(page));
      return (item.breadcrumbs(RouteMap[page]!.toString()) || []).map(
        (link: Link): string => {
          return link.title;
        },
      );
    }

    test('say the two pages live under "AI"', () => {
      expect(crumbTitles(insightsKey(item))).toEqual([
        ...item.trail,
        "AI",
        "Insights",
      ]);
      expect(crumbTitles(agentKey(item))).toEqual([
        ...item.trail,
        "AI",
        "AI agent",
      ]);
    });

    test('never call the page a bare "Agent"', () => {
      expect(crumbTitles(agentKey(item))).not.toContain("Agent");
    });

    test("never link a crumb to a page that does not exist", () => {
      goTo(resourceRoute(agentKey(item)));
      const links: Array<Link> = item.breadcrumbs(
        RouteMap[agentKey(item)]!.toString(),
      )!;
      for (const link of links) {
        expect(link.to.toString()).not.toMatch(/[:*]/);
        expect(link.to.toString()).not.toMatch(/\/ai$/);
      }
    });

    if (item.metricsInsights) {
      test("the resource charts are Resource Usage in the trail", () => {
        expect(crumbTitles(item.metricsInsights!)).toEqual([
          ...item.trail,
          "Resource Usage",
        ]);
      });
    }
  });

  describe("the side menu", () => {
    test("has an AI section right after its first section", async () => {
      await renderResourceMenu(item);

      const sections: Array<string> = sectionTitlesInOrder();
      expect(sections[0]).toBe(item.firstSection);
      expect(sections[1]).toBe("AI");
      expect(
        sections.filter((title: string): boolean => {
          return title === "AI";
        }),
      ).toHaveLength(1);
    });

    test('holds "Insights" and "AI agent", linking to their pages, each with an icon', async () => {
      await renderResourceMenu(item);

      expect(linksIn("AI")).toEqual([
        { title: "Insights", href: resourceRoute(insightsKey(item)) },
        { title: "AI agent", href: resourceRoute(agentKey(item)) },
      ]);
      expect(iconCountIn("AI")).toBe(2);
    });

    test('the whole menu has exactly one "Insights" item, and no bare link to /ai', async () => {
      await renderResourceMenu(item);

      const allLinks: Array<MenuLink> = sectionTitlesInOrder().flatMap(
        (section: string): Array<MenuLink> => {
          return linksIn(section);
        },
      );
      expect(
        titlesOf(allLinks).filter((title: string): boolean => {
          return title === "Insights";
        }),
      ).toHaveLength(1);
      for (const link of allLinks) {
        expect(link.href).not.toMatch(/\/ai$/);
      }
    });

    if (item.metricsInsights) {
      test('its charts page is "Resource Usage" now, on the same route', async () => {
        await renderResourceMenu(item);

        const usage: MenuLink | undefined = linksIn(item.firstSection).find(
          (link: MenuLink): boolean => {
            return link.title === "Resource Usage";
          },
        );
        expect(usage).toBeDefined();
        expect(usage!.href).toBe(resourceRoute(item.metricsInsights!));
        expect(RouteMap[item.metricsInsights!]!.toString()).toBe(
          `/dashboard/:projectId/${item.base}/:id/insights`,
        );
      });
    }

    test("the LightBulb is used only by AI → Insights, the robot only by AI → AI agent", () => {
      const source: string = readSource(
        "Pages",
        item.directory,
        "View",
        "SideMenu.tsx",
      );

      expect(source.match(/IconProp\.LightBulb/g)).toHaveLength(1);
      const lightBulbAt: number = source.indexOf("IconProp.LightBulb");
      const insightsAt: number = source.lastIndexOf(
        insightsKey(item),
        lightBulbAt,
      );
      expect(insightsAt).toBeGreaterThan(-1);
      expect(source.slice(insightsAt, lightBulbAt)).not.toContain(
        "SideMenuItem",
      );

      expect(source.match(/IconProp\.Automation/g)).toHaveLength(1);
      const automationAt: number = source.indexOf("IconProp.Automation");
      const agentAt: number = source.lastIndexOf(agentKey(item), automationAt);
      expect(agentAt).toBeGreaterThan(-1);
      expect(source.slice(agentAt, automationAt)).not.toContain("SideMenuItem");

      if (item.metricsInsights) {
        // The charts page's icon is a chart, like a Kubernetes cluster's.
        const usageAt: number = source.indexOf('"Resource Usage"');
        const chartAt: number = source.indexOf("IconProp.ChartBar", usageAt);
        expect(usageAt).toBeGreaterThan(-1);
        expect(source.slice(usageAt, chartAt)).toContain(
          `PageMap.${item.metricsInsights}]`,
        );
        expect(source.slice(usageAt, chartAt)).not.toContain("SideMenuItem");
      }
    });
  });
});
