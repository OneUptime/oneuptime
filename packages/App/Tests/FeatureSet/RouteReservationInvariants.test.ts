import { describe, expect, test } from "@jest/globals";
import path from "path";
import {
  DashboardFallbackRoutePrefixesToSkip,
  IngestRoutePrefixesToSkip,
  StatusPageDomainFallbackRoutePrefixesToSkip,
  isRouteReservedAgainstSpaFallback,
} from "../../FeatureSet/Frontend/RouteReservations";
import {
  APP_DIR,
  REPO_ROOT,
  firstPathSegment,
  parseSourceFile,
  readSource,
  scanRouterGetPaths,
  stripComments,
} from "./RouteReservationSource";

/*
 * The standing invariants the reservation scheme depends on. None of these is
 * asserted anywhere else, and each is the kind of thing a reasonable refactor
 * could break without any visible symptom - which is the whole problem with
 * this bug class: the failure is a 200 with the wrong body.
 */

const APP_INDEX: string = stripComments(readSource(APP_DIR, "Index.ts"));
const NGINX: string = readSource(REPO_ROOT, "Nginx", "default.conf.template");

describe("list hygiene", () => {
  const lists: Array<[string, Array<string>]> = [
    ["dashboard", DashboardFallbackRoutePrefixesToSkip],
    ["status page", StatusPageDomainFallbackRoutePrefixesToSkip],
    ["ingest", IngestRoutePrefixesToSkip],
  ];

  test.each(lists)(
    "the %s list has no duplicate entries",
    (_name: string, entries: Array<string>) => {
      /*
       * A duplicate is harmless at runtime but always means a hand-sync
       * mistake - an entry added to a list that already inherits it from the
       * shared spread.
       */
      const seen: Array<string> = entries.filter(
        (entry: string, index: number): boolean => {
          return entries.indexOf(entry) !== index;
        },
      );

      expect(seen).toEqual([]);
    },
  );

  test.each(lists)(
    "every %s entry is a well-formed prefix",
    (_name: string, entries: Array<string>) => {
      for (const entry of entries) {
        /*
         * The predicate compares req.path, which always starts with "/" and
         * never carries a query string or a trailing slash. An entry shaped
         * any other way silently matches nothing.
         */
        expect({ entry, ok: entry.startsWith("/") }).toEqual({
          entry,
          ok: true,
        });
        expect({ entry, ok: entry === "/" || !entry.endsWith("/") }).toEqual({
          entry,
          ok: true,
        });
        expect({ entry, ok: !entry.includes("*") }).toEqual({
          entry,
          ok: true,
        });
        expect({ entry, ok: !entry.includes("?") }).toEqual({
          entry,
          ok: true,
        });
        expect({ entry, ok: entry.trim() === entry }).toEqual({
          entry,
          ok: true,
        });
      }
    },
  );

  test('no list contains a bare "/"', () => {
    /*
     * "/" would only reserve "/" exactly, so it would not be catastrophic -
     * but it is never what anyone means, and its presence is the signature of
     * a parser or an edit having picked up a quoted "/" from prose.
     */
    for (const [, entries] of lists) {
      expect(entries).not.toContain("/");
    }
  });

  test("both lists really do contain the shared ingest prefixes by value", () => {
    /*
     * Guards the spread actually taking effect, rather than a list merely
     * mentioning IngestRoutePrefixesToSkip somewhere in its source.
     */
    expect(IngestRoutePrefixesToSkip.length).toBeGreaterThan(10);

    for (const prefix of IngestRoutePrefixesToSkip) {
      expect(DashboardFallbackRoutePrefixesToSkip).toContain(prefix);
      expect(StatusPageDomainFallbackRoutePrefixesToSkip).toContain(prefix);
    }
  });

  test("the dashboard list is not accidentally a subset of the status page one", () => {
    // They are different lists on purpose; this pins that they still differ.
    const onlyDashboard: Array<string> =
      DashboardFallbackRoutePrefixesToSkip.filter((entry: string): boolean => {
        return !StatusPageDomainFallbackRoutePrefixesToSkip.includes(entry);
      });

    expect(onlyDashboard.length).toBeGreaterThan(0);
    expect(onlyDashboard).toContain("/dashboard".replace("/dashboard", "/api"));
  });
});

describe("initialisation order in App/Index.ts", () => {
  test("the frontend fallbacks are registered before every feature set that serves GET", () => {
    /*
     * The premise of the whole scheme. If a feature set ever moves ahead of
     * Frontend, its routes stop needing a reservation - and if Frontend moves
     * last, everything does.
     */
    const frontend: number = APP_INDEX.indexOf("await FrontendRoutes.init()");

    expect(frontend).toBeGreaterThan(-1);

    for (const featureSet of [
      "Docs",
      "APIReference",
      "Workers",
      "Telemetry",
      "Workflow",
      "Runbook",
    ]) {
      const at: number = APP_INDEX.indexOf(`await ${featureSet}Routes.init()`);

      expect({ featureSet, found: at > -1 }).toEqual({
        featureSet,
        found: true,
      });
      expect({ featureSet, afterFrontend: at > frontend }).toEqual({
        featureSet,
        afterFrontend: true,
      });
    }
  });

  test("AppMetricsAPI is mounted before the feature sets, which is why /metrics/queue-size works", () => {
    /*
     * The near-miss worth pinning. /metrics/queue-size is registered by
     * routers in BOTH Workers and Telemetry, which init after Frontend - so
     * on the root mount they would be shadowed. It works only because
     * App/Index.ts mounts AppMetricsAPI on "/" first. If that line moves
     * below the feature sets, the KEDA queue-size trigger breaks the same way
     * the shed-rate one did, and "/metrics" being reserved is what now keeps
     * it safe either way.
     */
    const metricsMount: number = APP_INDEX.indexOf(
      'expressApp.use("/", AppMetricsAPI)',
    );
    const frontend: number = APP_INDEX.indexOf("await FrontendRoutes.init()");

    expect(metricsMount).toBeGreaterThan(-1);
    expect(metricsMount).toBeLessThan(frontend);
  });

  test("addDefaultRoutes stays last, so a reserved-but-unmatched path 404s", () => {
    const defaults: number = APP_INDEX.indexOf("App.addDefaultRoutes()");

    expect(defaults).toBeGreaterThan(-1);

    for (const featureSet of ["Telemetry", "Runbook", "Workflow"]) {
      expect(
        APP_INDEX.indexOf(`await ${featureSet}Routes.init()`),
      ).toBeLessThan(defaults);
    }
  });
});

describe("the KEDA autoscaling contract", () => {
  /*
   * Helm and the App have to agree on a URL path, across two files in
   * different languages with nothing linking them. Rename the route and the
   * scaler silently falls back forever - which is the failure this whole
   * change is about.
   */
  const KEDA: string = readSource(
    REPO_ROOT,
    "HelmChart",
    "Public",
    "oneuptime",
    "templates",
    "keda-scaledobjects.yaml",
  );
  const HELPERS: string = readSource(
    REPO_ROOT,
    "HelmChart",
    "Public",
    "oneuptime",
    "templates",
    "_helpers.tpl",
  );

  const urlPaths: Array<string> = [
    ...KEDA.matchAll(/"urlPath"\s+"([^"]+)"/g),
  ].map((match: RegExpMatchArray): string => {
    return match[1] as string;
  });

  const defaultPath: string | undefined = HELPERS.match(
    /\{\{\s*else\s*\}\}(\/metrics\/[a-z-]+)\{\{\s*end\s*\}\}/,
  )?.[1];

  test("the chart's metrics-api triggers were found", () => {
    // Otherwise every assertion below is vacuous.
    expect(HELPERS).toContain("type: metrics-api");
    expect(urlPaths.length).toBeGreaterThan(0);
    expect(defaultPath).toBe("/metrics/queue-size");
  });

  test("every polled path is reserved on BOTH lists", () => {
    /*
     * Both, because KEDA addresses the pod by Kubernetes service name. That
     * Host is not a primary host, so the request is answered by the
     * custom-domain fallback - which is registered first and has no billing
     * gate. The dashboard list alone would not cover it.
     */
    for (const urlPath of [...urlPaths, defaultPath as string]) {
      expect({
        urlPath,
        dashboard: isRouteReservedAgainstSpaFallback(
          DashboardFallbackRoutePrefixesToSkip,
          urlPath,
        ),
        statusPage: isRouteReservedAgainstSpaFallback(
          StatusPageDomainFallbackRoutePrefixesToSkip,
          urlPath,
        ),
      }).toEqual({ urlPath, dashboard: true, statusPage: true });
    }
  });

  test("the shed-rate path the chart polls is a route the App actually registers", () => {
    const shedRate: string = "/metrics/telemetry-writer-shed-rate";

    expect(urlPaths).toContain(shedRate);

    const routes: ReturnType<typeof scanRouterGetPaths> = scanRouterGetPaths(
      parseSourceFile(
        path.join(
          APP_DIR,
          "FeatureSet",
          "Telemetry",
          "API",
          "TelemetryWriter.ts",
        ),
      ),
    );

    expect(routes.getPaths).toContain(shedRate);
  });

  test("the route returns the JSON key the chart reads with valueLocation", () => {
    /*
     * The other half of the contract. KEDA reads valueLocation out of the
     * response body; if the handler stopped emitting that key the scaler
     * would break just as silently as it did when it got HTML.
     */
    const valueLocations: Array<string> = [
      ...KEDA.matchAll(/"valueLocation"\s+"([^"]+)"/g),
    ].map((match: RegExpMatchArray): string => {
      return match[1] as string;
    });

    expect(valueLocations).toContain("shedCount");

    const handler: string = stripComments(
      readSource(
        APP_DIR,
        "FeatureSet",
        "Telemetry",
        "API",
        "TelemetryWriter.ts",
      ),
    );

    expect(handler).toMatch(/shedCount:/);
  });

  test("telemetry-writer runs the same image, so the route exists on the pod KEDA polls", () => {
    /*
     * If the writer tier ran a different image the route would not be there
     * at all, and reserving the prefix would be beside the point.
     */
    const deployment: string = readSource(
      REPO_ROOT,
      "HelmChart",
      "Public",
      "oneuptime",
      "templates",
      "telemetry-writer.yaml",
    );

    expect(deployment).toMatch(/image:.*\bapp\b/);
  });
});

describe("nginx rewrite targets land where the App can answer them", () => {
  /*
   * #2986 was born here: nginx rewrites /heartbeat/<key> to
   * /incoming-request/<key>, so the App never sees the prefix it reserved.
   * Any rewrite whose TARGET lands on an unreserved segment can repeat that.
   */
  const targets: Array<string> = [
    ...new Set(
      [...NGINX.matchAll(/rewrite\s+\^\S+\s+(\/[^\s$]*)/g)].map(
        (match: RegExpMatchArray): string => {
          return match[1] as string;
        },
      ),
    ),
  ];

  test("rewrites were found in the template", () => {
    expect(targets.length).toBeGreaterThan(5);
  });

  test("every rewrite target's first segment is reserved on the dashboard list", () => {
    const unreserved: Array<string> = [
      ...new Set(
        targets
          .map((target: string): string | null => {
            return firstPathSegment(target);
          })
          .filter((segment: string | null): segment is string => {
            return segment !== null;
          })
          .filter((segment: string): boolean => {
            return !isRouteReservedAgainstSpaFallback(
              DashboardFallbackRoutePrefixesToSkip,
              segment,
            );
          }),
      ),
    ].sort();

    expect(unreserved).toEqual([]);
  });

  test("the heartbeat rewrite specifically still points somewhere reserved", () => {
    const heartbeat: string | undefined = NGINX.match(
      /rewrite\s+\^\/heartbeat\(\.\*\)\$\s+(\/\S+)\$1\s+break;/,
    )?.[1];

    expect(heartbeat).toBe("/incoming-request");
    expect(
      isRouteReservedAgainstSpaFallback(
        DashboardFallbackRoutePrefixesToSkip,
        `${heartbeat}/key`,
      ),
    ).toBe(true);
    expect(
      isRouteReservedAgainstSpaFallback(
        StatusPageDomainFallbackRoutePrefixesToSkip,
        `${heartbeat}/key`,
      ),
    ).toBe(true);
  });
});

describe("the reservation module stays importable from a test", () => {
  test("it pulls in nothing with side effects", () => {
    /*
     * The reason these tests can assert against real values instead of a
     * regex over the source. One import of an Express util or a database
     * service and this module boots half the server, and the next person to
     * need a value here goes back to scraping source - which is where the
     * false passes came from.
     */
    const source: string = readSource(
      APP_DIR,
      "FeatureSet",
      "Frontend",
      "RouteReservations.ts",
    );

    const imports: Array<string> = [
      ...source.matchAll(/^import\s.*?from\s+"([^"]+)";/gm),
    ].map((match: RegExpMatchArray): string => {
      return match[1] as string;
    });

    expect(imports).toEqual([]);
  });

  test("Frontend/Index.ts consumes it rather than keeping its own copy", () => {
    const frontend: string = stripComments(
      readSource(APP_DIR, "FeatureSet", "Frontend", "Index.ts"),
    );

    expect(frontend).toContain('from "./RouteReservations"');
    expect(frontend).not.toContain(
      "const DashboardFallbackRoutePrefixesToSkip",
    );
    expect(frontend).not.toContain(
      "const StatusPageDomainFallbackRoutePrefixesToSkip",
    );
  });
});
