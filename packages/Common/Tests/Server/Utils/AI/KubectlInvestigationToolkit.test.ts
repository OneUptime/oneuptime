import KubectlInvestigationToolkit, {
  INVESTIGATION_MAX_WALL_CLOCK_MS,
  LIST_CLUSTER_ACCESS_TOOL_NAME,
  RUN_KUBECTL_TOOL_NAME,
} from "../../../../Server/Utils/AI/ClusterAccess/KubectlInvestigationToolkit";
import KubectlJobRunner, {
  KUBECTL_CLAIM_TIMEOUT_MS,
  KUBECTL_OUTPUT_TRUNCATED_SUFFIX,
  RedactedKubectlOutput,
} from "../../../../Server/Utils/AI/ClusterAccess/KubectlJobRunner";
import { MAX_WALL_CLOCK_MS as ENGINE_MAX_WALL_CLOCK_MS } from "../../../../Server/Utils/AI/SRE/AIInvestigationEngine";
import { ObservabilityAssistantExtraTool } from "../../../../Server/Utils/AI/Chat/ObservabilityAssistant";
import { ToolCallOutcome } from "../../../../Server/Utils/AI/Toolbox/Index";
import AIRunService from "../../../../Server/Services/AIRunService";
import KubernetesClusterAiAccessService from "../../../../Server/Services/KubernetesClusterAiAccessService";
import RunnerJobService from "../../../../Server/Services/RunnerJobService";
import RunnerJob from "../../../../Models/DatabaseModels/RunnerJob";
import RunnerJobOrigin from "../../../../Types/Runbook/RunnerJobOrigin";
import RunnerJobStatus from "../../../../Types/Runbook/RunnerJobStatus";
import {
  DEFAULT_KUBECTL_TIMEOUT_MS,
  KubernetesAiRemediationMode,
  KubernetesClusterAiAccessStatus,
  MAX_KUBECTL_COMMANDS_PER_INVESTIGATION,
  MAX_KUBECTL_OUTPUT_CHARS_FOR_LLM,
  MAX_KUBECTL_TIMEOUT_MS,
} from "../../../../Types/Kubernetes/KubernetesClusterAiAccess";
import { KUBECTL_REDACTED_MARKER } from "../../../../Utils/AiRemediation/KubectlOutputRedactor";
import KubectlWaitBudget, {
  KUBECTL_WAIT_OVERHEAD_MS,
  MIN_KUBECTL_CLAIM_TIMEOUT_MS,
} from "../../../../Utils/AiRemediation/KubectlWaitBudget";
import ObjectID from "../../../../Types/ObjectID";
import { JSONObject } from "../../../../Types/JSON";
import { afterEach, beforeEach, describe, expect, it } from "@jest/globals";

/*
 * Contract under test — the run-scoped, READ-ONLY kubectl toolkit an
 * investigation gets:
 *
 * - no investigation-ready cluster, no tools at all (the model is told in
 *   its context why, and a tool that always fails only burns budget);
 * - run_kubectl only accepts a cluster from the ready set, only Read-tier
 *   commands (never a Secret read), and at most
 *   MAX_KUBECTL_COMMANDS_PER_INVESTIGATION of them;
 * - a command runs as an AiInvestigation-origin job through the shared
 *   KubectlJobRunner (which records the outcome on the cluster) and its
 *   output reaches the model framed as untrusted cluster data, with Secret
 *   data, credential-like env values, tokens and kubeconfig material
 *   masked before the model sees any of it;
 * - every command's claim window and execution timeout are planned so the
 *   wait ends before the run's wall-clock deadline, and a command the
 *   budget can no longer hold is refused before anything is enqueued;
 * - a job failure becomes a tool failure the model can continue from,
 *   never a thrown error that kills the investigation.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "22222222-2222-4222-8222-222222222222",
);
const RUN_ID: ObjectID = new ObjectID("88888888-8888-4888-8888-888888888888");
const CLUSTER_ID: ObjectID = new ObjectID(
  "33333333-3333-4333-8333-333333333333",
);
const RUNNER_ID: ObjectID = new ObjectID(
  "44444444-4444-4444-8444-444444444444",
);
const JOB_ID: ObjectID = new ObjectID("66666666-6666-4666-8666-666666666666");

function readyCluster(
  overrides: Partial<KubernetesClusterAiAccessStatus> = {},
): KubernetesClusterAiAccessStatus {
  return {
    clusterId: CLUSTER_ID.toString(),
    clusterName: "prod-us",
    clusterIdentifier: "prod-us",
    runner: {
      id: RUNNER_ID.toString(),
      name: "kubernetes-agent/prod-us",
      isOnline: true,
      canRunAiCommands: true,
      posture: { inCluster: true, allowWrites: false },
    },
    accessMethod: "in_cluster",
    kubectlAllowlist: [],
    isInvestigationEnabled: true,
    isInvestigationReady: true,
    remediationMode: KubernetesAiRemediationMode.Disabled,
    isRemediationReady: false,
    gaps: [],
    evaluatedAt: new Date().toISOString(),
    ...overrides,
  };
}

function getTool(
  toolkit: KubectlInvestigationToolkit,
  name: string,
): ObservabilityAssistantExtraTool {
  const tool: ObservabilityAssistantExtraTool | undefined = toolkit
    .buildTools()
    .find((candidate: ObservabilityAssistantExtraTool) => {
      return candidate.definition.name === name;
    });
  if (!tool) {
    throw new Error(`Tool ${name} not offered.`);
  }
  return tool;
}

function fakeJob(overrides: Partial<Record<string, unknown>> = {}): RunnerJob {
  return {
    id: JOB_ID,
    _id: JOB_ID.toString(),
    status: RunnerJobStatus.Succeeded,
    exitCode: 0,
    output: "NAME   READY   STATUS    RESTARTS\nweb-1  0/1     Pending   0",
    payload: { displayCommand: "kubectl get pods -n web" },
    ...overrides,
  } as unknown as RunnerJob;
}

describe("KubectlInvestigationToolkit.buildTools", () => {
  it("offers nothing when no cluster is investigation-ready", () => {
    const toolkit: KubectlInvestigationToolkit =
      new KubectlInvestigationToolkit({
        projectId: PROJECT_ID,
        aiRunId: RUN_ID,
        clusters: [
          readyCluster({ isInvestigationReady: false }),
          readyCluster({ runner: null }),
        ],
      });

    expect(toolkit.buildTools()).toEqual([]);
  });

  it("offers list_cluster_access and run_kubectl for a ready cluster", () => {
    const toolkit: KubectlInvestigationToolkit =
      new KubectlInvestigationToolkit({
        projectId: PROJECT_ID,
        aiRunId: RUN_ID,
        clusters: [readyCluster()],
      });

    expect(
      toolkit.buildTools().map((tool: ObservabilityAssistantExtraTool) => {
        return tool.definition.name;
      }),
    ).toEqual([LIST_CLUSTER_ACCESS_TOOL_NAME, RUN_KUBECTL_TOOL_NAME]);
  });

  it("admits a remediation-ready cluster when asked to check remediation readiness", () => {
    const cluster: KubernetesClusterAiAccessStatus = readyCluster({
      isInvestigationReady: false,
      isRemediationReady: true,
      remediationMode: KubernetesAiRemediationMode.RequireApproval,
    });

    expect(
      new KubectlInvestigationToolkit({
        projectId: PROJECT_ID,
        aiRunId: RUN_ID,
        clusters: [cluster],
      }).buildTools(),
    ).toEqual([]);

    expect(
      new KubectlInvestigationToolkit({
        projectId: PROJECT_ID,
        aiRunId: RUN_ID,
        clusters: [cluster],
        readinessCheck: "remediation",
      }).buildTools(),
    ).toHaveLength(2);
  });
});

describe("KubectlInvestigationToolkit run_kubectl", () => {
  let recordOutcome: jest.SpyInstance;

  beforeEach(() => {
    jest
      .spyOn(AIRunService, "updateOneBy")
      .mockResolvedValue(undefined as never);
    recordOutcome = jest
      .spyOn(KubernetesClusterAiAccessService, "recordCommandOutcome")
      .mockResolvedValue(undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("lists the ready clusters with their ids", async () => {
    const outcome: ToolCallOutcome = await getTool(
      new KubectlInvestigationToolkit({
        projectId: PROJECT_ID,
        aiRunId: RUN_ID,
        clusters: [readyCluster()],
      }),
      LIST_CLUSTER_ACCESS_TOOL_NAME,
    ).execute({});

    expect(outcome.success).toBe(true);
    expect(outcome.result?.rowCount).toBe(1);
    expect(outcome.textForLlm).toContain(CLUSTER_ID.toString());
    expect(outcome.textForLlm).toContain("prod-us");
  });

  it("refuses a cluster that is not in the ready set", async () => {
    const enqueue: jest.SpyInstance = jest.spyOn(
      RunnerJobService,
      "enqueueAiKubectlCommand",
    );

    const outcome: ToolCallOutcome = await getTool(
      new KubectlInvestigationToolkit({
        projectId: PROJECT_ID,
        aiRunId: RUN_ID,
        clusters: [readyCluster()],
      }),
      RUN_KUBECTL_TOOL_NAME,
    ).execute({
      clusterId: "99999999-9999-4999-8999-999999999999",
      command: "kubectl get pods",
      rationale: "look",
    });

    expect(outcome.success).toBe(false);
    expect(outcome.textForLlm).toContain("not one of the clusters");
    expect(enqueue).not.toHaveBeenCalled();
  });

  it("refuses a write and a denied command without enqueueing anything", async () => {
    const enqueue: jest.SpyInstance = jest.spyOn(
      RunnerJobService,
      "enqueueAiKubectlCommand",
    );
    const tool: ObservabilityAssistantExtraTool = getTool(
      new KubectlInvestigationToolkit({
        projectId: PROJECT_ID,
        aiRunId: RUN_ID,
        clusters: [readyCluster()],
      }),
      RUN_KUBECTL_TOOL_NAME,
    );

    const write: ToolCallOutcome = await tool.execute({
      clusterId: CLUSTER_ID.toString(),
      command: "kubectl rollout restart deployment/web -n web",
      rationale: "restart it",
    });
    expect(write.success).toBe(false);
    expect(write.textForLlm).toContain("would change the cluster");
    expect(write.textForLlm).toContain("SafeWrite");

    const denied: ToolCallOutcome = await tool.execute({
      clusterId: CLUSTER_ID.toString(),
      command: "kubectl exec -it web -- sh",
      rationale: "poke",
    });
    expect(denied.success).toBe(false);
    expect(denied.textForLlm).toContain("Refused by the kubectl policy");

    expect(enqueue).not.toHaveBeenCalled();
  });

  it("runs a read command as an AiInvestigation job and returns the output as untrusted data", async () => {
    const enqueue: jest.SpyInstance = jest
      .spyOn(RunnerJobService, "enqueueAiKubectlCommand")
      .mockResolvedValue(fakeJob());
    jest
      .spyOn(RunnerJobService, "pollUntilTerminal")
      .mockResolvedValue(fakeJob());

    const toolkit: KubectlInvestigationToolkit =
      new KubectlInvestigationToolkit({
        projectId: PROJECT_ID,
        aiRunId: RUN_ID,
        clusters: [readyCluster()],
      });

    const outcome: ToolCallOutcome = await getTool(
      toolkit,
      RUN_KUBECTL_TOOL_NAME,
    ).execute({
      clusterId: CLUSTER_ID.toString(),
      command: "kubectl get pods -n web",
      rationale: "see pod phases",
    });

    expect(outcome.success).toBe(true);
    expect(toolkit.getCommandsRun()).toBe(1);

    const enqueueArgs: Record<string, unknown> = enqueue.mock
      .calls[0]![0] as Record<string, unknown>;
    expect(enqueueArgs["origin"]).toBe(RunnerJobOrigin.AiInvestigation);
    expect((enqueueArgs["kubernetesClusterId"] as ObjectID).toString()).toBe(
      CLUSTER_ID.toString(),
    );
    expect((enqueueArgs["targetAgentId"] as ObjectID).toString()).toBe(
      RUNNER_ID.toString(),
    );
    expect(enqueueArgs["command"]).toBe("kubectl get pods -n web");
    expect(enqueueArgs["credentialId"]).toBeUndefined();
    expect(enqueueArgs["stepId"]).toBe("ai-investigation-kubectl-1");
    // No deadline given: the normal windows, untouched.
    expect(enqueueArgs["timeoutInMs"]).toBe(DEFAULT_KUBECTL_TIMEOUT_MS);
    expect(enqueueArgs["claimTimeoutInMs"]).toBe(KUBECTL_CLAIM_TIMEOUT_MS);

    expect(outcome.textForLlm).toContain("SUCCEEDED");
    expect(outcome.textForLlm).toContain(
      '<tool_result source="untrusted_cluster_output">',
    );
    expect(outcome.textForLlm).toContain("Pending");
    expect(outcome.result?.citationLabel).toBe(
      'kubectl get pods -n web on cluster "prod-us"',
    );
    expect(recordOutcome).toHaveBeenCalledWith({
      clusterId: expect.any(ObjectID),
      succeeded: true,
      errorMessage: undefined,
    });
  });

  it("passes the cluster's credential id for a Runner outside the cluster", async () => {
    const enqueue: jest.SpyInstance = jest
      .spyOn(RunnerJobService, "enqueueAiKubectlCommand")
      .mockResolvedValue(fakeJob());
    jest
      .spyOn(RunnerJobService, "pollUntilTerminal")
      .mockResolvedValue(fakeJob());

    await getTool(
      new KubectlInvestigationToolkit({
        projectId: PROJECT_ID,
        aiRunId: RUN_ID,
        clusters: [
          readyCluster({
            accessMethod: "credential",
            credentialId: "55555555-5555-4555-8555-555555555555",
          }),
        ],
      }),
      RUN_KUBECTL_TOOL_NAME,
    ).execute({
      clusterId: CLUSTER_ID.toString(),
      command: "kubectl get nodes",
      rationale: "capacity",
    });

    expect(
      (enqueue.mock.calls[0]![0] as Record<string, unknown>)["credentialId"],
    ).toBe("55555555-5555-4555-8555-555555555555");
  });

  it("turns a failed job into a tool failure the model can continue from", async () => {
    jest
      .spyOn(RunnerJobService, "enqueueAiKubectlCommand")
      .mockResolvedValue(fakeJob());
    jest.spyOn(RunnerJobService, "pollUntilTerminal").mockResolvedValue(
      fakeJob({
        status: RunnerJobStatus.TimedOut,
        errorMessage: "No runbook agent picked up this step",
        output: "",
      }),
    );

    const outcome: ToolCallOutcome = await getTool(
      new KubectlInvestigationToolkit({
        projectId: PROJECT_ID,
        aiRunId: RUN_ID,
        clusters: [readyCluster()],
      }),
      RUN_KUBECTL_TOOL_NAME,
    ).execute({
      clusterId: CLUSTER_ID.toString(),
      command: "kubectl get pods -n web",
      rationale: "see pod phases",
    });

    // The command ran (or tried to): success with a FAILED body, not a throw.
    expect(outcome.success).toBe(true);
    expect(outcome.textForLlm).toContain("FAILED");
    expect(outcome.textForLlm).toContain("No runbook agent picked up");
    expect(recordOutcome).toHaveBeenCalledWith(
      expect.objectContaining({ succeeded: false }),
    );
  });

  it("reports an enqueue error as a tool failure instead of throwing", async () => {
    jest
      .spyOn(RunnerJobService, "enqueueAiKubectlCommand")
      .mockRejectedValue(new Error("hourly limit"));

    const outcome: ToolCallOutcome = await getTool(
      new KubectlInvestigationToolkit({
        projectId: PROJECT_ID,
        aiRunId: RUN_ID,
        clusters: [readyCluster()],
      }),
      RUN_KUBECTL_TOOL_NAME,
    ).execute({
      clusterId: CLUSTER_ID.toString(),
      command: "kubectl get pods -n web",
      rationale: "see pod phases",
    });

    expect(outcome.success).toBe(false);
    expect(outcome.textForLlm).toContain("hourly limit");
    expect(outcome.textForLlm).toContain("Continue with OneUptime telemetry");
  });

  /*
   * C5: reading a Secret is Denied by the policy, so the toolkit refuses it
   * before anything is enqueued — the Runner and the enqueue chokepoint
   * refuse the same, and the tool description says so up front.
   */
  it.each([
    "kubectl get secret app-db -n prod -o yaml",
    "kubectl get secrets -A -o json",
    "kubectl get secret sa-token -n kube-system -o jsonpath='{.data.token}'",
    "kubectl describe secret app-db -n prod",
    "kubectl get secrets.v1. -n prod",
    "kubectl get secret/app-db -n prod",
  ])(
    "refuses to read a Secret (%s) before anything is enqueued",
    async (command: string) => {
      const enqueue: jest.SpyInstance = jest.spyOn(
        RunnerJobService,
        "enqueueAiKubectlCommand",
      );
      const toolkit: KubectlInvestigationToolkit =
        new KubectlInvestigationToolkit({
          projectId: PROJECT_ID,
          aiRunId: RUN_ID,
          clusters: [readyCluster()],
        });

      const outcome: ToolCallOutcome = await getTool(
        toolkit,
        RUN_KUBECTL_TOOL_NAME,
      ).execute({
        clusterId: CLUSTER_ID.toString(),
        command,
        rationale: "read the db password",
      });

      expect(outcome.success).toBe(false);
      expect(outcome.textForLlm).toContain("Refused by the kubectl policy");
      expect(outcome.textForLlm).toContain("Nothing was run");
      expect(enqueue).not.toHaveBeenCalled();
      expect(toolkit.getCommandsRun()).toBe(0);
    },
  );

  it("tells the model Secrets are refused and output is redacted", () => {
    const tool: ObservabilityAssistantExtraTool = getTool(
      new KubectlInvestigationToolkit({
        projectId: PROJECT_ID,
        aiRunId: RUN_ID,
        clusters: [readyCluster()],
      }),
      RUN_KUBECTL_TOOL_NAME,
    );

    expect(tool.definition.description).toContain("Reading Secrets is refused");
    expect(tool.definition.description).toContain("redacted from every output");
  });

  /*
   * C5: what a Read command can still return — a pod spec with plaintext
   * env values, a ConfigMap with a connection string, a ServiceAccount
   * token, a Secret the credential's RBAC happened to allow — reaches the
   * model with every credential-looking value masked.
   */
  it("masks Secret data, credential-like env values and tokens before the model sees the output", async () => {
    const PASSWORD_B64: string = "cGFzc3dvcmQ=";
    const JWT: string = `eyJhbGciOiJSUzI1NiIsImtpZCI6IjEyMyJ9.${"a".repeat(24)}.${"b".repeat(16)}`;
    const rawOutput: string = [
      "apiVersion: v1",
      "items:",
      "- apiVersion: v1",
      "  data:",
      `    DB_PASSWORD: ${PASSWORD_B64}`,
      "    tls.key: LS0tLS1CRUdJTiBSU0EgUFJJVkFURSBLRVktLS0tLQo=",
      "  kind: Secret",
      "  metadata:",
      "    name: app-db",
      "    namespace: prod",
      "- apiVersion: v1",
      "  kind: Pod",
      "  metadata:",
      "    name: web-7d9f4c8b5d-x2k9q",
      "  spec:",
      "    containers:",
      "    - name: web",
      "      image: registry.example.com/auth:1.2.3",
      "      env:",
      "      - name: DB_HOST",
      "        value: postgres",
      "      - name: DB_PASSWORD",
      "        value: s3cr3t-value",
      "      - name: STRIPE_KEY",
      "        value: sk-live-abc",
      "- apiVersion: v1",
      "  data:",
      "    DATABASE_URL: postgres://app:hunter2@db.prod.svc:5432/app",
      "    LOG_LEVEL: debug",
      "  kind: ConfigMap",
      "  metadata:",
      "    name: settings",
      "kind: List",
      `token:      ${JWT}`,
      "curl -H 'Authorization: Bearer abcdefghijklmnop1234567890'",
    ].join("\n");

    jest
      .spyOn(RunnerJobService, "enqueueAiKubectlCommand")
      .mockResolvedValue(fakeJob());
    jest
      .spyOn(RunnerJobService, "pollUntilTerminal")
      .mockResolvedValue(fakeJob({ output: rawOutput }));

    const outcome: ToolCallOutcome = await getTool(
      new KubectlInvestigationToolkit({
        projectId: PROJECT_ID,
        aiRunId: RUN_ID,
        clusters: [readyCluster()],
      }),
      RUN_KUBECTL_TOOL_NAME,
    ).execute({
      clusterId: CLUSTER_ID.toString(),
      command: "kubectl get pods -n web -o yaml",
      rationale: "see the pod spec",
    });

    expect(outcome.success).toBe(true);
    const text: string = outcome.textForLlm;

    // Nothing credential-looking survives, in the text or the cited data.
    for (const leaked of [
      PASSWORD_B64,
      "LS0tLS1CRUdJTi",
      "s3cr3t-value",
      "sk-live-abc",
      "hunter2",
      JWT,
      "abcdefghijklmnop1234567890",
    ]) {
      expect(text).not.toContain(leaked);
      expect(outcome.result?.dataForLlm).not.toContain(leaked);
    }

    // The structure the model needs to reason stays readable.
    expect(text).toContain(`    DB_PASSWORD: ${KUBECTL_REDACTED_MARKER}`);
    expect(text).toContain(`    tls.key: ${KUBECTL_REDACTED_MARKER}`);
    expect(text).toContain("  kind: Secret");
    expect(text).toContain("    name: app-db");
    expect(text).toContain("        value: postgres");
    expect(text).toContain(`        value: ${KUBECTL_REDACTED_MARKER}`);
    expect(text).toContain("      image: registry.example.com/auth:1.2.3");
    expect(text).toContain(
      `    DATABASE_URL: postgres://app:${KUBECTL_REDACTED_MARKER}@db.prod.svc:5432/app`,
    );
    expect(text).toContain("    LOG_LEVEL: debug");
    expect(text).toContain('<tool_result source="untrusted_cluster_output">');

    expect(outcome.result?.redactionCount).toBeGreaterThanOrEqual(7);
    expect(outcome.result?.isTruncated).toBe(false);
  });

  it("reports the shared cap's truncation on the result", async () => {
    jest
      .spyOn(RunnerJobService, "enqueueAiKubectlCommand")
      .mockResolvedValue(fakeJob());
    jest.spyOn(RunnerJobService, "pollUntilTerminal").mockResolvedValue(
      fakeJob({
        output: `NAME   READY\n${"web-1  1/1\n".repeat(
          MAX_KUBECTL_OUTPUT_CHARS_FOR_LLM,
        )}`,
      }),
    );

    const outcome: ToolCallOutcome = await getTool(
      new KubectlInvestigationToolkit({
        projectId: PROJECT_ID,
        aiRunId: RUN_ID,
        clusters: [readyCluster()],
      }),
      RUN_KUBECTL_TOOL_NAME,
    ).execute({
      clusterId: CLUSTER_ID.toString(),
      command: "kubectl get pods -A",
      rationale: "everything",
    });

    expect(outcome.result?.isTruncated).toBe(true);
    expect(outcome.textForLlm).toContain("[output truncated]");
    expect(outcome.result?.redactionCount).toBe(0);
  });

  it("redacts a Runner error message that echoes credential material", async () => {
    const JWT: string = `eyJhbGciOiJSUzI1NiIsImtpZCI6IjEyMyJ9.${"c".repeat(24)}.${"d".repeat(16)}`;
    jest
      .spyOn(RunnerJobService, "enqueueAiKubectlCommand")
      .mockResolvedValue(fakeJob());
    jest.spyOn(RunnerJobService, "pollUntilTerminal").mockResolvedValue(
      fakeJob({
        status: RunnerJobStatus.Failed,
        exitCode: 1,
        output: "",
        errorMessage: `error: the server rejected token=${JWT} (Unauthorized)`,
      }),
    );

    const outcome: ToolCallOutcome = await getTool(
      new KubectlInvestigationToolkit({
        projectId: PROJECT_ID,
        aiRunId: RUN_ID,
        clusters: [readyCluster()],
      }),
      RUN_KUBECTL_TOOL_NAME,
    ).execute({
      clusterId: CLUSTER_ID.toString(),
      command: "kubectl get pods -n web",
      rationale: "see pod phases",
    });

    expect(outcome.success).toBe(true);
    expect(outcome.textForLlm).toContain("FAILED");
    expect(outcome.textForLlm).toContain("Unauthorized");
    expect(outcome.textForLlm).not.toContain(JWT);
    expect(recordOutcome).toHaveBeenCalledWith(
      expect.objectContaining({
        succeeded: false,
        errorMessage: expect.not.stringContaining(JWT),
      }),
    );
  });

  it("spends the per-investigation budget and then refuses", async () => {
    jest
      .spyOn(RunnerJobService, "enqueueAiKubectlCommand")
      .mockResolvedValue(fakeJob());
    jest
      .spyOn(RunnerJobService, "pollUntilTerminal")
      .mockResolvedValue(fakeJob());

    const toolkit: KubectlInvestigationToolkit =
      new KubectlInvestigationToolkit({
        projectId: PROJECT_ID,
        aiRunId: RUN_ID,
        clusters: [readyCluster()],
        maxCommands: 2,
      });
    const tool: ObservabilityAssistantExtraTool = getTool(
      toolkit,
      RUN_KUBECTL_TOOL_NAME,
    );
    const call: JSONObject = {
      clusterId: CLUSTER_ID.toString(),
      command: "kubectl get pods -n web",
      rationale: "again",
    };

    expect((await tool.execute(call)).success).toBe(true);
    expect((await tool.execute(call)).success).toBe(true);

    const third: ToolCallOutcome = await tool.execute(call);
    expect(third.success).toBe(false);
    expect(third.textForLlm).toContain("budget (2 commands) is spent");
    expect(toolkit.getCommandsRun()).toBe(2);
    expect(MAX_KUBECTL_COMMANDS_PER_INVESTIGATION).toBeGreaterThan(0);
  });
});

/*
 * C27: the agent loop checks its wall clock only between tool calls, so
 * the toolkit plans each command's claim window and execution timeout
 * against the run's deadline and refuses what no longer fits.
 */
describe("KubectlInvestigationToolkit run_kubectl and the run's wall clock", () => {
  const NOW_MS: number = 1_700_000_000_000;

  let enqueue: jest.SpyInstance;
  let poll: jest.SpyInstance;

  beforeEach(() => {
    jest.spyOn(Date, "now").mockReturnValue(NOW_MS);
    jest
      .spyOn(AIRunService, "updateOneBy")
      .mockResolvedValue(undefined as never);
    jest
      .spyOn(KubernetesClusterAiAccessService, "recordCommandOutcome")
      .mockResolvedValue(undefined);
    enqueue = jest
      .spyOn(RunnerJobService, "enqueueAiKubectlCommand")
      .mockResolvedValue(fakeJob());
    poll = jest
      .spyOn(RunnerJobService, "pollUntilTerminal")
      .mockResolvedValue(fakeJob());
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  function toolkitWithDeadline(
    runDeadlineAtMs: number | undefined,
  ): KubectlInvestigationToolkit {
    return new KubectlInvestigationToolkit({
      projectId: PROJECT_ID,
      aiRunId: RUN_ID,
      clusters: [readyCluster()],
      runDeadlineAtMs,
    });
  }

  async function run(
    toolkit: KubectlInvestigationToolkit,
    timeoutInMs?: number,
  ): Promise<ToolCallOutcome> {
    return getTool(toolkit, RUN_KUBECTL_TOOL_NAME).execute({
      clusterId: CLUSTER_ID.toString(),
      command: "kubectl get pods -n web",
      rationale: "see pod phases",
      ...(timeoutInMs !== undefined ? { timeoutInMs } : {}),
    });
  }

  function enqueuedWindows(): {
    timeoutInMs: number;
    claimTimeoutInMs: number;
  } {
    const args: Record<string, unknown> = enqueue.mock.calls[0]![0] as Record<
      string,
      unknown
    >;
    return {
      timeoutInMs: args["timeoutInMs"] as number,
      claimTimeoutInMs: args["claimTimeoutInMs"] as number,
    };
  }

  function polledWindows(): { timeoutInMs: number; claimTimeoutInMs: number } {
    const args: Record<string, unknown> = poll.mock.calls[0]![0] as Record<
      string,
      unknown
    >;
    return {
      timeoutInMs: args["executionTimeoutInMs"] as number,
      claimTimeoutInMs: args["claimTimeoutInMs"] as number,
    };
  }

  it("passes the requested windows through while the deadline is far away", async () => {
    const outcome: ToolCallOutcome = await run(
      toolkitWithDeadline(NOW_MS + 200_000),
      MAX_KUBECTL_TIMEOUT_MS,
    );

    expect(outcome.success).toBe(true);
    expect(enqueuedWindows()).toEqual({
      timeoutInMs: MAX_KUBECTL_TIMEOUT_MS,
      claimTimeoutInMs: KUBECTL_CLAIM_TIMEOUT_MS,
    });
    expect(polledWindows()).toEqual(enqueuedWindows());
  });

  it("shortens the claim window first and keeps the requested execution time", async () => {
    await run(toolkitWithDeadline(NOW_MS + 80_000));

    expect(enqueuedWindows()).toEqual({
      timeoutInMs: DEFAULT_KUBECTL_TIMEOUT_MS,
      claimTimeoutInMs:
        80_000 - KUBECTL_WAIT_OVERHEAD_MS - DEFAULT_KUBECTL_TIMEOUT_MS,
    });
    expect(polledWindows()).toEqual(enqueuedWindows());
  });

  it("clamps a maximal timeout to what the remaining budget can hold", async () => {
    // The finding's scenario: 120 s asked for with 40 s of the run left.
    await run(toolkitWithDeadline(NOW_MS + 40_000), MAX_KUBECTL_TIMEOUT_MS);

    const windows: { timeoutInMs: number; claimTimeoutInMs: number } =
      enqueuedWindows();
    expect(windows).toEqual({
      timeoutInMs:
        40_000 - KUBECTL_WAIT_OVERHEAD_MS - MIN_KUBECTL_CLAIM_TIMEOUT_MS,
      claimTimeoutInMs: MIN_KUBECTL_CLAIM_TIMEOUT_MS,
    });
    expect(KubectlWaitBudget.getWorstCaseWaitMs(windows)).toBeLessThanOrEqual(
      40_000,
    );
    expect(polledWindows()).toEqual(windows);
  });

  it("refuses, enqueuing nothing and spending no command, when the budget cannot hold another command", async () => {
    const toolkit: KubectlInvestigationToolkit = toolkitWithDeadline(
      NOW_MS + 10_000,
    );

    const outcome: ToolCallOutcome = await run(toolkit, MAX_KUBECTL_TIMEOUT_MS);

    expect(outcome.success).toBe(false);
    expect(outcome.textForLlm).toContain("Not enough time is left");
    expect(outcome.textForLlm).toContain("about 10s remain");
    expect(outcome.textForLlm).toContain(
      `at least ${Math.round(KubectlWaitBudget.getMinimumBudgetMs() / 1000)}s`,
    );
    expect(outcome.textForLlm).toContain("Nothing was run");
    expect(enqueue).not.toHaveBeenCalled();
    expect(poll).not.toHaveBeenCalled();
    expect(toolkit.getCommandsRun()).toBe(0);
  });

  it("refuses once the deadline has passed", async () => {
    const outcome: ToolCallOutcome = await run(toolkitWithDeadline(NOW_MS - 1));

    expect(outcome.success).toBe(false);
    expect(outcome.textForLlm).toContain("about 0s remain");
    expect(enqueue).not.toHaveBeenCalled();
  });

  it("still refuses a Secret read and a write before it looks at the budget", async () => {
    const toolkit: KubectlInvestigationToolkit = toolkitWithDeadline(
      NOW_MS + 200_000,
    );
    const tool: ObservabilityAssistantExtraTool = getTool(
      toolkit,
      RUN_KUBECTL_TOOL_NAME,
    );

    const secret: ToolCallOutcome = await tool.execute({
      clusterId: CLUSTER_ID.toString(),
      command: "kubectl get secret app-db -n prod -o yaml",
      rationale: "read it",
    });
    expect(secret.textForLlm).toContain("Refused by the kubectl policy");

    const write: ToolCallOutcome = await tool.execute({
      clusterId: CLUSTER_ID.toString(),
      command: "kubectl delete pod web-1 -n web",
      rationale: "bounce it",
    });
    expect(write.textForLlm).toContain("would change the cluster");

    expect(enqueue).not.toHaveBeenCalled();
    expect(toolkit.getCommandsRun()).toBe(0);
  });

  it("never lets a planned wait exceed the remaining budget, whatever is asked for", async () => {
    const remainings: Array<number> = [
      KubectlWaitBudget.getMinimumBudgetMs(),
      30_000,
      60_000,
      96_000,
      INVESTIGATION_MAX_WALL_CLOCK_MS,
    ];
    const requests: Array<number> = [
      1_000,
      DEFAULT_KUBECTL_TIMEOUT_MS,
      MAX_KUBECTL_TIMEOUT_MS,
    ];

    for (const remaining of remainings) {
      for (const requested of requests) {
        enqueue.mockClear();
        poll.mockClear();

        const outcome: ToolCallOutcome = await run(
          toolkitWithDeadline(NOW_MS + remaining),
          requested,
        );

        expect(outcome.success).toBe(true);
        const windows: { timeoutInMs: number; claimTimeoutInMs: number } =
          enqueuedWindows();
        expect(
          KubectlWaitBudget.getWorstCaseWaitMs(windows),
        ).toBeLessThanOrEqual(remaining);
        expect(windows.timeoutInMs).toBeLessThanOrEqual(requested);
        expect(windows.claimTimeoutInMs).toBeLessThanOrEqual(
          KUBECTL_CLAIM_TIMEOUT_MS,
        );
        expect(polledWindows()).toEqual(windows);
      }
    }
  });

  it("uses the normal windows without a deadline", async () => {
    await run(toolkitWithDeadline(undefined), MAX_KUBECTL_TIMEOUT_MS);

    expect(enqueuedWindows()).toEqual({
      timeoutInMs: MAX_KUBECTL_TIMEOUT_MS,
      claimTimeoutInMs: KUBECTL_CLAIM_TIMEOUT_MS,
    });
  });

  it("states the engine's own default wall clock, not a copy of it", () => {
    /*
     * The runners hand this value to the engine (maxWallClockMs) and to the
     * toolkit (as a deadline); a second definition is how the two drift.
     */
    expect(INVESTIGATION_MAX_WALL_CLOCK_MS).toBe(ENGINE_MAX_WALL_CLOCK_MS);
    expect(typeof INVESTIGATION_MAX_WALL_CLOCK_MS).toBe("number");
    expect(INVESTIGATION_MAX_WALL_CLOCK_MS).toBeGreaterThan(0);
  });

  it("states one wall clock that a run_kubectl wait can always fit inside", () => {
    // Full windows must fit a fresh budget, or the tool would never run.
    expect(
      KubectlWaitBudget.getWorstCaseWaitMs({
        timeoutInMs: DEFAULT_KUBECTL_TIMEOUT_MS,
        claimTimeoutInMs: KUBECTL_CLAIM_TIMEOUT_MS,
      }),
    ).toBeLessThan(INVESTIGATION_MAX_WALL_CLOCK_MS);
  });
});

describe("KubectlJobRunner.redactAndCap", () => {
  const PASSWORD_B64: string = "cGFzc3dvcmQ=";

  it("masks Secret data structurally and then applies the generic tool-result rules", () => {
    const result: RedactedKubectlOutput = KubectlJobRunner.redactAndCap(
      [
        "apiVersion: v1",
        "data:",
        `  DB_PASSWORD: ${PASSWORD_B64}`,
        "kind: Secret",
        "metadata:",
        "  annotations:",
        "    owner: oncall@example.com",
        "  name: app-db",
      ].join("\n"),
    );

    expect(result.text).not.toContain(PASSWORD_B64);
    expect(result.text).toContain(`  DB_PASSWORD: ${KUBECTL_REDACTED_MARKER}`);
    expect(result.text).toContain("kind: Secret");
    expect(result.text).toContain("  name: app-db");
    // The generic rules still run (this one is the serializer's).
    expect(result.text).not.toContain("oncall@example.com");
    expect(result.text).toContain("[redacted-email]");
    expect(result.redactionCount).toBeGreaterThanOrEqual(2);
    expect(result.isTruncated).toBe(false);
  });

  it("redacts before it caps, so a cut never exposes what the cap removed a mask from", () => {
    const filler: string = `${"pod-line 1/1 Running\n".repeat(
      Math.ceil(MAX_KUBECTL_OUTPUT_CHARS_FOR_LLM / 21),
    )}`;
    const result: RedactedKubectlOutput = KubectlJobRunner.redactAndCap(
      `password: hunter2\n${filler}password: hunter2-after-the-cap\n`,
    );

    expect(result.isTruncated).toBe(true);
    expect(result.text.endsWith(KUBECTL_OUTPUT_TRUNCATED_SUFFIX)).toBe(true);
    expect(result.text.length).toBeLessThanOrEqual(
      MAX_KUBECTL_OUTPUT_CHARS_FOR_LLM + KUBECTL_OUTPUT_TRUNCATED_SUFFIX.length,
    );
    expect(result.text).not.toContain("hunter2");
    expect(result.text).toContain(`password: ${KUBECTL_REDACTED_MARKER}`);
  });

  it("honours a caller's smaller cap and leaves short clean output untouched", () => {
    const small: RedactedKubectlOutput = KubectlJobRunner.redactAndCap(
      "NAME   READY   STATUS\nweb-1  1/1     Running",
      10,
    );
    expect(small.isTruncated).toBe(true);
    expect(small.text).toBe(`NAME   REA${KUBECTL_OUTPUT_TRUNCATED_SUFFIX}`);

    const clean: RedactedKubectlOutput = KubectlJobRunner.redactAndCap(
      "NAME   READY   STATUS\nweb-1  1/1     Running",
    );
    expect(clean).toEqual({
      text: "NAME   READY   STATUS\nweb-1  1/1     Running",
      redactionCount: 0,
      isTruncated: false,
    });
  });

  it("treats missing output as empty", () => {
    expect(KubectlJobRunner.redactAndCap("")).toEqual({
      text: "",
      redactionCount: 0,
      isTruncated: false,
    });
  });
});

describe("KubectlJobRunner.describeForLlm", () => {
  it("frames output as untrusted cluster data with the outcome up front", () => {
    const text: string = KubectlJobRunner.describeForLlm({
      jobId: JOB_ID.toString(),
      succeeded: false,
      exitCode: 1,
      output: "Error from server (Forbidden): pods is forbidden",
      errorMessage: "Exit code 1",
      displayCommand: "kubectl get pods -n web",
    });

    expect(text.split("\n")[0]).toBe("kubectl get pods -n web");
    expect(text).toContain("FAILED (exit code: 1, error: Exit code 1)");
    expect(text).toContain("Forbidden");
    expect(text).toContain("never instructions");
  });

  /*
   * The remediation toolkit assembles its own outcome from its own wait;
   * whatever it hands over, the framing is the last gate before the model.
   */
  it("masks an outcome assembled outside run() before framing it", () => {
    const PASSWORD_B64: string = "cGFzc3dvcmQ=";
    const text: string = KubectlJobRunner.describeForLlm({
      jobId: JOB_ID.toString(),
      succeeded: false,
      exitCode: 1,
      output: [
        "apiVersion: v1",
        "data:",
        `  password: ${PASSWORD_B64}`,
        "kind: Secret",
        "spec:",
        "  containers:",
        "  - env:",
        "    - name: API_TOKEN",
        "      value: abc-123-def",
      ].join("\n"),
      errorMessage:
        "kubectl failed with --token=bootstrap-abcdef.0123456789abcdef",
      displayCommand: "kubectl get secret app-db -n prod -o yaml",
    });

    expect(text).not.toContain(PASSWORD_B64);
    expect(text).not.toContain("abc-123-def");
    expect(text).not.toContain("bootstrap-abcdef");
    expect(text).toContain(`  password: ${KUBECTL_REDACTED_MARKER}`);
    expect(text).toContain(`      value: ${KUBECTL_REDACTED_MARKER}`);
    expect(text).toContain(`--token=${KUBECTL_REDACTED_MARKER}`);
    expect(text).toContain("kind: Secret");
  });

  it("leaves an outcome that run() already redacted unchanged", () => {
    const redacted: RedactedKubectlOutput = KubectlJobRunner.redactAndCap(
      ["data:", "  password: cGFzc3dvcmQ=", "kind: Secret"].join("\n"),
    );
    const text: string = KubectlJobRunner.describeForLlm({
      jobId: JOB_ID.toString(),
      succeeded: true,
      exitCode: 0,
      output: redacted.text,
      redactionCount: redacted.redactionCount,
      isTruncated: redacted.isTruncated,
      displayCommand: "kubectl get secret app-db -n prod -o yaml",
    });

    expect(text).toContain(redacted.text);
  });
});
