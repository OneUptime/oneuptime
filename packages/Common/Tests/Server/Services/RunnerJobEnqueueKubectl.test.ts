import RunnerJobService, {
  MAX_AI_COMMAND_JOBS_PER_PROJECT_PER_HOUR,
  MAX_AI_INVESTIGATION_COMMAND_JOBS_PER_PROJECT_PER_HOUR,
} from "../../../Server/Services/RunnerJobService";
import AIRunService from "../../../Server/Services/AIRunService";
import KubernetesAiAgentService from "../../../Server/Services/KubernetesAiAgentService";
import KubernetesClusterService from "../../../Server/Services/KubernetesClusterService";
import RunnerService from "../../../Server/Services/RunnerService";
import AIRun from "../../../Models/DatabaseModels/AIRun";
import KubernetesCluster from "../../../Models/DatabaseModels/KubernetesCluster";
import AIRunType from "../../../Types/AI/AIRunType";
import Runner from "../../../Models/DatabaseModels/Runner";
import RunnerJob from "../../../Models/DatabaseModels/RunnerJob";
import RunbookStepType from "../../../Types/Runbook/RunbookStepType";
import RunnerJobOrigin, {
  AI_COMMAND_JOB_ORIGINS,
} from "../../../Types/Runbook/RunnerJobOrigin";
import RunnerJobStatus from "../../../Types/Runbook/RunnerJobStatus";
import {
  KubectlCommandTier,
  KubernetesAiRemediationMode,
} from "../../../Types/Kubernetes/KubernetesClusterAiAccess";
import { AI_COMMAND_STEP_TYPES } from "../../../Types/AutoRemediation/AiRemediationCommandPlan";
import BadDataException from "../../../Types/Exception/BadDataException";
import ObjectID from "../../../Types/ObjectID";
import PositiveNumber from "../../../Types/PositiveNumber";
import {
  fakeRunnerJobCountBy,
  fakeRunnerJobRows,
} from "../TestingUtils/Services/FakeRunnerJobCount";
import { afterEach, beforeEach, describe, expect, it } from "@jest/globals";
import AiCommandKillSwitch from "../../../Server/Utils/AI/AiCommandKillSwitch";

/*
 * Enable AI is on throughout: what turning it off does to these paths is
 * AiCommandKillSwitch's own suite (AiCommandKillSwitch.test.ts).
 */
beforeEach(() => {
  jest.spyOn(AiCommandKillSwitch, "isAiOff").mockResolvedValue(false);
});

/*
 * Contract under test — RunnerJobService.enqueueAiKubectlCommand, the
 * server-side chokepoint between an LLM's kubectl and a cluster:
 *
 * - it re-runs the kubectl policy on the command regardless of what the
 *   tool layer checked: Denied never becomes a row;
 * - an AiInvestigation-origin job must be Read tier — an investigation can
 *   never enqueue a write, whatever prompt produced the call;
 * - a remediation job must carry its suggestion, and Kubectl never travels
 *   through enqueueAiCommand's Bash/SSH payload shape;
 * - the payload is an argv (never a shell line) plus the rendered command,
 *   the tier and the cluster (id AND identifier), and the row carries
 *   kubernetesClusterId so the cluster's AI page can list it;
 * - the cluster and the target Runner must belong to the project, and a
 *   job is enqueued only for the in-cluster Runner OF THAT CLUSTER — never
 *   for a Runner that lives in some other cluster's pod, nor for one
 *   outside every cluster;
 * - the job goes through the cluster's CURRENT binding: the target is its
 *   bound Runner, an investigation job needs the investigation switch
 *   still on and a remediation job needs remediation still enabled —
 *   callers act on a snapshot, so revoking access on the AI page stops the
 *   next command;
 * - no job names a credential: a Runner outside a cluster reached it only
 *   with a Kubernetes runbook credential, and runbook credentials are gone
 *   (Runbooks > Runners > AI Access, removed);
 * - each origin has its own hourly project brake, and the dashboard's
 *   access test (explicitly flagged, no AI run) is exempt from the
 *   investigation switch and never counted against that brake.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "22222222-2222-4222-8222-222222222222",
);
const RUN_ID: ObjectID = new ObjectID("88888888-8888-4888-8888-888888888888");
const SUGGESTION_ID: ObjectID = new ObjectID(
  "77777777-7777-4777-8777-777777777777",
);
const CLUSTER_ID: ObjectID = new ObjectID(
  "33333333-3333-4333-8333-333333333333",
);
const RUNNER_ID: ObjectID = new ObjectID(
  "44444444-4444-4444-8444-444444444444",
);

type EnqueueArgs = Parameters<
  typeof RunnerJobService.enqueueAiKubectlCommand
>[0];

function args(overrides: Partial<EnqueueArgs> = {}): EnqueueArgs {
  return {
    projectId: PROJECT_ID,
    aiRunId: RUN_ID,
    origin: RunnerJobOrigin.AiInvestigation,
    kubernetesClusterId: CLUSTER_ID,
    stepId: "ai-investigation-kubectl-1",
    targetAgentId: RUNNER_ID,
    command: "kubectl get pods -n web",
    timeoutInMs: 30000,
    ...overrides,
  };
}

/*
 * The cluster as its AI page left it: bound to RUNNER_ID, its in-cluster
 * Runner, with investigation on and remediation asking for approval.
 */
function fakeCluster(
  overrides: Partial<Record<string, unknown>> = {},
): KubernetesCluster {
  return {
    id: CLUSTER_ID,
    _id: CLUSTER_ID.toString(),
    projectId: PROJECT_ID,
    name: "prod-us",
    clusterIdentifier: "prod-us",
    aiAccessRunnerId: RUNNER_ID,
    isAiInvestigationEnabled: true,
    aiRemediationMode: KubernetesAiRemediationMode.RequireApproval,
    ...overrides,
  } as unknown as KubernetesCluster;
}

// The in-cluster Runner of prod-us, as its posture describes it.
function fakeRunner(overrides: Partial<Record<string, unknown>> = {}): Runner {
  return {
    id: RUNNER_ID,
    _id: RUNNER_ID.toString(),
    projectId: PROJECT_ID,
    name: "kubernetes-agent/prod-us",
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

describe("RunnerJobService.enqueueAiKubectlCommand", () => {
  let createdRows: Array<RunnerJob>;
  let clusterLookup: jest.SpyInstance;
  let runnerLookup: jest.SpyInstance;
  let countBySpy: jest.SpyInstance;
  let aiRunLookup: jest.SpyInstance;

  beforeEach(() => {
    createdRows = [];
    countBySpy = jest
      .spyOn(RunnerJobService, "countBy")
      .mockResolvedValue(new PositiveNumber(0));
    // No Kubernetes AI agent: the bound Runner is the cluster's target.
    jest
      .spyOn(KubernetesAiAgentService, "findForCluster")
      .mockResolvedValue(null);
    // The run an investigation-origin job belongs to: an investigation.
    aiRunLookup = jest.spyOn(AIRunService, "findOneBy").mockResolvedValue({
      id: RUN_ID,
      runType: AIRunType.Investigation,
    } as unknown as AIRun);
    jest
      .spyOn(RunnerJobService, "create")
      .mockImplementation(async (data: unknown): Promise<RunnerJob> => {
        const row: RunnerJob = (data as { data: RunnerJob }).data;
        createdRows.push(row);
        return row;
      });
    clusterLookup = jest
      .spyOn(KubernetesClusterService, "findOneBy")
      .mockResolvedValue(fakeCluster());
    runnerLookup = jest
      .spyOn(RunnerService, "findOneBy")
      .mockResolvedValue(fakeRunner());
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("the Kubectl step type is an AI command type and both AI origins are claimable together", () => {
    expect(AI_COMMAND_STEP_TYPES).toContain(RunbookStepType.Kubectl);
    expect(AI_COMMAND_JOB_ORIGINS).toEqual([
      RunnerJobOrigin.AiRemediation,
      RunnerJobOrigin.AiInvestigation,
    ]);
  });

  it("stores an argv payload with the rendered command, tier and cluster for a read command", async () => {
    const job: RunnerJob = await RunnerJobService.enqueueAiKubectlCommand(
      args({ command: "get pods -n web -o wide" }),
    );

    expect(createdRows).toHaveLength(1);
    expect(job.stepType).toBe(RunbookStepType.Kubectl);
    expect(job.origin).toBe(RunnerJobOrigin.AiInvestigation);
    expect(job.status).toBe(RunnerJobStatus.Pending);
    expect(job.script).toBe("");
    expect(job.kubernetesClusterId?.toString()).toBe(CLUSTER_ID.toString());
    expect(job.aiRunId?.toString()).toBe(RUN_ID.toString());
    expect(job.autoRemediationSuggestionId).toBeUndefined();
    expect(job.payload).toEqual({
      args: ["get", "pods", "-n", "web", "-o", "wide"],
      displayCommand: "kubectl get pods -n web -o wide",
      tier: KubectlCommandTier.Read,
      kubernetesClusterId: CLUSTER_ID.toString(),
      clusterIdentifier: "prod-us",
    });
    expect(job.claimDeadlineAt).toBeInstanceOf(Date);
  });

  /*
   * Runbook credentials are gone, and the parameter that named one with
   * them: a caller that still passes a credential id gets a payload that
   * names none.
   */
  it("names no credential on the payload, whatever the caller passes", async () => {
    const job: RunnerJob = await RunnerJobService.enqueueAiKubectlCommand({
      ...args(),
      credentialId: "55555555-5555-4555-8555-555555555555",
    } as unknown as EnqueueArgs);

    expect(Object.keys(job.payload || {}).sort()).toEqual([
      "args",
      "clusterIdentifier",
      "displayCommand",
      "kubernetesClusterId",
      "tier",
    ]);
  });

  /*
   * The cross-cluster hole, closed at the chokepoint: a job runs with the
   * target pod's ServiceAccount, which reaches only the cluster that pod
   * lives in. So the target must be the in-cluster Runner of the job's own
   * cluster, and both rows must be this project's.
   */
  describe("cluster and Runner identity", () => {
    it("resolves the cluster and the Runner scoped to the project", async () => {
      await RunnerJobService.enqueueAiKubectlCommand(args());

      const clusterQuery: Record<string, unknown> = (
        clusterLookup.mock.calls[0]![0] as { query: Record<string, unknown> }
      ).query;
      expect(clusterQuery["_id"]).toBe(CLUSTER_ID.toString());
      expect(clusterQuery["projectId"]).toBe(PROJECT_ID);

      const runnerQuery: Record<string, unknown> = (
        runnerLookup.mock.calls[0]![0] as { query: Record<string, unknown> }
      ).query;
      expect(runnerQuery["_id"]).toBe(RUNNER_ID.toString());
      expect(runnerQuery["projectId"]).toBe(PROJECT_ID);
    });

    it("refuses a cluster that is not in the project", async () => {
      clusterLookup.mockResolvedValue(null);

      await expect(
        RunnerJobService.enqueueAiKubectlCommand(args()),
      ).rejects.toThrow(/cluster not found or it does not belong/);
      expect(createdRows).toHaveLength(0);
    });

    /*
     * The bound Runner is looked up in this project (the query above): one
     * that is not there is no access target, so nothing reaches the
     * cluster through it.
     */
    it("refuses a target Runner that is not in the project", async () => {
      runnerLookup.mockResolvedValue(null);

      await expect(
        RunnerJobService.enqueueAiKubectlCommand(args()),
      ).rejects.toThrow(/no longer reached through this Runner or agent/);
      expect(createdRows).toHaveLength(0);
    });

    /*
     * The in-cluster Runner of a DIFFERENT cluster is no access target of
     * this one (resolveKubernetesAiAccessTarget), so nothing is enqueued
     * for it.
     */
    it("refuses a job for the in-cluster Runner of a DIFFERENT cluster", async () => {
      runnerLookup.mockResolvedValue(
        fakeRunner({
          name: "kubernetes-agent/prod-eu",
          hostInfo: {
            kubernetes: { inCluster: true, clusterIdentifier: "prod-eu" },
          },
        }),
      );

      await expect(
        RunnerJobService.enqueueAiKubectlCommand(args()),
      ).rejects.toThrow(/no longer reached through this Runner or agent/);
      expect(createdRows).toHaveLength(0);
    });

    // A pod Runner that names no cluster is no in-cluster Runner of this one.
    it("refuses a job for a pod Runner with no cluster identity", async () => {
      runnerLookup.mockResolvedValue(
        fakeRunner({
          name: "pod-runner",
          hostInfo: { kubernetes: { inCluster: true } },
        }),
      );

      await expect(
        RunnerJobService.enqueueAiKubectlCommand(args()),
      ).rejects.toThrow(/no longer reached through this Runner or agent/);
      expect(createdRows).toHaveLength(0);
    });

    /*
     * A Runner outside the cluster reached it only with a Kubernetes
     * runbook credential. Those are gone, so a cluster still bound to one
     * (the data migration clears such a binding) is reached by nothing:
     * the Runner is no access target of it.
     */
    it("refuses a job for a Runner outside the cluster: it is no access target", async () => {
      runnerLookup.mockResolvedValue(
        fakeRunner({ name: "office-runner", hostInfo: { hostname: "x" } }),
      );

      await expect(
        RunnerJobService.enqueueAiKubectlCommand(args()),
      ).rejects.toThrow(/no longer reached through this Runner or agent/);
      expect(createdRows).toHaveLength(0);
    });

    /*
     * The cluster's in-cluster Runner, known by its server-owned name, whose
     * posture was dropped on a heartbeat: the target, but it has not said it
     * runs in the cluster, so nothing is sent to it - and the refusal points
     * at the Kubernetes AI agent, which replaces it.
     */
    it("refuses the in-cluster Runner by name while its posture does not name the cluster, and says to install the Kubernetes AI agent", async () => {
      runnerLookup.mockResolvedValue(
        fakeRunner({ name: "kubernetes-agent/prod-us", hostInfo: {} }),
      );

      await expect(
        RunnerJobService.enqueueAiKubectlCommand(args()),
      ).rejects.toThrow(
        'A kubectl command can only run on the in-cluster Runner of cluster "prod-us", and Runner "kubernetes-agent/prod-us" has not reported that it runs in it. Install the Kubernetes AI agent on the cluster: the Kubernetes agent chart installs it, and it replaces the in-cluster Runner.',
      );
      expect(createdRows).toHaveLength(0);
    });

    it("refuses a job when the cluster row has no identifier to match", async () => {
      clusterLookup.mockResolvedValue(fakeCluster({ clusterIdentifier: "" }));

      await expect(
        RunnerJobService.enqueueAiKubectlCommand(args()),
      ).rejects.toThrow(BadDataException);
      expect(createdRows).toHaveLength(0);
    });

    it("accepts a job when the posture names the cluster in a different case", async () => {
      runnerLookup.mockResolvedValue(
        fakeRunner({
          hostInfo: {
            kubernetes: { inCluster: true, clusterIdentifier: "PROD-US" },
          },
        }),
      );

      const job: RunnerJob =
        await RunnerJobService.enqueueAiKubectlCommand(args());

      expect(job.payload?.["clusterIdentifier"]).toBe("prod-us");
      expect(createdRows).toHaveLength(1);
    });

    it("runs the policy and the read-only rule BEFORE any lookup, so a denied command touches no row", async () => {
      await expect(
        RunnerJobService.enqueueAiKubectlCommand(
          args({ command: "kubectl delete namespace web" }),
        ),
      ).rejects.toThrow(/kubectl command policy/);
      await expect(
        RunnerJobService.enqueueAiKubectlCommand(
          args({ command: "kubectl rollout restart deployment/web -n web" }),
        ),
      ).rejects.toThrow(/read-only kubectl commands/);

      expect(clusterLookup).not.toHaveBeenCalled();
      expect(runnerLookup).not.toHaveBeenCalled();
    });
  });

  it("refuses a Denied command outright", async () => {
    await expect(
      RunnerJobService.enqueueAiKubectlCommand(
        args({ command: "kubectl delete namespace web" }),
      ),
    ).rejects.toThrow(BadDataException);
    await expect(
      RunnerJobService.enqueueAiKubectlCommand(
        args({ command: "kubectl get pods --kubeconfig=/tmp/x" }),
      ),
    ).rejects.toThrow(/kubectl command policy/);
    expect(createdRows).toHaveLength(0);
  });

  it("refuses any write for an investigation-origin job", async () => {
    await expect(
      RunnerJobService.enqueueAiKubectlCommand(
        args({ command: "kubectl rollout restart deployment/web -n web" }),
      ),
    ).rejects.toThrow(/read-only kubectl commands/);
    expect(createdRows).toHaveLength(0);
  });

  it("accepts a SafeWrite for a remediation-origin job that carries its suggestion", async () => {
    const job: RunnerJob = await RunnerJobService.enqueueAiKubectlCommand(
      args({
        origin: RunnerJobOrigin.AiRemediation,
        autoRemediationSuggestionId: SUGGESTION_ID,
        command: "kubectl rollout restart deployment/web -n web",
      }),
    );

    expect(job.origin).toBe(RunnerJobOrigin.AiRemediation);
    expect(job.autoRemediationSuggestionId?.toString()).toBe(
      SUGGESTION_ID.toString(),
    );
    expect(job.payload?.["tier"]).toBe(KubectlCommandTier.SafeWrite);
  });

  it("requires a suggestion for a remediation-origin job", async () => {
    await expect(
      RunnerJobService.enqueueAiKubectlCommand(
        args({
          origin: RunnerJobOrigin.AiRemediation,
          command: "kubectl rollout restart deployment/web -n web",
        }),
      ),
    ).rejects.toThrow(/needs its auto-remediation suggestion/);
  });

  it("requires a cluster and a target Runner", async () => {
    await expect(
      RunnerJobService.enqueueAiKubectlCommand(
        args({ kubernetesClusterId: undefined as unknown as ObjectID }),
      ),
    ).rejects.toThrow(/kubernetesClusterId is required/);
    await expect(
      RunnerJobService.enqueueAiKubectlCommand(
        args({ targetAgentId: undefined as unknown as ObjectID }),
      ),
    ).rejects.toThrow(/targetAgentId is required/);
  });

  it("brakes investigations and remediations on separate hourly counters", async () => {
    countBySpy.mockResolvedValue(
      new PositiveNumber(
        MAX_AI_INVESTIGATION_COMMAND_JOBS_PER_PROJECT_PER_HOUR,
      ),
    );

    await expect(
      RunnerJobService.enqueueAiKubectlCommand(args()),
    ).rejects.toThrow(/AI investigation commands in the last hour/);

    const investigationQuery: Record<string, unknown> = (
      countBySpy.mock.calls[0]![0] as { query: Record<string, unknown> }
    ).query;
    expect(investigationQuery["origin"]).toBe(RunnerJobOrigin.AiInvestigation);

    countBySpy.mockResolvedValue(
      new PositiveNumber(MAX_AI_COMMAND_JOBS_PER_PROJECT_PER_HOUR),
    );

    await expect(
      RunnerJobService.enqueueAiKubectlCommand(
        args({
          origin: RunnerJobOrigin.AiRemediation,
          autoRemediationSuggestionId: SUGGESTION_ID,
          command: "kubectl scale deployment/web --replicas=3 -n web",
        }),
      ),
    ).rejects.toThrow(/AI remediation commands in the last hour/);

    const remediationQuery: Record<string, unknown> = (
      countBySpy.mock.calls[1]![0] as { query: Record<string, unknown> }
    ).query;
    expect(remediationQuery["origin"]).toBe(RunnerJobOrigin.AiRemediation);
    expect(createdRows).toHaveLength(0);
  });

  /*
   * The access test is the only kubectl job without an AI run. The
   * investigation brake counts rows WITH an AI run, so however often
   * someone clicks "Test access" it never starves real investigations.
   */
  it("counts only investigation jobs that belong to an AI run toward the investigation brake", async () => {
    await RunnerJobService.enqueueAiKubectlCommand(args());

    const query: Record<string, unknown> = (
      countBySpy.mock.calls[0]![0] as { query: Record<string, unknown> }
    ).query;
    const aiRunFilter: { getSql?: (alias: string) => string } = query[
      "aiRunId"
    ] as { getSql?: (alias: string) => string };
    expect(aiRunFilter).toBeDefined();
    expect(aiRunFilter.getSql!('"aiRunId"')).toBe('("aiRunId" IS NOT NULL)');

    // The remediation brake keeps counting every remediation job.
    await RunnerJobService.enqueueAiKubectlCommand(
      args({
        origin: RunnerJobOrigin.AiRemediation,
        autoRemediationSuggestionId: SUGGESTION_ID,
        command: "kubectl scale deployment/web --replicas=3 -n web",
      }),
    );
    const remediationQuery: Record<string, unknown> = (
      countBySpy.mock.calls[1]![0] as { query: Record<string, unknown> }
    ).query;
    expect(remediationQuery["aiRunId"]).toBeUndefined();
  });

  /*
   * Resource commands (Docker, Podman, Swarm, Proxmox, VMware, Ceph,
   * database servers, hosts) land in the same RunnerJob table under the
   * same two AI origins, and are braked on their own ResourceCommand rows.
   * A busy hour on that infrastructure must never spend the cluster lane's
   * budget: counted against an in-memory table, the kubectl brakes count
   * only the rows they always counted.
   */
  describe("the hourly brakes never count resource-command rows", () => {
    const resourceRow: Record<string, unknown> = {
      projectId: PROJECT_ID,
      stepType: RunbookStepType.ResourceCommand,
      aiRunId: RUN_ID,
    };

    it("runs an investigation's kubectl after a full hour of resource investigation reads", async () => {
      countBySpy.mockImplementation(
        fakeRunnerJobCountBy(
          fakeRunnerJobRows(
            MAX_AI_INVESTIGATION_COMMAND_JOBS_PER_PROJECT_PER_HOUR,
            { ...resourceRow, origin: RunnerJobOrigin.AiInvestigation },
          ),
        ) as never,
      );

      await RunnerJobService.enqueueAiKubectlCommand(args());

      expect(createdRows).toHaveLength(1);
    });

    it("runs a kubectl fix after a full hour of resource fixes", async () => {
      countBySpy.mockImplementation(
        fakeRunnerJobCountBy(
          fakeRunnerJobRows(MAX_AI_COMMAND_JOBS_PER_PROJECT_PER_HOUR, {
            ...resourceRow,
            origin: RunnerJobOrigin.AiRemediation,
            autoRemediationSuggestionId: SUGGESTION_ID,
          }),
        ) as never,
      );

      await RunnerJobService.enqueueAiKubectlCommand(
        args({
          origin: RunnerJobOrigin.AiRemediation,
          autoRemediationSuggestionId: SUGGESTION_ID,
          command: "kubectl scale deployment/web --replicas=3 -n web",
        }),
      );

      expect(createdRows).toHaveLength(1);
    });

    it("negative control: a full hour of kubectl reads still stops the next one", async () => {
      countBySpy.mockImplementation(
        fakeRunnerJobCountBy(
          fakeRunnerJobRows(
            MAX_AI_INVESTIGATION_COMMAND_JOBS_PER_PROJECT_PER_HOUR,
            {
              ...resourceRow,
              stepType: RunbookStepType.Kubectl,
              origin: RunnerJobOrigin.AiInvestigation,
            },
          ),
        ) as never,
      );

      await expect(
        RunnerJobService.enqueueAiKubectlCommand(args()),
      ).rejects.toThrow(/AI investigation commands in the last hour/);
      expect(createdRows).toHaveLength(0);
    });

    it("negative control: kubectl fixes still share one budget with Bash and SSH fixes", async () => {
      countBySpy.mockImplementation(
        fakeRunnerJobCountBy([
          ...fakeRunnerJobRows(MAX_AI_COMMAND_JOBS_PER_PROJECT_PER_HOUR - 1, {
            ...resourceRow,
            stepType: RunbookStepType.Bash,
            origin: RunnerJobOrigin.AiRemediation,
          }),
          ...fakeRunnerJobRows(1, {
            ...resourceRow,
            stepType: RunbookStepType.SSH,
            origin: RunnerJobOrigin.AiRemediation,
          }),
        ]) as never,
      );

      await expect(
        RunnerJobService.enqueueAiKubectlCommand(
          args({
            origin: RunnerJobOrigin.AiRemediation,
            autoRemediationSuggestionId: SUGGESTION_ID,
            command: "kubectl scale deployment/web --replicas=3 -n web",
          }),
        ),
      ).rejects.toThrow(/AI remediation commands in the last hour/);
      expect(createdRows).toHaveLength(0);
    });
  });

  describe("the dashboard's access test", () => {
    it("enqueues without an AI run when flagged as an access test", async () => {
      const job: RunnerJob = await RunnerJobService.enqueueAiKubectlCommand(
        args({
          aiRunId: undefined,
          command: "kubectl version",
          isAccessTest: true,
        }),
      );

      expect(job.aiRunId).toBeUndefined();
      expect(job.payload?.["displayCommand"]).toBe("kubectl version");
    });

    it("is never counted against, nor stopped by, the project's investigation brake", async () => {
      countBySpy.mockResolvedValue(
        new PositiveNumber(
          MAX_AI_INVESTIGATION_COMMAND_JOBS_PER_PROJECT_PER_HOUR + 10,
        ),
      );

      await RunnerJobService.enqueueAiKubectlCommand(
        args({
          aiRunId: undefined,
          command: "kubectl version",
          isAccessTest: true,
        }),
      );

      expect(countBySpy).not.toHaveBeenCalled();
      expect(createdRows).toHaveLength(1);
    });

    it("runs before the investigation switch is turned on (that is what it is for)", async () => {
      clusterLookup.mockResolvedValue(
        fakeCluster({ isAiInvestigationEnabled: false }),
      );

      await RunnerJobService.enqueueAiKubectlCommand(
        args({
          aiRunId: undefined,
          command: "kubectl auth can-i --list",
          isAccessTest: true,
        }),
      );

      expect(createdRows).toHaveLength(1);
    });

    it("is still bound by the binding, the policy and the read-only rule", async () => {
      clusterLookup.mockResolvedValue(
        fakeCluster({ aiAccessRunnerId: ObjectID.generate() }),
      );

      await expect(
        RunnerJobService.enqueueAiKubectlCommand(
          args({
            aiRunId: undefined,
            command: "kubectl version",
            isAccessTest: true,
          }),
        ),
      ).rejects.toThrow(/no longer reached through this Runner/);

      await expect(
        RunnerJobService.enqueueAiKubectlCommand(
          args({
            aiRunId: undefined,
            command: "kubectl rollout restart deployment/web -n web",
            isAccessTest: true,
          }),
        ),
      ).rejects.toThrow(/read-only kubectl commands/);

      expect(createdRows).toHaveLength(0);
    });

    it("is refused with an AI run, or as a remediation", async () => {
      await expect(
        RunnerJobService.enqueueAiKubectlCommand(
          args({ command: "kubectl version", isAccessTest: true }),
        ),
      ).rejects.toThrow(/no AI run behind it/);

      await expect(
        RunnerJobService.enqueueAiKubectlCommand(
          args({
            aiRunId: undefined,
            origin: RunnerJobOrigin.AiRemediation,
            autoRemediationSuggestionId: SUGGESTION_ID,
            command: "kubectl version",
            isAccessTest: true,
          }),
        ),
      ).rejects.toThrow(/no AI run behind it/);

      expect(createdRows).toHaveLength(0);
    });

    it("an investigation job without its AI run is refused unless it is flagged as the access test", async () => {
      await expect(
        RunnerJobService.enqueueAiKubectlCommand(args({ aiRunId: undefined })),
      ).rejects.toThrow(/needs the AI run it belongs to/);

      expect(createdRows).toHaveLength(0);
    });
  });

  /*
   * Callers act on a snapshot of the cluster's AI access (an investigation
   * reads it once when it starts). The chokepoint re-reads the cluster, so
   * an operator who revokes or re-points access stops the next command.
   */
  describe("the cluster's CURRENT binding and switches", () => {
    it("reads the binding and both switches off the cluster row", async () => {
      await RunnerJobService.enqueueAiKubectlCommand(args());

      const select: Record<string, unknown> = (
        clusterLookup.mock.calls[0]![0] as { select: Record<string, unknown> }
      ).select;
      expect(select).toMatchObject({
        aiAccessRunnerId: true,
        isAiInvestigationEnabled: true,
        aiRemediationMode: true,
      });
      // The credential column is gone, and nothing reads it.
      expect(select["aiAccessCredentialId"]).toBeUndefined();
    });

    it("refuses a job for a Runner the cluster is no longer bound to", async () => {
      const reboundTo: ObjectID = ObjectID.generate();
      clusterLookup.mockResolvedValue(
        fakeCluster({ aiAccessRunnerId: reboundTo }),
      );

      await expect(
        RunnerJobService.enqueueAiKubectlCommand(args()),
      ).rejects.toThrow(/no longer reached through this Runner/);
      /*
       * The only Runner read is the one the cluster is bound to NOW (to
       * resolve its access target) — never the one the job asked for.
       */
      for (const call of runnerLookup.mock.calls) {
        expect(
          (call[0] as { query: Record<string, unknown> }).query["_id"],
        ).toBe(reboundTo.toString());
      }
      expect(createdRows).toHaveLength(0);
    });

    it("refuses any job for a cluster whose binding was cleared", async () => {
      clusterLookup.mockResolvedValue(
        fakeCluster({ aiAccessRunnerId: undefined }),
      );

      await expect(
        RunnerJobService.enqueueAiKubectlCommand(args()),
      ).rejects.toThrow(/no longer reached through this Runner/);
      expect(createdRows).toHaveLength(0);
    });

    it("refuses an investigation job once 'Let AI investigate with kubectl' is off", async () => {
      clusterLookup.mockResolvedValue(
        fakeCluster({ isAiInvestigationEnabled: false }),
      );

      await expect(
        RunnerJobService.enqueueAiKubectlCommand(args()),
      ).rejects.toThrow(/"Investigate with kubectl" is turned off/);
      expect(createdRows).toHaveLength(0);

      // The run's type decides the switch; read from this project only.
      const query: Record<string, unknown> = (
        aiRunLookup.mock.calls[0]![0] as { query: Record<string, unknown> }
      ).query;
      expect(query["_id"]).toBe(RUN_ID.toString());
      expect(query["projectId"]).toBe(PROJECT_ID);
    });

    it("fails closed to the investigation switch when the AI run cannot be found", async () => {
      aiRunLookup.mockResolvedValue(null);
      clusterLookup.mockResolvedValue(
        fakeCluster({ isAiInvestigationEnabled: false }),
      );

      await expect(
        RunnerJobService.enqueueAiKubectlCommand(args()),
      ).rejects.toThrow(/"Investigate with kubectl" is turned off/);
      expect(createdRows).toHaveLength(0);
    });

    /*
     * A remediation run reads the cluster it may fix through the same
     * read-only lane (KubectlInvestigationToolkit with the remediation
     * readiness check), even when the operator left investigation off. Its
     * reads follow the cluster's remediation mode, not the investigation
     * switch — tightening the investigation switch must not break them.
     */
    it("governs a remediation run's reads by the remediation mode, not the investigation switch", async () => {
      aiRunLookup.mockResolvedValue({
        id: RUN_ID,
        runType: AIRunType.RemediationExecution,
      } as unknown as AIRun);
      clusterLookup.mockResolvedValue(
        fakeCluster({
          isAiInvestigationEnabled: false,
          aiRemediationMode: KubernetesAiRemediationMode.Automatic,
        }),
      );

      await RunnerJobService.enqueueAiKubectlCommand(args());
      expect(createdRows).toHaveLength(1);

      clusterLookup.mockResolvedValue(
        fakeCluster({
          isAiInvestigationEnabled: true,
          aiRemediationMode: KubernetesAiRemediationMode.Disabled,
        }),
      );

      await expect(
        RunnerJobService.enqueueAiKubectlCommand(args()),
      ).rejects.toThrow(/AI fixes are turned off/);
      expect(createdRows).toHaveLength(1);
    });

    it("never looks the AI run up for the access test or a remediation job", async () => {
      await RunnerJobService.enqueueAiKubectlCommand(
        args({
          aiRunId: undefined,
          command: "kubectl version",
          isAccessTest: true,
        }),
      );
      await RunnerJobService.enqueueAiKubectlCommand(
        args({
          origin: RunnerJobOrigin.AiRemediation,
          autoRemediationSuggestionId: SUGGESTION_ID,
          command: "kubectl rollout restart deployment/web -n web",
        }),
      );

      expect(aiRunLookup).not.toHaveBeenCalled();
      expect(createdRows).toHaveLength(2);
    });

    it("refuses a remediation job once the cluster's remediation is Disabled (or unknown)", async () => {
      for (const mode of [
        KubernetesAiRemediationMode.Disabled,
        undefined,
        "automatic",
      ]) {
        clusterLookup.mockResolvedValue(
          fakeCluster({ aiRemediationMode: mode }),
        );

        await expect(
          RunnerJobService.enqueueAiKubectlCommand(
            args({
              origin: RunnerJobOrigin.AiRemediation,
              autoRemediationSuggestionId: SUGGESTION_ID,
              command: "kubectl rollout restart deployment/web -n web",
            }),
          ),
        ).rejects.toThrow(/AI fixes are turned off/);
      }

      expect(createdRows).toHaveLength(0);
    });

    it("negative control: every enabled remediation mode still enqueues, investigation switch or not", async () => {
      for (const mode of [
        KubernetesAiRemediationMode.RequireApproval,
        KubernetesAiRemediationMode.Automatic,
        KubernetesAiRemediationMode.BypassApproval,
      ]) {
        clusterLookup.mockResolvedValue(
          fakeCluster({
            aiRemediationMode: mode,
            isAiInvestigationEnabled: false,
          }),
        );

        await RunnerJobService.enqueueAiKubectlCommand(
          args({
            origin: RunnerJobOrigin.AiRemediation,
            autoRemediationSuggestionId: SUGGESTION_ID,
            command: "kubectl rollout restart deployment/web -n web",
          }),
        );
      }

      expect(createdRows).toHaveLength(3);
    });

    it("negative control: an investigation with remediation Disabled still enqueues", async () => {
      clusterLookup.mockResolvedValue(
        fakeCluster({
          aiRemediationMode: KubernetesAiRemediationMode.Disabled,
        }),
      );

      await RunnerJobService.enqueueAiKubectlCommand(args());

      expect(createdRows).toHaveLength(1);
    });

    it("negative control: a job for the cluster's own in-cluster Runner enqueues, naming no credential", async () => {
      const job: RunnerJob =
        await RunnerJobService.enqueueAiKubectlCommand(args());

      expect(job.payload?.["credentialId"]).toBeUndefined();
      expect(createdRows).toHaveLength(1);
    });
  });
});

describe("RunnerJobService.enqueueAiCommand with Kubectl", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("refuses the Kubectl step type — it has its own chokepoint", async () => {
    const create: jest.SpyInstance = jest.spyOn(RunnerJobService, "create");

    await expect(
      RunnerJobService.enqueueAiCommand({
        projectId: PROJECT_ID,
        aiRunId: RUN_ID,
        autoRemediationSuggestionId: SUGGESTION_ID,
        stepId: "ai-command-1",
        stepType: RunbookStepType.Kubectl,
        targetAgentId: RUNNER_ID,
        command: "kubectl get pods",
        timeoutInMs: 30000,
      }),
    ).rejects.toThrow(/enqueueAiKubectlCommand/);

    expect(create).not.toHaveBeenCalled();
  });
});
