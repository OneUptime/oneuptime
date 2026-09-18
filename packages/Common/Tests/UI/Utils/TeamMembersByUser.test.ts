import { describe, expect, it } from "@jest/globals";
import TeamMembersByUser, {
  ProjectUserRow,
} from "../../../UI/Utils/TeamMembersByUser";
import Team from "../../../Models/DatabaseModels/Team";
import TeamMember from "../../../Models/DatabaseModels/TeamMember";
import User from "../../../Models/DatabaseModels/User";
import Email from "../../../Types/Email";
import Name from "../../../Types/Name";
import ObjectID from "../../../Types/ObjectID";

/*
 * The Users table lists TeamMember, which is a (user, team) pair. Before this
 * util a person on three teams rendered as three rows with the same name and
 * avatar, which customers read as three different people. Everything below
 * pins the collapse of those rows into one row per person, because every way
 * it can go wrong is silent: a group key read off the wrong field merges
 * nobody (duplicates come straight back), a shared key merges strangers, and a
 * team that is dropped or double-counted just shows a slightly wrong Teams
 * column that nobody notices until a customer asks who is on which team.
 */

type MembershipSpec = {
  id?: string | undefined;
  userId?: string | undefined;
  userIdOnUserObject?: string | undefined;
  userName?: string | undefined;
  userEmail?: string | undefined;
  teamId?: string | undefined;
  teamName?: string | undefined;
  hasAcceptedInvitation?: boolean | undefined;
};

const buildMembership: (spec: MembershipSpec) => TeamMember = (
  spec: MembershipSpec,
): TeamMember => {
  const teamMember: TeamMember = new TeamMember();

  if (spec.id) {
    teamMember._id = spec.id;
  }

  if (spec.userId) {
    teamMember.userId = new ObjectID(spec.userId);
  }

  if (spec.userId || spec.userIdOnUserObject || spec.userName) {
    const user: User = new User();

    const userId: string | undefined = spec.userIdOnUserObject || spec.userId;

    if (userId) {
      user._id = userId;
    }

    if (spec.userName) {
      user.name = new Name(spec.userName);
    }

    if (spec.userEmail) {
      user.email = new Email(spec.userEmail);
    }

    teamMember.user = user;
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

  teamMember.hasAcceptedInvitation = spec.hasAcceptedInvitation ?? true;

  return teamMember;
};

const teamNamesOf: (row: ProjectUserRow) => Array<string> = (
  row: ProjectUserRow,
): Array<string> => {
  return row.teamsForUser.map((team: Team) => {
    return team.name?.toString() || "";
  });
};

describe("TeamMembersByUser.getGroupKey", () => {
  it("groups on the membership's userId", () => {
    const key: string | null = TeamMembersByUser.getGroupKey(
      buildMembership({ userId: "user-1", teamId: "team-1" }),
    );

    expect(key).toBe("user-1");
  });

  it("falls back to the id on the joined user when userId was not selected", () => {
    const teamMember: TeamMember = buildMembership({
      userIdOnUserObject: "user-1",
      teamId: "team-1",
    });

    expect(teamMember.userId).toBeUndefined();
    expect(TeamMembersByUser.getGroupKey(teamMember)).toBe("user-1");
  });

  it("returns null when the membership carries no user at all", () => {
    const teamMember: TeamMember = new TeamMember();

    expect(TeamMembersByUser.getGroupKey(teamMember)).toBeNull();
  });
});

describe("TeamMembersByUser.groupByUser", () => {
  it("returns nothing for no memberships", () => {
    expect(TeamMembersByUser.groupByUser([])).toEqual([]);
  });

  it("returns one row for a user on one team", () => {
    const rows: Array<ProjectUserRow> = TeamMembersByUser.groupByUser([
      buildMembership({
        userId: "user-1",
        userName: "Colton Hawkins",
        teamId: "team-1",
        teamName: "NTW_Online Operations",
      }),
    ]);

    expect(rows).toHaveLength(1);
    expect(teamNamesOf(rows[0]!)).toEqual(["NTW_Online Operations"]);
    expect(rows[0]!.teamCountForUser).toBe(1);
  });

  it("collapses one user on several teams into a single row carrying every team", () => {
    const rows: Array<ProjectUserRow> = TeamMembersByUser.groupByUser([
      buildMembership({
        userId: "user-1",
        userName: "Thomas Stock",
        teamId: "team-1",
        teamName: "NTW_Online Operations",
      }),
      buildMembership({
        userId: "user-1",
        userName: "Thomas Stock",
        teamId: "team-2",
        teamName: "Owners",
      }),
    ]);

    expect(rows).toHaveLength(1);
    expect(teamNamesOf(rows[0]!)).toEqual(["NTW_Online Operations", "Owners"]);
    expect(rows[0]!.teamCountForUser).toBe(2);
  });

  it("keeps different users apart", () => {
    const rows: Array<ProjectUserRow> = TeamMembersByUser.groupByUser([
      buildMembership({
        userId: "user-1",
        userName: "Thomas Stock",
        teamId: "team-1",
        teamName: "NTW_Online Operations",
      }),
      buildMembership({
        userId: "user-2",
        userName: "Jason Apel",
        teamId: "team-1",
        teamName: "NTW_Online Operations",
      }),
      buildMembership({
        userId: "user-1",
        userName: "Thomas Stock",
        teamId: "team-2",
        teamName: "Owners",
      }),
    ]);

    expect(rows).toHaveLength(2);
    expect(TeamMembersByUser.getDisplayName(rows[0]!)).toBe("Thomas Stock");
    expect(TeamMembersByUser.getDisplayName(rows[1]!)).toBe("Jason Apel");
    expect(teamNamesOf(rows[0]!)).toEqual(["NTW_Online Operations", "Owners"]);
    expect(teamNamesOf(rows[1]!)).toEqual(["NTW_Online Operations"]);
  });

  it("keeps the order the server returned, by first appearance of each user", () => {
    const rows: Array<ProjectUserRow> = TeamMembersByUser.groupByUser([
      buildMembership({ userId: "user-3", teamId: "team-1" }),
      buildMembership({ userId: "user-1", teamId: "team-1" }),
      buildMembership({ userId: "user-3", teamId: "team-2" }),
      buildMembership({ userId: "user-2", teamId: "team-1" }),
    ]);

    expect(
      rows.map((row: ProjectUserRow) => {
        return row.userId?.toString();
      }),
    ).toEqual(["user-3", "user-1", "user-2"]);
  });

  it("sorts the teams on a row by name, whatever order the memberships arrived in", () => {
    const rows: Array<ProjectUserRow> = TeamMembersByUser.groupByUser([
      buildMembership({ userId: "user-1", teamId: "t3", teamName: "Zulu" }),
      buildMembership({ userId: "user-1", teamId: "t1", teamName: "alpha" }),
      buildMembership({ userId: "user-1", teamId: "t2", teamName: "Bravo" }),
    ]);

    expect(teamNamesOf(rows[0]!)).toEqual(["alpha", "Bravo", "Zulu"]);
  });

  it("lists a team once even if the same membership pair comes back twice", () => {
    const rows: Array<ProjectUserRow> = TeamMembersByUser.groupByUser([
      buildMembership({ userId: "user-1", teamId: "team-1", teamName: "Ops" }),
      buildMembership({ userId: "user-1", teamId: "team-1", teamName: "Ops" }),
    ]);

    expect(teamNamesOf(rows[0]!)).toEqual(["Ops"]);
    expect(rows[0]!.teamCountForUser).toBe(1);
  });

  it("de-dupes on the team's own id when the membership has no teamId", () => {
    const first: TeamMember = buildMembership({
      userId: "user-1",
      teamId: "team-1",
      teamName: "Ops",
    });
    const second: TeamMember = buildMembership({
      userId: "user-1",
      teamId: "team-1",
      teamName: "Ops",
    });

    // The select asked for the joined team but not the foreign key.
    delete first.teamId;
    delete second.teamId;

    const rows: Array<ProjectUserRow> = TeamMembersByUser.groupByUser([
      first,
      second,
    ]);

    expect(teamNamesOf(rows[0]!)).toEqual(["Ops"]);
  });

  it("keeps a row whose membership has no team, with an empty team list", () => {
    const rows: Array<ProjectUserRow> = TeamMembersByUser.groupByUser([
      buildMembership({ userId: "user-1", userName: "Karsten Huster" }),
    ]);

    expect(rows).toHaveLength(1);
    expect(rows[0]!.teamsForUser).toEqual([]);
    expect(rows[0]!.teamCountForUser).toBe(0);
  });

  it("never merges memberships that carry no user, however many there are", () => {
    const rows: Array<ProjectUserRow> = TeamMembersByUser.groupByUser([
      new TeamMember(),
      new TeamMember(),
    ]);

    expect(rows).toHaveLength(2);
  });

  it("counts a user as a member as soon as one of their invitations is accepted", () => {
    const rows: Array<ProjectUserRow> = TeamMembersByUser.groupByUser([
      buildMembership({
        userId: "user-1",
        teamId: "team-1",
        hasAcceptedInvitation: false,
      }),
      buildMembership({
        userId: "user-1",
        teamId: "team-2",
        hasAcceptedInvitation: true,
      }),
    ]);

    expect(rows[0]!.hasAcceptedInvitation).toBe(true);
    expect(rows[0]!.pendingTeamCountForUser).toBe(1);
  });

  it("leaves a user with no accepted invitation as an invitee", () => {
    const rows: Array<ProjectUserRow> = TeamMembersByUser.groupByUser([
      buildMembership({
        userId: "user-1",
        teamId: "team-1",
        hasAcceptedInvitation: false,
      }),
      buildMembership({
        userId: "user-1",
        teamId: "team-2",
        hasAcceptedInvitation: false,
      }),
    ]);

    expect(rows[0]!.hasAcceptedInvitation).toBe(false);
    expect(rows[0]!.pendingTeamCountForUser).toBe(2);
  });

  it("reports no pending invitations when every membership is accepted", () => {
    const rows: Array<ProjectUserRow> = TeamMembersByUser.groupByUser([
      buildMembership({ userId: "user-1", teamId: "team-1" }),
      buildMembership({ userId: "user-1", teamId: "team-2" }),
    ]);

    expect(rows[0]!.hasAcceptedInvitation).toBe(true);
    expect(rows[0]!.pendingTeamCountForUser).toBe(0);
  });

  /*
   * The row's id identifies the person, and the table matches a selected row
   * to an on-screen row by that id alone. It fetches the visible page and the
   * "select all" set with two different sorts (the bulk fetch appends `_id` as
   * a tiebreaker), so a first-seen id would make the same person carry a
   * different id in the two results and every multi-team user's checkbox would
   * silently fail to tick. Hence: lowest membership id, independent of the
   * order the server happened to return.
   */
  it("gives a row the same id whatever order the memberships arrive in", () => {
    const oneOrder: Array<ProjectUserRow> = TeamMembersByUser.groupByUser([
      buildMembership({ id: "member-3", userId: "user-1", teamId: "team-3" }),
      buildMembership({ id: "member-1", userId: "user-1", teamId: "team-1" }),
      buildMembership({ id: "member-2", userId: "user-1", teamId: "team-2" }),
    ]);

    const otherOrder: Array<ProjectUserRow> = TeamMembersByUser.groupByUser([
      buildMembership({ id: "member-2", userId: "user-1", teamId: "team-2" }),
      buildMembership({ id: "member-3", userId: "user-1", teamId: "team-3" }),
      buildMembership({ id: "member-1", userId: "user-1", teamId: "team-1" }),
    ]);

    expect(oneOrder[0]!._id).toBe("member-1");
    expect(otherOrder[0]!._id).toBe(oneOrder[0]!._id);
  });

  it("keeps the row id pointing at a real membership of that user", () => {
    const rows: Array<ProjectUserRow> = TeamMembersByUser.groupByUser([
      buildMembership({ id: "member-9", userId: "user-1", teamId: "team-1" }),
      buildMembership({ id: "member-4", userId: "user-1", teamId: "team-2" }),
    ]);

    expect(["member-9", "member-4"]).toContain(rows[0]!._id);
  });

  it("leaves a single-membership row on its own id", () => {
    const rows: Array<ProjectUserRow> = TeamMembersByUser.groupByUser([
      buildMembership({ id: "member-7", userId: "user-1", teamId: "team-1" }),
    ]);

    expect(rows[0]!._id).toBe("member-7");
  });

  it("gives different users different row ids", () => {
    const rows: Array<ProjectUserRow> = TeamMembersByUser.groupByUser([
      buildMembership({ id: "member-1", userId: "user-1", teamId: "team-1" }),
      buildMembership({ id: "member-2", userId: "user-2", teamId: "team-1" }),
      buildMembership({ id: "member-3", userId: "user-1", teamId: "team-2" }),
    ]);

    expect(rows[0]!._id).not.toBe(rows[1]!._id);
  });

  it("does not invent an id for a row whose memberships have none", () => {
    const rows: Array<ProjectUserRow> = TeamMembersByUser.groupByUser([
      buildMembership({ userId: "user-1", teamId: "team-1" }),
      buildMembership({ userId: "user-1", teamId: "team-2" }),
    ]);

    expect(rows[0]!._id).toBeUndefined();
  });

  it("groups by user even when the same person's memberships are not adjacent", () => {
    const rows: Array<ProjectUserRow> = TeamMembersByUser.groupByUser([
      buildMembership({ userId: "user-1", teamId: "t1", teamName: "A" }),
      buildMembership({ userId: "user-2", teamId: "t1", teamName: "A" }),
      buildMembership({ userId: "user-3", teamId: "t1", teamName: "A" }),
      buildMembership({ userId: "user-1", teamId: "t2", teamName: "B" }),
    ]);

    expect(rows).toHaveLength(3);
    expect(teamNamesOf(rows[0]!)).toEqual(["A", "B"]);
  });
});

describe("TeamMembersByUser.mergeAllTeamsIntoRows", () => {
  it("replaces a filtered-down team list with the user's full one", () => {
    /*
     * What the table sees when it is filtered by one team: the membership for
     * the other team never came back, so the row claims one team.
     */
    const rows: Array<ProjectUserRow> = TeamMembersByUser.groupByUser([
      buildMembership({
        userId: "user-1",
        teamId: "team-1",
        teamName: "NTW_IT Operations",
      }),
    ]);

    expect(teamNamesOf(rows[0]!)).toEqual(["NTW_IT Operations"]);

    TeamMembersByUser.mergeAllTeamsIntoRows(rows, [
      buildMembership({
        userId: "user-1",
        teamId: "team-1",
        teamName: "NTW_IT Operations",
      }),
      buildMembership({
        userId: "user-1",
        teamId: "team-2",
        teamName: "Owners",
      }),
    ]);

    expect(teamNamesOf(rows[0]!)).toEqual(["NTW_IT Operations", "Owners"]);
    expect(rows[0]!.teamCountForUser).toBe(2);
  });

  it("merges into the right row when several users are on the page", () => {
    const rows: Array<ProjectUserRow> = TeamMembersByUser.groupByUser([
      buildMembership({ userId: "user-1", teamId: "team-1", teamName: "Ops" }),
      buildMembership({ userId: "user-2", teamId: "team-1", teamName: "Ops" }),
    ]);

    TeamMembersByUser.mergeAllTeamsIntoRows(rows, [
      buildMembership({ userId: "user-1", teamId: "team-1", teamName: "Ops" }),
      buildMembership({
        userId: "user-1",
        teamId: "team-2",
        teamName: "Owners",
      }),
      buildMembership({ userId: "user-2", teamId: "team-1", teamName: "Ops" }),
    ]);

    expect(teamNamesOf(rows[0]!)).toEqual(["Ops", "Owners"]);
    expect(teamNamesOf(rows[1]!)).toEqual(["Ops"]);
  });

  it("re-reads the member status from the unfiltered memberships", () => {
    /*
     * Filtering by a team the user has not accepted yet would otherwise leave
     * a full member of the project labelled "Invitation Sent".
     */
    const rows: Array<ProjectUserRow> = TeamMembersByUser.groupByUser([
      buildMembership({
        userId: "user-1",
        teamId: "team-2",
        hasAcceptedInvitation: false,
      }),
    ]);

    expect(rows[0]!.hasAcceptedInvitation).toBe(false);

    TeamMembersByUser.mergeAllTeamsIntoRows(rows, [
      buildMembership({
        userId: "user-1",
        teamId: "team-1",
        hasAcceptedInvitation: true,
      }),
      buildMembership({
        userId: "user-1",
        teamId: "team-2",
        hasAcceptedInvitation: false,
      }),
    ]);

    expect(rows[0]!.hasAcceptedInvitation).toBe(true);
    expect(rows[0]!.pendingTeamCountForUser).toBe(1);
  });

  it("leaves a row alone when the merge source knows nothing about that user", () => {
    const rows: Array<ProjectUserRow> = TeamMembersByUser.groupByUser([
      buildMembership({ userId: "user-1", teamId: "team-1", teamName: "Ops" }),
    ]);

    TeamMembersByUser.mergeAllTeamsIntoRows(rows, [
      buildMembership({
        userId: "user-9",
        teamId: "team-2",
        teamName: "Owners",
      }),
    ]);

    expect(teamNamesOf(rows[0]!)).toEqual(["Ops"]);
  });

  it("leaves the rows alone when there is nothing to merge", () => {
    const rows: Array<ProjectUserRow> = TeamMembersByUser.groupByUser([
      buildMembership({ userId: "user-1", teamId: "team-1", teamName: "Ops" }),
    ]);

    TeamMembersByUser.mergeAllTeamsIntoRows(rows, []);

    expect(teamNamesOf(rows[0]!)).toEqual(["Ops"]);
  });
});

describe("TeamMembersByUser.sortRowsByUserName", () => {
  it("sorts by name, ignoring case", () => {
    const rows: Array<ProjectUserRow> = TeamMembersByUser.groupByUser([
      buildMembership({ userId: "user-1", userName: "colton Hawkins" }),
      buildMembership({ userId: "user-2", userName: "Aaron Falzon" }),
      buildMembership({ userId: "user-3", userName: "Thomas Stock" }),
    ]);

    expect(
      TeamMembersByUser.sortRowsByUserName(rows).map(
        (row: ProjectUserRow): string => {
          return TeamMembersByUser.getDisplayName(row);
        },
      ),
    ).toEqual(["Aaron Falzon", "colton Hawkins", "Thomas Stock"]);
  });

  it("sorts a user with no name under their email", () => {
    const rows: Array<ProjectUserRow> = TeamMembersByUser.groupByUser([
      buildMembership({ userId: "user-1", userName: "Zoe Baker" }),
      buildMembership({ userId: "user-2", userEmail: "aaron@company.com" }),
    ]);

    expect(
      TeamMembersByUser.sortRowsByUserName(rows).map(
        (row: ProjectUserRow): string => {
          return TeamMembersByUser.getDisplayName(row);
        },
      ),
    ).toEqual(["aaron@company.com", "Zoe Baker"]);
  });

  it("puts rows with nothing to sort on last rather than at the top", () => {
    const rows: Array<ProjectUserRow> = TeamMembersByUser.groupByUser([
      new TeamMember(),
      buildMembership({ userId: "user-1", userName: "Aaron Falzon" }),
    ]);

    const sorted: Array<ProjectUserRow> =
      TeamMembersByUser.sortRowsByUserName(rows);

    expect(TeamMembersByUser.getDisplayName(sorted[0]!)).toBe("Aaron Falzon");
    expect(TeamMembersByUser.getDisplayName(sorted[1]!)).toBe("");
  });

  it("does not reorder the array it was given", () => {
    const rows: Array<ProjectUserRow> = TeamMembersByUser.groupByUser([
      buildMembership({ userId: "user-1", userName: "Zoe Baker" }),
      buildMembership({ userId: "user-2", userName: "Aaron Falzon" }),
    ]);

    TeamMembersByUser.sortRowsByUserName(rows);

    expect(TeamMembersByUser.getDisplayName(rows[0]!)).toBe("Zoe Baker");
  });
});

describe("the duplicate rows customers reported", () => {
  it("renders the reported project as one row per person", () => {
    /*
     * The exact list from the bug report: Thomas Stock and Jason Apel each
     * appeared twice because each belongs to two teams.
     */
    const rows: Array<ProjectUserRow> = TeamMembersByUser.groupByUser([
      buildMembership({
        userId: "thomas",
        userName: "Thomas Stock",
        teamId: "online-ops",
        teamName: "NTW_Online Operations",
      }),
      buildMembership({
        userId: "thomas",
        userName: "Thomas Stock",
        teamId: "owners",
        teamName: "Owners",
      }),
      buildMembership({
        userId: "jason",
        userName: "Jason Apel",
        teamId: "owners",
        teamName: "Owners",
      }),
      buildMembership({
        userId: "colton",
        userName: "Colton Hawkins",
        teamId: "online-ops",
        teamName: "NTW_Online Operations",
      }),
      buildMembership({
        userId: "karsten",
        userName: "Karsten Huster",
        teamId: "it-ops",
        teamName: "NTW_IT Operations",
      }),
      buildMembership({
        userId: "jason",
        userName: "Jason Apel",
        teamId: "online-ops",
        teamName: "NTW_Online Operations",
      }),
    ]);

    expect(
      rows.map((row: ProjectUserRow) => {
        return {
          name: TeamMembersByUser.getDisplayName(row),
          teams: teamNamesOf(row),
        };
      }),
    ).toEqual([
      {
        name: "Thomas Stock",
        teams: ["NTW_Online Operations", "Owners"],
      },
      {
        name: "Jason Apel",
        teams: ["NTW_Online Operations", "Owners"],
      },
      {
        name: "Colton Hawkins",
        teams: ["NTW_Online Operations"],
      },
      {
        name: "Karsten Huster",
        teams: ["NTW_IT Operations"],
      },
    ]);
  });
});
