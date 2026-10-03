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
} from "react-router-dom";
import getJestMockFunction, { MockFunction } from "../../MockType";
import PageMap from "../../../../App/FeatureSet/Dashboard/src/Utils/PageMap";
import RouteMap from "../../../../App/FeatureSet/Dashboard/src/Utils/RouteMap";
import Route from "../../../Types/API/Route";
import { PROJECT_ID, goTo } from "./SideMenuHarness";

/*
 * Number prefixes lived on a page called More Settings in Incidents, Alerts
 * and Scheduled Maintenance (…/settings/more) until each product got a Number
 * Prefix page instead. People have the old address bookmarked, and older
 * docs link to it, so it must keep arriving somewhere: the Number Prefix
 * page of the same product, in the same project.
 *
 * This mounts each product's REAL route group - every page and layout it
 * imports replaced by a marker, read from the route file's source so a page
 * added later is mocked too - and visits the old address.
 */

const DASHBOARD: string = "../../../../App/FeatureSet/Dashboard/src";

const ROUTES_DIR: string = path.join(
  __dirname,
  "..",
  "..",
  "..",
  "..",
  "App",
  "FeatureSet",
  "Dashboard",
  "src",
  "Routes",
);

interface Product {
  name: string;
  routesFile: string;
  rootKey: PageMap;
  pageKey: PageMap;
  segment: string;
  // The module (under Pages/) of the Number Prefix page.
  pageModule: string;
}

const PRODUCTS: Array<Product> = [
  {
    name: "Incidents",
    routesFile: "IncidentsRoutes",
    rootKey: PageMap.INCIDENTS_ROOT,
    pageKey: PageMap.INCIDENTS_SETTINGS_NUMBER_PREFIX,
    segment: "incidents",
    pageModule: "Incidents/Settings/IncidentNumberPrefix",
  },
  {
    name: "Alerts",
    routesFile: "AlertRoutes",
    rootKey: PageMap.ALERTS_ROOT,
    pageKey: PageMap.ALERTS_SETTINGS_NUMBER_PREFIX,
    segment: "alerts",
    pageModule: "Alerts/Settings/AlertNumberPrefix",
  },
  {
    name: "Scheduled Maintenance",
    routesFile: "ScheduleMaintenanceEventsRoutes",
    rootKey: PageMap.SCHEDULED_MAINTENANCE_EVENTS_ROOT,
    pageKey: PageMap.SCHEDULED_MAINTENANCE_EVENTS_SETTINGS_NUMBER_PREFIX,
    segment: "scheduled-maintenance-events",
    pageModule:
      "ScheduledMaintenanceEvents/Settings/ScheduledMaintenanceNumberPrefix",
  },
];

function pageModulesOf(routesFile: string): Array<string> {
  const source: string = fs.readFileSync(
    path.join(ROUTES_DIR, `${routesFile}.tsx`),
    "utf8",
  );

  return Array.from(
    new Set(
      Array.from(source.matchAll(/"\.\.\/Pages\/([^"]+)"/g)).map(
        (match: RegExpMatchArray): string => {
          return match[1]!;
        },
      ),
    ),
  );
}

// Every page a route renders, and every layout render with where it was.
const renderedPagesMock: MockFunction = getJestMockFunction();
const layoutRendersMock: MockFunction = getJestMockFunction();

const ALL_PAGE_MODULES: Array<string> = Array.from(
  new Set(
    PRODUCTS.flatMap((product: Product): Array<string> => {
      return pageModulesOf(product.routesFile);
    }),
  ),
);

for (const module of ALL_PAGE_MODULES) {
  jest.doMock(`${DASHBOARD}/Pages/${module}`, () => {
    if (module.endsWith("Layout")) {
      return {
        __esModule: true,
        default: (): React.ReactElement => {
          const { Outlet, useLocation: currentLocation } = jest.requireActual(
            "react-router-dom",
          ) as {
            Outlet: React.ComponentType;
            useLocation: () => Location;
          };
          layoutRendersMock(module, currentLocation().pathname);
          return (
            <div data-testid={`layout:${module}`}>
              <Outlet />
            </div>
          );
        },
      };
    }

    return {
      __esModule: true,
      default: (props: Record<string, unknown>): React.ReactElement => {
        renderedPagesMock(module, props);
        const { useLocation: currentLocation, useNavigationType: howReached } =
          jest.requireActual("react-router-dom") as {
            useLocation: () => Location;
            useNavigationType: () => NavigationType;
          };
        const location: Location = currentLocation();
        const navigationType: NavigationType = howReached();
        return (
          <div data-testid="page">
            <span data-testid="page-module">{module}</span>
            <span data-testid="pathname">{location.pathname}</span>
            <span data-testid="search">{location.search}</span>
            <span data-testid="hash">{location.hash}</span>
            <span data-testid="navigation-type">{navigationType}</span>
          </div>
        );
      },
    };
  });
}

// Required after the mocks above, which jest.doMock does not hoist.
function routesOf(
  product: Product,
): React.FunctionComponent<Record<string, unknown>> {
  return (
    jest.requireActual(`${DASHBOARD}/Routes/${product.routesFile}`) as {
      default: React.FunctionComponent<Record<string, unknown>>;
    }
  ).default;
}

function visit(product: Product, url: string): void {
  /*
   * RouteUtil fills the project id in from window.location, which a
   * MemoryRouter does not touch - so the address bar is put there too.
   */
  goTo(url.split(/[?#]/)[0]!);

  const ProductRoutes: React.FunctionComponent<Record<string, unknown>> =
    routesOf(product);

  render(
    <MemoryRouter initialEntries={[url]}>
      <Routes>
        <RouterRoute
          path={RouteMap[product.rootKey]!.toString()}
          element={
            <ProductRoutes
              pageRoute={
                new Route(`/dashboard/${PROJECT_ID}/${product.segment}`)
              }
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

function base(product: Product, projectId: string = PROJECT_ID): string {
  return `/dashboard/${projectId}/${product.segment}`;
}

beforeEach(() => {
  renderedPagesMock.mockReset();
  layoutRendersMock.mockReset();
  goTo(`/dashboard/${PROJECT_ID}`);
});

afterEach(() => {
  cleanup();
});

describe("the suite's own scaffolding", () => {
  test.each(PRODUCTS)(
    "$name: found the route group's pages and its Number Prefix page among them",
    (product: Product) => {
      const modules: Array<string> = pageModulesOf(product.routesFile);

      expect(modules.length).toBeGreaterThan(20);
      expect(modules).toContain(product.pageModule);
      expect(
        modules.filter((module: string): boolean => {
          return module.includes("MoreSettings");
        }),
      ).toEqual([]);
    },
  );
});

describe.each(PRODUCTS)(
  "$name: the old More Settings address",
  (product: Product) => {
    const oldUrl: string = `${base(product)}/settings/more`;
    const newUrl: string = `${base(product)}/settings/number-prefix`;

    test("arrives at the Number Prefix page", () => {
      visit(product, oldUrl);

      expect(screen.getByTestId("page-module")).toHaveTextContent(
        product.pageModule,
      );
      expect(landedOn()).toBe(newUrl);
    });

    test("is the address the route table gives the Number Prefix page", () => {
      visit(product, oldUrl);

      expect(landedOn()).toBe(
        RouteMap[product.pageKey]!.toString().replace(":projectId", PROJECT_ID),
      );
    });

    test("replaces the history entry, so Back does not bounce", () => {
      visit(product, oldUrl);

      expect(screen.getByTestId("navigation-type")).toHaveTextContent(
        "REPLACE",
      );
    });

    // The redirect sits outside the layout, so the side menu never flashes.
    test("never renders the product's layout at the old address", () => {
      visit(product, oldUrl);

      const pathsRendered: Array<string> = layoutRendersMock.mock.calls.map(
        (call: Array<unknown>): string => {
          return call[1] as string;
        },
      );

      expect(pathsRendered.length).toBeGreaterThan(0);
      expect(
        pathsRendered.filter((pathname: string): boolean => {
          return pathname.endsWith("/settings/more");
        }),
      ).toEqual([]);
    });

    test("keeps its query string and hash", () => {
      visit(product, `${oldUrl}?from=bookmark#prefix`);

      expect(landedOn()).toBe(`${newUrl}?from=bookmark#prefix`);
    });

    test("stays in the project in the URL", () => {
      const otherProjectId: string = "1c2d3e4f-5a6b-4c7d-8e9f-0a1b2c3d4e5f";

      visit(product, `${base(product, otherProjectId)}/settings/more`);

      expect(landedOn()).toBe(
        `${base(product, otherProjectId)}/settings/number-prefix`,
      );
    });

    test("matches in any case, as every dashboard route does", () => {
      visit(product, `${base(product)}/settings/More`);

      expect(landedOn()).toBe(newUrl);
    });

    test("an address below it never existed and is not forwarded", () => {
      visit(product, `${oldUrl}/anything`);

      expect(renderedPagesMock).not.toHaveBeenCalledWith(
        product.pageModule,
        expect.anything(),
      );
    });
  },
);

describe.each(PRODUCTS)(
  "$name: the Number Prefix page itself",
  (product: Product) => {
    test("renders at settings/number-prefix inside the product's layout, with its pageRoute", () => {
      visit(product, `${base(product)}/settings/number-prefix`);

      expect(screen.getAllByTestId("page")).toHaveLength(1);
      expect(screen.getByTestId("page-module")).toHaveTextContent(
        product.pageModule,
      );
      expect(screen.getByTestId("navigation-type")).toHaveTextContent("POP");

      const props: Record<string, unknown> = renderedPagesMock.mock.calls.find(
        (call: Array<unknown>): boolean => {
          return call[0] === product.pageModule;
        },
      )![1] as Record<string, unknown>;

      expect(props["pageRoute"]).toBe(RouteMap[product.pageKey]);
      expect(props["hasPaymentMethod"]).toBe(true);
      expect(layoutRendersMock).toHaveBeenCalled();
    });

    test("is not read as the id of a record", () => {
      visit(product, `${base(product)}/settings/number-prefix`);

      const modules: Array<string> = renderedPagesMock.mock.calls.map(
        (call: Array<unknown>): string => {
          return call[0] as string;
        },
      );

      expect(new Set(modules)).toEqual(new Set([product.pageModule]));
    });
  },
);
