import KubectlInvestigationToolkit, {
  INVESTIGATION_MAX_WALL_CLOCK_MS,
  KUBECTL_RESULT_UNKNOWN_EVENT_PREFIX,
  LIST_CLUSTER_ACCESS_TOOL_NAME,
  RUN_KUBECTL_TOOL_NAME,
} from "../../../../Server/Utils/AI/ClusterAccess/KubectlInvestigationToolkit";
import { isKubectlResultUnknownMessage } from "../../../../../App/FeatureSet/Dashboard/src/Components/AI/ClusterToolFormat";
import { KUBECTL_RESULT_UNKNOWN_EVENT_PREFIX as SHARED_KUBECTL_RESULT_UNKNOWN_PREFIX } from "../../../../Types/Kubernetes/KubernetesClusterAiAccessToolNames";
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
import AIRunStatus from "../../../../Types/AI/AIRunStatus";
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
 *   never a thrown error that kills the investigation;
 * - only a command that reached kubectl is evidence (cited, counted as
 *   run); one that never ran is a failed call, one a Runner took whose
 *   result never came back is a failed call marked "result unknown"
 *   (never "did not run"), and one no Runner claimed makes its Runner —
 *   and every cluster it serves — unreachable for the rest of the run.
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

  /*
   * A kubectl that ran and exited non-zero is still evidence ("NotFound",
   * "Forbidden" are findings): a completed, cited tool call with rowCount 0
   * the model can continue from — never a thrown error.
   */
  it("keeps a command that ran and failed as cited evidence with rowCount 0", async () => {
    jest.spyOn(RunnerJobService, "enqueueAiKubectlCommand").mockResolvedValue(
      fakeJob({
        payload: { displayCommand: "kubectl describe pod web-7d9f-abc -n web" },
      }),
    );
    jest.spyOn(RunnerJobService, "pollUntilTerminal").mockResolvedValue(
      fakeJob({
        status: RunnerJobStatus.Failed,
        exitCode: 1,
        errorMessage: "Exit code 1",
        output:
          '[stderr]\nError from server (NotFound): pods "web-7d9f-abc" not found',
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
      command: "kubectl describe pod web-7d9f-abc -n web",
      rationale: "see why it is pending",
    });

    expect(outcome.success).toBe(true);
    expect(outcome.result?.rowCount).toBe(0);
    expect(outcome.result?.citationLabel).toBe(
      'kubectl describe pod web-7d9f-abc -n web on cluster "prod-us"',
    );
    expect(outcome.textForLlm).toContain("FAILED (exit code: 1");
    expect(outcome.textForLlm).toContain("NotFound");
  });

  /*
   * The contract the investigation panel counts from: a command that ran
   * is a completed call whose rowCount says whether kubectl succeeded.
   */
  it("reports rowCount 1 for a command that succeeded", async () => {
    jest
      .spyOn(RunnerJobService, "enqueueAiKubectlCommand")
      .mockResolvedValue(fakeJob());
    jest
      .spyOn(RunnerJobService, "pollUntilTerminal")
      .mockResolvedValue(fakeJob());

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
    expect(outcome.result?.rowCount).toBe(1);
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

/*
 * A command that never reached kubectl — no Runner claimed it, or the
 * server or the Runner refused it before spawning kubectl — produced no
 * evidence. It is a FAILED tool call (no citation, so the agent loop emits
 * tool_failed and the panel never counts it as run), and an unclaimed one
 * trips a per-cluster breaker so later commands for that cluster fail at
 * once instead of each waiting out another claim window.
 */
describe("KubectlInvestigationToolkit run_kubectl when kubectl never ran", () => {
  const OTHER_CLUSTER_ID: ObjectID = new ObjectID(
    "77777777-7777-4777-8777-777777777777",
  );
  const OTHER_RUNNER_ID: ObjectID = new ObjectID(
    "99999999-9999-4999-8999-999999999999",
  );
  const UNCLAIMED_REASON: string =
    "No runbook agent picked up this step before the wait window expired. The agent may be offline — check that it is running and reachable, then try again.";

  let enqueue: jest.SpyInstance;
  let poll: jest.SpyInstance;
  let claimRead: jest.SpyInstance;
  let recordOutcome: jest.SpyInstance;

  // What RunnerJobService.timeoutJob hands back: no claimedAt selected.
  function timedOutJob(): RunnerJob {
    return fakeJob({
      status: RunnerJobStatus.TimedOut,
      exitCode: undefined,
      output: "",
      errorMessage: UNCLAIMED_REASON,
    });
  }

  // The claim columns of the row, as KubectlJobRunner re-reads them.
  function claimRow(overrides: Partial<Record<string, unknown>>): RunnerJob {
    return { _id: JOB_ID.toString(), ...overrides } as unknown as RunnerJob;
  }

  function singleClusterToolkit(): KubectlInvestigationToolkit {
    return new KubectlInvestigationToolkit({
      projectId: PROJECT_ID,
      aiRunId: RUN_ID,
      clusters: [readyCluster()],
    });
  }

  function twoClusterToolkit(): KubectlInvestigationToolkit {
    return new KubectlInvestigationToolkit({
      projectId: PROJECT_ID,
      aiRunId: RUN_ID,
      clusters: [
        readyCluster(),
        readyCluster({
          clusterId: OTHER_CLUSTER_ID.toString(),
          clusterName: "prod-eu",
          clusterIdentifier: "prod-eu",
          runner: {
            id: OTHER_RUNNER_ID.toString(),
            name: "kubernetes-agent/prod-eu",
            isOnline: true,
            canRunAiCommands: true,
            posture: { inCluster: true, allowWrites: false },
          },
        }),
      ],
    });
  }

  async function runOn(
    toolkit: KubectlInvestigationToolkit,
    clusterId: ObjectID = CLUSTER_ID,
    command: string = "kubectl get pods -n web",
  ): Promise<ToolCallOutcome> {
    return getTool(toolkit, RUN_KUBECTL_TOOL_NAME).execute({
      clusterId: clusterId.toString(),
      command,
      rationale: "see pod phases",
    });
  }

  beforeEach(() => {
    jest
      .spyOn(AIRunService, "updateOneBy")
      .mockResolvedValue(undefined as never);
    recordOutcome = jest
      .spyOn(KubernetesClusterAiAccessService, "recordCommandOutcome")
      .mockResolvedValue(undefined);
    enqueue = jest
      .spyOn(RunnerJobService, "enqueueAiKubectlCommand")
      .mockResolvedValue(fakeJob());
    poll = jest
      .spyOn(RunnerJobService, "pollUntilTerminal")
      .mockResolvedValue(timedOutJob());
    // Never claimed: no claimedAt, no assignedAgentId, no startedAt.
    claimRead = jest
      .spyOn(RunnerJobService, "findOneById")
      .mockResolvedValue(claimRow({}));
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("reports an unclaimed job as a failed call with no citation, never as run", async () => {
    const toolkit: KubectlInvestigationToolkit = singleClusterToolkit();

    const outcome: ToolCallOutcome = await runOn(toolkit);

    expect(outcome.success).toBe(false);
    expect(outcome.result).toBeUndefined();
    expect(outcome.textForLlm).toContain(
      'kubectl was NOT run on cluster "prod-us"',
    );
    expect(outcome.textForLlm).toContain("did not pick up");
    expect(outcome.textForLlm).toContain("Continue with OneUptime telemetry");
    // The runbook wording invites a retry; the model must be told not to.
    expect(outcome.textForLlm).not.toContain("try again");
    expect(outcome.textForLlm).not.toContain("runbook");
    expect(outcome.textForLlm).toContain("do not call run_kubectl on it again");
    // The persisted event names the cluster and nothing about its Runner.
    expect(outcome.errorMessage).toBe(
      'kubectl was not run on cluster "prod-us": its Runner did not pick up the command in time.',
    );
    // The claim state was read from the row, not guessed from the reason.
    expect(claimRead).toHaveBeenCalledTimes(1);
    expect(
      (claimRead.mock.calls[0]![0] as { select: Record<string, boolean> })
        .select,
    ).toEqual(
      expect.objectContaining({
        claimedAt: true,
        startedAt: true,
        assignedAgentId: true,
      }),
    );
    // A job was enqueued, so it counts against the per-run cap.
    expect(toolkit.getCommandsRun()).toBe(1);
  });

  it("trips a per-cluster breaker: the next command fails at once, enqueues nothing and spends nothing", async () => {
    const toolkit: KubectlInvestigationToolkit = singleClusterToolkit();

    await runOn(toolkit);
    expect(toolkit.isClusterUnreachable(CLUSTER_ID.toString())).toBe(true);

    const plan: jest.SpyInstance = jest.spyOn(KubectlWaitBudget, "plan");
    const second: ToolCallOutcome = await runOn(
      toolkit,
      CLUSTER_ID,
      "kubectl get events -n web",
    );

    expect(second.success).toBe(false);
    expect(second.result).toBeUndefined();
    expect(second.textForLlm).toContain(
      "treated as unreachable for the rest of this investigation",
    );
    expect(second.textForLlm).toContain(
      `within ${Math.round(KUBECTL_CLAIM_TIMEOUT_MS / 1000)}s`,
    );
    expect(second.textForLlm).toContain("Nothing was run");
    expect(second.textForLlm).toContain("continue with OneUptime telemetry");
    expect(second.errorMessage).toContain(
      'kubectl was not run on cluster "prod-us"',
    );
    expect(enqueue).toHaveBeenCalledTimes(1);
    expect(poll).toHaveBeenCalledTimes(1);
    expect(plan).not.toHaveBeenCalled();
    expect(toolkit.getCommandsRun()).toBe(1);
  });

  it("marks the unreachable cluster in list_cluster_access", async () => {
    const toolkit: KubectlInvestigationToolkit = twoClusterToolkit();

    await runOn(toolkit);

    const listing: ToolCallOutcome = await getTool(
      toolkit,
      LIST_CLUSTER_ACCESS_TOOL_NAME,
    ).execute({});

    const lines: Array<string> = listing.textForLlm.split("\n");
    expect(lines[0]).toContain('"prod-us"');
    expect(lines[0]).toContain(
      "UNREACHABLE for the rest of this investigation",
    );
    expect(lines[1]).toContain('"prod-eu"');
    expect(lines[1]).toContain(
      'read-only kubectl via Runner "kubernetes-agent/prod-eu"',
    );
  });

  // Negative control for the per-Runner breaker: another Runner is not tripped.
  it("keeps the breaker per Runner: a cluster on another Runner still runs", async () => {
    const toolkit: KubectlInvestigationToolkit = twoClusterToolkit();

    await runOn(toolkit, CLUSTER_ID);
    poll.mockResolvedValue(fakeJob());

    const other: ToolCallOutcome = await runOn(toolkit, OTHER_CLUSTER_ID);

    expect(other.success).toBe(true);
    expect(other.result?.rowCount).toBe(1);
    expect(enqueue).toHaveBeenCalledTimes(2);
    expect(
      (
        (enqueue.mock.calls[1]![0] as Record<string, unknown>)[
          "kubernetesClusterId"
        ] as ObjectID
      ).toString(),
    ).toBe(OTHER_CLUSTER_ID.toString());
    expect(toolkit.isClusterUnreachable(OTHER_CLUSTER_ID.toString())).toBe(
      false,
    );
  });

  /*
   * IP-4: two clusters bound to the same external Runner, each with its
   * own credential. Jobs are claimed by Runner, never by cluster, so an
   * unclaimed command on one says the other's commands will not be
   * claimed either.
   */
  function sharedRunnerToolkit(): KubectlInvestigationToolkit {
    const sharedRunner: KubernetesClusterAiAccessStatus["runner"] = {
      id: RUNNER_ID.toString(),
      name: "ops-runner",
      isOnline: true,
      canRunAiCommands: true,
    };

    return new KubectlInvestigationToolkit({
      projectId: PROJECT_ID,
      aiRunId: RUN_ID,
      clusters: [
        readyCluster({
          runner: sharedRunner,
          accessMethod: "credential",
          credentialId: "11111111-1111-4111-8111-111111111111",
        }),
        readyCluster({
          clusterId: OTHER_CLUSTER_ID.toString(),
          clusterName: "prod-eu",
          clusterIdentifier: "prod-eu",
          runner: sharedRunner,
          accessMethod: "credential",
          credentialId: "55555555-5555-4555-8555-555555555555",
        }),
      ],
    });
  }

  it("trips the breaker for every cluster on the Runner that left a command unclaimed", async () => {
    const toolkit: KubectlInvestigationToolkit = sharedRunnerToolkit();

    const first: ToolCallOutcome = await runOn(toolkit, CLUSTER_ID);

    // The trip message tells the model the other cluster is gone too.
    expect(first.textForLlm).toContain(
      'The same Runner "ops-runner" serves "prod-eu", so that cluster is unreachable too.',
    );

    const plan: jest.SpyInstance = jest.spyOn(KubectlWaitBudget, "plan");
    const second: ToolCallOutcome = await runOn(toolkit, OTHER_CLUSTER_ID);

    expect(second.success).toBe(false);
    expect(second.result).toBeUndefined();
    expect(second.textForLlm).toContain(
      "treated as unreachable for the rest of this investigation",
    );
    expect(second.textForLlm).toContain('Runner "ops-runner"');
    expect(second.textForLlm).toContain('serves cluster "prod-eu"');
    expect(second.textForLlm).toContain('(for cluster "prod-us")');
    expect(second.textForLlm).toContain("Nothing was run");
    expect(second.errorMessage).toBe(
      'kubectl was not run on cluster "prod-eu": its Runner did not pick up an earlier command, so the cluster was unreachable for the rest of this investigation.',
    );
    // No second claim window was waited out.
    expect(enqueue).toHaveBeenCalledTimes(1);
    expect(plan).not.toHaveBeenCalled();
    expect(toolkit.getCommandsRun()).toBe(1);
    expect(toolkit.isClusterUnreachable(CLUSTER_ID.toString())).toBe(true);
    expect(toolkit.isClusterUnreachable(OTHER_CLUSTER_ID.toString())).toBe(
      true,
    );

    const listing: ToolCallOutcome = await getTool(
      toolkit,
      LIST_CLUSTER_ACCESS_TOOL_NAME,
    ).execute({});
    const lines: Array<string> = listing.textForLlm.split("\n");

    expect(lines).toHaveLength(2);
    for (const line of lines) {
      expect(line).toContain("UNREACHABLE for the rest of this investigation");
      expect(line).toContain('its Runner "ops-runner"');
    }
  });

  /*
   * Negative controls: on a shared Runner, only an UNCLAIMED command trips
   * the breaker. A command that was claimed and went silent, ran and
   * exited non-zero, or was refused by the Runner leaves the other
   * cluster's commands running.
   */
  it.each<[string, () => void]>([
    [
      "was claimed and then went silent",
      (): void => {
        claimRead.mockResolvedValue(
          claimRow({
            claimedAt: new Date("2026-09-22T10:00:00.000Z"),
            assignedAgentId: RUNNER_ID,
          }),
        );
      },
    ],
    [
      "ran and exited non-zero",
      (): void => {
        poll.mockResolvedValueOnce(
          fakeJob({
            status: RunnerJobStatus.Failed,
            exitCode: 1,
            errorMessage: "Exit code 1",
            output:
              '[stderr]\nError from server (NotFound): pods "x" not found',
          }),
        );
      },
    ],
    [
      "was refused by the Runner",
      (): void => {
        poll.mockResolvedValueOnce(
          fakeJob({
            status: RunnerJobStatus.Failed,
            exitCode: undefined,
            output: "",
            errorMessage: "Refused by the Runner: --kubeconfig is not allowed.",
          }),
        );
      },
    ],
  ])(
    "does not trip the shared Runner's breaker for a command that %s",
    async (_label: string, arrange: () => void) => {
      arrange();
      const toolkit: KubectlInvestigationToolkit = sharedRunnerToolkit();

      await runOn(toolkit, CLUSTER_ID);
      poll.mockResolvedValue(fakeJob());
      const other: ToolCallOutcome = await runOn(toolkit, OTHER_CLUSTER_ID);

      expect(other.success).toBe(true);
      expect(enqueue).toHaveBeenCalledTimes(2);
      expect(toolkit.isClusterUnreachable(OTHER_CLUSTER_ID.toString())).toBe(
        false,
      );
    },
  );

  it("reports the claim window actually planned for the command", async () => {
    const NOW_MS: number = 1_700_000_000_000;
    jest.spyOn(Date, "now").mockReturnValue(NOW_MS);
    const toolkit: KubectlInvestigationToolkit =
      new KubectlInvestigationToolkit({
        projectId: PROJECT_ID,
        aiRunId: RUN_ID,
        clusters: [readyCluster()],
        runDeadlineAtMs: NOW_MS + 40_000,
      });

    const outcome: ToolCallOutcome = await runOn(toolkit);

    expect(outcome.textForLlm).toContain(
      `within ${Math.round(MIN_KUBECTL_CLAIM_TIMEOUT_MS / 1000)}s`,
    );
  });

  /*
   * Negative controls: only a job no Runner ever took trips the breaker. A
   * kubectl that ran and failed, or a Runner that took the job and went
   * silent, leaves the cluster reachable.
   */
  it("does not trip the breaker for a command that ran and exited non-zero", async () => {
    poll.mockResolvedValue(
      fakeJob({
        status: RunnerJobStatus.Failed,
        exitCode: 1,
        errorMessage: "Exit code 1",
        output: '[stderr]\nError from server (NotFound): pods "x" not found',
      }),
    );
    const toolkit: KubectlInvestigationToolkit = singleClusterToolkit();

    expect((await runOn(toolkit)).success).toBe(true);
    expect((await runOn(toolkit)).success).toBe(true);

    expect(enqueue).toHaveBeenCalledTimes(2);
    expect(toolkit.isClusterUnreachable(CLUSTER_ID.toString())).toBe(false);
    // The Failed row is read as it is; only a TimedOut row is re-read.
    expect(claimRead).not.toHaveBeenCalled();
  });

  /*
   * IP-1: a Runner took the job and no result came back. The row may have
   * claimedAt and assignedAgentId but no startedAt — the Runner announces a
   * step with one best-effort heartbeat (capped at 5 s) right before its
   * executor gets it, and runs it anyway when that gets no answer (an
   * older Runner's first heartbeat came 10 s in) — or startedAt too, which
   * does not prove kubectl ran either. It may have run: no citation (there
   * is no output), no breaker (the Runner is alive enough to claim), and
   * never "refused" or "did not run".
   */
  it.each<[string, Partial<Record<string, unknown>>]>([
    [
      "never heartbeated (its start heartbeat and its result both lost)",
      {
        claimedAt: new Date("2026-09-22T10:00:00.000Z"),
        assignedAgentId: RUNNER_ID,
        startedAt: null,
      },
    ],
    [
      "heartbeated and then went silent",
      {
        claimedAt: new Date("2026-09-22T10:00:00.000Z"),
        assignedAgentId: RUNNER_ID,
        startedAt: new Date("2026-09-22T10:00:10.000Z"),
      },
    ],
  ])(
    "reports a job a Runner claimed and %s as result unknown, not as run or not run",
    async (_label: string, row: Partial<Record<string, unknown>>) => {
      claimRead.mockResolvedValue(claimRow(row));
      const toolkit: KubectlInvestigationToolkit = singleClusterToolkit();

      const first: ToolCallOutcome = await runOn(toolkit);

      // Nothing came back, so there is nothing to cite...
      expect(first.success).toBe(false);
      expect(first.result).toBeUndefined();
      expect(first.textForLlm).toContain("did not report a result");
      expect(first.textForLlm).toContain("Whether it ran");
      expect(first.textForLlm).not.toContain("runbook");
      expect(first.textForLlm).not.toContain("try again");
      // ...and the persisted event says so, in a form the panel can tell apart.
      expect(first.errorMessage).toBe(
        `${KUBECTL_RESULT_UNKNOWN_EVENT_PREFIX} the Runner of cluster "prod-us" took the command, but no result came back, so whether it ran is unknown.`,
      );
      expect(first.errorMessage).not.toContain("refused");
      expect(first.errorMessage).not.toContain("did not run");
      expect(first.errorMessage).not.toContain("not run");
      expect(isKubectlResultUnknownMessage(first.errorMessage)).toBe(true);

      // The Runner claimed it, so the breaker stays open.
      await runOn(toolkit);
      expect(enqueue).toHaveBeenCalledTimes(2);
      expect(toolkit.isClusterUnreachable(CLUSTER_ID.toString())).toBe(false);
    },
  );

  it("does not trip the breaker when the claim state cannot be read", async () => {
    claimRead.mockRejectedValue(new Error("database unavailable"));
    const toolkit: KubectlInvestigationToolkit = singleClusterToolkit();

    const outcome: ToolCallOutcome = await runOn(toolkit);

    // Nothing is known to have run, so nothing is cited...
    expect(outcome.success).toBe(false);
    expect(outcome.result).toBeUndefined();
    // ...nor is it said not to have run...
    expect(isKubectlResultUnknownMessage(outcome.errorMessage)).toBe(true);
    // ...and nothing is known to be unreachable either.
    expect(toolkit.isClusterUnreachable(CLUSTER_ID.toString())).toBe(false);
    await runOn(toolkit);
    expect(enqueue).toHaveBeenCalledTimes(2);
  });

  // Negative control: an unclaimed job still says the Runner did not pick it up.
  it("keeps the never-ran wording for a job no Runner claimed", async () => {
    const outcome: ToolCallOutcome = await runOn(singleClusterToolkit());

    expect(outcome.errorMessage).toContain("did not pick up");
    expect(isKubectlResultUnknownMessage(outcome.errorMessage)).toBe(false);
  });

  /*
   * One definition of the marker (next to the shared tool names): the
   * event the toolkit persists for a lost result starts with it, and the
   * panel's reader recognises that event.
   */
  it("persists a lost result under the shared result-unknown marker, which the panel reads as unknown", async () => {
    claimRead.mockResolvedValue(
      claimRow({
        claimedAt: new Date("2026-09-22T10:00:00.000Z"),
        assignedAgentId: RUNNER_ID,
      }),
    );

    const outcome: ToolCallOutcome = await runOn(singleClusterToolkit());

    expect(
      outcome.errorMessage?.startsWith(
        `${SHARED_KUBECTL_RESULT_UNKNOWN_PREFIX} `,
      ),
    ).toBe(true);
    expect(isKubectlResultUnknownMessage(outcome.errorMessage)).toBe(true);
    // What the server module exports under that name is the shared marker.
    expect(KUBECTL_RESULT_UNKNOWN_EVENT_PREFIX).toBe(
      SHARED_KUBECTL_RESULT_UNKNOWN_PREFIX,
    );
  });

  it.each([
    [
      "the claim-time credential refusal",
      "The credential this step references is not available to this Runner. Check that it exists and that this Runner is assigned to it.",
    ],
    [
      "the Runner's cluster refusal",
      'Refused by the Runner: this kubectl command targets cluster "prod-us" but this Runner is the Kubernetes agent of cluster "staging" and only runs credential-less kubectl for its own cluster.',
    ],
    [
      "a missing kubectl",
      "kubectl is not installed on this Runner. Use the oneuptime/runner image (which bundles kubectl) or install kubectl on the host.",
    ],
  ])(
    "reports %s as a failed call with no citation",
    async (_label: string, refusal: string) => {
      poll.mockResolvedValue(
        fakeJob({
          status: RunnerJobStatus.Failed,
          exitCode: undefined,
          output: "",
          errorMessage: refusal,
          claimedAt: new Date("2026-09-22T10:00:00.000Z"),
        }),
      );
      const toolkit: KubectlInvestigationToolkit = singleClusterToolkit();

      const outcome: ToolCallOutcome = await runOn(toolkit);

      expect(outcome.success).toBe(false);
      expect(outcome.result).toBeUndefined();
      expect(outcome.textForLlm).toContain(
        'No kubectl result came back from cluster "prod-us"',
      );
      // The model reads why; the persisted event carries only the category.
      expect(outcome.textForLlm).toContain(refusal.slice(0, 40));
      expect(outcome.errorMessage).toBe(
        'No kubectl result came back from cluster "prod-us": the command was refused, or the Runner did not run it.',
      );
      expect(isKubectlResultUnknownMessage(outcome.errorMessage)).toBe(false);
      // A refusal is fast, not a dead Runner: the breaker stays open.
      expect(toolkit.isClusterUnreachable(CLUSTER_ID.toString())).toBe(false);
      // A refusal is an access problem, so the cluster's page shows it.
      expect(recordOutcome).toHaveBeenCalledWith(
        expect.objectContaining({ succeeded: false }),
      );
    },
  );

  it("keeps a kubectl the Runner killed at its timeout as a command that ran", async () => {
    poll.mockResolvedValue(
      fakeJob({
        status: RunnerJobStatus.Failed,
        exitCode: undefined,
        output: "",
        errorMessage: "Killed (timeout 30000ms)",
      }),
    );

    const outcome: ToolCallOutcome = await runOn(singleClusterToolkit());

    expect(outcome.success).toBe(true);
    expect(outcome.result?.rowCount).toBe(0);
    expect(outcome.textForLlm).toContain("Killed (timeout 30000ms)");
  });
});

/*
 * The AIRun heartbeat: a kubectl wait can outlast the stale-run sweeper's
 * window, so the run is touched while the command is in flight — and never
 * after, whether the wait resolved or threw.
 */
describe("KubectlJobRunner keeps the AI run alive while it waits", () => {
  let touch: jest.SpyInstance;

  beforeEach(() => {
    jest.useFakeTimers();
    touch = jest
      .spyOn(AIRunService, "updateOneBy")
      .mockResolvedValue(undefined as never);
    jest
      .spyOn(KubernetesClusterAiAccessService, "recordCommandOutcome")
      .mockResolvedValue(undefined);
    jest
      .spyOn(RunnerJobService, "enqueueAiKubectlCommand")
      .mockResolvedValue(fakeJob());
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  function runOnce(): Promise<unknown> {
    return KubectlJobRunner.run({
      projectId: PROJECT_ID,
      aiRunId: RUN_ID,
      origin: RunnerJobOrigin.AiInvestigation,
      kubernetesClusterId: CLUSTER_ID,
      targetRunnerId: RUNNER_ID,
      command: "kubectl get pods -n web",
      stepId: "ai-investigation-kubectl-1",
      timeoutInMs: DEFAULT_KUBECTL_TIMEOUT_MS,
    });
  }

  /*
   * pollUntilTerminal held open until the test settles it; `polled`
   * resolves once the wait has started (the heartbeat timer is armed just
   * before it), so the fake clock only moves while a command is in flight.
   */
  function holdPoll(): {
    polled: Promise<void>;
    settle: (job: RunnerJob) => void;
    fail: (error: Error) => void;
  } {
    let markPolled: () => void = (): void => {};
    const polled: Promise<void> = new Promise<void>(
      (resolve: () => void): void => {
        markPolled = resolve;
      },
    );
    const handles: {
      settle: (job: RunnerJob) => void;
      fail: (error: Error) => void;
    } = { settle: (): void => {}, fail: (): void => {} };

    jest
      .spyOn(RunnerJobService, "pollUntilTerminal")
      .mockImplementation((): Promise<RunnerJob> => {
        markPolled();
        return new Promise<RunnerJob>(
          (
            resolve: (job: RunnerJob) => void,
            reject: (error: Error) => void,
          ): void => {
            handles.settle = resolve;
            handles.fail = reject;
          },
        );
      });

    return {
      polled,
      settle: (job: RunnerJob): void => {
        handles.settle(job);
      },
      fail: (error: Error): void => {
        handles.fail(error);
      },
    };
  }

  it("touches the run about every 15 s while the job is in flight, and stops after it settles", async () => {
    const poll: ReturnType<typeof holdPoll> = holdPoll();

    const running: Promise<unknown> = runOnce();
    await poll.polled;
    jest.advanceTimersByTime(40_000);

    expect(touch).toHaveBeenCalledTimes(2);
    expect(touch.mock.calls[0]![0]).toEqual(
      expect.objectContaining({
        query: { _id: RUN_ID.toString(), status: AIRunStatus.Running },
      }),
    );

    poll.settle(fakeJob());
    await running;
    jest.advanceTimersByTime(60_000);

    expect(touch).toHaveBeenCalledTimes(2);
  });

  it("stops touching the run when the wait throws", async () => {
    const poll: ReturnType<typeof holdPoll> = holdPoll();

    const running: Promise<unknown> = runOnce();
    const settled: Promise<unknown> = running.catch((error: unknown) => {
      return error;
    });
    await poll.polled;
    jest.advanceTimersByTime(20_000);
    expect(touch).toHaveBeenCalledTimes(1);

    poll.fail(new Error("RunnerJob disappeared while waiting."));
    expect(await settled).toBeInstanceOf(Error);
    jest.advanceTimersByTime(60_000);

    expect(touch).toHaveBeenCalledTimes(1);
  });
});

/*
 * The server writes the "result unknown" marker into the run's persisted
 * event; the dashboard reads it to count such a command apart from one
 * that never ran. The marker has one definition (next to the shared tool
 * names); the toolkit's behaviour against the panel's reader is pinned in
 * "when kubectl never ran" above.
 */
describe("the kubectl result-unknown event marker", () => {
  it("does not match the never-ran wording", () => {
    expect(
      isKubectlResultUnknownMessage(
        'No kubectl result came back from cluster "prod-us": the command was refused, or the Runner did not run it.',
      ),
    ).toBe(false);
    expect(
      isKubectlResultUnknownMessage(
        'kubectl was not run on cluster "prod-us": its Runner did not pick up the command in time.',
      ),
    ).toBe(false);
    expect(isKubectlResultUnknownMessage(undefined)).toBe(false);
  });
});
