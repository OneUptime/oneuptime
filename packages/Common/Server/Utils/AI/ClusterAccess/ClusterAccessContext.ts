import {
  KubernetesAiAccessGap,
  KubernetesAiRemediationMode,
  KubernetesClusterAiAccessStatus,
} from "../../../../Types/Kubernetes/KubernetesClusterAiAccess";

/*
 * The prompt-side view of cluster access.
 *
 * Two audiences read this: the model, which needs to know which clusters it
 * may inspect and how; and, through the model's report, the on-call human,
 * who needs to hear "I could not access the cluster, here is why" in the
 * report itself rather than discover it later. The section is deterministic
 * text derived from KubernetesClusterAiAccessStatus — never model output.
 */
export default class ClusterAccessContext {
  public static readonly REPORT_SECTION_HEADING: string = "Cluster access";

  /*
   * Appended to the investigation persona whenever the subject is linked to
   * at least one cluster, ready or not.
   */
  public static buildPersonaAddendum(
    statuses: Array<KubernetesClusterAiAccessStatus>,
  ): string {
    const ready: Array<KubernetesClusterAiAccessStatus> = statuses.filter(
      (status: KubernetesClusterAiAccessStatus) => {
        return status.isInvestigationReady;
      },
    );

    const lines: Array<string> = [];

    if (ready.length > 0) {
      lines.push(
        `This signal is linked to Kubernetes cluster(s) OneUptime AI can inspect directly: ${ready
          .map((status: KubernetesClusterAiAccessStatus) => {
            return `"${status.clusterName}"`;
          })
          .join(", ")}. Use run_kubectl for READ-ONLY inspection — kubectl get/describe/events/logs/top/rollout status — the way an on-call engineer would open a terminal: describe the failing pod, read its recent events, check node capacity and pending-pod reasons, tail the crashing container's logs. Prefer direct cluster inspection over guessing from metrics when the two disagree. Every run_kubectl result is cited like any other tool result.`,
      );
    }

    const notReady: Array<KubernetesClusterAiAccessStatus> = statuses.filter(
      (status: KubernetesClusterAiAccessStatus) => {
        return !status.isInvestigationReady;
      },
    );

    if (notReady.length > 0) {
      lines.push(
        `This signal is linked to Kubernetes cluster(s) OneUptime AI CANNOT reach with kubectl: ${notReady
          .map((status: KubernetesClusterAiAccessStatus) => {
            return `"${status.clusterName}"`;
          })
          .join(", ")}. Investigate with OneUptime's own telemetry (metrics, logs, events, traces) and say plainly in your report that you could not inspect the cluster directly. Do NOT invent kubectl output.`,
      );
    }

    lines.push(
      `Add a section **${ClusterAccessContext.REPORT_SECTION_HEADING}** before Suggested next steps: one or two sentences on what you inspected directly on the cluster (or that you could not, and that the human should set up AI access on the cluster's AI page).`,
    );

    return lines.join("\n");
  }

  // The "# Cluster access" block of the context summary that seeds the run.
  public static buildContextSection(
    statuses: Array<KubernetesClusterAiAccessStatus>,
  ): string {
    if (statuses.length === 0) {
      return "";
    }

    const lines: Array<string> = ["", "# Cluster access"];

    for (const status of statuses) {
      if (status.isInvestigationReady) {
        lines.push(
          `- Cluster "${status.clusterName}" (clusterId: ${status.clusterId}): kubectl READ access available via run_kubectl${
            status.accessMethod === "in_cluster"
              ? " (in-cluster Runner)"
              : status.credentialName
                ? ` (Runner "${status.runner?.name}" with credential "${status.credentialName}")`
                : ""
          }. Remediation: ${ClusterAccessContext.describeRemediationMode(status)}.`,
        );
        continue;
      }

      const reasons: Array<string> = status.gaps
        .filter((gap: KubernetesAiAccessGap) => {
          return gap.blocks === "investigation" || gap.blocks === "both";
        })
        .map((gap: KubernetesAiAccessGap) => {
          return gap.title;
        });

      lines.push(
        `- Cluster "${status.clusterName}" (clusterId: ${status.clusterId}): NO kubectl access — ${
          reasons.length > 0 ? reasons.join("; ") : "not configured"
        }. Investigate with OneUptime telemetry only.`,
      );
    }

    return lines.join("\n");
  }

  /*
   * The sentence the investigation panel shows humans when AI investigated
   * with OneUptime data only. Deterministic so it reads the same on every
   * panel and never depends on the model remembering to say it.
   */
  public static describeMissingAccessForHumans(
    status: KubernetesClusterAiAccessStatus,
  ): string {
    const blocking: Array<KubernetesAiAccessGap> = status.gaps.filter(
      (gap: KubernetesAiAccessGap) => {
        return gap.blocks === "investigation" || gap.blocks === "both";
      },
    );

    if (blocking.length === 0) {
      return `OneUptime AI has kubectl access to cluster "${status.clusterName}".`;
    }

    const first: KubernetesAiAccessGap = blocking[0]!;

    return `OneUptime AI could not run kubectl on cluster "${status.clusterName}": ${first.title.toLowerCase()}. ${first.nextStep}`;
  }

  private static describeRemediationMode(
    status: KubernetesClusterAiAccessStatus,
  ): string {
    if (status.remediationMode === KubernetesAiRemediationMode.Automatic) {
      return status.isRemediationReady
        ? "Automatic (safe kubectl fixes run without a human; riskier ones ask)"
        : "Automatic, but not ready";
    }
    if (
      status.remediationMode === KubernetesAiRemediationMode.RequireApproval
    ) {
      return status.isRemediationReady
        ? "a human approves any kubectl fix before it runs"
        : "requires approval, but not ready";
    }
    return "disabled — AI may only inspect";
  }
}
