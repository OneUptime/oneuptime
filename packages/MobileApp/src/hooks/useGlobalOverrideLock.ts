import { useSyncExternalStore } from "react";
import {
  getProjectPermissionRows,
  subscribeToProjectPermissions,
} from "../api/projectPermissions";
import { isMasterAdminToken } from "../auth/currentUser";
import {
  getGlobalOverrideAccess,
  getGlobalOverrideLockReason,
  type GlobalOverrideAccess,
  type ProjectPermissionRow,
} from "../oncall/globalOverrideAccess";
import { getCachedAccessToken } from "../storage/keychain";

/**
 * Whether the signed-in person may arrange cover for every policy in
 * `projectId` (oncall/globalOverrideAccess): allowed, limited to some
 * policies, not allowed at all - or unknown while the server has not said
 * yet. Follows the rows as each answer about the project brings them
 * (api/projectPermissions).
 */
export function useGlobalOverrideAccess(
  projectId: string | null,
): GlobalOverrideAccess {
  const rows: Array<ProjectPermissionRow> | null = useSyncExternalStore(
    subscribeToProjectPermissions,
    (): Array<ProjectPermissionRow> | null => {
      return getProjectPermissionRows(projectId);
    },
  );

  return getGlobalOverrideAccess({
    rows: rows,
    isMasterAdmin: isMasterAdminToken(getCachedAccessToken()),
  });
}

/**
 * Why the signed-in person cannot arrange cover for every policy in
 * `projectId` - their permission to add user overrides covers only some
 * policies, or none - or null when they can, and while the server has not
 * said yet (oncall/globalOverrideAccess).
 */
export function useGlobalOverrideLock(projectId: string | null): string | null {
  return getGlobalOverrideLockReason(useGlobalOverrideAccess(projectId));
}
