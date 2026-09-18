import { beforeAll, describe, expect, test } from "@jest/globals";
import fs from "fs";
import nodePath from "path";

/*
 * Instance Health > Diagnostics > Telemetry is reached through five independent
 * hand-written wirings — a PageMap key, a RouteMap Route, a PageRoute in
 * App.tsx, a SideMenuItem and a shortcut on the health overview — and it is fed
 * by two API routes whose paths are typed out separately in the server and in
 * the components that call them. Nothing ties any of that together, and every
 * one of them fails quietly:
 *
 *  - a missing RouteMap entry makes RouteUtil.populateRouteParams stringify
 *    `undefined`, so the side-menu link and the breadcrumb both point at
 *    "/undefined";
 *  - a missing PageRoute in App.tsx renders a blank page under a working link;
 *  - and a route path that drifts from the one the component fetches produces a
 *    404 the page reports as a generic error, with the numbers simply absent.
 *
 * The page also exists because the ingestion card MOVED here off the ClickHouse
 * datastore page. A re-added copy there would not fail anything — it would just
 * quietly show the same card twice and re-run the same query — so that removal
 * is asserted too.
 *
 * Same deferred-import + browser-stub shape as
 * App/Tests/AdminDashboard/UserProjectsPageWiring.test.ts.
 */

type RouteMapModule =
  typeof import("../../FeatureSet/AdminDashboard/src/Utils/RouteMap");
type PageMapModule =
  typeof import("../../FeatureSet/AdminDashboard/src/Utils/PageMap");

let RouteMap: RouteMapModule["default"];
let PageMap: PageMapModule["default"];

const ADMIN_DASHBOARD_SRC: string = nodePath.join(
  __dirname,
  "../../FeatureSet/AdminDashboard/src",
);

/*
 * Source text, read rather than imported. These files render React elements and
 * pull in Common/UI, and the registrations they hold are invariants no runtime
 * value exposes — asserting on the text is what makes deleting one of them fail
 * a test rather than a code review.
 *
 * Comments are stripped first so a file that explains a pattern in prose cannot
 * satisfy an assertion about the code. (This test's own subject matter is
 * heavily commented, so that stripping is doing real work here.)
 */
function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/[^\n]*/g, "$1");
}

function readAdminSource(relativePath: string): string {
  return stripComments(
    fs.readFileSync(nodePath.join(ADMIN_DASHBOARD_SRC, relativePath), "utf8"),
  );
}

function readAppSource(relativePath: string): string {
  return stripComments(
    fs.readFileSync(nodePath.join(__dirname, "../..", relativePath), "utf8"),
  );
}

function routePath(pageKey: string): string {
  const route: { toString: () => string } | undefined = RouteMap[pageKey];

  if (!route) {
    throw new Error(`No route registered for PageMap.${pageKey}`);
  }

  return route.toString();
}

const appSource: string = readAdminSource("App.tsx");
const sideMenuSource: string = readAdminSource("Pages/Health/SideMenu.tsx");
const overviewSource: string = readAdminSource("Pages/Health/Index.tsx");
const telemetryPageSource: string = readAdminSource(
  "Pages/Health/Telemetry.tsx",
);
const clickhousePageSource: string = readAdminSource(
  "Pages/Health/Clickhouse.tsx",
);
const byProjectSource: string = readAdminSource(
  "Pages/Health/TelemetryIngestionByProject.tsx",
);
const bySignalSource: string = readAdminSource(
  "Pages/Health/TelemetryIngestionBySignal.tsx",
);
const adminHealthApiSource: string = readAppSource("API/AdminHealth.ts");
const appIndexSource: string = readAppSource("Index.ts");

/*
 * Common/UI/Config reads `window` the moment it loads, and ObjectID is pulled in
 * transitively, so the browser stub has to exist before either of them does —
 * hence the deferred imports. A static import would be hoisted above the stub
 * and throw.
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
    "../../FeatureSet/AdminDashboard/src/Utils/RouteMap"
  );
  const pageMapModule: PageMapModule = await import(
    "../../FeatureSet/AdminDashboard/src/Utils/PageMap"
  );

  RouteMap = routeMapModule.default;
  PageMap = pageMapModule.default;
});

describe("Health > Telemetry route", () => {
  test("the page has a PageMap key", () => {
    expect(PageMap.HEALTH_TELEMETRY).toBe("HEALTH_TELEMETRY");
  });

  test("the key resolves to a route", () => {
    expect(RouteMap[PageMap.HEALTH_TELEMETRY]).toBeDefined();
  });

  /*
   * Derived from the health root rather than hard-coded, so moving the whole
   * health section moves this page with it instead of stranding it.
   */
  test("the route hangs off the health section", () => {
    expect(routePath(PageMap.HEALTH_TELEMETRY)).toBe(
      `${routePath(PageMap.HEALTH)}/telemetry`,
    );
  });

  // The page is instance-wide; a model id in the path would never be filled in.
  test("the route takes no parameters", () => {
    expect(routePath(PageMap.HEALTH_TELEMETRY)).not.toContain(":");
  });

  test("the route is distinct from every other health page", () => {
    const healthRoutes: Array<string> = Object.keys(PageMap)
      .filter((key: string): boolean => {
        return key.startsWith("HEALTH") && Boolean(RouteMap[key]);
      })
      .map((key: string): string => {
        return routePath(key);
      });

    expect(new Set(healthRoutes).size).toBe(healthRoutes.length);
  });
});

describe("Health > Telemetry page registration", () => {
  test("App.tsx imports the page", () => {
    expect(appSource).toContain(
      'import HealthTelemetry from "./Pages/Health/Telemetry"',
    );
  });

  test("App.tsx registers a route that renders it", () => {
    expect(appSource).toMatch(
      /RouteMap\[PageMap\.HEALTH_TELEMETRY\][\s\S]{0,120}element=\{<HealthTelemetry \/>\}/,
    );
  });

  test("the health side menu links to it", () => {
    expect(sideMenuSource).toContain("RouteMap[PageMap.HEALTH_TELEMETRY]");
  });

  /*
   * The user asked for it in Diagnostics specifically. Section membership is
   * positional in the side menu, so it is asserted positionally: the link has to
   * fall between the Diagnostics heading and the next section's.
   */
  test("the side-menu link sits in the Diagnostics section", () => {
    const diagnosticsAt: number = sideMenuSource.indexOf(
      'SideMenuSection title="Diagnostics"',
    );
    const nextSectionAt: number = sideMenuSource.indexOf(
      "SideMenuSection",
      sideMenuSource.indexOf("</SideMenuSection>", diagnosticsAt),
    );
    const linkAt: number = sideMenuSource.indexOf(
      "RouteMap[PageMap.HEALTH_TELEMETRY]",
    );

    expect(diagnosticsAt).toBeGreaterThan(-1);
    expect(linkAt).toBeGreaterThan(diagnosticsAt);
    expect(linkAt).toBeLessThan(nextSectionAt);
  });

  test("the health overview offers it as a shortcut", () => {
    expect(overviewSource).toContain("route(PageMap.HEALTH_TELEMETRY)");
  });
});

describe("Health > Telemetry page contents", () => {
  test("the page renders both views", () => {
    expect(telemetryPageSource).toContain("<TelemetryIngestionBySignal />");
    expect(telemetryPageSource).toContain("<TelemetryIngestionByProject />");
  });

  // The per-project breakdown is the new view, and it belongs in its own tab.
  test("the two views are tabs rather than stacked cards", () => {
    expect(telemetryPageSource).toContain("<Tabs");
    expect(telemetryPageSource).toMatch(/name:\s*"By signal"/);
    expect(telemetryPageSource).toMatch(/name:\s*"By project"/);
  });

  /*
   * Every other page under OneUptime Health is Enterprise-gated. A page that
   * forgot the flag would render its cards on Community and then fail every
   * request with a payment-required error the user cannot act on.
   */
  test("the page carries the same Enterprise gate as its siblings", () => {
    expect(telemetryPageSource).toContain("enterpriseOnly={true}");
  });

  test("the page uses the shared health layout, so it keeps the side menu", () => {
    expect(telemetryPageSource).toContain("<HealthPage");
    expect(telemetryPageSource).toContain(
      "currentRoute={RouteMap[PageMap.HEALTH_TELEMETRY] as Route}",
    );
  });
});

describe("the ingestion card moved off the ClickHouse page", () => {
  /*
   * The point of the move: the ClickHouse page is about the datastore (capacity,
   * shards, replication), and telemetry ingestion is about what the instance is
   * being sent. A re-added copy would show the same card twice across two pages
   * and re-run the same query on both.
   */
  test("the ClickHouse page no longer renders the ingestion card", () => {
    expect(clickhousePageSource).not.toContain("TelemetryIngestionBySignal");
    expect(clickhousePageSource).not.toContain("ClickhouseTelemetryIngestion");
  });

  test("the ClickHouse page keeps its datastore cards", () => {
    expect(clickhousePageSource).toContain("<ClickhouseCapacity />");
    expect(clickhousePageSource).toContain("<ClickhouseCluster />");
  });

  // The old file is gone, so nothing can import the superseded copy by accident.
  test("the superseded component file is deleted", () => {
    expect(
      fs.existsSync(
        nodePath.join(
          ADMIN_DASHBOARD_SRC,
          "Pages/Health/ClickhouseTelemetryIngestion.tsx",
        ),
      ),
    ).toBe(false);
  });
});

describe("API wiring", () => {
  const HEALTH_API_PREFIX: string = "/api/admin/health";

  /*
   * The components build their URLs as APP_API_URL + "/admin/health/<route>",
   * and the server mounts this router at "/api/admin/health". If either half
   * moves, every request 404s and the page shows an error instead of numbers.
   */
  test("the health router is mounted where the components look for it", () => {
    expect(appIndexSource).toContain(
      `expressApp.use("${HEALTH_API_PREFIX}", AdminHealthAPI)`,
    );
  });

  test("the by-signal card calls a route the API registers", () => {
    expect(bySignalSource).toContain(
      '"/admin/health/clickhouse-telemetry-ingestion"',
    );
    expect(adminHealthApiSource).toContain('"/clickhouse-telemetry-ingestion"');
  });

  test("the by-project card calls a route the API registers", () => {
    expect(byProjectSource).toContain(
      '"/admin/health/clickhouse-telemetry-ingestion-by-project"',
    );
    expect(adminHealthApiSource).toContain(
      '"/clickhouse-telemetry-ingestion-by-project"',
    );
  });

  /*
   * Per-project ingestion names every tenant on the instance. It has to sit
   * behind the same master-admin authorization as the rest of the health API —
   * a route registered without the middleware is reachable by any logged-in
   * user.
   */
  test("the by-project route is master-admin gated", () => {
    expect(adminHealthApiSource).toMatch(
      /"\/clickhouse-telemetry-ingestion-by-project",\s*MasterAdminAuthorization\.isAuthorizedMasterAdmin/,
    );
  });

  // Same Enterprise gate as the page that calls it, and as every sibling route.
  test("the by-project route is Enterprise-gated", () => {
    const routeAt: number = adminHealthApiSource.indexOf(
      '"/clickhouse-telemetry-ingestion-by-project"',
    );
    const handler: string = adminHealthApiSource.slice(routeAt, routeAt + 1200);

    expect(handler).toContain("if (!IsEnterpriseEdition)");
    expect(handler).toContain("PaymentRequiredException");
  });

  /*
   * Both views read the same table list and the same event-time columns from the
   * shared probe. Re-inlining either query is how the two tabs start disagreeing
   * about what counts as telemetry.
   */
  test("both views are served from the one shared probe", () => {
    expect(adminHealthApiSource).toContain(
      'from "Common/Server/Utils/InstanceHealth/TelemetryIngestion"',
    );
    expect(adminHealthApiSource).toContain("getTelemetryIngestionBySignal()");
    expect(adminHealthApiSource).toContain("getTelemetryIngestionByProject()");
  });

  /*
   * The support bundle carries the by-signal ingestion figures. Moving the probe
   * out of this file must not have dropped them from the bundle operators send
   * us when they report an ingest problem.
   */
  test("the support bundle still carries the by-signal ingestion figures", () => {
    expect(adminHealthApiSource).toContain("clickhouseTelemetryIngestion,");
  });
});

describe("project names", () => {
  /*
   * ClickHouse only knows tenants by id. Resolving names by listing every
   * project and matching in memory would be a full table read on a large
   * instance; the route resolves exactly the ids that reported ingestion.
   */
  test("names are resolved for the reporting projects only", () => {
    const functionAt: number = adminHealthApiSource.indexOf(
      "async function getClickhouseTelemetryIngestionByProject",
    );
    const body: string = adminHealthApiSource.slice(
      functionAt,
      functionAt + 2500,
    );

    expect(functionAt).toBeGreaterThan(-1);
    expect(body).toContain("QueryHelper.any(projectIds)");
    expect(body).toContain("attachProjectNames(");
  });

  /*
   * Names are a nicety; the volumes are the point. A Postgres hiccup has to
   * leave the rows labelled by id rather than failing the whole page.
   */
  test("a name lookup failure does not fail the request", () => {
    const functionAt: number = adminHealthApiSource.indexOf(
      "async function getClickhouseTelemetryIngestionByProject",
    );
    const body: string = adminHealthApiSource.slice(
      functionAt,
      functionAt + 2500,
    );

    expect(body).toMatch(/catch \(err\)/);
  });
});
