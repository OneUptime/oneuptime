import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import {
  RemediationDecision,
  SILENT_REASONS,
} from "../AutoRemediation/RemediationDecisionLines";
import {
  AI_LANE_SWITCHES,
  AiLane,
  AiLaneAdvancedCard,
  AiLaneSwitchColumn,
  EnableAiCopy,
} from "../AISettings/ProjectAiSettingsCopy";
import { ENABLE_AI_COLUMN } from "../AISettings/EnableAiColumn";
import AutoRemediationRule from "Common/Models/DatabaseModels/AutoRemediationRule";
import Project from "Common/Models/DatabaseModels/Project";
import Route from "Common/Types/API/Route";
import InvestigationNotStartedReason, {
  InvestigationNotStartedCode,
} from "Common/Types/AI/InvestigationNotStartedReason";
import {
  AutoRemediationDecisionEntry,
  AutoRemediationDecisionReason,
  AutoRemediationDecisionStage,
} from "Common/Types/AutoRemediation/AutoRemediationDecision";
import Permission from "Common/Types/Permission";
import { getRouteToPageAnchor } from "Common/UI/Utils/PageAnchor";
import {
  translatableTerm,
  translationKey,
  Translator,
} from "Common/UI/Utils/TranslateTemplate";

/*
 * THE AI CARD AS ONE LINE, WHEN OneUptime AI DID NOTHING BECAUSE IT WAS OFF.
 *
 * "When AI investigation and remediation are off, can we please collapse
 * this card into one simple line that says, 'AI investigation is off.
 * Here's why.' ... Then you can expand that card to see what more you can
 * do to enable AI." - the maintainer.
 *
 * An incident or alert OneUptime AI neither investigated nor fixed, because
 * something the project chose kept it from doing so, used to fill the page
 * with two cards that both said "nothing happened": the AI Investigation
 * card (why, when it was decided, what you can do, the conversation) and the
 * Remediation card ("Fix new incidents automatically" is off). Now the AI
 * card is one quiet line - what is off, and why - that opens to say what to
 * turn on, where, and who can; and the Remediation card leaves it to that
 * line. Whenever either part did something, or could not because something
 * is wrong (no LLM provider, no AI credits, a limit, a failure), both cards
 * stay as they were: those need someone to look.
 *
 * This module decides when the card folds and what it says. It is
 * React-free, so App's tests can read it; AiOffSummary draws it, and
 * InvestigationPanel and RemediationSuggestionCard decide with it.
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

export function isAiOffInvestigationReason(
  reason: InvestigationNotStartedReason | null | undefined,
): reason is InvestigationNotStartedReason {
  return Boolean(reason && AI_OFF_INVESTIGATION_CODES.includes(reason.code));
}

/*
 * Why fixing did nothing with a record, when that too was a choice:
 *  - "ai_off": Enable AI was off;
 *  - "fixing_off": "Fix new incidents automatically" (or alerts) was off;
 *  - "no_rule_matched": AI rules are set up, and none of them matched it;
 *  - "rules_do_not_fix": the AI rules it matched only investigate;
 *  - "not_recorded": nothing was recorded about fixing it (a record from
 *    before fixing said what it did), so there is nothing to show either.
 */
export type RemediationOffReason =
  | "ai_off"
  | "fixing_off"
  | "no_rule_matched"
  | "rules_do_not_fix"
  | "not_recorded";

/*
 * What the Remediation card read about a record, as the AI card needs to
 * know it: still reading ("loading"), fixing did something or has something
 * to show ("on"), or it did nothing because it was off ("off", and why).
 */
export type RemediationFoldState =
  | { kind: "loading" }
  | { kind: "on" }
  | {
      kind: "off";
      reason: RemediationOffReason;
      // The first AI rule that matched, when the rules matched only investigate.
      ruleName?: string | undefined;
    };

export const REMEDIATION_FOLD_LOADING: RemediationFoldState = {
  kind: "loading",
};

/*
 * How the AI card is drawn, for what the page draws around it: "checking"
 * while it does not know yet, "folded" while it is the one-line "AI
 * investigation is off" summary, which speaks for the Remediation card too,
 * and "full" otherwise.
 */
export type AiCardFold = "checking" | "folded" | "full";

/*
 * The decision entries that say fixing was off for the record, by the
 * reason the line gives. Any other entry - a fix started, one that could
 * not start, a cluster or host that is not ready, a record linked to
 * nothing it could fix - means fixing was on and has something to say.
 */
const REMEDIATION_OFF_ENTRY_REASONS: Partial<
  Record<AutoRemediationDecisionReason, RemediationOffReason>
> = {
  [AutoRemediationDecisionReason.EnableAiOff]: "ai_off",
  [AutoRemediationDecisionReason.RemediationOff]: "fixing_off",
  [AutoRemediationDecisionReason.MatchedRulesDoNotFix]: "rules_do_not_fix",
  [AutoRemediationDecisionReason.NotMatchedByAnyRule]: "no_rule_matched",
  // The same, as decisions recorded before rules were merged said it.
  [AutoRemediationDecisionReason.NoRuleMatched]: "no_rule_matched",
  [AutoRemediationDecisionReason.NoRulesConfigured]: "no_rule_matched",
};

// The reason the line gives when several entries say fixing was off.
const REMEDIATION_OFF_REASON_ORDER: ReadonlyArray<RemediationOffReason> = [
  "ai_off",
  "fixing_off",
  "rules_do_not_fix",
  "no_rule_matched",
  "not_recorded",
];

export function getRemediationFoldState(input: {
  isLoaded: boolean;
  suggestionCount: number;
  decision: RemediationDecision | null;
}): RemediationFoldState {
  if (!input.isLoaded) {
    return REMEDIATION_FOLD_LOADING;
  }

  // A fix proposed, approved, run or dismissed is something to show.
  if (input.suggestionCount > 0) {
    return { kind: "on" };
  }

  if (!input.decision) {
    return { kind: "off", reason: "not_recorded" };
  }

  // Remediation waits for an investigation: it is on, and will say more.
  if (input.decision.stage !== AutoRemediationDecisionStage.Evaluated) {
    return { kind: "on" };
  }

  const entries: Array<AutoRemediationDecisionEntry> =
    input.decision.entries.filter(
      (entry: AutoRemediationDecisionEntry): boolean => {
        return !SILENT_REASONS.includes(entry.reason);
      },
    );

  /*
   * Every evaluation records at least one entry that is not silent. None
   * left means its entries are ones this build cannot read (a newer server
   * wrote them, and parseEntries left them out): what fixing did is
   * unknown, so the card stays whole rather than say nothing was fixed.
   */
  if (entries.length === 0) {
    return { kind: "on" };
  }

  let picked: RemediationOffReason = "not_recorded";
  let ruleName: string | undefined = undefined;

  for (const entry of entries) {
    const reason: RemediationOffReason | undefined =
      REMEDIATION_OFF_ENTRY_REASONS[entry.reason];

    if (!reason) {
      return { kind: "on" };
    }

    if (
      REMEDIATION_OFF_REASON_ORDER.indexOf(reason) <
      REMEDIATION_OFF_REASON_ORDER.indexOf(picked)
    ) {
      picked = reason;
      ruleName =
        reason === "rules_do_not_fix" ? entry.ruleName || undefined : undefined;
    }
  }

  return ruleName
    ? { kind: "off", reason: picked, ruleName }
    : { kind: "off", reason: picked };
}

// Two states say the same thing: a page reports a change only when it is one.
export function isSameRemediationFoldState(
  a: RemediationFoldState,
  b: RemediationFoldState,
): boolean {
  if (a.kind !== b.kind) {
    return false;
  }

  if (a.kind !== "off" || b.kind !== "off") {
    return true;
  }

  return a.reason === b.reason && (a.ruleName || "") === (b.ruleName || "");
}

/*
 * What the folded AI card tells the conversation it closes with
 * (InvestigationConversationSlot.fold). An empty conversation is folded
 * into the line's Ask OneUptime AI: it shows once something is in it - a
 * question, an answer on its way - or once the reader asks for it from the
 * line, when its box takes the focus.
 */
export interface InvestigationConversationFold {
  // A new number each time the line's Ask OneUptime AI is pressed; 0 before.
  askRequest: number;
  // Told whether the conversation has something to show by itself.
  onHasContentChange: (hasContent: boolean) => void;
}

/*
 * Whether the AI card is the one-line summary: the record was not
 * investigated for a reason the project chose, and fixing did nothing for
 * one either. "checking" while the Remediation card is still reading.
 * Without what the Remediation card read (a page that does not pass it on)
 * the card never folds: it cannot tell that fixing did nothing.
 */
export function getAiCardFold(input: {
  isInvestigationLoaded: boolean;
  offReason: InvestigationNotStartedReason | null;
  remediation: RemediationFoldState | undefined;
}): AiCardFold {
  if (!input.isInvestigationLoaded) {
    return "checking";
  }

  if (!input.offReason || !input.remediation) {
    return "full";
  }

  if (input.remediation.kind === "loading") {
    return "checking";
  }

  return input.remediation.kind === "off" ? "folded" : "full";
}

/*
 * Whether the Remediation card leaves what it would say to the AI card: it
 * would only say that fixing was off, and the AI card is the one-line
 * summary that says so - or is still deciding whether it is, so the card
 * does not show for a moment and go.
 */
export function isRemediationFoldedIntoAiCard(input: {
  state: RemediationFoldState;
  aiCardFold: AiCardFold | undefined;
}): boolean {
  return (
    input.state.kind === "off" &&
    (input.aiCardFold === "folded" || input.aiCardFold === "checking")
  );
}

/*
 * The project's two switches for the record's kind as they are now, read
 * when the card folds: true or false, or undefined while unknown (not read
 * yet, or not readable by this reader). The summary says "is on now" for a
 * switch that was off when the record was created and is on since, rather
 * than asking someone to turn on what is already on.
 */
export interface AiLaneSwitchStates {
  investigate?: boolean | undefined;
  fix?: boolean | undefined;
}

export function getAiLane(subjectType: AiOffSubjectType): AiLane {
  return subjectType === "alert" ? AiLane.Alert : AiLane.Incident;
}

/*
 * The lane's investigate switch, then its fix switch, as its AI settings
 * page draws them (AI_LANE_SWITCHES): the column and the title.
 */
export function getAiLaneSwitchColumns(subjectType: AiOffSubjectType): {
  investigate: AiLaneSwitchColumn;
  fix: AiLaneSwitchColumn;
} {
  return subjectType === "alert"
    ? {
        investigate: "enableAutomaticAlertInvestigation",
        fix: "enableAutomaticAlertRemediation",
      }
    : {
        investigate: "enableAutomaticIncidentInvestigation",
        fix: "enableAutomaticIncidentRemediation",
      };
}

function getSwitchTitle(
  subjectType: AiOffSubjectType,
  column: AiLaneSwitchColumn,
): string {
  return (
    AI_LANE_SWITCHES[getAiLane(subjectType)].find(
      (definition: { column: AiLaneSwitchColumn }): boolean => {
        return definition.column === column;
      },
    )?.title || column
  );
}

/*
 * The places on the record's AI settings page a step sends someone to: the
 * folded More settings opens by itself at the card the address names
 * (AdvancedPageSection), so nobody lands on a fold and has to find the
 * setting. The keys are the cards' own (AiLaneAdvancedCard), which the page
 * uses as their ids.
 */
export const AI_SETTINGS_RULES_ANCHOR: string = AiLaneAdvancedCard.AiRules;
export const AI_SETTINGS_WHICH_ANCHOR: string =
  AiLaneAdvancedCard.WhichAreInvestigated;

export type AiOffStepKey =
  | "enable-ai"
  | "investigate-switch"
  | "investigate-rules"
  | "minimum-severity"
  | "fix-switch"
  | "fix-rules";

export interface AiOffStepLink {
  // Translated.
  text: string;
  route: Route;
}

export interface AiOffStep {
  key: AiOffStepKey;
  // Translated: what to change, or that it is on now.
  text: string;
  // On now: nothing left to do for it.
  isDone: boolean;
  // Where it is changed, for someone who may change it. Null once done.
  link: AiOffStepLink | null;
  // Who may change it: the update rules of what it changes.
  permissions: Array<Permission>;
  // Translated: who can, said instead of the link to everyone else.
  whoCanChange: string;
}

export interface AiOffSummary {
  // Translated: what is off.
  title: string;
  // Translated: why, in one sentence.
  reason: string;
  // What would have OneUptime AI investigate (and fix) the next one.
  steps: Array<AiOffStep>;
  // Translated: none of it reaches back to this record.
  note: string;
}

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
 * ones the AI card and the Remediation card already link with.
 */
export const AI_OFF_LINK_TEXTS: {
  aiFeatures: string;
  settings: Record<AiOffSubjectType, string>;
  rules: Record<AiOffSubjectType, string>;
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

// --- Who may change what ---

function getColumnUpdatePermissions(column: string): Array<Permission> {
  return new Project().getColumnAccessControlFor(column)?.update || [];
}

// Creating a rule or changing one: either is enough to make one match.
function getAiRulePermissions(): Array<Permission> {
  const rule: AutoRemediationRule = new AutoRemediationRule();

  return Array.from(
    new Set<Permission>([
      ...(rule.getCreatePermissions() || []),
      ...(rule.getUpdatePermissions() || []),
    ]),
  );
}

function getMinimumSeverityColumn(subjectType: AiOffSubjectType): string {
  return subjectType === "alert"
    ? "alertInvestigationMinimumSeverity"
    : "incidentInvestigationMinimumSeverity";
}

function routeTo(page: PageMap, anchor?: string | undefined): Route | null {
  const route: Route | undefined = RouteMap[page] as Route | undefined;

  if (!route) {
    return null;
  }

  const populated: Route = RouteUtil.populateRouteParams(route);

  return anchor ? getRouteToPageAnchor(populated, anchor) : populated;
}

function getSettingsPage(subjectType: AiOffSubjectType): PageMap {
  return subjectType === "alert"
    ? PageMap.ALERTS_SETTINGS_AI
    : PageMap.INCIDENTS_SETTINGS_AI;
}

function link(
  translator: Translator,
  text: string,
  route: Route | null,
): AiOffStepLink | null {
  return route ? { text: translator.translateText(text) || text, route } : null;
}

/*
 * What the folded card says, from why the record was not investigated, why
 * nothing fixed it, and how things stand now.
 */
export function getAiOffSummary(input: {
  subjectType: AiOffSubjectType;
  // One of AI_OFF_INVESTIGATION_CODES.
  reason: InvestigationNotStartedReason;
  // Why fixing did nothing.
  remediationReason: RemediationOffReason;
  // The first AI rule that matched, when the rules matched only investigate.
  ruleName?: string | undefined;
  // Whether the project has AI on now (useAiOffered).
  isAiOn: boolean;
  switches: AiLaneSwitchStates;
  translator: Translator;
}): AiOffSummary {
  const { subjectType, reason, remediationReason, translator } = input;
  const code: InvestigationNotStartedCode = reason.code;
  const isRecorded: boolean = reason.source === "recorded";
  const columns: { investigate: AiLaneSwitchColumn; fix: AiLaneSwitchColumn } =
    getAiLaneSwitchColumns(subjectType);
  const reasons: (typeof AI_OFF_REASONS)[AiOffSubjectType] =
    AI_OFF_REASONS[subjectType];

  const switchName: (column: AiLaneSwitchColumn) => {
    switchName: ReturnType<typeof translatableTerm>;
  } = (
    column: AiLaneSwitchColumn,
  ): { switchName: ReturnType<typeof translatableTerm> } => {
    return {
      switchName: translatableTerm(getSwitchTitle(subjectType, column)),
    };
  };

  const title: string =
    translator.translateText(
      input.isAiOn
        ? AI_OFF_TITLES.investigationOff
        : AI_OFF_TITLES.projectAiOff,
    ) || "";

  let reasonText: string = "";

  if (code === "ai_disabled") {
    reasonText = !input.isAiOn
      ? translator.translateText(reasons.projectAiOffNow) || ""
      : translator.translateText(reasons.projectAiWasOff) || "";
  } else if (code === "automatic_investigation_disabled") {
    reasonText = translator.translateTemplate(
      isRecorded ? reasons.switchWasOff : reasons.switchIsOff,
      switchName(columns.investigate),
    );
  } else if (code === "no_investigation_rule_matched") {
    reasonText =
      translator.translateText(
        isRecorded ? reasons.rulesRecorded : reasons.rulesCurrent,
      ) || "";
  } else {
    reasonText =
      translator.translateText(
        isRecorded ? reasons.severityRecorded : reasons.severityCurrent,
      ) || "";
  }

  const steps: Array<AiOffStep> = [];
  const settingsPermissions: (column: string) => Array<Permission> =
    getColumnUpdatePermissions;
  const whoCanChangeSettings: string =
    translator.translateText(AI_OFF_WHO_CAN_CHANGE.settings[subjectType]) || "";
  const whoCanChangeRules: string =
    translator.translateText(AI_OFF_WHO_CAN_CHANGE.rules[subjectType]) || "";

  const addSwitchStep: (data: {
    key: AiOffStepKey;
    column: AiLaneSwitchColumn;
    isDone: boolean;
  }) => void = (data: {
    key: AiOffStepKey;
    column: AiLaneSwitchColumn;
    isDone: boolean;
  }): void => {
    steps.push({
      key: data.key,
      text: translator.translateTemplate(
        data.isDone
          ? AI_OFF_STEP_TEXTS.switchIsOnNow
          : AI_OFF_STEP_TEXTS.turnOnSwitch,
        switchName(data.column),
      ),
      isDone: data.isDone,
      link: data.isDone
        ? null
        : link(
            translator,
            AI_OFF_LINK_TEXTS.settings[subjectType],
            routeTo(getSettingsPage(subjectType)),
          ),
      permissions: settingsPermissions(data.column),
      whoCanChange: whoCanChangeSettings,
    });
  };

  const addRulesStep: (key: AiOffStepKey, text: string) => void = (
    key: AiOffStepKey,
    text: string,
  ): void => {
    steps.push({
      key,
      text,
      isDone: false,
      link: link(
        translator,
        AI_OFF_LINK_TEXTS.rules[subjectType],
        routeTo(getSettingsPage(subjectType), AI_SETTINGS_RULES_ANCHOR),
      ),
      permissions: getAiRulePermissions(),
      whoCanChange: whoCanChangeRules,
    });
  };

  /*
   * Enable AI first: nothing else runs while it is off. Said done when it
   * was the reason and is on now, so the reader sees what changed.
   */
  if (
    !input.isAiOn ||
    code === "ai_disabled" ||
    remediationReason === "ai_off"
  ) {
    const isDone: boolean = input.isAiOn;

    steps.push({
      key: "enable-ai",
      text: translator.translateTemplate(
        isDone
          ? AI_OFF_STEP_TEXTS.switchIsOnNow
          : AI_OFF_STEP_TEXTS.turnOnSwitch,
        { switchName: translatableTerm(EnableAiCopy.switchTitle) },
      ),
      isDone,
      link: isDone
        ? null
        : link(
            translator,
            AI_OFF_LINK_TEXTS.aiFeatures,
            routeTo(PageMap.SETTINGS_AI_FEATURES),
          ),
      permissions: getColumnUpdatePermissions(ENABLE_AI_COLUMN),
      whoCanChange:
        translator.translateText(AI_OFF_WHO_CAN_CHANGE.aiSwitch) || "",
    });
  }

  /*
   * Investigating: the switch when it was the reason - or, when AI was,
   * once it is known to be off now too.
   */
  if (
    code === "automatic_investigation_disabled" ||
    (code === "ai_disabled" && input.switches.investigate === false)
  ) {
    addSwitchStep({
      key: "investigate-switch",
      column: columns.investigate,
      isDone: input.switches.investigate === true,
    });
  }

  if (code === "no_investigation_rule_matched") {
    addRulesStep(
      "investigate-rules",
      translator.translateText(AI_OFF_STEP_TEXTS.rulesMatch[subjectType]) || "",
    );
  }

  if (code === "severity_below_threshold") {
    steps.push({
      key: "minimum-severity",
      text: translator.translateText(AI_OFF_STEP_TEXTS.minimumSeverity) || "",
      isDone: false,
      link: link(
        translator,
        AI_OFF_LINK_TEXTS.settings[subjectType],
        routeTo(getSettingsPage(subjectType), AI_SETTINGS_WHICH_ANCHOR),
      ),
      permissions: settingsPermissions(getMinimumSeverityColumn(subjectType)),
      whoCanChange: whoCanChangeSettings,
    });
  }

  /*
   * Fixing: the switch when it was the reason - or, when AI was, once it is
   * known to be off now too. Fixing changes production systems, so it is
   * never suggested when nothing said it was off.
   */
  if (
    remediationReason === "fixing_off" ||
    (remediationReason === "ai_off" && input.switches.fix === false)
  ) {
    addSwitchStep({
      key: "fix-switch",
      column: columns.fix,
      isDone: input.switches.fix === true,
    });
  }

  /*
   * The AI rules decide which records are fixed. A rule made on the
   * dashboard investigates and asks before fixing by default, so when the
   * record matched no rule at all, the rule that makes it investigated
   * makes it fixed too: one step says both.
   */
  const isRulesStepEnough: boolean =
    code === "no_investigation_rule_matched" &&
    remediationReason === "no_rule_matched";

  if (
    !isRulesStepEnough &&
    (remediationReason === "no_rule_matched" ||
      remediationReason === "rules_do_not_fix")
  ) {
    addRulesStep(
      "fix-rules",
      remediationReason === "rules_do_not_fix" && input.ruleName
        ? translator.translateTemplate(AI_OFF_STEP_TEXTS.ruleFixNamed, {
            ruleName: input.ruleName,
          })
        : translator.translateText(AI_OFF_STEP_TEXTS.rulesFix[subjectType]) ||
            "",
    );
  }

  return {
    title,
    reason: reasonText,
    steps,
    note:
      translator.translateText(
        input.isAiOn
          ? AI_OFF_NOTES[subjectType].askAi
          : AI_OFF_NOTES[subjectType].aiOff,
      ) || "",
  };
}
