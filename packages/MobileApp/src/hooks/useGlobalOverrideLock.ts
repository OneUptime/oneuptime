import { useSyncExternalStore } from "react";
import {
  getProjectPermissionRows,
  subscribeToProjectPermissions,
} from "../api/projectPermissions";
import { isMasterAdminToken } from "../auth/currentUser";
import {
  getGlobalOverrideAccess,
  getGlobalOverrideLockReason,
  type ProjectPermissionRow,
} from "../oncall/globalOverrideAccess";
import { getCachedAccessToken } from "../storage/keychain";

/**
 * Why the signed-in person cannot arrange cover for every policy in
 * `projectId` - their permission to add user overrides covers only some
 * policies, or none - or null when they can, and while the server has not
 * said yet (oncall/globalOverrideAccess). Follows the rows as each answer
 * about the project brings them (api/projectPermissions).
 */
export function useGlobalOverrideLock(projectId: string | null): string | null {
  const rows: Array<ProjectPermissionRow> | null = useSyncExternalStore(
    subscribeToProjectPermissions,
    (): Array<ProjectPermissionRow> | null => {
      return getProjectPermissionRows(projectId);
    },
  );

  return getGlobalOverrideLockReason(
    getGlobalOverrideAccess({
      rows: rows,
      isMasterAdmin: isMasterAdminToken(getCachedAccessToken()),
    }),
  );
}
