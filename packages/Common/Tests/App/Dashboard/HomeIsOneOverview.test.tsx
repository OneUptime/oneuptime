import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import "@testing-library/jest-dom";
import { act, cleanup, render, screen, within } from "@testing-library/react";
import * as fs from "fs";
import * as path from "path";
import * as React from "react";
import {
  Location,
  MemoryRouter,
  NavigationType,
  Outlet,
  Route as RouterRoute,
  Routes,
  useLocation,
  useNavigationType,
} from "react-router-dom";

/*
 * Home is one page, the overview, with no side menu (#6857).
 *
 * Home used to keep its own copies of six of the products' lists - active
 * incidents and their episodes, active alerts and their episodes, monitors
 * that are not operational, maintenance in progress - under a side menu of
 * its own. So a click on Home's Active Alerts opened a Home page with Home's
 * menu, not Alerts > Active Alerts, where the Alerts menu, its filters and
 * its actions are. Now everything Home counts opens the product's own list,
 * and the copies' addresses - in bookmarks, browser history, pasted links -
 * forward there (Routes/MovedHomeRoutes).
 *
 * This renders the real Home frame (Pages/Home/Layout), and the real forwards
 * routed by the real RouteMap patterns App.tsx mounts them at, and reads the
 * real strip and Needs attention definitions.
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

import HomeLayout from "../../../../App/FeatureSet/Dashboard/src/Pages/Home/Layout";
import { HomeCounts } from "../../../../App/FeatureSet/Dashboard/src/Components/Home/HomeOverviewData";
import {
  AttentionGroup,
  AttentionGroupKey,
  getAttentionGroups,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Home/NeedsAttention";
import {
  getStatTiles,
  StatTile,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Home/OverviewStats";
import { getSlosAtRiskQueryParams } from "../../../../App/FeatureSet/Dashboard/src/Components/Slo/SloListFacetRoute";
import MovedHomeRoutes from "../../../../App/FeatureSet/Dashboard/src/Routes/MovedHomeRoutes";
import { MOVED_HOME_LIST_PATHS } from "../../../../App/FeatureSet/Dashboard/src/Routes/MovedPagePaths";
import PageMap from "../../../../App/FeatureSet/Dashboard/src/Utils/PageMap";
import RouteMap from "../../../../App/FeatureSet/Dashboard/src/Utils/RouteMap";
import Project from "../../../Models/DatabaseModels/Project";
import Route from "../../../Types/API/Route";
import Dictionary from "../../../Types/Dictionary";
import { createTranslator } from "../../../UI/Utils/TranslateTemplate";
import {
  DESKTOP_WIDTH,
  MOBILE_WIDTH,
  PROJECT_ID,
  goTo,
  routeFor,
  setViewportWidth,
} from "./SideMenuHarness";

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

const HOME_ROUTE: string = (RouteMap[PageMap.HOME] as Route).toString();
const FORWARDS_ROUTE: string = (
  RouteMap[PageMap.MOVED_HOME_LISTS_ROOT] as Route
).toString();

const OTHER_PROJECT_ID: string = "1c2d3e4f-5a6b-4c7d-8e9f-0a1b2c3d4e5f";

function project(): Project {
  const value: Project = new Project();
  value._id = PROJECT_ID;
  return value;
}

function home(projectId: string = PROJECT_ID): string {
  return `/dashboard/${projectId}/home`;
}

// Reports where the router ended up, and how it got there.
function LocationProbe(): React.ReactElement {
  const location: Location = useLocation();
  const navigationType: NavigationType = useNavigationType();

  return (
    <div data-testid="location">
      <span data-testid="pathname">{location.pathname}</span>
      <span data-testid="search">{location.search}</span>
      <span data-testid="hash">{location.hash}</span>
      <span data-testid="navigation-type">{navigationType}</span>
    </div>
  );
}

/*
 * Routed as App.tsx routes them: Home inside its pathless frame, and the
 * forwards at their own mount beside it. Any other address stands for the
 * product page a forward opened.
 */
function visit(url: string): void {
  /*
   * RouteUtil fills the project id in from window.location, which a
   * MemoryRouter does not touch, so the address bar is put there too.
   */
  goTo(url.split(/[?#]/)[0]!);

  render(
    <MemoryRouter initialEntries={[url]}>
      <Routes>
        <RouterRoute
          element={
            <div data-testid="home-frame">
              <Outlet />
            </div>
          }
        >
          <RouterRoute
            path={HOME_ROUTE}
            element={
              <div data-testid="home-page">
                <LocationProbe />
              </div>
            }
          />
        </RouterRoute>
        <RouterRoute path={FORWARDS_ROUTE} element={<MovedHomeRoutes />} />
        <RouterRoute
          path="*"
          element={
            <div data-testid="product-page">
              <LocationProbe />
            </div>
          }
        />
      </Routes>
    </MemoryRouter>,
  );
}

function landedOn(): string {
  return (
    (screen.getByTestId("pathname").textContent ?? "") +
    (screen.getByTestId("search").textContent ?? "") +
    (screen.getByTestId("hash").textContent ?? "")
  );
}

function navigationType(): string {
  return screen.getByTestId("navigation-type").textContent ?? "";
}

beforeEach(() => {
  setViewportWidth(DESKTOP_WIDTH);
  goTo(home());
});

afterEach(() => {
  cleanup();
});

describe("Home's frame", () => {
  async function renderHome(url: string): Promise<void> {
    goTo(url);

    await act(async () => {
      render(
        <MemoryRouter initialEntries={[url]}>
          <Routes>
            <RouterRoute
              element={
                <HomeLayout
                  pageRoute={RouteMap[PageMap.HOME] as Route}
                  currentProject={project()}
                  hasPaymentMethod={false}
                />
              }
            >
              <RouterRoute
                path={HOME_ROUTE}
                element={<div data-testid="home-overview" />}
              />
            </RouterRoute>
          </Routes>
        </MemoryRouter>,
      );
    });
  }

  test.each([`${home()}/`, home()])(
    "at %s draws the overview with no side menu, on a phone too",
    async (url: string) => {
      for (const width of [DESKTOP_WIDTH, MOBILE_WIDTH]) {
        setViewportWidth(width);
        await renderHome(url);

        expect(screen.getByTestId("home-overview")).toBeInTheDocument();
        expect({
          width,
          sideMenu: screen.queryByRole("navigation", {
            name: "Main navigation",
          }),
          phoneToggle: screen.queryByTestId("mobile-sidemenu-toggle"),
        }).toEqual({ width, sideMenu: null, phoneToggle: null });

        cleanup();
      }
    },
  );

  test("is titled Home, under the trail Project > Home", async () => {
    await renderHome(`${home()}/`);

    expect(
      screen.getByRole("heading", { level: 1, name: "Home" }),
    ).toBeInTheDocument();

    const trail: HTMLElement = screen.getByRole("navigation", {
      name: "Breadcrumb",
    });

    expect(
      within(trail)
        .getAllByRole("listitem")
        .map((crumb: HTMLElement): string => {
          return (crumb.textContent || "").trim();
        }),
    ).toEqual(["Project", "Home"]);
  });

  /*
   * Setup Health (#6812) is the one page under Home besides the overview: a
   * page of its own about the whole project, opened from Needs attention -
   * not a copy of a product's list - with no side menu either.
   */
  test("Home's pages are the overview and its frame, Setup Health, and no side menu", () => {
    expect(
      fs.readdirSync(path.join(DASHBOARD_SRC, "Pages", "Home")).sort(),
    ).toEqual(["Home.tsx", "Layout.tsx", "SetupHealth.tsx"]);

    const setupHealth: string = fs.readFileSync(
      path.join(DASHBOARD_SRC, "Pages", "Home", "SetupHealth.tsx"),
      "utf8",
    );

    expect(setupHealth).not.toMatch(/sideMenu\s*=/);
    expect(setupHealth).not.toMatch(/SideMenu/);

    const frame: string = fs.readFileSync(
      path.join(DASHBOARD_SRC, "Pages", "Home", "Layout.tsx"),
      "utf8",
    );

    expect(frame).not.toMatch(/sideMenu\s*=/);
    expect(frame).not.toMatch(/SideMenu/);
  });

  test("nothing in the RouteMap is under Home but Home, Setup Health and the forwards", () => {
    const underHome: Array<string> = Object.keys(RouteMap).filter(
      (key: string): boolean => {
        return (RouteMap[key] as Route)
          .toString()
          .startsWith("/dashboard/:projectId/home/");
      },
    );

    expect(underHome.sort()).toEqual(
      [
        PageMap.HOME,
        PageMap.HOME_SETUP_HEALTH,
        PageMap.MOVED_HOME_LISTS_ROOT,
      ].sort(),
    );
    expect((RouteMap[PageMap.HOME_SETUP_HEALTH] as Route).toString()).toBe(
      "/dashboard/:projectId/home/setup-health",
    );
    expect(HOME_ROUTE).toBe("/dashboard/:projectId/home/");
    expect(FORWARDS_ROUTE).toBe("/dashboard/:projectId/home/*");
  });
});

/*
 * Each old address, and the product list it opens: written out, not read
 * from the RouteMap, so a list that moves again has to be looked at here.
 */
const FORWARDS: Array<[string, PageMap, string]> = [
  ["active-incidents", PageMap.UNRESOLVED_INCIDENTS, "incidents/unresolved"],
  [
    "active-incident-episodes",
    PageMap.UNRESOLVED_INCIDENT_EPISODES,
    "incidents/episodes/unresolved",
  ],
  ["active-alerts", PageMap.UNRESOLVED_ALERTS, "alerts/unresolved"],
  [
    "active-episodes",
    PageMap.UNRESOLVED_ALERT_EPISODES,
    "alerts/episodes/unresolved",
  ],
  [
    "monitors-inoperational",
    PageMap.MONITORS_INOPERATIONAL,
    "monitors/inoperational",
  ],
  [
    "scheduled-maintenance-ongoing",
    PageMap.ONGOING_SCHEDULED_MAINTENANCE_EVENTS,
    "scheduled-maintenance-events/ongoing",
  ],
];

describe("the forwarding table", () => {
  test("names the six addresses Home's lists had, relative to Home", () => {
    expect(MOVED_HOME_LIST_PATHS).toEqual({
      activeIncidents: "active-incidents",
      activeIncidentEpisodes: "active-incident-episodes",
      activeAlerts: "active-alerts",
      activeAlertEpisodes: "active-episodes",
      notOperationalMonitors: "monitors-inoperational",
      ongoingScheduledMaintenance: "scheduled-maintenance-ongoing",
    });
    expect(
      FORWARDS.map((forward: [string, PageMap, string]): string => {
        return forward[0];
      }).sort(),
    ).toEqual(Object.values(MOVED_HOME_LIST_PATHS).sort());
  });

  test("no page is at an old address any more", () => {
    const routes: Array<string> = Object.values(RouteMap).map(
      (route: Route): string => {
        return route.toString();
      },
    );

    for (const oldPath of Object.values(MOVED_HOME_LIST_PATHS)) {
      expect(routes).not.toContain(`/dashboard/:projectId/home/${oldPath}`);
    }
  });
});

describe("Home's old list addresses", () => {
  test.each(FORWARDS)(
    "…/home/%s opens the product's own list",
    (oldPath: string, pageMap: PageMap, newPath: string) => {
      visit(`${home()}/${oldPath}`);

      expect(screen.getByTestId("product-page")).toBeInTheDocument();
      expect(screen.queryByTestId("home-frame")).not.toBeInTheDocument();
      expect(landedOn()).toBe(`/dashboard/${PROJECT_ID}/${newPath}`);
      expect(landedOn()).toBe(routeFor(pageMap));
    },
  );

  test.each(FORWARDS)(
    "…/home/%s keeps its query string and hash",
    (oldPath: string, _pageMap: PageMap, newPath: string) => {
      visit(`${home()}/${oldPath}?page=2&sortBy=createdAt#top`);

      expect(landedOn()).toBe(
        `/dashboard/${PROJECT_ID}/${newPath}?page=2&sortBy=createdAt#top`,
      );
    },
  );

  test.each(FORWARDS)(
    "…/home/%s replaces the history entry, so Back does not bounce",
    (oldPath: string) => {
      visit(`${home()}/${oldPath}`);

      expect(navigationType()).toBe("REPLACE");
    },
  );

  test("the project in the address is the project it forwards within", () => {
    visit(`${home(OTHER_PROJECT_ID)}/active-alerts`);

    expect(landedOn()).toBe(`/dashboard/${OTHER_PROJECT_ID}/alerts/unresolved`);
  });

  test("an old address with a trailing slash forwards too", () => {
    visit(`${home()}/active-alerts/`);

    expect(landedOn()).toBe(`/dashboard/${PROJECT_ID}/alerts/unresolved`);
  });

  test.each([
    `${home()}/not-a-page`,
    `${home()}/active-alerts/anything`,
    `${home()}/overview`,
  ])("%s, never a page, lands on Home", (url: string) => {
    visit(url);

    expect(screen.getByTestId("home-page")).toBeInTheDocument();
    expect(landedOn()).toBe(`${home()}/`);
    expect(navigationType()).toBe("REPLACE");
  });

  test.each([`${home()}/`, home()])(
    "%s is Home itself: it outranks the forwards and is not forwarded",
    (url: string) => {
      visit(url);

      expect(screen.getByTestId("home-page")).toBeInTheDocument();
      expect(screen.getByTestId("home-frame")).toContainElement(
        screen.getByTestId("home-page"),
      );
      expect(landedOn()).toBe(url);
      expect(navigationType()).toBe("POP");
    },
  );
});

describe("what Home counts opens in its own product", () => {
  const COUNTS: HomeCounts = {
    activeIncidents: 2,
    activeAlerts: 3,
    notOperationalMonitors: 1,
    ongoingMaintenance: 1,
    slosNeedingAttention: 2,
    totalMonitors: 4,
    totalSlos: 2,
  };

  const PRODUCT_LIST_OF_TILE: Record<string, PageMap> = {
    "active-incidents": PageMap.UNRESOLVED_INCIDENTS,
    "active-alerts": PageMap.UNRESOLVED_ALERTS,
    "not-operational-monitors": PageMap.MONITORS_INOPERATIONAL,
    "ongoing-maintenance": PageMap.ONGOING_SCHEDULED_MAINTENANCE_EVENTS,
    "slos-needing-attention": PageMap.SLOS,
  };

  const TILE_OF_GROUP: Record<AttentionGroupKey, string> = {
    [AttentionGroupKey.Incidents]: "active-incidents",
    [AttentionGroupKey.Alerts]: "active-alerts",
    [AttentionGroupKey.Monitors]: "not-operational-monitors",
    [AttentionGroupKey.Slos]: "slos-needing-attention",
    [AttentionGroupKey.Maintenance]: "ongoing-maintenance",
  };

  test("each number opens its product's list, never a page under Home", () => {
    const tiles: Array<StatTile> = getStatTiles(COUNTS);

    expect(
      Object.fromEntries(
        tiles.map((tile: StatTile): [string, string] => {
          return [tile.key, tile.pageMap];
        }),
      ),
    ).toEqual(PRODUCT_LIST_OF_TILE);

    for (const tile of tiles) {
      expect({ tile: tile.key, route: routeFor(tile.pageMap) }).toEqual({
        tile: tile.key,
        route: expect.not.stringContaining("/home"),
      });
    }
  });

  test("each kind's View all opens the same list as its number", () => {
    const groups: Array<AttentionGroup> = getAttentionGroups(
      {
        activeIncidents: { items: [], count: COUNTS.activeIncidents },
        activeAlerts: { items: [], count: COUNTS.activeAlerts },
        notOperationalMonitors: {
          items: [],
          count: COUNTS.notOperationalMonitors,
        },
        ongoingMaintenance: { items: [], count: COUNTS.ongoingMaintenance },
        slosNeedingAttention: {
          items: [],
          count: COUNTS.slosNeedingAttention,
        },
        totalMonitors: COUNTS.totalMonitors,
        totalSlos: COUNTS.totalSlos,
      },
      createTranslator(undefined, "en"),
    );
    const tiles: Array<StatTile> = getStatTiles(COUNTS);

    expect(groups.length).toBe(5);

    for (const group of groups) {
      const tile: StatTile | undefined = tiles.find(
        (candidate: StatTile): boolean => {
          return candidate.key === TILE_OF_GROUP[group.key];
        },
      );

      expect({
        group: group.key,
        viewAll: group.viewAll,
        query: group.viewAllQuery,
      }).toEqual({
        group: group.key,
        viewAll: tile?.pageMap,
        query: tile?.linkQuery,
      });
    }
  });

  /*
   * The SLOs list holds every SLO, so while any is at risk the number opens
   * it with its chips set to them. Every other list holds just what its
   * number counts, and opens as it is.
   */
  test("only SLOs at risk opens its list filtered, and only while there are some", () => {
    const linkQueries: (
      counts: HomeCounts,
    ) => Record<string, Dictionary<string> | undefined> = (
      counts: HomeCounts,
    ): Record<string, Dictionary<string> | undefined> => {
      return Object.fromEntries(
        getStatTiles(counts).map(
          (tile: StatTile): [string, Dictionary<string> | undefined] => {
            return [tile.key, tile.linkQuery];
          },
        ),
      );
    };

    expect(Object.keys(getSlosAtRiskQueryParams())).toEqual([
      "slos-table-facets",
    ]);
    expect(linkQueries(COUNTS)).toStrictEqual({
      "active-incidents": undefined,
      "active-alerts": undefined,
      "not-operational-monitors": undefined,
      "ongoing-maintenance": undefined,
      "slos-needing-attention": getSlosAtRiskQueryParams(),
    });

    // None at risk: the whole list, where the healthy ones are.
    expect(
      linkQueries({ ...COUNTS, slosNeedingAttention: 0 })[
        "slos-needing-attention"
      ],
    ).toBeUndefined();

    // No SLOs yet: the whole list, where one is created.
    const notSetUp: StatTile | undefined = getStatTiles({
      ...COUNTS,
      slosNeedingAttention: 0,
      totalSlos: 0,
    }).find((tile: StatTile): boolean => {
      return tile.key === "slos-needing-attention";
    });

    expect(notSetUp?.pageMap).toBe(PageMap.SLOS);
    expect(notSetUp?.linkQuery).toBeUndefined();
  });
});
