import Team from "Common/Models/DatabaseModels/Team";
import TeamPermission from "Common/Models/DatabaseModels/TeamPermission";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import PermissionScope from "Common/Types/Database/AccessControl/PermissionScope";
import { LIMIT_PER_PROJECT } from "Common/Types/Database/LimitMax";
import ObjectID from "Common/Types/ObjectID";
import Permission from "Common/Types/Permission";
import GrantablePermission from "Common/UI/Utils/GrantablePermission";
import ModelAPI, { ListResult } from "Common/UI/Utils/ModelAPI/ModelAPI";

/*
 * INVITING A TEAMMATE STARTS ON THE OBVIOUS TEAM.
 *
 * Invite User asked for a team with nothing picked, so every invitation
 * started with a permissions decision between Owners, Admin and Members.
 * Most people invite a teammate to do the everyday work, which is what the
 * project's members team is for, so that team is picked to start with. The
 * picker shows it and it can be changed like any other value.
 *
 * Which team that is:
 *
 *   1. A team holding the ProjectMember role for the whole project (scope
 *      All), and blocking nothing of it - a renamed Members team still
 *      counts. When several do, the one called "Members" first, then the
 *      oldest: the one a project starts with.
 *   2. With none, the team called "Members", whatever it holds.
 *   3. Otherwise nothing: the inviter picks, as before.
 *
 * Only a team the inviter may invite to is picked. Inviting someone hands
 * them the team's permissions, and the server allows that only when the
 * inviter could grant every one of them (TeamPermissionService
 * .assertCanGrantTeamPermissions) - a Project Admin who is not in Members
 * cannot invite anyone to it. A default that is refused on submit would be
 * worse than none, so such a team is skipped (GrantablePermission mirrors
 * the server's rule).
 *
 * Nothing about the invitation itself changes: the team is a value the form
 * sends as it always did, and a lookup that fails - no permission to read
 * teams, a slow server - only means nothing is picked.
 */

export const MEMBERS_TEAM_NAME: string = "Members";

/*
 * Long enough for the two small lists below on a slow connection, short
 * enough that Invite User never feels stuck: past it the dialog opens with
 * nothing picked.
 */
export const DEFAULT_INVITE_TEAM_LOOKUP_TIMEOUT_MS: number = 3000;

export interface InviteTeam {
  id: string;
  name: string;
}

export interface InviteTeamPermissionRow {
  teamId: string;
  permission: Permission;
  isBlockPermission: boolean;
  scope?: PermissionScope | undefined;
}

type IsMembersNameFunction = (name: string) => boolean;

const isMembersName: IsMembersNameFunction = (name: string): boolean => {
  return name.trim().toLowerCase() === MEMBERS_TEAM_NAME.toLowerCase();
};

type PickDefaultInviteTeamFunction = (data: {
  // Every team in the project, oldest first.
  teams: Array<InviteTeam>;
  // Every permission row of those teams, allows and blocks.
  permissionRows: Array<InviteTeamPermissionRow>;
  // Whether the inviter may hand on all of these permissions.
  canGrantAll: (permissions: Array<Permission>) => boolean;
}) => InviteTeam | null;

export const pickDefaultInviteTeam: PickDefaultInviteTeamFunction = (data: {
  teams: Array<InviteTeam>;
  permissionRows: Array<InviteTeamPermissionRow>;
  canGrantAll: (permissions: Array<Permission>) => boolean;
}): InviteTeam | null => {
  const rowsOf: (teamId: string) => Array<InviteTeamPermissionRow> = (
    teamId: string,
  ): Array<InviteTeamPermissionRow> => {
    return data.permissionRows.filter(
      (row: InviteTeamPermissionRow): boolean => {
        return row.teamId === teamId;
      },
    );
  };

  /*
   * ProjectMember for the whole project. A label or Owned scope makes the
   * team a narrower one, made on purpose for some people, and a block on
   * ProjectMember undoes it.
   */
  const isMembersTeam: (team: InviteTeam) => boolean = (
    team: InviteTeam,
  ): boolean => {
    const rows: Array<InviteTeamPermissionRow> = rowsOf(team.id);

    const holdsProjectMember: boolean = rows.some(
      (row: InviteTeamPermissionRow): boolean => {
        return (
          !row.isBlockPermission &&
          row.permission === Permission.ProjectMember &&
          row.scope === PermissionScope.All
        );
      },
    );

    const blocksProjectMember: boolean = rows.some(
      (row: InviteTeamPermissionRow): boolean => {
        return (
          row.isBlockPermission && row.permission === Permission.ProjectMember
        );
      },
    );

    return holdsProjectMember && !blocksProjectMember;
  };

  const membersTeams: Array<InviteTeam> = data.teams.filter(isMembersTeam);

  let candidates: Array<InviteTeam> = [
    ...membersTeams.filter((team: InviteTeam): boolean => {
      return isMembersName(team.name);
    }),
    ...membersTeams.filter((team: InviteTeam): boolean => {
      return !isMembersName(team.name);
    }),
  ];

  if (candidates.length === 0) {
    candidates = data.teams.filter((team: InviteTeam): boolean => {
      return isMembersName(team.name);
    });
  }

  // Every row the team has, allow or block, is handed on with it.
  const canInviteTo: (team: InviteTeam) => boolean = (
    team: InviteTeam,
  ): boolean => {
    return data.canGrantAll(
      rowsOf(team.id).map((row: InviteTeamPermissionRow): Permission => {
        return row.permission;
      }),
    );
  };

  return candidates.find(canInviteTo) || null;
};

type FetchDefaultInviteTeamFunction = (data: {
  projectId: ObjectID;
  modelAPI?: typeof ModelAPI | undefined;
}) => Promise<InviteTeam | null>;

/*
 * The project's teams and their permission rows, both small lists, read in
 * parallel. Throws when either cannot be read.
 */
export const fetchDefaultInviteTeam: FetchDefaultInviteTeamFunction =
  async (data: {
    projectId: ObjectID;
    modelAPI?: typeof ModelAPI | undefined;
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
      canGrantAll: (permissions: Array<Permission>): boolean => {
        return GrantablePermission.canCurrentUserGrantAll(permissions);
      },
    });
  };

type FindDefaultInviteTeamFunction = (data: {
  projectId: ObjectID | null | undefined;
  modelAPI?: typeof ModelAPI | undefined;
  timeoutInMs?: number | undefined;
}) => Promise<InviteTeam | null>;

/*
 * The team Invite User starts on, or null. Never throws and never takes
 * longer than the timeout: the dialog opens either way.
 */
export const findDefaultInviteTeam: FindDefaultInviteTeamFunction =
  async (data: {
    projectId: ObjectID | null | undefined;
    modelAPI?: typeof ModelAPI | undefined;
    timeoutInMs?: number | undefined;
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
