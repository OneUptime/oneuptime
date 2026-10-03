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
import {
  MemoryRouter,
  Route as RouterRoute,
  Routes,
} from "react-router-dom";

/*
 * A status page had an Advanced Options page (…/status-pages/:id/
 * advanced-options) that no menu linked to: a broken copy of Embedded
 * Status's badge settings, drawn inside the page's own layout a second time,
 * with the only per-page JSON export. The page is gone; its export is on
 * Advanced Settings. The URL stays, so a bookmark still arrives somewhere:
 * it forwards to Embedded Status, where the badge settings are.
 *
 * This mounts the REAL status page route group, with the layouts and the
 * pages that matter here replaced by recorders, and visits the old URL.
 */

const countCalls: Array<Record<string, unknown>> = [];

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      count: (args: Record<string, unknown>) => {
        countCalls.push(args);
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

function mockLayout(name: string): {
  __esModule: boolean;
  default: () => ReactElement;
} {
  return {
    __esModule: true,
    default: (): ReactElement => {
      const router: typeof import("react-router-dom") = jest.requireActual(
        "react-router-dom",
      ) as typeof import("react-router-dom");

      return (
        <div data-testid="layout" data-layout={name}>
          <router.Outlet />
        </div>
      );
    },
  };
}

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Pages/StatusPages/Layout",
  () => {
    return mockLayout("status-pages");
  },
);
jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Pages/StatusPages/View/Layout",
  () => {
    return mockLayout("status-page-view");
  },
);
jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Pages/StatusPages/View/EmbeddedStatus",
  () => {
    return mockPage("EmbeddedStatus");
  },
);
jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Pages/StatusPages/View/StatusPageSettings",
  () => {
    return mockPage("StatusPageSettings");
  },
);
jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Pages/StatusPages/View/Index",
  () => {
    return mockPage("StatusPageView");
  },
);

import PageComponentProps from "../../../../App/FeatureSet/Dashboard/src/Pages/PageComponentProps";
import StatusPagesRoutes, {
  MOVED_STATUS_PAGE_ADVANCED_OPTIONS_PATH,
} from "../../../../App/FeatureSet/Dashboard/src/Routes/StatusPagesRoutes";
import PageMap from "../../../../App/FeatureSet/Dashboard/src/Utils/PageMap";
import RouteMap, {
  RouteUtil,
} from "../../../../App/FeatureSet/Dashboard/src/Utils/RouteMap";
import Route from "../../../Types/API/Route";
import { PROJECT_ID, goTo } from "./SideMenuHarness";

const STATUS_PAGE_ID: string = "6e1d2c3b-4a5f-4e6d-8c7b-9a0f1e2d3c4b";
const BASE: string = `/dashboard/${PROJECT_ID}/status-pages`;

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
          path={RouteUtil.getRouteString(PageMap.STATUS_PAGES_ROOT)}
          element={<StatusPagesRoutes {...PAGE_PROPS} />}
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
  countCalls.length = 0;
  goTo(`/dashboard/${PROJECT_ID}`);
});

afterEach(() => {
  cleanup();
});

describe("the old Advanced Options URL", () => {
  test("arrives at the status page's Embedded Status page", () => {
    visit(`${BASE}/${STATUS_PAGE_ID}/advanced-options`);

    expect(pageName()).toBe("EmbeddedStatus");
    expect(landedOn()).toBe(`${BASE}/${STATUS_PAGE_ID}/embedded`);
    // Inside the status page's own layout, drawn once.
    expect(
      screen.getAllByTestId("layout").map((element: HTMLElement) => {
        return element.getAttribute("data-layout");
      }),
    ).toEqual(["status-page-view"]);
  });

  test("lands where the route table puts Embedded Status", () => {
    visit(`${BASE}/${STATUS_PAGE_ID}/advanced-options`);

    expect(landedOn()).toBe(
      RouteMap[PageMap.STATUS_PAGE_VIEW_EMBEDDED]!.toString()
        .replace(":projectId", PROJECT_ID)
        .replace(":id", STATUS_PAGE_ID),
    );
  });

  test("keeps the status page it was for", () => {
    const otherStatusPageId: string = "0a1b2c3d-4e5f-4a6b-8c7d-00000000e0f3";

    visit(`${BASE}/${otherStatusPageId}/advanced-options`);

    expect(landedOn()).toBe(`${BASE}/${otherStatusPageId}/embedded`);
  });

  test("keeps its query string and hash", () => {
    visit(`${BASE}/${STATUS_PAGE_ID}/advanced-options?tab=badge#usage`);

    expect(landedOn()).toBe(
      `${BASE}/${STATUS_PAGE_ID}/embedded?tab=badge#usage`,
    );
  });

  test("replaces the history entry, so Back does not bounce", () => {
    visit(`${BASE}/${STATUS_PAGE_ID}/advanced-options`);

    expect(screen.getByTestId("navigation-type")).toHaveTextContent("REPLACE");
  });

  test("Embedded Status and Advanced Settings still open as themselves", () => {
    visit(`${BASE}/${STATUS_PAGE_ID}/embedded`);
    expect(pageName()).toBe("EmbeddedStatus");
    expect(screen.getByTestId("navigation-type")).toHaveTextContent("POP");
    cleanup();

    visit(`${BASE}/${STATUS_PAGE_ID}/settings`);
    expect(pageName()).toBe("StatusPageSettings");
    expect(landedOn()).toBe(`${BASE}/${STATUS_PAGE_ID}/settings`);
  });

  test("is spelled out where the routes are, since the route table has no entry for it", () => {
    expect(MOVED_STATUS_PAGE_ADVANCED_OPTIONS_PATH).toBe("advanced-options");
    expect(
      Object.keys(PageMap).filter((key: string): boolean => {
        return key.includes("ADVANCED_OPTIONS");
      }),
    ).toEqual([]);
    expect(
      Object.values(RouteMap)
        .map((route: Route): string => {
          return route.toString();
        })
        .filter((route: string): boolean => {
          return route.includes("advanced-options");
        }),
    ).toEqual([]);
  });
});

describe("the page that was there", () => {
  test("is gone from the source, and nothing links to it", () => {
    expect(
      fs.existsSync(
        path.join(
          DASHBOARD_SRC,
          "Pages",
          "StatusPages",
          "View",
          "AdvancedOptions.tsx",
        ),
      ),
    ).toBe(false);

    const routes: string = fs.readFileSync(
      path.join(DASHBOARD_SRC, "Routes", "StatusPagesRoutes.tsx"),
      "utf8",
    );

    expect(routes).not.toContain("View/AdvancedOptions");
    expect(routes).toContain(
      "<MovedPageRedirect pageMap={PageMap.STATUS_PAGE_VIEW_EMBEDDED} />",
    );
  });
});
