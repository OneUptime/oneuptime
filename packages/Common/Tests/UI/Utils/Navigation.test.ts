import Route from "../../../Types/API/Route";
import BadDataException from "../../../Types/Exception/BadDataException";
import Navigation from "../../../UI/Utils/Navigation";
import { NavigateFunction } from "react-router-dom";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * `Navigation.setQueryString` is the single write path for every piece of URL
 * state in the app (table filters, facets, sort/pagination, the telemetry
 * explorers). Its exact semantics are load-bearing:
 *
 *  - it must MERGE, so one component writing its params never deletes another
 *    component's params from the same route;
 *  - it must use `replaceState`, so dragging a filter around doesn't bury the
 *    "back to the list" entry under a hundred history entries;
 *  - it must pass the CURRENT `history.state` through, because that object is
 *    react-router's `{usr, key, idx}` bookkeeping — replacing it with `null`
 *    corrupts the router's history index;
 *  - and it must leave the pathname and hash alone.
 */

type SetUrlFunction = (url: string) => void;

const setUrl: SetUrlFunction = (url: string): void => {
  window.history.replaceState(window.history.state, "", url);
};

describe("Navigation URL query string helpers", () => {
  beforeEach(() => {
    setUrl("/dashboard/monitors");
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe("getQueryString", () => {
    test("returns the raw search string including the leading ?", () => {
      setUrl("/dashboard/monitors?a=1&b=2");

      expect(Navigation.getQueryString()).toBe("?a=1&b=2");
    });

    test("returns an empty string when there is no query", () => {
      expect(Navigation.getQueryString()).toBe("");
    });
  });

  describe("getQueryStringByName", () => {
    test("reads a param and percent-decodes it", () => {
      setUrl(`/dashboard/monitors?q=${encodeURIComponent('{"a":"b c"}')}`);

      expect(Navigation.getQueryStringByName("q")).toBe('{"a":"b c"}');
    });

    test("returns null for a missing param", () => {
      setUrl("/dashboard/monitors?other=1");

      expect(Navigation.getQueryStringByName("q")).toBeNull();
    });

    test("returns null for a present-but-empty param", () => {
      setUrl("/dashboard/monitors?q=");

      expect(Navigation.getQueryStringByName("q")).toBeNull();
    });
  });

  describe("setQueryString", () => {
    test("adds a param without touching the ones already there", () => {
      setUrl("/dashboard/monitors?existing=keepme");

      Navigation.setQueryString({ added: "value" });

      expect(Navigation.getQueryStringByName("existing")).toBe("keepme");
      expect(Navigation.getQueryStringByName("added")).toBe("value");
    });

    test("overwrites only the named param", () => {
      setUrl("/dashboard/monitors?a=1&b=2");

      Navigation.setQueryString({ a: "9" });

      expect(Navigation.getQueryStringByName("a")).toBe("9");
      expect(Navigation.getQueryStringByName("b")).toBe("2");
    });

    test("deletes a param when the value is null", () => {
      setUrl("/dashboard/monitors?a=1&b=2");

      Navigation.setQueryString({ a: null });

      expect(Navigation.getQueryStringByName("a")).toBeNull();
      expect(Navigation.getQueryStringByName("b")).toBe("2");
    });

    test("deletes a param when the value is an empty string", () => {
      setUrl("/dashboard/monitors?a=1");

      Navigation.setQueryString({ a: "" });

      expect(Navigation.getQueryStringByName("a")).toBeNull();
    });

    test("applies several params in one call", () => {
      setUrl("/dashboard/monitors?keep=1&drop=2");

      Navigation.setQueryString({ drop: null, one: "1", two: "2" });

      expect(Navigation.getQueryStringByName("keep")).toBe("1");
      expect(Navigation.getQueryStringByName("drop")).toBeNull();
      expect(Navigation.getQueryStringByName("one")).toBe("1");
      expect(Navigation.getQueryStringByName("two")).toBe("2");
    });

    test("leaves the pathname and hash intact", () => {
      setUrl("/dashboard/monitors/abc#section-two");

      Navigation.setQueryString({ a: "1" });

      expect(window.location.pathname).toBe("/dashboard/monitors/abc");
      expect(window.location.hash).toBe("#section-two");
      expect(Navigation.getQueryStringByName("a")).toBe("1");
    });

    test("drops the '?' entirely when the last param is removed", () => {
      setUrl("/dashboard/monitors?only=1");

      Navigation.setQueryString({ only: null });

      expect(window.location.search).toBe("");
    });

    test("round-trips a value containing URL-significant characters", () => {
      const value: string = '{"name":{"_type":"Search","value":"a&b=c d"}}';

      Navigation.setQueryString({ q: value });

      expect(Navigation.getQueryStringByName("q")).toBe(value);
    });

    test("replaces the current history entry instead of pushing a new one", () => {
      const lengthBefore: number = window.history.length;

      Navigation.setQueryString({ a: "1" });
      Navigation.setQueryString({ a: "2" });
      Navigation.setQueryString({ a: "3" });

      expect(window.history.length).toBe(lengthBefore);
    });

    test("preserves history.state so react-router's bookkeeping survives", () => {
      const routerState: { usr: null; key: string; idx: number } = {
        usr: null,
        key: "abc123",
        idx: 4,
      };
      window.history.replaceState(routerState, "", "/dashboard/monitors");

      Navigation.setQueryString({ a: "1" });

      expect(window.history.state).toEqual(routerState);
    });

    test("swallows the SecurityError Safari throws when replaceState is called too often", () => {
      const replaceState: ReturnType<typeof jest.spyOn> = jest
        .spyOn(window.history, "replaceState")
        .mockImplementation(() => {
          throw new Error("SecurityError: too many calls to replaceState");
        });

      expect(() => {
        Navigation.setQueryString({ a: "1" });
      }).not.toThrow();

      expect(replaceState).toHaveBeenCalled();
    });
  });
});

describe("Navigation route matching", () => {
  test("returns the matched route path through React Router's public API", () => {
    Navigation.setLocation({
      pathname: "/dashboard/monitors/monitor-id",
      search: "",
      hash: "",
      state: null,
      key: "navigation-route-match",
    });

    expect(
      Navigation.getRoutePath([{ path: "/dashboard/monitors/:monitorId" }]),
    ).toBe("/dashboard/monitors/:monitorId");
  });

  test("returns an empty path when no route matches", () => {
    Navigation.setLocation({
      pathname: "/dashboard/monitors",
      search: "",
      hash: "",
      state: null,
      key: "navigation-route-miss",
    });

    expect(Navigation.getRoutePath([{ path: "/dashboard/incidents" }])).toBe(
      "",
    );
  });

  test.each([
    [
      "/dashboard/project/security-events/",
      "/dashboard/project/security-events",
    ],
    [
      "/dashboard/project/security-events",
      "/dashboard/project/security-events/",
    ],
  ])(
    "treats trailing slashes as the same route for %s",
    (currentPath: string, routePath: string) => {
      Navigation.setLocation({
        pathname: currentPath,
        search: "",
        hash: "",
        state: null,
        key: "navigation-trailing-slash",
      });

      expect(Navigation.isOnThisPage(new Route(routePath))).toBe(true);
    },
  );
});

describe("Navigation internal route safety", () => {
  beforeEach(() => {
    setUrl("/dashboard/monitors");
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test.each([
    "/",
    "/incidents/incident-id",
    "/scheduled-maintenance/event-id?tab=timeline#note",
    "/status-page/status-page-id/",
    "/callback?next=https://example.com/complete",
    "/literal/javascript:alert(1)",
  ])("accepts same-origin path %s", (routeValue: string) => {
    expect(Navigation.isSafeInternalRoute(routeValue)).toBe(true);
  });

  test.each([
    "",
    "incidents/incident-id",
    "?tab=timeline",
    "#note",
    "javascript:alert(document.domain)",
    "JaVaScRiPt:alert(1)",
    "data:text/plain,hello",
    "http://evil.example/path",
    "https://evil.example/path",
    "//evil.example/path",
    "///evil.example/path",
    "\\evil.example/path",
    "/\\evil.example/path",
    '/"',
    "/☃",
    "/\u0000control",
  ])("rejects non-internal target %s", (routeValue: string) => {
    expect(Navigation.isSafeInternalRoute(routeValue)).toBe(false);
  });

  test("rejects an absolute URL even when it names the current origin", () => {
    expect(
      Navigation.isSafeInternalRoute(
        `${window.location.origin}/dashboard/monitors`,
      ),
    ).toBe(false);
  });

  test.each([
    "javascript:alert(document.domain)",
    "https://evil.example/path",
    "//evil.example/path",
    "incidents/incident-id",
    "/\\evil.example/path",
  ])(
    "forced navigation independently rejects spoofed Route target %s",
    (routeValue: string) => {
      const currentUrl: string = window.location.href;
      const route: Route = new Route("/safe");

      jest.spyOn(route, "toString").mockReturnValue(routeValue);

      expect(() => {
        Navigation.navigate(route, { forceNavigate: true });
      }).toThrowError(BadDataException);
      expect(window.location.href).toBe(currentUrl);
    },
  );

  test("forced navigation still accepts an internal path", () => {
    Navigation.navigate(new Route("/dashboard/monitors#forced"), {
      forceNavigate: true,
    });

    expect(window.location.pathname).toBe("/dashboard/monitors");
    expect(window.location.hash).toBe("#forced");
  });
});

/*
 * A link to a card on a page carries the card's place as its fragment:
 * ".../api-keys/<id>#custom-roles" opens the key's More settings at its
 * Custom Roles card. The page still reads its record's id from the last
 * part of the path - and the fragment is no part of it: read with it, the
 * id matched no record, and the card opened at said the key had no role.
 */
describe("Navigation last parameter", () => {
  const KEY_ID: string = "60000000-0000-4000-8000-000000000001";

  afterEach(() => {
    window.history.replaceState(null, "", "/");
  });

  test("a link to a card on the page leaves the record's id as it is", () => {
    window.history.replaceState(
      null,
      "",
      `/dashboard/p/settings/api-keys/${KEY_ID}#custom-roles`,
    );

    expect(Navigation.getLastParamAsString()).toBe(KEY_ID);
    expect(Navigation.getLastParamAsObjectID().toString()).toBe(KEY_ID);
    expect(Navigation.getLastParam()?.toString()).toBe(`/${KEY_ID}`);
    // The fragment is still there, for the page to open the card.
    expect(window.location.hash).toBe("#custom-roles");
  });

  test("reads further back the same way, with a query string too", () => {
    window.history.replaceState(
      null,
      "",
      `/dashboard/p/teams/${KEY_ID}/permissions?lang=de#custom-roles`,
    );

    expect(Navigation.getLastParamAsString()).toBe("permissions");
    expect(Navigation.getLastParamAsString(1)).toBe(KEY_ID);
    expect(Navigation.getLastParamAsObjectID(1).toString()).toBe(KEY_ID);
  });

  test("an address with no fragment reads as it always did", () => {
    window.history.replaceState(null, "", `/dashboard/p/monitors/${KEY_ID}`);

    expect(Navigation.getLastParamAsString()).toBe(KEY_ID);
    expect(Navigation.getLastParam()?.toString()).toBe(`/${KEY_ID}`);
  });
});

describe("Navigation current route", () => {
  const clearRouterLocation: () => void = (): void => {
    (Navigation as unknown as { location: unknown }).location = undefined;
  };

  afterEach(() => {
    clearRouterLocation();
    window.history.replaceState(null, "", "/");
  });

  test("reads the address bar before the router has provided a location", () => {
    clearRouterLocation();
    window.history.replaceState(null, "", "/status-page/abc/login?x=1");

    expect(Navigation.getCurrentRoute().toString()).toBe(
      "/status-page/abc/login",
    );
  });

  test("prefers the router's location once it has been set", () => {
    window.history.replaceState(null, "", "/from-the-address-bar");
    Navigation.setLocation({
      pathname: "/from-the-router",
      search: "",
      hash: "",
      state: null,
      key: "navigation-current-route",
    });

    expect(Navigation.getCurrentRoute().toString()).toBe("/from-the-router");
  });
});

/*
 * React Router matches paths case-insensitively (no route opts into
 * caseSensitive), so `/dashboard/<id>/SSO` renders the SSO page. Page checks
 * made through isOnThisPage / isStartWith (the dashboard hides its nav bar on
 * the SSO page, create pages hide their side menu) must agree with the page
 * the router rendered, or the SSO page shows up with the nav bar still on it.
 * navigate() is the exception: its "already here" check stays exact, because
 * parameter values that differ only by case are different pages, and
 * dropping that navigation would strand the user.
 */
describe("Navigation page checks ignore case the way React Router does", () => {
  const setPath: (pathname: string) => void = (pathname: string): void => {
    Navigation.setLocation({
      pathname: pathname,
      search: "",
      hash: "",
      state: null,
      key: "navigation-case",
    });
  };

  afterEach(() => {
    (Navigation as unknown as { location: unknown }).location = undefined;
    (Navigation as unknown as { navigateHook: unknown }).navigateHook =
      undefined;
  });

  test.each([
    ["/dashboard/abc/SSO", "/dashboard/:projectId/sso"],
    ["/dashboard/abc/Sso/", "/dashboard/:projectId/sso"],
    ["/dashboard/abc/sso", "/dashboard/:projectId/SSO"],
    [
      "/Dashboard/abc/incidents/CREATE",
      "/dashboard/:projectId/incidents/create",
    ],
  ])(
    "isOnThisPage matches %s to %s",
    (currentPath: string, routePath: string) => {
      setPath(currentPath);

      expect(Navigation.isOnThisPage(new Route(routePath))).toBe(true);
    },
  );

  test.each([
    ["/dashboard/abc/SSOX", "/dashboard/:projectId/sso"],
    ["/dashboard/abc/SSO/extra", "/dashboard/:projectId/sso"],
    ["/dashboard/abc/SSO", "/dashboard/:projectId/:id/sso"],
  ])(
    "isOnThisPage still tells %s apart from %s",
    (currentPath: string, routePath: string) => {
      setPath(currentPath);

      expect(Navigation.isOnThisPage(new Route(routePath))).toBe(false);
    },
  );

  test("a route that carries a query string still never matches the bare pathname", () => {
    setPath("/dashboard/abc/network-sites/MAP");

    expect(
      Navigation.isOnThisPage(
        new Route("/dashboard/abc/network-sites/map?site="),
      ),
    ).toBe(false);
  });

  test("isOnThisPage compares filled-in parameter values without case too", () => {
    // Deliberate: the values checked this way are ids. See isSameSegment.
    setPath("/dashboard/abc/containers/Web");

    expect(
      Navigation.isOnThisPage(new Route("/dashboard/abc/containers/web")),
    ).toBe(true);
  });

  test("isStartWith ignores case", () => {
    setPath("/dashboard/abc/Incidents/xyz");

    expect(
      Navigation.isStartWith(new Route("/dashboard/:projectId/incidents")),
    ).toBe(true);
    expect(
      Navigation.isStartWith(new Route("/dashboard/:projectId/incidentsx")),
    ).toBe(false);
  });

  test("navigate still treats a parameter value in another case as another page", () => {
    const navigateHook: ReturnType<typeof jest.fn> = jest.fn();
    Navigation.setNavigateHook(navigateHook as unknown as NavigateFunction);
    setPath("/dashboard/abc/containers/Web");

    Navigation.navigate(new Route("/dashboard/abc/containers/web"));
    Navigation.navigate(new Route("/dashboard/abc/containers/Web"));

    expect(navigateHook.mock.calls).toEqual([
      ["/dashboard/abc/containers/web"],
    ]);
  });
});

/*
 * isStartWith answers "is the user on this route, or on a page below it?" -
 * the nav bar's "you are here", the products menu's current product and the
 * category it opens on. React Router reads `/settings`, `/settings/` and the
 * `/settings/*` it mounts pages under as one place, and so must this:
 * Project Settings' route is `/dashboard/:projectId/settings/`, and while the
 * trailing slash counted as one more segment no page of Settings matched it,
 * so the nav bar told people in Settings they were in "Products".
 */
describe("Navigation.isStartWith reads a route as the place it names", () => {
  const setPath: (pathname: string) => void = (pathname: string): void => {
    Navigation.setLocation({
      pathname: pathname,
      search: "",
      hash: "",
      state: null,
      key: "navigation-start-with",
    });
  };

  afterEach(() => {
    (Navigation as unknown as { location: unknown }).location = undefined;
  });

  const SETTINGS_SPELLINGS: Array<string> = [
    "/dashboard/:projectId/settings",
    "/dashboard/:projectId/settings/",
    "/dashboard/:projectId/settings//",
    "/dashboard/:projectId/settings/*",
  ];

  const PAGES_IN_SETTINGS: Array<string> = [
    "/dashboard/abc/settings",
    "/dashboard/abc/settings/",
    "/dashboard/abc/settings/labels",
    "/dashboard/abc/settings/api-keys/65f00000000000000000aaaa",
    "/dashboard/abc/Settings/Labels",
  ];

  const PAGES_OUTSIDE_SETTINGS: Array<string> = [
    "/dashboard/abc",
    "/dashboard/abc/",
    "/dashboard/abc/home",
    "/dashboard/abc/user-settings/on-call-rules",
    "/dashboard/abc/settingsx",
    "/dashboard/abc/settings-archive/labels",
    "/dashboard/abc/monitors/settings",
    "/dashboard/settings",
  ];

  for (const spelling of SETTINGS_SPELLINGS) {
    test.each(PAGES_IN_SETTINGS)(
      `${spelling} holds %s`,
      (currentPath: string) => {
        setPath(currentPath);

        expect(Navigation.isStartWith(new Route(spelling))).toBe(true);
      },
    );

    test.each(PAGES_OUTSIDE_SETTINGS)(
      `${spelling} does not hold %s`,
      (currentPath: string) => {
        setPath(currentPath);

        expect(Navigation.isStartWith(new Route(spelling))).toBe(false);
      },
    );
  }

  test("a wildcard mount point holds its own landing page and every page below it", () => {
    const userSettings: Route = new Route(
      "/dashboard/:projectId/user-settings/*",
    );

    for (const page of [
      "/dashboard/abc/user-settings",
      "/dashboard/abc/user-settings/notification-methods",
      "/dashboard/abc/user-settings/on-call-rules",
      "/dashboard/abc/user-settings/on-call-logs/65f00000000000000000aaaa",
    ]) {
      setPath(page);
      expect(Navigation.isStartWith(userSettings)).toBe(true);
    }

    for (const page of [
      "/dashboard/abc/settings",
      "/dashboard/abc/user-settingsx/on-call-rules",
      "/dashboard/abc",
    ]) {
      setPath(page);
      expect(Navigation.isStartWith(userSettings)).toBe(false);
    }
  });

  test("a route that names one page still holds only that page and the pages below it", () => {
    const notificationMethods: Route = new Route(
      "/dashboard/:projectId/user-settings/notification-methods",
    );

    setPath("/dashboard/abc/user-settings/notification-methods");
    expect(Navigation.isStartWith(notificationMethods)).toBe(true);

    setPath("/dashboard/abc/user-settings/on-call-rules");
    expect(Navigation.isStartWith(notificationMethods)).toBe(false);
  });

  test("a parameter in the route still needs a value in the page", () => {
    const monitorView: Route = new Route("/dashboard/:projectId/monitors/:id/");

    setPath("/dashboard/abc/monitors/65f00000000000000000aaaa/criteria");
    expect(Navigation.isStartWith(monitorView)).toBe(true);

    setPath("/dashboard/abc/monitors");
    expect(Navigation.isStartWith(monitorView)).toBe(false);

    setPath("/dashboard/abc/monitors/");
    expect(Navigation.isStartWith(monitorView)).toBe(false);
  });

  test("a filled-in route keeps matching the way a pattern does", () => {
    const filledIn: Route = new Route(
      "/dashboard/65f00000000000000000aaaa/settings/",
    );

    setPath("/dashboard/65f00000000000000000aaaa/settings/labels");
    expect(Navigation.isStartWith(filledIn)).toBe(true);

    setPath("/dashboard/65f00000000000000000bbbb/settings/labels");
    expect(Navigation.isStartWith(filledIn)).toBe(false);
  });

  test.each(["/", "/*", "//"])(
    "the root route %s still means the root page only, not every page",
    (rootSpelling: string) => {
      setPath("/");
      expect(Navigation.isStartWith(new Route(rootSpelling))).toBe(true);

      setPath("/dashboard/abc/monitors");
      expect(Navigation.isStartWith(new Route(rootSpelling))).toBe(false);
    },
  );

  test("only a trailing wildcard is read as 'and below': one in the middle is a segment like any other", () => {
    const middleWildcard: Route = new Route("/dashboard/:projectId/*/labels");

    setPath("/dashboard/abc/settings/labels");
    expect(Navigation.isStartWith(middleWildcard)).toBe(false);
  });
});
