import HeldPermissionsUtil, {
  HeldPermissions,
} from "../../../Types/HeldPermissions";
import ObjectID from "../../../Types/ObjectID";
import Permission, { UserPermission } from "../../../Types/Permission";
import PermissionScope from "../../../Types/Database/AccessControl/PermissionScope";

/*
 * WHO HOLDS A PERMISSION in a project, read from the teams' rows: the
 * people-side twin of CallerPermission, which asks whether the caller of a
 * request holds one.
 *
 * A member's permissions in a project are the rows of the teams they belong
 * to - the teams they accepted an invitation to, as AccessTokenService builds
 * the rows their requests carry. So the people who hold a permission are the
 * ones whose own rows pass the rule every check follows (Types
 * /HeldPermissions): an allow row grants it, a team's block row never does,
 * and a block with no labels takes it away from everyone on that team,
 * whatever their other teams allow. A block with labels limits only the
 * records carrying them, so it takes nothing away here: this looks at no
 * record.
 *
 * ProjectService.getOwners asks it who holds Project Owner - the people the
 * owner emails go to - so a member blocked from being an owner is not told
 * as one.
 */

// One team's row for the permission: an allow or a block.
export interface TeamPermissionRow {
  teamId: ObjectID | string;
  permission: Permission;
  isBlockPermission?: boolean | undefined;
  labelIds?: Array<ObjectID | string> | undefined;
  scope?: PermissionScope | undefined;
}

// One accepted membership: who is on which team.
export interface TeamMembershipRow {
  teamId: ObjectID | string;
  userId: ObjectID | string;
}

export default class TeamPermissionHolders {
  /*
   * The ids of the people who hold `permission`, given every team row of the
   * project for it (allows and blocks) and the accepted memberships of those
   * teams. Each id once, in the order the memberships name them.
   */
  public static getHolderIds(data: {
    permission: Permission;
    rows: ReadonlyArray<TeamPermissionRow>;
    memberships: ReadonlyArray<TeamMembershipRow>;
  }): Array<string> {
    const rowsByTeam: Map<string, Array<UserPermission>> = new Map<
      string,
      Array<UserPermission>
    >();

    for (const row of data.rows) {
      if (row.permission !== data.permission) {
        continue;
      }

      const teamId: string = row.teamId.toString();
      const rows: Array<UserPermission> = rowsByTeam.get(teamId) || [];

      rows.push({
        _type: "UserPermission",
        permission: row.permission,
        labelIds: (row.labelIds || []).map(
          (labelId: ObjectID | string): ObjectID => {
            return new ObjectID(labelId.toString());
          },
        ),
        isBlockPermission: row.isBlockPermission === true,
        ...(row.scope ? { scope: row.scope } : {}),
      });

      rowsByTeam.set(teamId, rows);
    }

    // Each person's teams, in the order their memberships come.
    const teamsByUser: Map<string, Set<string>> = new Map<
      string,
      Set<string>
    >();

    for (const membership of data.memberships) {
      const userId: string = membership.userId.toString();
      const teams: Set<string> = teamsByUser.get(userId) || new Set<string>();

      teams.add(membership.teamId.toString());
      teamsByUser.set(userId, teams);
    }

    const holders: Array<string> = [];

    for (const [userId, teams] of teamsByUser) {
      const rows: Array<UserPermission> = [];

      for (const teamId of teams) {
        rows.push(...(rowsByTeam.get(teamId) || []));
      }

      const held: HeldPermissions = HeldPermissionsUtil.fromRows({ rows });

      if (HeldPermissionsUtil.holdsAnyOf(held, [data.permission])) {
        holders.push(userId);
      }
    }

    return holders;
  }
}
