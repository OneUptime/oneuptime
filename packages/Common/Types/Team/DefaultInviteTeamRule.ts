import PermissionScope from "../Database/AccessControl/PermissionScope";
import Permission from "../Permission";

/*
 * WHICH TEAM SOMEONE IS ADDED TO A PROJECT ON, TO START WITH.
 *
 * The rule, React-free and server-safe, so every place that adds people to
 * a project picks the same team: the dashboards' Invite User and provider
 * forms (Common/UI/Utils/DefaultInviteTeam, which reads the lists and asks
 * this) and an import from another tool, which invites the tool's people
 * (Server/Utils/ToolImport). Why the members team, and why only one the
 * person may hand on, is told there.
 */

export const MEMBERS_TEAM_NAME: string = "Members";

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

// Whether the person adding someone may hand on all of these permissions.
export type CanGrantAllFunction = (permissions: Array<Permission>) => boolean;

type IsMembersNameFunction = (name: string) => boolean;

const isMembersName: IsMembersNameFunction = (name: string): boolean => {
  return name.trim().toLowerCase() === MEMBERS_TEAM_NAME.toLowerCase();
};

type PickDefaultInviteTeamFunction = (data: {
  // Every team in the project, oldest first.
  teams: Array<InviteTeam>;
  // Every permission row of those teams, allows and blocks.
  permissionRows: Array<InviteTeamPermissionRow>;
  // Whether the person adding someone may hand on all of these permissions.
  canGrantAll: CanGrantAllFunction;
}) => InviteTeam | null;

export const pickDefaultInviteTeam: PickDefaultInviteTeamFunction = (data: {
  teams: Array<InviteTeam>;
  permissionRows: Array<InviteTeamPermissionRow>;
  canGrantAll: CanGrantAllFunction;
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
