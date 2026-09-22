import ClusterAccessContext from "../../../../Server/Utils/AI/ClusterAccess/ClusterAccessContext";
import {
  KubernetesAiRemediationMode,
  KubernetesClusterAiAccessStatus,
} from "../../../../Types/Kubernetes/KubernetesClusterAiAccess";
import { describe, expect, it } from "@jest/globals";

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

    expect(
      describe(KubernetesAiRemediationMode.BypassApproval, true),
    ).toContain(
      "Bypass approval (every allowed kubectl fix runs without a human; nothing is ever asked)",
    );
    expect(
      describe(KubernetesAiRemediationMode.BypassApproval, false),
    ).toContain("Bypass approval, but not ready");

    expect(describe(KubernetesAiRemediationMode.Automatic, true)).toContain(
      "Automatic (safe kubectl fixes run without a human; riskier ones are left in the recommendations for a human)",
    );
    expect(describe(KubernetesAiRemediationMode.Automatic, false)).toContain(
      "Automatic, but not ready",
    );
    /*
     * A riskier change never runs without a human in Automatic mode: the
     * unattended round leaves it in the recommendations rather than asking,
     * so the model must not be told that riskier fixes "ask".
     */
    expect(describe(KubernetesAiRemediationMode.Automatic, true)).not.toMatch(
      /riskier ones ask/,
    );

    expect(
      describe(KubernetesAiRemediationMode.RequireApproval, false),
    ).toContain("requires approval, but not ready");

    expect(describe(KubernetesAiRemediationMode.Disabled, false)).toContain(
      "disabled — AI may only inspect",
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
