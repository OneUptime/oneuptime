import fs from "fs";
import path from "path";
import vm from "vm";
import ts from "typescript";
import { describe, expect, test } from "@jest/globals";
import { Amber600, Gray500, Red500 } from "../../../Types/BrandColors";
import Color from "../../../Types/Color";
import NotNull from "../../../Types/BaseDatabase/NotNull";
import MonitorType from "../../../Types/Monitor/MonitorType";
import CronTab from "../../../Utils/CronTab";
import {
  MONITOR_LIST_STATUS_FILTER_OPERATIONAL,
  getMonitorListQuery,
  getMonitorListRowStatus,
} from "../../../Utils/Dashboard/MonitorListWidgetFormat";
import MonitorFirstCheck from "../../../Utils/Monitor/MonitorFirstCheck";
import MonitorOverviewFamilyUtil from "../../../Utils/Monitor/MonitorOverviewFamily";
import MonitorRowStatusUtil, {
  MONITOR_ROW_STATUS_COLORS,
  MONITOR_ROW_STATUS_SELECT,
  MONITOR_ROW_STATUS_WORDS,
  MonitorRowStatus,
  MonitorRowStatusFields,
  MonitorRowStatusKind,
} from "../../../Utils/Monitor/MonitorRowStatus";
import MonitoringIntervalUtil, {
  MonitoringIntervalNormalization,
  MonitoringIntervalNormalizationStatus,
} from "../../../Utils/Monitor/MonitoringIntervalUtil";
import MonitoringOff from "../../../Utils/Monitor/MonitoringOff";
import NotOperationalMonitorQuery from "../../../Utils/Monitor/NotOperationalMonitorQuery";
import MonitoringIntervalValidator from "../../../Server/Utils/Monitor/MonitoringIntervalValidator";

/*
 * THE MOBILE APP'S COPY OF THE MONITOR RULES SAYS WHAT THE WEB'S SAYS
 * (issues #6475, #8961).
 *
 * The app is built without Common's runtime code, so it keeps its own copy
 * of which monitors are listed, which are Disabled and which have an issue,
 * and of what a monitor's row says its status is
 * (MobileApp/src/utils/monitorHealth), with the rule for a monitor nothing
 * has checked yet (utils/monitorFirstCheck) and the cron reading that rule
 * needs (utils/cronSchedule). Each copy drifted once, silently: Home's
 * Monitor issues count kept counting a monitor whose monitoring is off long
 * after the web stopped (#6400), and the Monitors screen kept listing a
 * monitor nothing had checked yet as Operational after the web said
 * Waiting for data (#8899, #8961).
 *
 * This suite compiles the app's files as they are, runs them in a fresh
 * context, and holds them to the web's rules - NotOperationalMonitorQuery,
 * MonitoringOff, MonitorRowStatus, MonitorFirstCheck, MonitorOverviewFamily,
 * MonitoringIntervalUtil and CronTab - query for query, monitor for monitor
 * and schedule for schedule, so they cannot drift apart again.
 */

const REPOSITORY_ROOT: string = path.resolve(__dirname, "../../../../..");
const MOBILE_UTILS: string = path.join(
  REPOSITORY_ROOT,
  "packages/MobileApp/src/utils",
);

type ModuleExports = Record<string, unknown>;

/*
 * One of the app's files compiled to CommonJS as it is and run in a fresh
 * context, given only the app's other copies it imports.
 */
function loadMobileModule(
  fileName: string,
  modules: Record<string, ModuleExports>,
): ModuleExports {
  const compiled: string = ts.transpileModule(
    fs.readFileSync(path.join(MOBILE_UTILS, fileName), "utf8"),
    {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2019,
      },
      fileName: fileName,
    },
  ).outputText;

  const moduleObject: { exports: ModuleExports } = { exports: {} };

  vm.runInNewContext(compiled, {
    module: moduleObject,
    exports: moduleObject.exports,
    require: (specifier: string): ModuleExports => {
      const required: ModuleExports | undefined = modules[specifier];

      if (!required) {
        throw new Error(
          `The app's ${fileName} imports ${specifier}: it may import only the app's other copies of the web's rules, so this suite can run it as it is.`,
        );
      }

      return required;
    },
  });

  return moduleObject.exports;
}

type MobileHealth = "disabled" | "issue" | "notChecked" | "healthy" | "unknown";

interface MobileRowStatus {
  kind: string;
  text: string;
  isProductWords: boolean;
  tone: "neutral" | "danger" | "warning" | null;
}

interface MobileCron {
  CRON_MONTH_NAMES: ReadonlyArray<string>;
  isVariableCronExpression: (expression: unknown) => boolean;
  isValidCronExpression: (expression: unknown) => boolean;
  getNextCronRuns: (
    expression: string,
    count: number,
    after: Date,
  ) => Array<Date>;
}

interface MobileFirstCheck {
  getMonitorFamily: (monitorType: unknown) => string | null;
  isNeverMeasured: (monitor: unknown) => boolean;
  isStartingStatus: (status: unknown) => boolean;
  isStatusUnmeasured: (monitor: unknown) => boolean;
  readMonitoringInterval: (value: unknown) => string | null;
  parseMonitorDate: (value: unknown) => Date | undefined;
  isFirstCheckOverdue: (data: { monitor: unknown; now: Date }) => boolean;
}

interface MobileRules {
  MONITOR_ROW_STATUS_WORDS: Record<string, string>;
  MONITOR_ROW_STATUS_TONES: Record<string, string>;
  getMonitorRowStatusSelect: () => Record<string, unknown>;
  getMonitorRowStatus: (monitor: unknown, now?: Date) => MobileRowStatus;
  getListedMonitorsQuery: () => Record<string, unknown>;
  getDisabledMonitorsQuery: () => Record<string, unknown>;
  getMonitorIssuesQuery: () => Record<string, unknown>;
  getMonitorHealth: (monitor: unknown) => MobileHealth;
}

const cronModule: ModuleExports = loadMobileModule("cronSchedule.ts", {});
const firstCheckModule: ModuleExports = loadMobileModule(
  "monitorFirstCheck.ts",
  { "./cronSchedule": cronModule },
);
const healthModule: ModuleExports = loadMobileModule("monitorHealth.ts", {
  "./monitorFirstCheck": firstCheckModule,
});

const MOBILE_CRON: MobileCron = cronModule as unknown as MobileCron;
const MOBILE_FIRST_CHECK: MobileFirstCheck =
  firstCheckModule as unknown as MobileFirstCheck;
const MOBILE: MobileRules = healthModule as unknown as MobileRules;

// A value made in the other context, as plain JSON in this one.
function plain(value: unknown): unknown {
  return JSON.parse(JSON.stringify(value));
}

// The specifiers a file imports.
function importsOf(fileName: string): Array<string> {
  const source: string = fs.readFileSync(
    path.join(MOBILE_UTILS, fileName),
    "utf8",
  );
  const specifiers: Array<string> = [];

  for (const match of source.matchAll(/\bfrom\s+"([^"]+)"/g)) {
    specifiers.push(match[1]!);
  }

  for (const match of source.matchAll(/\brequire\(\s*"([^"]+)"\s*\)/g)) {
    specifiers.push(match[1]!);
  }

  return specifiers;
}

const NOW: Date = new Date("2026-11-16T12:00:00.000Z");
const SECOND: number = 1000;
const MINUTE: number = 60 * SECOND;
const HOUR: number = 60 * MINUTE;
const DAY: number = 24 * HOUR;

/*
 * The times "now" is put at: a Monday noon, a month's last minute, a leap
 * day, a year's turn and a Sunday night, all UTC as every time here is.
 */
const NOWS: Array<Date> = [
  NOW,
  new Date("2026-11-30T23:59:30.000Z"),
  new Date("2028-02-29T00:00:10.000Z"),
  new Date("2026-12-31T23:58:00.000Z"),
  new Date("2026-11-22T23:30:00.500Z"),
];

/*
 * How long before "now" a monitor was created: around every grace the rule
 * draws (five minutes, two runs), long ago, just now, and in the future
 * (clock skew).
 */
const CREATED_AGO: Array<number> = [
  -HOUR,
  0,
  30 * SECOND,
  MINUTE,
  3 * MINUTE,
  5 * MINUTE + 59 * SECOND,
  6 * MINUTE + SECOND,
  10 * MINUTE,
  14 * MINUTE,
  16 * MINUTE,
  31 * MINUTE,
  65 * MINUTE,
  2 * HOUR,
  3 * HOUR + 1,
  13 * HOUR,
  25 * HOUR,
  3 * DAY,
  8 * DAY,
  40 * DAY,
  400 * DAY,
];

/*
 * Schedules CronTab reads that never run - a day no allowed month has -
 * whose search for a run goes through its whole horizon.
 */
const CRON_WITHOUT_RUNS: Array<string> = [
  "0 0 30 2 *",
  "0 0 31 4 *",
  "0 0 31 2,4 *",
  "0 0 0 30 2 *",
];

// Schedules as cron, of every shape CronTab reads, and some it does not.
const CRON_EXPRESSIONS: Array<string> = [
  ...CRON_WITHOUT_RUNS,
  ...CronTab.PRESETS.map((preset: { value: string }): string => {
    return preset.value;
  }),
  "* * * * *",
  "*/2 * * * *",
  "*/5 * * * *",
  "*/7 * * * *",
  "*/10 * * * *",
  "*/30 * * * *",
  "0 * * * *",
  "0 0 * * *",
  "0 0 * * 0",
  "0 0 * * 7",
  "0 0 * * sun",
  "0 9 * * 1",
  "0 12 * * mon-fri",
  "*/5 9-17 * * 1-5",
  "15,45 * * * *",
  "5/15 * * * *",
  "0-30/10 * * * *",
  "0 */2 * * *",
  "0 0 1 */3 *",
  "0 0 1 jan,jul *",
  "0 0 1-7 * 1",
  "0 0 29 2 *",
  "0 0 30 2 1",
  "0 0 31 1,2 *",
  "0 0 31 * *",
  "0 */5 * * * *",
  "30 */5 * * * *",
  "*/30 * * * * *",
  "0 0 12 * * MON",
  "  */5 * * * *  ",
  "*/5  *  *  *  *",
  "0 0 L * *",
  "@hourly",
  "* * * *",
  "* * * * * * *",
  "61 * * * *",
  "* 24 * * *",
  "* * 0 * *",
  "* * * 13 *",
  "* * * * 8",
  "*/0 * * * *",
  "5-1 * * * *",
  "1,,2 * * * *",
  "*/5/2 * * * *",
  "1-2-3 * * * *",
  "-5 * * * *",
  "/5 * * * *",
  "0 0 * foo *",
  "0 0 * * funday",
  "0 0 * marmalade *",
  "{{schedule}}",
  "*/5 {{hour}} * * *",
  "",
  "   ",
];

/*
 * What a monitor's interval may be written as - the dashboard's values,
 * custom cron, the labels and durations the API used to take, and text no
 * reading understands - before the server stores it.
 */
const INTERVAL_INPUTS: Array<string | null | undefined> = [
  ...CRON_EXPRESSIONS,
  "*/5\t* * * *",
  "*/5\u00a0* * * *",
  "5m",
  "Every 5 minutes",
  "Every 5 Minutes",
  "EVERY  5   MINUTES.",
  "Every Five Minutes",
  "every minute",
  "1 minute",
  "every-1-min",
  "2 hrs",
  "1 day",
  "hourly",
  "daily",
  "weekly",
  "every 7 minutes",
  "not a schedule",
  null,
  undefined,
];

/*
 * The values a monitor's interval column can hold for an input: what a
 * write stores now (MonitoringIntervalValidator, which refuses what nobody
 * reads), and what the upgrade left in a row written before that
 * (NormalizeMonitoringInterval: rewritten when understood, left as it was
 * otherwise).
 */
function storedIntervals(
  input: string | null | undefined,
): Array<string | null | undefined> {
  const normalization: MonitoringIntervalNormalization =
    MonitoringIntervalUtil.normalize(input);
  const stored: Array<string | null | undefined> = [
    normalization.status === MonitoringIntervalNormalizationStatus.Normalized
      ? normalization.cron
      : input,
  ];

  try {
    stored.push(MonitoringIntervalValidator.validateAndNormalize(input));
  } catch {
    // Refused: no write stores it.
  }

  return stored;
}

const STORED_INTERVALS: Array<string | null | undefined> = Array.from(
  new Set<string | null | undefined>(INTERVAL_INPUTS.flatMap(storedIntervals)),
);

const MONITOR_TYPES: Array<string> = Object.values(
  MonitorType,
) as Array<string>;

// Types this build of either side does not know, and names objects carry.
const UNKNOWN_MONITOR_TYPES: Array<unknown> = [
  "NotAMonitorType",
  "SSLCertificate",
  "IncomingRequest",
  "website",
  "constructor",
  "toString",
  "__proto__",
  "hasOwnProperty",
  "",
  null,
  undefined,
  42,
];

// One type of each family, for the grids that would be too large with all.
const ONE_TYPE_PER_FAMILY: Array<string> = [
  MonitorType.Website,
  MonitorType.IncomingRequest,
  MonitorType.Server,
  MonitorType.Logs,
  MonitorType.Kubernetes,
  MonitorType.NetworkDevice,
  MonitorType.ProbeStatus,
  MonitorType.Manual,
];

describe("the app's files", () => {
  test("import only the app's other copies of the web's rules, so they can be held to them as they are", () => {
    expect(importsOf("cronSchedule.ts")).toEqual([]);
    expect(importsOf("monitorFirstCheck.ts")).toEqual(["./cronSchedule"]);
    expect(importsOf("monitorHealth.ts")).toEqual(["./monitorFirstCheck"]);
  });

  test("export the rules this suite holds them to", () => {
    const exported: Array<[ModuleExports, Array<string>]> = [
      [cronModule, ["isValidCronExpression", "getNextCronRuns"]],
      [
        firstCheckModule,
        [
          "getMonitorFamily",
          "isNeverMeasured",
          "isStartingStatus",
          "isStatusUnmeasured",
          "readMonitoringInterval",
          "parseMonitorDate",
          "isFirstCheckOverdue",
        ],
      ],
      [
        healthModule,
        [
          "getListedMonitorsQuery",
          "getDisabledMonitorsQuery",
          "getMonitorIssuesQuery",
          "getMonitorHealth",
          "getMonitorRowStatus",
          "getMonitorRowStatusSelect",
        ],
      ],
    ];

    for (const [moduleExports, names] of exported) {
      for (const name of names) {
        expect({ name, type: typeof moduleExports[name] }).toEqual({
          name,
          type: "function",
        });
      }
    }
  });
});

describe("the app reads a cron schedule as CronTab does", () => {
  test.each(CRON_EXPRESSIONS)(
    "%j is a schedule to both, or to neither",
    (expression: string) => {
      expect(MOBILE_CRON.isValidCronExpression(expression)).toBe(
        CronTab.isValid(expression),
      );
      expect(MOBILE_CRON.isVariableCronExpression(expression)).toBe(
        CronTab.isVariableExpression(expression),
      );
    },
  );

  test("what is no text is no schedule", () => {
    for (const value of [null, undefined, 5, {}, []]) {
      expect(MOBILE_CRON.isValidCronExpression(value)).toBe(false);
      expect(CronTab.isValid(value as unknown as string)).toBe(false);
    }
  });

  test("every valid schedule's next runs are CronTab's, from every kind of moment", () => {
    const froms: Array<Date> = [
      ...NOWS,
      new Date("2026-01-31T23:59:59.999Z"),
      new Date("2027-02-28T12:00:00.000Z"),
      new Date("2026-03-29T01:30:00.000Z"),
      new Date("2026-11-16T11:59:59.000Z"),
    ];
    let compared: number = 0;

    for (const expression of CRON_EXPRESSIONS) {
      if (!CronTab.isValid(expression)) {
        expect(() => {
          MOBILE_CRON.getNextCronRuns(expression, 1, NOW);
        }).toThrow();
        continue;
      }

      if (CRON_WITHOUT_RUNS.includes(expression)) {
        continue;
      }

      for (const from of froms) {
        const expected: Array<string> = CronTab.getNextExecutionTimes(
          expression,
          3,
          from,
        ).map((run: Date): string => {
          return run.toISOString();
        });
        const actual: Array<string> = MOBILE_CRON.getNextCronRuns(
          expression,
          3,
          from,
        ).map((run: Date): string => {
          return run.toISOString();
        });

        expect({ expression, from: from.toISOString(), runs: actual }).toEqual({
          expression,
          from: from.toISOString(),
          runs: expected,
        });
        compared++;
      }
    }

    expect(compared).toBeGreaterThan(300);
  });

  test.each(CRON_WITHOUT_RUNS)(
    "%j never runs, on either side: the search gives up at the same horizon",
    (expression: string) => {
      expect(CronTab.isValid(expression)).toBe(true);
      expect(MOBILE_CRON.getNextCronRuns(expression, 1, NOW)).toHaveLength(0);
      expect(CronTab.getNextExecutionTimes(expression, 1, NOW)).toHaveLength(0);
    },
  );

  test("month names are CronTab's", () => {
    expect([...MOBILE_CRON.CRON_MONTH_NAMES]).toEqual([
      "jan",
      "feb",
      "mar",
      "apr",
      "may",
      "jun",
      "jul",
      "aug",
      "sep",
      "oct",
      "nov",
      "dec",
    ]);
  });
});

describe("the app reads a monitor's interval as the web does", () => {
  test("for every value a monitor's interval can hold", () => {
    expect(STORED_INTERVALS.length).toBeGreaterThan(60);

    for (const stored of STORED_INTERVALS) {
      expect({
        stored,
        cron: MOBILE_FIRST_CHECK.readMonitoringInterval(stored),
      }).toEqual({ stored, cron: MonitoringIntervalUtil.toCronOrNull(stored) });
    }
  });

  test("a cron written with more spaces, a tab or a no-break space is read as the web reads it", () => {
    let compared: number = 0;

    for (const input of INTERVAL_INPUTS) {
      const collapsed: string = (input || "")
        .replace(/[\s\u00a0]+/g, " ")
        .trim();

      if (!CronTab.isValid(collapsed)) {
        continue;
      }

      expect({
        input,
        cron: MOBILE_FIRST_CHECK.readMonitoringInterval(input),
      }).toEqual({ input, cron: MonitoringIntervalUtil.toCronOrNull(input) });
      expect(MOBILE_FIRST_CHECK.readMonitoringInterval(input)).toBe(collapsed);
      compared++;
    }

    expect(compared).toBeGreaterThan(40);
  });

  test("whatever the server understands, it stores as a cron the app reads", () => {
    for (const input of INTERVAL_INPUTS) {
      const normalization: MonitoringIntervalNormalization =
        MonitoringIntervalUtil.normalize(input);

      if (normalization.cron) {
        expect({ input, valid: CronTab.isValid(normalization.cron) }).toEqual({
          input,
          valid: true,
        });
        expect(
          MOBILE_FIRST_CHECK.readMonitoringInterval(normalization.cron),
        ).toBe(normalization.cron);
      }
    }
  });

  test("a label such as 5m is never what a monitor holds: a write stores it as cron", () => {
    /*
     * The one reading the app leaves out, on purpose: it reads the column
     * as cron only, because nothing else is ever left in it that the web
     * reads (MonitoringIntervalValidator on every write, and the upgrade's
     * NormalizeMonitoringInterval for older rows).
     */
    for (const label of ["5m", "Every 5 minutes", "hourly", "1 day"]) {
      const stored: string | null =
        MonitoringIntervalValidator.validateAndNormalize(label);

      expect(stored).not.toBe(label);
      expect(MOBILE_FIRST_CHECK.readMonitoringInterval(stored)).toBe(
        MonitoringIntervalUtil.toCronOrNull(label),
      );
    }
  });
});

describe("the app knows each monitor type's family as the web does", () => {
  test.each(MONITOR_TYPES)("%j", (monitorType: string) => {
    expect(MOBILE_FIRST_CHECK.getMonitorFamily(monitorType)).toBe(
      MonitorOverviewFamilyUtil.getFamily(monitorType as MonitorType),
    );
  });

  test("a type the web does not know has no family, on either side", () => {
    for (const monitorType of UNKNOWN_MONITOR_TYPES) {
      expect({
        monitorType,
        family: MOBILE_FIRST_CHECK.getMonitorFamily(monitorType),
      }).toEqual({ monitorType, family: null });

      if (typeof monitorType === "string" && monitorType) {
        expect(() => {
          MonitorOverviewFamilyUtil.getFamily(monitorType as MonitorType);
        }).toThrow();
      }
    }
  });
});

/*
 * A monitor as the API hands one over: every flag the row rule reads as
 * true, false or not read, and its status of each kind a project's list
 * holds - with the both-ways status a project can configure, and none.
 */
const STATUSES: Array<MonitorRowStatusFields["currentMonitorStatus"]> = [
  {
    name: "Operational",
    color: "#10B981",
    isOperationalState: true,
    isOfflineState: false,
  },
  {
    name: "Offline",
    color: "#EF4444",
    isOperationalState: false,
    isOfflineState: true,
  },
  {
    name: "Degraded",
    color: "#F59E0B",
    isOperationalState: false,
    isOfflineState: false,
  },
  {
    name: "Both",
    color: "#6B7280",
    isOperationalState: true,
    isOfflineState: true,
  },
  { name: "", color: "#10B981", isOperationalState: true },
  { name: "Unflagged", color: "#10B981" },
  null,
  undefined,
];

function rowsOf(options: {
  monitorTypes: Array<unknown>;
  createdAgo: Array<number | null>;
  intervals: Array<string | null | undefined>;
}): Array<MonitorRowStatusFields> {
  const rows: Array<MonitorRowStatusFields> = [];
  const flags: Array<boolean | undefined> = [true, false, undefined];

  for (const isArchived of [false, true]) {
    for (const disableActiveMonitoring of flags) {
      for (const isNoProbeEnabledOnThisMonitor of [false, true]) {
        for (const isAllProbesDisconnectedFromThisMonitor of [false, true]) {
          for (const pause of [
            {},
            { disableActiveMonitoringBecauseOfManualIncident: true },
            {
              disableActiveMonitoringBecauseOfScheduledMaintenanceEvent: true,
            },
          ]) {
            for (const firstMeasuredAt of [
              null,
              "2026-11-01T00:00:00.000Z",
              undefined,
            ]) {
              for (const currentMonitorStatus of STATUSES) {
                for (const monitorType of options.monitorTypes) {
                  for (const ago of options.createdAgo) {
                    for (const monitoringInterval of options.intervals) {
                      rows.push({
                        isArchived,
                        disableActiveMonitoring,
                        isNoProbeEnabledOnThisMonitor,
                        isAllProbesDisconnectedFromThisMonitor,
                        ...pause,
                        firstMeasuredAt,
                        currentMonitorStatus,
                        monitorType: monitorType as MonitorType,
                        createdAt:
                          ago === null
                            ? undefined
                            : new Date(NOW.getTime() - ago).toISOString(),
                        monitoringInterval: monitoringInterval as string,
                      });
                    }
                  }
                }
              }
            }
          }
        }
      }
    }
  }

  return rows;
}

const ROWS: Array<MonitorRowStatusFields> = rowsOf({
  monitorTypes: [
    MonitorType.Website,
    MonitorType.IncomingRequest,
    MonitorType.Logs,
    MonitorType.Manual,
    null,
  ],
  createdAgo: [MINUTE, 2 * HOUR, null],
  intervals: ["*/5 * * * *", null],
});

// The tone the app draws a row's words in, as the web's colour for them.
function toneOf(color: Color | null): string | null {
  if (!color) {
    return null;
  }

  const byColor: Record<string, string> = {
    [Gray500.toString()]: "neutral",
    [Red500.toString()]: "danger",
    [Amber600.toString()]: "warning",
  };

  return byColor[color.toString()] ?? `own colour ${color.toString()}`;
}

// What the web's row says, in the terms the app's says it.
function webRow(
  monitor: MonitorRowStatusFields,
  now: Date = NOW,
): MobileRowStatus {
  const status: MonitorRowStatus = MonitorRowStatusUtil.getRowStatus(
    monitor,
    now,
  );

  return {
    kind: status.kind,
    text: status.text,
    isProductWords: status.isProductWords,
    tone:
      status.kind === MonitorRowStatusKind.Status ||
      status.kind === MonitorRowStatusKind.NoStatus
        ? null
        : (toneOf(status.color) as MobileRowStatus["tone"]),
  };
}

function appRow(
  monitor: MonitorRowStatusFields,
  now: Date = NOW,
): MobileRowStatus {
  return plain(MOBILE.getMonitorRowStatus(monitor, now)) as MobileRowStatus;
}

describe("the app's row says what the web's row says", () => {
  test("on every row of every flag, measurement, status, type and age", () => {
    expect(ROWS.length).toBeGreaterThan(20000);

    for (const row of ROWS) {
      const web: MobileRowStatus = webRow(row);
      const app: MobileRowStatus = appRow(row);

      if (app.kind !== web.kind || app.text !== web.text) {
        expect({ row, app }).toEqual({ row, app: web });
      }

      expect(app).toEqual(web);
    }
  });

  test("on a monitor nothing has checked yet, of every type, created at every age, on every interval it can hold", () => {
    let compared: number = 0;

    for (const now of NOWS) {
      for (const monitorType of [...MONITOR_TYPES, ...UNKNOWN_MONITOR_TYPES]) {
        for (const ago of CREATED_AGO) {
          for (const monitoringInterval of ["*/5 * * * *", "0 9 * * 1", null]) {
            const row: MonitorRowStatusFields = {
              isArchived: false,
              disableActiveMonitoring: false,
              monitorType: monitorType as MonitorType,
              firstMeasuredAt: null,
              createdAt: new Date(now.getTime() - ago).toISOString(),
              monitoringInterval: monitoringInterval as string,
              currentMonitorStatus: STATUSES[0],
            };

            expect({ row, app: appRow(row, now) }).toEqual({
              row,
              app: webRow(row, now),
            });
            compared++;
          }
        }
      }
    }

    expect(compared).toBeGreaterThan(3000);
  });

  test("words and tones are the web's, kind for kind", () => {
    expect(plain(MOBILE.MONITOR_ROW_STATUS_WORDS)).toEqual(
      plain(MONITOR_ROW_STATUS_WORDS),
    );

    const webTones: Record<string, string | null> = {};

    for (const [kind, color] of Object.entries(MONITOR_ROW_STATUS_COLORS)) {
      webTones[kind] = toneOf(color);
    }

    expect(plain(MOBILE.MONITOR_ROW_STATUS_TONES)).toEqual(webTones);
  });

  test("the app reads every field the web's row rule reads", () => {
    expect(plain(MOBILE.getMonitorRowStatusSelect())).toEqual(
      plain(MONITOR_ROW_STATUS_SELECT),
    );
  });

  test("the select is a fresh object each time: what one request adds reaches no other", () => {
    const first: Record<string, unknown> = MOBILE.getMonitorRowStatusSelect();
    first["_id"] = true;
    (first["currentMonitorStatus"] as Record<string, unknown>)["_id"] = true;

    expect(plain(MOBILE.getMonitorRowStatusSelect())).toEqual(
      plain(MONITOR_ROW_STATUS_SELECT),
    );
  });

  test("a monitor nothing has checked yet says Waiting for data, then No results yet, as the web's does", () => {
    const row: MonitorRowStatusFields = {
      monitorType: MonitorType.Website,
      firstMeasuredAt: null,
      createdAt: new Date(NOW.getTime() - MINUTE).toISOString(),
      monitoringInterval: "*/5 * * * *",
      currentMonitorStatus: STATUSES[0],
    };

    expect(appRow(row)).toEqual({
      kind: "WaitingForData",
      text: "Waiting for data",
      isProductWords: true,
      tone: "neutral",
    });
    expect(
      appRow({
        ...row,
        createdAt: new Date(NOW.getTime() - 2 * HOUR).toISOString(),
      }),
    ).toEqual({
      kind: "NoResultsYet",
      text: "No results yet",
      isProductWords: true,
      tone: "warning",
    });
  });
});

describe("the app's first-check rule is the web's", () => {
  test("never measured, its status the one it started in, on every row", () => {
    for (const row of ROWS) {
      expect({ row, never: MOBILE_FIRST_CHECK.isNeverMeasured(row) }).toEqual({
        row,
        never: MonitorFirstCheck.isNeverMeasured(row),
      });
      expect({
        row,
        unmeasured: MOBILE_FIRST_CHECK.isStatusUnmeasured(row),
      }).toEqual({
        row,
        unmeasured: MonitorFirstCheck.isStatusUnmeasured(row),
      });
    }

    for (const status of STATUSES) {
      expect(MOBILE_FIRST_CHECK.isStartingStatus(status)).toBe(
        MonitorFirstCheck.isStartingStatus(status),
      );
    }

    expect(MOBILE_FIRST_CHECK.isNeverMeasured(null)).toBe(false);
    expect(MOBILE_FIRST_CHECK.isNeverMeasured(undefined)).toBe(false);
    expect(MOBILE_FIRST_CHECK.isStatusUnmeasured(null)).toBe(false);
  });

  test("a first result is overdue when the web says so, for every family, age and interval a monitor can hold", () => {
    let compared: number = 0;
    let overdue: number = 0;

    for (const now of NOWS) {
      for (const monitorType of ONE_TYPE_PER_FAMILY) {
        for (const ago of CREATED_AGO) {
          for (const monitoringInterval of STORED_INTERVALS) {
            const monitor: {
              monitorType: string;
              createdAt: string;
              monitoringInterval: string | null | undefined;
            } = {
              monitorType,
              createdAt: new Date(now.getTime() - ago).toISOString(),
              monitoringInterval,
            };
            const expected: boolean = MonitorFirstCheck.isFirstCheckOverdue({
              monitor: monitor,
              now: now,
            });

            expect({
              monitor,
              now: now.toISOString(),
              overdue: MOBILE_FIRST_CHECK.isFirstCheckOverdue({
                monitor,
                now,
              }),
            }).toEqual({ monitor, now: now.toISOString(), overdue: expected });

            compared++;

            if (expected) {
              overdue++;
            }
          }
        }
      }
    }

    // Both answers are well represented, so agreeing is not agreeing on one.
    expect(compared).toBeGreaterThan(10000);
    expect(overdue).toBeGreaterThan(compared / 10);
    expect(compared - overdue).toBeGreaterThan(compared / 10);
  });

  test("every monitor type, at every age, on the dashboard's intervals", () => {
    for (const monitorType of [...MONITOR_TYPES, ...UNKNOWN_MONITOR_TYPES]) {
      for (const ago of CREATED_AGO) {
        for (const monitoringInterval of [
          "* * * * *",
          "*/5 * * * *",
          "0 * * * *",
          "0 0 * * 0",
          undefined,
        ]) {
          const monitor: Record<string, unknown> = {
            monitorType,
            createdAt: new Date(NOW.getTime() - ago).toISOString(),
            monitoringInterval,
          };

          expect({
            monitor,
            overdue: MOBILE_FIRST_CHECK.isFirstCheckOverdue({
              monitor,
              now: NOW,
            }),
          }).toEqual({
            monitor,
            overdue: MonitorFirstCheck.isFirstCheckOverdue({
              monitor: monitor as never,
              now: NOW,
            }),
          });
        }
      }
    }
  });

  test("a creation time is read as the web reads it, or not at all", () => {
    const createdAts: Array<unknown> = [
      new Date(NOW.getTime() - 2 * HOUR).toISOString(),
      new Date(NOW.getTime() - 2 * HOUR),
      NOW.getTime() - 2 * HOUR,
      {
        _type: "DateTime",
        value: new Date(NOW.getTime() - 2 * HOUR).toISOString(),
      },
      " 2026-11-16T10:00:00.000Z ",
      "2026-11-16T10:00:00Z",
      "",
      null,
      undefined,
      "not a date",
      Number.NaN,
      new Date(Number.NaN),
    ];

    for (const createdAt of createdAts) {
      const monitor: Record<string, unknown> = {
        monitorType: MonitorType.Website,
        createdAt,
        monitoringInterval: "*/5 * * * *",
      };

      expect({
        createdAt: String(createdAt),
        overdue: MOBILE_FIRST_CHECK.isFirstCheckOverdue({ monitor, now: NOW }),
      }).toEqual({
        createdAt: String(createdAt),
        overdue: MonitorFirstCheck.isFirstCheckOverdue({
          monitor: monitor as never,
          now: NOW,
        }),
      });
    }
  });
});

// Whether a stored monitor matches one of these flat queries.
function matches(
  query: Record<string, unknown>,
  monitor: StoredMonitor,
): boolean {
  for (const [key, expected] of Object.entries(query)) {
    const actual: unknown = (monitor as unknown as Record<string, unknown>)[
      key
    ];

    if (expected instanceof NotNull) {
      if (actual === null || actual === undefined) {
        return false;
      }

      continue;
    }

    if (expected !== null && typeof expected === "object") {
      if (actual === null || typeof actual !== "object") {
        return false;
      }

      for (const [nestedKey, nestedExpected] of Object.entries(
        expected as Record<string, unknown>,
      )) {
        if ((actual as Record<string, unknown>)[nestedKey] !== nestedExpected) {
          return false;
        }
      }

      continue;
    }

    if (actual !== expected) {
      return false;
    }
  }

  return true;
}

/*
 * A monitor as stored: both flags are NOT NULL columns, so each is true or
 * false; a monitor may have no current status; a manual monitor is stamped
 * measured when it is created, and the upgrade stamped every older one.
 */
interface StoredMonitor {
  isArchived: boolean;
  disableActiveMonitoring: boolean;
  isNoProbeEnabledOnThisMonitor: boolean;
  isAllProbesDisconnectedFromThisMonitor: boolean;
  disableActiveMonitoringBecauseOfManualIncident: boolean;
  monitorType: MonitorType;
  firstMeasuredAt: string | null;
  createdAt: string;
  monitoringInterval: string;
  currentMonitorStatus: {
    name: string;
    isOperationalState: boolean;
    isOfflineState: boolean;
  } | null;
}

const STORED_STATUSES: Array<StoredMonitor["currentMonitorStatus"]> = [
  { name: "Operational", isOperationalState: true, isOfflineState: false },
  { name: "Offline", isOperationalState: false, isOfflineState: true },
  { name: "Degraded", isOperationalState: false, isOfflineState: false },
  null,
];

const STORED_MONITORS: Array<StoredMonitor> = [];

for (const isArchived of [false, true]) {
  for (const disableActiveMonitoring of [false, true]) {
    for (const isNoProbeEnabledOnThisMonitor of [false, true]) {
      for (const isAllProbesDisconnectedFromThisMonitor of [false, true]) {
        for (const disableActiveMonitoringBecauseOfManualIncident of [
          false,
          true,
        ]) {
          for (const monitorType of [
            MonitorType.Website,
            MonitorType.IncomingRequest,
            MonitorType.Manual,
          ]) {
            for (const firstMeasuredAt of [null, "2026-11-01T00:00:00.000Z"]) {
              if (monitorType === MonitorType.Manual && !firstMeasuredAt) {
                continue;
              }

              for (const ago of [MINUTE, 2 * HOUR]) {
                for (const currentMonitorStatus of STORED_STATUSES) {
                  STORED_MONITORS.push({
                    isArchived,
                    disableActiveMonitoring,
                    isNoProbeEnabledOnThisMonitor,
                    isAllProbesDisconnectedFromThisMonitor,
                    disableActiveMonitoringBecauseOfManualIncident,
                    monitorType,
                    firstMeasuredAt,
                    createdAt: new Date(NOW.getTime() - ago).toISOString(),
                    monitoringInterval: "*/5 * * * *",
                    currentMonitorStatus,
                  });
                }
              }
            }
          }
        }
      }
    }
  }
}

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

const NOT_CHECKED_KINDS: Array<string> = [
  MonitorRowStatusKind.NoProbeEnabled,
  MonitorRowStatusKind.ProbesDisconnected,
  MonitorRowStatusKind.PausedBeforeFirstCheck,
  MonitorRowStatusKind.NoResultsYet,
  MonitorRowStatusKind.WaitingForData,
];

/*
 * Every stored monitor, as the server would match it against each query and
 * as the Monitors screen files it: the screen lists under Issues, Disabled
 * and the rest exactly the monitors Home's counts count, and calls Healthy
 * only a monitor whose row says its own operational status.
 */
describe("a monitor is filed where the web and the counts put it", () => {
  test.each(STORED_MONITORS)("%j", (monitor: StoredMonitor) => {
    const health: MobileHealth = MOBILE.getMonitorHealth(monitor);
    const isListed: boolean = matches(MOBILE.getListedMonitorsQuery(), monitor);
    const row: MonitorRowStatus = MonitorRowStatusUtil.getRowStatus(
      monitor,
      NOW,
    );
    const isOperational: boolean =
      monitor.currentMonitorStatus?.isOperationalState === true;

    // Disabled: monitoring off, whatever its status - as the web says.
    expect(health === "disabled").toBe(MonitoringOff.isOff(monitor));

    // Among listed monitors, the counts count what the screen files.
    if (isListed) {
      // Disabled is what the web's row says Disabled of.
      expect(health === "disabled").toBe(
        getMonitorListRowStatus(monitor, NOW).isMonitoringOff,
      );

      expect(health === "issue").toBe(
        matches(
          NotOperationalMonitorQuery.getQuery() as unknown as Record<
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

      // Healthy is what the web's row says is the monitor's own Operational.
      expect(health === "healthy").toBe(
        isOperational && row.kind === MonitorRowStatusKind.Status,
      );
      // Not checked is an Operational no check stands behind, as its row says.
      expect(health === "notChecked").toBe(
        isOperational && NOT_CHECKED_KINDS.includes(row.kind),
      );

      const isWebOperational: boolean = matches(
        getMonitorListQuery({
          statusFilter: MONITOR_LIST_STATUS_FILTER_OPERATIONAL,
        }),
        monitor,
      );

      // Healthy lists no monitor the web's Operational filter leaves out...
      if (health === "healthy") {
        expect(isWebOperational).toBe(true);
      }

      // ...and every one it lists, unless no probe checks it.
      if (
        isWebOperational &&
        !monitor.isNoProbeEnabledOnThisMonitor &&
        !monitor.isAllProbesDisconnectedFromThisMonitor
      ) {
        expect(health).toBe("healthy");
      }
    }

    // An archived monitor is in none of the counts.
    if (monitor.isArchived) {
      expect(isListed).toBe(false);
      expect(matches(MOBILE.getMonitorIssuesQuery(), monitor)).toBe(false);
      expect(matches(MOBILE.getDisabledMonitorsQuery(), monitor)).toBe(false);
    }
  });

  test("a monitor nothing has checked yet is Not checked, never Healthy, as the web's Operational filter leaves it out (#8961)", () => {
    const waiting: StoredMonitor = {
      isArchived: false,
      disableActiveMonitoring: false,
      isNoProbeEnabledOnThisMonitor: false,
      isAllProbesDisconnectedFromThisMonitor: false,
      disableActiveMonitoringBecauseOfManualIncident: false,
      monitorType: MonitorType.Website,
      firstMeasuredAt: null,
      createdAt: new Date(NOW.getTime() - MINUTE).toISOString(),
      monitoringInterval: "*/5 * * * *",
      currentMonitorStatus: STORED_STATUSES[0]!,
    };

    expect(MOBILE.getMonitorHealth(waiting)).toBe("notChecked");
    expect(
      matches(
        getMonitorListQuery({
          statusFilter: MONITOR_LIST_STATUS_FILTER_OPERATIONAL,
        }),
        waiting,
      ),
    ).toBe(false);
    expect(appRow(waiting).text).toBe("Waiting for data");

    // Once something has measured it, it is Healthy, as the web lists it.
    const measured: StoredMonitor = {
      ...waiting,
      firstMeasuredAt: "2026-11-16T11:59:30.000Z",
    };

    expect(MOBILE.getMonitorHealth(measured)).toBe("healthy");
    expect(appRow(measured).text).toBe("Operational");
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

  test("a monitor read without firstMeasuredAt - from a server older than it - is filed by its status, as before", () => {
    expect(
      MOBILE.getMonitorHealth({
        monitorType: MonitorType.Website,
        currentMonitorStatus: { isOperationalState: true },
      }),
    ).toBe("healthy");
    expect(
      appRow({
        monitorType: MonitorType.Website,
        currentMonitorStatus: { name: "Operational", isOperationalState: true },
      }).kind,
    ).toBe("Status");
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
