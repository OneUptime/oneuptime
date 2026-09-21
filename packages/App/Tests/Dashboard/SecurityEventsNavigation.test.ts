import { beforeAll, describe, expect, test } from "@jest/globals";
import {
  SecurityEventsTabKey,
  getActiveSecurityEventsTab,
  getSecurityEventsPathSegment,
} from "../../FeatureSet/Dashboard/src/Utils/SecurityEventsNavigation";

/*
 * Which header tab a Security Events route lights up.
 *
 * The product used to hang its seven destinations off a left side menu; they
 * are header tabs now, like Logs / Traces / Metrics / Exceptions. The mapping
 * is a pure function so every route can be pinned here without rendering a
 * page — and so the two failure modes a substring test would have are pinned
 * too: a segment BEFORE the product root that happens to contain a tab's name
 * (a project id, a parent path), and the `/*` react-router leaves on the
 * product's wildcard route.
 *
 * Deferred imports with a browser stub, the shape
 * App/Tests/Dashboard/SecurityEventsSetupGuide.test.ts uses: RouteMap pulls
 * in Common/UI/Config, which reads `window` at module load.
 */

type RouteMapModule =
  typeof import("../../FeatureSet/Dashboard/src/Utils/RouteMap");
type PageMapModule =
  typeof import("../../FeatureSet/Dashboard/src/Utils/PageMap");
type Route = InstanceType<(typeof import("Common/Types/API/Route"))["default"]>;

let RouteMap: RouteMapModule["default"];
let RouteUtil: RouteMapModule["RouteUtil"];
let SecurityEventsRoutePath: RouteMapModule["SecurityEventsRoutePath"];
let PageMap: PageMapModule["default"];

const PROJECT_ID: string = "11111111-1111-4111-8111-111111111111";

function routeFor(pageMapKey: string): string {
  return RouteUtil.getRouteString(pageMapKey as never).replace(
    ":projectId",
    PROJECT_ID,
  );
}

beforeAll(async () => {
  (globalThis as Record<string, unknown>)["window"] = {
    location: { pathname: "/", search: "", hash: "" },
    history: {
      state: null,
      replaceState: (): void => {
        // no-op; these tests never navigate.
      },
    },
  };

  for (const storageName of ["sessionStorage", "localStorage"]) {
    Object.defineProperty(globalThis, storageName, {
      value: {
        getItem: (): null => {
          return null;
        },
        setItem: (): void => {
          // no-op
        },
        removeItem: (): void => {
          // no-op
        },
      },
      configurable: true,
      writable: true,
    });
  }

  const routeMapModule: RouteMapModule = await import(
    "../../FeatureSet/Dashboard/src/Utils/RouteMap"
  );

  RouteMap = routeMapModule.default;
  RouteUtil = routeMapModule.RouteUtil;
  SecurityEventsRoutePath = routeMapModule.SecurityEventsRoutePath;
  PageMap = (await import("../../FeatureSet/Dashboard/src/Utils/PageMap"))
    .default;
});

/*
 * Keyed by the PageMap string rather than the enum member, so the table can
 * be written before the deferred import resolves.
 */
const EXPECTED_TAB_BY_PAGE: Array<{ page: string; tab: SecurityEventsTabKey }> =
  [
    { page: "SECURITY_EVENTS", tab: "events" },
    { page: "SECURITY_EVENTS_CORRELATE", tab: "correlate" },
    { page: "SECURITY_EVENTS_DETECTION_RULES", tab: "detection-rules" },
    { page: "SECURITY_EVENTS_THREAT_INTEL", tab: "threat-intel" },
    { page: "SECURITY_EVENTS_MONITORS", tab: "monitors" },
    { page: "SECURITY_EVENTS_CONNECTIONS", tab: "connections" },
    { page: "SECURITY_EVENTS_DOCUMENTATION", tab: "setup" },
  ];

describe("getActiveSecurityEventsTab", () => {
  test.each(EXPECTED_TAB_BY_PAGE)(
    "$page resolves to the $tab tab",
    ({ page, tab }: { page: string; tab: SecurityEventsTabKey }): void => {
      expect(getActiveSecurityEventsTab(routeFor(page))).toBe(tab);
    },
  );

  test("every routed destination has a tab of its own", () => {
    const tabs: Array<SecurityEventsTabKey> = EXPECTED_TAB_BY_PAGE.map(
      (entry: { page: string; tab: SecurityEventsTabKey }) => {
        return entry.tab;
      },
    );

    expect(new Set(tabs).size).toBe(tabs.length);

    /*
     * SecurityEventsRoutePath is what actually ships. A destination added
     * there without a tab here would silently light up "Events" — the tab
     * bar would show the user on a page they are not on.
     */
    expect(Object.keys(SecurityEventsRoutePath).sort()).toEqual(
      EXPECTED_TAB_BY_PAGE.map(
        (entry: { page: string; tab: SecurityEventsTabKey }): string => {
          return entry.page;
        },
      ).sort(),
    );
  });

  test("the product root selects Events, with or without a trailing slash", () => {
    expect(getActiveSecurityEventsTab(routeFor(PageMap.SECURITY_EVENTS))).toBe(
      "events",
    );
    expect(
      getActiveSecurityEventsTab(`${routeFor(PageMap.SECURITY_EVENTS)}/`),
    ).toBe("events");
  });

  test("the wildcard route the product is mounted under selects Events", () => {
    const rootRoute: Route = RouteMap[PageMap.SECURITY_EVENTS_ROOT] as Route;

    expect(rootRoute.toString()).toContain("/*");
    expect(
      getActiveSecurityEventsTab(
        rootRoute.toString().replace(":projectId", PROJECT_ID),
      ),
    ).toBe("events");
  });

  test("a query string never decides the tab", () => {
    expect(
      getActiveSecurityEventsTab(
        `${routeFor(PageMap.SECURITY_EVENTS)}?search=monitors&filters=correlate`,
      ),
    ).toBe("events");
  });

  test("a segment before the product root cannot select a tab", () => {
    expect(
      getActiveSecurityEventsTab("/dashboard/monitors/security-events"),
    ).toBe("events");
    expect(
      getActiveSecurityEventsTab(
        "/dashboard/correlate/security-events/monitors",
      ),
    ).toBe("monitors");
  });

  test("an unknown sub-route falls back to Events rather than no tab at all", () => {
    expect(
      getActiveSecurityEventsTab(
        `${routeFor(PageMap.SECURITY_EVENTS)}/not-a-page`,
      ),
    ).toBe("events");
  });

  test("a path that is not a Security Events route falls back to Events", () => {
    expect(getActiveSecurityEventsTab(`/dashboard/${PROJECT_ID}/logs`)).toBe(
      "events",
    );
    expect(getActiveSecurityEventsTab("")).toBe("events");
  });
});

describe("getSecurityEventsPathSegment", () => {
  test("names the segment after the product root", () => {
    expect(
      getSecurityEventsPathSegment(
        routeFor(PageMap.SECURITY_EVENTS_DETECTION_RULES),
      ),
    ).toBe("detection-rules");
  });

  test("is the empty string at the product root and null off the product", () => {
    expect(
      getSecurityEventsPathSegment(routeFor(PageMap.SECURITY_EVENTS)),
    ).toBe("");
    expect(getSecurityEventsPathSegment(`/dashboard/${PROJECT_ID}/logs`)).toBe(
      null,
    );
  });

  test("the segments it reads are the ones RouteMap actually builds", () => {
    for (const [page, segment] of Object.entries(SecurityEventsRoutePath)) {
      expect(getSecurityEventsPathSegment(routeFor(page))).toBe(segment);
    }
  });
});
