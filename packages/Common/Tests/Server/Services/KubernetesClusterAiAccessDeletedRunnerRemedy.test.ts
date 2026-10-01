import KubernetesClusterAiAccessService, {
  AI_AGENT_INSTALL_COMMAND,
  KubernetesAgentRegistrationRefusedException,
  KubernetesClusterAiAccessProjectGates,
  RegisterKubernetesAgentRunnerResult,
  getDeletedAgentRunnerRebindNote,
  getKubernetesAgentRunnerNameForCluster,
} from "../../../Server/Services/KubernetesClusterAiAccessService";
import KubernetesAiAgentService from "../../../Server/Services/KubernetesAiAgentService";
import KubernetesClusterFeedService from "../../../Server/Services/KubernetesClusterFeedService";
import KubernetesClusterService from "../../../Server/Services/KubernetesClusterService";
import RunbookCredentialService from "../../../Server/Services/RunbookCredentialService";
import RunbookSecretService from "../../../Server/Services/RunbookSecretService";
import RunnerService from "../../../Server/Services/RunnerService";
import logger from "../../../Server/Utils/Logger";
import KubernetesAiAgent from "../../../Models/DatabaseModels/KubernetesAiAgent";
import KubernetesCluster from "../../../Models/DatabaseModels/KubernetesCluster";
import Runner, {
  RunnerConnectionStatus,
} from "../../../Models/DatabaseModels/Runner";
import OneUptimeDate from "../../../Types/Date";
import ObjectID from "../../../Types/ObjectID";
import PositiveNumber from "../../../Types/PositiveNumber";
import {
  KubernetesAiAccessGap,
  KubernetesAiRemediationMode,
  KubernetesClusterAiAccessStatus,
} from "../../../Types/Kubernetes/KubernetesClusterAiAccess";
import { afterEach, beforeEach, describe, expect, it } from "@jest/globals";

/*
 * ---------------------------------------------------------------------------
 * Contract under test — how a cluster recovers from a stuck previous
 * in-cluster Runner, walked end to end against the real status computation
 * and the real registration.
 *
 * An offline previous in-cluster Runner (older charts) that holds more than
 * the agent defaults is refused on every registration its restarted pod
 * attempts. The way out the texts lead with is the chart upgrade: the
 * Kubernetes AI agent replaces the Runner, needs none of what it holds, and
 * takes over the moment it is online (resolveKubernetesAiAccessTarget).
 * Removing what the Runner holds still brings the same Runner back, still
 * bound. Deleting it leaves the cluster unbound (the binding's foreign key
 * is ON DELETE SET NULL and registration never re-binds a cluster that had
 * a Runner), and such a cluster is then reached through its AI agent — not
 * by selecting a Runner on a page.
 *
 * The database is a small in-memory stand-in: one cluster row, the Runner
 * rows, the cluster's agent row, and the FK's ON DELETE SET NULL applied by
 * deleteRunner().
 * ---------------------------------------------------------------------------
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "22222222-2222-4222-8222-222222222222",
);
const CLUSTER_ID: ObjectID = new ObjectID(
  "33333333-3333-4333-8333-333333333333",
);
const AGENT_RUNNER_ID: ObjectID = new ObjectID(
  "44444444-4444-4444-8444-444444444444",
);
const FRESH_RUNNER_ID: ObjectID = new ObjectID(
  "77777777-7777-4777-8777-777777777777",
);
const OTHER_RUNNER_ID: ObjectID = new ObjectID(
  "66666666-6666-4666-8666-666666666666",
);
const AI_AGENT_ID: ObjectID = new ObjectID(
  "88888888-8888-4888-8888-888888888888",
);

const AGENT_RUNNER_NAME: string =
  getKubernetesAgentRunnerNameForCluster("prod-us");

const READY_GATES: KubernetesClusterAiAccessProjectGates = {
  isAiEnabled: true,
  isAutoRemediationEnabled: true,
  isAiCommandExecutionEnabled: true,
  hasLlmProvider: true,
};

// The step every text leads with now.
const UPGRADE_STEP: string = "Upgrade the Kubernetes agent chart";

// Who may bind a Runner again.
const REBIND_PERMISSIONS: string =
  "binding a Runner again needs one of these permissions: Project Owner, Project Admin, Edit Auto Remediation Rule.";

interface FakeDatabase {
  cluster: KubernetesCluster;
  // The cluster's Kubernetes AI agent row, once the chart installs it.
  aiAgent: KubernetesAiAgent | null;
  runners: Array<Runner>;
  // Runner credentials assigned, by Runner id.
  assignedCredentials: Map<string, number>;
  clusterUpdates: Array<Record<string, unknown>>;
  runnerUpdates: Array<{ id: string; data: Record<string, unknown> }>;
  createdRunners: Array<Runner>;
}

function boundCluster(
  overrides: Partial<Record<string, unknown>> = {},
): KubernetesCluster {
  return {
    id: CLUSTER_ID,
    _id: CLUSTER_ID.toString(),
    projectId: PROJECT_ID,
    name: "prod-us",
    clusterIdentifier: "prod-us",
    aiAccessRunnerId: AGENT_RUNNER_ID,
    aiAccessCredentialId: undefined,
    isAiInvestigationEnabled: true,
    aiRemediationMode: KubernetesAiRemediationMode.RequireApproval,
    aiKubectlCommandAllowlist: undefined,
    aiAccessConfiguredAt: OneUptimeDate.getSomeMinutesAgo(60 * 24),
    aiAccessRunnerBoundAt: OneUptimeDate.getSomeMinutesAgo(60 * 24),
    aiAccessLastVerifiedAt: OneUptimeDate.getSomeMinutesAgo(60),
    aiAccessLastError: undefined,
    ...overrides,
  } as unknown as KubernetesCluster;
}

// This cluster's agent Runner, offline since its pod was replaced.
function offlineAgentRunner(
  overrides: Partial<Record<string, unknown>> = {},
): Runner {
  return {
    id: AGENT_RUNNER_ID,
    _id: AGENT_RUNNER_ID.toString(),
    projectId: PROJECT_ID,
    name: AGENT_RUNNER_NAME,
    key: "key-the-old-pod-held",
    lastAlive: OneUptimeDate.getSomeMinutesAgo(30),
    connectionStatus: RunnerConnectionStatus.Disconnected,
    canRunAiCommands: true,
    canRunRunbooks: false,
    canRunCodeFixTasks: false,
    hostInfo: {
      kubernetes: {
        inCluster: true,
        allowWrites: true,
        clusterIdentifier: "prod-us",
      },
    },
    ...overrides,
  } as unknown as Runner;
}

function nameLookedUp(query: Record<string, unknown>): string | undefined {
  const nameFilter: { objectLiteralParameters?: Record<string, unknown> } =
    query["name"] as { objectLiteralParameters?: Record<string, unknown> };
  const lookedUp: unknown = Object.values(
    nameFilter?.objectLiteralParameters || {},
  )[0];

  return typeof lookedUp === "string" ? lookedUp : undefined;
}

function installFakeDatabase(database: FakeDatabase): void {
  jest
    .spyOn(KubernetesClusterService, "findOrCreateByClusterIdentifier")
    .mockImplementation(async (): Promise<KubernetesCluster> => {
      return { ...database.cluster } as KubernetesCluster;
    });
  jest
    .spyOn(KubernetesClusterService, "findOneBy")
    .mockImplementation(async (): Promise<KubernetesCluster> => {
      return { ...database.cluster } as KubernetesCluster;
    });
  jest
    .spyOn(KubernetesClusterService, "updateOneById")
    .mockImplementation(async (args: unknown): Promise<never> => {
      const data: Record<string, unknown> = (
        args as { data: Record<string, unknown> }
      ).data;
      database.clusterUpdates.push(data);
      database.cluster = {
        ...database.cluster,
        ...data,
      } as unknown as KubernetesCluster;
      return undefined as never;
    });
  // No OTHER cluster is bound to the agent Runner.
  jest
    .spyOn(KubernetesClusterService, "countBy")
    .mockResolvedValue(new PositiveNumber(0));

  jest
    .spyOn(RunnerService, "findOneBy")
    .mockImplementation(async (args: unknown): Promise<Runner | null> => {
      const query: Record<string, unknown> = (
        args as { query: Record<string, unknown> }
      ).query;

      if (query["_id"]) {
        return (
          database.runners.find((runner: Runner) => {
            return runner.id!.toString() === String(query["_id"]);
          }) || null
        );
      }

      const name: string | undefined = nameLookedUp(query);

      return (
        database.runners.find((runner: Runner) => {
          return (runner.name || "").trim().toLowerCase() === name;
        }) || null
      );
    });
  jest
    .spyOn(RunnerService, "create")
    .mockImplementation(async (args: unknown): Promise<Runner> => {
      const data: Runner = (args as { data: Runner }).data;
      data.id = FRESH_RUNNER_ID;
      database.createdRunners.push(data);
      database.runners.push(data);
      return data;
    });
  jest
    .spyOn(RunnerService, "updateOneById")
    .mockImplementation(async (args: unknown): Promise<never> => {
      const call: { id: ObjectID; data: Record<string, unknown> } = args as {
        id: ObjectID;
        data: Record<string, unknown>;
      };
      database.runnerUpdates.push({ id: call.id.toString(), data: call.data });
      return undefined as never;
    });
  // Neither brake on minting agent Runner rows is near.
  jest.spyOn(RunnerService, "countBy").mockResolvedValue(new PositiveNumber(0));

  jest
    .spyOn(RunbookCredentialService, "countBy")
    .mockImplementation(async (args: unknown): Promise<PositiveNumber> => {
      // QueryHelper.inRelationArray: the Runner ids, as ObjectIDs.
      const runnerIds: Array<string> = (
        (args as { query: Record<string, unknown> }).query[
          "runners"
        ] as Array<unknown>
      ).map((runnerId: unknown) => {
        return String(runnerId);
      });
      let count: number = 0;

      for (const runnerId of runnerIds) {
        count += database.assignedCredentials.get(runnerId) || 0;
      }

      return new PositiveNumber(count);
    });
  jest
    .spyOn(RunbookSecretService, "countBy")
    .mockResolvedValue(new PositiveNumber(0));

  jest
    .spyOn(KubernetesClusterFeedService, "createKubernetesClusterFeedItem")
    .mockImplementation(async (): Promise<void> => {
      return undefined;
    });
  jest
    .spyOn(KubernetesAiAgentService, "findForCluster")
    .mockImplementation(async (): Promise<KubernetesAiAgent | null> => {
      return database.aiAgent;
    });
}

// The chart upgrade: the Kubernetes AI agent registers and is online.
function installAiAgent(database: FakeDatabase): void {
  database.aiAgent = {
    id: AI_AGENT_ID,
    _id: AI_AGENT_ID.toString(),
    projectId: PROJECT_ID,
    kubernetesClusterId: CLUSTER_ID,
    connectionStatus: "connected",
    lastAliveAt: OneUptimeDate.getCurrentDate(),
    posture: {
      inCluster: true,
      allowWrites: true,
      clusterIdentifier: "prod-us",
    },
  } as unknown as KubernetesAiAgent;
}

/*
 * What deleting a Runner under Runbooks → Runners does to these
 * rows: the Runner row goes, and the binding's foreign key (ON DELETE SET
 * NULL) clears aiAccessRunnerId in the same statement. aiAccessRunnerBoundAt
 * is never cleared — that is what registration reads as "a Runner was bound
 * here before".
 */
function deleteRunner(database: FakeDatabase, runnerId: ObjectID): void {
  database.runners = database.runners.filter((runner: Runner) => {
    return runner.id!.toString() !== runnerId.toString();
  });
  database.assignedCredentials.delete(runnerId.toString());

  if (database.cluster.aiAccessRunnerId?.toString() === runnerId.toString()) {
    database.cluster = {
      ...database.cluster,
      aiAccessRunnerId: null,
    } as unknown as KubernetesCluster;
  }
}

async function statusOf(
  database: FakeDatabase,
): Promise<KubernetesClusterAiAccessStatus> {
  return KubernetesClusterAiAccessService.getStatusForClusterModel({
    cluster: { ...database.cluster } as KubernetesCluster,
    gates: READY_GATES,
  });
}

function gapWithCode(
  status: KubernetesClusterAiAccessStatus,
  code: string,
): KubernetesAiAccessGap {
  const gap: KubernetesAiAccessGap | undefined = status.gaps.find(
    (candidate: KubernetesAiAccessGap) => {
      return candidate.code === code;
    },
  );

  if (!gap) {
    throw new Error(
      `No ${code} gap; the gaps were: ${JSON.stringify(status.gaps)}`,
    );
  }

  return gap;
}

// A restarted pod: it holds no key, so it cannot prove continuity.
function registerRestartedPod(): Promise<RegisterKubernetesAgentRunnerResult> {
  return KubernetesClusterAiAccessService.registerKubernetesAgentRunner({
    projectId: PROJECT_ID,
    clusterIdentifier: "prod-us",
    posture: { allowWrites: true },
  });
}

async function refusalOf(
  promise: Promise<unknown>,
): Promise<KubernetesAgentRegistrationRefusedException> {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(KubernetesAgentRegistrationRefusedException);
    return error as KubernetesAgentRegistrationRefusedException;
  }

  throw new Error("The registration was admitted; a refusal was expected.");
}

describe("recovering from a previous in-cluster Runner that holds more than the defaults", () => {
  let database: FakeDatabase;

  beforeEach(() => {
    for (const level of ["warn", "info", "error"] as const) {
      jest.spyOn(logger, level).mockImplementation((): void => {
        return undefined;
      });
    }

    // A Runner credential was assigned to the agent Runner before the guards.
    database = {
      cluster: boundCluster(),
      aiAgent: null,
      runners: [offlineAgentRunner()],
      assignedCredentials: new Map<string, number>([
        [AGENT_RUNNER_ID.toString(), 1],
      ]),
      clusterUpdates: [],
      runnerUpdates: [],
      createdRunners: [],
    };
    installFakeDatabase(database);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("the gap leads with the chart upgrade to the AI agent, never with the Runner's holdings", async () => {
    const gap: KubernetesAiAccessGap = gapWithCode(
      await statusOf(database),
      "runner_offline",
    );

    expect(gap.title).toBe("The previous in-cluster Runner signed off");
    expect(gap.nextStep.startsWith(UPGRADE_STEP)).toBe(true);
    expect(gap.nextStep).toContain(AI_AGENT_INSTALL_COMMAND);
    expect(gap.nextStep).not.toContain("unassign");
    expect(gap.nextStep).not.toContain("AI page as its Runner");
  });

  it("the refusal the Runner logs leads with the upgrade, then the removal, within the part it logs", async () => {
    const refusal: KubernetesAgentRegistrationRefusedException =
      await refusalOf(registerRestartedPod());

    expect(refusal.reason).toBe("runner_holds_more_than_defaults");
    const head: string = refusal.message.slice(0, 500);
    expect(head.startsWith(UPGRADE_STEP)).toBe(true);
    expect(head).toContain(
      'Or, under Runbooks → Runners, on Runner "kubernetes-agent/prod-us": unassign its 1 Runner credential(s).',
    );
    expect(refusal.message).not.toContain("AI page");
    // Nothing was written by the refused registration.
    expect(database.runnerUpdates).toEqual([]);
    expect(database.createdRunners).toEqual([]);
    expect(database.clusterUpdates).toEqual([]);
  });

  /*
   * The path the texts lead with, step by step: the chart upgrade installs
   * the Kubernetes AI agent, which is the cluster's target the moment it is
   * online — and from then on the stuck Runner's pod (if an old chart still
   * runs it somewhere) is refused as superseded, not as holding too much.
   */
  it("following the upgrade: the AI agent serves the cluster and the old Runner is superseded", async () => {
    installAiAgent(database);

    const status: KubernetesClusterAiAccessStatus = await statusOf(database);
    expect(status.gaps).toEqual([]);
    expect(status.runner?.kind).toBe("ai_agent");
    expect(status.isInvestigationReady).toBe(true);

    const refusal: KubernetesAgentRegistrationRefusedException =
      await refusalOf(registerRestartedPod());
    expect(refusal.reason).toBe("superseded_by_ai_agent");
    expect(refusal.retryAfterSeconds).toBe(60);
  });

  /*
   * The other way out keeps the binding: once the holdings are gone the
   * restarted pod re-keys the same row, and the cluster is still bound to it.
   */
  it("following the removal path: the same Runner comes back and the cluster is still bound to it", async () => {
    database.assignedCredentials.clear();

    const result: RegisterKubernetesAgentRunnerResult =
      await registerRestartedPod();

    expect(result.bindingState).toBe("already_bound");
    expect(result.isBoundToCluster).toBe(true);
    expect(result.runnerId.toString()).toBe(AGENT_RUNNER_ID.toString());
    expect(database.runnerUpdates).toHaveLength(1);
    expect(database.createdRunners).toEqual([]);
    expect(database.clusterUpdates).toEqual([]);
  });

  /*
   * Deleting the Runner leaves the cluster unbound for good (the sticky
   * no-rebind rule), and the status then asks for the AI agent — which
   * serves the cluster as soon as it is installed.
   */
  it("following a delete: the fresh Runner registers unbound, and the cluster is reached through its AI agent", async () => {
    deleteRunner(database, AGENT_RUNNER_ID);
    expect(database.cluster.aiAccessRunnerId).toBeNull();

    const result: RegisterKubernetesAgentRunnerResult =
      await registerRestartedPod();

    expect(result.bindingState).toBe("left_unbound_by_operator");
    expect(result.isBoundToCluster).toBe(false);
    expect(result.runnerId.toString()).toBe(FRESH_RUNNER_ID.toString());
    for (const update of database.clusterUpdates) {
      expect(update).not.toHaveProperty("aiAccessRunnerId");
    }

    const before: KubernetesClusterAiAccessStatus = await statusOf(database);
    expect(gapWithCode(before, "ai_agent_not_connected").nextStep).toContain(
      AI_AGENT_INSTALL_COMMAND,
    );

    installAiAgent(database);

    const after: KubernetesClusterAiAccessStatus = await statusOf(database);
    expect(after.gaps).toEqual([]);
    expect(after.runner?.kind).toBe("ai_agent");
  });

  it("negative control: a cluster with no binding history first-binds the fresh Runner", async () => {
    deleteRunner(database, AGENT_RUNNER_ID);
    database.cluster = boundCluster({
      aiAccessRunnerId: null,
      aiAccessRunnerBoundAt: undefined,
      aiAccessConfiguredAt: undefined,
      aiAccessLastVerifiedAt: undefined,
      aiAccessLastError: undefined,
    });

    const result: RegisterKubernetesAgentRunnerResult =
      await registerRestartedPod();

    expect(result.bindingState).toBe("first_bind");
    expect(result.isBoundToCluster).toBe(true);
    expect(database.clusterUpdates).toHaveLength(1);
    expect(database.clusterUpdates[0]!["aiAccessRunnerId"]).toEqual(
      FRESH_RUNNER_ID,
    );
  });

  it("the shared note says the clusters use their AI agent, and names who may bind a Runner again", () => {
    expect(getDeletedAgentRunnerRebindNote()).toBe(
      `Deleting a Runner leaves the clusters it was bound to with no Runner bound; they then use their Kubernetes AI agent (upgrade the Kubernetes agent chart to install it). A registering Runner never binds a cluster that had one, and ${REBIND_PERMISSIONS}`,
    );
  });
});

/*
 * The runner_belongs_to_another_cluster refusal: an operator cannot rename
 * an agent-named Runner (RunnerService refuses a non-root rename of one),
 * and the Kubernetes AI agent does not use Runner names at all — so the
 * step it leads with is the chart upgrade.
 */
describe("the runner_belongs_to_another_cluster refusal", () => {
  let database: FakeDatabase;

  beforeEach(() => {
    for (const level of ["warn", "info", "error"] as const) {
      jest.spyOn(logger, level).mockImplementation((): void => {
        return undefined;
      });
    }

    database = {
      cluster: boundCluster(),
      aiAgent: null,
      runners: [
        offlineAgentRunner({
          hostInfo: {
            kubernetes: { inCluster: true, clusterIdentifier: "prod-eu" },
          },
        }),
      ],
      assignedCredentials: new Map<string, number>(),
      clusterUpdates: [],
      runnerUpdates: [],
      createdRunners: [],
    };
    installFakeDatabase(database);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("leads with the chart upgrade and says the AI agent does not need that Runner", async () => {
    const refusal: KubernetesAgentRegistrationRefusedException =
      await refusalOf(registerRestartedPod());

    expect(refusal.reason).toBe("runner_belongs_to_another_cluster");
    expect(refusal.message).toMatch(
      /^Upgrade the Kubernetes agent chart of cluster "prod-us": its Kubernetes AI agent replaces the in-cluster Runner and does not need Runner "kubernetes-agent\/prod-us"\./,
    );
    expect(refusal.message).not.toContain("Rename or delete");
    expect(refusal.message).not.toContain("AI page");
  });

  it("following it: once the AI agent is online the old name no longer matters", async () => {
    installAiAgent(database);

    const status: KubernetesClusterAiAccessStatus = await statusOf({
      ...database,
      cluster: boundCluster({ aiAccessRunnerId: null }),
    });

    expect(status.runner?.kind).toBe("ai_agent");
    expect(status.gaps).toEqual([]);
  });
});

/*
 * A cluster BOUND to another cluster's in-cluster Runner: that Runner can
 * never reach this cluster, so it is no access target. Registration still
 * never replaces a cluster's binding (bound_to_other_runner), and the
 * cluster is reached through its own Kubernetes AI agent.
 */
describe("a cluster bound to another cluster's in-cluster Runner", () => {
  let database: FakeDatabase;

  beforeEach(() => {
    jest.spyOn(logger, "error").mockImplementation((): void => {
      return undefined;
    });
    jest.spyOn(logger, "info").mockImplementation((): void => {
      return undefined;
    });

    database = {
      cluster: boundCluster({ aiAccessRunnerId: OTHER_RUNNER_ID }),
      aiAgent: null,
      runners: [
        offlineAgentRunner({
          id: OTHER_RUNNER_ID,
          _id: OTHER_RUNNER_ID.toString(),
          name: getKubernetesAgentRunnerNameForCluster("prod-eu"),
          lastAlive: OneUptimeDate.getCurrentDate(),
          connectionStatus: RunnerConnectionStatus.Connected,
          hostInfo: {
            kubernetes: {
              inCluster: true,
              allowWrites: true,
              clusterIdentifier: "prod-eu",
            },
          },
        }),
      ],
      assignedCredentials: new Map<string, number>(),
      clusterUpdates: [],
      runnerUpdates: [],
      createdRunners: [],
    };
    installFakeDatabase(database);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("reads as not connected, with the install step, until the AI agent is installed", async () => {
    const before: KubernetesClusterAiAccessStatus = await statusOf(database);
    expect(gapWithCode(before, "ai_agent_not_connected").nextStep).toContain(
      AI_AGENT_INSTALL_COMMAND,
    );
    expect(before.runner).toBeNull();

    installAiAgent(database);

    const after: KubernetesClusterAiAccessStatus = await statusOf(database);
    expect(after.gaps).toEqual([]);
    expect(after.runner?.kind).toBe("ai_agent");
  });

  it("the previous in-cluster Runner registering here still does not steal the binding", async () => {
    const result: RegisterKubernetesAgentRunnerResult =
      await registerRestartedPod();

    expect(result.bindingState).toBe("bound_to_other_runner");
    expect(result.isBoundToCluster).toBe(false);
    expect(database.cluster.aiAccessRunnerId!.toString()).toBe(
      OTHER_RUNNER_ID.toString(),
    );
    expect(database.clusterUpdates).toEqual([]);
  });
});
