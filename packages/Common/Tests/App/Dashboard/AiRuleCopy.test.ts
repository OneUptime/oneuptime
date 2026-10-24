import { describe, expect, test } from "@jest/globals";
import {
  AI_RULE_DOES_NOT_INVESTIGATE_TEXT,
  AI_RULE_DOES_NOTHING_TEXT,
  AI_RULE_COLUMN_TITLE,
  AI_RULE_FIX_FIELD_COPY,
  AI_RULE_FIX_FIELD_KEY,
  AI_RULE_FIX_OPTIONS,
  AI_RULE_FIX_TEXT,
  AI_RULE_FOCUS_AFTER_FIX_LIKE_A_NEW_RULE,
  AI_RULE_FOCUS_AFTER_INVESTIGATE_TOO,
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
import {
  AI_LANE_RULES_COPY,
  AiLane,
} from "../../../../App/FeatureSet/Dashboard/src/Components/AISettings/ProjectAiSettingsCopy";
import { getAutoRemediationMoreFieldsSummary } from "../../../../App/FeatureSet/Dashboard/src/Components/AutoRemediation/AutoRemediationRuleCopy";
import { RULE_CODE_REPOSITORIES_FIELD_COPY } from "../../../../App/FeatureSet/Dashboard/src/Components/Code/RuleCodeRepositoriesCopy";
import {
  RULE_MCP_SERVERS_FIELD_COPY,
  getInvestigationRuleMoreFieldsSummary,
} from "../../../../App/FeatureSet/Dashboard/src/Components/ExternalMcpServer/ExternalMcpServerCopy";
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

// "Doesn't fix", "Asks before fixing", "Fixes without asking".
const MENTIONS_FIXING: RegExp = /fix/i;

// What a field's line under its title may say of more than one kind of rule.
const PULL_REQUEST_WORDS: RegExp = /pull request/i;
const FIX_WORDS: RegExp = /\bfix/i;

// The two lines a card's description may run to (ShortDescriptionsGuard).
const CARD_DESCRIPTION_LIMIT: number = 210;
const LINE_LIMIT: number = 150;

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
  test("names each answer as the rule's Fix question does, each about fixing", () => {
    expect(AI_RULE_FIX_TEXT).toEqual({
      [AiRuleFix.DoNotFix]: "Doesn't fix",
      [AiRuleFix.AskFirst]: "Asks before fixing",
      [AiRuleFix.WithoutAsking]: "Fixes without asking",
    });
    // One column says when a rule investigates and, under it, how it fixes.
    expect(AI_RULE_COLUMN_TITLE).toBe("Investigates and fixes");
  });

  /*
   * Under "Right away", in a column called "Investigates and fixes", the
   * auto remediation rules' "Asks first" read as asking before the
   * investigation: every pill says it is about fixing, in the words of the
   * Fix question's answer it stands for.
   */
  test("no pill could be read as being about the investigation above it", () => {
    for (const fix of AI_RULE_FIXES) {
      expect([fix, MENTIONS_FIXING.test(AI_RULE_FIX_TEXT[fix])]).toEqual([
        fix,
        true,
      ]);
    }

    const answerTitles: Record<string, string> = {};

    for (const option of AI_RULE_FIX_OPTIONS) {
      answerTitles[option.value] = option.title;
    }

    expect(answerTitles).toEqual({
      [AiRuleFix.DoNotFix]: "Don't fix",
      [AiRuleFix.AskFirst]: "Ask before fixing",
      [AiRuleFix.WithoutAsking]: "Fix without asking",
    });
    // The pill is the answer, said of the rule.
    expect(AI_RULE_FIX_TEXT[AiRuleFix.AskFirst]).toBe(
      answerTitles[AiRuleFix.AskFirst]!.replace("Ask ", "Asks "),
    );
    expect(AI_RULE_FIX_TEXT[AiRuleFix.WithoutAsking]).toBe(
      answerTitles[AiRuleFix.WithoutAsking]!.replace("Fix ", "Fixes "),
    );
  });

  test("an older rule that has OneUptime AI pick a runbook asks first, whatever it says", () => {
    const olderPicking: Record<string, unknown> = {
      remediationAction: AutoRemediationAction.OneUptimeAI,
      aiSelectsRunbook: true,
      executionMode: AutoRemediationExecutionMode.FullAuto,
    };

    expect(getShownAiRuleFix(olderPicking)).toBe(AiRuleFix.AskFirst);
    expect(getAiRuleFixText(olderPicking)).toBe("Asks before fixing");
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

  /*
   * A note's button takes the note away; keyboard focus goes to the
   * question that takes its place (FocusWhenDrawn): the answer that is
   * picked, else the first one.
   */
  test("focus goes to the picked answer of the question a note stood in for", () => {
    expect(AI_RULE_FOCUS_AFTER_INVESTIGATE_TOO).toEqual([
      "[data-testid='ai-rule-timing-field'] input[type='radio']:checked",
      "[data-testid='ai-rule-timing-field'] input[type='radio']",
    ]);
    expect(AI_RULE_FOCUS_AFTER_FIX_LIKE_A_NEW_RULE).toEqual([
      "[data-testid='ai-rule-fix-field'] [role='radio'][aria-checked='true']",
      "[data-testid='ai-rule-fix-field'] [role='radio'][tabindex='0']",
    ]);
  });
});

/*
 * The AI rules card's line: what happens with no rule, then a rule's three
 * steps in their order - which incidents (Match), when (Investigate) and
 * how each is fixed (Fix). ShortDescriptionsGuard holds a card's line to two
 * lines at 1280px, 210 characters, but cannot read it through the lane's
 * index in the table, so it is held to them here: a line of 224 ran to a
 * third line in German.
 */
describe("the AI rules card", () => {
  test.each([AiLane.Incident, AiLane.Alert])(
    "%s: says what happens with no rule, then the three steps, in two lines",
    (lane: AiLane) => {
      const copy: { aiRulesDescription: string; noAiRulesMessage: string } =
        AI_LANE_RULES_COPY[lane];
      const nouns: string = lane === AiLane.Incident ? "incidents" : "alerts";

      expect(copy.aiRulesDescription.length).toBeLessThanOrEqual(
        CARD_DESCRIPTION_LIMIT,
      );
      expect(copy.noAiRulesMessage.length).toBeLessThanOrEqual(LINE_LIMIT);
      // Pinned by AISettingsSwitchesFirst: with no rule, fixing opens them.
      expect(copy.aiRulesDescription).toContain(
        "while fixing is on, pull requests included.",
      );
      expect(copy.aiRulesDescription).toContain(
        `Add rules to choose which ${nouns} it works on, when, and how each is fixed.`,
      );
    },
  );
});

/*
 * Under More fields, the code repositories and MCP servers are asked of
 * every rule - one that only investigates too - so their lines say nothing
 * that is true only of a rule that fixes: a Don't fix rule's form said
 * OneUptime AI would "open pull requests in them".
 */
describe("the fields every rule shares", () => {
  test("say nothing about fixing or pull requests", () => {
    for (const line of [
      RULE_CODE_REPOSITORIES_FIELD_COPY.aiRuleDescription,
      RULE_MCP_SERVERS_FIELD_COPY.aiRuleDescription,
    ]) {
      expect([line, PULL_REQUEST_WORDS.test(line)]).toEqual([line, false]);
      expect([line, FIX_WORDS.test(line)]).toEqual([line, false]);
      expect(line.length).toBeLessThanOrEqual(LINE_LIMIT);
    }

    expect(RULE_CODE_REPOSITORIES_FIELD_COPY.aiRuleDescription).toBe(
      "OneUptime AI may use all of your connected repositories. Pick some to let it use only those.",
    );
    expect(RULE_MCP_SERVERS_FIELD_COPY.aiRuleDescription).toBe(
      "OneUptime AI may use all of your MCP servers. Pick some to let it use only those.",
    );
  });
});
