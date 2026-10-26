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
import KubernetesClusterSideMenu from "../../../../App/FeatureSet/Dashboard/src/Pages/Kubernetes/View/SideMenu";
import { getKubernetesBreadcrumbs } from "../../../../App/FeatureSet/Dashboard/src/Utils/Breadcrumbs/KubernetesBreadcrumbs";
import PageMap from "../../../../App/FeatureSet/Dashboard/src/Utils/PageMap";
import RouteMap, {
  RouteUtil,
} from "../../../../App/FeatureSet/Dashboard/src/Utils/RouteMap";
import ListResult from "../../../Types/BaseDatabase/ListResult";
import Link from "../../../Types/Link";
import ObjectID from "../../../Types/ObjectID";
import ModelAPI from "../../../UI/Utils/ModelAPI/ModelAPI";
import {
  activeLinkTitles,
  currentEntries,
  DESKTOP_WIDTH,
  goTo,
  isExpanded,
  linksIn,
  MOBILE_WIDTH,
  mobileSummaryText,
  PROJECT_ID,
  renderMenu,
  setViewportWidth,
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
 * A Kubernetes cluster's own pages - a namespace's, a pod's, a node's, an
 * autoscaler's - had no entry in the cluster's side menu, so nothing in it
 * was lit there, and on a phone the menu's button said "Navigate to /
 * Navigation" (#5201's line). #5241 made a page the menu does not list
 * borrow its trail's last crumb ("Pod Detail"). Now each such page is one
 * of the rows its list shows, as a VMware host's is: the list's entry stays
 * lit there, tells a screen reader it holds the page (aria-current="true"),
 * opens its section if it is folded, and names the button: "Workloads /
 * Pods".
 */

const CLUSTER_ID: ObjectID = new ObjectID(
  "44444444-0000-4000-8000-000000000004",
);
const OTHER_CLUSTER_ID: ObjectID = new ObjectID(
  "55555555-0000-4000-8000-000000000005",
);

// The PageMap key of a page of one row of a cluster's list.
const CLUSTER_DETAIL_PAGE_KEY: RegExp =
  /^KUBERNETES_CLUSTER_VIEW_[A-Z]+_DETAIL$/;

// A row's own page, its id in the address: a name, as Kubernetes keys them.
const ROW_ID: string = "checkout-api-7d9f8b6c5-x2x8k";

interface DetailPage {
  detailPage: PageMap;
  listPage: PageMap;
  list: string;
  section: string;
  crumb: string;
}

const DETAIL_PAGES: Array<DetailPage> = [
  {
    detailPage: PageMap.KUBERNETES_CLUSTER_VIEW_NAMESPACE_DETAIL,
    listPage: PageMap.KUBERNETES_CLUSTER_VIEW_NAMESPACES,
    list: "Namespaces",
    section: "Workloads",
    crumb: "Namespace Detail",
  },
  {
    detailPage: PageMap.KUBERNETES_CLUSTER_VIEW_POD_DETAIL,
    listPage: PageMap.KUBERNETES_CLUSTER_VIEW_PODS,
    list: "Pods",
    section: "Workloads",
    crumb: "Pod Detail",
  },
  {
    detailPage: PageMap.KUBERNETES_CLUSTER_VIEW_DEPLOYMENT_DETAIL,
    listPage: PageMap.KUBERNETES_CLUSTER_VIEW_DEPLOYMENTS,
    list: "Deployments",
    section: "Workloads",
    crumb: "Deployment Detail",
  },
  {
    detailPage: PageMap.KUBERNETES_CLUSTER_VIEW_STATEFULSET_DETAIL,
    listPage: PageMap.KUBERNETES_CLUSTER_VIEW_STATEFULSETS,
    list: "StatefulSets",
    section: "Workloads",
    crumb: "StatefulSet Detail",
  },
  {
    detailPage: PageMap.KUBERNETES_CLUSTER_VIEW_DAEMONSET_DETAIL,
    listPage: PageMap.KUBERNETES_CLUSTER_VIEW_DAEMONSETS,
    list: "DaemonSets",
    section: "Workloads",
    crumb: "DaemonSet Detail",
  },
  {
    detailPage: PageMap.KUBERNETES_CLUSTER_VIEW_JOB_DETAIL,
    listPage: PageMap.KUBERNETES_CLUSTER_VIEW_JOBS,
    list: "Jobs",
    section: "Workloads",
    crumb: "Job Detail",
  },
  {
    detailPage: PageMap.KUBERNETES_CLUSTER_VIEW_CRONJOB_DETAIL,
    listPage: PageMap.KUBERNETES_CLUSTER_VIEW_CRONJOBS,
    list: "CronJobs",
    section: "Workloads",
    crumb: "CronJob Detail",
  },
  {
    detailPage: PageMap.KUBERNETES_CLUSTER_VIEW_CONTAINER_DETAIL,
    listPage: PageMap.KUBERNETES_CLUSTER_VIEW_CONTAINERS,
    list: "Containers",
    section: "Workloads",
    crumb: "Container Detail",
  },
  {
    detailPage: PageMap.KUBERNETES_CLUSTER_VIEW_NODE_DETAIL,
    listPage: PageMap.KUBERNETES_CLUSTER_VIEW_NODES,
    list: "Nodes",
    section: "Infrastructure",
    crumb: "Node Detail",
  },
  {
    detailPage: PageMap.KUBERNETES_CLUSTER_VIEW_PVC_DETAIL,
    listPage: PageMap.KUBERNETES_CLUSTER_VIEW_PVCS,
    list: "PVCs",
    section: "Infrastructure",
    crumb: "PVC Detail",
  },
  {
    detailPage: PageMap.KUBERNETES_CLUSTER_VIEW_PV_DETAIL,
    listPage: PageMap.KUBERNETES_CLUSTER_VIEW_PVS,
    list: "PVs",
    section: "Infrastructure",
    crumb: "PV Detail",
  },
  {
    detailPage: PageMap.KUBERNETES_CLUSTER_VIEW_HPA_DETAIL,
    listPage: PageMap.KUBERNETES_CLUSTER_VIEW_HPAS,
    list: "HPAs",
    section: "Scaling",
    crumb: "HPA Detail",
  },
  {
    detailPage: PageMap.KUBERNETES_CLUSTER_VIEW_VPA_DETAIL,
    listPage: PageMap.KUBERNETES_CLUSTER_VIEW_VPAS,
    list: "VPAs",
    section: "Scaling",
    crumb: "VPA Detail",
  },
];

/*
 * A real path of the cluster. Built from the pattern, not with
 * populateRouteParams, which fills the project id from whatever address the
 * previous test left.
 */
function clusterPath(page: PageMap, clusterId: ObjectID = CLUSTER_ID): string {
  return RouteMap[page]!.toString()
    .replace(":projectId", PROJECT_ID)
    .replace(":id", clusterId.toString())
    .replace(":subModelId", ROW_ID);
}

async function renderClusterMenuAt(path: string): Promise<void> {
  goTo(path);
  await renderMenu(<KubernetesClusterSideMenu modelId={CLUSTER_ID} />);
}

beforeEach(() => {
  setViewportWidth(DESKTOP_WIDTH);
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

describe("a Kubernetes cluster's side menu on a row's own page", () => {
  test("every detail page of the cluster is listed here, with a path one row below its list", () => {
    const detailPages: Array<string> = Object.values(PageMap).filter(
      (page: string): boolean => {
        return CLUSTER_DETAIL_PAGE_KEY.test(page);
      },
    );

    expect(
      DETAIL_PAGES.map((entry: DetailPage): string => {
        return entry.detailPage;
      }).sort(),
    ).toEqual([...detailPages].sort());

    for (const entry of DETAIL_PAGES) {
      expect(clusterPath(entry.detailPage)).toBe(
        `${clusterPath(entry.listPage)}/${ROW_ID}`,
      );
    }
  });

  test.each(DETAIL_PAGES)(
    "on a row of $list, $list is lit and holds the page",
    async (entry: DetailPage) => {
      await renderClusterMenuAt(clusterPath(entry.detailPage));

      expect(activeLinkTitles()).toEqual([entry.list]);
      expect(currentEntries()).toEqual([
        { title: entry.list, current: "true" },
      ]);
      // Its section is open, folded by default or not (Scaling is).
      expect(isExpanded(entry.section)).toBe(true);
      // The entry still opens the list, not the row.
      expect(
        linksIn(entry.section).find((link: { title: string }): boolean => {
          return link.title === entry.list;
        })?.href,
      ).toBe(clusterPath(entry.listPage));
    },
  );

  test.each(DETAIL_PAGES)(
    "on the $list list itself, $list is the page",
    async (entry: DetailPage) => {
      await renderClusterMenuAt(clusterPath(entry.listPage));

      expect(currentEntries()).toEqual([
        { title: entry.list, current: "page" },
      ]);
    },
  );

  test.each(DETAIL_PAGES)(
    "on a phone, a row of $list names $section / $list on the menu's button",
    async (entry: DetailPage) => {
      setViewportWidth(MOBILE_WIDTH);
      await renderClusterMenuAt(clusterPath(entry.detailPage));

      expect(mobileSummaryText()).toBe(
        `Navigate to${entry.section} / ${entry.list}`,
      );
      expect(mobileSummaryText()).not.toContain("Navigation");
    },
  );

  test("another cluster's pod page lights nothing in this cluster's menu", async () => {
    await renderClusterMenuAt(
      clusterPath(PageMap.KUBERNETES_CLUSTER_VIEW_POD_DETAIL, OTHER_CLUSTER_ID),
    );

    expect(activeLinkTitles()).toEqual([]);
    expect(currentEntries()).toEqual([]);
  });

  test("a row's page one level deeper than a detail page is not one of its rows", async () => {
    await renderClusterMenuAt(
      `${clusterPath(PageMap.KUBERNETES_CLUSTER_VIEW_POD_DETAIL)}/logs`,
    );

    expect(currentEntries()).toEqual([]);
  });

  test.each(DETAIL_PAGES)(
    "the trail of a row of $list ends in $list, then $crumb",
    (entry: DetailPage) => {
      const pattern: string = RouteUtil.getRouteString(entry.detailPage);
      const trail: Array<Link> | undefined = getKubernetesBreadcrumbs(pattern);

      expect(
        trail?.map((link: Link): string => {
          return link.title;
        }),
      ).toEqual([
        "Project",
        "Kubernetes",
        "View Cluster",
        entry.list,
        entry.crumb,
      ]);
    },
  );
});

/*
 * Twelve of a cluster's pages had no trail at all - its Metrics, Traces,
 * Logs and Performance Profiles, PVCs and PVs and their rows, Costs,
 * Owners, Feed and Audit Logs - and so did the product's Costs, Archived
 * and its two rules pages: nothing above the page said where it was, and a
 * tab said only "OneUptime | Kubernetes Cluster".
 */
describe("every Kubernetes page has a trail", () => {
  const pages: Array<string> = Object.values(PageMap).filter(
    (page: string): boolean => {
      // The product's root only redirects to its clusters.
      return page.startsWith("KUBERNETES_") && page !== PageMap.KUBERNETES_ROOT;
    },
  );

  test("there are pages to check", () => {
    expect(pages.length).toBeGreaterThan(50);
  });

  test.each(pages)("%s", (page: string) => {
    const trail: Array<Link> | undefined = getKubernetesBreadcrumbs(
      RouteUtil.getRouteString(page),
    );

    expect(trail).toBeDefined();
    expect(
      trail!.slice(0, 2).map((link: Link): string => {
        return link.title;
      }),
    ).toEqual(["Project", "Kubernetes"]);
    expect(trail!.length).toBeGreaterThanOrEqual(3);
  });

  /*
   * A cluster page's crumb is named as its entry in the cluster's menu, so
   * the trail, the menu and the tab agree.
   */
  test.each([
    [PageMap.KUBERNETES_CLUSTER_VIEW_METRICS, "Metrics"],
    [PageMap.KUBERNETES_CLUSTER_VIEW_TRACES, "Traces"],
    [PageMap.KUBERNETES_CLUSTER_VIEW_LOGS, "Logs"],
    [PageMap.KUBERNETES_CLUSTER_VIEW_PROFILES, "Performance Profiles"],
    [PageMap.KUBERNETES_CLUSTER_VIEW_PVCS, "PVCs"],
    [PageMap.KUBERNETES_CLUSTER_VIEW_PVS, "PVs"],
    [PageMap.KUBERNETES_CLUSTER_VIEW_COSTS, "Costs"],
    [PageMap.KUBERNETES_CLUSTER_VIEW_OWNERS, "Owners"],
    [PageMap.KUBERNETES_CLUSTER_VIEW_FEED, "Feed"],
    [PageMap.KUBERNETES_CLUSTER_VIEW_AUDIT_LOGS, "Audit Logs"],
  ])("%s ends in its menu title, %s", async (page: string, title: string) => {
    const trail: Array<Link> | undefined = getKubernetesBreadcrumbs(
      RouteUtil.getRouteString(page),
    );

    expect(trail?.[trail.length - 1]?.title).toBe(title);

    // The same words as the entry the cluster's menu lights there.
    await renderClusterMenuAt(clusterPath(page as PageMap));
    expect(activeLinkTitles()).toEqual([title]);
  });
});
