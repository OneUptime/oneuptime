import Permission, { PermissionHelper } from "../Permission";

/*
 * Who may change what OneUptime AI is allowed to do on a Kubernetes cluster.
 *
 * Kept apart from KubernetesClusterAiAccess.ts, which the Runner binary
 * imports and which therefore stays free of the permission catalog.
 */

/*
 * Who may LOOSEN a cluster's AI access: switch remediation to an unattended
 * mode (Automatic or Bypass approval), author a kubectl allowlist, or bind
 * the Runner / Kubernetes credential kubectl runs through. A cluster's AI
 * mode does the job of a FullAuto AutoRemediationRule without a rule row, so
 * it takes the same set AutoRemediationRule uses for executionMode,
 * commandAllowlist and commandRunners.
 *
 * Tightening (Off or Ask for approval, clearing the allowlist or the
 * binding) stays open to anyone who may edit the cluster: making AI do less
 * never needs more privilege than the cluster itself.
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
 * Why deleting an in-cluster Runner is a two-step remedy. The binding's
 * foreign key is ON DELETE SET NULL, so a deleted Runner's clusters are
 * left with no Runner bound, and registration never binds a cluster that
 * had one (left_unbound_by_operator): the fresh Runner the agent registers
 * is used only once someone selects it on the cluster's AI page. Selecting
 * a Runner loosens AI access, so it needs one of these permissions — which
 * whoever deleted the Runner may not hold. Here, not in
 * KubernetesClusterAiAccessService, so RunnerService (which that service
 * imports) can name it too without an import cycle.
 */
export function getDeletedAgentRunnerRebindNote(): string {
  return `Deleting a Runner leaves the clusters it was bound to with no Runner bound, and a registering Runner never binds a cluster that had one. Selecting a Runner needs one of these permissions: ${PermissionHelper.getPermissionTitles(
    KUBERNETES_AI_ACCESS_ADMIN_PERMISSIONS,
  ).join(", ")}.`;
}
