import ObjectID from "../../../Types/ObjectID";
import { getIncomingCallRulesToTry } from "../../../Types/IncomingCall/IncomingCallEscalationOrder";
import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * Which escalation rule of an incoming call policy is dialled next (issue
 * #9609). A policy's rules are a drag-ordered list: a write of a rule's
 * number moves no other rule, so rules written through the API - by
 * Terraform, all at once - may share a number, leave gaps, or start at 0.
 * The handler used to dial "the first rule numbered higher than the one it
 * dialled": the second of two rules at one number was never dialled, and a
 * rule at 0 never either. Now it is the first rule after the one dialled, in
 * the policy's order.
 */

type Rule = { id: ObjectID; order: number; name: string };

const rule: (name: string, order: number, idEnd: string) => Rule = (
  name: string,
  order: number,
  idEnd: string,
): Rule => {
  return {
    id: new ObjectID(`1e000000-0000-4000-8000-0000000000${idEnd}`),
    order: order,
    name: name,
  };
};

const names: (rules: Array<Rule>) => Array<string> = (
  rules: Array<Rule>,
): Array<string> => {
  return rules.map((item: Rule) => {
    return item.name;
  });
};

// Two rules at 2, read in the order of their ids: Bea, then Cal.
const RULES: Array<Rule> = [
  rule("Dee", 3, "d4"),
  rule("Cal", 2, "c3"),
  rule("Ann", 1, "a1"),
  rule("Bea", 2, "b2"),
];

describe("getIncomingCallRulesToTry", () => {
  test("a new call tries every rule, lowest first, rules at one number by id", () => {
    expect(
      names(getIncomingCallRulesToTry({ rules: RULES, dialled: null })),
    ).toEqual(["Ann", "Bea", "Cal", "Dee"]);
  });

  test("after the first of two rules at one number, the second is dialled - not skipped", () => {
    expect(
      names(
        getIncomingCallRulesToTry({
          rules: RULES,
          dialled: { ruleId: RULES[3]!.id, ruleOrder: 2 },
        }),
      ),
    ).toEqual(["Cal", "Dee"]);
  });

  test("after the second of them, the rule after the pair", () => {
    expect(
      names(
        getIncomingCallRulesToTry({
          rules: RULES,
          dialled: { ruleId: RULES[1]!.id, ruleOrder: 2 },
        }),
      ),
    ).toEqual(["Dee"]);
  });

  test("after the last rule, none: the call ends, or the policy starts again", () => {
    expect(
      getIncomingCallRulesToTry({
        rules: RULES,
        dialled: { ruleId: RULES[0]!.id, ruleOrder: 3 },
      }),
    ).toEqual([]);
  });

  test("a rule at 0, or below, is dialled in its place too", () => {
    const rules: Array<Rule> = [
      rule("Ann", 1, "a1"),
      rule("Zero", 0, "e5"),
      rule("Below", -3, "f6"),
    ];

    expect(names(getIncomingCallRulesToTry({ rules, dialled: null }))).toEqual([
      "Below",
      "Zero",
      "Ann",
    ]);
  });

  test("gaps in the numbers change nothing", () => {
    const rules: Array<Rule> = [
      rule("Ann", 10, "a1"),
      rule("Bea", 20, "b2"),
      rule("Cal", 30, "c3"),
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

  test("a rule deleted while it rang is placed by its number: the rules at it and later come next", () => {
    expect(
      names(
        getIncomingCallRulesToTry({
          rules: RULES,
          dialled: {
            ruleId: new ObjectID("1e000000-0000-4000-8000-0000000000ff"),
            ruleOrder: 2,
          },
        }),
      ),
    ).toEqual(["Bea", "Cal", "Dee"]);
  });

  test("a rule's id is matched however its letters are cased", () => {
    expect(
      names(
        getIncomingCallRulesToTry({
          rules: RULES,
          dialled: {
            ruleId: RULES[3]!.id.toString().toUpperCase(),
            ruleOrder: 2,
          },
        }),
      ),
    ).toEqual(["Cal", "Dee"]);
  });

  test("the rules it is handed are left as they were", () => {
    const before: Array<string> = names(RULES);

    getIncomingCallRulesToTry({ rules: RULES, dialled: null });

    expect(names(RULES)).toEqual(before);
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

  test("never asks for the rule numbered higher than the one it dialled", () => {
    expect(handler).not.toContain("QueryHelper.greaterThan");
    expect(handler).not.toContain("currentEscalationRuleOrder || 0");
  });
});
