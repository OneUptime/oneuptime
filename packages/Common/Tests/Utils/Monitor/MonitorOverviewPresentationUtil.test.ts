import MonitorProbe, {
  MonitorStepProbeResponse,
} from "../../../Models/DatabaseModels/MonitorProbe";
import Probe, {
  ProbeConnectionStatus,
} from "../../../Models/DatabaseModels/Probe";
import OneUptimeDate from "../../../Types/Date";
import { JSONObject } from "../../../Types/JSON";
import { CheckOn, FilterType } from "../../../Types/Monitor/CriteriaFilter";
import MonitorMetricType from "../../../Types/Monitor/MonitorMetricType";
import MonitorSteps from "../../../Types/Monitor/MonitorSteps";
import MonitorType from "../../../Types/Monitor/MonitorType";
import ObjectID from "../../../Types/ObjectID";
import Timezone from "../../../Types/Timezone";
import CronTab from "../../../Utils/CronTab";
import { MonitorCheckFreshness } from "../../../Utils/Monitor/MonitorCheckScheduleUtil";
import MonitorOverviewFamilyUtil, {
  MonitorOverviewFamily,
  MonitorOverviewSetupKind,
} from "../../../Utils/Monitor/MonitorOverviewFamily";
import MonitorOverviewPresentationUtil, {
  MONITOR_LOG_MINIMUM_RETENTION_SECONDS,
  MONITOR_LOG_RETENTION_HORIZON_SECONDS,
  MonitorOverviewFact,
  MonitorOverviewPresentation,
  MonitorOverviewPresentationInput,
  MonitorOverviewRunState,
  MonitorOverviewStatusRef,
} from "../../../Utils/Monitor/MonitorOverviewPresentationUtil";
import MonitorOverviewProbeUtil, {
  MonitorOverviewProbeHealth,
  MonitorOverviewProbeRow,
  MonitorOverviewProbeSummary,
} from "../../../Utils/Monitor/MonitorOverviewProbeUtil";
import { afterEach, describe, expect, it, jest } from "@jest/globals";
import type { MockInstance } from "jest-mock";

/*
 * The hero, facts, pulse and section switches of the monitor overview for
 * every family and run state. The invariants at the top are the reason the
 * page was redesigned: a monitor that is paused, not being checked, not set
 * up or still waiting for data must never look healthy, and an unknown must
 * never be presented as a zero or a "none".
 */

const NOW: Date = new Date("2026-09-21T12:00:00.000Z");
const STEP_ID: string = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const DEVICE_ID: string = "66666666-6666-4666-8666-666666666666";
const OTHER_DEVICE_ID: string = "77777777-7777-4777-8777-777777777777";

const secondsAgo: (seconds: number) => Date = (seconds: number): Date => {
  return new Date(NOW.getTime() - seconds * 1000);
};

const DAY: number = 86400;

const OPERATIONAL: MonitorOverviewStatusRef = {
  id: "22222222-2222-4222-8222-222222222222",
  name: "Operational",
  color: "#10B981",
  isOperationalState: true,
  isOfflineState: false,
};

const DEGRADED: MonitorOverviewStatusRef = {
  id: "33333333-3333-4333-8333-333333333333",
  name: "Degraded",
  color: "#F59E0B",
  isOperationalState: false,
  isOfflineState: false,
};

const OFFLINE: MonitorOverviewStatusRef = {
  id: "44444444-4444-4444-8444-444444444444",
  name: "Offline",
  color: "#EF4444",
  isOperationalState: false,
  isOfflineState: true,
};

const ALL_TYPES: Array<MonitorType> = Object.values(MonitorType);

const stepsOf: (...stepData: Array<JSONObject>) => MonitorSteps = (
  ...stepData: Array<JSONObject>
): MonitorSteps => {
  return {
    data: {
      monitorStepsInstanceArray: stepData.map((data: JSONObject) => {
        return { data: { id: STEP_ID, ...data } };
      }),
    },
  } as unknown as MonitorSteps;
};

const NO_STEPS: MonitorSteps = stepsOf();

const missingWindowSteps: (
  checkOn: CheckOn,
  minutes: number,
) => MonitorSteps = (checkOn: CheckOn, minutes: number): MonitorSteps => {
  return stepsOf({
    monitorCriteria: {
      data: {
        monitorCriteriaInstanceArray: [
          {
            data: {
              filters: [
                {
                  checkOn: checkOn,
                  filterType: FilterType.NotRecievedInMinutes,
                  value: minutes,
                },
              ],
            },
          },
        ],
      },
    },
  });
};

const probes: (
  overrides?: Partial<MonitorOverviewProbeSummary>,
) => MonitorOverviewProbeSummary = (
  overrides?: Partial<MonitorOverviewProbeSummary>,
): MonitorOverviewProbeSummary => {
  return {
    rows: [],
    attachedCount: 2,
    enabledCount: 2,
    reportingCount: 2,
    disabledCount: 0,
    disconnectedCount: 0,
    lastResultAt: secondsAgo(60),
    nextCheckAt: secondsAgo(-240),
    latestResult: {
      probeId: "11111111-1111-4111-8111-111111111111",
      probeName: "London",
      monitoredAt: secondsAgo(60),
      isOnline: true,
      responseTimeInMs: 120,
      responseCode: 200,
    },
    responseTime: {
      medianMs: 120,
      minMs: 100,
      maxMs: 140,
      respondedCount: 2,
      totalCount: 2,
    },
    ...overrides,
  };
};

const NO_RESULTS: Partial<MonitorOverviewProbeSummary> = {
  reportingCount: 0,
  lastResultAt: undefined,
  latestResult: undefined,
  responseTime: null,
};

/*
 * A healthy, running monitor of the given type: the starting point every
 * test changes one thing about.
 */
const running: (
  monitorType: MonitorType,
  overrides?: Partial<MonitorOverviewPresentationInput>,
) => MonitorOverviewPresentationInput = (
  monitorType: MonitorType,
  overrides?: Partial<MonitorOverviewPresentationInput>,
): MonitorOverviewPresentationInput => {
  const family: MonitorOverviewFamily =
    MonitorOverviewFamilyUtil.getFamily(monitorType);

  const base: MonitorOverviewPresentationInput = {
    now: NOW,
    monitorType: monitorType,
    monitorSteps: stepsOf({
      monitorDestination: "https://api.example.com/health",
      networkDeviceMonitor: { networkDeviceId: DEVICE_ID },
    }),
    monitoringInterval: "*/5 * * * *",
    createdAt: secondsAgo(30 * DAY),
    currentStatus: OPERATIONAL,
    statusSince: secondsAgo(3 * DAY + 4 * 3600),
    pause: {
      isDisabled: false,
      byManualIncident: false,
      byScheduledMaintenance: false,
    },
    probeFlags: { isNoProbeEnabled: false, isAllProbesDisconnected: false },
    probes: family === MonitorOverviewFamily.ProbeCheck ? probes() : null,
    heartbeat: {
      lastReceivedAt: secondsAgo(120),
      lastCheckedAt: secondsAgo(30),
      requestMethod: "POST",
    },
    email: { lastReceivedAt: secondsAgo(300), lastCheckedAt: secondsAgo(40) },
    agent: {
      lastReportAt: secondsAgo(45),
      hostname: "web-01.example.com",
      cpuPercent: 42.4,
      memoryPercent: 63.6,
    },
    telemetry: {
      lastScheduledAt: secondsAgo(30),
      nextEvaluationAt: secondsAgo(-270),
    },
    latestEvaluationAt: secondsAgo(90),
    evaluationStatus: "loaded",
  };

  return { ...base, ...overrides };
};

const build: (
  input: MonitorOverviewPresentationInput,
) => MonitorOverviewPresentation = (
  input: MonitorOverviewPresentationInput,
): MonitorOverviewPresentation => {
  return MonitorOverviewPresentationUtil.build(input);
};

const factKeys: (presentation: MonitorOverviewPresentation) => Array<string> = (
  presentation: MonitorOverviewPresentation,
): Array<string> => {
  return presentation.facts.map((fact: MonitorOverviewFact) => {
    return fact.key;
  });
};

const fact: (
  presentation: MonitorOverviewPresentation,
  key: string,
) => MonitorOverviewFact = (
  presentation: MonitorOverviewPresentation,
  key: string,
): MonitorOverviewFact => {
  const found: MonitorOverviewFact | undefined = presentation.facts.find(
    (item: MonitorOverviewFact) => {
      return item.key === key;
    },
  );

  if (!found) {
    throw new Error(`no ${key} fact in ${factKeys(presentation).join(", ")}`);
  }

  return found;
};

interface Scenario {
  name: string;
  input: MonitorOverviewPresentationInput;
  runState: MonitorOverviewRunState;
  // Awaiting, but already judged by the server, so its history is shown.
  hasPushVerdict?: boolean;
}

/*
 * One monitor per interesting state, across the families. The invariant
 * tests run over all of them.
 */
const SCENARIOS: Array<Scenario> = [
  {
    name: "manual with a status",
    input: running(MonitorType.Manual),
    runState: MonitorOverviewRunState.Manual,
  },
  {
    name: "API disabled",
    input: running(MonitorType.API, {
      pause: {
        isDisabled: true,
        byManualIncident: false,
        byScheduledMaintenance: false,
      },
    }),
    runState: MonitorOverviewRunState.Paused,
  },
  {
    name: "Logs paused by an incident",
    input: running(MonitorType.Logs, {
      currentStatus: OFFLINE,
      pause: {
        isDisabled: false,
        byManualIncident: true,
        byScheduledMaintenance: false,
      },
    }),
    runState: MonitorOverviewRunState.Paused,
  },
  {
    name: "incoming request in maintenance",
    input: running(MonitorType.IncomingRequest, {
      pause: {
        isDisabled: false,
        byManualIncident: false,
        byScheduledMaintenance: true,
      },
    }),
    runState: MonitorOverviewRunState.Paused,
  },
  {
    name: "API with every probe switched off",
    input: running(MonitorType.API, {
      probeFlags: { isNoProbeEnabled: true, isAllProbesDisconnected: false },
      probes: probes({
        ...NO_RESULTS,
        attachedCount: 2,
        enabledCount: 0,
        disabledCount: 2,
      }),
    }),
    runState: MonitorOverviewRunState.NotChecking,
  },
  {
    name: "Website with every probe disconnected",
    input: running(MonitorType.Website, {
      currentStatus: OPERATIONAL,
      probeFlags: { isNoProbeEnabled: false, isAllProbesDisconnected: true },
    }),
    runState: MonitorOverviewRunState.NotChecking,
  },
  {
    name: "DNS with no criteria",
    input: running(MonitorType.DNS, { monitorSteps: NO_STEPS }),
    runState: MonitorOverviewRunState.NotConfigured,
  },
  {
    name: "network device with no device",
    input: running(MonitorType.NetworkDevice, {
      monitorSteps: stepsOf({ networkDeviceMonitor: {} }),
    }),
    runState: MonitorOverviewRunState.NotConfigured,
  },
  {
    name: "new API monitor",
    input: running(MonitorType.API, {
      createdAt: secondsAgo(120),
      statusSince: undefined,
      probes: probes(NO_RESULTS),
    }),
    runState: MonitorOverviewRunState.AwaitingFirstData,
  },
  {
    name: "heartbeat that never received a request",
    input: running(MonitorType.IncomingRequest, {
      heartbeat: {},
    }),
    runState: MonitorOverviewRunState.AwaitingFirstData,
  },
  {
    name: "inbound email that never received one",
    input: running(MonitorType.IncomingEmail, { email: {} }),
    runState: MonitorOverviewRunState.AwaitingFirstData,
  },
  {
    name: "server whose agent never reported",
    input: running(MonitorType.Server, { agent: {} }),
    runState: MonitorOverviewRunState.AwaitingFirstData,
  },
  {
    name: "kubernetes never evaluated",
    input: running(MonitorType.Kubernetes, {
      createdAt: secondsAgo(120),
      telemetry: {},
      latestEvaluationAt: undefined,
    }),
    runState: MonitorOverviewRunState.AwaitingFirstData,
  },
  {
    name: "API with a stale result",
    input: running(MonitorType.API, {
      probes: probes({ lastResultAt: secondsAgo(2 * 3600) }),
    }),
    runState: MonitorOverviewRunState.Overdue,
  },
  {
    name: "offline API with a stale result",
    input: running(MonitorType.API, {
      currentStatus: OFFLINE,
      probes: probes({ lastResultAt: secondsAgo(2 * 3600) }),
    }),
    runState: MonitorOverviewRunState.Overdue,
  },
  {
    /*
     * The worker keeps stamping "last scheduled" every minute, but nothing
     * has been evaluated for an hour: the queue is stuck, or every
     * evaluation fails.
     */
    name: "metrics monitor with a stale evaluation",
    input: running(MonitorType.Metrics, {
      monitoringInterval: "* * * * *",
      telemetry: {
        lastScheduledAt: secondsAgo(10),
        nextEvaluationAt: secondsAgo(-50),
      },
      latestEvaluationAt: secondsAgo(3600),
    }),
    runState: MonitorOverviewRunState.Overdue,
  },
  {
    name: "running API",
    input: running(MonitorType.API),
    runState: MonitorOverviewRunState.Running,
  },
  {
    name: "running heartbeat",
    input: running(MonitorType.IncomingRequest),
    runState: MonitorOverviewRunState.Running,
  },
  {
    name: "running network device",
    input: running(MonitorType.NetworkDevice),
    runState: MonitorOverviewRunState.Running,
  },
  {
    name: "running server with no status",
    input: running(MonitorType.Server, { currentStatus: undefined }),
    runState: MonitorOverviewRunState.Running,
  },
  {
    name: "heartbeat that never received a request, judged offline",
    input: running(MonitorType.IncomingRequest, {
      currentStatus: OFFLINE,
      heartbeat: {},
    }),
    runState: MonitorOverviewRunState.AwaitingFirstData,
    hasPushVerdict: true,
  },
  {
    name: "API that never reported, created two days ago",
    input: running(MonitorType.API, {
      createdAt: secondsAgo(2 * DAY),
      statusSince: undefined,
      probes: probes({ ...NO_RESULTS, nextCheckAt: undefined }),
    }),
    runState: MonitorOverviewRunState.Overdue,
  },
  {
    name: "logs monitor with nothing in its evaluation log's last day",
    input: running(MonitorType.Logs, {
      createdAt: secondsAgo(10 * DAY),
      latestEvaluationAt: undefined,
    }),
    runState: MonitorOverviewRunState.Overdue,
  },
  {
    name: "new network device whose log is loaded and empty",
    input: running(MonitorType.NetworkDevice, {
      createdAt: secondsAgo(3600),
      latestEvaluationAt: undefined,
    }),
    runState: MonitorOverviewRunState.AwaitingFirstData,
  },
  {
    // Its rows expired: the log only covers the last day or two.
    name: "network device with nothing in its evaluation log's last day",
    input: running(MonitorType.NetworkDevice, {
      currentStatus: OFFLINE,
      latestEvaluationAt: undefined,
    }),
    runState: MonitorOverviewRunState.Running,
  },
  {
    name: "weekly logs monitor whose last evaluation has left the log",
    input: running(MonitorType.Logs, {
      // Fridays at noon; now is Monday noon.
      monitoringInterval: "0 12 * * 5",
      createdAt: secondsAgo(90 * DAY),
      telemetry: {
        lastScheduledAt: secondsAgo(3 * DAY),
        nextEvaluationAt: secondsAgo(-4 * DAY),
      },
      latestEvaluationAt: undefined,
    }),
    runState: MonitorOverviewRunState.Running,
  },
];

describe("MonitorOverviewPresentationUtil run states", () => {
  it.each(SCENARIOS)("$name is $runState", (scenario: Scenario) => {
    expect(MonitorOverviewPresentationUtil.getRunState(scenario.input)).toBe(
      scenario.runState,
    );
    expect(build(scenario.input).runState).toBe(scenario.runState);
  });

  it("run-state precedence table", () => {
    const rows: Array<
      [string, MonitorOverviewPresentationInput, MonitorOverviewRunState]
    > = [
      [
        "Manual beats disabled",
        running(MonitorType.Manual, {
          pause: {
            isDisabled: true,
            byManualIncident: true,
            byScheduledMaintenance: true,
          },
        }),
        MonitorOverviewRunState.Manual,
      ],
      [
        "disabled beats not checking",
        running(MonitorType.API, {
          pause: {
            isDisabled: true,
            byManualIncident: false,
            byScheduledMaintenance: false,
          },
          probeFlags: {
            isNoProbeEnabled: true,
            isAllProbesDisconnected: true,
          },
        }),
        MonitorOverviewRunState.Paused,
      ],
      [
        "paused with no probes",
        running(MonitorType.API, {
          pause: {
            isDisabled: false,
            byManualIncident: false,
            byScheduledMaintenance: true,
          },
          probes: probes({
            ...NO_RESULTS,
            attachedCount: 0,
            enabledCount: 0,
          }),
        }),
        MonitorOverviewRunState.Paused,
      ],
      [
        "not checking beats awaiting",
        running(MonitorType.API, {
          createdAt: secondsAgo(60),
          probeFlags: {
            isNoProbeEnabled: true,
            isAllProbesDisconnected: false,
          },
          probes: probes(NO_RESULTS),
        }),
        MonitorOverviewRunState.NotChecking,
      ],
      [
        "not checking beats not configured",
        running(MonitorType.API, {
          monitorSteps: NO_STEPS,
          probeFlags: {
            isNoProbeEnabled: false,
            isAllProbesDisconnected: true,
          },
        }),
        MonitorOverviewRunState.NotChecking,
      ],
      [
        "not configured beats awaiting",
        running(MonitorType.API, {
          monitorSteps: NO_STEPS,
          createdAt: secondsAgo(60),
          probes: probes(NO_RESULTS),
        }),
        MonitorOverviewRunState.NotConfigured,
      ],
      [
        "awaiting beats overdue while only the scheduler's stamp is known",
        running(MonitorType.Logs, {
          createdAt: secondsAgo(10 * DAY),
          telemetry: { nextEvaluationAt: secondsAgo(DAY) },
          latestEvaluationAt: undefined,
          evaluationStatus: "error",
        }),
        MonitorOverviewRunState.AwaitingFirstData,
      ],
      [
        "overdue beats running",
        running(MonitorType.Ping, {
          probes: probes({ lastResultAt: secondsAgo(3600) }),
        }),
        MonitorOverviewRunState.Overdue,
      ],
      [
        "probe flags only matter for probe checks",
        running(MonitorType.IncomingRequest, {
          probeFlags: {
            isNoProbeEnabled: true,
            isAllProbesDisconnected: true,
          },
        }),
        MonitorOverviewRunState.Running,
      ],
      [
        "the probe rows say no probe is enabled before the flag does",
        running(MonitorType.API, {
          probes: probes({
            ...NO_RESULTS,
            enabledCount: 0,
            disabledCount: 2,
          }),
        }),
        MonitorOverviewRunState.NotChecking,
      ],
      [
        "the probe rows say every enabled probe is disconnected",
        running(MonitorType.API, {
          probes: probes({ disconnectedCount: 2, reportingCount: 0 }),
        }),
        MonitorOverviewRunState.NotChecking,
      ],
      [
        "unknown probes are never overdue or awaiting",
        running(MonitorType.API, { probes: null }),
        MonitorOverviewRunState.Running,
      ],
      [
        "a network device is not awaiting while its log is unknown",
        running(MonitorType.NetworkDevice, {
          latestEvaluationAt: undefined,
          evaluationStatus: undefined,
          createdAt: secondsAgo(60),
        }),
        MonitorOverviewRunState.Running,
      ],
      [
        "a network device is not awaiting while its log is unreadable",
        running(MonitorType.NetworkDevice, {
          latestEvaluationAt: undefined,
          evaluationStatus: "forbidden",
        }),
        MonitorOverviewRunState.Running,
      ],
    ];

    for (const [name, input, expected] of rows) {
      expect({ name: name, runState: build(input).runState }).toEqual({
        name: name,
        runState: expected,
      });
    }
  });
});

describe("MonitorOverviewPresentationUtil invariants", () => {
  it.each(ALL_TYPES)(
    "%s never produces more than 4 facts, minimal and full input",
    (monitorType: MonitorType) => {
      const minimal: MonitorOverviewPresentationInput = {
        now: NOW,
        monitorType: monitorType,
        pause: {
          isDisabled: false,
          byManualIncident: false,
          byScheduledMaintenance: false,
        },
        probeFlags: {
          isNoProbeEnabled: false,
          isAllProbesDisconnected: false,
        },
        probes: null,
        heartbeat: {},
        email: {},
        agent: {},
        telemetry: {},
      };

      for (const input of [minimal, running(monitorType)]) {
        const presentation: MonitorOverviewPresentation = build(input);

        expect(presentation.facts.length).toBeGreaterThanOrEqual(1);
        expect(presentation.facts.length).toBeLessThanOrEqual(4);
        expect(presentation.facts[presentation.facts.length - 1]!.key).toBe(
          "owners",
        );
        expect(new Set(factKeys(presentation)).size).toBe(
          presentation.facts.length,
        );
      }
    },
  );

  it("states Paused/NotChecking/NotConfigured/AwaitingFirstData are never good and never show the status name as the primary badge", () => {
    const guarded: Array<MonitorOverviewRunState> = [
      MonitorOverviewRunState.Paused,
      MonitorOverviewRunState.NotChecking,
      MonitorOverviewRunState.NotConfigured,
      MonitorOverviewRunState.AwaitingFirstData,
    ];
    let checked: number = 0;

    for (const scenario of SCENARIOS) {
      const presentation: MonitorOverviewPresentation = build(scenario.input);

      if (!guarded.includes(presentation.runState)) {
        continue;
      }

      checked++;
      expect({ name: scenario.name, tone: presentation.tone }).not.toEqual({
        name: scenario.name,
        tone: "good",
      });
      expect(presentation.badge.tone).not.toBe("good");
      expect(presentation.badge.text).not.toBe(
        scenario.input.currentStatus?.name,
      );
      expect(presentation.badge.statusColor).toBeUndefined();
    }

    expect(checked).toBeGreaterThanOrEqual(10);
  });

  it("Overdue is never good", () => {
    for (const status of [OPERATIONAL, DEGRADED, OFFLINE, undefined]) {
      const presentation: MonitorOverviewPresentation = build(
        running(MonitorType.API, {
          currentStatus: status,
          probes: probes({ lastResultAt: secondsAgo(2 * 3600) }),
        }),
      );

      expect(presentation.runState).toBe(MonitorOverviewRunState.Overdue);
      expect(presentation.tone).not.toBe("good");
      expect(presentation.secondaryBadges).toEqual([
        { text: "Checks overdue", tone: "warning" },
      ]);
    }

    expect(
      build(
        running(MonitorType.API, {
          currentStatus: OPERATIONAL,
          probes: probes({ lastResultAt: secondsAgo(2 * 3600) }),
        }),
      ).tone,
    ).toBe("warning");
    expect(
      build(
        running(MonitorType.API, {
          currentStatus: OFFLINE,
          probes: probes({ lastResultAt: secondsAgo(2 * 3600) }),
        }),
      ).tone,
    ).toBe("danger");
  });

  it("showUptime is false only while awaiting first data that nothing has judged", () => {
    for (const scenario of SCENARIOS) {
      const presentation: MonitorOverviewPresentation = build(scenario.input);

      expect({
        name: scenario.name,
        showUptime: presentation.sections.showUptime,
      }).toEqual({
        name: scenario.name,
        showUptime:
          presentation.runState !== MonitorOverviewRunState.AwaitingFirstData ||
          scenario.hasPushVerdict === true,
      });
    }
  });

  it("owners is always the last fact", () => {
    for (const scenario of SCENARIOS) {
      const presentation: MonitorOverviewPresentation = build(scenario.input);
      const last: MonitorOverviewFact =
        presentation.facts[presentation.facts.length - 1]!;

      expect(last).toEqual({ key: "owners", label: "Owners", value: "" });
    }
  });
});

describe("MonitorOverviewPresentationUtil hero", () => {
  it("running shows the status, its colour and how long it has held", () => {
    const presentation: MonitorOverviewPresentation = build(
      running(MonitorType.API),
    );

    expect(presentation.tone).toBe("good");
    expect(presentation.badge).toEqual({
      text: "Operational",
      tone: "good",
      statusColor: "#10B981",
    });
    expect(presentation.headline).toEqual({
      text: "Operational",
      since: secondsAgo(3 * DAY + 4 * 3600),
    });
    expect(presentation.secondaryBadges).toEqual([]);
    expect(presentation.explanation).toBeUndefined();
    expect(presentation.callToAction).toBeUndefined();
    expect(presentation.freshness).toBe(MonitorCheckFreshness.Fresh);
  });

  it('since is used only when given; no status gives "No status recorded yet"', () => {
    expect(
      build(running(MonitorType.API, { statusSince: undefined })).headline,
    ).toEqual({ text: "Operational", since: undefined });

    const noStatus: MonitorOverviewPresentation = build(
      running(MonitorType.API, {
        currentStatus: undefined,
        statusSince: secondsAgo(60),
      }),
    );

    expect(noStatus.headline).toEqual({ text: "No status recorded yet" });
    expect(noStatus.badge).toEqual({ text: "Unknown status", tone: "neutral" });
    expect(noStatus.tone).toBe("neutral");
  });

  it("offline status is danger, operational is good, any other is warning", () => {
    expect(MonitorOverviewPresentationUtil.getStatusTone(OPERATIONAL)).toBe(
      "good",
    );
    expect(MonitorOverviewPresentationUtil.getStatusTone(OFFLINE)).toBe(
      "danger",
    );
    expect(MonitorOverviewPresentationUtil.getStatusTone(DEGRADED)).toBe(
      "warning",
    );
    expect(MonitorOverviewPresentationUtil.getStatusTone(undefined)).toBe(
      "neutral",
    );
    // A status flagged both ways must not read as good.
    expect(
      MonitorOverviewPresentationUtil.getStatusTone({
        ...OFFLINE,
        isOperationalState: true,
      }),
    ).toBe("danger");

    expect(
      build(running(MonitorType.API, { currentStatus: OFFLINE })).badge,
    ).toEqual({ text: "Offline", tone: "danger", statusColor: "#EF4444" });
    expect(
      build(running(MonitorType.API, { currentStatus: DEGRADED })).tone,
    ).toBe("warning");
  });

  it("an unreadable status colour is dropped, not passed to a style", () => {
    expect(
      build(
        running(MonitorType.API, {
          currentStatus: { ...OPERATIONAL, color: "url(javascript:x)" },
        }),
      ).badge.statusColor,
    ).toBeUndefined();
  });

  it("manual monitors say who sets the status", () => {
    const presentation: MonitorOverviewPresentation = build(
      running(MonitorType.Manual, { currentStatus: DEGRADED }),
    );

    expect(presentation.badge.text).toBe("Degraded");
    expect(presentation.tone).toBe("warning");
    expect(presentation.secondaryBadges).toEqual([
      { text: "Manual", tone: "neutral" },
    ]);
    expect(presentation.explanation).toBe(
      "Manual monitor: OneUptime runs no checks. The status changes when someone sets it, or when an incident or scheduled maintenance event changes it.",
    );
    expect(presentation.callToAction).toEqual({
      text: "Change status",
      linkKey: "statusTimeline",
    });

    const unknown: MonitorOverviewPresentation = build(
      running(MonitorType.Manual, { currentStatus: undefined }),
    );

    expect(unknown.badge).toEqual({ text: "Unknown status", tone: "neutral" });
    expect(unknown.headline.text).toBe("No status recorded yet");
  });

  it("paused copy per reason", () => {
    const disabled: MonitorOverviewPresentation = build(SCENARIOS[1]!.input);

    expect(disabled.badge).toEqual({ text: "Disabled", tone: "neutral" });
    expect(disabled.headline.text).toBe("Monitoring is turned off");
    expect(disabled.explanation).toBe(
      "No checks run while monitoring is off, so the status stays at the last one recorded.",
    );
    expect(disabled.lastKnownStatus).toBe("Last recorded status: Operational");
    expect(disabled.callToAction).toEqual({
      text: "Open settings",
      linkKey: "settings",
    });

    const byIncident: MonitorOverviewPresentation = build(SCENARIOS[2]!.input);

    expect(byIncident.badge).toEqual({ text: "Paused", tone: "neutral" });
    expect(byIncident.headline.text).toBe(
      "Monitoring is paused by an incident",
    );
    expect(byIncident.lastKnownStatus).toBe("Last recorded status: Offline");
    expect(byIncident.callToAction).toEqual({
      text: "View incidents",
      linkKey: "incidents",
    });

    const maintenance: MonitorOverviewPresentation = build(SCENARIOS[3]!.input);

    expect(maintenance.badge.text).toBe("Paused");
    expect(maintenance.headline.text).toBe(
      "Monitoring is paused for scheduled maintenance",
    );
    expect(maintenance.explanation).toBe(
      "Checks resume automatically when the maintenance event ends.",
    );
    expect(maintenance.callToAction).toBeUndefined();
  });

  it('paused with no probe enabled keeps a "Probes Not Enabled" secondary badge', () => {
    const presentation: MonitorOverviewPresentation = build(
      running(MonitorType.API, {
        pause: {
          isDisabled: true,
          byManualIncident: false,
          byScheduledMaintenance: false,
        },
        probeFlags: { isNoProbeEnabled: true, isAllProbesDisconnected: true },
      }),
    );

    expect(presentation.badge.text).toBe("Disabled");
    expect(presentation.secondaryBadges).toEqual([
      { text: "Probes Not Enabled", tone: "danger" },
    ]);

    expect(
      build(
        running(MonitorType.API, {
          pause: {
            isDisabled: false,
            byManualIncident: false,
            byScheduledMaintenance: true,
          },
          probeFlags: {
            isNoProbeEnabled: false,
            isAllProbesDisconnected: true,
          },
        }),
      ).secondaryBadges,
    ).toEqual([{ text: "Probes Disconnected", tone: "danger" }]);

    // Only probe checks have probes to complain about.
    expect(
      build(
        running(MonitorType.Logs, {
          pause: {
            isDisabled: true,
            byManualIncident: false,
            byScheduledMaintenance: false,
          },
          probeFlags: {
            isNoProbeEnabled: true,
            isAllProbesDisconnected: false,
          },
        }),
      ).secondaryBadges,
    ).toEqual([]);
  });

  it("NotChecking wording for attached > 0, attached = 0, and unknown attachment", () => {
    const switchedOff: (
      attachedCount: number,
    ) => MonitorOverviewPresentation = (
      attachedCount: number,
    ): MonitorOverviewPresentation => {
      return build(
        running(MonitorType.API, {
          probeFlags: {
            isNoProbeEnabled: true,
            isAllProbesDisconnected: false,
          },
          probes: probes({
            ...NO_RESULTS,
            attachedCount: attachedCount,
            enabledCount: 0,
            disabledCount: attachedCount,
          }),
        }),
      );
    };

    const three: MonitorOverviewPresentation = switchedOff(3);

    expect(three.badge).toEqual({ text: "Probes Not Enabled", tone: "danger" });
    expect(three.tone).toBe("danger");
    expect(three.headline.text).toBe(
      "Every probe is turned off for this monitor",
    );
    expect(three.explanation).toBe(
      "3 probes are attached but switched off, so nothing is checking this resource.",
    );
    expect(three.callToAction).toEqual({
      text: "Manage probes",
      linkKey: "probes",
    });
    expect(three.lastKnownStatus).toBe("Last recorded status: Operational");

    expect(switchedOff(1).explanation).toBe(
      "1 probe is attached but switched off, so nothing is checking this resource.",
    );

    const none: MonitorOverviewPresentation = switchedOff(0);

    expect(none.headline.text).toBe("No probes are attached to this monitor");
    expect(none.explanation).toBe(
      "Add a probe to start checking this resource.",
    );
    expect(none.callToAction).toEqual({
      text: "Add a probe",
      linkKey: "probes",
    });

    const unknown: MonitorOverviewPresentation = build(
      running(MonitorType.API, {
        probeFlags: { isNoProbeEnabled: true, isAllProbesDisconnected: false },
        probes: null,
      }),
    );

    expect(unknown.headline.text).toBe("Nothing is checking this monitor");
    expect(unknown.explanation).toBe(
      "No probe is enabled for this monitor, so no checks run.",
    );
    expect(unknown.callToAction?.text).toBe("Manage probes");

    const disconnected: MonitorOverviewPresentation = build(
      SCENARIOS[5]!.input,
    );

    expect(disconnected.badge).toEqual({
      text: "Probes Disconnected",
      tone: "danger",
    });
    expect(disconnected.headline.text).toBe(
      "Every probe checking this monitor is disconnected",
    );
    expect(disconnected.callToAction).toEqual({
      text: "Check probes",
      linkKey: "probes",
    });
  });

  it('unknown probes never produce "No probes are attached"', () => {
    for (const flags of [
      { isNoProbeEnabled: true, isAllProbesDisconnected: false },
      { isNoProbeEnabled: true, isAllProbesDisconnected: true },
      { isNoProbeEnabled: false, isAllProbesDisconnected: false },
    ]) {
      const presentation: MonitorOverviewPresentation = build(
        running(MonitorType.API, { probeFlags: flags, probes: null }),
      );

      expect(JSON.stringify(presentation)).not.toContain(
        "No probes are attached",
      );
      expect(fact(presentation, "probes").value).toBe("Unavailable");
      expect(fact(presentation, "probes").isMuted).toBe(true);
    }
  });

  it("not configured copy", () => {
    const noCriteria: MonitorOverviewPresentation = build(SCENARIOS[6]!.input);

    expect(noCriteria.badge).toEqual({ text: "Not set up", tone: "neutral" });
    expect(noCriteria.headline.text).toBe("This monitor has no criteria yet");
    expect(noCriteria.callToAction).toEqual({
      text: "Set up criteria",
      linkKey: "criteria",
    });
    expect(noCriteria.lastKnownStatus).toBeUndefined();

    const noDevice: MonitorOverviewPresentation = build(SCENARIOS[7]!.input);

    expect(noDevice.headline.text).toBe("No network device is selected");
    expect(noDevice.explanation).toBe(
      "Choose the device this monitor alerts on.",
    );
    expect(noDevice.callToAction).toEqual({
      text: "Choose a device",
      linkKey: "criteria",
    });
  });

  it("awaiting copy per family", () => {
    const probeCheck: MonitorOverviewPresentation = build(SCENARIOS[8]!.input);

    expect(probeCheck.badge).toEqual({
      text: "Waiting for data",
      tone: "info",
    });
    expect(probeCheck.tone).toBe("info");
    expect(probeCheck.headline.text).toBe("Waiting for the first check");
    expect(probeCheck.explanation).toBe(
      "2 probes check this every 5 minutes. The first result usually arrives within a few minutes.",
    );
    expect(probeCheck.callToAction).toBeUndefined();
    expect(probeCheck.lastKnownStatus).toBe(
      "Last recorded status: Operational",
    );

    expect(
      build(
        running(MonitorType.Ping, {
          createdAt: secondsAgo(60),
          monitoringInterval: "* * * * *",
          probes: probes({ ...NO_RESULTS, enabledCount: 1, attachedCount: 1 }),
        }),
      ).explanation,
    ).toBe(
      "1 probe checks this every minute. The first result usually arrives within a few minutes.",
    );

    const heartbeat: MonitorOverviewPresentation = build(SCENARIOS[9]!.input);

    expect(heartbeat.headline.text).toBe("Waiting for the first heartbeat");
    expect(heartbeat.explanation).toBe(
      "Send a GET or POST request to this monitor's heartbeat URL to start tracking it.",
    );
    expect(heartbeat.callToAction).toEqual({
      text: "Setup instructions",
      linkKey: "documentation",
    });

    const email: MonitorOverviewPresentation = build(SCENARIOS[10]!.input);

    expect(email.headline.text).toBe("Waiting for the first email");
    expect(email.explanation).toBe(
      "Send an email to this monitor's address to start tracking it.",
    );
    expect(email.callToAction?.linkKey).toBe("documentation");

    const agent: MonitorOverviewPresentation = build(SCENARIOS[11]!.input);

    expect(agent.headline.text).toBe("Waiting for the agent to report");
    expect(agent.explanation).toBe(
      "Install the server agent to start sending reports.",
    );
    expect(agent.callToAction?.linkKey).toBe("documentation");

    const telemetry: MonitorOverviewPresentation = build(
      running(MonitorType.Traces, {
        monitoringInterval: "* * * * *",
        createdAt: secondsAgo(30),
        telemetry: {},
        latestEvaluationAt: undefined,
        currentStatus: undefined,
      }),
    );

    expect(telemetry.headline.text).toBe("Waiting for the first evaluation");
    expect(telemetry.explanation).toBe(
      "This monitor is evaluated every minute once saved.",
    );
    expect(telemetry.callToAction).toBeUndefined();
    expect(telemetry.lastKnownStatus).toBeUndefined();
  });

  it("overdue explanation uses compact durations and the interval phrase", () => {
    const probeCheck: MonitorOverviewPresentation = build(
      running(MonitorType.API, {
        probes: probes({ lastResultAt: secondsAgo(2 * 3600 + 5 * 60) }),
      }),
    );

    expect(probeCheck.explanation).toBe(
      "No result for 2h 5m, but this monitor checks every 5 minutes. A probe may be overloaded or offline.",
    );
    expect(probeCheck.callToAction).toEqual({
      text: "Check probes",
      linkKey: "probes",
    });
    // The pulse says how late: the age less one cadence.
    expect(probeCheck.pulse.overdueSeconds).toBe(2 * 3600);

    const telemetry: MonitorOverviewPresentation = build(SCENARIOS[15]!.input);

    expect(telemetry.explanation).toBe(
      "No evaluation for 1h, but this monitor is evaluated every minute.",
    );
    expect(telemetry.callToAction).toBeUndefined();
  });

  it("never-reported old monitor reads as overdue with the creation age", () => {
    const presentation: MonitorOverviewPresentation = build(
      running(MonitorType.API, {
        createdAt: secondsAgo(2 * DAY + 3 * 3600),
        statusSince: undefined,
        probes: probes(NO_RESULTS),
      }),
    );

    expect(presentation.runState).toBe(MonitorOverviewRunState.Overdue);
    expect(presentation.explanation).toBe(
      "No check result has arrived since this monitor was created 2d 3h ago.",
    );
    expect(presentation.tone).toBe("warning");
    expect(presentation.isNeverReported).toBe(true);
  });

  /*
   * Nothing was ever measured, so the stored status is only the default the
   * monitor was created with: it must not be the badge, and it has not
   * "held" for 30 days.
   */
  it("never-reported monitors lead with the missing results, not the default status", () => {
    const presentation: MonitorOverviewPresentation = build(
      running(MonitorType.API, {
        createdAt: secondsAgo(30 * DAY),
        probes: probes({ ...NO_RESULTS, nextCheckAt: undefined }),
      }),
    );

    expect(presentation.badge).toEqual({
      text: "No results yet",
      tone: "warning",
    });
    expect(presentation.headline).toEqual({
      text: "No check has completed yet",
    });
    expect(presentation.lastKnownStatus).toBe(
      "Last recorded status: Operational",
    );
    expect(presentation.secondaryBadges).toEqual([
      { text: "Checks overdue", tone: "warning" },
    ]);

    // Danger stays danger.
    expect(
      build(
        running(MonitorType.API, {
          currentStatus: OFFLINE,
          createdAt: secondsAgo(30 * DAY),
          probes: probes({ ...NO_RESULTS, nextCheckAt: undefined }),
        }),
      ).tone,
    ).toBe("danger");

    // Overdue with results keeps leading with the status it measured.
    const late: MonitorOverviewPresentation = build(
      running(MonitorType.API, {
        probes: probes({ lastResultAt: secondsAgo(2 * 3600) }),
      }),
    );

    expect(late.badge.text).toBe("Operational");
    expect(late.headline.since).toEqual(secondsAgo(3 * DAY + 4 * 3600));
    expect(late.lastKnownStatus).toBeUndefined();
    expect(late.isNeverReported).toBe(false);
  });
});

describe("MonitorOverviewPresentationUtil facts", () => {
  it("probe checks show the latest result, the probes and the owners", () => {
    const presentation: MonitorOverviewPresentation = build(
      running(MonitorType.API),
    );

    expect(factKeys(presentation)).toEqual([
      "latest-result",
      "probes",
      "owners",
    ]);
    expect(fact(presentation, "latest-result")).toEqual({
      key: "latest-result",
      label: "Latest result",
      value: "Up · 120 ms · HTTP 200",
      secondary: "from London",
      tone: "good",
    });
    expect(fact(presentation, "probes")).toEqual({
      key: "probes",
      label: "Probes",
      linkKey: "probes",
      value: "2 of 2 reporting",
      secondary: undefined,
      tone: "neutral",
    });
  });

  it("latest result per outcome and type", () => {
    const latest: (
      monitorType: MonitorType,
      result: Partial<NonNullable<MonitorOverviewProbeSummary["latestResult"]>>,
    ) => MonitorOverviewFact = (
      monitorType: MonitorType,
      result: Partial<NonNullable<MonitorOverviewProbeSummary["latestResult"]>>,
    ): MonitorOverviewFact => {
      return fact(
        build(
          running(monitorType, {
            probes: probes({
              latestResult: {
                probeId: "11111111-1111-4111-8111-111111111111",
                probeName: "London",
                monitoredAt: secondsAgo(60),
                ...result,
              },
            }),
          }),
        ),
        "latest-result",
      );
    };

    const down: MonitorOverviewFact = latest(MonitorType.Website, {
      isOnline: false,
      responseTimeInMs: 30000.4,
      responseCode: 503,
      failureCause: "Service Unavailable",
    });

    expect(down.value).toBe("Down · 30000 ms · HTTP 503");
    expect(down.secondary).toBe("Service Unavailable");
    expect(down.tone).toBe("danger");

    // Only HTTP checks quote a status code.
    expect(
      latest(MonitorType.Port, {
        isOnline: true,
        responseTimeInMs: 12,
        responseCode: 200,
      }).value,
    ).toBe("Up · 12 ms");

    expect(
      latest(MonitorType.SyntheticMonitor, {
        isOnline: true,
        responseTimeInMs: 4200,
      }).value,
    ).toBe("Passed · 4200 ms");
    expect(
      latest(MonitorType.CustomJavaScriptCode, { isOnline: false }).value,
    ).toBe("Failed");

    const reported: MonitorOverviewFact = latest(MonitorType.DNS, {});

    expect(reported.value).toBe("Reported");
    expect(reported.tone).toBe("neutral");
    expect(reported.secondary).toBe("from London");
  });

  it("latest result when there is none, and when probes are unknown", () => {
    expect(
      fact(
        build(running(MonitorType.API, { probes: probes(NO_RESULTS) })),
        "latest-result",
      ),
    ).toEqual({
      key: "latest-result",
      label: "Latest result",
      value: "—",
      secondary: "No results yet",
      isMuted: true,
    });
    expect(
      fact(build(running(MonitorType.API, { probes: null })), "latest-result"),
    ).toEqual({
      key: "latest-result",
      label: "Latest result",
      value: "Unavailable",
      isMuted: true,
    });
  });

  it("probes fact tones and secondary line", () => {
    const probesFact: (
      overrides: Partial<MonitorOverviewProbeSummary>,
    ) => MonitorOverviewFact = (
      overrides: Partial<MonitorOverviewProbeSummary>,
    ): MonitorOverviewFact => {
      return fact(
        build(running(MonitorType.API, { probes: probes(overrides) })),
        "probes",
      );
    };

    const partly: MonitorOverviewFact = probesFact({
      attachedCount: 5,
      enabledCount: 3,
      reportingCount: 2,
      disabledCount: 2,
      disconnectedCount: 1,
    });

    expect(partly.value).toBe("2 of 3 reporting");
    expect(partly.secondary).toBe("2 disabled · 1 disconnected");
    expect(partly.tone).toBe("warning");

    expect(
      probesFact({ reportingCount: 0, lastResultAt: secondsAgo(60) }).tone,
    ).toBe("danger");
    expect(probesFact({ disabledCount: 1, attachedCount: 3 }).secondary).toBe(
      "1 disabled",
    );
  });

  it("certificate and domain expiry tones at 31, 30, 8, 7, 0 and −1 days, and an invalid certificate", () => {
    const expiresIn: (seconds: number) => Date = (seconds: number): Date => {
      return new Date(NOW.getTime() + seconds * 1000);
    };

    const cases: Array<[number, string, string]> = [
      [31 * DAY, "in 31 days", "neutral"],
      [30 * DAY, "in 30 days", "warning"],
      [8 * DAY, "in 8 days", "warning"],
      [7 * DAY, "in 7 days", "danger"],
      [DAY, "in 1 day", "danger"],
      [3600, "Expires in 1 hour", "danger"],
      [-DAY, "Expired 1 day ago", "danger"],
      [-3 * DAY, "Expired 3 days ago", "danger"],
    ];

    for (const [seconds, value, tone] of cases) {
      const ssl: MonitorOverviewFact = fact(
        build(
          running(MonitorType.SSLCertificate, {
            probes: probes({
              latestResult: {
                probeId: "11111111-1111-4111-8111-111111111111",
                probeName: "London",
                monitoredAt: secondsAgo(60),
                isOnline: true,
                sslExpiresAt: expiresIn(seconds),
                isValidCertificate: true,
              },
            }),
          }),
        ),
        "certificate-expiry",
      );

      expect({ seconds: seconds, value: ssl.value, tone: ssl.tone }).toEqual({
        seconds: seconds,
        value: value,
        tone: tone,
      });
      expect(ssl.label).toBe("Certificate expires");
      expect(ssl.secondary).toBe(
        OneUptimeDate.getDateAsUserFriendlyLocalFormattedString(
          expiresIn(seconds),
          true,
        ),
      );

      const domain: MonitorOverviewFact = fact(
        build(
          running(MonitorType.Domain, {
            probes: probes({
              latestResult: {
                probeId: "11111111-1111-4111-8111-111111111111",
                probeName: "London",
                monitoredAt: secondsAgo(60),
                isOnline: true,
                domainExpiresAt: expiresIn(seconds),
              },
            }),
          }),
        ),
        "domain-expiry",
      );

      expect({
        seconds: seconds,
        value: domain.value,
        tone: domain.tone,
      }).toEqual({ seconds: seconds, value: value, tone: tone });
      expect(domain.label).toBe("Domain expires");
    }

    const invalid: MonitorOverviewFact =
      MonitorOverviewPresentationUtil.getExpiryFact({
        key: "certificate-expiry",
        expiresAt: expiresIn(200 * DAY),
        isValidCertificate: false,
        now: NOW,
      });

    expect(invalid.value).toBe("Not valid");
    expect(invalid.tone).toBe("danger");

    expect(
      MonitorOverviewPresentationUtil.getExpiryFact({
        key: "domain-expiry",
        expiresAt: undefined,
        now: NOW,
      }),
    ).toEqual({
      key: "domain-expiry",
      label: "Domain expires",
      value: "—",
      isMuted: true,
    });

    // Facts are ordered result, expiry, probes, owners.
    expect(factKeys(build(running(MonitorType.SSLCertificate)))).toEqual([
      "latest-result",
      "certificate-expiry",
      "probes",
      "owners",
    ]);
    expect(
      fact(
        build(running(MonitorType.Domain, { probes: null })),
        "domain-expiry",
      ).value,
    ).toBe("Unavailable");
  });

  it('heartbeat missing-window falls back to "Set in Criteria"', () => {
    const withWindow: MonitorOverviewPresentation = build(
      running(MonitorType.IncomingRequest, {
        monitorSteps: missingWindowSteps(CheckOn.IncomingRequest, 10),
      }),
    );

    expect(factKeys(withWindow)).toEqual([
      "missing-window",
      "heartbeat-check",
      "owners",
    ]);
    expect(fact(withWindow, "missing-window")).toEqual({
      key: "missing-window",
      label: "Missing-request window",
      value: "10 minutes",
      secondary: "From this monitor's criteria",
    });
    expect(fact(withWindow, "heartbeat-check")).toEqual({
      key: "heartbeat-check",
      label: "Last missing-request check",
      value: "",
      valueDate: secondsAgo(30),
    });

    const withoutWindow: MonitorOverviewPresentation = build(
      running(MonitorType.IncomingRequest),
    );

    expect(fact(withoutWindow, "missing-window")).toEqual({
      key: "missing-window",
      label: "Missing-request window",
      value: "Set in Criteria",
      linkKey: "criteria",
    });

    const email: MonitorOverviewPresentation = build(
      running(MonitorType.IncomingEmail, {
        monitorSteps: missingWindowSteps(CheckOn.EmailReceivedAt, 1),
        email: { lastReceivedAt: secondsAgo(60) },
      }),
    );

    expect(fact(email, "missing-window").label).toBe("Missing-email window");
    expect(fact(email, "missing-window").value).toBe("1 minute");
    expect(fact(email, "heartbeat-check")).toEqual({
      key: "heartbeat-check",
      label: "Last missing-email check",
      value: "Not run yet",
      isMuted: true,
    });
  });

  it("agent facts before and after the first report", () => {
    const before: MonitorOverviewPresentation = build(
      running(MonitorType.Server, { agent: {} }),
    );

    expect(factKeys(before)).toEqual(["host", "cpu", "memory", "owners"]);
    expect(fact(before, "host")).toEqual({
      key: "host",
      label: "Host",
      value: "Not reported yet",
      isMuted: true,
    });
    expect(fact(before, "cpu")).toEqual({
      key: "cpu",
      label: "CPU",
      value: "—",
      isMuted: true,
    });
    expect(fact(before, "memory").value).toBe("—");

    const after: MonitorOverviewPresentation = build(
      running(MonitorType.Server),
    );

    expect(fact(after, "host")).toEqual({
      key: "host",
      label: "Host",
      value: "web-01.example.com",
      isMono: true,
    });
    expect(fact(after, "cpu").value).toBe("42%");
    expect(fact(after, "memory").value).toBe("64%");
    expect(after.target).toEqual({
      value: "web-01.example.com",
      isMono: true,
      extraStepCount: 0,
    });
  });

  it("telemetry and infrastructure show the evaluation cadence and criteria", () => {
    for (const monitorType of [MonitorType.Logs, MonitorType.Kubernetes]) {
      const presentation: MonitorOverviewPresentation = build(
        running(monitorType, {
          monitoringInterval: "* * * * *",
          monitorSteps: stepsOf({}, {}),
        }),
      );

      expect(factKeys(presentation)).toEqual([
        "evaluates",
        "criteria",
        "owners",
      ]);
      expect(fact(presentation, "evaluates").value).toBe("Every minute");
      expect(fact(presentation, "criteria")).toEqual({
        key: "criteria",
        label: "Criteria",
        value: "2 steps",
        linkKey: "criteria",
      });
    }

    expect(fact(build(running(MonitorType.Metrics)), "criteria").value).toBe(
      "1 step",
    );
  });

  it("network device fact links the step's networkDeviceId, not autoProvisionedNetworkDeviceId", () => {
    const presentation: MonitorOverviewPresentation = build(
      running(MonitorType.NetworkDevice, {
        monitorSteps: stepsOf(
          {
            networkDeviceMonitor: { networkDeviceId: DEVICE_ID },
            autoProvisionedNetworkDeviceId: OTHER_DEVICE_ID,
          },
          { networkDeviceMonitor: { networkDeviceId: OTHER_DEVICE_ID } },
        ),
      }),
    );

    expect(factKeys(presentation)).toEqual(["device", "evaluated", "owners"]);
    expect(fact(presentation, "device")).toEqual({
      key: "device",
      label: "Device",
      value: "View device",
      linkKey: "networkDevice",
      linkId: DEVICE_ID,
    });
    expect(fact(presentation, "evaluated").value).toBe(
      "On every poll and matching trap",
    );
    expect(presentation.target).toBeNull();

    const unselected: MonitorOverviewPresentation = build(
      running(MonitorType.NetworkDevice, {
        monitorSteps: stepsOf({
          networkDeviceMonitor: {},
          autoProvisionedNetworkDeviceId: OTHER_DEVICE_ID,
        }),
      }),
    );

    expect(fact(unselected, "device")).toEqual({
      key: "device",
      label: "Device",
      value: "Not selected",
      isMuted: true,
    });
  });

  it("manual monitors have one fact about checks", () => {
    const presentation: MonitorOverviewPresentation = build(
      running(MonitorType.Manual),
    );

    expect(presentation.facts).toEqual([
      {
        key: "checks",
        label: "Checks",
        value: "None",
        secondary: "Status is set by hand or by incidents",
      },
      { key: "owners", label: "Owners", value: "" },
    ]);
  });
});

describe("MonitorOverviewPresentationUtil pulse", () => {
  it('pulse per family, including "Last checked: unavailable" when probes are unknown', () => {
    expect(build(running(MonitorType.API)).pulse).toEqual({
      label: "Last checked",
      at: secondsAgo(60),
      emptyText: "Not checked yet",
      cadenceText: "Every 5 minutes",
      nextAt: secondsAgo(-240),
      overdueSeconds: undefined,
      isUnavailable: false,
    });

    const unknown: MonitorOverviewPresentation = build(
      running(MonitorType.API, { probes: null }),
    );

    expect(unknown.pulse.label).toBe("Last checked");
    expect(unknown.pulse.isUnavailable).toBe(true);
    expect(unknown.pulse.at).toBeUndefined();

    expect(build(running(MonitorType.IncomingRequest)).pulse).toEqual({
      label: "Last request",
      at: secondsAgo(120),
      emptyText: "No request yet",
      isUnavailable: false,
    });
    expect(build(running(MonitorType.IncomingEmail)).pulse).toEqual({
      label: "Last email",
      at: secondsAgo(300),
      emptyText: "No email yet",
      isUnavailable: false,
    });
    expect(build(running(MonitorType.Server)).pulse).toEqual({
      label: "Last report",
      at: secondsAgo(45),
      emptyText: "No report yet",
      isUnavailable: false,
    });
    expect(
      build(running(MonitorType.Logs, { monitoringInterval: "* * * * *" }))
        .pulse,
    ).toEqual({
      label: "Last evaluated",
      at: secondsAgo(90),
      emptyText: "Not evaluated yet",
      cadenceText: "Every minute",
      nextAt: secondsAgo(-270),
      overdueSeconds: undefined,
      isUnavailable: false,
    });
    expect(build(running(MonitorType.NetworkDevice)).pulse).toEqual({
      label: "Last evaluated",
      at: secondsAgo(90),
      emptyText: "Not evaluated yet",
      isUnavailable: false,
    });
    expect(build(running(MonitorType.Manual)).pulse).toEqual({
      label: null,
      emptyText: "No automated checks",
      isUnavailable: false,
    });
  });

  it("a next check in the past is not promised, and overdue carries its lateness", () => {
    const overdue: MonitorOverviewPresentation = build(
      running(MonitorType.API, {
        probes: probes({
          lastResultAt: secondsAgo(1000),
          nextCheckAt: secondsAgo(700),
        }),
      }),
    );

    expect(overdue.pulse.nextAt).toBeUndefined();
    // The result came at 11:43:20, so the next was due at the 11:45 run.
    expect(overdue.pulse.overdueSeconds).toBe(900);
    expect(overdue.freshness).toBe(MonitorCheckFreshness.Stale);
  });

  it("a paused or unchecked monitor promises no cadence", () => {
    for (const scenario of [SCENARIOS[1]!, SCENARIOS[4]!, SCENARIOS[6]!]) {
      const presentation: MonitorOverviewPresentation = build(scenario.input);

      expect(presentation.pulse.cadenceText).toBeUndefined();
      expect(presentation.pulse.nextAt).toBeUndefined();
    }

    expect(build(SCENARIOS[1]!.input).freshness).toBe(
      MonitorCheckFreshness.NotScheduled,
    );
  });
});

describe("MonitorOverviewPresentationUtil sections", () => {
  it("probe checks: uptime, response time, summary and the probes card", () => {
    expect(build(running(MonitorType.API)).sections).toEqual({
      showUptime: true,
      setup: null,
      connection: null,
      summary: {
        isShown: true,
        description: "What each probe saw on its most recent check.",
      },
      sideCard: "probes",
      responseTimeMetric: MonitorMetricType.ResponseTime,
      telemetryPreview: null,
      stepCount: 1,
    });

    expect(
      build(running(MonitorType.SyntheticMonitor)).sections.responseTimeMetric,
    ).toBe(MonitorMetricType.ExecutionTime);
  });

  it("an awaiting probe check has no uptime and no response time yet", () => {
    const sections: MonitorOverviewPresentation["sections"] = build(
      SCENARIOS[8]!.input,
    ).sections;

    expect(sections.showUptime).toBe(false);
    expect(sections.responseTimeMetric).toBeNull();
    expect(sections.summary.isShown).toBe(true);
    expect(sections.sideCard).toBe("probes");
  });

  it("push types show setup while awaiting and the connection card after", () => {
    const awaiting: MonitorOverviewPresentation["sections"] = build(
      SCENARIOS[9]!.input,
    ).sections;

    expect(awaiting.setup).toBe(MonitorOverviewSetupKind.HeartbeatUrl);
    expect(awaiting.connection).toBeNull();
    expect(awaiting.sideCard).toBeNull();
    expect(awaiting.summary.isShown).toBe(false);

    const after: MonitorOverviewPresentation["sections"] = build(
      running(MonitorType.IncomingRequest),
    ).sections;

    expect(after.setup).toBeNull();
    expect(after.connection).toBe(MonitorOverviewSetupKind.HeartbeatUrl);
    expect(after.sideCard).toBe("connection");
    expect(after.summary).toEqual({
      isShown: true,
      description: "The most recent request and how the criteria judged it.",
    });

    expect(build(SCENARIOS[10]!.input).sections.setup).toBe(
      MonitorOverviewSetupKind.InboundEmail,
    );
    expect(build(SCENARIOS[11]!.input).sections.setup).toBe(
      MonitorOverviewSetupKind.ServerAgent,
    );
    expect(build(running(MonitorType.Server)).sections.connection).toBe(
      MonitorOverviewSetupKind.ServerAgent,
    );
  });

  it("previews need a step", () => {
    expect(build(running(MonitorType.Logs)).sections.telemetryPreview).toBe(
      "Logs",
    );
    expect(
      build(running(MonitorType.Logs, { monitorSteps: NO_STEPS })).sections
        .telemetryPreview,
    ).toBeNull();
    expect(
      build(running(MonitorType.Exceptions)).sections.telemetryPreview,
    ).toBeNull();
  });

  it("manual monitors have no summary and the manual guide", () => {
    const sections: MonitorOverviewPresentation["sections"] = build(
      running(MonitorType.Manual),
    ).sections;

    expect(sections.summary).toEqual({ isShown: false, description: "" });
    expect(sections.sideCard).toBe("manual");
    expect(sections.showUptime).toBe(true);
  });

  it("the target is the redacted first step", () => {
    expect(
      build(
        running(MonitorType.API, {
          monitorSteps: stepsOf(
            {
              requestType: "GET",
              monitorDestination: "https://ops:pw@api.example.com/health?k=1",
            },
            {},
          ),
        }),
      ).target,
    ).toEqual({
      value: "GET https://api.example.com/health",
      isMono: true,
      extraStepCount: 1,
    });
  });
});

/*
 * Probe rows as the server stores them, summarised the way the page does,
 * so these tests cover the whole path from MonitorProbe to the hero.
 */
const probeRow: (data: {
  probeId: string;
  name: string;
  resultAgeSeconds?: number;
  isOnline?: boolean;
  nextPingInSeconds?: number;
  connectionStatus?: ProbeConnectionStatus;
  isEnabled?: boolean;
}) => MonitorProbe = (data: {
  probeId: string;
  name: string;
  resultAgeSeconds?: number;
  isOnline?: boolean;
  nextPingInSeconds?: number;
  connectionStatus?: ProbeConnectionStatus;
  isEnabled?: boolean;
}): MonitorProbe => {
  const row: MonitorProbe = new MonitorProbe();
  const probe: Probe = new Probe();

  probe._id = data.probeId;
  probe.name = data.name;
  probe.connectionStatus =
    data.connectionStatus || ProbeConnectionStatus.Connected;

  row.probeId = new ObjectID(data.probeId);
  row.probe = probe;
  row.isEnabled = data.isEnabled ?? true;
  row.nextPingAt = secondsAgo(-(data.nextPingInSeconds ?? 60));

  if (data.resultAgeSeconds !== undefined) {
    row.lastPingAt = secondsAgo(data.resultAgeSeconds + 2);
    row.lastMonitoringLog = {
      [STEP_ID]: {
        monitoredAt: secondsAgo(data.resultAgeSeconds).toISOString(),
        isOnline: data.isOnline ?? true,
        responseTimeInMs: 120,
      },
    } as unknown as MonitorStepProbeResponse;
  }

  return row;
};

const summaryOf: (
  rows: Array<MonitorProbe>,
  isScheduled?: boolean,
) => MonitorOverviewProbeSummary = (
  rows: Array<MonitorProbe>,
  isScheduled?: boolean,
): MonitorOverviewProbeSummary => {
  const monitorSteps: MonitorSteps | undefined = running(
    MonitorType.API,
  ).monitorSteps;

  return MonitorOverviewProbeUtil.summarizeProbes({
    monitorProbes: rows,
    validStepIds: MonitorOverviewProbeUtil.getValidStepIds(monitorSteps),
    primaryStepId: MonitorOverviewProbeUtil.getPrimaryStepId(monitorSteps),
    cadenceSeconds: 300,
    now: NOW,
    monitoringInterval: "*/5 * * * *",
    isScheduled: isScheduled,
  });
};

const FRANKFURT: string = "11111111-1111-4111-8111-111111111111";
const VIRGINIA: string = "22222222-2222-4222-8222-222222222222";
const SINGAPORE: string = "33333333-3333-4333-8333-333333333333";

describe("MonitorOverviewPresentationUtil probes that stop checking", () => {
  /*
   * Only a probe's own claim moves its nextPingAt, so a probe that lost its
   * connection keeps a due time that sinks further into the past. The
   * monitor is still checked on time by the others.
   */
  it("one disconnected probe does not make a monitor others check on time overdue", () => {
    const presentation: MonitorOverviewPresentation = build(
      running(MonitorType.Website, {
        probes: summaryOf([
          probeRow({
            probeId: FRANKFURT,
            name: "Frankfurt",
            resultAgeSeconds: 60,
            nextPingInSeconds: 240,
          }),
          probeRow({
            probeId: VIRGINIA,
            name: "Virginia",
            resultAgeSeconds: 30,
            nextPingInSeconds: 270,
          }),
          probeRow({
            probeId: SINGAPORE,
            name: "Singapore",
            resultAgeSeconds: 3 * DAY,
            nextPingInSeconds: -3 * DAY,
            connectionStatus: ProbeConnectionStatus.Disconnected,
          }),
        ]),
      }),
    );

    expect(presentation.runState).toBe(MonitorOverviewRunState.Running);
    expect(presentation.freshness).toBe(MonitorCheckFreshness.Fresh);
    expect(presentation.secondaryBadges).toEqual([]);
    expect(presentation.pulse.nextAt).toEqual(secondsAgo(-240));
    expect(presentation.pulse.overdueSeconds).toBeUndefined();

    // The lost probe is still reported where probes are reported.
    expect(fact(presentation, "probes")).toMatchObject({
      value: "2 of 3 reporting",
      secondary: "1 disconnected",
      tone: "warning",
    });
  });

  it("one probe that stopped claiming does not either", () => {
    const presentation: MonitorOverviewPresentation = build(
      running(MonitorType.API, {
        probes: summaryOf([
          probeRow({
            probeId: FRANKFURT,
            name: "Frankfurt",
            resultAgeSeconds: 60,
            nextPingInSeconds: 240,
          }),
          probeRow({
            probeId: VIRGINIA,
            name: "Virginia",
            resultAgeSeconds: 2 * 3600,
            nextPingInSeconds: -2 * 3600,
          }),
        ]),
      }),
    );

    expect(presentation.runState).toBe(MonitorOverviewRunState.Running);
    expect(presentation.pulse.nextAt).toEqual(secondsAgo(-240));
  });

  it("is overdue when every probe that is checking is past due", () => {
    const presentation: MonitorOverviewPresentation = build(
      running(MonitorType.API, {
        probes: summaryOf([
          probeRow({
            probeId: FRANKFURT,
            name: "Frankfurt",
            resultAgeSeconds: 100,
            nextPingInSeconds: -1200,
          }),
          probeRow({
            probeId: VIRGINIA,
            name: "Virginia",
            resultAgeSeconds: 100,
            nextPingInSeconds: -1100,
          }),
        ]),
      }),
    );

    expect(presentation.runState).toBe(MonitorOverviewRunState.Overdue);
    // Past due since the later of the two.
    expect(presentation.pulse.overdueSeconds).toBe(1100);
  });
});

describe("MonitorOverviewPresentationUtil paused probes", () => {
  const MAINTENANCE: MonitorOverviewPresentationInput["pause"] = {
    isDisabled: false,
    byManualIncident: false,
    byScheduledMaintenance: true,
  };

  it("a paused monitor's probes are neither late nor a fault", () => {
    const summary: MonitorOverviewProbeSummary = summaryOf(
      [
        probeRow({
          probeId: FRANKFURT,
          name: "Frankfurt",
          resultAgeSeconds: 25 * 60,
        }),
        probeRow({
          probeId: VIRGINIA,
          name: "Virginia",
          resultAgeSeconds: 25 * 60,
          isOnline: false,
        }),
      ],
      false,
    );

    expect(
      summary.rows.map((row: MonitorOverviewProbeRow) => {
        return row.health;
      }),
    ).toEqual([MonitorOverviewProbeHealth.Down, MonitorOverviewProbeHealth.Up]);

    const presentation: MonitorOverviewPresentation = build(
      running(MonitorType.API, { pause: MAINTENANCE, probes: summary }),
    );

    expect(presentation.runState).toBe(MonitorOverviewRunState.Paused);
    expect(fact(presentation, "probes")).toEqual({
      key: "probes",
      label: "Probes",
      linkKey: "probes",
      value: "2 enabled",
      secondary: "Checks paused",
      tone: "neutral",
    });
  });

  it("keeps saying which probes are switched off or disconnected", () => {
    const presentation: MonitorOverviewPresentation = build(
      running(MonitorType.API, {
        pause: {
          isDisabled: true,
          byManualIncident: false,
          byScheduledMaintenance: false,
        },
        probes: probes({
          attachedCount: 4,
          enabledCount: 3,
          reportingCount: 0,
          disabledCount: 1,
          disconnectedCount: 1,
        }),
      }),
    );

    expect(fact(presentation, "probes")).toMatchObject({
      value: "3 enabled",
      secondary: "Checks paused · 1 disabled · 1 disconnected",
      tone: "neutral",
    });

    // No probe enabled is still a problem when monitoring resumes.
    expect(
      fact(
        build(
          running(MonitorType.API, {
            pause: MAINTENANCE,
            probes: probes({
              ...NO_RESULTS,
              enabledCount: 0,
              disabledCount: 2,
            }),
          }),
        ),
        "probes",
      ),
    ).toMatchObject({ value: "None enabled", tone: "danger" });
  });
});

describe("MonitorOverviewPresentationUtil probes that disagree", () => {
  it("down probes are never neutral in the probes fact", () => {
    const probesFact: (
      overrides: Partial<MonitorOverviewProbeSummary>,
      monitorType?: MonitorType,
    ) => MonitorOverviewFact = (
      overrides: Partial<MonitorOverviewProbeSummary>,
      monitorType?: MonitorType,
    ): MonitorOverviewFact => {
      return fact(
        build(
          running(monitorType || MonitorType.API, {
            probes: probes(overrides),
          }),
        ),
        "probes",
      );
    };

    expect(
      probesFact({
        attachedCount: 3,
        enabledCount: 3,
        reportingCount: 3,
        upCount: 1,
        downCount: 2,
      }),
    ).toMatchObject({
      value: "3 of 3 reporting",
      secondary: "2 down",
      tone: "warning",
    });

    // Every reporting probe sees it down.
    expect(
      probesFact({
        attachedCount: 3,
        enabledCount: 3,
        reportingCount: 2,
        upCount: 0,
        downCount: 2,
        disconnectedCount: 1,
      }),
    ).toMatchObject({
      secondary: "2 down · 1 disconnected",
      tone: "danger",
    });

    expect(
      probesFact(
        { reportingCount: 2, upCount: 1, downCount: 1 },
        MonitorType.SyntheticMonitor,
      ).secondary,
    ).toBe("1 failing");
  });

  it("the latest result says the probes disagree instead of quoting whichever reported last", () => {
    const latest: (
      monitorType: MonitorType,
      overrides: Partial<MonitorOverviewProbeSummary>,
    ) => MonitorOverviewFact = (
      monitorType: MonitorType,
      overrides: Partial<MonitorOverviewProbeSummary>,
    ): MonitorOverviewFact => {
      return fact(
        build(running(monitorType, { probes: probes(overrides) })),
        "latest-result",
      );
    };

    expect(
      latest(MonitorType.API, {
        attachedCount: 3,
        enabledCount: 3,
        reportingCount: 3,
        upCount: 1,
        downCount: 2,
      }),
    ).toEqual({
      key: "latest-result",
      label: "Latest result",
      value: "Mixed · 1 up, 2 down",
      tone: "warning",
    });
    expect(
      latest(MonitorType.SyntheticMonitor, { upCount: 1, downCount: 1 }).value,
    ).toBe("Mixed · 1 passed, 1 failed");

    // Agreement keeps the newest result.
    expect(latest(MonitorType.API, { upCount: 2, downCount: 0 }).value).toBe(
      "Up · 120 ms · HTTP 200",
    );
  });

  it("from real probe rows", () => {
    const presentation: MonitorOverviewPresentation = build(
      running(MonitorType.API, {
        probes: summaryOf([
          probeRow({
            probeId: FRANKFURT,
            name: "Frankfurt",
            resultAgeSeconds: 20,
          }),
          probeRow({
            probeId: VIRGINIA,
            name: "Virginia",
            resultAgeSeconds: 40,
            isOnline: false,
          }),
          probeRow({
            probeId: SINGAPORE,
            name: "Singapore",
            resultAgeSeconds: 50,
            isOnline: false,
          }),
        ]),
      }),
    );

    expect(fact(presentation, "latest-result").value).toBe(
      "Mixed · 1 up, 2 down",
    );
    expect(fact(presentation, "probes")).toMatchObject({
      value: "3 of 3 reporting",
      secondary: "2 down",
      tone: "warning",
    });
  });
});

/*
 * The worker stamps telemetryMonitorLastMonitorAt when it QUEUES an
 * evaluation. Only the evaluation log says one ran.
 */
describe("MonitorOverviewPresentationUtil telemetry evaluations", () => {
  it("a stuck evaluator is overdue even while the scheduler keeps stamping", () => {
    const presentation: MonitorOverviewPresentation = build(
      running(MonitorType.Logs, {
        monitoringInterval: "* * * * *",
        telemetry: {
          lastScheduledAt: secondsAgo(5),
          nextEvaluationAt: secondsAgo(-55),
        },
        latestEvaluationAt: secondsAgo(20 * 60),
        evaluationStatus: "loaded",
      }),
    );

    expect(presentation.runState).toBe(MonitorOverviewRunState.Overdue);
    expect(presentation.pulse).toMatchObject({
      label: "Last evaluated",
      at: secondsAgo(20 * 60),
    });
    expect(presentation.explanation).toBe(
      "No evaluation for 20m, but this monitor is evaluated every minute.",
    );
  });

  it("without the evaluation log, the scheduler's stamp is called what it is", () => {
    const statuses: Array<"loading" | "error" | "forbidden"> = [
      "loading",
      "error",
      "forbidden",
    ];

    for (const evaluationStatus of statuses) {
      const presentation: MonitorOverviewPresentation = build(
        running(MonitorType.Kubernetes, {
          telemetry: {
            lastScheduledAt: secondsAgo(30),
            nextEvaluationAt: secondsAgo(-270),
          },
          latestEvaluationAt: undefined,
          evaluationStatus: evaluationStatus,
        }),
      );

      expect({
        evaluationStatus: evaluationStatus,
        runState: presentation.runState,
        label: presentation.pulse.label,
        at: presentation.pulse.at,
      }).toEqual({
        evaluationStatus: evaluationStatus,
        runState: MonitorOverviewRunState.Running,
        label: "Last scheduled",
        at: secondsAgo(30),
      });
    }

    // The old name for the stamp is still read.
    expect(
      build(
        running(MonitorType.Logs, {
          telemetry: { lastEvaluatedAt: secondsAgo(40) },
          latestEvaluationAt: undefined,
          evaluationStatus: undefined,
        }),
      ).pulse,
    ).toMatchObject({ label: "Last scheduled", at: secondsAgo(40) });
  });

  /*
   * The log still holds every evaluation of a monitor younger than a day,
   * so its emptiness means none has completed: the worker's stamp, which it
   * writes when it only queues one, must not end the wait.
   */
  it("never evaluated: waiting while young, overdue after", () => {
    const young: MonitorOverviewPresentation = build(
      running(MonitorType.Metrics, {
        createdAt: secondsAgo(120),
        telemetry: {
          lastScheduledAt: secondsAgo(30),
          nextEvaluationAt: secondsAgo(-270),
        },
        latestEvaluationAt: undefined,
      }),
    );

    expect(young.runState).toBe(MonitorOverviewRunState.AwaitingFirstData);
    expect(young.pulse).toMatchObject({
      label: "Last evaluated",
      at: undefined,
      emptyText: "Not evaluated yet",
    });

    const stuck: MonitorOverviewPresentation = build(
      running(MonitorType.Metrics, {
        createdAt: secondsAgo(5 * 3600),
        latestEvaluationAt: undefined,
      }),
    );

    expect(stuck.runState).toBe(MonitorOverviewRunState.Overdue);
    expect(stuck.isNeverReported).toBe(true);
    expect(stuck.badge).toEqual({ text: "No results yet", tone: "warning" });
    expect(stuck.headline).toEqual({ text: "No evaluation has completed yet" });
    expect(stuck.explanation).toBe(
      "No evaluation has run since this monitor was created 5h ago.",
    );

    // The worker stamps every evaluation it queues, so none was ever queued.
    const neverQueued: MonitorOverviewPresentation = build(
      running(MonitorType.Metrics, {
        createdAt: secondsAgo(10 * DAY),
        telemetry: {},
        latestEvaluationAt: undefined,
      }),
    );

    expect(neverQueued.runState).toBe(MonitorOverviewRunState.Overdue);
    expect(neverQueued.isNeverReported).toBe(true);
    expect(neverQueued.explanation).toBe(
      "No evaluation has run since this monitor was created 10d ago.",
    );
  });
});

/*
 * MonitorLog keeps a row for a day (MonitorLogUtil.DEFAULT_RETENTION_DAYS)
 * and drops it with its daily partition, so a row is gone within about two
 * days. For a monitor older than that, an empty log is not "never
 * evaluated".
 */
describe("MonitorOverviewPresentationUtil evaluation log retention", () => {
  it("the log keeps rows for a day, and none for more than about two", () => {
    expect(MONITOR_LOG_MINIMUM_RETENTION_SECONDS).toBe(DAY);
    expect(MONITOR_LOG_RETENTION_HORIZON_SECONDS).toBe(2 * DAY);
  });

  it("an old monitor evaluated every minute with nothing in the log's last day is overdue, not 'never evaluated'", () => {
    const presentation: MonitorOverviewPresentation = build(
      running(MonitorType.Metrics, {
        monitoringInterval: "* * * * *",
        createdAt: secondsAgo(90 * DAY),
        // The worker keeps queueing; nothing completes.
        telemetry: {
          lastScheduledAt: secondsAgo(5),
          nextEvaluationAt: secondsAgo(-55),
        },
        latestEvaluationAt: undefined,
        evaluationStatus: "loaded",
      }),
    );

    expect(presentation.runState).toBe(MonitorOverviewRunState.Overdue);
    expect(presentation.isNeverReported).toBe(false);
    // What it last measured leads, as for any overdue monitor with results.
    expect(presentation.badge.text).toBe("Operational");
    expect(presentation.headline).toEqual({
      text: "Operational",
      since: secondsAgo(3 * DAY + 4 * 3600),
    });
    expect(presentation.secondaryBadges).toEqual([
      { text: "Checks overdue", tone: "warning" },
    ]);
    expect(presentation.tone).toBe("warning");
    expect(presentation.explanation).toBe(
      "No evaluation recorded in the last day, but this monitor is evaluated every minute.",
    );
    expect(presentation.lastKnownStatus).toBeUndefined();
    expect(MonitorOverviewPresentationUtil.getUptimeCaveat(presentation)).toBe(
      null,
    );
    expect(presentation.sections.showUptime).toBe(true);
    // How late is unknown: the log only says "not in the last day".
    expect(presentation.pulse).toEqual({
      label: "Last evaluated",
      at: undefined,
      emptyText: "Not evaluated in the last day",
      cadenceText: "Every minute",
      nextAt: secondsAgo(-55),
      overdueSeconds: undefined,
      isUnavailable: false,
    });
  });

  it("a weekly monitor between evaluations shows its last scheduled run, not an overdue or a wait", () => {
    const presentation: MonitorOverviewPresentation = build(
      running(MonitorType.Kubernetes, {
        // Fridays at noon; now is Monday noon.
        monitoringInterval: "0 12 * * 5",
        createdAt: secondsAgo(90 * DAY),
        telemetry: {
          lastScheduledAt: secondsAgo(3 * DAY),
          nextEvaluationAt: secondsAgo(-4 * DAY),
        },
        latestEvaluationAt: undefined,
        evaluationStatus: "loaded",
      }),
    );

    expect(presentation.runState).toBe(MonitorOverviewRunState.Running);
    expect(presentation.isNeverReported).toBe(false);
    expect(presentation.badge.text).toBe("Operational");
    expect(presentation.sections.showUptime).toBe(true);
    expect(presentation.pulse).toMatchObject({
      label: "Last scheduled",
      at: secondsAgo(3 * DAY),
      nextAt: secondsAgo(-4 * DAY),
    });
  });

  it("a weekly monitor a day or two old, whose first evaluation has left the log, is not still waiting", () => {
    // Saturdays at 13:00; created just before Saturday's run, 47 hours ago.
    const presentation: MonitorOverviewPresentation = build(
      running(MonitorType.Logs, {
        monitoringInterval: "0 13 * * 6",
        createdAt: secondsAgo(47 * 3600 + 300),
        telemetry: {
          lastScheduledAt: secondsAgo(47 * 3600),
          nextEvaluationAt: secondsAgo(-(5 * DAY + 3600)),
        },
        latestEvaluationAt: undefined,
        evaluationStatus: "loaded",
      }),
    );

    expect(presentation.runState).toBe(MonitorOverviewRunState.Running);
    expect(presentation.pulse).toMatchObject({
      label: "Last scheduled",
      at: secondsAgo(47 * 3600),
    });
  });

  it("a schedule with gaps is not overdue through the weekend, and is once Monday's runs are missing", () => {
    // Every 5 minutes, 09:00 to 17:55 UTC, Monday to Friday.
    const businessHours: (now: Date) => MonitorOverviewPresentation = (
      now: Date,
    ): MonitorOverviewPresentation => {
      return build(
        running(MonitorType.Logs, {
          now: now,
          monitoringInterval: "*/5 9-17 * * 1-5",
          createdAt: secondsAgo(90 * DAY),
          telemetry: {
            // Friday's last run; the worker queues nothing until Monday.
            lastScheduledAt: new Date("2026-09-18T17:55:00.000Z"),
            nextEvaluationAt: new Date("2026-09-21T09:00:00.000Z"),
          },
          latestEvaluationAt: undefined,
          evaluationStatus: "loaded",
        }),
      );
    };

    const mondayMorning: MonitorOverviewPresentation = businessHours(
      new Date("2026-09-21T08:00:00.000Z"),
    );

    expect(mondayMorning.runState).toBe(MonitorOverviewRunState.Running);
    expect(mondayMorning.pulse.label).toBe("Last scheduled");

    const mondayTen: MonitorOverviewPresentation = businessHours(
      new Date("2026-09-21T10:00:00.000Z"),
    );

    expect(mondayTen.runState).toBe(MonitorOverviewRunState.Overdue);
    expect(mondayTen.isNeverReported).toBe(false);
  });

  it("a monitor a day or two old with nothing in the log's last day is not called 'never evaluated'", () => {
    const presentation: MonitorOverviewPresentation = build(
      running(MonitorType.Metrics, {
        monitoringInterval: "* * * * *",
        createdAt: secondsAgo(36 * 3600),
        latestEvaluationAt: undefined,
      }),
    );

    expect(presentation.runState).toBe(MonitorOverviewRunState.Overdue);
    expect(presentation.isNeverReported).toBe(false);
    expect(presentation.explanation).toBe(
      "No evaluation recorded in the last day, but this monitor is evaluated every minute.",
    );
  });

  it("an impossible schedule is judged as the every-minute one it gets, without CronTab's search", () => {
    // The 30th of February: CronTab takes over a second to find no run.
    const search: MockInstance<typeof CronTab.getNextExecutionTimes> =
      jest.spyOn(CronTab, "getNextExecutionTimes");

    try {
      const probeCheck: MonitorOverviewPresentation = build(
        running(MonitorType.API, { monitoringInterval: "0 0 30 2 *" }),
      );
      const telemetry: MonitorOverviewPresentation = build(
        running(MonitorType.Logs, {
          monitoringInterval: "0 0 30 2 *",
          createdAt: secondsAgo(90 * DAY),
          latestEvaluationAt: undefined,
        }),
      );

      expect(probeCheck.runState).toBe(MonitorOverviewRunState.Running);
      expect(probeCheck.pulse.cadenceText).toBe("Every minute");
      // Nothing in the last day, on a schedule the scheduler runs every minute.
      expect(telemetry.runState).toBe(MonitorOverviewRunState.Overdue);
      expect(telemetry.explanation).toBe(
        "No evaluation recorded in the last day, but this monitor is evaluated every minute.",
      );
      expect(search).not.toHaveBeenCalled();
    } finally {
      search.mockRestore();
    }
  });

  it("paused, it names the last scheduled run instead of 'not evaluated yet'", () => {
    const presentation: MonitorOverviewPresentation = build(
      running(MonitorType.Logs, {
        createdAt: secondsAgo(90 * DAY),
        pause: {
          isDisabled: true,
          byManualIncident: false,
          byScheduledMaintenance: false,
        },
        telemetry: { lastScheduledAt: secondsAgo(5 * DAY) },
        latestEvaluationAt: undefined,
      }),
    );

    expect(presentation.runState).toBe(MonitorOverviewRunState.Paused);
    expect(presentation.pulse).toMatchObject({
      label: "Last scheduled",
      at: secondsAgo(5 * DAY),
    });
  });
});

describe("MonitorOverviewPresentationUtil network device evaluations", () => {
  const pulseFor: (
    overrides: Partial<MonitorOverviewPresentationInput>,
  ) => MonitorOverviewPresentation["pulse"] = (
    overrides: Partial<MonitorOverviewPresentationInput>,
  ): MonitorOverviewPresentation["pulse"] => {
    return build(running(MonitorType.NetworkDevice, overrides)).pulse;
  };

  it("an unreadable log is unavailable, never 'not evaluated yet'", () => {
    const statuses: Array<"error" | "forbidden"> = ["error", "forbidden"];

    for (const evaluationStatus of statuses) {
      expect(
        pulseFor({
          latestEvaluationAt: undefined,
          evaluationStatus: evaluationStatus,
        }),
      ).toEqual({
        label: "Last evaluated",
        at: undefined,
        emptyText: "Not evaluated yet",
        isUnavailable: true,
      });
    }
  });

  it("a log still loading says so", () => {
    expect(
      pulseFor({ latestEvaluationAt: undefined, evaluationStatus: "loading" }),
    ).toEqual({
      label: "Last evaluated",
      at: undefined,
      emptyText: "Loading…",
      isUnavailable: false,
    });
  });

  it("a loaded, empty log is waiting for the first poll, not a measured status", () => {
    const presentation: MonitorOverviewPresentation = build(
      running(MonitorType.NetworkDevice, {
        createdAt: secondsAgo(2 * 3600),
        latestEvaluationAt: undefined,
        evaluationStatus: "loaded",
      }),
    );

    expect(presentation.runState).toBe(
      MonitorOverviewRunState.AwaitingFirstData,
    );
    expect(presentation.badge).toEqual({
      text: "Waiting for data",
      tone: "info",
    });
    expect(presentation.headline.text).toBe("Waiting for the first poll");
    expect(presentation.lastKnownStatus).toBe(
      "Last recorded status: Operational",
    );
    expect(presentation.sections.showUptime).toBe(false);
    expect(presentation.pulse.isUnavailable).toBe(false);
  });

  /*
   * Its polling stopped (turned off, or its probe went offline) more than
   * a day ago, and the log's rows have expired since. It has been judged
   * for months: that history, and its status, stay.
   */
  it("an older device with nothing in the log's last day keeps its status and history", () => {
    const presentation: MonitorOverviewPresentation = build(
      running(MonitorType.NetworkDevice, {
        createdAt: secondsAgo(90 * DAY),
        currentStatus: OFFLINE,
        latestEvaluationAt: undefined,
        evaluationStatus: "loaded",
      }),
    );

    expect(presentation.runState).toBe(MonitorOverviewRunState.Running);
    expect(presentation.badge).toMatchObject({
      text: "Offline",
      tone: "danger",
    });
    expect(presentation.headline).toEqual({
      text: "Offline",
      since: secondsAgo(3 * DAY + 4 * 3600),
    });
    expect(presentation.explanation).toBe(
      "No poll or trap from this device has been evaluated in the last day, so the status shown is the last one recorded.",
    );
    expect(presentation.lastKnownStatus).toBeUndefined();
    expect(presentation.sections.showUptime).toBe(true);
    expect(presentation.pulse).toEqual({
      label: "Last evaluated",
      at: undefined,
      emptyText: "Not evaluated in the last day",
      isUnavailable: false,
    });

    // A device that is being evaluated needs no such note.
    expect(build(running(MonitorType.NetworkDevice)).explanation).toBe(
      undefined,
    );
  });

  it("a device just under a day old with an empty log is still waiting", () => {
    expect(
      build(
        running(MonitorType.NetworkDevice, {
          createdAt: secondsAgo(DAY - 60),
          latestEvaluationAt: undefined,
          evaluationStatus: "loaded",
        }),
      ).runState,
    ).toBe(MonitorOverviewRunState.AwaitingFirstData);
    expect(
      build(
        running(MonitorType.NetworkDevice, {
          createdAt: secondsAgo(DAY + 60),
          latestEvaluationAt: undefined,
          evaluationStatus: "loaded",
        }),
      ).runState,
    ).toBe(MonitorOverviewRunState.Running);
  });
});

/*
 * The heartbeat and agent checks judge a monitor that never reported as if
 * its last signal came at creation, so it can be Offline with an incident
 * open while the page still waits for the first signal.
 */
describe("MonitorOverviewPresentationUtil push monitors the server has judged", () => {
  it("a heartbeat judged offline leads with that verdict and keeps the setup", () => {
    const presentation: MonitorOverviewPresentation = build(
      running(MonitorType.IncomingRequest, {
        currentStatus: OFFLINE,
        createdAt: secondsAgo(3 * DAY),
        heartbeat: {},
      }),
    );

    expect(presentation.runState).toBe(
      MonitorOverviewRunState.AwaitingFirstData,
    );
    expect(presentation.tone).toBe("danger");
    expect(presentation.badge).toEqual({
      text: "Waiting for data",
      tone: "info",
    });
    expect(presentation.secondaryBadges).toEqual([
      { text: "Offline", tone: "danger" },
    ]);
    expect(presentation.headline).toEqual({
      text: "No heartbeat has arrived since this monitor was created 3d ago",
    });
    expect(presentation.explanation).toBe(
      "Send a GET or POST request to this monitor's heartbeat URL to start tracking it.",
    );
    expect(presentation.callToAction).toEqual({
      text: "Setup instructions",
      linkKey: "documentation",
    });
    expect(presentation.lastKnownStatus).toBeUndefined();
    expect(presentation.sections.showUptime).toBe(true);
    expect(presentation.sections.setup).toBe(
      MonitorOverviewSetupKind.HeartbeatUrl,
    );
  });

  it("an email or agent monitor judged degraded or offline leads with its tone", () => {
    const email: MonitorOverviewPresentation = build(
      running(MonitorType.IncomingEmail, {
        currentStatus: DEGRADED,
        createdAt: secondsAgo(2 * 3600),
        email: {},
      }),
    );

    expect(email.tone).toBe("warning");
    expect(email.secondaryBadges).toEqual([
      { text: "Degraded", tone: "warning" },
    ]);
    expect(email.headline.text).toBe(
      "No email has arrived since this monitor was created 2h ago",
    );

    const agent: MonitorOverviewPresentation = build(
      running(MonitorType.Server, {
        currentStatus: OFFLINE,
        createdAt: secondsAgo(DAY),
        agent: {},
      }),
    );

    expect(agent.headline.text).toBe(
      "The agent has not reported since this monitor was created 1d ago",
    );
    expect(agent.sections.showUptime).toBe(true);
    expect(agent.sections.setup).toBe(MonitorOverviewSetupKind.ServerAgent);
  });

  it("history shows once the missing-signal window since creation has passed", () => {
    const showsUptime: (
      overrides: Partial<MonitorOverviewPresentationInput>,
    ) => boolean = (
      overrides: Partial<MonitorOverviewPresentationInput>,
    ): boolean => {
      return build(
        running(MonitorType.IncomingEmail, { email: {}, ...overrides }),
      ).sections.showUptime;
    };

    const steps: MonitorSteps = missingWindowSteps(CheckOn.EmailReceivedAt, 30);

    expect(
      showsUptime({ monitorSteps: steps, createdAt: secondsAgo(31 * 60) }),
    ).toBe(true);
    expect(
      showsUptime({ monitorSteps: steps, createdAt: secondsAgo(29 * 60) }),
    ).toBe(false);
    // No missing-email criterion: nothing will judge it.
    expect(showsUptime({ createdAt: secondsAgo(DAY) })).toBe(false);

    // Operational means nothing has said otherwise: calm, not a verdict.
    const calm: MonitorOverviewPresentation = build(
      running(MonitorType.IncomingEmail, {
        email: {},
        monitorSteps: steps,
        createdAt: secondsAgo(31 * 60),
      }),
    );

    expect(calm.tone).toBe("info");
    expect(calm.secondaryBadges).toEqual([]);
    expect(calm.headline.text).toBe("Waiting for the first email");
  });

  it("an agent's window is three minutes, and only with an Is Online criterion", () => {
    const isOnlineSteps: MonitorSteps = stepsOf({
      monitorCriteria: {
        data: {
          monitorCriteriaInstanceArray: [
            {
              data: {
                filters: [
                  {
                    checkOn: CheckOn.IsOnline,
                    filterType: FilterType.False,
                  },
                ],
              },
            },
          ],
        },
      },
    });
    const showsUptime: (
      overrides: Partial<MonitorOverviewPresentationInput>,
    ) => boolean = (
      overrides: Partial<MonitorOverviewPresentationInput>,
    ): boolean => {
      return build(running(MonitorType.Server, { agent: {}, ...overrides }))
        .sections.showUptime;
    };

    expect(
      showsUptime({ monitorSteps: isOnlineSteps, createdAt: secondsAgo(200) }),
    ).toBe(true);
    expect(
      showsUptime({ monitorSteps: isOnlineSteps, createdAt: secondsAgo(170) }),
    ).toBe(false);
    expect(showsUptime({ createdAt: secondsAgo(DAY) })).toBe(false);
  });
});

describe("MonitorOverviewPresentationUtil.getUptimeCaveat", () => {
  const caveatOf: (input: MonitorOverviewPresentationInput) => string | null = (
    input: MonitorOverviewPresentationInput,
  ): string | null => {
    return MonitorOverviewPresentationUtil.getUptimeCaveat(build(input));
  };

  it("names the unmeasured time per run state", () => {
    const rows: Array<
      [string, MonitorOverviewPresentationInput, string | null]
    > = [
      ["running", running(MonitorType.API), null],
      ["disabled", SCENARIOS[1]!.input, "paused"],
      ["paused by an incident", SCENARIOS[2]!.input, "paused"],
      ["no probe enabled", SCENARIOS[4]!.input, "not-checking"],
      ["every probe disconnected", SCENARIOS[5]!.input, "not-checking"],
      ["no criteria", SCENARIOS[6]!.input, "not-checking"],
      [
        "overdue with results",
        running(MonitorType.API, {
          probes: probes({ lastResultAt: secondsAgo(2 * 3600) }),
        }),
        null,
      ],
      [
        "never reported",
        running(MonitorType.API, {
          createdAt: secondsAgo(2 * DAY),
          probes: probes({ ...NO_RESULTS, nextCheckAt: undefined }),
        }),
        "no-results",
      ],
      [
        "judged heartbeat",
        running(MonitorType.IncomingRequest, {
          currentStatus: OFFLINE,
          heartbeat: {},
        }),
        null,
      ],
      /*
       * Months of evaluations back these windows; the log just no longer
       * holds them.
       */
      [
        "telemetry with nothing in its evaluation log's last day",
        running(MonitorType.Metrics, {
          monitoringInterval: "* * * * *",
          createdAt: secondsAgo(90 * DAY),
          latestEvaluationAt: undefined,
        }),
        null,
      ],
    ];

    for (const [name, input, expected] of rows) {
      expect({ name: name, caveat: caveatOf(input) }).toEqual({
        name: name,
        caveat: expected,
      });
    }
  });

  it("a manual monitor has no checks to pause", () => {
    expect(
      caveatOf(
        running(MonitorType.Manual, {
          pause: {
            isDisabled: false,
            byManualIncident: true,
            byScheduledMaintenance: true,
          },
        }),
      ),
    ).toBeNull();
  });
});

describe("MonitorOverviewPresentationUtil expiry wording", () => {
  afterEach(() => {
    // setUserTimezone is process-wide static state; never leak it.
    OneUptimeDate.setUserTimezone(null);
  });

  const expiry: (seconds: number) => MonitorOverviewFact = (
    seconds: number,
  ): MonitorOverviewFact => {
    return MonitorOverviewPresentationUtil.getExpiryFact({
      key: "certificate-expiry",
      expiresAt: new Date(NOW.getTime() + seconds * 1000),
      isValidCertificate: true,
      now: NOW,
    });
  };

  it("hours within a day, either way", () => {
    OneUptimeDate.setUserTimezone(Timezone.UTC);

    const cases: Array<[number, string]> = [
      [20 * 3600, "Expires in 20 hours"],
      [3600, "Expires in 1 hour"],
      [20 * 60, "Expires in 20 minutes"],
      [5, "Expires in 1 minute"],
      [-5, "Expired 1 minute ago"],
      [-3600, "Expired 1 hour ago"],
      [-23 * 3600, "Expired 23 hours ago"],
    ];

    for (const [seconds, value] of cases) {
      expect({ seconds: seconds, fact: expiry(seconds) }).toMatchObject({
        seconds: seconds,
        fact: { value: value, tone: "danger" },
      });
    }
  });

  it("calendar days beyond that, in the zone the date is printed in", () => {
    OneUptimeDate.setUserTimezone(Timezone.UTC);

    // Noon on the 21st to midnight on the 23rd: two dates away.
    expect(expiry(36 * 3600)).toMatchObject({
      value: "in 2 days",
      tone: "danger",
    });
    // Midnight on the 19th, seen at noon on the 21st: two dates back.
    expect(expiry(-60 * 3600).value).toBe("Expired 2 days ago");
    // The tone still counts whole days left: 7 days and 20 hours is danger.
    expect(expiry(7 * DAY + 20 * 3600)).toMatchObject({
      value: "in 8 days",
      tone: "danger",
    });

    // 08:00 on the 21st to 20:00 on the 22nd in New York: one date away.
    OneUptimeDate.setUserTimezone(Timezone.AmericaNew_York);

    const newYork: MonitorOverviewFact = expiry(36 * 3600);

    expect(newYork.value).toBe("in 1 day");
    expect(newYork.secondary).toBe("Sep 22, 2026");
  });
});

/*
 * `now` is the page's single clock, corrected to the server's by the
 * caller. Nothing may read the machine clock behind its back, or a fast
 * browser clock would make every check look late.
 */
describe("MonitorOverviewPresentationUtil clock", () => {
  afterEach(() => {
    jest.useRealTimers();
  });

  it("reads no clock but input.now", () => {
    const inputs: Array<MonitorOverviewPresentationInput> = SCENARIOS.map(
      (scenario: Scenario) => {
        return scenario.input;
      },
    );
    const before: Array<MonitorOverviewPresentation> = inputs.map(
      (input: MonitorOverviewPresentationInput) => {
        return build(input);
      },
    );

    jest.useFakeTimers();
    // Seven minutes fast, and three days ahead besides.
    jest.setSystemTime(new Date(NOW.getTime() + (7 * 60 + 3 * DAY) * 1000));

    expect(
      inputs.map((input: MonitorOverviewPresentationInput) => {
        return build(input);
      }),
    ).toEqual(before);
  });
});
