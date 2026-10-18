import "@testing-library/jest-dom";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { cleanup, render, screen } from "@testing-library/react";
import fs from "fs";
import path from "path";
import * as React from "react";
import {
  Location,
  MemoryRouter,
  NavigationType,
  Route as RouterRoute,
  Routes,
  useLocation,
  useNavigationType,
} from "react-router-dom";
import getJestMockFunction, { MockFunction } from "../../MockType";
import PageMap from "../../../../App/FeatureSet/Dashboard/src/Utils/PageMap";
import RouteMap from "../../../../App/FeatureSet/Dashboard/src/Utils/RouteMap";
import { MOVED_EPISODE_DOCS_PATH } from "../../../../App/FeatureSet/Dashboard/src/Routes/MovedPagePaths";
import Route from "../../../Types/API/Route";
import { PROJECT_ID, goTo } from "./SideMenuHarness";

/*
 * Incidents and Alerts each had a "Documentation" page under Episodes in
 * their side menus: a manual of how episodes and grouping rules work, drawn
 * in the product, beside the docs pages that say the same (and that it had
 * drifted from). The docs are the one place for it now: each episode list
 * links there, and the old address - in bookmarks and older messages -
 * forwards to the episode list, outside the layout so the menu never
 * flashes, and ahead of episodes/:id, which would otherwise open
 * "documentation" as an episode.
 *
 * The same route groups hide the side menu on their create pages. Create
 * Alert Episode was the one create page that kept it, squeezing its form.
 *
 * This mounts the REAL Incidents and Alerts route groups, every page of them
 * replaced by a marker that names it.
 */

const DASHBOARD: string = "../../../../App/FeatureSet/Dashboard/src";

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

interface Product {
  name: string;
  routesModule: string;
  pagesDirectory: string;
  segment: string;
  root: PageMap;
  episodesModule: string;
  episodeViewModule: string;
  retiredDocsModule: string;
  createPages: Array<{ path: string; module: string }>;
}

const PRODUCTS: Array<Product> = [
  {
    name: "Incidents",
    routesModule: "Routes/IncidentsRoutes",
    pagesDirectory: "Incidents",
    segment: "incidents",
    root: PageMap.INCIDENTS_ROOT,
    episodesModule: "Incidents/Episodes",
    episodeViewModule: "Incidents/EpisodeView/Index",
    retiredDocsModule: "Incidents/EpisodeDocs",
    createPages: [
      { path: "create", module: "Incidents/Create" },
      { path: "episodes/create", module: "Incidents/EpisodeCreate" },
    ],
  },
  {
    name: "Alerts",
    routesModule: "Routes/AlertRoutes",
    pagesDirectory: "Alerts",
    segment: "alerts",
    root: PageMap.ALERTS_ROOT,
    episodesModule: "Alerts/Episodes",
    episodeViewModule: "Alerts/EpisodeView/Index",
    retiredDocsModule: "Alerts/EpisodeDocs",
    createPages: [
      { path: "create", module: "Alerts/Create" },
      { path: "episodes/create", module: "Alerts/EpisodeCreate" },
    ],
  },
];

// Every page module a route group imports, read from its source.
function pageModulesOf(product: Product): Array<string> {
  const source: string = fs.readFileSync(
    path.join(DASHBOARD_SRC, `${product.routesModule}.tsx`),
    "utf8",
  );

  return Array.from(
    new Set(
      Array.from(
        source.matchAll(
          new RegExp(
            `"\\.\\./Pages/(${product.pagesDirectory}/[A-Za-z/]+)"`,
            "g",
          ),
        ),
      ).map((match: RegExpMatchArray): string => {
        return match[1]!;
      }),
    ),
  );
}

// Called on every render of a product's layout, with what it was handed.
const layoutRenderMock: MockFunction = getJestMockFunction();

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

for (const product of PRODUCTS) {
  for (const module of pageModulesOf(product)) {
    jest.doMock(`${DASHBOARD}/Pages/${module}`, () => {
      if (module === `${product.pagesDirectory}/Layout`) {
        return {
          __esModule: true,
          default: (props: { hideSideMenu?: boolean }): React.ReactElement => {
            layoutRenderMock(product.name, Boolean(props.hideSideMenu));
            const { Outlet } = jest.requireActual("react-router-dom") as {
              Outlet: React.ComponentType;
            };
            return (
              <div
                data-testid="layout"
                data-side-menu={props.hideSideMenu ? "hidden" : "shown"}
              >
                <LocationProbe />
                <Outlet />
              </div>
            );
          },
        };
      }

      return {
        __esModule: true,
        default: (): React.ReactElement => {
          return <div data-testid="page">{module}</div>;
        },
      };
    });
  }
}

const routeGroups: Record<
  string,
  React.FunctionComponent<Record<string, unknown>>
> = {};

for (const product of PRODUCTS) {
  routeGroups[product.name] = (
    jest.requireActual(`${DASHBOARD}/${product.routesModule}`) as {
      default: React.FunctionComponent<Record<string, unknown>>;
    }
  ).default;
}

function base(product: Product): string {
  return `/dashboard/${PROJECT_ID}/${product.segment}`;
}

function visit(product: Product, url: string): void {
  /*
   * The route groups decide whether to hide the menu from window.location,
   * which a MemoryRouter does not touch, so the address bar is put there too.
   */
  goTo(url.split(/[?#]/)[0]!);

  const RouteGroup: React.FunctionComponent<Record<string, unknown>> =
    routeGroups[product.name]!;

  render(
    <MemoryRouter initialEntries={[url]}>
      <Routes>
        <RouterRoute
          path={RouteMap[product.root]!.toString()}
          element={
            <RouteGroup
              pageRoute={new Route(base(product))}
              currentProject={null}
              hasPaymentMethod={true}
            />
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

beforeEach(() => {
  layoutRenderMock.mockReset();
  goTo(`/dashboard/${PROJECT_ID}`);
});

afterEach(() => {
  cleanup();
});

describe("the episode manuals gave way to the docs", () => {
  test("the old address, relative to the product, is episodes/documentation", () => {
    expect(MOVED_EPISODE_DOCS_PATH).toBe("episodes/documentation");
  });

  test("no page of the product is at that address any more", () => {
    for (const product of PRODUCTS) {
      const oldAddress: string = `/dashboard/:projectId/${product.segment}/${MOVED_EPISODE_DOCS_PATH}`;

      for (const route of Object.values(RouteMap)) {
        expect(route.toString()).not.toBe(oldAddress);
      }
    }

    expect(Object.keys(PageMap)).not.toContain("INCIDENT_EPISODE_DOCS");
    expect(Object.keys(PageMap)).not.toContain("ALERT_EPISODE_DOCS");
  });

  test.each(PRODUCTS)(
    "the $name manual is gone, and its route group mounts the forward outside its layout",
    (product: Product) => {
      expect(
        fs.existsSync(
          path.join(DASHBOARD_SRC, "Pages", `${product.retiredDocsModule}.tsx`),
        ),
      ).toBe(false);
      expect(pageModulesOf(product)).not.toContain(product.retiredDocsModule);

      const source: string = fs.readFileSync(
        path.join(DASHBOARD_SRC, `${product.routesModule}.tsx`),
        "utf8",
      );
      const forwardAt: number = source.indexOf(
        "path={MOVED_EPISODE_DOCS_PATH}",
      );

      expect(forwardAt).toBeGreaterThan(-1);
      expect(forwardAt).toBeLessThan(source.indexOf('path="/"'));
    },
  );
});

describe.each(PRODUCTS)(
  "the old $name episode manual address",
  (product: Product) => {
    test("the scaffolding found the episode list and the episode page", () => {
      expect(pageModulesOf(product)).toEqual(
        expect.arrayContaining([
          `${product.pagesDirectory}/Layout`,
          product.episodesModule,
          product.episodeViewModule,
        ]),
      );
    });

    test("arrives at the episode list, which links to the docs", () => {
      visit(product, `${base(product)}/episodes/documentation`);

      expect(landedOn()).toBe(`${base(product)}/episodes`);
      expect(screen.getByTestId("page")).toHaveTextContent(
        product.episodesModule,
      );
    });

    test("is never opened as an episode", () => {
      visit(product, `${base(product)}/episodes/documentation`);

      expect(
        screen.queryByText(product.episodeViewModule),
      ).not.toBeInTheDocument();
    });

    test("replaces the history entry, so Back does not bounce through it", () => {
      visit(product, `${base(product)}/episodes/documentation`);

      expect(screen.getByTestId("navigation-type")).toHaveTextContent(
        "REPLACE",
      );
    });

    test("keeps its query string and hash", () => {
      visit(product, `${base(product)}/episodes/documentation?from=email#top`);

      expect(landedOn()).toBe(`${base(product)}/episodes?from=email#top`);
    });

    test("draws the menu no more often than a direct visit to the list", () => {
      visit(product, `${base(product)}/episodes`);
      const direct: number = layoutRenderMock.mock.calls.length;
      cleanup();
      layoutRenderMock.mockReset();

      visit(product, `${base(product)}/episodes/documentation`);

      expect(direct).toBeGreaterThan(0);
      expect(layoutRenderMock.mock.calls.length).toBe(direct);
    });
  },
);

describe.each(PRODUCTS)("the $name create pages", (product: Product) => {
  test.each(product.createPages)(
    "…/$path fills the width: the side menu is hidden",
    (createPage: { path: string; module: string }) => {
      visit(product, `${base(product)}/${createPage.path}`);

      expect(screen.getByTestId("page")).toHaveTextContent(createPage.module);
      expect(screen.getByTestId("layout")).toHaveAttribute(
        "data-side-menu",
        "hidden",
      );
    },
  );

  test("the episode list keeps its side menu", () => {
    visit(product, `${base(product)}/episodes`);

    expect(screen.getByTestId("layout")).toHaveAttribute(
      "data-side-menu",
      "shown",
    );
  });
});
