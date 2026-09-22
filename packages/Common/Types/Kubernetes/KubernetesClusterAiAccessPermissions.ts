import Permission from "../Permission";

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
