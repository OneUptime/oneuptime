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
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import type { SpyInstance } from "jest-mock";
import * as React from "react";
import { MemoryRouter, matchRoutes } from "react-router-dom";

/*
 * Whether this install has billing on, pinned by the suite rather than read
 * from the environment: the Settings menu grows a Billing section and an AI
 * Credits entry with it, and CI and a bare `npx jest` disagree about the
 * default. Both are exercised below.
 */
let billingEnabledForTest: boolean = false;

jest.mock("../../../UI/Config", () => {
  const actual: Record<string, unknown> = jest.requireActual(
    "../../../UI/Config",
  ) as Record<string, unknown>;

  const mocked: Record<string, unknown> = { ...actual };

  Object.defineProperty(mocked, "BILLING_ENABLED", {
    get: (): boolean => {
      return billingEnabledForTest;
    },
  });

  return mocked;
});

jest.mock("../../../UI/Utils/Analytics", () => {
  return { __esModule: true, default: { capture: jest.fn() } };
});

import AICodeFixReadiness from "../../../../App/FeatureSet/Dashboard/src/Components/AIAgentTask/AICodeFixReadiness";
import RunnerElement from "../../../../App/FeatureSet/Dashboard/src/Components/Runner/Runner";
import RunnersElement from "../../../../App/FeatureSet/Dashboard/src/Components/Runner/Runners";
import RunbookSideMenu from "../../../../App/FeatureSet/Dashboard/src/Pages/Runbook/SideMenu";
import SettingsSideMenu from "../../../../App/FeatureSet/Dashboard/src/Pages/Settings/SideMenu";
import PageMap from "../../../../App/FeatureSet/Dashboard/src/Utils/PageMap";
import RouteMap, {
  RouteUtil,
  RunbookRoutePath,
} from "../../../../App/FeatureSet/Dashboard/src/Utils/RouteMap";
import {
  getRunbooksBreadcrumbs as getRunbooksBreadcrumbsFromBarrel,
  getSettingsBreadcrumbs as getSettingsBreadcrumbsFromBarrel,
} from "../../../../App/FeatureSet/Dashboard/src/Utils/Breadcrumbs";
import { getRunbooksBreadcrumbs } from "../../../../App/FeatureSet/Dashboard/src/Utils/Breadcrumbs/RunbooksBreadcrumbs";
import { getSettingsBreadcrumbs } from "../../../../App/FeatureSet/Dashboard/src/Utils/Breadcrumbs/SettingsBreadcrumbs";
import { getReadinessCheckLink } from "../../../../App/FeatureSet/Dashboard/src/Utils/ExceptionAIAssistance";
import Runner from "../../../Models/DatabaseModels/Runner";
import HTTPResponse from "../../../Types/API/HTTPResponse";
import Route from "../../../Types/API/Route";
import { JSONObject } from "../../../Types/JSON";
import Link from "../../../Types/Link";
import Page from "../../../UI/Components/Page/Page";
import API from "../../../UI/Utils/API/API";
import Navigation from "../../../UI/Utils/Navigation";
import {
  DESKTOP_WIDTH,
  MOBILE_WIDTH,
  MenuLink,
  PROJECT_ID,
  allLinks,
  goTo,
  hrefsInMenu,
  iconCountIn,
  isExpanded,
  linksIn,
  mobileSummaryText,
  renderMenu,
  routeFor,
  sectionBody,
  sectionTitlesInOrder,
  sectionToggle,
  setViewportWidth,
} from "./SideMenuHarness";

/*
 * Runners are set up in Runbooks, not in Project Settings. Three things say
 * where a page lives — the side menu that lists it, the breadcrumb trail
 * above it, and every link elsewhere in the dashboard that sends people to
 * it — and nothing forces them to agree. This renders all three for real,
 * against the app's own route table.
 */

const NAMES_A_RUNNER: RegExp = /runner/i;

const RUNNER_ID: string = "5d9e2c11-7a3b-4c1d-9e8f-00000000a0b1";
const RUNBOOKS: string = `/dashboard/${PROJECT_ID}/runbooks`;
const RUNNERS_PATH: string = `${RUNBOOKS}/runners`;
const RUNNER_VIEW_PATH: string = `${RUNBOOKS}/runners/${RUNNER_ID}`;
const CREDENTIALS_PATH: string = `${RUNBOOKS}/runner-credentials`;

const realRoutes: Array<{ path: string }> = Object.values(RouteMap)
  .map((route: Route): { path: string } => {
    return { path: route.toString() };
  })
  .filter((route: { path: string }): boolean => {
    return !route.path.includes("*");
  });

function visit(page: string): string {
  const pagePath: string = RouteUtil.getRouteString(page)
    .replace(":projectId", PROJECT_ID)
    .replace(":id", RUNNER_ID);
  goTo(pagePath);
  return pagePath;
}

beforeEach(() => {
  billingEnabledForTest = false;
  setViewportWidth(DESKTOP_WIDTH);
  goTo(RUNBOOKS);
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

describe("the Runbooks side menu lists the Runner pages", () => {
  test("Runners is its own section, between the runbooks and their Settings", async () => {
    await renderMenu(<RunbookSideMenu />);

    expect(sectionTitlesInOrder()).toEqual([
      "Runbooks",
      "Runners",
      "Settings",
      "Developer",
    ]);
  });

  test("the section holds Runners and Credentials, at their Runbooks URLs", async () => {
    await renderMenu(<RunbookSideMenu />);

    expect(linksIn("Runners")).toEqual([
      { title: "Runners", href: RUNNERS_PATH },
      { title: "Credentials", href: CREDENTIALS_PATH },
    ]);
  });

  test("its links come from the route table, not from spelled-out paths", async () => {
    await renderMenu(<RunbookSideMenu />);

    expect(linksIn("Runners")).toEqual([
      { title: "Runners", href: routeFor(PageMap.RUNBOOKS_RUNNERS) },
      {
        title: "Credentials",
        href: routeFor(PageMap.RUNBOOKS_RUNNER_CREDENTIALS),
      },
    ]);
  });

  test("both entries carry an icon", async () => {
    await renderMenu(<RunbookSideMenu />);

    expect(iconCountIn("Runners")).toBe(2);
  });

  test("the rest of the menu is where it was", async () => {
    await renderMenu(<RunbookSideMenu />);

    expect(linksIn("Runbooks")).toEqual([
      { title: "Runbooks", href: RUNBOOKS },
      { title: "Executions", href: `${RUNBOOKS}/executions` },
    ]);
    expect(linksIn("Settings")).toEqual([
      { title: "Secrets", href: `${RUNBOOKS}/settings/secrets` },
      { title: "Owner Rules", href: `${RUNBOOKS}/settings/owner-rules` },
      { title: "Label Rules", href: `${RUNBOOKS}/settings/label-rules` },
    ]);
  });

  test("Runners is folded down to its title on the Runbooks landing page, like Settings", async () => {
    /*
     * "Collapsing things in the side menu that are not used frequently"
     * (the maintainer, for every side menu): a Runner is installed once and
     * checked now and then, so its section shows only its title, between the
     * runbooks and Settings, until it is opened.
     */
    await renderMenu(<RunbookSideMenu />);

    expect(isExpanded("Runbooks")).toBe(true);
    expect(isExpanded("Runners")).toBe(false);
    expect(sectionBody("Runners")).toHaveClass(
      "max-h-0",
      "opacity-0",
      "invisible",
    );
    expect(isExpanded("Settings")).toBe(false);
  });

  test("a click opens Runners to show both entries", async () => {
    await renderMenu(<RunbookSideMenu />);

    fireEvent.click(sectionToggle("Runners"));

    expect(isExpanded("Runners")).toBe(true);
    expect(sectionBody("Runners")).not.toHaveClass("invisible");
    expect(linksIn("Runners")).toHaveLength(2);
  });

  test.each([
    ["the Runners list", RUNNERS_PATH],
    ["a Runner's page", RUNNER_VIEW_PATH],
    ["Runner Credentials", CREDENTIALS_PATH],
  ])(
    "Runners opens by itself on %s",
    async (_name: string, pagePath: string) => {
      goTo(pagePath);
      await renderMenu(<RunbookSideMenu />);

      expect(isExpanded("Runners")).toBe(true);
      expect(sectionBody("Runners")).not.toHaveClass("invisible");
    },
  );

  test.each([
    ["Runners", RUNNERS_PATH],
    ["Credentials", CREDENTIALS_PATH],
  ])(
    "%s is the highlighted entry on its own page, and the only one",
    async (title: string, pagePath: string) => {
      goTo(pagePath);
      await renderMenu(<RunbookSideMenu />);

      const highlighted: Array<string> = Array.from(
        document.querySelectorAll("nav a"),
      )
        .filter((anchor: Element): boolean => {
          return anchor.className.includes("bg-indigo-50");
        })
        .map((anchor: Element): string => {
          return (
            anchor.querySelector("span.truncate")?.textContent ?? ""
          ).trim();
        });

      expect(highlighted).toEqual([title]);
    },
  );

  test("every entry in the menu opens a page the router has", async () => {
    await renderMenu(<RunbookSideMenu />);

    const hrefs: Array<string> = hrefsInMenu();

    // Seven Runbooks pages, then the Developer section's three.
    expect(hrefs).toHaveLength(10);
    for (const href of hrefs) {
      expect(href).not.toMatch(/[:*]/);
      expect(matchRoutes(realRoutes, href)).not.toBeNull();
    }
  });

  test("on a phone the menu names the section and the page", async () => {
    setViewportWidth(MOBILE_WIDTH);
    goTo(CREDENTIALS_PATH);
    await renderMenu(<RunbookSideMenu />);

    expect(mobileSummaryText()).toContain("Runners");
    expect(mobileSummaryText()).toContain("Credentials");
  });
});

describe("the Project Settings side menu no longer lists them", () => {
  test.each([
    ["without billing", false],
    ["with billing", true],
  ])(
    "there is no Runners section and no Runner entry %s",
    async (_name: string, billingEnabled: boolean) => {
      billingEnabledForTest = billingEnabled;
      goTo(`/dashboard/${PROJECT_ID}/settings`);
      await renderMenu(<SettingsSideMenu />);

      expect(sectionTitlesInOrder()).not.toContain("Runners");
      expect(
        allLinks().filter((link: MenuLink): boolean => {
          return (
            NAMES_A_RUNNER.test(link.title) || NAMES_A_RUNNER.test(link.href)
          );
        }),
      ).toEqual([]);
    },
  );

  test("AI is followed directly by Advanced, where Runners used to sit between", async () => {
    goTo(`/dashboard/${PROJECT_ID}/settings`);
    await renderMenu(<SettingsSideMenu />);

    const sections: Array<string> = sectionTitlesInOrder();

    expect(sections.indexOf("AI")).toBeGreaterThan(-1);
    expect(sections[sections.indexOf("AI") + 1]).toBe("Advanced");
  });

  test("Credentials is not left behind under another Settings section", async () => {
    goTo(`/dashboard/${PROJECT_ID}/settings`);
    await renderMenu(<SettingsSideMenu />);

    expect(
      allLinks().map((link: MenuLink): string => {
        return link.title;
      }),
    ).not.toContain("Credentials");
  });

  test("every Settings entry still stays inside Settings", async () => {
    billingEnabledForTest = true;
    goTo(`/dashboard/${PROJECT_ID}/settings`);
    await renderMenu(<SettingsSideMenu />);

    const hrefs: Array<string> = hrefsInMenu();

    expect(hrefs.length).toBeGreaterThan(15);
    for (const href of hrefs) {
      expect(href.startsWith(`/dashboard/${PROJECT_ID}/settings`)).toBe(true);
    }
  });
});

describe("the Runner pages' breadcrumbs lead back through Runbooks", () => {
  const EXPECTED_TITLES: Record<string, Array<string>> = {
    [PageMap.RUNBOOKS_RUNNERS]: ["Project", "Runbooks", "Runners"],
    [PageMap.RUNBOOKS_RUNNER_VIEW]: [
      "Project",
      "Runbooks",
      "Runners",
      "View Runner",
    ],
    [PageMap.RUNBOOKS_RUNNER_CREDENTIALS]: [
      "Project",
      "Runbooks",
      "Runner Credentials",
    ],
  };

  const RUNNER_PAGES: Array<string> = Object.keys(RunbookRoutePath).filter(
    (page: string): boolean => {
      return page.includes("RUNNER");
    },
  );

  test("the router's Runner pages are the ones with a pinned trail", () => {
    expect([...RUNNER_PAGES].sort()).toEqual(
      Object.keys(EXPECTED_TITLES).sort(),
    );
  });

  test.each(Object.keys(EXPECTED_TITLES))(
    "%s has a complete, navigable trail through the Page header",
    (page: string) => {
      const currentPath: string = visit(page);
      const matchedPath: string = Navigation.getRoutePath(
        RouteUtil.getRoutes(),
      );
      // The page matches its own route, not the runbook view's `:id`.
      expect(matchedPath).toBe(RouteUtil.getRouteString(page));

      const links: Array<Link> | undefined =
        getRunbooksBreadcrumbs(matchedPath);
      expect(links).toBeDefined();
      expect(
        links!.map((link: Link): string => {
          return link.title;
        }),
      ).toEqual(EXPECTED_TITLES[page]);
      expect(links![0]?.to.toString()).toBe(`/dashboard/${PROJECT_ID}`);
      expect(links![1]?.to.toString()).toBe(RUNBOOKS);
      expect(links![links!.length - 1]?.to.toString()).toBe(currentPath);

      links!.forEach((link: Link) => {
        expect(link.to.toString()).not.toMatch(/[:*]/);
        expect(link.to.toString()).not.toContain("/settings");
        expect(matchRoutes(realRoutes, link.to.toString())).not.toBeNull();
      });

      render(
        <Page title="Runbooks" breadcrumbLinks={links}>
          <div>Page content</div>
        </Page>,
      );
      const trail: HTMLElement = screen.getByRole("navigation", {
        name: "Breadcrumb",
      });
      expect(within(trail).getAllByRole("listitem")).toHaveLength(
        links!.length,
      );
      within(trail)
        .getAllByRole("link")
        .forEach((anchor: HTMLElement) => {
          expect(anchor.getAttribute("href")).not.toBe(currentPath);
        });
    },
  );

  test("a Runner's page links back to the Runners list", () => {
    visit(PageMap.RUNBOOKS_RUNNER_VIEW);

    const links: Array<Link> = getRunbooksBreadcrumbs(
      RouteUtil.getRouteString(PageMap.RUNBOOKS_RUNNER_VIEW),
    )!;

    expect(links[2]?.title).toBe("Runners");
    expect(links[2]?.to.toString()).toBe(RUNNERS_PATH);
  });

  test("the Runbooks pages that were already there kept their trails", () => {
    visit(PageMap.RUNBOOKS_SECRETS);

    expect(
      getRunbooksBreadcrumbs(
        RouteUtil.getRouteString(PageMap.RUNBOOKS_SECRETS),
      )!.map((link: Link): string => {
        return link.title;
      }),
    ).toEqual(["Project", "Runbooks", "Secrets"]);
    expect(
      getRunbooksBreadcrumbs(
        RouteUtil.getRouteString(PageMap.RUNBOOK_VIEW_STEPS),
      )!.map((link: Link): string => {
        return link.title;
      }),
    ).toEqual(["Project", "Runbooks", "View Runbook", "Steps"]);
  });

  test("Settings has no trail for a Runner page, new URL or old", () => {
    for (const pattern of [
      RouteUtil.getRouteString(PageMap.RUNBOOKS_RUNNERS),
      RouteUtil.getRouteString(PageMap.RUNBOOKS_RUNNER_VIEW),
      RouteUtil.getRouteString(PageMap.RUNBOOKS_RUNNER_CREDENTIALS),
      "/dashboard/:projectId/settings/runners",
      "/dashboard/:projectId/settings/runners/:id",
      "/dashboard/:projectId/settings/runner-credentials",
    ]) {
      expect(getSettingsBreadcrumbs(pattern)).toBeUndefined();
    }
  });

  test("the barrel exports the trails the layouts read", () => {
    expect(getRunbooksBreadcrumbsFromBarrel).toBe(getRunbooksBreadcrumbs);
    expect(getSettingsBreadcrumbsFromBarrel).toBe(getSettingsBreadcrumbs);
  });
});

describe("links elsewhere in the dashboard arrive at the Runbooks pages", () => {
  function runner(name: string, id?: string): Runner {
    const model: Runner = new Runner();
    model.name = name;
    if (id) {
      model._id = id;
    }
    return model;
  }

  test("a Runner's name links to its page under Runbooks", () => {
    render(
      <MemoryRouter>
        <RunnerElement runner={runner("prod-bastion", RUNNER_ID)} />
      </MemoryRouter>,
    );

    expect(screen.getByRole("link", { name: /prod-bastion/ })).toHaveAttribute(
      "href",
      RUNNER_VIEW_PATH,
    );
  });

  test("a Runner without an id is plain text, not a link to nowhere", () => {
    render(
      <MemoryRouter>
        <RunnerElement runner={runner("unsaved")} />
      </MemoryRouter>,
    );

    expect(screen.getByText("unsaved")).toBeInTheDocument();
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });

  test("a list of Runners links each one to its own page", () => {
    const otherId: string = "0a1b2c3d-4e5f-4a6b-8c7d-00000000e0f3";

    render(
      <MemoryRouter>
        <RunnersElement
          runners={[runner("alpha", RUNNER_ID), runner("beta", otherId)]}
        />
      </MemoryRouter>,
    );

    expect(screen.getByRole("link", { name: /alpha/ })).toHaveAttribute(
      "href",
      RUNNER_VIEW_PATH,
    );
    expect(screen.getByRole("link", { name: /beta/ })).toHaveAttribute(
      "href",
      `${RUNBOOKS}/runners/${otherId}`,
    );
  });

  test("the exception page's missing-Runner link opens Runbooks → Runners", () => {
    const link: ReturnType<typeof getReadinessCheckLink> =
      getReadinessCheckLink("agentAvailable");

    expect(link?.pageMap).toBe(PageMap.RUNBOOKS_RUNNERS);
    expect(routeFor(link!.pageMap)).toBe(RUNNERS_PATH);
  });

  describe("the AI code-fix readiness card", () => {
    function readinessResponse(agentOk: boolean): HTTPResponse<JSONObject> {
      return new HTTPResponse<JSONObject>(
        200,
        {
          ready: agentOk,
          checks: [
            {
              id: "repositoryConnected",
              ok: true,
              title: "A code repository is connected",
              detail: "",
            },
            {
              id: "llmProvider",
              ok: true,
              title: "An LLM provider is available",
              detail: "",
            },
            {
              id: "agentAvailable",
              ok: agentOk,
              title: "A Runner that runs AI code fixes is online",
              detail: agentOk ? "" : "No agent is available for this project.",
            },
          ],
        },
        {},
      );
    }

    test("its missing-Runner tile sends people to Runbooks → Runners", async () => {
      jest.spyOn(API, "post").mockResolvedValue(readinessResponse(false));
      const navigate: SpyInstance<typeof Navigation.navigate> = jest
        .spyOn(Navigation, "navigate")
        .mockImplementation((): void => {});

      render(<AICodeFixReadiness />);

      const tile: HTMLElement = await waitFor((): HTMLElement => {
        return screen.getByTestId("ai-readiness-check-agentAvailable");
      });
      expect(tile).toHaveAttribute("role", "button");

      fireEvent.click(tile);

      expect(navigate).toHaveBeenCalledTimes(1);
      expect((navigate.mock.calls[0]![0] as Route).toString()).toBe(
        RUNNERS_PATH,
      );
    });

    test("the same tile works from the keyboard", async () => {
      jest.spyOn(API, "post").mockResolvedValue(readinessResponse(false));
      const navigate: SpyInstance<typeof Navigation.navigate> = jest
        .spyOn(Navigation, "navigate")
        .mockImplementation((): void => {});

      render(<AICodeFixReadiness />);

      const tile: HTMLElement = await waitFor((): HTMLElement => {
        return screen.getByTestId("ai-readiness-check-agentAvailable");
      });

      fireEvent.keyDown(tile, { key: "Enter" });

      expect((navigate.mock.calls[0]![0] as Route).toString()).toBe(
        RUNNERS_PATH,
      );
    });
  });
});
