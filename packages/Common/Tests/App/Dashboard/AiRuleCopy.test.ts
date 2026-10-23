import { describe, expect, test } from "@jest/globals";
import {
  AI_RULE_DOES_NOT_INVESTIGATE_TEXT,
  AI_RULE_DOES_NOTHING_TEXT,
  AI_RULE_COLUMN_TITLE,
  AI_RULE_FIX_FIELD_COPY,
  AI_RULE_FIX_FIELD_KEY,
  AI_RULE_FIX_OPTIONS,
  AI_RULE_FIX_TEXT,
  AI_RULE_ONLY_FIXES_COPY,
  AI_RULE_TEST_IDS,
  doesEditedRuleFix,
  doesEditedRuleInvestigate,
  getAiRuleFixText,
  getAiRuleMoreFieldsSummary,
  getEditedRuleFix,
  getShownAiRuleFix,
  isFixingWithOneUptimeAi,
  prepareAiRuleCreate,
  validateAiRuleFix,
} from "../../../../App/FeatureSet/Dashboard/src/Components/AISettings/AiRuleCopy";
import { AiLane } from "../../../../App/FeatureSet/Dashboard/src/Components/AISettings/ProjectAiSettingsCopy";
import {
  AUTO_REMEDIATION_APPROVAL_TEXT,
  getAutoRemediationMoreFieldsSummary,
} from "../../../../App/FeatureSet/Dashboard/src/Components/AutoRemediation/AutoRemediationRuleCopy";
import { getInvestigationRuleMoreFieldsSummary } from "../../../../App/FeatureSet/Dashboard/src/Components/ExternalMcpServer/ExternalMcpServerCopy";
import AutoRemediationRule from "../../../Models/DatabaseModels/AutoRemediationRule";
import { AI_RULE_FIXES, AiRuleFix } from "../../../Types/AI/AiRule";
import AutoRemediationAction from "../../../Types/AutoRemediation/AutoRemediationAction";
import AutoRemediationExecutionMode from "../../../Types/AutoRemediation/AutoRemediationExecutionMode";
import FormValues from "../../../UI/Components/Forms/Types/FormValues";

/*
 * What an AI rule's form and table say and decide (AISettings/AiRuleCopy),
 * React-free: the Investigate and Fix questions, the table's columns, and
 * the note on a rule that only fixes - an auto remediation rule from before
 * investigation rules and auto remediation rules became one AI rule.
 */

type Values = FormValues<AutoRemediationRule>;

function values(fields: Record<string, unknown>): Values {
  return fields as unknown as Values;
}

describe("the rule being edited", () => {
  test("investigates only when it says so: a rule that only fixes, or a value not read, does not", () => {
    expect(doesEditedRuleInvestigate(values({ investigates: true }))).toBe(
      true,
    );

    for (const notInvestigating of [
      values({ investigates: false }),
      values({}),
      values({ investigates: "true" }),
      null,
      undefined,
      "investigates",
      42,
    ]) {
      expect(doesEditedRuleInvestigate(notInvestigating)).toBe(false);
    }
  });

  test("holds the Fix answer picked, or - before one is picked - the one its columns make", () => {
    // As its columns make it, before anything is picked.
    expect(getEditedRuleFix(values({}))).toBe(AiRuleFix.AskFirst);
    expect(
      getEditedRuleFix(
        values({ executionMode: AutoRemediationExecutionMode.FullAuto }),
      ),
    ).toBe(AiRuleFix.WithoutAsking);
    expect(
      getEditedRuleFix(
        values({
          fixes: false,
          executionMode: AutoRemediationExecutionMode.FullAuto,
        }),
      ),
    ).toBe(AiRuleFix.DoNotFix);

    // Once picked, the pick - whatever the columns still say.
    for (const fix of AI_RULE_FIXES) {
      expect(
        getEditedRuleFix(
          values({
            fixes: false,
            executionMode: AutoRemediationExecutionMode.FullAuto,
            [AI_RULE_FIX_FIELD_KEY]: fix,
          }),
        ),
      ).toBe(fix);
    }

    // A value that is not an answer is not a pick.
    expect(
      getEditedRuleFix(
        values({ fixes: false, [AI_RULE_FIX_FIELD_KEY]: "Sometimes" }),
      ),
    ).toBe(AiRuleFix.DoNotFix);
    expect(getEditedRuleFix(null)).toBe(AiRuleFix.AskFirst);
  });

  test("fixes unless its answer is Don't fix", () => {
    expect(doesEditedRuleFix(values({}))).toBe(true);
    expect(doesEditedRuleFix(values({ fixes: false }))).toBe(false);
    expect(
      doesEditedRuleFix(
        values({ fixes: false, [AI_RULE_FIX_FIELD_KEY]: AiRuleFix.AskFirst }),
      ),
    ).toBe(true);
    expect(
      doesEditedRuleFix(
        values({ fixes: true, [AI_RULE_FIX_FIELD_KEY]: AiRuleFix.DoNotFix }),
      ),
    ).toBe(false);
  });

  test("fixes with OneUptime AI when it fixes, neither running its runbooks every time nor being an older rule", () => {
    expect(isFixingWithOneUptimeAi(values({}))).toBe(true);
    expect(isFixingWithOneUptimeAi(values({ fixes: false }))).toBe(false);
    expect(
      isFixingWithOneUptimeAi(
        values({ remediationAction: AutoRemediationAction.Runbooks }),
      ),
    ).toBe(false);
    expect(isFixingWithOneUptimeAi(values({ aiComposesCommands: true }))).toBe(
      false,
    );
    expect(isFixingWithOneUptimeAi(values({ aiSelectsRunbook: true }))).toBe(
      false,
    );
  });
});

describe("a rule that does not investigate must fix", () => {
  test("the Fix question refuses Don't fix for it, saying what to do", () => {
    expect(
      validateAiRuleFix(
        values({
          investigates: false,
          [AI_RULE_FIX_FIELD_KEY]: AiRuleFix.DoNotFix,
        }),
      ),
    ).toBe(AI_RULE_DOES_NOTHING_TEXT);
    expect(
      validateAiRuleFix(values({ investigates: false, fixes: false })),
    ).toBe(AI_RULE_DOES_NOTHING_TEXT);
    expect(AI_RULE_DOES_NOTHING_TEXT).toBe(
      "A rule that doesn't investigate must fix. Turn investigating on in the Investigate step first.",
    );
  });

  test("every other answer, and every answer of a rule that investigates, is fine", () => {
    for (const investigates of [true, false]) {
      for (const fix of AI_RULE_FIXES) {
        expect(
          validateAiRuleFix(
            values({ investigates, [AI_RULE_FIX_FIELD_KEY]: fix }),
          ),
        ).toBe(
          !investigates && fix === AiRuleFix.DoNotFix
            ? AI_RULE_DOES_NOTHING_TEXT
            : null,
        );
      }
    }
  });
});

describe("what a new rule saves", () => {
  test("it investigates: there is no fixing without investigating", () => {
    const item: AutoRemediationRule = new AutoRemediationRule();

    expect(prepareAiRuleCreate(item)).toBe(item);
    expect(item.investigates).toBe(true);

    const fixOnly: AutoRemediationRule = Object.assign(
      new AutoRemediationRule(),
      { investigates: false, fixes: true },
    );

    expect(prepareAiRuleCreate(fixOnly).investigates).toBe(true);
    expect(fixOnly.fixes).toBe(true);
  });

  /*
   * A create says what the Fix step showed - its two columns - whatever was
   * clicked: a rule saved on the answer it opened on asks first, said, not
   * left to the server's defaults.
   */
  test.each([
    [{}, true, AutoRemediationExecutionMode.Suggest],
    [
      { executionMode: AutoRemediationExecutionMode.FullAuto },
      true,
      AutoRemediationExecutionMode.FullAuto,
    ],
    [{ fixes: false }, false, AutoRemediationExecutionMode.Suggest],
    [
      { fixes: false, executionMode: AutoRemediationExecutionMode.FullAuto },
      false,
      AutoRemediationExecutionMode.FullAuto,
    ],
  ])(
    "a create of %j says fixes %s and executionMode %s",
    (
      fields: Partial<AutoRemediationRule>,
      fixes: boolean,
      executionMode: AutoRemediationExecutionMode,
    ) => {
      const item: AutoRemediationRule = Object.assign(
        new AutoRemediationRule(),
        fields,
      );

      prepareAiRuleCreate(item);

      expect([item.investigates, item.fixes, item.executionMode]).toEqual([
        true,
        fixes,
        executionMode,
      ]);
    },
  );
});

describe("the table's Fix column", () => {
  test("names each answer the way the auto remediation rules' table did, and Don't fix its own way", () => {
    expect(AI_RULE_FIX_TEXT).toEqual({
      [AiRuleFix.DoNotFix]: "Doesn't fix",
      [AiRuleFix.AskFirst]: "Asks first",
      [AiRuleFix.WithoutAsking]: "Without asking",
    });
    expect(AI_RULE_FIX_TEXT[AiRuleFix.AskFirst]).toBe(
      AUTO_REMEDIATION_APPROVAL_TEXT.asksFirst,
    );
    expect(AI_RULE_FIX_TEXT[AiRuleFix.WithoutAsking]).toBe(
      AUTO_REMEDIATION_APPROVAL_TEXT.withoutAsking,
    );
    // One column says when a rule investigates and, under it, how it fixes.
    expect(AI_RULE_COLUMN_TITLE).toBe("Investigates and fixes");
  });

  test("an older rule that has OneUptime AI pick a runbook asks first, whatever it says", () => {
    const olderPicking: Record<string, unknown> = {
      remediationAction: AutoRemediationAction.OneUptimeAI,
      aiSelectsRunbook: true,
      executionMode: AutoRemediationExecutionMode.FullAuto,
    };

    expect(getShownAiRuleFix(olderPicking)).toBe(AiRuleFix.AskFirst);
    expect(getAiRuleFixText(olderPicking)).toBe("Asks first");
    // Not fixing, it says so.
    expect(getShownAiRuleFix({ ...olderPicking, fixes: false })).toBe(
      AiRuleFix.DoNotFix,
    );
    // Composing commands wins over picking, as it always has: its own answer.
    expect(
      getShownAiRuleFix({ ...olderPicking, aiComposesCommands: true }),
    ).toBe(AiRuleFix.WithoutAsking);
    // Running its runbooks every time wins over an older flag.
    expect(
      getShownAiRuleFix({
        ...olderPicking,
        remediationAction: AutoRemediationAction.Runbooks,
      }),
    ).toBe(AiRuleFix.WithoutAsking);
  });

  test("every other rule shows its own answer", () => {
    expect(getShownAiRuleFix({})).toBe(AiRuleFix.AskFirst);
    expect(
      getShownAiRuleFix({
        executionMode: AutoRemediationExecutionMode.FullAuto,
      }),
    ).toBe(AiRuleFix.WithoutAsking);
    expect(
      getShownAiRuleFix({
        fixes: false,
        executionMode: AutoRemediationExecutionMode.FullAuto,
      }),
    ).toBe(AiRuleFix.DoNotFix);
    expect(getAiRuleFixText({ fixes: false })).toBe("Doesn't fix");
  });

  test("a rule that only fixes says it does not investigate", () => {
    expect(AI_RULE_DOES_NOT_INVESTIGATE_TEXT).toBe("Doesn't investigate");
  });
});

describe("the Fix question", () => {
  test("says what it asks", () => {
    expect(AI_RULE_FIX_FIELD_COPY).toEqual({
      title: "Fix",
      description:
        "After it investigates, OneUptime AI can fix what it found. Choose whether it does, and whether a fix waits for approval.",
    });
    expect(AI_RULE_FIX_FIELD_KEY).toBe("aiRuleFix");
  });

  test("offers every answer, once, in order", () => {
    expect(
      AI_RULE_FIX_OPTIONS.map((option: { value: string }): string => {
        return option.value;
      }),
    ).toEqual([...AI_RULE_FIXES]);
  });
});

describe("the note on a rule that only fixes", () => {
  test("says what the rule does, in its own kind's words, and offers to investigate too", () => {
    expect(AI_RULE_ONLY_FIXES_COPY).toEqual({
      [AiLane.Incident]: {
        note: "This rule only fixes: it was an auto remediation rule, and does not decide which incidents are investigated.",
        investigateToo: "Investigate too",
      },
      [AiLane.Alert]: {
        note: "This rule only fixes: it was an auto remediation rule, and does not decide which alerts are investigated.",
        investigateToo: "Investigate too",
      },
    });
  });
});

describe("the line under More fields, folded", () => {
  test("a rule that fixes says what an auto remediation rule's said", () => {
    for (const formValues of [
      values({}),
      values({ fixes: true, runbooks: ["a"] }),
      values({ remediationAction: AutoRemediationAction.Runbooks }),
      values({ aiComposesCommands: true }),
    ]) {
      expect(getAiRuleMoreFieldsSummary(formValues)).toEqual(
        getAutoRemediationMoreFieldsSummary(formValues),
      );
    }
  });

  test("a rule that does not fix says what an investigation may use: no runbooks, no pull requests", () => {
    const notFixing: Values = values({ investigates: true, fixes: false });

    expect(getAiRuleMoreFieldsSummary(notFixing)).toEqual(
      getInvestigationRuleMoreFieldsSummary(notFixing),
    );
    expect(getAiRuleMoreFieldsSummary(notFixing)).toEqual([
      "OneUptime AI may use any of your MCP servers and connected repositories.",
    ]);
    // Picked as Don't fix, before the columns are written.
    expect(
      getAiRuleMoreFieldsSummary(
        values({ [AI_RULE_FIX_FIELD_KEY]: AiRuleFix.DoNotFix }),
      ),
    ).toEqual([
      "OneUptime AI may use any of your MCP servers and connected repositories.",
    ]);
  });
});

describe("the form's own parts", () => {
  test("each has a test id of its own", () => {
    const ids: Array<string> = Object.values(AI_RULE_TEST_IDS);

    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) {
      expect(id).toMatch(/^ai-rule-[a-z-]+$/);
    }
  });
});
