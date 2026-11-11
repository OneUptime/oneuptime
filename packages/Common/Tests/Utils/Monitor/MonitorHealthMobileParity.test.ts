import fs from "fs";
import path from "path";
import vm from "vm";
import ts from "typescript";
import { describe, expect, test } from "@jest/globals";
import {
  getMonitorListQuery,
  getMonitorListRowStatus,
} from "../../../Utils/Dashboard/MonitorListWidgetFormat";
import MonitoringOff from "../../../Utils/Monitor/MonitoringOff";
import NotOperationalMonitorQuery from "../../../Utils/Monitor/NotOperationalMonitorQuery";

/*
 * THE MOBILE APP'S COPY OF THE MONITOR RULES SAYS WHAT THE WEB'S SAYS
 * (issue #6475).
 *
 * The app is built without Common's runtime code, so it keeps its own copy
 * of which monitors are listed, which are Disabled and which have an issue
 * (MobileApp/src/utils/monitorHealth). Its Monitor issues count on Home kept
 * counting a monitor whose monitoring is off - its status frozen at
 * "Offline" by its last check - long after the web stopped (#6400). This
 * suite compiles the app's file as it is and holds it to
 * NotOperationalMonitorQuery and MonitoringOff, query for query and monitor
 * for monitor, so the two cannot drift apart again.
 */

const REPOSITORY_ROOT: string = path.resolve(__dirname, "../../../../..");
const MOBILE_FILE: string = path.join(
  REPOSITORY_ROOT,
  "packages/MobileApp/src/utils/monitorHealth.ts",
);

type MobileHealth = "disabled" | "issue" | "healthy" | "unknown";

interface MobileMonitor {
  disableActiveMonitoring?: boolean | null | undefined;
  currentMonitorStatus?:
    | { isOperationalState?: boolean | null | undefined }
    | null
    | undefined;
}

interface MobileRules {
  getListedMonitorsQuery: () => Record<string, unknown>;
  getDisabledMonitorsQuery: () => Record<string, unknown>;
  getMonitorIssuesQuery: () => Record<string, unknown>;
  getMonitorHealth: (monitor: MobileMonitor) => MobileHealth;
}

// The app's file compiled to CommonJS as it is and run in a fresh context.
function loadMobileRules(): MobileRules {
  const compiled: string = ts.transpileModule(
    fs.readFileSync(MOBILE_FILE, "utf8"),
    {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2019,
      },
      fileName: "monitorHealth.ts",
    },
  ).outputText;

  const moduleObject: { exports: Record<string, unknown> } = { exports: {} };

  vm.runInNewContext(compiled, {
    module: moduleObject,
    exports: moduleObject.exports,
    require: (specifier: string): never => {
      throw new Error(
        `The app's monitorHealth.ts imports ${specifier}: it must import nothing, so this suite can run it as it is.`,
      );
    },
  });

  return moduleObject.exports as unknown as MobileRules;
}

const MOBILE: MobileRules = loadMobileRules();

// A value made in the other context, as plain JSON in this one.
function plain(value: unknown): unknown {
  return JSON.parse(JSON.stringify(value));
}

// Whether a stored monitor matches one of these flat queries.
function matches(
  query: Record<string, unknown>,
  monitor: StoredMonitor,
): boolean {
  for (const [key, expected] of Object.entries(query)) {
    if (key === "currentMonitorStatus") {
      const statusQuery: Record<string, unknown> = expected as Record<
        string,
        unknown
      >;

      for (const [statusKey, statusExpected] of Object.entries(statusQuery)) {
        if (
          !monitor.currentMonitorStatus ||
          (monitor.currentMonitorStatus as Record<string, unknown>)[
            statusKey
          ] !== statusExpected
        ) {
          return false;
        }
      }

      continue;
    }

    if ((monitor as unknown as Record<string, unknown>)[key] !== expected) {
      return false;
    }
  }

  return true;
}

/*
 * A monitor as stored: both flags are NOT NULL columns, so each is true or
 * false; a monitor may have no current status.
 */
interface StoredMonitor {
  isArchived: boolean;
  disableActiveMonitoring: boolean;
  currentMonitorStatus: { isOperationalState: boolean } | null;
}

const STORED_MONITORS: Array<StoredMonitor> = [];

for (const isArchived of [false, true]) {
  for (const disableActiveMonitoring of [false, true]) {
    for (const currentMonitorStatus of [
      { isOperationalState: true },
      { isOperationalState: false },
      null,
    ]) {
      STORED_MONITORS.push({
        isArchived,
        disableActiveMonitoring,
        currentMonitorStatus,
      });
    }
  }
}

describe("the app's file", () => {
  test("imports nothing, so it can be held to the web's rules as it is", () => {
    const source: string = fs.readFileSync(MOBILE_FILE, "utf8");

    expect(source).not.toMatch(/^\s*import\s/m);
    expect(source).not.toMatch(/\brequire\(/);
  });

  test("exports the four rules this suite holds it to", () => {
    for (const name of [
      "getListedMonitorsQuery",
      "getDisabledMonitorsQuery",
      "getMonitorIssuesQuery",
      "getMonitorHealth",
    ]) {
      expect({
        name,
        type: typeof (MOBILE as unknown as Record<string, unknown>)[name],
      }).toEqual({
        name,
        type: "function",
      });
    }
  });
});

describe("the queries the app sends ask for what the web's do", () => {
  test("Monitor issues is Not Operational, word for word", () => {
    expect(plain(MOBILE.getMonitorIssuesQuery())).toEqual(
      plain(NotOperationalMonitorQuery.getQuery()),
    );
  });

  test("the listed monitors are the Monitor List widget's with no filter: all but the archived ones", () => {
    expect(plain(MOBILE.getListedMonitorsQuery())).toEqual(
      plain(getMonitorListQuery({})),
    );
  });

  test("Disabled is the listed monitors whose monitoring is off", () => {
    expect(plain(MOBILE.getDisabledMonitorsQuery())).toEqual({
      ...(plain(getMonitorListQuery({})) as Record<string, unknown>),
      disableActiveMonitoring: true,
    });
  });

  test("every query is a fresh object: what one request adds reaches no other", () => {
    for (const getQuery of [
      MOBILE.getListedMonitorsQuery,
      MOBILE.getDisabledMonitorsQuery,
      MOBILE.getMonitorIssuesQuery,
    ]) {
      const first: Record<string, unknown> = getQuery();
      const before: unknown = plain(getQuery());
      first["isArchived"] = true;
      first["projectId"] = "project";

      expect(plain(getQuery())).toEqual(before);
      expect(getQuery()).not.toBe(getQuery());
    }

    const issues: Record<string, unknown> = MOBILE.getMonitorIssuesQuery();
    (issues["currentMonitorStatus"] as Record<string, unknown>)[
      "isOperationalState"
    ] = true;

    expect(plain(MOBILE.getMonitorIssuesQuery())).toEqual(
      plain(NotOperationalMonitorQuery.getQuery()),
    );
  });
});

/*
 * Every stored monitor, as the server would match it against each query and
 * as the Monitors screen files it: the screen lists under Issues, Disabled
 * and the rest exactly the monitors Home's counts count.
 */
describe("a monitor is filed where the web and the counts put it", () => {
  test.each(STORED_MONITORS)("%j", (monitor: StoredMonitor) => {
    const health: MobileHealth = MOBILE.getMonitorHealth(monitor);
    const isListed: boolean = matches(MOBILE.getListedMonitorsQuery(), monitor);

    // Disabled: monitoring off, whatever its status - as the web says.
    expect(health === "disabled").toBe(MonitoringOff.isOff(monitor));
    expect(health === "disabled").toBe(
      getMonitorListRowStatus({
        disableActiveMonitoring: monitor.disableActiveMonitoring,
        currentMonitorStatus: monitor.currentMonitorStatus
          ? {
              name: monitor.currentMonitorStatus.isOperationalState
                ? "Operational"
                : "Offline",
            }
          : null,
      }).isMonitoringOff,
    );

    // Among listed monitors, the counts count what the screen files.
    if (isListed) {
      expect(health === "issue").toBe(
        matches(
          plain(NotOperationalMonitorQuery.getQuery()) as Record<
            string,
            unknown
          >,
          monitor,
        ),
      );
      expect(health === "issue").toBe(
        matches(MOBILE.getMonitorIssuesQuery(), monitor),
      );
      expect(health === "disabled").toBe(
        matches(MOBILE.getDisabledMonitorsQuery(), monitor),
      );
    }

    // An archived monitor is in none of the counts.
    if (monitor.isArchived) {
      expect(isListed).toBe(false);
      expect(matches(MOBILE.getMonitorIssuesQuery(), monitor)).toBe(false);
      expect(matches(MOBILE.getDisabledMonitorsQuery(), monitor)).toBe(false);
    }
  });

  test("an Offline monitor whose monitoring is off is Disabled, never an issue", () => {
    expect(
      MOBILE.getMonitorHealth({
        disableActiveMonitoring: true,
        currentMonitorStatus: { isOperationalState: false },
      }),
    ).toBe("disabled");
  });

  test("a monitor read without the flag is filed by its status, as MonitoringOff reads it", () => {
    for (const disableActiveMonitoring of [undefined, null]) {
      expect(MonitoringOff.isOff({ disableActiveMonitoring })).toBe(false);
      expect(
        MOBILE.getMonitorHealth({
          disableActiveMonitoring,
          currentMonitorStatus: { isOperationalState: false },
        }),
      ).toBe("issue");
      expect(
        MOBILE.getMonitorHealth({
          disableActiveMonitoring,
          currentMonitorStatus: { isOperationalState: true },
        }),
      ).toBe("healthy");
    }
  });

  test("a monitor with no status, or none read, is unknown - not healthy", () => {
    for (const currentMonitorStatus of [
      null,
      undefined,
      {},
      { isOperationalState: null },
    ]) {
      expect(
        MOBILE.getMonitorHealth({
          disableActiveMonitoring: false,
          currentMonitorStatus,
        }),
      ).toBe("unknown");
    }
  });
});
