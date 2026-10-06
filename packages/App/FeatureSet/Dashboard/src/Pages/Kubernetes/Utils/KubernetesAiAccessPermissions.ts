import Permission from "Common/Types/Permission";
import {
  KUBERNETES_AI_ACCESS_ADMIN_PERMISSIONS,
  KUBERNETES_AI_ACCESS_CREDENTIAL_PERMISSIONS,
} from "Common/Types/Kubernetes/KubernetesClusterAiAccessPermissions";
import KubernetesCluster from "Common/Models/DatabaseModels/KubernetesCluster";
import RunbookCredential from "Common/Models/DatabaseModels/RunbookCredential";
import Runner from "Common/Models/DatabaseModels/Runner";
import RunnerJob from "Common/Models/DatabaseModels/RunnerJob";
import PermissionGate, {
  ModelAction,
  PermissionGateOptions,
  PermissionGateResult,
} from "Common/UI/Utils/PermissionGate";

/*
 * What the signed-in user may do on a cluster's AI pages, read from the
 * permission snapshot the way the server reads it. Browser-side (it reads
 * the snapshot through the UI utils); the pure rules live in
 * KubernetesAiAccessSettings.ts.
 */

/*
 * Whether the signed-in user holds one of `allowed` in this project, read
 * the way the server reads it (PermissionGate.holdsAnyOf): a BLOCK row is a
 * denial rather than a grant, and a block with no labels on any of them
 * takes them away. A master admin holds everything.
 */
export function holdsKubernetesAiAccessPermission(
  allowed: Array<Permission>,
  options?: PermissionGateOptions | undefined,
): boolean {
  return PermissionGate.holdsAnyOf(allowed, options);
}

/*
 * Whether the signed-in user may LOOSEN what AI may do on the cluster:
 * turn fixes on or up, add a kubectl allowlist pattern, bind a Runner or
 * credential, or move an advanced binding over to the cluster's AI agent.
 * A cluster's fixes mode does the job of an auto-remediation rule, so it
 * takes the same permissions (KUBERNETES_AI_ACCESS_ADMIN_PERMISSIONS) and
 * the server refuses the write without them. Tightening stays open to
 * every cluster editor (getKubernetesAiAccessLooseningChanges).
 */
export function canConfigureUnattendedKubernetesAiAccess(): boolean {
  return holdsKubernetesAiAccessPermission(
    KUBERNETES_AI_ACCESS_ADMIN_PERMISSIONS,
  );
}

/*
 * Resetting the agent revokes its key; the pod registers again on its own.
 * The server gates the route on the admin set, and counts a block on any of
 * them as a refusal, labelled or not.
 */
export function canResetKubernetesAiAgent(): boolean {
  return holdsKubernetesAiAccessPermission(
    KUBERNETES_AI_ACCESS_ADMIN_PERMISSIONS,
    { labelledBlocksRefuse: true },
  );
}

/*
 * The project-level AI switches (AI Features, LLM providers, AI credits,
 * automatic investigation) are changed by project owners and admins —
 * Project.enableAutomaticIncidentInvestigation's update ACL. Everyone else
 * is told who to ask instead of being sent to a page that refuses them.
 */
export const PROJECT_AI_SETTINGS_PERMISSIONS: Array<Permission> = [
  Permission.ProjectOwner,
  Permission.ProjectAdmin,
];

export function canChangeProjectAiSettings(): boolean {
  return holdsKubernetesAiAccessPermission(PROJECT_AI_SETTINGS_PERMISSIONS);
}

/*
 * Whether the signed-in user may pick a Kubernetes credential for an
 * advanced Runner. The picker lists RunbookCredential rows, which carry
 * cluster tokens and are deliberately not readable by every member.
 */
export function canPickKubernetesCredential(): boolean {
  return PermissionGate.check(new RunbookCredential(), ModelAction.Read)
    .isAllowed;
}

export function getKubernetesCredentialPermissionTitles(): Array<string> {
  return PermissionGate.getPermissionTitles(
    new RunbookCredential().getReadPermissions(),
  );
}

/*
 * The Runner picker's sibling of canPickKubernetesCredential. The Runner
 * read ACL is not widened: it exposes every Runner's capabilities and
 * liveness.
 */
export function canPickKubernetesRunner(): boolean {
  return PermissionGate.check(new Runner(), ModelAction.Read).isAllowed;
}

export function getKubernetesRunnerPermissionTitles(): Array<string> {
  return PermissionGate.getPermissionTitles(new Runner().getReadPermissions());
}

/*
 * The kubectl command history is RunnerJob rows. Roles that may open the
 * cluster's AI pages — Settings*, ReadKubernetesCluster,
 * EditKubernetesCluster — may not read them, and RunnerJob stays that way:
 * its runbook rows carry scripts and their output. Such users get an
 * explanation instead of a table that can only fail.
 */
export function canReadKubectlJobs(): boolean {
  return PermissionGate.check(new RunnerJob(), ModelAction.Read).isAllowed;
}

export function getKubectlJobsPermissionTitles(): Array<string> {
  return PermissionGate.getPermissionTitles(
    new RunnerJob().getReadPermissions(),
  );
}

/*
 * The connection test spends the agent's time, so its endpoint requires
 * edit access to the cluster (KubernetesClusterAiAccessAPI:
 * assertCanEditCluster, which mirrors KubernetesCluster's update ACL).
 */
export function getAccessTestPermissionGate(): PermissionGateResult {
  return PermissionGate.check(new KubernetesCluster(), ModelAction.Update);
}

// Why the test is locked, for the disabled button's tooltip and note.
export function getAccessTestPermissionRequirement(): string {
  return `Testing the connection needs permission to edit this cluster (one of: ${PermissionGate.getPermissionTitles(
    new KubernetesCluster().getUpdatePermissions(),
  ).join(", ")}).`;
}

/*
 * What a refused test says. The server's sentence for this route talks
 * about CHANGING the cluster's AI access, which the user did not try.
 */
export function getAccessTestPermissionMessage(): string {
  return `${getAccessTestPermissionRequirement()} Nothing on the cluster or in its AI settings was changed.`;
}

/*
 * What the Change modal offers the signed-in user. Computed once when the
 * modal opens: the permission snapshot has long landed by then.
 */
export interface KubernetesAiAccessEditCapabilities {
  // Loosening. Without it the modal still offers every tightening.
  canConfigureUnattended: boolean;
  // The Runner picker (advanced bindings only): loosening AND able to list Runners.
  canPickRunner: boolean;
  // The credential picker: loosening AND able to read (and bind) credentials.
  canPickCredential: boolean;
}

export function getKubernetesAiAccessEditCapabilities(): KubernetesAiAccessEditCapabilities {
  const canConfigureUnattended: boolean =
    canConfigureUnattendedKubernetesAiAccess();

  return {
    canConfigureUnattended,
    canPickRunner: canConfigureUnattended && canPickKubernetesRunner(),
    canPickCredential:
      canConfigureUnattended &&
      canPickKubernetesCredential() &&
      holdsKubernetesAiAccessPermission(
        KUBERNETES_AI_ACCESS_CREDENTIAL_PERMISSIONS,
      ),
  };
}
