import { useSyncExternalStore } from "react";
import {
  getProjectPermissionRows,
  subscribeToProjectPermissions,
} from "../api/projectPermissions";
import { isMasterAdminToken } from "../auth/currentUser";
import type { ProjectPermissionRow } from "../oncall/globalOverrideAccess";
import {
  getOverrideTeamLimit,
  type OverrideTeamAction,
  type OverrideTeamLimit,
} from "../oncall/overrideTeamAccess";
import { getCachedAccessToken } from "../storage/keychain";

// The teams an override of `action`, global or on a policy, is kept to.
export type OverrideTeamLimitOf = (
  action: OverrideTeamAction,
  isGlobal: boolean,
) => OverrideTeamLimit | null;

/**
 * For someone who manages the user overrides of their own teams' people
 * only (oncall/overrideTeamAccess): the teams an override they add, edit
 * or delete in `projectId` is kept to - or null for anyone it does not
 * narrow, and while the server has not said yet. Follows the rows as each
 * answer about the project brings them (api/projectPermissions).
 */
export function useOverrideTeamLimits(
  projectId: string | null,
): OverrideTeamLimitOf {
  const rows: Array<ProjectPermissionRow> | null = useSyncExternalStore(
    subscribeToProjectPermissions,
    (): Array<ProjectPermissionRow> | null => {
      return getProjectPermissionRows(projectId);
    },
  );

  const isMasterAdmin: boolean = isMasterAdminToken(getCachedAccessToken());

  return (
    action: OverrideTeamAction,
    isGlobal: boolean,
  ): OverrideTeamLimit | null => {
    return getOverrideTeamLimit({
      rows: rows,
      isMasterAdmin: isMasterAdmin,
      action: action,
      isGlobal: isGlobal,
    });
  };
}
