import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import "@testing-library/jest-dom";
import { cleanup, render, screen } from "@testing-library/react";
import fs from "fs";
import path from "path";
import * as React from "react";
import {
  MemoryRouter,
  Outlet,
  Route as RouterRoute,
  Routes,
} from "react-router-dom";
import type PageComponentProps from "../../../../App/FeatureSet/Dashboard/src/Pages/PageComponentProps";
import SloListSideMenu from "../../../../App/FeatureSet/Dashboard/src/Pages/Slo/SideMenu";
import { getSloBreadcrumbs } from "../../../../App/FeatureSet/Dashboard/src/Pages/Slo/Utils/Breadcrumbs";
import SloViewSideMenu from "../../../../App/FeatureSet/Dashboard/src/Pages/Slo/View/SideMenu";
import PageMap from "../../../../App/FeatureSet/Dashboard/src/Utils/PageMap";
import RouteMap, {
  RouteUtil,
  SloRoutePath,
} from "../../../../App/FeatureSet/Dashboard/src/Utils/RouteMap";
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
  setViewportWidth,
} from "./SideMenuHarness";

/*
 * An SLO page is reachable only when five separate things line up: a PageMap
 * key, a RouteMap entry, a <PageRoute> in SloRoutes, a breadcrumb trail and a
 * side-menu link. Miss one and nothing fails loudly - the menu entry is simply
 * absent, the link opens a blank layout, or the header loses its trail.
 *
 * The pages are taken from PageMap itself rather than from a list here, so a
 * page added later is swept the moment its key exists. Everything is checked
 * by behaviour: the real route tree is rendered (with page bodies stubbed),
 * and the real side menus and breadcrumb map are read, so a refactor of any
 * of those files can only fail this suite by breaking navigation.
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

/*
 * Side-menu rows can badge themselves with ModelAPI.count. Stub it so a badge
 * added to either SLO menu never reaches for the network from this suite.
 * getList backs the unresolved-state lookup the view menu's open-alert and
 * open-incident badges wait on (through ModelListCache); an empty list means
 * nothing is open, so no count is requested at all.
 */
jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      count: () => {
        return Promise.resolve(0);
      },
      getList: () => {
        return Promise.resolve({ data: [], count: 0, skip: 0, limit: 0 });
      },
    },
  };
});

const DASHBOARD_SRC: string = path.join(
  __dirname,
  "..",
  "..",
  "..",
  "..",
  "App",
  "FeatureSet",
  "Dashboard",
  "src",
);

const SLO_ROUTES_FILE: string = path.join(
  DASHBOARD_SRC,
  "Routes",
  "SloRoutes.tsx",
);

const MODEL_ID: ObjectID = new ObjectID("0193c0de-5555-4aaa-8bbb-000000000005");

/*
 * SLOS, SLOS_*, SLO_VIEW and SLO_VIEW_*. SLOS_ROOT is left out for what it
 * is - the `/*` mount point App nests the SLO router under, not a page - so a
 * key is never skipped just because of its name.
 */
// A named RegExp, because eslint's wrap-regex and prettier fight over a bare literal.
const SLO_PAGE_KEY_PATTERN: RegExp = /^SLOS?(_|$)/;

const SLO_PAGE_KEYS: Array<string> = Object.keys(PageMap).filter(
  (key: string): boolean => {
    return (
      SLO_PAGE_KEY_PATTERN.test(key) &&
      !RouteUtil.getRouteString(key).endsWith("/*")
    );
  },
);

// A rule id for view pages nested below a list, e.g. monitor-rules/:subModelId.
const SUB_MODEL_ID: ObjectID = new ObjectID(
  "0193c0de-5555-4aaa-8bbb-000000000006",
);

/*
 * Charts left the menu when its history moved into Metrics. A monitor rule's
 * view page is reached from its row's View button, not the menu - it has a
 * rule id no menu could know.
 */
const SLO_MENU_KEYS: Array<string> = SLO_PAGE_KEYS.filter(
  (key: string): boolean => {
    return (
      key !== PageMap.SLO_VIEW_CHARTS &&
      key !== PageMap.SLO_VIEW_MONITOR_RULE_VIEW
    );
  },
);

type SloLayoutKind = "list" | "view";

function isViewPage(key: string): boolean {
  return key === PageMap.SLO_VIEW || key.startsWith(`${PageMap.SLO_VIEW}_`);
}

function layoutOf(key: string): SloLayoutKind {
  return isViewPage(key) ? "view" : "list";
}

function pathFor(key: string): string {
  return RouteUtil.populateRouteParams(RouteMap[key] as Route, {
    modelId: MODEL_ID,
    subModelId: SUB_MODEL_ID,
  }).toString();
}

function breadcrumbsAt(key: string): Array<Link> | undefined {
  goTo(pathFor(key));
  return getSloBreadcrumbs(Navigation.getRoutePath(RouteUtil.getRoutes()));
}

async function renderSideMenuFor(key: string): Promise<void> {
  if (layoutOf(key) === "view") {
    await renderMenu(<SloViewSideMenu modelId={MODEL_ID} />);
    return;
  }

  await renderMenu(<SloListSideMenu />);
}

/*
 * Replace every SLO page and layout SloRoutes imports with a stub that shows
 * which route it was mounted for. The import list is read from SloRoutes so a
 * newly routed page is stubbed too, instead of dragging its real body (and its
 * API calls) into this suite.
 */
function stubSloRoutePages(): void {
  const source: string = fs.readFileSync(SLO_ROUTES_FILE, "utf8");
  const importPattern: RegExp =
    /(?:from\s+|import\(\s*)"(\.\.\/Pages\/Slo\/[^"]+)"/g;
  const modulePaths: Set<string> = new Set();
  let match: RegExpExecArray | null = importPattern.exec(source);

  while (match) {
    modulePaths.add(match[1]!);
    match = importPattern.exec(source);
  }

  modulePaths.forEach((modulePath: string) => {
    const absolutePath: string = path.resolve(
      path.dirname(SLO_ROUTES_FILE),
      modulePath,
    );

    if (modulePath.endsWith("/Layout")) {
      const kind: SloLayoutKind = modulePath.includes("/View/")
        ? "view"
        : "list";

      jest.doMock(absolutePath, () => {
        return {
          __esModule: true,
          default: (): React.ReactElement => {
            return (
              <div data-layout={kind}>
                <Outlet />
              </div>
            );
          },
        };
      });
      return;
    }

    jest.doMock(absolutePath, () => {
      return {
        __esModule: true,
        default: (props: PageComponentProps): React.ReactElement => {
          return <div data-testid="slo-page">{props.pageRoute.toString()}</div>;
        },
      };
    });
  });
}

let SloRoutes: React.FunctionComponent<PageComponentProps> | undefined;

function renderSloRoutesAt(currentPath: string): void {
  const SloRoutesComponent: React.FunctionComponent<PageComponentProps> =
    SloRoutes!;

  // Mounted exactly as App mounts it: under the SLOS_ROOT splat route.
  render(
    <MemoryRouter initialEntries={[currentPath]}>
      <Routes>
        <RouterRoute
          path={RouteUtil.getRouteString(PageMap.SLOS_ROOT)}
          element={
            <SloRoutesComponent
              pageRoute={RouteMap[PageMap.SLOS_ROOT] as Route}
              currentProject={null}
              hasPaymentMethod={true}
            />
          }
        />
      </Routes>
    </MemoryRouter>,
  );
}

describe("SLO navigation wiring", () => {
  beforeAll(() => {
    stubSloRoutePages();
    SloRoutes = (
      jest.requireActual(SLO_ROUTES_FILE) as {
        default: React.FunctionComponent<PageComponentProps>;
      }
    ).default;
  });

  beforeEach(() => {
    setViewportWidth(DESKTOP_WIDTH);
    // Route population reads the project id from the current URL.
    goTo(`/dashboard/${PROJECT_ID}`);
  });

  afterEach(() => {
    cleanup();
  });

  test("sweeps every SLO page, including the list and view landings", () => {
    expect(SLO_PAGE_KEYS).toEqual(
      expect.arrayContaining([
        PageMap.SLOS,
        PageMap.SLOS_ARCHIVED,
        PageMap.SLO_VIEW,
        PageMap.SLO_VIEW_MONITORS,
        PageMap.SLO_VIEW_MONITOR_RULES,
        PageMap.SLO_VIEW_METRICS,
        PageMap.SLO_VIEW_FEED,
        PageMap.SLO_VIEW_SETTINGS,
      ]),
    );
    expect(SLO_PAGE_KEYS).not.toContain(PageMap.SLOS_ROOT);
  });

  test.each(SLO_PAGE_KEYS)(
    "%s has a route under the SLO product URL",
    (key: string) => {
      const route: string = RouteUtil.getRouteString(key);
      const productPath: string = RouteUtil.getRouteString(PageMap.SLOS);

      expect(route).not.toBe("");
      expect(route).not.toContain("*");

      if (key === PageMap.SLOS) {
        return;
      }

      /*
       * Every other page is one SloRoutePath segment below the list. The
       * nested router matches that segment, so a RouteMap entry that does
       * not use it would link somewhere the router never renders.
       */
      expect(SloRoutePath[key]).toBeTruthy();
      expect(route).toBe(`${productPath}/${SloRoutePath[key]}`);
    },
  );

  test("no two SLO pages share a URL", () => {
    const routes: Array<string> = SLO_PAGE_KEYS.map((key: string): string => {
      return RouteUtil.getRouteString(key);
    });

    expect(new Set(routes).size).toBe(routes.length);
  });

  test.each(SLO_PAGE_KEYS)(
    "%s is routed by SloRoutes to its own page inside the matching layout",
    (key: string) => {
      renderSloRoutesAt(pathFor(key));

      const pages: Array<HTMLElement> = screen.getAllByTestId("slo-page");

      expect(pages).toHaveLength(1);
      // The stub prints the pageRoute SloRoutes handed it for this URL.
      expect(pages[0]!.textContent).toBe(RouteUtil.getRouteString(key));
      /*
       * `archived` and `:id` are both one segment below the list, so a list
       * page rendered inside the view layout would be read as an SLO id.
       */
      expect(
        pages[0]!.closest("[data-layout]")?.getAttribute("data-layout"),
      ).toBe(layoutOf(key));
    },
  );

  test.each(SLO_PAGE_KEYS)(
    "%s has a breadcrumb trail that ends on the page itself",
    (key: string) => {
      const currentPath: string = pathFor(key);
      goTo(currentPath);

      const matchedPath: string = Navigation.getRoutePath(
        RouteUtil.getRoutes(),
      );

      // The app-wide matcher resolves this URL to this page, not a sibling.
      expect(matchedPath).toBe(RouteUtil.getRouteString(key));

      const links: Array<Link> | undefined = getSloBreadcrumbs(matchedPath);

      expect(links).toBeDefined();

      const titles: Array<string> = links!.map((link: Link): string => {
        return link.title;
      });

      expect(titles.slice(0, 2)).toEqual(["Project", "SLOs"]);

      if (isViewPage(key)) {
        expect(titles[2]).toBe("View SLO");
      }

      expect(links![links!.length - 1]!.to.toString()).toBe(currentPath);
    },
  );

  test.each(SLO_MENU_KEYS)(
    "%s is linked from its side menu under the name its breadcrumb uses",
    async (key: string) => {
      const trail: Array<Link> = breadcrumbsAt(key) || [];
      const leafTitle: string | undefined = trail[trail.length - 1]?.title;

      await renderSideMenuFor(key);

      const link: MenuLink | undefined = allLinks().find(
        (candidate: MenuLink): boolean => {
          return candidate.href === pathFor(key);
        },
      );

      expect(link).toBeDefined();

      /*
       * The overview is the one page named differently on purpose: "Overview"
       * among its siblings in the menu, "View SLO" as the parent crumb every
       * other SLO page's trail runs through.
       */
      if (key !== PageMap.SLO_VIEW) {
        expect(link!.title).toBe(leafTitle);
      }
    },
  );

  test("Charts still resolves for bookmarks but is no longer a menu destination", async () => {
    renderSloRoutesAt(pathFor(PageMap.SLO_VIEW_CHARTS));

    expect(screen.getByTestId("slo-page").textContent).toBe(
      RouteUtil.getRouteString(PageMap.SLO_VIEW_CHARTS),
    );

    cleanup();
    await renderSideMenuFor(PageMap.SLO_VIEW_CHARTS);

    expect(
      allLinks().map((link: MenuLink): string => {
        return link.href;
      }),
    ).not.toContain(pathFor(PageMap.SLO_VIEW_CHARTS));
  });

  test.each([PageMap.SLOS, PageMap.SLO_VIEW])(
    "every link in the %s side menu opens a distinct SLO page",
    async (menuPage: string) => {
      const sloPagePaths: Set<string> = new Set(SLO_PAGE_KEYS.map(pathFor));

      await renderSideMenuFor(menuPage);

      const hrefs: Array<string> = allLinks().map((link: MenuLink): string => {
        return link.href;
      });

      expect(hrefs.length).toBeGreaterThan(0);
      expect(new Set(hrefs).size).toBe(hrefs.length);
      hrefs.forEach((href: string) => {
        expect(sloPagePaths.has(href)).toBe(true);
      });
    },
  );
});
