import RuleFeedMarkdown from "../../../../Server/Utils/Rules/RuleFeedMarkdown";
import Team from "../../../../Models/DatabaseModels/Team";
import User from "../../../../Models/DatabaseModels/User";
import Email from "../../../../Types/Email";
import Name from "../../../../Types/Name";
import FeedMarkdown from "../../../../Utils/Markdown/FeedMarkdown";
import { describe, expect, test } from "@jest/globals";

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
