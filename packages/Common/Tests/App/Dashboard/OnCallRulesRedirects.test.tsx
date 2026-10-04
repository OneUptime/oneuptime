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
 * A person's on-call rules were four pages, one per kind - in User Settings
 * (…/user-settings/incident-on-call-rules and its three siblings) and again
 * for an admin under Users (…/users/:id/incident-on-call-rules and so on).
 * They are one On-Call Rules page in each place now, with a tab per kind, and
 * the tab is in the address (?type=alerts).
 *
 * The old addresses are in bookmarks, in tickets and in every setup-reminder
 * email sent before this change, so each one still arrives: on the new page,
 * opened on the tab it used to be.
 *
 * This mounts the REAL route groups, with the layouts and the pages that matter
 * here replaced by recorders, and visits the old URLs.
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

// A layout that draws its child and says which layout it is.
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
  "../../../../App/FeatureSet/Dashboard/src/Pages/UserSettings/Layout",
  () => {
    return mockLayout("user-settings");
  },
);
jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Pages/UserSettings/OnCallRules",
  () => {
    return mockPage("UserSettingsOnCallRules");
  },
);
jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Pages/UserSettings/NotificationMethods",
  () => {
    return mockPage("UserSettingsNotificationMethods");
  },
);
jest.mock("../../../../App/FeatureSet/Dashboard/src/Pages/Users/Layout", () => {
  return mockLayout("users");
});
jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Pages/Users/View/Layout",
  () => {
    return mockLayout("user-view");
  },
);
jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Pages/Users/View/OnCall/Layout",
  () => {
    return mockLayout("user-view-on-call");
  },
);
jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Pages/Users/View/OnCall/Rules",
  () => {
    return mockPage("UserViewOnCallRules");
  },
);
jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Pages/Users/View/OnCall/Readiness",
  () => {
    return mockPage("UserViewOnCallReadiness");
  },
);
/*
 * The rest of the Users group's pages, which these tests never visit, as
 * recorders too: the members list builds its own model API on the real one at
 * import time, which the ModelAPI stub above cannot be extended by.
 */
jest.mock("../../../../App/FeatureSet/Dashboard/src/Pages/Users/Index", () => {
  return mockPage("Users");
});
jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Pages/Users/CustomFields",
  () => {
    return mockPage("UserCustomFields");
  },
);
jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Pages/Users/View/Index",
  () => {
    return mockPage("UserView");
  },
);
jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Pages/Users/View/Teams",
  () => {
    return mockPage("UserViewTeams");
  },
);
jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Pages/Users/View/NotificationRules",
  () => {
    return mockPage("UserViewNotificationRules");
  },
);
jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Pages/Users/View/OnCall/NotificationMethods",
  () => {
    return mockPage("UserViewNotificationMethods");
  },
);
jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Pages/Users/View/CustomFields",
  () => {
    return mockPage("UserViewCustomFields");
  },
);
jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Pages/Users/View/Delete",
  () => {
    return mockPage("UserViewDelete");
  },
);

import PageComponentProps from "../../../../App/FeatureSet/Dashboard/src/Pages/PageComponentProps";
import { getForwardedSearch } from "../../../../App/FeatureSet/Dashboard/src/Components/Routing/MovedPageRedirect";
import UserSettingsRoutes from "../../../../App/FeatureSet/Dashboard/src/Routes/UserSettingsRoutes";
import UsersRoutes from "../../../../App/FeatureSet/Dashboard/src/Routes/UsersRoutes";
import PageMap from "../../../../App/FeatureSet/Dashboard/src/Utils/PageMap";
import RouteMap, {
  RouteUtil,
} from "../../../../App/FeatureSet/Dashboard/src/Utils/RouteMap";
import Route from "../../../Types/API/Route";
import { PROJECT_ID, goTo } from "./SideMenuHarness";

const USER_ID: string = "7a1d2c3b-4a5f-4e6d-8c7b-9a0f1e2d3c4b";
const SETTINGS: string = `/dashboard/${PROJECT_ID}/user-settings`;
const USERS: string = `/dashboard/${PROJECT_ID}/users`;

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

/*
 * Each retired page, by the end of its address, the tab it became, and the
 * query that opens that tab. Spelled out rather than read from
 * MOVED_ON_CALL_RULES_PATHS, so a renamed address or tab fails here: these
 * are in mail already sent. The first tab, Incidents, is the page's bare
 * address.
 */
const MOVED: Array<[string, string, string]> = [
  ["incident-on-call-rules", "Incidents", ""],
  [
    "incident-episode-on-call-rules",
    "Incident Episodes",
    "?type=incident-episodes",
  ],
  ["alert-on-call-rules", "Alerts", "?type=alerts"],
  ["alert-episode-on-call-rules", "Alert Episodes", "?type=alert-episodes"],
];

function visit(url: string, group: "user-settings" | "users"): void {
  // RouteUtil reads the project id from window.location.
  goTo(url.split(/[?#]/)[0]!);

  render(
    <MemoryRouter initialEntries={[url]}>
      <Routes>
        <RouterRoute
          path={RouteUtil.getRouteString(
            group === "user-settings"
              ? PageMap.USER_SETTINGS_ROOT
              : PageMap.USERS_ROOT,
          )}
          element={
            group === "user-settings" ? (
              <UserSettingsRoutes {...PAGE_PROPS} />
            ) : (
              <UsersRoutes {...PAGE_PROPS} />
            )
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

function pageName(): string | null {
  const pages: Array<HTMLElement> = screen.queryAllByTestId("page");

  expect(pages).toHaveLength(1);

  return pages[0]!.getAttribute("data-page");
}

function layouts(): Array<string | null> {
  return screen.getAllByTestId("layout").map((element: HTMLElement) => {
    return element.getAttribute("data-layout");
  });
}

beforeEach(() => {
  goTo(`/dashboard/${PROJECT_ID}`);
});

afterEach(() => {
  cleanup();
});

describe("your own rules: the four old User Settings pages", () => {
  test.each(MOVED)(
    "…/user-settings/%s arrives at On-Call Rules on the %s tab",
    (oldPath: string, _tab: string, search: string) => {
      visit(`${SETTINGS}/${oldPath}`, "user-settings");

      expect(pageName()).toBe("UserSettingsOnCallRules");
      expect(landedOn()).toBe(`${SETTINGS}/on-call-rules${search}`);
      // Inside User Settings' own layout, drawn once.
      expect(layouts()).toEqual(["user-settings"]);
    },
  );

  test("lands where the route table puts the page", () => {
    visit(`${SETTINGS}/alert-on-call-rules`, "user-settings");

    expect(screen.getByTestId("pathname").textContent).toBe(
      RouteMap[PageMap.USER_SETTINGS_ON_CALL_RULES]!.toString().replace(
        ":projectId",
        PROJECT_ID,
      ),
    );
    expect(screen.getByTestId("page")).toHaveAttribute(
      "data-page-route",
      RouteMap[PageMap.USER_SETTINGS_ON_CALL_RULES]!.toString(),
    );
  });

  test("keeps the old address's query string and hash, and the tab wins over a stale type", () => {
    visit(
      `${SETTINGS}/alert-episode-on-call-rules?from=email&type=incidents#rules`,
      "user-settings",
    );

    expect(landedOn()).toBe(
      `${SETTINGS}/on-call-rules?from=email&type=alert-episodes#rules`,
    );
  });

  test("replaces the history entry, so Back does not bounce", () => {
    visit(`${SETTINGS}/incident-on-call-rules`, "user-settings");

    expect(screen.getByTestId("navigation-type")).toHaveTextContent("REPLACE");
  });

  test("On-Call Rules opens as itself, on whichever tab its address names", () => {
    visit(`${SETTINGS}/on-call-rules?type=alerts`, "user-settings");

    expect(pageName()).toBe("UserSettingsOnCallRules");
    expect(landedOn()).toBe(`${SETTINGS}/on-call-rules?type=alerts`);
    expect(screen.getByTestId("navigation-type")).toHaveTextContent("POP");
  });

  test("the other User Settings pages still open as themselves", () => {
    visit(`${SETTINGS}/notification-methods`, "user-settings");

    expect(pageName()).toBe("UserSettingsNotificationMethods");
    expect(screen.getByTestId("navigation-type")).toHaveTextContent("POP");
  });
});

describe("a member's rules: the four old pages under Users", () => {
  test.each(MOVED)(
    "…/users/:id/%s arrives at the member's On-Call Rules on the %s tab",
    (oldPath: string, _tab: string, search: string) => {
      visit(`${USERS}/${USER_ID}/${oldPath}`, "users");

      expect(pageName()).toBe("UserViewOnCallRules");
      expect(landedOn()).toBe(`${USERS}/${USER_ID}/on-call-rules${search}`);
      /*
       * Inside the member's view and its On-Call section, once each: the
       * forward itself does not wait for (or repeat) the section's reads.
       */
      expect(layouts()).toEqual(["user-view", "user-view-on-call"]);
    },
  );

  test("keeps the member it was for", () => {
    const otherUserId: string = "0a1b2c3d-4e5f-4a6b-8c7d-00000000e0f3";

    visit(`${USERS}/${otherUserId}/alert-on-call-rules`, "users");

    expect(landedOn()).toBe(
      `${USERS}/${otherUserId}/on-call-rules?type=alerts`,
    );
  });

  test("lands where the route table puts the page", () => {
    visit(`${USERS}/${USER_ID}/incident-episode-on-call-rules`, "users");

    expect(screen.getByTestId("pathname").textContent).toBe(
      RouteMap[PageMap.USER_VIEW_ON_CALL_RULES]!.toString()
        .replace(":projectId", PROJECT_ID)
        .replace(":id", USER_ID),
    );
  });

  test("replaces the history entry, so Back does not bounce", () => {
    visit(`${USERS}/${USER_ID}/alert-episode-on-call-rules`, "users");

    expect(screen.getByTestId("navigation-type")).toHaveTextContent("REPLACE");
  });

  test("On-Call Rules and Readiness open as themselves", () => {
    visit(`${USERS}/${USER_ID}/on-call-rules?type=incident-episodes`, "users");

    expect(pageName()).toBe("UserViewOnCallRules");
    expect(screen.getByTestId("navigation-type")).toHaveTextContent("POP");
    expect(landedOn()).toBe(
      `${USERS}/${USER_ID}/on-call-rules?type=incident-episodes`,
    );
    cleanup();

    visit(`${USERS}/${USER_ID}/on-call-readiness`, "users");

    expect(pageName()).toBe("UserViewOnCallReadiness");
  });
});

describe("the query a forward carries", () => {
  test("is the old address's own when there is nothing to add", () => {
    expect(getForwardedSearch({ search: "?from=wiki" })).toBe("?from=wiki");
    expect(getForwardedSearch({ search: "" })).toBe("");
    expect(getForwardedSearch({ search: "", searchParams: {} })).toBe("");
  });

  test("adds the new page's parameters after the old ones", () => {
    expect(
      getForwardedSearch({
        search: "?from=wiki",
        searchParams: { type: "alerts" },
      }),
    ).toBe("?from=wiki&type=alerts");
    expect(
      getForwardedSearch({ search: "", searchParams: { type: "alerts" } }),
    ).toBe("?type=alerts");
  });

  test("a parameter the forward sets wins over the old address's", () => {
    expect(
      getForwardedSearch({
        search: "?type=incidents&from=wiki",
        searchParams: { type: "alert-episodes" },
      }),
    ).toBe("?type=alert-episodes&from=wiki");
  });

  test("values are encoded", () => {
    expect(
      getForwardedSearch({
        search: "",
        searchParams: { note: "a b&c" },
      }),
    ).toBe("?note=a+b%26c");
  });
});

describe("the pages that were there", () => {
  test("are gone from the source, and both route groups forward their URLs", () => {
    for (const file of [
      "IncidentOnCallRules.tsx",
      "IncidentEpisodeOnCallRules.tsx",
      "AlertOnCallRules.tsx",
      "EpisodeOnCallRules.tsx",
    ]) {
      expect(
        fs.existsSync(path.join(DASHBOARD_SRC, "Pages", "UserSettings", file)),
      ).toBe(false);
    }

    for (const routesFile of ["UserSettingsRoutes.tsx", "UsersRoutes.tsx"]) {
      const routes: string = fs.readFileSync(
        path.join(DASHBOARD_SRC, "Routes", routesFile),
        "utf8",
      );

      expect(routes).toContain("MOVED_ON_CALL_RULES_PATHS");
      expect(routes).toContain("<MovedPageRedirect");
      expect(routes).toContain("searchParams={getOnCallRuleKindQuery(kind)}");
    }
  });

  test("the route table has one On-Call Rules page on each side and no page per kind", () => {
    const routes: Array<string> = Object.values(RouteMap).map(
      (route: Route): string => {
        return route.toString();
      },
    );

    for (const [oldPath] of MOVED) {
      expect(
        routes.filter((route: string): boolean => {
          return route.endsWith(`/${oldPath}`);
        }),
      ).toEqual([]);
    }

    expect(RouteMap[PageMap.USER_SETTINGS_ON_CALL_RULES]!.toString()).toBe(
      "/dashboard/:projectId/user-settings/on-call-rules",
    );
    expect(RouteMap[PageMap.USER_VIEW_ON_CALL_RULES]!.toString()).toBe(
      "/dashboard/:projectId/users/:id/on-call-rules",
    );
    expect(
      Object.keys(PageMap).filter((key: string): boolean => {
        return key.includes("_ON_CALL_RULES") && key.startsWith("USER");
      }),
    ).toEqual(["USER_SETTINGS_ON_CALL_RULES", "USER_VIEW_ON_CALL_RULES"]);
  });
});
