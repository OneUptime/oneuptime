import Team from "../../Models/DatabaseModels/Team";
import TeamMember from "../../Models/DatabaseModels/TeamMember";

/*
 * TeamMember is a (user, team) pair, so a list of team members is a list of
 * memberships - not a list of people. Rendering it straight into a "Users"
 * table gives one row per membership, and someone who belongs to three teams
 * reads as three separate people with the same name and avatar.
 *
 * These helpers collapse memberships into one row per person, carrying every
 * team that person belongs to on the row so the table can show them together.
 * The row is still a TeamMember (the table, its columns and its delete action
 * are all typed against the model) - it just stands for the user rather than
 * for one of their memberships.
 */

export interface ProjectUserExtras {
  // Every team this user belongs to, sorted by name.
  teamsForUser: Array<Team>;
  teamCountForUser: number;
  /*
   * How many of those memberships are still unaccepted invitations. A user can
   * be a fully accepted member of one team and a pending invite on another.
   */
  pendingTeamCountForUser: number;
}

export type ProjectUserRow = TeamMember & ProjectUserExtras;

export default class TeamMembersByUser {
  /**
   * The identity a membership is grouped under. Null when the row carries no
   * user at all - those rows are never merged, because merging them would put
   * unrelated memberships on one line.
   */
  public static getGroupKey(teamMember: TeamMember): string | null {
    const userId: string =
      teamMember.userId?.toString() || teamMember.user?._id?.toString() || "";

    return userId || null;
  }

  /**
   * The name this row sorts and reads under. Falls back to the email so a user
   * who was invited but has not set a name yet still lands somewhere sensible.
   */
  public static getDisplayName(teamMember: TeamMember): string {
    return (
      teamMember.user?.name?.toString() ||
      teamMember.user?.email?.toString() ||
      ""
    );
  }

  /**
   * One row per user, in the order each user was first seen. The input order is
   * whatever the server sorted by, so first-seen order keeps that sort intact.
   *
   * The returned rows are the same TeamMember instances that came in (the first
   * membership seen for each user), mutated with the aggregate fields.
   */
  public static groupByUser(
    teamMembers: Array<TeamMember>,
  ): Array<ProjectUserRow> {
    const rowsByGroupKey: Map<string, ProjectUserRow> = new Map<
      string,
      ProjectUserRow
    >();
    const rows: Array<ProjectUserRow> = [];

    /*
     * Which teams are already on a row, keyed the same way for every
     * membership. Tracked here rather than re-derived from `teamsForUser`
     * because a membership identifies its team by `teamId` while the team
     * object it carries identifies itself by `_id`, and either one can be
     * missing from a given select.
     */
    const teamKeysByRow: Map<ProjectUserRow, Set<string>> = new Map<
      ProjectUserRow,
      Set<string>
    >();

    for (const teamMember of teamMembers) {
      const groupKey: string | null = this.getGroupKey(teamMember);

      const existingRow: ProjectUserRow | undefined = groupKey
        ? rowsByGroupKey.get(groupKey)
        : undefined;

      if (existingRow) {
        this.addMembershipToRow(
          existingRow,
          teamMember,
          teamKeysByRow.get(existingRow)!,
          Boolean(teamMember.hasAcceptedInvitation),
        );
        continue;
      }

      const row: ProjectUserRow = teamMember as ProjectUserRow;
      const teamKeys: Set<string> = new Set<string>();

      /*
       * The row *is* this membership, so read its acceptance before the reset
       * below overwrites it.
       */
      const hasAcceptedInvitation: boolean = Boolean(
        teamMember.hasAcceptedInvitation,
      );

      row.teamsForUser = [];
      row.teamCountForUser = 0;
      row.pendingTeamCountForUser = 0;

      /*
       * Reset before folding the row's own membership back in: on a grouped row
       * this field means "is a member of this project", which is true as soon as
       * any one of the memberships has been accepted.
       */
      row.hasAcceptedInvitation = false;

      teamKeysByRow.set(row, teamKeys);
      this.addMembershipToRow(row, teamMember, teamKeys, hasAcceptedInvitation);

      if (groupKey) {
        rowsByGroupKey.set(groupKey, row);
      }

      rows.push(row);
    }

    for (const row of rows) {
      this.finalizeRow(row);
    }

    return rows;
  }

  /**
   * Replaces the team aggregate on each row with the one derived from
   * `allTeamMembers`.
   *
   * Needed because the rows on screen may have been built from a *filtered*
   * membership list - filter the table by one team and grouping only ever sees
   * that team, so the Teams column would claim each user belongs to exactly the
   * team that was filtered for. The caller re-reads the unfiltered memberships
   * for the users on the current page and merges them back in here.
   *
   * Rows with no matching membership in `allTeamMembers` are left untouched.
   */
  public static mergeAllTeamsIntoRows(
    rows: Array<ProjectUserRow>,
    allTeamMembers: Array<TeamMember>,
  ): Array<ProjectUserRow> {
    const groupedRows: Array<ProjectUserRow> = this.groupByUser(allTeamMembers);

    const groupedRowsByKey: Map<string, ProjectUserRow> = new Map<
      string,
      ProjectUserRow
    >();

    for (const groupedRow of groupedRows) {
      const groupKey: string | null = this.getGroupKey(groupedRow);

      if (groupKey) {
        groupedRowsByKey.set(groupKey, groupedRow);
      }
    }

    for (const row of rows) {
      const groupKey: string | null = this.getGroupKey(row);
      const groupedRow: ProjectUserRow | undefined = groupKey
        ? groupedRowsByKey.get(groupKey)
        : undefined;

      if (!groupedRow) {
        continue;
      }

      row.teamsForUser = groupedRow.teamsForUser;
      row.teamCountForUser = groupedRow.teamCountForUser;
      row.pendingTeamCountForUser = groupedRow.pendingTeamCountForUser;
      row.hasAcceptedInvitation = Boolean(groupedRow.hasAcceptedInvitation);
    }

    return rows;
  }

  /**
   * Alphabetical by display name, case-insensitively. Rows with no name at all
   * sort last so the list does not open on a run of blanks.
   *
   * Returns a new array; the input is left alone.
   */
  public static sortRowsByUserName(
    rows: Array<ProjectUserRow>,
  ): Array<ProjectUserRow> {
    return [...rows].sort((a: ProjectUserRow, b: ProjectUserRow) => {
      const nameA: string = this.getDisplayName(a).toLowerCase();
      const nameB: string = this.getDisplayName(b).toLowerCase();

      if (!nameA && !nameB) {
        return 0;
      }

      if (!nameA) {
        return 1;
      }

      if (!nameB) {
        return -1;
      }

      return nameA.localeCompare(nameB);
    });
  }

  private static addMembershipToRow(
    row: ProjectUserRow,
    teamMember: TeamMember,
    teamKeys: Set<string>,
    hasAcceptedInvitation: boolean,
  ): void {
    if (hasAcceptedInvitation) {
      row.hasAcceptedInvitation = true;
    } else {
      row.pendingTeamCountForUser = row.pendingTeamCountForUser + 1;
    }

    const team: Team | undefined = teamMember.team;

    if (!team) {
      return;
    }

    const teamKey: string =
      teamMember.teamId?.toString() ||
      team._id?.toString() ||
      team.name?.toString() ||
      "";

    if (!teamKey || teamKeys.has(teamKey)) {
      return;
    }

    teamKeys.add(teamKey);
    row.teamsForUser.push(team);
  }

  private static finalizeRow(row: ProjectUserRow): void {
    row.teamsForUser.sort((a: Team, b: Team) => {
      return (a.name?.toString() || "")
        .toLowerCase()
        .localeCompare((b.name?.toString() || "").toLowerCase());
    });

    row.teamCountForUser = row.teamsForUser.length;
  }
}
