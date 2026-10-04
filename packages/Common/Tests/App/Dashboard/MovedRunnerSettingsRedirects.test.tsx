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
import { MOVED_RUNNER_SETTINGS_PATHS } from "../../../../App/FeatureSet/Dashboard/src/Routes/MovedPagePaths";
import Route from "../../../Types/API/Route";
import { PROJECT_ID, goTo } from "./SideMenuHarness";

/*
 * The Runner pages moved from Project Settings into Runbooks. People have the
 * old URLs bookmarked and written into wikis, and a Runner image older than
 * the move still prints "Project Settings > Runners" — so the old URLs must
 * keep arriving somewhere. This mounts the REAL Settings route group (every
 * Settings page replaced by a marker) next to a probe standing where Runbooks
 * is, and visits the old URLs.
 */

const DASHBOARD: string = "../../../../App/FeatureSet/Dashboard/src";

const NAMES_A_RUNNER: RegExp = /runner/i;

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

/*
 * Every Settings page the route group imports, read from its source so a page
 * added later is mocked too rather than dragging its whole feature into this
 * suite. Covers the static imports and the lazy import().
 */
const SETTINGS_PAGE_MODULES: Array<string> = Array.from(
  new Set(
    Array.from(
      SETTINGS_ROUTES_SOURCE.matchAll(/"\.\.\/Pages\/(Settings\/[A-Za-z]+)"/g),
    ).map((match: RegExpMatchArray): string => {
      return match[1]!;
    }),
  ),
);

/*
 * Called on every render of the Settings layout. A redirect that sat inside
 * the layout would paint the Settings menu for a frame and then leave — and
 * the DOM after the redirect looks the same either way, so the renders are
 * counted rather than looked for.
 */
const settingsLayoutRenderMock: MockFunction = getJestMockFunction();

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

const RUNNER_ID: string = "5d9e2c11-7a3b-4c1d-9e8f-00000000a0b1";
const SETTINGS: string = `/dashboard/${PROJECT_ID}/settings`;
const RUNBOOKS: string = `/dashboard/${PROJECT_ID}/runbooks`;

// Stands where the Runbooks route group is and reports how it was reached.
const RunbooksProbe: React.FunctionComponent = (): React.ReactElement => {
  const location: Location = useLocation();
  const navigationType: NavigationType = useNavigationType();

  return (
    <div data-testid="runbooks">
      <span data-testid="pathname">{location.pathname}</span>
      <span data-testid="search">{location.search}</span>
      <span data-testid="hash">{location.hash}</span>
      <span data-testid="navigation-type">{navigationType}</span>
    </div>
  );
};

function visit(url: string): void {
  /*
   * RouteUtil fills the project id in from window.location, which a
   * MemoryRouter does not touch — so the address bar is put there too.
   */
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
        <RouterRoute
          path={RouteMap[PageMap.RUNBOOKS_ROOT]!.toString()}
          element={<RunbooksProbe />}
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
  test("found the Settings pages to mock, and none of them is a Runner page", () => {
    expect(SETTINGS_PAGE_MODULES).toEqual(
      expect.arrayContaining([
        "Settings/Layout",
        "Settings/ProjectSettings",
        "Settings/Labels",
        "Settings/DangerZone",
      ]),
    );
    expect(
      SETTINGS_PAGE_MODULES.filter((module: string): boolean => {
        return NAMES_A_RUNNER.test(module);
      }),
    ).toEqual([]);
  });

  test("a Settings page that did not move still renders in Settings", () => {
    visit(`${SETTINGS}/labels`);

    expect(screen.getByTestId("settings-layout")).toBeInTheDocument();
    expect(screen.getByTestId("settings-page")).toHaveTextContent(
      "Settings/Labels",
    );
    expect(screen.queryByTestId("runbooks")).not.toBeInTheDocument();
    // The render counter the redirect tests rely on does count.
    expect(settingsLayoutRenderMock).toHaveBeenCalled();
  });
});

describe("the old Settings URLs forward to Runbooks", () => {
  test.each([
    [`${SETTINGS}/runners`, `${RUNBOOKS}/runners`],
    [`${SETTINGS}/runners/${RUNNER_ID}`, `${RUNBOOKS}/runners/${RUNNER_ID}`],
    [`${SETTINGS}/runner-credentials`, `${RUNBOOKS}/runner-credentials`],
  ])("%s arrives at %s", (oldUrl: string, newUrl: string) => {
    visit(oldUrl);

    expect(screen.getByTestId("runbooks")).toBeInTheDocument();
    expect(landedOn()).toBe(newUrl);
  });

  test("the destinations are the ones the route table gives the Runner pages", () => {
    const destinations: Record<string, string> = {
      [`${SETTINGS}/runners`]: RouteMap[PageMap.RUNBOOKS_RUNNERS]!.toString(),
      [`${SETTINGS}/runners/${RUNNER_ID}`]:
        RouteMap[PageMap.RUNBOOKS_RUNNER_VIEW]!.toString(),
      [`${SETTINGS}/runner-credentials`]:
        RouteMap[PageMap.RUNBOOKS_RUNNER_CREDENTIALS]!.toString(),
    };

    for (const [oldUrl, pattern] of Object.entries(destinations)) {
      visit(oldUrl);
      expect(landedOn()).toBe(
        pattern.replace(":projectId", PROJECT_ID).replace(":id", RUNNER_ID),
      );
      cleanup();
    }
  });

  test("the redirect replaces the history entry, so Back does not bounce", () => {
    visit(`${SETTINGS}/runners`);

    expect(screen.getByTestId("navigation-type")).toHaveTextContent("REPLACE");
  });

  test("the Settings layout never renders on the way", () => {
    for (const oldUrl of [
      `${SETTINGS}/runners`,
      `${SETTINGS}/runners/${RUNNER_ID}`,
      `${SETTINGS}/runner-credentials`,
    ]) {
      visit(oldUrl);
      expect(settingsLayoutRenderMock).not.toHaveBeenCalled();
      expect(screen.queryByTestId("settings-layout")).not.toBeInTheDocument();
      expect(screen.queryByTestId("settings-page")).not.toBeInTheDocument();
      cleanup();
    }
  });

  test.each([
    [
      `${SETTINGS}/runners?sortBy=lastAlive&sortOrder=DESC`,
      `${RUNBOOKS}/runners?sortBy=lastAlive&sortOrder=DESC`,
    ],
    [
      `${SETTINGS}/runners/${RUNNER_ID}#owners`,
      `${RUNBOOKS}/runners/${RUNNER_ID}#owners`,
    ],
    [
      `${SETTINGS}/runner-credentials?filter=ssh#top`,
      `${RUNBOOKS}/runner-credentials?filter=ssh#top`,
    ],
  ])("%s keeps its query string and hash", (oldUrl: string, newUrl: string) => {
    visit(oldUrl);

    expect(landedOn()).toBe(newUrl);
  });

  test("each Runner keeps its own id", () => {
    const otherRunnerId: string = "0a1b2c3d-4e5f-4a6b-8c7d-00000000e0f3";

    visit(`${SETTINGS}/runners/${otherRunnerId}`);

    expect(landedOn()).toBe(`${RUNBOOKS}/runners/${otherRunnerId}`);
  });

  test("the old URLs match in any case, as every dashboard route does", () => {
    visit(`${SETTINGS}/Runners`);

    expect(landedOn()).toBe(`${RUNBOOKS}/runners`);
  });

  test("the project in the URL is the project it forwards within", () => {
    const otherProjectId: string = "1c2d3e4f-5a6b-4c7d-8e9f-0a1b2c3d4e5f";

    visit(`/dashboard/${otherProjectId}/settings/runners/${RUNNER_ID}`);

    expect(landedOn()).toBe(
      `/dashboard/${otherProjectId}/runbooks/runners/${RUNNER_ID}`,
    );
  });

  test("a URL that never existed is not forwarded", () => {
    visit(`${SETTINGS}/runners/${RUNNER_ID}/anything`);

    expect(screen.queryByTestId("runbooks")).not.toBeInTheDocument();
  });
});

describe("the forwarding table", () => {
  test("covers exactly the three URLs the Runner pages used to have", () => {
    expect(MOVED_RUNNER_SETTINGS_PATHS).toEqual({
      runners: "runners",
      runnerView: "runners/:id",
      runnerCredentials: "runner-credentials",
    });
  });

  test("each old path is the new page's path, one product over", () => {
    /*
     * The move changed the product segment and nothing else. If a Runner page
     * is renamed later this fails, which is the prompt to decide whether the
     * old Settings URL should follow it.
     */
    const moved: Array<[keyof typeof MOVED_RUNNER_SETTINGS_PATHS, string]> = [
      ["runners", PageMap.RUNBOOKS_RUNNERS],
      ["runnerView", PageMap.RUNBOOKS_RUNNER_VIEW],
      ["runnerCredentials", PageMap.RUNBOOKS_RUNNER_CREDENTIALS],
    ];

    for (const [name, page] of moved) {
      expect(
        `/dashboard/:projectId/runbooks/${MOVED_RUNNER_SETTINGS_PATHS[name]}`,
      ).toBe(RouteMap[page]!.toString());
    }
  });
});
