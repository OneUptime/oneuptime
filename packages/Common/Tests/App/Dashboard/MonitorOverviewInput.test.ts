/** @timezone UTC */

import { describe, expect, test } from "@jest/globals";
import {
  getCurrentStatusId,
  getCurrentStatusRef,
  getProbeLastResultAt,
  isMonitorScheduled,
  summarizeProbeSection,
  toPresentationInput,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Monitor/Overview/MonitorOverviewInput";
import { MonitorOverviewProbeData } from "../../../../App/FeatureSet/Dashboard/src/Components/Monitor/Overview/MonitorOverviewTypes";
import {
  OverviewSection,
  failSection,
  forbidSection,
  getLoadingSection,
  resolveSection,
} from "../../../../App/FeatureSet/Dashboard/src/Utils/OverviewSection";
import Monitor from "../../../Models/DatabaseModels/Monitor";
import MonitorProbe, {
  MonitorStepProbeResponse,
} from "../../../Models/DatabaseModels/MonitorProbe";
import MonitorStatus from "../../../Models/DatabaseModels/MonitorStatus";
import MonitorStatusTimeline from "../../../Models/DatabaseModels/MonitorStatusTimeline";
import Probe from "../../../Models/DatabaseModels/Probe";
import Color from "../../../Types/Color";
import Dictionary from "../../../Types/Dictionary";
import { JSONObject } from "../../../Types/JSON";
import IncomingMonitorRequest from "../../../Types/Monitor/IncomingMonitor/IncomingMonitorRequest";
import MonitorSteps from "../../../Types/Monitor/MonitorSteps";
import MonitorType from "../../../Types/Monitor/MonitorType";
import ServerMonitorResponse from "../../../Types/Monitor/ServerMonitor/ServerMonitorResponse";
import ObjectID from "../../../Types/ObjectID";
import MonitorOverviewPresentationUtil, {
  MonitorOverviewPresentation,
  MonitorOverviewPresentationInput,
  MonitorOverviewRunState,
} from "../../../Utils/Monitor/MonitorOverviewPresentationUtil";
import MonitorOverviewProbeUtil, {
  MonitorEvaluationByProbe,
  MonitorOverviewProbeHealth,
  MonitorOverviewProbeRow,
  MonitorOverviewProbeSummary,
} from "../../../Utils/Monitor/MonitorOverviewProbeUtil";

/*
 * toPresentationInput is the seam between what the overview's data hook
 * loaded and the pure presentation model. Its rules are "unknown is not
 * zero" and "a JSON column is never trusted": a forbidden probe read must
 * become null (so the hero cannot say "No probes are attached"), a status
 * duration may only come from a newest open row with the current status,
 * and dates in JSON columns arrive as strings.
 */

const NOW: Date = new Date("2026-09-21T12:00:00.000Z");
const MONITOR_ID: string = "9a1f0c2e-5b3d-4c7a-8e1f-2d3c4b5a6978";
const OPERATIONAL_ID: string = "1b2c3d4e-5f60-4718-8293-a4b5c6d7e8f9";
const OFFLINE_ID: string = "2c3d4e5f-6071-4829-93a4-b5c6d7e8f901";
const STEP_ID: string = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const DELETED_STEP_ID: string = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const PROBE_A: string = "11111111-1111-4111-8111-111111111111";
const PROBE_B: string = "22222222-2222-4222-8222-222222222222";

const minutesAgo: (minutes: number) => Date = (minutes: number): Date => {
  return new Date(NOW.getTime() - minutes * 60 * 1000);
};

const STEPS: MonitorSteps = {
  data: {
    monitorStepsInstanceArray: [{ data: { id: STEP_ID } }],
  },
} as unknown as MonitorSteps;

// Partial<T> under exactOptionalPropertyTypes forbids an explicit undefined.
type MonitorOverrides = {
  [K in keyof Monitor]?: Monitor[K] | undefined;
};

type BuildMonitorFunction = (overrides?: MonitorOverrides) => Monitor;

const buildMonitor: BuildMonitorFunction = (
  overrides?: MonitorOverrides,
): Monitor => {
  const status: MonitorStatus = new MonitorStatus();
  status._id = OPERATIONAL_ID;
  status.name = "Operational";
  status.color = new Color("#10b981");
  status.isOperationalState = true;
  status.isOfflineState = false;

  const monitor: Monitor = new Monitor();
  monitor._id = MONITOR_ID;
  monitor.monitorType = MonitorType.API;
  monitor.monitorSteps = STEPS;
  monitor.monitoringInterval = "* * * * *";
  monitor.createdAt = new Date("2026-01-01T00:00:00.000Z");
  monitor.currentMonitorStatusId = new ObjectID(OPERATIONAL_ID);
  monitor.currentMonitorStatus = status;
  Object.assign(monitor, overrides || {});
  return monitor;
};

type BuildStatusRowFunction = (data: {
  statusId: string;
  startsAt: Date;
  endsAt?: Date;
}) => MonitorStatusTimeline;

const buildStatusRow: BuildStatusRowFunction = (data: {
  statusId: string;
  startsAt: Date;
  endsAt?: Date;
}): MonitorStatusTimeline => {
  const row: MonitorStatusTimeline = new MonitorStatusTimeline();
  row._id = "3d4e5f60-7182-493a-a4b5-c6d7e8f90a1b";
  row.monitorStatusId = new ObjectID(data.statusId);
  row.startsAt = data.startsAt;

  if (data.endsAt) {
    row.endsAt = data.endsAt;
  }

  return row;
};

type BuildProbeRowFunction = (data: {
  probeId: string;
  isEnabled?: boolean;
  log?: Dictionary<JSONObject>;
}) => MonitorProbe;

const buildProbeRow: BuildProbeRowFunction = (data: {
  probeId: string;
  isEnabled?: boolean;
  log?: Dictionary<JSONObject>;
}): MonitorProbe => {
  const row: MonitorProbe = new MonitorProbe();
  row.probeId = new ObjectID(data.probeId);
  row.isEnabled = data.isEnabled !== false;

  const probe: Probe = new Probe();
  probe._id = data.probeId;
  probe.name = `Probe ${data.probeId.slice(0, 4)}`;
  row.probe = probe;

  if (data.log) {
    row.lastMonitoringLog = data.log as unknown as MonitorStepProbeResponse;
  }

  return row;
};

type ProbeSectionFunction = (
  rows: Array<MonitorProbe>,
) => OverviewSection<MonitorOverviewProbeData>;

const loadedProbes: ProbeSectionFunction = (
  rows: Array<MonitorProbe>,
): OverviewSection<MonitorOverviewProbeData> => {
  return resolveSection<MonitorOverviewProbeData>({
    value: {
      rows: rows,
      attached: MonitorOverviewProbeUtil.toAttachedProbes(rows),
      fullLoadedAt: NOW,
    },
    subjectId: MONITOR_ID,
  });
};

const emptyEvaluation: OverviewSection<MonitorEvaluationByProbe> =
  resolveSection<MonitorEvaluationByProbe>({
    value: { byProbeId: {} },
    subjectId: MONITOR_ID,
  });

type BuildInputFunction = (data?: {
  monitor?: Monitor;
  probes?: OverviewSection<MonitorOverviewProbeData>;
  statusRows?: OverviewSection<Array<MonitorStatusTimeline>>;
  evaluation?: OverviewSection<MonitorEvaluationByProbe>;
}) => MonitorOverviewPresentationInput;

const buildInput: BuildInputFunction = (data?: {
  monitor?: Monitor;
  probes?: OverviewSection<MonitorOverviewProbeData>;
  statusRows?: OverviewSection<Array<MonitorStatusTimeline>>;
  evaluation?: OverviewSection<MonitorEvaluationByProbe>;
}): MonitorOverviewPresentationInput => {
  return toPresentationInput({
    monitor: data?.monitor || buildMonitor(),
    probes: data?.probes || loadedProbes([]),
    statusRows:
      data?.statusRows ||
      resolveSection<Array<MonitorStatusTimeline>>({
        value: [],
        subjectId: MONITOR_ID,
      }),
    evaluation: data?.evaluation || emptyEvaluation,
    now: NOW,
  });
};

const reportingProbe: MonitorProbe = buildProbeRow({
  probeId: PROBE_A,
  log: {
    [STEP_ID]: {
      monitoredAt: minutesAgo(1).toISOString(),
      isOnline: true,
      responseTimeInMs: 120,
    },
  },
});

describe("toPresentationInput: probes", () => {
  test("forbidden probes become null, never an empty summary", () => {
    const input: MonitorOverviewPresentationInput = buildInput({
      probes: forbidSection<MonitorOverviewProbeData>({
        reason: "You need permission to read this monitor's probes.",
        subjectId: MONITOR_ID,
      }),
    });

    expect(input.probes).toBeNull();
  });

  test("a failed first probe read (no value kept) is null too", () => {
    const input: MonitorOverviewPresentationInput = buildInput({
      probes: failSection<MonitorOverviewProbeData>({
        previous: getLoadingSection<MonitorOverviewProbeData>(),
        message: "Network error.",
        subjectId: MONITOR_ID,
      }),
    });

    expect(input.probes).toBeNull();
  });

  test("a failed refresh keeps summarising the last probes that loaded", () => {
    const input: MonitorOverviewPresentationInput = buildInput({
      probes: failSection<MonitorOverviewProbeData>({
        previous: loadedProbes([reportingProbe]),
        message: "Network error.",
        subjectId: MONITOR_ID,
      }),
    });

    expect(input.probes).not.toBeNull();
    expect(input.probes!.enabledCount).toBe(1);
    expect(input.probes!.reportingCount).toBe(1);
  });

  test("loaded probes are summarised against the monitor's steps and cadence", () => {
    const input: MonitorOverviewPresentationInput = buildInput({
      probes: loadedProbes([
        reportingProbe,
        buildProbeRow({ probeId: PROBE_B, isEnabled: false }),
      ]),
    });

    expect(input.probes).not.toBeNull();
    expect(input.probes!.attachedCount).toBe(2);
    expect(input.probes!.enabledCount).toBe(1);
    expect(input.probes!.disabledCount).toBe(1);
    expect(input.probes!.lastResultAt).toEqual(minutesAgo(1));
    expect(input.probes!.responseTime?.medianMs).toBe(120);
  });

  test("an empty loaded probe list is a known zero, which is different from unknown", () => {
    const input: MonitorOverviewPresentationInput = buildInput({
      probes: loadedProbes([]),
    });

    expect(input.probes).not.toBeNull();
    expect(input.probes!.attachedCount).toBe(0);
  });

  test("a result for a deleted step does not count as the last check", () => {
    const input: MonitorOverviewPresentationInput = buildInput({
      probes: loadedProbes([
        buildProbeRow({
          probeId: PROBE_A,
          log: {
            [DELETED_STEP_ID]: {
              monitoredAt: minutesAgo(1).toISOString(),
              isOnline: true,
            },
          },
        }),
      ]),
    });

    expect(input.probes!.lastResultAt).toBeUndefined();
  });

  test("a paused monitor's probes keep their last verdict and are never late", () => {
    // Twenty-five minutes old on a one-minute monitor: late, if it were checking.
    const lastBeforePause: MonitorProbe = buildProbeRow({
      probeId: PROBE_A,
      log: {
        [STEP_ID]: {
          monitoredAt: minutesAgo(25).toISOString(),
          isOnline: false,
        },
      },
    });

    const healthOf: (monitor: Monitor) => MonitorOverviewProbeHealth = (
      monitor: Monitor,
    ): MonitorOverviewProbeHealth => {
      const summary: MonitorOverviewProbeSummary | null = summarizeProbeSection(
        {
          monitor: monitor,
          probes: loadedProbes([lastBeforePause]),
          now: NOW,
        },
      );

      return summary!.rows[0]!.health;
    };

    expect(healthOf(buildMonitor())).toBe(MonitorOverviewProbeHealth.Late);

    for (const pause of [
      { disableActiveMonitoring: true },
      { disableActiveMonitoringBecauseOfManualIncident: true },
      { disableActiveMonitoringBecauseOfScheduledMaintenanceEvent: true },
    ]) {
      expect({ pause, health: healthOf(buildMonitor(pause)) }).toEqual({
        pause,
        health: MonitorOverviewProbeHealth.Down,
      });
    }
  });

  test("isMonitorScheduled is false while any pause flag is set", () => {
    expect(isMonitorScheduled(buildMonitor())).toBe(true);
    expect(
      isMonitorScheduled(buildMonitor({ disableActiveMonitoring: false })),
    ).toBe(true);
    expect(
      isMonitorScheduled(
        buildMonitor({
          disableActiveMonitoringBecauseOfScheduledMaintenanceEvent: true,
        }),
      ),
    ).toBe(false);
  });

  test("a probe is not late through a gap in the schedule", () => {
    // Every five minutes from 09:00 to 17:55; the last check ran last night.
    const officeHours: Monitor = buildMonitor({
      monitoringInterval: "*/5 9-17 * * *",
    });
    const lastNight: MonitorProbe = buildProbeRow({
      probeId: PROBE_A,
      log: {
        [STEP_ID]: {
          monitoredAt: "2026-09-20T17:55:00.000Z",
          isOnline: true,
        },
      },
    });

    const rowAt: (now: Date) => MonitorOverviewProbeRow = (
      now: Date,
    ): MonitorOverviewProbeRow => {
      return summarizeProbeSection({
        monitor: officeHours,
        probes: loadedProbes([lastNight]),
        now: now,
      })!.rows[0]!;
    };

    // 08:30: the next run is 09:00, so nothing is due yet.
    expect(rowAt(new Date("2026-09-21T08:30:00.000Z")).health).toBe(
      MonitorOverviewProbeHealth.Up,
    );
    // 09:20: the 09:00 run is more than the grace overdue.
    expect(rowAt(new Date("2026-09-21T09:20:00.000Z")).health).toBe(
      MonitorOverviewProbeHealth.Late,
    );
  });

  test("summarizeProbeSection agrees with the input's probes", () => {
    const monitor: Monitor = buildMonitor();
    const probes: OverviewSection<MonitorOverviewProbeData> = loadedProbes([
      reportingProbe,
    ]);

    expect(
      summarizeProbeSection({ monitor: monitor, probes: probes, now: NOW }),
    ).toEqual(buildInput({ monitor: monitor, probes: probes }).probes);
    expect(
      summarizeProbeSection({
        monitor: monitor,
        probes: getLoadingSection<MonitorOverviewProbeData>(),
        now: NOW,
      }),
    ).toBeNull();
  });
});

describe("toPresentationInput: agent metrics", () => {
  test("server metrics are extracted from the agent's last report", () => {
    const input: MonitorOverviewPresentationInput = buildInput({
      monitor: buildMonitor({
        monitorType: MonitorType.Server,
        serverMonitorRequestReceivedAt: minutesAgo(2),
        serverMonitorResponse: {
          hostname: "  web-01.internal  ",
          basicInfrastructureMetrics: {
            cpuMetrics: { percentUsed: 41.6, cores: 4 },
            memoryMetrics: { percentUsed: 72.25 },
            diskMetrics: [],
          },
        } as unknown as ServerMonitorResponse,
      }),
    });

    expect(input.agent).toEqual({
      lastReportAt: minutesAgo(2),
      hostname: "web-01.internal",
      cpuPercent: 41.6,
      memoryPercent: 72.25,
    });
  });

  test("a malformed report gives unknowns, never NaN", () => {
    const input: MonitorOverviewPresentationInput = buildInput({
      monitor: buildMonitor({
        monitorType: MonitorType.Server,
        serverMonitorResponse: {
          hostname: 42,
          basicInfrastructureMetrics: {
            cpuMetrics: { percentUsed: "high" },
            memoryMetrics: { percentUsed: Number.NaN },
          },
        } as unknown as ServerMonitorResponse,
      }),
    });

    expect(input.agent.hostname).toBeUndefined();
    expect(input.agent.cpuPercent).toBeUndefined();
    expect(input.agent.memoryPercent).toBeUndefined();
    expect(input.agent.lastReportAt).toBeUndefined();
  });

  test("no report at all leaves every agent field unset", () => {
    expect(buildInput().agent).toEqual({
      lastReportAt: undefined,
      hostname: undefined,
      cpuPercent: undefined,
      memoryPercent: undefined,
    });
  });

  test("a report date stored as a string is parsed", () => {
    const input: MonitorOverviewPresentationInput = buildInput({
      monitor: buildMonitor({
        serverMonitorRequestReceivedAt: minutesAgo(
          3,
        ).toISOString() as unknown as Date,
      }),
    });

    expect(input.agent.lastReportAt).toEqual(minutesAgo(3));
  });
});

describe("toPresentationInput: how long the status has held", () => {
  test("since comes from a newest open row with the current status", () => {
    const input: MonitorOverviewPresentationInput = buildInput({
      statusRows: resolveSection<Array<MonitorStatusTimeline>>({
        value: [
          buildStatusRow({
            statusId: OPERATIONAL_ID,
            startsAt: minutesAgo(90),
          }),
          buildStatusRow({
            statusId: OFFLINE_ID,
            startsAt: minutesAgo(120),
            endsAt: minutesAgo(90),
          }),
        ],
        subjectId: MONITOR_ID,
      }),
    });

    expect(input.statusSince).toEqual(minutesAgo(90));
  });

  test("a newest row with another status (drift) gives no duration", () => {
    const input: MonitorOverviewPresentationInput = buildInput({
      statusRows: resolveSection<Array<MonitorStatusTimeline>>({
        value: [
          buildStatusRow({ statusId: OFFLINE_ID, startsAt: minutesAgo(5) }),
        ],
        subjectId: MONITOR_ID,
      }),
    });

    expect(input.statusSince).toBeUndefined();
  });

  test("a closed newest row gives no duration", () => {
    const input: MonitorOverviewPresentationInput = buildInput({
      statusRows: resolveSection<Array<MonitorStatusTimeline>>({
        value: [
          buildStatusRow({
            statusId: OPERATIONAL_ID,
            startsAt: minutesAgo(90),
            endsAt: minutesAgo(10),
          }),
        ],
        subjectId: MONITOR_ID,
      }),
    });

    expect(input.statusSince).toBeUndefined();
  });

  test("forbidden status rows give no duration, and the headline drops it", () => {
    const input: MonitorOverviewPresentationInput = buildInput({
      statusRows: forbidSection<Array<MonitorStatusTimeline>>({
        reason: "You need permission to read this monitor's status timeline.",
        subjectId: MONITOR_ID,
      }),
    });

    expect(input.statusSince).toBeUndefined();

    const presentation: MonitorOverviewPresentation =
      MonitorOverviewPresentationUtil.build(input);
    expect(presentation.headline.since).toBeUndefined();
  });

  test("the duration reaches the presentation's headline", () => {
    const presentation: MonitorOverviewPresentation =
      MonitorOverviewPresentationUtil.build(
        buildInput({
          probes: loadedProbes([reportingProbe]),
          statusRows: resolveSection<Array<MonitorStatusTimeline>>({
            value: [
              buildStatusRow({
                statusId: OPERATIONAL_ID,
                startsAt: minutesAgo(90),
              }),
            ],
            subjectId: MONITOR_ID,
          }),
        }),
      );

    expect(presentation.headline.text).toBe("Operational");
    expect(presentation.headline.since).toEqual(minutesAgo(90));
  });
});

describe("toPresentationInput: the rest of the row", () => {
  test("the current status is a normalised reference", () => {
    const input: MonitorOverviewPresentationInput = buildInput();

    expect(input.currentStatus).toEqual({
      id: OPERATIONAL_ID,
      name: "Operational",
      color: "#10b981",
      isOperationalState: true,
      isOfflineState: false,
    });
  });

  test("no status relation means no current status", () => {
    const input: MonitorOverviewPresentationInput = buildInput({
      monitor: buildMonitor({
        currentMonitorStatus: undefined,
        currentMonitorStatusId: undefined,
      }),
    });

    expect(input.currentStatus).toBeUndefined();
  });

  test("the status id column wins over the relation's _id", () => {
    const monitor: Monitor = buildMonitor();
    monitor.currentMonitorStatus!._id = OFFLINE_ID;

    expect(getCurrentStatusId(monitor)).toBe(OPERATIONAL_ID);
    expect(getCurrentStatusRef(monitor)?.id).toBe(OPERATIONAL_ID);

    // Without the id column, the relation's _id is the answer.
    const withoutIdColumn: Monitor = buildMonitor({
      currentMonitorStatusId: undefined,
    });
    withoutIdColumn.currentMonitorStatus!._id = OFFLINE_ID;
    expect(getCurrentStatusId(withoutIdColumn)).toBe(OFFLINE_ID);
  });

  test("an unusable status colour is dropped rather than passed to a style", () => {
    const monitor: Monitor = buildMonitor();
    (monitor.currentMonitorStatus as unknown as JSONObject)["color"] =
      "url(javascript:alert(1))";

    expect(getCurrentStatusRef(monitor)?.color).toBeUndefined();
  });

  test("pause and probe flags are booleans even when the columns are unset", () => {
    expect(buildInput().pause).toEqual({
      isDisabled: false,
      byManualIncident: false,
      byScheduledMaintenance: false,
    });
    expect(buildInput().probeFlags).toEqual({
      isNoProbeEnabled: false,
      isAllProbesDisconnected: false,
    });

    const input: MonitorOverviewPresentationInput = buildInput({
      monitor: buildMonitor({
        disableActiveMonitoring: true,
        disableActiveMonitoringBecauseOfManualIncident: true,
        disableActiveMonitoringBecauseOfScheduledMaintenanceEvent: true,
        isNoProbeEnabledOnThisMonitor: true,
        isAllProbesDisconnectedFromThisMonitor: true,
      }),
    });

    expect(input.pause).toEqual({
      isDisabled: true,
      byManualIncident: true,
      byScheduledMaintenance: true,
    });
    expect(input.probeFlags).toEqual({
      isNoProbeEnabled: true,
      isAllProbesDisconnected: true,
    });
  });

  test("heartbeat times and method come from the JSON column, even as strings", () => {
    const input: MonitorOverviewPresentationInput = buildInput({
      monitor: buildMonitor({
        monitorType: MonitorType.IncomingRequest,
        incomingMonitorRequest: {
          incomingRequestReceivedAt: minutesAgo(4).toISOString(),
          checkedAt: minutesAgo(4).toISOString(),
          requestMethod: "POST",
        } as unknown as IncomingMonitorRequest,
        incomingRequestMonitorHeartbeatCheckedAt: minutesAgo(1),
      }),
    });

    expect(input.heartbeat).toEqual({
      lastReceivedAt: minutesAgo(4),
      lastCheckedAt: minutesAgo(1),
      requestMethod: "POST",
    });
  });

  test("a typed date envelope in the JSON column is parsed too", () => {
    const input: MonitorOverviewPresentationInput = buildInput({
      monitor: buildMonitor({
        incomingMonitorRequest: {
          incomingRequestReceivedAt: {
            _type: "DateTime",
            value: minutesAgo(6).toISOString(),
          },
        } as unknown as IncomingMonitorRequest,
      }),
    });

    expect(input.heartbeat.lastReceivedAt).toEqual(minutesAgo(6));
  });

  test("email, telemetry and the evaluation time are read from their own columns", () => {
    const evaluation: OverviewSection<MonitorEvaluationByProbe> =
      resolveSection<MonitorEvaluationByProbe>({
        value: { byProbeId: {}, latestAt: minutesAgo(7) },
        subjectId: MONITOR_ID,
      });

    const input: MonitorOverviewPresentationInput = buildInput({
      monitor: buildMonitor({
        incomingEmailMonitorLastEmailReceivedAt: minutesAgo(8),
        incomingEmailMonitorHeartbeatCheckedAt: minutesAgo(3),
        telemetryMonitorLastMonitorAt: minutesAgo(1),
        telemetryMonitorNextMonitorAt: new Date(NOW.getTime() + 60 * 1000),
        minimumProbeAgreement: 2,
      }),
      evaluation: evaluation,
    });

    expect(input.email).toEqual({
      lastReceivedAt: minutesAgo(8),
      lastCheckedAt: minutesAgo(3),
    });
    /*
     * The worker's stamp is when an evaluation was queued, so it is passed
     * as "last scheduled"; only the log says one completed.
     */
    expect(input.telemetry).toEqual({
      lastScheduledAt: minutesAgo(1),
      nextEvaluationAt: new Date(NOW.getTime() + 60 * 1000),
    });
    expect(input.latestEvaluationAt).toEqual(minutesAgo(7));
    expect(input.evaluationStatus).toBe("loaded");
    expect(input.minimumProbeAgreement).toBe(2);
  });

  test("the evaluation log's status travels with its time", () => {
    const loading: OverviewSection<MonitorEvaluationByProbe> =
      getLoadingSection<MonitorEvaluationByProbe>();
    const failed: OverviewSection<MonitorEvaluationByProbe> =
      failSection<MonitorEvaluationByProbe>({
        previous: getLoadingSection<MonitorEvaluationByProbe>(),
        message: "Logs are unavailable.",
        subjectId: MONITOR_ID,
      });
    const forbidden: OverviewSection<MonitorEvaluationByProbe> =
      forbidSection<MonitorEvaluationByProbe>({
        reason: "You need permission to read this monitor's logs.",
        subjectId: MONITOR_ID,
      });

    expect(buildInput({ evaluation: loading }).evaluationStatus).toBe(
      "loading",
    );
    expect(buildInput({ evaluation: failed }).evaluationStatus).toBe("error");
    expect(buildInput({ evaluation: forbidden }).evaluationStatus).toBe(
      "forbidden",
    );
    // A loaded log with no rows is a known "none", not an unknown.
    expect(buildInput({ evaluation: emptyEvaluation }).evaluationStatus).toBe(
      "loaded",
    );

    // A failed refresh keeps the log that loaded, and so its status.
    const kept: MonitorOverviewPresentationInput = buildInput({
      evaluation: failSection<MonitorEvaluationByProbe>({
        previous: resolveSection<MonitorEvaluationByProbe>({
          value: { byProbeId: {}, latestAt: minutesAgo(2) },
          subjectId: MONITOR_ID,
        }),
        message: "Logs are unavailable.",
        subjectId: MONITOR_ID,
      }),
    });

    expect(kept.evaluationStatus).toBe("loaded");
    expect(kept.latestEvaluationAt).toEqual(minutesAgo(2));
  });

  test("a telemetry monitor whose loaded log has no evaluation is overdue, whatever the scheduler stamps", () => {
    // The worker keeps queueing evaluations, but none has ever completed.
    const stalled: Monitor = buildMonitor({
      monitorType: MonitorType.Logs,
      telemetryMonitorLastMonitorAt: minutesAgo(1),
      telemetryMonitorNextMonitorAt: new Date(NOW.getTime() + 60 * 1000),
    });

    const loaded: MonitorOverviewPresentation =
      MonitorOverviewPresentationUtil.build(
        buildInput({ monitor: stalled, evaluation: emptyEvaluation }),
      );

    expect(loaded.runState).toBe(MonitorOverviewRunState.Overdue);
    expect(loaded.isNeverReported).toBe(true);
    expect(loaded.pulse.label).toBe("Last evaluated");

    // A log that could not be read says nothing either way.
    const unreadable: MonitorOverviewPresentation =
      MonitorOverviewPresentationUtil.build(
        buildInput({
          monitor: stalled,
          evaluation: failSection<MonitorEvaluationByProbe>({
            previous: getLoadingSection<MonitorEvaluationByProbe>(),
            message: "Logs are unavailable.",
            subjectId: MONITOR_ID,
          }),
        }),
      );

    expect(unreadable.runState).toBe(MonitorOverviewRunState.Running);
    expect(unreadable.pulse.label).toBe("Last scheduled");
    expect(unreadable.pulse.at).toEqual(minutesAgo(1));
  });

  test("an unloaded evaluation has no time", () => {
    const input: MonitorOverviewPresentationInput = buildInput({
      evaluation: forbidSection<MonitorEvaluationByProbe>({
        reason: "You need permission to read this monitor's logs.",
        subjectId: MONITOR_ID,
      }),
    });

    expect(input.latestEvaluationAt).toBeUndefined();
  });

  test("type, steps, interval, creation time and now pass straight through", () => {
    const input: MonitorOverviewPresentationInput = buildInput();

    expect(input.monitorType).toBe(MonitorType.API);
    expect(input.monitorSteps).toBe(STEPS);
    expect(input.monitoringInterval).toBe("* * * * *");
    expect(input.createdAt).toEqual(new Date("2026-01-01T00:00:00.000Z"));
    expect(input.now).toBe(NOW);
  });
});

describe("getProbeLastResultAt", () => {
  test("is the newest result across enabled probes and current steps", () => {
    expect(
      getProbeLastResultAt({
        monitorSteps: STEPS,
        rows: [
          reportingProbe,
          buildProbeRow({
            probeId: PROBE_B,
            log: {
              [STEP_ID]: { monitoredAt: minutesAgo(10).toISOString() },
            },
          }),
        ],
      }),
    ).toEqual(minutesAgo(1));
  });

  test("ignores switched-off probes and results for deleted steps", () => {
    expect(
      getProbeLastResultAt({
        monitorSteps: STEPS,
        rows: [
          buildProbeRow({
            probeId: PROBE_A,
            isEnabled: false,
            log: { [STEP_ID]: { monitoredAt: minutesAgo(1).toISOString() } },
          }),
          buildProbeRow({
            probeId: PROBE_B,
            log: {
              [DELETED_STEP_ID]: {
                monitoredAt: minutesAgo(2).toISOString(),
              },
              [STEP_ID]: { monitoredAt: minutesAgo(30).toISOString() },
            },
          }),
        ],
      }),
    ).toEqual(minutesAgo(30));
  });

  test("is not clamped to now, so a skewed result stays a stable fingerprint", () => {
    const future: Date = new Date(NOW.getTime() + 30 * 1000);

    expect(
      getProbeLastResultAt({
        monitorSteps: STEPS,
        rows: [
          buildProbeRow({
            probeId: PROBE_A,
            log: { [STEP_ID]: { monitoredAt: future.toISOString() } },
          }),
        ],
      }),
    ).toEqual(future);
  });

  test("rows without results give undefined", () => {
    expect(
      getProbeLastResultAt({
        monitorSteps: STEPS,
        rows: [buildProbeRow({ probeId: PROBE_A })],
      }),
    ).toBeUndefined();
  });
});
