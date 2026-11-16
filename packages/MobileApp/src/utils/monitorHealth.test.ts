import { describe, expect, test } from "@jest/globals";
import {
  MONITOR_ROW_STATUS_TONES,
  MONITOR_ROW_STATUS_WORDS,
  getDisabledMonitorsQuery,
  getListedMonitorsQuery,
  getMonitorHealth,
  getMonitorIssuesQuery,
  getMonitorRowStatus,
  getMonitorRowStatusSelect,
  type MonitorHealth,
  type MonitorHealthFields,
  type MonitorRowStatus,
} from "./monitorHealth";

/*
 * The app's copy of the web's monitor rule (issue #6475): a monitor whose
 * monitoring is turned off is Disabled and never an issue, whatever status its
 * last check left, and archived monitors are listed and counted nowhere. And
 * since #8961 the web's row rule: a monitor with an operational status no
 * check stands behind - nothing has checked it yet, or no probe checks it -
 * is Not checked, never Healthy, and its row says why in the web's words.
 *
 * Home's counts are server queries, the Monitors screen sorts the rows it was
 * sent in memory, and Home's rows open the screen's filters - so the two must
 * pick the same monitors. This suite runs each query over every kind of row,
 * in memory, and holds it to what the screen does with that row. Common's
 * suite runs this file next to the web's rule itself
 * (MonitorHealthMobileParity).
 */

interface Row extends MonitorHealthFields {
  isArchived: boolean;
}

/*
 * A query as the server reads one of these: every key must match, a nested
 * object matches the related record's fields, a value is compared as is.
 */
function matches(row: Record<string, unknown>, query: unknown): boolean {
  return Object.entries(query as Record<string, unknown>).every(
    ([key, expected]: [string, unknown]): boolean => {
      const actual: unknown = row[key];

      if (expected !== null && typeof expected === "object") {
        return (
          actual !== null &&
          typeof actual === "object" &&
          matches(actual as Record<string, unknown>, expected)
        );
      }

      return actual === expected;
    },
  );
}

// Every kind of row: archived or not, monitoring on or off, each status flag.
const ROWS: Array<Row> = [true, false].flatMap((isArchived: boolean) => {
  return [true, false].flatMap((disableActiveMonitoring: boolean) => {
    return [true, false, undefined].map(
      (isOperationalState: boolean | undefined): Row => {
        return {
          isArchived,
          disableActiveMonitoring,
          currentMonitorStatus:
            isOperationalState === undefined ? {} : { isOperationalState },
        };
      },
    );
  });
});

function describeRow(row: Row): string {
  return `archived=${row.isArchived} off=${row.disableActiveMonitoring} operational=${String(
    row.currentMonitorStatus?.isOperationalState,
  )}`;
}

function listed(): Array<Row> {
  return ROWS.filter((row: Row): boolean => {
    return matches(
      row as unknown as Record<string, unknown>,
      getListedMonitorsQuery(),
    );
  });
}

describe("getMonitorHealth", () => {
  test.each<[string, MonitorHealthFields, MonitorHealth]>([
    [
      "an offline monitor that is checked has an issue",
      { currentMonitorStatus: { isOperationalState: false } },
      "issue",
    ],
    [
      "an operational monitor that is checked is healthy",
      { currentMonitorStatus: { isOperationalState: true } },
      "healthy",
    ],
    [
      "an offline monitor whose monitoring is off is disabled, not an issue",
      {
        disableActiveMonitoring: true,
        currentMonitorStatus: { isOperationalState: false },
      },
      "disabled",
    ],
    [
      "an operational monitor whose monitoring is off is disabled, not healthy",
      {
        disableActiveMonitoring: true,
        currentMonitorStatus: { isOperationalState: true },
      },
      "disabled",
    ],
    [
      "a monitor whose monitoring is off and that has no status is disabled",
      { disableActiveMonitoring: true },
      "disabled",
    ],
    [
      "a monitor read without a status is unknown, not healthy",
      { currentMonitorStatus: undefined },
      "unknown",
    ],
    [
      "a status without the semantic flag is unknown",
      { currentMonitorStatus: {} },
      "unknown",
    ],
    [
      "a null flag is unknown",
      { currentMonitorStatus: { isOperationalState: null } },
      "unknown",
    ],
    [
      "monitoring explicitly on reads the status",
      {
        disableActiveMonitoring: false,
        currentMonitorStatus: { isOperationalState: false },
      },
      "issue",
    ],
    [
      "a missing monitoring flag is on: the column defaults to false",
      {
        disableActiveMonitoring: undefined,
        currentMonitorStatus: { isOperationalState: false },
      },
      "issue",
    ],
    [
      "a null monitoring flag is on",
      {
        disableActiveMonitoring: null,
        currentMonitorStatus: { isOperationalState: true },
      },
      "healthy",
    ],
  ])(
    "%s",
    (_name: string, monitor: MonitorHealthFields, expected: MonitorHealth) => {
      expect(getMonitorHealth(monitor)).toBe(expected);
    },
  );
});

describe("the queries Home counts with", () => {
  test("Monitor issues is the web's Not Operational rule, word for word", () => {
    expect(getMonitorIssuesQuery()).toEqual({
      isArchived: false,
      disableActiveMonitoring: false,
      currentMonitorStatus: { isOperationalState: false },
    });
  });

  test("Disabled monitors leaves the archived ones out, as the web's Disabled badge does", () => {
    expect(getDisabledMonitorsQuery()).toEqual({
      isArchived: false,
      disableActiveMonitoring: true,
    });
  });

  test("All monitors leaves the archived ones out and nothing else", () => {
    expect(getListedMonitorsQuery()).toEqual({ isArchived: false });
  });

  test("each call hands out a fresh object: a caller that changes one changes no other", () => {
    const issues: Record<string, unknown> = getMonitorIssuesQuery();
    issues["isArchived"] = true;
    (issues["currentMonitorStatus"] as Record<string, unknown>)[
      "isOperationalState"
    ] = true;
    const disabled: Record<string, unknown> = getDisabledMonitorsQuery();
    disabled["disableActiveMonitoring"] = false;
    const all: Record<string, unknown> = getListedMonitorsQuery();
    all["isArchived"] = true;

    expect(getMonitorIssuesQuery()).toEqual({
      isArchived: false,
      disableActiveMonitoring: false,
      currentMonitorStatus: { isOperationalState: false },
    });
    expect(getDisabledMonitorsQuery()).toEqual({
      isArchived: false,
      disableActiveMonitoring: true,
    });
    expect(getListedMonitorsQuery()).toEqual({ isArchived: false });
  });
});

describe("Home's counts pick the monitors the screen's filters show", () => {
  test("the screen is sent no archived monitor", () => {
    expect(listed().length).toBe(6);
    for (const row of listed()) {
      expect(row.isArchived).toBe(false);
    }
  });

  test.each(
    ROWS.map((row: Row): [string, Row] => {
      return [describeRow(row), row];
    }),
  )("%s", (_name: string, row: Row) => {
    const record: Record<string, unknown> = row as unknown as Record<
      string,
      unknown
    >;
    const isListed: boolean = matches(record, getListedMonitorsQuery());
    const health: MonitorHealth = getMonitorHealth(row);

    // Monitor issues counts exactly the listed rows under Issues.
    expect(matches(record, getMonitorIssuesQuery())).toBe(
      isListed && health === "issue",
    );
    // Disabled monitors counts exactly the listed rows under Disabled.
    expect(matches(record, getDisabledMonitorsQuery())).toBe(
      isListed && health === "disabled",
    );
  });

  test("an offline monitor whose monitoring is off is in the Disabled count and not in Monitor issues", () => {
    const row: Record<string, unknown> = {
      isArchived: false,
      disableActiveMonitoring: true,
      currentMonitorStatus: { isOperationalState: false },
    };

    expect(matches(row, getMonitorIssuesQuery())).toBe(false);
    expect(matches(row, getDisabledMonitorsQuery())).toBe(true);
    expect(matches(row, getListedMonitorsQuery())).toBe(true);
  });

  test("an archived offline monitor is counted nowhere", () => {
    const row: Record<string, unknown> = {
      isArchived: true,
      disableActiveMonitoring: false,
      currentMonitorStatus: { isOperationalState: false },
    };

    expect(matches(row, getMonitorIssuesQuery())).toBe(false);
    expect(matches(row, getDisabledMonitorsQuery())).toBe(false);
    expect(matches(row, getListedMonitorsQuery())).toBe(false);
  });
});

const NOW: Date = new Date("2026-11-16T12:00:00.000Z");
const MINUTE: number = 60 * 1000;
const HOUR: number = 60 * MINUTE;

// A Website nothing has checked yet, as a server with firstMeasuredAt sends it.
function neverChecked(
  overrides: Partial<MonitorHealthFields> = {},
): MonitorHealthFields {
  return {
    isArchived: false,
    disableActiveMonitoring: false,
    disableActiveMonitoringBecauseOfManualIncident: false,
    disableActiveMonitoringBecauseOfScheduledMaintenanceEvent: false,
    isNoProbeEnabledOnThisMonitor: false,
    isAllProbesDisconnectedFromThisMonitor: false,
    monitorType: "Website",
    firstMeasuredAt: null,
    createdAt: new Date(NOW.getTime() - MINUTE).toISOString(),
    monitoringInterval: "*/5 * * * *",
    currentMonitorStatus: {
      name: "Operational",
      isOperationalState: true,
      isOfflineState: false,
    },
    ...overrides,
  };
}

function rowOf(monitor: MonitorHealthFields): MonitorRowStatus {
  return getMonitorRowStatus(monitor, NOW);
}

describe("getMonitorRowStatus: what a row says (#8961)", () => {
  test("a monitor nothing has checked yet says Waiting for data, in the muted tone", () => {
    expect(rowOf(neverChecked())).toEqual({
      kind: "WaitingForData",
      text: "Waiting for data",
      isProductWords: true,
      tone: "neutral",
    });
  });

  test("No results yet once its first result is overdue, in the warning tone", () => {
    expect(
      rowOf(
        neverChecked({
          createdAt: new Date(NOW.getTime() - 2 * HOUR).toISOString(),
        }),
      ),
    ).toEqual({
      kind: "NoResultsYet",
      text: "No results yet",
      isProductWords: true,
      tone: "warning",
    });
  });

  test("Paused while an incident or a maintenance event holds its checks, however late", () => {
    for (const pause of [
      { disableActiveMonitoringBecauseOfManualIncident: true },
      { disableActiveMonitoringBecauseOfScheduledMaintenanceEvent: true },
    ]) {
      expect(
        rowOf(
          neverChecked({
            ...pause,
            createdAt: new Date(NOW.getTime() - 2 * HOUR).toISOString(),
          }),
        ),
      ).toEqual({
        kind: "PausedBeforeFirstCheck",
        text: "Paused",
        isProductWords: true,
        tone: "neutral",
      });
    }
  });

  test("why nothing checks it comes first, in the web's order", () => {
    expect(
      rowOf(neverChecked({ isArchived: true, disableActiveMonitoring: true }))
        .kind,
    ).toBe("Archived");
    expect(
      rowOf(
        neverChecked({
          disableActiveMonitoring: true,
          isNoProbeEnabledOnThisMonitor: true,
        }),
      ).kind,
    ).toBe("MonitoringOff");
    expect(
      rowOf(
        neverChecked({
          isNoProbeEnabledOnThisMonitor: true,
          isAllProbesDisconnectedFromThisMonitor: true,
        }),
      ),
    ).toEqual({
      kind: "NoProbeEnabled",
      text: "No Probe Enabled",
      isProductWords: true,
      tone: "danger",
    });
    expect(
      rowOf(neverChecked({ isAllProbesDisconnectedFromThisMonitor: true })),
    ).toEqual({
      kind: "ProbesDisconnected",
      text: "Probes Disconnected",
      isProductWords: true,
      tone: "danger",
    });
  });

  test("a monitor something has measured says its own status, in its own colour", () => {
    expect(
      rowOf(neverChecked({ firstMeasuredAt: "2026-11-16T11:00:00.000Z" })),
    ).toEqual({
      kind: "Status",
      text: "Operational",
      isProductWords: false,
      tone: null,
    });
  });

  test("a status something set before the first check, a manual monitor, and a row read without the column say the status", () => {
    expect(
      rowOf(
        neverChecked({
          currentMonitorStatus: {
            name: "Offline",
            isOperationalState: false,
            isOfflineState: true,
          },
        }),
      ).text,
    ).toBe("Offline");
    expect(rowOf(neverChecked({ monitorType: "Manual" })).text).toBe(
      "Operational",
    );
    expect(rowOf(neverChecked({ firstMeasuredAt: undefined })).text).toBe(
      "Operational",
    );
  });

  test("a monitor read with no status, or a status with no name, says Unknown", () => {
    expect(rowOf(neverChecked({ currentMonitorStatus: null }))).toEqual({
      kind: "NoStatus",
      text: "Unknown",
      isProductWords: true,
      tone: null,
    });
    expect(
      rowOf(
        neverChecked({
          firstMeasuredAt: "2026-11-16T11:00:00.000Z",
          currentMonitorStatus: { name: "", isOperationalState: false },
        }),
      ),
    ).toEqual({
      kind: "Status",
      text: "Unknown",
      isProductWords: true,
      tone: null,
    });
  });

  test("without a time, it is judged now", () => {
    const young: MonitorHealthFields = neverChecked({
      createdAt: new Date(Date.now() - MINUTE).toISOString(),
    });
    const old: MonitorHealthFields = neverChecked({
      createdAt: new Date(Date.now() - 2 * HOUR).toISOString(),
    });

    expect(getMonitorRowStatus(young).text).toBe("Waiting for data");
    expect(getMonitorRowStatus(old).text).toBe("No results yet");
  });

  test("every kind but the monitor's own status has words, and every word but Unknown a tone", () => {
    expect(Object.keys(MONITOR_ROW_STATUS_WORDS).sort()).toEqual(
      [
        "Archived",
        "MonitoringOff",
        "NoProbeEnabled",
        "ProbesDisconnected",
        "PausedBeforeFirstCheck",
        "NoResultsYet",
        "WaitingForData",
        "NoStatus",
      ].sort(),
    );
    expect(Object.keys(MONITOR_ROW_STATUS_TONES).sort()).toEqual(
      Object.keys(MONITOR_ROW_STATUS_WORDS)
        .filter((kind: string): boolean => {
          return kind !== "NoStatus";
        })
        .sort(),
    );
  });
});

describe("getMonitorHealth: an operational status no check stands behind is Not checked (#8961)", () => {
  test.each<[string, Partial<MonitorHealthFields>, MonitorHealth]>([
    ["nothing has checked it yet", {}, "notChecked"],
    [
      "its first result is overdue",
      { createdAt: new Date(NOW.getTime() - 2 * HOUR).toISOString() },
      "notChecked",
    ],
    [
      "an incident holds its first check",
      { disableActiveMonitoringBecauseOfManualIncident: true },
      "notChecked",
    ],
    [
      "no probe is enabled",
      {
        firstMeasuredAt: "2026-11-01T00:00:00.000Z",
        isNoProbeEnabledOnThisMonitor: true,
      },
      "notChecked",
    ],
    [
      "every probe is disconnected",
      {
        firstMeasuredAt: "2026-11-01T00:00:00.000Z",
        isAllProbesDisconnectedFromThisMonitor: true,
      },
      "notChecked",
    ],
    [
      "something has measured it",
      { firstMeasuredAt: "2026-11-01T00:00:00.000Z" },
      "healthy",
    ],
    [
      "an incident paused it after it was measured: its status is what paused it",
      {
        firstMeasuredAt: "2026-11-01T00:00:00.000Z",
        disableActiveMonitoringBecauseOfManualIncident: true,
      },
      "healthy",
    ],
    ["it is a manual monitor", { monitorType: "Manual" }, "healthy"],
    [
      "it was read from a server older than firstMeasuredAt",
      { firstMeasuredAt: undefined },
      "healthy",
    ],
    [
      "no probe checks it, but its last status was Offline: an issue, as Not Operational counts it",
      {
        firstMeasuredAt: "2026-11-01T00:00:00.000Z",
        isAllProbesDisconnectedFromThisMonitor: true,
        currentMonitorStatus: {
          name: "Offline",
          isOperationalState: false,
          isOfflineState: true,
        },
      },
      "issue",
    ],
    ["its monitoring is off", { disableActiveMonitoring: true }, "disabled"],
    ["it has no status", { currentMonitorStatus: null }, "unknown"],
  ])(
    "%s",
    (
      _name: string,
      overrides: Partial<MonitorHealthFields>,
      expected: MonitorHealth,
    ) => {
      expect(getMonitorHealth(neverChecked(overrides))).toBe(expected);
    },
  );

  test("Not checked is exactly an operational status whose row says why no check stands behind it", () => {
    const flags: Array<boolean> = [false, true];

    for (const isNoProbeEnabledOnThisMonitor of flags) {
      for (const isAllProbesDisconnectedFromThisMonitor of flags) {
        for (const disableActiveMonitoringBecauseOfManualIncident of flags) {
          for (const firstMeasuredAt of [null, "2026-11-01T00:00:00.000Z"]) {
            const monitor: MonitorHealthFields = neverChecked({
              isNoProbeEnabledOnThisMonitor,
              isAllProbesDisconnectedFromThisMonitor,
              disableActiveMonitoringBecauseOfManualIncident,
              firstMeasuredAt,
            });
            const row: MonitorRowStatus = rowOf(monitor);

            expect({ monitor, health: getMonitorHealth(monitor) }).toEqual({
              monitor,
              health: row.kind === "Status" ? "healthy" : "notChecked",
            });
          }
        }
      }
    }
  });
});

describe("getMonitorRowStatusSelect", () => {
  test("reads every field the row rule reads", () => {
    expect(getMonitorRowStatusSelect()).toEqual({
      isArchived: true,
      disableActiveMonitoring: true,
      disableActiveMonitoringBecauseOfManualIncident: true,
      disableActiveMonitoringBecauseOfScheduledMaintenanceEvent: true,
      isNoProbeEnabledOnThisMonitor: true,
      isAllProbesDisconnectedFromThisMonitor: true,
      monitorType: true,
      firstMeasuredAt: true,
      createdAt: true,
      monitoringInterval: true,
      currentMonitorStatus: {
        name: true,
        color: true,
        isOperationalState: true,
        isOfflineState: true,
      },
    });
  });

  test("hands out a fresh object each time", () => {
    const first: Record<string, unknown> = getMonitorRowStatusSelect();
    first["projectId"] = true;
    (first["currentMonitorStatus"] as Record<string, unknown>)["_id"] = true;

    expect(getMonitorRowStatusSelect()).not.toHaveProperty("projectId");
    expect(
      getMonitorRowStatusSelect()["currentMonitorStatus"],
    ).not.toHaveProperty("_id");
  });
});
