/*
 * What an AI rule does (Types/AI/AiRule): investigate what it matches, fix
 * it, or both - read the one way by the rule engines, the rule service, the
 * migration's tests and the dashboard.
 */

import {
  AI_RULE_DOES_NOTHING_MESSAGE,
  AI_RULE_FIXES,
  AiRuleFix,
  doesAiRuleFix,
  doesAiRuleInvestigate,
  getAiRuleFix,
  getAiRuleFixColumns,
  getAiRuleShapeProblem,
  getFixingAiRules,
  getInvestigatingAiRules,
  isAiRuleFix,
} from "../../../Types/AI/AiRule";
import AutoRemediationExecutionMode from "../../../Types/AutoRemediation/AutoRemediationExecutionMode";
import { describe, expect, test } from "@jest/globals";

interface Rule {
  name: string;
  investigates?: unknown;
  fixes?: unknown;
}

// Values a column was never read as, or a client sent instead of a boolean.
const NOT_BOOLEANS: Array<unknown> = [
  undefined,
  null,
  "true",
  "false",
  1,
  0,
  {},
  [],
];

describe("whether a rule investigates", () => {
  test("only a rule saved as investigating does: the column defaults to off", () => {
    expect(doesAiRuleInvestigate({ investigates: true })).toBe(true);
    expect(doesAiRuleInvestigate({ investigates: false })).toBe(false);
    expect(doesAiRuleInvestigate({})).toBe(false);

    // A value that was not read never widens what is investigated.
    for (const value of NOT_BOOLEANS) {
      expect(doesAiRuleInvestigate({ investigates: value })).toBe(false);
    }
  });
});

describe("whether a rule fixes", () => {
  test("every rule does unless it was saved as one that does not: the column defaults to on", () => {
    expect(doesAiRuleFix({ fixes: true })).toBe(true);
    expect(doesAiRuleFix({ fixes: false })).toBe(false);
    // Every auto remediation rule fixed, and a rule read without the column still does.
    expect(doesAiRuleFix({})).toBe(true);

    for (const value of NOT_BOOLEANS) {
      expect(doesAiRuleFix({ fixes: value })).toBe(true);
    }
  });
});

describe("the rules that investigate, and the ones that fix", () => {
  const BOTH: Rule = { name: "both", investigates: true, fixes: true };
  const INVESTIGATES: Rule = {
    name: "investigates",
    investigates: true,
    fixes: false,
  };
  const FIXES: Rule = { name: "fixes", investigates: false, fixes: true };
  const OLDER: Rule = { name: "an auto remediation rule, as read before" };

  test("keep the rules given, in their order, as they are", () => {
    const rules: Array<Rule> = [BOTH, INVESTIGATES, FIXES, OLDER];

    expect(getInvestigatingAiRules(rules)).toEqual([BOTH, INVESTIGATES]);
    expect(getInvestigatingAiRules(rules)[0]).toBe(BOTH);
    expect(getFixingAiRules(rules)).toEqual([BOTH, FIXES, OLDER]);
    expect(getFixingAiRules(rules)[2]).toBe(OLDER);
  });

  test("leave the list given alone", () => {
    const rules: ReadonlyArray<Rule> = Object.freeze([
      FIXES,
      INVESTIGATES,
    ]) as ReadonlyArray<Rule>;

    expect(getInvestigatingAiRules(rules)).toEqual([INVESTIGATES]);
    expect(getFixingAiRules(rules)).toEqual([FIXES]);
    expect(rules).toEqual([FIXES, INVESTIGATES]);
  });

  test("no rules, none of either", () => {
    expect(getInvestigatingAiRules([])).toEqual([]);
    expect(getFixingAiRules([])).toEqual([]);
  });
});

describe("a rule that can be saved", () => {
  test.each([
    [true, true],
    [true, false],
    [false, true],
    [true, undefined],
    [false, undefined],
    [undefined, true],
    [undefined, undefined],
  ])(
    "investigates %s and fixes %s: it does something",
    (investigates: boolean | undefined, fixes: boolean | undefined) => {
      expect(getAiRuleShapeProblem({ investigates, fixes })).toBeNull();
    },
  );

  test.each([
    [false, false],
    [undefined, false],
  ])(
    "investigates %s and fixes %s: it does nothing, and is refused",
    (investigates: boolean | undefined, fixes: boolean | undefined) => {
      expect(getAiRuleShapeProblem({ investigates, fixes })).toBe(
        AI_RULE_DOES_NOTHING_MESSAGE,
      );
    },
  );

  test("the refusal says what to do", () => {
    expect(AI_RULE_DOES_NOTHING_MESSAGE).toBe(
      "An AI rule must investigate what it matches, fix it, or both. Turn investigating or fixing on.",
    );
  });

  test("anything but true or false is refused, naming the field", () => {
    for (const value of [null, "true", "false", 1, 0, {}, []]) {
      expect(getAiRuleShapeProblem({ investigates: value, fixes: true })).toBe(
        "Investigates must be true or false.",
      );
      expect(getAiRuleShapeProblem({ investigates: true, fixes: value })).toBe(
        "Fixes must be true or false.",
      );
    }
  });
});

describe("the Fix question", () => {
  test("three answers, in the order the form offers them", () => {
    expect(AI_RULE_FIXES).toEqual([
      AiRuleFix.DoNotFix,
      AiRuleFix.AskFirst,
      AiRuleFix.WithoutAsking,
    ]);
    expect(new Set(AI_RULE_FIXES).size).toBe(AI_RULE_FIXES.length);
  });

  test("knows its answers, exactly", () => {
    for (const fix of AI_RULE_FIXES) {
      expect(isAiRuleFix(fix)).toBe(true);
    }

    for (const value of [
      "doNotFix",
      "ASKFIRST",
      " WithoutAsking",
      "",
      AutoRemediationExecutionMode.FullAuto,
      AutoRemediationExecutionMode.Suggest,
      null,
      undefined,
      true,
      0,
      ["AskFirst"],
    ]) {
      expect(isAiRuleFix(value)).toBe(false);
    }
  });

  test.each([
    [{}, AiRuleFix.AskFirst],
    [
      { executionMode: AutoRemediationExecutionMode.Suggest },
      AiRuleFix.AskFirst,
    ],
    [
      { executionMode: AutoRemediationExecutionMode.FullAuto },
      AiRuleFix.WithoutAsking,
    ],
    [
      { fixes: true, executionMode: AutoRemediationExecutionMode.FullAuto },
      AiRuleFix.WithoutAsking,
    ],
    [{ fixes: true, executionMode: "something" }, AiRuleFix.AskFirst],
    [
      { fixes: false, executionMode: AutoRemediationExecutionMode.FullAuto },
      AiRuleFix.DoNotFix,
    ],
    [
      { fixes: false, executionMode: AutoRemediationExecutionMode.Suggest },
      AiRuleFix.DoNotFix,
    ],
    [{ fixes: false }, AiRuleFix.DoNotFix],
  ])(
    "a rule's columns %j answer %s",
    (rule: Record<string, unknown>, fix: AiRuleFix) => {
      expect(getAiRuleFix(rule)).toBe(fix);
    },
  );

  test("each answer writes the two columns an API client reads", () => {
    expect(getAiRuleFixColumns(AiRuleFix.AskFirst)).toEqual({
      fixes: true,
      executionMode: AutoRemediationExecutionMode.Suggest,
    });
    expect(getAiRuleFixColumns(AiRuleFix.WithoutAsking)).toEqual({
      fixes: true,
      executionMode: AutoRemediationExecutionMode.FullAuto,
    });
    expect(getAiRuleFixColumns(AiRuleFix.DoNotFix)).toEqual({
      fixes: false,
      executionMode: AutoRemediationExecutionMode.Suggest,
    });
  });

  test("not fixing keeps how a fix would wait, so turning fixing back on asks as before", () => {
    expect(
      getAiRuleFixColumns(
        AiRuleFix.DoNotFix,
        AutoRemediationExecutionMode.FullAuto,
      ),
    ).toEqual({
      fixes: false,
      executionMode: AutoRemediationExecutionMode.FullAuto,
    });
    expect(
      getAiRuleFixColumns(
        AiRuleFix.DoNotFix,
        AutoRemediationExecutionMode.Suggest,
      ),
    ).toEqual({
      fixes: false,
      executionMode: AutoRemediationExecutionMode.Suggest,
    });
    // Anything else asks first.
    expect(getAiRuleFixColumns(AiRuleFix.DoNotFix, "FullAuto ")).toEqual({
      fixes: false,
      executionMode: AutoRemediationExecutionMode.Suggest,
    });
    // An answer that fixes says how, whatever the rule said before.
    expect(
      getAiRuleFixColumns(
        AiRuleFix.AskFirst,
        AutoRemediationExecutionMode.FullAuto,
      ).executionMode,
    ).toBe(AutoRemediationExecutionMode.Suggest);
  });

  test("an answer written reads back as itself, from any rule", () => {
    for (const fix of AI_RULE_FIXES) {
      for (const current of [
        undefined,
        AutoRemediationExecutionMode.Suggest,
        AutoRemediationExecutionMode.FullAuto,
      ]) {
        expect(getAiRuleFix(getAiRuleFixColumns(fix, current))).toBe(fix);
      }
    }
  });

  test("every answer written can be saved", () => {
    for (const fix of AI_RULE_FIXES) {
      for (const investigates of [true, false]) {
        const columns: { fixes: boolean } = getAiRuleFixColumns(fix);

        expect(
          getAiRuleShapeProblem({ investigates, fixes: columns.fixes }) ===
            null,
        ).toBe(investigates || fix !== AiRuleFix.DoNotFix);
      }
    }
  });
});
