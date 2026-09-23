import RemediationCommandToolkit, {
  RemediationCommandToolkitOptions,
} from "../../../../Server/Utils/AI/Remediation/RemediationCommandTools";
import { ObservabilityAssistantExtraTool } from "../../../../Server/Utils/AI/Chat/ObservabilityAssistant";
import { ToolCallOutcome } from "../../../../Server/Utils/AI/Toolbox/Index";
import AIRunService from "../../../../Server/Services/AIRunService";
import AutoRemediationSuggestionService from "../../../../Server/Services/AutoRemediationSuggestionService";
import KubernetesClusterAiAccessService from "../../../../Server/Services/KubernetesClusterAiAccessService";
import RunnerJobService from "../../../../Server/Services/RunnerJobService";
import RunnerService from "../../../../Server/Services/RunnerService";
import Semaphore, {
  SemaphoreMutex,
} from "../../../../Server/Infrastructure/Semaphore";
import logger from "../../../../Server/Utils/Logger";
import AutoRemediationSuggestion from "../../../../Models/DatabaseModels/AutoRemediationSuggestion";
import RunnerJob from "../../../../Models/DatabaseModels/RunnerJob";
import AutoRemediationSuggestionStatus from "../../../../Types/AutoRemediation/AutoRemediationSuggestionStatus";
import {
  KubectlCommandTier,
  KubernetesAiRemediationMode,
  KubernetesClusterAiAccessStatus,
  KubernetesRunnerPosture,
} from "../../../../Types/Kubernetes/KubernetesClusterAiAccess";
import KubectlPolicy from "../../../../Utils/AiRemediation/KubectlPolicy";
import RunnerJobStatus from "../../../../Types/Runbook/RunnerJobStatus";
import { JSONObject } from "../../../../Types/JSON";
import ObjectID from "../../../../Types/ObjectID";
import PositiveNumber from "../../../../Types/PositiveNumber";
import { afterEach, describe, expect, it } from "@jest/globals";

/*
 * Contract under test — a kubectl write the cluster's bound Runner has said
 * it will refuse is refused BEFORE it is proposed or run (PR #3953 review,
 * XP-6). The Runner reports its write scope in its posture: the namespaces
 * its chart bound write RBAC in (writeNamespaces; empty = cluster-wide), the
 * namespace its own pod runs in (podNamespace; never changed), and whether
 * node operations are on (allowNodeOperations). The toolkit reads it:
 *
 * - a write whose namespace is outside a non-empty writeNamespaces, or IS
 *   the Runner's own namespace — with no -n, the in-cluster Runner's own
 *   namespace (a credential kubeconfig's "default") — is refused with a
 *   reason the model can act on: nothing is enqueued, recorded or kept for
 *   a proposal, and a Suggest round cannot put it on a plan either;
 * - a rollback the Runner would refuse is refused with its command — it
 *   would leave the change applied when verification fails;
 * - node operations (cordon, uncordon, drain, taint, label/annotate/patch of
 *   nodes) are refused when node operations are off, and are never
 *   namespace-scoped (a node has no namespace);
 * - a Namespace object is judged by its name and any other cluster-scoped
 *   object is outside every listed namespace, whatever -n says;
 * - a command the Runner cannot read for certain is refused, because the
 *   Runner refuses it — the toolkit asks the Runner's own rule
 *   (KubectlWriteScope.getRefusal) with the posture it reported, so it
 *   refuses exactly what the Runner refuses and nothing more;
 * - a Runner that reported nothing is left to the Runner;
 * - list_command_targets tells the model the scope up front.
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
const JOB_ID: ObjectID = new ObjectID("66666666-6666-4666-8666-666666666666");

const SAFE_WRITE: string = "kubectl rollout restart deployment/web -n web";
const SAFE_UNDO: string = "kubectl rollout undo deployment/web -n web";

const SCOPED: KubernetesRunnerPosture = {
  inCluster: true,
  allowWrites: true,
  writeNamespaces: ["web", "api"],
  podNamespace: "oneuptime-agent",
  allowNodeOperations: false,
};

function cluster(
  posture: KubernetesRunnerPosture | null = SCOPED,
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
      posture: posture || undefined,
    },
    accessMethod: "in_cluster",
    kubectlAllowlist: [],
    isInvestigationEnabled: true,
    isInvestigationReady: true,
    remediationMode: KubernetesAiRemediationMode.BypassApproval,
    isRemediationReady: true,
    gaps: [],
    evaluatedAt: new Date().toISOString(),
    ...overrides,
  };
}

function refusalFor(
  command: string,
  target: KubernetesClusterAiAccessStatus = cluster(),
): string | null {
  return RemediationCommandToolkit.getRunnerScopeRefusal({
    cluster: target,
    command,
  });
}

describe("RemediationCommandToolkit.getRunnerScopeRefusal — the Runner's reported write scope", () => {
  it.each([
    [
      "-n outside the write namespaces",
      "kubectl rollout restart deployment/pay -n payments",
      'would change namespace "payments", outside the namespaces',
    ],
    [
      "--namespace= outside",
      "kubectl rollout restart deployment/pay --namespace=payments",
      '"payments"',
    ],
    [
      "-nX outside",
      "kubectl scale deployment/pay --replicas=2 -npayments",
      '"payments"',
    ],
    [
      "the Runner's own namespace, named",
      "kubectl rollout restart deployment/agent -n oneuptime-agent",
      "it never changes its own namespace",
    ],
    [
      "no -n in-cluster: the Runner's own namespace",
      "kubectl rollout restart deployment/web",
      'names no namespace, so kubectl would run it in "oneuptime-agent"',
    ],
    [
      "a write to a node with node operations off",
      "kubectl cordon n1",
      "node operations turned off",
    ],
    [
      "drain with node operations off",
      "kubectl drain n1 --ignore-daemonsets",
      "node operations turned off",
    ],
    [
      "label of a node (TYPE NAME)",
      "kubectl label node n1 team=a",
      "node operations turned off",
    ],
    [
      "label of a node (TYPE/NAME)",
      "kubectl label nodes/n1 team=a --overwrite",
      "node operations turned off",
    ],
    [
      "annotate of a node by its short name",
      "kubectl annotate no n1 note=x",
      "node operations turned off",
    ],
    [
      "patch of a node, group-qualified",
      `kubectl patch nodes.v1. n1 -p '{"spec":{"unschedulable":true}}'`,
      "node operations turned off",
    ],
  ])("refuses %s", (_label: string, command: string, expected: string) => {
    // A command the policy denies never reaches the scope check at all.
    expect(KubectlPolicy.evaluateCommand(command).tier).not.toBe(
      KubectlCommandTier.Denied,
    );
    const refusal: string | null = refusalFor(command);
    expect(refusal).not.toBeNull();
    expect(refusal).toContain(expected);
  });

  it("names the scope and what to do, so the model can act on it", () => {
    expect(
      refusalFor("kubectl rollout restart deployment/pay -n payments"),
    ).toContain(
      'It only lets OneUptime AI change "web", "api" (aiAccess.remediation.namespaces on the Kubernetes agent chart).',
    );
    expect(refusalFor("kubectl rollout restart deployment/web")).toContain(
      "Name the target namespace with -n <namespace>.",
    );
    expect(refusalFor("kubectl cordon n1")).toContain(
      "aiAccess.remediation.nodeOperations=false",
    );
  });

  it.each([
    ["a write inside the scope", SAFE_WRITE],
    [
      "a write inside the scope, namespace first",
      "kubectl -n api rollout restart deployment/api",
    ],
    ["a read anywhere", "kubectl get pods -n payments"],
    [
      "a label of a pod (not a node) inside the scope",
      "kubectl label pod web-1 team=a -n web",
    ],
  ])("negative control: allows %s", (_label: string, command: string) => {
    expect(refusalFor(command)).toBeNull();
  });

  it("negative control: node operations are never namespace-scoped — a cordon with no -n is not an own-namespace write", () => {
    const nodesOn: KubernetesClusterAiAccessStatus = cluster({
      ...SCOPED,
      allowNodeOperations: true,
    });

    expect(refusalFor("kubectl cordon n1", nodesOn)).toBeNull();
    expect(refusalFor("kubectl label node n1 team=a", nodesOn)).toBeNull();
    // ...while a pod label with no -n still lands in the Runner's own namespace.
    expect(refusalFor("kubectl label pod web-1 team=a", nodesOn)).toContain(
      '"oneuptime-agent"',
    );
  });

  it("negative control: a Runner that did not report node operations (older, or outside the chart) is left to its RBAC", () => {
    expect(
      refusalFor(
        "kubectl cordon n1",
        cluster({ ...SCOPED, allowNodeOperations: undefined }),
      ),
    ).toBeNull();
  });

  it("negative control: an empty write-namespace list is cluster-wide — only the Runner's own namespace is off limits", () => {
    const clusterWide: KubernetesClusterAiAccessStatus = cluster({
      ...SCOPED,
      writeNamespaces: [],
    });

    expect(
      refusalFor(
        "kubectl rollout restart deployment/pay -n payments",
        clusterWide,
      ),
    ).toBeNull();
    expect(
      refusalFor(
        "kubectl rollout restart deployment/agent -n oneuptime-agent",
        clusterWide,
      ),
    ).not.toBeNull();
  });

  it("negative control: no reported posture, no pre-check — the Runner decides", () => {
    expect(
      refusalFor(
        "kubectl rollout restart deployment/pay -n payments",
        cluster(null),
      ),
    ).toBeNull();
  });

  it('reads a missing -n on a credential kubeconfig as "default", as the Runner does', () => {
    const viaCredential: KubernetesClusterAiAccessStatus = cluster(SCOPED, {
      accessMethod: "credential",
      credentialId: "55555555-5555-4555-8555-555555555555",
    });

    expect(
      refusalFor("kubectl rollout restart deployment/web", viaCredential),
    ).toContain('would run it in "default"');
  });

  it("matches namespaces case-insensitively, the way the Runner compares them", () => {
    expect(
      refusalFor(
        "kubectl rollout restart deployment/web -n web",
        cluster({ ...SCOPED, writeNamespaces: ["WEB"] }),
      ),
    ).toBeNull();
  });

  it("reads past a flag it knows takes a value to find the object", () => {
    const command: string = "kubectl label --field-manager mgr node n1 team=a";
    expect(KubectlPolicy.evaluateCommand(command).tier).not.toBe(
      KubectlCommandTier.Denied,
    );
    expect(refusalFor(command)).toContain("node operations turned off");
  });

  /*
   * Used to be left "to the Runner": the toolkit's own flag table did not
   * size --save-config, so it could not tell the Node kind — and the
   * Runner, which sizes every flag the policy accepts, refused the node
   * label after the approval. The shared rule reads it the Runner's way.
   */
  it("reads every flag the policy accepts: a node label behind --save-config is a node operation", () => {
    const command: string = "kubectl label --save-config node n1 team=a";
    expect(KubectlPolicy.evaluateCommand(command).tier).not.toBe(
      KubectlCommandTier.Denied,
    );
    expect(refusalFor(command)).toContain("node operations turned off");
    // Negative control: with node operations on it is let through.
    expect(
      refusalFor(command, cluster({ ...SCOPED, allowNodeOperations: true })),
    ).toBeNull();
  });

  /*
   * Used to be left to the Runner too, which refuses a write whose objects
   * it cannot read for certain; now refused before it is proposed.
   */
  it("refuses a command the Runner cannot read for certain, saying how to write it", () => {
    const command: string = "kubectl label node/n1 pod-1 x=y -n web";
    expect(KubectlPolicy.evaluateCommand(command).tier).not.toBe(
      KubectlCommandTier.Denied,
    );

    const nodesOn: KubernetesClusterAiAccessStatus = cluster({
      ...SCOPED,
      allowNodeOperations: true,
    });

    expect(refusalFor(command, nodesOn)).toContain(
      'The Runner of cluster "prod-us" cannot tell for certain which objects',
    );
    expect(refusalFor(command, nodesOn)).toContain("TYPE NAME or TYPE/NAME");
    // With node operations off it could be one, and is refused as such.
    expect(refusalFor(command)).toContain("cannot tell for certain whether");
  });

  describe("objects outside every namespace, judged as the Runner judges them", () => {
    it.each([
      [
        "an unlisted Namespace object behind a listed -n",
        "kubectl label namespace staging team=a -n web",
        'would change the Namespace object "staging", outside the namespaces',
      ],
      [
        "the Runner's own Namespace object",
        "kubectl label ns oneuptime-agent team=a -n web",
        'would change the Namespace object "oneuptime-agent", where the Runner of cluster "prod-us" itself runs',
      ],
      [
        "Namespace objects it does not name",
        "kubectl label ns --all team=a",
        "without naming them",
      ],
      [
        "a PersistentVolume behind a listed -n",
        `kubectl patch pv pv-1 -p '{"spec":{"persistentVolumeReclaimPolicy":"Retain"}}' -n web`,
        "persistentvolume objects, which are cluster-scoped",
      ],
      [
        "create priorityclass",
        "kubectl create priorityclass high --value=1000",
        "priorityclass objects, which are cluster-scoped",
      ],
    ])("refuses %s", (_label: string, command: string, expected: string) => {
      expect(KubectlPolicy.evaluateCommand(command).tier).not.toBe(
        KubectlCommandTier.Denied,
      );
      const refusal: string | null = refusalFor(command);
      expect(refusal).toContain(expected);
      // -n means nothing for these objects; never tell the model to add one.
      expect(refusal).not.toContain("-n <namespace>");
    });

    /*
     * The toolkit's old reading judged this by the missing -n and refused
     * it as a write into the Runner's own namespace; the Runner runs it.
     */
    it("negative control: a listed Namespace object with no -n is let through", () => {
      expect(refusalFor("kubectl label namespace web team=a")).toBeNull();
    });

    it("negative control: without a write-namespace list, cluster-scoped objects are left to RBAC", () => {
      expect(
        refusalFor(
          `kubectl patch pv pv-1 -p '{"spec":{"persistentVolumeReclaimPolicy":"Retain"}}'`,
          cluster({ ...SCOPED, writeNamespaces: [] }),
        ),
      ).toBeNull();
    });
  });
});

let enqueueKubectl: jest.SpyInstance;
let persist: jest.SpyInstance;

function mockServices(liveCluster: KubernetesClusterAiAccessStatus): void {
  jest.spyOn(logger, "error").mockImplementation((): void => {
    return undefined;
  });
  jest.spyOn(logger, "warn").mockImplementation((): void => {
    return undefined;
  });
  jest
    .spyOn(AutoRemediationSuggestionService, "findOneById")
    .mockResolvedValue({
      id: SUGGESTION_ID,
      _id: SUGGESTION_ID.toString(),
      status: AutoRemediationSuggestionStatus.Planning,
    } as unknown as AutoRemediationSuggestion);
  persist = jest
    .spyOn(AutoRemediationSuggestionService, "updateOneById")
    .mockResolvedValue(undefined as never);
  jest
    .spyOn(RunnerJobService, "countBy")
    .mockResolvedValue(new PositiveNumber(0));
  enqueueKubectl = jest
    .spyOn(RunnerJobService, "enqueueAiKubectlCommand")
    .mockResolvedValue({
      id: JOB_ID,
      status: RunnerJobStatus.Pending,
      payload: { displayCommand: SAFE_WRITE },
    } as unknown as RunnerJob);
  jest.spyOn(RunnerJobService, "pollUntilTerminal").mockResolvedValue({
    id: JOB_ID,
    status: RunnerJobStatus.Succeeded,
    exitCode: 0,
    output: "deployment.apps/web restarted",
  } as unknown as RunnerJob);
  jest.spyOn(AIRunService, "updateOneBy").mockResolvedValue(undefined as never);
  jest
    .spyOn(KubernetesClusterAiAccessService, "recordCommandOutcome")
    .mockResolvedValue(undefined);
  jest
    .spyOn(RunnerService, "getOnlineAiCommandRunnersForProject")
    .mockResolvedValue([]);
  jest
    .spyOn(KubernetesClusterAiAccessService, "getStatusForCluster")
    .mockResolvedValue(liveCluster);
  jest
    .spyOn(Semaphore, "lock")
    .mockResolvedValue({ id: "cluster-lock" } as unknown as SemaphoreMutex);
  jest.spyOn(Semaphore, "release").mockResolvedValue(undefined);
  jest
    .spyOn(AutoRemediationSuggestionService, "countBy")
    .mockResolvedValue(new PositiveNumber(0));
  jest.spyOn(AutoRemediationSuggestionService, "findBy").mockResolvedValue([]);
  jest.spyOn(RunnerJobService, "findBy").mockResolvedValue([]);
}

function buildToolkit(
  overrides: Partial<RemediationCommandToolkitOptions> = {},
): RemediationCommandToolkit {
  return new RemediationCommandToolkit({
    projectId: PROJECT_ID,
    aiRunId: RUN_ID,
    suggestionId: SUGGESTION_ID,
    mode: "FullAuto",
    allowlistPatterns: [],
    allowedRunnerIds: [],
    clusterTargets: [cluster()],
    proposesRefusedCommands: true,
    ...overrides,
  });
}

function tool(
  toolkit: RemediationCommandToolkit,
  name: string,
): ObservabilityAssistantExtraTool {
  const found: ObservabilityAssistantExtraTool | undefined = toolkit
    .buildTools()
    .find((candidate: ObservabilityAssistantExtraTool) => {
      return candidate.definition.name === name;
    });
  if (!found) {
    throw new Error(`${name} is not offered.`);
  }
  return found;
}

function kubectlArgs(
  command: string,
  rollbackCommand: string | undefined = undefined,
): JSONObject {
  return {
    stepType: "Kubectl",
    kubernetesClusterId: CLUSTER_ID.toString(),
    command,
    rationale: "web pods are crash-looping after a config change",
    expectedEffect: "fresh pods come up Running",
    ...(rollbackCommand ? { rollbackCommand } : {}),
  } as JSONObject;
}

describe("RemediationCommandToolkit refuses a write its cluster's Runner would refuse — before it is run or proposed", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("an unattended round never enqueues, records or keeps a write outside the Runner's write namespaces", async () => {
    mockServices(cluster());
    const toolkit: RemediationCommandToolkit = buildToolkit();

    const outcome: ToolCallOutcome = await tool(
      toolkit,
      "execute_remediation_command",
    ).execute(
      kubectlArgs("kubectl rollout restart deployment/pay -n payments"),
    );

    expect(outcome.success).toBe(false);
    expect(outcome.textForLlm).toContain(
      'would change namespace "payments", outside the namespaces',
    );
    expect(outcome.textForLlm).toContain("neither run nor recorded");
    expect(enqueueKubectl).not.toHaveBeenCalled();
    expect(persist).not.toHaveBeenCalled();
    expect(toolkit.getExecutedCommands()).toHaveLength(0);
    // No click could make the Runner run it: nothing to propose.
    expect(toolkit.getCommandsNeedingApproval()).toHaveLength(0);
  });

  it("uses the Runner's scope as it reports it NOW: a write the live posture no longer allows is refused although the run's snapshot allowed it", async () => {
    mockServices(cluster({ ...SCOPED, writeNamespaces: ["api"] }));
    const toolkit: RemediationCommandToolkit = buildToolkit();

    const outcome: ToolCallOutcome = await tool(
      toolkit,
      "execute_remediation_command",
    ).execute(kubectlArgs(SAFE_WRITE, SAFE_UNDO));

    expect(outcome.success).toBe(false);
    expect(outcome.textForLlm).toContain('would change namespace "web"');
    expect(enqueueKubectl).not.toHaveBeenCalled();
  });

  it("refuses a command whose ROLLBACK the Runner would refuse — it would leave the change applied when verification fails", async () => {
    mockServices(cluster());
    const toolkit: RemediationCommandToolkit = buildToolkit();

    const outcome: ToolCallOutcome = await tool(
      toolkit,
      "execute_remediation_command",
    ).execute(kubectlArgs(SAFE_WRITE, "kubectl rollout undo deployment/web"));

    expect(outcome.success).toBe(false);
    expect(outcome.textForLlm).toContain(
      "The rollbackCommand would be refused when it has to run",
    );
    expect(enqueueKubectl).not.toHaveBeenCalled();
  });

  it("refuses a node operation on a Runner whose node operations are off, and does not keep it for a proposal", async () => {
    mockServices(cluster());
    const toolkit: RemediationCommandToolkit = buildToolkit({
      clusterTargets: [cluster()],
    });

    const outcome: ToolCallOutcome = await tool(
      toolkit,
      "execute_remediation_command",
    ).execute(kubectlArgs("kubectl cordon n1", "kubectl uncordon n1"));

    expect(outcome.success).toBe(false);
    expect(outcome.textForLlm).toContain("node operations turned off");
    expect(enqueueKubectl).not.toHaveBeenCalled();
    expect(toolkit.getCommandsNeedingApproval()).toHaveLength(0);
  });

  it("negative control: the same cordon runs when the Runner allows node operations", async () => {
    const nodesOn: KubernetesClusterAiAccessStatus = cluster({
      ...SCOPED,
      allowNodeOperations: true,
    });
    mockServices(nodesOn);
    const toolkit: RemediationCommandToolkit = buildToolkit({
      clusterTargets: [nodesOn],
    });

    const outcome: ToolCallOutcome = await tool(
      toolkit,
      "execute_remediation_command",
    ).execute(kubectlArgs("kubectl cordon n1", "kubectl uncordon n1"));

    expect(outcome.success).toBe(true);
    expect(enqueueKubectl).toHaveBeenCalledTimes(1);
  });

  it("negative control: a write inside the scope is enqueued as before", async () => {
    mockServices(cluster());
    const toolkit: RemediationCommandToolkit = buildToolkit();

    const outcome: ToolCallOutcome = await tool(
      toolkit,
      "execute_remediation_command",
    ).execute(kubectlArgs(SAFE_WRITE, SAFE_UNDO));

    expect(outcome.success).toBe(true);
    expect(enqueueKubectl).toHaveBeenCalledTimes(1);
    expect(toolkit.getExecutedCommands()).toHaveLength(1);
  });

  it("a Suggest round cannot put a write the Runner would refuse on its plan", async () => {
    mockServices(cluster());
    const toolkit: RemediationCommandToolkit = buildToolkit({
      mode: "Suggest",
    });

    const refused: ToolCallOutcome = await tool(
      toolkit,
      "propose_remediation_commands",
    ).execute({
      commands: [
        kubectlArgs("kubectl rollout restart deployment/pay -n payments"),
      ],
    } as JSONObject);

    expect(refused.success).toBe(false);
    expect(refused.textForLlm).toContain("The plan was NOT recorded");
    expect(refused.textForLlm).toContain('"payments"');
    expect(toolkit.getProposedPlan()).toBeNull();

    // Negative control: the in-scope plan is recorded.
    const recorded: ToolCallOutcome = await tool(
      toolkit,
      "propose_remediation_commands",
    ).execute({
      commands: [kubectlArgs(SAFE_WRITE, SAFE_UNDO)],
    } as JSONObject);

    expect(recorded.success).toBe(true);
    expect(toolkit.getProposedPlan()?.commands).toHaveLength(1);
  });

  it("list_command_targets states the Runner's write scope up front", async () => {
    mockServices(cluster());
    const toolkit: RemediationCommandToolkit = buildToolkit();

    const outcome: ToolCallOutcome = await tool(
      toolkit,
      "list_command_targets",
    ).execute({});

    expect(outcome.textForLlm).toContain(
      'writes only in namespaces "web", "api"',
    );
    expect(outcome.textForLlm).toContain(
      'never in its own namespace "oneuptime-agent"',
    );
    expect(outcome.textForLlm).toContain("no node operations");
  });
});
