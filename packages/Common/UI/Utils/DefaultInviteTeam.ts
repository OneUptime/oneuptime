import Team from "../../Models/DatabaseModels/Team";
import TeamPermission from "../../Models/DatabaseModels/TeamPermission";
import SortOrder from "../../Types/BaseDatabase/SortOrder";
import { LIMIT_PER_PROJECT } from "../../Types/Database/LimitMax";
import ObjectID from "../../Types/ObjectID";
import Permission from "../../Types/Permission";
import {
  CanGrantAllFunction,
  InviteTeam,
  InviteTeamPermissionRow,
  pickDefaultInviteTeam,
} from "../../Types/Team/DefaultInviteTeamRule";
import GrantablePermission from "./GrantablePermission";
import ModelAPI, { ListResult } from "./ModelAPI/ModelAPI";

/*
 * ADDING SOMEONE TO A PROJECT STARTS ON THE OBVIOUS TEAM.
 *
 * Invite User asked for a team with nothing picked, so every invitation
 * started with a permissions decision between Owners, Admin and Members.
 * Most people invite a teammate to do the everyday work, which is what the
 * project's members team is for, so that team is picked to start with. The
 * picker shows it and it can be changed like any other value.
 *
 * The same rule picks the team wherever someone is added to a project: the
 * Dashboard's Invite User and its SSO and SCIM provider forms, and the Admin
 * Dashboard's Invite User, Add to Project (one user, or many from the Users
 * list) and the projects attached to a global SSO or OIDC provider.
 *
 * Which team that is:
 *
 *   1. A team holding the ProjectMember role for the whole project (scope
 *      All), and blocking nothing of it - a renamed Members team still
 *      counts. When several do, the one called "Members" first, then the
 *      oldest: the one a project starts with.
 *   2. With none, the team called "Members", whatever it holds.
 *   3. Otherwise nothing: the person picks, as before.
 *
 * Only a team the person may hand on is picked. Adding someone to a team
 * hands them the team's permissions, and the server allows that only when
 * the person doing it could grant every one of them (TeamPermissionService
 * .assertCanGrantTeamPermissions) - a Project Admin who is not in Members
 * cannot invite anyone to it. A default that is refused on submit would be
 * worse than none, so such a team is skipped. Who may hand on what is the
 * caller's to say (canGrantAll): by default the signed-in user's own
 * permissions, which GrantablePermission mirrors from the server. The Admin
 * Dashboard says so explicitly for a master admin, whom the server lets hand
 * on any team.
 *
 * Nothing about the membership itself changes: the team is a value the form
 * sends as it always did, and a lookup that fails - no permission to read
 * teams, a slow server - only means nothing is picked.
 */


/*
 * Long enough for the two small lists below on a slow connection, short
 * enough that a form never feels stuck: past it the form opens with nothing
 * picked.
 */
export const DEFAULT_INVITE_TEAM_LOOKUP_TIMEOUT_MS: number = 3000;

/*
 * The rule itself is React-free in Common/Types/Team/DefaultInviteTeamRule,
 * where the server reads it too (an import from another tool invites people
 * on the same team). It is re-exported here, where the dashboards import it.
 */
export {
  MEMBERS_TEAM_NAME,
  pickDefaultInviteTeam,
} from "../../Types/Team/DefaultInviteTeamRule";
export type {
  CanGrantAllFunction,
  InviteTeam,
  InviteTeamPermissionRow,
} from "../../Types/Team/DefaultInviteTeamRule";

/*
 * The signed-in user's own permissions, as the server reads them for a
 * request in the current project (GrantablePermission).
 */
export const canSignedInUserGrantAll: CanGrantAllFunction = (
  permissions: Array<Permission>,
): boolean => {
  return GrantablePermission.canCurrentUserGrantAll(permissions);
};

type FetchDefaultInviteTeamFunction = (data: {
  projectId: ObjectID;
  modelAPI?: typeof ModelAPI | undefined;
  // Defaults to the signed-in user's own permissions.
  canGrantAll?: CanGrantAllFunction | undefined;
}) => Promise<InviteTeam | null>;

/*
 * The project's teams and their permission rows, both small lists, read in
 * parallel. Throws when either cannot be read.
 */
export const fetchDefaultInviteTeam: FetchDefaultInviteTeamFunction =
  async (data: {
    projectId: ObjectID;
    modelAPI?: typeof ModelAPI | undefined;
    canGrantAll?: CanGrantAllFunction | undefined;
  }): Promise<InviteTeam | null> => {
    const modelAPI: typeof ModelAPI = data.modelAPI || ModelAPI;

    const [teams, permissions]: [ListResult<Team>, ListResult<TeamPermission>] =
      await Promise.all([
        modelAPI.getList<Team>({
          modelType: Team,
          query: {
            projectId: data.projectId,
          },
          limit: LIMIT_PER_PROJECT,
          skip: 0,
          select: {
            _id: true,
            name: true,
            createdAt: true,
          },
          sort: {
            createdAt: SortOrder.Ascending,
          },
        }),
        modelAPI.getList<TeamPermission>({
          modelType: TeamPermission,
          query: {
            projectId: data.projectId,
          },
          limit: LIMIT_PER_PROJECT,
          skip: 0,
          select: {
            _id: true,
            teamId: true,
            permission: true,
            isBlockPermission: true,
            scope: true,
          },
          sort: {},
        }),
      ]);

    return pickDefaultInviteTeam({
      teams: teams.data
        .filter((team: Team): boolean => {
          return Boolean(team.id);
        })
        .map((team: Team): InviteTeam => {
          return {
            id: team.id!.toString(),
            name: team.name?.toString() || "",
          };
        }),
      permissionRows: permissions.data
        .filter((row: TeamPermission): boolean => {
          return Boolean(row.teamId && row.permission);
        })
        .map((row: TeamPermission): InviteTeamPermissionRow => {
          return {
            teamId: row.teamId!.toString(),
            permission: row.permission as Permission,
            isBlockPermission: Boolean(row.isBlockPermission),
            scope: row.scope,
          };
        }),
      canGrantAll: data.canGrantAll || canSignedInUserGrantAll,
    });
  };

type FindDefaultInviteTeamFunction = (data: {
  projectId: ObjectID | null | undefined;
  modelAPI?: typeof ModelAPI | undefined;
  timeoutInMs?: number | undefined;
  // Defaults to the signed-in user's own permissions.
  canGrantAll?: CanGrantAllFunction | undefined;
}) => Promise<InviteTeam | null>;

/*
 * The team a form starts on, or null. Never throws and never takes longer
 * than the timeout: the form opens either way.
 */
export const findDefaultInviteTeam: FindDefaultInviteTeamFunction =
  async (data: {
    projectId: ObjectID | null | undefined;
    modelAPI?: typeof ModelAPI | undefined;
    timeoutInMs?: number | undefined;
    canGrantAll?: CanGrantAllFunction | undefined;
  }): Promise<InviteTeam | null> => {
    if (!data.projectId) {
      return null;
    }

    const timer: { id?: ReturnType<typeof setTimeout> | undefined } = {};

    const timeout: Promise<null> = new Promise<null>(
      (resolve: (value: null) => void) => {
        timer.id = setTimeout(() => {
          resolve(null);
        }, data.timeoutInMs ?? DEFAULT_INVITE_TEAM_LOOKUP_TIMEOUT_MS);
      },
    );

    const lookup: Promise<InviteTeam | null> = fetchDefaultInviteTeam({
      projectId: data.projectId,
      modelAPI: data.modelAPI,
      canGrantAll: data.canGrantAll,
    }).catch((): null => {
      return null;
    });

    try {
      return await Promise.race([lookup, timeout]);
    } finally {
      if (timer.id !== undefined) {
        clearTimeout(timer.id);
      }
    }
  };
