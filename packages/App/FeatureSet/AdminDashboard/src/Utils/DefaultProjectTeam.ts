import AdminModelAPI from "./ModelAPI";
import ObjectID from "Common/Types/ObjectID";
import Permission from "Common/Types/Permission";
import {
  CanGrantAllFunction,
  InviteTeam,
  findDefaultInviteTeam,
} from "Common/UI/Utils/DefaultInviteTeam";

/*
 * THE TEAM A MASTER ADMIN STARTS ON WHEN ADDING SOMEONE TO A PROJECT.
 *
 * Invite User (Projects > Users), Add to Project (a user's Projects page,
 * and the Users list's bulk action) and attaching a project to a global SSO
 * or OIDC provider all asked for a team with nothing picked. They start on
 * the project's members team now, found by the same rule as the Dashboard's
 * Invite User (Common/UI/Utils/DefaultInviteTeam).
 *
 * Two things differ from the Dashboard, on purpose:
 *
 *   - The lists are read through AdminModelAPI: a master admin works from
 *     outside every project, so the requests carry no project of their own.
 *   - Every team counts as one the admin may hand on. The server lets a
 *     master admin create a membership in any team - TeamMemberService
 *     .onBeforeCreate skips the grant ceiling (TeamPermissionService
 *     .assertCanGrantTeamPermissions) for isMasterAdmin, and that check
 *     answers yes to a master admin itself - so no team is ever skipped for
 *     that reason here. A global provider's attached teams are written by
 *     the server as root when someone signs in.
 */

// A master admin may hand on any team's permissions (see above).
export const masterAdminCanGrantAll: CanGrantAllFunction = (
  _permissions: Array<Permission>,
): boolean => {
  return true;
};

type FindProjectDefaultTeamFunction = (data: {
  projectId: ObjectID | null | undefined;
  timeoutInMs?: number | undefined;
}) => Promise<InviteTeam | null>;

/*
 * The project's members team, or null. Never throws, and never waits past
 * the lookup's timeout: the form shows either way, with nothing picked.
 */
export const findProjectDefaultTeam: FindProjectDefaultTeamFunction =
  async (data: {
    projectId: ObjectID | null | undefined;
    timeoutInMs?: number | undefined;
  }): Promise<InviteTeam | null> => {
    return await findDefaultInviteTeam({
      projectId: data.projectId,
      modelAPI: AdminModelAPI,
      canGrantAll: masterAdminCanGrantAll,
      timeoutInMs: data.timeoutInMs,
    });
  };
