import RunnerJobService, {
  MAX_AI_COMMAND_JOBS_PER_PROJECT_PER_HOUR,
  MAX_AI_INVESTIGATION_COMMAND_JOBS_PER_PROJECT_PER_HOUR,
} from "../../../Server/Services/RunnerJobService";
import RunnerJob from "../../../Models/DatabaseModels/RunnerJob";
import RunbookStepType from "../../../Types/Runbook/RunbookStepType";
import RunnerJobOrigin, {
  AI_COMMAND_JOB_ORIGINS,
} from "../../../Types/Runbook/RunnerJobOrigin";
import RunnerJobStatus from "../../../Types/Runbook/RunnerJobStatus";
import { KubectlCommandTier } from "../../../Types/Kubernetes/KubernetesClusterAiAccess";
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
 *   the tier, the cluster and the optional credential, and the row carries
 *   kubernetesClusterId so the cluster's AI page can list it;
 * - each origin has its own hourly project brake.
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

describe("RunnerJobService.enqueueAiKubectlCommand", () => {
  let createdRows: Array<RunnerJob>;

  beforeEach(() => {
    createdRows = [];
    jest
      .spyOn(RunnerJobService, "countBy")
      .mockResolvedValue(new PositiveNumber(0));
    jest
      .spyOn(RunnerJobService, "create")
      .mockImplementation(async (data: unknown): Promise<RunnerJob> => {
        const row: RunnerJob = (data as { data: RunnerJob }).data;
        createdRows.push(row);
        return row;
      });
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
    });
    expect(job.claimDeadlineAt).toBeInstanceOf(Date);
  });

  it("includes the credential id for a Runner outside the cluster", async () => {
    const job: RunnerJob = await RunnerJobService.enqueueAiKubectlCommand(
      args({ credentialId: "55555555-5555-4555-8555-555555555555" }),
    );

    expect(job.payload?.["credentialId"]).toBe(
      "55555555-5555-4555-8555-555555555555",
    );
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
    const countBy: jest.SpyInstance = jest
      .spyOn(RunnerJobService, "countBy")
      .mockResolvedValue(
        new PositiveNumber(
          MAX_AI_INVESTIGATION_COMMAND_JOBS_PER_PROJECT_PER_HOUR,
        ),
      );

    await expect(
      RunnerJobService.enqueueAiKubectlCommand(args()),
    ).rejects.toThrow(/AI investigation commands in the last hour/);

    const investigationQuery: Record<string, unknown> = (
      countBy.mock.calls[0]![0] as { query: Record<string, unknown> }
    ).query;
    expect(investigationQuery["origin"]).toBe(RunnerJobOrigin.AiInvestigation);

    countBy.mockResolvedValue(
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
      countBy.mock.calls[1]![0] as { query: Record<string, unknown> }
    ).query;
    expect(remediationQuery["origin"]).toBe(RunnerJobOrigin.AiRemediation);
    expect(createdRows).toHaveLength(0);
  });

  it("allows the dashboard access test to enqueue without an AI run", async () => {
    const job: RunnerJob = await RunnerJobService.enqueueAiKubectlCommand(
      args({ aiRunId: undefined, command: "kubectl version" }),
    );

    expect(job.aiRunId).toBeUndefined();
    expect(job.payload?.["displayCommand"]).toBe("kubectl version");
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
