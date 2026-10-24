import { EnableAiCopy } from "../AISettings/ProjectAiSettingsCopy";
import { InvestigationNotStartedCode } from "Common/Types/AI/InvestigationNotStartedReason";
import { translationKey } from "Common/UI/Utils/TranslateTemplate";

/*
 * THE WORDS OF THE AI CARD'S ONE LINE, and the reasons it folds for.
 *
 * AiOffSummaryData decides when the AI card folds and builds what it says
 * from these; AiOffSummary draws it. They live apart from those because
 * they need nothing a browser has, so App's docs tests import the very
 * words the line draws (AiCardOffLineDocs) and the locale tests every
 * language's.
 */

export type AiOffSubjectType = "incident" | "alert";

/*
 * The reasons a record was not investigated that are a choice the project
 * made for it, not a fault: Enable AI was off, automatic investigation was
 * off, it matched none of the AI rules that investigate, or its severity was
 * below the minimum the project investigates. Each one changes in the
 * record's AI settings, and none reaches back: turning it on later does not
 * investigate a record already created (only a daily limit's skip is taken
 * back, InvestigationLimitCatchUp - and that one is not a choice).
 */
export const AI_OFF_INVESTIGATION_CODES: ReadonlyArray<InvestigationNotStartedCode> =
  [
    "ai_disabled",
    "automatic_investigation_disabled",
    "no_investigation_rule_matched",
    "severity_below_threshold",
  ];

// --- The line ---

/*
 * What is off, in the maintainer's words. The reason under it says for
 * which record and since when, so the line stays true once the switch is
 * turned on: it never reaches back to this record.
 */
export const AI_OFF_TITLES: {
  investigationOff: string;
  projectAiOff: string;
} = {
  investigationOff: translationKey("AI investigation is off"),
  projectAiOff: translationKey("AI is off for this project"),
};

/*
 * Why, by reason: "recorded" is what was decided when the record was
 * created (or when an AI rule's wait ended), "current" what the settings
 * say now, for a record created before decisions were recorded.
 */
export const AI_OFF_REASONS: Record<
  AiOffSubjectType,
  {
    projectAiOffNow: string;
    projectAiWasOff: string;
    switchWasOff: string;
    switchIsOff: string;
    rulesRecorded: string;
    rulesCurrent: string;
    severityRecorded: string;
    severityCurrent: string;
  }
> = {
  incident: {
    projectAiOffNow: translationKey(
      "OneUptime AI did not investigate or fix this incident.",
    ),
    projectAiWasOff: translationKey(
      "AI was off for this project when this incident was created.",
    ),
    switchWasOff: translationKey(
      "“{{switchName}}” was off when this incident was created.",
    ),
    switchIsOff: translationKey("“{{switchName}}” is off."),
    rulesRecorded: translationKey(
      "This incident matched none of the AI rules that investigate.",
    ),
    rulesCurrent: translationKey(
      "This incident matches none of the AI rules that investigate.",
    ),
    severityRecorded: translationKey(
      "This incident's severity was below the minimum for AI investigation.",
    ),
    severityCurrent: translationKey(
      "This incident's severity is below the minimum for AI investigation.",
    ),
  },
  alert: {
    projectAiOffNow: translationKey(
      "OneUptime AI did not investigate or fix this alert.",
    ),
    projectAiWasOff: translationKey(
      "AI was off for this project when this alert was created.",
    ),
    switchWasOff: translationKey(
      "“{{switchName}}” was off when this alert was created.",
    ),
    switchIsOff: translationKey("“{{switchName}}” is off."),
    rulesRecorded: translationKey(
      "This alert matched none of the AI rules that investigate.",
    ),
    rulesCurrent: translationKey(
      "This alert matches none of the AI rules that investigate.",
    ),
    severityRecorded: translationKey(
      "This alert's severity was below the minimum for AI investigation.",
    ),
    severityCurrent: translationKey(
      "This alert's severity is below the minimum for AI investigation.",
    ),
  },
};

// --- What you can do ---

export const AI_OFF_STEP_TEXTS: {
  turnOnSwitch: string;
  switchIsOnNow: string;
  rulesMatch: Record<AiOffSubjectType, string>;
  rulesFix: Record<AiOffSubjectType, string>;
  ruleFixNamed: string;
  minimumSeverity: string;
} = {
  turnOnSwitch: translationKey("Turn on “{{switchName}}”."),
  switchIsOnNow: translationKey("“{{switchName}}” is on now."),
  rulesMatch: {
    incident: translationKey(
      "Add or change an AI rule so it matches incidents like this one.",
    ),
    alert: translationKey(
      "Add or change an AI rule so it matches alerts like this one.",
    ),
  },
  rulesFix: {
    incident: translationKey(
      "Add or change an AI rule so it fixes incidents like this one.",
    ),
    alert: translationKey(
      "Add or change an AI rule so it fixes alerts like this one.",
    ),
  },
  ruleFixNamed: translationKey(
    "Set AI rule “{{ruleName}}” to fix too, or add a rule that does.",
  ),
  minimumSeverity: translationKey(
    "Lower or clear the minimum severity for AI investigation.",
  ),
};

/*
 * Where each step is changed: Enable AI on Project Settings → AI → AI
 * Features, the rest on the record's AI settings page - the AI rules and
 * the minimum severity under its More settings. The link texts are the
 * ones the AI card and the Remediation card already link with, and the
 * minimum severity's the name of the card it opens at.
 */
export const AI_OFF_LINK_TEXTS: {
  aiFeatures: string;
  settings: Record<AiOffSubjectType, string>;
  rules: Record<AiOffSubjectType, string>;
  minimumSeverity: Record<AiOffSubjectType, string>;
} = {
  // The page's own name: Project Settings → AI → AI Features.
  aiFeatures: translationKey("AI Features"),
  settings: {
    incident: translationKey("Incident AI settings"),
    alert: translationKey("Alert AI settings"),
  },
  rules: {
    incident: translationKey("Incident AI rules"),
    alert: translationKey("Alert AI rules"),
  },
  /*
   * The settings page's own card, under More settings: a link of its own
   * name, so it never reads as a second "Incident AI settings" that goes
   * somewhere else on the page beside the switches' link.
   */
  minimumSeverity: {
    incident: translationKey("Which incidents are investigated"),
    alert: translationKey("Which alerts are investigated"),
  },
};

/*
 * Who can, said to someone who may not: Enable AI takes a project owner or
 * someone with Manage Billing (its own sentence, shared with the AI
 * settings pages); the record's switches and the minimum severity a project
 * owner or admin; the AI rules them, or anyone whose role may create or
 * edit AI rules.
 */
export const AI_OFF_WHO_CAN_CHANGE: {
  aiSwitch: string;
  settings: Record<AiOffSubjectType, string>;
  rules: Record<AiOffSubjectType, string>;
} = {
  aiSwitch: EnableAiCopy.whoCanTurnOn,
  settings: {
    incident: translationKey(
      "A project owner or admin can make these changes in Incidents → AI → Settings.",
    ),
    alert: translationKey(
      "A project owner or admin can make these changes in Alerts → AI → Settings.",
    ),
  },
  rules: {
    incident: translationKey(
      "A project owner or admin, or someone who may edit AI rules, can change them in Incidents → AI → Settings.",
    ),
    alert: translationKey(
      "A project owner or admin, or someone who may edit AI rules, can change them in Alerts → AI → Settings.",
    ),
  },
};

/*
 * It does not reach back: every one of these settings is read when a
 * record is created, so turning it on changes what happens to the next
 * one. While AI is on, OneUptime AI can still be asked about this one.
 */
export const AI_OFF_NOTES: Record<
  AiOffSubjectType,
  { askAi: string; aiOff: string }
> = {
  incident: {
    askAi: translationKey(
      "This applies to new incidents only, not to this one. You can still ask OneUptime AI about it.",
    ),
    aiOff: translationKey(
      "This applies to new incidents only, not to this one.",
    ),
  },
  alert: {
    askAi: translationKey(
      "This applies to new alerts only, not to this one. You can still ask OneUptime AI about it.",
    ),
    aiOff: translationKey("This applies to new alerts only, not to this one."),
  },
};

/*
 * The line's two controls: the conversation, one click away while AI is on,
 * and the fold. Their words are the conversation's own title and the
 * heading the full card puts over what can be done.
 */
export const AI_OFF_ASK_AI: string = translationKey("Ask OneUptime AI");
export const AI_OFF_WHAT_YOU_CAN_DO: string = translationKey("What you can do");
