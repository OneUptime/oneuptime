import ClusterAccessContext, {
  UNATTENDED_ROUND_BECOMES_PROPOSAL_SUMMARY,
} from "../../../../Server/Utils/AI/ClusterAccess/ClusterAccessContext";
import { KUBECTL_ALWAYS_ASKS_SUMMARY } from "../../../../Types/AutoRemediation/AiRemediationCommandPlan";
import {
  KubernetesAiRemediationMode,
  KubernetesClusterAiAccessStatus,
  PROTECTED_KUBERNETES_NAMESPACES,
} from "../../../../Types/Kubernetes/KubernetesClusterAiAccess";
import { describe, expect, it } from "@jest/globals";

// The stale Bypass promise: a Bypass round does still ask, for some changes.
const NOTHING_IS_ASKED_PATTERN: RegExp =
  /nothing is ever asked|nobody is asked/i;
const DRAIN_WORD_PATTERN: RegExp = /\bdrain\b/;
const TAINT_WORD_PATTERN: RegExp = /\btaint\b/;

/*
 * Contract under test — the deterministic text that tells the model (and,
 * through the panel, the human) which clusters OneUptime AI can inspect and
 * which it cannot, and why. It is derived from the access status only,
 * never from model output.
 */

function status(
  overrides: Partial<KubernetesClusterAiAccessStatus> = {},
): KubernetesClusterAiAccessStatus {
  return {
    clusterId: "33333333-3333-4333-8333-333333333333",
    clusterName: "prod-us",
    clusterIdentifier: "prod-us",
    runner: {
      id: "44444444-4444-4444-8444-444444444444",
      name: "kubernetes-agent/prod-us",
      isOnline: true,
      canRunAiCommands: true,
    },
    accessMethod: "in_cluster",
    kubectlAllowlist: [],
    isInvestigationEnabled: true,
    isInvestigationReady: true,
    remediationMode: KubernetesAiRemediationMode.RequireApproval,
    isRemediationReady: true,
    gaps: [],
    evaluatedAt: new Date().toISOString(),
    ...overrides,
  };
}

describe("ClusterAccessContext", () => {
  it("renders nothing for a signal with no clusters", () => {
    expect(ClusterAccessContext.buildContextSection([])).toBe("");
  });

  it("tells the model which cluster it may inspect and how remediation works", () => {
    const section: string = ClusterAccessContext.buildContextSection([
      status(),
    ]);

    expect(section).toContain("# Cluster access");
    expect(section).toContain('"prod-us"');
    expect(section).toContain(
      "clusterId: 33333333-3333-4333-8333-333333333333",
    );
    expect(section).toContain("kubectl READ access available via run_kubectl");
    expect(section).toContain("in-cluster Runner");
    expect(section).toContain("a human approves any kubectl fix");
  });

  it("describes every remediation mode, ready or not, so the model never guesses what it may change", () => {
    const describe: (
      mode: KubernetesAiRemediationMode,
      isRemediationReady: boolean,
    ) => string = (
      mode: KubernetesAiRemediationMode,
      isRemediationReady: boolean,
    ): string => {
      return ClusterAccessContext.buildContextSection([
        status({ remediationMode: mode, isRemediationReady }),
      ]);
    };

    /*
     * Changed in the round-three review: the Bypass line used to promise
     * "nothing is ever asked" and the Automatic line that riskier fixes are
     * "left in the recommendations". Both contradicted the canonical
     * KubernetesAiRemediationMode comment — a Bypass round still asks for
     * a protected-namespace write, a node drain or a taint, and becomes a
     * proposal when the breaker trips or another round holds the cluster;
     * an Automatic round proposes a riskier fix for one-click approval. The
     * clause-by-clause pins are in "states every mode the way the
     * canonical comment does" below.
     */
    expect(
      describe(KubernetesAiRemediationMode.BypassApproval, true),
    ).toContain("Bypass approval (AI does not ask:");
    expect(
      describe(KubernetesAiRemediationMode.BypassApproval, false),
    ).toContain("Bypass approval, but not ready");

    expect(describe(KubernetesAiRemediationMode.Automatic, true)).toContain(
      "Automatic (safe kubectl fixes run without a human",
    );
    expect(describe(KubernetesAiRemediationMode.Automatic, false)).toContain(
      "Automatic, but not ready",
    );

    expect(
      describe(KubernetesAiRemediationMode.RequireApproval, false),
    ).toContain("requires approval, but not ready");

    expect(describe(KubernetesAiRemediationMode.Disabled, false)).toContain(
      "disabled — AI may only inspect",
    );
  });

  /*
   * The canonical KubernetesAiRemediationMode comment, clause by clause:
   * Bypass approval does not ask — except for a protected-namespace write,
   * a node drain and a node taint, which always need a human, and a round
   * becomes a proposal when the breaker trips or another unattended round
   * holds the cluster; Automatic runs safe (and allowlisted) fixes and
   * proposes a riskier one for one-click approval, never leaving it only
   * in the recommendations.
   */
  it("states every mode the way the canonical comment does", () => {
    const describeReady: (mode: KubernetesAiRemediationMode) => string = (
      mode: KubernetesAiRemediationMode,
    ): string => {
      return ClusterAccessContext.buildContextSection([
        status({ remediationMode: mode, isRemediationReady: true }),
      ]);
    };

    const bypass: string = describeReady(
      KubernetesAiRemediationMode.BypassApproval,
    );
    const automatic: string = describeReady(
      KubernetesAiRemediationMode.Automatic,
    );

    for (const text of [bypass, automatic]) {
      // Automatic's copy starts a sentence with it, so compare case-blind.
      expect(text.toLowerCase()).toContain(
        KUBECTL_ALWAYS_ASKS_SUMMARY.toLowerCase(),
      );
      expect(text).toMatch(DRAIN_WORD_PATTERN);
      expect(text).toMatch(TAINT_WORD_PATTERN);
      for (const namespace of PROTECTED_KUBERNETES_NAMESPACES) {
        expect(text).toContain(namespace);
      }
      expect(text).toContain(UNATTENDED_ROUND_BECOMES_PROPOSAL_SUMMARY);
      expect(text).toContain("destructive commands never run");
      expect(text).not.toMatch(NOTHING_IS_ASKED_PATTERN);
      expect(text).not.toContain("left in the recommendations");
    }

    expect(UNATTENDED_ROUND_BECOMES_PROPOSAL_SUMMARY).toContain(
      "circuit breaker trips",
    );
    expect(UNATTENDED_ROUND_BECOMES_PROPOSAL_SUMMARY).toContain(
      "another unattended round already holds the cluster",
    );

    expect(bypass).toContain("AI does not ask");
    expect(bypass).toContain("safe and riskier");
    expect(bypass).toContain("follow-up rounds included");

    expect(automatic).toContain(
      "riskier ones whose shape the cluster's kubectl allowlist names",
    );
    expect(automatic).toContain(
      "a round that finds only riskier fixes proposes them for one-click approval",
    );
    expect(automatic).toContain(
      "a riskier one is proposed only if verification shows they did not recover the signal",
    );

    // Negative control: a cluster that asks for everything says only that.
    const requireApproval: string = describeReady(
      KubernetesAiRemediationMode.RequireApproval,
    );
    expect(requireApproval).toContain("a human approves any kubectl fix");
    expect(requireApproval).not.toContain(
      UNATTENDED_ROUND_BECOMES_PROPOSAL_SUMMARY,
    );
  });

  it("tells the model why a cluster is unreachable and to say so", () => {
    const section: string = ClusterAccessContext.buildContextSection([
      status({
        isInvestigationReady: false,
        gaps: [
          {
            code: "runner_offline",
            title: "The Runner is offline",
            description: "x",
            nextStep: "y",
            blocks: "both",
          },
          {
            code: "remediation_disabled",
            title: "AI remediation is turned off for this cluster",
            description: "x",
            nextStep: "y",
            blocks: "remediation",
          },
        ],
      }),
    ]);

    expect(section).toContain("NO kubectl access — The Runner is offline");
    // A remediation-only gap is not a reason the investigation failed.
    expect(section).not.toContain("remediation is turned off");
    expect(section).toContain("OneUptime telemetry only");
  });

  it("builds a persona addendum that covers ready, unreachable and the report section", () => {
    const addendum: string = ClusterAccessContext.buildPersonaAddendum([
      status(),
      status({
        clusterId: "99999999-9999-4999-8999-999999999999",
        clusterName: "staging",
        isInvestigationReady: false,
      }),
    ]);

    expect(addendum).toContain('can inspect directly: "prod-us"');
    expect(addendum).toContain("Use run_kubectl for READ-ONLY inspection");
    // Secrets are refused by the policy and output is redacted: said up front.
    expect(addendum).toContain("Reading Secrets is refused");
    expect(addendum).toContain("redacted from every output");
    expect(addendum).toContain('CANNOT reach with kubectl: "staging"');
    expect(addendum).toContain("Do NOT invent kubectl output");
    expect(addendum).toContain(
      `**${ClusterAccessContext.REPORT_SECTION_HEADING}**`,
    );
  });

  /*
   * The in-cluster Runner can be down exactly when the cluster is in
   * trouble. The model must know that a command which did not run is not
   * evidence, and that an unresponsive Runner means "stop trying kubectl
   * on that cluster" rather than "try again".
   */
  it("tells the model a command that did not run is not evidence, and to stop on an unresponsive Runner", () => {
    const addendum: string = ClusterAccessContext.buildPersonaAddendum([
      status(),
    ]);

    expect(addendum).toContain("Every kubectl command that ran is cited");
    expect(addendum).toContain(
      "a command that could not run comes back as an error, is not evidence",
    );
    expect(addendum).toContain("did not pick up a command");
    expect(addendum).toContain("do not call run_kubectl on it again");
    expect(addendum).not.toContain("try again");
    expect(addendum).toContain("the cluster's Runner not responding");
  });

  it("describes missing access for humans with the first blocking gap and its next step", () => {
    const text: string = ClusterAccessContext.describeMissingAccessForHumans(
      status({
        isInvestigationReady: false,
        gaps: [
          {
            code: "investigation_disabled",
            title: "AI investigation is turned off for this cluster",
            description: "x",
            nextStep: 'Turn on "Let AI investigate with kubectl".',
            blocks: "investigation",
          },
        ],
      }),
    );

    expect(text).toBe(
      'OneUptime AI could not run kubectl on cluster "prod-us": ai investigation is turned off for this cluster. Turn on "Let AI investigate with kubectl".',
    );

    expect(ClusterAccessContext.describeMissingAccessForHumans(status())).toBe(
      'OneUptime AI has kubectl access to cluster "prod-us".',
    );
  });
});
