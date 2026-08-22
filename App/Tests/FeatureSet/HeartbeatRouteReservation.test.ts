import { describe, expect, test } from "@jest/globals";
import {
  APP_DIR,
  REPO_ROOT,
  arrayEntries,
  isReserved,
  readSource,
  stripComments,
} from "./RouteReservationSource";

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
 * The prefix arrays are module-private, so this reads the source, using the
 * shared parser in ./RouteReservationSource. That parser strips comments
 * before reading entries and resolves the `...IngestRoutePrefixesToSkip`
 * spread the lists share; the reasoning for both is documented there, and
 * the test below guards that this file still benefits from it.
 *
 * This file pins the specific #2986 path. The general rule - every GET route
 * mounted at the root by a later feature set must be reserved - is derived
 * from the mounts themselves in RootMountedRouteReservation.test.ts.
 */

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

describe("the nginx heartbeat rewrite target is reserved against the dashboard SPA fallback", () => {
  const rewriteTarget: string | undefined = NGINX_TEMPLATE.match(
    /rewrite\s+\^\/heartbeat\(\.\*\)\$\s+(\/\S+)\$1\s+break;/,
  )?.[1];

  const prefixes: Array<string> = arrayEntries(
    FRONTEND_INDEX,
    "DashboardFallbackRoutePrefixesToSkip",
  );

  test("the nginx /heartbeat block still rewrites to some other path", () => {
    /*
     * Everything below is about the REWRITTEN path. If the rewrite is ever
     * dropped the App would receive "/heartbeat/<key>" directly - separately
     * reserved - and these assertions would be answering the wrong question,
     * so prove the rewrite exists before trusting its target. Today it is
     * "/incoming-request"; the target is not hardcoded, so a deliberate
     * retarget stays green as long as the new target is reserved too.
     */
    expect(rewriteTarget).toBeDefined();
    expect(rewriteTarget).toMatch(/^\/[a-z-]/);
  });

  test("the fallback skip list was found and parsed", () => {
    // A rename would otherwise make the assertions below vacuous.
    expect(prefixes.length).toBeGreaterThan(3);
  });

  test("the parser reads entries only, never quoted paths in comments", () => {
    /*
     * The guard on this file's own method. The reserved prefixes carry
     * comments that quote OTHER real paths - "/telemetry" and "/" in the
     * session-replay note, for instance - so a scrape-every-string parser
     * reports more prefixes than there are entries, and "/" alone would make
     * isReserved answer true for every path on earth. That parser would keep
     * this suite green through the exact deletion it exists to catch.
     *
     * Stripping comments first must therefore change nothing.
     */
    const source: string = FRONTEND_INDEX.slice(
      FRONTEND_INDEX.indexOf("const IngestRoutePrefixesToSkip"),
    );
    const body: string = source.slice(0, source.indexOf("];"));

    /*
     * There is prose quoting a bare "/" in there, and it must not become an
     * entry: a "/" prefix would make isReserved answer true for every path.
     */
    expect(body).toMatch(/\/\*[\s\S]*"\/"[\s\S]*?\*\//);
    expect(prefixes).not.toContain("/");
    expect(prefixes).toEqual(
      arrayEntries(
        stripComments(FRONTEND_INDEX),
        "DashboardFallbackRoutePrefixesToSkip",
      ),
    );
    expect(
      prefixes.every((entry: string) => {
        return entry.startsWith("/");
      }),
    ).toBe(true);
  });

  test("reserves the rewritten heartbeat path", () => {
    /*
     * isReserved, not toContain: a retarget to a deeper path (say
     * "/incoming-request-ingest/incoming-request") is reserved by its parent
     * without appearing in the list verbatim.
     */
    expect(isReserved(prefixes, `${rewriteTarget}`)).toBe(true);
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

  test("isReserved still mirrors the predicate the server actually runs", () => {
    /*
     * isReserved above is a copy. If shouldSkipDashboardFallbackRoute ever
     * became an exact match, the copy would keep passing while the server
     * stopped covering "/incoming-request/<key>".
     */
    expect(FRONTEND_INDEX).toContain("path.startsWith(`${prefix}/`)");
    expect(FRONTEND_INDEX).toContain("if (path === prefix)");
  });

  test("the reservation is needed because ingest is mounted at the root prefix", () => {
    expect(
      arrayEntries(TELEMETRY_INDEX, "INCOMING_REQUEST_PREFIXES"),
    ).toContain("/");
    expect(stripComments(TELEMETRY_INDEX)).toContain(
      "app.use(INCOMING_REQUEST_PREFIXES, IncomingRequestAPI);",
    );
  });

  test("the frontend fallback is registered before the telemetry ingest routes", () => {
    /*
     * The reservation only matters while this ordering holds. If telemetry
     * ever inits first the entry becomes belt and braces rather than the fix.
     */
    const code: string = stripComments(APP_INDEX);
    const frontendInitIndex: number = code.indexOf(
      "await FrontendRoutes.init();",
    );
    const telemetryInitIndex: number = code.indexOf(
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
       * Comments are stripped first so a commented-out registration cannot
       * satisfy this.
       */
      expect(stripComments(INCOMING_REQUEST_ROUTER)).toMatch(
        new RegExp(`router\\.${method}\\(\\s*"/incoming-request/:secretkey"`),
      );
    },
  );
});
