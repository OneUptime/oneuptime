import AccessTokenService from "../../../Server/Services/AccessTokenService";
import ProjectService from "../../../Server/Services/ProjectService";
import ObjectID from "../../../Types/ObjectID";
import {
  UserGlobalAccessPermission,
  UserTenantAccessPermission,
} from "../../../Types/Permission";
import { getJestSpyOn } from "../../Spy";

/*
 * A request across the caller's projects, answered project by project
 * through the lookups a suite stubs.
 *
 * Such a request (UserMiddleware.getUserTenantAccessPermissionForMultiTenant)
 * reads every project's row first, in one statement
 * (ProjectService.loadAccessRules), asks each project's questions of the
 * per-project getters - isProjectBlocked, getRequireSsoForLogin,
 * getRequireSsoWithSsoProviderId - and reads the permission sets of the
 * projects the caller may open at once
 * (AccessTokenService.getUserTenantAccessPermissions). A suite that stubs
 * the getters and getUserTenantAccessPermission, as each project was once
 * asked on its own, calls this in its set-up:
 *
 *   - the read of the rows does nothing: the stubbed getters answer;
 *   - the batch read of the sets answers each project as the suite's
 *     getUserTenantAccessPermission answers it - so what the suite asserts
 *     of that lookup (which projects' sets were read, with which global
 *     permission) still holds.
 *
 * The real batch reads are pinned by ProjectAccessRulesRead,
 * AccessTokenSignInReads and SignInStatementsPostgres; the middleware's
 * use of them by MultiTenantProjectLookups.
 */
export function answerMultiTenantReadsProjectByProject(): void {
  getJestSpyOn(ProjectService, "loadAccessRules").mockResolvedValue(undefined);

  getJestSpyOn(
    AccessTokenService,
    "getUserTenantAccessPermissions",
  ).mockImplementation(
    async (
      userId: ObjectID,
      projectIds: Array<ObjectID>,
      options?: {
        userGlobalAccessPermission?:
          | UserGlobalAccessPermission
          | null
          | Promise<UserGlobalAccessPermission | null>
          | undefined;
      },
    ): Promise<Map<string, UserTenantAccessPermission | null>> => {
      const sets: Map<string, UserTenantAccessPermission | null> = new Map();

      for (const projectId of projectIds) {
        sets.set(
          projectId.toString().toLowerCase(),
          (await AccessTokenService.getUserTenantAccessPermission(
            userId,
            projectId,
            {
              userGlobalAccessPermission: options?.userGlobalAccessPermission,
            },
          )) || null,
        );
      }

      return sets;
    },
  );
}
