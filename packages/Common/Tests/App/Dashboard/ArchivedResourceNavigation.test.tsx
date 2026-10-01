import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import "@testing-library/jest-dom";
import { act, cleanup, render, screen } from "@testing-library/react";
import * as React from "react";
import { ReactElement } from "react";
import {
  MemoryRouter,
  Outlet,
  Route as PageRoute,
  Routes,
} from "react-router-dom";

/*
 * How a user gets to archived workflows, monitors, status pages, dashboards
 * and on-call policies, and back.
 *
 * Archived resources leave their lists, so each product's menu has an
 * Archived entry - without it, the only way back to one would be its URL.
 * Each Archived page has a route under the product (`/workflows/archived`,
 * ...) that must open the page rather than be read as a resource id by the
 * `:id` route next to it, and a breadcrumb trail. An on-call policy gained a
 * Settings page (Export and Archive, as a workflow's or a monitor's Settings
 * page has). And the Monitors side-menu badges count live monitors only:
 * an archived monitor is not checked, so its frozen status must not keep
 * "Not Operational" lit.
 *
 * The real menus, route tables and breadcrumbs are used. Route rendering
 * mounts the real product routers with the layouts and the pages under test
 * replaced by recorders, so the page a URL actually lands on is visible.
 */

const countCalls: Array<Record<string, unknown>> = [];

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      count: (args: Record<string, unknown>) => {
        countCalls.push(args);
        return Promise.resolve(0);
      },
      getList: () => {
        return Promise.resolve({ data: [], count: 0, skip: 0, limit: 0 });
      },
      getItem: () => {
        return Promise.resolve(null);
      },
    },
  };
});

jest.mock("../../../UI/Utils/ModelListCache", () => {
  return {
    __esModule: true,
    default: {
      getList: () => {
        return Promise.resolve({ data: [], count: 0, skip: 0, limit: 0 });
      },
    },
  };
});

jest.mock("../../../UI/Utils/Analytics", () => {
  return { __esModule: true, default: { capture: jest.fn() } };
});

type MockPageProps = { pageRoute?: { toString: () => string } | undefined };

function mockPage(name: string): {
  __esModule: boolean;
  default: (props: MockPageProps) => ReactElement;
} {
  return {
    __esModule: true,
    default: (props: MockPageProps): ReactElement => {
      return (
        <div
          data-testid="page"
          data-page={name}
          data-page-route={props.pageRoute?.toString() || ""}
        />
      );
    },
  };
}

function mockLayout(name: string): {
  __esModule: boolean;
  default: () => ReactElement;
} {
  return {
    __esModule: true,
    default: (): ReactElement => {
      return (
        <div data-testid="layout" data-layout={name}>
          <Outlet />
        </div>
      );
    },
  };
}

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Pages/Workflow/Layout",
  () => {
    return mockLayout("workflows");
  },
);
jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Pages/Workflow/View/Layout",
  () => {
    return mockLayout("workflow-view");
  },
);
jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Pages/Workflow/Workflows",
  () => {
    return mockPage("Workflows");
  },
);
jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Pages/Workflow/Archived",
  () => {
    return mockPage("WorkflowsArchived");
  },
);
jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Pages/Workflow/View/Index",
  () => {
    return mockPage("WorkflowView");
  },
);

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Pages/Monitor/View/Layout",
  () => {
    return mockLayout("monitor-view");
  },
);
jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Pages/Monitor/Monitors",
  () => {
    return mockPage("Monitors");
  },
);
jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Pages/Monitor/ArchivedMonitors",
  () => {
    return mockPage("MonitorsArchived");
  },
);
jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Pages/Monitor/View/Index",
  () => {
    return mockPage("MonitorView");
  },
);

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Pages/StatusPages/Layout",
  () => {
    return mockLayout("status-pages");
  },
);
jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Pages/StatusPages/View/Layout",
  () => {
    return mockLayout("status-page-view");
  },
);
jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Pages/StatusPages/StatusPages",
  () => {
    return mockPage("StatusPages");
  },
);
jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Pages/StatusPages/Archived",
  () => {
    return mockPage("StatusPagesArchived");
  },
);
jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Pages/StatusPages/View/Index",
  () => {
    return mockPage("StatusPageView");
  },
);

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Pages/Dashboards/Layout",
  () => {
    return mockLayout("dashboards");
  },
);
jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Pages/Dashboards/View/Layout",
  () => {
    return mockLayout("dashboard-view");
  },
);
jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Pages/Dashboards/Dashboards",
  () => {
    return mockPage("Dashboards");
  },
);
jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Pages/Dashboards/Archived",
  () => {
    return mockPage("DashboardsArchived");
  },
);
jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Pages/Dashboards/View/Index",
  () => {
    return mockPage("DashboardView");
  },
);

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Pages/OnCallDuty/Layout",
  () => {
    return mockLayout("on-call-duty");
  },
);
jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Pages/OnCallDuty/OnCallDutyPolicy/Layout",
  () => {
    return mockLayout("on-call-policy-view");
  },
);
jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Pages/OnCallDuty/OnCallDutyPolicies",
  () => {
    return mockPage("OnCallPolicies");
  },
);
jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Pages/OnCallDuty/OnCallDutyPoliciesArchived",
  () => {
    return mockPage("OnCallPoliciesArchived");
  },
);
jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Pages/OnCallDuty/OnCallDutyPolicy/Index",
  () => {
    return mockPage("OnCallPolicyView");
  },
);
jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Pages/OnCallDuty/OnCallDutyPolicy/Settings",
  () => {
    return mockPage("OnCallPolicySettings");
  },
);

import DashboardsSideMenu from "../../../../App/FeatureSet/Dashboard/src/Pages/Dashboards/SideMenu";
import MonitorLayout from "../../../../App/FeatureSet/Dashboard/src/Pages/Monitor/Layout";
import MonitorsSideMenu from "../../../../App/FeatureSet/Dashboard/src/Pages/Monitor/SideMenu";
import OnCallDutySideMenu from "../../../../App/FeatureSet/Dashboard/src/Pages/OnCallDuty/SideMenu";
import OnCallDutyPolicySideMenu from "../../../../App/FeatureSet/Dashboard/src/Pages/OnCallDuty/OnCallDutyPolicy/SideMenu";
import PageComponentProps from "../../../../App/FeatureSet/Dashboard/src/Pages/PageComponentProps";
import StatusPagesSideMenu from "../../../../App/FeatureSet/Dashboard/src/Pages/StatusPages/SideMenu";
import WorkflowsSideMenu from "../../../../App/FeatureSet/Dashboard/src/Pages/Workflow/SideMenu";
import DashboardRoutes from "../../../../App/FeatureSet/Dashboard/src/Routes/DashboardRoutes";
import MonitorsRoutes from "../../../../App/FeatureSet/Dashboard/src/Routes/MonitorsRoutes";
import OnCallDutyRoutes from "../../../../App/FeatureSet/Dashboard/src/Routes/OnCallDutyRoutes";
import StatusPagesRoutes from "../../../../App/FeatureSet/Dashboard/src/Routes/StatusPagesRoutes";
import WorkflowRoutes from "../../../../App/FeatureSet/Dashboard/src/Routes/WorkflowRoutes";
import { getDashboardBreadcrumbs } from "../../../../App/FeatureSet/Dashboard/src/Utils/Breadcrumbs/DashboardBreadCrumbs";
import { getMonitorBreadcrumbs } from "../../../../App/FeatureSet/Dashboard/src/Utils/Breadcrumbs/MonitorBreadcrumbs";
import { getOnCallDutyBreadcrumbs } from "../../../../App/FeatureSet/Dashboard/src/Utils/Breadcrumbs/OnCallDutyBreadcrumbs";
import { getStatusPagesBreadcrumbs } from "../../../../App/FeatureSet/Dashboard/src/Utils/Breadcrumbs/StatusPagesBreadcrumbs";
import { getWorkflowsBreadcrumbs } from "../../../../App/FeatureSet/Dashboard/src/Utils/Breadcrumbs/WorkflowsBreadcrumbs";
import PageMap from "../../../../App/FeatureSet/Dashboard/src/Utils/PageMap";
import RouteMap, {
  RouteUtil,
} from "../../../../App/FeatureSet/Dashboard/src/Utils/RouteMap";
import Project from "../../../Models/DatabaseModels/Project";
import Route from "../../../Types/API/Route";
import Link from "../../../Types/Link";
import ObjectID from "../../../Types/ObjectID";
import Navigation from "../../../UI/Utils/Navigation";
import {
  DESKTOP_WIDTH,
  MenuLink,
  PROJECT_ID,
  allLinks,
  goTo,
  renderMenu,
  routeFor,
  setViewportWidth,
} from "./SideMenuHarness";

const RESOURCE_ID: string = "6e1d2c3b-4a5f-4e6d-8c7b-9a0f1e2d3c4b";
const BASE: string = `/dashboard/${PROJECT_ID}`;

const PAGE_PROPS: PageComponentProps = {
  pageRoute: new Route(`${BASE}/home`),
  currentProject: null,
  hasPaymentMethod: true,
} as unknown as PageComponentProps;

interface Product {
  name: string;
  renderMenu: () => ReactElement;
  archivedPage: PageMap;
  archivedPath: string;
  // A resource's own page next to it, which must keep resolving.
  viewPage: PageMap;
  viewPath: string;
  breadcrumbs: (path: string) => Array<Link> | undefined;
  archivedBreadcrumbs: Array<string>;
  rootPage: PageMap;
  renderRoutes: () => ReactElement;
  archivedPageName: string;
  viewPageName: string;
}

const PRODUCTS: Array<Product> = [
  {
    name: "Workflows",
    renderMenu: () => {
      return <WorkflowsSideMenu />;
    },
    archivedPage: PageMap.WORKFLOWS_ARCHIVED,
    archivedPath: `${BASE}/workflows/archived`,
    viewPage: PageMap.WORKFLOW_VIEW,
    viewPath: `${BASE}/workflows/${RESOURCE_ID}`,
    breadcrumbs: getWorkflowsBreadcrumbs,
    archivedBreadcrumbs: ["Project", "Workflows", "Archived"],
    rootPage: PageMap.WORKFLOWS_ROOT,
    renderRoutes: () => {
      return <WorkflowRoutes {...PAGE_PROPS} />;
    },
    archivedPageName: "WorkflowsArchived",
    viewPageName: "WorkflowView",
  },
  {
    name: "Monitors",
    renderMenu: () => {
      const project: Project = new Project();
      project._id = PROJECT_ID;
      return <MonitorsSideMenu project={project} />;
    },
    archivedPage: PageMap.MONITORS_ARCHIVED,
    archivedPath: `${BASE}/monitors/archived`,
    viewPage: PageMap.MONITOR_VIEW,
    viewPath: `${BASE}/monitors/${RESOURCE_ID}`,
    breadcrumbs: getMonitorBreadcrumbs,
    archivedBreadcrumbs: ["Project", "Monitors", "Archived"],
    rootPage: PageMap.MONITORS_ROOT,
    renderRoutes: () => {
      return <MonitorsRoutes {...PAGE_PROPS} />;
    },
    archivedPageName: "MonitorsArchived",
    viewPageName: "MonitorView",
  },
  {
    name: "Status Pages",
    renderMenu: () => {
      return <StatusPagesSideMenu />;
    },
    archivedPage: PageMap.STATUS_PAGES_ARCHIVED,
    archivedPath: `${BASE}/status-pages/archived`,
    viewPage: PageMap.STATUS_PAGE_VIEW,
    viewPath: `${BASE}/status-pages/${RESOURCE_ID}`,
    breadcrumbs: getStatusPagesBreadcrumbs,
    archivedBreadcrumbs: ["Project", "Status Pages", "Archived"],
    rootPage: PageMap.STATUS_PAGES_ROOT,
    renderRoutes: () => {
      return <StatusPagesRoutes {...PAGE_PROPS} />;
    },
    archivedPageName: "StatusPagesArchived",
    viewPageName: "StatusPageView",
  },
  {
    name: "Dashboards",
    renderMenu: () => {
      return <DashboardsSideMenu />;
    },
    archivedPage: PageMap.DASHBOARDS_ARCHIVED,
    archivedPath: `${BASE}/dashboards/archived`,
    viewPage: PageMap.DASHBOARD_VIEW,
    viewPath: `${BASE}/dashboards/${RESOURCE_ID}`,
    breadcrumbs: getDashboardBreadcrumbs,
    archivedBreadcrumbs: ["Project", "Dashboards", "Archived"],
    rootPage: PageMap.DASHBOARDS_ROOT,
    renderRoutes: () => {
      return <DashboardRoutes {...PAGE_PROPS} />;
    },
    archivedPageName: "DashboardsArchived",
    viewPageName: "DashboardView",
  },
  {
    name: "On-Call Policies",
    renderMenu: () => {
      return <OnCallDutySideMenu />;
    },
    archivedPage: PageMap.ON_CALL_DUTY_POLICIES_ARCHIVED,
    archivedPath: `${BASE}/on-call-duty/policies/archived`,
    viewPage: PageMap.ON_CALL_DUTY_POLICY_VIEW,
    viewPath: `${BASE}/on-call-duty/policies/${RESOURCE_ID}`,
    breadcrumbs: getOnCallDutyBreadcrumbs,
    archivedBreadcrumbs: ["Project", "On-Call Duty", "Policies", "Archived"],
    rootPage: PageMap.ON_CALL_DUTY_ROOT,
    renderRoutes: () => {
      return <OnCallDutyRoutes {...PAGE_PROPS} />;
    },
    archivedPageName: "OnCallPoliciesArchived",
    viewPageName: "OnCallPolicyView",
  },
];

const POLICY_SETTINGS_PATH: string = `${BASE}/on-call-duty/policies/${RESOURCE_ID}/settings`;

// The page pattern the app resolves for a URL, as the layouts ask for it.
function resolve(path: string): string {
  goTo(path);
  return Navigation.getRoutePath(RouteUtil.getRoutes());
}

function titlesOf(links: Array<Link> | undefined): Array<string> {
  return (links || []).map((link: Link): string => {
    return link.title;
  });
}

function renderRoutesAt(product: Product, path: string): void {
  goTo(path);

  render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <PageRoute
          path={RouteUtil.getRouteString(product.rootPage)}
          element={product.renderRoutes()}
        />
      </Routes>
    </MemoryRouter>,
  );
}

function renderedPage(): { name: string; route: string } {
  const pages: Array<HTMLElement> = screen.queryAllByTestId("page");

  expect(pages).toHaveLength(1);

  return {
    name: pages[0]!.getAttribute("data-page") || "",
    route: pages[0]!.getAttribute("data-page-route") || "",
  };
}

beforeEach(() => {
  countCalls.length = 0;
  setViewportWidth(DESKTOP_WIDTH);
});

afterEach(() => {
  cleanup();
});

describe.each(PRODUCTS)(
  "$name: the way to archived ones",
  (product: Product) => {
    test("the menu has one Archived entry, leading to the Archived page", async () => {
      goTo(product.archivedPath);
      await renderMenu(product.renderMenu());

      const archived: Array<MenuLink> = allLinks().filter(
        (link: MenuLink): boolean => {
          return link.title === "Archived";
        },
      );

      expect(archived).toHaveLength(1);
      expect(archived[0]!.href).toBe(routeFor(product.archivedPage));
      expect(archived[0]!.href).toBe(product.archivedPath);
    });

    test("the Archived URL resolves to the Archived page, not to a resource called 'archived'", () => {
      expect(resolve(product.archivedPath)).toBe(
        RouteUtil.getRouteString(product.archivedPage),
      );
      expect(resolve(product.archivedPath)).not.toBe(
        RouteUtil.getRouteString(product.viewPage),
      );
    });

    test("a resource's own URL still resolves to its page", () => {
      expect(resolve(product.viewPath)).toBe(
        RouteUtil.getRouteString(product.viewPage),
      );
    });

    test("the Archived page's breadcrumbs lead back through the product", () => {
      expect(
        titlesOf(product.breadcrumbs(resolve(product.archivedPath))),
      ).toEqual(product.archivedBreadcrumbs);
    });

    test("the product's router opens the Archived page at its URL", () => {
      renderRoutesAt(product, product.archivedPath);

      expect(renderedPage()).toEqual({
        name: product.archivedPageName,
        route: (RouteMap[product.archivedPage] as Route).toString(),
      });
    });

    test("the product's router still opens a resource at its own URL", () => {
      renderRoutesAt(product, product.viewPath);

      expect(renderedPage().name).toBe(product.viewPageName);
    });
  },
);

describe("an on-call policy's Settings page", () => {
  test("is in the policy's menu, after its other pages and before Audit Logs", async () => {
    goTo(POLICY_SETTINGS_PATH);

    await act(async () => {
      render(
        <MemoryRouter>
          <OnCallDutyPolicySideMenu modelId={new ObjectID(RESOURCE_ID)} />
        </MemoryRouter>,
      );
    });

    const anchors: Array<HTMLAnchorElement> = Array.from(
      document.querySelectorAll("a"),
    );
    const titles: Array<string> = anchors.map(
      (anchor: HTMLAnchorElement): string => {
        return (
          anchor.querySelector("span.truncate")?.textContent ??
          anchor.textContent ??
          ""
        ).trim();
      },
    );
    const settings: HTMLAnchorElement | undefined = anchors.find(
      (anchor: HTMLAnchorElement): boolean => {
        return (anchor.textContent || "").trim() === "Settings";
      },
    );

    expect(settings).toBeDefined();
    expect(settings!.getAttribute("href")).toBe(POLICY_SETTINGS_PATH);
    expect(titles.indexOf("Settings")).toBeLessThan(
      titles.indexOf("Audit Logs"),
    );
    // Delete keeps its own page and its own name.
    expect(titles).toContain("Delete Policy");
  });

  test("resolves, with breadcrumbs back to the policy", () => {
    expect(resolve(POLICY_SETTINGS_PATH)).toBe(
      RouteUtil.getRouteString(PageMap.ON_CALL_DUTY_POLICY_VIEW_SETTINGS),
    );
    expect(
      titlesOf(getOnCallDutyBreadcrumbs(resolve(POLICY_SETTINGS_PATH))),
    ).toEqual(["Project", "On-Call Duty", "View On-Call Policy", "Settings"]);
  });

  test("opens inside the policy's own layout", () => {
    renderRoutesAt(PRODUCTS[4]!, POLICY_SETTINGS_PATH);

    expect(renderedPage()).toEqual({
      name: "OnCallPolicySettings",
      route: (
        RouteMap[PageMap.ON_CALL_DUTY_POLICY_VIEW_SETTINGS] as Route
      ).toString(),
    });
    expect(
      screen.getByTestId("page").closest('[data-layout="on-call-policy-view"]'),
    ).not.toBeNull();
  });
});

describe("the Monitors menu badges", () => {
  test("count live monitors only: an archived monitor's frozen status lights nothing", async () => {
    goTo(`${BASE}/monitors`);
    const project: Project = new Project();
    project._id = PROJECT_ID;

    await renderMenu(<MonitorsSideMenu project={project} />);

    expect(countCalls.length).toBeGreaterThanOrEqual(4);

    for (const call of countCalls) {
      expect(call["query"]).toEqual(
        expect.objectContaining({ isArchived: false }),
      );
    }
  });
});

describe("the Archived Monitors page in the Monitors layout", () => {
  test("keeps the Monitors side menu, as the other monitor lists do", async () => {
    await act(async () => {
      render(
        <MemoryRouter initialEntries={[`${BASE}/monitors/archived`]}>
          <Routes>
            <PageRoute element={<MonitorLayout {...PAGE_PROPS} />}>
              <PageRoute
                path={RouteUtil.getRouteString(PageMap.MONITORS_ARCHIVED)}
                element={<div data-testid="archived-monitors-pane" />}
              />
            </PageRoute>
          </Routes>
        </MemoryRouter>,
      );
    });

    expect(screen.getByTestId("archived-monitors-pane")).toBeInTheDocument();
    const archivedLinks: Array<HTMLAnchorElement> = Array.from(
      document.querySelectorAll("a"),
    ).filter((anchor: HTMLAnchorElement): boolean => {
      return anchor.getAttribute("href") === `${BASE}/monitors/archived`;
    });
    expect(archivedLinks.length).toBeGreaterThan(0);
  });
});
