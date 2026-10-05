/*
 * Everything OneUptime AI did on one Kubernetes cluster, newest first: the
 * response of POST /api/kubernetes-cluster/ai-access/logs, which the
 * cluster's AI Logs page renders. (The cluster's AI Insights page — what AI
 * learned from all of it — reads KUBERNETES_CLUSTER_AI_ACCESS_INSIGHTS_PATH.)
 *
 * Summaries only. Nothing here carries kubectl output, a prompt or a
 * command plan: the route is readable by everyone who may read the
 * cluster, a wider audience than the AI runs, suggestions and Runner jobs
 * it summarises.
 */

/*
 * The cluster's AI Logs and AI Insights calls, POST under /api with
 * { clusterId }. The insights call answers AiActivityInsights
 * (Common/Types/AI/AiActivityInsights.ts).
 */
export const KUBERNETES_CLUSTER_AI_ACCESS_LOGS_PATH: string =
  "/kubernetes-cluster/ai-access/logs";
export const KUBERNETES_CLUSTER_AI_ACCESS_INSIGHTS_PATH: string =
  "/kubernetes-cluster/ai-access/insights";

// How many investigations, and how many fixes, the route returns (newest).
export const KUBERNETES_CLUSTER_AI_LOGS_LIMIT: number = 25;

// The window commandCounts covers.
export const KUBERNETES_CLUSTER_AI_LOGS_COMMAND_WINDOW_IN_DAYS: number = 30;

// How much of a fix's rationale the route returns.
export const KUBERNETES_CLUSTER_AI_LOGS_RATIONALE_MAX_LENGTH: number = 300;

/*
 * One investigation that concerns the cluster: it ran kubectl on it, or it
 * investigated an incident or alert linked to it.
 */
export interface KubernetesClusterAiLogInvestigation {
  aiRunId: string;
  // AIRunStatus.
  status?: string | undefined;
  analysisTldr?: string | undefined;
  /*
   * A completed run with no TL;DR: the Summary its posted report opens
   * with, as plain text (InvestigationReportSummary). Never both.
   */
  reportSummary?: string | undefined;
  // ISO dates.
  createdAt?: string | undefined;
  completedAt?: string | undefined;
  incident?:
    | {
        id: string;
        title?: string | undefined;
        number?: number | undefined;
      }
    | undefined;
  alert?:
    | {
        id: string;
        title?: string | undefined;
      }
    | undefined;
}

/*
 * One fix AI proposed or ran on the cluster: a round the cluster's Fixes
 * setting produced, or any suggestion whose kubectl ran on the cluster.
 */
export interface KubernetesClusterAiLogFix {
  id: string;
  // AutoRemediationSuggestionStatus.
  status?: string | undefined;
  // AutoRemediationExecutionMode.
  executionMode?: string | undefined;
  // AutoRemediationSuggestionType.
  suggestionType?: string | undefined;
  // The first KUBERNETES_CLUSTER_AI_LOGS_RATIONALE_MAX_LENGTH characters.
  rationale?: string | undefined;
  createdAt?: string | undefined;
  approvedAt?: string | undefined;
  incidentId?: string | undefined;
  alertId?: string | undefined;
}

export interface KubernetesClusterAiLogs {
  clusterId: string;
  investigations: Array<KubernetesClusterAiLogInvestigation>;
  fixes: Array<KubernetesClusterAiLogFix>;
  /*
   * kubectl commands AI ran on the cluster in the last
   * KUBERNETES_CLUSTER_AI_LOGS_COMMAND_WINDOW_IN_DAYS days, by kind.
   * The AI agent page's "Test connection" checks are not counted.
   */
  commandCounts: {
    investigation: number;
    remediation: number;
  };
}
