import {
  AI_LANE_SWITCHES,
  AiLane,
  EnableAiCopy,
} from "../AISettings/ProjectAiSettingsCopy";
import {
  AI_OFF_NOTES,
  AI_OFF_STEP_TEXTS,
  AI_OFF_TITLES,
  AiOffSubjectType,
} from "./AiOffSummaryWords";
import InvestigationNotStartedReason, {
  InvestigationNotStartedCode,
  InvestigationNotStartedFacts,
} from "Common/Types/AI/InvestigationNotStartedReason";
import { joinSentences } from "Common/UI/Components/DeleteConfirmation/DeleteConsequences";
import {
  PluralTemplate,
  TemplateValues,
  translatableTerm,
  translationKey,
  Translator,
} from "Common/UI/Utils/TranslateTemplate";

/*
 * WHY OneUptime AI DID NOT INVESTIGATE AN INCIDENT OR ALERT, IN THE READER'S
 * LANGUAGE (issue #6656).
 *
 * The record's AI card says why nothing was investigated: a title, why, and
 * what can be done. The server writes those three in English
 * (InvestigationEligibility) and still does, for API readers and older
 * Dashboards. The card words each reason itself, from its code, how it was
 * decided (its source) and the facts sent with it
 * (InvestigationNotStartedFacts), so it reads in every Dashboard language. A
 * code this table does not know - one a newer server sends - is drawn in the
 * server's own English (InvestigationNotStarted).
 *
 * When it was decided is said by the line under the description ("Decision
 * recorded at creation", "... when the wait ended", "Based on current
 * settings"), so these words say only what stopped it: in the past for a
 * decision recorded then, in the present for the current settings. Where a
 * step is changed is the link under it, or who can change it.
 *
 * A sentence that refers to the record names it (this incident, this
 * alert), even where the English could share one sentence: the English is
 * the translation key, and a language whose words agree with the record's
 * gender needs to know which one it is. Settings are named as the Dashboard
 * draws them; severity names, which are a project's own data, are set apart
 * from the sentence around them.
 *
 * React-free, so the locale tests read the very words the card draws.
 */

export type NotStartedSubjectType = AiOffSubjectType;

// A sentence with a count in it takes the count's own form in every language.
export type NotStartedSentence = string | PluralTemplate;

// As decided then ("recorded") and as the settings are now ("current").
export interface NotStartedVariants<T> {
  recorded: T;
  current: T;
}

// A fact a sentence names (InvestigationNotStartedFacts).
export type NotStartedFact =
  | "severityName"
  | "minimumSeverityName"
  | "cooldownWindowMinutes";

export interface NotStartedCodeWords {
  title: NotStartedVariants<string>;
  description: NotStartedVariants<NotStartedSentence>;
  // What can be done, in sentences of their own, one after the other.
  nextStep: NotStartedVariants<ReadonlyArray<string>>;
  // Said instead when the reason has every fact the sentence names.
  withFacts?:
    | {
        needs: ReadonlyArray<NotStartedFact>;
        description: NotStartedVariants<NotStartedSentence>;
      }
    | undefined;
  // A daily token limit of 0, which pauses the work rather than running out.
  paused?:
    | {
        title: NotStartedVariants<string>;
        description: NotStartedVariants<NotStartedSentence>;
        nextStep: ReadonlyArray<string>;
      }
    | undefined;
  /*
   * Decided when an AI rule's wait ended (decidedAfterWaitMinutes), where
   * that changes what happened.
   */
  afterWait?: NotStartedSentence | undefined;
  // Neither the decision taken then nor today's checks could be read.
  unknown?: NotStartedSentence | undefined;
  // The setting a sentence names as {{settingName}}, as its page draws it.
  settingName?: string | undefined;
  // What a sentence with a count counts.
  count?: "cooldownWindowMinutes" | "waitMinutes" | undefined;
}

// --- Sentences several reasons share ---

const SETTING_WAS_OFF: string = translationKey(
  "“{{settingName}}” was off, so no investigation started.",
);
const SETTING_IS_OFF: string = translationKey(
  "“{{settingName}}” is off, so no new investigation can start.",
);
const CHECK_SETTING_IS_ON: string = translationKey(
  "Check that “{{settingName}}” is on.",
);
const NOTHING_IS_TRIED_AGAIN: string = translationKey(
  "Nothing is tried again automatically.",
);
const ASK_ADMIN_FOR_SETTINGS: string = translationKey(
  "Ask a project administrator to check the service's health and the AI settings.",
);
const ASK_ADMIN_FOR_LOGS: string = translationKey(
  "Ask a project administrator to check the service's health and the server logs.",
);

export const NOT_STARTED_TITLES: {
  aiWasOff: string;
  providerWasMissing: string;
  providerIsMissing: string;
  creditsWereOut: string;
  creditsAreOut: string;
  dailyLimitWasReached: string;
  dailyLimitIsReached: string;
  severityWasBelow: string;
  severityIsBelow: string;
  skippedInCooldown: string;
  inCooldown: string;
  resolvedBeforeInvestigation: string;
  tokenLimitWasReached: string;
  tokenLimitIsReached: string;
  aiWorkWasPaused: string;
  aiWorkIsPaused: string;
  tokenLimitNotChecked: string;
  tokenLimitCannotBeChecked: string;
  notQueued: string;
  queueCannotBeChecked: string;
  checksNotFinished: string;
  checksCannotBeFinished: string;
  noRunRecorded: string;
} = {
  aiWasOff: translationKey("AI was off for this project"),
  providerWasMissing: translationKey("No LLM provider was available"),
  providerIsMissing: translationKey("No LLM provider is available"),
  creditsWereOut: translationKey("The project was out of AI credits"),
  creditsAreOut: translationKey("The project is out of AI credits"),
  dailyLimitWasReached: translationKey(
    "The project's daily AI limit was reached",
  ),
  dailyLimitIsReached: translationKey(
    "The project's daily AI limit is reached",
  ),
  severityWasBelow: translationKey(
    "Severity was below the minimum for AI investigation",
  ),
  severityIsBelow: translationKey(
    "Severity is below the minimum for AI investigation",
  ),
  skippedInCooldown: translationKey(
    "Skipped during the re-investigation cooldown",
  ),
  inCooldown: translationKey("Within the re-investigation cooldown"),
  resolvedBeforeInvestigation: translationKey(
    "Resolved before the investigation started",
  ),
  tokenLimitWasReached: translationKey("The daily AI token limit was reached"),
  tokenLimitIsReached: translationKey("The daily AI token limit is reached"),
  aiWorkWasPaused: translationKey("Automatic AI work was paused"),
  aiWorkIsPaused: translationKey("Automatic AI work is paused"),
  tokenLimitNotChecked: translationKey(
    "The AI token limit could not be checked",
  ),
  tokenLimitCannotBeChecked: translationKey(
    "The AI token limit cannot be checked right now",
  ),
  notQueued: translationKey("The investigation could not be queued"),
  queueCannotBeChecked: translationKey(
    "The investigation queue cannot be checked right now",
  ),
  checksNotFinished: translationKey("The AI checks could not be finished"),
  checksCannotBeFinished: translationKey(
    "The AI checks cannot be finished right now",
  ),
  noRunRecorded: translationKey("No investigation was recorded"),
};

const DESCRIPTIONS: {
  providerWasMissing: string;
  providerIsMissing: string;
  creditsWereOut: string;
  creditsAreOut: string;
  dailyLimitWasReached: string;
  dailyLimitIsReached: string;
  tokenLimitWasUsedUp: string;
  tokenLimitIsUsedUp: string;
  tokenLimitWasZero: string;
  tokenLimitIsZero: string;
  tokenLimitNotChecked: string;
  tokenLimitCannotBeChecked: string;
  notQueued: string;
  queueCannotBeChecked: string;
  checksNotFinished: string;
  checksCannotBeFinished: string;
  checksNotRead: string;
} = {
  providerWasMissing: translationKey(
    "OneUptime AI had no LLM provider to run on, so no investigation started.",
  ),
  providerIsMissing: translationKey(
    "OneUptime AI has no LLM provider to run on, so no new investigation can start.",
  ),
  creditsWereOut: translationKey(
    "The project had no AI credits left, so no investigation started.",
  ),
  creditsAreOut: translationKey(
    "The project has no AI credits left, so no new investigation can start.",
  ),
  dailyLimitWasReached: translationKey(
    "The project had reached one of its own daily AI limits, so no investigation started.",
  ),
  dailyLimitIsReached: translationKey(
    "The project has reached one of its own daily AI limits, so no new investigation can start before midnight UTC.",
  ),
  tokenLimitWasUsedUp: translationKey(
    "AI work had used up the day's “{{settingName}}”, so no investigation started.",
  ),
  tokenLimitIsUsedUp: translationKey(
    "AI work has used up today's “{{settingName}}”, so no new investigation can start before midnight UTC.",
  ),
  tokenLimitWasZero: translationKey(
    "“{{settingName}}” was set to 0, which pauses automatic AI work, so no investigation started.",
  ),
  tokenLimitIsZero: translationKey(
    "“{{settingName}}” is set to 0, which pauses automatic AI work.",
  ),
  tokenLimitNotChecked: translationKey(
    "OneUptime AI could not check the daily AI token limit, so it started no investigation that might go over it.",
  ),
  tokenLimitCannotBeChecked: translationKey(
    "OneUptime AI cannot check the daily AI token limit right now, so it cannot tell whether a new investigation could start.",
  ),
  notQueued: translationKey(
    "OneUptime AI could not save the investigation to its queue, so none started.",
  ),
  queueCannotBeChecked: translationKey(
    "OneUptime AI cannot tell right now whether a new investigation could be queued.",
  ),
  checksNotFinished: translationKey(
    "OneUptime AI could not finish the checks it runs before an automatic investigation, so none started.",
  ),
  checksCannotBeFinished: translationKey(
    "OneUptime AI cannot finish the checks it runs before an automatic investigation right now.",
  ),
  checksNotRead: translationKey(
    "No investigation was found, and neither the decision taken then nor today's checks could be read.",
  ),
};

const STEPS: {
  setUpProvider: string;
  addCredits: string;
  raiseOrRemoveDailyLimit: string;
  shortenCooldown: string;
  raiseTokenLimitOrWait: string;
  raiseTokenLimitAboveZero: string;
  waitIsOnRules: string;
} = {
  setUpProvider: translationKey("Set up an LLM provider for the project."),
  addCredits: translationKey("Add AI credits to the project."),
  raiseOrRemoveDailyLimit: translationKey(
    "Raise or remove the limit under More settings, or wait until midnight UTC, when it resets.",
  ),
  shortenCooldown: translationKey(
    "Shorten or clear the re-investigation cooldown.",
  ),
  raiseTokenLimitOrWait: translationKey(
    "Raise “{{settingName}}” under More settings, or wait until midnight UTC, when usage resets.",
  ),
  raiseTokenLimitAboveZero: translationKey(
    "Raise “{{settingName}}” above 0 under More settings, or clear it.",
  ),
  waitIsOnRules: translationKey(
    "The wait is set on the AI rules, under More settings.",
  ),
};

/*
 * The sentences that name the record, by its kind: the same sentence for an
 * incident and an alert, each worded on its own.
 */
export const NOT_STARTED_BY_KIND: Record<
  NotStartedSubjectType,
  {
    // The daily token limit's field, as the AI settings page titles it.
    tokenLimitName: string;
    dailyLimitCatchUp: string;
    severityWasBelow: string;
    severityIsBelow: string;
    severityWasBelowNamed: string;
    severityIsBelowNamed: string;
    cooldownWasOn: string;
    cooldownIsOn: string;
    cooldownWasOnFor: PluralTemplate;
    cooldownIsOnFor: PluralTemplate;
    outsideRulesRecorded: string;
    outsideRulesCurrent: string;
    rulesMatchedNone: string;
    rulesMatchNone: string;
    rulesMatchedNoneAfterWait: string;
    createdResolvedTitle: string;
    createdResolved: string;
    askAiBelow: string;
    resolvedDuringWait: PluralTemplate;
    noRunRecorded: string;
    noRunNextStep: string;
  }
> = {
  incident: {
    tokenLimitName: translationKey("Daily Incident AI Token Limit"),
    dailyLimitCatchUp: translationKey(
      "OneUptime AI investigates this incident when the limit resets at midnight UTC, if it is still open then, or as soon as the limit is raised or removed under More settings.",
    ),
    severityWasBelow: translationKey(
      "OneUptime AI investigates only the incidents at or above a minimum severity, and this one was below it.",
    ),
    severityIsBelow: translationKey(
      "OneUptime AI investigates only the incidents at or above a minimum severity, and this one is below it.",
    ),
    severityWasBelowNamed: translationKey(
      "This incident's severity, {{severity}}, was below the minimum for AI investigation, {{minimumSeverity}}.",
    ),
    severityIsBelowNamed: translationKey(
      "This incident's severity, {{severity}}, is below the minimum for AI investigation, {{minimumSeverity}}.",
    ),
    cooldownWasOn: translationKey(
      "Another incident on the same monitor had been investigated within the re-investigation cooldown, so no investigation started.",
    ),
    cooldownIsOn: translationKey(
      "Another incident on the same monitor was investigated within the re-investigation cooldown, so no new investigation can start yet.",
    ),
    cooldownWasOnFor: {
      one: "Another incident on the same monitor had been investigated within the re-investigation cooldown of {{count}} minute, so no investigation started.",
      other:
        "Another incident on the same monitor had been investigated within the re-investigation cooldown of {{count}} minutes, so no investigation started.",
    },
    cooldownIsOnFor: {
      one: "Another incident on the same monitor was investigated within the re-investigation cooldown of {{count}} minute, so no new investigation can start yet.",
      other:
        "Another incident on the same monitor was investigated within the re-investigation cooldown of {{count}} minutes, so no new investigation can start yet.",
    },
    outsideRulesRecorded: translationKey(
      "This incident was outside the AI rules that investigate",
    ),
    outsideRulesCurrent: translationKey(
      "This incident is outside the AI rules that investigate",
    ),
    rulesMatchedNone: translationKey(
      "OneUptime AI investigates only the incidents that match one of the AI rules that investigate, and this one matched none.",
    ),
    rulesMatchNone: translationKey(
      "OneUptime AI investigates only the incidents that match one of the AI rules that investigate, and this one matches none.",
    ),
    rulesMatchedNoneAfterWait: translationKey(
      "An AI rule made OneUptime AI wait, and when the wait ended this incident matched none of the AI rules that investigate any more: it or the rules had changed.",
    ),
    createdResolvedTitle: translationKey(
      "This incident was created already resolved",
    ),
    createdResolved: translationKey(
      "The incident was over before it was recorded, so OneUptime AI did not investigate it automatically.",
    ),
    askAiBelow: translationKey(
      "To look into this incident anyway, ask OneUptime AI below.",
    ),
    resolvedDuringWait: {
      one: "An AI rule made OneUptime AI wait {{count}} minute to see whether this incident would still be open. It was resolved first, so it was not investigated.",
      other:
        "An AI rule made OneUptime AI wait {{count}} minutes to see whether this incident would still be open. It was resolved first, so it was not investigated.",
    },
    noRunRecorded: translationKey(
      "This incident would be investigated under today's settings, but no investigation or decision was recorded for it. The settings may have changed since it was created.",
    ),
    noRunNextStep: translationKey(
      "Automatic investigation starts when an incident is created, so turning it on later does not investigate older ones. If new incidents are not investigated either, check the AI Logs.",
    ),
  },
  alert: {
    tokenLimitName: translationKey("Daily Alert AI Token Limit"),
    dailyLimitCatchUp: translationKey(
      "OneUptime AI investigates this alert when the limit resets at midnight UTC, if it is still open then, or as soon as the limit is raised or removed under More settings.",
    ),
    severityWasBelow: translationKey(
      "OneUptime AI investigates only the alerts at or above a minimum severity, and this one was below it.",
    ),
    severityIsBelow: translationKey(
      "OneUptime AI investigates only the alerts at or above a minimum severity, and this one is below it.",
    ),
    severityWasBelowNamed: translationKey(
      "This alert's severity, {{severity}}, was below the minimum for AI investigation, {{minimumSeverity}}.",
    ),
    severityIsBelowNamed: translationKey(
      "This alert's severity, {{severity}}, is below the minimum for AI investigation, {{minimumSeverity}}.",
    ),
    cooldownWasOn: translationKey(
      "Another alert on the same monitor had been investigated within the re-investigation cooldown, so no investigation started.",
    ),
    cooldownIsOn: translationKey(
      "Another alert on the same monitor was investigated within the re-investigation cooldown, so no new investigation can start yet.",
    ),
    cooldownWasOnFor: {
      one: "Another alert on the same monitor had been investigated within the re-investigation cooldown of {{count}} minute, so no investigation started.",
      other:
        "Another alert on the same monitor had been investigated within the re-investigation cooldown of {{count}} minutes, so no investigation started.",
    },
    cooldownIsOnFor: {
      one: "Another alert on the same monitor was investigated within the re-investigation cooldown of {{count}} minute, so no new investigation can start yet.",
      other:
        "Another alert on the same monitor was investigated within the re-investigation cooldown of {{count}} minutes, so no new investigation can start yet.",
    },
    outsideRulesRecorded: translationKey(
      "This alert was outside the AI rules that investigate",
    ),
    outsideRulesCurrent: translationKey(
      "This alert is outside the AI rules that investigate",
    ),
    rulesMatchedNone: translationKey(
      "OneUptime AI investigates only the alerts that match one of the AI rules that investigate, and this one matched none.",
    ),
    rulesMatchNone: translationKey(
      "OneUptime AI investigates only the alerts that match one of the AI rules that investigate, and this one matches none.",
    ),
    rulesMatchedNoneAfterWait: translationKey(
      "An AI rule made OneUptime AI wait, and when the wait ended this alert matched none of the AI rules that investigate any more: it or the rules had changed.",
    ),
    createdResolvedTitle: translationKey(
      "This alert was created already resolved",
    ),
    createdResolved: translationKey(
      "The alert was over before it was recorded, so OneUptime AI did not investigate it automatically.",
    ),
    askAiBelow: translationKey(
      "To look into this alert anyway, ask OneUptime AI below.",
    ),
    resolvedDuringWait: {
      one: "An AI rule made OneUptime AI wait {{count}} minute to see whether this alert would still be open. It was resolved first, so it was not investigated.",
      other:
        "An AI rule made OneUptime AI wait {{count}} minutes to see whether this alert would still be open. It was resolved first, so it was not investigated.",
    },
    noRunRecorded: translationKey(
      "This alert would be investigated under today's settings, but no investigation or decision was recorded for it. The settings may have changed since it was created.",
    ),
    noRunNextStep: translationKey(
      "Automatic investigation starts when an alert is created, so turning it on later does not investigate older ones. If new alerts are not investigated either, check the AI Logs.",
    ),
  },
};

/*
 * The record's own switch, "Investigate new incidents", as its AI settings
 * page draws it.
 */
export function getInvestigateSwitchTitle(kind: NotStartedSubjectType): string {
  const column: string =
    kind === "alert"
      ? "enableAutomaticAlertInvestigation"
      : "enableAutomaticIncidentInvestigation";

  return (
    AI_LANE_SWITCHES[kind === "alert" ? AiLane.Alert : AiLane.Incident].find(
      (definition: { column: string }): boolean => {
        return definition.column === column;
      },
    )?.title || ""
  );
}

/*
 * Every reason's words, by the record's kind. A Record of every code, so a
 * code the server learns to send cannot be added to the type alone.
 */
function wordsFor(
  kind: NotStartedSubjectType,
): Record<InvestigationNotStartedCode, NotStartedCodeWords> {
  const own: (typeof NOT_STARTED_BY_KIND)[NotStartedSubjectType] =
    NOT_STARTED_BY_KIND[kind];
  // AI is off, or cannot run: asking it about this record would not work.
  const newOnly: string = AI_OFF_NOTES[kind].aiOff;
  // AI is on: it can still be asked about this record.
  const askAi: string = AI_OFF_NOTES[kind].askAi;

  // A switch that was off: Enable AI, or the record's own.
  const switchWords: (data: {
    title: NotStartedVariants<string>;
    settingName: string;
    note: string;
  }) => NotStartedCodeWords = (data: {
    title: NotStartedVariants<string>;
    settingName: string;
    note: string;
  }): NotStartedCodeWords => {
    return {
      title: data.title,
      description: { recorded: SETTING_WAS_OFF, current: SETTING_IS_OFF },
      nextStep: {
        recorded: [CHECK_SETTING_IS_ON, data.note],
        current: [AI_OFF_STEP_TEXTS.turnOnSwitch, data.note],
      },
      settingName: data.settingName,
    };
  };

  // A fault in the service, not a setting: someone has to look.
  const faultWords: (data: {
    title: NotStartedVariants<string>;
    description: NotStartedVariants<string>;
    step: string;
    unknown?: string | undefined;
  }) => NotStartedCodeWords = (data: {
    title: NotStartedVariants<string>;
    description: NotStartedVariants<string>;
    step: string;
    unknown?: string | undefined;
  }): NotStartedCodeWords => {
    const steps: ReadonlyArray<string> = [data.step, NOTHING_IS_TRIED_AGAIN];

    return {
      title: data.title,
      description: data.description,
      nextStep: { recorded: steps, current: steps },
      ...(data.unknown ? { unknown: data.unknown } : {}),
    };
  };

  // The same words whether decided then or read from the settings now.
  const always: <T>(value: T) => NotStartedVariants<T> = <T>(
    value: T,
  ): NotStartedVariants<T> => {
    return { recorded: value, current: value };
  };

  return {
    // OneUptime AI cannot run while AI is off: nothing to ask it.
    ai_disabled: switchWords({
      title: {
        recorded: NOT_STARTED_TITLES.aiWasOff,
        current: AI_OFF_TITLES.projectAiOff,
      },
      settingName: EnableAiCopy.switchTitle,
      note: newOnly,
    }),
    automatic_investigation_disabled: switchWords({
      title: {
        recorded: AI_OFF_TITLES.investigationWasOff,
        current: AI_OFF_TITLES.investigationOff,
      },
      settingName: getInvestigateSwitchTitle(kind),
      note: askAi,
    }),
    provider_missing: {
      title: {
        recorded: NOT_STARTED_TITLES.providerWasMissing,
        current: NOT_STARTED_TITLES.providerIsMissing,
      },
      description: {
        recorded: DESCRIPTIONS.providerWasMissing,
        current: DESCRIPTIONS.providerIsMissing,
      },
      nextStep: always([STEPS.setUpProvider, newOnly]),
    },
    insufficient_ai_balance: {
      title: {
        recorded: NOT_STARTED_TITLES.creditsWereOut,
        current: NOT_STARTED_TITLES.creditsAreOut,
      },
      description: {
        recorded: DESCRIPTIONS.creditsWereOut,
        current: DESCRIPTIONS.creditsAreOut,
      },
      nextStep: always([STEPS.addCredits, newOnly]),
    },
    /*
     * A recorded skip is taken back once the limit no longer stops AI
     * (InvestigationLimitCatchUp), while the record is still open. The
     * project's limits hold Ask AI too, so it is not offered.
     */
    project_daily_limit_reached: {
      title: {
        recorded: NOT_STARTED_TITLES.dailyLimitWasReached,
        current: NOT_STARTED_TITLES.dailyLimitIsReached,
      },
      description: {
        recorded: DESCRIPTIONS.dailyLimitWasReached,
        current: DESCRIPTIONS.dailyLimitIsReached,
      },
      nextStep: {
        recorded: [own.dailyLimitCatchUp],
        current: [STEPS.raiseOrRemoveDailyLimit, newOnly],
      },
    },
    severity_below_threshold: {
      title: {
        recorded: NOT_STARTED_TITLES.severityWasBelow,
        current: NOT_STARTED_TITLES.severityIsBelow,
      },
      description: {
        recorded: own.severityWasBelow,
        current: own.severityIsBelow,
      },
      withFacts: {
        needs: ["severityName", "minimumSeverityName"],
        description: {
          recorded: own.severityWasBelowNamed,
          current: own.severityIsBelowNamed,
        },
      },
      nextStep: always([AI_OFF_STEP_TEXTS.minimumSeverity, askAi]),
    },
    monitor_cooldown: {
      title: {
        recorded: NOT_STARTED_TITLES.skippedInCooldown,
        current: NOT_STARTED_TITLES.inCooldown,
      },
      description: {
        recorded: own.cooldownWasOn,
        current: own.cooldownIsOn,
      },
      withFacts: {
        needs: ["cooldownWindowMinutes"],
        description: {
          recorded: own.cooldownWasOnFor,
          current: own.cooldownIsOnFor,
        },
      },
      count: "cooldownWindowMinutes",
      nextStep: always([STEPS.shortenCooldown, askAi]),
    },
    no_investigation_rule_matched: {
      title: {
        recorded: own.outsideRulesRecorded,
        current: own.outsideRulesCurrent,
      },
      description: {
        recorded: own.rulesMatchedNone,
        current: own.rulesMatchNone,
      },
      /*
       * After a wait the record matched a rule when it was created - the
       * rule that made it wait - so what changed is said instead.
       */
      afterWait: own.rulesMatchedNoneAfterWait,
      nextStep: always([AI_OFF_STEP_TEXTS.rulesMatch[kind], askAi]),
    },
    // Only ever recorded at creation.
    created_resolved: {
      title: always(own.createdResolvedTitle),
      description: always(own.createdResolved),
      nextStep: always([own.askAiBelow]),
    },
    /*
     * Only ever recorded when an AI rule's wait ends, with the wait
     * (decidedAfterWaitMinutes).
     */
    resolved_before_investigation: {
      title: always(NOT_STARTED_TITLES.resolvedBeforeInvestigation),
      description: always(own.resolvedDuringWait),
      count: "waitMinutes",
      nextStep: always([own.askAiBelow, STEPS.waitIsOnRules]),
    },
    /*
     * The incident (or alert) lane's own daily token limit, which never
     * holds Ask AI.
     */
    daily_budget_exhausted: {
      title: {
        recorded: NOT_STARTED_TITLES.tokenLimitWasReached,
        current: NOT_STARTED_TITLES.tokenLimitIsReached,
      },
      description: {
        recorded: DESCRIPTIONS.tokenLimitWasUsedUp,
        current: DESCRIPTIONS.tokenLimitIsUsedUp,
      },
      nextStep: always([STEPS.raiseTokenLimitOrWait, askAi]),
      // Waiting does not lift a limit of 0.
      paused: {
        title: {
          recorded: NOT_STARTED_TITLES.aiWorkWasPaused,
          current: NOT_STARTED_TITLES.aiWorkIsPaused,
        },
        description: {
          recorded: DESCRIPTIONS.tokenLimitWasZero,
          current: DESCRIPTIONS.tokenLimitIsZero,
        },
        nextStep: [STEPS.raiseTokenLimitAboveZero, askAi],
      },
      settingName: own.tokenLimitName,
    },
    budget_check_failed: faultWords({
      title: {
        recorded: NOT_STARTED_TITLES.tokenLimitNotChecked,
        current: NOT_STARTED_TITLES.tokenLimitCannotBeChecked,
      },
      description: {
        recorded: DESCRIPTIONS.tokenLimitNotChecked,
        current: DESCRIPTIONS.tokenLimitCannotBeChecked,
      },
      step: ASK_ADMIN_FOR_SETTINGS,
    }),
    enqueue_failed: faultWords({
      title: {
        recorded: NOT_STARTED_TITLES.notQueued,
        current: NOT_STARTED_TITLES.queueCannotBeChecked,
      },
      description: {
        recorded: DESCRIPTIONS.notQueued,
        current: DESCRIPTIONS.queueCannotBeChecked,
      },
      step: ASK_ADMIN_FOR_LOGS,
    }),
    eligibility_check_failed: faultWords({
      title: {
        recorded: NOT_STARTED_TITLES.checksNotFinished,
        current: NOT_STARTED_TITLES.checksCannotBeFinished,
      },
      description: {
        recorded: DESCRIPTIONS.checksNotFinished,
        current: DESCRIPTIONS.checksCannotBeFinished,
      },
      step: ASK_ADMIN_FOR_SETTINGS,
      // The server could read neither (InvestigationEligibility's catch).
      unknown: DESCRIPTIONS.checksNotRead,
    }),
    // Never a decision: nothing was recorded, and the checks pass today.
    no_run_recorded: {
      title: always(NOT_STARTED_TITLES.noRunRecorded),
      description: always(own.noRunRecorded),
      nextStep: always([own.noRunNextStep]),
    },
  };
}

export const INVESTIGATION_NOT_STARTED_WORDS: Record<
  NotStartedSubjectType,
  Record<InvestigationNotStartedCode, NotStartedCodeWords>
> = {
  incident: wordsFor("incident"),
  alert: wordsFor("alert"),
};

// The codes the card words itself, in the order the table lists them.
export const WORDED_NOT_STARTED_CODES: ReadonlyArray<InvestigationNotStartedCode> =
  Object.keys(
    INVESTIGATION_NOT_STARTED_WORDS.incident,
  ) as Array<InvestigationNotStartedCode>;

/*
 * Every sentence the card may draw for a code and a kind, each once - the
 * names of the settings they quote among them: the locale tests hold each
 * one to a translation in every language.
 */
export function getNotStartedSentences(
  words: NotStartedCodeWords,
): Array<NotStartedSentence> {
  const sentences: Array<NotStartedSentence> = [];
  const seen: Set<string> = new Set<string>();
  const add: (sentence: NotStartedSentence | undefined) => void = (
    sentence: NotStartedSentence | undefined,
  ): void => {
    if (!sentence) {
      return;
    }

    const key: string =
      typeof sentence === "string" ? sentence : sentence.other;

    if (!seen.has(key)) {
      seen.add(key);
      sentences.push(sentence);
    }
  };

  add(words.title.recorded);
  add(words.title.current);
  add(words.description.recorded);
  add(words.description.current);
  add(words.withFacts?.description.recorded);
  add(words.withFacts?.description.current);
  add(words.paused?.title.recorded);
  add(words.paused?.title.current);
  add(words.paused?.description.recorded);
  add(words.paused?.description.current);
  add(words.afterWait);
  add(words.unknown);

  for (const step of [
    ...words.nextStep.recorded,
    ...words.nextStep.current,
    ...(words.paused?.nextStep || []),
  ]) {
    add(step);
  }

  add(words.settingName);

  return sentences;
}

// Every sentence of every code and kind, each once.
export function getAllNotStartedSentences(): Array<NotStartedSentence> {
  const sentences: Array<NotStartedSentence> = [];
  const seen: Set<string> = new Set<string>();

  for (const kind of Object.keys(
    INVESTIGATION_NOT_STARTED_WORDS,
  ) as Array<NotStartedSubjectType>) {
    for (const code of WORDED_NOT_STARTED_CODES) {
      for (const sentence of getNotStartedSentences(
        INVESTIGATION_NOT_STARTED_WORDS[kind][code],
      )) {
        const key: string =
          typeof sentence === "string" ? sentence : sentence.other;

        if (!seen.has(key)) {
          seen.add(key);
          sentences.push(sentence);
        }
      }
    }
  }

  return sentences;
}

export interface InvestigationNotStartedWords {
  title: string;
  description: string;
  nextStep: string;
}

// A name the reason's facts hold, when it is one.
function factName(
  facts: InvestigationNotStartedFacts | undefined,
  key: "severityName" | "minimumSeverityName",
): string | undefined {
  const value: unknown = facts?.[key];

  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

// A whole count above 0, when the value is one.
function positiveCount(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value >= 1
    ? Math.round(value)
    : undefined;
}

/*
 * The card's three lines for a reason, in the reader's language: null for a
 * code this table does not know, or for a sentence whose count the reason
 * lacks - the card then draws the server's own English.
 */
export function getInvestigationNotStartedWords(input: {
  reason: InvestigationNotStartedReason;
  subjectType: NotStartedSubjectType;
  translator: Translator;
}): InvestigationNotStartedWords | null {
  const { reason, translator } = input;
  const table: Record<InvestigationNotStartedCode, NotStartedCodeWords> =
    INVESTIGATION_NOT_STARTED_WORDS[input.subjectType] ||
    INVESTIGATION_NOT_STARTED_WORDS.incident;

  // Only a code of the table: never one of an object's own properties.
  if (!Object.prototype.hasOwnProperty.call(table, reason.code)) {
    return null;
  }

  const words: NotStartedCodeWords = table[reason.code];
  const variant: keyof NotStartedVariants<unknown> =
    reason.source === "current_configuration" ? "current" : "recorded";
  const facts: InvestigationNotStartedFacts | undefined = reason.facts;
  const severity: string | undefined = factName(facts, "severityName");
  const minimumSeverity: string | undefined = factName(
    facts,
    "minimumSeverityName",
  );
  const counts: Record<
    "cooldownWindowMinutes" | "waitMinutes",
    number | undefined
  > = {
    cooldownWindowMinutes: positiveCount(facts?.cooldownWindowMinutes),
    waitMinutes: positiveCount(reason.decidedAfterWaitMinutes),
  };
  const known: Record<NotStartedFact, boolean> = {
    severityName: severity !== undefined,
    minimumSeverityName: minimumSeverity !== undefined,
    cooldownWindowMinutes: counts.cooldownWindowMinutes !== undefined,
  };
  const tokenLimit: unknown = facts?.dailyTokenLimit;
  const isPaused: boolean = Boolean(
    words.paused &&
      typeof tokenLimit === "number" &&
      Number.isFinite(tokenLimit) &&
      tokenLimit <= 0,
  );
  const isAfterWait: boolean =
    variant === "recorded" && counts.waitMinutes !== undefined;

  let description: NotStartedSentence = words.description[variant];

  if (reason.source === "unknown" && words.unknown) {
    description = words.unknown;
  } else if (isPaused && words.paused) {
    description = words.paused.description[variant];
  } else if (isAfterWait && words.afterWait) {
    description = words.afterWait;
  } else if (
    words.withFacts &&
    words.withFacts.needs.every((fact: NotStartedFact): boolean => {
      return known[fact];
    })
  ) {
    description = words.withFacts.description[variant];
  }

  /*
   * The setting, by both names its sentences give it: {{switchName}} in the
   * AI card's folded line's own step (AI_OFF_STEP_TEXTS.turnOnSwitch).
   */
  const values: TemplateValues = {
    ...(words.settingName
      ? {
          settingName: translatableTerm(words.settingName),
          switchName: translatableTerm(words.settingName),
        }
      : {}),
    ...(severity !== undefined ? { severity } : {}),
    ...(minimumSeverity !== undefined ? { minimumSeverity } : {}),
  };
  let descriptionText: string = "";

  if (typeof description === "string") {
    descriptionText = translator.translateTemplate(description, values, {
      setsValuesApart: true,
    });
  } else {
    // A sentence with a count needs the count.
    const count: number | undefined = words.count
      ? counts[words.count]
      : undefined;

    if (count === undefined) {
      return null;
    }

    descriptionText = translator.translatePlural(description, count, values, {
      setsValuesApart: true,
    });
  }

  const title: string =
    isPaused && words.paused
      ? words.paused.title[variant]
      : words.title[variant];
  const steps: ReadonlyArray<string> =
    isPaused && words.paused ? words.paused.nextStep : words.nextStep[variant];

  return {
    title: translator.translateText(title) || title,
    description: descriptionText,
    nextStep: joinSentences(
      steps.map((step: string): string => {
        return translator.translateTemplate(step, values, {
          setsValuesApart: true,
        });
      }),
    ),
  };
}
