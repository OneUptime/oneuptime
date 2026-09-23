import { PROTECTED_KUBERNETES_NAMESPACES } from "Common/Types/Kubernetes/KubernetesClusterAiAccess";
import {
  KUBERNETES_AGENT_HELM_NAMESPACE,
  KUBERNETES_AGENT_HELM_RELEASE,
} from "./DocumentationMarkdown";

/*
 * The helm upgrades and the write-access copy the cluster AI page
 * (Pages/Kubernetes/View/AI.tsx) shows, in a module of their own so the
 * docs suite (App/Tests/FeatureSet/Docs/KubernetesAiAccessDocs.test.ts) can
 * hold them to the same rules as the docs pages — a refreshed chart index
 * before every upgrade, what patch access to workloads amounts to, that a
 * listed namespace must already exist and how to reset the list.
 *
 * Import-clean on purpose (Common types and DocumentationMarkdown only):
 * App tests run without a browser, and AI.tsx reaches RouteMap and
 * Navigation, which read `window` at load.
 */

// "a, b and c" / "a, b or c".
export function formatNameList(
  names: ReadonlyArray<string>,
  conjunction: string,
): string {
  if (names.length <= 1) {
    return names.join("");
  }
  return `${names.slice(0, -1).join(", ")} ${conjunction} ${names[names.length - 1]}`;
}

// The example namespaces the scoped write-access command names.
export const AI_ACCESS_EXAMPLE_WRITE_NAMESPACES: string = "{web,api}";

/*
 * The flag that puts aiAccess.remediation.namespaces back to cluster-wide
 * under `helm upgrade --reuse-values`, which every command here uses.
 *
 * Not `--set aiAccess.remediation.namespaces=null`. With --reuse-values,
 * Helm (3.16) coalesces the new overrides into the release's stored
 * values, and that coalescing deletes a null override whose key the stored
 * values already hold — so a stored [web, api] survives and the role stays
 * bound in web and api alone. On a release installed from a chart that
 * predates aiAccess (every install before this chart), no stored value
 * holds the key, the null reaches the values schema (namespaces is an
 * array) and the whole upgrade fails. An empty JSON list is an ordinary
 * value on both: it replaces a stored list and passes the schema.
 * `--set-json` needs Helm 3.10+. `=null` only resets the list without
 * --reuse-values, e.g. with --reset-then-reuse-values (Helm 3.14+) in its
 * place. Both cases were reproduced with the real helm binary against a
 * stored release (HELM_DRIVER=memory); helm-unittest renders from values
 * files and cannot model --reuse-values.
 */
export const AI_ACCESS_CLUSTER_WIDE_NAMESPACES_FLAG: string =
  "--set-json 'aiAccess.remediation.namespaces=[]'";

/*
 * What the page says wherever it names that reset: why the `=null` form
 * people reach for is not it.
 */
export const AI_ACCESS_NULL_RESET_WARNING: string =
  "--set aiAccess.remediation.namespaces=null does not reset a stored list under --reuse-values (Helm keeps the stored list, and on an agent installed before aiAccess existed the upgrade fails the chart's schema); it only works with --reset-then-reuse-values (Helm 3.14+) in place of --reuse-values";

export interface AiAccessHelmCommands {
  // The default: read-only investigation access. What a plain copy-paste runs.
  readOnly: string;
  /*
   * Write access, the recommended form: the write role bound only in the
   * namespaces AI may fix, and no node operations. A complete command of
   * its own, never a line to append — a dropped last line left a trailing
   * backslash behind.
   */
  enableRemediationScoped: string;
  /*
   * Write access bound cluster-wide. It resets aiAccess.remediation.
   * namespaces with AI_ACCESS_CLUSTER_WIDE_NAMESPACES_FLAG: under
   * --reuse-values a list stored by an earlier scoped upgrade is kept when
   * the flag is left out, so without the reset this command would leave the
   * role bound only where that list says — not "across the cluster", as the
   * page calls it. Node operations keep the release's setting (the chart's
   * default is on).
   */
  enableRemediation: string;
}

/*
 * Every command starts with `helm repo update`: an install from before
 * aiAccess existed keeps a cached chart index, `helm upgrade` then resolves
 * the old chart, and its values schema refuses the flag with "Additional
 * property aiAccess is not allowed" — which reads as "this feature does not
 * exist". Each command is complete on its own, so an operator who skips the
 * read-only step and runs a write-access command directly is covered too.
 * No chart version is named: published charts carry the OneUptime version,
 * not the chart's own.
 */
export function getAiAccessHelmCommands(): AiAccessHelmCommands {
  const upgrade: string = `helm repo update
helm upgrade ${KUBERNETES_AGENT_HELM_RELEASE} oneuptime/kubernetes-agent \\
  --namespace ${KUBERNETES_AGENT_HELM_NAMESPACE} --reuse-values \\
  --set aiAccess.enabled=true`;

  return {
    readOnly: upgrade,
    enableRemediationScoped: `${upgrade} \\
  --set aiAccess.remediation.enabled=true \\
  --set "aiAccess.remediation.namespaces=${AI_ACCESS_EXAMPLE_WRITE_NAMESPACES}" \\
  --set aiAccess.remediation.nodeOperations=false`,
    enableRemediation: `${upgrade} \\
  --set aiAccess.remediation.enabled=true \\
  ${AI_ACCESS_CLUSTER_WIDE_NAMESPACES_FLAG}`,
  };
}

/*
 * What the page says under the recommended (scoped) command. The chart
 * creates one RoleBinding in each listed namespace and never creates a
 * namespace, so a missing one fails the whole upgrade — the agent's
 * collector included. Under --reuse-values a stored list is kept when the
 * flag is left out, so going back to cluster-wide takes
 * AI_ACCESS_CLUSTER_WIDE_NAMESPACES_FLAG (never `=null`, which Helm drops
 * there), and a stored nodeOperations=false is kept too, so turning node
 * operations back on takes `=true` rather than dropping the line. A drain,
 * a taint and a patch of a node always wait for a human, in every mode.
 * What the bound Runner would refuse is refused when a fix is proposed or
 * approved (the remediation toolkit, the approval route and the enqueue
 * chokepoint read the Runner's reported scope), not only on the Runner.
 */
export function getAiAccessScopedCommandNote(): string {
  return `Replace ${AI_ACCESS_EXAMPLE_WRITE_NAMESPACES} with the namespaces AI may fix. Every namespace you list must already exist: the chart creates a RoleBinding in each and never creates a namespace, so a missing one fails the whole upgrade — the agent's collector included — with namespaces "<name>" not found. The chart binds the write role in those alone (aiAccess.remediation.namespaces); a fix anywhere else is refused when it is proposed or approved, and the Runner refuses it again before it runs kubectl. With --reuse-values, leaving the flag out later keeps the stored list: ${AI_ACCESS_CLUSTER_WIDE_NAMESPACES_FLAG} resets it to cluster-wide, as the next command does. ${AI_ACCESS_NULL_RESET_WARNING}. aiAccess.remediation.nodeOperations=false keeps fixes off nodes; set it to true to let AI cordon, uncordon, drain and taint nodes (a drain, a taint or a patch of a node still waits for a human).`;
}

// What the page says under the cluster-wide command.
export function getAiAccessClusterWideCommandNote(): string {
  return `${AI_ACCESS_CLUSTER_WIDE_NAMESPACES_FLAG} resets a namespace list stored on the release, so the write role is bound cluster-wide — see below for what that includes. --set-json needs Helm 3.10 or later. ${AI_ACCESS_NULL_RESET_WARNING}. Node operations keep the release's setting (on unless you turned them off).`;
}

/*
 * What granting the in-cluster Runner write access amounts to, said
 * wherever the page offers it — the same disclosure the chart docs make
 * (telemetry/kubernetes-agent.md, ai/ai-sre.md): RBAC bounds WHERE the
 * Runner may write, not what a write may do.
 */
export function getAiAccessWriteDisclosure(): string {
  return `Write access grants patch/update on Deployments, StatefulSets, DaemonSets, ReplicaSets, Jobs, CronJobs, Pods and HPAs, create on Jobs and HPAs, and delete on Pods and Jobs — and, unless aiAccess.remediation.nodeOperations=false, cordon, uncordon, drain and taint on every node. Patch/update on workloads, pods and CronJobs, and create on Jobs, in a namespace is equivalent to running any image as any ServiceAccount in that namespace and reading its Secrets. Without aiAccess.remediation.namespaces the write role is bound cluster-wide — ${formatNameList(
    PROTECTED_KUBERNETES_NAMESPACES,
    "and",
  )} and the agent's own namespace included — and there only the command policy and the Runner hold the line: a write in ${formatNameList(
    PROTECTED_KUBERNETES_NAMESPACES,
    "or",
  )} always needs a human, and the Runner never changes anything in its own namespace. With it, the chart binds the role in exactly the namespaces you list, and a write anywhere else is refused when it is proposed or approved, and again by the Runner.`;
}
