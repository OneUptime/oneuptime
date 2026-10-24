import AutoRemediationRule from "Common/Models/DatabaseModels/AutoRemediationRule";
import {
  AiRuleFix,
  doesAiRuleInvestigate,
  getAiRuleFix,
  getAiRuleFixColumns,
  isAiRuleFix,
} from "Common/Types/AI/AiRule";
import { AutoRemediationFixKind } from "Common/Types/AutoRemediation/AutoRemediationFix";
import IconProp from "Common/Types/Icon/IconProp";
import type { CardSelectOption } from "Common/UI/Components/CardSelect/CardSelect";
import type FormValues from "Common/UI/Components/Forms/Types/FormValues";
import {
  translateText,
  translationKey,
} from "Common/UI/Utils/TranslateTemplate";
import { AiLane } from "./ProjectAiSettingsCopy";
import {
  getAutoRemediationMoreFieldsSummary,
  getEditedRuleFixKind,
  isOlderAutoRemediationRule,
  isRunbooksEveryTime,
} from "../AutoRemediation/AutoRemediationRuleCopy";
import { getInvestigationRuleMoreFieldsSummary } from "../ExternalMcpServer/ExternalMcpServerCopy";

/*
 * WHAT AN AI RULE'S FORM AND TABLE SAY - React-free, so the table, its
 * tests, the offline browser suite and App's tests read these exact words.
 *
 * Investigation rules and auto remediation rules were two tables of rules
 * with the same conditions. "Should incident investigation rule and
 * remediation rule be the same entity - we can call it Incident AI rules
 * ... Since its not possible to remediate without investigation" - the
 * maintainer. So a rule asks three questions, a step each:
 *
 *   - Match: which incidents (or alerts) - "All incidents" or "Only
 *     incidents that match conditions";
 *   - Investigate: right away, or only if still open after a wait;
 *   - Fix: don't fix, ask before fixing, or fix without asking - and its
 *     name. What most rules never change is folded under More fields: the
 *     code repositories and MCP servers OneUptime AI may use (for the
 *     investigation too), the LLM provider, the runbooks, the Runner, and
 *     the two pull requests (Types/AI/AiRule).
 *
 * A rule made on the dashboard always investigates: there is no fixing
 * without investigating. One set up as an auto remediation rule before the
 * merge, or created through the API without saying, may only fix - it
 * never decided which incidents are investigated - and its Investigate
 * step says so, with "Investigate too" (getAiRuleOnlyFixesText).
 */

// The Fix step's one question.
export const AI_RULE_FIX_FIELD_COPY: {
  title: string;
  description: string;
} = {
  title: translationKey("Fix"),
  description: translationKey(
    "After it investigates, OneUptime AI can fix what it found. Choose whether it does, and whether a fix waits for approval.",
  ),
};

// Its three answers: the cards of a CardSelect.
export const AI_RULE_FIX_OPTIONS: Array<CardSelectOption> = [
  {
    value: AiRuleFix.DoNotFix,
    title: translationKey("Don't fix"),
    description: translationKey(
      "OneUptime AI investigates and posts what it finds. It changes nothing.",
    ),
    icon: IconProp.Search,
  },
  {
    value: AiRuleFix.AskFirst,
    title: translationKey("Ask before fixing"),
    description: translationKey(
      "Nothing runs until someone approves the fix with one click.",
    ),
    icon: IconProp.HandRaised,
  },
  {
    value: AiRuleFix.WithoutAsking,
    title: translationKey("Fix without asking"),
    /*
     * Said whatever More fields holds: with no runbook picked, a runbook
     * OneUptime AI picks from any of them still waits for approval
     * (AutoRemediationFix.mayAiPickedRunbookStartWithoutAsking), and with
     * no MCP server picked, every change through one waits too
     * (McpRemediationRunner).
     */
    description: translationKey(
      "OneUptime AI fixes on its own where the AI agent's settings allow it, and with the runbooks and MCP servers you pick under More fields.",
    ),
    icon: IconProp.Bolt,
  },
];

// The form-only value the Fix question keeps; it writes fixes and executionMode.
export const AI_RULE_FIX_FIELD_KEY: string = "aiRuleFix";

/*
 * How the table's column says each Fix answer, in the pill under when the
 * rule investigates. Each names fixing: the auto remediation rules' table
 * said "Asks first" under a column called Fix, but under "Investigates and
 * fixes", below "Right away", "Asks first" read as asking before the
 * investigation.
 */
export const AI_RULE_FIX_TEXT: Record<AiRuleFix, string> = {
  [AiRuleFix.DoNotFix]: translationKey("Doesn't fix"),
  [AiRuleFix.AskFirst]: translationKey("Asks before fixing"),
  [AiRuleFix.WithoutAsking]: translationKey("Fixes without asking"),
};

// The table's column, for a rule that only fixes.
export const AI_RULE_DOES_NOT_INVESTIGATE_TEXT: string = translationKey(
  "Doesn't investigate",
);

/*
 * The table's one column for what a rule does: when it investigates, and
 * under it whether and how it fixes. Two columns pushed Status under the
 * row's buttons at 1280px beside the side menu - in German, by more than a
 * column's width.
 */
export const AI_RULE_COLUMN_TITLE: string = translationKey(
  "Investigates and fixes",
);

/*
 * The note on the Investigate step of a rule that only fixes, and the
 * button beside it. Such a rule never decided which incidents are
 * investigated; "Investigate too" makes it one that does - right away, the
 * step's first answer - like every rule made here, once the dialog is
 * saved.
 */
export const AI_RULE_ONLY_FIXES_COPY: Record<
  AiLane,
  { note: string; investigateToo: string }
> = {
  [AiLane.Incident]: {
    note: translationKey(
      "This rule only fixes: it was an auto remediation rule, and does not decide which incidents are investigated.",
    ),
    investigateToo: translationKey("Investigate too"),
  },
  [AiLane.Alert]: {
    note: translationKey(
      "This rule only fixes: it was an auto remediation rule, and does not decide which alerts are investigated.",
    ),
    investigateToo: translationKey("Investigate too"),
  },
};

/*
 * Choosing "Don't fix" for a rule that does not investigate would leave a
 * rule that does nothing: the Fix question says so instead.
 */
export const AI_RULE_DOES_NOTHING_TEXT: string = translationKey(
  "A rule that doesn't investigate must fix. Turn investigating on in the Investigate step first.",
);

// The data-testids of the form's own parts.
export const AI_RULE_TEST_IDS: {
  timingField: string;
  fixField: string;
  onlyFixesNote: string;
  investigateToo: string;
  timingColumn: string;
  fixColumn: string;
  fixColumnLine: string;
} = {
  timingField: "ai-rule-timing-field",
  fixField: "ai-rule-fix-field",
  onlyFixesNote: "ai-rule-only-fixes-note",
  investigateToo: "ai-rule-investigate-too",
  timingColumn: "ai-rule-timing",
  fixColumn: "ai-rule-fix",
  fixColumnLine: "ai-rule-fixed-with",
};

/*
 * Where keyboard focus goes once a note's button has taken the note away
 * (FocusWhenDrawn): after "Investigate too", the answer "When to
 * investigate" holds; after "Fix like a new rule", the Fix answer.
 */
export const AI_RULE_FOCUS_AFTER_INVESTIGATE_TOO: Array<string> = [
  `[data-testid='${AI_RULE_TEST_IDS.timingField}'] input[type='radio']:checked`,
  `[data-testid='${AI_RULE_TEST_IDS.timingField}'] input[type='radio']`,
];

export const AI_RULE_FOCUS_AFTER_FIX_LIKE_A_NEW_RULE: Array<string> = [
  `[data-testid='${AI_RULE_TEST_IDS.fixField}'] [role='radio'][aria-checked='true']`,
  `[data-testid='${AI_RULE_TEST_IDS.fixField}'] [role='radio'][tabindex='0']`,
];

type Values = Record<string, unknown>;

const asValues: (values: unknown) => Values = (values: unknown): Values => {
  return values && typeof values === "object" ? (values as Values) : {};
};

/*
 * Whether the rule being edited investigates. A new rule does: the form
 * starts it on, and its create says so (prepareAiRuleCreate).
 */
export function doesEditedRuleInvestigate(values: unknown): boolean {
  return doesAiRuleInvestigate(asValues(values));
}

/*
 * The Fix answer the rule being edited holds: as picked, or - before
 * anything is picked - as its columns make it.
 */
export function getEditedRuleFix(values: unknown): AiRuleFix {
  const chosen: unknown = asValues(values)[AI_RULE_FIX_FIELD_KEY];

  if (isAiRuleFix(chosen)) {
    return chosen;
  }

  return getAiRuleFix(asValues(values));
}

// Whether the rule being edited fixes what it matches.
export function doesEditedRuleFix(values: unknown): boolean {
  return getEditedRuleFix(values) !== AiRuleFix.DoNotFix;
}

/*
 * The Fix question's check: a rule that does not investigate must fix.
 * Null when the answer is fine.
 */
export function validateAiRuleFix(values: unknown): string | null {
  if (
    !doesEditedRuleInvestigate(values) &&
    getEditedRuleFix(values) === AiRuleFix.DoNotFix
  ) {
    return (
      translateText(AI_RULE_DOES_NOTHING_TEXT) || AI_RULE_DOES_NOTHING_TEXT
    );
  }

  return null;
}

/*
 * The answer the table shows for a saved rule: its own - but an older rule
 * that has OneUptime AI pick one of its runbooks asks first whatever it
 * says, as such a pick is always proposed, never started
 * (AutoRemediationFix.mayAiPickedRunbookStartWithoutAsking).
 */
export function getShownAiRuleFix(rule: {
  fixes?: unknown;
  executionMode?: unknown;
  remediationAction?: unknown;
  aiComposesCommands?: unknown;
  aiSelectsRunbook?: unknown;
}): AiRuleFix {
  const fix: AiRuleFix = getAiRuleFix(rule);

  if (
    fix === AiRuleFix.WithoutAsking &&
    getEditedRuleFixKind(rule as FormValues<AutoRemediationRule>) ===
      AutoRemediationFixKind.AiPicksRunbook
  ) {
    return AiRuleFix.AskFirst;
  }

  return fix;
}

/*
 * The table's Fix column for a rule - its pill, and what an export of the
 * table says: the answer it shows.
 */
export function getAiRuleFixText(
  rule: Parameters<typeof getShownAiRuleFix>[0],
): string {
  return AI_RULE_FIX_TEXT[getShownAiRuleFix(rule)];
}

/*
 * What a rule saves for what it does. A new rule always investigates; every
 * rule's Fix answer is written into the two columns the server reads, so an
 * API client that knows only executionMode reads it as it always did.
 */
export function prepareAiRuleCreate(
  item: AutoRemediationRule,
): AutoRemediationRule {
  item.investigates = true;

  /*
   * The answer the Fix step showed, said whatever was clicked: a rule saved
   * on the answer it opened on ("Ask before fixing") sends it too, rather
   * than leaving the server's defaults to say it.
   */
  const columns: ReturnType<typeof getAiRuleFixColumns> = getAiRuleFixColumns(
    getAiRuleFix(item),
    item.executionMode,
  );
  item.fixes = columns.fixes;
  item.executionMode = columns.executionMode;

  return item;
}

/*
 * The More fields line while folded: what the defaults left do. A rule that
 * fixes says what an auto remediation rule's said (its runbooks, MCP
 * servers, repositories and pull requests); one that only investigates
 * says what an investigation rule's did (its MCP servers and repositories).
 */
export function getAiRuleMoreFieldsSummary(
  values: FormValues<AutoRemediationRule>,
): Array<string> | undefined {
  if (!doesEditedRuleFix(values)) {
    return getInvestigationRuleMoreFieldsSummary(values);
  }

  return getAutoRemediationMoreFieldsSummary(values);
}

/*
 * Whether a fix-only field of More fields shows: only while the rule
 * fixes - with OneUptime AI, for the fields an older or every-time rule has
 * no use for.
 */
export function isFixingWithOneUptimeAi(
  values: FormValues<AutoRemediationRule>,
): boolean {
  return (
    doesEditedRuleFix(values) &&
    !isRunbooksEveryTime(values) &&
    !isOlderAutoRemediationRule(values)
  );
}
