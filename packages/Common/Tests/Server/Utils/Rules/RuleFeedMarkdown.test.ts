import RuleFeedMarkdown from "../../../../Server/Utils/Rules/RuleFeedMarkdown";
import PendingInviteeProfiles, {
  WithheldProfile,
} from "../../../../Server/Utils/TeamMember/PendingInviteeProfiles";
import Team from "../../../../Models/DatabaseModels/Team";
import User from "../../../../Models/DatabaseModels/User";
import Email from "../../../../Types/Email";
import Name from "../../../../Types/Name";
import ObjectID from "../../../../Types/ObjectID";
import FeedMarkdown from "../../../../Utils/Markdown/FeedMarkdown";
import { describe, expect, jest, test } from "@jest/globals";
import type { SpyInstance } from "jest-mock";

/*
 * RuleFeedMarkdown writes the lines a rule engine puts into a feed: which
 * rules ran, which matched, and the owners they assigned. Rule, user and
 * team names are typed by people, so they are escaped as text - nobody can
 * make a rule name bold, link somewhere or mention someone.
 */

function user(data: { name?: string; email?: string }): User {
  const item: User = new User();

  if (data.name !== undefined) {
    item.name = new Name(data.name);
  }

  if (data.email !== undefined) {
    item.email = new Email(data.email);
  }

  return item;
}

function team(name?: string): Team {
  const item: Team = new Team();

  if (name !== undefined) {
    item.name = name;
  }

  return item;
}

describe("RuleFeedMarkdown.executedLine", () => {
  test("names one rule in bold, under the rule kind in the singular", () => {
    expect(
      RuleFeedMarkdown.executedLine({
        emoji: "🏷️",
        ruleKind: "Incident Label Rule",
        ruleNames: ["Prod"],
      }).toString(),
    ).toBe("🏷️ **Incident Label Rule executed:** **Prod**");
  });

  test("names several rules in bold, in order, under the plural", () => {
    expect(
      RuleFeedMarkdown.executedLine({
        emoji: "🏷️",
        ruleKind: "Incident Label Rule",
        ruleNames: ["Prod", "EU", "Database"],
      }).toString(),
    ).toBe(
      "🏷️ **Incident Label Rules executed:** **Prod**, **EU**, **Database**",
    );
  });

  test("keeps the singular, and names nothing, when no rule is given", () => {
    expect(
      RuleFeedMarkdown.executedLine({
        emoji: "👤",
        ruleKind: "Alert Owner Rule",
        ruleNames: [],
      }).toString(),
    ).toBe("👤 **Alert Owner Rule executed:** ");
  });

  test("uses the emoji it is given", () => {
    expect(
      RuleFeedMarkdown.executedLine({
        emoji: "📟",
        ruleKind: "On-Call Rule",
        ruleNames: ["Paging"],
      }).toString(),
    ).toMatch(/^📟 /);
  });

  test("escapes Markdown in a rule's name, so it reads as written", () => {
    const line: string = RuleFeedMarkdown.executedLine({
      emoji: "🏷️",
      ruleKind: "Incident Label Rule",
      ruleNames: ["**bold** [x](http://e.com) `c`"],
    }).toString();

    expect(line).toBe(
      "🏷️ **Incident Label Rule executed:** **\\*\\*bold\\*\\* \\[x\\](http://e.com) \\`c\\`**",
    );
  });

  test("a rule's name cannot mention anyone in a chat", () => {
    const line: string = RuleFeedMarkdown.executedLine({
      emoji: "🏷️",
      ruleKind: "Incident Label Rule",
      ruleNames: ["<@U123> <!channel>"],
    }).toString();

    expect(line).not.toContain("<@U123>");
    expect(line).not.toContain("<!channel>");
  });

  test("is Markdown a feed can place as it is", () => {
    expect(
      FeedMarkdown.isMarkdownText(
        RuleFeedMarkdown.executedLine({
          emoji: "🏷️",
          ruleKind: "Incident Label Rule",
          ruleNames: ["Prod"],
        }),
      ),
    ).toBe(true);
  });
});

describe("RuleFeedMarkdown.ownersList", () => {
  test("one bullet per user, then one per team", () => {
    expect(
      RuleFeedMarkdown.ownersList({
        users: [user({ name: "Ada Lovelace" }), user({ name: "Alan Turing" })],
        teams: [team("Platform"), team("SRE")],
      }).toString(),
    ).toBe("- 👤 Ada Lovelace\n- 👤 Alan Turing\n- 👥 Platform\n- 👥 SRE");
  });

  test("names a user by their email when they have no name", () => {
    expect(
      RuleFeedMarkdown.ownersList({
        users: [user({ email: "ada@example.com" })],
        teams: [],
      }).toString(),
    ).toBe("- 👤 ada@example.com");
  });

  test("prefers a user's name to their email", () => {
    expect(
      RuleFeedMarkdown.ownersList({
        users: [user({ name: "Ada Lovelace", email: "ada@example.com" })],
        teams: [],
      }).toString(),
    ).toBe("- 👤 Ada Lovelace");
  });

  test("says Unknown User for a user with neither name nor email", () => {
    expect(
      RuleFeedMarkdown.ownersList({
        users: [user({})],
        teams: [],
      }).toString(),
    ).toBe("- 👤 Unknown User");
  });

  test("says Unnamed Team for a team with no name", () => {
    expect(
      RuleFeedMarkdown.ownersList({
        users: [],
        teams: [team()],
      }).toString(),
    ).toBe("- 👥 Unnamed Team");
  });

  test("says there are no named owners when there are none", () => {
    expect(
      RuleFeedMarkdown.ownersList({ users: [], teams: [] }).toString(),
    ).toBe("- (no named owners)");
  });

  test("escapes Markdown in a user's name", () => {
    expect(
      RuleFeedMarkdown.ownersList({
        users: [user({ name: "Ada *Love*" })],
        teams: [],
      }).toString(),
    ).toBe("- 👤 Ada \\*Love\\*");
  });

  /*
   * An owner rule can name someone invited to the project who has not
   * accepted: the project sees only what it invited of them - the name
   * typed for them, else their address - never their own name (#9823).
   */
  test("lists someone only invited by the name typed for them, else their address", async () => {
    const pending: User = user({
      name: "Grace Hopper",
      email: "grace@example.com",
    });
    pending.id = new ObjectID("0194d4ba-0000-4000-8000-00000000e101");

    const pendingUnnamed: User = user({
      name: "Alan Turing",
      email: "alan@example.com",
    });
    pendingUnnamed.id = new ObjectID("0194d4ba-0000-4000-8000-00000000e102");

    const member: User = user({
      name: "Ada Lovelace",
      email: "ada@example.com",
    });
    member.id = new ObjectID("0194d4ba-0000-4000-8000-00000000e103");

    const projectId: ObjectID = new ObjectID(
      "0194d4ba-0000-4000-8000-00000000e100",
    );

    const withheldIn: SpyInstance<
      typeof PendingInviteeProfiles.readWithheldProfilesInProject
    > = jest
      .spyOn(PendingInviteeProfiles, "readWithheldProfilesInProject")
      .mockResolvedValue(
        new Map<string, WithheldProfile>([
          [pending.id.toString(), { inviteeName: "Grace from Payments" }],
          [pendingUnnamed.id.toString(), { inviteeName: null }],
        ]),
      );

    try {
      const list: string = (
        await RuleFeedMarkdown.readOwnersList({
          users: [pending, pendingUnnamed, member],
          teams: [team("Platform")],
          projectId: projectId,
        })
      ).toString();

      expect(list).toBe(
        "- 👤 Grace from Payments\n- 👤 alan@example.com\n- 👤 Ada Lovelace\n- 👥 Platform",
      );

      // One read for every owner listed, in the project.
      expect(withheldIn).toHaveBeenCalledTimes(1);
      expect(withheldIn.mock.calls[0]![0]).toEqual({
        userIds: [
          pending.id.toString(),
          pendingUnnamed.id.toString(),
          member.id.toString(),
        ],
        projectId: projectId,
      });
    } finally {
      withheldIn.mockRestore();
    }
  });

  test("a team's name cannot start a new bullet of its own", () => {
    const list: string = RuleFeedMarkdown.ownersList({
      users: [],
      teams: [team("Platform\n- 👤 Injected")],
    }).toString();

    expect(
      list.split("\n").filter((line: string) => {
        return line.startsWith("- ");
      }),
    ).toHaveLength(1);
  });
});

describe("RuleFeedMarkdown.matchedRulesLine", () => {
  test("lists the rules as code by default", () => {
    expect(
      RuleFeedMarkdown.matchedRulesLine({
        ruleKind: "Label",
        ruleNames: ["Prod", "EU"],
      }).toString(),
    ).toBe("**Label rules that matched**: `Prod`, `EU`");
  });

  test("lists the rules in bold when asked", () => {
    expect(
      RuleFeedMarkdown.matchedRulesLine({
        ruleKind: "Owner",
        ruleNames: ["Prod", "EU"],
        namesInBold: true,
      }).toString(),
    ).toBe("**Owner rules that matched**: **Prod**, **EU**");
  });

  test("namesInBold false is the same as leaving it out", () => {
    expect(
      RuleFeedMarkdown.matchedRulesLine({
        ruleKind: "Label",
        ruleNames: ["Prod"],
        namesInBold: false,
      }).toString(),
    ).toBe(
      RuleFeedMarkdown.matchedRulesLine({
        ruleKind: "Label",
        ruleNames: ["Prod"],
      }).toString(),
    );
  });

  test("a backtick in a name cannot close its code span", () => {
    expect(
      RuleFeedMarkdown.matchedRulesLine({
        ruleKind: "Owner",
        ruleNames: ["a`b"],
      }).toString(),
    ).toBe("**Owner rules that matched**: `` a`b ``");
  });

  test("escapes Markdown in a bold name", () => {
    expect(
      RuleFeedMarkdown.matchedRulesLine({
        ruleKind: "Owner",
        ruleNames: ["*x*"],
        namesInBold: true,
      }).toString(),
    ).toBe("**Owner rules that matched**: **\\*x\\***");
  });

  test("names nothing when no rule matched", () => {
    expect(
      RuleFeedMarkdown.matchedRulesLine({
        ruleKind: "Owner",
        ruleNames: [],
      }).toString(),
    ).toBe("**Owner rules that matched**: ");
  });

  test("an empty name is an empty code span, which shows nothing", () => {
    expect(
      RuleFeedMarkdown.matchedRulesLine({
        ruleKind: "Owner",
        ruleNames: [""],
      }).toString(),
    ).toBe("**Owner rules that matched**: ");
  });
});
