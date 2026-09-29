import Permission, { PermissionHelper } from "../Permission";

/*
 * Who may change what OneUptime AI is allowed to do on a Kubernetes cluster.
 *
 * Kept apart from KubernetesClusterAiAccess.ts, which the Runner binary
 * imports and which therefore stays free of the permission catalog.
 */

/*
 * Who may LOOSEN a cluster's AI access: turn AI fixes on (any move up from
 * Off, Ask for approval included) or give them more autonomy (Automatic,
 * Bypass approval), author a kubectl allowlist, bind the Runner / Kubernetes
 * credential kubectl runs through, or clear that binding while the cluster
 * has a Kubernetes AI agent (which hands the cluster to the agent), and
 * reset the cluster's Kubernetes AI agent. A cluster's AI mode does the job
 * of a FullAuto AutoRemediationRule without a rule row, so it takes the
 * same set AutoRemediationRule uses for executionMode, commandAllowlist and
 * commandRunners.
 *
 * Tightening (Off, moving down, clearing the allowlist, or clearing the
 * binding of a cluster with no AI agent) stays open to anyone who may edit
 * the cluster: making AI do less never needs more privilege than the
 * cluster itself.
 */
export const KUBERNETES_AI_ACCESS_ADMIN_PERMISSIONS: Array<Permission> = [
  Permission.ProjectOwner,
  Permission.ProjectAdmin,
  Permission.EditAutoRemediationRule,
];

/*
 * Binding a Kubernetes credential additionally needs permission to read
 * credentials — the same rule the dashboard's credential picker applies —
 * so a credential id copied from somewhere else cannot be bound blind.
 */
export const KUBERNETES_AI_ACCESS_CREDENTIAL_PERMISSIONS: Array<Permission> = [
  Permission.ProjectOwner,
  Permission.ProjectAdmin,
  Permission.ReadRunbookCredential,
];

/*
 * What deleting a previous in-cluster Runner does. The binding's foreign
 * key is ON DELETE SET NULL, so a deleted Runner's clusters are left with
 * no Runner bound, and registration never binds a cluster that had one
 * (left_unbound_by_operator): such a cluster is then reached through its
 * Kubernetes AI agent, which the current chart installs. Binding a Runner
 * again loosens AI access, so it needs one of these permissions — which
 * whoever deleted the Runner may not hold. Here, not in
 * KubernetesClusterAiAccessService, so RunnerService (which that service
 * imports) can name it too without an import cycle.
 */
export function getDeletedAgentRunnerRebindNote(): string {
  return `Deleting a Runner leaves the clusters it was bound to with no Runner bound; they then use their Kubernetes AI agent (upgrade the Kubernetes agent chart to install it). A registering Runner never binds a cluster that had one, and binding a Runner again needs one of these permissions: ${PermissionHelper.getPermissionTitles(
    KUBERNETES_AI_ACCESS_ADMIN_PERMISSIONS,
  ).join(", ")}.`;
}
