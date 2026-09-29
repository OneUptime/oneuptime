import Project from "../Models/DatabaseModels/Project";
import Team from "../Models/DatabaseModels/Team";
import TeamMember from "../Models/DatabaseModels/TeamMember";
import ObjectID from "../Types/ObjectID";

/*
 * TeamMember is a (user, team) pair, so "every membership this user has" is not
 * the same list as "every project this user belongs to": someone on three teams
 * of the same project has three memberships but is in one project.
 *
 * These helpers collapse a user's memberships into one row per project, carrying
 * every team they belong to in that project. The Admin Dashboard's
 * User > Projects page is the list this exists for, and the master-admin
 * `POST /user/:userId/projects` endpoint is what runs it.
 *
 * This is the project-side mirror of TeamMembersByUser (which collapses a
 * project's memberships into one row per user). They are kept apart rather than
 * generalised into one grouper because the aggregate each side needs is
 * different - one carries teams, the other carries teams *and* the project - and
 * a shared abstraction would be read by neither caller.
 */
export interface UserProjectMembership {
  /*
   * Identity of the row. The lowest of the user's membership ids in this
   * project, so the row carries the same id whatever order the memberships came
   * back in - a first-seen id would change between two reads sorted differently
   * and break every id-keyed thing on top of it (row selection, delete).
   */
  id: string | undefined;
  projectId: ObjectID | undefined;
  project: Project | undefined;
  // Every team this user belongs to in this project, sorted by name.
  teams: Array<Team>;
  // The ids of every membership folded into this row.
  teamMemberIds: Array<string>;
  /*
   * True as soon as ONE of the memberships has been accepted: a person who has
   * accepted their invitation to any team of the project is in the project.
   */
  hasAcceptedInvitation: boolean;
  // How many of the memberships are still unaccepted invitations.
  pendingTeamCount: number;
  // When the user was first invited to this project (earliest membership).
  joinedAt: Date | undefined;
}

export default class TeamMembersByProject {
  /**
   * The project a membership is grouped under. Null when the membership carries
   * no project at all - those rows are never merged, because merging them would
   * put memberships of unrelated projects on one line.
   */
  public static getGroupKey(teamMember: TeamMember): string | null {
    const projectId: string =
      teamMember.projectId?.toString() ||
      teamMember.project?._id?.toString() ||
      "";

    return projectId || null;
  }

  /**
   * The name this row reads and sorts under. Falls back to the project id so a
   * row whose project could not be joined still lands somewhere deterministic
   * rather than sorting as a blank.
   */
  public static getProjectName(row: UserProjectMembership): string {
    return (
      row.project?.name?.toString() ||
      row.projectId?.toString() ||
      row.project?._id?.toString() ||
      ""
    );
  }

  /**
   * One row per project, in the order each project was first seen. The input
   * order is whatever the caller sorted the memberships by, so first-seen order
   * keeps that sort intact.
   */
  public static groupByProject(
    teamMembers: Array<TeamMember>,
  ): Array<UserProjectMembership> {
    const rowsByGroupKey: Map<string, UserProjectMembership> = new Map<
      string,
      UserProjectMembership
    >();
    const rows: Array<UserProjectMembership> = [];

    /*
     * Which teams are already on a row. Tracked separately rather than
     * re-derived from `teams`, because a membership identifies its team by
     * `teamId` while the team object it carries identifies itself by `_id`, and
     * either one can be missing from a given select.
     */
    const teamKeysByRow: Map<UserProjectMembership, Set<string>> = new Map<
      UserProjectMembership,
      Set<string>
    >();

    for (const teamMember of teamMembers) {
      const groupKey: string | null = this.getGroupKey(teamMember);

      let row: UserProjectMembership | undefined = groupKey
        ? rowsByGroupKey.get(groupKey)
        : undefined;

      if (!row) {
        row = {
          id: undefined,
          projectId: teamMember.projectId || undefined,
          project: teamMember.project || undefined,
          teams: [],
          teamMemberIds: [],
          hasAcceptedInvitation: false,
          pendingTeamCount: 0,
          joinedAt: undefined,
        };

        teamKeysByRow.set(row, new Set<string>());

        if (groupKey) {
          rowsByGroupKey.set(groupKey, row);
        }

        rows.push(row);
      }

      this.addMembershipToRow(row, teamMember, teamKeysByRow.get(row)!);
    }

    for (const row of rows) {
      this.finalizeRow(row);
    }

    return rows;
  }

  /**
   * Alphabetical by project name, case-insensitively. Rows with no name at all
   * sort last so the list does not open on a run of blanks.
   *
   * Returns a new array; the input is left alone.
   */
  public static sortByProjectName(
    rows: Array<UserProjectMembership>,
  ): Array<UserProjectMembership> {
    return [...rows].sort(
      (a: UserProjectMembership, b: UserProjectMembership) => {
        const nameA: string = this.getProjectName(a).toLowerCase();
        const nameB: string = this.getProjectName(b).toLowerCase();

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
      },
    );
  }

  private static addMembershipToRow(
    row: UserProjectMembership,
    teamMember: TeamMember,
    teamKeys: Set<string>,
  ): void {
    if (teamMember.hasAcceptedInvitation) {
      row.hasAcceptedInvitation = true;
    } else {
      row.pendingTeamCount = row.pendingTeamCount + 1;
    }

    /*
     * A later membership can carry the joined project when the first one did
     * not (different selects, or a nullified relation), so fill in whatever is
     * still missing rather than trusting the first membership seen.
     */
    if (!row.project && teamMember.project) {
      row.project = teamMember.project;
    }

    if (!row.projectId && teamMember.projectId) {
      row.projectId = teamMember.projectId;
    }

    const membershipId: string = teamMember._id?.toString() || "";

    if (membershipId) {
      row.teamMemberIds.push(membershipId);
    }

    const createdAt: Date | undefined = teamMember.createdAt;

    if (createdAt && (!row.joinedAt || createdAt < row.joinedAt)) {
      row.joinedAt = createdAt;
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
    row.teams.push(team);
  }

  private static finalizeRow(row: UserProjectMembership): void {
    row.teams.sort((a: Team, b: Team) => {
      return (a.name?.toString() || "")
        .toLowerCase()
        .localeCompare((b.name?.toString() || "").toLowerCase());
    });

    if (row.teamMemberIds.length > 0) {
      row.id = [...row.teamMemberIds].sort()[0]!;
    }
  }
}
