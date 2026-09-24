import KubernetesClusterAiAccessService, {
  KubernetesAgentRegistrationRefusedException,
  KubernetesClusterAiAccessProjectGates,
  RegisterKubernetesAgentRunnerResult,
  getDeletedAgentRunnerRebindNote,
  getKubernetesAgentRunnerNameForCluster,
} from "../../../Server/Services/KubernetesClusterAiAccessService";
import KubernetesClusterFeedService from "../../../Server/Services/KubernetesClusterFeedService";
import KubernetesClusterService from "../../../Server/Services/KubernetesClusterService";
import RunbookCredentialService from "../../../Server/Services/RunbookCredentialService";
import RunbookSecretService from "../../../Server/Services/RunbookSecretService";
import RunnerService from "../../../Server/Services/RunnerService";
import logger from "../../../Server/Utils/Logger";
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
 * Contract under test — what the "delete the Runner" remedy promises, walked
 * end to end against the real status computation and the real registration.
 *
 * An offline agent Runner that holds more than the agent defaults is refused
 * on every registration its restarted pod attempts. Two texts tell the
 * operator how to recover: the cluster's holdings gap and the registration
 * refusal the Runner logs. Both offer two ways out:
 *
 *   - remove what the Runner holds: the Runner row survives, its restarted
 *     pod re-keys it, and the cluster is still bound to it;
 *   - delete the Runner: the binding's foreign key is ON DELETE SET NULL, so
 *     the cluster is left with no Runner bound, and a registration never
 *     binds a cluster that had one (left_unbound_by_operator, deliberate).
 *     The fresh Runner the agent registers is therefore used only once
 *     someone selects it on the cluster's AI page — a loosening that needs
 *     Project Owner, Project Admin or Edit Auto Remediation Rule.
 *
 * Round three said "delete the Runner, and the in-cluster Runner registers a
 * fresh one within a minute" and stopped there, which left the operator with
 * an unbound cluster and AI investigations on telemetry only.
 *
 * The database is a small in-memory stand-in: one cluster row, the Runner
 * rows, and the FK's ON DELETE SET NULL applied by deleteRunner().
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

const AGENT_RUNNER_NAME: string =
  getKubernetesAgentRunnerNameForCluster("prod-us");

const READY_GATES: KubernetesClusterAiAccessProjectGates = {
  isAiEnabled: true,
  isAutoRemediationEnabled: true,
  isAiCommandExecutionEnabled: true,
  hasLlmProvider: true,
};

// The second step, as the texts must say it.
const SELECT_STEP: string = "select it on the cluster's AI page as its Runner";

// Who may take that step.
const REBIND_PERMISSIONS: string =
  "Selecting a Runner needs one of these permissions: Project Owner, Project Admin, Edit Auto Remediation Rule.";

interface FakeDatabase {
  cluster: KubernetesCluster;
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
}

/*
 * What deleting a Runner under Project Settings → Runners does to these
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

describe("the delete-the-Runner remedy for an agent Runner that holds more than the defaults", () => {
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

  it("the gap leads with removing the holdings, then names the delete path's second step and who may take it", async () => {
    const gap: KubernetesAiAccessGap = gapWithCode(
      await statusOf(database),
      "runner_offline",
    );

    expect(gap.title).toContain("cannot re-register");
    expect(gap.nextStep).toMatch(
      /^Under Project Settings → Runners, on Runner "kubernetes-agent\/prod-us": unassign its 1 Runner credential\(s\)\. The in-cluster Runner then reconnects on its next retry, still bound to this cluster\. Or delete the Runner/,
    );
    expect(gap.nextStep).toContain(
      `Or delete the Runner and, once the in-cluster Runner registers a fresh one (within a minute), ${SELECT_STEP}.`,
    );
    expect(gap.nextStep).toContain(REBIND_PERMISSIONS);
    expect(gap.nextStep).toContain(
      "Deleting a Runner leaves the clusters it was bound to with no Runner bound",
    );
    // The removal comes first: it keeps the binding.
    expect(gap.nextStep.indexOf("unassign its 1")).toBeLessThan(
      gap.nextStep.indexOf("delete the Runner"),
    );
  });

  it("the refusal the Runner logs names the second step within the part it logs", async () => {
    const refusal: KubernetesAgentRegistrationRefusedException =
      await refusalOf(registerRestartedPod());

    expect(refusal.reason).toBe("runner_holds_more_than_defaults");
    const head: string = refusal.message.slice(0, 500);
    expect(head).toContain(
      `— or delete the Runner and, once the agent registers a fresh one on its next retry, ${SELECT_STEP}.`,
    );
    expect(refusal.message).toContain(REBIND_PERMISSIONS);
    // Nothing was written by the refused registration.
    expect(database.runnerUpdates).toEqual([]);
    expect(database.createdRunners).toEqual([]);
    expect(database.clusterUpdates).toEqual([]);
  });

  /*
   * The path the texts describe, step by step: the operator deletes the
   * Runner, the pod registers a fresh one — and the cluster stays unbound
   * until the fresh Runner is selected. That is why the texts must say so.
   */
  it("following the delete path: the fresh Runner registers but the cluster stays unbound, and its status then asks for the select step", async () => {
    deleteRunner(database, AGENT_RUNNER_ID);
    expect(database.cluster.aiAccessRunnerId).toBeNull();
    expect(database.cluster.aiAccessRunnerBoundAt).toBeDefined();

    const result: RegisterKubernetesAgentRunnerResult =
      await registerRestartedPod();

    expect(result.bindingState).toBe("left_unbound_by_operator");
    expect(result.isBoundToCluster).toBe(false);
    expect(result.runnerId.toString()).toBe(FRESH_RUNNER_ID.toString());
    expect(database.createdRunners).toHaveLength(1);
    expect(database.createdRunners[0]!.name).toBe(AGENT_RUNNER_NAME);

    // No write bound the cluster to anything.
    for (const update of database.clusterUpdates) {
      expect(update).not.toHaveProperty("aiAccessRunnerId");
    }
    expect(database.cluster.aiAccessRunnerId).toBeNull();

    // The status now asks for exactly the step the remedy named.
    const status: KubernetesClusterAiAccessStatus = await statusOf(database);
    expect(status.isInvestigationReady).toBe(false);
    const gap: KubernetesAiAccessGap = gapWithCode(status, "no_runner_bound");
    expect(gap.title).toBe(
      "The in-cluster Runner is installed but not selected",
    );
    expect(gap.nextStep).toContain(
      `Select the kubernetes-agent Runner "${AGENT_RUNNER_NAME}" on the cluster's AI page as its Runner`,
    );
  });

  /*
   * The other way out keeps the binding: once the holdings are gone the
   * restarted pod re-keys the same row, and the cluster is still bound to it
   * — which is what "still bound to this cluster" promises.
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
   * Negative control: the unbound outcome above comes from the cluster's
   * history, not from the test harness. The same fresh registration for a
   * cluster that never had a Runner bound, never ran kubectl and was never
   * configured first-binds, and writes the binding.
   */
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

  it("the shared note names the permissions from the catalog, the ones a Runner binding needs", () => {
    expect(getDeletedAgentRunnerRebindNote()).toBe(
      `Deleting a Runner leaves the clusters it was bound to with no Runner bound, and a registering Runner never binds a cluster that had one. ${REBIND_PERMISSIONS}`,
    );
  });
});

/*
 * The runner_belongs_to_another_cluster refusal offered "Rename or delete".
 * An operator cannot rename an agent-named Runner (RunnerService refuses a
 * non-root rename of one), and a delete leaves a cluster bound to that row
 * unbound — so it offers the delete, with its second step.
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

  it("leads with the delete, says a rename is not possible, and names the select step", async () => {
    const refusal: KubernetesAgentRegistrationRefusedException =
      await refusalOf(registerRestartedPod());

    expect(refusal.reason).toBe("runner_belongs_to_another_cluster");
    expect(refusal.message).toMatch(
      /^Delete Runner "kubernetes-agent\/prod-us" under Project Settings → Runners \(an in-cluster Runner cannot be renamed\) and, once the agent registers a fresh one on its next retry, select it on the AI page of cluster "prod-us" as its Runner\./,
    );
    expect(refusal.message).not.toContain("Rename or delete");
    expect(refusal.message).toContain(REBIND_PERMISSIONS);
  });

  it("following it: after the delete the fresh Runner registers, and the cluster that was bound to the old row stays unbound", async () => {
    deleteRunner(database, AGENT_RUNNER_ID);

    const result: RegisterKubernetesAgentRunnerResult =
      await registerRestartedPod();

    expect(result.bindingState).toBe("left_unbound_by_operator");
    expect(result.isBoundToCluster).toBe(false);
    expect(database.cluster.aiAccessRunnerId).toBeNull();
  });
});

/*
 * runner_cluster_mismatch is shown only for a cluster BOUND to a Runner that
 * runs in another cluster. Round three said installing the in-cluster
 * Runner "binds itself" — but registration never replaces a cluster's
 * binding (bound_to_other_runner), so the select step is needed there too.
 */
describe("the runner_cluster_mismatch next step", () => {
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

  it("asks for the select step after the install, and no longer says the Runner binds itself", async () => {
    const gap: KubernetesAiAccessGap = gapWithCode(
      await statusOf(database),
      "runner_cluster_mismatch",
    );

    expect(gap.nextStep).toContain(
      "Install the in-cluster Runner on THIS cluster with --set aiAccess.enabled=true and select it on the cluster's AI page as its Runner",
    );
    expect(gap.nextStep).not.toContain("binds itself");
  });

  it("following it: the installed Runner registers but the cluster stays bound to the other Runner until it is selected", async () => {
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
