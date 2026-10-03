import Permission, {
  UserPermission,
  UserTenantAccessPermission,
} from "Common/Types/Permission";
import RunnerJob from "Common/Models/DatabaseModels/RunnerJob";
import PermissionUtil from "Common/UI/Utils/Permission";
import PermissionGate, {
  ModelAction,
  PermissionGateResult,
} from "Common/UI/Utils/PermissionGate";
import User from "Common/UI/Utils/User";
import { ResourceAiAgentDescriptor } from "./ResourceAiAgentDescriptors";
import { RESOURCE_AI_ACCESS_ADMIN_PERMISSIONS } from "./ResourceAiAccessSettingsUtil";
import {
  translatableTerm,
  translateTemplate,
} from "Common/UI/Utils/TranslateTemplate";

/*
 * What the signed-in user may do on a resource's AI pages, read from the
 * permission snapshot the way the server reads it. Browser-side (it reads
 * the snapshot through the UI utils); the pure rules live in
 * ResourceAiAccessSettingsUtil.ts.
 */

/*
 * Whether the signed-in user holds one of `allowed` in this project, read
 * the way the server reads it: from the project's permission rows only,
 * and a BLOCK row is a denial rather than a grant. A master admin holds
 * everything.
 */
export function holdsProjectPermission(
  allowed: ReadonlyArray<Permission>,
): boolean {
  if (User.isMasterAdmin()) {
    return true;
  }

  const tenantPermission: UserTenantAccessPermission | null =
    PermissionUtil.getProjectPermissions();

  return Boolean(
    tenantPermission?.permissions?.some((row: UserPermission): boolean => {
      return !row.isBlockPermission && allowed.includes(row.permission);
    }),
  );
}

/*
 * Whether the signed-in user may LOOSEN what AI may do on the resource:
 * turn fixes on or up, or add an allowlist entry. The server refuses the
 * write without RESOURCE_AI_ACCESS_ADMIN_PERMISSIONS; tightening stays open
 * to every editor of the resource.
 */
export function canConfigureUnattendedResourceAiAccess(): boolean {
  return holdsProjectPermission(RESOURCE_AI_ACCESS_ADMIN_PERMISSIONS);
}

/*
 * Resetting the agent revokes its key; the agent registers again on its
 * own. The server gates the route on the admin set.
 */
export function canResetResourceAiAgent(): boolean {
  return canConfigureUnattendedResourceAiAccess();
}

/*
 * The project-level AI switches (AI Features, LLM providers, AI credits)
 * are changed by project owners and admins. Everyone else is told who to
 * ask instead of being sent to a page that refuses them.
 */
export const RESOURCE_PROJECT_AI_SETTINGS_PERMISSIONS: ReadonlyArray<Permission> =
  [Permission.ProjectOwner, Permission.ProjectAdmin];

export function canChangeProjectAiSettingsForResource(): boolean {
  return holdsProjectPermission(RESOURCE_PROJECT_AI_SETTINGS_PERMISSIONS);
}

/*
 * The command history is RunnerJob rows. Roles that may open a resource's
 * AI pages may not read them (RunnerJob's runbook rows carry scripts and
 * their output), so such users get an explanation instead of a table that
 * can only fail.
 */
export function canReadResourceCommandJobs(): boolean {
  return PermissionGate.check(new RunnerJob(), ModelAction.Read).isAllowed;
}

export function getResourceCommandJobsPermissionTitles(): Array<string> {
  return PermissionGate.getPermissionTitles(
    new RunnerJob().getReadPermissions(),
  );
}

// The resource's own edit gate: the settings' Change button and one-click fixes.
export function getResourceSettingsGate(
  descriptor: ResourceAiAgentDescriptor,
): PermissionGateResult {
  return PermissionGate.check(new descriptor.modelType(), ModelAction.Update);
}

/*
 * The connection test spends the agent's time, so its endpoint requires
 * edit access to the resource (the same gate as the Kubernetes cluster's).
 */
export function getResourceAccessTestPermissionGate(
  descriptor: ResourceAiAgentDescriptor,
): PermissionGateResult {
  return getResourceSettingsGate(descriptor);
}

// Why the test is locked, for the disabled button's tooltip and note.
export function getResourceAccessTestPermissionRequirement(
  descriptor: ResourceAiAgentDescriptor,
): string {
  return translateTemplate(
    "Testing the connection needs permission to edit this {{noun}} (one of: {{permissions}}).",
    {
      noun: translatableTerm(descriptor.noun, { inSentence: true }),
      permissions: PermissionGate.getPermissionTitles(
        new descriptor.modelType().getUpdatePermissions(),
      ).join(", "),
    },
  );
}

/*
 * What a refused test says. The server's sentence for this route may talk
 * about CHANGING the resource's AI access, which the user did not try.
 */
export function getResourceAccessTestPermissionMessage(
  descriptor: ResourceAiAgentDescriptor,
): string {
  return translateTemplate(
    "{{requirement}} Nothing on the {{noun}} or in its AI settings was changed.",
    {
      requirement: getResourceAccessTestPermissionRequirement(descriptor),
      noun: translatableTerm(descriptor.noun, { inSentence: true }),
    },
  );
}
