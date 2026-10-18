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
import { MOVED_OIDC_SETTINGS_PATH } from "../../../../App/FeatureSet/Dashboard/src/Routes/MovedPagePaths";
import Route from "../../../Types/API/Route";
import { PROJECT_ID, goTo } from "./SideMenuHarness";

/*
 * Project Settings > Security > OIDC folded into SSO: the project's OpenID
 * Connect providers are on the SSO page now, under its SAML providers, with
 * the one test link and the one Require SSO for Login switch. The old
 * address (…/settings/oidc) is bookmarked and linked from wikis, so it
 * forwards to the SSO page. This mounts the REAL Settings route group (every
 * Settings page replaced by a marker, the SSO page by a probe that reports
 * how it was reached) and visits the old address.
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

// Stands where the SSO page is, and reports how it was reached.
const SsoPageProbe: React.FunctionComponent = (): React.ReactElement => {
  const location: Location = useLocation();
  const navigationType: NavigationType = useNavigationType();

  return (
    <div data-testid="sso-page">
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

    if (module === "Settings/SSO") {
      return { __esModule: true, default: SsoPageProbe };
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
  test("found the Settings pages to mock, the SSO page among them, and no OIDC page", () => {
    expect(SETTINGS_PAGE_MODULES).toEqual(
      expect.arrayContaining(["Settings/Layout", "Settings/SSO"]),
    );
    expect(SETTINGS_PAGE_MODULES).not.toContain("Settings/OIDC");
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
          "OIDC.tsx",
        ),
      ),
    ).toBe(false);
  });

  test("the SSO page is where it always was", () => {
    visit(`${SETTINGS}/sso`);

    expect(screen.getByTestId("sso-page")).toBeInTheDocument();
    expect(landedOn()).toBe(`${SETTINGS}/sso`);
    expect(screen.getByTestId("settings-layout")).toBeInTheDocument();
  });
});

describe("the old OIDC address forwards to the SSO page", () => {
  test("is the address the page had", () => {
    expect(MOVED_OIDC_SETTINGS_PATH).toBe("oidc");
  });

  test("…/settings/oidc arrives at …/settings/sso", () => {
    visit(`${SETTINGS}/oidc`);

    expect(screen.getByTestId("sso-page")).toBeInTheDocument();
    expect(landedOn()).toBe(
      RouteMap[PageMap.SETTINGS_SSO]!.toString().replace(
        ":projectId",
        PROJECT_ID,
      ),
    );
  });

  test("replaces the history entry, so Back does not bounce through it", () => {
    visit(`${SETTINGS}/oidc`);

    expect(screen.getByTestId("navigation-type")).toHaveTextContent("REPLACE");
  });

  test("keeps the query string and the hash", () => {
    visit(`${SETTINGS}/oidc?sortBy=name#providers`);

    expect(landedOn()).toBe(`${SETTINGS}/sso?sortBy=name#providers`);
  });

  test("the Settings menu does not flash on the way: the redirect is outside the layout", () => {
    const redirectAt: number = SETTINGS_ROUTES_SOURCE.indexOf(
      "path={MOVED_OIDC_SETTINGS_PATH}",
    );
    const layoutAt: number = SETTINGS_ROUTES_SOURCE.indexOf(
      "element={<SettingsLayout {...props} />}",
    );

    expect(redirectAt).toBeGreaterThan(-1);
    expect(layoutAt).toBeGreaterThan(-1);
    // A sibling of the layout's route, before it - not one of its children.
    expect(redirectAt).toBeLessThan(layoutAt);

    visit(`${SETTINGS}/oidc`);

    // The layout draws once, for the SSO page the address lands on.
    expect(screen.getAllByTestId("settings-layout")).toHaveLength(1);
    expect(screen.getByTestId("sso-page")).toBeInTheDocument();
  });
});

describe("nothing in the Dashboard still links to the old address", () => {
  test("no page key, route or menu item names it", () => {
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
    const pageMap: string = fs.readFileSync(
      path.join(src, "Utils", "PageMap.ts"),
      "utf8",
    );
    const routeMap: string = fs.readFileSync(
      path.join(src, "Utils", "RouteMap.ts"),
      "utf8",
    );
    const sideMenu: string = fs.readFileSync(
      path.join(src, "Pages", "Settings", "SideMenu.tsx"),
      "utf8",
    );

    expect(pageMap).not.toMatch(/SETTINGS_OIDC\b/);
    expect(routeMap).not.toMatch(/SETTINGS_OIDC\b/);
    expect(sideMenu).not.toMatch(/SETTINGS_OIDC\b|title: "OIDC"/);
  });
});
