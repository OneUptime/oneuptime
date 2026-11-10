import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import PageMap from "../../../../App/FeatureSet/Dashboard/src/Utils/PageMap";
import RouteMap, {
  RumRoutePath,
} from "../../../../App/FeatureSet/Dashboard/src/Utils/RouteMap";
import { getRumBreadcrumbs } from "../../../../App/FeatureSet/Dashboard/src/Utils/Breadcrumbs/RumBreadcrumbs";
import Link from "../../../Types/Link";
import { goTo, PROJECT_ID } from "./SideMenuHarness";
import {
  PRODUCT_ANALYTICS_BREAKDOWN_ROUTE,
  PRODUCT_ANALYTICS_PEOPLE_ROUTE,
  PRODUCT_ANALYTICS_PERSON_ROUTE,
  PRODUCT_ANALYTICS_SUMMARY_ROUTE,
  PRODUCT_ANALYTICS_TREND_ROUTE,
  fromProductAnalyticsPersonSegment,
  toProductAnalyticsPersonSegment,
} from "../../../Types/Rum/ProductAnalytics";

/*
 * The product analytics pages (issue #6444) are reached through wirings no
 * runtime value of the pages exposes - a key, a path, a route registered at
 * the right depth, a trail - and each fails quietly: a route registered at
 * the default depth becomes a bare ":subModelId" that shadows every other
 * tab of the application; a trail left out is a page with no way up.
 * Same source-text shape as SessionReplayUsersPageWiring.test.ts.
 */

const dashboardSource: string = path.join(
  __dirname,
  "../../../../App/FeatureSet/Dashboard/src",
);

function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/[^\n]*/g, "$1");
}

function read(relativePath: string): string {
  return stripComments(
    fs.readFileSync(path.join(dashboardSource, relativePath), "utf8"),
  );
}

const routesSource: string = read("Routes/RumApplicationRoutes.tsx");
const sideMenuSource: string = read("Pages/Rum/View/SideMenu.tsx");
const usersPageSource: string = read(
  "Pages/Rum/View/ProductAnalyticsUsers.tsx",
);
const sessionsPageSource: string = read(
  "Pages/Rum/View/ProductAnalyticsSessions.tsx",
);
const personPageSource: string = read(
  "Pages/Rum/View/ProductAnalyticsPerson.tsx",
);

const PAGES: Array<{ key: string; path: string; component: string }> = [
  {
    key: "RUM_APPLICATION_VIEW_PRODUCT_ANALYTICS_USERS",
    path: ":id/product-analytics-users",
    component: "RumApplicationProductAnalyticsUsers",
  },
  {
    key: "RUM_APPLICATION_VIEW_PRODUCT_ANALYTICS_PERSON",
    path: ":id/product-analytics-users/:subModelId",
    component: "RumApplicationProductAnalyticsPerson",
  },
  {
    key: "RUM_APPLICATION_VIEW_PRODUCT_ANALYTICS_SESSIONS",
    path: ":id/product-analytics-sessions",
    component: "RumApplicationProductAnalyticsSessions",
  },
];

describe("the product analytics pages have keys and paths", () => {
  test.each(PAGES)(
    "$key is a page under the application",
    (page: { key: string; path: string }) => {
      const key: string = (PageMap as Record<string, string>)[page.key]!;

      expect(key).toBe(page.key);
      expect(RumRoutePath[key]).toBe(page.path);
      expect(RouteMap[key]!.toString()).toBe(
        `/dashboard/:projectId/rum/${page.path}`,
      );
    },
  );

  test("no other page shares a path with them", () => {
    for (const page of PAGES) {
      expect(
        Object.values(RumRoutePath).filter((candidate: string): boolean => {
          return candidate === page.path;
        }),
      ).toHaveLength(1);
    }
  });
});

describe("the routes are registered once, at the right depth", () => {
  test.each(PAGES)(
    "$component renders from its own module",
    (page: { key: string; component: string }) => {
      expect(
        (
          routesSource.match(
            new RegExp(`getLastPathForKey\\(\\s*PageMap\\.${page.key}\\b`, "g"),
          ) ?? []
        ).length,
      ).toBe(1);
      expect(routesSource).toContain(`<${page.component}`);
      /* Its pageRoute is its own key's. */
      expect(routesSource).toMatch(
        new RegExp(`RouteMap\\[\\s*PageMap\\.${page.key}\\s*\\]\\s*as Route`),
      );
    },
  );

  test("the person's route keeps two segments, so it never shadows the other tabs", () => {
    expect(routesSource).toMatch(
      /getLastPathForKey\(\s*PageMap\.RUM_APPLICATION_VIEW_PRODUCT_ANALYTICS_PERSON,\s*2,\s*\)/,
    );
  });

  test("Users and Sessions read the application one segment from the end; the person page from the router", () => {
    expect(usersPageSource).toContain("Navigation.getLastParamAsObjectID(1)");
    expect(sessionsPageSource).toContain(
      "Navigation.getLastParamAsObjectID(1)",
    );
    expect(personPageSource).toContain("useLocation()");
    expect(personPageSource).not.toContain("getLastParamAsObjectID");
  });
});

describe("the side menu", () => {
  test("a Product Analytics category between Observability and Session Replay", () => {
    const observability: number = sideMenuSource.indexOf(
      'title="Observability"',
    );
    const productAnalytics: number = sideMenuSource.indexOf(
      'title="Product Analytics"',
    );
    const sessionReplay: number = sideMenuSource.indexOf(
      'title="Session Replay"',
    );

    expect(observability).toBeGreaterThan(-1);
    expect(productAnalytics).toBeGreaterThan(observability);
    expect(sessionReplay).toBeGreaterThan(productAnalytics);

    const section: string = sideMenuSource.slice(
      productAnalytics,
      sessionReplay,
    );

    expect(section).toContain('title: "Users"');
    expect(section).toContain(
      "PageMap.RUM_APPLICATION_VIEW_PRODUCT_ANALYTICS_USERS",
    );
    expect(section).toContain('title: "Sessions"');
    expect(section).toContain(
      "PageMap.RUM_APPLICATION_VIEW_PRODUCT_ANALYTICS_SESSIONS",
    );
    /* A person's page lights Users. */
    expect(section).toContain("activeRoute={isOnPersonPage ? personRoute");
  });
});

describe("the trails", () => {
  const APP_ID: string = "0193c0de-1111-4aaa-8bbb-000000000001";
  const APP_PATH: string = `/dashboard/${PROJECT_ID}/rum/${APP_ID}`;

  function trail(key: string, concretePath: string): Array<Link> {
    goTo(concretePath);

    return getRumBreadcrumbs(RouteMap[key]!.toString()) || [];
  }

  function titles(links: Array<Link>): Array<string> {
    return links.map((link: Link): string => {
      return link.title;
    });
  }

  test("Users and Sessions sit under the application", () => {
    expect(
      titles(
        trail(
          PageMap.RUM_APPLICATION_VIEW_PRODUCT_ANALYTICS_USERS,
          `${APP_PATH}/product-analytics-users`,
        ),
      ),
    ).toEqual(["Project", "Real User Monitoring", "View Application", "Users"]);
    expect(
      titles(
        trail(
          PageMap.RUM_APPLICATION_VIEW_PRODUCT_ANALYTICS_SESSIONS,
          `${APP_PATH}/product-analytics-sessions`,
        ),
      ),
    ).toEqual([
      "Project",
      "Real User Monitoring",
      "View Application",
      "Sessions",
    ]);
  });

  test("a person sits under Users, which leads back to the list", () => {
    const links: Array<Link> = trail(
      PageMap.RUM_APPLICATION_VIEW_PRODUCT_ANALYTICS_PERSON,
      `${APP_PATH}/product-analytics-users/v-7f3a2b1c9d8e4f5a6b7c8d9e0f1a2b3c`,
    );

    expect(titles(links)).toEqual([
      "Project",
      "Real User Monitoring",
      "View Application",
      "Users",
      "Person",
    ]);
    expect(links[3]!.to.toString()).toBe(`${APP_PATH}/product-analytics-users`);
  });
});

describe("the reads the pages call", () => {
  test("five POST routes under one prefix, as TelemetryAPI registers them", () => {
    const telemetryApi: string = stripComments(
      fs.readFileSync(
        path.join(__dirname, "../../../Server/API/TelemetryAPI.ts"),
        "utf8",
      ),
    );

    for (const route of [
      PRODUCT_ANALYTICS_SUMMARY_ROUTE,
      PRODUCT_ANALYTICS_TREND_ROUTE,
      PRODUCT_ANALYTICS_BREAKDOWN_ROUTE,
      PRODUCT_ANALYTICS_PEOPLE_ROUTE,
      PRODUCT_ANALYTICS_PERSON_ROUTE,
    ]) {
      expect(route.startsWith("/telemetry/rum/product-analytics/")).toBe(true);
    }

    for (const route of [
      PRODUCT_ANALYTICS_SUMMARY_ROUTE,
      PRODUCT_ANALYTICS_TREND_ROUTE,
      PRODUCT_ANALYTICS_BREAKDOWN_ROUTE,
      PRODUCT_ANALYTICS_PEOPLE_ROUTE,
      PRODUCT_ANALYTICS_PERSON_ROUTE,
    ]) {
      expect(telemetryApi).toContain(`"${route}"`);
    }
  });

  test("a person's key travels as one address segment and back", () => {
    const key: string =
      "u:9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08";

    expect(toProductAnalyticsPersonSegment(key)).toBe(
      "u-9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08",
    );
    expect(
      fromProductAnalyticsPersonSegment(toProductAnalyticsPersonSegment(key)),
    ).toBe(key);
    expect(fromProductAnalyticsPersonSegment("u-nobody")).toBeNull();
  });
});
