import AutoRemediationRuleEngineService, {
  FIXES_ON_MODES,
  MAX_DECISIONS_READ_WHEN_FIXES_TURN_ON,
  MAX_SUBJECTS_TRIED_AGAIN_WHEN_FIXES_TURN_ON,
  REMEDIATION_FIXES_COLUMN,
  REMEDIATION_RETRY_LOCK_NAMESPACE,
  RemediationFixesTarget,
  doesTurnFixesOn,
  getFixesOffEntry,
  getFixesOffEntryMatch,
  getRemediationRetryLockKey,
  isFixesOnMode,
} from "../../../Server/Services/AutoRemediationRuleEngineService";
import AutoRemediationDecisionService from "../../../Server/Services/AutoRemediationDecisionService";
import AlertService from "../../../Server/Services/AlertService";
import IncidentService from "../../../Server/Services/IncidentService";
import KubernetesClusterService from "../../../Server/Services/KubernetesClusterService";
import ResourceAiAccessService, {
  ResourceAiAccessRow,
} from "../../../Server/Services/ResourceAiAccessService";
import Semaphore from "../../../Server/Infrastructure/Semaphore";
import logger from "../../../Server/Utils/Logger";
import AutoRemediationDecision from "../../../Models/DatabaseModels/AutoRemediationDecision";
import KubernetesCluster from "../../../Models/DatabaseModels/KubernetesCluster";
import {
  AutoRemediationDecisionEntry,
  AutoRemediationDecisionHelper,
  AutoRemediationDecisionLane,
  AutoRemediationDecisionReason,
  AutoRemediationDecisionStage,
} from "../../../Types/AutoRemediation/AutoRemediationDecision";
import { KubernetesAiRemediationMode } from "../../../Types/Kubernetes/KubernetesClusterAiAccess";
import AiResourceType from "../../../Types/ResourceAiAgent/AiResourceType";
import { ResourceAiRemediationMode } from "../../../Types/ResourceAiAgent/ResourceAiAccess";
import SortOrder from "../../../Types/BaseDatabase/SortOrder";
import { JSONArray, JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import type { Mock, SpyInstance } from "jest-mock";

/*
 * TURNING FIXES ON MAKES ONEUPTIME AI TRY AGAIN (#5303's follow-up).
 *
 * The Remediation step of an open incident said "Fixes are off for cluster
 * prod-eu, so OneUptime AI only investigates there", and turning them on
 * changed nothing: it is not a link, so the linking retry never ran, and a
 * decision is made once. Now turning a cluster's or a resource's Fixes on -
 * on its AI agent page, through the API or Terraform, or by its agent's
 * configuration - decides again about the open records whose latest
 * decision said so. These tests hold that, and its limits:
 *
 *   - only the records whose latest evaluation found that target's Fixes off
 *     are decided again - found by the entry the evaluation wrote, the most
 *     recently decided first, each once, at most 25;
 *   - only while the record is open, and only while the target's Fixes are
 *     still on;
 *   - each under its record's retry lock (shared with the linking retry and
 *     Try again), asked again inside it; without the lock, not at all;
 *   - it never throws into the save that turned Fixes on.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
);
const CLUSTER_ID: string = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const HOST_ID: string = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const CLOUD_ACCOUNT_ID: string = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";

const CLUSTER: RemediationFixesTarget = {
  lane: AutoRemediationDecisionLane.KubernetesCluster,
  id: CLUSTER_ID,
};
const HOST: RemediationFixesTarget = {
  lane: AutoRemediationDecisionLane.Resource,
  id: HOST_ID,
};

function incidentId(index: number): ObjectID {
  return new ObjectID(
    `bbbbbbbb-bbbb-4bbb-8bbb-${String(index).padStart(12, "0")}`,
  );
}

function alertId(index: number): ObjectID {
  return new ObjectID(
    `ffffffff-ffff-4fff-8fff-${String(index).padStart(12, "0")}`,
  );
}

// The entry an evaluation writes when a cluster's Fixes are off.
const CLUSTER_FIXES_OFF: AutoRemediationDecisionEntry = {
  lane: AutoRemediationDecisionLane.KubernetesCluster,
  reason: AutoRemediationDecisionReason.ClusterFixesOff,
  kubernetesClusterId: CLUSTER_ID,
  kubernetesClusterName: "prod-eu",
  remediationMode: KubernetesAiRemediationMode.Disabled,
};

// The entry an evaluation writes when a host's Fixes are off.
const HOST_FIXES_OFF: AutoRemediationDecisionEntry = {
  lane: AutoRemediationDecisionLane.Resource,
  reason: AutoRemediationDecisionReason.ResourceFixesOff,
  resourceType: AiResourceType.Host,
  resourceId: HOST_ID,
  resourceName: "test01",
  remediationMode: ResourceAiRemediationMode.Disabled,
};

// A decision row, as the reads return it.
function decision(
  subject: { incidentId?: ObjectID; alertId?: ObjectID },
  entries: Array<AutoRemediationDecisionEntry> = [CLUSTER_FIXES_OFF],
): AutoRemediationDecision {
  const row: AutoRemediationDecision = new AutoRemediationDecision();
  row.stage = AutoRemediationDecisionStage.Evaluated;
  row.entries = entries.map((entry: AutoRemediationDecisionEntry) => {
    return AutoRemediationDecisionHelper.toJSON(entry);
  }) as unknown as JSONArray;

  if (subject.incidentId) {
    row.incidentId = subject.incidentId;
  }

  if (subject.alertId) {
    row.alertId = subject.alertId;
  }

  return row;
}

interface Spies {
  found: SpyInstance<typeof AutoRemediationDecisionService.findBy>;
  latest: SpyInstance<typeof AutoRemediationDecisionService.findOneBy>;
  isIncidentResolved: SpyInstance<typeof IncidentService.isIncidentResolved>;
  isAlertResolved: SpyInstance<typeof AlertService.isAlertResolved>;
  cluster: SpyInstance<typeof KubernetesClusterService.findOneBy>;
  resource: SpyInstance<typeof ResourceAiAccessService.loadResource>;
  lock: SpyInstance<typeof Semaphore.lock>;
  release: SpyInstance<typeof Semaphore.release>;
  applyToIncident: SpyInstance<
    typeof AutoRemediationRuleEngineService.applyRulesToIncidentById
  >;
  applyToAlert: SpyInstance<
    typeof AutoRemediationRuleEngineService.applyRulesToAlertById
  >;
}

function clusterIn(mode: string): KubernetesCluster {
  const cluster: KubernetesCluster = new KubernetesCluster();
  cluster._id = CLUSTER_ID;
  cluster.aiRemediationMode = mode as KubernetesAiRemediationMode;
  return cluster;
}

function resourceIn(
  mode: ResourceAiRemediationMode,
  overrides: Partial<ResourceAiAccessRow> = {},
): ResourceAiAccessRow {
  return {
    resourceType: AiResourceType.Host,
    id: new ObjectID(HOST_ID),
    projectId: PROJECT_ID,
    name: "test01",
    isAiInvestigationEnabled: true,
    aiRemediationMode: mode,
    aiCommandAllowlist: [],
    isArchived: false,
    ...overrides,
  };
}

function installSpies(data: {
  found: Array<AutoRemediationDecision>;
  // The latest decision of each record, by its id; default: what was found.
  latest?: Map<string, AutoRemediationDecision | null>;
  resolved?: Set<string>;
  clusterMode?: string;
  resourceRow?: ResourceAiAccessRow | null;
}): Spies {
  const latestOf: (query: JSONObject) => AutoRemediationDecision | null = (
    query: JSONObject,
  ): AutoRemediationDecision | null => {
    const id: string = String(query["incidentId"] || query["alertId"] || "");

    if (data.latest && data.latest.has(id)) {
      return data.latest.get(id) || null;
    }

    return (
      data.found.find((row: AutoRemediationDecision): boolean => {
        return (
          (row.incidentId || row.alertId)?.toString() === id.toLowerCase()
        );
      }) || null
    );
  };

  return {
    found: jest
      .spyOn(AutoRemediationDecisionService, "findBy")
      .mockResolvedValue(data.found as never),
    latest: jest
      .spyOn(AutoRemediationDecisionService, "findOneBy")
      .mockImplementation((async (args: { query: JSONObject }) => {
        return latestOf(args.query);
      }) as never),
    isIncidentResolved: jest
      .spyOn(IncidentService, "isIncidentResolved")
      .mockImplementation((async (args: { incidentId: ObjectID }) => {
        return Boolean(data.resolved?.has(args.incidentId.toString()));
      }) as never),
    isAlertResolved: jest
      .spyOn(AlertService, "isAlertResolved")
      .mockImplementation((async (args: { alertId: ObjectID }) => {
        return Boolean(data.resolved?.has(args.alertId.toString()));
      }) as never),
    cluster: jest
      .spyOn(KubernetesClusterService, "findOneBy")
      .mockResolvedValue(
        clusterIn(
          data.clusterMode ?? KubernetesAiRemediationMode.RequireApproval,
        ) as never,
      ),
    resource: jest
      .spyOn(ResourceAiAccessService, "loadResource")
      .mockResolvedValue(
        (data.resourceRow === undefined
          ? resourceIn(ResourceAiRemediationMode.RequireApproval)
          : data.resourceRow) as never,
      ),
    lock: jest
      .spyOn(Semaphore, "lock")
      .mockResolvedValue({ identifier: "lock" } as never),
    release: jest.spyOn(Semaphore, "release").mockResolvedValue(undefined),
    applyToIncident: jest
      .spyOn(AutoRemediationRuleEngineService, "applyRulesToIncidentById")
      .mockResolvedValue(undefined),
    applyToAlert: jest
      .spyOn(AutoRemediationRuleEngineService, "applyRulesToAlertById")
      .mockResolvedValue(undefined),
  };
}

beforeEach(() => {
  jest.spyOn(logger, "warn").mockImplementation((): void => {});
  jest.spyOn(logger, "error").mockImplementation((): void => {});
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("which writes turn Fixes on", () => {
  test("every mode but Off lets OneUptime AI fix: from asking first to on its own", () => {
    expect([...FIXES_ON_MODES].sort()).toEqual(
      [
        KubernetesAiRemediationMode.RequireApproval,
        KubernetesAiRemediationMode.Automatic,
        KubernetesAiRemediationMode.BypassApproval,
      ].sort(),
    );
    // A resource's modes are the cluster's, value for value.
    for (const mode of Object.values(ResourceAiRemediationMode)) {
      expect(isFixesOnMode(mode)).toBe(
        mode !== ResourceAiRemediationMode.Disabled,
      );
    }
    for (const mode of Object.values(KubernetesAiRemediationMode)) {
      expect(isFixesOnMode(mode)).toBe(
        mode !== KubernetesAiRemediationMode.Disabled,
      );
    }
  });

  test.each([
    [{ aiRemediationMode: "RequireApproval" }],
    [{ aiRemediationMode: "Automatic", isAiInvestigationEnabled: true }],
    [{ aiRemediationMode: "BypassApproval" }],
  ])("%j does", (data: JSONObject) => {
    expect(doesTurnFixesOn(data)).toBe(true);
  });

  test.each([
    [{ aiRemediationMode: "Disabled" }],
    [{ aiRemediationMode: "ask-for-approval" }],
    [{ aiRemediationMode: null }],
    [{ isAiInvestigationEnabled: true }],
    [{ lastSeenAt: new Date("2026-11-03T10:00:00.000Z") }],
    [{}],
  ])("%j does not", (data: JSONObject) => {
    expect(doesTurnFixesOn(data)).toBe(false);
  });

  test("nothing that is not an object does", () => {
    expect(doesTurnFixesOn(undefined)).toBe(false);
    expect(doesTurnFixesOn(null)).toBe(false);
    expect(doesTurnFixesOn("RequireApproval")).toBe(false);
  });

  test("the column a write turns Fixes on through is the one the clusters and resources store", () => {
    expect(REMEDIATION_FIXES_COLUMN).toBe("aiRemediationMode");
    expect(new KubernetesCluster().hasColumn(REMEDIATION_FIXES_COLUMN)).toBe(
      true,
    );
  });
});

describe("the entry an evaluation wrote when Fixes were off", () => {
  test("a cluster's is found by its reason and the cluster's id, as the decisions store it", () => {
    const match: JSONObject = getFixesOffEntryMatch(CLUSTER);
    const stored: JSONObject =
      AutoRemediationDecisionHelper.toJSON(CLUSTER_FIXES_OFF);

    expect(match).toEqual({
      lane: AutoRemediationDecisionLane.KubernetesCluster,
      reason: AutoRemediationDecisionReason.ClusterFixesOff,
      kubernetesClusterId: CLUSTER_ID,
    });
    // Contained in what is stored: Postgres's @> finds it.
    for (const [key, value] of Object.entries(match)) {
      expect(stored[key]).toBe(value);
    }
  });

  test("a resource's by its reason and its id alone: every resource's id is its own", () => {
    const match: JSONObject = getFixesOffEntryMatch(HOST);
    const stored: JSONObject =
      AutoRemediationDecisionHelper.toJSON(HOST_FIXES_OFF);

    expect(match).toEqual({
      lane: AutoRemediationDecisionLane.Resource,
      reason: AutoRemediationDecisionReason.ResourceFixesOff,
      resourceId: HOST_ID,
    });
    for (const [key, value] of Object.entries(match)) {
      expect(stored[key]).toBe(value);
    }
  });

  test("an id in capitals is found as the decisions store it, lower-cased", () => {
    expect(
      getFixesOffEntryMatch({
        lane: AutoRemediationDecisionLane.KubernetesCluster,
        id: CLUSTER_ID.toUpperCase(),
      })["kubernetesClusterId"],
    ).toBe(CLUSTER_ID);
  });

  test("getFixesOffEntry: the entry naming the target, of its own lane only", () => {
    const entries: JSONArray = [
      AutoRemediationDecisionHelper.toJSON(HOST_FIXES_OFF),
      AutoRemediationDecisionHelper.toJSON(CLUSTER_FIXES_OFF),
    ] as JSONArray;

    expect(getFixesOffEntry(entries, CLUSTER)?.kubernetesClusterName).toBe(
      "prod-eu",
    );
    expect(getFixesOffEntry(entries, HOST)?.resourceType).toBe(
      AiResourceType.Host,
    );
    // A cluster with the host's id is not the host.
    expect(
      getFixesOffEntry(entries, {
        lane: AutoRemediationDecisionLane.KubernetesCluster,
        id: HOST_ID,
      }),
    ).toBeUndefined();
    // Fixes on but not ready is not off.
    expect(
      getFixesOffEntry(
        [
          {
            lane: "KubernetesCluster",
            reason: AutoRemediationDecisionReason.ClusterNotReady,
            kubernetesClusterId: CLUSTER_ID,
          },
        ],
        CLUSTER,
      ),
    ).toBeUndefined();
    expect(getFixesOffEntry(undefined, CLUSTER)).toBeUndefined();
  });
});

describe("onFixesTurnedOn: a cluster's Fixes turned on", () => {
  test("finds the evaluations that found them off, in the project, newest first, as OneUptime", async () => {
    const spies: Spies = installSpies({
      found: [decision({ incidentId: incidentId(1) })],
    });

    await AutoRemediationRuleEngineService.onFixesTurnedOn({
      projectId: PROJECT_ID,
      target: CLUSTER,
    });

    const args: {
      query: JSONObject;
      sort: JSONObject;
      limit: number;
      props: JSONObject;
    } = spies.found.mock.calls[0]![0] as never;

    expect(args.query["projectId"]).toBe(PROJECT_ID);
    expect(args.query["stage"]).toBe(AutoRemediationDecisionStage.Evaluated);
    expect(args.sort).toEqual({ createdAt: SortOrder.Descending });
    expect(args.limit).toBe(MAX_DECISIONS_READ_WHEN_FIXES_TURN_ON);
    expect(args.props).toEqual({ isRoot: true });

    // The entries holding the one entry: Postgres's @>, a bound parameter.
    const operator: { objectLiteralParameters?: JSONObject } = args.query[
      "entries"
    ] as never;
    const parameters: Array<unknown> = Object.values(
      operator.objectLiteralParameters || {},
    );

    expect(parameters).toHaveLength(1);
    expect(JSON.parse(String(parameters[0]))).toEqual([
      getFixesOffEntryMatch(CLUSTER),
    ]);
  });

  test("decides again about the open incident it stopped, as for a new one", async () => {
    const spies: Spies = installSpies({
      found: [decision({ incidentId: incidentId(1) })],
    });

    const decided: number =
      await AutoRemediationRuleEngineService.onFixesTurnedOn({
        projectId: PROJECT_ID,
        target: CLUSTER,
      });

    expect(decided).toBe(1);
    expect(spies.applyToIncident).toHaveBeenCalledWith({
      incidentId: incidentId(1),
      projectId: PROJECT_ID,
    });
    expect(spies.applyToAlert).not.toHaveBeenCalled();
    // The cluster is read afresh, in the project, as OneUptime.
    expect(spies.cluster.mock.calls[0]![0]).toMatchObject({
      query: { _id: CLUSTER_ID, projectId: PROJECT_ID },
      props: { isRoot: true },
    });
  });

  test("an alert it stopped is decided again as an alert", async () => {
    const spies: Spies = installSpies({
      found: [decision({ alertId: alertId(1) })],
    });

    await AutoRemediationRuleEngineService.onFixesTurnedOn({
      projectId: PROJECT_ID,
      target: CLUSTER,
    });

    expect(spies.applyToAlert).toHaveBeenCalledWith({
      alertId: alertId(1),
      projectId: PROJECT_ID,
    });
    expect(spies.isAlertResolved).toHaveBeenCalledWith({
      alertId: alertId(1),
    });
    expect(spies.applyToIncident).not.toHaveBeenCalled();
  });

  test("each record once, the most recently decided first", async () => {
    const spies: Spies = installSpies({
      found: [
        decision({ incidentId: incidentId(2) }),
        decision({ alertId: alertId(1) }),
        decision({ incidentId: incidentId(2) }),
        decision({ incidentId: incidentId(1) }),
      ],
    });

    const decided: number =
      await AutoRemediationRuleEngineService.onFixesTurnedOn({
        projectId: PROJECT_ID,
        target: CLUSTER,
      });

    expect(decided).toBe(3);
    expect(
      spies.lock.mock.calls.map((call: Array<unknown>): string => {
        return (call[0] as { key: string }).key;
      }),
    ).toEqual([
      getRemediationRetryLockKey(incidentId(2)),
      getRemediationRetryLockKey(alertId(1)),
      getRemediationRetryLockKey(incidentId(1)),
    ]);
  });

  test(`at most ${MAX_SUBJECTS_TRIED_AGAIN_WHEN_FIXES_TURN_ON} records: turning Fixes on never starts hundreds of fixes at once`, async () => {
    const spies: Spies = installSpies({
      found: Array.from(
        { length: MAX_SUBJECTS_TRIED_AGAIN_WHEN_FIXES_TURN_ON + 10 },
        (_value: unknown, index: number): AutoRemediationDecision => {
          return decision({ incidentId: incidentId(index) });
        },
      ),
    });

    const decided: number =
      await AutoRemediationRuleEngineService.onFixesTurnedOn({
        projectId: PROJECT_ID,
        target: CLUSTER,
      });

    expect(MAX_SUBJECTS_TRIED_AGAIN_WHEN_FIXES_TURN_ON).toBe(25);
    expect(decided).toBe(MAX_SUBJECTS_TRIED_AGAIN_WHEN_FIXES_TURN_ON);
    expect(spies.applyToIncident).toHaveBeenCalledTimes(
      MAX_SUBJECTS_TRIED_AGAIN_WHEN_FIXES_TURN_ON,
    );
    // The newest ones.
    expect(spies.applyToIncident.mock.calls[0]![0]).toEqual({
      incidentId: incidentId(0),
      projectId: PROJECT_ID,
    });
  });

  test("a record decided again since - its latest decision says something else - is left as it is", async () => {
    const newer: AutoRemediationDecision = decision(
      { incidentId: incidentId(1) },
      [
        {
          lane: AutoRemediationDecisionLane.KubernetesCluster,
          reason: AutoRemediationDecisionReason.ClusterRoundStarted,
          kubernetesClusterId: CLUSTER_ID,
        },
      ],
    );
    const spies: Spies = installSpies({
      found: [decision({ incidentId: incidentId(1) })],
      latest: new Map([[incidentId(1).toString(), newer]]),
    });

    const decided: number =
      await AutoRemediationRuleEngineService.onFixesTurnedOn({
        projectId: PROJECT_ID,
        target: CLUSTER,
      });

    expect(decided).toBe(0);
    expect(spies.lock).not.toHaveBeenCalled();
    expect(spies.applyToIncident).not.toHaveBeenCalled();
  });

  test("another cluster's Fixes being off is not this one's", async () => {
    const OTHER: AutoRemediationDecisionEntry = {
      ...CLUSTER_FIXES_OFF,
      kubernetesClusterId: "cccccccc-cccc-4ccc-8ccc-000000000000",
    };
    const spies: Spies = installSpies({
      found: [decision({ incidentId: incidentId(1) })],
      latest: new Map([
        [incidentId(1).toString(), decision({ incidentId: incidentId(1) }, [OTHER])],
      ]),
    });

    await AutoRemediationRuleEngineService.onFixesTurnedOn({
      projectId: PROJECT_ID,
      target: CLUSTER,
    });

    expect(spies.applyToIncident).not.toHaveBeenCalled();
  });

  test("a resolved record is not decided again", async () => {
    const spies: Spies = installSpies({
      found: [
        decision({ incidentId: incidentId(1) }),
        decision({ incidentId: incidentId(2) }),
      ],
      resolved: new Set([incidentId(1).toString()]),
    });

    const decided: number =
      await AutoRemediationRuleEngineService.onFixesTurnedOn({
        projectId: PROJECT_ID,
        target: CLUSTER,
      });

    expect(decided).toBe(1);
    expect(spies.applyToIncident).toHaveBeenCalledTimes(1);
    expect(spies.applyToIncident).toHaveBeenCalledWith({
      incidentId: incidentId(2),
      projectId: PROJECT_ID,
    });
  });

  test("Fixes off again by the time it asks: nothing is decided", async () => {
    const spies: Spies = installSpies({
      found: [decision({ incidentId: incidentId(1) })],
      clusterMode: KubernetesAiRemediationMode.Disabled,
    });

    expect(
      await AutoRemediationRuleEngineService.onFixesTurnedOn({
        projectId: PROJECT_ID,
        target: CLUSTER,
      }),
    ).toBe(0);
    expect(spies.applyToIncident).not.toHaveBeenCalled();
  });

  test("a cluster that is gone has no Fixes on", async () => {
    const spies: Spies = installSpies({
      found: [decision({ incidentId: incidentId(1) })],
    });
    spies.cluster.mockResolvedValue(null);

    await AutoRemediationRuleEngineService.onFixesTurnedOn({
      projectId: PROJECT_ID,
      target: CLUSTER,
    });

    expect(spies.applyToIncident).not.toHaveBeenCalled();
  });

  test("nothing found, nothing decided, no lock taken", async () => {
    const spies: Spies = installSpies({ found: [] });

    expect(
      await AutoRemediationRuleEngineService.onFixesTurnedOn({
        projectId: PROJECT_ID,
        target: CLUSTER,
      }),
    ).toBe(0);
    expect(spies.latest).not.toHaveBeenCalled();
    expect(spies.lock).not.toHaveBeenCalled();
  });

  test("a target without a OneUptime ID reads nothing", async () => {
    const spies: Spies = installSpies({ found: [] });

    expect(
      await AutoRemediationRuleEngineService.onFixesTurnedOn({
        projectId: PROJECT_ID,
        target: { lane: AutoRemediationDecisionLane.KubernetesCluster, id: "prod" },
      }),
    ).toBe(0);
    expect(spies.found).not.toHaveBeenCalled();
  });
});

describe("onFixesTurnedOn: serialized per record, as the linking retry is", () => {
  test("each record under its own retry lock, given back after", async () => {
    const spies: Spies = installSpies({
      found: [decision({ incidentId: incidentId(1) })],
    });

    await AutoRemediationRuleEngineService.onFixesTurnedOn({
      projectId: PROJECT_ID,
      target: CLUSTER,
    });

    const lock: { key: string; namespace: string } = spies.lock.mock
      .calls[0]![0] as never;
    expect(lock.key).toBe(getRemediationRetryLockKey(incidentId(1)));
    expect(lock.namespace).toBe(REMEDIATION_RETRY_LOCK_NAMESPACE);
    expect(spies.release).toHaveBeenCalledTimes(1);
  });

  test("asked again inside the lock: a link or a Try again that decided while it waited wins", async () => {
    const spies: Spies = installSpies({
      found: [decision({ incidentId: incidentId(1) })],
    });
    const decidedMeanwhile: AutoRemediationDecision = decision(
      { incidentId: incidentId(1) },
      [
        {
          lane: AutoRemediationDecisionLane.KubernetesCluster,
          reason: AutoRemediationDecisionReason.ClusterRoundStarted,
          kubernetesClusterId: CLUSTER_ID,
        },
      ],
    );
    spies.latest
      .mockResolvedValueOnce(decision({ incidentId: incidentId(1) }) as never)
      .mockResolvedValueOnce(decidedMeanwhile as never);

    expect(
      await AutoRemediationRuleEngineService.onFixesTurnedOn({
        projectId: PROJECT_ID,
        target: CLUSTER,
      }),
    ).toBe(0);
    expect(spies.latest).toHaveBeenCalledTimes(2);
    expect(spies.applyToIncident).not.toHaveBeenCalled();
    // The lock is still given back.
    expect(spies.release).toHaveBeenCalledTimes(1);
  });

  test("without the lock it does not decide, rather than risk two fixes at once - and the next record is still tried", async () => {
    const spies: Spies = installSpies({
      found: [
        decision({ incidentId: incidentId(1) }),
        decision({ incidentId: incidentId(2) }),
      ],
    });
    spies.lock
      .mockRejectedValueOnce(new Error("Redis client is not connected"))
      .mockResolvedValueOnce({ identifier: "lock" } as never);

    expect(
      await AutoRemediationRuleEngineService.onFixesTurnedOn({
        projectId: PROJECT_ID,
        target: CLUSTER,
      }),
    ).toBe(1);
    expect(spies.applyToIncident).toHaveBeenCalledTimes(1);
    expect(spies.applyToIncident).toHaveBeenCalledWith({
      incidentId: incidentId(2),
      projectId: PROJECT_ID,
    });
    expect(logger.warn).toHaveBeenCalled();
  });

  test("never throws into the save that turned Fixes on", async () => {
    const spies: Spies = installSpies({ found: [] });
    spies.found.mockRejectedValue(new Error("Postgres went away"));

    await expect(
      AutoRemediationRuleEngineService.onFixesTurnedOn({
        projectId: PROJECT_ID,
        target: CLUSTER,
      }),
    ).resolves.toBe(0);
    expect(logger.error).toHaveBeenCalled();
  });

  test("a decision that fails for one record does not stop the next", async () => {
    const spies: Spies = installSpies({
      found: [
        decision({ incidentId: incidentId(1) }),
        decision({ incidentId: incidentId(2) }),
      ],
    });
    spies.applyToIncident
      .mockRejectedValueOnce(new Error("LLM provider timed out"))
      .mockResolvedValueOnce(undefined);

    expect(
      await AutoRemediationRuleEngineService.onFixesTurnedOn({
        projectId: PROJECT_ID,
        target: CLUSTER,
      }),
    ).toBe(1);
    expect(spies.applyToIncident).toHaveBeenCalledTimes(2);
    expect(spies.release).toHaveBeenCalledTimes(2);
  });
});

describe("onFixesTurnedOn: a resource's Fixes turned on", () => {
  test("a host's: its own row read afresh, by the type the evaluation named", async () => {
    const spies: Spies = installSpies({
      found: [decision({ incidentId: incidentId(1) }, [HOST_FIXES_OFF])],
    });

    expect(
      await AutoRemediationRuleEngineService.onFixesTurnedOn({
        projectId: PROJECT_ID,
        target: HOST,
      }),
    ).toBe(1);
    expect(spies.resource).toHaveBeenCalledWith({
      projectId: PROJECT_ID,
      resourceType: AiResourceType.Host,
      resourceId: new ObjectID(HOST_ID),
    });
    expect(spies.cluster).not.toHaveBeenCalled();
    expect(spies.applyToIncident).toHaveBeenCalledTimes(1);
  });

  test("a cloud account's, read as the cloud account it is", async () => {
    const CLOUD_FIXES_OFF: AutoRemediationDecisionEntry = {
      lane: AutoRemediationDecisionLane.Resource,
      reason: AutoRemediationDecisionReason.ResourceFixesOff,
      resourceType: AiResourceType.AwsAccount,
      resourceId: CLOUD_ACCOUNT_ID,
      resourceName: "prod (123456789012)",
    };
    const spies: Spies = installSpies({
      found: [decision({ alertId: alertId(1) }, [CLOUD_FIXES_OFF])],
      resourceRow: resourceIn(ResourceAiRemediationMode.Automatic, {
        resourceType: AiResourceType.AwsAccount,
        id: new ObjectID(CLOUD_ACCOUNT_ID),
      }),
    });

    await AutoRemediationRuleEngineService.onFixesTurnedOn({
      projectId: PROJECT_ID,
      target: {
        lane: AutoRemediationDecisionLane.Resource,
        id: CLOUD_ACCOUNT_ID,
      },
    });

    expect(spies.resource).toHaveBeenCalledWith({
      projectId: PROJECT_ID,
      resourceType: AiResourceType.AwsAccount,
      resourceId: new ObjectID(CLOUD_ACCOUNT_ID),
    });
    expect(spies.applyToAlert).toHaveBeenCalledTimes(1);
  });

  test.each([
    ["off again", resourceIn(ResourceAiRemediationMode.Disabled)],
    [
      "archived",
      resourceIn(ResourceAiRemediationMode.RequireApproval, {
        isArchived: true,
      }),
    ],
    ["gone", null],
  ])(
    "a resource %s by the time it asks: nothing is decided",
    async (_how: string, row: ResourceAiAccessRow | null) => {
      const spies: Spies = installSpies({
        found: [decision({ incidentId: incidentId(1) }, [HOST_FIXES_OFF])],
        resourceRow: row,
      });

      await AutoRemediationRuleEngineService.onFixesTurnedOn({
        projectId: PROJECT_ID,
        target: HOST,
      });

      expect(spies.applyToIncident).not.toHaveBeenCalled();
    },
  );

  test("an entry naming a resource type this build does not know is not decided again", async () => {
    const spies: Spies = installSpies({
      found: [
        decision({ incidentId: incidentId(1) }, [
          { ...HOST_FIXES_OFF, resourceType: "Mainframe" },
        ]),
      ],
    });

    await AutoRemediationRuleEngineService.onFixesTurnedOn({
      projectId: PROJECT_ID,
      target: HOST,
    });

    expect(spies.resource).not.toHaveBeenCalled();
    expect(spies.applyToIncident).not.toHaveBeenCalled();
  });
});

describe("onFixesSettingWritten: a write handed over by a service", () => {
  test("a write that turns Fixes on decides again for each row it wrote, each in its own project", async () => {
    const turnedOn: SpyInstance<
      typeof AutoRemediationRuleEngineService.onFixesTurnedOn
    > = jest
      .spyOn(AutoRemediationRuleEngineService, "onFixesTurnedOn")
      .mockResolvedValueOnce(2)
      .mockResolvedValueOnce(1);
    const OTHER_PROJECT: ObjectID = new ObjectID(
      "aaaaaaaa-aaaa-4aaa-8aaa-000000000000",
    );
    const OTHER_CLUSTER: ObjectID = new ObjectID(
      "cccccccc-cccc-4ccc-8ccc-000000000001",
    );

    const decided: number =
      await AutoRemediationRuleEngineService.onFixesSettingWritten({
        lane: AutoRemediationDecisionLane.KubernetesCluster,
        written: { aiRemediationMode: "Automatic" },
        updatedIds: [new ObjectID(CLUSTER_ID), OTHER_CLUSTER],
        readProjectId: async (id: ObjectID): Promise<ObjectID> => {
          return id.toString() === CLUSTER_ID ? PROJECT_ID : OTHER_PROJECT;
        },
      });

    expect(decided).toBe(3);
    expect(turnedOn.mock.calls.map((call: Array<unknown>) => call[0])).toEqual(
      [
        { projectId: PROJECT_ID, target: CLUSTER },
        {
          projectId: OTHER_PROJECT,
          target: {
            lane: AutoRemediationDecisionLane.KubernetesCluster,
            id: OTHER_CLUSTER.toString(),
          },
        },
      ],
    );
  });

  test.each([
    [{ aiRemediationMode: "Disabled" }],
    [{ isAiInvestigationEnabled: false }],
    [{ lastSeenAt: new Date("2026-11-03T10:00:00.000Z") }],
  ])("%j hands nothing over", async (written: JSONObject) => {
    const turnedOn: SpyInstance<
      typeof AutoRemediationRuleEngineService.onFixesTurnedOn
    > = jest.spyOn(AutoRemediationRuleEngineService, "onFixesTurnedOn");
    const readProjectId: Mock<() => Promise<ObjectID>> = jest.fn(
      async (): Promise<ObjectID> => {
        return PROJECT_ID;
      },
    );

    expect(
      await AutoRemediationRuleEngineService.onFixesSettingWritten({
        lane: AutoRemediationDecisionLane.Resource,
        written,
        updatedIds: [new ObjectID(HOST_ID)],
        readProjectId,
      }),
    ).toBe(0);
    expect(readProjectId).not.toHaveBeenCalled();
    expect(turnedOn).not.toHaveBeenCalled();
  });

  test("a row whose project cannot be found, or read, is skipped; the rest are not", async () => {
    const turnedOn: SpyInstance<
      typeof AutoRemediationRuleEngineService.onFixesTurnedOn
    > = jest
      .spyOn(AutoRemediationRuleEngineService, "onFixesTurnedOn")
      .mockResolvedValue(1);
    const FIRST: ObjectID = new ObjectID(
      "dddddddd-dddd-4ddd-8ddd-000000000001",
    );
    const SECOND: ObjectID = new ObjectID(
      "dddddddd-dddd-4ddd-8ddd-000000000002",
    );
    const THIRD: ObjectID = new ObjectID(
      "dddddddd-dddd-4ddd-8ddd-000000000003",
    );

    const decided: number =
      await AutoRemediationRuleEngineService.onFixesSettingWritten({
        lane: AutoRemediationDecisionLane.Resource,
        written: { aiRemediationMode: "RequireApproval" },
        updatedIds: [FIRST, SECOND, THIRD],
        readProjectId: async (id: ObjectID): Promise<ObjectID | null> => {
          if (id.toString() === FIRST.toString()) {
            return null;
          }

          if (id.toString() === SECOND.toString()) {
            throw new Error("Postgres went away");
          }

          return PROJECT_ID;
        },
      });

    expect(decided).toBe(1);
    expect(turnedOn).toHaveBeenCalledTimes(1);
    expect(turnedOn.mock.calls[0]![0]).toEqual({
      projectId: PROJECT_ID,
      target: {
        lane: AutoRemediationDecisionLane.Resource,
        id: THIRD.toString(),
      },
    });
    expect(logger.error).toHaveBeenCalled();
  });
});
