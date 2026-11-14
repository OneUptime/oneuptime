import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import {
  CLOUD_STREAM_LOGS_PATH,
  CLOUD_STREAM_METRICS_PATH,
  CLOUD_STREAM_PUBSUB_LOGS_PATH,
} from "Common/Types/CloudConnection/CloudStream";
import {
  HOST_COLLECTOR_OPAMP_PATH,
  HOST_COLLECTOR_OPAMP_ROUTE,
} from "Common/Types/HostCollector/HostCollector";
import {
  IngestRoutePrefixesToSkip,
  shouldSkipDashboardFallbackRoute,
  shouldSkipStatusPageDomainFallbackRoute,
} from "../../FeatureSet/Frontend/RouteReservations";

/*
 * Every route the Telemetry routers serve at the root is reserved against
 * the two SPA fallbacks.
 *
 * The Telemetry feature set mounts each of its routers on "/telemetry" and
 * on "/" (TELEMETRY_PREFIXES), so /opamp/v1 is as much the host collector's
 * route as /telemetry/opamp/v1 - and hosts installed before the installers
 * moved to /telemetry still ask there. A GET to a root route that is not
 * reserved is answered with the Dashboard's page at HTTP 200 on a
 * self-hosted primary host, and with the status page on a custom domain: a
 * page where a client, or a person checking the address with curl, expected
 * the route. Most of these routes are POST-only, so nothing is shadowed
 * today; reserving all of them keeps a GET added later (a health or
 * validate route, as /otlp has) from quietly answering with HTML.
 *
 * The routes are read from the routers Telemetry/Index.ts mounts on
 * TELEMETRY_PREFIXES, so a router or a route added later fails here until
 * its prefix is reserved in RouteReservations.ts.
 */

const TELEMETRY_DIRECTORY: string = path.join(
  __dirname,
  "../../FeatureSet/Telemetry",
);

// OneUptime's own API, which a compatible intake may share (Datadog's logs).
const ONEUPTIME_API_PREFIX: string = "/api";

// The names a router registers a route with, and what they hold.
const ROUTE_NAMES: Record<string, string> = {
  CLOUD_STREAM_METRICS_PATH,
  CLOUD_STREAM_LOGS_PATH,
  CLOUD_STREAM_PUBSUB_LOGS_PATH,
};

interface TelemetryRoute {
  file: string;
  method: string;
  route: string;
}

function readTelemetrySource(relativePath: string): string {
  return fs.readFileSync(path.join(TELEMETRY_DIRECTORY, relativePath), "utf8");
}

/*
 * The paths a name stands for: one of ROUTE_NAMES, or each name of the
 * `for (const <name> of [A, B])` the registration sits in.
 */
function readNamedPaths(
  name: string,
  lines: Array<string>,
  lineIndex: number,
  file: string,
): Array<string> {
  for (let index: number = lineIndex; index >= 0; index--) {
    const loop: RegExpMatchArray | null = lines[index]!.match(
      new RegExp(`for\\s*\\(\\s*const\\s+${name}\\s+of\\s+\\[([^\\]]*)\\]`),
    );

    if (loop) {
      return loop[1]!
        .split(",")
        .map((item: string): string => {
          return item.trim();
        })
        .filter(Boolean)
        .flatMap((item: string): Array<string> => {
          return readNamedPaths(item, lines, index - 1, file);
        });
    }
  }

  const value: string | undefined = ROUTE_NAMES[name];

  if (!value) {
    throw new Error(
      `${file} registers a route with ${name}, which this test does not know: add it to ROUTE_NAMES`,
    );
  }

  return [value];
}

function readTelemetryRoutes(): {
  mountPrefixes: Array<string>;
  routes: Array<TelemetryRoute>;
} {
  const index: string = readTelemetrySource("Index.ts");
  const prefixes: RegExpMatchArray | null = index.match(
    /const TELEMETRY_PREFIXES: Array<string> = \[([^\]]*)\];/,
  );

  if (!prefixes) {
    throw new Error("Telemetry/Index.ts no longer declares TELEMETRY_PREFIXES");
  }

  const imports: Map<string, string> = new Map();

  for (const match of index.matchAll(
    /^import\s+(\w+)\s+from\s+"\.\/(API\/[^"]+)";/gm,
  )) {
    imports.set(match[1]!, `${match[2]}.ts`);
  }

  const mounted: Array<string> = Array.from(
    index.matchAll(/^\s*app\.use\(TELEMETRY_PREFIXES,\s*(\w+)\);/gm),
    (match: RegExpMatchArray): string => {
      return match[1]!;
    },
  );

  // A list read only in part would let the test pass with nothing checked.
  expect(mounted).toHaveLength(
    index.split("app.use(TELEMETRY_PREFIXES,").length - 1,
  );

  const routes: Array<TelemetryRoute> = [];

  for (const name of mounted) {
    const file: string | undefined = imports.get(name);

    if (!file) {
      throw new Error(
        `Telemetry/Index.ts mounts ${name}, imported from nowhere`,
      );
    }

    const lines: Array<string> = readTelemetrySource(file).split("\n");

    lines.forEach((line: string, lineIndex: number) => {
      const registration: RegExpMatchArray | null = line.match(
        /^\s*router\.(get|post|put|patch|delete|all)\(\s*(.*)$/,
      );

      if (!registration) {
        return;
      }

      let argument: string = registration[2]!.trim();
      let argumentLine: number = lineIndex;

      if (argument === "") {
        argumentLine = lineIndex + 1;
        argument = (lines[argumentLine] || "").trim();
      }

      const quoted: RegExpMatchArray | null = argument.match(/^"([^"]+)"/);
      const named: RegExpMatchArray | null = argument.match(
        /^([A-Za-z_][A-Za-z0-9_]*)\s*(,|$)/,
      );

      let paths: Array<string> = [];

      if (quoted) {
        paths = [quoted[1]!];
      } else if (named) {
        paths = readNamedPaths(named[1]!, lines, argumentLine, file);
      } else {
        throw new Error(
          `${file}:${lineIndex + 1}: cannot read the route of ${line.trim()}`,
        );
      }

      for (const route of paths) {
        routes.push({
          file,
          method: registration[1]!.toUpperCase(),
          route,
        });
      }
    });
  }

  return {
    mountPrefixes: Array.from(
      prefixes[1]!.matchAll(/"([^"]*)"/g),
      (match: RegExpMatchArray): string => {
        return match[1]!;
      },
    ),
    routes,
  };
}

// A route with a value in place of each ":name" segment.
function exampleOf(route: string): string {
  return route.replace(/:[A-Za-z]+/g, "a1b2c3d4");
}

const { mountPrefixes, routes } = readTelemetryRoutes();

describe("the routes the Telemetry routers serve at the root", () => {
  test("are served at the root as well as under /telemetry", () => {
    expect([...mountPrefixes].sort()).toEqual(["/", "/telemetry"]);
  });

  test("were all read, the host collector's OpAMP route among them", () => {
    expect(routes.length).toBeGreaterThanOrEqual(25);
    expect(
      routes.some((route: TelemetryRoute): boolean => {
        return (
          route.method === "POST" && route.route === HOST_COLLECTOR_OPAMP_ROUTE
        );
      }),
    ).toBe(true);
  });

  test("are each reserved against both SPA fallbacks, at the root and under /telemetry", () => {
    const unreserved: Array<string> = [];

    for (const route of routes) {
      for (const requestPath of [
        exampleOf(route.route),
        `/telemetry${exampleOf(route.route)}`,
      ]) {
        if (
          !shouldSkipDashboardFallbackRoute(requestPath) ||
          !shouldSkipStatusPageDomainFallbackRoute(requestPath)
        ) {
          unreserved.push(`${route.method} ${requestPath} (${route.file})`);
        }
      }
    }

    expect(unreserved).toEqual([]);
  });

  test("are reserved by their own first segment, not by a broader entry", () => {
    /*
     * A route's own prefix, so the reservation says which route it is for.
     * A route under OneUptime's own /api - the Datadog Agent's logs, at
     * /api/v2/logs (#6797) - has no first segment of its own: /api is
     * reserved on the dashboard list only (RouteReservationInvariants), so
     * such a route is reserved by its whole path.
     */
    const missing: Array<string> = routes
      .map((route: TelemetryRoute): string => {
        const firstSegment: string = `/${route.route.split("/")[1]}`;

        return firstSegment === ONEUPTIME_API_PREFIX
          ? route.route
          : firstSegment;
      })
      .filter((prefix: string): boolean => {
        return !IngestRoutePrefixesToSkip.includes(prefix);
      });

    expect(Array.from(new Set(missing))).toEqual([]);
  });
});

describe("the host collector's OpAMP addresses", () => {
  test.each([[HOST_COLLECTOR_OPAMP_PATH], [HOST_COLLECTOR_OPAMP_ROUTE]])(
    "%s never answers with a web page",
    (requestPath: string) => {
      expect(shouldSkipDashboardFallbackRoute(requestPath)).toBe(true);
      expect(shouldSkipStatusPageDomainFallbackRoute(requestPath)).toBe(true);
    },
  );

  test("the reservation stops at its own path segment", () => {
    expect(shouldSkipDashboardFallbackRoute("/opamp")).toBe(true);
    expect(shouldSkipDashboardFallbackRoute("/opamp/v2")).toBe(true);
    expect(shouldSkipDashboardFallbackRoute("/opampx")).toBe(false);
    expect(shouldSkipDashboardFallbackRoute("/opamp-docs")).toBe(false);
  });
});
