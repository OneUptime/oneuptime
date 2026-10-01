import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import "@testing-library/jest-dom";
import {
  act,
  cleanup,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import * as React from "react";
import { MemoryRouter, Route as PageRoute, Routes } from "react-router-dom";

/*
 * Workflow runs live in a Logs section of their own, holding one entry, Runs,
 * in both workflow menus:
 *
 *   Workflows menu:        Workflows (Workflows, Global Variables)
 *                          Logs (Runs)
 *                          Settings (collapsed: Owner Rules, Label Rules)
 *
 *   A workflow's menu:     Basic (Overview, Builder, Workflow Variables)
 *                          Logs (Runs)
 *                          Owners (Owners)
 *                          Advanced (Settings, Audit Logs, Delete Workflow)
 *
 * They used to be "Runs & Logs": a third row under Workflows, and in a
 * workflow's own menu an entry under Advanced, beside Settings and Delete.
 * The pages kept their URLs (/workflows/logs and /workflows/:id/logs), so
 * links and bookmarks people already have must still open them.
 *
 * The menus are rendered for real against the app's RouteMap. The route
 * suite mounts the real WorkflowRoutes with the real layouts - so the real
 * breadcrumbs and menus - and stands in only for the pages themselves.
 */

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

jest.mock("../../../UI/Utils/Analytics", () => {
  return { __esModule: true, default: { capture: jest.fn() } };
});

// The workflow page's header reads the workflow's name.
jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getItem: async (): Promise<unknown> => {
        const WorkflowModel: new () => { name?: string } = (
          jest.requireActual("../../../Models/DatabaseModels/Workflow") as {
            default: new () => { name?: string };
          }
        ).default;
        const workflow: { name?: string } = new WorkflowModel();
        workflow.name = "Nightly sync";
        return workflow;
      },
      getList: async (): Promise<unknown> => {
        return { data: [], count: 0, skip: 0, limit: 10 };
      },
      count: async (): Promise<number> => {
        return 0;
      },
    },
  };
});

type MockPageProps = { pageRoute?: { toString: () => string } | undefined };

function mockPageModule(name: string): {
  __esModule: boolean;
  default: (props: MockPageProps) => React.ReactElement;
} {
  return {
    __esModule: true,
    default: (props: MockPageProps): React.ReactElement => {
      return (
        <div
          data-testid="page"
          data-page={name}
          data-page-route={props.pageRoute?.toString() || ""}
        >
          {name}
        </div>
      );
    },
  };
}

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Pages/Workflow/Logs",
  () => {
    return mockPageModule("AllWorkflowRuns");
  },
);
jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Pages/Workflow/View/Logs",
  () => {
    return mockPageModule("OneWorkflowRuns");
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
  "../../../../App/FeatureSet/Dashboard/src/Pages/Workflow/VariableView",
  () => {
    return mockPageModule("GlobalVariableView");
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
  "../../../../App/FeatureSet/Dashboard/src/Pages/Workflow/View/VariableView",
  () => {
    return mockPageModule("WorkflowVariableView");
  },
);
jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Pages/Workflow/View/Builder",
  () => {
    return mockPageModule("WorkflowBuilder");
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

import WorkflowsSideMenu from "../../../../App/FeatureSet/Dashboard/src/Pages/Workflow/SideMenu";
import WorkflowViewSideMenu from "../../../../App/FeatureSet/Dashboard/src/Pages/Workflow/View/SideMenu";
import WorkflowRoutes from "../../../../App/FeatureSet/Dashboard/src/Routes/WorkflowRoutes";
import { getWorkflowsBreadcrumbs } from "../../../../App/FeatureSet/Dashboard/src/Utils/Breadcrumbs/WorkflowsBreadcrumbs";
import PageMap from "../../../../App/FeatureSet/Dashboard/src/Utils/PageMap";
import RouteMap, {
  RouteUtil,
  WorkflowRoutePath,
} from "../../../../App/FeatureSet/Dashboard/src/Utils/RouteMap";
import Route from "../../../Types/API/Route";
import Link from "../../../Types/Link";
import ObjectID from "../../../Types/ObjectID";
import Navigation from "../../../UI/Utils/Navigation";
import {
  DESKTOP_WIDTH,
  MOBILE_WIDTH,
  MenuLink,
  PROJECT_ID,
  goTo,
  hrefsInMenu,
  iconCountIn,
  isExpanded,
  linksIn,
  mobileSummaryText,
  renderMenu,
  sectionBody,
  sectionRoot,
  sectionTitlesInOrder,
  setViewportWidth,
  titlesInMenu,
} from "./SideMenuHarness";

const WORKFLOW_ID: string = "0193c0de-7777-4aaa-8bbb-000000000007";

const WORKFLOWS_PATH: string = `/dashboard/${PROJECT_ID}/workflows`;
const ALL_RUNS_PATH: string = `${WORKFLOWS_PATH}/logs`;
const WORKFLOW_PATH: string = `${WORKFLOWS_PATH}/${WORKFLOW_ID}`;
const WORKFLOW_RUNS_PATH: string = `${WORKFLOW_PATH}/logs`;

const ACTIVE_LINK_CLASSES: Array<string> = [
  "bg-indigo-50",
  "text-indigo-700",
  "font-semibold",
];

interface MenuPage {
  title: string;
  section: string;
  path: string;
}

const WORKFLOWS_MENU: ReadonlyArray<MenuPage> = [
  { title: "Workflows", section: "Workflows", path: WORKFLOWS_PATH },
  {
    title: "Global Variables",
    section: "Workflows",
    path: `${WORKFLOWS_PATH}/variables`,
  },
  // Archived workflows leave the list, so the way back to them sits beside it.
  {
    title: "Archived",
    section: "Workflows",
    path: `${WORKFLOWS_PATH}/archived`,
  },
  { title: "Runs", section: "Logs", path: ALL_RUNS_PATH },
  {
    title: "Owner Rules",
    section: "Settings",
    path: `${WORKFLOWS_PATH}/settings/owner-rules`,
  },
  {
    title: "Label Rules",
    section: "Settings",
    path: `${WORKFLOWS_PATH}/settings/label-rules`,
  },
];

const WORKFLOW_MENU: ReadonlyArray<MenuPage> = [
  { title: "Overview", section: "Basic", path: WORKFLOW_PATH },
  { title: "Builder", section: "Basic", path: `${WORKFLOW_PATH}/builder` },
  {
    title: "Workflow Variables",
    section: "Basic",
    path: `${WORKFLOW_PATH}/variables`,
  },
  { title: "Runs", section: "Logs", path: WORKFLOW_RUNS_PATH },
  { title: "Owners", section: "Owners", path: `${WORKFLOW_PATH}/owners` },
  {
    title: "Settings",
    section: "Advanced",
    path: `${WORKFLOW_PATH}/settings`,
  },
  {
    title: "Audit Logs",
    section: "Advanced",
    path: `${WORKFLOW_PATH}/audit-logs`,
  },
  {
    title: "Delete Workflow",
    section: "Advanced",
    path: `${WORKFLOW_PATH}/delete`,
  },
];

function linksOf(
  pages: ReadonlyArray<MenuPage>,
  section: string,
): Array<MenuLink> {
  return pages
    .filter((page: MenuPage): boolean => {
      return page.section === section;
    })
    .map((page: MenuPage): MenuLink => {
      return { title: page.title, href: page.path };
    });
}

async function renderWorkflowsMenu(): Promise<void> {
  await renderMenu(<WorkflowsSideMenu />);
}

async function renderWorkflowMenu(): Promise<void> {
  await renderMenu(
    <WorkflowViewSideMenu modelId={new ObjectID(WORKFLOW_ID)} />,
  );
}

function activeLinks(): Array<Element> {
  return Array.from(document.querySelectorAll("nav a.bg-indigo-50"));
}

beforeEach(() => {
  setViewportWidth(DESKTOP_WIDTH);
});

afterEach(() => {
  cleanup();
});

describe("the Workflows menu", () => {
  beforeEach(() => {
    goTo(WORKFLOWS_PATH);
  });

  test("has a Logs section between Workflows and Settings", async () => {
    await renderWorkflowsMenu();

    expect(sectionTitlesInOrder()).toEqual(["Workflows", "Logs", "Settings"]);
  });

  test("Logs holds Runs alone, at the run list's existing URL", async () => {
    await renderWorkflowsMenu();

    expect(linksIn("Logs")).toEqual([{ title: "Runs", href: ALL_RUNS_PATH }]);
    expect(ALL_RUNS_PATH).toBe(
      RouteUtil.populateRouteParams(
        RouteMap[PageMap.WORKFLOWS_LOGS] as Route,
      ).toString(),
    );
  });

  test("the Workflows section keeps only Workflows, Global Variables and Archived", async () => {
    await renderWorkflowsMenu();

    expect(linksIn("Workflows")).toEqual(linksOf(WORKFLOWS_MENU, "Workflows"));
    expect(linksIn("Settings")).toEqual(linksOf(WORKFLOWS_MENU, "Settings"));
  });

  test("lists every page once, in order", async () => {
    await renderWorkflowsMenu();

    expect(hrefsInMenu()).toEqual(
      WORKFLOWS_MENU.map((page: MenuPage): string => {
        return page.path;
      }),
    );
    expect(titlesInMenu()).toEqual(
      WORKFLOWS_MENU.map((page: MenuPage): string => {
        return page.title;
      }),
    );
  });

  test("Logs is open on the landing page, while Settings starts collapsed", async () => {
    await renderWorkflowsMenu();

    expect(isExpanded("Logs")).toBe(true);
    expect(sectionBody("Logs")).not.toHaveClass("max-h-0");
    expect(screen.getByRole("link", { name: "Runs" })).toBeVisible();
    expect(isExpanded("Settings")).toBe(false);
  });

  test("on the Runs page, Runs is the one active entry", async () => {
    goTo(ALL_RUNS_PATH);
    await renderWorkflowsMenu();

    const runs: HTMLElement = screen.getByRole("link", { name: "Runs" });

    expect(runs).toHaveAttribute("href", ALL_RUNS_PATH);
    expect(runs).toHaveClass(...ACTIVE_LINK_CLASSES);
    expect(activeLinks()).toEqual([runs]);
    expect(isExpanded("Logs")).toBe(true);
  });

  test("on a phone, the menu button names Logs / Runs on the Runs page", async () => {
    setViewportWidth(MOBILE_WIDTH);
    goTo(ALL_RUNS_PATH);
    await renderWorkflowsMenu();

    expect(mobileSummaryText()).toContain("Logs / Runs");
  });

  test("every entry keeps an icon", async () => {
    await renderWorkflowsMenu();

    sectionTitlesInOrder().forEach((section: string) => {
      expect(iconCountIn(section)).toBe(linksIn(section).length);
    });
  });

  test("nothing in it is called Runs & Logs any more", async () => {
    await renderWorkflowsMenu();

    expect(titlesInMenu()).not.toContain("Runs & Logs");
    expect(document.body.textContent).not.toContain("Runs & Logs");
  });
});

describe("a workflow's own menu", () => {
  beforeEach(() => {
    goTo(WORKFLOW_PATH);
  });

  test("has Basic, Logs, Owners and Advanced, in that order", async () => {
    await renderWorkflowMenu();

    expect(sectionTitlesInOrder()).toEqual([
      "Basic",
      "Logs",
      "Owners",
      "Advanced",
    ]);
  });

  test("Logs holds Runs alone, at the workflow's existing runs URL", async () => {
    await renderWorkflowMenu();

    expect(linksIn("Logs")).toEqual([
      { title: "Runs", href: WORKFLOW_RUNS_PATH },
    ]);
    expect(WORKFLOW_RUNS_PATH).toBe(
      RouteUtil.populateRouteParams(RouteMap[PageMap.WORKFLOW_LOGS] as Route, {
        modelId: new ObjectID(WORKFLOW_ID),
      }).toString(),
    );
  });

  test("Advanced no longer lists the runs: Settings, Audit Logs and Delete Workflow", async () => {
    await renderWorkflowMenu();

    expect(linksIn("Advanced")).toEqual(linksOf(WORKFLOW_MENU, "Advanced"));
    expect(
      within(sectionRoot("Advanced")).queryByRole("link", { name: /Runs/ }),
    ).toBeNull();
  });

  test("Basic and Owners are unchanged", async () => {
    await renderWorkflowMenu();

    expect(linksIn("Basic")).toEqual(linksOf(WORKFLOW_MENU, "Basic"));
    expect(linksIn("Owners")).toEqual(linksOf(WORKFLOW_MENU, "Owners"));
  });

  test("lists all eight pages once, in order", async () => {
    await renderWorkflowMenu();

    const hrefs: Array<string> = hrefsInMenu();

    expect(hrefs).toHaveLength(8);
    expect(new Set(hrefs).size).toBe(8);
    expect(hrefs).toEqual(
      WORKFLOW_MENU.map((page: MenuPage): string => {
        return page.path;
      }),
    );
  });

  /*
   * Advanced is the section other menus fold away by default. Runs must not
   * depend on it staying open: on every other page of a workflow - none of
   * them inside Logs, so nothing forces Logs open - Runs is on screen.
   */
  test.each(
    WORKFLOW_MENU.filter((page: MenuPage): boolean => {
      return page.section !== "Logs";
    }),
  )("Runs is on screen on the $title page", async (page: MenuPage) => {
    goTo(page.path);
    await renderWorkflowMenu();

    expect(isExpanded("Logs")).toBe(true);
    expect(sectionBody("Logs")).not.toHaveClass("max-h-0");
    expect(screen.getByRole("link", { name: "Runs" })).toBeVisible();
  });

  test("on the Runs page, Runs is the one active entry", async () => {
    goTo(WORKFLOW_RUNS_PATH);
    await renderWorkflowMenu();

    const runs: HTMLElement = screen.getByRole("link", { name: "Runs" });

    expect(runs).toHaveClass(...ACTIVE_LINK_CLASSES);
    expect(activeLinks()).toEqual([runs]);
    expect(isExpanded("Logs")).toBe(true);
  });

  test("on a phone, the menu button names Logs / Runs on the Runs page", async () => {
    setViewportWidth(MOBILE_WIDTH);
    goTo(WORKFLOW_RUNS_PATH);
    await renderWorkflowMenu();

    expect(mobileSummaryText()).toContain("Logs / Runs");
  });

  test("Delete Workflow stays last, with its danger hover", async () => {
    await renderWorkflowMenu();

    const advanced: Array<MenuLink> = linksIn("Advanced");

    expect(advanced[advanced.length - 1]).toEqual({
      title: "Delete Workflow",
      href: `${WORKFLOW_PATH}/delete`,
    });
    expect(screen.getByRole("link", { name: "Delete Workflow" })).toHaveClass(
      "danger-on-hover",
    );
  });

  test("every entry keeps an icon, and nothing is called Runs & Logs", async () => {
    await renderWorkflowMenu();

    sectionTitlesInOrder().forEach((section: string) => {
      expect(iconCountIn(section)).toBe(linksIn(section).length);
    });
    expect(document.body.textContent).not.toContain("Runs & Logs");
  });
});

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

describe("the run pages' breadcrumbs", () => {
  test("the project's runs: Project > Workflows > Runs", () => {
    const links: Array<Link> = breadcrumbsAt(ALL_RUNS_PATH);

    expect(titlesOf(links)).toEqual(["Project", "Workflows", "Runs"]);
    expect(links[1]?.to.toString()).toBe(WORKFLOWS_PATH);
    // The last crumb is the page itself, drawn as text rather than a link.
    expect(links[2]?.to.toString()).toBe(ALL_RUNS_PATH);
  });

  test("a workflow's runs: Project > Workflows > View Workflow > Runs", () => {
    const links: Array<Link> = breadcrumbsAt(WORKFLOW_RUNS_PATH);

    expect(titlesOf(links)).toEqual([
      "Project",
      "Workflows",
      "View Workflow",
      "Runs",
    ]);
    expect(links[2]?.to.toString()).toBe(WORKFLOW_PATH);
    expect(links[3]?.to.toString()).toBe(WORKFLOW_RUNS_PATH);
  });

  test("no workflow page's trail ends in the old Logs title", () => {
    const leaves: Array<string> = [
      PageMap.WORKFLOWS,
      ...Object.keys(WorkflowRoutePath),
    ].map((page: string): string => {
      const links: Array<Link> =
        getWorkflowsBreadcrumbs(RouteUtil.getRouteString(page)) || [];
      return links[links.length - 1]?.title || "";
    });

    expect(leaves).not.toContain("Logs");
    expect(leaves).not.toContain("Runs & Logs");
    expect(
      leaves.filter((leaf: string): boolean => {
        return leaf === "Runs";
      }),
    ).toHaveLength(2);
  });
});

function renderWorkflowRoutesAt(path: string): void {
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

function breadcrumbTrail(): HTMLElement {
  return screen.getByRole("navigation", { name: "Breadcrumb" });
}

function crumbTexts(): Array<string> {
  return within(breadcrumbTrail())
    .getAllByRole("listitem")
    .map((item: HTMLElement): string => {
      return item.textContent?.trim() || "";
    });
}

describe("the run pages keep their URLs", () => {
  test("/workflows/logs still opens the project's runs, under the Workflows menu", async () => {
    renderWorkflowRoutesAt(ALL_RUNS_PATH);

    const page: HTMLElement = await screen.findByTestId("page");

    expect(page).toHaveAttribute("data-page", "AllWorkflowRuns");
    expect(page).toHaveAttribute(
      "data-page-route",
      RouteMap[PageMap.WORKFLOWS_LOGS]!.toString(),
    );
    expect(crumbTexts()).toEqual(["Project", "Workflows", "Runs"]);

    const runs: HTMLElement = screen.getByRole("link", { name: "Runs" });
    expect(runs).toHaveAttribute("href", ALL_RUNS_PATH);
    expect(runs).toHaveClass(...ACTIVE_LINK_CLASSES);
    expect(sectionTitlesInOrder()).toEqual(["Workflows", "Logs", "Settings"]);
  });

  test("/workflows/:id/logs still opens that workflow's runs, under its own menu", async () => {
    renderWorkflowRoutesAt(WORKFLOW_RUNS_PATH);

    const page: HTMLElement = await screen.findByTestId("page");

    expect(page).toHaveAttribute("data-page", "OneWorkflowRuns");
    expect(page).toHaveAttribute(
      "data-page-route",
      RouteMap[PageMap.WORKFLOW_LOGS]!.toString(),
    );

    // The header names the workflow; the trail ends in Runs.
    await waitFor(() => {
      expect(document.body.textContent).toContain("Nightly sync");
    });
    expect(crumbTexts()).toEqual([
      "Project",
      "Workflows",
      "View Workflow",
      "Runs",
    ]);

    const runs: HTMLElement = screen.getByRole("link", { name: "Runs" });
    expect(runs).toHaveAttribute("href", WORKFLOW_RUNS_PATH);
    expect(runs).toHaveClass(...ACTIVE_LINK_CLASSES);
    expect(sectionTitlesInOrder()).toEqual([
      "Basic",
      "Logs",
      "Owners",
      "Advanced",
    ]);
  });

  test("the run URLs resolve to the run pages and nothing else", () => {
    expect(resolve(ALL_RUNS_PATH)).toBe(
      RouteUtil.getRouteString(PageMap.WORKFLOWS_LOGS),
    );
    expect(resolve(WORKFLOW_RUNS_PATH)).toBe(
      RouteUtil.getRouteString(PageMap.WORKFLOW_LOGS),
    );
    expect(WorkflowRoutePath[PageMap.WORKFLOWS_LOGS]).toBe("logs");
    expect(WorkflowRoutePath[PageMap.WORKFLOW_LOGS]).toBe(":id/logs");
  });

  test("the page under the run list's URL is not mistaken for a workflow", async () => {
    // "logs" sits where a workflow id would; it must not open a workflow.
    await act(async () => {
      renderWorkflowRoutesAt(ALL_RUNS_PATH);
    });

    expect(screen.queryByText("WorkflowOverview")).toBeNull();
    expect(screen.getAllByTestId("page")).toHaveLength(1);
  });
});
