import ProjectInvitationDisplay from "../../../UI/Utils/ProjectInvitationDisplay";
import TeamMembersByProject, {
  UserProjectMembership,
} from "../../../Utils/TeamMembersByProject";
import Project from "../../../Models/DatabaseModels/Project";
import Team from "../../../Models/DatabaseModels/Team";
import TeamMember from "../../../Models/DatabaseModels/TeamMember";
import ObjectID from "../../../Types/ObjectID";
import { describe, expect, it } from "@jest/globals";

/*
 * These helpers stand between the invitation rows the API returns and the card
 * a freshly signed-up user is asked to press Accept on. Everything they guard
 * against is a missing value rather than a wrong one: a select that did not
 * carry the project relation, a team removed between the invite and the
 * render, a project named in a script whose first character is a surrogate
 * pair. None of those throw - they render as "undefined", as a blank square,
 * or as a row React re-keys on every reload - so each fallback is pinned here.
 */

type BuildInvitationSpec = {
  id?: string | undefined;
  projectId?: string | undefined;
  projectIdOnProjectObject?: string | undefined;
  projectName?: string | undefined;
  teamNames?: Array<string> | undefined;
  teamMemberIds?: Array<string> | undefined;
};

type BuildInvitationFunction = (
  spec: BuildInvitationSpec,
) => UserProjectMembership;

/*
 * Built as the interface rather than folded out of TeamMember rows, so a test
 * can hold exactly one field wrong. The fold itself is covered by
 * Tests/Utils/TeamMembersByProject.test.ts, and the two are tied together by
 * the round-trip at the bottom of this file.
 */
const buildInvitation: BuildInvitationFunction = (
  spec: BuildInvitationSpec,
): UserProjectMembership => {
  let project: Project | undefined = undefined;

  if (spec.projectName || spec.projectIdOnProjectObject) {
    project = new Project();

    if (spec.projectName) {
      project.name = spec.projectName;
    }

    if (spec.projectIdOnProjectObject) {
      project._id = spec.projectIdOnProjectObject;
    }
  }

  return {
    id: spec.id,
    projectId: spec.projectId ? new ObjectID(spec.projectId) : undefined,
    project: project,
    teams: (spec.teamNames || []).map((teamName: string) => {
      const team: Team = new Team();

      if (teamName) {
        team.name = teamName;
      }

      return team;
    }),
    teamMemberIds: spec.teamMemberIds || [],
    hasAcceptedInvitation: false,
    pendingTeamCount: (spec.teamMemberIds || []).length,
    joinedAt: undefined,
  };
};

describe("ProjectInvitationDisplay", () => {
  describe("getProjectName", () => {
    it("reads the name off the joined project", () => {
      expect(
        ProjectInvitationDisplay.getProjectName(
          buildInvitation({ projectName: "Acme Rockets" }),
        ),
      ).toBe("Acme Rockets");
    });

    /*
     * A project the user has not joined yet is read through a relation the
     * server may decline to expand. An id is a poor label, but it is one the
     * user can tell apart from the row above it - a blank is not.
     */
    it("falls back to the project id when the relation did not come back", () => {
      expect(
        ProjectInvitationDisplay.getProjectName(
          buildInvitation({ projectId: "project-1" }),
        ),
      ).toBe("project-1");
    });

    it("falls back to the id on the project object when there is no projectId", () => {
      expect(
        ProjectInvitationDisplay.getProjectName(
          buildInvitation({ projectIdOnProjectObject: "project-2" }),
        ),
      ).toBe("project-2");
    });

    it("is empty, not 'undefined', when there is nothing to read", () => {
      expect(ProjectInvitationDisplay.getProjectName(buildInvitation({}))).toBe(
        "",
      );
    });
  });

  describe("getInitials", () => {
    it("takes one letter from each of the first two words", () => {
      expect(ProjectInvitationDisplay.getInitials("Acme Rockets")).toBe("AR");
    });

    it("ignores words past the second", () => {
      expect(
        ProjectInvitationDisplay.getInitials("Acme Rockets Incorporated"),
      ).toBe("AR");
    });

    /*
     * A lone letter in a 44px square reads as a rendering bug rather than as a
     * monogram, so a single-word name gives up two of its own letters.
     */
    it("takes two letters from a single-word name", () => {
      expect(ProjectInvitationDisplay.getInitials("Globex")).toBe("GL");
    });

    it("uppercases whatever it took", () => {
      expect(ProjectInvitationDisplay.getInitials("acme rockets")).toBe("AR");
    });

    it("survives a single-character name", () => {
      expect(ProjectInvitationDisplay.getInitials("x")).toBe("X");
    });

    it("ignores surrounding and repeated whitespace", () => {
      expect(ProjectInvitationDisplay.getInitials("   acme   rockets  ")).toBe(
        "AR",
      );
    });

    it("treats a tab or newline between words as a word break", () => {
      expect(ProjectInvitationDisplay.getInitials("Acme\tRockets")).toBe("AR");
      expect(ProjectInvitationDisplay.getInitials("Acme\nRockets")).toBe("AR");
    });

    /*
     * Cutting by index would split the surrogate pair and paint a replacement
     * box in the avatar.
     */
    it("does not cut a leading astral character in half", () => {
      expect(ProjectInvitationDisplay.getInitials("🚀 Rockets")).toBe("🚀R");
      expect(ProjectInvitationDisplay.getInitials("🚀Rockets")).toBe("🚀R");
    });

    it("keeps non-latin scripts intact", () => {
      expect(ProjectInvitationDisplay.getInitials("東京 チーム")).toBe("東チ");
    });

    it("shows a placeholder rather than an empty square for a nameless project", () => {
      expect(ProjectInvitationDisplay.getInitials("")).toBe("?");
      expect(ProjectInvitationDisplay.getInitials("     ")).toBe("?");
    });
  });

  describe("getTeamNames", () => {
    it("names every team on the invitation", () => {
      expect(
        ProjectInvitationDisplay.getTeamNames(
          buildInvitation({ teamNames: ["Engineering", "On Call"] }),
        ),
      ).toEqual(["Engineering", "On Call"]);
    });

    /*
     * The chip count is not load-bearing - the copy that says how many teams
     * are being accepted counts memberships - so a team the select could not
     * name is dropped rather than rendered as an empty chip.
     */
    it("drops teams that came back without a name", () => {
      expect(
        ProjectInvitationDisplay.getTeamNames(
          buildInvitation({ teamNames: ["Engineering", ""] }),
        ),
      ).toEqual(["Engineering"]);
    });

    it("is empty when no team relation came back at all", () => {
      expect(
        ProjectInvitationDisplay.getTeamNames(buildInvitation({})),
      ).toEqual([]);
    });
  });

  describe("getTeamCountLabel", () => {
    /*
     * Counts memberships, not named teams: an invitation whose team relations
     * did not come back still has to say how much pressing Accept takes on.
     */
    it("counts memberships rather than named teams", () => {
      expect(
        ProjectInvitationDisplay.getTeamCountLabel(
          buildInvitation({ teamMemberIds: ["a", "b"], teamNames: [] }),
        ),
      ).toBe("2 teams");
    });

    it("is singular for one membership", () => {
      expect(
        ProjectInvitationDisplay.getTeamCountLabel(
          buildInvitation({ teamMemberIds: ["a"] }),
        ),
      ).toBe("1 team");
    });

    it("is plural for none", () => {
      expect(
        ProjectInvitationDisplay.getTeamCountLabel(buildInvitation({})),
      ).toBe("0 teams");
    });
  });

  describe("getRowKey", () => {
    it("uses the row id", () => {
      expect(
        ProjectInvitationDisplay.getRowKey(
          buildInvitation({ id: "member-1", projectId: "project-1" }),
        ),
      ).toBe("member-1");
    });

    it("falls back to the project id", () => {
      expect(
        ProjectInvitationDisplay.getRowKey(
          buildInvitation({ projectId: "project-1" }),
        ),
      ).toBe("project-1");
    });

    it("falls back to the id on the project object", () => {
      expect(
        ProjectInvitationDisplay.getRowKey(
          buildInvitation({ projectIdOnProjectObject: "project-2" }),
        ),
      ).toBe("project-2");
    });

    it("is empty when the row can be identified by nothing", () => {
      expect(ProjectInvitationDisplay.getRowKey(buildInvitation({}))).toBe("");
    });

    /*
     * The busy state of a card is held against this key, so two invitations
     * must never share one: pressing Accept on the second would spin the
     * first, and React would carry one row's state onto the other after a
     * decline reordered the list.
     */
    it("is distinct for two invitations to different projects", () => {
      const first: string = ProjectInvitationDisplay.getRowKey(
        buildInvitation({ id: "member-1" }),
      );
      const second: string = ProjectInvitationDisplay.getRowKey(
        buildInvitation({ id: "member-2" }),
      );

      expect(first).not.toBe(second);
    });
  });

  /*
   * The helpers are typed against UserProjectMembership, but every row they
   * ever see is one the grouper folded out of TeamMember rows. This is the
   * seam between the two, run end to end so a change to either side that
   * stopped filling a field these read shows up here.
   */
  describe("on rows folded from real memberships", () => {
    type BuildMembershipFunction = (spec: {
      id: string;
      projectId: string;
      projectName: string;
      teamId: string;
      teamName: string;
    }) => TeamMember;

    const buildMembership: BuildMembershipFunction = (spec: {
      id: string;
      projectId: string;
      projectName: string;
      teamId: string;
      teamName: string;
    }): TeamMember => {
      const teamMember: TeamMember = new TeamMember();
      teamMember._id = spec.id;
      teamMember.projectId = new ObjectID(spec.projectId);

      const project: Project = new Project();
      project._id = spec.projectId;
      project.name = spec.projectName;
      teamMember.project = project;

      teamMember.teamId = new ObjectID(spec.teamId);

      const team: Team = new Team();
      team._id = spec.teamId;
      team.name = spec.teamName;
      teamMember.team = team;

      teamMember.hasAcceptedInvitation = false;

      return teamMember;
    };

    it("reads a two-team invitation as one project with both teams", () => {
      const rows: Array<UserProjectMembership> =
        TeamMembersByProject.groupByProject([
          buildMembership({
            id: "member-2",
            projectId: "project-1",
            projectName: "Acme Rockets",
            teamId: "team-2",
            teamName: "On Call",
          }),
          buildMembership({
            id: "member-1",
            projectId: "project-1",
            projectName: "Acme Rockets",
            teamId: "team-1",
            teamName: "Engineering",
          }),
        ]);

      expect(rows).toHaveLength(1);

      const invitation: UserProjectMembership = rows[0]!;

      expect(ProjectInvitationDisplay.getProjectName(invitation)).toBe(
        "Acme Rockets",
      );
      expect(ProjectInvitationDisplay.getInitials("Acme Rockets")).toBe("AR");
      expect(ProjectInvitationDisplay.getTeamNames(invitation)).toEqual([
        "Engineering",
        "On Call",
      ]);
      expect(ProjectInvitationDisplay.getTeamCountLabel(invitation)).toBe(
        "2 teams",
      );
      // The lowest membership id, so the key does not depend on the order above.
      expect(ProjectInvitationDisplay.getRowKey(invitation)).toBe("member-1");
    });
  });
});
