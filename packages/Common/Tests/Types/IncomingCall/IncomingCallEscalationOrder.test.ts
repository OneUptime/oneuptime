import ObjectID from "../../../Types/ObjectID";
import {
  getIncomingCallRulesToTry,
  sortIncomingCallRules,
} from "../../../Types/IncomingCall/IncomingCallEscalationOrder";
import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * Which escalation rule of an incoming call policy is dialled next. A
 * policy's rules are a drag-ordered list: a write of a rule's number moves
 * no other rule (issue #9609), so rules written through the API - by
 * Terraform, all at once - may share a number, leave gaps, or start at 0.
 * The handler used to dial "the first rule numbered higher than the one it
 * dialled": the second of two rules at one number was never dialled, and a
 * rule at 0 never either. Now it is the first rule after the one dialled, in
 * the order the policy's page lists them: by number, then the older rule
 * first, then by id.
 */

type Rule = {
  id: ObjectID;
  order: number | null;
  name: string;
  createdAt: Date;
};

const rule: (
  name: string,
  order: number | null,
  idEnd: string,
  minute: number,
) => Rule = (
  name: string,
  order: number | null,
  idEnd: string,
  minute: number,
): Rule => {
  return {
    id: new ObjectID(`1e000000-0000-4000-8000-0000000000${idEnd}`),
    order: order,
    name: name,
    createdAt: new Date(Date.UTC(2026, 10, 1, 9, minute)),
  };
};

const names: (rules: Array<Rule>) => Array<string> = (
  rules: Array<Rule>,
): Array<string> => {
  return rules.map((item: Rule) => {
    return item.name;
  });
};

/*
 * Two rules at 2: Bea was created first, so she comes first - though Cal's
 * id sorts before hers.
 */
const RULES: Array<Rule> = [
  rule("Dee", 3, "d4", 4),
  rule("Cal", 2, "a3", 3),
  rule("Ann", 1, "b1", 1),
  rule("Bea", 2, "c2", 2),
];

const byName: (name: string) => Rule = (name: string): Rule => {
  return RULES.find((item: Rule) => {
    return item.name === name;
  })!;
};

describe("sortIncomingCallRules", () => {
  test("lowest number first; of two rules at one number, the older first", () => {
    expect(names(sortIncomingCallRules(RULES))).toEqual([
      "Ann",
      "Bea",
      "Cal",
      "Dee",
    ]);
  });

  test("rules at one number created at one moment go by id", () => {
    const rules: Array<Rule> = [
      rule("Second", 1, "b2", 5),
      rule("First", 1, "a1", 5),
    ];

    expect(names(sortIncomingCallRules(rules))).toEqual(["First", "Second"]);
  });

  test("a rule without a number comes last, as the policy's page lists it", () => {
    const rules: Array<Rule> = [
      rule("Unnumbered", null, "a1", 0),
      rule("Ann", 7, "b2", 9),
    ];

    expect(names(sortIncomingCallRules(rules))).toEqual(["Ann", "Unnumbered"]);
  });

  test("the rules it is handed are left as they were", () => {
    const before: Array<string> = names(RULES);

    sortIncomingCallRules(RULES);

    expect(names(RULES)).toEqual(before);
  });
});

describe("getIncomingCallRulesToTry", () => {
  test("a new call tries every rule, in the policy's order", () => {
    expect(
      names(getIncomingCallRulesToTry({ rules: RULES, dialled: null })),
    ).toEqual(["Ann", "Bea", "Cal", "Dee"]);
  });

  test("after the first of two rules at one number, the second is dialled - not skipped", () => {
    expect(
      names(
        getIncomingCallRulesToTry({
          rules: RULES,
          dialled: { ruleId: byName("Bea").id, ruleOrder: 2 },
        }),
      ),
    ).toEqual(["Cal", "Dee"]);
  });

  test("after the second of them, the rule after the pair", () => {
    expect(
      names(
        getIncomingCallRulesToTry({
          rules: RULES,
          dialled: { ruleId: byName("Cal").id, ruleOrder: 2 },
        }),
      ),
    ).toEqual(["Dee"]);
  });

  test("after the last rule, none: the call ends, or the policy starts again", () => {
    expect(
      getIncomingCallRulesToTry({
        rules: RULES,
        dialled: { ruleId: byName("Dee").id, ruleOrder: 3 },
      }),
    ).toEqual([]);
  });

  test("a rule at 0, or below, is dialled in its place too", () => {
    const rules: Array<Rule> = [
      rule("Ann", 1, "a1", 1),
      rule("Zero", 0, "e5", 2),
      rule("Below", -3, "f6", 3),
    ];

    expect(names(getIncomingCallRulesToTry({ rules, dialled: null }))).toEqual([
      "Below",
      "Zero",
      "Ann",
    ]);
  });

  test("gaps in the numbers change nothing", () => {
    const rules: Array<Rule> = [
      rule("Ann", 10, "a1", 1),
      rule("Bea", 20, "b2", 2),
      rule("Cal", 30, "c3", 3),
    ];

    expect(
      names(
        getIncomingCallRulesToTry({
          rules,
          dialled: { ruleId: rules[0]!.id, ruleOrder: 10 },
        }),
      ),
    ).toEqual(["Bea", "Cal"]);
  });

  test("a rule deleted while it rang is placed by its number: the rules at it and after it come next", () => {
    expect(
      names(
        getIncomingCallRulesToTry({
          rules: RULES,
          dialled: { ruleId: null, ruleOrder: 2 },
        }),
      ),
    ).toEqual(["Bea", "Cal", "Dee"]);
  });

  test("a rule no longer among the policy's is placed by its number the same way", () => {
    expect(
      names(
        getIncomingCallRulesToTry({
          rules: RULES,
          dialled: {
            ruleId: new ObjectID("1e000000-0000-4000-8000-0000000000ff"),
            ruleOrder: 3,
          },
        }),
      ),
    ).toEqual(["Dee"]);
  });

  test("a rule's id is matched however its letters are cased", () => {
    expect(
      names(
        getIncomingCallRulesToTry({
          rules: RULES,
          dialled: {
            ruleId: byName("Bea").id.toString().toUpperCase(),
            ruleOrder: 2,
          },
        }),
      ),
    ).toEqual(["Cal", "Dee"]);
  });

  test("rules read as rows, by _id, are matched too", () => {
    const rows: Array<{ _id: string; order: number; name: string }> = [
      { _id: "1e000000-0000-4000-8000-0000000000b2", order: 2, name: "Two" },
      { _id: "1e000000-0000-4000-8000-0000000000a1", order: 1, name: "One" },
    ];

    expect(
      getIncomingCallRulesToTry({
        rules: rows,
        dialled: { ruleId: rows[1]!._id, ruleOrder: 1 },
      }).map((row: { name: string }) => {
        return row.name;
      }),
    ).toEqual(["Two"]);
  });
});

describe("the call handler", () => {
  const handler: string = fs.readFileSync(
    path.resolve(
      __dirname,
      "../../../../App/FeatureSet/Notification/API/IncomingCall.ts",
    ),
    "utf8",
  );

  test("reads which rule comes next here, from the rule the call log item dialled", () => {
    expect(handler).toContain("getIncomingCallRulesToTry({");
    expect(handler).toContain(
      "ruleId: callLogItem.incomingCallPolicyEscalationRuleId || null,",
    );
    expect(handler).toContain("incomingCallPolicyEscalationRuleId: true,");
  });

  test("reads the policy's rules in its order, the older of two at one number first", () => {
    expect(handler).toContain(
      "sort: {\n        order: SortOrder.Ascending,\n        createdAt: SortOrder.Ascending,\n      },",
    );
  });

  test("never asks for the rule numbered higher than the one it dialled", () => {
    expect(handler).not.toContain("QueryHelper.greaterThan");
    expect(handler).not.toContain("currentEscalationRuleOrder || 0");
  });
});
