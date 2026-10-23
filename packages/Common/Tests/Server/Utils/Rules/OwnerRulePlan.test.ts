import OwnerRulePlanBuilder, {
  OWNER_RULE_INHERIT_SOURCES,
  OwnerIdSets,
  OwnerRuleInheritSource,
  OwnerRuleMatch,
  OwnerRulePlan,
  OwnerRulePlanEntry,
} from "../../../../Server/Utils/Rules/OwnerRulePlan";
import { INHERITED_OWNER_COLUMNS } from "../../../../Utils/Rules/RuleAction";
import ObjectID from "../../../../Types/ObjectID";
import { describe, expect, it } from "@jest/globals";

/*
 * Contract under test - what an event's owner rules will add, worked out
 * before anything is written (Server/Utils/Rules/OwnerRulePlan).
 *
 * The owner rule engines of incidents, alerts and their episodes evaluate in
 * two halves: this plan, then the writes that carry it out. The create form's
 * review asks for the same plan of the event it holds (POST
 * /<event>/owner-rule-preview), so the plan has to say exactly what the
 * create will do: which rules add something, who each brings - named,
 * the creator's team, inherited - and who is told.
 */

interface Rule {
  name: string;
}

const RULE_A: Rule = { name: "Checkout rule" };
const RULE_B: Rule = { name: "Payments rule" };

const USER_1: string = "11111111-1111-4111-8111-111111111111";
const USER_2: string = "22222222-2222-4222-8222-222222222222";
const TEAM_1: string = "33333333-3333-4333-8333-333333333333";
const TEAM_2: string = "44444444-4444-4444-8444-444444444444";
const CREATOR_TEAM: string = "55555555-5555-4555-8555-555555555555";
const MONITOR_OWNER: string = "66666666-6666-4666-8666-666666666666";
const HOST_OWNER_TEAM: string = "77777777-7777-4777-8777-777777777777";

function match(fields: Partial<OwnerRuleMatch<Rule>>): OwnerRuleMatch<Rule> {
  return {
    rule: RULE_A,
    notifyOwners: true,
    userIds: [],
    teamIds: [],
    listsCreatorTeams: false,
    creatorTeamIds: [],
    inheritsFrom: [],
    ...fields,
  };
}

function owners(data: {
  userIds?: Array<string>;
  teamIds?: Array<string>;
}): OwnerIdSets {
  return {
    userIds: new Set<string>(data.userIds || []),
    teamIds: new Set<string>(data.teamIds || []),
  };
}

const NOTHING_INHERITED: Map<OwnerRuleInheritSource, OwnerIdSets> = new Map();

function plan(
  matches: Array<OwnerRuleMatch<Rule>>,
  data: {
    allowOwnerNotification?: boolean;
    inherited?: Map<OwnerRuleInheritSource, OwnerIdSets>;
  } = {},
): OwnerRulePlan<Rule> {
  const builder: OwnerRulePlanBuilder<Rule> = new OwnerRulePlanBuilder<Rule>(
    data.allowOwnerNotification ?? true,
  );

  for (const each of matches) {
    builder.addMatch(each);
  }

  return builder.build(data.inherited || NOTHING_INHERITED);
}

function sorted(values: Iterable<string>): Array<string> {
  return Array.from(values).sort();
}

describe("OwnerRulePlanBuilder.idsOf", () => {
  it("reads each related row's id as text, once, in its order", () => {
    expect(
      OwnerRulePlanBuilder.idsOf([
        { id: new ObjectID(TEAM_2) },
        { id: new ObjectID(TEAM_1) },
        { id: new ObjectID(TEAM_2) },
        { id: null },
        {},
      ]),
    ).toEqual([TEAM_2, TEAM_1]);
  });

  it("reads nothing from a list that is not there", () => {
    expect(OwnerRulePlanBuilder.idsOf(undefined)).toEqual([]);
    expect(OwnerRulePlanBuilder.idsOf(null)).toEqual([]);
    expect(OwnerRulePlanBuilder.idsOf([])).toEqual([]);
  });
});

describe("OwnerRulePlanBuilder.getInheritSources", () => {
  it("names the six sources in the order the rule form shows their switches", () => {
    expect(
      OWNER_RULE_INHERIT_SOURCES.map((entry: { column: string }): string => {
        return entry.column;
      }),
    ).toEqual([...INHERITED_OWNER_COLUMNS]);
  });

  it("reads a switch as on only when it is true", () => {
    expect(
      OwnerRulePlanBuilder.getInheritSources({
        inheritOwnersFromServices: true,
        inheritOwnersFromMonitors: true,
        inheritOwnersFromHosts: false,
        inheritOwnersFromKubernetesClusters: "true",
        inheritOwnersFromDockerHosts: 1,
      }),
    ).toEqual(["monitors", "services"]);

    expect(OwnerRulePlanBuilder.getInheritSources(undefined)).toEqual([]);
    expect(OwnerRulePlanBuilder.getInheritSources({})).toEqual([]);
  });
});

describe("an owner rule plan", () => {
  it("is empty when no rule matched", () => {
    const result: OwnerRulePlan<Rule> = plan([]);

    expect(result.anyRuleMatched).toBe(false);
    expect(result.matchedRules).toEqual([]);
    expect(result.entries).toEqual([]);
    expect(result.allUserIds.size).toBe(0);
    expect(result.allTeamIds.size).toBe(0);
  });

  it("lists a rule that matched with whom it names", () => {
    const result: OwnerRulePlan<Rule> = plan([
      match({ userIds: [USER_1], teamIds: [TEAM_1] }),
    ]);

    expect(result.anyRuleMatched).toBe(true);
    expect(result.matchedRules).toEqual([RULE_A]);
    expect(result.entries).toEqual([
      {
        rule: RULE_A,
        notify: true,
        userIds: [USER_1],
        teamIds: [TEAM_1],
        creatorTeamIds: [],
      },
    ]);
    expect(sorted(result.allUserIds)).toEqual([USER_1]);
    expect(sorted(result.allTeamIds)).toEqual([TEAM_1]);
  });

  /*
   * A rule that adds nothing at all still matched - the run reports it
   * matched and did nothing - but it is no entry: the review lists only
   * rules that add someone.
   */
  it("counts a rule that adds nothing as matched, and lists nothing for it", () => {
    const result: OwnerRulePlan<Rule> = plan([match({})]);

    expect(result.anyRuleMatched).toBe(true);
    expect(result.matchedRules).toEqual([]);
    expect(result.entries).toEqual([]);
  });

  describe("the creator's team", () => {
    it("adds the teams of the rule the creator is in, as teams it brings", () => {
      const result: OwnerRulePlan<Rule> = plan([
        match({
          teamIds: [TEAM_1],
          listsCreatorTeams: true,
          creatorTeamIds: [CREATOR_TEAM],
        }),
      ]);

      expect(result.entries[0]).toEqual({
        rule: RULE_A,
        notify: true,
        userIds: [],
        teamIds: [TEAM_1, CREATOR_TEAM],
        creatorTeamIds: [CREATOR_TEAM],
      });
      expect(sorted(result.allTeamIds)).toEqual(sorted([TEAM_1, CREATOR_TEAM]));
      expect(sorted(result.creatorTeamIds)).toEqual([CREATOR_TEAM]);
      expect(sorted(result.teamsByNotify.get(true)!)).toEqual(
        sorted([TEAM_1, CREATOR_TEAM]),
      );
    });

    it("adds several when the creator is in several", () => {
      const result: OwnerRulePlan<Rule> = plan([
        match({
          listsCreatorTeams: true,
          creatorTeamIds: [TEAM_1, TEAM_2],
        }),
      ]);

      expect(result.entries[0]!.teamIds).toEqual([TEAM_1, TEAM_2]);
      expect(result.entries[0]!.creatorTeamIds).toEqual([TEAM_1, TEAM_2]);
    });

    /*
     * A rule that lists teams adds something when it matches - the team of
     * whoever creates the next event - even when this event's creator is in
     * none of them, or there is no creator: it is matched, adds nobody here,
     * and the review does not list it.
     */
    it("adds nobody for a creator in none of the teams, or no creator", () => {
      const result: OwnerRulePlan<Rule> = plan([
        match({ listsCreatorTeams: true, creatorTeamIds: [] }),
      ]);

      expect(result.anyRuleMatched).toBe(true);
      expect(result.matchedRules).toEqual([RULE_A]);
      expect(result.entries).toEqual([
        {
          rule: RULE_A,
          notify: true,
          userIds: [],
          teamIds: [],
          creatorTeamIds: [],
        },
      ]);
      expect(result.allTeamIds.size).toBe(0);
      expect(result.creatorTeamIds.size).toBe(0);
    });

    it("is told as the rule's own owners are", () => {
      const result: OwnerRulePlan<Rule> = plan([
        match({
          notifyOwners: false,
          listsCreatorTeams: true,
          creatorTeamIds: [CREATOR_TEAM],
        }),
      ]);

      expect(result.entries[0]!.notify).toBe(false);
      expect(sorted(result.teamsByNotify.get(false)!)).toEqual([CREATOR_TEAM]);
      expect(result.teamsByNotify.get(true)!.size).toBe(0);
    });
  });

  describe("who is told", () => {
    it("follows each rule's Notify Owners, which is on unless it is false", () => {
      const result: OwnerRulePlan<Rule> = plan([
        match({ rule: RULE_A, notifyOwners: null, userIds: [USER_1] }),
        match({ rule: RULE_B, notifyOwners: false, userIds: [USER_2] }),
      ]);

      expect(
        result.entries.map((entry: OwnerRulePlanEntry<Rule>): boolean => {
          return entry.notify;
        }),
      ).toEqual([true, false]);
      expect(sorted(result.usersByNotify.get(true)!)).toEqual([USER_1]);
      expect(sorted(result.usersByNotify.get(false)!)).toEqual([USER_2]);
    });

    it("tells nobody on a run that did not opt in, whatever the rules say", () => {
      const result: OwnerRulePlan<Rule> = plan(
        [
          match({
            userIds: [USER_1],
            listsCreatorTeams: true,
            creatorTeamIds: [CREATOR_TEAM],
            inheritsFrom: ["monitors"],
          }),
        ],
        {
          allowOwnerNotification: false,
          inherited: new Map([
            ["monitors", owners({ userIds: [MONITOR_OWNER] })],
          ]),
        },
      );

      expect(result.entries[0]!.notify).toBe(false);
      expect(result.usersByNotify.get(true)!.size).toBe(0);
      expect(result.teamsByNotify.get(true)!.size).toBe(0);
      expect(sorted(result.usersByNotify.get(false)!)).toEqual(
        sorted([USER_1, MONITOR_OWNER]),
      );
    });

    /*
     * The writes add the notifying set first, so an owner two rules disagree
     * about is added once, and told: the plan keeps them in both sets.
     */
    it("keeps an owner two rules disagree about in both sets", () => {
      const result: OwnerRulePlan<Rule> = plan([
        match({ rule: RULE_A, notifyOwners: false, userIds: [USER_1] }),
        match({ rule: RULE_B, notifyOwners: true, userIds: [USER_1] }),
      ]);

      expect(sorted(result.usersByNotify.get(true)!)).toEqual([USER_1]);
      expect(sorted(result.usersByNotify.get(false)!)).toEqual([USER_1]);
      expect(sorted(result.allUserIds)).toEqual([USER_1]);
    });

    it("tells inherited owners when any rule that inherits tells its owners", () => {
      const inherited: Map<OwnerRuleInheritSource, OwnerIdSets> = new Map([
        ["monitors", owners({ userIds: [MONITOR_OWNER] })],
      ]);

      const quiet: OwnerRulePlan<Rule> = plan(
        [match({ notifyOwners: false, inheritsFrom: ["monitors"] })],
        { inherited },
      );

      expect(sorted(quiet.usersByNotify.get(false)!)).toEqual([MONITOR_OWNER]);

      const told: OwnerRulePlan<Rule> = plan(
        [
          match({
            rule: RULE_A,
            notifyOwners: false,
            inheritsFrom: ["monitors"],
          }),
          match({
            rule: RULE_B,
            notifyOwners: true,
            inheritsFrom: ["monitors"],
          }),
        ],
        { inherited },
      );

      expect(sorted(told.usersByNotify.get(true)!)).toEqual([MONITOR_OWNER]);
      expect(told.usersByNotify.get(false)!.size).toBe(0);
    });
  });

  describe("inherited owners", () => {
    it("asks for each source some matched rule inherits from, once", () => {
      const builder: OwnerRulePlanBuilder<Rule> =
        new OwnerRulePlanBuilder<Rule>(true);

      builder.addMatch(match({ inheritsFrom: ["monitors", "hosts"] }));
      builder.addMatch(match({ rule: RULE_B, inheritsFrom: ["hosts"] }));

      expect(sorted(builder.getSourcesToInherit())).toEqual([
        "hosts",
        "monitors",
      ]);
    });

    it("lists each rule with the owners of the sources it inherits from", () => {
      const result: OwnerRulePlan<Rule> = plan(
        [
          match({
            rule: RULE_A,
            userIds: [USER_1],
            inheritsFrom: ["monitors"],
          }),
          match({ rule: RULE_B, inheritsFrom: ["hosts"] }),
        ],
        {
          inherited: new Map([
            ["monitors", owners({ userIds: [MONITOR_OWNER, USER_1] })],
            ["hosts", owners({ teamIds: [HOST_OWNER_TEAM] })],
          ]),
        },
      );

      expect(result.entries).toEqual([
        {
          rule: RULE_A,
          notify: true,
          userIds: [USER_1, MONITOR_OWNER],
          teamIds: [],
          creatorTeamIds: [],
        },
        {
          rule: RULE_B,
          notify: true,
          userIds: [],
          teamIds: [HOST_OWNER_TEAM],
          creatorTeamIds: [],
        },
      ]);
      expect(sorted(result.allUserIds)).toEqual(
        sorted([USER_1, MONITOR_OWNER]),
      );
      expect(sorted(result.allTeamIds)).toEqual([HOST_OWNER_TEAM]);
    });

    it("reads a source the event has none of as no owners", () => {
      const result: OwnerRulePlan<Rule> = plan([
        match({ inheritsFrom: ["kubernetesClusters"] }),
      ]);

      expect(result.matchedRules).toEqual([RULE_A]);
      expect(result.entries[0]!.userIds).toEqual([]);
      expect(result.entries[0]!.teamIds).toEqual([]);
      expect(result.allUserIds.size).toBe(0);
    });

    it("never adds the owners of a source no matched rule inherits from", () => {
      const result: OwnerRulePlan<Rule> = plan([match({ userIds: [USER_1] })], {
        inherited: new Map([
          ["monitors", owners({ userIds: [MONITOR_OWNER] })],
        ]),
      });

      expect(sorted(result.allUserIds)).toEqual([USER_1]);
    });
  });
});
