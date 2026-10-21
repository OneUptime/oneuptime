import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * An archived monitor must not be checked by anything: not a probe, not a
 * worker, not an ingest path. Before archiving existed, "is this monitor
 * checked" was spelled out by hand wherever it was asked - three flags in a
 * query, three flags in an `||` - and archiving added a fourth. One place that
 * kept the old three would quietly keep probing archived monitors and opening
 * incidents for them.
 *
 * So the rule now lives in two helpers - MonitorService.getEnabledMonitorQuery
 * for queries and MonitorPauseState for a monitor already read - and this
 * guard keeps it there: it reads the server and dashboard sources and fails
 * when the three-flag rule is spelled out somewhere without the fourth.
 */

const PACKAGES_DIR: string = path.resolve(__dirname, "../../../../../");

const SCANNED_ROOTS: Array<string> = [
  "Common/Server",
  "Common/Utils",
  "Common/UI",
  "App/FeatureSet",
  "App/Services",
];

const SKIPPED_PATH_PARTS: Array<string> = [
  `${path.sep}node_modules${path.sep}`,
  `${path.sep}build${path.sep}`,
  `${path.sep}Tests${path.sep}`,
  `${path.sep}SchemaMigrations${path.sep}`,
];

const SOURCE_FILE: RegExp = /\.(ts|tsx)$/;
const TEST_FILE: RegExp = /\.test\.(ts|tsx)$/;

// The query form of "not paused by maintenance".
const MAINTENANCE_QUERY_FALSE: RegExp =
  /disableActiveMonitoringBecauseOfScheduledMaintenanceEvent:\s*false/;
// The SQL form.
const MAINTENANCE_SQL_FALSE: RegExp =
  /"disableActiveMonitoringBecauseOfScheduledMaintenanceEvent"\s*=\s*false/;
// Reading the flag off a monitor (not writing it as an object key).
const MAINTENANCE_FLAG_READ: RegExp =
  /\.disableActiveMonitoringBecauseOfScheduledMaintenanceEvent\b/;
// Inside an update's `data: { ... }` - a write-back, not a question.
const INSIDE_DATA_BLOCK: RegExp = /data:\s*\{[^{}]*$/;
// Any mention of the archive flag.
const MENTIONS_ARCHIVED: RegExp = /\bisArchived\b/;
// A select (or query) that reads the archive flag.
const SELECTS_ARCHIVED: RegExp = /isArchived:\s*true/;

function walk(directory: string): Array<string> {
  if (!fs.existsSync(directory)) {
    return [];
  }

  return fs
    .readdirSync(directory, { withFileTypes: true })
    .flatMap((entry: fs.Dirent): Array<string> => {
      const full: string = path.join(directory, entry.name);

      if (
        SKIPPED_PATH_PARTS.some((part: string): boolean => {
          return `${full}${path.sep}`.includes(part);
        })
      ) {
        return [];
      }

      if (entry.isDirectory()) {
        return walk(full);
      }

      return SOURCE_FILE.test(entry.name) && !TEST_FILE.test(entry.name)
        ? [full]
        : [];
    });
}

// Source with comments removed, so a comment that names a flag never counts.
function code(file: string): string {
  return fs
    .readFileSync(file, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/(^|[^:"'`])\/\/[^\n]*/g, "$1");
}

function relative(file: string): string {
  return path.relative(PACKAGES_DIR, file).split(path.sep).join("/");
}

const SOURCES: Array<string> = SCANNED_ROOTS.flatMap(
  (root: string): Array<string> => {
    return walk(path.join(PACKAGES_DIR, root));
  },
);

describe("every place that asks whether a monitor is checked also asks whether it is archived", () => {
  test("the scan reads the server, the workers and the dashboard", () => {
    const files: Array<string> = SOURCES.map(relative);

    expect(files).toContain("Common/Server/Services/MonitorService.ts");
    expect(files).toContain(
      "App/FeatureSet/Workers/Jobs/TelemetryMonitor/MonitorTelemetryMonitor.ts",
    );
    expect(files).toContain(
      "App/FeatureSet/Dashboard/src/Components/Monitor/MonitorTable.tsx",
    );
  });

  test("the query form of the rule is only spelled out in getEnabledMonitorQuery, with isArchived", () => {
    /*
     * Writing the flag back to false when a maintenance event ends (an
     * update's `data: { ... }`) is not asking the question, so it is skipped.
     */
    const isQuery: (source: string, at: number) => boolean = (
      source: string,
      at: number,
    ): boolean => {
      const before: string = source.slice(Math.max(0, at - 200), at);
      return !INSIDE_DATA_BLOCK.test(before);
    };

    const spelledOut: Array<string> = SOURCES.filter(
      (file: string): boolean => {
        const source: string = code(file);
        const pattern: RegExp = new RegExp(MAINTENANCE_QUERY_FALSE.source, "g");
        let match: RegExpExecArray | null = pattern.exec(source);

        while (match) {
          if (isQuery(source, match.index)) {
            return true;
          }
          match = pattern.exec(source);
        }

        return false;
      },
    ).map(relative);

    expect(spelledOut).toEqual(["Common/Server/Services/MonitorService.ts"]);

    const monitorService: string = code(
      path.join(PACKAGES_DIR, "Common/Server/Services/MonitorService.ts"),
    );
    const start: number = monitorService.indexOf("getEnabledMonitorQuery()");
    const body: string = monitorService.slice(
      start,
      monitorService.indexOf("}", monitorService.indexOf("return {", start)),
    );

    expect(start).toBeGreaterThan(-1);
    expect(body).toMatch(MAINTENANCE_QUERY_FALSE);
    expect(body).toMatch(/isArchived:\s*false/);
  });

  test("the SQL form is only in the probe claim, and it leaves archived monitors out", () => {
    const spelledOut: Array<string> = SOURCES.filter(
      (file: string): boolean => {
        return MAINTENANCE_SQL_FALSE.test(code(file));
      },
    ).map(relative);

    expect(spelledOut).toEqual([
      "Common/Server/Services/MonitorProbeService.ts",
    ]);

    const sql: string = code(
      path.join(PACKAGES_DIR, "Common/Server/Services/MonitorProbeService.ts"),
    );
    const where: string = sql.slice(
      sql.indexOf('FROM "MonitorProbe" mp'),
      sql.indexOf("FOR UPDATE OF mp SKIP LOCKED"),
    );

    expect(where).toMatch(MAINTENANCE_SQL_FALSE);
    expect(where).toMatch(/m\."isArchived"\s*=\s*false/);
  });

  test("a file that reads the pause flags off a monitor reads isArchived too", () => {
    const readers: Array<string> = SOURCES.filter((file: string): boolean => {
      return MAINTENANCE_FLAG_READ.test(code(file));
    });

    // Not vacuous: the dashboard's banner and the result pipeline read them.
    expect(readers.length).toBeGreaterThan(0);

    const missingArchived: Array<string> = readers
      .filter((file: string): boolean => {
        const source: string = code(file);
        return (
          !MENTIONS_ARCHIVED.test(source) &&
          !source.includes("MonitorPauseState")
        );
      })
      .map(relative);

    expect(missingArchived).toEqual([]);
  });

  test("a select that reads the three pause flags by hand reads isArchived with them", () => {
    /*
     * A select that lists the three older flags but not isArchived feeds a
     * check that cannot see archiving. MONITOR_PAUSE_FLAGS_SELECT reads all
     * four; a hand-written list must too.
     */
    const handWrittenSelect: RegExp =
      /disableActiveMonitoring:\s*true,\s*disableActiveMonitoringBecauseOfManualIncident:\s*true,\s*disableActiveMonitoringBecauseOfScheduledMaintenanceEvent:\s*true/g;

    const offenders: Array<string> = [];

    for (const file of SOURCES) {
      const source: string = code(file);
      let match: RegExpExecArray | null = handWrittenSelect.exec(source);

      while (match) {
        const around: string = source.slice(
          Math.max(0, match.index - 400),
          match.index + match[0].length + 400,
        );

        if (!SELECTS_ARCHIVED.test(around)) {
          offenders.push(relative(file));
        }

        match = handWrittenSelect.exec(source);
      }

      handWrittenSelect.lastIndex = 0;
    }

    expect(offenders).toEqual([]);
  });
});
