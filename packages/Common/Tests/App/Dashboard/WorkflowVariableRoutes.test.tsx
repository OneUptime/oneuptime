import { afterEach, describe, expect, jest, test } from "@jest/globals";
import "@testing-library/jest-dom";
import { cleanup, render, screen, within } from "@testing-library/react";
import * as React from "react";
import {
  MemoryRouter,
  Outlet,
  Route as PageRoute,
  Routes,
  matchRoutes,
} from "react-router-dom";

/*
 * Where a workflow variable's own page lives. Everything done to one variable
 * moved off the list and onto this page, for global variables (Workflows >
 * Global Variables > View Variable) and for a workflow's own variables
 * (Workflow > Variables > View Variable). So each page needs a route the app
 * resolves, a breadcrumb trail that leads back to the right list, and a place
 * in WorkflowRoutes under the right layout.
 *
 * The global view URL, /workflows/variables/:id, sits right next to the
 * workflow view URL, /workflows/:id - the checks below make sure "variables"
 * is never read as a workflow id, and that the plain list URLs still open the
 * lists.
 *
 * The route-rendering half mounts the real WorkflowRoutes with every page and
 * both layouts replaced by recorders (the layouts render an <Outlet/> inside a
 * marker, so the test can see which layout a page landed in). The two variable
 * view pages stay real, with only the WorkflowVariableView component beneath
 * them recorded, so the ids each page reads from the URL are checked too.
 */

type RecordedPage = { name: string; pageRoute: string };

const renderedPages: Array<RecordedPage> = [];

type RecordedVariableViewProps = {
  variableId: string;
  workflowId: string | undefined;
};

const variableViewProps: Array<RecordedVariableViewProps> = [];

type MockPageProps = { pageRoute?: { toString: () => string } | undefined };

function mockPageModule(name: string): {
  __esModule: boolean;
  default: (props: MockPageProps) => React.ReactElement;
} {
  return {
    __esModule: true,
    default: (props: MockPageProps): React.ReactElement => {
      const pageRoute: string = props.pageRoute?.toString() || "";
      renderedPages.push({ name, pageRoute });
      return (
        <div data-testid="page" data-page={name} data-page-route={pageRoute}>
          {name}
        </div>
      );
    },
  };
}

function mockLayoutModule(testId: string): {
  __esModule: boolean;
  default: () => React.ReactElement;
} {
  return {
    __esModule: true,
    default: (): React.ReactElement => {
      return (
        <div data-testid={testId}>
          <Outlet />
        </div>
      );
    },
  };
}

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Pages/Workflow/Layout",
  () => {
    return mockLayoutModule("workflows-layout");
  },
);
jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Pages/Workflow/View/Layout",
  () => {
    return mockLayoutModule("workflow-view-layout");
  },
);
jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Pages/Workflow/Workflows",
  () => {
    return mockPageModule("Workflows");
  },
);
jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Pages/Workflow/Variable",
  () => {
    return mockPageModule("GlobalVariables");
  },
);
jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Pages/Workflow/Logs",
  () => {
    return mockPageModule("WorkflowsLogs");
  },
);
jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Pages/Workflow/Settings/OwnerRules",
  () => {
    return mockPageModule("OwnerRules");
  },
);
jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Pages/Workflow/Settings/LabelRules",
  () => {
    return mockPageModule("LabelRules");
  },
);
jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Pages/Workflow/View/Index",
  () => {
    return mockPageModule("WorkflowOverview");
  },
);
jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Pages/Workflow/View/Settings",
  () => {
    return mockPageModule("WorkflowSettings");
  },
);
jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Pages/Workflow/View/Variable",
  () => {
    return mockPageModule("WorkflowVariables");
  },
);
jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Pages/Workflow/View/Builder",
  () => {
    return mockPageModule("WorkflowBuilder");
  },
);
jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Pages/Workflow/View/Logs",
  () => {
    return mockPageModule("WorkflowLogs");
  },
);
jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Pages/Workflow/View/Owners",
  () => {
    return mockPageModule("WorkflowOwners");
  },
);
jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Pages/Workflow/View/AuditLogs",
  () => {
    return mockPageModule("WorkflowAuditLogs");
  },
);
jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Pages/Workflow/View/Delete",
  () => {
    return mockPageModule("WorkflowDelete");
  },
);

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Workflow/WorkflowVariableView",
  () => {
    return {
      __esModule: true,
      default: (props: {
        variableId: { toString: () => string };
        workflowId?: { toString: () => string } | undefined;
      }): React.ReactElement => {
        const recorded: RecordedVariableViewProps = {
          variableId: props.variableId.toString(),
          workflowId: props.workflowId?.toString(),
        };
        variableViewProps.push(recorded);
        return (
          <div
            data-testid="variable-view"
            data-variable-id={recorded.variableId}
            data-workflow-id={recorded.workflowId || ""}
          />
        );
      },
    };
  },
);

import WorkflowRoutes from "../../../../App/FeatureSet/Dashboard/src/Routes/WorkflowRoutes";
import { getWorkflowsBreadcrumbs } from "../../../../App/FeatureSet/Dashboard/src/Utils/Breadcrumbs/WorkflowsBreadcrumbs";
import PageMap from "../../../../App/FeatureSet/Dashboard/src/Utils/PageMap";
import RouteMap, {
  RouteUtil,
  WorkflowRoutePath,
} from "../../../../App/FeatureSet/Dashboard/src/Utils/RouteMap";
import {
  getWorkflowVariableViewRoute,
  getWorkflowVariablesListRoute,
} from "../../../../App/FeatureSet/Dashboard/src/Utils/Workflow/WorkflowVariableUtil";
import Route from "../../../Types/API/Route";
import Link from "../../../Types/Link";
import ObjectID from "../../../Types/ObjectID";
import Navigation from "../../../UI/Utils/Navigation";
import { goTo, PROJECT_ID } from "./SideMenuHarness";

const WORKFLOW_ID: string = "1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d";
const VARIABLE_ID: string = "9c4a2b1e-7d3f-4e8a-9b6c-1f2e3d4c5b6a";

const WORKFLOWS_URL: string = `/dashboard/${PROJECT_ID}/workflows`;
const GLOBAL_LIST_URL: string = `${WORKFLOWS_URL}/variables`;
const GLOBAL_VIEW_URL: string = `${WORKFLOWS_URL}/variables/${VARIABLE_ID}`;
const WORKFLOW_URL: string = `${WORKFLOWS_URL}/${WORKFLOW_ID}`;
const LOCAL_LIST_URL: string = `${WORKFLOW_URL}/variables`;
const LOCAL_VIEW_URL: string = `${WORKFLOW_URL}/variables/${VARIABLE_ID}`;

const GLOBAL_VIEW_PATTERN: string =
  "/dashboard/:projectId/workflows/variables/:id";
const LOCAL_VIEW_PATTERN: string =
  "/dashboard/:projectId/workflows/:id/variables/:subModelId";

// Mount points (`/*`) only nest child routers; they are not pages.
const realRoutes: Array<{ path: string }> = RouteUtil.getRoutes().filter(
  (route: { path: string }): boolean => {
    return !route.path.includes("*");
  },
);

// The page pattern the app resolves for a URL, as the layouts ask for it.
function resolve(path: string): string {
  goTo(path);
  return Navigation.getRoutePath(RouteUtil.getRoutes());
}

function breadcrumbsAt(path: string): Array<Link> {
  const links: Array<Link> | undefined = getWorkflowsBreadcrumbs(resolve(path));

  if (!links) {
    throw new Error(`No breadcrumbs for ${path}.`);
  }

  return links;
}

function titlesOf(links: Array<Link>): Array<string> {
  return links.map((link: Link): string => {
    return link.title;
  });
}

function hrefsOf(links: Array<Link>): Array<string> {
  return links.map((link: Link): string => {
    return link.to.toString();
  });
}

function renderWorkflowRoutesAt(path: string): void {
  // The variable view pages read their ids from the address bar.
  goTo(path);

  render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <PageRoute
          path={RouteUtil.getRouteString(PageMap.WORKFLOWS_ROOT)}
          element={
            <WorkflowRoutes
              pageRoute={RouteMap[PageMap.WORKFLOWS_ROOT] as Route}
              currentProject={null}
              hasPaymentMethod={false}
            />
          }
        />
      </Routes>
    </MemoryRouter>,
  );
}

function renderedPageNames(): Array<string> {
  return screen.queryAllByTestId("page").map((element: HTMLElement): string => {
    return element.getAttribute("data-page") || "";
  });
}

afterEach(() => {
  cleanup();
  renderedPages.length = 0;
  variableViewProps.length = 0;
});

describe("workflow variable routes", () => {
  test("a global variable's page is /workflows/variables/:id", () => {
    expect(RouteMap[PageMap.WORKFLOWS_VARIABLE_VIEW]?.toString()).toBe(
      GLOBAL_VIEW_PATTERN,
    );
    expect(WorkflowRoutePath[PageMap.WORKFLOWS_VARIABLE_VIEW]).toBe(
      "variables/:id",
    );
  });

  test("a workflow's own variable's page is /workflows/:id/variables/:subModelId", () => {
    expect(RouteMap[PageMap.WORKFLOW_VARIABLE_VIEW]?.toString()).toBe(
      LOCAL_VIEW_PATTERN,
    );
    expect(WorkflowRoutePath[PageMap.WORKFLOW_VARIABLE_VIEW]).toBe(
      ":id/variables/:subModelId",
    );
  });

  test("the lists keep their routes", () => {
    expect(RouteMap[PageMap.WORKFLOWS_VARIABLES]?.toString()).toBe(
      "/dashboard/:projectId/workflows/variables",
    );
    expect(RouteMap[PageMap.WORKFLOW_VARIABLES]?.toString()).toBe(
      "/dashboard/:projectId/workflows/:id/variables",
    );
  });

  /*
   * WorkflowRoutes nests the local view page under the workflow's `:id`
   * route, so it registers only the last two segments.
   */
  test("the local view page's nested path is variables/:subModelId", () => {
    expect(RouteUtil.getLastPathForKey(PageMap.WORKFLOW_VARIABLE_VIEW, 2)).toBe(
      "variables/:subModelId",
    );
    expect(
      `${WorkflowRoutePath[PageMap.WORKFLOW_VIEW]}/${RouteUtil.getLastPathForKey(
        PageMap.WORKFLOW_VARIABLE_VIEW,
        2,
      )}`,
    ).toBe(WorkflowRoutePath[PageMap.WORKFLOW_VARIABLE_VIEW]);
  });

  test("every workflows page is mounted under /dashboard/:projectId/workflows", () => {
    Object.keys(WorkflowRoutePath).forEach((page: string) => {
      expect(RouteUtil.getRouteString(page)).toBe(
        `/dashboard/:projectId/workflows/${WorkflowRoutePath[page]}`,
      );
    });
  });
});

describe("resolving workflow variable URLs", () => {
  test("a global variable's URL resolves to its view page", () => {
    expect(resolve(GLOBAL_VIEW_URL)).toBe(GLOBAL_VIEW_PATTERN);
  });

  test("a local variable's URL resolves to its view page", () => {
    expect(resolve(LOCAL_VIEW_URL)).toBe(LOCAL_VIEW_PATTERN);
  });

  // `variables` must not be read as a workflow id.
  test("the global view URL is not mistaken for a workflow's pages", () => {
    const matched: string = resolve(GLOBAL_VIEW_URL);

    expect(matched).not.toBe(RouteUtil.getRouteString(PageMap.WORKFLOW_VIEW));
    expect(matched).not.toBe(
      RouteUtil.getRouteString(PageMap.WORKFLOW_VARIABLES),
    );
    expect(matched).not.toBe(LOCAL_VIEW_PATTERN);
  });

  test("the global list URL still opens the global list", () => {
    expect(resolve(GLOBAL_LIST_URL)).toBe(
      RouteUtil.getRouteString(PageMap.WORKFLOWS_VARIABLES),
    );
  });

  test("a workflow's variables URL still opens its list", () => {
    expect(resolve(LOCAL_LIST_URL)).toBe(
      RouteUtil.getRouteString(PageMap.WORKFLOW_VARIABLES),
    );
  });

  test("a workflow's own URL still opens the workflow", () => {
    expect(resolve(WORKFLOW_URL)).toBe(
      RouteUtil.getRouteString(PageMap.WORKFLOW_VIEW),
    );
  });

  /*
   * The list's View button and the variable page's Delete both build their
   * destination with these helpers; what they build has to open the page.
   */
  test("the links the list and the view page build resolve to the right pages", () => {
    goTo(WORKFLOWS_URL);
    const variableId: ObjectID = new ObjectID(VARIABLE_ID);
    const workflowId: ObjectID = new ObjectID(WORKFLOW_ID);

    const globalView: string = getWorkflowVariableViewRoute({
      variableId,
    }).toString();
    const localView: string = getWorkflowVariableViewRoute({
      variableId,
      workflowId,
    }).toString();
    const globalList: string = getWorkflowVariablesListRoute().toString();
    const localList: string =
      getWorkflowVariablesListRoute(workflowId).toString();

    expect(globalView).toBe(GLOBAL_VIEW_URL);
    expect(localView).toBe(LOCAL_VIEW_URL);
    expect(globalList).toBe(GLOBAL_LIST_URL);
    expect(localList).toBe(LOCAL_LIST_URL);

    expect(resolve(globalView)).toBe(GLOBAL_VIEW_PATTERN);
    expect(resolve(localView)).toBe(LOCAL_VIEW_PATTERN);
    expect(resolve(globalList)).toBe(
      RouteUtil.getRouteString(PageMap.WORKFLOWS_VARIABLES),
    );
    expect(resolve(localList)).toBe(
      RouteUtil.getRouteString(PageMap.WORKFLOW_VARIABLES),
    );
  });
});

describe("workflow variable breadcrumbs", () => {
  test("a global variable's page reads Project > Workflows > Variables > View Variable", () => {
    const links: Array<Link> = breadcrumbsAt(GLOBAL_VIEW_URL);

    expect(titlesOf(links)).toEqual([
      "Project",
      "Workflows",
      "Variables",
      "View Variable",
    ]);
    expect(hrefsOf(links)).toEqual([
      `/dashboard/${PROJECT_ID}`,
      WORKFLOWS_URL,
      GLOBAL_LIST_URL,
      GLOBAL_VIEW_URL,
    ]);
  });

  test("a local variable's page reads Project > Workflows > View Workflow > Variables > View Variable", () => {
    const links: Array<Link> = breadcrumbsAt(LOCAL_VIEW_URL);

    expect(titlesOf(links)).toEqual([
      "Project",
      "Workflows",
      "View Workflow",
      "Variables",
      "View Variable",
    ]);
    expect(hrefsOf(links)).toEqual([
      `/dashboard/${PROJECT_ID}`,
      WORKFLOWS_URL,
      WORKFLOW_URL,
      LOCAL_LIST_URL,
      LOCAL_VIEW_URL,
    ]);
  });

  // Back from a workflow's variable goes to that workflow's list, not the global one.
  test("a local variable's Variables crumb leads to its workflow's list", () => {
    const links: Array<Link> = breadcrumbsAt(LOCAL_VIEW_URL);
    const variablesCrumb: Link | undefined = links.find((link: Link) => {
      return link.title === "Variables";
    });

    expect(variablesCrumb?.to.toString()).toBe(LOCAL_LIST_URL);
    expect(variablesCrumb?.to.toString()).not.toBe(GLOBAL_LIST_URL);
    expect(
      matchRoutes(realRoutes, variablesCrumb!.to.toString())?.[0]?.route.path,
    ).toBe(RouteUtil.getRouteString(PageMap.WORKFLOW_VARIABLES));
  });

  test("a global variable's Variables crumb leads to the global list", () => {
    const links: Array<Link> = breadcrumbsAt(GLOBAL_VIEW_URL);
    const variablesCrumb: Link | undefined = links.find((link: Link) => {
      return link.title === "Variables";
    });

    expect(
      matchRoutes(realRoutes, variablesCrumb!.to.toString())?.[0]?.route.path,
    ).toBe(RouteUtil.getRouteString(PageMap.WORKFLOWS_VARIABLES));
  });

  test.each([GLOBAL_VIEW_URL, LOCAL_VIEW_URL])(
    "every crumb on %s leads to a real page",
    (url: string) => {
      breadcrumbsAt(url).forEach((link: Link) => {
        expect(link.to.toString()).not.toMatch(/[:*]/);
        expect(matchRoutes(realRoutes, link.to.toString())).not.toBeNull();
      });
    },
  );

  test("the lists keep their trails", () => {
    expect(titlesOf(breadcrumbsAt(GLOBAL_LIST_URL))).toEqual([
      "Project",
      "Workflows",
      "Variables",
    ]);
    expect(titlesOf(breadcrumbsAt(LOCAL_LIST_URL))).toEqual([
      "Project",
      "Workflows",
      "View Workflow",
      "Variables",
    ]);
  });
});

describe("WorkflowRoutes", () => {
  /*
   * The global view page renders inside the Workflows layout (its side menu
   * has Global Variables), with no workflow id: WorkflowVariableView reads a
   * missing workflow id as "this is a global variable".
   */
  test("renders a global variable's page in the Workflows layout", () => {
    renderWorkflowRoutesAt(GLOBAL_VIEW_URL);

    const layout: HTMLElement = screen.getByTestId("workflows-layout");
    const view: HTMLElement = within(layout).getByTestId("variable-view");

    expect(view).toHaveAttribute("data-variable-id", VARIABLE_ID);
    expect(view).toHaveAttribute("data-workflow-id", "");
    expect(variableViewProps).toHaveLength(1);
    expect(variableViewProps[0]?.workflowId).toBeUndefined();
    expect(screen.queryByTestId("workflow-view-layout")).toBeNull();
    // Not the workflow overview for a workflow called "variables", nor the list.
    expect(renderedPageNames()).toEqual([]);
  });

  test("renders a local variable's page in the workflow's layout", () => {
    renderWorkflowRoutesAt(LOCAL_VIEW_URL);

    const layout: HTMLElement = screen.getByTestId("workflow-view-layout");
    const view: HTMLElement = within(layout).getByTestId("variable-view");

    expect(view).toHaveAttribute("data-variable-id", VARIABLE_ID);
    expect(view).toHaveAttribute("data-workflow-id", WORKFLOW_ID);
    expect(variableViewProps).toEqual([
      { variableId: VARIABLE_ID, workflowId: WORKFLOW_ID },
    ]);
    expect(screen.queryByTestId("workflows-layout")).toBeNull();
    expect(renderedPageNames()).toEqual([]);
  });

  // The workflow id is three segments from the end, the variable id is the last.
  test("reads the workflow id and the variable id from the right segments", () => {
    const otherWorkflowId: string = "0f1e2d3c-4b5a-4968-8776-655443322110";
    const otherVariableId: string = "5d6c7b8a-9f0e-4d1c-8b2a-3948576a1b2c";

    renderWorkflowRoutesAt(
      `${WORKFLOWS_URL}/${otherWorkflowId}/variables/${otherVariableId}`,
    );

    expect(variableViewProps).toEqual([
      { variableId: otherVariableId, workflowId: otherWorkflowId },
    ]);
  });

  test("still renders the global list at /workflows/variables", () => {
    renderWorkflowRoutesAt(GLOBAL_LIST_URL);

    const layout: HTMLElement = screen.getByTestId("workflows-layout");
    const page: HTMLElement = within(layout).getByTestId("page");

    expect(page).toHaveAttribute("data-page", "GlobalVariables");
    expect(page).toHaveAttribute(
      "data-page-route",
      RouteUtil.getRouteString(PageMap.WORKFLOWS_VARIABLES),
    );
    expect(screen.queryByTestId("variable-view")).toBeNull();
  });

  test("still renders a workflow's list at /workflows/:id/variables", () => {
    renderWorkflowRoutesAt(LOCAL_LIST_URL);

    const layout: HTMLElement = screen.getByTestId("workflow-view-layout");
    const page: HTMLElement = within(layout).getByTestId("page");

    expect(page).toHaveAttribute("data-page", "WorkflowVariables");
    expect(page).toHaveAttribute(
      "data-page-route",
      RouteUtil.getRouteString(PageMap.WORKFLOW_VARIABLES),
    );
    expect(screen.queryByTestId("variable-view")).toBeNull();
  });

  test("still renders the workflow overview at /workflows/:id", () => {
    renderWorkflowRoutesAt(WORKFLOW_URL);

    expect(renderedPageNames()).toEqual(["WorkflowOverview"]);
    expect(screen.queryByTestId("variable-view")).toBeNull();
  });

  test("renders nothing for a variable URL with an extra segment", () => {
    renderWorkflowRoutesAt(`${LOCAL_VIEW_URL}/extra`);

    expect(screen.queryByTestId("variable-view")).toBeNull();
    expect(renderedPageNames()).toEqual([]);
  });
});
