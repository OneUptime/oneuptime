import { describe, expect, test } from "@jest/globals";
import path from "path";
import {
  DashboardFallbackRoutePrefixesToSkip,
  StatusPageDomainFallbackRoutePrefixesToSkip,
  isRouteReservedAgainstSpaFallback,
} from "../../FeatureSet/Frontend/RouteReservations";
import {
  APP_DIR,
  REPO_ROOT,
  parseSourceFile,
  readSource,
  RouterMount,
  scanAppUseMounts,
  scanRouterGetPaths,
  stripComments,
} from "./RouteReservationSource";

/*
 * Regression test for #2986: GET https://<host>/heartbeat/<secretkey> came
 * back as the dashboard SPA's HTML at HTTP 200, and the monitor stayed
 * Offline because the heartbeat never reached the ingest queue.
 *
 * Four things have to agree for a heartbeat GET to work, and no single one of
 * them is wrong on its own:
 *
 *   1. Nginx rewrites /heartbeat/<key> to /incoming-request/<key> before
 *      proxying, so the App never sees the "/heartbeat" prefix.
 *   2. Telemetry mounts IncomingRequestAPI on "/" as well as on
 *      "/incoming-request-ingest", so the rewritten path is a root-level one.
 *   3. FrontendRoutes.init() runs BEFORE TelemetryRoutes.init(), so the
 *      dashboard's app.get("*") fallback is registered first and answers the
 *      GET unless the path is reserved.
 *   4. The ingest router registers GET as well as POST - which is why POST
 *      always worked and only GET regressed.
 *
 * Each assertion below pins one of those four, so moving the rewrite target,
 * un-mounting the root prefix, dropping the reservation, or deleting the GET
 * registration fails here rather than in a self-hosted install's monitor.
 *
 * This file pins the specific #2986 path. The general rule - every GET route
 * a post-Frontend feature set registers must be reserved - is derived from
 * the mounts in PostFrontendRouteReservation.test.ts, and the runtime
 * behaviour is in SpaFallbackBehaviour.test.ts.
 */

const NGINX_TEMPLATE: string = readSource(
  REPO_ROOT,
  "Nginx",
  "default.conf.template",
);

const TELEMETRY_INDEX_PATH: string = path.join(
  APP_DIR,
  "FeatureSet",
  "Telemetry",
  "Index.ts",
);

const APP_INDEX: string = stripComments(readSource(APP_DIR, "Index.ts"));

const rewriteTarget: string | undefined = NGINX_TEMPLATE.match(
  /rewrite\s+\^\/heartbeat\(\.\*\)\$\s+(\/\S+)\$1\s+break;/,
)?.[1];

describe("the nginx heartbeat rewrite target is reserved against the SPA fallbacks", () => {
  test("the nginx /heartbeat block still rewrites to some other path", () => {
    /*
     * Everything below is about the REWRITTEN path. If the rewrite were ever
     * dropped the App would receive "/heartbeat/<key>" directly - separately
     * reserved - and these assertions would be answering the wrong question.
     * The target is not hardcoded, so a deliberate retarget stays green as
     * long as the new target is reserved too.
     */
    expect(rewriteTarget).toBeDefined();
    expect(rewriteTarget).toMatch(/^\/[a-z-]/);
  });

  test("reserves the rewritten heartbeat path on both lists", () => {
    /*
     * isReserved, not toContain: a retarget to a deeper path (say
     * "/incoming-request-ingest/incoming-request") is reserved by its parent
     * without appearing in either list verbatim.
     *
     * Both lists, because nginx passes the client's Host through, and a
     * heartbeat aimed at a status-page custom domain reaches the
     * custom-domain fallback rather than the dashboard one.
     */
    for (const list of [
      DashboardFallbackRoutePrefixesToSkip,
      StatusPageDomainFallbackRoutePrefixesToSkip,
    ]) {
      expect(isRouteReservedAgainstSpaFallback(list, `${rewriteTarget}`)).toBe(
        true,
      );
      expect(
        isRouteReservedAgainstSpaFallback(
          list,
          `${rewriteTarget}/some-monitor-secret-key`,
        ),
      ).toBe(true);
    }
  });

  test("still reserves the explicitly prefixed ingest mount", () => {
    /*
     * "/incoming-request" does not cover "/incoming-request-ingest/..." - the
     * predicate matches on "<prefix>/" - so both entries have to stay.
     */
    for (const list of [
      DashboardFallbackRoutePrefixesToSkip,
      StatusPageDomainFallbackRoutePrefixesToSkip,
    ]) {
      expect(list).toContain("/incoming-request-ingest");
      expect(
        isRouteReservedAgainstSpaFallback(
          list,
          "/incoming-request-ingest/incoming-request/some-monitor-secret-key",
        ),
      ).toBe(true);
    }
  });

  test("the reservation is needed because ingest is mounted at the root prefix", () => {
    const scan: ReturnType<typeof scanAppUseMounts> = scanAppUseMounts(
      parseSourceFile(TELEMETRY_INDEX_PATH),
    );

    const incomingRequestMount: RouterMount | undefined = scan.mounts.find(
      (mount: RouterMount): boolean => {
        return mount.routerText.includes("IncomingRequestAPI");
      },
    );

    expect(incomingRequestMount).toBeDefined();
    expect(incomingRequestMount?.mountPaths).toContain("/");
    expect(incomingRequestMount?.mountPaths).toContain(
      "/incoming-request-ingest",
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

  test("the ingest router answers GET, not only POST, on the rewritten path", () => {
    /*
     * Only GET regressed, because the fallbacks are app.get("*"). The GET
     * side is read from the parsed router, so a registration that is
     * commented out does not count.
     */
    const routerFile: string = path.join(
      APP_DIR,
      "FeatureSet",
      "Telemetry",
      "API",
      "IncomingRequestIngest",
      "IncomingRequest.ts",
    );

    const routes: ReturnType<typeof scanRouterGetPaths> = scanRouterGetPaths(
      parseSourceFile(routerFile),
    );

    expect(routes.getPaths).toContain("/incoming-request/:secretkey");
    expect(routes.unreadable).toEqual([]);
  });

  test("POST is registered too, so the asymmetry cannot come back", () => {
    const source: string = stripComments(
      readSource(
        APP_DIR,
        "FeatureSet",
        "Telemetry",
        "API",
        "IncomingRequestIngest",
        "IncomingRequest.ts",
      ),
    );

    expect(source).toMatch(/router\.post\(\s*"\/incoming-request\/:secretkey"/);
  });
});
