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
 * A monitor had an Interval page (…/monitors/:id/interval): one card whose
 * Edit dialog held one dropdown. The interval is on the Probes & Interval
 * page now (…/monitors/:id/probes), with the probes that check the monitor
 * and how many of them must agree. The old URL stays, so a bookmark or a
 * link in a wiki still arrives somewhere: it forwards to that page.
 *
 * This mounts the REAL monitor route group, with the layout and the pages
 * that matter here replaced by recorders, and visits the old URL.
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
  "../../../../App/FeatureSet/Dashboard/src/Pages/Monitor/View/Layout",
  () => {
    return {
      __esModule: true,
      default: (): ReactElement => {
        const router: typeof import("react-router-dom") = jest.requireActual(
          "react-router-dom",
        ) as typeof import("react-router-dom");

        return (
          <div data-testid="layout" data-layout="monitor-view">
            <router.Outlet />
          </div>
        );
      },
    };
  },
);
jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Pages/Monitor/View/Probes",
  () => {
    return mockPage("ProbesAndInterval");
  },
);
jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Pages/Monitor/View/Settings",
  () => {
    return mockPage("Settings");
  },
);
jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Pages/Monitor/View/Index",
  () => {
    return mockPage("MonitorView");
  },
);

import PageComponentProps from "../../../../App/FeatureSet/Dashboard/src/Pages/PageComponentProps";
import MonitorRoutes, {
  MOVED_MONITOR_INTERVAL_PATH,
} from "../../../../App/FeatureSet/Dashboard/src/Routes/MonitorsRoutes";
import PageMap from "../../../../App/FeatureSet/Dashboard/src/Utils/PageMap";
import RouteMap, {
  RouteUtil,
} from "../../../../App/FeatureSet/Dashboard/src/Utils/RouteMap";
import Route from "../../../Types/API/Route";
import { PROJECT_ID, goTo } from "./SideMenuHarness";

const MONITOR_ID: string = "6e1d2c3b-4a5f-4e6d-8c7b-9a0f1e2d3c4b";
const BASE: string = `/dashboard/${PROJECT_ID}/monitors`;

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
          path={RouteUtil.getRouteString(PageMap.MONITORS_ROOT)}
          element={<MonitorRoutes {...PAGE_PROPS} />}
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

describe("the old Interval URL", () => {
  test("arrives at the monitor's Probes & Interval page", () => {
    visit(`${BASE}/${MONITOR_ID}/interval`);

    expect(pageName()).toBe("ProbesAndInterval");
    expect(landedOn()).toBe(`${BASE}/${MONITOR_ID}/probes`);
    // Inside the monitor's own layout, drawn once.
    expect(
      screen.getAllByTestId("layout").map((element: HTMLElement) => {
        return element.getAttribute("data-layout");
      }),
    ).toEqual(["monitor-view"]);
  });

  test("lands where the route table puts the page", () => {
    visit(`${BASE}/${MONITOR_ID}/interval`);

    expect(landedOn()).toBe(
      RouteMap[PageMap.MONITOR_VIEW_PROBES]!.toString()
        .replace(":projectId", PROJECT_ID)
        .replace(":id", MONITOR_ID),
    );
    expect(screen.getByTestId("page")).toHaveAttribute(
      "data-page-route",
      RouteMap[PageMap.MONITOR_VIEW_PROBES]!.toString(),
    );
  });

  test("keeps the monitor it was for", () => {
    const otherMonitorId: string = "0a1b2c3d-4e5f-4a6b-8c7d-00000000e0f3";

    visit(`${BASE}/${otherMonitorId}/interval`);

    expect(landedOn()).toBe(`${BASE}/${otherMonitorId}/probes`);
  });

  test("keeps its query string and hash", () => {
    visit(`${BASE}/${MONITOR_ID}/interval?from=wiki#interval`);

    expect(landedOn()).toBe(`${BASE}/${MONITOR_ID}/probes?from=wiki#interval`);
  });

  test("replaces the history entry, so Back does not bounce", () => {
    visit(`${BASE}/${MONITOR_ID}/interval`);

    expect(screen.getByTestId("navigation-type")).toHaveTextContent("REPLACE");
  });

  test("Probes & Interval and Settings still open as themselves", () => {
    visit(`${BASE}/${MONITOR_ID}/probes`);
    expect(pageName()).toBe("ProbesAndInterval");
    expect(screen.getByTestId("navigation-type")).toHaveTextContent("POP");
    cleanup();

    visit(`${BASE}/${MONITOR_ID}/settings`);
    expect(pageName()).toBe("Settings");
    expect(landedOn()).toBe(`${BASE}/${MONITOR_ID}/settings`);
  });

  test("is spelled out where the routes are, since the route table has no entry for it", () => {
    expect(MOVED_MONITOR_INTERVAL_PATH).toBe("interval");
    expect(
      Object.keys(PageMap).filter((key: string): boolean => {
        return key.startsWith("MONITOR_") && key.includes("INTERVAL");
      }),
    ).toEqual([]);
    expect(
      Object.values(RouteMap)
        .map((route: Route): string => {
          return route.toString();
        })
        .filter((route: string): boolean => {
          return route.includes("/monitors/") && route.endsWith("/interval");
        }),
    ).toEqual([]);
  });
});

describe("the page that was there", () => {
  test("is gone from the source, and the routes forward its URL", () => {
    expect(
      fs.existsSync(
        path.join(DASHBOARD_SRC, "Pages", "Monitor", "View", "Interval.tsx"),
      ),
    ).toBe(false);

    const routes: string = fs.readFileSync(
      path.join(DASHBOARD_SRC, "Routes", "MonitorsRoutes.tsx"),
      "utf8",
    );

    expect(routes).not.toContain("View/Interval");
    expect(routes).toContain(
      "<MovedPageRedirect pageMap={PageMap.MONITOR_VIEW_PROBES} />",
    );
  });
});
