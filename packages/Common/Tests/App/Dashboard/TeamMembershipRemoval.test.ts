import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import TeamMembershipRemoval, {
  RemovalConfirmation,
  TeamRemovalOutcome,
  TeamRemovalPlan,
} from "../../../../App/FeatureSet/Dashboard/src/Utils/TeamMembershipRemoval";
import ModelAPI, { ListResult } from "../../../UI/Utils/ModelAPI/ModelAPI";
import Team from "../../../Models/DatabaseModels/Team";
import TeamMember from "../../../Models/DatabaseModels/TeamMember";
import User from "../../../Models/DatabaseModels/User";
import { LIMIT_PER_PROJECT } from "../../../Types/Database/LimitMax";
import Email from "../../../Types/Email";
import BadDataException from "../../../Types/Exception/BadDataException";
import Name from "../../../Types/Name";
import ObjectID from "../../../Types/ObjectID";

/*
 * A user is in a project only through its teams. So on Users > View > Teams,
 * removing someone from their last team also removed them from the project -
 * and the only thing the admin was told was "Are you sure you want to delete
 * this  ? This action cannot be undone." No user, no team, no mention of the
 * project, and afterwards no sign of whether the user was still there.
 *
 * These tests pin the words that replace that sentence, and - more importantly
 * - the rule that decides which words: whether the user stays in the project,
 * loses access to it while still invited elsewhere, or leaves it altogether.
 * Getting that rule wrong is worse than the old vague dialog, because the new
 * one is specific enough to be believed.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "00000000-0000-4000-8000-000000000001",
);
const USER_ID: ObjectID = new ObjectID("00000000-0000-4000-8000-0000000000aa");

type MembershipSpec = {
  id: string;
  teamName?: string | undefined;
  accepted?: boolean | undefined;
  userName?: string | undefined;
  userEmail?: string | undefined;
  withUser?: boolean | undefined;
};

const buildUser: (name?: string, email?: string) => User = (
  name?: string,
  email?: string,
): User => {
  const user: User = new User();
  user._id = USER_ID.toString();

  if (name) {
    user.name = new Name(name);
  }

  if (email) {
    user.email = new Email(email);
  }

  return user;
};

const buildMembership: (spec: MembershipSpec) => TeamMember = (
  spec: MembershipSpec,
): TeamMember => {
  const membership: TeamMember = new TeamMember();
  membership._id = spec.id;
  membership.userId = USER_ID;
  membership.projectId = PROJECT_ID;
  membership.hasAcceptedInvitation = spec.accepted ?? true;

  if (spec.withUser !== false) {
    membership.user = buildUser(
      spec.userName ?? "Jane Doe",
      spec.userEmail ?? "jane@example.com",
    );
  }

  if (spec.teamName) {
    const team: Team = new Team();
    team._id = `team-${spec.id}`;
    team.name = spec.teamName;
    membership.team = team;
    membership.teamId = new ObjectID(`team-${spec.id}`);
  }

  return membership;
};

const planFor: (
  membershipId: string,
  memberships: Array<MembershipSpec>,
) => TeamRemovalPlan = (
  membershipId: string,
  memberships: Array<MembershipSpec>,
): TeamRemovalPlan => {
  return TeamMembershipRemoval.buildTeamRemovalPlan({
    membershipId: membershipId,
    memberships: memberships.map(buildMembership),
  });
};

describe("TeamMembershipRemoval.getUserLabel", () => {
  test("gives both the name and the email, so two people with one name can be told apart", () => {
    expect(
      TeamMembershipRemoval.getUserLabel(
        buildUser("Jane Doe", "jane@example.com"),
      ),
    ).toBe("Jane Doe (jane@example.com)");
  });

  test("falls back to the email for an invitee who has not set a name", () => {
    expect(
      TeamMembershipRemoval.getUserLabel(
        buildUser(undefined, "jane@example.com"),
      ),
    ).toBe("jane@example.com");
  });

  test("falls back to the name when no email was selected", () => {
    expect(TeamMembershipRemoval.getUserLabel(buildUser("Jane Doe"))).toBe(
      "Jane Doe",
    );
  });

  test('says "this user" rather than leaving a hole when nothing is known', () => {
    expect(TeamMembershipRemoval.getUserLabel(undefined)).toBe("this user");
    expect(TeamMembershipRemoval.getUserLabel(null)).toBe("this user");
    expect(TeamMembershipRemoval.getUserLabel(buildUser())).toBe("this user");
  });

  test("treats a whitespace-only name as no name", () => {
    expect(
      TeamMembershipRemoval.getUserLabel(buildUser("   ", "jane@example.com")),
    ).toBe("jane@example.com");
  });
});

describe("TeamMembershipRemoval.getTeamPhrase", () => {
  test('reads "the X team"', () => {
    expect(TeamMembershipRemoval.getTeamPhrase("Backend")).toBe(
      "the Backend team",
    );
  });

  test('does not say "team" twice for a team already named "... Team"', () => {
    expect(TeamMembershipRemoval.getTeamPhrase("Platform Team")).toBe(
      "the Platform Team",
    );
    expect(TeamMembershipRemoval.getTeamPhrase("sre team")).toBe(
      "the sre team",
    );
  });

  test("only drops the suffix for the whole word", () => {
    expect(TeamMembershipRemoval.getTeamPhrase("Dreamteam")).toBe(
      "the Dreamteam team",
    );
  });

  test('says "this team" when the name is unknown', () => {
    expect(TeamMembershipRemoval.getTeamPhrase(undefined)).toBe("this team");
    expect(TeamMembershipRemoval.getTeamPhrase("  ")).toBe("this team");
  });
});

describe("TeamMembershipRemoval.formatNames", () => {
  test("joins names as a sentence would", () => {
    expect(TeamMembershipRemoval.formatNames([])).toBe("");
    expect(TeamMembershipRemoval.formatNames(["Owners"])).toBe("Owners");
    expect(TeamMembershipRemoval.formatNames(["SRE", "Owners"])).toBe(
      "Owners and SRE",
    );
    expect(
      TeamMembershipRemoval.formatNames(["SRE", "Owners", "Backend"]),
    ).toBe("Backend, Owners and SRE");
  });

  test("sorts without regard to case", () => {
    expect(TeamMembershipRemoval.formatNames(["beta", "Alpha", "Gamma"])).toBe(
      "Alpha, beta and Gamma",
    );
  });

  test("drops blanks and duplicates", () => {
    expect(
      TeamMembershipRemoval.formatNames(["Owners", "", "  ", "Owners"]),
    ).toBe("Owners");
  });

  test('cuts a long list off with "and N more"', () => {
    expect(
      TeamMembershipRemoval.formatNames(["A", "B", "C", "D", "E", "F", "G"]),
    ).toBe("A, B, C, D, E and 2 more");
  });

  test("lists exactly five in full", () => {
    expect(TeamMembershipRemoval.formatNames(["A", "B", "C", "D", "E"])).toBe(
      "A, B, C, D and E",
    );
  });
});

describe("TeamMembershipRemoval.getTeamRemovalOutcome", () => {
  const outcome: (
    membershipId: string,
    memberships: Array<MembershipSpec>,
  ) => TeamRemovalOutcome = (
    membershipId: string,
    memberships: Array<MembershipSpec>,
  ): TeamRemovalOutcome => {
    return TeamMembershipRemoval.getTeamRemovalOutcome({
      membershipId: membershipId,
      memberships: memberships.map(buildMembership),
    });
  };

  // The bug report, exactly: the last team goes, and the project with it.
  test("leaves the project when the membership is the user's only one", () => {
    expect(outcome("m1", [{ id: "m1", teamName: "Members" }])).toBe(
      TeamRemovalOutcome.LeavesProject,
    );
  });

  test("leaves the project when the only membership is a pending invitation", () => {
    expect(
      outcome("m1", [{ id: "m1", teamName: "Members", accepted: false }]),
    ).toBe(TeamRemovalOutcome.LeavesProject);
  });

  test("stays in the project while another accepted membership remains", () => {
    expect(
      outcome("m1", [
        { id: "m1", teamName: "Members" },
        { id: "m2", teamName: "Owners" },
      ]),
    ).toBe(TeamRemovalOutcome.StaysInProject);
  });

  /*
   * The server takes someone off on-call duty as soon as no ACCEPTED membership
   * is left, not when no membership at all is left - a pending invitation is
   * not access.
   */
  test("loses access when the last accepted membership goes and only invitations remain", () => {
    expect(
      outcome("m1", [
        { id: "m1", teamName: "Members", accepted: true },
        { id: "m2", teamName: "Owners", accepted: false },
      ]),
    ).toBe(TeamRemovalOutcome.LosesProjectAccess);
  });

  test("stays when a pending invitation is revoked while an accepted membership remains", () => {
    expect(
      outcome("m2", [
        { id: "m1", teamName: "Members", accepted: true },
        { id: "m2", teamName: "Owners", accepted: false },
      ]),
    ).toBe(TeamRemovalOutcome.StaysInProject);
  });

  // Someone who never joined cannot lose access they never had.
  test("stays when one of several pending invitations is revoked", () => {
    expect(
      outcome("m1", [
        { id: "m1", teamName: "Members", accepted: false },
        { id: "m2", teamName: "Owners", accepted: false },
      ]),
    ).toBe(TeamRemovalOutcome.StaysInProject);
  });

  test("accepts the id as an ObjectID as well as a string", () => {
    const memberships: Array<TeamMember> = [
      buildMembership({ id: "00000000-0000-4000-8000-000000000011" }),
    ];

    expect(
      TeamMembershipRemoval.getTeamRemovalOutcome({
        membershipId: new ObjectID("00000000-0000-4000-8000-000000000011"),
        memberships: memberships,
      }),
    ).toBe(TeamRemovalOutcome.LeavesProject);
  });
});

describe("TeamMembershipRemoval.buildTeamRemovalPlan", () => {
  describe("the sentence that replaced 'delete this  ?'", () => {
    test("names the user, their email and the team", () => {
      const plan: TeamRemovalPlan = planFor("m1", [
        { id: "m1", teamName: "Members" },
        { id: "m2", teamName: "Owners" },
      ]);

      expect(plan.confirmation.description).toContain(
        "Remove Jane Doe (jane@example.com) from the Members team?",
      );
    });

    test("never leaves a blank where a name should be", () => {
      const plans: Array<TeamRemovalPlan> = [
        planFor("m1", [{ id: "m1", teamName: "Members" }]),
        planFor("m1", [{ id: "m1" }]),
        planFor("m1", [{ id: "m1", withUser: false }]),
        planFor("m1", [
          { id: "m1", teamName: "Members" },
          { id: "m2", teamName: "Owners" },
        ]),
      ];

      for (const plan of plans) {
        expect(plan.confirmation.description).not.toMatch(/this\s+\?/);
        expect(plan.confirmation.description).not.toMatch(/\s{2,}\?/);
        expect(plan.confirmation.description).not.toContain("undefined");
        expect(plan.confirmation.description).not.toContain("null");
        expect(plan.confirmation.title.trim()).not.toBe("");
        expect(plan.confirmation.submitButtonText.trim()).not.toBe("");
      }
    });

    test("falls back to generic words when the row carries no user or team", () => {
      const plan: TeamRemovalPlan = planFor("m1", [
        { id: "m1", withUser: false },
      ]);

      expect(plan.confirmation.description).toContain(
        "Remove this user from this team?",
      );
    });
  });

  describe("removing the user's only team", () => {
    const plan: () => TeamRemovalPlan = (): TeamRemovalPlan => {
      return planFor("m1", [{ id: "m1", teamName: "Members" }]);
    };

    test("says the user will be removed from the project too", () => {
      expect(plan().outcome).toBe(TeamRemovalOutcome.LeavesProject);
      expect(plan().confirmation.description).toContain(
        "This is their only team in this project, so they will also be removed from the project.",
      );
    });

    test("puts the project in the title and on the button, not only in the prose", () => {
      expect(plan().confirmation.title).toBe("Remove from Team and Project");
      expect(plan().confirmation.submitButtonText).toBe(
        "Remove from Team and Project",
      );
    });

    // "(+ impact of that)" - the second half of the report.
    test("spells out what leaving the project costs", () => {
      const description: string = plan().confirmation.description;

      expect(description).toContain("lose access to it immediately");
      expect(description).toContain(
        "taken off every on-call schedule and escalation policy",
      );
      expect(description).toContain("stop receiving its notifications");
    });

    test("says the account survives and how to move them instead", () => {
      const description: string = plan().confirmation.description;

      expect(description).toContain("Their OneUptime account is not deleted");
      expect(description).toContain("invite them back");
      expect(description).toContain(
        "To move them to a different team instead, add them to that team first.",
      );
    });

    test("describes a never-accepted invitation as such, without on-call talk", () => {
      const pending: TeamRemovalPlan = planFor("m1", [
        { id: "m1", teamName: "Members", accepted: false },
      ]);

      expect(pending.outcome).toBe(TeamRemovalOutcome.LeavesProject);
      expect(pending.confirmation.description).toContain(
        "They have not accepted this invitation yet",
      );
      expect(pending.confirmation.description).toContain(
        "also be removed from the project",
      );
      expect(pending.confirmation.description).not.toContain("on-call");
      expect(pending.confirmation.title).toBe("Remove from Team and Project");
    });

    test("uses paragraphs, which the dialog preserves", () => {
      expect(plan().confirmation.description.split("\n\n").length).toBe(3);
    });
  });

  describe("removing one of several teams", () => {
    test("says the user stays in the project, and through which teams", () => {
      const plan: TeamRemovalPlan = planFor("m1", [
        { id: "m1", teamName: "Members" },
        { id: "m2", teamName: "Owners" },
        { id: "m3", teamName: "SRE" },
      ]);

      expect(plan.outcome).toBe(TeamRemovalOutcome.StaysInProject);
      expect(plan.confirmation.description).toContain(
        "They will lose the permissions this team grants, but will stay in this project through their other teams: Owners and SRE.",
      );
      expect(plan.confirmation.title).toBe("Remove from Team");
      expect(plan.confirmation.submitButtonText).toBe("Remove from Team");
    });

    test("uses the singular for one other team", () => {
      const plan: TeamRemovalPlan = planFor("m1", [
        { id: "m1", teamName: "Members" },
        { id: "m2", teamName: "Owners" },
      ]);

      expect(plan.confirmation.description).toContain(
        "through their other team: Owners.",
      );
    });

    test("does not count pending invitations as teams that keep them in the project", () => {
      const plan: TeamRemovalPlan = planFor("m1", [
        { id: "m1", teamName: "Members", accepted: true },
        { id: "m2", teamName: "Owners", accepted: true },
        { id: "m3", teamName: "SRE", accepted: false },
      ]);

      expect(plan.confirmation.description).toContain(
        "through their other team: Owners.",
      );
      expect(plan.confirmation.description).not.toContain("SRE");
    });

    test("never mentions leaving the project", () => {
      const plan: TeamRemovalPlan = planFor("m1", [
        { id: "m1", teamName: "Members" },
        { id: "m2", teamName: "Owners" },
      ]);

      expect(plan.confirmation.description).not.toContain(
        "removed from the project",
      );
      expect(plan.confirmation.description).not.toContain("on-call");
    });

    test("still reads when the other teams' names were not loaded", () => {
      const plan: TeamRemovalPlan = planFor("m1", [
        { id: "m1", teamName: "Members" },
        { id: "m2" },
      ]);

      expect(plan.confirmation.description).toContain(
        "will stay in this project through their other team.",
      );
    });

    test("revoking a pending invitation says so, and that they stay", () => {
      const plan: TeamRemovalPlan = planFor("m2", [
        { id: "m1", teamName: "Owners", accepted: true },
        { id: "m2", teamName: "Members", accepted: false },
      ]);

      expect(plan.outcome).toBe(TeamRemovalOutcome.StaysInProject);
      expect(plan.confirmation.description).toContain(
        "They have not accepted this invitation yet. They will stay in this project through their other team: Owners.",
      );
    });

    test("revoking one of several invitations says the others still stand", () => {
      const plan: TeamRemovalPlan = planFor("m1", [
        { id: "m1", teamName: "Members", accepted: false },
        { id: "m2", teamName: "Owners", accepted: false },
      ]);

      expect(plan.confirmation.description).toContain(
        "They have not accepted this invitation yet. They will still be invited to Owners in this project.",
      );
    });
  });

  describe("removing the last accepted team while invitations remain", () => {
    const plan: () => TeamRemovalPlan = (): TeamRemovalPlan => {
      return planFor("m1", [
        { id: "m1", teamName: "Members", accepted: true },
        { id: "m2", teamName: "Owners", accepted: false },
        { id: "m3", teamName: "SRE", accepted: false },
      ]);
    };

    test("says access to the project goes, and what that costs", () => {
      expect(plan().outcome).toBe(TeamRemovalOutcome.LosesProjectAccess);
      expect(plan().confirmation.description).toContain(
        "they will lose access to the project immediately",
      );
      expect(plan().confirmation.description).toContain(
        "taken off every on-call schedule and escalation policy",
      );
    });

    test("says they are still listed as invited, and to which teams", () => {
      expect(plan().confirmation.description).toContain(
        "They will stay listed as invited to Owners and SRE, and will get access back if they accept.",
      );
    });

    // They do NOT leave the Users list, so the title must not claim so.
    test("does not claim they leave the project", () => {
      expect(plan().confirmation.title).toBe("Remove from Team");
      expect(plan().confirmation.description).not.toContain(
        "removed from the project",
      );
    });
  });

  describe("a row that is no longer in the fetched list", () => {
    test("takes the user and team from the clicked row", () => {
      const clicked: TeamMember = buildMembership({
        id: "gone",
        teamName: "Members",
        userName: "Sam Smith",
        userEmail: "sam@example.com",
      });

      const plan: TeamRemovalPlan = TeamMembershipRemoval.buildTeamRemovalPlan({
        membershipId: "gone",
        memberships: [
          buildMembership({
            id: "m2",
            teamName: "Owners",
            userName: "Sam Smith",
            userEmail: "sam@example.com",
          }),
        ],
        fallbackMembership: clicked,
      });

      expect(plan.confirmation.description).toContain(
        "Remove Sam Smith (sam@example.com) from the Members team?",
      );
    });

    test("finds the user on another membership when the clicked row has none", () => {
      const clicked: TeamMember = buildMembership({
        id: "m1",
        teamName: "Members",
        withUser: false,
      });

      const plan: TeamRemovalPlan = TeamMembershipRemoval.buildTeamRemovalPlan({
        membershipId: "m1",
        memberships: [
          clicked,
          buildMembership({
            id: "m2",
            teamName: "Owners",
            userName: "Sam Smith",
            userEmail: "sam@example.com",
          }),
        ],
      });

      expect(plan.confirmation.description).toContain(
        "Remove Sam Smith (sam@example.com) from the Members team?",
      );
    });
  });
});

describe("TeamMembershipRemoval.buildProjectRemovalConfirmation", () => {
  const confirm: (
    teamNames: Array<string>,
    hasJoined?: boolean,
  ) => RemovalConfirmation = (
    teamNames: Array<string>,
    hasJoined: boolean = true,
  ): RemovalConfirmation => {
    return TeamMembershipRemoval.buildProjectRemovalConfirmation({
      user: buildUser("Jane Doe", "jane@example.com"),
      teamNames: teamNames,
      hasJoined: hasJoined,
    });
  };

  test("names the user and the project", () => {
    expect(confirm(["Owners"]).description).toContain(
      "Remove Jane Doe (jane@example.com) from this project?",
    );
  });

  test("names every team the user will be removed from", () => {
    expect(confirm(["SRE", "Owners", "Backend"]).description).toContain(
      "They will be removed from all 3 of their teams (Backend, Owners and SRE).",
    );
  });

  test("names a single team without a count", () => {
    expect(confirm(["Owners"]).description).toContain(
      "They will be removed from the Owners team.",
    );
  });

  test("still reads when no team names are known", () => {
    expect(confirm([]).description).toContain(
      "They will be removed from every team they belong to.",
    );
  });

  test("counts distinct teams, not memberships", () => {
    expect(confirm(["Owners", "Owners", "SRE"]).description).toContain(
      "all 2 of their teams (Owners and SRE)",
    );
  });

  test("spells out the impact and that the account survives", () => {
    const description: string = confirm(["Owners"]).description;

    expect(description).toContain("lose access to it immediately");
    expect(description).toContain(
      "taken off every on-call schedule and escalation policy",
    );
    expect(description).toContain("stop receiving its notifications");
    expect(description).toContain("Their OneUptime account is not deleted");
  });

  test("says Remove from Project, not Delete", () => {
    const confirmation: RemovalConfirmation = confirm(["Owners"]);

    expect(confirmation.title).toBe("Remove from Project");
    expect(confirmation.submitButtonText).toBe("Remove from Project");
  });

  describe("for someone who never accepted an invitation", () => {
    test("says their invitation is cancelled, and to which team", () => {
      const description: string = confirm(["Owners"], false).description;

      expect(description).toContain(
        "They have not accepted an invitation to this project yet.",
      );
      expect(description).toContain(
        "Removing them cancels their invitation to the Owners team",
      );
      expect(description).not.toContain("on-call");
    });

    test("counts several invitations", () => {
      expect(confirm(["Owners", "SRE"], false).description).toContain(
        "cancels their invitations to 2 teams (Owners and SRE)",
      );
    });

    test("still reads with no team names", () => {
      expect(confirm([], false).description).toContain(
        "cancels their invitation to this project",
      );
    });
  });
});

/*
 * ModelAPI's statics are spied rather than the module mocked, as in the
 * ProjectUsersModelAPI suite: the util calls them by name.
 */
interface Spy {
  mockResolvedValue: (value: unknown) => Spy;
  mockResolvedValueOnce: (value: unknown) => Spy;
  mock: { calls: Array<Array<unknown>> };
}

describe("TeamMembershipRemoval fetching", () => {
  let getListSpy: Spy;
  let getItemSpy: Spy;
  let countSpy: Spy;

  const asList: (memberships: Array<TeamMember>) => ListResult<TeamMember> = (
    memberships: Array<TeamMember>,
  ): ListResult<TeamMember> => {
    return {
      data: memberships,
      count: memberships.length,
      skip: 0,
      limit: LIMIT_PER_PROJECT,
    };
  };

  type ListArgs = {
    query: Record<string, unknown>;
    select: Record<string, unknown>;
    limit: number;
    skip: number;
  };

  const listArgs: (index: number) => ListArgs = (index: number): ListArgs => {
    return getListSpy.mock.calls[index]![0] as ListArgs;
  };

  beforeEach(() => {
    getListSpy = jest.spyOn(ModelAPI, "getList") as unknown as Spy;
    getItemSpy = jest.spyOn(ModelAPI, "getItem") as unknown as Spy;
    countSpy = jest.spyOn(ModelAPI, "count") as unknown as Spy;
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe("fetchUserMemberships", () => {
    test("reads every membership of that user in this project, with team and user names", async () => {
      const memberships: Array<TeamMember> = [
        buildMembership({ id: "m1", teamName: "Owners" }),
      ];
      getListSpy.mockResolvedValue(asList(memberships));

      const result: Array<TeamMember> =
        await TeamMembershipRemoval.fetchUserMemberships({
          userId: USER_ID,
          projectId: PROJECT_ID,
        });

      expect(result).toBe(memberships);
      expect(getListSpy.mock.calls).toHaveLength(1);

      const args: ListArgs = listArgs(0);
      expect(args.query["userId"]).toBe(USER_ID);
      expect(args.query["projectId"]).toBe(PROJECT_ID);
      expect(args.select["hasAcceptedInvitation"]).toBe(true);
      expect(args.select["team"]).toEqual({ _id: true, name: true });
      expect(args.select["user"]).toEqual({
        _id: true,
        name: true,
        email: true,
      });
    });

    // The old Remove from Project read limit: 1 - and removed only that one.
    test("does not stop at the first membership", async () => {
      getListSpy.mockResolvedValue(asList([]));

      await TeamMembershipRemoval.fetchUserMemberships({
        userId: USER_ID,
        projectId: PROJECT_ID,
      });

      expect(listArgs(0).limit).toBe(LIMIT_PER_PROJECT);
      expect(listArgs(0).skip).toBe(0);
    });
  });

  describe("isUserStillInProject", () => {
    test("is true while any membership - accepted or pending - remains", async () => {
      countSpy.mockResolvedValue(1);

      await expect(
        TeamMembershipRemoval.isUserStillInProject({
          userId: USER_ID,
          projectId: PROJECT_ID,
        }),
      ).resolves.toBe(true);

      const args: { query: Record<string, unknown> } = countSpy.mock
        .calls[0]![0] as { query: Record<string, unknown> };

      expect(args.query).toEqual({ userId: USER_ID, projectId: PROJECT_ID });
      // Not filtered to accepted: a pending invite keeps them on the Users list.
      expect(args.query["hasAcceptedInvitation"]).toBeUndefined();
    });

    test("is false once nothing remains", async () => {
      countSpy.mockResolvedValue(0);

      await expect(
        TeamMembershipRemoval.isUserStillInProject({
          userId: USER_ID,
          projectId: PROJECT_ID,
        }),
      ).resolves.toBe(false);
    });
  });

  describe("getTeamRemovalPlan", () => {
    test("uses the user id the page already knows, without an extra lookup", async () => {
      getListSpy.mockResolvedValue(
        asList([buildMembership({ id: "m1", teamName: "Members" })]),
      );

      const clicked: TeamMember = new TeamMember();
      clicked._id = "m1";

      const plan: TeamRemovalPlan =
        await TeamMembershipRemoval.getTeamRemovalPlan({
          membership: clicked,
          userId: USER_ID,
          projectId: PROJECT_ID,
        });

      expect(getItemSpy.mock.calls).toHaveLength(0);
      expect(listArgs(0).query["userId"]).toBe(USER_ID);
      expect(plan.outcome).toBe(TeamRemovalOutcome.LeavesProject);
    });

    test("reads the user id off the row when it has one", async () => {
      getListSpy.mockResolvedValue(
        asList([
          buildMembership({ id: "m1", teamName: "Members" }),
          buildMembership({ id: "m2", teamName: "Owners" }),
        ]),
      );

      const clicked: TeamMember = buildMembership({ id: "m1" });

      const plan: TeamRemovalPlan =
        await TeamMembershipRemoval.getTeamRemovalPlan({
          membership: clicked,
          projectId: PROJECT_ID,
        });

      expect(getItemSpy.mock.calls).toHaveLength(0);
      expect(listArgs(0).query["userId"]).toBe(USER_ID);
      expect(listArgs(0).query["projectId"]).toBe(PROJECT_ID);
      expect(plan.outcome).toBe(TeamRemovalOutcome.StaysInProject);
    });

    test("reads the user id off the row's user when userId was not selected", async () => {
      getListSpy.mockResolvedValue(asList([]));

      const clicked: TeamMember = new TeamMember();
      clicked._id = "m1";
      clicked.user = buildUser("Jane Doe");

      await TeamMembershipRemoval.getTeamRemovalPlan({
        membership: clicked,
        projectId: PROJECT_ID,
      });

      expect(getItemSpy.mock.calls).toHaveLength(0);
      expect((listArgs(0).query["userId"] as ObjectID).toString()).toBe(
        USER_ID.toString(),
      );
    });

    test("asks the membership for its user when the row carries none", async () => {
      const lookedUp: TeamMember = new TeamMember();
      lookedUp._id = "m1";
      lookedUp.userId = USER_ID;
      getItemSpy.mockResolvedValue(lookedUp);
      getListSpy.mockResolvedValue(
        asList([buildMembership({ id: "m1", teamName: "Members" })]),
      );

      const clicked: TeamMember = new TeamMember();
      clicked._id = "m1";

      await TeamMembershipRemoval.getTeamRemovalPlan({
        membership: clicked,
        projectId: PROJECT_ID,
      });

      expect(getItemSpy.mock.calls).toHaveLength(1);
      const lookup: { id: ObjectID; select: Record<string, unknown> } =
        getItemSpy.mock.calls[0]![0] as {
          id: ObjectID;
          select: Record<string, unknown>;
        };
      expect(lookup.id.toString()).toBe("m1");
      expect(lookup.select["userId"]).toBe(true);
      expect(listArgs(0).query["userId"]).toBe(USER_ID);
    });

    test("refuses, rather than guessing, when the user cannot be found", async () => {
      getItemSpy.mockResolvedValue(null);

      const clicked: TeamMember = new TeamMember();
      clicked._id = "m1";

      await expect(
        TeamMembershipRemoval.getTeamRemovalPlan({
          membership: clicked,
          projectId: PROJECT_ID,
        }),
      ).rejects.toBeInstanceOf(BadDataException);

      expect(getListSpy.mock.calls).toHaveLength(0);
    });

    test("refuses a row with no id", async () => {
      await expect(
        TeamMembershipRemoval.getTeamRemovalPlan({
          membership: new TeamMember(),
          userId: USER_ID,
          projectId: PROJECT_ID,
        }),
      ).rejects.toBeInstanceOf(BadDataException);
    });
  });
});
