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
import { MOVED_AI_SECTION_PATHS } from "../../../../App/FeatureSet/Dashboard/src/Routes/MovedPagePaths";
import Route from "../../../Types/API/Route";
import { PROJECT_ID, goTo } from "./SideMenuHarness";

/*
 * The AI settings page and the Auto Remediation Rules moved out of the
 * Settings and Rules sections of the Incidents and Alerts menus into an AI
 * section of their own, and their URLs moved with them: …/settings/ai is
 * …/ai/settings now, and …/settings/auto-remediation-rules was
 * …/ai/auto-remediation-rules. Then the rules folded into the AI settings
 * page itself, under More settings, next to the investigation rules - so
 * both of the rules' addresses arrive at …/ai/settings. The old URLs are in
 * bookmarks, in emails, in older docs and in messages the server wrote
 * before the move, so they must keep arriving at the page that has them.
 *
 * This mounts the REAL Incidents and Alerts route groups, every page of them
 * replaced by a marker that names it, and visits the old URLs.
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
  aiSettings: PageMap;
  // The page module the AI settings page renders, as the route group imports it.
  aiSettingsModule: string;
  // The rules page module that is gone: no route group may import it.
  retiredRulesModule: string;
}

const PRODUCTS: Array<Product> = [
  {
    name: "Incidents",
    routesModule: "Routes/IncidentsRoutes",
    pagesDirectory: "Incidents",
    segment: "incidents",
    root: PageMap.INCIDENTS_ROOT,
    aiSettings: PageMap.INCIDENTS_SETTINGS_AI,
    aiSettingsModule: "Incidents/Settings/IncidentAISettings",
    retiredRulesModule: "Incidents/Settings/IncidentAutoRemediationRules",
  },
  {
    name: "Alerts",
    routesModule: "Routes/AlertRoutes",
    pagesDirectory: "Alerts",
    segment: "alerts",
    root: PageMap.ALERTS_ROOT,
    aiSettings: PageMap.ALERTS_SETTINGS_AI,
    aiSettingsModule: "Alerts/Settings/AlertAISettings",
    retiredRulesModule: "Alerts/Settings/AlertAutoRemediationRules",
  },
];

/*
 * Every page module a route group imports, read from its source so a page
 * added later is mocked too rather than dragging its whole feature into this
 * suite.
 */
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

/*
 * Called on every render of a product's layout. The redirects sit outside the
 * layout, so the layout draws exactly as often as it does for a direct visit
 * to the new address: the menu never flashes on the way.
 */
const layoutRenderMock: MockFunction = getJestMockFunction();

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

for (const product of PRODUCTS) {
  for (const module of pageModulesOf(product)) {
    jest.doMock(`${DASHBOARD}/Pages/${module}`, () => {
      if (module === `${product.pagesDirectory}/Layout`) {
        return {
          __esModule: true,
          default: (): React.ReactElement => {
            layoutRenderMock(product.name);
            const { Outlet } = jest.requireActual("react-router-dom") as {
              Outlet: React.ComponentType;
            };
            return (
              <div data-testid="layout">
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

// Required after the mocks above, which jest.doMock does not hoist.
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

function base(product: Product, projectId: string = PROJECT_ID): string {
  return `/dashboard/${projectId}/${product.segment}`;
}

function visit(product: Product, url: string): void {
  /*
   * RouteUtil fills the project id in from window.location, which a
   * MemoryRouter does not touch, so the address bar is put there too.
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

describe("the forwarding table", () => {
  test("names the three addresses the moved pages had, relative to the product", () => {
    expect(MOVED_AI_SECTION_PATHS).toEqual({
      aiSettings: "settings/ai",
      autoRemediationRules: "settings/auto-remediation-rules",
      aiAutoRemediationRules: "ai/auto-remediation-rules",
    });
  });

  test.each(PRODUCTS)(
    "no $name page is at an old address any more: the AI settings are under ai/",
    (product: Product) => {
      expect(RouteMap[product.aiSettings]!.toString()).toBe(
        `/dashboard/:projectId/${product.segment}/ai/settings`,
      );

      const oldAddresses: Array<string> = Object.values(
        MOVED_AI_SECTION_PATHS,
      ).map((oldPath: string): string => {
        return `/dashboard/:projectId/${product.segment}/${oldPath}`;
      });

      for (const route of Object.values(RouteMap)) {
        expect(oldAddresses).not.toContain(route.toString());
      }
    },
  );

  test.each(PRODUCTS)(
    "the $name route group mounts every forward, outside its layout",
    (product: Product) => {
      const source: string = fs.readFileSync(
        path.join(DASHBOARD_SRC, `${product.routesModule}.tsx`),
        "utf8",
      );
      const layoutAt: number = source.indexOf('path="/"');

      for (const key of [
        "aiSettings",
        "autoRemediationRules",
        "aiAutoRemediationRules",
      ]) {
        const at: number = source.indexOf(`MOVED_AI_SECTION_PATHS.${key}`);

        expect({ key, mounted: at > -1 }).toEqual({ key, mounted: true });
        expect({ key, beforeLayout: at < layoutAt }).toEqual({
          key,
          beforeLayout: true,
        });
      }
    },
  );
});

describe.each(PRODUCTS)("the old $name URLs", (product: Product) => {
  test("the scaffolding found the route group's pages: the AI settings, and no rules page", () => {
    expect(pageModulesOf(product)).toEqual(
      expect.arrayContaining([
        `${product.pagesDirectory}/Layout`,
        product.aiSettingsModule,
      ]),
    );
    expect(pageModulesOf(product)).not.toContain(product.retiredRulesModule);
    expect(
      fs.existsSync(
        path.join(DASHBOARD_SRC, "Pages", `${product.retiredRulesModule}.tsx`),
      ),
    ).toBe(false);
  });

  test.each([
    ["settings/ai", "ai/settings"],
    ["settings/auto-remediation-rules", "ai/settings"],
    ["ai/auto-remediation-rules", "ai/settings"],
  ])(
    "…/%s arrives at …/%s, the page that has its settings",
    (oldPath: string, newPath: string) => {
      visit(product, `${base(product)}/${oldPath}`);

      expect(landedOn()).toBe(`${base(product)}/${newPath}`);
      expect(screen.getByTestId("page")).toHaveTextContent(
        product.aiSettingsModule,
      );
    },
  );

  test("the new address opens the AI settings directly", () => {
    visit(product, `${base(product)}/ai/settings`);
    expect(screen.getByTestId("page")).toHaveTextContent(
      product.aiSettingsModule,
    );
  });

  test("the rules' forwards replace the history entry too", () => {
    visit(product, `${base(product)}/ai/auto-remediation-rules`);

    expect(screen.getByTestId("navigation-type")).toHaveTextContent("REPLACE");
  });

  test("the forward replaces the history entry, so Back does not bounce", () => {
    visit(product, `${base(product)}/settings/ai`);

    expect(screen.getByTestId("navigation-type")).toHaveTextContent("REPLACE");
  });

  test("the menu draws no more often than for a direct visit", () => {
    visit(product, `${base(product)}/ai/settings`);
    const direct: number = layoutRenderMock.mock.calls.length;
    cleanup();
    layoutRenderMock.mockReset();

    visit(product, `${base(product)}/settings/ai`);

    expect(direct).toBeGreaterThan(0);
    expect(layoutRenderMock.mock.calls.length).toBe(direct);
  });

  test.each([
    ["settings/ai?tab=advanced#limits", "ai/settings?tab=advanced#limits"],
    [
      "settings/auto-remediation-rules?sortBy=name&sortOrder=ASC",
      "ai/settings?sortBy=name&sortOrder=ASC",
    ],
    [
      "ai/auto-remediation-rules?sortBy=name#rules",
      "ai/settings?sortBy=name#rules",
    ],
  ])(
    "…/%s keeps its query string and hash",
    (oldPath: string, newPath: string) => {
      visit(product, `${base(product)}/${oldPath}`);

      expect(landedOn()).toBe(`${base(product)}/${newPath}`);
    },
  );

  test("the project in the URL is the project it forwards within", () => {
    const otherProjectId: string = "1c2d3e4f-5a6b-4c7d-8e9f-0a1b2c3d4e5f";

    visit(product, `${base(product, otherProjectId)}/settings/ai`);

    expect(landedOn()).toBe(`${base(product, otherProjectId)}/ai/settings`);
  });

  test("a URL under the old ones that never existed is not forwarded", () => {
    visit(product, `${base(product)}/settings/ai/anything`);

    expect(
      screen.queryByText(product.aiSettingsModule),
    ).not.toBeInTheDocument();
  });
});
