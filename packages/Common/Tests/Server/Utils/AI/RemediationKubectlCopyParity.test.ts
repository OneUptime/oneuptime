import { buildClusterFullAutoPersona } from "../../../../Server/Utils/AI/Remediation/RemediationExecutionRunner";
import RemediationCommandToolkit from "../../../../Server/Utils/AI/Remediation/RemediationCommandTools";
import { ObservabilityAssistantExtraTool } from "../../../../Server/Utils/AI/Chat/ObservabilityAssistant";
import { ToolCallOutcome } from "../../../../Server/Utils/AI/Toolbox/Index";
import RunnerService from "../../../../Server/Services/RunnerService";
import {
  AiRemediationCommandPolicyVerdict,
  KUBECTL_ALWAYS_ASKS_SUMMARY,
  KUBECTL_AUTOMATIC_MODE_SUMMARY,
  KUBECTL_BYPASS_MODE_SUMMARY,
  KUBECTL_EVERY_MODE_LIMITS_SUMMARY,
  KUBECTL_NEVER_RUNS_SUMMARY,
  KUBECTL_RISKIER_CHANGES_SUMMARY,
  KUBECTL_SAFE_CHANGES_SUMMARY,
  KubectlChangeSummaryOptions,
  getKubectlAlwaysAsksSummary,
  getKubectlAutomaticModeSummary,
  getKubectlRiskierChangesSummary,
  getKubectlSafeChangesSummary,
} from "../../../../Types/AutoRemediation/AiRemediationCommandPlan";
import {
  KubectlCommandTier,
  KubernetesAiRemediationMode,
  KubernetesClusterAiAccessStatus,
  PROTECTED_KUBERNETES_NAMESPACES,
} from "../../../../Types/Kubernetes/KubernetesClusterAiAccess";
import KubectlPolicy, {
  KubectlAutoExecutionVerdict,
} from "../../../../Utils/AiRemediation/KubectlPolicy";
import { UNATTENDED_ROUND_BECOMES_PROPOSAL_SUMMARY } from "../../../../Server/Utils/AI/ClusterAccess/ClusterAccessContext";
import ObjectID from "../../../../Types/ObjectID";
import { afterEach, describe, expect, it } from "@jest/globals";

const TAINT_WORD_PATTERN: RegExp = /\btaint\b/;
// The stale Bypass promise: a Bypass round still asks for some changes.
const NOBODY_IS_ASKED_PATTERN: RegExp =
  /nobody is asked|nothing is ever asked/i;

/*
 * Contract under test — every LLM-facing description of the kubectl tiers
 * and the unattended cluster modes says what the policy does NOW (PR #3953
 * review, XP-4 and known follow-up 3):
 *
 * - the shared summaries (AiRemediationCommandPlan's KUBECTL_*_SUMMARY)
 *   restate the canonical KubernetesAiRemediationMode / KubectlCommandTier
 *   semantics: SafeWrite is ONE named object; scale to zero, deleting a job,
 *   drain, taint and multi-object forms are riskier; a protected-namespace
 *   write, a node drain, a node taint and a patch of a Node always need a
 *   human; destructive
 *   commands never run; the allowlist is token-wise;
 * - each example they name is tiered that way by KubectlPolicy itself — so
 *   the copy cannot drift from the policy unnoticed;
 * - the cluster personas and the tools the model reads (list_command_
 *   targets, execute_remediation_command) use those summaries, and none of
 *   the stale wording survives ("delete a named pod/job", "only Denied
 *   commands are refused", a rollback example other than rollout undo).
 */

// Examples of each phrase in the summaries, as the model would write them.
const SAFE_EXAMPLES: Array<string> = [
  "kubectl rollout restart deployment/web -n web",
  "kubectl rollout undo deployment/web -n web",
  "kubectl rollout pause deployment/web -n web",
  "kubectl rollout resume deployment/web -n web",
  "kubectl scale deployment/web --replicas=3 -n web",
  "kubectl delete pod web-1 -n web",
  "kubectl cordon n1",
  "kubectl uncordon n1",
  "kubectl label pod web-1 team=a -n web",
  "kubectl annotate deployment/web note=restarted -n web",
];

const RISKIER_EXAMPLES: Array<string> = [
  `kubectl patch deployment/web -n web -p '{"spec":{"replicas":2}}'`,
  "kubectl set image deployment/web web=img:2 -n web",
  "kubectl set env deployment/web LOG_LEVEL=debug -n web",
  "kubectl set resources deployment/web --limits=memory=1Gi -n web",
  "kubectl drain n1 --ignore-daemonsets",
  "kubectl taint nodes n1 dedicated=db:NoSchedule",
  "kubectl scale deployment/web --replicas=0 -n web",
  "kubectl delete deployment/web -n web",
  "kubectl delete job/migrate -n web",
  "kubectl create job migrate-now --from=cronjob/migrate -n web",
  // Touching several objects at once.
  "kubectl rollout restart deployment -n web",
  "kubectl delete pod -l app=web -n web",
  "kubectl label pod web-1 web-2 team=a -n web",
];

const NEVER_RUNS_EXAMPLES: Array<string> = [
  "kubectl exec web-1 -n web -- sh",
  "kubectl apply -f deploy.yaml",
  "kubectl delete namespace web",
  "kubectl create job debug --image=busybox -n web",
  "kubectl create rolebinding web-admin --clusterrole=admin --serviceaccount=web:default -n web",
];

const STALE_PHRASES: Array<string> = [
  "delete a named pod/job",
  "a NAMED pod or job",
  "deleting a named pod or job",
  "only Denied commands are refused",
  "Only destructive commands",
  "kubectl scale back to the previous count",
  "kubectl set image back to the previous image",
];

describe("the shared kubectl tier summaries match what KubectlPolicy does", () => {
  it.each(SAFE_EXAMPLES)(
    "a safe change is SafeWrite: %s",
    (command: string) => {
      expect(KubectlPolicy.evaluateCommand(command).tier).toBe(
        KubectlCommandTier.SafeWrite,
      );
    },
  );

  it.each(RISKIER_EXAMPLES)(
    "a riskier change is RiskyWrite: %s",
    (command: string) => {
      expect(KubectlPolicy.evaluateCommand(command).tier).toBe(
        KubectlCommandTier.RiskyWrite,
      );
    },
  );

  it.each(NEVER_RUNS_EXAMPLES)(
    "a destructive command never runs: %s",
    (command: string) => {
      expect(KubectlPolicy.evaluateCommand(command).tier).toBe(
        KubectlCommandTier.Denied,
      );
    },
  );

  it("a write in a protected namespace asks a human even with approvals bypassed and an allowlist that names it", () => {
    for (const namespace of PROTECTED_KUBERNETES_NAMESPACES) {
      const command: string = `kubectl rollout restart deployment/coredns -n ${namespace}`;
      expect(
        KubectlPolicy.evaluateForAutoExecution({
          command,
          allowlistPatterns: [command],
          bypassApproval: true,
        }).verdict,
      ).toBe(AiRemediationCommandPolicyVerdict.RequiresApproval);
      expect(KUBECTL_ALWAYS_ASKS_SUMMARY).toContain(namespace);
    }
  });

  /*
   * Round four: a patch of a Node can set, replace or clear its taints, so
   * the policy holds it to the drain and taint rule. The summary the model
   * reads names it next to them.
   */
  it.each([
    `kubectl patch node n1 -p '{"spec":{"unschedulable":true}}'`,
    "kubectl drain n1 --ignore-daemonsets",
    "kubectl taint nodes n1 dedicated=ai:NoSchedule",
  ])(
    "%s asks a human even with approvals bypassed and an allowlist that names it, and the summary says so",
    (command: string) => {
      const verdict: KubectlAutoExecutionVerdict =
        KubectlPolicy.evaluateForAutoExecution({
          command,
          allowlistPatterns: [command],
          bypassApproval: true,
        });

      expect(verdict.verdict).toBe(
        AiRemediationCommandPolicyVerdict.RequiresApproval,
      );
      expect(verdict.requiresHuman).toBe(true);
      expect(KUBECTL_ALWAYS_ASKS_SUMMARY).toContain(
        "a node drain, a node taint and a patch of a Node always need a human",
      );
    },
  );

  it("the summaries name what each tier covers, in the canonical words", () => {
    expect(KUBECTL_SAFE_CHANGES_SUMMARY).toContain("exactly ONE named object");
    expect(KUBECTL_SAFE_CHANGES_SUMMARY).toContain("delete of one named pod");
    expect(KUBECTL_SAFE_CHANGES_SUMMARY).not.toContain("job");
    for (const riskier of [
      "patch",
      "set image",
      "drain",
      "taint",
      "scale to zero",
      "deleting a workload or a job",
      "several objects",
    ]) {
      expect(KUBECTL_RISKIER_CHANGES_SUMMARY).toContain(riskier);
    }
    expect(KUBECTL_ALWAYS_ASKS_SUMMARY).toContain(
      "a node drain, a node taint and a patch of a Node",
    );
    // The round-three wording, which left the Node patch out.
    expect(KUBECTL_ALWAYS_ASKS_SUMMARY).not.toContain("a node drain or taint");
    expect(KUBECTL_ALWAYS_ASKS_SUMMARY).toContain("in every mode");
    expect(KUBECTL_NEVER_RUNS_SUMMARY).toContain("--image");
    expect(KUBECTL_NEVER_RUNS_SUMMARY).toContain("not JSON");
    expect(KUBECTL_EVERY_MODE_LIMITS_SUMMARY).toContain(
      "never changes its own namespace",
    );
    /*
     * The canonical comment's last clause, word for word: the breaker AND
     * another unattended round holding the cluster both turn a run into a
     * proposal.
     */
    expect(
      KUBECTL_EVERY_MODE_LIMITS_SUMMARY.endsWith(
        "and an unattended run becomes a proposal when the hourly per-cluster circuit breaker trips or another unattended round already holds the cluster.",
      ),
    ).toBe(true);
    // The earlier copy named only the breaker.
    expect(KUBECTL_EVERY_MODE_LIMITS_SUMMARY).not.toContain(
      "circuit breaker turns an unattended run into a proposal",
    );
  });

  it("the Automatic and Bypass summaries state the canonical mode semantics", () => {
    // KubernetesAiRemediationMode.Automatic's doc comment, clause by clause.
    expect(KUBECTL_AUTOMATIC_MODE_SUMMARY).toContain(
      "when the round could only find riskier fixes it ends by proposing exactly those for one-click approval",
    );
    expect(KUBECTL_AUTOMATIC_MODE_SUMMARY).toContain(
      "a riskier fix is proposed only if verification shows the safe ones did not recover the signal (the follow-up round, which asks)",
    );
    expect(KUBECTL_AUTOMATIC_MODE_SUMMARY).toContain(
      "Shapes on the cluster's kubectl allowlist run on their own.",
    );
    // KubernetesAiRemediationMode.BypassApproval's doc comment.
    expect(KUBECTL_BYPASS_MODE_SUMMARY).toContain("AI does not ask.");
    /*
     * The canonical sentence goes on with its exceptions. The summary is
     * interpolated into prompts and feed copy on its own, so it names them
     * rather than pointing "below".
     */
    expect(KUBECTL_BYPASS_MODE_SUMMARY).toContain(
      "Every change the policy allows — safe AND riskier — runs on its own, follow-up rounds included, except for what always needs a human.",
    );
    expect(KUBECTL_BYPASS_MODE_SUMMARY).not.toContain("below");
  });
});

describe("the cluster personas use the shared summaries — and none of the stale wording", () => {
  it.each([
    ["Automatic", false],
    ["Bypass approval", true],
  ])("%s persona", (_label: string, bypassApproval: boolean) => {
    const persona: string = buildClusterFullAutoPersona({ bypassApproval });

    expect(persona).toContain(
      bypassApproval
        ? KUBECTL_BYPASS_MODE_SUMMARY
        : KUBECTL_AUTOMATIC_MODE_SUMMARY,
    );
    expect(persona).toContain(KUBECTL_SAFE_CHANGES_SUMMARY);
    expect(persona).toContain(KUBECTL_ALWAYS_ASKS_SUMMARY);
    expect(persona).toContain(
      "kubectl rollout undo deployment/<name> -n <namespace>",
    );
    for (const stale of STALE_PHRASES) {
      expect(persona).not.toContain(stale);
    }
  });

  it("the Bypass persona no longer promises that nobody is ever asked", () => {
    const persona: string = buildClusterFullAutoPersona({
      bypassApproval: true,
    });
    expect(persona).toContain("EXCEPT that");
    expect(persona).toContain("proposes it to a human for one-click approval");
  });

  /*
   * A cluster whose Runner turned node operations off: the personas use
   * the same summaries without the node operations, and offer none.
   */
  it.each([
    ["Automatic", false],
    ["Bypass approval", true],
  ])(
    "%s persona for a Runner with node operations off",
    (_label: string, bypassApproval: boolean) => {
      const off: KubectlChangeSummaryOptions = { allowNodeOperations: false };
      const persona: string = buildClusterFullAutoPersona({
        bypassApproval,
        changes: off,
      });

      if (!bypassApproval) {
        expect(persona).toContain(getKubectlAutomaticModeSummary(off));
      }
      expect(persona).toContain(getKubectlSafeChangesSummary(off));
      expect(persona).toContain(getKubectlRiskierChangesSummary(off));
      expect(persona).toContain(getKubectlAlwaysAsksSummary(off));
      for (const offer of [
        "cordon/uncordon of one node",
        "kubectl uncordon <node>",
        "resources, drain, taint",
        "a node drain or taint",
        "a node drain, a node taint",
        "a patch of a Node",
      ]) {
        expect(persona).not.toContain(offer);
      }
      for (const stale of STALE_PHRASES) {
        expect(persona).not.toContain(stale);
      }
    },
  );

  // Negative control: omitted or on, the persona is the full one.
  it.each([false, true])(
    "a persona built with node operations on is the default one (bypass %s)",
    (bypassApproval: boolean) => {
      expect(
        buildClusterFullAutoPersona({
          bypassApproval,
          changes: { allowNodeOperations: true },
        }),
      ).toBe(buildClusterFullAutoPersona({ bypassApproval }));
    },
  );

  it("the Automatic summary without node operations differs only by them", () => {
    expect(getKubectlAutomaticModeSummary({ allowNodeOperations: true })).toBe(
      KUBECTL_AUTOMATIC_MODE_SUMMARY,
    );
    expect(getKubectlAutomaticModeSummary({ allowNodeOperations: false })).toBe(
      KUBECTL_AUTOMATIC_MODE_SUMMARY.replace(
        "cordon/uncordon of one node, ",
        "",
      ).replace("drain, taint, ", ""),
    );
  });
});

describe("the tools the model reads use the shared summaries", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  function clusterIn(
    mode: KubernetesAiRemediationMode,
  ): KubernetesClusterAiAccessStatus {
    return {
      clusterId: "33333333-3333-4333-8333-333333333333",
      clusterName: "prod-us",
      runner: {
        id: "44444444-4444-4444-8444-444444444444",
        name: "kubernetes-agent/prod-us",
        isOnline: true,
        canRunAiCommands: true,
      },
      accessMethod: "in_cluster",
      kubectlAllowlist: ["kubectl set image deployment/web * -n web"],
      isInvestigationEnabled: true,
      isInvestigationReady: true,
      remediationMode: mode,
      isRemediationReady: true,
      gaps: [],
      evaluatedAt: new Date().toISOString(),
    };
  }

  function toolkitFor(
    mode: KubernetesAiRemediationMode,
  ): RemediationCommandToolkit {
    return new RemediationCommandToolkit({
      projectId: new ObjectID("22222222-2222-4222-8222-222222222222"),
      aiRunId: new ObjectID("88888888-8888-4888-8888-888888888888"),
      suggestionId: new ObjectID("77777777-7777-4777-8777-777777777777"),
      mode: "FullAuto",
      allowlistPatterns: [],
      allowedRunnerIds: [],
      clusterTargets: [clusterIn(mode)],
      proposesRefusedCommands: true,
    });
  }

  function toolNamed(
    toolkit: RemediationCommandToolkit,
    name: string,
  ): ObservabilityAssistantExtraTool {
    return toolkit
      .buildTools()
      .find((candidate: ObservabilityAssistantExtraTool) => {
        return candidate.definition.name === name;
      })!;
  }

  it.each([
    KubernetesAiRemediationMode.Automatic,
    KubernetesAiRemediationMode.BypassApproval,
  ])(
    "list_command_targets on a %s cluster",
    async (mode: KubernetesAiRemediationMode) => {
      jest
        .spyOn(RunnerService, "getOnlineAiCommandRunnersForProject")
        .mockResolvedValue([]);

      const outcome: ToolCallOutcome = await toolNamed(
        toolkitFor(mode),
        "list_command_targets",
      ).execute({});

      expect(outcome.textForLlm).toContain(KUBECTL_SAFE_CHANGES_SUMMARY);
      expect(outcome.textForLlm).toContain(KUBECTL_RISKIER_CHANGES_SUMMARY);
      expect(outcome.textForLlm).toContain(KUBECTL_ALWAYS_ASKS_SUMMARY);
      expect(outcome.textForLlm).toContain("matched token by token");
      for (const stale of STALE_PHRASES) {
        expect(outcome.textForLlm).not.toContain(stale);
      }
    },
  );

  it("execute_remediation_command's description", () => {
    const description: string = toolNamed(
      toolkitFor(KubernetesAiRemediationMode.Automatic),
      "execute_remediation_command",
    ).definition.description;

    expect(description).toContain(KUBECTL_SAFE_CHANGES_SUMMARY);
    expect(description).toContain(KUBECTL_RISKIER_CHANGES_SUMMARY);
    expect(description).toContain(KUBECTL_ALWAYS_ASKS_SUMMARY);
    expect(description).toContain(KUBECTL_NEVER_RUNS_SUMMARY);
    // The canonical every-mode clause: breaker and hold turn a run into a proposal.
    expect(description).toContain(UNATTENDED_ROUND_BECOMES_PROPOSAL_SUMMARY);
    for (const stale of STALE_PHRASES) {
      expect(description).not.toContain(stale);
    }
  });

  it("the command field asks for a JSON patch body", () => {
    const properties: Record<string, { description: string }> = toolNamed(
      toolkitFor(KubernetesAiRemediationMode.Automatic),
      "execute_remediation_command",
    ).definition.inputSchema["properties"] as unknown as Record<
      string,
      { description: string }
    >;
    const example: string = `kubectl patch deployment/web -n web -p '{"spec":{"replicas":3}}'`;

    expect(properties["command"]!.description).toContain(
      "a patch body must be JSON",
    );
    expect(properties["command"]!.description).toContain(example);
    // The example is one the policy lets through, not one it denies.
    expect(KubectlPolicy.evaluateCommand(example).tier).toBe(
      KubectlCommandTier.RiskyWrite,
    );
  });

  /*
   * One row field per idea, each capped at the serializer's 500 characters:
   * the mode field must carry the whole canonical sentence — the breaker
   * and hold exception included — or the model reads it cut off.
   */
  it.each<[KubernetesAiRemediationMode, boolean]>([
    [KubernetesAiRemediationMode.Automatic, true],
    [KubernetesAiRemediationMode.Automatic, false],
    [KubernetesAiRemediationMode.BypassApproval, true],
    [KubernetesAiRemediationMode.BypassApproval, false],
  ])(
    "the %s mode field (a round that proposes refused changes: %p) states the breaker and hold exception, whole",
    async (mode: KubernetesAiRemediationMode, proposes: boolean) => {
      jest
        .spyOn(RunnerService, "getOnlineAiCommandRunnersForProject")
        .mockResolvedValue([]);

      const toolkit: RemediationCommandToolkit = new RemediationCommandToolkit({
        projectId: new ObjectID("22222222-2222-4222-8222-222222222222"),
        aiRunId: new ObjectID("88888888-8888-4888-8888-888888888888"),
        suggestionId: new ObjectID("77777777-7777-4777-8777-777777777777"),
        mode: "FullAuto",
        allowlistPatterns: [],
        allowedRunnerIds: [],
        clusterTargets: [clusterIn(mode)],
        proposesRefusedCommands: proposes,
      });

      const outcome: ToolCallOutcome = await toolNamed(
        toolkit,
        "list_command_targets",
      ).execute({});

      expect(outcome.textForLlm).toContain(
        UNATTENDED_ROUND_BECOMES_PROPOSAL_SUMMARY,
      );
      expect(outcome.textForLlm).toContain("alwaysNeedsAHuman");
      expect(outcome.textForLlm).not.toContain("[truncated]");
      expect(outcome.result?.isTruncated).toBe(false);
    },
  );
});

describe("the cluster personas state the canonical every-mode rules", () => {
  it.each([
    ["Automatic", false],
    ["Bypass approval", true],
  ])(
    "%s persona: the breaker and hold exception, and a lost result is checked before a resend",
    (_label: string, bypassApproval: boolean) => {
      const persona: string = buildClusterFullAutoPersona({ bypassApproval });

      expect(persona).toContain(UNATTENDED_ROUND_BECOMES_PROPOSAL_SUMMARY);
      expect(persona).toContain("do NOT try other changes on that cluster");
      expect(persona).toContain("result comes back UNKNOWN");
      expect(persona).toContain("never resend it blindly");
      // A node taint always needs a human, in every mode.
      expect(persona).toMatch(TAINT_WORD_PATTERN);
      expect(persona).not.toMatch(NOBODY_IS_ASKED_PATTERN);
    },
  );
});
