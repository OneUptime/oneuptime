import {
  describeEvidenceTool,
  EvidenceToolDescription,
  formatRowCount,
} from "../../Utils/InvestigationEvidenceFormat";
import {
  KUBECTL_RESULT_UNKNOWN_EVENT_PREFIX,
  LIST_CLUSTER_ACCESS_TOOL_NAME,
  RUN_KUBECTL_TOOL_NAME,
} from "Common/Types/Kubernetes/KubernetesClusterAiAccessToolNames";
import {
  INFRASTRUCTURE_RESULT_UNKNOWN_EVENT_PREFIX,
  INFRASTRUCTURE_TOOL_NAMES,
  LIST_INFRASTRUCTURE_ACCESS_TOOL_NAME,
  RUN_INFRASTRUCTURE_COMMAND_TOOL_NAME,
  isInfrastructureResultUnknownMessage,
  isInfrastructureToolName,
} from "Common/Server/Utils/AI/ResourceAccess/ResourceAccessToolNames";
import {
  getGlobalTranslator,
  Translator,
} from "Common/UI/Utils/TranslateTemplate";

/*
 * How the investigation panel words the AI tools that reach a Kubernetes
 * cluster rather than the project's telemetry — in the activity feed, the
 * Evidence tab and the usage line alike, so the three can never drift.
 *
 * A kubectl call has no rows: the server records rowCount 1 for a command
 * kubectl completed and 0 for one where kubectl ran and returned an error.
 * list_cluster_access's rowCount is the number of clusters it listed.
 *
 * Pure (no RouteMap, no window at load) so any component and test can
 * import it. The wording is in the reader's language: a component passes its
 * translator, and everything else gets the global one (English until the
 * Dashboard's i18next is set up).
 */

export const CLUSTER_TOOL_NAMES: ReadonlyArray<string> = [
  RUN_KUBECTL_TOOL_NAME,
  LIST_CLUSTER_ACCESS_TOOL_NAME,
];

// Cluster tool calls are never "telemetry queries".
export function isClusterToolName(
  toolName: string | null | undefined,
): boolean {
  return CLUSTER_TOOL_NAMES.includes(toolName || "");
}

/*
 * The tools that reach an infrastructure resource (a Docker or Podman
 * host, a Swarm, Proxmox, VMware or Ceph cluster, a database server, a
 * host) through its AI agent — defined next to the server's toolkit and
 * re-exported for the panel's readers. Worded here like the cluster tools.
 */
export {
  INFRASTRUCTURE_RESULT_UNKNOWN_EVENT_PREFIX,
  INFRASTRUCTURE_TOOL_NAMES,
  isInfrastructureResultUnknownMessage,
  isInfrastructureToolName,
};

/*
 * Every tool that runs something on live infrastructure — a cluster or any
 * other resource — rather than querying the project's telemetry. Their
 * calls are never "telemetry queries" and have no rows to load.
 */
export function isLiveInfrastructureToolName(
  toolName: string | null | undefined,
): boolean {
  return isClusterToolName(toolName) || isInfrastructureToolName(toolName);
}

/*
 * How the server's persisted event starts for a kubectl command a Runner
 * took whose result never came back — whether it ran is unknown, so it is
 * never counted as "did not run". Defined once, next to the tool names the
 * server and the panel share; re-exported for the panel's readers.
 */
export { KUBECTL_RESULT_UNKNOWN_EVENT_PREFIX };

export function isKubectlResultUnknownMessage(
  errorMessage: string | null | undefined,
): boolean {
  return (
    typeof errorMessage === "string" &&
    errorMessage.startsWith(KUBECTL_RESULT_UNKNOWN_EVENT_PREFIX)
  );
}

export interface ClusterToolOutcome {
  // Sentence case, for a pill on its own: "Succeeded".
  label: string;
  // For a "·"-joined detail line: "succeeded".
  detail: string;
  // kubectl ran and returned an error.
  isError: boolean;
}

function toCount(value: number | null | undefined): number {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.max(0, Math.floor(value))
    : 0;
}

/*
 * What a completed cluster tool call did, or null for any other tool
 * (whose rowCount really is rows).
 */
export function describeClusterToolOutcome(
  toolName: string | null | undefined,
  rowCount: number | null | undefined,
  translator: Translator = getGlobalTranslator(),
): ClusterToolOutcome | null {
  const outcome: (data: {
    label: string;
    detail: string;
    isError: boolean;
  }) => ClusterToolOutcome = (data: {
    label: string;
    detail: string;
    isError: boolean;
  }): ClusterToolOutcome => {
    return {
      label: translator.translateText(data.label) as string,
      detail: translator.translateText(data.detail) as string,
      isError: data.isError,
    };
  };

  if (toolName === RUN_KUBECTL_TOOL_NAME) {
    return toCount(rowCount) > 0
      ? outcome({ label: "Succeeded", detail: "succeeded", isError: false })
      : outcome({
          label: "kubectl returned an error",
          detail: "kubectl returned an error",
          isError: true,
        });
  }

  if (toolName === LIST_CLUSTER_ACCESS_TOOL_NAME) {
    const count: number = toCount(rowCount);

    if (count === 0) {
      return outcome({
        label: "No clusters",
        detail: "no clusters",
        isError: false,
      });
    }

    const text: string = translator.translatePlural(
      { one: "{{count}} cluster", other: "{{count}} clusters" },
      count,
    );

    return { label: text, detail: text, isError: false };
  }

  /*
   * A command on an infrastructure resource: 1 when it completed, 0 when
   * it ran and the program returned an error; a resource listing's
   * rowCount is the number of resources it listed.
   */
  if (toolName === RUN_INFRASTRUCTURE_COMMAND_TOOL_NAME) {
    return toCount(rowCount) > 0
      ? outcome({ label: "Succeeded", detail: "succeeded", isError: false })
      : outcome({
          label: "The command returned an error",
          detail: "the command returned an error",
          isError: true,
        });
  }

  if (toolName === LIST_INFRASTRUCTURE_ACCESS_TOOL_NAME) {
    const count: number = toCount(rowCount);

    if (count === 0) {
      return outcome({
        label: "No resources",
        detail: "no resources",
        isError: false,
      });
    }

    const text: string = translator.translatePlural(
      { one: "{{count}} resource", other: "{{count}} resources" },
      count,
    );

    return { label: text, detail: text, isError: false };
  }

  return null;
}

// The Evidence tab's pill: the cluster wording, or the row count.
export function formatEvidenceOutcome(
  toolName: string | null | undefined,
  rowCount: number | null | undefined,
  translator: Translator = getGlobalTranslator(),
): string {
  return (
    describeClusterToolOutcome(toolName, rowCount, translator)?.label ??
    formatRowCount(rowCount)
  );
}

/*
 * What a cluster tool did, or null for any other tool. The wording lives in
 * the shared evidence formatter's table (Utils/InvestigationEvidenceFormat),
 * so every surface that describes a tool call — this one included — reads
 * the same entry.
 */
export function describeClusterEvidenceTool(
  toolName: string | null | undefined,
): EvidenceToolDescription | null {
  return isLiveInfrastructureToolName(toolName)
    ? describeEvidenceTool(toolName)
    : null;
}

/*
 * Why an expanded cluster item shows no rows, or null for any other tool.
 * kubectl output is never re-run or shown from the dashboard: the report
 * quotes what the AI read.
 */
export function getClusterEvidenceNote(
  toolName: string | null | undefined,
  translator: Translator = getGlobalTranslator(),
): string | null {
  if (toolName === RUN_KUBECTL_TOOL_NAME) {
    return translator.translateText(
      "kubectl commands are not re-run from the dashboard, and their output is not shown here. The report quotes what OneUptime AI read from it; the cluster's AI Logs page (AI → Logs) lists every kubectl command OneUptime AI ran there.",
    ) as string;
  }

  if (toolName === LIST_CLUSTER_ACCESS_TOOL_NAME) {
    return translator.translateText(
      "This listed the clusters OneUptime AI could inspect with kubectl during the investigation; it has no rows to load.",
    ) as string;
  }

  if (toolName === RUN_INFRASTRUCTURE_COMMAND_TOOL_NAME) {
    return translator.translateText(
      "Infrastructure commands are not re-run from the dashboard, and their output is not shown here. The report quotes what OneUptime AI read from it; the resource's AI Logs page (AI → Logs) lists every command OneUptime AI ran there.",
    ) as string;
  }

  if (toolName === LIST_INFRASTRUCTURE_ACCESS_TOOL_NAME) {
    return translator.translateText(
      "This listed the infrastructure resources OneUptime AI could inspect through their AI agents during the investigation; it has no rows to load.",
    ) as string;
  }

  return null;
}
