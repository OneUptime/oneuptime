import {
  AI_LANE_SWITCHES,
  AiLane,
  EnableAiCopy,
} from "../AISettings/ProjectAiSettingsCopy";
import {
  AI_OFF_NOTES,
  AI_OFF_REASONS,
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
 * LANGUAGE.
 *
 * The record's AI card says why nothing was investigated: a title, why, and
 * what can be done. The server writes those three in English
 * (InvestigationEligibility), and still does, for API readers and older
 * Dashboards; the card words each reason itself from the reason's code, how
 * it was decided and the facts sent with it (InvestigationNotStartedFacts),
 * so it reads in every Dashboard language. A code this table does not know
 * - one a newer server sends - is drawn in the server's own English
 * (InvestigationNotStarted).
 *
 * How it was decided is said by the line under the description ("Decision
 * recorded at creation", "... when the wait ended", "Based on current
 * settings"), so these words say only what stopped it - in the past for a
 * decision recorded then, in the present for the current settings - and
 * never when. Where the next step is changed is the link under it, or who
 * can change it.
 *
 * A sentence that refers back to the record names it (this incident, this
 * alert), even where the English could share one sentence: the English is
 * the translation key, and a language whose words agree with the record's
 * gender needs to know which one it is. Setting names and severity names
 * are drawn as the Dashboard draws them, and severity names, which are a
 * project's own data, are set apart from the sentence around them.
 *
 * React-free, so App's docs tests import the very words the card draws, and
 * the locale tests every language's.
 */

export type NotStartedSubjectType = AiOffSubjectType;

// A sentence with a count in it: the count's own form in every language.
export type NotStartedSentence = string | PluralTemplate;

export interface NotStartedCodeWords {
  // What stopped it, as decided then ("recorded") and as the settings are now.
  title: { recorded: string; current: string };
  description: {
    recorded: NotStartedSentence;
    current: NotStartedSentence;
    // With the facts the sentence names (severity_below_threshold).
    recordedWithFacts?: NotStartedSentence | undefined;
    currentWithFacts?: NotStartedSentence | undefined;
    // Decided when an AI rule's wait ended (no_investigation_rule_matched).
    afterWait?: NotStartedSentence | undefined;
    // A daily token limit of 0, which pauses automatic investigation.
    recordedPaused?: NotStartedSentence | undefined;
    currentPaused?: NotStartedSentence | undefined;
    // Neither the decision nor the current checks could be read.
    unknown?: NotStartedSentence | undefined;
  };
  // What can be done, in sentences of their own, one after the other.
  nextStep: {
    recorded: ReadonlyArray<string>;
    current: ReadonlyArray<string>;
    paused?: ReadonlyArray<string> | undefined;
  };
  // The setting a sentence names as {{switchName}}, as its page draws it.
  switchName?: string | undefined;
}

// --- Sentences several reasons share ---

const SWITCH_WAS_OFF: string = translationKey(
  "“{{switchName}}” was off, so no investigation started.",
);
const SWITCH_IS_OFF: string = translationKey(
  "“{{switchName}}” is off, so no new investigation can start.",
);
const CHECK_SWITCH_IS_ON: string = translationKey(
  "Check that “{{switchName}}” is on.",
);
const NOTHING_IS_RETRIED: string = translationKey(
  "Nothing is tried again automatically.",
);
const ASK_ADMIN_FOR_SETTINGS: string = translationKey(
  "Ask a project administrator to check the service's health and the AI settings.",
);
const ASK_ADMIN_FOR_LOGS: string = translationKey(
  "Ask a project administrator to check the service's health and the server logs.",
);

const TITLES: {
  aiWasOff: string;
  providerWasMissing: string;
  providerIsMissing: string;
  creditsWereOut: string;
  creditsAreOut: string;
  dailyLimitWasReached: string;
  dailyLimitIsReached: string;
  severityWasBelow: string;
  severityIsBelow: string;
  inCooldown: string;
  monitorInCooldown: string;
  resolvedBeforeInvestigation: string;
  tokenLimitWasReached: string;
  tokenLimitIsReached: string;
  tokenLimitNotChecked: string;
  tokenLimitCannotBeChecked: string;
  notQueued: string;
  queueCannotBeChecked: string;
  checksNotFinished: string;
  checksCannotBeFinished: string;
  noRunRecorded: string;
} = {
  aiWasOff: translationKey("AI was off for this project"),
  providerWasMissing: translationKey("No AI provider was available"),
  providerIsMissing: translationKey("No AI provider is available"),
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
  inCooldown: translationKey("Skipped during the re-investigation cooldown"),
  monitorInCooldown: translationKey(
    "A monitor is in its re-investigation cooldown",
  ),
  resolvedBeforeInvestigation: translationKey(
    "Resolved before the investigation started",
  ),
  tokenLimitWasReached: translationKey("The daily AI token limit was reached"),
  tokenLimitIsReached: translationKey("The daily AI token limit is reached"),
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
  tokenLimitWasZero: string;
  tokenLimitIsUsedUp: string;
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
    "OneUptime AI had no AI provider to run on, so no investigation started.",
  ),
  providerIsMissing: translationKey(
    "OneUptime AI has no AI provider to run on in this project, so no new investigation can start.",
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
    "Investigations had used up the daily AI token limit, so no investigation started.",
  ),
  tokenLimitWasZero: translationKey(
    "The daily AI token limit was 0, which pauses automatic investigation, so no investigation started.",
  ),
  tokenLimitIsUsedUp: translationKey(
    "Investigations have used up today's AI token limit, so no new investigation can start before midnight UTC.",
  ),
  tokenLimitIsZero: translationKey(
    "The daily AI token limit is 0, which pauses automatic investigation.",
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
  raiseTokenLimit: string;
  waitIsOnRules: string;
} = {
  setUpProvider: translationKey("Set up an AI provider."),
  addCredits: translationKey("Add AI credits to the project."),
  raiseOrRemoveDailyLimit: translationKey(
    "Raise or remove the limit under More settings, or wait until midnight UTC, when it resets.",
  ),
  shortenCooldown: translationKey(
    "Shorten or clear the re-investigation cooldown.",
  ),
  raiseTokenLimitOrWait: translationKey(
    "Raise the daily AI token limit under More settings, or wait until midnight UTC, when usage resets.",
  ),
  raiseTokenLimit: translationKey(
    "Raise the daily AI token limit under More settings.",
  ),
  waitIsOnRules: translationKey(
    "The wait is set on the AI rules, under More settings.",
  ),
};

/*
 * The sentences that name the record, by its kind: the same sentence for
 * an incident and an alert, each worded on its own.
 */
const BY_KIND: Record<
  NotStartedSubjectType,
  {
    dailyLimitCatchUp: string;
    severityWasBelowNamed: string;
    severityIsBelowNamed: string;
    cooldownWasOn: string;
    cooldownIsOn: string;
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
    dailyLimitCatchUp: translationKey(
      "OneUptime AI investigates this incident when the limit resets at midnight UTC, if it is still open then, or as soon as the limit is raised or removed under More settings.",
    ),
    severityWasBelowNamed: translationKey(
      "This incident's severity, {{severity}}, was below the minimum for AI investigation, {{minimumSeverity}}.",
    ),
    severityIsBelowNamed: translationKey(
      "This incident's severity, {{severity}}, is below the minimum for AI investigation, {{minimumSeverity}}.",
    ),
    cooldownWasOn: translationKey(
      "Another incident on the same monitor had just been investigated, inside the re-investigation cooldown, so no investigation started.",
    ),
    cooldownIsOn: translationKey(
      "Another incident on the same monitor has just been investigated, inside the re-investigation cooldown, so no new investigation can start yet.",
    ),
    outsideRulesRecorded: translationKey(
      "This incident was outside the AI rules that investigate",
    ),
    outsideRulesCurrent: translationKey(
      "This incident is outside the AI rules that investigate",
    ),
    rulesMatchedNone: translationKey(
      "With AI rules that investigate set up for incidents, OneUptime AI investigates only the incidents that match one, and this one matched none.",
    ),
    rulesMatchNone: translationKey(
      "With AI rules that investigate set up for incidents, OneUptime AI investigates only the incidents that match one, and this one matches none.",
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
    // A count's sentences: the extractor reads { one, other } as one plural.
    resolvedDuringWait: {
      one: "An AI rule made OneUptime AI wait {{count}} minute to see whether this incident would still be open. It was resolved first, so it was not investigated.",
      other:
        "An AI rule made OneUptime AI wait {{count}} minutes to see whether this incident would still be open. It was resolved first, so it was not investigated.",
    },
    noRunRecorded: translationKey(
      "This incident passes today's AI checks, but no investigation or decision was recorded for it. The settings may have changed since it was created.",
    ),
    noRunNextStep: translationKey(
      "Automatic investigation starts when an incident is created, so turning it on later does not investigate older ones. If new incidents are not investigated either, check the AI logs.",
    ),
  },
  alert: {
    dailyLimitCatchUp: translationKey(
      "OneUptime AI investigates this alert when the limit resets at midnight UTC, if it is still open then, or as soon as the limit is raised or removed under More settings.",
    ),
    severityWasBelowNamed: translationKey(
      "This alert's severity, {{severity}}, was below the minimum for AI investigation, {{minimumSeverity}}.",
    ),
    severityIsBelowNamed: translationKey(
      "This alert's severity, {{severity}}, is below the minimum for AI investigation, {{minimumSeverity}}.",
    ),
    cooldownWasOn: translationKey(
      "Another alert on the same monitor had just been investigated, inside the re-investigation cooldown, so no investigation started.",
    ),
    cooldownIsOn: translationKey(
      "Another alert on the same monitor has just been investigated, inside the re-investigation cooldown, so no new investigation can start yet.",
    ),
    outsideRulesRecorded: translationKey(
      "This alert was outside the AI rules that investigate",
    ),
    outsideRulesCurrent: translationKey(
      "This alert is outside the AI rules that investigate",
    ),
    rulesMatchedNone: translationKey(
      "With AI rules that investigate set up for alerts, OneUptime AI investigates only the alerts that match one, and this one matched none.",
    ),
    rulesMatchNone: translationKey(
      "With AI rules that investigate set up for alerts, OneUptime AI investigates only the alerts that match one, and this one matches none.",
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
    // A count's sentences: the extractor reads { one, other } as one plural.
    resolvedDuringWait: {
      one: "An AI rule made OneUptime AI wait {{count}} minute to see whether this alert would still be open. It was resolved first, so it was not investigated.",
      other:
        "An AI rule made OneUptime AI wait {{count}} minutes to see whether this alert would still be open. It was resolved first, so it was not investigated.",
    },
    noRunRecorded: translationKey(
      "This alert passes today's AI checks, but no investigation or decision was recorded for it. The settings may have changed since it was created.",
    ),
    noRunNextStep: translationKey(
      "Automatic investigation starts when an alert is created, so turning it on later does not investigate older ones. If new alerts are not investigated either, check the AI logs.",
    ),
  },
};

/*
 * The record's own switch, "Investigate new incidents", as its AI settings
 * page draws it.
 */
function getInvestigateSwitchTitle(kind: NotStartedSubjectType): string {
  const column: string =
    kind === "alert"
      ? "enableAutomaticAlertInvestigation"
      : "enableAutomaticIncidentInvestigation";

  return (
    AI_LANE_SWITCHES[kind === "alert" ? AiLane.Alert : AiLane.Incident].find(
      (definition: { column: string }): boolean => {
        return definition.column === column;
      },
    )?.title || column
  );
}

/*
 * Every reason's words, by the record's kind. A Record of every code, so a
 * code the server learns to send cannot be added to the type alone.
 */
function wordsFor(
  kind: NotStartedSubjectType,
): Record<InvestigationNotStartedCode, NotStartedCodeWords> {
  const own: (typeof BY_KIND)[NotStartedSubjectType] = BY_KIND[kind];
  const newOnly: string = AI_OFF_NOTES[kind].aiOff;
  const askAi: string = AI_OFF_NOTES[kind].askAi;
  const offReasons: (typeof AI_OFF_REASONS)[NotStartedSubjectType] =
    AI_OFF_REASONS[kind];

  // A switch that was off: Enable AI, or the record's own.
  const switchWords: (title: string, switchName: string) => NotStartedCodeWords =
    (title: string, switchName: string): NotStartedCodeWords => {
      return {
        title: {
          recorded: title,
          current:
            title === TITLES.aiWasOff
              ? AI_OFF_TITLES.projectAiOff
              : AI_OFF_TITLES.investigationOff,
        },
        description: { recorded: SWITCH_WAS_OFF, current: SWITCH_IS_OFF },
        nextStep: {
          recorded: [CHECK_SWITCH_IS_ON, newOnly],
          current: [AI_OFF_STEP_TEXTS.turnOnSwitch, newOnly],
        },
        switchName,
      };
    };

  // A fault in the service, not a setting: someone has to look.
  const faultWords: (data: {
    title: { recorded: string; current: string };
    description: { recorded: string; current: string };
    steps: ReadonlyArray<string>;
    unknown?: string | undefined;
  }) => NotStartedCodeWords = (data: {
    title: { recorded: string; current: string };
    description: { recorded: string; current: string };
    steps: ReadonlyArray<string>;
    unknown?: string | undefined;
  }): NotStartedCodeWords => {
    return {
      title: data.title,
      description: {
        ...data.description,
        ...(data.unknown ? { unknown: data.unknown } : {}),
      },
      nextStep: { recorded: data.steps, current: data.steps },
    };
  };

  return {
    ai_disabled: switchWords(TITLES.aiWasOff, EnableAiCopy.switchTitle),
    automatic_investigation_disabled: switchWords(
      AI_OFF_TITLES.investigationWasOff,
      getInvestigateSwitchTitle(kind),
    ),
    provider_missing: {
      title: {
        recorded: TITLES.providerWasMissing,
        current: TITLES.providerIsMissing,
      },
      description: {
        recorded: DESCRIPTIONS.providerWasMissing,
        current: DESCRIPTIONS.providerIsMissing,
      },
      nextStep: {
        recorded: [STEPS.setUpProvider, newOnly],
        current: [STEPS.setUpProvider, newOnly],
      },
    },
    insufficient_ai_balance: {
      title: {
        recorded: TITLES.creditsWereOut,
        current: TITLES.creditsAreOut,
      },
      description: {
        recorded: DESCRIPTIONS.creditsWereOut,
        current: DESCRIPTIONS.creditsAreOut,
      },
      nextStep: {
        recorded: [STEPS.addCredits, newOnly],
        current: [STEPS.addCredits, newOnly],
      },
    },
    /*
     * A recorded skip is taken back once the limit no longer stops AI
     * (InvestigationLimitCatchUp), while the record is still open.
     */
    project_daily_limit_reached: {
      title: {
        recorded: TITLES.dailyLimitWasReached,
        current: TITLES.dailyLimitIsReached,
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
        recorded: TITLES.severityWasBelow,
        current: TITLES.severityIsBelow,
      },
      description: {
        recorded: offReasons.severityRecorded,
        current: offReasons.severityCurrent,
        recordedWithFacts: own.severityWasBelowNamed,
        currentWithFacts: own.severityIsBelowNamed,
      },
      nextStep: {
        recorded: [AI_OFF_STEP_TEXTS.minimumSeverity, newOnly],
        current: [AI_OFF_STEP_TEXTS.minimumSeverity, newOnly],
      },
    },
    monitor_cooldown: {
      title: {
        recorded: TITLES.inCooldown,
        current: TITLES.monitorInCooldown,
      },
      description: {
        recorded: own.cooldownWasOn,
        current: own.cooldownIsOn,
      },
      nextStep: {
        recorded: [STEPS.shortenCooldown, askAi],
        current: [STEPS.shortenCooldown, askAi],
      },
    },
    no_investigation_rule_matched: {
      title: {
        recorded: own.outsideRulesRecorded,
        current: own.outsideRulesCurrent,
      },
      description: {
        recorded: own.rulesMatchedNone,
        current: own.rulesMatchNone,
        /*
         * After a wait the record matched a rule when it was created - the
         * rule that made it wait - so what changed is said instead.
         */
        afterWait: own.rulesMatchedNoneAfterWait,
      },
      nextStep: {
        recorded: [AI_OFF_STEP_TEXTS.rulesMatch[kind], askAi],
        current: [AI_OFF_STEP_TEXTS.rulesMatch[kind], askAi],
      },
    },
    // Only ever recorded at creation.
    created_resolved: {
      title: {
        recorded: own.createdResolvedTitle,
        current: own.createdResolvedTitle,
      },
      description: {
        recorded: own.createdResolved,
        current: own.createdResolved,
      },
      nextStep: { recorded: [own.askAiBelow], current: [own.askAiBelow] },
    },
    /*
     * Only ever recorded when an AI rule's wait ends, with the wait
     * (decidedAfterWaitMinutes).
     */
    resolved_before_investigation: {
      title: {
        recorded: TITLES.resolvedBeforeInvestigation,
        current: TITLES.resolvedBeforeInvestigation,
      },
      description: {
        recorded: own.resolvedDuringWait,
        current: own.resolvedDuringWait,
      },
      nextStep: {
        recorded: [own.askAiBelow, STEPS.waitIsOnRules],
        current: [own.askAiBelow, STEPS.waitIsOnRules],
      },
    },
    daily_budget_exhausted: {
      title: {
        recorded: TITLES.tokenLimitWasReached,
        current: TITLES.tokenLimitIsReached,
      },
      description: {
        recorded: DESCRIPTIONS.tokenLimitWasUsedUp,
        current: DESCRIPTIONS.tokenLimitIsUsedUp,
        recordedPaused: DESCRIPTIONS.tokenLimitWasZero,
        currentPaused: DESCRIPTIONS.tokenLimitIsZero,
      },
      nextStep: {
        recorded: [STEPS.raiseTokenLimitOrWait, newOnly],
        current: [STEPS.raiseTokenLimitOrWait, newOnly],
        // Waiting does not lift a limit of 0.
        paused: [STEPS.raiseTokenLimit, newOnly],
      },
    },
    budget_check_failed: faultWords({
      title: {
        recorded: TITLES.tokenLimitNotChecked,
        current: TITLES.tokenLimitCannotBeChecked,
      },
      description: {
        recorded: DESCRIPTIONS.tokenLimitNotChecked,
        current: DESCRIPTIONS.tokenLimitCannotBeChecked,
      },
      steps: [ASK_ADMIN_FOR_SETTINGS, NOTHING_IS_RETRIED],
    }),
    enqueue_failed: faultWords({
      title: {
        recorded: TITLES.notQueued,
        current: TITLES.queueCannotBeChecked,
      },
      description: {
        recorded: DESCRIPTIONS.notQueued,
        current: DESCRIPTIONS.queueCannotBeChecked,
      },
      steps: [ASK_ADMIN_FOR_LOGS, NOTHING_IS_RETRIED],
    }),
    eligibility_check_failed: faultWords({
      title: {
        recorded: TITLES.checksNotFinished,
        current: TITLES.checksCannotBeFinished,
      },
      description: {
        recorded: DESCRIPTIONS.checksNotFinished,
        current: DESCRIPTIONS.checksCannotBeFinished,
      },
      steps: [ASK_ADMIN_FOR_SETTINGS, NOTHING_IS_RETRIED],
      // The server could read neither (InvestigationEligibility's catch).
      unknown: DESCRIPTIONS.checksNotRead,
    }),
    // Never a decision: nothing was recorded, and the checks pass today.
    no_run_recorded: {
      title: {
        recorded: TITLES.noRunRecorded,
        current: TITLES.noRunRecorded,
      },
      description: {
        recorded: own.noRunRecorded,
        current: own.noRunRecorded,
      },
      nextStep: {
        recorded: [own.noRunNextStep],
        current: [own.noRunNextStep],
      },
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

// The codes the card words itself, in the order the type lists them.
export const WORDED_NOT_STARTED_CODES: ReadonlyArray<InvestigationNotStartedCode> =
  Object.keys(
    INVESTIGATION_NOT_STARTED_WORDS.incident,
  ) as Array<InvestigationNotStartedCode>;

/*
 * Every sentence the card may draw for a reason, each once: the locale
 * tests hold each to a translation in every language.
 */
export function getAllNotStartedSentences(): Array<NotStartedSentence> {
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

  for (const kind of Object.keys(
    INVESTIGATION_NOT_STARTED_WORDS,
  ) as Array<NotStartedSubjectType>) {
    for (const words of Object.values(INVESTIGATION_NOT_STARTED_WORDS[kind])) {
      add(words.title.recorded);
      add(words.title.current);

      for (const sentence of Object.values(words.description)) {
        add(sentence);
      }

      for (const steps of Object.values(words.nextStep)) {
        for (const step of steps || []) {
          add(step);
        }
      }

      add(words.switchName);
    }
  }

  return sentences;
}

export interface InvestigationNotStartedWords {
  title: string;
  description: string;
  nextStep: string;
}

// A fact, when the reason has it.
function factName(
  facts: InvestigationNotStartedFacts | undefined,
  key: "severityName" | "minimumSeverityName",
): string | undefined {
  const value: unknown = facts?.[key];

  return typeof value === "string" && value.trim() ? value : undefined;
}

function positiveCount(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? Math.round(value)
    : undefined;
}

/*
 * The card's three lines for a reason, in the reader's language: null for a
 * code this table does not know, or for words that need a fact the reason
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
  const isCurrent: boolean = reason.source === "current_configuration";
  const facts: InvestigationNotStartedFacts | undefined = reason.facts;
  const waitMinutes: number | undefined = positiveCount(
    reason.decidedAfterWaitMinutes,
  );
  const tokenLimit: unknown = facts?.dailyTokenLimit;
  const isPaused: boolean =
    typeof tokenLimit === "number" && Number.isFinite(tokenLimit)
      ? tokenLimit <= 0
      : false;
  const severity: string | undefined = factName(facts, "severityName");
  const minimumSeverity: string | undefined = factName(
    facts,
    "minimumSeverityName",
  );
  const values: TemplateValues = {
    ...(words.switchName
      ? { switchName: translatableTerm(words.switchName) }
      : {}),
    ...(severity && minimumSeverity ? { severity, minimumSeverity } : {}),
  };

  let description: NotStartedSentence | undefined = isCurrent
    ? words.description.current
    : words.description.recorded;

  if (reason.source === "unknown" && words.description.unknown) {
    description = words.description.unknown;
  } else if (
    severity &&
    minimumSeverity &&
    (isCurrent
      ? words.description.currentWithFacts
      : words.description.recordedWithFacts)
  ) {
    description = isCurrent
      ? words.description.currentWithFacts
      : words.description.recordedWithFacts;
  } else if (
    isPaused &&
    (isCurrent
      ? words.description.currentPaused
      : words.description.recordedPaused)
  ) {
    description = isCurrent
      ? words.description.currentPaused
      : words.description.recordedPaused;
  } else if (
    !isCurrent &&
    waitMinutes !== undefined &&
    words.description.afterWait
  ) {
    description = words.description.afterWait;
  }

  // A sentence with a count needs the count: the wait, here.
  if (!description || (typeof description !== "string" && !waitMinutes)) {
    return null;
  }

  const descriptionText: string =
    typeof description === "string"
      ? translator.translateTemplate(description, values, {
          setsValuesApart: true,
        })
      : translator.translatePlural(description, waitMinutes!, values, {
          setsValuesApart: true,
        });

  const steps: ReadonlyArray<string> =
    isPaused && words.nextStep.paused
      ? words.nextStep.paused
      : isCurrent
        ? words.nextStep.current
        : words.nextStep.recorded;

  return {
    title:
      translator.translateText(
        isCurrent ? words.title.current : words.title.recorded,
      ) || "",
    description: descriptionText,
    nextStep: joinSentences(
      steps.map((step: string): string => {
        return translator.translateTemplate(step, values);
      }),
    ),
  };
}
