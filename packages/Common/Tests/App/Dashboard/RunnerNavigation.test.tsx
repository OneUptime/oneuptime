import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import "@testing-library/jest-dom";
import { cleanup, render, screen, within } from "@testing-library/react";
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

import CodeBlockerNotice from "../../../../App/FeatureSet/Dashboard/src/Components/Code/CodeBlockerNotice";
import { CodeTaskBlockerType } from "../../../Types/AI/CodeTask";
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
import Route from "../../../Types/API/Route";
import Link from "../../../Types/Link";
import ObjectID from "../../../Types/ObjectID";
import Permission from "../../../Types/Permission";
import Page from "../../../UI/Components/Page/Page";
import Navigation from "../../../UI/Utils/Navigation";
import PermissionUtil from "../../../UI/Utils/Permission";
import User from "../../../UI/Utils/User";
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
// Runbooks > Runners > AI Access, gone with runbook credentials.
const OLD_CREDENTIALS_PATH: string = `${RUNBOOKS}/runner-credentials`;

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
  /*
   * Runners had a section of their own while AI Access stood beside them
   * (the runbook credentials OneUptime AI's commands reached a host or a
   * cluster with). AI Access went with runbook credentials, and a section
   * holding one row named like itself is a fold to open for nothing: the
   * row joined the Runbooks section.
   */
  test("Runners is a row of the Runbooks section: no section of its own any more", async () => {
    await renderMenu(<RunbookSideMenu />);

    expect(sectionTitlesInOrder()).toEqual([
      "Runbooks",
      "Settings",
      "Developer",
    ]);
  });

  test("the Runbooks section holds Runners after the runbooks and their runs, at its Runbooks URL", async () => {
    await renderMenu(<RunbookSideMenu />);

    expect(linksIn("Runbooks")).toEqual([
      { title: "Runbooks", href: RUNBOOKS },
      { title: "Executions", href: `${RUNBOOKS}/executions` },
      { title: "Runners", href: RUNNERS_PATH },
    ]);
  });

  test("its link comes from the route table, not from a spelled-out path", async () => {
    await renderMenu(<RunbookSideMenu />);

    expect(linksIn("Runbooks")[2]).toEqual({
      title: "Runners",
      href: routeFor(PageMap.RUNBOOKS_RUNNERS),
    });
  });

  test("every entry of the section carries an icon", async () => {
    await renderMenu(<RunbookSideMenu />);

    expect(iconCountIn("Runbooks")).toBe(3);
  });

  test("the rest of the menu is where it was", async () => {
    await renderMenu(<RunbookSideMenu />);

    expect(linksIn("Settings")).toEqual([
      { title: "Global Variables", href: `${RUNBOOKS}/settings/variables` },
      { title: "Owner Rules", href: `${RUNBOOKS}/settings/owner-rules` },
      { title: "Label Rules", href: `${RUNBOOKS}/settings/label-rules` },
    ]);
  });

  test("Runners is in sight on the Runbooks landing page, with Settings folded", async () => {
    await renderMenu(<RunbookSideMenu />);

    expect(isExpanded("Runbooks")).toBe(true);
    expect(sectionBody("Runbooks")).not.toHaveClass("invisible");
    expect(isExpanded("Settings")).toBe(false);
  });

  test("AI Access is in no section, and nothing in the menu leads to its old address", async () => {
    for (const pagePath of [RUNBOOKS, RUNNERS_PATH, OLD_CREDENTIALS_PATH]) {
      goTo(pagePath);
      await renderMenu(<RunbookSideMenu />);

      expect(hrefsInMenu()).not.toContain(OLD_CREDENTIALS_PATH);
      expect(
        allLinks().map((link: MenuLink): string => {
          return link.title;
        }),
      ).not.toContain("AI Access");
      cleanup();
    }
  });

  test.each([
    ["the Runners list", RUNNERS_PATH],
    ["a Runner's page", RUNNER_VIEW_PATH],
  ])(
    "the Runbooks section is open on %s",
    async (_name: string, pagePath: string) => {
      goTo(pagePath);
      await renderMenu(<RunbookSideMenu />);

      expect(isExpanded("Runbooks")).toBe(true);
      expect(sectionBody("Runbooks")).not.toHaveClass("invisible");
    },
  );

  test("Runners is the highlighted entry on its own page, and the only one", async () => {
    goTo(RUNNERS_PATH);
    await renderMenu(<RunbookSideMenu />);

    const highlighted: Array<string> = Array.from(
      document.querySelectorAll("nav a"),
    )
      .filter((anchor: Element): boolean => {
        return anchor.className.includes("bg-indigo-50");
      })
      .map((anchor: Element): string => {
        return (
          anchor.querySelector('[data-testid="side-menu-item-title"]')
            ?.textContent ?? ""
        ).trim();
      });

    expect(highlighted).toEqual(["Runners"]);
  });

  test("every entry in the menu opens a page the router has", async () => {
    await renderMenu(<RunbookSideMenu />);

    const hrefs: Array<string> = hrefsInMenu();

    // Six Runbooks pages, then the Developer section's three.
    expect(hrefs).toHaveLength(9);
    for (const href of hrefs) {
      expect(href).not.toMatch(/[:*]/);
      expect(matchRoutes(realRoutes, href)).not.toBeNull();
    }
  });

  test("on a phone the menu names the section and the page", async () => {
    setViewportWidth(MOBILE_WIDTH);
    goTo(RUNNERS_PATH);
    await renderMenu(<RunbookSideMenu />);

    expect(mobileSummaryText()).toContain("Runbooks");
    expect(mobileSummaryText()).toContain("Runners");
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
    visit(PageMap.RUNBOOKS_VARIABLES);

    expect(
      getRunbooksBreadcrumbs(
        RouteUtil.getRouteString(PageMap.RUNBOOKS_VARIABLES),
      )!.map((link: Link): string => {
        return link.title;
      }),
    ).toEqual(["Project", "Runbooks", "Global Variables"]);
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
      "/dashboard/:projectId/runbooks/runner-credentials",
      "/dashboard/:projectId/settings/runners",
      "/dashboard/:projectId/settings/runners/:id",
      "/dashboard/:projectId/settings/runner-credentials",
    ]) {
      expect(getSettingsBreadcrumbs(pattern)).toBeUndefined();
    }
  });

  // AI Access went with runbook credentials: no trail is kept for it.
  test("Runbooks has no trail for AI Access, which forwards to Runners", () => {
    expect(
      getRunbooksBreadcrumbs(
        "/dashboard/:projectId/runbooks/runner-credentials",
      ),
    ).toBeUndefined();
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

  /*
   * Code says, above a repository's request box, when no Runner is online to
   * do the work - with the one link that fixes it: the repository's own
   * settings, at its Runner (under More settings, which opens there),
   * offered to whoever may change the repository (everyone else is told who
   * can).
   */
  describe("Code's notice that no Runner is online", () => {
    const REPOSITORY_ID: string = "7c1d2e3f-4a5b-4c6d-8e7f-9a0b1c2d3e4f";
    const REPOSITORY_SETTINGS_PATH: string = `/dashboard/${PROJECT_ID}/code/repositories/${REPOSITORY_ID}/settings#runner`;

    // The reader may change the repository, as the permission snapshot says.
    function grantEditRepository(): void {
      const permissions: Array<Permission> = [
        Permission.ProjectUser,
        Permission.EditCodeRepository,
      ];

      jest.spyOn(User, "isMasterAdmin").mockReturnValue(false);
      jest
        .spyOn(PermissionUtil, "getAllPermissions")
        .mockReturnValue(permissions);
      jest.spyOn(PermissionUtil, "getGlobalPermissions").mockReturnValue(null);
      jest.spyOn(PermissionUtil, "getProjectPermissions").mockReturnValue({
        projectId: new ObjectID(PROJECT_ID),
        userId: ObjectID.generate(),
        permissions: permissions.map((permission: Permission) => {
          return {
            permission: permission,
            labelIds: [],
            _type: "UserPermission",
          };
        }),
        _type: "UserTenantAccessPermission",
      });
    }

    function renderNoAgentNotice(
      type: CodeTaskBlockerType = CodeTaskBlockerType.NoAgent,
      // Null for a notice with no repository to open.
      repositoryId: string | null = REPOSITORY_ID,
    ): void {
      render(
        <CodeBlockerNotice
          blocker={{
            type: type,
            message: "No agent is available for this project.",
          }}
          repositoryId={repositoryId || undefined}
        />,
      );
    }

    test.each([
      CodeTaskBlockerType.NoAgent,
      CodeTaskBlockerType.RunnerNotOnline,
      CodeTaskBlockerType.GlobalRunnersOff,
    ])(
      "%s: its fix opens the repository's settings, where its Runner is picked",
      (type: CodeTaskBlockerType) => {
        grantEditRepository();
        renderNoAgentNotice(type);

        const fix: HTMLElement = screen.getByTestId("code-blocker-fix");

        expect(fix).toHaveTextContent("Pick a Runner");
        expect(fix).toHaveAttribute("href", REPOSITORY_SETTINGS_PATH);
        expect(fix).not.toHaveAttribute("href", RUNNERS_PATH);
      },
    );

    test("with no repository to open, the fix is not linked", () => {
      grantEditRepository();
      renderNoAgentNotice(CodeTaskBlockerType.NoAgent, null);

      expect(screen.queryByTestId("code-blocker-fix")).not.toBeInTheDocument();
    });

    test("it says why in the reader's words, not the server's", () => {
      renderNoAgentNotice();

      expect(screen.getByTestId("code-blocker")).toHaveTextContent(
        "No global Runner is online to work in this repository. Pick one of your Runners for it, or try again once the global Runner is back.",
      );
      expect(screen.getByTestId("code-blocker")).not.toHaveTextContent(
        "No agent is available for this project.",
      );
      expect(screen.getByTestId("code-blocker")).not.toHaveTextContent(
        "Code Fixes",
      );
    });
  });
});
