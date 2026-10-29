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
  Params,
  Route as RouterRoute,
  Routes,
  matchPath,
  useLocation,
  useNavigationType,
  useParams,
} from "react-router-dom";
import PageMap from "../../../../App/FeatureSet/Dashboard/src/Utils/PageMap";
import RouteMap from "../../../../App/FeatureSet/Dashboard/src/Utils/RouteMap";
import { MOVED_USERS_SETTINGS_PATHS } from "../../../../App/FeatureSet/Dashboard/src/Routes/MovedPagePaths";
import DatabaseConfig from "../../../Server/DatabaseConfig";
import UserService from "../../../Server/Services/UserService";
import Route from "../../../Types/API/Route";
import URL from "../../../Types/API/URL";
import ObjectID from "../../../Types/ObjectID";
import { PROJECT_ID, goTo } from "./SideMenuHarness";

/*
 * A PERSON'S NAME IN A FEED ENTRY, A SLACK OR TEAMS MESSAGE OR AN EMAIL
 * OPENS THAT PERSON.
 *
 * Every person OneUptime names in them is a link to their page in the
 * project (UserService.getUserLinkInDashboard). It pointed at
 * …/settings/users/<id>, where no page has been since Users left Project
 * Settings: Settings had no page there and drew nothing, so the link opened
 * a blank page under the header. Now:
 *
 *   - the server links to Users > the person (…/users/<id>), the page the
 *     Dashboard's RouteMap has for them;
 *   - the old address - years of stored entries and posted messages carry
 *     it - forwards there, keeping the person;
 *   - any other address Settings has no page for says "Page not found".
 *
 * This mounts the REAL Users and Settings route groups (their pages
 * replaced by probes that say where they were reached) and visits the link
 * the server builds, the old one, and an unknown one.
 */

const DASHBOARD: string = "../../../../App/FeatureSet/Dashboard/src";
const DASHBOARD_DIR: string = path.join(
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

const USER_ID: string = "8f2a1b3c-4d5e-4f60-9a7b-000000000777";
const SERVER_DASHBOARD_URL: string = "https://oneuptime.example/dashboard";

const readRoutes: (file: string) => string = (file: string): string => {
  return fs.readFileSync(path.join(DASHBOARD_DIR, "Routes", file), "utf8");
};

const USERS_ROUTES_SOURCE: string = readRoutes("UsersRoutes.tsx");
const SETTINGS_ROUTES_SOURCE: string = readRoutes("SettingsRoutes.tsx");

const PAGE_MODULE: RegExp = /"\.\.\/Pages\/((?:Users|Settings)\/[A-Za-z/]+)"/g;

// Every Users and Settings page the two route groups import, from their source.
const PAGE_MODULES: Array<string> = Array.from(
  new Set(
    [USERS_ROUTES_SOURCE, SETTINGS_ROUTES_SOURCE].flatMap(
      (source: string): Array<string> => {
        return Array.from(source.matchAll(PAGE_MODULE)).map(
          (match: RegExpMatchArray): string => {
            return match[1]!;
          },
        );
      },
    ),
  ),
);

const LAYOUTS: Array<string> = [
  "Users/Layout",
  "Users/View/Layout",
  "Users/View/OnCall/Layout",
  "Settings/Layout",
];

// Says which page it is, where it was reached, and how.
const PageProbe: React.FunctionComponent<{ module: string }> = (props: {
  module: string;
}): React.ReactElement => {
  const location: Location = useLocation();
  const params: Readonly<Params<string>> = useParams();
  const navigationType: NavigationType = useNavigationType();

  return (
    <div data-testid="page">
      <span data-testid="module">{props.module}</span>
      <span data-testid="pathname">{location.pathname}</span>
      <span data-testid="search">{location.search}</span>
      <span data-testid="hash">{location.hash}</span>
      <span data-testid="model-id">{params["id"] || ""}</span>
      <span data-testid="navigation-type">{navigationType}</span>
    </div>
  );
};

for (const module of PAGE_MODULES) {
  jest.doMock(`${DASHBOARD}/Pages/${module}`, () => {
    if (LAYOUTS.includes(module)) {
      return {
        __esModule: true,
        default: (): React.ReactElement => {
          const { Outlet } = jest.requireActual("react-router-dom") as {
            Outlet: React.ComponentType;
          };

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
      default: (): React.ReactElement => {
        return <PageProbe module={module} />;
      },
    };
  });
}

// Required after the mocks above, which jest.doMock does not hoist.
const UsersRoutes: React.FunctionComponent<Record<string, unknown>> = (
  jest.requireActual(`${DASHBOARD}/Routes/UsersRoutes`) as {
    default: React.FunctionComponent<Record<string, unknown>>;
  }
).default;
const SettingsRoutes: React.FunctionComponent<Record<string, unknown>> = (
  jest.requireActual(`${DASHBOARD}/Routes/SettingsRoutes`) as {
    default: React.FunctionComponent<Record<string, unknown>>;
  }
).default;

const PAGE_PROPS: Record<string, unknown> = {
  pageRoute: new Route(`/dashboard/${PROJECT_ID}`),
  currentProject: null,
  hasPaymentMethod: true,
  onProjectDeleted: () => {},
};

// The Dashboard's Users and Settings route groups, mounted as App mounts them.
function visit(url: string): void {
  goTo(url.split(/[?#]/)[0]!);

  render(
    <MemoryRouter initialEntries={[url]}>
      <Routes>
        <RouterRoute
          path={RouteMap[PageMap.USERS_ROOT]!.toString()}
          element={<UsersRoutes {...PAGE_PROPS} />}
        />
        <RouterRoute
          path={RouteMap[PageMap.SETTINGS_ROOT]!.toString()}
          element={<SettingsRoutes {...PAGE_PROPS} />}
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

const PERSON_PAGE: string = `/dashboard/${PROJECT_ID}/users/${USER_ID}`;
const SETTINGS: string = `/dashboard/${PROJECT_ID}/settings`;

beforeEach(() => {
  goTo(`/dashboard/${PROJECT_ID}`);
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

describe("the suite's own scaffolding", () => {
  test("found the pages to stand in for: Users, a person's page and Settings", () => {
    expect(PAGE_MODULES).toEqual(
      expect.arrayContaining([
        "Users/Index",
        "Users/View/Index",
        "Users/View/Teams",
        "Settings/Layout",
        "Settings/SSO",
      ]),
    );
  });
});

describe("the link the server writes for a person", () => {
  const serverLink: () => Promise<string> = async (): Promise<string> => {
    jest
      .spyOn(DatabaseConfig, "getDashboardUrl")
      .mockResolvedValue(URL.fromString(SERVER_DASHBOARD_URL));

    return (
      await UserService.getUserLinkInDashboard(
        new ObjectID(PROJECT_ID),
        new ObjectID(USER_ID),
      )
    ).toString();
  };

  test("is the person's page in the project: Users, then them", async () => {
    expect(await serverLink()).toBe(
      `${SERVER_DASHBOARD_URL}/${PROJECT_ID}/users/${USER_ID}`,
    );
  });

  test("is the address the Dashboard's RouteMap has for that page, with the person's id", async () => {
    const pathname: string = new globalThis.URL(await serverLink()).pathname;

    const match: ReturnType<typeof matchPath> = matchPath(
      { path: RouteMap[PageMap.USER_VIEW]!.toString(), end: true },
      pathname,
    );

    expect(match).not.toBeNull();
    expect(match!.params["projectId"]).toBe(PROJECT_ID);
    expect(match!.params["id"]).toBe(USER_ID);
  });

  test("opens the person's page, with them on it", async () => {
    visit(new globalThis.URL(await serverLink()).pathname);

    expect(screen.getByTestId("module")).toHaveTextContent("Users/View/Index");
    expect(screen.getByTestId("model-id")).toHaveTextContent(USER_ID);
    expect(screen.getByTestId("layout:Users/View/Layout")).toBeInTheDocument();
  });

  test("never names Settings", async () => {
    expect(new globalThis.URL(await serverLink()).pathname).not.toContain(
      "/settings/",
    );
  });
});

describe("the old address every link already written carries", () => {
  test("is the one Settings used to have", () => {
    expect(MOVED_USERS_SETTINGS_PATHS).toEqual({
      users: "users",
      userView: "users/:id",
      userViewPage: "users/:id/*",
    });
  });

  test("…/settings/users/<id> opens the person's page", () => {
    visit(`${SETTINGS}/users/${USER_ID}`);

    expect(screen.getByTestId("module")).toHaveTextContent("Users/View/Index");
    expect(screen.getByTestId("model-id")).toHaveTextContent(USER_ID);
    expect(landedOn()).toBe(PERSON_PAGE);
  });

  test("replaces the history entry, so Back does not bounce through it", () => {
    visit(`${SETTINGS}/users/${USER_ID}`);

    expect(screen.getByTestId("navigation-type")).toHaveTextContent("REPLACE");
  });

  test("keeps the query string and the hash", () => {
    visit(`${SETTINGS}/users/${USER_ID}?from=slack#teams`);

    expect(landedOn()).toBe(`${PERSON_PAGE}?from=slack#teams`);
  });

  test("a page under the old one opens the person too", () => {
    visit(`${SETTINGS}/users/${USER_ID}/teams`);

    expect(screen.getByTestId("module")).toHaveTextContent("Users/View/Index");
    expect(landedOn()).toBe(PERSON_PAGE);
  });

  test("…/settings/users opens Users", () => {
    visit(`${SETTINGS}/users`);

    expect(screen.getByTestId("module")).toHaveTextContent("Users/Index");
    expect(landedOn()).toBe(`/dashboard/${PROJECT_ID}/users`);
  });

  test("the Settings menu does not flash on the way: the forwards are outside its layout", () => {
    const layoutAt: number = SETTINGS_ROUTES_SOURCE.indexOf(
      "element={<SettingsLayout {...props} />}",
    );

    expect(layoutAt).toBeGreaterThan(-1);

    for (const key of ["users", "userView", "userViewPage"]) {
      const forwardAt: number = SETTINGS_ROUTES_SOURCE.indexOf(
        `path={MOVED_USERS_SETTINGS_PATHS.${key}}`,
      );

      expect({ key, forwardAt: forwardAt > -1 }).toEqual({
        key,
        forwardAt: true,
      });
      expect({ key, beforeLayout: forwardAt < layoutAt }).toEqual({
        key,
        beforeLayout: true,
      });
    }

    visit(`${SETTINGS}/users/${USER_ID}`);

    expect(screen.queryByTestId("layout:Settings/Layout")).toBeNull();
  });
});

describe("an address Settings has no page for", () => {
  test.each([
    `${SETTINGS}/no-such-page`,
    `${SETTINGS}/teams/${USER_ID}`,
    `${SETTINGS}/danger-zone/extra`,
  ])("%s says the page was not found, never a blank page", (url: string) => {
    visit(url);

    expect(screen.getByText("Page not found")).toBeInTheDocument();
    expect(screen.queryByTestId("page")).toBeNull();
  });

  test("a page Settings has is still that page, its menu around it", () => {
    visit(`${SETTINGS}/sso`);

    expect(screen.getByTestId("module")).toHaveTextContent("Settings/SSO");
    expect(screen.getByTestId("layout:Settings/Layout")).toBeInTheDocument();
    expect(screen.queryByText("Page not found")).toBeNull();
  });

  test("Settings itself is still its overview", () => {
    visit(`${SETTINGS}/`);

    expect(screen.getByTestId("module")).toHaveTextContent(
      "Settings/ProjectSettings",
    );
    expect(screen.queryByText("Page not found")).toBeNull();
  });
});
