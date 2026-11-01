import { beforeAll, describe, expect, test } from "@jest/globals";
import fs from "fs";
import nodePath from "path";

/*
 * The User Flows page is reached through six hand-written wirings - a
 * PageMap key, a RumRoutePath entry, an absolute Route, a PageRoute, a side
 * menu item and a breadcrumb - plus one string shared with the server: the
 * endpoint path. Each fails silently when it is wrong (a blank breadcrumb,
 * a page that reads the wrong id, a 404 the page shows as "could not
 * load"), so each is pinned here.
 *
 * Same deferred-import + browser-stub shape as SessionReplayRoutes.test.ts:
 * RouteMap reads `window` at load.
 */

type RouteMapModule =
  typeof import("../../FeatureSet/Dashboard/src/Utils/RouteMap");
type PageMapModule =
  typeof import("../../FeatureSet/Dashboard/src/Utils/PageMap");
type Link = import("Common/Types/Link").default;

let RouteMap: RouteMapModule["default"];
let RouteUtil: RouteMapModule["RouteUtil"];
let RumRoutePath: RouteMapModule["RumRoutePath"];
let PageMap: PageMapModule["default"];
let getRumBreadcrumbs: (path: string) => Array<Link> | undefined;
let setNavigationLocation: (pathname: string) => void;

function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/[^\n]*/g, "$1");
}

function read(relative: string): string {
  return stripComments(
    fs.readFileSync(nodePath.join(__dirname, "../../", relative), "utf8"),
  );
}

const routesSource: string = read(
  "FeatureSet/Dashboard/src/Routes/RumApplicationRoutes.tsx",
);
const sideMenuSource: string = read(
  "FeatureSet/Dashboard/src/Pages/Rum/View/SideMenu.tsx",
);
const pageSource: string = read(
  "FeatureSet/Dashboard/src/Pages/Rum/View/UserFlows.tsx",
);
const apiClientSource: string = read(
  "FeatureSet/Dashboard/src/Components/UserFlow/UserFlowApi.ts",
);
const telemetryApiSource: string = read("../Common/Server/API/TelemetryAPI.ts");

beforeAll(async () => {
  (globalThis as Record<string, unknown>)["window"] = {
    location: { pathname: "/", search: "", hash: "" },
    history: {
      state: null,
      replaceState: (): void => {
        // no-op
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
  RumRoutePath = routeMapModule.RumRoutePath;
  PageMap = (await import("../../FeatureSet/Dashboard/src/Utils/PageMap"))
    .default;
  getRumBreadcrumbs = (
    await import(
      "../../FeatureSet/Dashboard/src/Utils/Breadcrumbs/RumBreadcrumbs"
    )
  ).getRumBreadcrumbs;

  const Navigation: typeof import("Common/UI/Utils/Navigation").default = (
    await import("Common/UI/Utils/Navigation")
  ).default;

  setNavigationLocation = (pathname: string): void => {
    Navigation.setLocation({
      pathname: pathname,
      search: "",
      hash: "",
      state: null,
      key: "test",
    });
  };
});

describe("the User Flows page is reachable", () => {
  test("its route is a sibling of the application, never under session-replay/", () => {
    expect(RumRoutePath[PageMap.RUM_APPLICATION_VIEW_USER_FLOWS]).toBe(
      ":id/user-flows",
    );

    const path: string =
      RouteMap[PageMap.RUM_APPLICATION_VIEW_USER_FLOWS]!.toString();
    const segments: Array<string> = path.split("/");

    expect(path.startsWith("/dashboard/:projectId/rum/")).toBe(true);
    expect(path.endsWith("/user-flows")).toBe(true);
    /* The page reads its id with getLastParamAsObjectID(1). */
    expect(segments[segments.length - 2]).toBe(":id");
    expect(pageSource).toContain("Navigation.getLastParamAsObjectID(1)");
  });

  test("the router registers it once, from its own module", () => {
    expect(routesSource).toContain('from "../Pages/Rum/View/UserFlows"');
    expect(
      (
        routesSource.match(
          /getLastPathForKey\(\s*PageMap\.RUM_APPLICATION_VIEW_USER_FLOWS\s*,?\s*\)/g,
        ) ?? []
      ).length,
    ).toBe(1);
  });

  test("the side menu lists it in the Session Replay section", () => {
    const sectionStart: number = sideMenuSource.indexOf(
      'SideMenuSection title="Session Replay"',
    );
    const sectionEnd: number = sideMenuSource.indexOf(
      'SideMenuSection title="Settings"',
    );
    const itemIndex: number = sideMenuSource.indexOf('title: "User Flows"');

    expect(itemIndex).toBeGreaterThan(sectionStart);
    expect(itemIndex).toBeLessThan(sectionEnd);

    const item: string = sideMenuSource.slice(
      itemIndex,
      sideMenuSource.indexOf("/>", itemIndex),
    );

    expect(item).toContain("PageMap.RUM_APPLICATION_VIEW_USER_FLOWS");
    expect(item).toContain("IconProp.Share");
  });

  test("the breadcrumb names it", () => {
    setNavigationLocation("/dashboard/proj-1/rum/app-1/user-flows");

    const trail: Array<Link> | undefined = getRumBreadcrumbs(
      RouteUtil.getRouteString(PageMap.RUM_APPLICATION_VIEW_USER_FLOWS),
    );

    expect(
      trail?.map((link: Link): string => {
        return link.title;
      }),
    ).toEqual([
      "Project",
      "Real User Monitoring",
      "View Application",
      "User Flows",
    ]);
  });

  test("the client calls the route the server registers", () => {
    const clientRoute: RegExpMatchArray | null = apiClientSource.match(
      /USER_FLOW_ROUTE: string =\s*"([^"]+)"/,
    );

    expect(clientRoute?.[1]).toBe("/telemetry/rum/session-replay/user-flow");
    expect(telemetryApiSource).toContain(`"${clientRoute?.[1]}"`);
  });

  test("the server guards it like the session list", () => {
    const start: number = telemetryApiSource.indexOf(
      '"/telemetry/rum/session-replay/user-flow"',
    );
    const handler: string = telemetryApiSource.slice(
      start,
      telemetryApiSource.indexOf("router.post(", start + 1),
    );

    expect(handler).toContain("...requireSessionReplayListAccess");
    expect(handler).toContain("assertSessionReplayPlan(databaseProps)");
    expect(handler).toContain("assertSessionReplayApplicationAccess(");
    expect(handler).toContain("permissions: SESSION_REPLAY_LIST_PERMISSIONS");
  });
});
