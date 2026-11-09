import HeldPermissionsUtil, { HeldPermissions } from "../HeldPermissions";
import Permission, { UserPermission } from "../Permission";
import { ACTING_ON_EVERY_TEAM_OWNED_RULE } from "./TeamOwnedRuleKinds";

/*
 * WHAT A PERSON HOLDS ON ONE RULE THAT TEAMS OWN - the dashboard's statement
 * of the server's rule (Server/Types/Database/Permissions
 * /TeamOwnedRulePermission), for the locks on its Edit and Delete:
 *
 *   - a rule no team owns is the project's: everyone holds every permission
 *     of theirs on it;
 *   - so does a Project Owner or Project Admin over the whole project, on
 *     every rule;
 *   - anyone else holds only the permissions of the teams of theirs that
 *     own it. Another team's permission reaches none of the rule, and
 *     neither does a permission no team grants (the defaults every member
 *     holds).
 *
 * A block always applies, whichever team it is on.
 */
export default class TeamOwnedRuleHeld {
  // Whether `held` changes every rule of the project, whichever teams own it.
  public static actsOnEveryTeamOwnedRule(held: HeldPermissions): boolean {
    return HeldPermissionsUtil.holdsAnyOf(
      held,
      [...ACTING_ON_EVERY_TEAM_OWNED_RULE],
      {
        projectWideOnly: true,
      },
    );
  }

  /*
   * The rows that reach a rule some teams own, for a person who does not
   * act on every rule: their blocks, and the allow rows of the teams of
   * theirs that own it (UserPermission.teamId) - never the rows of their
   * other teams, nor rows no team grants.
   */
  public static getRowsOfOwningTeams(data: {
    rows: ReadonlyArray<UserPermission>;
    owningTeamIds: ReadonlyArray<string>;
  }): Array<UserPermission> {
    const owning: Set<string> = new Set<string>(
      data.owningTeamIds.map((teamId: string): string => {
        return teamId.toString().toLowerCase();
      }),
    );

    return data.rows.filter((row: UserPermission): boolean => {
      if (!row) {
        return false;
      }

      if (HeldPermissionsUtil.isBlockRow(row)) {
        return true;
      }

      const teamId: string | null = TeamOwnedRuleHeld.getId(row.teamId);

      return Boolean(teamId && owning.has(teamId.toLowerCase()));
    });
  }

  /*
   * An id as a snapshot carries it: an ObjectID, its string, or - read back
   * from storage without its type - the object it was written as.
   */
  public static getId(value: unknown): string | null {
    if (!value) {
      return null;
    }

    if (typeof value === "string") {
      return value;
    }

    const written: unknown = (value as { value?: unknown }).value;

    if (typeof written === "string") {
      return written;
    }

    const text: string = String(value);

    return text && text !== "[object Object]" ? text : null;
  }

  /*
   * What the person holds on the rule: null when it is everything they hold
   * - a rule no team owns, or a person who acts on every rule - and
   * otherwise what their blocks and the rows of their teams that own it
   * hold (getRowsOfOwningTeams).
   */
  public static getHeldOnRule(data: {
    rows: ReadonlyArray<UserPermission>;
    globalPermissions?: ReadonlyArray<Permission> | undefined;
    owningTeamIds: ReadonlyArray<string>;
  }): HeldPermissions | null {
    if (data.owningTeamIds.length === 0) {
      return null;
    }

    const held: HeldPermissions = HeldPermissionsUtil.fromRows({
      rows: data.rows,
      globalPermissions: data.globalPermissions,
    });

    if (TeamOwnedRuleHeld.actsOnEveryTeamOwnedRule(held)) {
      return null;
    }

    return HeldPermissionsUtil.fromRows({
      rows: TeamOwnedRuleHeld.getRowsOfOwningTeams({
        rows: data.rows,
        owningTeamIds: data.owningTeamIds,
      }),
      globalPermissions: data.globalPermissions,
    });
  }
}
