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
import fs from "fs";
import path from "path";
import KubernetesClusterSideMenu from "../../../../App/FeatureSet/Dashboard/src/Pages/Kubernetes/View/SideMenu";
import { getKubernetesBreadcrumbs } from "../../../../App/FeatureSet/Dashboard/src/Utils/Breadcrumbs/KubernetesBreadcrumbs";
import PageMap from "../../../../App/FeatureSet/Dashboard/src/Utils/PageMap";
import RouteMap, {
  KubernetesRoutePath,
  RouteUtil,
} from "../../../../App/FeatureSet/Dashboard/src/Utils/RouteMap";
import Link from "../../../Types/Link";
import ListResult from "../../../Types/BaseDatabase/ListResult";
import ObjectID from "../../../Types/ObjectID";
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
 * The cluster's AI section: "Insights" (what AI learned here and what
 * deserves attention), "Logs" (everything AI did, newest first — the page
 * that was called Insights before) and "Agent" (the Kubernetes AI agent and
 * what AI may do), in a section of their own right after Basic. Basic's
 * resource charts are "Resource Usage" now, so the menu never shows two
 * "Insights" and the LightBulb belongs to AI alone; AI's "Logs" has a list
 * icon and a route of its own beside Telemetry's "Logs". The old single AI
 * page's route (":id/ai") stays, as a redirect to the agent page; the
 * redirect itself is rendered in KubernetesClusterAiPage.test.tsx.
 */

const CLUSTER_ID: ObjectID = new ObjectID(
  "44444444-0000-4000-8000-000000000004",
);

const ROUTES_SOURCE: string = path.resolve(
  __dirname,
  "../../../../App/FeatureSet/Dashboard/src/Routes/KubernetesRoutes.tsx",
);
const OLD_AI_PAGE_SOURCE: string = path.resolve(
  __dirname,
  "../../../../App/FeatureSet/Dashboard/src/Pages/Kubernetes/View/AI.tsx",
);

/*
 * A real cluster path. Built from the pattern, not with populateRouteParams:
 * that fills the project id from the address bar, which is whatever the
 * previous test left there.
 */
function clusterRoute(page: PageMap): string {
  return RouteMap[page]!.toString()
    .replace(":projectId", PROJECT_ID)
    .replace(":id", CLUSTER_ID.toString());
}

async function renderClusterMenu(): Promise<void> {
  goTo(clusterRoute(PageMap.KUBERNETES_CLUSTER_VIEW));
  await renderMenu(<KubernetesClusterSideMenu modelId={CLUSTER_ID} />);
}

function titlesOf(links: Array<MenuLink>): Array<string> {
  return links.map((link: MenuLink): string => {
    return link.title;
  });
}

beforeEach(() => {
  jest.spyOn(ModelAPI, "getList").mockResolvedValue({
    data: [],
    count: 0,
    skip: 0,
    limit: 0,
  } as ListResult<never>);
  jest.spyOn(ModelAPI, "count").mockResolvedValue(0);
  // The Recommendations item reads the cluster row; nothing to recommend.
  jest.spyOn(ModelAPI, "getItem").mockResolvedValue(null);
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

describe("the cluster side menu's AI section", () => {
  test("sits right after Basic", async () => {
    await renderClusterMenu();

    const sections: Array<string> = sectionTitlesInOrder();
    expect(sections[0]).toBe("Basic");
    expect(sections[1]).toBe("AI");
    expect(
      sections.filter((title: string): boolean => {
        return title === "AI";
      }),
    ).toHaveLength(1);
  });

  test("holds Insights, Logs and Agent, in that order, linking to their pages", async () => {
    await renderClusterMenu();

    expect(linksIn("AI")).toEqual([
      {
        title: "Insights",
        href: `/dashboard/${PROJECT_ID}/kubernetes/${CLUSTER_ID.toString()}/ai/insights`,
      },
      {
        title: "Logs",
        href: `/dashboard/${PROJECT_ID}/kubernetes/${CLUSTER_ID.toString()}/ai/logs`,
      },
      {
        title: "Agent",
        href: `/dashboard/${PROJECT_ID}/kubernetes/${CLUSTER_ID.toString()}/ai/agent`,
      },
    ]);
    expect(iconCountIn("AI")).toBe(3);
  });

  test("AI's Logs and Telemetry's Logs are two pages, each in its own section", async () => {
    await renderClusterMenu();

    const aiLogs: MenuLink = linksIn("AI").find((link: MenuLink): boolean => {
      return link.title === "Logs";
    })!;
    const telemetryLogs: MenuLink = linksIn("Telemetry").find(
      (link: MenuLink): boolean => {
        return link.title === "Logs";
      },
    )!;

    expect(aiLogs.href).toBe(
      clusterRoute(PageMap.KUBERNETES_CLUSTER_VIEW_AI_LOGS),
    );
    expect(telemetryLogs.href).toBe(
      clusterRoute(PageMap.KUBERNETES_CLUSTER_VIEW_LOGS),
    );
    expect(aiLogs.href).not.toBe(telemetryLogs.href);
  });

  test("Basic no longer holds an AI item, and its charts are Resource Usage", async () => {
    await renderClusterMenu();

    const basic: Array<MenuLink> = linksIn("Basic");
    expect(titlesOf(basic)).toEqual([
      "Overview",
      "Resource Usage",
      "Recommendations",
      "Costs",
      "Documentation",
    ]);
    // Still the same page and route: bookmarks keep working.
    expect(
      basic.find((link: MenuLink): boolean => {
        return link.title === "Resource Usage";
      })!.href,
    ).toBe(clusterRoute(PageMap.KUBERNETES_CLUSTER_VIEW_INSIGHTS));
  });

  test("the whole menu has exactly one Insights item, and no bare link to /ai", async () => {
    await renderClusterMenu();

    const allTitles: Array<string> = sectionTitlesInOrder().flatMap(
      (section: string): Array<string> => {
        return titlesOf(linksIn(section));
      },
    );
    expect(
      allTitles.filter((title: string): boolean => {
        return title === "Insights";
      }),
    ).toHaveLength(1);
    expect(allTitles).not.toContain("AI");

    const oldAiRoute: string = clusterRoute(PageMap.KUBERNETES_CLUSTER_VIEW_AI);
    for (const section of sectionTitlesInOrder()) {
      for (const link of linksIn(section)) {
        expect(link.href).not.toBe(oldAiRoute);
      }
    }
  });

  /*
   * The LightBulb is AI → Insights' icon, product-wide. The resource
   * charts use a chart icon, so the two cannot be told apart by icon.
   */
  test("the LightBulb is used only by AI → Insights", () => {
    const source: string = fs.readFileSync(
      path.resolve(
        __dirname,
        "../../../../App/FeatureSet/Dashboard/src/Pages/Kubernetes/View/SideMenu.tsx",
      ),
      "utf8",
    );
    expect(source.match(/IconProp\.LightBulb/g)).toHaveLength(1);
    const lightBulbAt: number = source.indexOf("IconProp.LightBulb");
    const insightsRouteAt: number = source.lastIndexOf(
      "KUBERNETES_CLUSTER_VIEW_AI_INSIGHTS",
      lightBulbAt,
    );
    expect(insightsRouteAt).toBeGreaterThan(-1);
    expect(source.slice(insightsRouteAt, lightBulbAt)).not.toContain(
      "SideMenuItem",
    );
  });

  // AI → Logs has the list icon; Telemetry → Logs keeps the logs icon.
  test("the QueueList is used only by AI → Logs", () => {
    const source: string = fs.readFileSync(
      path.resolve(
        __dirname,
        "../../../../App/FeatureSet/Dashboard/src/Pages/Kubernetes/View/SideMenu.tsx",
      ),
      "utf8",
    );
    expect(source.match(/IconProp\.QueueList/g)).toHaveLength(1);
    const listAt: number = source.indexOf("IconProp.QueueList");
    const logsRouteAt: number = source.lastIndexOf(
      "KUBERNETES_CLUSTER_VIEW_AI_LOGS",
      listAt,
    );
    expect(logsRouteAt).toBeGreaterThan(-1);
    expect(source.slice(logsRouteAt, listAt)).not.toContain("SideMenuItem");
  });
});

describe("the AI routes", () => {
  test("nest under the cluster: ai/insights, ai/logs and ai/agent", () => {
    expect(
      KubernetesRoutePath[PageMap.KUBERNETES_CLUSTER_VIEW_AI_INSIGHTS],
    ).toBe(":id/ai/insights");
    expect(KubernetesRoutePath[PageMap.KUBERNETES_CLUSTER_VIEW_AI_LOGS]).toBe(
      ":id/ai/logs",
    );
    expect(KubernetesRoutePath[PageMap.KUBERNETES_CLUSTER_VIEW_AI_AGENT]).toBe(
      ":id/ai/agent",
    );
    expect(RouteMap[PageMap.KUBERNETES_CLUSTER_VIEW_AI_LOGS]!.toString()).toBe(
      "/dashboard/:projectId/kubernetes/:id/ai/logs",
    );
    // The old page's route stays, so old links still land somewhere.
    expect(KubernetesRoutePath[PageMap.KUBERNETES_CLUSTER_VIEW_AI]).toBe(
      ":id/ai",
    );
    expect(RouteMap[PageMap.KUBERNETES_CLUSTER_VIEW_AI_AGENT]!.toString()).toBe(
      "/dashboard/:projectId/kubernetes/:id/ai/agent",
    );
    expect(
      RouteMap[PageMap.KUBERNETES_CLUSTER_VIEW_AI_INSIGHTS]!.toString(),
    ).toBe("/dashboard/:projectId/kubernetes/:id/ai/insights");
  });

  // The nested child routes take the last two path segments.
  test("register as nested children of the cluster view", () => {
    expect(
      RouteUtil.getLastPathForKey(PageMap.KUBERNETES_CLUSTER_VIEW_AI_AGENT, 2),
    ).toBe("ai/agent");
    expect(
      RouteUtil.getLastPathForKey(
        PageMap.KUBERNETES_CLUSTER_VIEW_AI_INSIGHTS,
        2,
      ),
    ).toBe("ai/insights");
    expect(
      RouteUtil.getLastPathForKey(PageMap.KUBERNETES_CLUSTER_VIEW_AI_LOGS, 2),
    ).toBe("ai/logs");

    const source: string = fs.readFileSync(ROUTES_SOURCE, "utf8");
    expect(source).toContain('from "../Pages/Kubernetes/View/AI/Agent"');
    expect(source).toContain('from "../Pages/Kubernetes/View/AI/Insights"');
    expect(source).toContain('from "../Pages/Kubernetes/View/AI/Logs"');
    expect(source).toContain("<KubernetesClusterViewAiRedirect />");
    for (const key of [
      "KUBERNETES_CLUSTER_VIEW_AI_INSIGHTS",
      "KUBERNETES_CLUSTER_VIEW_AI_LOGS",
      "KUBERNETES_CLUSTER_VIEW_AI_AGENT",
    ]) {
      expect(source).toMatch(
        new RegExp(`getLastPathForKey\\(\\s*PageMap\\.${key},\\s*2,?\\s*\\)`),
      );
    }
  });

  test("the old single AI page is gone", () => {
    expect(fs.existsSync(OLD_AI_PAGE_SOURCE)).toBe(false);
  });

  /*
   * The page that listed everything AI did was "AI Insights" on
   * :id/ai/insights. It is "AI Logs" on :id/ai/logs now, and an old
   * bookmark of :id/ai/insights lands on the AI Insights page, which links
   * to it from its heading.
   */
  test("ai/insights renders the AI Insights page, ai/logs the AI Logs page", () => {
    const source: string = fs
      .readFileSync(ROUTES_SOURCE, "utf8")
      .replace(/\s+/g, "");

    const insightsMount: number = source.indexOf(
      "getLastPathForKey(PageMap.KUBERNETES_CLUSTER_VIEW_AI_INSIGHTS,2",
    );
    const logsMount: number = source.indexOf(
      "getLastPathForKey(PageMap.KUBERNETES_CLUSTER_VIEW_AI_LOGS,2",
    );
    expect(insightsMount).toBeGreaterThan(-1);
    expect(logsMount).toBeGreaterThan(-1);
    expect(source.slice(insightsMount, insightsMount + 160)).toContain(
      "<KubernetesClusterViewAiInsights",
    );
    expect(source.slice(logsMount, logsMount + 160)).toContain(
      "<KubernetesClusterViewAiLogs",
    );
  });
});

describe("the AI breadcrumbs", () => {
  function crumbTitles(page: PageMap): Array<string> {
    const route: string = clusterRoute(page);
    goTo(route);
    const links: Array<Link> | undefined = getKubernetesBreadcrumbs(
      RouteMap[page]!.toString(),
    );
    return (links || []).map((link: Link): string => {
      return link.title;
    });
  }

  test('say the "Insights", "Logs" and "AI agent" pages live under AI', () => {
    expect(crumbTitles(PageMap.KUBERNETES_CLUSTER_VIEW_AI_INSIGHTS)).toEqual([
      "Project",
      "Kubernetes",
      "View Cluster",
      "AI",
      "Insights",
    ]);
    expect(crumbTitles(PageMap.KUBERNETES_CLUSTER_VIEW_AI_LOGS)).toEqual([
      "Project",
      "Kubernetes",
      "View Cluster",
      "AI",
      "Logs",
    ]);
    expect(crumbTitles(PageMap.KUBERNETES_CLUSTER_VIEW_AI_AGENT)).toEqual([
      "Project",
      "Kubernetes",
      "View Cluster",
      "AI",
      "AI agent",
    ]);
  });

  // Never a bare "Agent": the Overview's "Agent Status" is the collector.
  test('never call the page a bare "Agent"', () => {
    expect(crumbTitles(PageMap.KUBERNETES_CLUSTER_VIEW_AI_AGENT)).not.toContain(
      "Agent",
    );
  });

  test("the resource charts are Resource Usage in the trail too", () => {
    expect(crumbTitles(PageMap.KUBERNETES_CLUSTER_VIEW_INSIGHTS)).toEqual([
      "Project",
      "Kubernetes",
      "View Cluster",
      "Resource Usage",
    ]);
  });

  test("the AI crumb of a nested page links to a real page", () => {
    goTo(clusterRoute(PageMap.KUBERNETES_CLUSTER_VIEW_AI_AGENT));
    const links: Array<Link> = getKubernetesBreadcrumbs(
      RouteMap[PageMap.KUBERNETES_CLUSTER_VIEW_AI_AGENT]!.toString(),
    )!;
    const aiCrumb: Link = links[3]!;
    expect(aiCrumb.title).toBe("AI");
    // ":id/ai" is a real route (the redirect to this page).
    expect(aiCrumb.to.toString()).toBe(
      clusterRoute(PageMap.KUBERNETES_CLUSTER_VIEW_AI),
    );
  });
});
