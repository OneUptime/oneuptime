import fs from "fs";
import path from "path";
import { JSONObject } from "../../../Types/JSON";
import MonitorSteps from "../../../Types/Monitor/MonitorSteps";
import MonitorType from "../../../Types/Monitor/MonitorType";
import { EVERY_THIRTY_SECONDS } from "../../../Utils/CronTime";
import HeartbeatSweepSchedule, {
  HEARTBEAT_CHECK_STAMP_FRESH_FOR_SECONDS,
  HEARTBEAT_CHECK_STAMP_WRITE_EVERY_SECONDS,
  HEARTBEAT_SWEEP_EVERY_SECONDS,
} from "../../../Utils/Monitor/HeartbeatSweepSchedule";
import MonitorOverviewFamilyUtil, {
  MonitorOverviewFamily,
} from "../../../Utils/Monitor/MonitorOverviewFamily";
import MonitorOverviewPresentationUtil, {
  MonitorOverviewFact,
  MonitorOverviewPresentation,
  MonitorOverviewPresentationInput,
  MonitorOverviewRunState,
  MonitorOverviewStatusRef,
} from "../../../Utils/Monitor/MonitorOverviewPresentationUtil";
import { MonitorOverviewProbeSummary } from "../../../Utils/Monitor/MonitorOverviewProbeUtil";
import MonitorHeartbeatState from "../../../Server/Utils/Monitor/MonitorHeartbeatState";
import { describe, expect, test } from "@jest/globals";

/*
 * THE MONITOR PAGE READS WHAT THE LISTS READ (issues #8899, #8123).
 *
 *   - Monitor.firstMeasuredAt: NULL says nothing has ever measured the
 *     monitor - what the Monitors list, the Monitor List widget and status
 *     pages go by. The hero says so too, even while the evaluation log or
 *     the probes cannot be read, and a monitor that was measured keeps its
 *     "Last recorded status" when the rows that showed it are gone.
 *   - The heartbeat sweeps check a monitor every 30 seconds and stamp it
 *     only every five minutes: the hero's last missing-signal check says
 *     the schedule while the stamp is as recent as a running sweep leaves
 *     it, and the stamp itself once it is older.
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

const STEPS: MonitorSteps = {
  data: {
    monitorStepsInstanceArray: [
      {
        data: {
          id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
          monitorDestination: "https://api.example.com/health",
          networkDeviceMonitor: {
            networkDeviceId: "66666666-6666-4666-8666-666666666666",
          },
          probeStatusMonitor: {
            probeIds: ["11111111-1111-4111-8111-111111111111"],
          },
        },
      },
    ],
  },
} as unknown as MonitorSteps;

const probesWithResult: () => MonitorOverviewProbeSummary =
  (): MonitorOverviewProbeSummary => {
    return {
      rows: [],
      attachedCount: 1,
      enabledCount: 1,
      reportingCount: 1,
      disabledCount: 0,
      disconnectedCount: 0,
      lastResultAt: ago(MINUTE),
      nextCheckAt: new Date(NOW.getTime() + 4 * MINUTE),
      latestResult: undefined,
      responseTime: null,
    } as unknown as MonitorOverviewProbeSummary;
  };

const input: (
  monitorType: MonitorType,
  overrides?: Partial<MonitorOverviewPresentationInput>,
) => MonitorOverviewPresentationInput = (
  monitorType: MonitorType,
  overrides?: Partial<MonitorOverviewPresentationInput>,
): MonitorOverviewPresentationInput => {
  return {
    now: NOW,
    monitorType: monitorType,
    monitorSteps: STEPS,
    monitoringInterval: "*/5 * * * *",
    createdAt: ago(30 * DAY),
    currentStatus: OPERATIONAL,
    statusSince: ago(30 * DAY),
    pause: {
      isDisabled: false,
      byManualIncident: false,
      byScheduledMaintenance: false,
    },
    probeFlags: { isNoProbeEnabled: false, isAllProbesDisconnected: false },
    probes:
      MonitorOverviewFamilyUtil.getFamily(monitorType) ===
      MonitorOverviewFamily.ProbeCheck
        ? probesWithResult()
        : null,
    heartbeat: {},
    email: {},
    agent: {},
    telemetry: {},
    latestEvaluationAt: undefined,
    evaluationStatus: "loaded",
    ...overrides,
  };
};

const build: (
  data: MonitorOverviewPresentationInput,
) => MonitorOverviewPresentation = (
  data: MonitorOverviewPresentationInput,
): MonitorOverviewPresentation => {
  return MonitorOverviewPresentationUtil.build(data);
};

const factOf: (
  presentation: MonitorOverviewPresentation,
  key: string,
) => MonitorOverviewFact | undefined = (
  presentation: MonitorOverviewPresentation,
  key: string,
): MonitorOverviewFact | undefined => {
  return presentation.facts.find((fact: MonitorOverviewFact): boolean => {
    return fact.key === key;
  });
};

describe("firstMeasuredAt NULL: nothing has ever measured the monitor", () => {
  test("a telemetry monitor older than its log keeps rows is No results yet, not Operational", () => {
    /*
     * Queued by the scheduler but never evaluated: before the column, an
     * empty log of an old monitor said only that nothing ran in the last
     * day, and the hero led with the status it was created in.
     */
    const queued: Partial<MonitorOverviewPresentationInput> = {
      createdAt: ago(5 * DAY),
      telemetry: { lastScheduledAt: ago(MINUTE) },
    };
    const unknown: MonitorOverviewPresentation = build(
      input(MonitorType.Logs, queued),
    );
    const neverMeasured: MonitorOverviewPresentation = build(
      input(MonitorType.Logs, { ...queued, firstMeasuredAt: null }),
    );

    expect(unknown.badge.text).toBe("Operational");
    expect(neverMeasured.runState).toBe(MonitorOverviewRunState.Overdue);
    expect(neverMeasured.badge.text).toBe("No results yet");
    expect(neverMeasured.isNeverReported).toBe(true);
    expect(neverMeasured.headline.text).toBe("No evaluation has completed yet");
    expect(neverMeasured.lastKnownStatus).toBeUndefined();
  });

  test.each([
    ["loading", "loading"],
    ["failed", "error"],
    ["forbidden", "forbidden"],
  ] as Array<[string, MonitorOverviewPresentationInput["evaluationStatus"]]>)(
    "a network device monitor whose log is %s still says it is waiting",
    (
      _name: string,
      evaluationStatus: MonitorOverviewPresentationInput["evaluationStatus"],
    ) => {
      const presentation: MonitorOverviewPresentation = build(
        input(MonitorType.NetworkDevice, {
          evaluationStatus: evaluationStatus,
          firstMeasuredAt: null,
        }),
      );

      expect(presentation.runState).toBe(
        MonitorOverviewRunState.AwaitingFirstData,
      );
      expect(presentation.badge.text).toBe("Waiting for data");
      expect(presentation.lastKnownStatus).toBeUndefined();
    },
  );

  test("a Probe Status monitor whose log cannot be read waits, and claims no recorded status", () => {
    const presentation: MonitorOverviewPresentation = build(
      input(MonitorType.ProbeStatus, {
        evaluationStatus: "error",
        firstMeasuredAt: null,
      }),
    );

    expect(presentation.badge.text).toBe("Waiting for data");
  });

  test("a row in the log wins over an empty column: the stamp is written once, first", () => {
    const presentation: MonitorOverviewPresentation = build(
      input(MonitorType.Logs, {
        createdAt: ago(5 * DAY),
        firstMeasuredAt: null,
        latestEvaluationAt: ago(MINUTE),
      }),
    );

    expect(presentation.runState).toBe(MonitorOverviewRunState.Running);
    expect(presentation.badge.text).toBe("Operational");
  });

  test("a probe check whose probes cannot be read, paused, claims no recorded status", () => {
    const presentation: MonitorOverviewPresentation = build(
      input(MonitorType.Website, {
        probes: null,
        firstMeasuredAt: null,
        pause: {
          isDisabled: true,
          byManualIncident: false,
          byScheduledMaintenance: false,
        },
      }),
    );

    expect(presentation.badge.text).toBe("Disabled");
    expect(presentation.lastKnownStatus).toBeUndefined();
  });

  test("without the column (undefined) a paused probe check with unknown probes says its status, as before", () => {
    const presentation: MonitorOverviewPresentation = build(
      input(MonitorType.Website, {
        probes: null,
        pause: {
          isDisabled: true,
          byManualIncident: false,
          byScheduledMaintenance: false,
        },
      }),
    );

    expect(presentation.lastKnownStatus).toBe(
      "Last recorded status: Operational",
    );
  });

  test("a manual monitor is never taken for one that waits", () => {
    const presentation: MonitorOverviewPresentation = build(
      input(MonitorType.Manual, { firstMeasuredAt: null }),
    );

    expect(presentation.runState).toBe(MonitorOverviewRunState.Manual);
    expect(presentation.badge.text).toBe("Operational");
  });
});

describe("firstMeasuredAt set: something measured the monitor", () => {
  test("a probe check no probe checks any more keeps its last recorded status", () => {
    const presentation: MonitorOverviewPresentation = build(
      input(MonitorType.Website, {
        firstMeasuredAt: ago(10 * DAY),
        probeFlags: { isNoProbeEnabled: true, isAllProbesDisconnected: false },
        probes: {
          ...probesWithResult(),
          rows: [],
          attachedCount: 0,
          enabledCount: 0,
          reportingCount: 0,
          lastResultAt: undefined,
        } as unknown as MonitorOverviewProbeSummary,
      }),
    );

    expect(presentation.runState).toBe(MonitorOverviewRunState.NotChecking);
    expect(presentation.lastKnownStatus).toBe(
      "Last recorded status: Operational",
    );
  });

  test("a heartbeat monitor turned off whose row lost its request keeps its last recorded status", () => {
    const presentation: MonitorOverviewPresentation = build(
      input(MonitorType.IncomingRequest, {
        firstMeasuredAt: ago(3 * DAY),
        pause: {
          isDisabled: true,
          byManualIncident: false,
          byScheduledMaintenance: false,
        },
      }),
    );

    expect(presentation.badge.text).toBe("Disabled");
    expect(presentation.lastKnownStatus).toBe(
      "Last recorded status: Operational",
    );
  });

  test("a running probe check with results reads as it always did", () => {
    const presentation: MonitorOverviewPresentation = build(
      input(MonitorType.Website, { firstMeasuredAt: ago(10 * DAY) }),
    );

    expect(presentation.runState).toBe(MonitorOverviewRunState.Running);
    expect(presentation.badge.text).toBe("Operational");
  });
});

describe("the last missing-signal check of a heartbeat monitor (#8123)", () => {
  test.each([
    [MonitorType.IncomingRequest, "Missing-request check"],
    [MonitorType.IncomingEmail, "Missing-email check"],
  ] as Array<[MonitorType, string]>)(
    "%s: while the stamp is as recent as a running sweep leaves it, the schedule",
    (monitorType: MonitorType, label: string) => {
      for (const ageSeconds of [0, 30, 4 * 60, 6 * 60]) {
        const presentation: MonitorOverviewPresentation = build(
          input(monitorType, {
            heartbeat: {
              lastReceivedAt: ago(MINUTE),
              lastCheckedAt: ago(ageSeconds * SECOND),
            },
            email: {
              lastReceivedAt: ago(MINUTE),
              lastCheckedAt: ago(ageSeconds * SECOND),
            },
          }),
        );
        const fact: MonitorOverviewFact | undefined = factOf(
          presentation,
          "heartbeat-check",
        );

        expect({ ageSeconds, label: fact?.label, value: fact?.value }).toEqual({
          ageSeconds,
          label: label,
          value: "Every 30 seconds",
        });
        expect(fact?.valueDate).toBeUndefined();
      }
    },
  );

  test("older than that, the stamp: the sweeps have stopped reaching the monitor", () => {
    const checkedAt: Date = ago((HEARTBEAT_CHECK_STAMP_FRESH_FOR_SECONDS + 1) * SECOND);
    const fact: MonitorOverviewFact | undefined = factOf(
      build(
        input(MonitorType.IncomingRequest, {
          heartbeat: { lastReceivedAt: ago(MINUTE), lastCheckedAt: checkedAt },
        }),
      ),
      "heartbeat-check",
    );

    expect(fact?.label).toBe("Last missing-request check");
    expect(fact?.valueDate?.getTime()).toBe(checkedAt.getTime());
  });

  test("a paused monitor is not swept: its stamp says when it last was", () => {
    const checkedAt: Date = ago(MINUTE);
    const fact: MonitorOverviewFact | undefined = factOf(
      build(
        input(MonitorType.IncomingEmail, {
          email: { lastReceivedAt: ago(HOUR), lastCheckedAt: checkedAt },
          pause: {
            isDisabled: false,
            byManualIncident: true,
            byScheduledMaintenance: false,
          },
        }),
      ),
      "heartbeat-check",
    );

    expect(fact?.label).toBe("Last missing-email check");
    expect(fact?.valueDate?.getTime()).toBe(checkedAt.getTime());
  });

  test("never stamped: not run yet, as before", () => {
    const fact: MonitorOverviewFact | undefined = factOf(
      build(input(MonitorType.IncomingRequest, { heartbeat: {} })),
      "heartbeat-check",
    );

    expect(fact?.label).toBe("Last missing-request check");
    expect(fact?.value).toBe("Not run yet");
  });
});

describe("HeartbeatSweepSchedule", () => {
  test("a stamp up to one write fence and two sweeps old is on schedule", () => {
    expect(HEARTBEAT_CHECK_STAMP_FRESH_FOR_SECONDS).toBe(
      HEARTBEAT_CHECK_STAMP_WRITE_EVERY_SECONDS +
        2 * HEARTBEAT_SWEEP_EVERY_SECONDS,
    );
    expect(
      HeartbeatSweepSchedule.isStampOnSchedule({
        checkedAt: ago(HEARTBEAT_CHECK_STAMP_FRESH_FOR_SECONDS * SECOND),
        now: NOW,
      }),
    ).toBe(true);
    expect(
      HeartbeatSweepSchedule.isStampOnSchedule({
        checkedAt: ago((HEARTBEAT_CHECK_STAMP_FRESH_FOR_SECONDS + 1) * SECOND),
        now: NOW,
      }),
    ).toBe(false);
  });

  test("a stamp from the future (clock skew) counts as just written; none is not on schedule", () => {
    expect(
      HeartbeatSweepSchedule.isStampOnSchedule({
        checkedAt: new Date(NOW.getTime() + MINUTE),
        now: NOW,
      }),
    ).toBe(true);
    expect(
      HeartbeatSweepSchedule.isStampOnSchedule({ checkedAt: undefined, now: NOW }),
    ).toBe(false);
    expect(
      HeartbeatSweepSchedule.isStampOnSchedule({ checkedAt: null, now: NOW }),
    ).toBe(false);
    expect(
      HeartbeatSweepSchedule.isStampOnSchedule({
        checkedAt: new Date("not a time"),
        now: NOW,
      }),
    ).toBe(false);
  });

  test("its numbers are the sweeps' and the write fence's own", () => {
    expect(MonitorHeartbeatState.CHECK_STAMP_WRITE_EVERY_SECONDS).toBe(
      HEARTBEAT_CHECK_STAMP_WRITE_EVERY_SECONDS,
    );
    expect(HEARTBEAT_SWEEP_EVERY_SECONDS).toBe(30);

    const workers: string = path.resolve(
      __dirname,
      "../../../../App/FeatureSet/Workers/Jobs",
    );

    for (const sweep of [
      "IncomingRequestMonitor/CheckHeartbeat.ts",
      "IncomingEmailMonitor/CheckOnlineStatus.ts",
    ]) {
      const source: string = fs.readFileSync(path.join(workers, sweep), "utf8");

      expect({ sweep, everyThirty: source.includes("EVERY_THIRTY_SECONDS") }).toEqual(
        { sweep, everyThirty: true },
      );
    }

    // EVERY_THIRTY_SECONDS is the cron for thirty seconds.
    expect(EVERY_THIRTY_SECONDS).toMatch(/\*\/30/);
  });

  test("the schedule's words are in every Dashboard language, one and other", () => {
    const locales: string = path.resolve(
      __dirname,
      "../../../../App/FeatureSet/Dashboard/src/Locales",
    );

    for (const file of fs.readdirSync(locales)) {
      if (!file.endsWith(".json")) {
        continue;
      }

      const locale: JSONObject = JSON.parse(
        fs.readFileSync(path.join(locales, file), "utf8"),
      ) as JSONObject;

      for (const key of [
        "Every {{count}} seconds",
        "Every {{count}} seconds_one",
        "Missing-request check",
        "Missing-email check",
      ]) {
        expect({ file, key, isWorded: typeof locale[key] === "string" }).toEqual(
          { file, key, isWorded: true },
        );
      }

      expect(String(locale["Every {{count}} seconds"])).toContain("{{count}}");
      expect(String(locale["Every {{count}} seconds_one"])).toContain(
        "{{count}}",
      );
    }
  });
});
