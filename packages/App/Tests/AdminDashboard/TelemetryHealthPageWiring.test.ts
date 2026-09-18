import { beforeAll, describe, expect, test } from "@jest/globals";
import fs from "fs";
import nodePath from "path";

/*
 * Instance Health > Diagnostics > Telemetry is reached through independent
 * hand-written wirings — a PageMap key, a RouteMap Route, a PageRoute in
 * App.tsx and a SideMenuItem — and it is fed by two API routes whose paths are
 * typed out separately in the server and in the screens that call them.
 * Nothing ties any of that together, and every one of them fails quietly:
 *
 *  - a missing RouteMap entry makes RouteUtil.populateRouteParams stringify
 *    `undefined`, so the side-menu link and the breadcrumb both point at
 *    "/undefined";
 *  - a missing PageRoute in App.tsx renders a blank page under a working link;
 *  - and a route path that drifts from the one the screen fetches produces a
 *    404 the page reports as a generic error, with the numbers simply absent.
 *
 * Telemetry ingestion is an Enterprise Edition screen. Its content (the two
 * tabs and the components that call the API) ships in the enterprise plugin
 * under ee/, which the Community build does not contain, so this core suite
 * pins only what core owns: the route, the page shell that renders the plugin
 * or the upsell, the Health layout, and the server routes. The screen-side
 * pins live with the screens in ee/Tests/UI/Health.
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

const HEALTH_PAGES_DIR: string = nodePath.join(
  ADMIN_DASHBOARD_SRC,
  "Pages/Health",
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
const telemetryPageSource: string = readAdminSource(
  "Pages/Health/Telemetry.tsx",
);
const clickhousePageSource: string = readAdminSource(
  "Pages/Health/Clickhouse.tsx",
);
const healthLayoutSource: string = readAdminSource(
  "Pages/Health/HealthPage.tsx",
);
const adminHealthApiSource: string = readAppSource("API/AdminHealth.ts");
const appIndexSource: string = readAppSource("Index.ts");

/*
 * Every Health page whose content is an Enterprise feature, and the plugin
 * key its shell renders. The Community pages (ClickHouse capacity, the
 * instance log, probes, migrations, the support bundle) are not in this list.
 */
const ENTERPRISE_HEALTH_SHELLS: Array<{ file: string; pluginKey: string }> = [
  { file: "Index.tsx", pluginKey: "HealthOverview" },
  { file: "Queues.tsx", pluginKey: "HealthQueues" },
  { file: "Postgres.tsx", pluginKey: "HealthPostgres" },
  { file: "Redis.tsx", pluginKey: "HealthRedis" },
  { file: "Logs.tsx", pluginKey: "HealthLogs" },
  { file: "Telemetry.tsx", pluginKey: "HealthTelemetry" },
  { file: "QueryConsole.tsx", pluginKey: "HealthQueryConsole" },
  { file: "Clickhouse.tsx", pluginKey: "HealthClickhouseCluster" },
];

// The Enterprise screens that moved to ee/AdminDashboard/Health.
const MOVED_TO_ENTERPRISE: Array<string> = [
  "BackgroundQueues.tsx",
  "ClickhouseCluster.tsx",
  "DiagnosticLogs.tsx",
  "PostgresCluster.tsx",
  "PostgresHealthSettings.tsx",
  "RedisHealth.tsx",
  "RedisHealthSettings.tsx",
  "TelemetryIngestionByProject.tsx",
  "TelemetryIngestionBySignal.tsx",
  "TelemetryIngestionUtils.ts",
];

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
});

describe("Health > Telemetry page shell", () => {
  test("renders the enterprise Telemetry plugin, or the upsell", () => {
    expect(telemetryPageSource).toContain("<EnterprisePluginPage");
    expect(telemetryPageSource).toContain(
      "getAdminDashboardPlugins().HealthTelemetry",
    );
    expect(telemetryPageSource).toContain("<EnterpriseHealthUpgrade");
    expect(telemetryPageSource).toContain('featureName="Telemetry ingestion"');
  });

  test("the page uses the shared health layout, so it keeps the side menu", () => {
    expect(telemetryPageSource).toContain("<HealthPage");
    expect(telemetryPageSource).toContain(
      "currentRoute={RouteMap[PageMap.HEALTH_TELEMETRY] as Route}",
    );
  });

  // The screens it used to import directly are enterprise code now.
  test("does not import the enterprise screens", () => {
    expect(telemetryPageSource).not.toContain("TelemetryIngestionBySignal");
    expect(telemetryPageSource).not.toContain("TelemetryIngestionByProject");
  });
});

describe("the Health pages decide the edition in one place", () => {
  /*
   * The layout used to carry an `enterpriseOnly` flag that read the raw
   * edition; a page that forgot it rendered Enterprise cards on the Community
   * Edition and then failed every request with a payment-required error.
   */
  test("the Health layout has no edition gate of its own", () => {
    expect(healthLayoutSource).not.toContain("enterpriseOnly");
    expect(healthLayoutSource).not.toContain("IS_ENTERPRISE_EDITION");
    expect(healthLayoutSource).not.toContain("EnterpriseHealthUpgrade");
  });

  test("no Health page passes the removed enterpriseOnly flag", () => {
    for (const file of fs.readdirSync(HEALTH_PAGES_DIR)) {
      expect({
        file,
        enterpriseOnly: readAdminSource(`Pages/Health/${file}`).includes(
          "enterpriseOnly",
        ),
      }).toEqual({ file, enterpriseOnly: false });
    }
  });

  test.each(ENTERPRISE_HEALTH_SHELLS)(
    "$file renders its Enterprise content through the $pluginKey plugin",
    (shell: { file: string; pluginKey: string }) => {
      const source: string = readAdminSource(`Pages/Health/${shell.file}`);

      expect(source).toContain("<EnterprisePluginPage");
      expect(source).toContain(`getAdminDashboardPlugins().${shell.pluginKey}`);
      expect(source).toContain("<HealthPage");
      expect(source).toContain("renderUpsell=");
    },
  );

  test.each(MOVED_TO_ENTERPRISE)(
    "%s is no longer in the Community Admin Dashboard",
    (file: string) => {
      expect(fs.existsSync(nodePath.join(HEALTH_PAGES_DIR, file))).toBe(false);
    },
  );

  test("no Health page imports a screen that moved to ee", () => {
    for (const file of fs.readdirSync(HEALTH_PAGES_DIR)) {
      const source: string = readAdminSource(`Pages/Health/${file}`);

      for (const moved of MOVED_TO_ENTERPRISE) {
        const moduleName: string = moved.replace(/\.tsx?$/, "");

        expect({
          file,
          imports: source.includes(`from "./${moduleName}"`),
        }).toEqual({ file, imports: false });
      }
    }
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

  /*
   * Capacity and its settings are Community features (capacity alerts and
   * automatic pruning run on every edition), so they render outside the
   * plugin; only the cluster section is Enterprise.
   */
  test("the ClickHouse page keeps its datastore cards, capacity on every edition", () => {
    expect(clickhousePageSource).toContain("<ClickhouseCapacity />");
    expect(clickhousePageSource).toContain("<ClickhouseCapacitySettings />");
    expect(clickhousePageSource).toContain(
      "getAdminDashboardPlugins().HealthClickhouseCluster",
    );

    const pluginAt: number = clickhousePageSource.indexOf(
      "<EnterprisePluginPage",
    );
    const pluginEnd: number = clickhousePageSource.indexOf("/>", pluginAt);
    const capacityAt: number = clickhousePageSource.indexOf(
      "<ClickhouseCapacity />",
    );
    const settingsAt: number = clickhousePageSource.indexOf(
      "<ClickhouseCapacitySettings />",
    );

    // Both capacity cards sit outside the plugin element.
    expect(capacityAt).toBeLessThan(pluginAt);
    expect(settingsAt).toBeGreaterThan(pluginEnd);
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
   * The screens build their URLs as APP_API_URL + "/admin/health/<route>",
   * and the server mounts this router at "/api/admin/health". If either half
   * moves, every request 404s and the page shows an error instead of numbers.
   */
  test("the health router is mounted where the screens look for it", () => {
    expect(appIndexSource).toContain(
      `expressApp.use("${HEALTH_API_PREFIX}", AdminHealthAPI)`,
    );
  });

  test("the API registers both ingestion routes", () => {
    expect(adminHealthApiSource).toContain('"/clickhouse-telemetry-ingestion"');
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

  /*
   * Same licensed gate as every other live dashboard route: the Enterprise
   * Edition with a license that covers instance health (OneUptime Cloud
   * always passes). Never the raw IS_ENTERPRISE_EDITION flag.
   */
  test("both ingestion routes are license-gated", () => {
    for (const route of [
      '"/clickhouse-telemetry-ingestion"',
      '"/clickhouse-telemetry-ingestion-by-project"',
    ]) {
      const routeAt: number = adminHealthApiSource.indexOf(route);
      const handler: string = adminHealthApiSource.slice(
        routeAt,
        routeAt + 600,
      );

      expect(handler).toContain("EnterpriseEdition.assertFeatureAvailable(");
      expect(handler).toContain("EnterpriseFeature.InstanceHealth");
      expect(handler).not.toContain("IsEnterpriseEdition");
    }
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
   * The support bundle carries the by-signal ingestion figures, on every
   * edition. Moving the probe out of this file must not have dropped them
   * from the bundle operators send us when they report an ingest problem.
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
