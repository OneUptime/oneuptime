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
 * A status page's subscribers were five pages - Email Subscribers
 * (…/email-subscribers), SMS Subscribers, Slack Subscribers, Microsoft Teams
 * Subscribers and Webhook Subscribers - and are one Subscribers page with a
 * tab per channel now (#9125). The old URLs stay, so a bookmark, a link in a
 * wiki or an email the server sent still arrives: each forwards to the
 * Subscribers page, on its own channel's tab.
 *
 * This mounts the REAL status page route group, with the layouts and the
 * pages that matter here replaced by recorders, and visits the old URLs.
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
  "../../../../App/FeatureSet/Dashboard/src/Pages/StatusPages/View/Subscribers",
  () => {
    return mockPage("Subscribers");
  },
);
jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Pages/StatusPages/View/SubscriberSettings",
  () => {
    return mockPage("SubscriberSettings");
  },
);
jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Pages/StatusPages/View/NotificationLogs",
  () => {
    return mockPage("NotificationLogs");
  },
);
jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Pages/StatusPages/View/Index",
  () => {
    return mockPage("StatusPageView");
  },
);

import PageComponentProps from "../../../../App/FeatureSet/Dashboard/src/Pages/PageComponentProps";
import StatusPagesRoutes from "../../../../App/FeatureSet/Dashboard/src/Routes/StatusPagesRoutes";
import PageMap from "../../../../App/FeatureSet/Dashboard/src/Utils/PageMap";
import RouteMap, {
  RouteUtil,
} from "../../../../App/FeatureSet/Dashboard/src/Utils/RouteMap";
import Route from "../../../Types/API/Route";
import { MOVED_SUBSCRIBER_LIST_PATHS } from "../../../Types/StatusPage/StatusPageSubscriberChannel";
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

// The old pages, by URL, the page file each one was, and its tab's query.
const OLD_PAGES: Array<[string, string, string]> = [
  ["email-subscribers", "EmailSubscribers.tsx", ""],
  ["sms-subscribers", "SMSSubscribers.tsx", "channel=sms"],
  ["slack-subscribers", "SlackSubscribers.tsx", "channel=slack"],
  [
    "microsoft-teams-subscribers",
    "MicrosoftTeamsSubscribers.tsx",
    "channel=microsoft-teams",
  ],
  ["webhook-subscribers", "WebhookSubscribers.tsx", "channel=webhook"],
];

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
  goTo(`/dashboard/${PROJECT_ID}`);
});

afterEach(() => {
  cleanup();
});

describe("the old per-channel subscriber pages' URLs", () => {
  test("are exactly the five pages the tabs replaced", () => {
    expect(Object.keys(MOVED_SUBSCRIBER_LIST_PATHS)).toEqual(
      OLD_PAGES.map(([oldPath]: [string, string, string]): string => {
        return oldPath;
      }),
    );
  });

  test.each(OLD_PAGES)(
    "…/%s arrives at the Subscribers page, on its channel's tab, inside the status page's layout",
    (oldPath: string, _file: string, query: string) => {
      visit(`${BASE}/${STATUS_PAGE_ID}/${oldPath}`);

      expect(pageName()).toBe("Subscribers");
      expect(landedOn()).toBe(
        `${BASE}/${STATUS_PAGE_ID}/subscribers${query ? `?${query}` : ""}`,
      );
      expect(
        screen.getAllByTestId("layout").map((element: HTMLElement) => {
          return element.getAttribute("data-layout");
        }),
      ).toEqual(["status-page-view"]);
    },
  );

  test.each(OLD_PAGES)(
    "…/%s lands where the route table puts Subscribers",
    (oldPath: string) => {
      visit(`${BASE}/${STATUS_PAGE_ID}/${oldPath}`);

      expect(screen.getByTestId("pathname").textContent).toBe(
        RouteMap[PageMap.STATUS_PAGE_VIEW_SUBSCRIBERS]!.toString()
          .replace(":projectId", PROJECT_ID)
          .replace(":id", STATUS_PAGE_ID),
      );
    },
  );

  test.each(OLD_PAGES)(
    "…/%s keeps the status page it was for, its own query string and its hash",
    (oldPath: string, _file: string, query: string) => {
      const otherStatusPageId: string = "0a1b2c3d-4e5f-4a6b-8c7d-00000000e0f3";

      visit(`${BASE}/${otherStatusPageId}/${oldPath}?from=wiki#list`);

      expect(landedOn()).toBe(
        `${BASE}/${otherStatusPageId}/subscribers?from=wiki${
          query ? `&${query}` : ""
        }#list`,
      );
    },
  );

  test.each(OLD_PAGES)(
    "…/%s replaces the history entry, so Back does not bounce",
    (oldPath: string) => {
      visit(`${BASE}/${STATUS_PAGE_ID}/${oldPath}`);

      expect(screen.getByTestId("navigation-type")).toHaveTextContent(
        "REPLACE",
      );
    },
  );

  test.each(OLD_PAGES)(
    "…/%s: %s is gone from the source, and the route table has no page there",
    (oldPath: string, file: string) => {
      expect(
        fs.existsSync(
          path.join(DASHBOARD_SRC, "Pages", "StatusPages", "View", file),
        ),
      ).toBe(false);

      expect(
        Object.values(RouteMap)
          .map((route: Route): string => {
            return route.toString();
          })
          .filter((route: string): boolean => {
            return route.endsWith(`/${oldPath}`);
          }),
      ).toEqual([]);
    },
  );
});

describe("the pages beside it", () => {
  test.each([
    ["subscribers", "Subscribers"],
    ["subscriber-settings", "SubscriberSettings"],
    ["notification-logs", "NotificationLogs"],
  ])("…/%s opens as itself", (segment: string, name: string) => {
    visit(`${BASE}/${STATUS_PAGE_ID}/${segment}?channel=sms`);

    expect(pageName()).toBe(name);
    expect(landedOn()).toBe(`${BASE}/${STATUS_PAGE_ID}/${segment}?channel=sms`);
    expect(screen.getByTestId("navigation-type")).toHaveTextContent("POP");
  });
});
