import HeldPermissionsUtil, { HeldPermissions } from "../HeldPermissions";
import Permission, { UserPermission } from "../Permission";

/*
 * WHAT A PERSON HOLDS ON ONE PRIVATE RECORD - the dashboard's statement of
 * the server's rule (Server/Types/Database/Permissions
 * /PrivateRecordPermission), for its locks:
 *
 *   - a person named as an owner of the record holds every permission of
 *     theirs on it, as on any record;
 *   - so does one who acts on every private record of the project: a Project
 *     Owner or Project Admin over the whole project;
 *   - anyone else holds only the permissions of the teams of theirs that own
 *     it - another team's permission reaches none of a private record that
 *     team does not own.
 *
 * A block always applies, whichever team it is on. A permission limited to
 * labels is held as it is: the server weighs labels record by record, as
 * for every record.
 */
export default class PrivateRecordHeld {
  // Who acts on every private record of a project, over the whole project.
  public static readonly ACTING_ON_EVERY_PRIVATE_RECORD: ReadonlyArray<Permission> =
    [Permission.ProjectOwner, Permission.ProjectAdmin];

  // Whether `held` acts on every private record of the project.
  public static actsOnEveryPrivateRecord(held: HeldPermissions): boolean {
    return HeldPermissionsUtil.holdsAnyOf(
      held,
      [...PrivateRecordHeld.ACTING_ON_EVERY_PRIVATE_RECORD],
      {
        projectWideOnly: true,
      },
    );
  }

  /*
   * The rows that reach the record for a person who acts on it neither as a
   * named owner nor on every private record: their blocks, the rows no team
   * grants (the defaults every member holds) and the rows of the teams of
   * theirs that own it (UserPermission.teamId) - never the rows of their
   * other teams.
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

      const teamId: string | null = PrivateRecordHeld.getId(row.teamId);

      if (HeldPermissionsUtil.isBlockRow(row) || !teamId) {
        return true;
      }

      return owning.has(teamId.toLowerCase());
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
   * What the person holds on the record, read by the one rule
   * (HeldPermissionsUtil): null when it is everything they hold - a record
   * that is not private, one they are named an owner of, or a person who
   * acts on every private record - and otherwise what the rows of the teams
   * of theirs that own it hold (getRowsOfOwningTeams).
   */
  public static getHeldOnRecord(data: {
    rows: ReadonlyArray<UserPermission>;
    globalPermissions?: ReadonlyArray<Permission> | undefined;
    isPrivate: boolean;
    isOwnedByPerson: boolean;
    owningTeamIds: ReadonlyArray<string>;
  }): HeldPermissions | null {
    if (!data.isPrivate || data.isOwnedByPerson) {
      return null;
    }

    const held: HeldPermissions = HeldPermissionsUtil.fromRows({
      rows: data.rows,
      globalPermissions: data.globalPermissions,
    });

    if (PrivateRecordHeld.actsOnEveryPrivateRecord(held)) {
      return null;
    }

    return HeldPermissionsUtil.fromRows({
      rows: PrivateRecordHeld.getRowsOfOwningTeams({
        rows: data.rows,
        owningTeamIds: data.owningTeamIds,
      }),
      globalPermissions: data.globalPermissions,
    });
  }
}
