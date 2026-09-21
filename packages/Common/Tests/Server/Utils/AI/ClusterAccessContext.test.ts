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
    expect(addendum).toContain('CANNOT reach with kubectl: "staging"');
    expect(addendum).toContain("Do NOT invent kubectl output");
    expect(addendum).toContain(
      `**${ClusterAccessContext.REPORT_SECTION_HEADING}**`,
    );
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
