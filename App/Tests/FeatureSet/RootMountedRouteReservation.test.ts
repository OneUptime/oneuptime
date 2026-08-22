import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import {
  APP_DIR,
  arrayEntries,
  isReserved,
  readSource,
  stripComments,
} from "./RouteReservationSource";

/*
 * A general guard for the bug class behind #2986, rather than one more
 * entry in a denylist.
 *
 * App/Index.ts calls FrontendRoutes.init() before the remaining feature
 * sets. Frontend registers two app.get("*") fallbacks, so by the time a
 * later feature set mounts a router on "/" the catch-alls are already in
 * Express's stack and win every GET the router would have answered. The
 * caller gets SPA HTML at HTTP 200. Nothing logs and nothing 404s, so the
 * failure surfaces as "the integration silently does nothing":
 *
 *   - #2986: heartbeat monitors stayed Offline forever.
 *   - /metrics/telemetry-writer-shed-rate: KEDA cannot parse shedCount out
 *     of HTML, falls back, and the writer tier never scales on shed rate.
 *
 * The two skip lists are what hold the class off, and keeping them correct
 * by hand has failed repeatedly - each miss left a comment behind rather
 * than a test. So this file does not hard-code the prefixes that need
 * reserving. It derives them from the mounts themselves:
 *
 *   1. read the feature-set init order out of App/Index.ts and keep the
 *      ones that run after FrontendRoutes;
 *   2. in each of those, find every router mounted on "/";
 *   3. read that router's GET registrations;
 *   4. for every (mount x route) pair the router is reachable at, require
 *      the first path segment to be reserved in BOTH lists.
 *
 * Add a root-mounted GET route without reserving its prefix and this fails,
 * naming the route and the list that is missing it.
 *
 * Both lists, not just the dashboard one: the custom-domain fallback fires
 * whenever the Host is not a primary host, and cluster-internal callers
 * addressing a pod by Kubernetes service name land there too. KEDA polling
 * http://<release>-telemetry-writer:<port>/metrics/... is exactly that.
 */

const APP_INDEX: string = readSource(APP_DIR, "Index.ts");
const FRONTEND_INDEX: string = readSource(
  APP_DIR,
  "FeatureSet",
  "Frontend",
  "Index.ts",
);

/*
 * The init() calls in App/Index.ts are `await <Name>Routes.init();`, and the
 * feature set lives in FeatureSet/<Name>. Anything that does not resolve to
 * a directory (Realtime, which is not a feature set) is skipped.
 */
function featureSetsInitialisedAfterFrontend(): Array<string> {
  const code: string = stripComments(APP_INDEX);
  const initialised: Array<string> = [
    ...code.matchAll(/await (\w+)Routes\.init\(\);/g),
  ].map((match: RegExpMatchArray): string => {
    return match[1] as string;
  });

  const frontendIndex: number = initialised.indexOf("Frontend");

  if (frontendIndex < 0) {
    throw new Error(
      "Could not find `await FrontendRoutes.init();` in App/Index.ts.",
    );
  }

  return initialised
    .slice(frontendIndex + 1)
    .filter((featureSet: string): boolean => {
      return fs.existsSync(path.join(APP_DIR, "FeatureSet", featureSet));
    });
}

interface RootMount {
  featureSet: string;
  router: string;
  routerPath: string;
  mounts: Array<string>;
}

/*
 * Routers mounted on "/" by a feature set that initialises after Frontend.
 * The mount argument is either a literal, an inline array, or an
 * Array<string> constant in the same file.
 */
function rootMountsIn(featureSet: string): Array<RootMount> {
  const indexPath: string = path.join(
    APP_DIR,
    "FeatureSet",
    featureSet,
    "Index.ts",
  );

  if (!fs.existsSync(indexPath)) {
    return [];
  }

  const source: string = readSource(indexPath);
  const code: string = stripComments(source);
  const mounted: Array<RootMount> = [];

  const appUse: RegExp =
    /app\.use\(\s*(?:"([^"]+)"|\[([^\]]*)\]|([A-Z_][A-Z0-9_]*))\s*,\s*(\w+)\s*\)/g;

  for (const match of code.matchAll(appUse)) {
    const [, literal, inline, constant] = match;
    const router: string | undefined = match[4];

    if (!router) {
      throw new Error(
        `Could not read the router name out of ${JSON.stringify(
          match[0],
        )} in FeatureSet/${featureSet}/Index.ts.`,
      );
    }

    let mounts: Array<string>;

    if (literal) {
      mounts = [literal];
    } else if (inline !== undefined) {
      mounts = [...inline.matchAll(/"([^"]+)"/g)]
        .map((entry: RegExpMatchArray): string | undefined => {
          return entry[1];
        })
        .filter((entry: string | undefined): entry is string => {
          return entry !== undefined;
        });
    } else if (constant) {
      mounts = arrayEntries(source, constant);

      if (mounts.length === 0) {
        throw new Error(
          `Could not resolve mount prefixes "${constant}" in ` +
            `FeatureSet/${featureSet}/Index.ts.`,
        );
      }
    } else {
      throw new Error(
        `Unrecognised mount argument in ${JSON.stringify(match[0])} in ` +
          `FeatureSet/${featureSet}/Index.ts. It must be a string literal, ` +
          `an inline array, or an Array<string> constant, so that this test ` +
          `can tell whether the router is mounted at the root.`,
      );
    }

    if (!mounts.includes("/")) {
      continue;
    }

    const importMatch: RegExpMatchArray | null = code.match(
      new RegExp(`import ${router} from "([^"]+)"`),
    );

    if (!importMatch || !importMatch[1]) {
      throw new Error(
        `"${router}" is mounted on "/" in FeatureSet/${featureSet}/Index.ts ` +
          `but its import could not be found, so its GET routes cannot be ` +
          `checked for reservation.`,
      );
    }

    const routerPath: string = `${path.join(
      APP_DIR,
      "FeatureSet",
      featureSet,
      importMatch[1].replace(/^\.\//, ""),
    )}.ts`;

    if (!fs.existsSync(routerPath)) {
      throw new Error(
        `Router source for "${router}" not found at ${routerPath}.`,
      );
    }

    mounted.push({
      featureSet: featureSet,
      router: router,
      routerPath: routerPath,
      mounts: mounts,
    });
  }

  return mounted;
}

interface ReachableRoute {
  origin: string;
  requestPath: string;
  segment: string;
}

/*
 * Every path a root-mounted router answers GET on. A router mounted on
 * ["/probe-ingest", "/"] with a route "/probe/queue/size" is reachable at
 * both "/probe-ingest/probe/queue/size" and "/probe/queue/size", and the
 * fallbacks are keyed on the FIRST segment, so both spellings matter -
 * "/server-monitor" does not cover "/server-monitor-ingest/...".
 */
function reachableGetRoutes(): Array<ReachableRoute> {
  const reachable: Array<ReachableRoute> = [];

  for (const featureSet of featureSetsInitialisedAfterFrontend()) {
    for (const mount of rootMountsIn(featureSet)) {
      const routerSource: string = stripComments(readSource(mount.routerPath));

      const routes: Array<string> = [
        ...routerSource.matchAll(/router\.get\(\s*"([^"]+)"/g),
      ].map((match: RegExpMatchArray): string => {
        return match[1] as string;
      });

      for (const prefix of mount.mounts) {
        for (const route of routes) {
          const requestPath: string = `${prefix === "/" ? "" : prefix}${route}`;
          const firstSegment: string | undefined = requestPath
            .split("/")
            .filter(Boolean)[0];

          if (!firstSegment) {
            continue;
          }

          reachable.push({
            origin: `${mount.featureSet}/${mount.router}`,
            requestPath: requestPath,
            segment: `/${firstSegment}`,
          });
        }
      }
    }
  }

  return reachable;
}

const ROUTES: Array<ReachableRoute> = reachableGetRoutes();

const LISTS: Array<string> = [
  "DashboardFallbackRoutePrefixesToSkip",
  "StatusPageDomainFallbackRoutePrefixesToSkip",
];

describe("every root-mounted GET route is reserved against the SPA fallbacks", () => {
  test("the derivation actually found the root-mounted routes", () => {
    /*
     * Everything below is vacuous if the parsing silently found nothing, and
     * a rename in App/Index.ts or a feature-set Index.ts is exactly the kind
     * of change that would cause that.
     */
    expect(ROUTES.length).toBeGreaterThan(10);

    const segments: Array<string> = [
      ...new Set(
        ROUTES.map((route: ReachableRoute): string => {
          return route.segment;
        }),
      ),
    ];

    /*
     * Spot-check the two the class has actually bitten: the heartbeat ingest
     * path from #2986, and the KEDA shed-rate path. If either stops being
     * derived, the derivation - not the reservation - is what broke.
     */
    expect(segments).toContain("/incoming-request");
    expect(segments).toContain("/metrics");
    expect(
      ROUTES.some((route: ReachableRoute): boolean => {
        return route.requestPath === "/metrics/telemetry-writer-shed-rate";
      }),
    ).toBe(true);
  });

  describe.each(LISTS)("%s", (list: string) => {
    const prefixes: Array<string> = arrayEntries(FRONTEND_INDEX, list);

    test("the list was found and parsed", () => {
      expect(prefixes.length).toBeGreaterThan(3);
      expect(
        prefixes.every((prefix: string): boolean => {
          return prefix.startsWith("/");
        }),
      ).toBe(true);
    });

    test("reserves the first path segment of every root-mounted GET route", () => {
      const unreserved: Array<string> = [
        ...new Set(
          ROUTES.filter((route: ReachableRoute): boolean => {
            return !isReserved(prefixes, route.requestPath);
          }).map((route: ReachableRoute): string => {
            return `${route.requestPath} (${route.origin}) needs ${route.segment}`;
          }),
        ),
      ];

      /*
       * Printed rather than counted so the failure names the route and the
       * prefix to add, which is the whole point of deriving this list.
       */
      expect(unreserved).toEqual([]);
    });
  });
});

describe("the reservation mechanism these tests model still exists", () => {
  test("both fallbacks are registered as GET catch-alls", () => {
    const code: string = stripComments(FRONTEND_INDEX);

    expect(code).toContain("registerCustomDomainFallback();");
    expect(code).toContain("registerDashboardFallbackForPrimaryHost();");
    expect(code).toContain("app.get(");
    expect(code).toContain('"*"');
  });

  test("stripping comments does not swallow the code being checked", () => {
    /*
     * Frontend/Index.ts contains a template literal ending in "/*", and a
     * naive comment stripper reads that as the start of a block comment and
     * deletes ~1,400 characters - the whole registerCustomDomainFallback
     * declaration among them. It throws nothing; the assertions above simply
     * stop seeing what they claim to check. Pinned here because that is a
     * silent-false-pass, the same failure mode as the route bug itself.
     */
    const code: string = stripComments(FRONTEND_INDEX);

    expect(FRONTEND_INDEX).toContain("`${frontendConfig.routePrefix}/*`");

    for (const declaration of [
      "const registerCustomDomainFallback",
      "const registerDashboardFallbackForPrimaryHost",
      "const IngestRoutePrefixesToSkip",
      "const DashboardFallbackRoutePrefixesToSkip",
      "const StatusPageDomainFallbackRoutePrefixesToSkip",
    ]) {
      expect(code).toContain(declaration);
    }
  });

  test("the custom-domain fallback consults the status-page list", () => {
    /*
     * This is why /metrics has to be on BOTH lists. The custom-domain
     * fallback is registered first and has no IsBillingEnabled gate, so it
     * is the one that answers a request whose Host is a Kubernetes service
     * name - which is every KEDA poll.
     */
    const code: string = stripComments(FRONTEND_INDEX);
    const customDomainFallback: string = code.slice(
      code.indexOf("const registerCustomDomainFallback"),
      code.indexOf("const registerDashboardFallbackForPrimaryHost"),
    );

    expect(customDomainFallback).toContain(
      "shouldSkipStatusPageDomainFallbackRoute(req.path)",
    );
    expect(customDomainFallback).not.toContain("IsBillingEnabled");
  });

  test("isReserved still mirrors the predicate the server runs", () => {
    /*
     * isReserved is a copy of the server's predicate. If the server ever
     * switched to an exact match, the copy would keep passing while the
     * server stopped covering "/metrics/telemetry-writer-shed-rate".
     */
    expect(FRONTEND_INDEX).toContain("path.startsWith(`${prefix}/`)");
    expect(FRONTEND_INDEX).toContain("if (path === prefix)");
  });

  test("both lists share one ingest source of truth", () => {
    /*
     * The lists were hand-synced denylists and drifted: before this test the
     * status-page list reserved none of the ingest prefixes, and the
     * dashboard list had "/server-monitor" but not
     * "/server-monitor-ingest". Sharing the entries is what keeps a single
     * new mount from having to be remembered twice.
     */
    const code: string = stripComments(FRONTEND_INDEX);

    for (const list of LISTS) {
      const body: string = code.slice(
        code.indexOf(`const ${list}: Array<string> = [`),
      );

      expect(body.slice(0, body.indexOf("];"))).toContain(
        "...IngestRoutePrefixesToSkip",
      );
    }
  });
});
