import MonitorLog from "../../../Models/AnalyticsModels/MonitorLog";
import MonitorProbe, {
  MonitorStepProbeResponse,
} from "../../../Models/DatabaseModels/MonitorProbe";
import Probe, {
  ProbeConnectionStatus,
} from "../../../Models/DatabaseModels/Probe";
import Dictionary from "../../../Types/Dictionary";
import FilterCondition from "../../../Types/Filter/FilterCondition";
import { JSONObject } from "../../../Types/JSON";
import MonitorEvaluationSummary from "../../../Types/Monitor/MonitorEvaluationSummary";
import MonitorSteps from "../../../Types/Monitor/MonitorSteps";
import MonitorType from "../../../Types/Monitor/MonitorType";
import ObjectID from "../../../Types/ObjectID";
import MonitorOverviewProbeUtil, {
  MonitorAttachedProbes,
  MonitorEvaluationByProbe,
  MonitorOverviewProbeHealth,
  MonitorOverviewProbeRow,
  MonitorOverviewProbeSummary,
} from "../../../Utils/Monitor/MonitorOverviewProbeUtil";
import { describe, expect, it } from "@jest/globals";

/*
 * The behaviour that used to live inline in the monitor overview page (and
 * was pinned there by source-text tests), plus the probe health the new
 * Probes card and hero read. The trap these guard against: lastPingAt is
 * when a probe CLAIMED a check, not when a result came back, so it must
 * never be shown as "last checked".
 */

const NOW: Date = new Date("2026-09-21T12:00:00.000Z");
const STEP_ID: string = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const SECOND_STEP_ID: string = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const DELETED_STEP_ID: string = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

const PROBE_A: string = "11111111-1111-4111-8111-111111111111";
const PROBE_B: string = "22222222-2222-4222-8222-222222222222";
const PROBE_C: string = "33333333-3333-4333-8333-333333333333";
const PROBE_D: string = "44444444-4444-4444-8444-444444444444";
const PROBE_E: string = "55555555-5555-4555-8555-555555555555";
const PROBE_F: string = "66666666-6666-4666-8666-666666666666";
const PROBE_G: string = "77777777-7777-4777-8777-777777777777";

const secondsAgo: (seconds: number) => Date = (seconds: number): Date => {
  return new Date(NOW.getTime() - seconds * 1000);
};

const STEPS: MonitorSteps = {
  data: {
    monitorStepsInstanceArray: [
      { data: { id: STEP_ID } },
      { data: { id: SECOND_STEP_ID } },
    ],
  },
} as unknown as MonitorSteps;

const response: (data: {
  monitoredAt?: Date | string;
  isOnline?: boolean;
  responseTimeInMs?: number;
  responseCode?: number;
  failureCause?: string;
  sslExpiresAt?: string;
  isValidCertificate?: boolean;
  domainExpiresAt?: string;
}) => JSONObject = (data: {
  monitoredAt?: Date | string;
  isOnline?: boolean;
  responseTimeInMs?: number;
  responseCode?: number;
  failureCause?: string;
  sslExpiresAt?: string;
  isValidCertificate?: boolean;
  domainExpiresAt?: string;
}): JSONObject => {
  const result: JSONObject = {};

  if (data.monitoredAt !== undefined) {
    result["monitoredAt"] =
      data.monitoredAt instanceof Date
        ? data.monitoredAt.toISOString()
        : data.monitoredAt;
  }

  if (data.isOnline !== undefined) {
    result["isOnline"] = data.isOnline;
  }

  if (data.responseTimeInMs !== undefined) {
    result["responseTimeInMs"] = data.responseTimeInMs;
  }

  if (data.responseCode !== undefined) {
    result["responseCode"] = data.responseCode;
  }

  if (data.failureCause !== undefined) {
    result["failureCause"] = data.failureCause;
  }

  if (
    data.sslExpiresAt !== undefined ||
    data.isValidCertificate !== undefined
  ) {
    result["sslResponse"] = {
      expiresAt: data.sslExpiresAt || null,
      isValidCertificate: data.isValidCertificate ?? null,
    };
  }

  if (data.domainExpiresAt !== undefined) {
    result["domainResponse"] = { expiresDate: data.domainExpiresAt };
  }

  return result;
};

const monitorProbe: (data: {
  probeId?: string | undefined;
  name?: string;
  withProbe?: boolean;
  relationId?: string;
  isEnabled?: boolean | undefined;
  connectionStatus?: ProbeConnectionStatus;
  lastPingAt?: Date;
  nextPingAt?: Date;
  log?: Dictionary<JSONObject>;
}) => MonitorProbe = (data: {
  probeId?: string | undefined;
  name?: string;
  withProbe?: boolean;
  relationId?: string;
  isEnabled?: boolean | undefined;
  connectionStatus?: ProbeConnectionStatus;
  lastPingAt?: Date;
  nextPingAt?: Date;
  log?: Dictionary<JSONObject>;
}): MonitorProbe => {
  const row: MonitorProbe = new MonitorProbe();

  if (data.probeId) {
    row.probeId = new ObjectID(data.probeId);
  }

  if (data.isEnabled !== undefined) {
    row.isEnabled = data.isEnabled;
  }

  if (data.withProbe !== false) {
    const probe: Probe = new Probe();
    const relationId: string | undefined = data.relationId || data.probeId;

    if (relationId) {
      probe._id = relationId;
    }

    probe.name = data.name || "Probe";

    if (data.connectionStatus) {
      probe.connectionStatus = data.connectionStatus;
    }

    row.probe = probe;
  }

  if (data.lastPingAt) {
    row.lastPingAt = data.lastPingAt;
  }

  if (data.nextPingAt) {
    row.nextPingAt = data.nextPingAt;
  }

  if (data.log) {
    row.lastMonitoringLog = data.log as unknown as MonitorStepProbeResponse;
  }

  return row;
};

const summarize: (
  rows: Array<MonitorProbe>,
  options?: {
    validStepIds?: Set<string> | null;
    primaryStepId?: string | null;
    monitoringInterval?: string;
    isScheduled?: boolean;
    now?: Date;
  },
) => MonitorOverviewProbeSummary = (
  rows: Array<MonitorProbe>,
  options?: {
    validStepIds?: Set<string> | null;
    primaryStepId?: string | null;
    monitoringInterval?: string;
    isScheduled?: boolean;
    now?: Date;
  },
): MonitorOverviewProbeSummary => {
  return MonitorOverviewProbeUtil.summarizeProbes({
    monitorProbes: rows,
    validStepIds:
      options?.validStepIds === undefined
        ? MonitorOverviewProbeUtil.getValidStepIds(STEPS)
        : options.validStepIds,
    primaryStepId:
      options?.primaryStepId === undefined
        ? MonitorOverviewProbeUtil.getPrimaryStepId(STEPS)
        : options.primaryStepId,
    // Every 5 minutes: late after 300 + 600 seconds.
    cadenceSeconds: 300,
    now: options?.now || NOW,
    monitoringInterval: options?.monitoringInterval,
    isScheduled: options?.isScheduled,
  });
};

// A connected probe that reported `ageSeconds` ago and will claim again.
const reportingRow: (data: {
  probeId: string;
  name?: string;
  ageSeconds: number;
  isOnline?: boolean;
  responseTimeInMs?: number;
  nextPingInSeconds?: number;
  connectionStatus?: ProbeConnectionStatus;
}) => MonitorProbe = (data: {
  probeId: string;
  name?: string;
  ageSeconds: number;
  isOnline?: boolean;
  responseTimeInMs?: number;
  nextPingInSeconds?: number;
  connectionStatus?: ProbeConnectionStatus;
}): MonitorProbe => {
  return monitorProbe({
    probeId: data.probeId,
    name: data.name || "Probe",
    isEnabled: true,
    connectionStatus: data.connectionStatus || ProbeConnectionStatus.Connected,
    lastPingAt: secondsAgo(data.ageSeconds + 2),
    nextPingAt: secondsAgo(-(data.nextPingInSeconds ?? 30)),
    log: {
      [STEP_ID]: response({
        monitoredAt: secondsAgo(data.ageSeconds),
        isOnline: data.isOnline ?? true,
        ...(data.responseTimeInMs === undefined
          ? {}
          : { responseTimeInMs: data.responseTimeInMs }),
      }),
    },
  });
};

const healthOf: (
  summary: MonitorOverviewProbeSummary,
  probeId: string,
) => MonitorOverviewProbeHealth | undefined = (
  summary: MonitorOverviewProbeSummary,
  probeId: string,
): MonitorOverviewProbeHealth | undefined => {
  return summary.rows.find((row: MonitorOverviewProbeRow) => {
    return row.probeId === probeId;
  })?.health;
};

describe("MonitorOverviewProbeUtil.toAttachedProbes", () => {
  it("toAttachedProbes keeps only rows with probeId and a probe relation", () => {
    const attached: MonitorAttachedProbes =
      MonitorOverviewProbeUtil.toAttachedProbes([
        monitorProbe({ probeId: PROBE_A, name: "London" }),
        monitorProbe({ probeId: undefined, name: "No id" }),
        monitorProbe({ probeId: PROBE_B, withProbe: false }),
        monitorProbe({ probeId: PROBE_C, name: "Frankfurt" }),
      ]);

    expect(
      attached.probes.map((probe: Probe) => {
        return probe.name;
      }),
    ).toEqual(["London", "Frankfurt"]);
  });

  it("the picker id is the join row's probeId, not the relation _id", () => {
    const attached: MonitorAttachedProbes =
      MonitorOverviewProbeUtil.toAttachedProbes([
        monitorProbe({
          probeId: PROBE_A,
          relationId: PROBE_G,
          name: "London",
        }),
      ]);

    expect(attached.probes[0]!._id).toBe(PROBE_A);
  });

  it("disabled ids come from isEnabled === false", () => {
    const attached: MonitorAttachedProbes =
      MonitorOverviewProbeUtil.toAttachedProbes([
        monitorProbe({ probeId: PROBE_A, isEnabled: true }),
        monitorProbe({ probeId: PROBE_B, isEnabled: false }),
        // Not selected (undefined) is not the same as switched off.
        monitorProbe({ probeId: PROBE_C, isEnabled: undefined }),
      ]);

    expect(attached.disabledProbeIds).toEqual([PROBE_B]);
    expect(attached.probes).toHaveLength(3);
  });

  it("responses come only from rows that have a lastMonitoringLog", () => {
    const logA: Dictionary<JSONObject> = {
      [STEP_ID]: response({ monitoredAt: secondsAgo(30), isOnline: true }),
    };
    const logC: Dictionary<JSONObject> = {
      [STEP_ID]: response({ monitoredAt: secondsAgo(60), isOnline: false }),
    };

    const attached: MonitorAttachedProbes =
      MonitorOverviewProbeUtil.toAttachedProbes([
        monitorProbe({ probeId: PROBE_A, log: logA }),
        monitorProbe({ probeId: PROBE_B }),
        monitorProbe({ probeId: PROBE_C, log: logC }),
      ]);

    expect(attached.probeResponses).toEqual([logA, logC]);
  });

  it("an empty list gives empty results", () => {
    expect(MonitorOverviewProbeUtil.toAttachedProbes([])).toEqual({
      probes: [],
      disabledProbeIds: [],
      probeResponses: [],
    });
  });
});

describe("MonitorOverviewProbeUtil.mergeProbeRows", () => {
  it("mergeProbeRows keeps light fields and the full row's lastMonitoringLog", () => {
    const fullLog: Dictionary<JSONObject> = {
      [STEP_ID]: response({ monitoredAt: secondsAgo(400), isOnline: true }),
    };
    const full: Array<MonitorProbe> = [
      monitorProbe({
        probeId: PROBE_A,
        isEnabled: true,
        lastPingAt: secondsAgo(400),
        log: fullLog,
      }),
    ];
    const light: Array<MonitorProbe> = [
      monitorProbe({
        probeId: PROBE_A,
        isEnabled: false,
        lastPingAt: secondsAgo(10),
        nextPingAt: secondsAgo(-290),
      }),
      monitorProbe({ probeId: PROBE_B, isEnabled: true }),
    ];

    const merged: Array<MonitorProbe> = MonitorOverviewProbeUtil.mergeProbeRows(
      { lightRows: light, fullRows: full },
    );

    expect(merged).toHaveLength(2);
    expect(merged[0]!.isEnabled).toBe(false);
    expect(merged[0]!.lastPingAt?.toISOString()).toBe(
      secondsAgo(10).toISOString(),
    );
    expect(merged[0]!.nextPingAt?.toISOString()).toBe(
      secondsAgo(-290).toISOString(),
    );
    expect(merged[0]!.lastMonitoringLog).toBe(fullLog);
    expect(merged[0]).toBeInstanceOf(MonitorProbe);
    // A probe the full read has not seen yet has no results to borrow.
    expect(merged[1]!.lastMonitoringLog).toBeUndefined();
  });

  it("does not mutate the light rows", () => {
    const light: MonitorProbe = monitorProbe({ probeId: PROBE_A });
    const full: MonitorProbe = monitorProbe({
      probeId: PROBE_A,
      log: { [STEP_ID]: response({ monitoredAt: secondsAgo(5) }) },
    });

    const merged: Array<MonitorProbe> = MonitorOverviewProbeUtil.mergeProbeRows(
      { lightRows: [light], fullRows: [full] },
    );

    expect(merged[0]).not.toBe(light);
    expect(light.lastMonitoringLog).toBeUndefined();
  });
});

describe("MonitorOverviewProbeUtil.hasPendingProbeResults", () => {
  const fullRow: (probeId: string, monitoredAt: Date | null) => MonitorProbe = (
    probeId: string,
    monitoredAt: Date | null,
  ): MonitorProbe => {
    return monitorProbe({
      probeId: probeId,
      isEnabled: true,
      ...(monitoredAt
        ? {
            log: {
              [STEP_ID]: response({ monitoredAt: monitoredAt, isOnline: true }),
            },
          }
        : {}),
    });
  };

  it("true when a claim is newer than the newest result", () => {
    expect(
      MonitorOverviewProbeUtil.hasPendingProbeResults({
        lightRows: [
          monitorProbe({
            probeId: PROBE_A,
            isEnabled: true,
            lastPingAt: secondsAgo(20),
          }),
        ],
        fullRows: [fullRow(PROBE_A, secondsAgo(320))],
      }),
    ).toBe(true);
  });

  it("true when an enabled probe has a claim but no result", () => {
    expect(
      MonitorOverviewProbeUtil.hasPendingProbeResults({
        lightRows: [
          monitorProbe({
            probeId: PROBE_A,
            isEnabled: true,
            lastPingAt: secondsAgo(20),
          }),
        ],
        fullRows: [fullRow(PROBE_A, null)],
      }),
    ).toBe(true);
  });

  it("true when the probe set changes", () => {
    expect(
      MonitorOverviewProbeUtil.hasPendingProbeResults({
        lightRows: [
          monitorProbe({ probeId: PROBE_A, isEnabled: true }),
          monitorProbe({ probeId: PROBE_B, isEnabled: true }),
        ],
        fullRows: [fullRow(PROBE_A, secondsAgo(10))],
      }),
    ).toBe(true);
  });

  it("true when an enabled flag changes", () => {
    expect(
      MonitorOverviewProbeUtil.hasPendingProbeResults({
        lightRows: [monitorProbe({ probeId: PROBE_A, isEnabled: false })],
        fullRows: [fullRow(PROBE_A, secondsAgo(10))],
      }),
    ).toBe(true);
  });

  it("false when every claim already has its result", () => {
    expect(
      MonitorOverviewProbeUtil.hasPendingProbeResults({
        lightRows: [
          monitorProbe({
            probeId: PROBE_A,
            isEnabled: true,
            lastPingAt: secondsAgo(30),
          }),
          monitorProbe({ probeId: PROBE_B, isEnabled: true }),
        ],
        fullRows: [
          fullRow(PROBE_B, secondsAgo(500)),
          fullRow(PROBE_A, secondsAgo(25)),
        ],
      }),
    ).toBe(false);
  });

  it("false for a newer claim on a probe that is switched off", () => {
    const off: MonitorProbe = monitorProbe({
      probeId: PROBE_A,
      isEnabled: false,
      lastPingAt: secondsAgo(5),
    });
    const offFull: MonitorProbe = monitorProbe({
      probeId: PROBE_A,
      isEnabled: false,
    });

    expect(
      MonitorOverviewProbeUtil.hasPendingProbeResults({
        lightRows: [off],
        fullRows: [offFull],
      }),
    ).toBe(false);
  });

  it("false for empty light rows", () => {
    expect(
      MonitorOverviewProbeUtil.hasPendingProbeResults({
        lightRows: [],
        fullRows: [fullRow(PROBE_A, secondsAgo(10))],
      }),
    ).toBe(false);
  });

  /*
   * A probe that never answers must not make every poll re-read every
   * probe's full results for as long as the page is open.
   */
  it("false for a disconnected probe that never reported, poll after poll", () => {
    const lost: MonitorProbe = monitorProbe({
      probeId: PROBE_A,
      isEnabled: true,
      connectionStatus: ProbeConnectionStatus.Disconnected,
      // Stamped when the row was created, three days ago.
      lastPingAt: secondsAgo(3 * 86400),
    });

    expect(
      MonitorOverviewProbeUtil.hasPendingProbeResults({
        lightRows: [lost],
        fullRows: [lost],
        now: NOW,
        cadenceSeconds: 300,
        fullLoadedAt: secondsAgo(60),
      }),
    ).toBe(false);

    // Disconnected is enough on its own, whatever else the caller passes.
    expect(
      MonitorOverviewProbeUtil.hasPendingProbeResults({
        lightRows: [lost],
        fullRows: [lost],
      }),
    ).toBe(false);
  });

  it("a claim with no result is pending only while a result could still come", () => {
    const claimed: (claimAgeSeconds: number) => boolean = (
      claimAgeSeconds: number,
    ): boolean => {
      return MonitorOverviewProbeUtil.hasPendingProbeResults({
        lightRows: [
          monitorProbe({
            probeId: PROBE_A,
            isEnabled: true,
            connectionStatus: ProbeConnectionStatus.Connected,
            lastPingAt: secondsAgo(claimAgeSeconds),
          }),
        ],
        fullRows: [fullRow(PROBE_A, null)],
        now: NOW,
        // Every 5 minutes: a result is still expected for 300 + 600 s.
        cadenceSeconds: 300,
      });
    };

    expect(claimed(20)).toBe(true);
    expect(claimed(900)).toBe(true);
    expect(claimed(901)).toBe(false);
    // The creation stamp of a probe that never reported.
    expect(claimed(2 * 86400)).toBe(false);
  });

  it("a claim the last full read was taken after has already been read", () => {
    const pending: (fullLoadedAt: Date | null) => boolean = (
      fullLoadedAt: Date | null,
    ): boolean => {
      return MonitorOverviewProbeUtil.hasPendingProbeResults({
        lightRows: [
          monitorProbe({
            probeId: PROBE_A,
            isEnabled: true,
            lastPingAt: secondsAgo(40),
          }),
        ],
        fullRows: [fullRow(PROBE_A, secondsAgo(320))],
        now: NOW,
        cadenceSeconds: 300,
        fullLoadedAt: fullLoadedAt,
      });
    };

    // Read 10 s after the claim: whatever the claim produced is in it.
    expect(pending(secondsAgo(30))).toBe(false);
    // Read before the claim: its result is news.
    expect(pending(secondsAgo(60))).toBe(true);
    // Never read in full.
    expect(pending(null)).toBe(true);
  });
});

describe("MonitorOverviewProbeUtil step ids", () => {
  it("valid and primary step ids come from the monitor's steps", () => {
    expect(
      Array.from(MonitorOverviewProbeUtil.getValidStepIds(STEPS)!).sort(),
    ).toEqual([STEP_ID, SECOND_STEP_ID].sort());
    expect(MonitorOverviewProbeUtil.getPrimaryStepId(STEPS)).toBe(STEP_ID);
  });

  it("unknown steps mean no filtering and no primary step", () => {
    expect(MonitorOverviewProbeUtil.getValidStepIds(undefined)).toBeNull();
    expect(MonitorOverviewProbeUtil.getPrimaryStepId(undefined)).toBeNull();
    expect(
      MonitorOverviewProbeUtil.getPrimaryStepId({
        data: { monitorStepsInstanceArray: [] },
      } as unknown as MonitorSteps),
    ).toBeNull();
  });
});

describe("MonitorOverviewProbeUtil.summarizeProbes", () => {
  it("summarizeProbes uses monitoredAt, not lastPingAt, for lastResultAt", () => {
    const summary: MonitorOverviewProbeSummary = summarize([
      monitorProbe({
        probeId: PROBE_A,
        isEnabled: true,
        // Claimed a check seconds ago; the result it has is 4 minutes old.
        lastPingAt: secondsAgo(5),
        log: {
          [STEP_ID]: response({ monitoredAt: secondsAgo(240), isOnline: true }),
        },
      }),
    ]);

    expect(summary.lastResultAt?.toISOString()).toBe(
      secondsAgo(240).toISOString(),
    );
    expect(summary.rows[0]!.lastPingAt?.toISOString()).toBe(
      secondsAgo(5).toISOString(),
    );
  });

  it("a probe with a claim but no result has no lastResultAt", () => {
    const summary: MonitorOverviewProbeSummary = summarize([
      monitorProbe({
        probeId: PROBE_A,
        isEnabled: true,
        lastPingAt: secondsAgo(5),
      }),
    ]);

    expect(summary.lastResultAt).toBeUndefined();
    expect(healthOf(summary, PROBE_A)).toBe(
      MonitorOverviewProbeHealth.NoResultYet,
    );
  });

  it("ignores disabled probes for lastResultAt and nextCheckAt", () => {
    const summary: MonitorOverviewProbeSummary = summarize([
      monitorProbe({
        probeId: PROBE_A,
        isEnabled: false,
        nextPingAt: secondsAgo(-10),
        log: {
          [STEP_ID]: response({ monitoredAt: secondsAgo(5), isOnline: true }),
        },
      }),
      monitorProbe({
        probeId: PROBE_B,
        isEnabled: true,
        nextPingAt: secondsAgo(-200),
        log: {
          [STEP_ID]: response({ monitoredAt: secondsAgo(100), isOnline: true }),
        },
      }),
      monitorProbe({
        probeId: PROBE_C,
        isEnabled: true,
        nextPingAt: secondsAgo(-60),
        log: {
          [STEP_ID]: response({ monitoredAt: secondsAgo(200), isOnline: true }),
        },
      }),
    ]);

    expect(summary.lastResultAt?.toISOString()).toBe(
      secondsAgo(100).toISOString(),
    );
    expect(summary.nextCheckAt?.toISOString()).toBe(
      secondsAgo(-60).toISOString(),
    );
    expect(summary.latestResult?.probeId).toBe(PROBE_B);
  });

  it("filters foreign step ids", () => {
    const summary: MonitorOverviewProbeSummary = summarize([
      monitorProbe({
        probeId: PROBE_A,
        isEnabled: true,
        log: {
          // A step that was deleted still has a (newer, failing) result.
          [DELETED_STEP_ID]: response({
            monitoredAt: secondsAgo(10),
            isOnline: false,
          }),
        },
      }),
    ]);

    expect(summary.lastResultAt).toBeUndefined();
    expect(healthOf(summary, PROBE_A)).toBe(
      MonitorOverviewProbeHealth.NoResultYet,
    );

    // With unknown steps nothing is filtered.
    const unfiltered: MonitorOverviewProbeSummary = summarize(
      [
        monitorProbe({
          probeId: PROBE_A,
          isEnabled: true,
          log: {
            [DELETED_STEP_ID]: response({
              monitoredAt: secondsAgo(10),
              isOnline: false,
            }),
          },
        }),
      ],
      { validStepIds: null, primaryStepId: null },
    );

    expect(healthOf(unfiltered, PROBE_A)).toBe(MonitorOverviewProbeHealth.Down);
  });

  it("prefers the first step's result over a newer one from another step", () => {
    const summary: MonitorOverviewProbeSummary = summarize([
      monitorProbe({
        probeId: PROBE_A,
        isEnabled: true,
        log: {
          [SECOND_STEP_ID]: response({
            monitoredAt: secondsAgo(10),
            isOnline: false,
          }),
          [STEP_ID]: response({ monitoredAt: secondsAgo(40), isOnline: true }),
        },
      }),
    ]);

    expect(healthOf(summary, PROBE_A)).toBe(MonitorOverviewProbeHealth.Up);

    // Without a result for the first step, the newest valid step is used.
    const fallback: MonitorOverviewProbeSummary = summarize([
      monitorProbe({
        probeId: PROBE_A,
        isEnabled: true,
        log: {
          [SECOND_STEP_ID]: response({
            monitoredAt: secondsAgo(10),
            isOnline: false,
          }),
        },
      }),
    ]);

    expect(healthOf(fallback, PROBE_A)).toBe(MonitorOverviewProbeHealth.Down);
  });

  it("a monitoredAt in the future is clamped to now", () => {
    const summary: MonitorOverviewProbeSummary = summarize([
      monitorProbe({
        probeId: PROBE_A,
        isEnabled: true,
        log: {
          [STEP_ID]: response({ monitoredAt: secondsAgo(-90), isOnline: true }),
        },
      }),
    ]);

    expect(summary.lastResultAt?.toISOString()).toBe(NOW.toISOString());
  });

  it("health order and every health state", () => {
    const summary: MonitorOverviewProbeSummary = summarize([
      monitorProbe({
        probeId: PROBE_A,
        name: "Zulu up",
        isEnabled: true,
        log: {
          [STEP_ID]: response({ monitoredAt: secondsAgo(30), isOnline: true }),
        },
      }),
      monitorProbe({
        probeId: PROBE_B,
        name: "Turned off",
        isEnabled: false,
        log: {
          [STEP_ID]: response({ monitoredAt: secondsAgo(30), isOnline: false }),
        },
      }),
      monitorProbe({
        probeId: PROBE_C,
        name: "Waiting",
        isEnabled: true,
      }),
      monitorProbe({
        probeId: PROBE_D,
        name: "Late",
        isEnabled: true,
        log: {
          // Every 5 minutes: 901 seconds is past cadence plus grace.
          [STEP_ID]: response({ monitoredAt: secondsAgo(901), isOnline: true }),
        },
      }),
      monitorProbe({
        probeId: PROBE_E,
        name: "Lost",
        isEnabled: true,
        connectionStatus: ProbeConnectionStatus.Disconnected,
        log: {
          [STEP_ID]: response({ monitoredAt: secondsAgo(30), isOnline: true }),
        },
      }),
      monitorProbe({
        probeId: PROBE_F,
        name: "Failing",
        isEnabled: true,
        connectionStatus: ProbeConnectionStatus.Connected,
        log: {
          [STEP_ID]: response({
            monitoredAt: secondsAgo(30),
            isOnline: false,
            failureCause: "Connection refused",
          }),
        },
      }),
      monitorProbe({
        probeId: PROBE_G,
        name: "Alpha reported",
        isEnabled: true,
        log: {
          [STEP_ID]: response({ monitoredAt: secondsAgo(30) }),
        },
      }),
    ]);

    expect(
      summary.rows.map((row: MonitorOverviewProbeRow) => {
        return [row.name, row.health];
      }),
    ).toEqual([
      ["Failing", MonitorOverviewProbeHealth.Down],
      ["Lost", MonitorOverviewProbeHealth.Disconnected],
      ["Late", MonitorOverviewProbeHealth.Late],
      ["Waiting", MonitorOverviewProbeHealth.NoResultYet],
      // Up and Reported share a rank and sort by name.
      ["Alpha reported", MonitorOverviewProbeHealth.Reported],
      ["Zulu up", MonitorOverviewProbeHealth.Up],
      ["Turned off", MonitorOverviewProbeHealth.TurnedOff],
    ]);

    const failing: MonitorOverviewProbeRow = summary.rows[0]!;

    expect(failing.latestResult?.failureCause).toBe("Connection refused");
    expect(failing.isConnected).toBe(true);
    expect(summary.rows[1]!.isConnected).toBe(false);
    expect(summary.rows[3]!.isConnected).toBeNull();
  });

  it("late only past cadence plus grace", () => {
    const summary: MonitorOverviewProbeSummary = summarize([
      monitorProbe({
        probeId: PROBE_A,
        isEnabled: true,
        log: {
          [STEP_ID]: response({ monitoredAt: secondsAgo(900), isOnline: true }),
        },
      }),
    ]);

    expect(healthOf(summary, PROBE_A)).toBe(MonitorOverviewProbeHealth.Up);
  });

  it("reporting counts", () => {
    const summary: MonitorOverviewProbeSummary = summarize([
      monitorProbe({
        probeId: PROBE_A,
        isEnabled: true,
        log: {
          [STEP_ID]: response({ monitoredAt: secondsAgo(30), isOnline: true }),
        },
      }),
      monitorProbe({
        probeId: PROBE_B,
        isEnabled: true,
        log: {
          [STEP_ID]: response({ monitoredAt: secondsAgo(30), isOnline: false }),
        },
      }),
      monitorProbe({
        probeId: PROBE_C,
        isEnabled: true,
        log: { [STEP_ID]: response({ monitoredAt: secondsAgo(30) }) },
      }),
      monitorProbe({ probeId: PROBE_D, isEnabled: true }),
      monitorProbe({
        probeId: PROBE_E,
        isEnabled: true,
        connectionStatus: ProbeConnectionStatus.Disconnected,
      }),
      monitorProbe({
        probeId: PROBE_F,
        isEnabled: false,
        connectionStatus: ProbeConnectionStatus.Disconnected,
      }),
      monitorProbe({
        probeId: PROBE_G,
        isEnabled: true,
        log: {
          [STEP_ID]: response({
            monitoredAt: secondsAgo(5000),
            isOnline: true,
          }),
        },
      }),
      // No probeId: cannot be identified, so it is not counted.
      monitorProbe({ probeId: undefined }),
    ]);

    expect({
      attachedCount: summary.attachedCount,
      enabledCount: summary.enabledCount,
      reportingCount: summary.reportingCount,
      disabledCount: summary.disabledCount,
      disconnectedCount: summary.disconnectedCount,
    }).toEqual({
      attachedCount: 7,
      enabledCount: 6,
      // Up, Down and Reported; not NoResultYet, Disconnected or Late.
      reportingCount: 3,
      disabledCount: 1,
      // A switched-off probe counts as disabled, not disconnected.
      disconnectedCount: 1,
    });
  });

  it("median, min, max response time", () => {
    const withTimes: (
      times: Array<number | undefined>,
    ) => Array<MonitorProbe> = (
      times: Array<number | undefined>,
    ): Array<MonitorProbe> => {
      const ids: Array<string> = [PROBE_A, PROBE_B, PROBE_C, PROBE_D, PROBE_E];

      return times.map((time: number | undefined, index: number) => {
        return monitorProbe({
          probeId: ids[index]!,
          isEnabled: true,
          log: {
            [STEP_ID]: response({
              monitoredAt: secondsAgo(30),
              isOnline: true,
              ...(time === undefined ? {} : { responseTimeInMs: time }),
            }),
          },
        });
      });
    };

    expect(summarize(withTimes([300, 100, 200])).responseTime).toEqual({
      medianMs: 200,
      minMs: 100,
      maxMs: 300,
      respondedCount: 3,
      totalCount: 3,
    });

    // An even count averages the two middle values, rounded.
    expect(summarize(withTimes([101, 400, 200, 50])).responseTime).toEqual({
      medianMs: 151,
      minMs: 50,
      maxMs: 400,
      respondedCount: 4,
      totalCount: 4,
    });

    // Zero and missing times are not responses.
    expect(summarize(withTimes([0, undefined, 120])).responseTime).toEqual({
      medianMs: 120,
      minMs: 120,
      maxMs: 120,
      respondedCount: 1,
      totalCount: 3,
    });

    expect(summarize(withTimes([undefined, 0])).responseTime).toBeNull();
  });

  it("latest result carries the probe name", () => {
    const summary: MonitorOverviewProbeSummary = summarize([
      monitorProbe({
        probeId: PROBE_A,
        name: "London",
        isEnabled: true,
        log: {
          [STEP_ID]: response({
            monitoredAt: secondsAgo(90),
            isOnline: true,
            responseTimeInMs: 120,
          }),
        },
      }),
      monitorProbe({
        probeId: PROBE_B,
        name: "Frankfurt",
        isEnabled: true,
        log: {
          [STEP_ID]: response({
            monitoredAt: secondsAgo(20),
            isOnline: true,
            responseTimeInMs: 88,
            responseCode: 200,
            sslExpiresAt: "2026-10-21T12:00:00.000Z",
            isValidCertificate: true,
            domainExpiresAt: "2027-01-01T00:00:00.000Z",
          }),
        },
      }),
    ]);

    expect(summary.latestResult).toEqual({
      probeId: PROBE_B,
      probeName: "Frankfurt",
      monitoredAt: secondsAgo(20),
      isOnline: true,
      responseTimeInMs: 88,
      responseCode: 200,
      failureCause: undefined,
      sslExpiresAt: new Date("2026-10-21T12:00:00.000Z"),
      isValidCertificate: true,
      domainExpiresAt: new Date("2027-01-01T00:00:00.000Z"),
    });
  });

  it("an empty list is an empty summary, not an error", () => {
    const summary: MonitorOverviewProbeSummary = summarize([]);

    expect(summary.rows).toEqual([]);
    expect(summary.attachedCount).toBe(0);
    expect(summary.enabledCount).toBe(0);
    expect(summary.lastResultAt).toBeUndefined();
    expect(summary.latestResult).toBeUndefined();
    expect(summary.responseTime).toBeNull();
    expect(summary.nextCheckAt).toBeUndefined();
    expect(summary.latestNextCheckAt).toBeUndefined();
  });

  /*
   * Only a probe's own claim moves its nextPingAt, so a probe that lost its
   * connection or stopped claiming keeps one that sinks into the past.
   */
  it("a disconnected or late probe does not hold back the next check", () => {
    const summary: MonitorOverviewProbeSummary = summarize([
      reportingRow({ probeId: PROBE_A, ageSeconds: 30, nextPingInSeconds: 25 }),
      reportingRow({ probeId: PROBE_B, ageSeconds: 30, nextPingInSeconds: 40 }),
      reportingRow({
        probeId: PROBE_C,
        ageSeconds: 3 * 86400,
        nextPingInSeconds: -3 * 86400,
        connectionStatus: ProbeConnectionStatus.Disconnected,
      }),
      reportingRow({
        probeId: PROBE_D,
        ageSeconds: 2 * 3600,
        nextPingInSeconds: -2 * 3600,
      }),
    ]);

    expect(healthOf(summary, PROBE_C)).toBe(
      MonitorOverviewProbeHealth.Disconnected,
    );
    expect(healthOf(summary, PROBE_D)).toBe(MonitorOverviewProbeHealth.Late);
    expect(summary.nextCheckAt).toEqual(secondsAgo(-25));
    expect(summary.latestNextCheckAt).toEqual(secondsAgo(-40));
  });

  it("the next check is never in the past; the latest due time may be", () => {
    const summary: MonitorOverviewProbeSummary = summarize([
      // Claimed seconds ago; its result is on the way.
      reportingRow({
        probeId: PROBE_A,
        ageSeconds: 50,
        nextPingInSeconds: -10,
      }),
    ]);

    expect(summary.nextCheckAt).toBeUndefined();
    expect(summary.latestNextCheckAt).toEqual(secondsAgo(10));
  });

  it("before any probe reports, the next check comes from the probes still waiting", () => {
    const summary: MonitorOverviewProbeSummary = summarize([
      monitorProbe({
        probeId: PROBE_A,
        isEnabled: true,
        nextPingAt: secondsAgo(-100),
      }),
      monitorProbe({
        probeId: PROBE_B,
        isEnabled: true,
        nextPingAt: secondsAgo(-50),
      }),
      monitorProbe({
        probeId: PROBE_C,
        isEnabled: true,
        connectionStatus: ProbeConnectionStatus.Disconnected,
        nextPingAt: secondsAgo(-5),
      }),
    ]);

    expect(summary.nextCheckAt).toEqual(secondsAgo(-50));
    expect(summary.latestNextCheckAt).toEqual(secondsAgo(-100));
  });

  it("while monitoring is paused no probe is late: each keeps its last verdict", () => {
    const rows: Array<MonitorProbe> = [
      reportingRow({ probeId: PROBE_A, ageSeconds: 25 * 60 }),
      reportingRow({ probeId: PROBE_B, ageSeconds: 25 * 60, isOnline: false }),
    ];

    const paused: MonitorOverviewProbeSummary = summarize(rows, {
      isScheduled: false,
    });

    expect(healthOf(paused, PROBE_A)).toBe(MonitorOverviewProbeHealth.Up);
    expect(healthOf(paused, PROBE_B)).toBe(MonitorOverviewProbeHealth.Down);
    expect(paused.reportingCount).toBe(2);

    const scheduled: MonitorOverviewProbeSummary = summarize(rows);

    expect(healthOf(scheduled, PROBE_A)).toBe(MonitorOverviewProbeHealth.Late);
    expect(scheduled.reportingCount).toBe(0);
  });

  it("a schedule with gaps does not make probes late through the gap", () => {
    // Saturday evening; the last run of the week was Friday at 17:55.
    const saturday: Date = new Date("2026-09-19T20:00:00.000Z");
    const rows: Array<MonitorProbe> = [
      monitorProbe({
        probeId: PROBE_A,
        isEnabled: true,
        log: {
          [STEP_ID]: response({
            monitoredAt: new Date("2026-09-18T17:55:00.000Z"),
            isOnline: true,
          }),
        },
      }),
    ];

    expect(
      healthOf(
        summarize(rows, {
          now: saturday,
          monitoringInterval: "*/5 9-17 * * 1-5",
        }),
        PROBE_A,
      ),
    ).toBe(MonitorOverviewProbeHealth.Up);

    // Monday 09:12: the 09:00 run is more than ten minutes late.
    expect(
      healthOf(
        summarize(rows, {
          now: new Date("2026-09-21T09:12:00.000Z"),
          monitoringInterval: "*/5 9-17 * * 1-5",
        }),
        PROBE_A,
      ),
    ).toBe(MonitorOverviewProbeHealth.Late);
  });

  it("counts the reporting probes that are up and down", () => {
    const summary: MonitorOverviewProbeSummary = summarize([
      reportingRow({ probeId: PROBE_A, ageSeconds: 30 }),
      reportingRow({ probeId: PROBE_B, ageSeconds: 30, isOnline: false }),
      reportingRow({ probeId: PROBE_C, ageSeconds: 30, isOnline: false }),
      // Late and disconnected probes are not counted either way.
      reportingRow({ probeId: PROBE_D, ageSeconds: 5000, isOnline: false }),
      reportingRow({
        probeId: PROBE_E,
        ageSeconds: 30,
        isOnline: false,
        connectionStatus: ProbeConnectionStatus.Disconnected,
      }),
    ]);

    expect({
      reportingCount: summary.reportingCount,
      upCount: summary.upCount,
      downCount: summary.downCount,
    }).toEqual({ reportingCount: 3, upCount: 1, downCount: 2 });
  });

  it("response times come only from probes that are reporting now", () => {
    const summary: MonitorOverviewProbeSummary = summarize([
      reportingRow({ probeId: PROBE_A, ageSeconds: 30, responseTimeInMs: 110 }),
      reportingRow({ probeId: PROBE_B, ageSeconds: 30, responseTimeInMs: 130 }),
      // Its last reading, from before it lost its connection 3 days ago.
      reportingRow({
        probeId: PROBE_C,
        ageSeconds: 3 * 86400,
        responseTimeInMs: 4500,
        connectionStatus: ProbeConnectionStatus.Disconnected,
      }),
      reportingRow({
        probeId: PROBE_D,
        ageSeconds: 2 * 3600,
        responseTimeInMs: 9000,
      }),
    ]);

    expect(summary.responseTime).toEqual({
      medianMs: 120,
      minMs: 110,
      maxMs: 130,
      respondedCount: 2,
      totalCount: 4,
    });
  });
});

describe("MonitorOverviewProbeUtil.getEvaluationByProbe", () => {
  const verdict: (name: string) => MonitorEvaluationSummary = (
    name: string,
  ): MonitorEvaluationSummary => {
    return {
      evaluatedAt: NOW,
      criteriaResults: [
        {
          criteriaName: name,
          filterCondition: FilterCondition.All,
          met: true,
          message: name,
          filters: [],
        },
      ],
      events: [],
    };
  };

  const log: (data: {
    time: Date;
    probeId?: unknown;
    summary?: MonitorEvaluationSummary | JSONObject;
  }) => MonitorLog = (data: {
    time: Date;
    probeId?: unknown;
    summary?: MonitorEvaluationSummary | JSONObject;
  }): MonitorLog => {
    const monitorLog: MonitorLog = new MonitorLog();
    monitorLog.time = data.time;
    monitorLog.logBody = {
      ...(data.probeId === undefined
        ? {}
        : { probeId: data.probeId as string }),
      ...(data.summary === undefined
        ? {}
        : { evaluationSummary: data.summary as unknown as JSONObject }),
    };

    return monitorLog;
  };

  it("groups by string and object probeId, the first per probe wins, skips empty summaries", () => {
    const newestA: MonitorEvaluationSummary = verdict("newest A");
    const olderA: MonitorEvaluationSummary = verdict("older A");
    const fromB: MonitorEvaluationSummary = verdict("B");

    const result: MonitorEvaluationByProbe =
      MonitorOverviewProbeUtil.getEvaluationByProbe([
        // Newest row: an empty summary is not a verdict.
        log({
          time: secondsAgo(5),
          probeId: PROBE_C,
          summary: { evaluatedAt: NOW, criteriaResults: [], events: [] },
        }),
        log({ time: secondsAgo(10), probeId: PROBE_A, summary: newestA }),
        log({
          time: secondsAgo(20),
          probeId: { _type: "ObjectID", value: PROBE_B },
          summary: fromB,
        }),
        log({ time: secondsAgo(30), probeId: PROBE_A, summary: olderA }),
        log({ time: secondsAgo(40), probeId: PROBE_D }),
      ]);

    expect(Object.keys(result.byProbeId).sort()).toEqual(
      [PROBE_A, PROBE_B].sort(),
    );
    expect(result.byProbeId[PROBE_A]).toBe(newestA);
    expect(result.byProbeId[PROBE_B]).toBe(fromB);
    expect(result.latest?.summary).toBe(newestA);
    expect(result.latest?.probeId).toBe(PROBE_A);
    expect(result.latest?.at.toISOString()).toBe(secondsAgo(10).toISOString());
    // The newest log's time, verdict or not.
    expect(result.latestAt?.toISOString()).toBe(secondsAgo(5).toISOString());
  });

  it("reads an ObjectID instance and an events-only verdict", () => {
    const eventsOnly: MonitorEvaluationSummary = {
      evaluatedAt: NOW,
      criteriaResults: [],
      events: [{ type: "monitor-status-changed", title: "Status changed" }],
    };

    const result: MonitorEvaluationByProbe =
      MonitorOverviewProbeUtil.getEvaluationByProbe([
        log({
          time: secondsAgo(5),
          probeId: new ObjectID(PROBE_E),
          summary: eventsOnly,
        }),
      ]);

    expect(result.byProbeId[PROBE_E]).toBe(eventsOnly);
  });

  it("a verdict with no probe still counts as the latest", () => {
    const central: MonitorEvaluationSummary = verdict("central");
    const result: MonitorEvaluationByProbe =
      MonitorOverviewProbeUtil.getEvaluationByProbe([
        log({ time: secondsAgo(60), summary: central }),
      ]);

    expect(result.byProbeId).toEqual({});
    expect(result.latest?.summary).toBe(central);
    expect(result.latest?.probeId).toBeUndefined();
  });

  it("no logs gives nothing", () => {
    expect(MonitorOverviewProbeUtil.getEvaluationByProbe([])).toEqual({
      latest: undefined,
      byProbeId: {},
      latestAt: undefined,
    });
  });
});

describe("MonitorOverviewProbeUtil.getEvaluationLogLimit", () => {
  it("evaluation log limits per type", () => {
    const limit: (
      monitorType: MonitorType,
      enabledProbeCount: number,
    ) => number = (
      monitorType: MonitorType,
      enabledProbeCount: number,
    ): number => {
      return MonitorOverviewProbeUtil.getEvaluationLogLimit({
        monitorType: monitorType,
        enabledProbeCount: enabledProbeCount,
      });
    };

    // Probe checks: two per probe, at least 1, at most 20.
    expect(limit(MonitorType.API, 3)).toBe(6);
    expect(limit(MonitorType.Website, 0)).toBe(1);
    expect(limit(MonitorType.Ping, 50)).toBe(20);

    // Scripted checks carry payloads: one per probe, at most 10.
    expect(limit(MonitorType.SyntheticMonitor, 3)).toBe(3);
    expect(limit(MonitorType.CustomJavaScriptCode, 0)).toBe(1);
    expect(limit(MonitorType.SyntheticMonitor, 40)).toBe(10);

    // Everything else is evaluated centrally.
    expect(limit(MonitorType.IncomingRequest, 5)).toBe(1);
    expect(limit(MonitorType.Server, 5)).toBe(1);
    expect(limit(MonitorType.Logs, 5)).toBe(1);
    expect(limit(MonitorType.Kubernetes, 5)).toBe(1);
    expect(limit(MonitorType.NetworkDevice, 5)).toBe(1);
    expect(limit(MonitorType.Manual, 5)).toBe(1);

    // A nonsense count never produces a nonsense limit.
    expect(limit(MonitorType.API, Number.NaN)).toBe(1);
  });
});
