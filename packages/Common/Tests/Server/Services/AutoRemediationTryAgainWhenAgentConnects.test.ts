import AutoRemediationRuleEngineService, {
  AGENT_NOT_CONNECTED_GAP_CODES,
  MAX_DECISIONS_READ_WHEN_FIXES_TURN_ON,
  MAX_SUBJECTS_TRIED_AGAIN_WHEN_FIXES_TURN_ON,
  REMEDIATION_RETRY_LOCK_NAMESPACE,
  RemediationFixesTarget,
  getAgentNotConnectedEntry,
  getNotReadyEntryMatch,
  getRemediationRetryLockKey,
} from "../../../Server/Services/AutoRemediationRuleEngineService";
import AutoRemediationDecisionService from "../../../Server/Services/AutoRemediationDecisionService";
import AlertService from "../../../Server/Services/AlertService";
import IncidentService from "../../../Server/Services/IncidentService";
import Semaphore from "../../../Server/Infrastructure/Semaphore";
import logger from "../../../Server/Utils/Logger";
import AutoRemediationDecision from "../../../Models/DatabaseModels/AutoRemediationDecision";
import {
  AutoRemediationDecisionEntry,
  AutoRemediationDecisionHelper,
  AutoRemediationDecisionLane,
  AutoRemediationDecisionReason,
  AutoRemediationDecisionStage,
} from "../../../Types/AutoRemediation/AutoRemediationDecision";
import {
  KubernetesAiAccessGapCode,
  KubernetesAiRemediationMode,
} from "../../../Types/Kubernetes/KubernetesClusterAiAccess";
import AiResourceType from "../../../Types/ResourceAiAgent/AiResourceType";
import {
  ResourceAiAccessGapCode,
  ResourceAiRemediationMode,
} from "../../../Types/ResourceAiAgent/ResourceAiAccess";
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
import type { SpyInstance } from "jest-mock";

/*
 * AN AI AGENT CONNECTING MAKES ONEUPTIME AI TRY AGAIN (#5367's follow-up).
 *
 * A cloud account's Fixes were on, its Cloud AI agent was not connected
 * yet (or a host's agent had stopped reporting), and an incident came in:
 * its Remediation step said "Fixes are on, but the AI agent is not
 * connected", and when the agent connected nothing decided again - only a
 * new incident got a fix round. Now an agent connecting (it registers, or
 * reports again after it had stopped) decides again about the open records
 * whose latest decision found it missing. These tests hold that, and its
 * limits:
 *
 *   - only the records whose latest evaluation found that target's agent
 *     missing (NotReady, with an ai_agent_not_connected or
 *     ai_agent_offline gap) - never one not ready for another reason, never
 *     another target's - the most recently decided first, each once, at
 *     most 25;
 *   - only while the record is open;
 *   - once for that decision: decided again inside the record's retry lock
 *     only while that same decision is still its latest, so two
 *     connections handled at once decide a record once, and a record
 *     decided since (by a link, Fixes turned on, a person's Try again) is
 *     never decided twice for the same cause;
 *   - without the lock, not at all; and it never throws into the agent's
 *     request.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
);
const CLOUD_ACCOUNT_ID: string = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
const HOST_ID: string = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const CLUSTER_ID: string = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

const ACCOUNT: RemediationFixesTarget = {
  lane: AutoRemediationDecisionLane.Resource,
  id: CLOUD_ACCOUNT_ID,
};
const CLUSTER: RemediationFixesTarget = {
  lane: AutoRemediationDecisionLane.KubernetesCluster,
  id: CLUSTER_ID,
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

function decisionId(index: number): ObjectID {
  return new ObjectID(
    `99999999-9999-4999-8999-${String(index).padStart(12, "0")}`,
  );
}

function gap(code: string): {
  code: string;
  title: string;
  nextStep: string;
} {
  return {
    code,
    title: `Gap ${code}`,
    nextStep: `Fix ${code}`,
  };
}

// The entry an evaluation writes when an account's agent is not connected.
const ACCOUNT_AGENT_MISSING: AutoRemediationDecisionEntry = {
  lane: AutoRemediationDecisionLane.Resource,
  reason: AutoRemediationDecisionReason.ResourceNotReady,
  resourceType: AiResourceType.AwsAccount,
  resourceId: CLOUD_ACCOUNT_ID,
  resourceName: "prod",
  remediationMode: ResourceAiRemediationMode.RequireApproval,
  gaps: [gap("ai_agent_not_connected")],
};

// The entry an evaluation writes when a cluster's agent stopped reporting.
const CLUSTER_AGENT_OFFLINE: AutoRemediationDecisionEntry = {
  lane: AutoRemediationDecisionLane.KubernetesCluster,
  reason: AutoRemediationDecisionReason.ClusterNotReady,
  kubernetesClusterId: CLUSTER_ID,
  kubernetesClusterName: "prod-eu",
  remediationMode: KubernetesAiRemediationMode.RequireApproval,
  gaps: [gap("ai_agent_offline")],
};

// A decision row, as the reads return it.
function decision(
  index: number,
  subject: { incidentId?: ObjectID; alertId?: ObjectID },
  entries: Array<AutoRemediationDecisionEntry> = [ACCOUNT_AGENT_MISSING],
): AutoRemediationDecision {
  const row: AutoRemediationDecision = new AutoRemediationDecision();
  row._id = decisionId(index).toString();
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
  lock: SpyInstance<typeof Semaphore.lock>;
  release: SpyInstance<typeof Semaphore.release>;
  applyToIncident: SpyInstance<
    typeof AutoRemediationRuleEngineService.applyRulesToIncidentById
  >;
  applyToAlert: SpyInstance<
    typeof AutoRemediationRuleEngineService.applyRulesToAlertById
  >;
}

function installSpies(data: {
  found: Array<AutoRemediationDecision>;
  // The latest decision of each record, by its id; default: the newest found.
  latest?: Map<string, AutoRemediationDecision | null>;
  resolved?: Set<string>;
  // What deciding again writes: the record's new latest decision.
  decideWrites?: (subjectId: string) => AutoRemediationDecision | null;
}): Spies {
  const written: Map<string, AutoRemediationDecision | null> = new Map();
  const held: Map<string, { released: Promise<void>; release: () => void }> =
    new Map();

  const latestOf: (query: JSONObject) => AutoRemediationDecision | null = (
    query: JSONObject,
  ): AutoRemediationDecision | null => {
    const id: string = String(
      query["incidentId"] || query["alertId"] || "",
    ).toLowerCase();

    if (written.has(id)) {
      return written.get(id) || null;
    }

    if (data.latest && data.latest.has(id)) {
      return data.latest.get(id) || null;
    }

    return (
      data.found.find((row: AutoRemediationDecision): boolean => {
        return (row.incidentId || row.alertId)?.toString() === id;
      }) || null
    );
  };

  const decide: (subjectId: string) => void = (subjectId: string): void => {
    if (data.decideWrites) {
      written.set(subjectId, data.decideWrites(subjectId));
    }
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
    /*
     * The lock as Valkey's is: one holder per key at a time, the next
     * waiting until it is released.
     */
    lock: jest.spyOn(Semaphore, "lock").mockImplementation((async (args: {
      key: string;
    }) => {
      while (held.has(args.key)) {
        await held.get(args.key)!.released;
      }

      let release: () => void = (): void => {};
      const released: Promise<void> = new Promise<void>(
        (resolve: () => void) => {
          release = resolve;
        },
      );

      held.set(args.key, { released, release });

      return { identifier: args.key };
    }) as never),
    release: jest
      .spyOn(Semaphore, "release")
      .mockImplementation((async (mutex: { identifier: string }) => {
        const holder: { release: () => void } | undefined = held.get(
          mutex.identifier,
        );

        held.delete(mutex.identifier);
        holder?.release();
      }) as never),
    applyToIncident: jest
      .spyOn(AutoRemediationRuleEngineService, "applyRulesToIncidentById")
      .mockImplementation((async (args: { incidentId: ObjectID }) => {
        decide(args.incidentId.toString());
      }) as never),
    applyToAlert: jest
      .spyOn(AutoRemediationRuleEngineService, "applyRulesToAlertById")
      .mockImplementation((async (args: { alertId: ObjectID }) => {
        decide(args.alertId.toString());
      }) as never),
  };
}

beforeEach(() => {
  jest.spyOn(logger, "warn").mockImplementation((): void => {});
  jest.spyOn(logger, "error").mockImplementation((): void => {});
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("which decisions waited for an AI agent", () => {
  test("the gaps that say an agent was not there are the ones both kinds of agent write", () => {
    expect([...AGENT_NOT_CONNECTED_GAP_CODES].sort()).toEqual([
      "ai_agent_not_connected",
      "ai_agent_offline",
    ]);

    // Spelled as the resource AI agents' and the Kubernetes AI agent's gaps spell them.
    const resourceCodes: Array<ResourceAiAccessGapCode> = [
      "ai_agent_not_connected",
      "ai_agent_offline",
    ];
    const clusterCodes: Array<KubernetesAiAccessGapCode> = [
      "ai_agent_not_connected",
      "ai_agent_offline",
    ];

    expect(resourceCodes).toEqual(clusterCodes);
    for (const code of AGENT_NOT_CONNECTED_GAP_CODES) {
      expect(resourceCodes as Array<string>).toContain(code);
    }
  });

  test("a resource's is found by its NotReady entry naming the resource, as the decisions store it", () => {
    const match: JSONObject = getNotReadyEntryMatch(ACCOUNT);
    const stored: JSONObject = AutoRemediationDecisionHelper.toJSON(
      ACCOUNT_AGENT_MISSING,
    );

    expect(match).toEqual({
      lane: AutoRemediationDecisionLane.Resource,
      reason: AutoRemediationDecisionReason.ResourceNotReady,
      resourceId: CLOUD_ACCOUNT_ID,
    });
    // Contained in what is stored: Postgres's @> finds it.
    for (const [key, value] of Object.entries(match)) {
      expect(stored[key]).toBe(value);
    }
  });

  test("a cluster's by its NotReady entry naming the cluster, and an id in capitals as stored, lower-cased", () => {
    expect(getNotReadyEntryMatch(CLUSTER)).toEqual({
      lane: AutoRemediationDecisionLane.KubernetesCluster,
      reason: AutoRemediationDecisionReason.ClusterNotReady,
      kubernetesClusterId: CLUSTER_ID,
    });
    expect(
      getNotReadyEntryMatch({ ...ACCOUNT, id: CLOUD_ACCOUNT_ID.toUpperCase() })[
        "resourceId"
      ],
    ).toBe(CLOUD_ACCOUNT_ID);
  });

  test("getAgentNotConnectedEntry: NotReady for this target with an agent gap, nothing else", () => {
    const stored: JSONArray = [
      AutoRemediationDecisionHelper.toJSON(ACCOUNT_AGENT_MISSING),
      AutoRemediationDecisionHelper.toJSON(CLUSTER_AGENT_OFFLINE),
    ] as JSONArray;

    expect(getAgentNotConnectedEntry(stored, ACCOUNT)?.resourceName).toBe(
      "prod",
    );
    expect(
      getAgentNotConnectedEntry(stored, CLUSTER)?.kubernetesClusterName,
    ).toBe("prod-eu");

    // Another resource's agent is not this one's.
    expect(
      getAgentNotConnectedEntry(stored, {
        lane: AutoRemediationDecisionLane.Resource,
        id: HOST_ID,
      }),
    ).toBeUndefined();
    // A cluster with the account's id is not the account.
    expect(
      getAgentNotConnectedEntry(stored, {
        lane: AutoRemediationDecisionLane.KubernetesCluster,
        id: CLOUD_ACCOUNT_ID,
      }),
    ).toBeUndefined();
    // The id is compared as the decisions store it.
    expect(
      getAgentNotConnectedEntry(stored, {
        ...ACCOUNT,
        id: CLOUD_ACCOUNT_ID.toUpperCase(),
      }),
    ).toBeDefined();
    expect(getAgentNotConnectedEntry(undefined, ACCOUNT)).toBeUndefined();
  });

  test.each([
    ["the agent never connected", "ai_agent_not_connected", true],
    ["the agent stopped reporting", "ai_agent_offline", true],
    [
      "the agent cannot reach what it serves",
      "ai_agent_unreachable_resource",
      false,
    ],
    [
      "the agent may not change anything",
      "remediation_write_access_missing",
      false,
    ],
    ["no LLM provider", "llm_provider_missing", false],
  ])(
    "a NotReady entry because %s: %s waits for the agent: %s",
    (_why: string, code: string, waits: boolean) => {
      const entries: JSONArray = [
        AutoRemediationDecisionHelper.toJSON({
          ...ACCOUNT_AGENT_MISSING,
          gaps: [gap(code)],
        }),
      ] as JSONArray;

      expect(Boolean(getAgentNotConnectedEntry(entries, ACCOUNT))).toBe(waits);
    },
  );

  test("an agent gap beside others still waits for the agent", () => {
    const entries: JSONArray = [
      AutoRemediationDecisionHelper.toJSON({
        ...ACCOUNT_AGENT_MISSING,
        gaps: [
          gap("remediation_write_access_missing"),
          gap("ai_agent_offline"),
        ],
      }),
    ] as JSONArray;

    expect(getAgentNotConnectedEntry(entries, ACCOUNT)).toBeDefined();
  });

  test("Fixes off, or a round started, is not waiting for the agent", () => {
    for (const reason of [
      AutoRemediationDecisionReason.ResourceFixesOff,
      AutoRemediationDecisionReason.ResourceRoundStarted,
      AutoRemediationDecisionReason.ResourceNotChosen,
    ]) {
      expect(
        getAgentNotConnectedEntry(
          [
            AutoRemediationDecisionHelper.toJSON({
              ...ACCOUNT_AGENT_MISSING,
              reason,
            }),
          ] as JSONArray,
          ACCOUNT,
        ),
      ).toBeUndefined();
    }
  });
});

describe("onAgentConnected: a cloud account's agent connects", () => {
  test("finds the evaluations that found its target not ready, in the project, newest first, as OneUptime", async () => {
    const spies: Spies = installSpies({
      found: [decision(1, { incidentId: incidentId(1) })],
    });

    await AutoRemediationRuleEngineService.onAgentConnected({
      projectId: PROJECT_ID,
      target: ACCOUNT,
    });

    const args: {
      query: JSONObject;
      sort: JSONObject;
      limit: number;
      props: JSONObject;
      select: JSONObject;
    } = spies.found.mock.calls[0]![0] as never;

    expect(args.query["projectId"]).toBe(PROJECT_ID);
    expect(args.query["stage"]).toBe(AutoRemediationDecisionStage.Evaluated);
    expect(args.sort).toEqual({ createdAt: SortOrder.Descending });
    expect(args.limit).toBe(MAX_DECISIONS_READ_WHEN_FIXES_TURN_ON);
    expect(args.props).toEqual({ isRoot: true });
    // The entries are read too: which gap made the target not ready.
    expect(args.select).toMatchObject({ _id: true, entries: true });

    // The entries holding the one entry: Postgres's @>, a bound parameter.
    const operator: { objectLiteralParameters?: JSONObject } = args.query[
      "entries"
    ] as never;
    const parameters: Array<unknown> = Object.values(
      operator.objectLiteralParameters || {},
    );

    expect(parameters).toHaveLength(1);
    expect(JSON.parse(String(parameters[0]))).toEqual([
      getNotReadyEntryMatch(ACCOUNT),
    ]);
  });

  test("decides again about the open incident that waited for it, as for a new one, under its retry lock", async () => {
    const spies: Spies = installSpies({
      found: [decision(1, { incidentId: incidentId(1) })],
    });

    const decided: number =
      await AutoRemediationRuleEngineService.onAgentConnected({
        projectId: PROJECT_ID,
        target: ACCOUNT,
      });

    expect(decided).toBe(1);
    expect(spies.applyToIncident).toHaveBeenCalledTimes(1);
    expect(spies.applyToIncident).toHaveBeenCalledWith({
      incidentId: incidentId(1),
      projectId: PROJECT_ID,
    });
    expect(spies.applyToAlert).not.toHaveBeenCalled();

    // The lock Try again and the other retries share, released after.
    expect(spies.lock).toHaveBeenCalledTimes(1);
    expect(spies.lock.mock.calls[0]![0]).toMatchObject({
      key: getRemediationRetryLockKey(incidentId(1)),
      namespace: REMEDIATION_RETRY_LOCK_NAMESPACE,
    });
    expect(spies.release).toHaveBeenCalledTimes(1);

    // Asked before the lock and again inside it.
    expect(spies.latest).toHaveBeenCalledTimes(2);
    expect(spies.latest.mock.calls[0]![0]).toMatchObject({
      query: {
        projectId: PROJECT_ID,
        stage: AutoRemediationDecisionStage.Evaluated,
        incidentId: incidentId(1),
      },
      sort: { createdAt: SortOrder.Descending },
      props: { isRoot: true },
    });
  });

  test("an alert that waited for it is decided again as an alert", async () => {
    const spies: Spies = installSpies({
      found: [decision(1, { alertId: alertId(1) })],
    });

    await AutoRemediationRuleEngineService.onAgentConnected({
      projectId: PROJECT_ID,
      target: ACCOUNT,
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

  test("a Kubernetes AI agent's cluster works the same way", async () => {
    const spies: Spies = installSpies({
      found: [
        decision(1, { incidentId: incidentId(1) }, [CLUSTER_AGENT_OFFLINE]),
      ],
    });

    const decided: number =
      await AutoRemediationRuleEngineService.onAgentConnected({
        projectId: PROJECT_ID,
        target: CLUSTER,
      });

    expect(decided).toBe(1);
    expect(spies.applyToIncident).toHaveBeenCalledWith({
      incidentId: incidentId(1),
      projectId: PROJECT_ID,
    });
  });

  test("never a closed one: a resolved incident is left as it is", async () => {
    const spies: Spies = installSpies({
      found: [
        decision(1, { incidentId: incidentId(1) }),
        decision(2, { incidentId: incidentId(2) }),
      ],
      resolved: new Set([incidentId(1).toString()]),
    });

    const decided: number =
      await AutoRemediationRuleEngineService.onAgentConnected({
        projectId: PROJECT_ID,
        target: ACCOUNT,
      });

    expect(decided).toBe(1);
    expect(spies.applyToIncident).toHaveBeenCalledTimes(1);
    expect(spies.applyToIncident).toHaveBeenCalledWith({
      incidentId: incidentId(2),
      projectId: PROJECT_ID,
    });
    // The resolved one is never even locked.
    expect(
      spies.lock.mock.calls.map((call: Array<unknown>): string => {
        return (call[0] as { key: string }).key;
      }),
    ).toEqual([getRemediationRetryLockKey(incidentId(2))]);
  });

  test("a resolved alert is left as it is too", async () => {
    const spies: Spies = installSpies({
      found: [decision(1, { alertId: alertId(1) })],
      resolved: new Set([alertId(1).toString()]),
    });

    expect(
      await AutoRemediationRuleEngineService.onAgentConnected({
        projectId: PROJECT_ID,
        target: ACCOUNT,
      }),
    ).toBe(0);
    expect(spies.applyToAlert).not.toHaveBeenCalled();
  });

  test("each record once, by its newest decision, the most recently decided first", async () => {
    const spies: Spies = installSpies({
      found: [
        decision(1, { incidentId: incidentId(2) }),
        decision(2, { alertId: alertId(1) }),
        decision(3, { incidentId: incidentId(2) }),
        decision(4, { incidentId: incidentId(1) }),
      ],
    });

    const decided: number =
      await AutoRemediationRuleEngineService.onAgentConnected({
        projectId: PROJECT_ID,
        target: ACCOUNT,
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

  test("a record whose newest such decision was not ready for another reason is not tried, whatever an older one said", async () => {
    const newerOtherReason: AutoRemediationDecision = decision(
      1,
      { incidentId: incidentId(1) },
      [
        {
          ...ACCOUNT_AGENT_MISSING,
          gaps: [gap("remediation_write_access_missing")],
        },
      ],
    );
    const spies: Spies = installSpies({
      found: [newerOtherReason, decision(2, { incidentId: incidentId(1) })],
    });

    expect(
      await AutoRemediationRuleEngineService.onAgentConnected({
        projectId: PROJECT_ID,
        target: ACCOUNT,
      }),
    ).toBe(0);
    expect(spies.lock).not.toHaveBeenCalled();
    expect(spies.applyToIncident).not.toHaveBeenCalled();
  });

  test(`at most ${MAX_SUBJECTS_TRIED_AGAIN_WHEN_FIXES_TURN_ON} records, the newest: an agent connecting never starts hundreds of fixes at once`, async () => {
    const spies: Spies = installSpies({
      found: Array.from(
        { length: MAX_SUBJECTS_TRIED_AGAIN_WHEN_FIXES_TURN_ON + 10 },
        (_value: unknown, index: number): AutoRemediationDecision => {
          return decision(index, { incidentId: incidentId(index) });
        },
      ),
    });

    const decided: number =
      await AutoRemediationRuleEngineService.onAgentConnected({
        projectId: PROJECT_ID,
        target: ACCOUNT,
      });

    expect(MAX_SUBJECTS_TRIED_AGAIN_WHEN_FIXES_TURN_ON).toBe(25);
    expect(decided).toBe(MAX_SUBJECTS_TRIED_AGAIN_WHEN_FIXES_TURN_ON);
    expect(spies.applyToIncident).toHaveBeenCalledTimes(
      MAX_SUBJECTS_TRIED_AGAIN_WHEN_FIXES_TURN_ON,
    );
    expect(spies.applyToIncident.mock.calls[0]![0]).toEqual({
      incidentId: incidentId(0),
      projectId: PROJECT_ID,
    });
  });

  test("a record decided again since - by a link, Fixes turned on or Try again - is left as it is", async () => {
    const newer: AutoRemediationDecision = decision(
      7,
      { incidentId: incidentId(1) },
      [
        {
          lane: AutoRemediationDecisionLane.Resource,
          reason: AutoRemediationDecisionReason.ResourceRoundStarted,
          resourceId: CLOUD_ACCOUNT_ID,
        },
      ],
    );
    const spies: Spies = installSpies({
      found: [decision(1, { incidentId: incidentId(1) })],
      latest: new Map([[incidentId(1).toString(), newer]]),
    });

    expect(
      await AutoRemediationRuleEngineService.onAgentConnected({
        projectId: PROJECT_ID,
        target: ACCOUNT,
      }),
    ).toBe(0);
    expect(spies.lock).not.toHaveBeenCalled();
    expect(spies.applyToIncident).not.toHaveBeenCalled();
  });

  test("never twice for the same cause: a newer decision that again found the agent missing is not the one this connection waited on", async () => {
    // Its latest decision is a newer one, which ALSO says the agent is missing.
    const newerAlsoMissing: AutoRemediationDecision = decision(8, {
      incidentId: incidentId(1),
    });
    const spies: Spies = installSpies({
      found: [decision(1, { incidentId: incidentId(1) })],
      latest: new Map([[incidentId(1).toString(), newerAlsoMissing]]),
    });

    expect(
      await AutoRemediationRuleEngineService.onAgentConnected({
        projectId: PROJECT_ID,
        target: ACCOUNT,
      }),
    ).toBe(0);
    expect(spies.applyToIncident).not.toHaveBeenCalled();
  });

  test("two connections handled at once - a registration and a heartbeat on two servers - decide a record once", async () => {
    // Deciding again writes a new decision, which again finds the agent missing.
    const spies: Spies = installSpies({
      found: [decision(1, { incidentId: incidentId(1) })],
      decideWrites: (subjectId: string): AutoRemediationDecision => {
        return decision(50, { incidentId: new ObjectID(subjectId) });
      },
    });

    const decided: Array<number> = await Promise.all([
      AutoRemediationRuleEngineService.onAgentConnected({
        projectId: PROJECT_ID,
        target: ACCOUNT,
      }),
      AutoRemediationRuleEngineService.onAgentConnected({
        projectId: PROJECT_ID,
        target: ACCOUNT,
      }),
    ]);

    expect(
      decided.reduce((sum: number, count: number): number => {
        return sum + count;
      }, 0),
    ).toBe(1);
    expect(spies.applyToIncident).toHaveBeenCalledTimes(1);
  });

  test("the record's next connection after that decides again: a new decision is a new cause", async () => {
    let written: number = 0;
    const spies: Spies = installSpies({
      found: [decision(1, { incidentId: incidentId(1) })],
      decideWrites: (subjectId: string): AutoRemediationDecision => {
        written++;
        return decision(100 + written, {
          incidentId: new ObjectID(subjectId),
        });
      },
    });

    expect(
      await AutoRemediationRuleEngineService.onAgentConnected({
        projectId: PROJECT_ID,
        target: ACCOUNT,
      }),
    ).toBe(1);

    // The agent dropped, an evaluation found it missing again, it connected again.
    spies.found.mockResolvedValue([
      decision(101, { incidentId: incidentId(1) }),
    ] as never);

    expect(
      await AutoRemediationRuleEngineService.onAgentConnected({
        projectId: PROJECT_ID,
        target: ACCOUNT,
      }),
    ).toBe(1);
    expect(spies.applyToIncident).toHaveBeenCalledTimes(2);
  });

  test("another target's agent connecting decides nothing here", async () => {
    const spies: Spies = installSpies({
      found: [decision(1, { incidentId: incidentId(1) })],
    });

    expect(
      await AutoRemediationRuleEngineService.onAgentConnected({
        projectId: PROJECT_ID,
        target: { lane: AutoRemediationDecisionLane.Resource, id: HOST_ID },
      }),
    ).toBe(0);
    expect(spies.applyToIncident).not.toHaveBeenCalled();
  });

  test("without the lock (Valkey unreachable) it does not decide again, rather than risk two fixes at once", async () => {
    const spies: Spies = installSpies({
      found: [decision(1, { incidentId: incidentId(1) })],
    });
    spies.lock.mockRejectedValue(new Error("Valkey is unreachable"));

    expect(
      await AutoRemediationRuleEngineService.onAgentConnected({
        projectId: PROJECT_ID,
        target: ACCOUNT,
      }),
    ).toBe(0);
    expect(spies.applyToIncident).not.toHaveBeenCalled();
    expect(spies.release).not.toHaveBeenCalled();
  });

  test("a target id that is not an id reads nothing", async () => {
    const spies: Spies = installSpies({
      found: [decision(1, { incidentId: incidentId(1) })],
    });

    expect(
      await AutoRemediationRuleEngineService.onAgentConnected({
        projectId: PROJECT_ID,
        target: { lane: AutoRemediationDecisionLane.Resource, id: "prod" },
      }),
    ).toBe(0);
    expect(spies.found).not.toHaveBeenCalled();
  });

  test("never throws into the agent's request: a read that fails decides nothing and is logged", async () => {
    const spies: Spies = installSpies({ found: [] });
    spies.found.mockRejectedValue(new Error("Postgres is down"));

    await expect(
      AutoRemediationRuleEngineService.onAgentConnected({
        projectId: PROJECT_ID,
        target: ACCOUNT,
      }),
    ).resolves.toBe(0);
    expect(logger.error).toHaveBeenCalled();
  });

  test("a decision with no record to decide about is skipped", async () => {
    const orphan: AutoRemediationDecision = decision(1, {});
    const spies: Spies = installSpies({ found: [orphan] });

    expect(
      await AutoRemediationRuleEngineService.onAgentConnected({
        projectId: PROJECT_ID,
        target: ACCOUNT,
      }),
    ).toBe(0);
    expect(spies.lock).not.toHaveBeenCalled();
  });
});
