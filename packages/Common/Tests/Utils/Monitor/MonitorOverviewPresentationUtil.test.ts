import OneUptimeDate from "../../../Types/Date";
import { JSONObject } from "../../../Types/JSON";
import { CheckOn, FilterType } from "../../../Types/Monitor/CriteriaFilter";
import MonitorMetricType from "../../../Types/Monitor/MonitorMetricType";
import MonitorSteps from "../../../Types/Monitor/MonitorSteps";
import MonitorType from "../../../Types/Monitor/MonitorType";
import { MonitorCheckFreshness } from "../../../Utils/Monitor/MonitorCheckScheduleUtil";
import MonitorOverviewFamilyUtil, {
  MonitorOverviewFamily,
  MonitorOverviewSetupKind,
} from "../../../Utils/Monitor/MonitorOverviewFamily";
import MonitorOverviewPresentationUtil, {
  MonitorOverviewFact,
  MonitorOverviewPresentation,
  MonitorOverviewPresentationInput,
  MonitorOverviewRunState,
  MonitorOverviewStatusRef,
} from "../../../Utils/Monitor/MonitorOverviewPresentationUtil";
import { MonitorOverviewProbeSummary } from "../../../Utils/Monitor/MonitorOverviewProbeUtil";
import { describe, expect, it } from "@jest/globals";

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
      lastEvaluatedAt: secondsAgo(30),
      nextEvaluationAt: secondsAgo(-270),
    },
    latestEvaluationAt: secondsAgo(90),
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
    input: running(MonitorType.Kubernetes, { telemetry: {} }),
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
    name: "metrics monitor with a stale evaluation",
    input: running(MonitorType.Metrics, {
      monitoringInterval: "* * * * *",
      telemetry: {
        lastEvaluatedAt: secondsAgo(3600),
        nextEvaluationAt: secondsAgo(3540),
      },
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
        "awaiting beats overdue",
        running(MonitorType.Logs, {
          createdAt: secondsAgo(10 * DAY),
          telemetry: { nextEvaluationAt: secondsAgo(DAY) },
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
        "a network device is never awaiting",
        running(MonitorType.NetworkDevice, {
          latestEvaluationAt: undefined,
          createdAt: secondsAgo(60),
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

  it("showUptime is false only while awaiting first data", () => {
    for (const scenario of SCENARIOS) {
      const presentation: MonitorOverviewPresentation = build(scenario.input);

      expect({
        name: scenario.name,
        showUptime: presentation.sections.showUptime,
      }).toEqual({
        name: scenario.name,
        showUptime:
          presentation.runState !== MonitorOverviewRunState.AwaitingFirstData,
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
        telemetry: {},
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
    expect(presentation.headline).toEqual({
      text: "Operational",
      since: undefined,
    });
    expect(presentation.tone).toBe("warning");
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
      [3600, "Expires today", "danger"],
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
      at: secondsAgo(30),
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
    expect(overdue.pulse.overdueSeconds).toBe(700);
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
