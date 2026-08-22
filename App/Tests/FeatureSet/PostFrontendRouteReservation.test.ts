import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import {
  DashboardFallbackRoutePrefixesToSkip,
  StatusPageDomainFallbackRoutePrefixesToSkip,
  isRouteReservedAgainstSpaFallback,
} from "../../FeatureSet/Frontend/RouteReservations";
import {
  APP_DIR,
  firstPathSegment,
  joinMountAndRoute,
  parseSourceFile,
  scanAppGetPaths,
  scanAppUseMounts,
  scanRouterGetPaths,
  stripComments,
  UnreadableMount,
} from "./RouteReservationSource";

/*
 * The general guard for the bug class behind #2986, derived from the mounts
 * rather than hard-coded.
 *
 * App/Index.ts calls FrontendRoutes.init() before the remaining feature sets.
 * Frontend registers two app.get("*") fallbacks, so by the time a later
 * feature set registers ANY GET - through a router mounted with app.use, or
 * directly with app.get - the catch-alls are already ahead of it in Express's
 * stack and answer first. The caller gets SPA HTML at HTTP 200. Nothing logs
 * and nothing 404s, so it surfaces as "the integration silently does nothing":
 *
 *   - #2986: heartbeat monitors stayed Offline forever.
 *   - /metrics/telemetry-writer-shed-rate: KEDA cannot read shedCount out of
 *     HTML, falls back, and the writer tier never scales on shed rate.
 *
 * So this file hard-codes no prefixes. It reads the init order out of
 * App/Index.ts, takes the feature sets that follow Frontend, and for each one
 * works out every path it answers GET on:
 *
 *   every app.use(prefix, router) x every GET the router registers,
 *   plus every direct app.get(path),
 *
 * then requires the first segment of each to be reserved. Add a GET route in
 * one of those feature sets without reserving its prefix and this fails,
 * naming the route and the prefix to add.
 *
 * Two properties matter as much as the assertion itself:
 *
 *   1. The reservation lists are IMPORTED, not parsed. The values under test
 *      are the ones the server uses.
 *   2. Anything the scanner cannot resolve statically is surfaced and must be
 *      explicitly accounted for below. The previous regex version of this
 *      scan silently skipped 11 of 31 mounts - including every Prettier-
 *      reflowed one - and so would have passed a newly added root mount.
 */

const APP_INDEX_PATH: string = path.join(APP_DIR, "Index.ts");

/*
 * Mounts whose prefix or router is computed at runtime and so cannot be read
 * from source. Each needs a human to have checked it. Anything NOT on this
 * list that the scanner cannot read fails the suite.
 */
const REVIEWED_UNREADABLE_MOUNTS: Array<{
  featureSet: string;
  contains: string;
  why: string;
}> = [
  {
    featureSet: "Workers",
    contains: "Queue.getInspectorRoute()",
    why:
      "Common/Server/Infrastructure/Queue.ts returns the constant " +
      '"/worker/inspect/queue/:dashboardSecret", whose first segment "/worker" ' +
      "is reserved on both lists.",
  },
];

/*
 * Prefixes deliberately NOT reserved against the custom-domain (status page)
 * fallback. These are human-facing pages, and a visitor to a customer's
 * status-page domain should get that status page, not OneUptime's docs. No
 * machine polls them - unlike /metrics, which is why that one is reserved on
 * both lists.
 */
const STATUS_PAGE_FALLBACK_INTENTIONAL: Array<string> = [
  "/docs",
  "/reference",
  "/workflow",
];

interface DerivedRoute {
  featureSet: string;
  origin: string;
  requestPath: string;
  segment: string;
}

function featureSetsInitialisedAfterFrontend(): Array<string> {
  const code: string = stripComments(fs.readFileSync(APP_INDEX_PATH, "utf8"));
  const initialised: Array<string> = [
    ...code.matchAll(/await (\w+)Routes\.init\(\)/g),
  ].map((match: RegExpMatchArray): string => {
    return match[1] as string;
  });

  const frontendIndex: number = initialised.indexOf("Frontend");

  if (frontendIndex < 0) {
    throw new Error(
      "Could not find `await FrontendRoutes.init()` in App/Index.ts. The " +
        "whole premise of this file is that ordering, so refusing to run.",
    );
  }

  return initialised
    .slice(frontendIndex + 1)
    .filter((featureSet: string): boolean => {
      return fs.existsSync(
        path.join(APP_DIR, "FeatureSet", featureSet, "Index.ts"),
      );
    });
}

interface Derivation {
  routes: Array<DerivedRoute>;
  unreadable: Array<UnreadableMount & { featureSet: string }>;
  featureSets: Array<string>;
  routersRead: Array<string>;
}

function derive(): Derivation {
  const routes: Array<DerivedRoute> = [];
  const unreadable: Array<UnreadableMount & { featureSet: string }> = [];
  const routersRead: Array<string> = [];
  const featureSets: Array<string> = featureSetsInitialisedAfterFrontend();

  const record: (
    featureSet: string,
    origin: string,
    requestPath: string,
  ) => void = (
    featureSet: string,
    origin: string,
    requestPath: string,
  ): void => {
    const segment: string | null = firstPathSegment(requestPath);

    if (segment) {
      routes.push({
        featureSet: featureSet,
        origin: origin,
        requestPath: requestPath,
        segment: segment,
      });
    }
  };

  for (const featureSet of featureSets) {
    const indexPath: string = path.join(
      APP_DIR,
      "FeatureSet",
      featureSet,
      "Index.ts",
    );
    const sourceFile: ReturnType<typeof parseSourceFile> =
      parseSourceFile(indexPath);

    // Direct app.get(...) registrations, as Docs and APIReference use.
    const direct: ReturnType<typeof scanAppGetPaths> =
      scanAppGetPaths(sourceFile);

    for (const routePath of direct.getPaths) {
      record(featureSet, `${featureSet}/Index.ts app.get`, routePath);
    }

    for (const item of direct.unreadable) {
      unreadable.push({ ...item, featureSet: featureSet });
    }

    // Routers mounted with app.use(...).
    const scan: ReturnType<typeof scanAppUseMounts> =
      scanAppUseMounts(sourceFile);

    for (const item of scan.unreadable) {
      unreadable.push({ ...item, featureSet: featureSet });
    }

    for (const mount of scan.mounts) {
      /*
       * A static-file mount answers GET on everything below its own prefix,
       * so the prefix itself is the thing that needs reserving.
       */
      if (mount.isStaticFileMount) {
        for (const mountPath of mount.mountPaths) {
          record(featureSet, `${featureSet}/${mount.routerText}`, mountPath);
        }

        continue;
      }

      if (!mount.routerFile) {
        continue;
      }

      routersRead.push(`${featureSet}/${path.basename(mount.routerFile)}`);

      const router: ReturnType<typeof scanRouterGetPaths> = scanRouterGetPaths(
        parseSourceFile(mount.routerFile),
      );

      for (const item of router.unreadable) {
        unreadable.push({ ...item, featureSet: featureSet });
      }

      for (const mountPath of mount.mountPaths) {
        for (const routePath of router.getPaths) {
          record(
            featureSet,
            `${featureSet}/${mount.routerText}`,
            joinMountAndRoute(mountPath, routePath),
          );
        }
      }
    }
  }

  return {
    routes: routes,
    unreadable: unreadable,
    featureSets: featureSets,
    routersRead: routersRead,
  };
}

const DERIVED: Derivation = derive();

const SEGMENTS: Array<string> = [
  ...new Set(
    DERIVED.routes.map((route: DerivedRoute): string => {
      return route.segment;
    }),
  ),
].sort();

describe("the derivation itself is sound", () => {
  test("it read the feature sets that initialise after Frontend", () => {
    /*
     * Everything else is vacuous if this came back empty, and a rename in
     * App/Index.ts is exactly the kind of change that would empty it.
     */
    expect(DERIVED.featureSets).toEqual(
      expect.arrayContaining([
        "Docs",
        "APIReference",
        "Workers",
        "Telemetry",
        "Workflow",
        "Runbook",
      ]),
    );
  });

  test("every feature set in scope contributed at least one readable mount or route", () => {
    /*
     * The failure this catches is a whole feature set silently dropping out
     * of the scan - which is what the previous regex version did to five of
     * the six, while still passing a count-based canary.
     */
    const contributing: Set<string> = new Set(
      DERIVED.routes.map((route: DerivedRoute): string => {
        return route.featureSet;
      }),
    );

    expect([...contributing].sort()).toEqual(
      [...DERIVED.featureSets].sort().filter((featureSet: string): boolean => {
        return featureSet !== "Runbook";
      }),
    );
  });

  test("Runbook is in scope but genuinely registers no GET route", () => {
    /*
     * Pinned rather than ignored: Runbook mounts /runbook, /runner-ingest and
     * /runbook-agent-ingest, none of which is on either skip list. That is
     * only safe while those routers stay POST-only. The moment one grows a
     * GET, the test above starts requiring it here and the reservation
     * assertions below start demanding the prefix.
     */
    const runbookRoutes: Array<DerivedRoute> = DERIVED.routes.filter(
      (route: DerivedRoute): boolean => {
        return route.featureSet === "Runbook";
      },
    );

    expect(runbookRoutes).toEqual([]);
  });

  test("it found the specific routes this guard exists for", () => {
    const paths: Array<string> = DERIVED.routes.map(
      (route: DerivedRoute): string => {
        return route.requestPath;
      },
    );

    // The KEDA path, and the #2986 heartbeat ingest path.
    expect(paths).toContain("/metrics/telemetry-writer-shed-rate");
    expect(paths).toContain("/incoming-request/:secretkey");

    /*
     * A route reachable only through a prefixed alias, and one whose path is
     * a template literal - both invisible to the regex scanner this replaced.
     */
    expect(paths).toContain(
      "/server-monitor-ingest/server-monitor/queue/stats",
    );
    expect(paths).toContain("/workflow/model-schema/:tableName");
  });

  test("it read routers behind every mount idiom the repo uses", () => {
    /*
     * `new FooAPI().router`, a local `const x = new FooAPI()`, a plain
     * imported identifier, and a template-literal prefix. Losing any of these
     * is a silent loss of coverage.
     */
    expect(DERIVED.routersRead).toEqual(
      expect.arrayContaining(
        ["TelemetryWriter.ts", "Metrics.ts", "Manual.ts", "Runbook.ts"].map(
          (file: string): string => {
            return expect.stringContaining(file) as unknown as string;
          },
        ),
      ),
    );
  });

  test("nothing the scanner could not read is left unaccounted for", () => {
    /*
     * The rule that makes this guard trustworthy: an unresolvable mount or
     * route must be reviewed, not skipped. The regex version had an
     * unreachable throw and dropped 11 of 31 mounts in silence.
     */
    const unreviewed: Array<string> = DERIVED.unreadable
      .filter((item: UnreadableMount & { featureSet: string }): boolean => {
        return !REVIEWED_UNREADABLE_MOUNTS.some(
          (reviewed: { featureSet: string; contains: string }): boolean => {
            return (
              reviewed.featureSet === item.featureSet &&
              item.text.includes(reviewed.contains)
            );
          },
        );
      })
      .map((item: UnreadableMount & { featureSet: string }): string => {
        return `${item.featureSet}/Index.ts:${item.line} ${item.reason} -- ${item.text}`;
      });

    expect(unreviewed).toEqual([]);
  });

  test("the reviewed-unreadable list has not gone stale", () => {
    // An entry that no longer matches anything is a comment pretending to be a check.
    for (const reviewed of REVIEWED_UNREADABLE_MOUNTS) {
      expect(
        DERIVED.unreadable.some(
          (item: UnreadableMount & { featureSet: string }): boolean => {
            return (
              item.featureSet === reviewed.featureSet &&
              item.text.includes(reviewed.contains)
            );
          },
        ),
      ).toBe(true);
    }
  });
});

describe("every GET route registered after the SPA fallbacks is reserved", () => {
  test("the dashboard fallback skips all of them", () => {
    const unreserved: Array<string> = [
      ...new Set(
        DERIVED.routes
          .filter((route: DerivedRoute): boolean => {
            return !isRouteReservedAgainstSpaFallback(
              DashboardFallbackRoutePrefixesToSkip,
              route.requestPath,
            );
          })
          .map((route: DerivedRoute): string => {
            return `${route.requestPath} (${route.origin}) needs ${route.segment}`;
          }),
      ),
    ].sort();

    expect(unreserved).toEqual([]);
  });

  test("the custom-domain fallback skips all of them, bar the documented UI prefixes", () => {
    const unreserved: Array<string> = [
      ...new Set(
        DERIVED.routes
          .filter((route: DerivedRoute): boolean => {
            if (STATUS_PAGE_FALLBACK_INTENTIONAL.includes(route.segment)) {
              return false;
            }

            return !isRouteReservedAgainstSpaFallback(
              StatusPageDomainFallbackRoutePrefixesToSkip,
              route.requestPath,
            );
          })
          .map((route: DerivedRoute): string => {
            return `${route.requestPath} (${route.origin}) needs ${route.segment}`;
          }),
      ),
    ].sort();

    expect(unreserved).toEqual([]);
  });

  test("the intentional status-page exceptions are still only human-facing UI", () => {
    /*
     * Guards the exception list from being widened by habit. Each entry must
     * still be a real derived prefix, and must still be reserved on the
     * dashboard list - the exception is about custom domains only.
     */
    for (const prefix of STATUS_PAGE_FALLBACK_INTENTIONAL) {
      expect(SEGMENTS).toContain(prefix);
      expect(
        isRouteReservedAgainstSpaFallback(
          DashboardFallbackRoutePrefixesToSkip,
          prefix,
        ),
      ).toBe(true);
      expect(
        isRouteReservedAgainstSpaFallback(
          StatusPageDomainFallbackRoutePrefixesToSkip,
          prefix,
        ),
      ).toBe(false);
    }
  });

  test("a route on an unreserved prefix would actually be reported", () => {
    /*
     * The self-test. Every assertion above is "this list is empty", which is
     * also what a broken derivation produces, so prove the check has teeth by
     * running it over a fixture route that is deliberately not reserved.
     */
    const fixture: string = "/definitely-not-reserved/thing";

    expect(firstPathSegment(fixture)).toBe("/definitely-not-reserved");
    expect(
      isRouteReservedAgainstSpaFallback(
        DashboardFallbackRoutePrefixesToSkip,
        fixture,
      ),
    ).toBe(false);
    expect(
      isRouteReservedAgainstSpaFallback(
        StatusPageDomainFallbackRoutePrefixesToSkip,
        fixture,
      ),
    ).toBe(false);
  });
});
