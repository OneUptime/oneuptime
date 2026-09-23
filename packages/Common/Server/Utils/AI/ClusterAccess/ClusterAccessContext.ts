import {
  KubernetesAiAccessGap,
  KubernetesAiRemediationMode,
  KubernetesClusterAiAccessStatus,
} from "../../../../Types/Kubernetes/KubernetesClusterAiAccess";
import { KUBECTL_ALWAYS_ASKS_SUMMARY } from "../../../../Types/AutoRemediation/AiRemediationCommandPlan";

/*
 * The canonical KubernetesAiRemediationMode comment's last every-mode
 * clause, in the words every model-facing copy of the unattended modes
 * uses: what turns an Automatic or Bypass-approval round into a proposal.
 * The remediation prompts, tools and feed items import it from here (a
 * pure module every one of them can reach without an import cycle).
 */
export const UNATTENDED_ROUND_BECOMES_PROPOSAL_SUMMARY: string =
  "an unattended run becomes a proposal when the hourly per-cluster circuit breaker trips or another unattended round already holds the cluster";

// "a write ..." -> "A write ..." for copy that starts a sentence.
function capitalizeFirst(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

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
          .join(
            ", ",
          )}. Use run_kubectl for READ-ONLY inspection — kubectl get/describe/events/logs/top/rollout status — the way an on-call engineer would open a terminal: describe the failing pod, read its recent events, check node capacity and pending-pod reasons, tail the crashing container's logs. Prefer direct cluster inspection over guessing from metrics when the two disagree. Every kubectl command that ran is cited like any other tool result; a command that could not run comes back as an error, is not evidence, and must never be described as inspected. The Runner that runs kubectl lives in the cluster and can itself be down: if run_kubectl says a cluster's Runner did not pick up a command, that cluster is unreachable for the rest of this investigation — do not call run_kubectl on it again, continue with OneUptime telemetry, and say so in your report. Reading Secrets is refused and credential-looking values (Secret data, passwords, tokens, keys) are redacted from every output before you see it — never ask for them and never treat a redaction marker as a finding.`,
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
          .join(
            ", ",
          )}. Investigate with OneUptime's own telemetry (metrics, logs, events, traces) and say plainly in your report that you could not inspect the cluster directly. Do NOT invent kubectl output.`,
      );
    }

    lines.push(
      `Add a section **${ClusterAccessContext.REPORT_SECTION_HEADING}** before Suggested next steps: one or two sentences on what you inspected directly on the cluster (or that you could not — access not set up, or the cluster's Runner not responding — and that the human should check the cluster's AI page).`,
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

  /*
   * The cluster's remediation mode in the words of the canonical
   * KubernetesAiRemediationMode comment (Types/Kubernetes/
   * KubernetesClusterAiAccess): what runs without a human, what is
   * proposed instead, and what always asks — Bypass approval included.
   */
  private static describeRemediationMode(
    status: KubernetesClusterAiAccessStatus,
  ): string {
    if (status.remediationMode === KubernetesAiRemediationMode.BypassApproval) {
      return status.isRemediationReady
        ? `Bypass approval (AI does not ask: every kubectl fix the policy allows, safe and riskier, runs without a human, follow-up rounds included — except that ${KUBECTL_ALWAYS_ASKS_SUMMARY}, and ${UNATTENDED_ROUND_BECOMES_PROPOSAL_SUMMARY}; destructive commands never run)`
        : "Bypass approval, but not ready";
    }
    if (status.remediationMode === KubernetesAiRemediationMode.Automatic) {
      return status.isRemediationReady
        ? `Automatic (safe kubectl fixes run without a human, and so do riskier ones whose shape the cluster's kubectl allowlist names; any other riskier fix never runs without one — a round that finds only riskier fixes proposes them for one-click approval, and after safe fixes a riskier one is proposed only if verification shows they did not recover the signal, in a follow-up round that asks. ${capitalizeFirst(
            KUBECTL_ALWAYS_ASKS_SUMMARY,
          )}, and ${UNATTENDED_ROUND_BECOMES_PROPOSAL_SUMMARY}; destructive commands never run)`
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
