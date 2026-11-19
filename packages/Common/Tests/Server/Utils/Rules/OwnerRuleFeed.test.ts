import Team from "../../../../Models/DatabaseModels/Team";
import User from "../../../../Models/DatabaseModels/User";
import TeamService from "../../../../Server/Services/TeamService";
import UserService from "../../../../Server/Services/UserService";
import logger from "../../../../Server/Utils/Logger";
import OwnerRuleAssignment, {
  OwnerAddOutcome,
  OwnerNotAdded,
  OwnersAdded,
} from "../../../../Server/Utils/Rules/OwnerRuleAssignment";
import OwnerRuleFeed from "../../../../Server/Utils/Rules/OwnerRuleFeed";
import RuleFeedMarkdown from "../../../../Server/Utils/Rules/RuleFeedMarkdown";
import { RuleApplicationResultUtil } from "../../../../Server/Utils/Rules/RuleRun/RuleApplication";
import PendingInviteeProfiles, {
  WithheldProfile,
} from "../../../../Server/Utils/TeamMember/PendingInviteeProfiles";
import Email from "../../../../Types/Email";
import Name from "../../../../Types/Name";
import ObjectID from "../../../../Types/ObjectID";
import FeedMarkdown, { mdText } from "../../../../Utils/Markdown/FeedMarkdown";
import { afterEach, describe, expect, jest, test } from "@jest/globals";
import type { SpyInstance } from "jest-mock";

/*
 * #9933: an owner rule's feed item named as assigned every owner its rules
 * asked for, though createOwner skips a user who is not a member of the
 * project and a team that is not one of its teams. The words of what a rule
 * did are written here now, from what addOwners actually did (OwnersAdded):
 * the owners added under "Assigned the following owners", and the ones it
 * skipped apart, each with why. Who is named, and how, follows #9823: someone
 * only invited by the name typed for them, else their address; a team of
 * another project never by its name.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "22222222-2222-4222-8222-222222222222",
);

function user(id: string, name: string, email: string): User {
  const item: User = new User();
  item._id = id;
  item.id = new ObjectID(id);
  item.name = new Name(name);
  item.email = new Email(email);
  return item;
}

function team(id: string, name: string): Team {
  const item: Team = new Team();
  item._id = id;
  item.id = new ObjectID(id);
  item.name = name;
  return item;
}

const ADA: User = user(
  "11111111-1111-4111-8111-111111111111",
  "Ada Lovelace",
  "ada@example.com",
);
const BOB: User = user(
  "33333333-3333-4333-8333-333333333333",
  "Bob Departed",
  "bob@example.com",
);
const CAROL: User = user(
  "44444444-4444-4444-8444-444444444444",
  "Carol Ownname",
  "carol@example.com",
);
const PLATFORM: Team = team("55555555-5555-4555-8555-555555555555", "Platform");
const FOREIGN_TEAM_ID: ObjectID = new ObjectID(
  "66666666-6666-4666-8666-666666666666",
);

function skipped(
  ownerColumn: "userId" | "teamId",
  id: ObjectID,
  reason: OwnerNotAdded["reason"],
): OwnerNotAdded {
  return { ownerColumn, id, reason };
}

// Carol is only invited: the name typed for her is "Carol".
function carolIsInvited(): Map<string, WithheldProfile> {
  return new Map([
    [CAROL.id!.toString().toLowerCase(), { inviteeName: "Carol" }],
  ]);
}

afterEach(() => {
  jest.restoreAllMocks();
});

describe("RuleFeedMarkdown.ownersNotAddedList", () => {
  test("names a person who left by their name, and says why", () => {
    expect(
      RuleFeedMarkdown.ownersNotAddedList({
        notAdded: [
          skipped("userId", BOB.id!, OwnerAddOutcome.NotProjectMember),
        ],
        users: [BOB],
      }).toString(),
    ).toBe("- 👤 Bob Departed, who is not a member of this project");
  });

  test("names someone only invited by the name typed for them, never their account's", () => {
    const list: string = RuleFeedMarkdown.ownersNotAddedList({
      notAdded: [
        skipped("userId", CAROL.id!, OwnerAddOutcome.NotProjectMember),
      ],
      users: [CAROL],
      withheld: carolIsInvited(),
    }).toString();

    expect(list).toBe(
      "- 👤 Carol, who has not accepted the invitation to this project yet",
    );
    expect(list).not.toContain("Ownname");
  });

  test("names someone only invited with no typed name by their address", () => {
    expect(
      RuleFeedMarkdown.ownersNotAddedList({
        notAdded: [
          skipped("userId", CAROL.id!, OwnerAddOutcome.NotProjectMember),
        ],
        users: [CAROL],
        withheld: new Map([
          [CAROL.id!.toString().toLowerCase(), { inviteeName: null }],
        ]),
      }).toString(),
    ).toBe(
      "- 👤 carol@example.com, who has not accepted the invitation to this project yet",
    );
  });

  test("never names a team that is not the project's: only its id, which the rule holds", () => {
    const list: string = RuleFeedMarkdown.ownersNotAddedList({
      notAdded: [
        skipped("teamId", FOREIGN_TEAM_ID, OwnerAddOutcome.NotProjectRecord),
      ],
      users: [],
    }).toString();

    expect(list).toBe(
      `- 👥 A team that is not one of this project's teams (\`${FOREIGN_TEAM_ID.toString()}\`)`,
    );
  });

  test("a user the owner service refused as not the project's is not a member", () => {
    expect(
      RuleFeedMarkdown.ownersNotAddedList({
        notAdded: [
          skipped("userId", BOB.id!, OwnerAddOutcome.NotProjectRecord),
        ],
        users: [BOB],
      }).toString(),
    ).toBe("- 👤 Bob Departed, who is not a member of this project");
  });

  test("an account that is gone is an Unknown User", () => {
    expect(
      RuleFeedMarkdown.ownersNotAddedList({
        notAdded: [
          skipped("userId", BOB.id!, OwnerAddOutcome.NotProjectMember),
        ],
        users: [],
      }).toString(),
    ).toBe("- 👤 Unknown User, who is not a member of this project");
  });

  test("lists people first, then teams, as the owners added are listed - each in the order given", () => {
    expect(
      RuleFeedMarkdown.ownersNotAddedList({
        notAdded: [
          skipped("teamId", FOREIGN_TEAM_ID, OwnerAddOutcome.NotProjectRecord),
          skipped("userId", CAROL.id!, OwnerAddOutcome.NotProjectMember),
          skipped("userId", BOB.id!, OwnerAddOutcome.NotProjectMember),
        ],
        users: [BOB, CAROL],
        withheld: carolIsInvited(),
      })
        .toString()
        .split("\n"),
    ).toEqual([
      "- 👤 Carol, who has not accepted the invitation to this project yet",
      "- 👤 Bob Departed, who is not a member of this project",
      `- 👥 A team that is not one of this project's teams (\`${FOREIGN_TEAM_ID.toString()}\`)`,
    ]);
  });

  test("a name is text: it cannot restyle the feed, link anywhere or mention anyone", () => {
    const sly: User = user(
      "77777777-7777-4777-8777-777777777777",
      "**Bob** [x](http://e.com) <!channel>",
      "sly@example.com",
    );

    const list: string = RuleFeedMarkdown.ownersNotAddedList({
      notAdded: [skipped("userId", sly.id!, OwnerAddOutcome.NotProjectMember)],
      users: [sly],
    }).toString();

    expect(list).not.toContain("**Bob**");
    expect(list).not.toContain("[x](http://e.com)");
    expect(list).not.toContain("<!channel>");
  });

  test("is Markdown a feed can place as it is", () => {
    expect(
      FeedMarkdown.isMarkdownText(
        RuleFeedMarkdown.ownersNotAddedList({ notAdded: [], users: [] }),
      ),
    ).toBe(true);
  });
});

describe("OwnerRuleFeed.getOutcome", () => {
  function outcome(data: Partial<OwnersAdded>): OwnersAdded {
    return { ...OwnerRuleAssignment.noOwnersAdded(), ...data };
  }

  test("names the owners added, and nothing else, when none was skipped", () => {
    expect(
      OwnerRuleFeed.getOutcome({
        recordNoun: "incident",
        outcome: outcome({ userIds: [ADA.id!], teamIds: [PLATFORM.id!] }),
        addedUsers: [ADA],
        addedTeams: [PLATFORM],
        skippedUsers: [],
      }).toString(),
    ).toBe(
      "Assigned the following owners to the incident:\n- 👤 Ada Lovelace\n- 👥 Platform",
    );
  });

  test("says owner in the singular for one", () => {
    expect(
      OwnerRuleFeed.getOutcome({
        recordNoun: "alert",
        outcome: outcome({ userIds: [ADA.id!] }),
        addedUsers: [ADA],
        addedTeams: [],
        skippedUsers: [],
      }).toString(),
    ).toBe("Assigned the following owner to the alert:\n- 👤 Ada Lovelace");
  });

  test("lists the skipped apart, after the owners added and their notes", () => {
    expect(
      OwnerRuleFeed.getOutcome({
        recordNoun: "incident",
        outcome: outcome({
          userIds: [ADA.id!],
          notAdded: [
            skipped("userId", BOB.id!, OwnerAddOutcome.NotProjectMember),
            skipped(
              "teamId",
              FOREIGN_TEAM_ID,
              OwnerAddOutcome.NotProjectRecord,
            ),
          ],
        }),
        addedUsers: [ADA],
        addedTeams: [],
        skippedUsers: [BOB],
        notesOnAdded: mdText`\n\n_Some owners were inherited from the incident's monitors._`,
      }).toString(),
    ).toBe(
      [
        "Assigned the following owner to the incident:",
        "- 👤 Ada Lovelace",
        "",
        "_Some owners were inherited from the incident's monitors._",
        "",
        "Did not assign the following owners to the incident:",
        "- 👤 Bob Departed, who is not a member of this project",
        `- 👥 A team that is not one of this project's teams (\`${FOREIGN_TEAM_ID.toString()}\`)`,
      ].join("\n"),
    );
  });

  test("with nothing added, says only who was skipped - never that it assigned anyone", () => {
    const said: string = OwnerRuleFeed.getOutcome({
      recordNoun: "episode",
      outcome: outcome({
        notAdded: [
          skipped("userId", BOB.id!, OwnerAddOutcome.NotProjectMember),
        ],
      }),
      addedUsers: [],
      addedTeams: [],
      skippedUsers: [BOB],
      // A note about owners added has nothing to be about.
      notesOnAdded: mdText`\n\n_Some owners were inherited from the episode's monitors._`,
    }).toString();

    expect(said).toBe(
      "Did not assign the following owner to the episode:\n- 👤 Bob Departed, who is not a member of this project",
    );
  });

  test("names an added owner whose row is gone as no named owner, as before", () => {
    expect(
      OwnerRuleFeed.getOutcome({
        recordNoun: "monitor",
        outcome: outcome({ userIds: [ADA.id!] }),
        addedUsers: [],
        addedTeams: [],
        skippedUsers: [],
      }).toString(),
    ).toBe(
      "Assigned the following owners to the monitor:\n- (no named owners)",
    );
  });

  test("says nothing when the rules added and skipped nobody", () => {
    expect(
      OwnerRuleFeed.getOutcome({
        recordNoun: "event",
        outcome: outcome({}),
        addedUsers: [],
        addedTeams: [],
        skippedUsers: [],
      }).toString(),
    ).toBe("");
  });
});

describe("OwnerRuleFeed.readOutcome", () => {
  test("reads the people added and skipped once, the teams added once, and never a skipped team", async () => {
    const users: SpyInstance<typeof UserService.findBy> = jest
      .spyOn(UserService, "findBy")
      .mockResolvedValue([ADA, BOB, CAROL]);
    const teams: SpyInstance<typeof TeamService.findBy> = jest
      .spyOn(TeamService, "findBy")
      .mockResolvedValue([PLATFORM]);
    const withheld: SpyInstance<
      typeof PendingInviteeProfiles.readWithheldProfilesInProject
    > = jest
      .spyOn(PendingInviteeProfiles, "readWithheldProfilesInProject")
      .mockResolvedValue(carolIsInvited());

    const said: string = (
      await OwnerRuleFeed.readOutcome({
        projectId: PROJECT_ID,
        recordNoun: "incident",
        outcome: {
          userIds: [ADA.id!],
          teamIds: [PLATFORM.id!],
          notAdded: [
            skipped("userId", BOB.id!, OwnerAddOutcome.NotProjectMember),
            skipped("userId", CAROL.id!, OwnerAddOutcome.NotProjectMember),
            skipped(
              "teamId",
              FOREIGN_TEAM_ID,
              OwnerAddOutcome.NotProjectRecord,
            ),
          ],
        },
      })
    ).toString();

    expect(said).toBe(
      [
        "Assigned the following owners to the incident:",
        "- 👤 Ada Lovelace",
        "- 👥 Platform",
        "",
        "Did not assign the following owners to the incident:",
        "- 👤 Bob Departed, who is not a member of this project",
        "- 👤 Carol, who has not accepted the invitation to this project yet",
        `- 👥 A team that is not one of this project's teams (\`${FOREIGN_TEAM_ID.toString()}\`)`,
      ].join("\n"),
    );

    expect(users).toHaveBeenCalledTimes(1);
    expect(teams).toHaveBeenCalledTimes(1);
    expect(withheld).toHaveBeenCalledTimes(1);

    // The teams read are the ones added: another project's is never read.
    const teamQuery: string = JSON.stringify(teams.mock.calls[0]![0].query);
    expect(teamQuery).toContain(PLATFORM.id!.toString());
    expect(teamQuery).not.toContain(FOREIGN_TEAM_ID.toString());

    // Read as OneUptime, for the project the record is in.
    expect(users.mock.calls[0]![0].props).toEqual({ isRoot: true });
    expect(String(withheld.mock.calls[0]![0].projectId)).toBe(
      PROJECT_ID.toString(),
    );
    expect(withheld.mock.calls[0]![0].userIds).toEqual([
      ADA.id!.toString(),
      BOB.id!.toString(),
      CAROL.id!.toString(),
    ]);
  });

  test("an added person only invited is named by the name typed for them too", async () => {
    jest.spyOn(UserService, "findBy").mockResolvedValue([CAROL]);
    jest
      .spyOn(PendingInviteeProfiles, "readWithheldProfilesInProject")
      .mockResolvedValue(carolIsInvited());

    const said: string = (
      await OwnerRuleFeed.readOutcome({
        projectId: PROJECT_ID,
        recordNoun: "alert",
        outcome: {
          userIds: [CAROL.id!],
          teamIds: [],
          notAdded: [],
        },
      })
    ).toString();

    expect(said).toBe("Assigned the following owner to the alert:\n- 👤 Carol");
  });

  test("reads nobody when there is nobody to name", async () => {
    const users: SpyInstance<typeof UserService.findBy> = jest.spyOn(
      UserService,
      "findBy",
    );
    const teams: SpyInstance<typeof TeamService.findBy> = jest.spyOn(
      TeamService,
      "findBy",
    );

    const said: string = (
      await OwnerRuleFeed.readOutcome({
        projectId: PROJECT_ID,
        recordNoun: "alert",
        outcome: {
          userIds: [],
          teamIds: [],
          notAdded: [
            skipped(
              "teamId",
              FOREIGN_TEAM_ID,
              OwnerAddOutcome.NotProjectRecord,
            ),
          ],
        },
      })
    ).toString();

    expect(users).not.toHaveBeenCalled();
    expect(teams).not.toHaveBeenCalled();
    expect(said).toContain("Did not assign the following owner to the alert:");
  });
});

describe("OwnerRuleFeed.getResult", () => {
  test("counts the owners added", () => {
    expect(
      OwnerRuleFeed.getResult({
        userIds: [ADA.id!],
        teamIds: [PLATFORM.id!],
        notAdded: [
          skipped("userId", BOB.id!, OwnerAddOutcome.NotProjectMember),
        ],
      }),
    ).toEqual(RuleApplicationResultUtil.updated(2));
  });

  test("is a record the run could not update when every owner was skipped: never 'already applied'", () => {
    expect(
      OwnerRuleFeed.getResult({
        userIds: [],
        teamIds: [],
        notAdded: [
          skipped("userId", BOB.id!, OwnerAddOutcome.NotProjectMember),
        ],
      }),
    ).toEqual(RuleApplicationResultUtil.failed());
  });

  test("is already applied when there was nothing to add and nobody was skipped", () => {
    expect(
      OwnerRuleFeed.getResult(OwnerRuleAssignment.noOwnersAdded()),
    ).toEqual(RuleApplicationResultUtil.alreadyApplied());
  });
});

describe("OwnerRuleFeed.log", () => {
  test("says how many were added, and which were skipped and why, by id alone", () => {
    const debug: SpyInstance<typeof logger.debug> = jest
      .spyOn(logger, "debug")
      .mockImplementation((() => {
        // asserted below
      }) as never);
    const warn: SpyInstance<typeof logger.warn> = jest
      .spyOn(logger, "warn")
      .mockImplementation((() => {
        // asserted below
      }) as never);

    OwnerRuleFeed.log({
      engine: "IncidentOwnerRuleEngine",
      record: "incident abc",
      outcome: {
        userIds: [ADA.id!],
        teamIds: [],
        notAdded: [
          skipped("userId", BOB.id!, OwnerAddOutcome.NotProjectMember),
          skipped("teamId", FOREIGN_TEAM_ID, OwnerAddOutcome.NotProjectRecord),
        ],
      },
      logAttributes: { projectId: PROJECT_ID.toString() },
    });

    expect(String(debug.mock.calls[0]![0])).toBe(
      "IncidentOwnerRuleEngine added 1 owner to incident abc",
    );
    expect(String(warn.mock.calls[0]![0])).toBe(
      `IncidentOwnerRuleEngine did not add 2 of the owners its rules name to incident abc: user ${BOB.id!.toString()} (NotProjectMember), team ${FOREIGN_TEAM_ID.toString()} (NotProjectRecord)`,
    );
    expect(String(warn.mock.calls[0]![0])).not.toContain("Bob");
  });

  test("warns of nothing when nobody was skipped", () => {
    jest.spyOn(logger, "debug").mockImplementation((() => {
      // not asserted
    }) as never);
    const warn: SpyInstance<typeof logger.warn> = jest
      .spyOn(logger, "warn")
      .mockImplementation((() => {
        // asserted below
      }) as never);

    OwnerRuleFeed.log({
      engine: "AlertOwnerRuleEngine",
      record: "alert abc",
      outcome: {
        userIds: [ADA.id!],
        teamIds: [],
        notAdded: [],
      },
      logAttributes: {},
    });

    expect(warn).not.toHaveBeenCalled();
  });
});

describe("OwnerRuleFeed.logSkipped", () => {
  test("warns of the owners skipped, by id, and says nothing of those added", () => {
    const debug: SpyInstance<typeof logger.debug> = jest
      .spyOn(logger, "debug")
      .mockImplementation((() => {
        // asserted below
      }) as never);
    const warn: SpyInstance<typeof logger.warn> = jest
      .spyOn(logger, "warn")
      .mockImplementation((() => {
        // asserted below
      }) as never);

    OwnerRuleFeed.logSkipped({
      engine: "HostOwnerRuleEngine",
      record: "host abc",
      outcome: {
        userIds: [ADA.id!],
        teamIds: [],
        notAdded: [
          skipped("userId", BOB.id!, OwnerAddOutcome.NotProjectMember),
        ],
      },
      logAttributes: { projectId: PROJECT_ID.toString() },
    });

    expect(debug).not.toHaveBeenCalled();
    expect(String(warn.mock.calls[0]![0])).toBe(
      `HostOwnerRuleEngine did not add 1 of the owners its rules name to host abc: user ${BOB.id!.toString()} (NotProjectMember)`,
    );
  });

  test("says nothing when nobody was skipped", () => {
    const warn: SpyInstance<typeof logger.warn> = jest
      .spyOn(logger, "warn")
      .mockImplementation((() => {
        // asserted below
      }) as never);

    OwnerRuleFeed.logSkipped({
      engine: "HostOwnerRuleEngine",
      record: "host abc",
      outcome: OwnerRuleAssignment.noOwnersAdded(),
      logAttributes: {},
    });

    expect(warn).not.toHaveBeenCalled();
  });
});

/*
 * The rules a resource's feed item credits - "Owners were added to
 * <resource> by 2 owner rules" - are the ones that brought an owner the run
 * added (#9933): never a rule whose every owner was skipped, or was there
 * already.
 */
describe("OwnerRuleFeed.getRulesThatAdded", () => {
  interface FakeRule {
    name: string;
    ownerUsers?: Array<{ id: ObjectID | null }> | undefined;
    ownerTeams?: Array<{ id: ObjectID | null }> | undefined;
  }

  function fakeRule(
    name: string,
    users: Array<ObjectID>,
    teams: Array<ObjectID>,
  ): FakeRule {
    return {
      name: name,
      ownerUsers: users.map((id: ObjectID): { id: ObjectID } => {
        return { id };
      }),
      ownerTeams: teams.map((id: ObjectID): { id: ObjectID } => {
        return { id };
      }),
    };
  }

  function namesOf(rules: Array<FakeRule>): Array<string> {
    return rules.map((rule: FakeRule): string => {
      return rule.name;
    });
  }

  test("keeps the rules that name an owner added, in their order, and drops the rest", () => {
    const rules: Array<FakeRule> = [
      fakeRule("Names Ada", [ADA.id!], []),
      fakeRule("Names Bob, who left", [BOB.id!], []),
      fakeRule("Names Platform", [], [PLATFORM.id!]),
      fakeRule("Names another project's team", [], [FOREIGN_TEAM_ID]),
    ];

    expect(
      namesOf(
        OwnerRuleFeed.getRulesThatAdded(rules, {
          userIds: [ADA.id!],
          teamIds: [PLATFORM.id!],
        }),
      ),
    ).toEqual(["Names Ada", "Names Platform"]);
  });

  test("credits every rule that names one owner added, and a rule for any one of its owners", () => {
    const rules: Array<FakeRule> = [
      fakeRule("First", [ADA.id!], []),
      fakeRule("Second", [ADA.id!], []),
      fakeRule("Ada and Bob", [BOB.id!, ADA.id!], []),
    ];

    expect(
      namesOf(
        OwnerRuleFeed.getRulesThatAdded(rules, {
          userIds: [ADA.id!],
          teamIds: [],
        }),
      ),
    ).toEqual(["First", "Second", "Ada and Bob"]);
  });

  test("credits nobody when nothing was added", () => {
    expect(
      OwnerRuleFeed.getRulesThatAdded(
        [fakeRule("Names Ada", [ADA.id!], [PLATFORM.id!])],
        { userIds: [], teamIds: [] },
      ),
    ).toEqual([]);
  });

  test("never takes a user's id for a team's", () => {
    // The same id added as a user does not credit a rule naming it as a team.
    expect(
      OwnerRuleFeed.getRulesThatAdded([fakeRule("Team", [], [ADA.id!])], {
        userIds: [ADA.id!],
        teamIds: [],
      }),
    ).toEqual([]);
  });

  test("compares ids in any case, and passes over owners with no id or no list", () => {
    const rules: Array<FakeRule> = [
      {
        name: "Upper case",
        ownerUsers: [{ id: new ObjectID(ADA.id!.toString().toUpperCase()) }],
      },
      { name: "No lists" },
      { name: "No ids", ownerUsers: [{ id: null }], ownerTeams: [] },
    ];

    expect(
      namesOf(
        OwnerRuleFeed.getRulesThatAdded(rules, {
          userIds: [ADA.id!],
          teamIds: [],
        }),
      ),
    ).toEqual(["Upper case"]);
  });
});
