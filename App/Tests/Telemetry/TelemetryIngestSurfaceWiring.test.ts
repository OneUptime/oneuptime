import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
/*
 * Sibling-relative like ChangeEventRow.test.ts: the bare `Common` specifier
 * can resolve a checkout that predates this branch's files, and this suite is
 * worthless if it reads the enum from somewhere other than the tree it is
 * scanning.
 */
import TelemetryIngestSurface, {
  BROWSER_ALLOWED_INGEST_SURFACES,
} from "../../../Common/Types/Telemetry/TelemetryIngestSurface";

/*
 * WHY THIS SUITE EXISTS: the surface argument is unenforceable by types.
 *
 * TelemetryIngest.forSurface(TelemetryIngestSurface.X) compiles for EVERY X.
 * A source-map upload route registered with OtelTraces, or a session-replay
 * route registered with Syslog, type-checks, boots, serves traffic and passes
 * every unit test of the middleware - because the middleware is doing exactly
 * what it was told. The wiring IS the control: BROWSER_ALLOWED_INGEST_SURFACES
 * only protects an endpoint if that endpoint names itself honestly, so the one
 * place a mis-classification can be caught is against the route table itself.
 *
 * The consequence of getting it wrong is not subtle. A browser ingestion key is
 * PUBLISHED - it is pasted into page JavaScript and anyone can read it. If a
 * route mislabels itself with a browser-allowed surface, that scraped key can
 * write to it: overwrite the source maps everyone else's stack traces are
 * de-obfuscated with, forge security events, or inject Kubernetes cost rows.
 * Conversely a route mislabelled with a server-only surface silently breaks
 * every customer's browser SDK with "use a server ingestion key".
 *
 * So this suite:
 *   - reads the API directory at test time rather than hardcoding a file list,
 *     so a NEW ingest route fails here until someone classifies it;
 *   - pins each surface to the route path it sits next to, not merely to the
 *     file it appears in;
 *   - refuses the legacy unnamed guard anywhere in the Telemetry API;
 *   - cross-checks the route table against BROWSER_ALLOWED_INGEST_SURFACES in
 *     both directions, so widening that allowlist fails here until someone
 *     states which live endpoint it just opened to the public internet;
 *   - pins the two non-Express ingest pipes (gRPC, MQTT) to their own surfaces,
 *     neither of which a browser key may use.
 */

const TELEMETRY_API_DIRECTORY: string = "App/FeatureSet/Telemetry/API";

interface WiredIngestRoute {
  file: string;
  routePath: string;
  surfaceMember: string;
}

/*
 * The classification table. Every entry here is a deliberate answer to "may a
 * key scraped off a public page write here?" - changing one is a security
 * decision, which is the point of making it a diff in this file.
 */
const EXPECTED_WIRING: Array<WiredIngestRoute> = [
  {
    file: `${TELEMETRY_API_DIRECTORY}/ChangeEventsIngest.ts`,
    routePath: "/change-events/v1/ingest",
    surfaceMember: "ChangeEvents",
  },
  {
    file: `${TELEMETRY_API_DIRECTORY}/Fluent.ts`,
    routePath: "/fluentd/v1/logs",
    surfaceMember: "Fluent",
  },
  {
    file: `${TELEMETRY_API_DIRECTORY}/KubernetesCostIngest.ts`,
    routePath: "/kubernetes-cost/ingest",
    surfaceMember: "KubernetesCost",
  },
  {
    file: `${TELEMETRY_API_DIRECTORY}/OTelIngest.ts`,
    routePath: "/otlp/v1/traces",
    surfaceMember: "OtelTraces",
  },
  {
    file: `${TELEMETRY_API_DIRECTORY}/OTelIngest.ts`,
    routePath: "/otlp/v1/metrics",
    surfaceMember: "OtelMetrics",
  },
  {
    file: `${TELEMETRY_API_DIRECTORY}/OTelIngest.ts`,
    routePath: "/otlp/v1/logs",
    surfaceMember: "OtelLogs",
  },
  {
    file: `${TELEMETRY_API_DIRECTORY}/OTelIngest.ts`,
    routePath: "/otlp/v1/profiles",
    surfaceMember: "OtelProfiles",
  },
  {
    file: `${TELEMETRY_API_DIRECTORY}/Pyroscope.ts`,
    routePath: "/pyroscope/ingest",
    surfaceMember: "Pyroscope",
  },
  {
    file: `${TELEMETRY_API_DIRECTORY}/Pyroscope.ts`,
    routePath: "/pyroscope/push.v1.PusherService/Push",
    surfaceMember: "Pyroscope",
  },
  {
    file: `${TELEMETRY_API_DIRECTORY}/SecurityEventsIngest.ts`,
    routePath: "/security-events/v1/ingest",
    surfaceMember: "SecurityEvents",
  },
  {
    file: `${TELEMETRY_API_DIRECTORY}/SessionReplayIngest.ts`,
    routePath: "/session-replay/v1/chunk",
    surfaceMember: "SessionReplay",
  },
  {
    file: `${TELEMETRY_API_DIRECTORY}/SessionReplayIngest.ts`,
    routePath: "/session-replay/v1/config",
    surfaceMember: "SessionReplay",
  },
  {
    file: `${TELEMETRY_API_DIRECTORY}/SourceMapIngest.ts`,
    routePath: "/source-maps/v1/upload",
    surfaceMember: "SourceMap",
  },
  {
    file: `${TELEMETRY_API_DIRECTORY}/Syslog.ts`,
    routePath: "/syslog/v1/logs",
    surfaceMember: "Syslog",
  },
];

/*
 * The route paths a published browser key is allowed to reach. Written out as
 * paths rather than derived from the allowlist on purpose: the question this
 * pins is "which live URLs did we just open to the internet", and only a
 * literal list can answer it.
 */
const EXPECTED_BROWSER_REACHABLE_ROUTE_PATHS: Array<string> = [
  "/otlp/v1/logs",
  "/otlp/v1/metrics",
  "/otlp/v1/traces",
  "/session-replay/v1/chunk",
  "/session-replay/v1/config",
];

function repoPath(relative: string): string {
  return path.join(__dirname, "../../..", relative);
}

function readSource(relative: string): string {
  return fs.readFileSync(repoPath(relative), "utf8");
}

function readSquashed(relative: string): string {
  return readSource(relative).replace(/\s+/g, " ");
}

function walkApiDirectory(relativeDir: string, found: Array<string>): void {
  const entries: Array<fs.Dirent> = fs.readdirSync(repoPath(relativeDir), {
    withFileTypes: true,
  });

  for (const entry of entries) {
    const relative: string = `${relativeDir}/${entry.name}`;

    if (entry.isDirectory()) {
      walkApiDirectory(relative, found);
      continue;
    }

    if (entry.name.endsWith(".ts")) {
      found.push(relative);
    }
  }
}

/*
 * Read the directory rather than trusting a hardcoded list - a new ingest
 * route dropped in later must be seen by this suite, including one added in a
 * subdirectory.
 */
function listTelemetryApiSourceFiles(): Array<string> {
  const found: Array<string> = [];
  walkApiDirectory(TELEMETRY_API_DIRECTORY, found);
  return found.sort();
}

/*
 * Pair each forSurface() call with the route path it is registered under, by
 * walking the file and remembering the most recent router.<method>("<path>".
 * Adjacency is the whole point: "OtelTraces appears somewhere in OTelIngest.ts"
 * would pass even if the traces surface were wired to the profiles route.
 */
function readWiredIngestRoutes(): Array<WiredIngestRoute> {
  const routes: Array<WiredIngestRoute> = [];

  for (const file of listTelemetryApiSourceFiles()) {
    const lines: Array<string> = readSource(file).split("\n");
    let currentRoutePath: string | null = null;
    let isAwaitingRoutePath: boolean = false;

    for (const line of lines) {
      const registration: RegExpMatchArray | null = line.match(
        /router\.(?:get|post|put|patch|delete|all)\(/,
      );

      if (registration) {
        const inlineRoutePath: RegExpMatchArray | null = line.match(
          /router\.[a-z]+\(\s*"([^"]+)"/,
        );

        if (inlineRoutePath && inlineRoutePath[1]) {
          currentRoutePath = inlineRoutePath[1];
          isAwaitingRoutePath = false;
        } else {
          currentRoutePath = null;
          isAwaitingRoutePath = true;
        }

        continue;
      }

      if (isAwaitingRoutePath) {
        const routePathLine: RegExpMatchArray | null =
          line.match(/^\s*"([^"]+)"\s*,/);

        if (routePathLine && routePathLine[1]) {
          currentRoutePath = routePathLine[1];
          isAwaitingRoutePath = false;
        }
      }

      const surfaceCall: RegExpMatchArray | null = line.match(
        /TelemetryIngest\.forSurface\(\s*TelemetryIngestSurface\.([A-Za-z0-9_]+)\s*\)/,
      );

      if (surfaceCall && surfaceCall[1]) {
        routes.push({
          file: file,
          routePath: currentRoutePath || "<no route path found>",
          surfaceMember: surfaceCall[1],
        });
      }
    }
  }

  return routes;
}

function describeRoute(route: WiredIngestRoute): string {
  return `${route.file} ${route.routePath} -> TelemetryIngestSurface.${route.surfaceMember}`;
}

function surfaceValueForMember(member: string): TelemetryIngestSurface {
  const members: Record<string, string> =
    TelemetryIngestSurface as unknown as Record<string, string>;

  return members[member] as TelemetryIngestSurface;
}

function isBrowserAllowedMember(member: string): boolean {
  return BROWSER_ALLOWED_INGEST_SURFACES.has(surfaceValueForMember(member));
}

const WIRED_ROUTES: Array<WiredIngestRoute> = readWiredIngestRoutes();

describe("Telemetry ingest route -> surface wiring", () => {
  test("no ingest route is left on the unnamed legacy guard", () => {
    /*
     * isAuthorizedServiceMiddleware authorizes with NO surface, which the
     * middleware treats as server-only. It fails closed, so a route left on it
     * is not a hole - but it is an un-migrated route whose classification
     * nobody has made, and it silently refuses every browser key. Every
     * registration must state its surface.
     */
    const offenders: Array<string> = listTelemetryApiSourceFiles().filter(
      (file: string): boolean => {
        return readSquashed(file).includes(
          "TelemetryIngest.isAuthorizedServiceMiddleware",
        );
      },
    );

    expect(offenders).toEqual([]);
  });

  test("every forSurface call found in the directory is accounted for by the parser", () => {
    /*
     * Guards this suite against itself: if a call site is reformatted so the
     * regex above stops matching it, the route table would silently shrink and
     * every mapping assertion below would keep passing while checking nothing.
     */
    let occurrences: number = 0;

    for (const file of listTelemetryApiSourceFiles()) {
      occurrences += (
        readSquashed(file).match(/TelemetryIngest\.forSurface\(/g) || []
      ).length;
    }

    expect(WIRED_ROUTES).toHaveLength(occurrences);
    expect(occurrences).toBeGreaterThan(0);
  });

  test("the set of files registering surface-guarded ingest routes is exactly the classified set", () => {
    /*
     * Directory-driven, so a brand new ingest route file fails here until its
     * surface is written into EXPECTED_WIRING above - which forces the author
     * to answer the browser-key question rather than inherit an answer.
     */
    const discoveredFiles: Array<string> = Array.from(
      new Set(
        WIRED_ROUTES.map((route: WiredIngestRoute): string => {
          return route.file;
        }),
      ),
    ).sort();

    const expectedFiles: Array<string> = Array.from(
      new Set(
        EXPECTED_WIRING.map((route: WiredIngestRoute): string => {
          return route.file;
        }),
      ),
    ).sort();

    expect(discoveredFiles).toEqual(expectedFiles);
  });

  test("each ingest route names the surface it actually is", () => {
    const discovered: Array<string> = WIRED_ROUTES.map(describeRoute).sort();
    const expected: Array<string> = EXPECTED_WIRING.map(describeRoute).sort();

    expect(discovered).toEqual(expected);
  });

  test("the four OTLP routes each carry their own signal's surface", () => {
    /*
     * Called out separately from the table because these four sit in one file,
     * one after another, with identical middleware chains - a copy-paste that
     * leaves two routes on the same surface is the single most likely wiring
     * mistake in this codebase, and it would make OTLP metrics either
     * unreachable from browsers or reachable when they should not be.
     */
    const otelRoutes: Record<string, string> = {};

    for (const route of WIRED_ROUTES) {
      if (route.file.endsWith("/OTelIngest.ts")) {
        otelRoutes[route.routePath] = route.surfaceMember;
      }
    }

    expect(otelRoutes).toEqual({
      "/otlp/v1/traces": "OtelTraces",
      "/otlp/v1/metrics": "OtelMetrics",
      "/otlp/v1/logs": "OtelLogs",
      "/otlp/v1/profiles": "OtelProfiles",
    });
  });

  test("both session replay registrations and both Pyroscope registrations are guarded, not just the first of each", () => {
    /*
     * A file with two registrations is where "the surface is present in this
     * file" reasoning breaks down: the chunk route can be guarded correctly
     * while the config route beside it is left open or mislabelled.
     */
    const sessionReplayRoutes: Array<WiredIngestRoute> = WIRED_ROUTES.filter(
      (route: WiredIngestRoute): boolean => {
        return route.file.endsWith("/SessionReplayIngest.ts");
      },
    );

    expect(sessionReplayRoutes).toHaveLength(2);
    expect(
      sessionReplayRoutes.every((route: WiredIngestRoute): boolean => {
        return route.surfaceMember === "SessionReplay";
      }),
    ).toBe(true);

    const pyroscopeRoutes: Array<WiredIngestRoute> = WIRED_ROUTES.filter(
      (route: WiredIngestRoute): boolean => {
        return route.file.endsWith("/Pyroscope.ts");
      },
    );

    expect(pyroscopeRoutes).toHaveLength(2);
    expect(
      pyroscopeRoutes.every((route: WiredIngestRoute): boolean => {
        return route.surfaceMember === "Pyroscope";
      }),
    ).toBe(true);
  });

  test("every surface named by a route is a real member of TelemetryIngestSurface", () => {
    /*
     * A route naming a member that no longer exists would be a compile error
     * today, but this suite reads TEXT - without this check a rename could
     * leave EXPECTED_WIRING and the routes agreeing on a string that is not a
     * surface at all, and the browser cross-check below would then compare
     * against `undefined` and pass vacuously.
     */
    const members: Record<string, string> =
      TelemetryIngestSurface as unknown as Record<string, string>;

    for (const route of WIRED_ROUTES) {
      expect(Object.keys(members)).toContain(route.surfaceMember);
      expect(typeof members[route.surfaceMember]).toBe("string");
    }
  });

  test("only the OTLP traces/logs/metrics routes and the session replay routes are reachable by a published browser key", () => {
    /*
     * The cross-check that gives BROWSER_ALLOWED_INGEST_SURFACES its meaning.
     * Adding a member to that set is not an abstract act - it opens a specific
     * live URL to a credential anyone can read off a web page - so it must
     * fail here until the URL it opens is written down.
     */
    const browserReachableRoutePaths: Array<string> = Array.from(
      new Set(
        WIRED_ROUTES.filter((route: WiredIngestRoute): boolean => {
          return isBrowserAllowedMember(route.surfaceMember);
        }).map((route: WiredIngestRoute): string => {
          return route.routePath;
        }),
      ),
    ).sort();

    expect(browserReachableRoutePaths).toEqual(
      EXPECTED_BROWSER_REACHABLE_ROUTE_PATHS,
    );
  });

  test("no build-time or infrastructure ingest route is browser reachable", () => {
    /*
     * Stated as the negative as well, because it is the failure everyone
     * actually cares about. Source maps are the sharpest: a browser key that
     * could upload them could replace the maps used to de-obfuscate every
     * other stack trace in the project.
     */
    for (const route of WIRED_ROUTES) {
      const isExpectedBrowserRoute: boolean =
        EXPECTED_BROWSER_REACHABLE_ROUTE_PATHS.includes(route.routePath);

      if (isExpectedBrowserRoute) {
        continue;
      }

      expect({
        route: describeRoute(route),
        browserReachable: isBrowserAllowedMember(route.surfaceMember),
      }).toEqual({
        route: describeRoute(route),
        browserReachable: false,
      });
    }
  });

  test("every browser-allowed surface is wired to at least one route", () => {
    /*
     * The other direction: a browser-allowed surface with no route behind it
     * means either a dead allowlist entry or - far worse - a route that was
     * meant to carry it and does not, so the browser SDK aimed at that
     * endpoint is being refused in production.
     */
    const wiredMembers: Set<string> = new Set(
      WIRED_ROUTES.map((route: WiredIngestRoute): string => {
        return route.surfaceMember;
      }),
    );

    const wiredBrowserAllowedValues: Array<string> = Array.from(wiredMembers)
      .filter(isBrowserAllowedMember)
      .map((member: string): string => {
        return String(surfaceValueForMember(member));
      })
      .sort();

    const allowedValues: Array<string> = Array.from(
      BROWSER_ALLOWED_INGEST_SURFACES,
    )
      .map((surface: TelemetryIngestSurface): string => {
        return String(surface);
      })
      .sort();

    expect(wiredBrowserAllowedValues).toEqual(allowedValues);
  });
});

describe("Non-Express ingest pipes name their own surfaces", () => {
  test("the gRPC OTLP server refuses through the shared guard as the Grpc surface", () => {
    /*
     * gRPC cannot use the Express middleware, so a browser key presented on
     * that port is only stopped if this file asks the shared guard, with its
     * OWN surface. Naming a browser-allowed surface here would admit a scraped
     * key on a transport no browser can even speak.
     */
    const source: string = readSquashed(
      "App/FeatureSet/Telemetry/GrpcServer.ts",
    );

    expect(source).toContain("TelemetryIngestionKeyGuard.getRefusal({");

    const namedSurfaces: Array<string> = Array.from(
      new Set(
        (source.match(/TelemetryIngestSurface\.([A-Za-z0-9_]+)/g) || []).map(
          (match: string): string => {
            return match.replace("TelemetryIngestSurface.", "");
          },
        ),
      ),
    );

    expect(namedSurfaces).toEqual(["Grpc"]);
  });

  test("the MQTT broker refuses through the shared guard as the Mqtt surface", () => {
    /*
     * The MQTT WebSocket listener rides the ordinary HTTP ingress, so it is
     * reachable straight from page JavaScript - the one non-HTTP pipe a
     * scraped browser key could actually be replayed into.
     */
    const source: string = readSquashed(
      "App/FeatureSet/Telemetry/MqttServer.ts",
    );

    expect(source).toContain("TelemetryIngestionKeyGuard.getRefusal({");

    const namedSurfaces: Array<string> = Array.from(
      new Set(
        (source.match(/TelemetryIngestSurface\.([A-Za-z0-9_]+)/g) || []).map(
          (match: string): string => {
            return match.replace("TelemetryIngestSurface.", "");
          },
        ),
      ),
    );

    expect(namedSurfaces).toEqual(["Mqtt"]);
  });

  test("neither the gRPC nor the MQTT surface is browser allowed", () => {
    expect(
      BROWSER_ALLOWED_INGEST_SURFACES.has(TelemetryIngestSurface.Grpc),
    ).toBe(false);
    expect(
      BROWSER_ALLOWED_INGEST_SURFACES.has(TelemetryIngestSurface.Mqtt),
    ).toBe(false);
  });
});
