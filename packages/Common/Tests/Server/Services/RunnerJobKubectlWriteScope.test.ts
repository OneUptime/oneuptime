import RunnerJobService, {
  Service as RunnerJobServiceClass,
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
 * are never scoped, node operations are in no namespace, and a Runner that
 * did not report a setting is not second-guessed.
 *
 * The rule is the Runner's own (KubectlWriteScope.getRefusal, asked with
 * the posture it reported), so it also refuses what the Runner refuses and
 * the chokepoint's old reading let through: a Namespace object outside the
 * scope behind a listed -n, a PersistentVolume or other cluster-scoped
 * object while a write-namespace list is set, a write with no -n when the
 * Runner reported no namespace of its own, and a write it cannot read for
 * certain. KubectlWriteScopeCallerParity holds it to the Runner and the
 * toolkit over the whole table.
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

    /*
     * Used to be enqueued "for the Runner to decide" — and the Runner
     * refuses it: in-cluster, a missing -n is its pod's namespace, and a
     * Runner that does not know that namespace cannot tell where the write
     * lands. Refused here now, as the Runner refuses it.
     */
    it("refuses a write with no -n when the Runner reported no namespace of its own", async () => {
      runnerLookup.mockResolvedValue(agentRunner({ writeNamespaces: ["web"] }));

      const message: string = await refusal(
        "kubectl rollout restart deployment/web",
      );

      expect(message).toContain("names no namespace");
      expect(message).toContain("was not enqueued");
      expect(message).toContain("-n <namespace>");
      expect(createdRows).toHaveLength(0);
    });

    it("negative control: the same write naming its namespace is enqueued", async () => {
      runnerLookup.mockResolvedValue(agentRunner({ writeNamespaces: ["web"] }));

      await enqueue(SAFE_WRITE);

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

  /*
   * Objects that live outside every namespace, judged the way the Runner
   * judges them. The chokepoint used to wave every one of these through
   * as "cluster-scoped" — and the Runner refused them after the approval.
   */
  describe("Namespace objects and other cluster-scoped objects", () => {
    beforeEach(() => {
      runnerLookup.mockResolvedValue(
        agentRunner({
          writeNamespaces: ["web"],
          podNamespace: "oneuptime-agent",
          allowNodeOperations: true,
        }),
      );
    });

    it.each([
      [
        "an unlisted Namespace object behind a listed -n",
        "kubectl label namespace staging team=a -n web",
        'the Namespace object "staging"',
      ],
      [
        "the Runner's own Namespace object",
        "kubectl label ns oneuptime-agent team=a -n web",
        "itself runs in",
      ],
      [
        "a PersistentVolume behind a listed -n",
        `kubectl patch pv pv-1 -p '{"spec":{"persistentVolumeReclaimPolicy":"Retain"}}' -n web`,
        "cluster-scoped",
      ],
    ])(
      "refuses %s, as the Runner does",
      async (_label: string, command: string, expected: string) => {
        const message: string = await refusal(command);

        expect(message).toContain(expected);
        expect(message).toContain("was not enqueued");
        expect(createdRows).toHaveLength(0);
      },
    );

    /*
     * Namespace objects a write does not name (`--all`, a selector) could
     * include kube-system's, so the kubectl policy denies such a write
     * outright before the scope is consulted. The chokepoint still refuses
     * it and still creates nothing.
     */
    it("refuses Namespace objects it does not name through the policy, before the scope", async () => {
      const message: string = await refusal("kubectl label ns --all team=a");

      expect(message).toContain("name each Namespace object");
      expect(createdRows).toHaveLength(0);
    });

    it.each([
      [
        "a listed Namespace object with no -n",
        "kubectl label namespace web team=a",
      ],
      ["a node label (the switch is on)", "kubectl label node n1 team=a"],
    ])(
      "negative control: enqueues %s",
      async (_label: string, command: string) => {
        await enqueue(command);

        expect(createdRows).toHaveLength(1);
      },
    );
  });
});

describe("RunnerJobService.getRunnerWriteScopeRefusal words the Runner's rule for whoever enqueued", () => {
  function refusalFor(
    command: string,
    posture: KubernetesRunnerPosture,
    usesCredential: boolean = false,
  ): string | null {
    return RunnerJobServiceClass.getRunnerWriteScopeRefusal({
      policy: KubectlPolicy.evaluateCommand(command),
      posture,
      usesCredential,
    });
  }

  const SCOPED: KubernetesRunnerPosture = {
    inCluster: true,
    allowWrites: true,
    writeNamespaces: ["web"],
    podNamespace: "oneuptime-agent",
    allowNodeOperations: true,
  };

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

  it("a Namespace object outside the scope names the object, the scope and the chart value — never a -n that changes nothing", () => {
    const message: string | null = refusalFor(
      "kubectl label namespace staging team=a -n web",
      SCOPED,
    );

    expect(message).toContain('the Namespace object "staging"');
    expect(message).toContain("-n does not apply to it");
    expect(message).toContain('"web": aiAccess.remediation.namespaces');
    expect(message).toContain("ONEUPTIME_KUBECTL_WRITE_NAMESPACES");
    expect(message).toContain(
      'To let OneUptime AI change "staging", add it to aiAccess.remediation.namespaces',
    );
    expect(message).not.toContain("-n <namespace>");
  });

  it("a cluster-scoped kind names the kinds and the scope", () => {
    const message: string | null = refusalFor(
      "kubectl annotate ingressclass nginx note=x -n web",
      SCOPED,
    );

    expect(message).toContain("ingressclass objects, which are cluster-scoped");
    expect(message).toContain("whatever -n says");
    expect(message).toContain("It was not enqueued.");
  });

  it("a command it cannot read for certain says why and how to write it", () => {
    const objects: string | null = refusalFor(
      "kubectl label node/n1 pod-1 x=y -n web",
      SCOPED,
    );

    expect(objects).toContain(
      "The cluster's Runner cannot tell for certain which objects",
    );
    expect(objects).toContain("TYPE NAME or TYPE/NAME");

    const namespace: string | null = refusalFor(
      "kubectl rollout restart deployment/web -l -nweb",
      SCOPED,
    );

    expect(namespace).toContain(
      "The cluster's Runner cannot tell for certain which namespace",
    );
    expect(namespace).toContain("kubectl -n <namespace> ...");
  });

  it("with node operations off, a write it cannot read is refused as a possible node operation", () => {
    const message: string | null = refusalFor(
      "kubectl label node/n1 pod-1 x=y -n web",
      { ...SCOPED, allowNodeOperations: false },
    );

    expect(message).toContain("cannot tell for certain whether");
    expect(message).toContain("changes a node");
    expect(message).toContain("aiAccess.remediation.nodeOperations=false");
  });

  it("every refusal is whole sentences that say it was not enqueued", () => {
    for (const command of [
      "kubectl cordon n1",
      "kubectl rollout restart deployment/pay -n payments",
      "kubectl rollout restart deployment/web",
      "kubectl rollout restart deployment/x -n oneuptime-agent",
      "kubectl label namespace staging team=a -n web",
      "kubectl label ns oneuptime-agent team=a -n web",
      // (`label ns --all` never reaches the scope: the policy denies it.)
      "kubectl create priorityclass high --value=1000",
      "kubectl label node/n1 pod-1 x=y -n web",
    ]) {
      const message: string | null = refusalFor(command, {
        ...SCOPED,
        allowNodeOperations: false,
      });

      expect({ command, refused: message !== null }).toEqual({
        command,
        refused: true,
      });
      expect(message).toContain("It was not enqueued.");
      expect(message?.endsWith(".")).toBe(true);
      expect(message).not.toContain("this Runner");
    }
  });
});
