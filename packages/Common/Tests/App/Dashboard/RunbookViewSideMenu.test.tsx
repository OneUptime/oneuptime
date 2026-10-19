import "@testing-library/jest-dom";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import * as React from "react";
import {
  BrowserRouter,
  Route as RouterRoute,
  Routes,
  useLocation,
  useNavigate,
  useParams,
} from "react-router-dom";

/*
 * A RUNBOOK'S OWN SIDE MENU SHOWS AS LITTLE AS IT CAN.
 *
 * The maintainer: "In an effort to make oneuptime simple, can you please move
 * executions to logs in the side menu, in the log section, which should be
 * collapsed by default? Can you please move triggers to the settings side
 * menu, which should also be collapsed by default? The idea is to show as
 * little stuff as possible to the user, so it reduces decision paralysis."
 *
 * So a runbook's menu reads:
 *
 *   Basic       Overview, Steps                    open
 *   Logs        Executions                         folded
 *   Owners      Owners                             folded
 *   Settings    Triggers, Settings                 folded
 *   Developer   Terraform, API, AI Assistants      folded
 *   Advanced    Audit Logs, Delete Runbook         folded
 *
 * Executions and Triggers used to sit in Basic, open on every visit, and the
 * Settings page under Advanced. Every page kept its URL and its breadcrumbs.
 * A folded section opens by itself on a page inside it - one run's page
 * included, where Executions stays the marked entry - so the page someone is
 * on is never folded away.
 *
 * The menu is rendered for real against the app's RouteMap; the last part
 * mounts the real Runbooks route group with the real view layout (so the
 * real header, breadcrumbs and menu), standing in only for the pages.
 */

jest.mock("react-i18next", () => {
  return {
    useTranslation: () => {
      return {
        t: (key: string, options?: unknown): string => {
          if (options && typeof options === "object") {
            return (options as { defaultValue?: string }).defaultValue ?? key;
          }
          return typeof options === "string" ? options : key;
        },
        i18n: { language: "en" },
      };
    },
  };
});

jest.mock("../../../UI/Utils/Analytics", () => {
  return { __esModule: true, default: { capture: jest.fn() } };
});

// The runbook's page header reads the runbook's name.
jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getItem: async (): Promise<unknown> => {
        const RunbookModel: new () => { name?: string } = (
          jest.requireActual("../../../Models/DatabaseModels/Runbook") as {
            default: new () => { name?: string };
          }
        ).default;
        const runbook: { name?: string } = new RunbookModel();
        runbook.name = "Restart the web tier";
        return runbook;
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

// A stand-in for one page of the route group: its name, and the route it was given.
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
  "../../../../App/FeatureSet/Dashboard/src/Pages/Runbook/Runbooks",
  () => {
    return mockPageModule("Runbooks");
  },
);
jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Pages/Runbook/Executions",
  () => {
    return mockPageModule("AllRunbookExecutions");
  },
);
jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Pages/Runbook/Secrets",
  () => {
    return mockPageModule("Secrets");
  },
);
jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Pages/Runbook/Runners/Runners",
  () => {
    return mockPageModule("Runners");
  },
);
jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Pages/Runbook/Runners/RunnerView",
  () => {
    return mockPageModule("RunnerView");
  },
);
jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Pages/Runbook/Runners/RunnerCredentials",
  () => {
    return mockPageModule("RunnerCredentials");
  },
);
jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Pages/Runbook/Settings/OwnerRules",
  () => {
    return mockPageModule("OwnerRules");
  },
);
jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Pages/Runbook/Settings/LabelRules",
  () => {
    return mockPageModule("LabelRules");
  },
);
jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Pages/Runbook/View/Index",
  () => {
    return mockPageModule("RunbookOverview");
  },
);
jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Pages/Runbook/View/Steps",
  () => {
    return mockPageModule("RunbookSteps");
  },
);
jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Pages/Runbook/View/Executions",
  () => {
    return mockPageModule("RunbookExecutions");
  },
);
jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Pages/Runbook/View/ExecutionView",
  () => {
    return mockPageModule("RunbookExecution");
  },
);
jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Pages/Runbook/View/Triggers",
  () => {
    return mockPageModule("RunbookTriggers");
  },
);
jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Pages/Runbook/View/Owners",
  () => {
    return mockPageModule("RunbookOwners");
  },
);
jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Pages/Runbook/View/AuditLogs",
  () => {
    return mockPageModule("RunbookAuditLogs");
  },
);
jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Pages/Runbook/View/Settings",
  () => {
    return mockPageModule("RunbookSettings");
  },
);
jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Pages/Runbook/View/Delete",
  () => {
    return mockPageModule("RunbookDelete");
  },
);

import RunbookViewSideMenu from "../../../../App/FeatureSet/Dashboard/src/Pages/Runbook/View/SideMenu";
import RunbookRoutes from "../../../../App/FeatureSet/Dashboard/src/Routes/RunbookRoutes";
import { getRunbooksBreadcrumbs } from "../../../../App/FeatureSet/Dashboard/src/Utils/Breadcrumbs";
import PageMap from "../../../../App/FeatureSet/Dashboard/src/Utils/PageMap";
import RouteMap, {
  RouteUtil,
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
  activeLinkTitles,
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
  sectionToggle,
  setViewportWidth,
  titlesInMenu,
} from "./SideMenuHarness";

const RUNBOOK_ID: string = "2d4f6a8c-1b3e-4c5d-8e7f-9a0b1c2d3e4f";
const RUN_ID: string = "7e1c2a3b-4d5e-4f60-8a9b-0c1d2e3f4a5b";

const RUNBOOKS_PATH: string = `/dashboard/${PROJECT_ID}/runbooks`;
const RUNBOOK_PATH: string = `${RUNBOOKS_PATH}/${RUNBOOK_ID}`;
const EXECUTIONS_PATH: string = `${RUNBOOK_PATH}/executions`;
// One run's own page, under the runbook's Executions.
const RUN_PATH: string = `${EXECUTIONS_PATH}/${RUN_ID}`;
const TRIGGERS_PATH: string = `${RUNBOOK_PATH}/triggers`;
const SETTINGS_PATH: string = `${RUNBOOK_PATH}/settings`;

const SECTIONS_IN_ORDER: Array<string> = [
  "Basic",
  "Logs",
  "Owners",
  "Settings",
  "Developer",
  "Advanced",
];

// Every section but the first starts folded down to its title.
const FOLDED_SECTIONS: Array<string> = SECTIONS_IN_ORDER.slice(1);

const ACTIVE_LINK_CLASSES: Array<string> = [
  "bg-indigo-50",
  "text-indigo-700",
  "font-semibold",
];

const FOLDED_BODY_CLASSES: Array<string> = [
  "max-h-0",
  "opacity-0",
  "invisible",
];

interface MenuPage {
  title: string;
  section: string;
  path: string;
}

/*
 * The whole menu, in the order it is drawn. Spelled out rather than read off
 * the component: a list generated from the menu would agree with whatever
 * the menu said.
 */
const RUNBOOK_MENU: ReadonlyArray<MenuPage> = [
  { title: "Overview", section: "Basic", path: RUNBOOK_PATH },
  { title: "Steps", section: "Basic", path: `${RUNBOOK_PATH}/steps` },
  { title: "Executions", section: "Logs", path: EXECUTIONS_PATH },
  { title: "Owners", section: "Owners", path: `${RUNBOOK_PATH}/owners` },
  { title: "Triggers", section: "Settings", path: TRIGGERS_PATH },
  { title: "Settings", section: "Settings", path: SETTINGS_PATH },
  {
    title: "Terraform",
    section: "Developer",
    path: `${RUNBOOK_PATH}/developer/terraform`,
  },
  { title: "API", section: "Developer", path: `${RUNBOOK_PATH}/developer/api` },
  {
    title: "AI Assistants",
    section: "Developer",
    path: `${RUNBOOK_PATH}/developer/ai-assistants`,
  },
  {
    title: "Audit Logs",
    section: "Advanced",
    path: `${RUNBOOK_PATH}/audit-logs`,
  },
  {
    title: "Delete Runbook",
    section: "Advanced",
    path: `${RUNBOOK_PATH}/delete`,
  },
];

// A page of the runbook and the menu entry marked on it.
interface PageAndEntry {
  // The page's own title, as its breadcrumbs end.
  name: string;
  path: string;
  // The section that holds the page, and must be open on it.
  section: string;
  // The menu entry marked as the page you are on.
  marked: string;
}

/*
 * Every page under a runbook: the menu's own, and one run's page (an
 * Execution, which the menu does not list: it is one of the runs Executions
 * lists).
 */
const EVERY_PAGE: ReadonlyArray<PageAndEntry> = [
  ...RUNBOOK_MENU.map((page: MenuPage): PageAndEntry => {
    return {
      name: page.title,
      path: page.path,
      section: page.section,
      marked: page.title,
    };
  }),
  {
    name: "Execution",
    path: RUN_PATH,
    section: "Logs",
    marked: "Executions",
  },
];

function linksOf(section: string): Array<MenuLink> {
  return RUNBOOK_MENU.filter((page: MenuPage): boolean => {
    return page.section === section;
  }).map((page: MenuPage): MenuLink => {
    return { title: page.title, href: page.path };
  });
}

// The href the app builds for a runbook page, from its own route table.
function routeOf(pageMapKey: PageMap, subModelId?: string): string {
  return RouteUtil.populateRouteParams(RouteMap[pageMapKey] as Route, {
    modelId: new ObjectID(RUNBOOK_ID),
    subModelId: subModelId ? new ObjectID(subModelId) : undefined,
  }).toString();
}

async function renderRunbookMenuAt(path: string): Promise<void> {
  goTo(path);
  await renderMenu(<RunbookViewSideMenu modelId={new ObjectID(RUNBOOK_ID)} />);
}

function expectFolded(section: string): void {
  expect({ section, expanded: isExpanded(section) }).toEqual({
    section,
    expanded: false,
  });
  expect(sectionBody(section)).toHaveClass(...FOLDED_BODY_CLASSES);
}

function expectOpen(section: string): void {
  expect({ section, expanded: isExpanded(section) }).toEqual({
    section,
    expanded: true,
  });
  expect(sectionBody(section)).not.toHaveClass("max-h-0");
  expect(sectionBody(section)).not.toHaveClass("invisible");
}

function entry(section: string, title: string): HTMLElement {
  return within(sectionRoot(section)).getByRole("link", { name: title });
}

beforeEach(() => {
  setViewportWidth(DESKTOP_WIDTH);
});

afterEach(() => {
  cleanup();
});

describe("a runbook's side menu", () => {
  test("has Basic, Logs, Owners, Settings, Developer and Advanced, in that order", async () => {
    await renderRunbookMenuAt(RUNBOOK_PATH);

    expect(sectionTitlesInOrder()).toEqual(SECTIONS_IN_ORDER);
  });

  test("Basic holds only Overview and Steps", async () => {
    await renderRunbookMenuAt(RUNBOOK_PATH);

    expect(linksIn("Basic")).toEqual(linksOf("Basic"));
    expect(
      within(sectionRoot("Basic")).queryByRole("link", { name: "Executions" }),
    ).toBeNull();
    expect(
      within(sectionRoot("Basic")).queryByRole("link", { name: "Triggers" }),
    ).toBeNull();
  });

  test("Logs holds Executions alone, at the runbook's executions URL", async () => {
    await renderRunbookMenuAt(RUNBOOK_PATH);

    expect(linksIn("Logs")).toEqual([
      { title: "Executions", href: EXECUTIONS_PATH },
    ]);
    expect(EXECUTIONS_PATH).toBe(routeOf(PageMap.RUNBOOK_VIEW_EXECUTIONS));
  });

  test("Settings holds Triggers, then the runbook's Settings page", async () => {
    await renderRunbookMenuAt(RUNBOOK_PATH);

    expect(linksIn("Settings")).toEqual([
      { title: "Triggers", href: TRIGGERS_PATH },
      { title: "Settings", href: SETTINGS_PATH },
    ]);
    expect(TRIGGERS_PATH).toBe(routeOf(PageMap.RUNBOOK_VIEW_TRIGGERS));
    expect(SETTINGS_PATH).toBe(routeOf(PageMap.RUNBOOK_VIEW_SETTINGS));
  });

  test("Advanced keeps Audit Logs and Delete Runbook: the Settings page moved out", async () => {
    await renderRunbookMenuAt(RUNBOOK_PATH);

    expect(linksIn("Advanced")).toEqual(linksOf("Advanced"));
    expect(
      within(sectionRoot("Advanced")).queryByRole("link", { name: "Settings" }),
    ).toBeNull();
  });

  test("Delete Runbook stays last, with its danger hover", async () => {
    await renderRunbookMenuAt(RUNBOOK_PATH);

    const titles: Array<string> = titlesInMenu();

    expect(titles[titles.length - 1]).toBe("Delete Runbook");
    expect(entry("Advanced", "Delete Runbook")).toHaveClass("danger-on-hover");
  });

  test("Owners and Developer are where they were", async () => {
    await renderRunbookMenuAt(RUNBOOK_PATH);

    expect(linksIn("Owners")).toEqual(linksOf("Owners"));
    expect(linksIn("Developer")).toEqual(linksOf("Developer"));
  });

  test("lists all eleven pages once, in order", async () => {
    await renderRunbookMenuAt(RUNBOOK_PATH);

    const hrefs: Array<string> = hrefsInMenu();

    expect(hrefs).toHaveLength(11);
    expect(new Set(hrefs).size).toBe(11);
    expect(hrefs).toEqual(
      RUNBOOK_MENU.map((page: MenuPage): string => {
        return page.path;
      }),
    );
    expect(titlesInMenu()).toEqual(
      RUNBOOK_MENU.map((page: MenuPage): string => {
        return page.title;
      }),
    );
  });

  test("every entry keeps its icon", async () => {
    await renderRunbookMenuAt(RUNBOOK_PATH);

    for (const section of sectionTitlesInOrder()) {
      expect({ section, icons: iconCountIn(section) }).toEqual({
        section,
        icons: linksIn(section).length,
      });
    }
  });
});

describe("what a runbook's menu shows before anything is opened", () => {
  test("on the Overview only Basic is open: every other section is folded down to its title", async () => {
    await renderRunbookMenuAt(RUNBOOK_PATH);

    expectOpen("Basic");

    for (const section of FOLDED_SECTIONS) {
      expectFolded(section);
    }

    // The only entries on show are the two Basic ones, Overview marked.
    expect(activeLinkTitles()).toEqual(["Overview"]);
  });

  test.each(
    EVERY_PAGE.filter((page: PageAndEntry): boolean => {
      return page.section !== "Logs";
    }),
  )(
    "Executions stays folded away under Logs on the $name page",
    async (page: PageAndEntry) => {
      await renderRunbookMenuAt(page.path);

      expectFolded("Logs");
    },
  );

  test.each(
    EVERY_PAGE.filter((page: PageAndEntry): boolean => {
      return page.section !== "Settings";
    }),
  )(
    "Triggers stays folded away under Settings on the $name page",
    async (page: PageAndEntry) => {
      await renderRunbookMenuAt(page.path);

      expectFolded("Settings");
    },
  );

  test.each(EVERY_PAGE)(
    "Basic, with Overview and Steps, is open on the $name page",
    async (page: PageAndEntry) => {
      await renderRunbookMenuAt(page.path);

      expectOpen("Basic");
      expect(linksIn("Basic")).toEqual(linksOf("Basic"));
    },
  );
});

describe("a folded section opens by itself on its own pages, with the page marked", () => {
  test.each(EVERY_PAGE)(
    "the $name page: its section is open and its entry is the one marked",
    async (page: PageAndEntry) => {
      await renderRunbookMenuAt(page.path);

      expectOpen(page.section);
      expect(activeLinkTitles()).toEqual([page.marked]);
      expect(entry(page.section, page.marked)).toHaveClass(
        ...ACTIVE_LINK_CLASSES,
      );

      // No other folded section opens with it.
      for (const section of FOLDED_SECTIONS) {
        if (section !== page.section) {
          expectFolded(section);
        }
      }
    },
  );

  test("on one run's page, Executions is marked and still leads to the list of runs", async () => {
    await renderRunbookMenuAt(RUN_PATH);

    expect(RUN_PATH).toBe(routeOf(PageMap.RUNBOOK_VIEW_EXECUTION, RUN_ID));

    const executions: HTMLElement = entry("Logs", "Executions");

    expect(executions).toHaveClass(...ACTIVE_LINK_CLASSES);
    expect(executions).toHaveAttribute("href", EXECUTIONS_PATH);
    // The Overview, whose path every runbook page starts with, is not marked.
    expect(entry("Basic", "Overview")).not.toHaveClass("bg-indigo-50");
  });

  test("on the Executions list itself, Executions is marked as before", async () => {
    await renderRunbookMenuAt(EXECUTIONS_PATH);

    expect(entry("Logs", "Executions")).toHaveClass(...ACTIVE_LINK_CLASSES);
    expect(activeLinkTitles()).toEqual(["Executions"]);
  });

  test("on the Settings page, the Settings section is open with the Settings page marked, and Advanced stays folded", async () => {
    await renderRunbookMenuAt(SETTINGS_PATH);

    expectOpen("Settings");
    expect(entry("Settings", "Settings")).toHaveClass(...ACTIVE_LINK_CLASSES);
    expect(entry("Settings", "Triggers")).not.toHaveClass("bg-indigo-50");
    expectFolded("Advanced");
  });
});

describe("opening a folded section", () => {
  test("a click on Logs shows Executions, and another folds it away again", async () => {
    await renderRunbookMenuAt(RUNBOOK_PATH);

    expectFolded("Logs");

    await act(async () => {
      fireEvent.click(sectionToggle("Logs"));
    });

    expectOpen("Logs");
    expect(entry("Logs", "Executions")).toHaveAttribute(
      "href",
      EXECUTIONS_PATH,
    );

    await act(async () => {
      fireEvent.click(sectionToggle("Logs"));
    });

    expectFolded("Logs");
  });

  test("a click on Settings shows Triggers and Settings, and leaves the others folded", async () => {
    await renderRunbookMenuAt(RUNBOOK_PATH);

    await act(async () => {
      fireEvent.click(sectionToggle("Settings"));
    });

    expectOpen("Settings");
    expect(linksIn("Settings")).toEqual(linksOf("Settings"));

    for (const section of ["Logs", "Owners", "Developer", "Advanced"]) {
      expectFolded(section);
    }
  });

  test("each folded section's toggle names the rows it shows", async () => {
    await renderRunbookMenuAt(RUNBOOK_PATH);

    for (const section of FOLDED_SECTIONS) {
      const toggle: HTMLElement = sectionToggle(section);

      expect(toggle.tagName).toBe("BUTTON");
      expect(toggle).toHaveAttribute("aria-controls", sectionBody(section).id);
    }
  });
});

describe("on a phone", () => {
  beforeEach(() => {
    setViewportWidth(MOBILE_WIDTH);
  });

  test("the menu button names Logs / Executions on the Executions page", async () => {
    await renderRunbookMenuAt(EXECUTIONS_PATH);

    expect(mobileSummaryText()).toContain("Logs / Executions");
  });

  test("the menu button names Logs / Executions on one run's page too", async () => {
    await renderRunbookMenuAt(RUN_PATH);

    expect(mobileSummaryText()).toContain("Logs / Executions");
  });

  test("the menu button names Settings / Triggers on the Triggers page", async () => {
    await renderRunbookMenuAt(TRIGGERS_PATH);

    expect(mobileSummaryText()).toContain("Settings / Triggers");
  });

  test("the menu button names Settings, once, on the Settings page", async () => {
    await renderRunbookMenuAt(SETTINGS_PATH);

    expect(mobileSummaryText()).toContain("Settings");
    expect(mobileSummaryText()).not.toContain("Settings / Settings");
  });

  test("the menu button names Basic / Overview on the Overview", async () => {
    await renderRunbookMenuAt(RUNBOOK_PATH);

    expect(mobileSummaryText()).toContain("Basic / Overview");
  });
});

// The page pattern the app resolves for a URL, as the view layout asks for it.
function resolve(path: string): string {
  goTo(path);
  return Navigation.getRoutePath(RouteUtil.getRoutes());
}

function trailTitles(path: string): Array<string> {
  const links: Array<Link> | undefined = getRunbooksBreadcrumbs(resolve(path));

  return (links || []).map((link: Link): string => {
    return link.title;
  });
}

describe("the trail above each page of a runbook", () => {
  test.each(
    RUNBOOK_MENU.filter((page: MenuPage): boolean => {
      return page.title !== "Overview";
    }),
  )(
    "the $title page reads Project > Runbooks > View Runbook > $title",
    (page: MenuPage) => {
      expect(trailTitles(page.path)).toEqual([
        "Project",
        "Runbooks",
        "View Runbook",
        page.title,
      ]);
    },
  );

  test("the Overview reads Project > Runbooks > View Runbook", () => {
    expect(trailTitles(RUNBOOK_PATH)).toEqual([
      "Project",
      "Runbooks",
      "View Runbook",
    ]);
  });

  test("one run reads Project > Runbooks > View Runbook > Executions > Execution", () => {
    expect(trailTitles(RUN_PATH)).toEqual([
      "Project",
      "Runbooks",
      "View Runbook",
      "Executions",
      "Execution",
    ]);
  });

  test("no trail names a menu section: pages are named by their own titles", () => {
    for (const page of EVERY_PAGE) {
      const titles: Array<string> = trailTitles(page.path);

      expect({ page: page.name, titles: titles.slice(0, 3) }).toEqual({
        page: page.name,
        titles: ["Project", "Runbooks", "View Runbook"],
      });
      for (const sectionOnly of ["Basic", "Logs", "Advanced"]) {
        expect({
          page: page.name,
          names: titles.includes(sectionOnly),
        }).toEqual({ page: page.name, names: false });
      }
    }
  });
});

describe("the pages kept their addresses", () => {
  test.each([
    [
      PageMap.RUNBOOK_VIEW_EXECUTIONS,
      "/dashboard/:projectId/runbooks/:id/executions",
    ],
    [
      PageMap.RUNBOOK_VIEW_EXECUTION,
      "/dashboard/:projectId/runbooks/:id/executions/:subModelId",
    ],
    [
      PageMap.RUNBOOK_VIEW_TRIGGERS,
      "/dashboard/:projectId/runbooks/:id/triggers",
    ],
    [
      PageMap.RUNBOOK_VIEW_SETTINGS,
      "/dashboard/:projectId/runbooks/:id/settings",
    ],
  ])("%s is still %s", (key: PageMap, pattern: string) => {
    expect(RouteMap[key]!.toString()).toBe(pattern);
  });
});

/*
 * The real Runbooks route group, as the Dashboard mounts it: the view
 * layout's header, breadcrumbs and side menu are the production ones, and the
 * Shell hands React Router's navigation to Navigation the way App.tsx does,
 * so a click on a menu entry navigates as it does in the product. The
 * layout stays mounted from page to page, and so does its menu.
 */
function Shell(): React.ReactElement {
  Navigation.setNavigateHook(useNavigate());
  Navigation.setLocation(useLocation());
  Navigation.setParams(useParams());

  return (
    <RunbookRoutes
      pageRoute={RouteMap[PageMap.RUNBOOKS_ROOT] as Route}
      currentProject={null}
      hasPaymentMethod={true}
    />
  );
}

async function openRunbookAt(path: string): Promise<void> {
  goTo(path);

  await act(async () => {
    render(
      <BrowserRouter>
        <Routes>
          <RouterRoute
            path={RouteMap[PageMap.RUNBOOKS_ROOT]!.toString()}
            element={<Shell />}
          />
        </Routes>
      </BrowserRouter>,
    );
  });

  await waitFor(() => {
    expect(document.body.textContent).toContain("Restart the web tier");
  });
}

async function click(element: HTMLElement): Promise<void> {
  await act(async () => {
    fireEvent.click(element);
  });
}

function shownPage(): string {
  return screen.getByTestId("page").getAttribute("data-page") || "";
}

function crumbTexts(): Array<string> {
  return within(screen.getByRole("navigation", { name: "Breadcrumb" }))
    .getAllByRole("listitem")
    .map((item: HTMLElement): string => {
      return item.textContent?.trim() || "";
    });
}

describe("moving around a runbook, with the real layout and routes", () => {
  test("from the Overview: open Logs, then Executions; Logs stays open on the way back", async () => {
    await openRunbookAt(RUNBOOK_PATH);

    expect(shownPage()).toBe("RunbookOverview");
    expectFolded("Logs");
    expectFolded("Settings");

    await click(sectionToggle("Logs"));
    expectOpen("Logs");

    await click(entry("Logs", "Executions"));

    await waitFor(() => {
      expect(shownPage()).toBe("RunbookExecutions");
    });
    expect(window.location.pathname).toBe(EXECUTIONS_PATH);
    expect(entry("Logs", "Executions")).toHaveClass(...ACTIVE_LINK_CLASSES);
    expect(crumbTexts()).toEqual([
      "Project",
      "Runbooks",
      "View Runbook",
      "Executions",
    ]);

    // Back to the Overview: the menu stays as it was left, Logs open.
    await click(entry("Basic", "Overview"));

    await waitFor(() => {
      expect(shownPage()).toBe("RunbookOverview");
    });
    expectOpen("Logs");
    expect(activeLinkTitles()).toEqual(["Overview"]);
    expectFolded("Settings");
  });

  test("from the Overview: open Settings, then Triggers; Settings stays open while the Settings page opens", async () => {
    await openRunbookAt(RUNBOOK_PATH);

    await click(sectionToggle("Settings"));
    await click(entry("Settings", "Triggers"));

    await waitFor(() => {
      expect(shownPage()).toBe("RunbookTriggers");
    });
    expect(window.location.pathname).toBe(TRIGGERS_PATH);
    expect(activeLinkTitles()).toEqual(["Triggers"]);
    expect(crumbTexts()).toEqual([
      "Project",
      "Runbooks",
      "View Runbook",
      "Triggers",
    ]);
    expectFolded("Logs");

    await click(entry("Settings", "Settings"));

    await waitFor(() => {
      expect(shownPage()).toBe("RunbookSettings");
    });
    expectOpen("Settings");
    expect(activeLinkTitles()).toEqual(["Settings"]);
    expect(crumbTexts()).toEqual([
      "Project",
      "Runbooks",
      "View Runbook",
      "Settings",
    ]);
  });

  test("a run opened from the page, as Run Now and Last Run do, unfolds Logs with Executions marked", async () => {
    await openRunbookAt(RUNBOOK_PATH);

    expectFolded("Logs");

    await act(async () => {
      Navigation.navigate(new Route(RUN_PATH));
    });

    await waitFor(() => {
      expect(shownPage()).toBe("RunbookExecution");
    });
    expectOpen("Logs");
    expect(activeLinkTitles()).toEqual(["Executions"]);
    expect(crumbTexts()).toEqual([
      "Project",
      "Runbooks",
      "View Runbook",
      "Executions",
      "Execution",
    ]);
  });

  test("a bookmarked Triggers page opens with Settings unfolded and Triggers marked", async () => {
    await openRunbookAt(TRIGGERS_PATH);

    expect(shownPage()).toBe("RunbookTriggers");
    expectOpen("Settings");
    expectFolded("Logs");
    expect(activeLinkTitles()).toEqual(["Triggers"]);
  });

  test("the Owners and Audit Logs pages have their trail too", async () => {
    await openRunbookAt(`${RUNBOOK_PATH}/owners`);

    expect(shownPage()).toBe("RunbookOwners");
    expect(crumbTexts()).toEqual([
      "Project",
      "Runbooks",
      "View Runbook",
      "Owners",
    ]);

    cleanup();

    await openRunbookAt(`${RUNBOOK_PATH}/audit-logs`);

    expect(shownPage()).toBe("RunbookAuditLogs");
    expect(crumbTexts()).toEqual([
      "Project",
      "Runbooks",
      "View Runbook",
      "Audit Logs",
    ]);
  });
});
