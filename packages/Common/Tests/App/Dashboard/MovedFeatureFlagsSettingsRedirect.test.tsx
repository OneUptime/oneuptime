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
import { MOVED_FEATURE_FLAGS_SETTINGS_PATH } from "../../../../App/FeatureSet/Dashboard/src/Routes/MovedPagePaths";
import Route from "../../../Types/API/Route";
import { PROJECT_ID, goTo } from "./SideMenuHarness";

/*
 * Project Settings > Advanced > Feature Flags held one switch, Monitor
 * Groups, which decides what the Monitors menu shows. It is a row of
 * Project Settings > Products now, under Monitors, beside the switches that
 * choose what every other menu shows (#7324), and Feature Flags is gone. The
 * old address (…/settings/feature-flags) is bookmarked and linked from
 * wikis and older docs, so it forwards to Products. This mounts the REAL
 * Settings route group (every Settings page replaced by a marker, Products
 * by a probe that reports how it was reached) and visits the old address.
 */

const DASHBOARD: string = "../../../../App/FeatureSet/Dashboard/src";

const SETTINGS_ROUTES_SOURCE: string = fs.readFileSync(
  path.join(
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
    "SettingsRoutes.tsx",
  ),
  "utf8",
);

// Every Settings page the route group imports, read from its source.
const SETTINGS_PAGE_MODULES: Array<string> = Array.from(
  new Set(
    Array.from(
      SETTINGS_ROUTES_SOURCE.matchAll(/"\.\.\/Pages\/(Settings\/[A-Za-z]+)"/g),
    ).map((match: RegExpMatchArray): string => {
      return match[1]!;
    }),
  ),
);

const settingsLayoutRenderMock: MockFunction = getJestMockFunction();

// Stands where Products is, and reports how it was reached.
const ProductsPageProbe: React.FunctionComponent = (): React.ReactElement => {
  const location: Location = useLocation();
  const navigationType: NavigationType = useNavigationType();

  return (
    <div data-testid="products-page">
      <span data-testid="pathname">{location.pathname}</span>
      <span data-testid="search">{location.search}</span>
      <span data-testid="hash">{location.hash}</span>
      <span data-testid="navigation-type">{navigationType}</span>
    </div>
  );
};

for (const module of SETTINGS_PAGE_MODULES) {
  jest.doMock(`${DASHBOARD}/Pages/${module}`, () => {
    if (module === "Settings/Layout") {
      return {
        __esModule: true,
        default: (): React.ReactElement => {
          settingsLayoutRenderMock();
          const { Outlet } = jest.requireActual("react-router-dom") as {
            Outlet: React.ComponentType;
          };
          return (
            <div data-testid="settings-layout">
              <Outlet />
            </div>
          );
        },
      };
    }

    if (module === "Settings/Products") {
      return { __esModule: true, default: ProductsPageProbe };
    }

    return {
      __esModule: true,
      default: (): React.ReactElement => {
        return <div data-testid="settings-page">{module}</div>;
      },
    };
  });
}

// Required after the mocks above, which jest.doMock does not hoist.
const settingsRoutesModule: {
  default: React.FunctionComponent<Record<string, unknown>>;
} = jest.requireActual(`${DASHBOARD}/Routes/SettingsRoutes`) as {
  default: React.FunctionComponent<Record<string, unknown>>;
};

const SettingsRoutes: React.FunctionComponent<Record<string, unknown>> =
  settingsRoutesModule.default;

const SETTINGS: string = `/dashboard/${PROJECT_ID}/settings`;

function visit(url: string): void {
  goTo(url.split(/[?#]/)[0]!);

  render(
    <MemoryRouter initialEntries={[url]}>
      <Routes>
        <RouterRoute
          path={RouteMap[PageMap.SETTINGS_ROOT]!.toString()}
          element={
            <SettingsRoutes
              pageRoute={new Route(SETTINGS)}
              currentProject={null}
              hasPaymentMethod={true}
              onProjectDeleted={() => {}}
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
  settingsLayoutRenderMock.mockReset();
  goTo(`/dashboard/${PROJECT_ID}`);
});

afterEach(() => {
  cleanup();
});

describe("the suite's own scaffolding", () => {
  test("found the Settings pages to mock, Products among them, and no Feature Flags page", () => {
    expect(SETTINGS_PAGE_MODULES).toEqual(
      expect.arrayContaining(["Settings/Layout", "Settings/Products"]),
    );
    expect(SETTINGS_PAGE_MODULES).not.toContain("Settings/FeatureFlags");
    expect(
      fs.existsSync(
        path.join(
          __dirname,
          "..",
          "..",
          "..",
          "..",
          "App",
          "FeatureSet",
          "Dashboard",
          "src",
          "Pages",
          "Settings",
          "FeatureFlags.tsx",
        ),
      ),
    ).toBe(false);
  });

  test("Products is where it always was", () => {
    visit(`${SETTINGS}/products`);

    expect(screen.getByTestId("products-page")).toBeInTheDocument();
    expect(landedOn()).toBe(`${SETTINGS}/products`);
    expect(screen.getByTestId("settings-layout")).toBeInTheDocument();
  });
});

describe("the old Feature Flags address forwards to Products", () => {
  test("is the address the page had", () => {
    expect(MOVED_FEATURE_FLAGS_SETTINGS_PATH).toBe("feature-flags");
  });

  test("…/settings/feature-flags arrives at …/settings/products", () => {
    visit(`${SETTINGS}/feature-flags`);

    expect(screen.getByTestId("products-page")).toBeInTheDocument();
    expect(landedOn()).toBe(
      RouteMap[PageMap.SETTINGS_PRODUCTS]!.toString().replace(
        ":projectId",
        PROJECT_ID,
      ),
    );
  });

  test("replaces the history entry, so Back does not bounce through it", () => {
    visit(`${SETTINGS}/feature-flags`);

    expect(screen.getByTestId("navigation-type")).toHaveTextContent("REPLACE");
  });

  test("keeps the query string and the hash", () => {
    visit(`${SETTINGS}/feature-flags?from=wiki#monitors`);

    expect(landedOn()).toBe(`${SETTINGS}/products?from=wiki#monitors`);
  });

  test("the Settings menu does not flash on the way: the redirect is outside the layout", () => {
    const redirectAt: number = SETTINGS_ROUTES_SOURCE.indexOf(
      "path={MOVED_FEATURE_FLAGS_SETTINGS_PATH}",
    );
    const layoutAt: number = SETTINGS_ROUTES_SOURCE.indexOf(
      "element={<SettingsLayout {...props} />}",
    );

    expect(redirectAt).toBeGreaterThan(-1);
    expect(layoutAt).toBeGreaterThan(-1);
    // A sibling of the layout's route, before it - not one of its children.
    expect(redirectAt).toBeLessThan(layoutAt);

    visit(`${SETTINGS}/feature-flags`);

    // The layout draws once, for Products, where the address lands.
    expect(screen.getAllByTestId("settings-layout")).toHaveLength(1);
    expect(screen.getByTestId("products-page")).toBeInTheDocument();
  });
});

describe("nothing in the Dashboard still links to the old address", () => {
  test("no page key, route, breadcrumb or menu item names it", () => {
    const src: string = path.join(
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
    const read: (file: string) => string = (file: string): string => {
      return fs.readFileSync(path.join(src, file), "utf8");
    };

    expect(read("Utils/PageMap.ts")).not.toMatch(/SETTINGS_FEATURE_FLAGS\b/);
    expect(read("Utils/RouteMap.ts")).not.toMatch(
      /SETTINGS_FEATURE_FLAGS\b|"feature-flags"/,
    );
    expect(read("Utils/Breadcrumbs/SettingsBreadcrumbs.ts")).not.toContain(
      "Feature Flags",
    );
    expect(read("Pages/Settings/SideMenu.tsx")).not.toMatch(
      /SETTINGS_FEATURE_FLAGS\b|title: "Feature Flags"/,
    );
  });
});
