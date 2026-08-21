import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * Regression test for #2986: GET https://<host>/heartbeat/<secretkey> came
 * back as the dashboard SPA's HTML at HTTP 200, and the monitor stayed
 * Offline because the heartbeat never reached the ingest queue.
 *
 * Four files have to agree for a heartbeat GET to work, and no single one of
 * them is wrong on its own:
 *
 *   1. Nginx rewrites /heartbeat/<key> to /incoming-request/<key> before
 *      proxying, so the App never sees the "/heartbeat" prefix it reserves.
 *   2. Telemetry mounts IncomingRequestAPI on "/" as well as on
 *      "/incoming-request-ingest", so the rewritten path is a root-level one.
 *   3. FrontendRoutes.init() runs BEFORE TelemetryRoutes.init(), so the
 *      dashboard's app.get("*") fallback is registered first and answers the
 *      GET unless the path is on DashboardFallbackRoutePrefixesToSkip.
 *   4. The ingest router registers GET as well as POST - which is why POST
 *      always worked and only GET regressed.
 *
 * Each assertion below pins one of those four, so moving the rewrite target,
 * un-mounting the root prefix, dropping the reservation, or deleting the GET
 * registration fails here rather than in a self-hosted install's monitor.
 *
 * The prefix arrays are module-private, so this reads the source the same way
 * VendorAssetRouteReservation.test.ts does.
 */

const APP_DIR: string = path.join(__dirname, "..", "..");
const REPO_ROOT: string = path.join(APP_DIR, "..");

function readSource(...segments: Array<string>): string {
  return fs.readFileSync(path.join(...segments), "utf8");
}

const FRONTEND_INDEX: string = readSource(
  APP_DIR,
  "FeatureSet",
  "Frontend",
  "Index.ts",
);

const NGINX_TEMPLATE: string = readSource(
  REPO_ROOT,
  "Nginx",
  "default.conf.template",
);

const INCOMING_REQUEST_ROUTER: string = readSource(
  APP_DIR,
  "FeatureSet",
  "Telemetry",
  "API",
  "IncomingRequestIngest",
  "IncomingRequest.ts",
);

const TELEMETRY_INDEX: string = readSource(
  APP_DIR,
  "FeatureSet",
  "Telemetry",
  "Index.ts",
);

const APP_INDEX: string = readSource(APP_DIR, "Index.ts");

function dashboardFallbackSkipPrefixes(): Array<string> {
  const declaration: RegExpMatchArray | null = FRONTEND_INDEX.match(
    /const DashboardFallbackRoutePrefixesToSkip: Array<string> = \[([\s\S]*?)\n\];/,
  );

  if (!declaration || !declaration[1]) {
    return [];
  }

  return (declaration[1].match(/"([^"]+)"/g) || []).map(
    (entry: string): string => {
      return entry.replace(/"/g, "");
    },
  );
}

/* Mirrors shouldSkipDashboardFallbackRoute in FeatureSet/Frontend/Index.ts. */
function isReserved(prefixes: Array<string>, requestPath: string): boolean {
  return prefixes.some((prefix: string) => {
    return requestPath === prefix || requestPath.startsWith(`${prefix}/`);
  });
}

describe("the nginx heartbeat rewrite target is reserved against the dashboard SPA fallback", () => {
  const rewriteTarget: string | undefined = NGINX_TEMPLATE.match(
    /rewrite\s+\^\/heartbeat\(\.\*\)\$\s+(\/\S+)\$1\s+break;/,
  )?.[1];

  const prefixes: Array<string> = dashboardFallbackSkipPrefixes();

  test("the nginx /heartbeat block still rewrites to a different path", () => {
    /*
     * If the rewrite is ever dropped the App would receive "/heartbeat/<key>"
     * directly, which is already reserved - so this test would be asserting
     * nothing without first proving the rewrite exists.
     */
    expect(rewriteTarget).toBe("/incoming-request");
  });

  test("the fallback skip list was found and parsed", () => {
    // A rename would otherwise make the assertions below vacuous.
    expect(prefixes.length).toBeGreaterThan(3);
  });

  test("reserves whatever nginx rewrites /heartbeat to", () => {
    expect(prefixes).toContain(rewriteTarget);
  });

  test("reserves the rewritten heartbeat path itself, not just the bare prefix", () => {
    expect(
      isReserved(prefixes, `${rewriteTarget}/some-monitor-secret-key`),
    ).toBe(true);
  });

  test("still reserves the explicitly prefixed ingest mount", () => {
    /*
     * "/incoming-request" does not cover "/incoming-request-ingest/..." - the
     * predicate matches on "<prefix>/" - so both entries have to stay.
     */
    expect(prefixes).toContain("/incoming-request-ingest");
    expect(
      isReserved(
        prefixes,
        "/incoming-request-ingest/incoming-request/some-monitor-secret-key",
      ),
    ).toBe(true);
  });

  test("the reservation is needed because ingest is mounted at the root prefix", () => {
    const mountedPrefixes: RegExpMatchArray | null = TELEMETRY_INDEX.match(
      /const INCOMING_REQUEST_PREFIXES: Array<string> = \[([\s\S]*?)\n\];/,
    );

    expect(mountedPrefixes?.[1]).toContain('"/"');
    expect(TELEMETRY_INDEX).toContain(
      "app.use(INCOMING_REQUEST_PREFIXES, IncomingRequestAPI);",
    );
  });

  test("the frontend fallback is registered before the telemetry ingest routes", () => {
    /*
     * The reservation only matters while this ordering holds. If telemetry
     * ever inits first the entry becomes belt and braces rather than the fix.
     */
    const frontendInitIndex: number = APP_INDEX.indexOf(
      "await FrontendRoutes.init();",
    );
    const telemetryInitIndex: number = APP_INDEX.indexOf(
      "await TelemetryRoutes.init();",
    );

    expect(frontendInitIndex).toBeGreaterThan(-1);
    expect(telemetryInitIndex).toBeGreaterThan(-1);
    expect(frontendInitIndex).toBeLessThan(telemetryInitIndex);
  });

  test.each(["get", "post"])(
    "the ingest router answers %s on the rewritten path",
    (method: string) => {
      /*
       * Only GET regressed, because the dashboard fallback is app.get("*").
       * Both are pinned so the asymmetry cannot come back from either side.
       */
      expect(INCOMING_REQUEST_ROUTER).toMatch(
        new RegExp(`router\\.${method}\\(\\s*"/incoming-request/:secretkey"`),
      );
    },
  );
});
