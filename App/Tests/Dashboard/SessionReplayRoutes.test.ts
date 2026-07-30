import { beforeAll, describe, expect, test } from "@jest/globals";

/*
 * Session replay adds four pages, and reaching any of them takes six
 * independent hand-written wirings: a PageMap key, a RumRoutePath entry, an
 * absolute RouteMap Route, a PageRoute in RumApplicationRoutes.tsx, a
 * SideMenuItem, and a breadcrumb. Nothing ties those together, and every one
 * of them fails silently:
 *
 *  - a route missing from RouteMap makes Navigation.getRoutePath() return ""
 *    in Pages/Rum/View/Layout.tsx and the breadcrumb trail just vanishes;
 *  - the player route registered with RouteUtil.getLastPathForKey's DEFAULT
 *    count of 1 collapses to ":subModelId", which then matches every other
 *    single-segment tab of the application view;
 *  - the player page reads its ids with Navigation.getLastParamAsObjectID(2)
 *    plus getLastParamAsString(), which only resolve correctly for a route
 *    shaped ":id/session-replay/:subModelId". Any other shape loads the wrong
 *    application - or, with (1), the literal string "session-replay".
 *
 * Same deferred-import + browser-stub shape as
 * App/Tests/Dashboard/MonitorRecommendationRoutes.test.ts.
 */

type RouteMapModule =
  typeof import("../../FeatureSet/Dashboard/src/Utils/RouteMap");
type PageMapModule =
  typeof import("../../FeatureSet/Dashboard/src/Utils/PageMap");
type RouteParamsModule =
  typeof import("../../FeatureSet/Dashboard/src/Utils/RouteParams");
type Route = InstanceType<(typeof import("Common/Types/API/Route"))["default"]>;
type Link = import("Common/Types/Link").default;

let RouteMap: RouteMapModule["default"];
let RouteUtil: RouteMapModule["RouteUtil"];
let RumRoutePath: RouteMapModule["RumRoutePath"];
let PageMap: PageMapModule["default"];
let RouteParams: RouteParamsModule["default"];
let getRumBreadcrumbs: (path: string) => Array<Link> | undefined;
let setNavigationLocation: (pathname: string) => void;

/* Every session-replay page key, in the order a user meets them. */
let sessionReplayPageKeys: Array<string>;

/*
 * Common/UI/Config reads `window` the moment it loads, and RouteMap pulls it
 * in transitively via ProjectUtil, so the browser stub has to exist before
 * either of them does - hence the deferred imports. A static import would be
 * hoisted above the stub and throw.
 */
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

  /*
   * Node 26 ships real sessionStorage/localStorage globals and plain
   * assignment over them throws inside jest's vm context; defining the
   * property works on every version.
   */
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
  RouteParams = (
    await import("../../FeatureSet/Dashboard/src/Utils/RouteParams")
  ).default;
  getRumBreadcrumbs = (
    await import(
      "../../FeatureSet/Dashboard/src/Utils/Breadcrumbs/RumBreadcrumbs"
    )
  ).getRumBreadcrumbs;

  /*
   * The breadcrumb resolver walks the LIVE location to build ancestor links,
   * so a trail can only be produced with a concrete URL in place. Navigation
   * holds it in a private static that React normally fills from the router.
   */
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

  sessionReplayPageKeys = [
    PageMap.RUM_APPLICATION_VIEW_SESSION_REPLAY,
    PageMap.RUM_APPLICATION_VIEW_SESSION_REPLAY_VIEW,
    PageMap.RUM_APPLICATION_VIEW_SESSION_REPLAY_AUDIT,
    PageMap.RUM_SETTINGS_SESSION_REPLAY,
  ];
});

describe("Session replay page wiring", () => {
  test("every session replay page key is defined", () => {
    for (const key of sessionReplayPageKeys) {
      expect(key).toBeTruthy();
    }

    expect(new Set<string>(sessionReplayPageKeys).size).toBe(
      sessionReplayPageKeys.length,
    );
  });

  test("every key has a RumRoutePath entry", () => {
    for (const key of sessionReplayPageKeys) {
      expect(RumRoutePath[key]).toBeTruthy();
    }
  });

  test("every key resolves to an absolute RouteMap route", () => {
    for (const key of sessionReplayPageKeys) {
      const route: Route | undefined = RouteMap[key];

      expect(route).toBeDefined();
      expect(route!.toString().startsWith("/dashboard/")).toBe(true);
      expect(route!.toString()).toContain("/rum/");
    }
  });

  test("no session replay route duplicates another route in the whole map", () => {
    /*
     * Built once outside the loop rather than filtering inside it: a route
     * that collides with an existing one is registered twice with React
     * Router and the second registration is simply never reached.
     */
    const keysByPath: Record<string, Array<string>> = {};

    for (const candidate of Object.keys(RouteMap)) {
      const path: string = RouteMap[candidate]!.toString();

      keysByPath[path] = [...(keysByPath[path] ?? []), candidate];
    }

    for (const key of sessionReplayPageKeys) {
      expect(keysByPath[RouteMap[key]!.toString()]).toEqual([key]);
    }
  });

  test("the list route ends with /session-replay and carries the model id", () => {
    const path: string =
      RouteMap[PageMap.RUM_APPLICATION_VIEW_SESSION_REPLAY]!.toString();
    const segments: Array<string> = path.split("/");

    expect(path.endsWith("/session-replay")).toBe(true);
    // Read with Navigation.getLastParamAsObjectID(1).
    expect(segments[segments.length - 2]).toBe(RouteParams.ModelID);
  });

  test("the player route is :id/session-replay/:subModelId", () => {
    const path: string =
      RouteMap[PageMap.RUM_APPLICATION_VIEW_SESSION_REPLAY_VIEW]!.toString();
    const segments: Array<string> = path.split("/");

    /*
     * The page reads modelId with getLastParamAsObjectID(2) and sessionId
     * with getLastParamAsString(). Both only work for exactly this shape.
     */
    expect(segments[segments.length - 1]).toBe(RouteParams.SubModelID);
    expect(segments[segments.length - 2]).toBe("session-replay");
    expect(segments[segments.length - 3]).toBe(RouteParams.ModelID);
  });

  test("the player PageRoute must be registered with two path segments", () => {
    /*
     * This is the trap RouteUtil.getLastPathForKey's default hides: with the
     * default count of 1 the player would register as the bare ":subModelId"
     * wildcard under the application view and shadow every sibling tab.
     */
    const withDefault: string = RouteUtil.getLastPathForKey(
      PageMap.RUM_APPLICATION_VIEW_SESSION_REPLAY_VIEW,
    );
    const withTwo: string = RouteUtil.getLastPathForKey(
      PageMap.RUM_APPLICATION_VIEW_SESSION_REPLAY_VIEW,
      2,
    );

    expect(withDefault).toBe(RouteParams.SubModelID);
    expect(withTwo).toBe(`session-replay/${RouteParams.SubModelID}`);
  });

  test("the audit route cannot be shadowed by a session id", () => {
    /*
     * If the audit page lived at ":id/session-replay/audit" then a session
     * whose id happened to be "audit" would open the audit tab instead of
     * that recording, because React Router prefers a static segment over a
     * dynamic one. A sibling path removes the possibility entirely.
     */
    const auditPath: string =
      RouteMap[PageMap.RUM_APPLICATION_VIEW_SESSION_REPLAY_AUDIT]!.toString();
    const playerPath: string =
      RouteMap[PageMap.RUM_APPLICATION_VIEW_SESSION_REPLAY_VIEW]!.toString();

    const playerPrefix: string = playerPath.slice(
      0,
      playerPath.lastIndexOf("/") + 1,
    );

    expect(auditPath.startsWith(playerPrefix)).toBe(false);
    expect(auditPath.endsWith("/session-replay-audit")).toBe(true);
    expect(auditPath.split("/").slice(-2)[0]).toBe(RouteParams.ModelID);
  });

  test("the settings route is a project-level rum settings page", () => {
    const path: string =
      RouteMap[PageMap.RUM_SETTINGS_SESSION_REPLAY]!.toString();

    expect(path.endsWith("/rum/settings/session-replay")).toBe(true);
    // No :id anywhere - it is not scoped to a single application.
    expect(path).not.toContain(RouteParams.ModelID);
  });

  test("every session replay page has a breadcrumb trail", () => {
    /*
     * RUM_APPLICATION_VIEW_CLIENTS has no breadcrumb entry and renders
     * trail-less. That omission is not copied here.
     */
    for (const key of sessionReplayPageKeys) {
      const pattern: string = RouteUtil.getRouteString(key);

      setNavigationLocation(
        pattern
          .replace(RouteParams.ProjectID, "proj-1")
          .replace(RouteParams.ModelID, "app-1")
          .replace(RouteParams.SubModelID, "sess-1"),
      );

      const trail: Array<Link> | undefined = getRumBreadcrumbs(pattern);

      expect(trail).toBeDefined();
      expect(trail!.length).toBeGreaterThanOrEqual(3);
      expect(trail![0]!.title).toBe("Project");
      expect(trail![1]!.title).toBe("Real User Monitoring");
    }
  });

  test("the player breadcrumb has one crumb per meaningful URL segment", () => {
    setNavigationLocation("/dashboard/proj-1/rum/app-1/session-replay/sess-1");

    const trail: Array<Link> | undefined = getRumBreadcrumbs(
      RouteUtil.getRouteString(
        PageMap.RUM_APPLICATION_VIEW_SESSION_REPLAY_VIEW,
      ),
    );

    expect(trail).toBeDefined();
    expect(
      trail!.map((link: Link): string => {
        return link.title;
      }),
    ).toEqual([
      "Project",
      "Real User Monitoring",
      "View Application",
      "Session Replay",
      "Watch Session",
    ]);
  });

  test("populating the player route fills both ids", () => {
    const populated: Route = RouteUtil.populateRouteParams(
      RouteMap[PageMap.RUM_APPLICATION_VIEW_SESSION_REPLAY_VIEW]!,
      {
        modelId: "68b1e4a6f3a2c40012ab34cd",
        subModelId: "sess-abc-123",
      },
    );

    const path: string = populated.toString();

    expect(path).toContain("68b1e4a6f3a2c40012ab34cd");
    expect(path.endsWith("/session-replay/sess-abc-123")).toBe(true);
    expect(path).not.toContain(RouteParams.SubModelID);
  });
});
