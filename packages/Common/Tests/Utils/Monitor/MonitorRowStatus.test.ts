import fs from "fs";
import path from "path";
import { Amber600, Gray500, Red500 } from "../../../Types/BrandColors";
import Color from "../../../Types/Color";
import { JSONObject } from "../../../Types/JSON";
import Monitor from "../../../Models/DatabaseModels/Monitor";
import MonitorSteps from "../../../Types/Monitor/MonitorSteps";
import MonitorType from "../../../Types/Monitor/MonitorType";
import MonitorFirstCheck, {
  MONITOR_FIRST_CHECK_SELECT,
  STARTING_STATUS_SELECT,
} from "../../../Utils/Monitor/MonitorFirstCheck";
import MonitorOverviewFamilyUtil, {
  MonitorOverviewFamily,
} from "../../../Utils/Monitor/MonitorOverviewFamily";
import MonitorOverviewPresentationUtil, {
  MonitorOverviewPresentation,
  MonitorOverviewPresentationInput,
  MonitorOverviewStatusRef,
} from "../../../Utils/Monitor/MonitorOverviewPresentationUtil";
import { MonitorOverviewProbeSummary } from "../../../Utils/Monitor/MonitorOverviewProbeUtil";
import MonitorRowStatusUtil, {
  MONITOR_ROW_STATUS_COLORS,
  MONITOR_ROW_STATUS_SELECT,
  MONITOR_ROW_STATUS_WORDS,
  MonitorRowStatus,
  MonitorRowStatusFields,
  MonitorRowStatusKind,
} from "../../../Utils/Monitor/MonitorRowStatus";
import { DASHBOARD_LANGUAGES } from "../../Helpers/TranslatedLanguages";
import { describe, expect, test } from "@jest/globals";

/*
 * WHAT A ROW SAYS A MONITOR'S STATUS IS (issue #8899).
 *
 * A monitor nothing has checked yet holds the operational status every
 * monitor is created in. Its own page said "Waiting for data"; the Monitors
 * list, the Monitor List widget and its honeycomb said "Operational", in
 * green, from the same monitor. They read one rule now
 * (Utils/Monitor/MonitorRowStatus), from the monitor's row alone, and this
 * holds it to the page's own hero (MonitorOverviewPresentationUtil) for
 * every family, age and pause: the row says what the hero's badge says.
 */

const NOW: Date = new Date("2026-11-16T12:00:00.000Z");
const SECOND: number = 1000;
const MINUTE: number = 60 * SECOND;
const HOUR: number = 60 * MINUTE;
const DAY: number = 24 * HOUR;

const ago: (ms: number) => Date = (ms: number): Date => {
  return new Date(NOW.getTime() - ms);
};

const OPERATIONAL: MonitorOverviewStatusRef = {
  id: "22222222-2222-4222-8222-222222222222",
  name: "Operational",
  color: "#10B981",
  isOperationalState: true,
  isOfflineState: false,
};

const OFFLINE: MonitorOverviewStatusRef = {
  id: "44444444-4444-4444-8444-444444444444",
  name: "Offline",
  color: "#EF4444",
  isOperationalState: false,
  isOfflineState: true,
};

const EVERY_FIVE_MINUTES: string = "*/5 * * * *";

// A new Website monitor, as the list reads it: nothing has measured it.
const newRow: (
  overrides?: Partial<MonitorRowStatusFields>,
) => MonitorRowStatusFields = (
  overrides?: Partial<MonitorRowStatusFields>,
): MonitorRowStatusFields => {
  return {
    isArchived: false,
    disableActiveMonitoring: false,
    disableActiveMonitoringBecauseOfManualIncident: false,
    disableActiveMonitoringBecauseOfScheduledMaintenanceEvent: false,
    isNoProbeEnabledOnThisMonitor: false,
    isAllProbesDisconnectedFromThisMonitor: false,
    monitorType: MonitorType.Website,
    firstMeasuredAt: null,
    createdAt: ago(1 * MINUTE),
    monitoringInterval: EVERY_FIVE_MINUTES,
    currentMonitorStatus: {
      name: OPERATIONAL.name,
      color: OPERATIONAL.color,
      isOperationalState: true,
      isOfflineState: false,
    },
    ...overrides,
  };
};

const rowStatus: (monitor: MonitorRowStatusFields) => MonitorRowStatus = (
  monitor: MonitorRowStatusFields,
): MonitorRowStatus => {
  return MonitorRowStatusUtil.getRowStatus(monitor, NOW);
};

describe("MonitorFirstCheck: whether anything has measured a monitor", () => {
  test("never measured: the column read and empty, on a monitor something checks", () => {
    expect(
      MonitorFirstCheck.isNeverMeasured({
        monitorType: MonitorType.Website,
        firstMeasuredAt: null,
      }),
    ).toBe(true);
    expect(
      MonitorFirstCheck.isNeverMeasured({
        monitorType: MonitorType.IncomingRequest,
        firstMeasuredAt: null,
      }),
    ).toBe(true);
  });

  test("measured: the column holds a time, as a Date or as the API's text", () => {
    for (const firstMeasuredAt of [ago(DAY), "2026-11-15T12:00:00.000Z"]) {
      expect(
        MonitorFirstCheck.isNeverMeasured({
          monitorType: MonitorType.Website,
          firstMeasuredAt: firstMeasuredAt,
        }),
      ).toBe(false);
    }
  });

  test("a row read without the column shows its status as it always did", () => {
    expect(
      MonitorFirstCheck.isNeverMeasured({ monitorType: MonitorType.Website }),
    ).toBe(false);
    expect(MonitorFirstCheck.isNeverMeasured(undefined)).toBe(false);
    expect(MonitorFirstCheck.isNeverMeasured(null)).toBe(false);
  });

  test("a manual monitor never waits: its status is a person's word", () => {
    expect(
      MonitorFirstCheck.isNeverMeasured({
        monitorType: MonitorType.Manual,
        firstMeasuredAt: null,
      }),
    ).toBe(false);
  });

  test("a monitor read without its type is never taken for one that waits", () => {
    for (const monitorType of [undefined, null, ""]) {
      expect(
        MonitorFirstCheck.isNeverMeasured({
          monitorType: monitorType,
          firstMeasuredAt: null,
        }),
      ).toBe(false);
    }
  });

  test("the status a monitor starts in: operational, and not offline as well", () => {
    expect(
      MonitorFirstCheck.isStartingStatus({
        isOperationalState: true,
        isOfflineState: false,
      }),
    ).toBe(true);
    expect(
      MonitorFirstCheck.isStartingStatus({ isOperationalState: true }),
    ).toBe(true);
    expect(
      MonitorFirstCheck.isStartingStatus({
        isOperationalState: true,
        isOfflineState: true,
      }),
    ).toBe(false);
    expect(
      MonitorFirstCheck.isStartingStatus({ isOperationalState: false }),
    ).toBe(false);
    expect(MonitorFirstCheck.isStartingStatus({})).toBe(false);
    expect(MonitorFirstCheck.isStartingStatus(null)).toBe(false);
    expect(MonitorFirstCheck.isStartingStatus(undefined)).toBe(false);
  });

  test("its status is unmeasured only while it is the one it started in", () => {
    expect(MonitorFirstCheck.isStatusUnmeasured(newRow())).toBe(true);
    expect(
      MonitorFirstCheck.isStatusUnmeasured(
        newRow({
          currentMonitorStatus: {
            name: "Offline",
            isOperationalState: false,
            isOfflineState: true,
          },
        }),
      ),
    ).toBe(false);
    expect(
      MonitorFirstCheck.isStatusUnmeasured(newRow({ firstMeasuredAt: ago(DAY) })),
    ).toBe(false);
  });

  test("what a list reads it with is every column of the Monitor model", () => {
    const model: Monitor = new Monitor();

    for (const column of Object.keys(MONITOR_FIRST_CHECK_SELECT)) {
      expect({ column, isColumn: model.isTableColumn(column) }).toEqual({
        column,
        isColumn: true,
      });
    }

    expect(STARTING_STATUS_SELECT).toEqual({
      isOperationalState: true,
      isOfflineState: true,
    });
  });
});

describe("MonitorFirstCheck: whether a first result is overdue", () => {
  const overdue: (monitor: {
    monitorType?: string | undefined;
    createdAt?: Date | string | undefined;
    monitoringInterval?: string | undefined;
  }) => boolean = (monitor: {
    monitorType?: string | undefined;
    createdAt?: Date | string | undefined;
    monitoringInterval?: string | undefined;
  }): boolean => {
    return MonitorFirstCheck.isFirstCheckOverdue({ monitor, now: NOW });
  };

  test("a probe check, a telemetry and an infrastructure monitor have a time it is due by", () => {
    for (const monitorType of [
      MonitorType.Website,
      MonitorType.API,
      MonitorType.Ping,
      MonitorType.Port,
      MonitorType.SSLCertificate,
      MonitorType.SyntheticMonitor,
      MonitorType.DNS,
      MonitorType.Logs,
      MonitorType.Metrics,
      MonitorType.Traces,
      MonitorType.Exceptions,
      MonitorType.Kubernetes,
      MonitorType.Docker,
    ]) {
      expect({
        monitorType,
        young: overdue({
          monitorType,
          createdAt: ago(2 * MINUTE),
          monitoringInterval: EVERY_FIVE_MINUTES,
        }),
        old: overdue({
          monitorType,
          createdAt: ago(2 * HOUR),
          monitoringInterval: EVERY_FIVE_MINUTES,
        }),
      }).toEqual({ monitorType, young: false, old: true });
    }
  });

  test("a heartbeat, an agent, a network device and a Probe Status monitor wait however long", () => {
    for (const monitorType of [
      MonitorType.IncomingRequest,
      MonitorType.IncomingEmail,
      MonitorType.Server,
      MonitorType.NetworkDevice,
      MonitorType.ProbeStatus,
      MonitorType.Manual,
    ]) {
      expect({
        monitorType,
        overdue: overdue({
          monitorType,
          createdAt: ago(30 * DAY),
          monitoringInterval: EVERY_FIVE_MINUTES,
        }),
      }).toEqual({ monitorType, overdue: false });
    }
  });

  test("the grace is the page's: two runs, and never less than five minutes", () => {
    // Every five minutes: the first run within five, then ten minutes' grace.
    expect(
      overdue({
        monitorType: MonitorType.Website,
        createdAt: ago(14 * MINUTE),
        monitoringInterval: EVERY_FIVE_MINUTES,
      }),
    ).toBe(false);
    expect(
      overdue({
        monitorType: MonitorType.Website,
        createdAt: ago(16 * MINUTE),
        monitoringInterval: EVERY_FIVE_MINUTES,
      }),
    ).toBe(true);
  });

  test("a schedule with gaps is not due until its first run after creation", () => {
    // Mondays at 09:00: created on a Monday afternoon, its first run is a week off.
    const mondayAfternoon: Date = new Date("2026-11-16T12:00:00.000Z");

    expect(
      MonitorFirstCheck.isFirstCheckOverdue({
        monitor: {
          monitorType: MonitorType.Website,
          createdAt: new Date(mondayAfternoon.getTime() - 2 * HOUR),
          monitoringInterval: "0 9 * * 1",
        },
        now: new Date(mondayAfternoon.getTime() + 3 * DAY),
      }),
    ).toBe(false);
  });

  test("an interval it cannot read is the scheduler's minute", () => {
    expect(
      overdue({
        monitorType: MonitorType.Website,
        createdAt: ago(3 * MINUTE),
        monitoringInterval: "not a schedule",
      }),
    ).toBe(false);
    expect(
      overdue({
        monitorType: MonitorType.Website,
        createdAt: ago(10 * MINUTE),
        monitoringInterval: "not a schedule",
      }),
    ).toBe(true);
  });

  test("nothing is overdue without a creation time, a type it knows, or a creation in the past", () => {
    expect(overdue({ monitorType: MonitorType.Website })).toBe(false);
    expect(
      overdue({
        monitorType: "NotAMonitorType",
        createdAt: ago(30 * DAY),
      }),
    ).toBe(false);
    expect(
      overdue({
        monitorType: MonitorType.Website,
        createdAt: new Date(NOW.getTime() + HOUR),
      }),
    ).toBe(false);
  });

  test("a creation time as the API's text is read as the time it is", () => {
    expect(
      overdue({
        monitorType: MonitorType.Website,
        createdAt: ago(2 * HOUR).toISOString(),
        monitoringInterval: EVERY_FIVE_MINUTES,
      }),
    ).toBe(true);
  });
});

describe("MonitorRowStatus: what a row says", () => {
  test("a monitor nothing has checked yet is Waiting for data, in gray, not pulsing", () => {
    expect(rowStatus(newRow())).toEqual({
      kind: MonitorRowStatusKind.WaitingForData,
      text: "Waiting for data",
      color: Gray500,
      isProductWords: true,
      shouldAnimate: false,
    });
  });

  test("No results yet once its first result is overdue, in amber", () => {
    expect(rowStatus(newRow({ createdAt: ago(2 * HOUR) }))).toEqual({
      kind: MonitorRowStatusKind.NoResultsYet,
      text: "No results yet",
      color: Amber600,
      isProductWords: true,
      shouldAnimate: false,
    });
  });

  test("Paused while an incident or a maintenance event holds its checks", () => {
    for (const pause of [
      { disableActiveMonitoringBecauseOfManualIncident: true },
      { disableActiveMonitoringBecauseOfScheduledMaintenanceEvent: true },
    ]) {
      expect(
        rowStatus(newRow({ ...pause, createdAt: ago(2 * HOUR) })),
      ).toEqual({
        kind: MonitorRowStatusKind.PausedBeforeFirstCheck,
        text: "Paused",
        color: Gray500,
        isProductWords: true,
        shouldAnimate: false,
      });
    }
  });

  test("a heartbeat waits for its first signal however long ago it was created", () => {
    for (const monitorType of [
      MonitorType.IncomingRequest,
      MonitorType.IncomingEmail,
      MonitorType.Server,
      MonitorType.NetworkDevice,
      MonitorType.ProbeStatus,
    ]) {
      expect({
        monitorType,
        kind: rowStatus(newRow({ monitorType, createdAt: ago(40 * DAY) })).kind,
      }).toEqual({ monitorType, kind: MonitorRowStatusKind.WaitingForData });
    }
  });

  test("why nothing checks it comes first, as the page puts it first", () => {
    expect(
      rowStatus(newRow({ isArchived: true, disableActiveMonitoring: true }))
        .kind,
    ).toBe(MonitorRowStatusKind.Archived);
    expect(
      rowStatus(
        newRow({
          disableActiveMonitoring: true,
          isNoProbeEnabledOnThisMonitor: true,
        }),
      ).kind,
    ).toBe(MonitorRowStatusKind.MonitoringOff);
    expect(
      rowStatus(
        newRow({
          isNoProbeEnabledOnThisMonitor: true,
          isAllProbesDisconnectedFromThisMonitor: true,
        }),
      ).kind,
    ).toBe(MonitorRowStatusKind.NoProbeEnabled);
    expect(
      rowStatus(newRow({ isAllProbesDisconnectedFromThisMonitor: true })).kind,
    ).toBe(MonitorRowStatusKind.ProbesDisconnected);
  });

  test("Archived and Disabled in gray, a probe problem in red, as the Monitors table drew them", () => {
    expect(rowStatus(newRow({ isArchived: true }))).toMatchObject({
      text: "Archived",
      color: Gray500,
    });
    expect(rowStatus(newRow({ disableActiveMonitoring: true }))).toMatchObject(
      { text: "Disabled", color: Gray500 },
    );
    expect(
      rowStatus(newRow({ isNoProbeEnabledOnThisMonitor: true })),
    ).toMatchObject({ text: "Probes Not Enabled", color: Red500 });
    expect(
      rowStatus(newRow({ isAllProbesDisconnectedFromThisMonitor: true })),
    ).toMatchObject({ text: "Probes Disconnected", color: Red500 });
  });

  test("a monitor something has measured says its status, in its colour, pulsing", () => {
    const status: MonitorRowStatus = rowStatus(
      newRow({ firstMeasuredAt: ago(HOUR), createdAt: ago(2 * DAY) }),
    );

    expect(status.kind).toBe(MonitorRowStatusKind.Status);
    expect(status.text).toBe("Operational");
    expect(status.color?.toString()).toBe(Color.fromString("#10B981").toString());
    expect(status.isProductWords).toBe(false);
    expect(status.shouldAnimate).toBe(true);
  });

  test("a status something else set before the first check is said as it is", () => {
    const status: MonitorRowStatus = rowStatus(
      newRow({
        currentMonitorStatus: {
          name: OFFLINE.name,
          color: OFFLINE.color,
          isOperationalState: false,
          isOfflineState: true,
        },
      }),
    );

    expect(status.kind).toBe(MonitorRowStatusKind.Status);
    expect(status.text).toBe("Offline");
  });

  test("a manual monitor says its status, measured or not", () => {
    expect(
      rowStatus(newRow({ monitorType: MonitorType.Manual })).text,
    ).toBe("Operational");
  });

  test("a row read without firstMeasuredAt says its status, as every row did before", () => {
    const row: MonitorRowStatusFields = newRow();
    delete row.firstMeasuredAt;

    expect(rowStatus(row).kind).toBe(MonitorRowStatusKind.Status);
  });

  test("a row read with no status says Unknown, with no colour", () => {
    expect(
      rowStatus(newRow({ firstMeasuredAt: ago(HOUR), currentMonitorStatus: null })),
    ).toEqual({
      kind: MonitorRowStatusKind.NoStatus,
      text: "Unknown",
      color: null,
      isProductWords: true,
      shouldAnimate: false,
    });
  });

  test("a status read with no name says Unknown in the reader's words, in its colour", () => {
    const status: MonitorRowStatus = rowStatus(
      newRow({
        firstMeasuredAt: ago(HOUR),
        currentMonitorStatus: { color: "#ef4444", isOperationalState: false },
      }),
    );

    expect(status.text).toBe("Unknown");
    expect(status.isProductWords).toBe(true);
    expect(status.color?.toString()).toBe("#ef4444");
  });

  test("reads a Monitor as the API hands it over, the empty column as NULL", () => {
    const monitor: Monitor = Monitor.fromJSON(
      Monitor.toJSON(
        Monitor.fromJSON(
          {
            _id: "8b1d6a3e-3a52-4f1f-9b8e-0b5a3a3f0aa1",
            monitorType: MonitorType.Website,
            firstMeasuredAt: null,
            createdAt: ago(MINUTE).toISOString(),
            monitoringInterval: EVERY_FIVE_MINUTES,
            disableActiveMonitoring: false,
            currentMonitorStatus: {
              name: "Operational",
              color: "#10B981",
              isOperationalState: true,
              isOfflineState: false,
            },
          } as JSONObject,
          Monitor,
        ) as Monitor,
        Monitor,
      ),
      Monitor,
    ) as Monitor;

    expect((monitor as unknown as JSONObject)["firstMeasuredAt"]).toBeNull();
    expect(MonitorRowStatusUtil.getRowStatus(monitor, NOW).kind).toBe(
      MonitorRowStatusKind.WaitingForData,
    );
  });

  test("a row stands for its own status only when it shows it", () => {
    expect(MonitorRowStatusUtil.isOwnStatus(rowStatus(newRow()))).toBe(false);
    expect(
      MonitorRowStatusUtil.isOwnStatus(
        rowStatus(newRow({ firstMeasuredAt: ago(HOUR) })),
      ),
    ).toBe(true);
  });

  test("what a row is read with is every column the rule reads", () => {
    const model: Monitor = new Monitor();

    for (const column of Object.keys(MONITOR_ROW_STATUS_SELECT)) {
      expect({ column, isColumn: model.isTableColumn(column) }).toEqual({
        column,
        isColumn: true,
      });
    }

    expect(MONITOR_ROW_STATUS_SELECT.currentMonitorStatus).toEqual({
      name: true,
      color: true,
      isOperationalState: true,
      isOfflineState: true,
    });
  });

  test("every kind but the status itself has its words and every one but Unknown its colour", () => {
    for (const kind of Object.values(MonitorRowStatusKind)) {
      if (kind === MonitorRowStatusKind.Status) {
        continue;
      }

      expect(
        (MONITOR_ROW_STATUS_WORDS as Record<string, string>)[kind],
      ).toBeTruthy();

      if (kind !== MonitorRowStatusKind.NoStatus) {
        expect(
          (MONITOR_ROW_STATUS_COLORS as Record<string, Color>)[kind],
        ).toBeInstanceOf(Color);
      }
    }
  });
});

describe("the words a row says are worded in every Dashboard language", () => {
  const LOCALES: string = path.resolve(
    __dirname,
    "../../../../App/FeatureSet/Dashboard/src/Locales",
  );

  test.each(["en", ...DASHBOARD_LANGUAGES])("%s", (language: string) => {
    const locale: Record<string, unknown> = JSON.parse(
      fs.readFileSync(path.join(LOCALES, `${language}.json`), "utf8"),
    ) as Record<string, unknown>;

    for (const word of Object.values(MONITOR_ROW_STATUS_WORDS)) {
      const wording: unknown = locale[word];

      expect({ language, word, isWorded: typeof wording === "string" }).toEqual(
        { language, word, isWorded: true },
      );

      if (language === "en") {
        expect(wording).toBe(word);
      }
    }
  });
});

/*
 * The page's hero, given the monitor as the page reads it in the same
 * state: no probe result, no heartbeat, no report, an evaluation log that
 * holds nothing, and a row that says nothing has measured it.
 */
const STEP_ID: string = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const DEVICE_ID: string = "66666666-6666-4666-8666-666666666666";
const PROBE_ID: string = "11111111-1111-4111-8111-111111111111";

const STEPS: MonitorSteps = {
  data: {
    monitorStepsInstanceArray: [
      {
        data: {
          id: STEP_ID,
          monitorDestination: "https://api.example.com/health",
          networkDeviceMonitor: { networkDeviceId: DEVICE_ID },
          probeStatusMonitor: { probeIds: [PROBE_ID] },
        },
      },
    ],
  },
} as unknown as MonitorSteps;

const probesWithoutResults: (
  row: MonitorRowStatusFields,
) => MonitorOverviewProbeSummary = (
  row: MonitorRowStatusFields,
): MonitorOverviewProbeSummary => {
  const enabledCount: number = row.isNoProbeEnabledOnThisMonitor ? 0 : 2;

  return {
    rows: [],
    attachedCount: 2,
    enabledCount: enabledCount,
    reportingCount: 0,
    disabledCount: 2 - enabledCount,
    disconnectedCount: row.isAllProbesDisconnectedFromThisMonitor
      ? enabledCount
      : 0,
    lastResultAt: undefined,
    nextCheckAt: undefined,
    latestResult: undefined,
    responseTime: null,
  } as unknown as MonitorOverviewProbeSummary;
};

const heroOf: (row: MonitorRowStatusFields) => MonitorOverviewPresentation = (
  row: MonitorRowStatusFields,
): MonitorOverviewPresentation => {
  const monitorType: MonitorType = row.monitorType as MonitorType;
  const family: MonitorOverviewFamily =
    MonitorOverviewFamilyUtil.getFamily(monitorType);

  const input: MonitorOverviewPresentationInput = {
    now: NOW,
    monitorType: monitorType,
    monitorSteps: STEPS,
    monitoringInterval: row.monitoringInterval || undefined,
    createdAt: row.createdAt as Date,
    firstMeasuredAt: row.firstMeasuredAt as Date | null | undefined,
    currentStatus: OPERATIONAL,
    statusSince: row.createdAt as Date,
    pause: {
      isArchived: row.isArchived === true,
      isDisabled: row.disableActiveMonitoring === true,
      byManualIncident:
        row.disableActiveMonitoringBecauseOfManualIncident === true,
      byScheduledMaintenance:
        row.disableActiveMonitoringBecauseOfScheduledMaintenanceEvent === true,
    },
    probeFlags: {
      isNoProbeEnabled: row.isNoProbeEnabledOnThisMonitor === true,
      isAllProbesDisconnected:
        row.isAllProbesDisconnectedFromThisMonitor === true,
    },
    probes:
      family === MonitorOverviewFamily.ProbeCheck
        ? probesWithoutResults(row)
        : null,
    heartbeat: {},
    email: {},
    agent: {},
    telemetry: {},
    latestEvaluationAt: undefined,
    evaluationStatus: "loaded",
  };

  return MonitorOverviewPresentationUtil.build(input);
};

describe("a row says what the monitor's own page says (the hero's badge)", () => {
  const TYPES: Array<MonitorType> = [
    MonitorType.Website,
    MonitorType.API,
    MonitorType.Ping,
    MonitorType.Port,
    MonitorType.SSLCertificate,
    MonitorType.SyntheticMonitor,
    MonitorType.DNS,
    MonitorType.IncomingRequest,
    MonitorType.IncomingEmail,
    MonitorType.Server,
    MonitorType.Logs,
    MonitorType.Metrics,
    MonitorType.Traces,
    MonitorType.Kubernetes,
    MonitorType.NetworkDevice,
    MonitorType.ProbeStatus,
  ];

  const AGES: Array<number> = [1 * MINUTE, 12 * MINUTE, 2 * HOUR, 10 * DAY];

  const PAUSES: Array<Partial<MonitorRowStatusFields>> = [
    {},
    { disableActiveMonitoringBecauseOfManualIncident: true },
    { disableActiveMonitoringBecauseOfScheduledMaintenanceEvent: true },
    { disableActiveMonitoring: true },
    { isArchived: true },
  ];

  const PROBE_PROBLEMS: Array<Partial<MonitorRowStatusFields>> = [
    {},
    { isNoProbeEnabledOnThisMonitor: true },
    { isAllProbesDisconnectedFromThisMonitor: true },
  ];

  interface Case {
    name: string;
    row: MonitorRowStatusFields;
  }

  const CASES: Array<Case> = [];

  for (const monitorType of TYPES) {
    const isProbeCheck: boolean =
      MonitorOverviewFamilyUtil.getFamily(monitorType) ===
      MonitorOverviewFamily.ProbeCheck;

    for (const age of AGES) {
      for (const pause of PAUSES) {
        for (const probeProblem of isProbeCheck ? PROBE_PROBLEMS : [{}]) {
          /*
           * Paused by an incident or maintenance with no probe checking it:
           * the page leads with Paused and draws the probe problem beside
           * it; the list says the probe problem, which outlasts the pause
           * and is the one to act on.
           */
          const isPausedOnly: boolean = Boolean(
            pause.disableActiveMonitoringBecauseOfManualIncident ||
              pause.disableActiveMonitoringBecauseOfScheduledMaintenanceEvent,
          );

          if (isPausedOnly && Object.keys(probeProblem).length > 0) {
            continue;
          }

          CASES.push({
            name: `${monitorType}, created ${age / MINUTE} minutes ago, ${JSON.stringify({ ...pause, ...probeProblem })}`,
            row: newRow({
              monitorType: monitorType,
              createdAt: ago(age),
              ...pause,
              ...probeProblem,
            }),
          });
        }
      }
    }
  }

  test("there are cases for every family it reads", () => {
    expect(CASES.length).toBeGreaterThan(200);
  });

  test.each(CASES)("$name", (testCase: Case) => {
    const status: MonitorRowStatus = rowStatus(testCase.row);
    const hero: MonitorOverviewPresentation = heroOf(testCase.row);

    expect(status.text).toBe(hero.badge.text);

    // Nothing measured, so the page claims no recorded status either.
    expect(hero.lastKnownStatus).toBeUndefined();
  });

  test.each(TYPES)(
    "a %s monitor that has been measured says its status on both",
    (monitorType: MonitorType) => {
      const row: MonitorRowStatusFields = newRow({
        monitorType: monitorType,
        firstMeasuredAt: ago(HOUR),
        createdAt: ago(2 * HOUR),
      });

      expect(rowStatus(row).text).toBe("Operational");
      expect(rowStatus(row).kind).toBe(MonitorRowStatusKind.Status);
    },
  );
});
