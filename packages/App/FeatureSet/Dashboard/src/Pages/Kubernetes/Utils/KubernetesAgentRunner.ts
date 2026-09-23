import {
  isKubernetesAgentRunnerName,
  isKubernetesAgentRunnerPosture,
  parseKubernetesRunnerPosture,
} from "Common/Types/Kubernetes/KubernetesClusterAiAccess";

/*
 * Which Runner rows the kubernetes-agent chart installed, for every
 * Dashboard page that treats such a row differently: the cluster AI page's
 * Runner and credential pickers, and the Runner list and detail pages.
 *
 * Deliberately import-clean (Common types only): the App docs suite and the
 * page suites read it without a browser, and nothing here may reach
 * RouteMap or Navigation, which read `window` at load.
 */

// What the rule reads off a Runner row: the stored name and the posture.
export interface KubernetesAgentRunnerRowMarkers {
  name?: unknown;
  hostInfo?: unknown;
}

/*
 * Is this Runner row a kubernetes-agent Runner? The server's one rule
 * (RunnerService.isKubernetesAgentRunnerRow), failing closed on either
 * fact:
 *
 * - the server-owned name marker ("kubernetes-agent/..."), compared
 *   case-insensitively the way the database compares it — RunnerService
 *   refuses any non-root rename into or out of the prefix, in any case; or
 * - an agent posture (in a cluster AND naming that cluster), which only the
 *   kubernetes-agent Runner binary reports on its heartbeats.
 *
 * The server refuses a rename of such a row, "Runs Runbooks" or "Runs AI
 * Code Fixes" on it, a credential for it, Bash/SSH work on it and binding
 * it to another cluster; the pages use this rule so they never offer what
 * the server would refuse. Reading only the name would miss a row whose
 * posture says it is an agent (a legacy rename from before the rename
 * guard), and the server would still refuse the write.
 */
export function isKubernetesAgentRunnerRow(
  runner: KubernetesAgentRunnerRowMarkers | null | undefined,
): boolean {
  if (!runner) {
    return false;
  }

  return (
    isKubernetesAgentRunnerName(
      typeof runner.name === "string" ? runner.name.trim().toLowerCase() : "",
    ) ||
    isKubernetesAgentRunnerPosture(
      parseKubernetesRunnerPosture(runner.hostInfo),
    )
  );
}
