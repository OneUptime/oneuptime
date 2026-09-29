import { describe, expect, it } from "@jest/globals";
import TeamMembersByProject, {
  UserProjectMembership,
} from "../../Utils/TeamMembersByProject";
import Project from "../../Models/DatabaseModels/Project";
import Team from "../../Models/DatabaseModels/Team";
import TeamMember from "../../Models/DatabaseModels/TeamMember";
import ObjectID from "../../Types/ObjectID";

/*
 * The Admin Dashboard's User > Projects page asks "which projects is this
 * person in?" and the only data that answers it is a list of TeamMember - a
 * (user, team) pair. Someone on three teams of one project has three
 * memberships and is in one project, so every row on that page is a fold of
 * several memberships.
 *
 * Everything below pins that fold, because every way it can go wrong is
 * silent: a group key read off the wrong field merges nothing (one project
 * renders as three), a shared key merges unrelated projects onto one line, a
 * team dropped or double-counted just shows a slightly wrong Teams column, and
 * an unstable row id breaks the delete button on exactly the multi-team rows
 * this exists for.
 */

type MembershipSpec = {
  id?: string | undefined;
  projectId?: string | undefined;
  projectIdOnProjectObject?: string | undefined;
  projectName?: string | undefined;
  teamId?: string | undefined;
  teamName?: string | undefined;
  hasAcceptedInvitation?: boolean | undefined;
  createdAt?: Date | undefined;
};

const buildMembership: (spec: MembershipSpec) => TeamMember = (
  spec: MembershipSpec,
): TeamMember => {
  const teamMember: TeamMember = new TeamMember();

  if (spec.id) {
    teamMember._id = spec.id;
  }

  if (spec.projectId) {
    teamMember.projectId = new ObjectID(spec.projectId);
  }

  if (spec.projectId || spec.projectIdOnProjectObject || spec.projectName) {
    const project: Project = new Project();

    const projectId: string | undefined =
      spec.projectIdOnProjectObject || spec.projectId;

    if (projectId) {
      project._id = projectId;
    }

    if (spec.projectName) {
      project.name = spec.projectName;
    }

    teamMember.project = project;
  }

  if (spec.teamId) {
    teamMember.teamId = new ObjectID(spec.teamId);
  }

  if (spec.teamId || spec.teamName) {
    const team: Team = new Team();

    if (spec.teamId) {
      team._id = spec.teamId;
    }

    if (spec.teamName) {
      team.name = spec.teamName;
    }

    teamMember.team = team;
  }

  if (spec.createdAt) {
    teamMember.createdAt = spec.createdAt;
  }

  teamMember.hasAcceptedInvitation = spec.hasAcceptedInvitation ?? true;

  return teamMember;
};

const teamNamesOf: (row: UserProjectMembership) => Array<string> = (
  row: UserProjectMembership,
): Array<string> => {
  return row.teams.map((team: Team) => {
    return team.name?.toString() || "";
  });
};

const projectNamesOf: (rows: Array<UserProjectMembership>) => Array<string> = (
  rows: Array<UserProjectMembership>,
): Array<string> => {
  return rows.map((row: UserProjectMembership) => {
    return TeamMembersByProject.getProjectName(row);
  });
};

describe("TeamMembersByProject.getGroupKey", () => {
  it("groups on the membership's projectId", () => {
    expect(
      TeamMembersByProject.getGroupKey(
        buildMembership({ projectId: "project-1", teamId: "team-1" }),
      ),
    ).toBe("project-1");
  });

  it("falls back to the id on the joined project when projectId was not selected", () => {
    const teamMember: TeamMember = buildMembership({
      projectIdOnProjectObject: "project-1",
      teamId: "team-1",
    });

    expect(teamMember.projectId).toBeUndefined();
    expect(TeamMembersByProject.getGroupKey(teamMember)).toBe("project-1");
  });

  it("returns null when the membership carries no project at all", () => {
    expect(TeamMembersByProject.getGroupKey(new TeamMember())).toBeNull();
  });
});

describe("TeamMembersByProject.groupByProject", () => {
  it("returns nothing for no memberships", () => {
    expect(TeamMembersByProject.groupByProject([])).toEqual([]);
  });

  it("returns one row for a user on one team of one project", () => {
    const rows: Array<UserProjectMembership> =
      TeamMembersByProject.groupByProject([
        buildMembership({
          projectId: "project-1",
          projectName: "Acme Production",
          teamId: "team-1",
          teamName: "Owners",
        }),
      ]);

    expect(rows).toHaveLength(1);
    expect(teamNamesOf(rows[0]!)).toEqual(["Owners"]);
  });

  it("collapses several teams of one project into a single row carrying every team", () => {
    const rows: Array<UserProjectMembership> =
      TeamMembersByProject.groupByProject([
        buildMembership({
          projectId: "project-1",
          projectName: "Acme Production",
          teamId: "team-1",
          teamName: "Owners",
        }),
        buildMembership({
          projectId: "project-1",
          projectName: "Acme Production",
          teamId: "team-2",
          teamName: "Engineering",
        }),
      ]);

    expect(rows).toHaveLength(1);
    expect(teamNamesOf(rows[0]!)).toEqual(["Engineering", "Owners"]);
  });

  it("keeps different projects apart", () => {
    const rows: Array<UserProjectMembership> =
      TeamMembersByProject.groupByProject([
        buildMembership({
          projectId: "project-1",
          projectName: "Acme Production",
          teamId: "team-1",
          teamName: "Owners",
        }),
        buildMembership({
          projectId: "project-2",
          projectName: "Acme Staging",
          teamId: "team-3",
          teamName: "Owners",
        }),
        buildMembership({
          projectId: "project-1",
          projectName: "Acme Production",
          teamId: "team-2",
          teamName: "Engineering",
        }),
      ]);

    expect(rows).toHaveLength(2);
    expect(projectNamesOf(rows)).toEqual(["Acme Production", "Acme Staging"]);
    expect(teamNamesOf(rows[0]!)).toEqual(["Engineering", "Owners"]);
    expect(teamNamesOf(rows[1]!)).toEqual(["Owners"]);
  });

  it("keeps the order the caller passed, by first appearance of each project", () => {
    const rows: Array<UserProjectMembership> =
      TeamMembersByProject.groupByProject([
        buildMembership({ projectId: "project-3", teamId: "team-1" }),
        buildMembership({ projectId: "project-1", teamId: "team-1" }),
        buildMembership({ projectId: "project-3", teamId: "team-2" }),
        buildMembership({ projectId: "project-2", teamId: "team-1" }),
      ]);

    expect(
      rows.map((row: UserProjectMembership) => {
        return row.projectId?.toString();
      }),
    ).toEqual(["project-3", "project-1", "project-2"]);
  });

  it("groups by project even when the same project's memberships are not adjacent", () => {
    const rows: Array<UserProjectMembership> =
      TeamMembersByProject.groupByProject([
        buildMembership({ projectId: "p1", teamId: "t1", teamName: "A" }),
        buildMembership({ projectId: "p2", teamId: "t1", teamName: "A" }),
        buildMembership({ projectId: "p3", teamId: "t1", teamName: "A" }),
        buildMembership({ projectId: "p1", teamId: "t2", teamName: "B" }),
      ]);

    expect(rows).toHaveLength(3);
    expect(teamNamesOf(rows[0]!)).toEqual(["A", "B"]);
  });

  it("sorts the teams on a row by name, whatever order the memberships arrived in", () => {
    const rows: Array<UserProjectMembership> =
      TeamMembersByProject.groupByProject([
        buildMembership({ projectId: "p1", teamId: "t3", teamName: "Zulu" }),
        buildMembership({ projectId: "p1", teamId: "t1", teamName: "alpha" }),
        buildMembership({ projectId: "p1", teamId: "t2", teamName: "Bravo" }),
      ]);

    expect(teamNamesOf(rows[0]!)).toEqual(["alpha", "Bravo", "Zulu"]);
  });

  it("lists a team once even if the same membership pair comes back twice", () => {
    const rows: Array<UserProjectMembership> =
      TeamMembersByProject.groupByProject([
        buildMembership({ projectId: "p1", teamId: "t1", teamName: "Ops" }),
        buildMembership({ projectId: "p1", teamId: "t1", teamName: "Ops" }),
      ]);

    expect(teamNamesOf(rows[0]!)).toEqual(["Ops"]);
  });

  it("de-dupes on the team's own id when the membership has no teamId", () => {
    const first: TeamMember = buildMembership({
      projectId: "p1",
      teamId: "t1",
      teamName: "Ops",
    });
    const second: TeamMember = buildMembership({
      projectId: "p1",
      teamId: "t1",
      teamName: "Ops",
    });

    // The select asked for the joined team but not the foreign key.
    delete first.teamId;
    delete second.teamId;

    const rows: Array<UserProjectMembership> =
      TeamMembersByProject.groupByProject([first, second]);

    expect(teamNamesOf(rows[0]!)).toEqual(["Ops"]);
  });

  it("keeps a row whose membership has no team, with an empty team list", () => {
    const rows: Array<UserProjectMembership> =
      TeamMembersByProject.groupByProject([
        buildMembership({ projectId: "p1", projectName: "Acme" }),
      ]);

    expect(rows).toHaveLength(1);
    expect(rows[0]!.teams).toEqual([]);
  });

  it("never merges memberships that carry no project, however many there are", () => {
    const rows: Array<UserProjectMembership> =
      TeamMembersByProject.groupByProject([new TeamMember(), new TeamMember()]);

    expect(rows).toHaveLength(2);
  });

  it("fills in the project from a later membership when the first one lacked it", () => {
    /*
     * The relation can be missing on one membership and present on the next
     * (nullified relation, or a partial select). Taking the first membership's
     * project verbatim would leave the row nameless while the data to name it
     * was right there.
     */
    const withoutProject: TeamMember = buildMembership({
      projectId: "p1",
      teamId: "t1",
    });
    delete withoutProject.project;

    const rows: Array<UserProjectMembership> =
      TeamMembersByProject.groupByProject([
        withoutProject,
        buildMembership({
          projectId: "p1",
          projectName: "Acme Production",
          teamId: "t2",
        }),
      ]);

    expect(rows).toHaveLength(1);
    expect(TeamMembersByProject.getProjectName(rows[0]!)).toBe(
      "Acme Production",
    );
  });

  it("fills in the projectId from a later membership when it was grouped on the joined project", () => {
    const rows: Array<UserProjectMembership> =
      TeamMembersByProject.groupByProject([
        buildMembership({ projectIdOnProjectObject: "p1", teamId: "t1" }),
        buildMembership({ projectId: "p1", teamId: "t2" }),
      ]);

    expect(rows).toHaveLength(1);
    expect(rows[0]!.projectId?.toString()).toBe("p1");
  });
});

describe("TeamMembersByProject.groupByProject — membership status", () => {
  it("counts the user as a member of the project as soon as one invitation is accepted", () => {
    const rows: Array<UserProjectMembership> =
      TeamMembersByProject.groupByProject([
        buildMembership({
          projectId: "p1",
          teamId: "t1",
          hasAcceptedInvitation: false,
        }),
        buildMembership({
          projectId: "p1",
          teamId: "t2",
          hasAcceptedInvitation: true,
        }),
      ]);

    expect(rows[0]!.hasAcceptedInvitation).toBe(true);
    expect(rows[0]!.pendingTeamCount).toBe(1);
  });

  it("leaves a user with no accepted invitation as an invitee", () => {
    const rows: Array<UserProjectMembership> =
      TeamMembersByProject.groupByProject([
        buildMembership({
          projectId: "p1",
          teamId: "t1",
          hasAcceptedInvitation: false,
        }),
        buildMembership({
          projectId: "p1",
          teamId: "t2",
          hasAcceptedInvitation: false,
        }),
      ]);

    expect(rows[0]!.hasAcceptedInvitation).toBe(false);
    expect(rows[0]!.pendingTeamCount).toBe(2);
  });

  it("reports no pending invitations when every membership is accepted", () => {
    const rows: Array<UserProjectMembership> =
      TeamMembersByProject.groupByProject([
        buildMembership({ projectId: "p1", teamId: "t1" }),
        buildMembership({ projectId: "p1", teamId: "t2" }),
      ]);

    expect(rows[0]!.hasAcceptedInvitation).toBe(true);
    expect(rows[0]!.pendingTeamCount).toBe(0);
  });

  it("keeps the status of one project out of another", () => {
    const rows: Array<UserProjectMembership> =
      TeamMembersByProject.groupByProject([
        buildMembership({
          projectId: "p1",
          teamId: "t1",
          hasAcceptedInvitation: true,
        }),
        buildMembership({
          projectId: "p2",
          teamId: "t2",
          hasAcceptedInvitation: false,
        }),
      ]);

    expect(rows[0]!.hasAcceptedInvitation).toBe(true);
    expect(rows[1]!.hasAcceptedInvitation).toBe(false);
    expect(rows[1]!.pendingTeamCount).toBe(1);
  });
});

describe("TeamMembersByProject.groupByProject — joinedAt", () => {
  it("reports the earliest membership as when the user joined the project", () => {
    const rows: Array<UserProjectMembership> =
      TeamMembersByProject.groupByProject([
        buildMembership({
          projectId: "p1",
          teamId: "t1",
          createdAt: new Date("2024-06-01T00:00:00.000Z"),
        }),
        buildMembership({
          projectId: "p1",
          teamId: "t2",
          createdAt: new Date("2024-01-15T00:00:00.000Z"),
        }),
      ]);

    expect(rows[0]!.joinedAt?.toISOString()).toBe("2024-01-15T00:00:00.000Z");
  });

  it("leaves joinedAt unset when no membership carries a date", () => {
    const rows: Array<UserProjectMembership> =
      TeamMembersByProject.groupByProject([
        buildMembership({ projectId: "p1", teamId: "t1" }),
      ]);

    expect(rows[0]!.joinedAt).toBeUndefined();
  });

  it("takes the only date there is when some memberships have none", () => {
    const rows: Array<UserProjectMembership> =
      TeamMembersByProject.groupByProject([
        buildMembership({ projectId: "p1", teamId: "t1" }),
        buildMembership({
          projectId: "p1",
          teamId: "t2",
          createdAt: new Date("2024-03-03T00:00:00.000Z"),
        }),
      ]);

    expect(rows[0]!.joinedAt?.toISOString()).toBe("2024-03-03T00:00:00.000Z");
  });
});

describe("TeamMembersByProject.groupByProject — row identity", () => {
  /*
   * The row's id identifies the PROJECT the user is in, and the table matches
   * a selected row to an on-screen row by that id alone. A first-seen id would
   * change whenever the server returned the memberships in a different order,
   * so the same row would carry different ids between two reads and its
   * checkbox — and its delete — would silently target nothing. Hence: lowest
   * membership id, independent of arrival order.
   */
  it("gives a row the same id whatever order the memberships arrive in", () => {
    const oneOrder: Array<UserProjectMembership> =
      TeamMembersByProject.groupByProject([
        buildMembership({ id: "member-3", projectId: "p1", teamId: "t3" }),
        buildMembership({ id: "member-1", projectId: "p1", teamId: "t1" }),
        buildMembership({ id: "member-2", projectId: "p1", teamId: "t2" }),
      ]);

    const otherOrder: Array<UserProjectMembership> =
      TeamMembersByProject.groupByProject([
        buildMembership({ id: "member-2", projectId: "p1", teamId: "t2" }),
        buildMembership({ id: "member-3", projectId: "p1", teamId: "t3" }),
        buildMembership({ id: "member-1", projectId: "p1", teamId: "t1" }),
      ]);

    expect(oneOrder[0]!.id).toBe("member-1");
    expect(otherOrder[0]!.id).toBe(oneOrder[0]!.id);
  });

  it("keeps the row id pointing at a real membership of that project", () => {
    const rows: Array<UserProjectMembership> =
      TeamMembersByProject.groupByProject([
        buildMembership({ id: "member-9", projectId: "p1", teamId: "t1" }),
        buildMembership({ id: "member-4", projectId: "p1", teamId: "t2" }),
      ]);

    expect(["member-9", "member-4"]).toContain(rows[0]!.id);
  });

  it("leaves a single-membership row on its own id", () => {
    const rows: Array<UserProjectMembership> =
      TeamMembersByProject.groupByProject([
        buildMembership({ id: "member-7", projectId: "p1", teamId: "t1" }),
      ]);

    expect(rows[0]!.id).toBe("member-7");
  });

  it("gives different projects different row ids", () => {
    const rows: Array<UserProjectMembership> =
      TeamMembersByProject.groupByProject([
        buildMembership({ id: "member-1", projectId: "p1", teamId: "t1" }),
        buildMembership({ id: "member-2", projectId: "p2", teamId: "t1" }),
        buildMembership({ id: "member-3", projectId: "p1", teamId: "t2" }),
      ]);

    expect(rows[0]!.id).not.toBe(rows[1]!.id);
  });

  it("does not invent an id for a row whose memberships have none", () => {
    const rows: Array<UserProjectMembership> =
      TeamMembersByProject.groupByProject([
        buildMembership({ projectId: "p1", teamId: "t1" }),
        buildMembership({ projectId: "p1", teamId: "t2" }),
      ]);

    expect(rows[0]!.id).toBeUndefined();
  });

  /*
   * Removing the user from the project deletes every one of these, so a row
   * that forgot one would leave the person half-removed.
   */
  it("carries every membership id folded into the row", () => {
    const rows: Array<UserProjectMembership> =
      TeamMembersByProject.groupByProject([
        buildMembership({ id: "member-1", projectId: "p1", teamId: "t1" }),
        buildMembership({ id: "member-2", projectId: "p1", teamId: "t2" }),
        buildMembership({ id: "member-3", projectId: "p2", teamId: "t3" }),
      ]);

    expect(rows[0]!.teamMemberIds).toEqual(["member-1", "member-2"]);
    expect(rows[1]!.teamMemberIds).toEqual(["member-3"]);
  });
});

describe("TeamMembersByProject.sortByProjectName", () => {
  it("sorts by project name, ignoring case", () => {
    const rows: Array<UserProjectMembership> =
      TeamMembersByProject.groupByProject([
        buildMembership({ projectId: "p1", projectName: "zebra corp" }),
        buildMembership({ projectId: "p2", projectName: "Acme Production" }),
        buildMembership({ projectId: "p3", projectName: "middle ground" }),
      ]);

    expect(
      projectNamesOf(TeamMembersByProject.sortByProjectName(rows)),
    ).toEqual(["Acme Production", "middle ground", "zebra corp"]);
  });

  it("falls back to the project id for a project with no name", () => {
    const rows: Array<UserProjectMembership> =
      TeamMembersByProject.groupByProject([
        buildMembership({ projectId: "p1" }),
      ]);

    expect(TeamMembersByProject.getProjectName(rows[0]!)).toBe("p1");
  });

  it("puts rows with nothing to sort on last rather than at the top", () => {
    const rows: Array<UserProjectMembership> =
      TeamMembersByProject.groupByProject([
        new TeamMember(),
        buildMembership({ projectId: "p1", projectName: "Acme Production" }),
      ]);

    const sorted: Array<UserProjectMembership> =
      TeamMembersByProject.sortByProjectName(rows);

    expect(TeamMembersByProject.getProjectName(sorted[0]!)).toBe(
      "Acme Production",
    );
    expect(TeamMembersByProject.getProjectName(sorted[1]!)).toBe("");
  });

  it("does not reorder the array it was given", () => {
    const rows: Array<UserProjectMembership> =
      TeamMembersByProject.groupByProject([
        buildMembership({ projectId: "p1", projectName: "Zebra" }),
        buildMembership({ projectId: "p2", projectName: "Acme" }),
      ]);

    TeamMembersByProject.sortByProjectName(rows);

    expect(TeamMembersByProject.getProjectName(rows[0]!)).toBe("Zebra");
  });
});

describe("what the User > Projects page renders", () => {
  it("shows a user on six teams across three projects as three rows", () => {
    const rows: Array<UserProjectMembership> =
      TeamMembersByProject.sortByProjectName(
        TeamMembersByProject.groupByProject([
          buildMembership({
            projectId: "prod",
            projectName: "Acme Production",
            teamId: "owners",
            teamName: "Owners",
          }),
          buildMembership({
            projectId: "staging",
            projectName: "Acme Staging",
            teamId: "eng",
            teamName: "Engineering",
          }),
          buildMembership({
            projectId: "prod",
            projectName: "Acme Production",
            teamId: "eng",
            teamName: "Engineering",
          }),
          buildMembership({
            projectId: "sandbox",
            projectName: "Sandbox",
            teamId: "invited",
            teamName: "Support",
            hasAcceptedInvitation: false,
          }),
          buildMembership({
            projectId: "prod",
            projectName: "Acme Production",
            teamId: "support",
            teamName: "Support",
          }),
          buildMembership({
            projectId: "staging",
            projectName: "Acme Staging",
            teamId: "owners-staging",
            teamName: "Owners",
          }),
        ]),
      );

    expect(
      rows.map((row: UserProjectMembership) => {
        return {
          project: TeamMembersByProject.getProjectName(row),
          teams: teamNamesOf(row),
          isMember: row.hasAcceptedInvitation,
        };
      }),
    ).toEqual([
      {
        project: "Acme Production",
        teams: ["Engineering", "Owners", "Support"],
        isMember: true,
      },
      {
        project: "Acme Staging",
        teams: ["Engineering", "Owners"],
        isMember: true,
      },
      {
        project: "Sandbox",
        teams: ["Support"],
        isMember: false,
      },
    ]);
  });
});
