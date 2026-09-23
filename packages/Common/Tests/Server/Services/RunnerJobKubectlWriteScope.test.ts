import RunnerJobService, {
  Service as RunnerJobServiceClass,
  describeKubectlWriteTarget,
  readKubectlObjectKind,
} from "../../../Server/Services/RunnerJobService";
import AIRunService from "../../../Server/Services/AIRunService";
import KubernetesClusterService from "../../../Server/Services/KubernetesClusterService";
import RunnerService from "../../../Server/Services/RunnerService";
import AIRun from "../../../Models/DatabaseModels/AIRun";
import KubernetesCluster from "../../../Models/DatabaseModels/KubernetesCluster";
import Runner from "../../../Models/DatabaseModels/Runner";
import RunnerJob from "../../../Models/DatabaseModels/RunnerJob";
import AIRunType from "../../../Types/AI/AIRunType";
import BadDataException from "../../../Types/Exception/BadDataException";
import {
  KubectlCommandTier,
  KubernetesAiRemediationMode,
  KubernetesRunnerPosture,
} from "../../../Types/Kubernetes/KubernetesClusterAiAccess";
import ObjectID from "../../../Types/ObjectID";
import PositiveNumber from "../../../Types/PositiveNumber";
import RunnerJobOrigin from "../../../Types/Runbook/RunnerJobOrigin";
import KubectlPolicy from "../../../Utils/AiRemediation/KubectlPolicy";
import { afterEach, beforeEach, describe, expect, it } from "@jest/globals";

/*
 * Contract under test — XP-6, the server half: the enqueue chokepoint never
 * lets a remediation write reach the queue when the bound Runner's own
 * reported posture says it will refuse it:
 *
 * - allowNodeOperations === false (aiAccess.remediation.nodeOperations=false
 *   on the chart): no cordon/uncordon/drain/taint, no label/annotate/patch of
 *   a Node;
 * - a namespaced write outside a non-empty writeNamespaces
 *   (aiAccess.remediation.namespaces), or in the Runner pod's own namespace
 *   — a write with no -n lands in the pod's namespace in-cluster;
 *
 * each refusal naming the chart value to change, and nothing created (so
 * nothing is approved, enqueued or counted by the circuit breaker only to be
 * refused on the Runner). It never refuses MORE than the Runner would: reads
 * are never scoped, node operations and other cluster-scoped objects are in
 * no namespace, and a Runner that did not report a setting is not
 * second-guessed.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "22222222-2222-4222-8222-222222222222",
);
const CLUSTER_ID: ObjectID = new ObjectID(
  "33333333-3333-4333-8333-333333333333",
);
const RUNNER_ID: ObjectID = new ObjectID(
  "44444444-4444-4444-8444-444444444444",
);
const SUGGESTION_ID: ObjectID = new ObjectID(
  "77777777-7777-4777-8777-777777777777",
);

const SAFE_WRITE: string = "kubectl rollout restart deployment/web -n web";
const RISKY_WRITE: string = "kubectl set image deployment/web web=img:2 -n web";

function agentRunner(posture: KubernetesRunnerPosture): Runner {
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
        ...posture,
      },
    },
  } as unknown as Runner;
}

describe("RunnerJobService.enqueueAiKubectlCommand refuses writes the Runner's posture rules out", () => {
  let createdRows: Array<RunnerJob>;
  let runnerLookup: jest.SpyInstance;

  beforeEach(() => {
    createdRows = [];
    jest
      .spyOn(RunnerJobService, "countBy")
      .mockResolvedValue(new PositiveNumber(0));
    jest.spyOn(AIRunService, "findOneBy").mockResolvedValue({
      runType: AIRunType.RemediationExecution,
    } as unknown as AIRun);
    jest
      .spyOn(RunnerJobService, "create")
      .mockImplementation(async (data: unknown): Promise<RunnerJob> => {
        const row: RunnerJob = (data as { data: RunnerJob }).data;
        createdRows.push(row);
        return row;
      });
    jest.spyOn(KubernetesClusterService, "findOneBy").mockResolvedValue({
      id: CLUSTER_ID,
      _id: CLUSTER_ID.toString(),
      projectId: PROJECT_ID,
      name: "prod-us",
      clusterIdentifier: "prod-us",
      aiAccessRunnerId: RUNNER_ID,
      isAiInvestigationEnabled: true,
      aiRemediationMode: KubernetesAiRemediationMode.Automatic,
    } as unknown as KubernetesCluster);
    runnerLookup = jest
      .spyOn(RunnerService, "findOneBy")
      .mockResolvedValue(agentRunner({}));
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  async function enqueue(
    command: string,
    origin: RunnerJobOrigin = RunnerJobOrigin.AiRemediation,
  ): Promise<RunnerJob> {
    return RunnerJobService.enqueueAiKubectlCommand({
      projectId: PROJECT_ID,
      origin: origin as
        | RunnerJobOrigin.AiRemediation
        | RunnerJobOrigin.AiInvestigation,
      ...(origin === RunnerJobOrigin.AiRemediation
        ? { autoRemediationSuggestionId: SUGGESTION_ID }
        : { aiRunId: ObjectID.generate() }),
      kubernetesClusterId: CLUSTER_ID,
      stepId: "ai-command-1",
      targetAgentId: RUNNER_ID,
      command,
      timeoutInMs: 30000,
    });
  }

  async function refusal(command: string): Promise<string> {
    try {
      await enqueue(command);
    } catch (error) {
      expect(error).toBeInstanceOf(BadDataException);
      return (error as Error).message;
    }

    throw new Error(`expected "${command}" to be refused`);
  }

  describe("node operations", () => {
    it("refuses cordon when the chart did not grant node operations, naming the chart value", async () => {
      runnerLookup.mockResolvedValue(
        agentRunner({ allowNodeOperations: false }),
      );

      const message: string = await refusal("kubectl cordon n1");

      expect(message).toContain("aiAccess.remediation.nodeOperations");
      expect(message).toContain("ONEUPTIME_KUBECTL_ALLOW_NODE_OPERATIONS");
      expect(message).toContain("was not enqueued");
      expect(createdRows).toHaveLength(0);
    });

    it("refuses every node operation the policy lets through, and labelling a Node", async () => {
      runnerLookup.mockResolvedValue(
        agentRunner({ allowNodeOperations: false }),
      );

      for (const command of [
        "kubectl uncordon n1",
        "kubectl drain n1 --ignore-daemonsets",
        "kubectl taint node n1 dedicated=web:NoSchedule",
        "kubectl label node n1 team=web",
        "kubectl annotate node/n1 note=x",
      ]) {
        const tier: KubectlCommandTier =
          KubectlPolicy.evaluateCommand(command).tier;

        // The policy may deny some of these outright; that is not this rule.
        if (
          tier === KubectlCommandTier.Denied ||
          tier === KubectlCommandTier.Read
        ) {
          continue;
        }

        await expect(enqueue(command)).rejects.toThrow(
          /aiAccess\.remediation\.nodeOperations/,
        );
      }

      expect(createdRows).toHaveLength(0);
    });

    it("negative control: allowed, or not reported by an older Runner, cordon is enqueued", async () => {
      for (const posture of [{ allowNodeOperations: true }, {}]) {
        runnerLookup.mockResolvedValue(agentRunner(posture));
        await enqueue("kubectl cordon n1");
      }

      expect(createdRows).toHaveLength(2);
    });

    it("negative control: a node is in no namespace, so the namespace scope never refuses cordon", async () => {
      runnerLookup.mockResolvedValue(
        agentRunner({
          allowNodeOperations: true,
          writeNamespaces: ["web"],
          podNamespace: "oneuptime-agent",
        }),
      );

      await enqueue("kubectl cordon n1");

      expect(createdRows).toHaveLength(1);
    });
  });

  describe("the namespace scope", () => {
    it("refuses a write outside the chart's write namespaces, naming the chart value", async () => {
      runnerLookup.mockResolvedValue(agentRunner({ writeNamespaces: ["web"] }));

      const message: string = await refusal(
        "kubectl rollout restart deployment/api -n api",
      );

      expect(message).toContain('namespace "api"');
      expect(message).toContain('"web"');
      expect(message).toContain("aiAccess.remediation.namespaces");
      expect(message).toContain("ONEUPTIME_KUBECTL_WRITE_NAMESPACES");
      expect(createdRows).toHaveLength(0);
    });

    it("refuses a RiskyWrite outside the scope the same way", async () => {
      runnerLookup.mockResolvedValue(agentRunner({ writeNamespaces: ["api"] }));

      await refusal(RISKY_WRITE);
    });

    it("refuses a write in the Runner's own namespace, named or implied by a missing -n", async () => {
      runnerLookup.mockResolvedValue(
        agentRunner({ podNamespace: "oneuptime-agent" }),
      );

      const named: string = await refusal(
        "kubectl rollout restart deployment/oneuptime-agent -n oneuptime-agent",
      );
      expect(named).toContain("itself runs in");

      const implied: string = await refusal(
        "kubectl rollout restart deployment/web",
      );
      expect(implied).toContain('namespace "oneuptime-agent"');
      expect(implied).toContain("names none");
    });

    it("negative control: a write inside the scope is enqueued, SafeWrite and RiskyWrite", async () => {
      runnerLookup.mockResolvedValue(
        agentRunner({
          writeNamespaces: ["web"],
          podNamespace: "oneuptime-agent",
        }),
      );

      await enqueue(SAFE_WRITE);
      await enqueue(RISKY_WRITE);

      expect(createdRows).toHaveLength(2);
    });

    it("negative control: namespaces are compared the way the Runner compares them", async () => {
      runnerLookup.mockResolvedValue(agentRunner({ writeNamespaces: ["Web"] }));

      await enqueue(SAFE_WRITE);

      expect(createdRows).toHaveLength(1);
    });

    it("negative control: an empty scope (cluster-wide) and an unreported one refuse nothing", async () => {
      for (const posture of [{ writeNamespaces: [] }, {}]) {
        runnerLookup.mockResolvedValue(agentRunner(posture));
        await enqueue("kubectl rollout restart deployment/api -n api");
      }

      expect(createdRows).toHaveLength(2);
    });

    it("negative control: a write with no -n and no known pod namespace is left to the Runner", async () => {
      runnerLookup.mockResolvedValue(agentRunner({ writeNamespaces: ["web"] }));

      await enqueue("kubectl rollout restart deployment/web");

      expect(createdRows).toHaveLength(1);
    });

    it("negative control: reads are never refused for scope, whatever the origin", async () => {
      runnerLookup.mockResolvedValue(
        agentRunner({
          writeNamespaces: ["web"],
          podNamespace: "oneuptime-agent",
          allowNodeOperations: false,
        }),
      );

      await enqueue("kubectl get pods -n api");
      await enqueue("kubectl get pods -n oneuptime-agent");
      await enqueue("kubectl describe node n1");
      await enqueue("kubectl get pods -n api", RunnerJobOrigin.AiInvestigation);

      expect(createdRows).toHaveLength(4);
    });
  });
});

describe("describeKubectlWriteTarget / readKubectlObjectKind", () => {
  function target(command: string): {
    isNodeOperation: boolean;
    isClusterScoped: boolean;
  } {
    return describeKubectlWriteTarget(KubectlPolicy.evaluateCommand(command));
  }

  it("reads the object kind after the verb (after the subcommand for rollout and set)", () => {
    expect(
      readKubectlObjectKind(["rollout", "restart", "deployment/web"]),
    ).toBe("deployment");
    expect(
      readKubectlObjectKind(["set", "image", "deployments.apps/web", "a=b"]),
    ).toBe("deployments");
    expect(readKubectlObjectKind(["label", "--overwrite", "node", "n1"])).toBe(
      "node",
    );
    expect(readKubectlObjectKind(["-n", "web", "label", "pod", "p1"])).toBe(
      "pod",
    );
    expect(readKubectlObjectKind(["create", "namespace", "x"])).toBe(
      "namespace",
    );
    expect(readKubectlObjectKind([])).toBe("");
  });

  it("node verbs and Node objects are node operations, and cluster-scoped", () => {
    expect(target("kubectl cordon n1")).toEqual({
      isNodeOperation: true,
      isClusterScoped: true,
    });
    expect(target("kubectl label node n1 team=web").isNodeOperation).toBe(true);
    expect(target("kubectl annotate nodes/n1 a=b").isNodeOperation).toBe(true);
  });

  it("negative control: workloads are neither, even named like a node", () => {
    expect(target(SAFE_WRITE)).toEqual({
      isNodeOperation: false,
      isClusterScoped: false,
    });
    expect(
      target("kubectl rollout restart deployment/node -n web").isNodeOperation,
    ).toBe(false);
  });

  it("getRunnerWriteScopeRefusal never scopes a Denied or Read result", () => {
    for (const command of ["kubectl get pods -n api", "kubectl exec x -- sh"]) {
      expect(
        RunnerJobServiceClass.getRunnerWriteScopeRefusal({
          policy: KubectlPolicy.evaluateCommand(command),
          posture: {
            writeNamespaces: ["web"],
            podNamespace: "oneuptime-agent",
            allowNodeOperations: false,
          },
          usesCredential: false,
        }),
      ).toBeNull();
    }
  });

  it('through a credential\'s kubeconfig, a missing -n means "default"', () => {
    const refusal: string | null =
      RunnerJobServiceClass.getRunnerWriteScopeRefusal({
        policy: KubectlPolicy.evaluateCommand(
          "kubectl rollout restart deployment/web",
        ),
        posture: { writeNamespaces: ["web"] },
        usesCredential: true,
      });

    expect(refusal).toContain('namespace "default"');
  });
});
