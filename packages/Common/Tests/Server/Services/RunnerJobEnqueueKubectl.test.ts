import RunnerJobService, {
  MAX_AI_COMMAND_JOBS_PER_PROJECT_PER_HOUR,
  MAX_AI_INVESTIGATION_COMMAND_JOBS_PER_PROJECT_PER_HOUR,
} from "../../../Server/Services/RunnerJobService";
import AIRunService from "../../../Server/Services/AIRunService";
import KubernetesClusterService from "../../../Server/Services/KubernetesClusterService";
import RunbookCredentialService from "../../../Server/Services/RunbookCredentialService";
import RunnerService from "../../../Server/Services/RunnerService";
import AIRun from "../../../Models/DatabaseModels/AIRun";
import KubernetesCluster from "../../../Models/DatabaseModels/KubernetesCluster";
import RunbookCredential from "../../../Models/DatabaseModels/RunbookCredential";
import AIRunType from "../../../Types/AI/AIRunType";
import Runner from "../../../Models/DatabaseModels/Runner";
import RunnerJob from "../../../Models/DatabaseModels/RunnerJob";
import RunbookCredentialType from "../../../Types/Runbook/RunbookCredentialType";
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
import { afterEach, beforeEach, describe, expect, it } from "@jest/globals";

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
 *   the tier, the cluster (id AND identifier) and the optional credential,
 *   and the row carries kubernetesClusterId so the cluster's AI page can
 *   list it;
 * - the cluster and the target Runner must belong to the project, and a
 *   credential-less job is enqueued only for the in-cluster Runner OF THAT
 *   CLUSTER — never for a Runner that lives in some other cluster's pod;
 * - the job goes through the cluster's CURRENT binding: the target is its
 *   bound Runner, a credential is its bound Kubernetes credential, an
 *   investigation job needs the investigation switch still on and a
 *   remediation job needs remediation still enabled — callers act on a
 *   snapshot, so revoking access on the AI page stops the next command;
 * - a kubernetes-agent Runner is never sent a job that names a credential;
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
const CREDENTIAL_ID: string = "55555555-5555-4555-8555-555555555555";

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
 * The cluster as its AI page left it: bound to RUNNER_ID with a Kubernetes
 * credential also selected (the in-cluster Runner wins over it, so a
 * credential-less job is still legitimate), investigation on, remediation
 * asking for approval.
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
    aiAccessCredentialId: new ObjectID(CREDENTIAL_ID),
    isAiInvestigationEnabled: true,
    aiRemediationMode: KubernetesAiRemediationMode.RequireApproval,
    ...overrides,
  } as unknown as KubernetesCluster;
}

function fakeCredential(
  overrides: Partial<Record<string, unknown>> = {},
): RunbookCredential {
  return {
    id: new ObjectID(CREDENTIAL_ID),
    _id: CREDENTIAL_ID,
    name: "prod-us kubeconfig",
    credentialType: RunbookCredentialType.Kubernetes,
    ...overrides,
  } as unknown as RunbookCredential;
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
  let credentialLookup: jest.SpyInstance;
  let countBySpy: jest.SpyInstance;
  let aiRunLookup: jest.SpyInstance;

  beforeEach(() => {
    createdRows = [];
    countBySpy = jest
      .spyOn(RunnerJobService, "countBy")
      .mockResolvedValue(new PositiveNumber(0));
    credentialLookup = jest
      .spyOn(RunbookCredentialService, "findOneBy")
      .mockResolvedValue(fakeCredential());
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

  it("includes the credential id for a Runner outside the cluster", async () => {
    runnerLookup.mockResolvedValue(
      fakeRunner({ name: "office-runner", hostInfo: { hostname: "x" } }),
    );

    const job: RunnerJob = await RunnerJobService.enqueueAiKubectlCommand(
      args({ credentialId: CREDENTIAL_ID }),
    );

    expect(job.payload?.["credentialId"]).toBe(CREDENTIAL_ID);
    expect(job.payload?.["clusterIdentifier"]).toBe("prod-us");
  });

  /*
   * The cross-cluster hole, closed at the chokepoint: a credential-less job
   * runs with the target pod's ServiceAccount, which reaches only the
   * cluster that pod lives in. So the target must be the in-cluster Runner
   * of the job's own cluster, and both rows must be this project's.
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

    it("refuses a target Runner that is not in the project, credential or not", async () => {
      runnerLookup.mockResolvedValue(null);

      await expect(
        RunnerJobService.enqueueAiKubectlCommand(args()),
      ).rejects.toThrow(/Runner was not found or it does not belong/);
      await expect(
        RunnerJobService.enqueueAiKubectlCommand(
          args({ credentialId: CREDENTIAL_ID }),
        ),
      ).rejects.toThrow(/Runner was not found or it does not belong/);
      expect(createdRows).toHaveLength(0);
    });

    it("refuses a credential-less job for the in-cluster Runner of a DIFFERENT cluster", async () => {
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
      ).rejects.toThrow(/in-cluster Runner of cluster "prod-eu"/);
      expect(createdRows).toHaveLength(0);
    });

    it("refuses a credential-less job for a pod Runner with no cluster identity", async () => {
      runnerLookup.mockResolvedValue(
        fakeRunner({
          name: "pod-runner",
          hostInfo: { kubernetes: { inCluster: true } },
        }),
      );

      await expect(
        RunnerJobService.enqueueAiKubectlCommand(args()),
      ).rejects.toThrow(/an unnamed cluster/);
      expect(createdRows).toHaveLength(0);
    });

    it("refuses a credential-less job for a Runner outside the cluster", async () => {
      runnerLookup.mockResolvedValue(
        fakeRunner({ name: "office-runner", hostInfo: { hostname: "x" } }),
      );

      await expect(
        RunnerJobService.enqueueAiKubectlCommand(args()),
      ).rejects.toThrow(/runs outside the cluster/);
      expect(createdRows).toHaveLength(0);
    });

    it("refuses a credential-less job when the cluster row has no identifier to match", async () => {
      clusterLookup.mockResolvedValue(fakeCluster({ clusterIdentifier: "" }));

      await expect(
        RunnerJobService.enqueueAiKubectlCommand(args()),
      ).rejects.toThrow(BadDataException);
      expect(createdRows).toHaveLength(0);
    });

    it("accepts a credential-less job when the posture names the cluster in a different case", async () => {
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

    /*
     * Flipped with the credential-exfiltration fix. This used to enqueue:
     * "the credential names the API server". But a kubernetes-agent Runner
     * is minted and re-keyed with the telemetry ingestion key, so it is
     * never handed credential material — the job must never exist.
     */
    it("refuses a credential job for a kubernetes-agent Runner, even another cluster's", async () => {
      runnerLookup.mockResolvedValue(
        fakeRunner({
          name: "kubernetes-agent/prod-eu",
          hostInfo: {
            kubernetes: { inCluster: true, clusterIdentifier: "prod-eu" },
          },
        }),
      );

      await expect(
        RunnerJobService.enqueueAiKubectlCommand(
          args({ credentialId: CREDENTIAL_ID }),
        ),
      ).rejects.toThrow(/is never given a credential/);
      expect(createdRows).toHaveLength(0);
    });

    it("refuses it by the server-owned NAME, even when the Runner's posture was dropped on heartbeat", async () => {
      runnerLookup.mockResolvedValue(
        fakeRunner({ name: "kubernetes-agent/prod-eu", hostInfo: {} }),
      );

      await expect(
        RunnerJobService.enqueueAiKubectlCommand(
          args({ credentialId: CREDENTIAL_ID }),
        ),
      ).rejects.toThrow(/is never given a credential/);
      expect(createdRows).toHaveLength(0);
    });

    it("negative control: a dashboard Runner living in another cluster's pod may carry the credential", async () => {
      runnerLookup.mockResolvedValue(
        fakeRunner({
          name: "pod-runner",
          hostInfo: {
            kubernetes: { inCluster: true, clusterIdentifier: "prod-eu" },
          },
        }),
      );

      const job: RunnerJob = await RunnerJobService.enqueueAiKubectlCommand(
        args({ credentialId: CREDENTIAL_ID }),
      );

      expect(job.payload?.["credentialId"]).toBe(CREDENTIAL_ID);
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
        aiAccessCredentialId: true,
        isAiInvestigationEnabled: true,
        aiRemediationMode: true,
      });
    });

    it("refuses a job for a Runner the cluster is no longer bound to", async () => {
      clusterLookup.mockResolvedValue(
        fakeCluster({ aiAccessRunnerId: ObjectID.generate() }),
      );

      await expect(
        RunnerJobService.enqueueAiKubectlCommand(args()),
      ).rejects.toThrow(/no longer reached through this Runner/);
      expect(runnerLookup).not.toHaveBeenCalled();
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

    it("refuses a credential that is no longer the cluster's bound credential", async () => {
      clusterLookup.mockResolvedValue(
        fakeCluster({ aiAccessCredentialId: ObjectID.generate() }),
      );
      runnerLookup.mockResolvedValue(
        fakeRunner({ name: "office-runner", hostInfo: { hostname: "x" } }),
      );

      await expect(
        RunnerJobService.enqueueAiKubectlCommand(
          args({ credentialId: CREDENTIAL_ID }),
        ),
      ).rejects.toThrow(/no longer reached with this Kubernetes credential/);

      clusterLookup.mockResolvedValue(
        fakeCluster({ aiAccessCredentialId: undefined }),
      );

      await expect(
        RunnerJobService.enqueueAiKubectlCommand(
          args({ credentialId: CREDENTIAL_ID }),
        ),
      ).rejects.toThrow(/no longer reached with this Kubernetes credential/);
      expect(createdRows).toHaveLength(0);
    });

    it("refuses a bound credential that is not a Kubernetes credential of this project", async () => {
      runnerLookup.mockResolvedValue(
        fakeRunner({ name: "office-runner", hostInfo: { hostname: "x" } }),
      );
      credentialLookup.mockResolvedValue(
        fakeCredential({ credentialType: RunbookCredentialType.SSH }),
      );

      await expect(
        RunnerJobService.enqueueAiKubectlCommand(
          args({ credentialId: CREDENTIAL_ID }),
        ),
      ).rejects.toThrow(/not a Kubernetes credential of this project/);

      credentialLookup.mockResolvedValue(null);

      await expect(
        RunnerJobService.enqueueAiKubectlCommand(
          args({ credentialId: CREDENTIAL_ID }),
        ),
      ).rejects.toThrow(/not a Kubernetes credential of this project/);

      const query: Record<string, unknown> = (
        credentialLookup.mock.calls[0]![0] as {
          query: Record<string, unknown>;
        }
      ).query;
      expect(query["_id"]).toBe(CREDENTIAL_ID);
      expect(query["projectId"]).toBe(PROJECT_ID);
      expect(createdRows).toHaveLength(0);
    });

    it("refuses an investigation job once 'Let AI investigate with kubectl' is off", async () => {
      clusterLookup.mockResolvedValue(
        fakeCluster({ isAiInvestigationEnabled: false }),
      );

      await expect(
        RunnerJobService.enqueueAiKubectlCommand(args()),
      ).rejects.toThrow(/"Let AI investigate with kubectl" is turned off/);
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
      ).rejects.toThrow(/"Let AI investigate with kubectl" is turned off/);
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
      ).rejects.toThrow(/AI remediation is turned off/);
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
        ).rejects.toThrow(/AI remediation is turned off/);
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

    it("negative control: a credential-less job for the cluster's own agent is fine with a credential still selected", async () => {
      // The default cluster has aiAccessCredentialId set; the job has none.
      const job: RunnerJob =
        await RunnerJobService.enqueueAiKubectlCommand(args());

      expect(job.payload?.["credentialId"]).toBeUndefined();
      expect(credentialLookup).not.toHaveBeenCalled();
      expect(createdRows).toHaveLength(1);
    });

    it("negative control: the bound Runner and bound credential enqueue with the credential on the payload", async () => {
      runnerLookup.mockResolvedValue(
        fakeRunner({ name: "office-runner", hostInfo: { hostname: "x" } }),
      );

      const job: RunnerJob = await RunnerJobService.enqueueAiKubectlCommand(
        args({ credentialId: CREDENTIAL_ID }),
      );

      expect(job.payload?.["credentialId"]).toBe(CREDENTIAL_ID);
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
