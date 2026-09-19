import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * The OneUptime Health screens that ship in the enterprise Admin Dashboard
 * plugin, checked against the core they plug into.
 *
 * The screens call the health API by hand-typed paths, and core's page shells
 * render them by plugin key; neither half fails loudly when it drifts (a 404
 * shows as a generic error, a missing key as an upsell on the Enterprise
 * Edition). The core side of this wiring is pinned in
 * packages/App/Tests/AdminDashboard/TelemetryHealthPageWiring.test.ts.
 *
 * Source text is read rather than imported for the wiring pins (the screens
 * render React and pull in Common/UI); comments are stripped first so prose
 * cannot satisfy an assertion about code.
 */

const EE_DIR: string = path.resolve(__dirname, "..", "..", "..");
const HEALTH_DIR: string = path.join(EE_DIR, "AdminDashboard", "Health");
const REPOSITORY_ROOT: string = path.resolve(EE_DIR, "..");
const CORE_HEALTH_API: string = path.join(
  REPOSITORY_ROOT,
  "packages/App/API/AdminHealth.ts",
);
const EE_QUERY_CONSOLE_API: string = path.join(
  EE_DIR,
  "Server/AdminHealth/QueryConsole.ts",
);

const stripComments: (source: string) => string = (source: string): string => {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/[^\n]*/g, "$1");
};

const readHealthSource: (file: string) => string = (file: string): string => {
  return stripComments(fs.readFileSync(path.join(HEALTH_DIR, file), "utf8"));
};

const healthFiles: () => Array<string> = (): Array<string> => {
  return fs.readdirSync(HEALTH_DIR).filter((file: string): boolean => {
    return file.endsWith(".ts") || file.endsWith(".tsx");
  });
};

// The static tail of every "/admin/health/..." URL a screen builds.
const API_PATH_PATTERN: RegExp = /["`]\/admin\/health(\/[^"`$]*)/g;

// A core Health page imported through the admin-dashboard specifier.
const CORE_HEALTH_PAGE_IMPORT: RegExp =
  /@oneuptime\/admin-dashboard\/Pages\/Health\//;

// Any relative import that climbs out of the screen's own directory.
const RELATIVE_IMPORT: RegExp = /from "\.\.\//;

const PLUGIN_ENTRIES: Array<{ key: string; module: string }> = [
  { key: "HealthOverview", module: "./Overview" },
  { key: "HealthQueues", module: "./Queues" },
  { key: "HealthPostgres", module: "./Postgres" },
  { key: "HealthRedis", module: "./Redis" },
  { key: "HealthLogs", module: "./DiagnosticLogs" },
  { key: "HealthTelemetry", module: "./Telemetry" },
  { key: "HealthQueryConsole", module: "./QueryConsole" },
  { key: "HealthClickhouseCluster", module: "./ClickhouseCluster" },
];

describe("the Health plugin object", () => {
  const pluginsSource: string = readHealthSource("Plugins.ts");

  test.each(PLUGIN_ENTRIES)(
    "$key is a lazy import of $module",
    (entry: { key: string; module: string }) => {
      expect(pluginsSource).toMatch(
        new RegExp(
          `${entry.key}: React\\.lazy\\(\\(\\) => \\{\\s*return import\\("${entry.module.replace(
            /[.*+?^${}()|[\]\\/]/g,
            "\\$&",
          )}"\\);`,
        ),
      );
      expect(
        fs.existsSync(path.join(HEALTH_DIR, `${entry.module.slice(2)}.tsx`)),
      ).toBe(true);
    },
  );

  /*
   * The instance log is the audit trail of ClickHouse capacity notifications
   * and pruning, which are Community features: core renders it on every
   * edition, so the plugin must not replace it.
   */
  test("does not provide the instance log", () => {
    expect(pluginsSource).not.toMatch(/HealthInstanceLogs:/);
  });

  test("is assembled into the Admin Dashboard plugin", () => {
    const indexSource: string = stripComments(
      fs.readFileSync(path.join(EE_DIR, "AdminDashboard", "Index.tsx"), "utf8"),
    );

    expect(indexSource).toContain(
      'import HealthPlugins from "./Health/Plugins"',
    );
    expect(indexSource).toContain("...HealthPlugins");
  });
});

describe("the Health screens render content only", () => {
  /*
   * Core's shells keep the Health layout (breadcrumbs, side menu) around the
   * plugin. A screen that wrapped itself in HealthPage again would render the
   * menu twice; one that imported a core shell would re-enter the plugin door
   * while the Enterprise bundle is still loading.
   */
  test.each(PLUGIN_ENTRIES)(
    "$module does not wrap itself in the Health layout",
    (entry: { key: string; module: string }) => {
      const source: string = readHealthSource(`${entry.module.slice(2)}.tsx`);

      expect(source).not.toContain("<HealthPage");
      expect(source).not.toContain("Pages/Health/HealthPage");
    },
  );

  test("no screen imports a core Health shell or the plugin door", () => {
    for (const file of healthFiles()) {
      const source: string = readHealthSource(file);

      expect({
        file,
        importsCoreHealthPage: CORE_HEALTH_PAGE_IMPORT.test(source),
        importsPluginDoor: source.includes("Enterprise/Plugins"),
      }).toEqual({
        file,
        importsCoreHealthPage: false,
        importsPluginDoor: false,
      });
    }
  });

  test("no screen reaches core through a relative path", () => {
    for (const file of healthFiles()) {
      const source: string = readHealthSource(file);

      expect({ file, relativeCore: RELATIVE_IMPORT.test(source) }).toEqual({
        file,
        relativeCore: false,
      });
    }
  });
});

describe("every health API path a screen calls is served", () => {
  const coreApi: string = stripComments(
    fs.readFileSync(CORE_HEALTH_API, "utf8"),
  );
  const consoleApi: string = stripComments(
    fs.readFileSync(EE_QUERY_CONSOLE_API, "utf8"),
  );

  const calledPaths: Array<{ file: string; apiPath: string }> = [];

  for (const file of healthFiles()) {
    for (const match of readHealthSource(file).matchAll(API_PATH_PATTERN)) {
      calledPaths.push({ file, apiPath: match[1] as string });
    }
  }

  test("the screens call the API at all (the pattern still matches)", () => {
    expect(calledPaths.length).toBeGreaterThanOrEqual(10);
  });

  test.each(calledPaths)(
    "$file calls $apiPath",
    (called: { file: string; apiPath: string }) => {
      if (called.apiPath === "/query/") {
        // `/admin/health/query/${engine}`: served by the enterprise console.
        expect(consoleApi).toContain("`/query/${engine}`");
        return;
      }

      if (called.apiPath === "/queues/") {
        // `/admin/health/queues/${queueName}/failed-jobs`.
        expect(coreApi).toContain('"/queues/:queueName/failed-jobs"');
        return;
      }

      expect(coreApi).toContain(`"${called.apiPath}"`);
    },
  );
});

describe("Telemetry", () => {
  const telemetrySource: string = readHealthSource("Telemetry.tsx");

  test("renders both views as tabs", () => {
    expect(telemetrySource).toContain("<TelemetryIngestionBySignal />");
    expect(telemetrySource).toContain("<TelemetryIngestionByProject />");
    expect(telemetrySource).toContain("<Tabs");
    expect(telemetrySource).toMatch(/name:\s*"By signal"/);
    expect(telemetrySource).toMatch(/name:\s*"By project"/);
  });

  test("the by-signal card calls the by-signal route", () => {
    expect(readHealthSource("TelemetryIngestionBySignal.tsx")).toContain(
      '"/admin/health/clickhouse-telemetry-ingestion"',
    );
  });

  test("the by-project card calls the by-project route", () => {
    expect(readHealthSource("TelemetryIngestionByProject.tsx")).toContain(
      '"/admin/health/clickhouse-telemetry-ingestion-by-project"',
    );
  });
});

describe("the live overview", () => {
  const overviewSource: string = readHealthSource("Overview.tsx");

  test("offers the enterprise screens as shortcuts", () => {
    expect(overviewSource).toContain("route(PageMap.HEALTH_TELEMETRY)");
    expect(overviewSource).toContain("route(PageMap.HEALTH_QUERY)");
    expect(overviewSource).toContain("route(PageMap.HEALTH_LOGS)");
  });

  /*
   * Core's landing page lists the tools that work on every edition right under
   * this overview; repeating them here would show each link twice.
   */
  test("leaves the every-edition tools to core's landing page", () => {
    for (const page of [
      "HEALTH_MIGRATIONS",
      "HEALTH_SUPPORT_BUNDLE",
      "HEALTH_PROBES",
      "HEALTH_INSTANCE_LOGS",
    ]) {
      expect({
        page,
        linked: overviewSource.includes(`route(PageMap.${page})`),
      }).toEqual({ page, linked: false });
    }
  });

  test("reads the licensed overview endpoint", () => {
    expect(overviewSource).toContain('"/admin/health/overview"');
  });
});
