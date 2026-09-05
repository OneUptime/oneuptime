import { beforeAll, describe, expect, test } from "@jest/globals";
import fs from "fs";
import nodePath from "path";

/*
 * Session replay adds four pages under the RUM application, and reaching any
 * of them takes six independent hand-written wirings: a PageMap key, a
 * RumRoutePath entry, an absolute RouteMap Route, a PageRoute in
 * RumApplicationRoutes.tsx, a SideMenuItem, and a breadcrumb. Nothing ties
 * those together, and every one of them fails silently:
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
 * Source text, read rather than imported.
 *
 * The registrations, the canvas flag and the rrweb import boundary are all
 * invariants that no runtime value exposes: RumApplicationRoutes.tsx renders
 * React Router elements, and the rrweb boundary is a property of the module
 * graph. Asserting on the text is the only way to make deleting one of them
 * fail a test rather than a code review.
 *
 * Comments are stripped first: these files quote the very patterns being
 * banned - the player's header explains why a top-level `from "rrweb"` would
 * be a disaster - so a naive text search matches the warning and fails on
 * correct code.
 */
function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/[^\n]*/g, "$1");
}

const routeSource: string = fs.readFileSync(
  nodePath.join(
    __dirname,
    "../../FeatureSet/Dashboard/src/Routes/RumApplicationRoutes.tsx",
  ),
  "utf8",
);
/*
 * The Replayer is configured by the engine now (Engine/ReplayEngine.ts);
 * ReplayStage.tsx is a thin React binding that never constructs one.
 */
const replayEngineSource: string = stripComments(
  fs.readFileSync(
    nodePath.join(
      __dirname,
      "../../FeatureSet/Dashboard/src/Components/SessionReplay/Engine/ReplayEngine.ts",
    ),
    "utf8",
  ),
);

const sessionReplayComponentsDirectory: string = nodePath.join(
  __dirname,
  "../../FeatureSet/Dashboard/src/Components/SessionReplay",
);

/* Every .ts/.tsx under the session replay components, subfolders included. */
function listSessionReplaySources(directory: string): Array<string> {
  const files: Array<string> = [];

  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const fullPath: string = nodePath.join(directory, entry.name);

    if (entry.isDirectory()) {
      files.push(...listSessionReplaySources(fullPath));
    } else if (entry.name.endsWith(".ts") || entry.name.endsWith(".tsx")) {
      files.push(fullPath);
    }
  }

  return files;
}
const sessionReplayPlayerSource: string = stripComments(
  fs.readFileSync(
    nodePath.join(
      __dirname,
      "../../FeatureSet/Dashboard/src/Components/SessionReplay/SessionReplayPlayer.tsx",
    ),
    "utf8",
  ),
);

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
    PageMap.RUM_APPLICATION_VIEW_SESSION_REPLAY_SETTINGS,
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

    /*
     * ...and the CALL SITE actually passes 2. The arithmetic above is
     * RouteUtil's, not this feature's; deleting the literal `2` from
     * RumApplicationRoutes.tsx is the mistake this test exists to catch, and
     * it cannot be caught without reading the registration itself.
     */
    expect(routeSource).toMatch(
      /getLastPathForKey\(\s*PageMap\.RUM_APPLICATION_VIEW_SESSION_REPLAY_VIEW\s*,\s*2\s*,?\s*\)/,
    );
  });

  test("each session replay page is registered exactly once as a PageRoute", () => {
    /*
     * A key registered twice means React Router silently never reaches the
     * second registration; a key registered zero times means the page is
     * unreachable while every other wiring still looks correct.
     */
    for (const key of [
      "RUM_APPLICATION_VIEW_SESSION_REPLAY",
      "RUM_APPLICATION_VIEW_SESSION_REPLAY_VIEW",
      "RUM_APPLICATION_VIEW_SESSION_REPLAY_AUDIT",
      "RUM_APPLICATION_VIEW_SESSION_REPLAY_SETTINGS",
    ]) {
      const occurrences: number = (
        routeSource.match(
          new RegExp(`getLastPathForKey\\(\\s*PageMap\\.${key}\\b`, "g"),
        ) ?? []
      ).length;

      expect([key, occurrences]).toEqual([key, 1]);
    }
  });

  test("the project-level settings page is registered under the RUM list layout", () => {
    /*
     * Registered from RumRoutePath rather than getLastPathForKey because
     * the path is two segments ("settings/session-replay"), and it belongs
     * to the RumLayout branch, not the application-view branch: nesting it
     * under the application view would put a :id in front of a page that
     * has no application to read.
     */
    const occurrences: number = (
      routeSource.match(
        /RumRoutePath\[\s*PageMap\.RUM_SETTINGS_SESSION_REPLAY\s*\]/g,
      ) ?? []
    ).length;

    expect(occurrences).toBe(1);
  });

  test("canvas replay stays disabled wherever a Replayer is configured", () => {
    /*
     * rrweb implements canvas replay by dropping the strict sandbox for
     * "allow-same-origin allow-scripts", which is script execution inside a
     * document built from attacker-influenceable end-user HTML on the
     * Dashboard's own origin. This is a security invariant, and a comment is
     * not a mechanism: the engine must set it false, and nothing under the
     * session replay components may ever set it true.
     */
    expect(replayEngineSource).toContain("UNSAFE_replayCanvas: false");

    const canvasEnabled: RegExp = /UNSAFE_replayCanvas:\s*true/;

    for (const file of listSessionReplaySources(
      sessionReplayComponentsDirectory,
    )) {
      const source: string = stripComments(fs.readFileSync(file, "utf8"));

      expect([
        nodePath.relative(sessionReplayComponentsDirectory, file),
        canvasEnabled.test(source),
      ]).toEqual([
        nodePath.relative(sessionReplayComponentsDirectory, file),
        false,
      ]);
    }
  });

  test("rrweb is reachable only through the dynamic import in the player", () => {
    /*
     * Common/UI/esbuild-config.js hardcodes minify:false, so a single static
     * `import ... from "rrweb"` moves ~450KB of Replayer into the shared
     * chunk downloaded by every user who never opens a replay. The lazy
     * boundary is the whole reason ReplayStage takes a replayerFactory
     * instead of constructing one.
     */
    for (const file of listSessionReplaySources(
      sessionReplayComponentsDirectory,
    )) {
      const fileName: string = nodePath.relative(
        sessionReplayComponentsDirectory,
        file,
      );
      const source: string = stripComments(fs.readFileSync(file, "utf8"));

      // A static import in any form: `from "rrweb"` or `require("rrweb")`.
      const staticImport: RegExp = /from\s+["']rrweb["']/;
      const staticRequire: RegExp = /require\(\s*["']rrweb["']\s*\)/;

      expect([fileName, staticImport.test(source)]).toEqual([fileName, false]);
      expect([fileName, staticRequire.test(source)]).toEqual([fileName, false]);
    }

    // And exactly one dynamic import, in the one file allowed to have it.
    expect(sessionReplayPlayerSource).toMatch(
      /await import\(\s*["']rrweb["']\s*\)/,
    );
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

  test("the per-application settings route is scoped to one application", () => {
    /*
     * Replay policy is per-application and lives on the application, so
     * the route has to carry a :id the page can read - it is NOT a
     * project-wide page. The page reads it with
     * Navigation.getLastParamAsObjectID(1), which only resolves for a
     * route shaped ":id/session-replay-settings".
     */
    const path: string =
      RouteMap[
        PageMap.RUM_APPLICATION_VIEW_SESSION_REPLAY_SETTINGS
      ]!.toString();
    const segments: Array<string> = path.split("/");

    expect(path.endsWith("/session-replay-settings")).toBe(true);
    expect(segments[segments.length - 2]).toBe(RouteParams.ModelID);
  });

  test("the per-application settings route cannot be shadowed by a session id", () => {
    /*
     * Same trap as the audit page. At ":id/session-replay/settings" a
     * recording whose session id was literally "settings" would open this
     * page instead of the player, because React Router prefers a static
     * segment over a dynamic one. A sibling path removes the possibility.
     */
    const settingsPath: string =
      RouteMap[
        PageMap.RUM_APPLICATION_VIEW_SESSION_REPLAY_SETTINGS
      ]!.toString();
    const playerPath: string =
      RouteMap[PageMap.RUM_APPLICATION_VIEW_SESSION_REPLAY_VIEW]!.toString();

    const playerPrefix: string = playerPath.slice(
      0,
      playerPath.lastIndexOf("/") + 1,
    );

    expect(settingsPath.startsWith(playerPrefix)).toBe(false);
  });

  test("the project-level settings page lives under RUM settings, unscoped to an application", () => {
    /*
     * The project master switch, the installation test and targeted
     * capture are project-shaped: they are reached from the Real User
     * Monitoring > Settings side menu, beside the applications and
     * recordings they govern. Nothing about them is scoped to ONE
     * application, so a :id in this route would mean the page had been
     * wired under the application view by mistake.
     */
    const path: string =
      RouteMap[PageMap.RUM_SETTINGS_SESSION_REPLAY]!.toString();

    expect(path.endsWith("/rum/settings/session-replay")).toBe(true);
    expect(path).not.toContain(RouteParams.ModelID);
  });

  test("the project-level settings page is no longer under project settings", () => {
    /*
     * The old SETTINGS_SESSION_REPLAY key is gone. Leaving it defined
     * would let a stale link keep resolving to a route nothing renders.
     */
    expect(
      (PageMap as Record<string, string | undefined>)[
        "SETTINGS_SESSION_REPLAY"
      ],
    ).toBeUndefined();
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
