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
import { ReactElement } from "react";
import { MemoryRouter, Route as RouterRoute, Routes } from "react-router-dom";

/*
 * A team had a Block Permissions page (…/teams/:id/block-permissions) beside
 * its Permissions page. Block permissions are on the Permissions page now
 * (…/teams/:id/permissions), folded under Advanced at the bottom. The old
 * URL stays, so a bookmark or a link in a wiki still arrives somewhere: it
 * forwards to that page.
 *
 * This mounts the REAL team route group, with the layout and the pages that
 * matter here replaced by recorders, and visits the old URL.
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
      getItem: () => {
        return Promise.resolve(null);
      },
    },
  };
});

jest.mock("../../../UI/Utils/ModelListCache", () => {
  return {
    __esModule: true,
    default: {
      getList: () => {
        return Promise.resolve({ data: [], count: 0, skip: 0, limit: 0 });
      },
    },
  };
});

jest.mock("../../../UI/Utils/Analytics", () => {
  return { __esModule: true, default: { capture: jest.fn() } };
});

type MockPageProps = { pageRoute?: { toString: () => string } | undefined };

// A page that says which it is, where it was reached, and how.
function mockPage(name: string): {
  __esModule: boolean;
  default: (props: MockPageProps) => ReactElement;
} {
  return {
    __esModule: true,
    default: (props: MockPageProps): ReactElement => {
      const router: typeof import("react-router-dom") = jest.requireActual(
        "react-router-dom",
      ) as typeof import("react-router-dom");
      const location: ReturnType<typeof router.useLocation> =
        router.useLocation();
      const navigationType: string = router.useNavigationType();

      return (
        <div
          data-testid="page"
          data-page={name}
          data-page-route={props.pageRoute?.toString() || ""}
        >
          <span data-testid="pathname">{location.pathname}</span>
          <span data-testid="search">{location.search}</span>
          <span data-testid="hash">{location.hash}</span>
          <span data-testid="navigation-type">{navigationType}</span>
        </div>
      );
    },
  };
}

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Pages/Teams/View/Layout",
  () => {
    return {
      __esModule: true,
      default: (): ReactElement => {
        const router: typeof import("react-router-dom") = jest.requireActual(
          "react-router-dom",
        ) as typeof import("react-router-dom");

        return (
          <div data-testid="layout" data-layout="team-view">
            <router.Outlet />
          </div>
        );
      },
    };
  },
);
jest.mock("../../../../App/FeatureSet/Dashboard/src/Pages/Teams/Layout", () => {
  return {
    __esModule: true,
    default: (): ReactElement => {
      const router: typeof import("react-router-dom") = jest.requireActual(
        "react-router-dom",
      ) as typeof import("react-router-dom");

      return (
        <div data-testid="layout" data-layout="teams">
          <router.Outlet />
        </div>
      );
    },
  };
});
jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Pages/Teams/View/Permissions",
  () => {
    return mockPage("Permissions");
  },
);
jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Pages/Teams/View/Members",
  () => {
    return mockPage("Members");
  },
);
jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Pages/Teams/View/Index",
  () => {
    return mockPage("TeamView");
  },
);
jest.mock("../../../../App/FeatureSet/Dashboard/src/Pages/Teams/Index", () => {
  return mockPage("Teams");
});

import PageComponentProps from "../../../../App/FeatureSet/Dashboard/src/Pages/PageComponentProps";
import TeamsRoutes, {
  MOVED_TEAM_BLOCK_PERMISSIONS_PATH,
} from "../../../../App/FeatureSet/Dashboard/src/Routes/TeamsRoutes";
import PageMap from "../../../../App/FeatureSet/Dashboard/src/Utils/PageMap";
import RouteMap, {
  RouteUtil,
  TeamsRoutePath,
} from "../../../../App/FeatureSet/Dashboard/src/Utils/RouteMap";
import Route from "../../../Types/API/Route";
import { PROJECT_ID, goTo } from "./SideMenuHarness";

const TEAM_ID: string = "7a1d2c3b-4a5f-4e6d-8c7b-9a0f1e2d3c4b";
const BASE: string = `/dashboard/${PROJECT_ID}/teams`;

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

const PAGE_PROPS: PageComponentProps = {
  pageRoute: new Route(`/dashboard/${PROJECT_ID}/home`),
  currentProject: null,
  hasPaymentMethod: true,
} as unknown as PageComponentProps;

function visit(url: string): void {
  // RouteUtil reads the project id from window.location.
  goTo(url.split(/[?#]/)[0]!);

  render(
    <MemoryRouter initialEntries={[url]}>
      <Routes>
        <RouterRoute
          path={RouteUtil.getRouteString(PageMap.TEAMS_ROOT)}
          element={<TeamsRoutes {...PAGE_PROPS} />}
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

function pageName(): string | null {
  const pages: Array<HTMLElement> = screen.queryAllByTestId("page");

  expect(pages).toHaveLength(1);

  return pages[0]!.getAttribute("data-page");
}

beforeEach(() => {
  goTo(`/dashboard/${PROJECT_ID}`);
});

afterEach(() => {
  cleanup();
});

describe("the old Block Permissions URL", () => {
  test("arrives at the team's Permissions page", () => {
    visit(`${BASE}/${TEAM_ID}/block-permissions`);

    expect(pageName()).toBe("Permissions");
    expect(landedOn()).toBe(`${BASE}/${TEAM_ID}/permissions`);
    // Inside the team's own layout, drawn once.
    expect(
      screen.getAllByTestId("layout").map((element: HTMLElement) => {
        return element.getAttribute("data-layout");
      }),
    ).toEqual(["team-view"]);
  });

  test("lands where the route table puts the page", () => {
    visit(`${BASE}/${TEAM_ID}/block-permissions`);

    expect(landedOn()).toBe(
      RouteMap[PageMap.TEAM_VIEW_PERMISSIONS]!.toString()
        .replace(":projectId", PROJECT_ID)
        .replace(":id", TEAM_ID),
    );
    expect(screen.getByTestId("page")).toHaveAttribute(
      "data-page-route",
      RouteMap[PageMap.TEAM_VIEW_PERMISSIONS]!.toString(),
    );
  });

  test("keeps the team it was for", () => {
    const otherTeamId: string = "0a1b2c3d-4e5f-4a6b-8c7d-00000000e0f3";

    visit(`${BASE}/${otherTeamId}/block-permissions`);

    expect(landedOn()).toBe(`${BASE}/${otherTeamId}/permissions`);
  });

  test("keeps its query string and hash", () => {
    visit(`${BASE}/${TEAM_ID}/block-permissions?from=wiki#mcp`);

    expect(landedOn()).toBe(`${BASE}/${TEAM_ID}/permissions?from=wiki#mcp`);
  });

  test("replaces the history entry, so Back does not bounce", () => {
    visit(`${BASE}/${TEAM_ID}/block-permissions`);

    expect(screen.getByTestId("navigation-type")).toHaveTextContent("REPLACE");
  });

  test("Permissions and Members still open as themselves", () => {
    visit(`${BASE}/${TEAM_ID}/permissions`);
    expect(pageName()).toBe("Permissions");
    expect(screen.getByTestId("navigation-type")).toHaveTextContent("POP");
    cleanup();

    visit(`${BASE}/${TEAM_ID}/members`);
    expect(pageName()).toBe("Members");
    expect(landedOn()).toBe(`${BASE}/${TEAM_ID}/members`);
  });

  test("is spelled out where the routes are, since the route table has no entry for it", () => {
    expect(MOVED_TEAM_BLOCK_PERMISSIONS_PATH).toBe("block-permissions");
    expect(
      Object.keys(PageMap).filter((key: string): boolean => {
        return key.startsWith("TEAM_") && key.includes("BLOCK");
      }),
    ).toEqual([]);
    expect(
      Object.values(TeamsRoutePath).filter((routePath: string): boolean => {
        return routePath.endsWith("block-permissions");
      }),
    ).toEqual([]);
    expect(
      Object.values(RouteMap)
        .map((route: Route): string => {
          return route.toString();
        })
        .filter((route: string): boolean => {
          return (
            route.includes("/teams/") && route.endsWith("/block-permissions")
          );
        }),
    ).toEqual([]);
  });
});

describe("the page that was there", () => {
  test("is gone from the source, and the routes forward its URL", () => {
    expect(
      fs.existsSync(
        path.join(
          DASHBOARD_SRC,
          "Pages",
          "Teams",
          "View",
          "BlockPermissions.tsx",
        ),
      ),
    ).toBe(false);

    const routes: string = fs.readFileSync(
      path.join(DASHBOARD_SRC, "Routes", "TeamsRoutes.tsx"),
      "utf8",
    );

    expect(routes).not.toContain("View/BlockPermissions");
    expect(routes).toContain(
      "<MovedPageRedirect pageMap={PageMap.TEAM_VIEW_PERMISSIONS} />",
    );
  });
});
