import {
  PluralTemplate,
  translatableTerm,
  translationKey,
  Translator,
} from "Common/UI/Utils/TranslateTemplate";
import { RuleCriteriaSubject } from "Common/Types/Rules/RuleCriteriaSubject";
import {
  FoldedSectionItem,
  foldedSectionItem,
} from "Common/UI/Components/FoldedSection/FoldedSectionItem";
import ProjectAiDailyLimits, {
  MAX_PROJECT_AI_DAILY_SPEND_LIMIT_IN_USD,
  MAX_PROJECT_AI_DAILY_TOKEN_LIMIT,
  MIN_PROJECT_AI_DAILY_SPEND_LIMIT_IN_USD,
  MIN_PROJECT_AI_DAILY_TOKEN_LIMIT,
  PROJECT_AI_DAILY_SPEND_LIMIT_COLUMN,
  PROJECT_AI_DAILY_TOKEN_LIMIT_COLUMN,
  ProjectAiDailyLimit,
  ProjectAiDailyLimitColumn,
  ProjectAiDailyLimitValues,
  ProjectAiDailyUsage,
} from "Common/Types/AI/ProjectAiDailyLimits";
import { AUTOMATIC_FIX_SWITCH_COLUMNS } from "Common/Types/AI/AutomaticFixPullRequests";
import AutoRemediationTriggerEntity, {
  IncidentOrAlertTriggerEntity,
} from "Common/Types/AutoRemediation/AutoRemediationTriggerEntity";

/*
 * What the project's AI settings pages say, in one place: Incidents → AI
 * → Settings, Alerts → AI → Settings, AI → Insights → Settings and Project
 * Settings → AI Features.
 *
 * Those pages used to put every AI behaviour behind an Update button: the
 * incident and alert pages showed nine read-only rows whose Update opened a
 * three-step wizard (three switches, a severity, a cooldown and four
 * numeric limits, each with a paragraph of help), the postmortem draft was
 * one more switch behind one more dialog, AI Insights was three switches
 * behind Update, and Enable AI itself sat behind "Edit AI Features".
 *
 * Now each yes-or-no AI behaviour is a switch that saves the moment it is
 * flipped, named for what it does ("Investigate new incidents"), on the
 * shared switch rows (Common/UI/Components/ModelSwitch). What narrows or
 * caps the work - which incidents are investigated, how many run at once,
 * how much may run each day - is folded under More settings, whose folded
 * header names those cards and says what the defaults do. Two things are said only when they are true:
 * that Enable AI is off (with the switch that turns it on), and that the
 * project has no LLM provider OneUptime AI can use.
 *
 * New projects start with every AI behaviour on (ProjectService's
 * NEW_PROJECT_AI_DEFAULT_COLUMNS) but fixing, which changes infrastructure
 * and so is turned on by the project itself, and Enable AI is still the
 * project's only AI switch.
 *
 * The pull requests OneUptime AI opens - a fix in the code, and missing
 * telemetry - are part of fixing, and live in the AI rules that fix, under
 * each rule's More fields, on by default (and on with no rule): "Both of
 * these toggles should be inside of Remediation Rule, inside of More, and
 * they should be checked by default ... You can remove these toggles from
 * the main card" - the maintainer. They open only while fixing is on
 * (Common/Types/AI/AutomaticFixPullRequests), and the fix switch's line says
 * a pull request is one of the ways it fixes.
 *
 * Which incidents (or alerts) are investigated, and which are fixed and how,
 * can be narrowed by AI rules, folded under More settings with the limits:
 * one rule says which incidents it matches, when OneUptime AI investigates
 * them and whether - and how - it fixes them (Common/Types/AI/AiRule). With
 * no rule, every one is investigated and fixed. They were two kinds of rule
 * with the same conditions, Investigation rules and Auto remediation rules:
 * "Should incident investigation rule and remediation rule be the same
 * entity ... Since its not possible to remediate without investigation" -
 * the maintainer. So can which resolved incidents get a postmortem draft,
 * and the templates each draft follows: Postmortem rules, on the incident
 * page only - alerts have no postmortem (PostmortemRulesCopy).
 *
 * Project Settings → AI → AI Features has a More settings fold of its own, with
 * the project's daily limits on everything OneUptime AI does - a ceiling above
 * the incident and alert limits (see the end of this file).
 *
 * Kept free of React so the pages and App/Tests read these exact strings.
 * Every sentence is wrapped in translationKey() so npm run i18n:extract
 * finds it.
 */

/*
 * The two kinds of signal OneUptime AI investigates on its own. Each has its
 * own settings page, its own switches and its own limits.
 */
export enum AiLane {
  Incident = "Incident",
  Alert = "Alert",
}

/*
 * What a lane's AI rules apply to: "All incidents" or "Only incidents that
 * match conditions" (RuleCriteriaSubject). One table of rules holds both
 * lanes, so the page names them.
 */
export const AI_LANE_RULE_CRITERIA_SUBJECTS: Readonly<
  Record<AiLane, RuleCriteriaSubject>
> = {
  [AiLane.Incident]: RuleCriteriaSubject.Incidents,
  [AiLane.Alert]: RuleCriteriaSubject.Alerts,
};

// The Project columns behind the incident and alert pages' switches.
export type AiLaneSwitchColumn =
  | "enableAutomaticIncidentInvestigation"
  | "enableAutomaticIncidentRemediation"
  | "enableAutomaticPostmortemDraft"
  | "enableAutomaticAlertInvestigation"
  | "enableAutomaticAlertRemediation";

// The Project columns behind AI Insights' switches.
export type AiInsightsSwitchColumn =
  | "enableAiInsights"
  | "enableInsightFixTasks"
  | "autoArchiveNonActionableExceptions";

export interface ProjectAiSwitchDefinition<TColumn extends string> {
  column: TColumn;
  // The switch's name: what happens while it is on.
  title: string;
  // The sentence under it, whichever way it is set.
  description: string;
  // What it needs besides the switch, when it needs something.
  note?: string | undefined;
  /*
   * The switches that are part of this one, drawn under it while it is on.
   * They turn on and off with it, in the same save. One level deep; the
   * order they are drawn in is Common's getSwitchesInDrawnOrder.
   */
  children?: Array<ProjectAiSwitchDefinition<TColumn>> | undefined;
}

// The data-testid of a project AI switch, wherever it is drawn.
export const getProjectAiSwitchTestId: (column: string) => string = (
  column: string,
): string => {
  return `ai-switch-${column}`;
};

/*
 * What AI Insights' fix pull request switch needs besides the switch: a
 * repository connected in Code - on GitHub, GitLab, Forgejo, Gitea or any
 * Git server (SubjectCodeFixRun.hasConnectedRepository).
 */
const CONNECTED_REPOSITORY_NOTE: string = translationKey(
  "Needs a repository connected in Code.",
);
/*
 * Fixing starts off: it changes infrastructure, so a project turns it on
 * itself (ProjectService leaves it out of the new project's AI defaults).
 * Rules under More settings narrow it. Who approves what, in one sentence:
 * the AI agent's settings decide for its own fixes, and a runbook OneUptime
 * AI picks is proposed unless a rule that fixes without asking names it - or
 * runs it every time (Common/Types/AutoRemediation/AutoRemediationFix). A
 * pull request is never merged, so it waits for nobody.
 */
const REMEDIATION_NOTE: string = translationKey(
  "Nothing runs without approval unless the AI agent's settings or a rule allow it.",
);

/*
 * A lane's fix switch, by the column the server reads
 * (Common/Types/AI/AutomaticFixPullRequests). It has no switches under it:
 * the pull requests that are part of fixing are each AI rule's (More
 * settings), on by default.
 */
const getFixSwitch: (data: {
  signal: IncidentOrAlertTriggerEntity;
  title: string;
  description: string;
}) => ProjectAiSwitchDefinition<AiLaneSwitchColumn> = (data: {
  signal: IncidentOrAlertTriggerEntity;
  title: string;
  description: string;
}): ProjectAiSwitchDefinition<AiLaneSwitchColumn> => {
  return {
    column: AUTOMATIC_FIX_SWITCH_COLUMNS[data.signal],
    title: data.title,
    description: data.description,
    note: REMEDIATION_NOTE,
  };
};

/*
 * The switches of each lane's page, in the order they are drawn: what
 * OneUptime AI does on its own as incidents (or alerts) happen - investigate,
 * fix (with a pull request among the ways it fixes), and for incidents draft
 * the postmortem.
 */
export const AI_LANE_SWITCHES: Record<
  AiLane,
  Array<ProjectAiSwitchDefinition<AiLaneSwitchColumn>>
> = {
  [AiLane.Incident]: [
    {
      column: "enableAutomaticIncidentInvestigation",
      title: translationKey("Investigate new incidents"),
      description: translationKey(
        "OneUptime AI looks into each new incident and posts the likely root cause, with the evidence for it, to the incident's timeline.",
      ),
    },
    getFixSwitch({
      signal: AutoRemediationTriggerEntity.Incident,
      title: translationKey("Fix new incidents automatically"),
      description: translationKey(
        "OneUptime AI fixes each new incident through the AI agent on the affected cluster or host, with one of your runbooks, or with a pull request.",
      ),
    }),
    {
      column: "enableAutomaticPostmortemDraft",
      title: translationKey("Draft a postmortem when an incident resolves"),
      description: translationKey(
        "OneUptime AI drafts a postmortem from the incident's timeline and telemetry for review. It never replaces an existing one.",
      ),
    },
  ],
  [AiLane.Alert]: [
    {
      column: "enableAutomaticAlertInvestigation",
      title: translationKey("Investigate new alerts"),
      description: translationKey(
        "OneUptime AI looks into each new alert and posts the likely root cause, with the evidence for it, to the alert's timeline.",
      ),
    },
    getFixSwitch({
      signal: AutoRemediationTriggerEntity.Alert,
      title: translationKey("Fix new alerts automatically"),
      description: translationKey(
        "OneUptime AI fixes each new alert through the AI agent on the affected cluster or host, with one of your runbooks, or with a pull request.",
      ),
    }),
  ],
};

/*
 * The columns folded under each lane's Advanced section, by what they
 * decide. Every one is empty by default, and empty means no limit.
 */
export interface AiLaneAdvancedColumns {
  minimumSeverity:
    | "incidentInvestigationMinimumSeverity"
    | "alertInvestigationMinimumSeverity";
  cooldown:
    | "incidentInvestigationDedupeWindowMinutes"
    | "alertInvestigationDedupeWindowMinutes";
  maxConcurrent:
    | "incidentAiMaxConcurrentInvestigations"
    | "alertAiMaxConcurrentInvestigations";
  timeLimit:
    | "incidentAiInvestigationTimeLimitInMinutes"
    | "alertAiInvestigationTimeLimitInMinutes";
  dailyTokens:
    | "incidentAiDailyAutonomousTokenLimit"
    | "alertAiDailyAutonomousTokenLimit";
  dailyFixTasks: "incidentAiDailyFixTaskLimit" | "alertAiDailyFixTaskLimit";
}

export const AI_LANE_ADVANCED_COLUMNS: Record<AiLane, AiLaneAdvancedColumns> = {
  [AiLane.Incident]: {
    minimumSeverity: "incidentInvestigationMinimumSeverity",
    cooldown: "incidentInvestigationDedupeWindowMinutes",
    maxConcurrent: "incidentAiMaxConcurrentInvestigations",
    timeLimit: "incidentAiInvestigationTimeLimitInMinutes",
    dailyTokens: "incidentAiDailyAutonomousTokenLimit",
    dailyFixTasks: "incidentAiDailyFixTaskLimit",
  },
  [AiLane.Alert]: {
    minimumSeverity: "alertInvestigationMinimumSeverity",
    cooldown: "alertInvestigationDedupeWindowMinutes",
    maxConcurrent: "alertAiMaxConcurrentInvestigations",
    timeLimit: "alertAiInvestigationTimeLimitInMinutes",
    dailyTokens: "alertAiDailyAutonomousTokenLimit",
    dailyFixTasks: "alertAiDailyFixTaskLimit",
  },
};

/*
 * The cards under More settings, each one question: three hold Project
 * columns, each with its own Edit, and the others are tables of rules.
 */
export enum AiLaneAdvancedCard {
  /*
   * AI rules: which incidents (or alerts) OneUptime AI investigates, and
   * whether - and how - it fixes them.
   */
  AiRules = "AiRules",
  // Minimum severity and re-investigation cooldown.
  WhichAreInvestigated = "WhichAreInvestigated",
  // How many run at once, and for how long.
  InvestigationLimits = "InvestigationLimits",
  /*
   * Postmortem rules: which resolved incidents get a postmortem draft, and
   * the templates it follows. Incidents only: an alert has no postmortem.
   */
  PostmortemRules = "PostmortemRules",
  // Tokens and fix pull requests per day.
  DailyLimits = "DailyLimits",
}

/*
 * Each lane's cards under More settings, in the order they are drawn: the
 * AI rules first - which incidents are investigated and fixed, and how -
 * then the rest in the order of the switches above them: investigating and,
 * for incidents, the postmortem draft; then the daily limits, which hold all
 * of them.
 */
export const AI_LANE_ADVANCED_CARDS: Record<
  AiLane,
  Array<AiLaneAdvancedCard>
> = {
  [AiLane.Incident]: [
    AiLaneAdvancedCard.AiRules,
    AiLaneAdvancedCard.WhichAreInvestigated,
    AiLaneAdvancedCard.InvestigationLimits,
    AiLaneAdvancedCard.PostmortemRules,
    AiLaneAdvancedCard.DailyLimits,
  ],
  [AiLane.Alert]: [
    AiLaneAdvancedCard.AiRules,
    AiLaneAdvancedCard.WhichAreInvestigated,
    AiLaneAdvancedCard.InvestigationLimits,
    AiLaneAdvancedCard.DailyLimits,
  ],
};

/*
 * The cards that are tables of rules rather than Project columns. With no
 * rule, every incident (or alert) is in scope; a table with any rule narrows
 * it, so the folded header draws it as a chip with how many it holds.
 */
export const AI_LANE_RULES_CARDS: Array<AiLaneAdvancedCard> = [
  AiLaneAdvancedCard.AiRules,
  AiLaneAdvancedCard.PostmortemRules,
];

export const isAiLaneRulesCard: (card: AiLaneAdvancedCard) => boolean = (
  card: AiLaneAdvancedCard,
): boolean => {
  return AI_LANE_RULES_CARDS.includes(card);
};

// Which of a lane's Advanced columns each card holds (none, for rules).
export const getAiLaneAdvancedCardColumns: (
  lane: AiLane,
  card: AiLaneAdvancedCard,
) => Array<string> = (
  lane: AiLane,
  card: AiLaneAdvancedCard,
): Array<string> => {
  const columns: AiLaneAdvancedColumns = AI_LANE_ADVANCED_COLUMNS[lane];

  switch (card) {
    case AiLaneAdvancedCard.WhichAreInvestigated:
      return [columns.minimumSeverity, columns.cooldown];
    case AiLaneAdvancedCard.InvestigationLimits:
      return [columns.maxConcurrent, columns.timeLimit];
    case AiLaneAdvancedCard.DailyLimits:
      return [columns.dailyTokens, columns.dailyFixTasks];
    default:
      return [];
  }
};

/*
 * What the Advanced cards have read so far, by column: a column's value as
 * the card read it (null when nothing is set), how many rules each rules
 * table holds, and which cards have read.
 */
export interface AiLaneAdvancedState {
  values: Record<string, unknown>;
  ruleCounts?: Partial<Record<AiLaneAdvancedCard, number>> | undefined;
  loadedCards: Array<AiLaneAdvancedCard>;
}

export const EMPTY_AI_LANE_ADVANCED_STATE: AiLaneAdvancedState = {
  values: {},
  ruleCounts: {},
  loadedCards: [],
};

// How many rules a rules table read: 0 until it has read.
export const getAiLaneRuleCount: (
  state: AiLaneAdvancedState,
  card: AiLaneAdvancedCard,
) => number = (
  state: AiLaneAdvancedState,
  card: AiLaneAdvancedCard,
): number => {
  const count: unknown = state.ruleCounts?.[card];

  return typeof count === "number" && Number.isFinite(count) && count > 0
    ? Math.floor(count)
    : 0;
};

/*
 * What a rules table has read - how many rules it holds - added to what
 * the other cards have. It reads again after every change to its rules.
 */
export const recordAiLaneAdvancedRules: (data: {
  state: AiLaneAdvancedState;
  card: AiLaneAdvancedCard;
  count: number;
}) => AiLaneAdvancedState = (data: {
  state: AiLaneAdvancedState;
  card: AiLaneAdvancedCard;
  count: number;
}): AiLaneAdvancedState => {
  return {
    values: data.state.values,
    ruleCounts: {
      ...(data.state.ruleCounts || {}),
      [data.card]:
        Number.isFinite(data.count) && data.count > 0
          ? Math.floor(data.count)
          : 0,
    },
    loadedCards: data.state.loadedCards.includes(data.card)
      ? data.state.loadedCards
      : [...data.state.loadedCards, data.card],
  };
};

// What a card has read, added to what the others have.
export const recordAiLaneAdvancedCard: (data: {
  state: AiLaneAdvancedState;
  lane: AiLane;
  card: AiLaneAdvancedCard;
  item: Record<string, unknown>;
}) => AiLaneAdvancedState = (data: {
  state: AiLaneAdvancedState;
  lane: AiLane;
  card: AiLaneAdvancedCard;
  item: Record<string, unknown>;
}): AiLaneAdvancedState => {
  const values: Record<string, unknown> = { ...data.state.values };

  for (const column of getAiLaneAdvancedCardColumns(data.lane, data.card)) {
    const value: unknown = data.item[column];
    values[column] = value === undefined ? null : value;
  }

  return {
    values,
    ruleCounts: data.state.ruleCounts,
    loadedCards: data.state.loadedCards.includes(data.card)
      ? data.state.loadedCards
      : [...data.state.loadedCards, data.card],
  };
};

/*
 * Whether a limit holds something: a severity picked, or any number,
 * including 0 (which pauses a daily limit, and is never the default).
 */
export const isAiLaneAdvancedValueSet: (value: unknown) => boolean = (
  value: unknown,
): boolean => {
  if (value === null || value === undefined) {
    return false;
  }

  if (typeof value === "string") {
    return value.trim().length > 0;
  }

  if (typeof value === "number") {
    return !Number.isNaN(value);
  }

  return true;
};

/*
 * The cards under a lane's More settings, by title, as its folded header
 * lists them - each one a chip once a limit in it is set, so folding never
 * hides a limit in force. The alerts' page has no postmortem rules, so it
 * has no title for them.
 */
export type AiLaneAdvancedCardTitles = {
  [AiLane.Incident]: Record<AiLaneAdvancedCard, string>;
  [AiLane.Alert]: Record<
    Exclude<AiLaneAdvancedCard, AiLaneAdvancedCard.PostmortemRules>,
    string
  >;
};

export const AI_LANE_ADVANCED_CARD_TITLES: AiLaneAdvancedCardTitles = {
  [AiLane.Incident]: {
    [AiLaneAdvancedCard.AiRules]: translationKey("AI rules"),
    [AiLaneAdvancedCard.WhichAreInvestigated]: translationKey(
      "Which incidents are investigated",
    ),
    [AiLaneAdvancedCard.InvestigationLimits]: translationKey(
      "Investigation limits",
    ),
    [AiLaneAdvancedCard.PostmortemRules]: translationKey("Postmortem rules"),
    [AiLaneAdvancedCard.DailyLimits]: translationKey("Daily limits"),
  },
  [AiLane.Alert]: {
    [AiLaneAdvancedCard.AiRules]: translationKey("AI rules"),
    [AiLaneAdvancedCard.WhichAreInvestigated]: translationKey(
      "Which alerts are investigated",
    ),
    [AiLaneAdvancedCard.InvestigationLimits]: translationKey(
      "Investigation limits",
    ),
    [AiLaneAdvancedCard.DailyLimits]: translationKey("Daily limits"),
  },
};

// A card's title on a lane's page, or "" for a card the lane does not have.
export const getAiLaneAdvancedCardTitle: (
  lane: AiLane,
  card: AiLaneAdvancedCard,
) => string = (lane: AiLane, card: AiLaneAdvancedCard): string => {
  const titles: Partial<Record<AiLaneAdvancedCard, string>> =
    AI_LANE_ADVANCED_CARD_TITLES[lane];

  return titles[card] || "";
};

/*
 * Whether a card under a lane's More settings holds a limit - or, for a
 * rules table, any rule.
 */
export const isAiLaneAdvancedCardConfigured: (
  lane: AiLane,
  card: AiLaneAdvancedCard,
  state: AiLaneAdvancedState,
) => boolean = (
  lane: AiLane,
  card: AiLaneAdvancedCard,
  state: AiLaneAdvancedState,
): boolean => {
  if (isAiLaneRulesCard(card)) {
    return getAiLaneRuleCount(state, card) > 0;
  }

  return getAiLaneAdvancedCardColumns(lane, card).some(
    (column: string): boolean => {
      return isAiLaneAdvancedValueSet(state.values[column]);
    },
  );
};

/*
 * What the folded More settings header lists: every card, set or not, and
 * how many rules a rules table holds ("AI rules: 2").
 */
export const getAiLaneAdvancedItems: (
  lane: AiLane,
  state: AiLaneAdvancedState,
) => Array<FoldedSectionItem> = (
  lane: AiLane,
  state: AiLaneAdvancedState,
): Array<FoldedSectionItem> => {
  return AI_LANE_ADVANCED_CARDS[lane].map(
    (card: AiLaneAdvancedCard): FoldedSectionItem => {
      const isSet: boolean = isAiLaneAdvancedCardConfigured(lane, card, state);

      return foldedSectionItem(getAiLaneAdvancedCardTitle(lane, card), {
        key: card,
        isSet,
        value:
          isSet && isAiLaneRulesCard(card)
            ? String(getAiLaneRuleCount(state, card))
            : undefined,
      });
    },
  );
};

// Whether anything under a lane's More settings is set.
export const isAiLaneAdvancedConfigured: (
  lane: AiLane,
  state: AiLaneAdvancedState,
) => boolean = (lane: AiLane, state: AiLaneAdvancedState): boolean => {
  const hasRule: boolean = AI_LANE_ADVANCED_CARDS[lane]
    .filter(isAiLaneRulesCard)
    .some((card: AiLaneAdvancedCard): boolean => {
      return getAiLaneRuleCount(state, card) > 0;
    });

  return (
    hasRule ||
    Object.values(AI_LANE_ADVANCED_COLUMNS[lane]).some(
      (column: string): boolean => {
        return isAiLaneAdvancedValueSet(state.values[column]);
      },
    )
  );
};

export interface AiLanePageCopy {
  // The switches card.
  switchesCardTitle: string;
  switchesCardDescription: string;
  // The More settings section.
  advancedDescription: string;
  advancedDefaultsSummary: string;
}

const SWITCHES_CARD_TITLE: string = translationKey("What OneUptime AI does");

export const AI_LANE_PAGE_COPY: Record<AiLane, AiLanePageCopy> = {
  [AiLane.Incident]: {
    switchesCardTitle: SWITCHES_CARD_TITLE,
    switchesCardDescription: translationKey(
      "It works on incidents on its own. Turn off anything you do not want it to do.",
    ),
    advancedDescription: translationKey(
      "Which incidents are investigated, fixed or given a postmortem draft, and limits on investigations and on AI work each day.",
    ),
    advancedDefaultsSummary: translationKey(
      "Every incident is investigated, whatever its severity, fixed while fixing is on, and given a postmortem draft when it resolves. Nothing limits how much OneUptime AI does.",
    ),
  },
  [AiLane.Alert]: {
    switchesCardTitle: SWITCHES_CARD_TITLE,
    switchesCardDescription: translationKey(
      "It works on alerts on its own. Turn off anything you do not want it to do.",
    ),
    advancedDescription: translationKey(
      "Which alerts are investigated or fixed, and limits on investigations and on AI work each day.",
    ),
    advancedDefaultsSummary: translationKey(
      "Every alert is investigated, whatever its severity, and every one is fixed while fixing is on. Nothing limits how much OneUptime AI does.",
    ),
  },
};

/*
 * The line under the folded More settings header: what the defaults do,
 * once every card has read and none holds anything (no limit, no rule). Nothing until then - a
 * "nothing limits AI" read before the limits are known could be untrue -
 * and nothing while a limit is set, when the header draws that card as a
 * chip.
 */
export const getAiLaneAdvancedSummary: (
  lane: AiLane,
  state: AiLaneAdvancedState,
) => string | undefined = (
  lane: AiLane,
  state: AiLaneAdvancedState,
): string | undefined => {
  const hasEveryCardRead: boolean = AI_LANE_ADVANCED_CARDS[lane].every(
    (card: AiLaneAdvancedCard): boolean => {
      return state.loadedCards.includes(card);
    },
  );

  if (!hasEveryCardRead || isAiLaneAdvancedConfigured(lane, state)) {
    return undefined;
  }

  return AI_LANE_PAGE_COPY[lane].advancedDefaultsSummary;
};

/*
 * The table of AI rules under a lane's More settings. With no rule, every
 * incident (or alert) is investigated right away, and every one is fixed
 * while fixing is on - its pull requests included; rules narrow that to the
 * ones that match, each the way its rule says.
 *
 * A rule is conditions, when to investigate, and one answer about fixing:
 * don't, ask first, or without asking. The runbooks OneUptime AI may run,
 * the Runner it runs its commands on, the LLM provider, the MCP servers and
 * code repositories it may use, and the two pull requests it opens are
 * folded under the rule's More fields.
 */
export interface AiLaneRulesCopy {
  aiRulesDescription: string;
  noAiRulesMessage: string;
}

/*
 * The card's line names a rule's three steps in their order - which
 * incidents (Match), when (Investigate) and how each is fixed (Fix) - within
 * a card description's two lines at 1280px (ShortDescriptionsGuard's 210
 * characters, which it cannot read through the lane's index here, so
 * AiRuleCopy's tests hold it to them).
 */
export const AI_LANE_RULES_COPY: Record<AiLane, AiLaneRulesCopy> = {
  [AiLane.Incident]: {
    aiRulesDescription: translationKey(
      "With no rule, OneUptime AI investigates every new incident right away, and fixes it while fixing is on, pull requests included. Add rules to choose which incidents it works on, when, and how each is fixed.",
    ),
    noAiRulesMessage: translationKey(
      "No rules. Every new incident is investigated, and fixed while fixing is on.",
    ),
  },
  [AiLane.Alert]: {
    aiRulesDescription: translationKey(
      "With no rule, OneUptime AI investigates every new alert right away, and fixes it while fixing is on, pull requests included. Add rules to choose which alerts it works on, when, and how each is fixed.",
    ),
    noAiRulesMessage: translationKey(
      "No rules. Every new alert is investigated, and fixed while fixing is on.",
    ),
  },
};

// The data-testids of a lane page's parts.
export const AI_LANE_SWITCHES_TEST_ID: Record<AiLane, string> = {
  [AiLane.Incident]: "incident-ai-switches",
  [AiLane.Alert]: "alert-ai-switches",
};

export const AI_LANE_ADVANCED_SECTION_TEST_ID: Record<AiLane, string> = {
  [AiLane.Incident]: "incident-ai-advanced-section",
  [AiLane.Alert]: "alert-ai-advanced-section",
};

export const AI_LANE_AI_RULES_TABLE_ID: Record<AiLane, string> = {
  [AiLane.Incident]: "ai-rules-table-Incident",
  [AiLane.Alert]: "ai-rules-table-Alert",
};

// Incidents only: an alert has no postmortem.
export const AI_POSTMORTEM_RULES_TABLE_ID: string = "ai-postmortem-rules-table";

/*
 * AI → Insights → Settings: what OneUptime watches for in telemetry, and
 * what AI does with what it finds.
 */
export const AI_INSIGHTS_SWITCHES: Array<
  ProjectAiSwitchDefinition<AiInsightsSwitchColumn>
> = [
  {
    column: "enableAiInsights",
    title: translationKey("Watch telemetry for problems"),
    description: translationKey(
      "Every 15 minutes, OneUptime looks for spikes, new errors, slowdowns and drift in your telemetry and files each one as an insight.",
    ),
  },
  {
    column: "enableInsightFixTasks",
    title: translationKey(
      "Open a fix pull request when an insight points at your code",
    ),
    description: translationKey(
      "OneUptime AI opens a pull request with a proposed fix for your team to review. Nothing is merged automatically.",
    ),
    note: CONNECTED_REPOSITORY_NOTE,
  },
  {
    column: "autoArchiveNonActionableExceptions",
    title: translationKey("Archive exceptions that are expected"),
    description: translationKey(
      "OneUptime AI archives exceptions that are expected, such as a refused sign-in, so they stop showing as unresolved.",
    ),
  },
];

export const AiInsightsSettingsCopy: {
  cardTitle: string;
  cardDescription: string;
} = {
  cardTitle: translationKey("AI Insights"),
  cardDescription: translationKey(
    "OneUptime looks for trouble in your telemetry before a monitor catches it. Insights never page anyone or open incidents.",
  ),
};

export const AI_INSIGHTS_SWITCHES_TEST_ID: string = "ai-insights-switches";

/*
 * Security Events → AI → Settings: what OneUptime AI does on its own for
 * security cases. One switch, saved the moment it is flipped: triaging each
 * case a detection opens. On for new projects (ProjectService
 * NEW_PROJECT_AI_DEFAULT_COLUMNS); a project that existed keeps it off until
 * someone turns it on here. A person can ask for a triage on any case's AI
 * card whatever it says.
 */
export type SecurityAiSwitchColumn = "enableAutomaticSecurityCaseTriage";

export const SECURITY_AI_SWITCHES: Array<
  ProjectAiSwitchDefinition<SecurityAiSwitchColumn>
> = [
  {
    column: "enableAutomaticSecurityCaseTriage",
    title: translationKey("Triage new cases"),
    description: translationKey(
      "OneUptime AI reads each case a detection opens and says what happened, whether it looks real, and what to do next. It changes nothing.",
    ),
  },
];

/*
 * The card's words are the Incidents' and Alerts' AI settings' own: the same
 * title, and a sentence that says it works on its own and can be turned off.
 */
export const SecurityAiSettingsCopy: {
  cardTitle: string;
  cardDescription: string;
} = {
  cardTitle: SWITCHES_CARD_TITLE,
  cardDescription: translationKey(
    "It works on security cases on its own. Turn off anything you do not want it to do.",
  ),
};

export const SECURITY_AI_SWITCHES_TEST_ID: string = "security-ai-switches";

/*
 * Project Settings → AI → AI Features: Enable AI, the project's one AI switch.
 * Turning it off stops every AI feature at once, so it asks first. The column
 * lives in EnableAiColumn.ts, which the dashboard's first chunk reads.
 */
export { ENABLE_AI_COLUMN } from "./EnableAiColumn";
export type { EnableAiColumn } from "./EnableAiColumn";

export const EnableAiCopy: {
  cardTitle: string;
  cardDescription: string;
  switchTitle: string;
  switchDescription: string;
  // The dialog before AI is turned off.
  turnOffConfirmTitle: string;
  turnOffConfirmDescription: string;
  turnOffConfirmButton: string;
  // Who can turn it on, for those who cannot.
  whoCanTurnOn: string;
} = {
  cardTitle: translationKey("AI Features"),
  cardDescription: translationKey(
    "Turn OneUptime AI on or off for this project.",
  ),
  switchTitle: translationKey("Enable AI"),
  /*
   * Not "Auto-remediation needs no other project switch" any more: fixing
   * new incidents and alerts has a switch of its own on each AI settings
   * page, off until a project turns it on.
   */
  switchDescription: translationKey(
    "The master switch for every AI feature in this project: Ask AI, investigations, postmortem drafts, auto-remediation and more.",
  ),
  turnOffConfirmTitle: translationKey("Turn off AI for this project?"),
  turnOffConfirmDescription: translationKey(
    "Every AI feature in this project stops at once. Each keeps its own setting, so turning AI back on brings back what was on.",
  ),
  turnOffConfirmButton: translationKey("Turn off AI"),
  whoCanTurnOn: translationKey(
    "A project owner or someone with Manage Billing can turn AI on in Project Settings → AI → AI Features.",
  ),
};

// The data-testid of the Enable AI switch on Project Settings → AI → AI Features.
export const ENABLE_AI_SWITCH_TEST_ID: string = "enable-ai-switch";

// The data-testid of the Enable AI switch in the notice on the other pages.
export const ENABLE_AI_NOTICE_SWITCH_TEST_ID: string =
  "enable-ai-notice-switch";

/*
 * The notices at the top of the AI settings pages. They say only what is
 * out of the ordinary and needs doing: AI is off for the project, or the
 * project has no LLM provider OneUptime AI can use. Nothing is said while
 * all is well, while the answer is on its way, or when it could not be
 * read (the server still decides).
 */
export enum ProjectAiNoticeContext {
  Incidents = "Incidents",
  Alerts = "Alerts",
  Insights = "Insights",
  // Project Settings → AI → AI Features, where Enable AI is the page itself.
  AiFeatures = "AiFeatures",
  /*
   * The AI Insights page of a cluster, a resource, or the Incidents' and
   * Alerts' AI section: what AI found out, which stops growing with AI off.
   */
  ActivityInsights = "ActivityInsights",
  /*
   * Project Settings → AI → External MCP Servers: servers OneUptime AI uses
   * only while it runs.
   */
  ExternalMcpServers = "ExternalMcpServers",
  // Security Events → AI → Settings: triaging security cases.
  SecurityEvents = "SecurityEvents",
  /*
   * Profiler → AI → Settings: slow code OneUptime finds in profiles
   * (Common/Types/AI/TelemetryAi), which is still found with AI off.
   */
  Profiles = "Profiles",
  /*
   * Traces → AI → Settings: slow and failing operations OneUptime finds in
   * traces, still found with AI off.
   */
  Traces = "Traces",
  /*
   * Exceptions → AI → Settings: new and rising exceptions OneUptime finds,
   * still found with AI off.
   */
  Exceptions = "Exceptions",
  /*
   * Metrics → AI → Settings: problems OneUptime finds in metrics, and the
   * metrics busy services do not send, still found with AI off.
   */
  Metrics = "Metrics",
}

// Project.enableAi, as the page knows it.
export enum ProjectAiState {
  Unknown = "Unknown",
  On = "On",
  Off = "Off",
}

/*
 * The LLM provider OneUptime AI would use for this project's own work (the
 * project's default provider, else a global one), as the page knows it.
 */
export enum ProjectAiProviderState {
  Unknown = "Unknown",
  // There is one: nothing to say.
  Usable = "Usable",
  // The project has no provider, and there is no global one.
  Missing = "Missing",
  // The project has providers, but none is its default.
  NoDefault = "NoDefault",
}

export enum ProjectAiNoticeKind {
  AiOff = "AiOff",
  ProviderMissing = "ProviderMissing",
  ProviderNoDefault = "ProviderNoDefault",
}

/*
 * Which notices a page shows, first to fix first. AI being off comes before
 * the provider: with AI off nothing runs whatever the provider, and the
 * switch is the one thing to do. AI Features is where Enable AI is, so it
 * never says AI is off. Once AI is turned on from the notice, the notice
 * stays (saying it is on, so the press shows its result and can be taken
 * back) and the provider, if missing, is said under it.
 */
export const getProjectAiNotices: (data: {
  context: ProjectAiNoticeContext;
  aiState: ProjectAiState;
  providerState: ProjectAiProviderState;
  isChangedHere: boolean;
}) => Array<ProjectAiNoticeKind> = (data: {
  context: ProjectAiNoticeContext;
  aiState: ProjectAiState;
  providerState: ProjectAiProviderState;
  isChangedHere: boolean;
}): Array<ProjectAiNoticeKind> => {
  const notices: Array<ProjectAiNoticeKind> = [];

  if (
    data.context !== ProjectAiNoticeContext.AiFeatures &&
    (data.aiState === ProjectAiState.Off || data.isChangedHere)
  ) {
    notices.push(ProjectAiNoticeKind.AiOff);
  }

  if (data.aiState !== ProjectAiState.On) {
    return notices;
  }

  if (data.providerState === ProjectAiProviderState.Missing) {
    notices.push(ProjectAiNoticeKind.ProviderMissing);
  }

  if (data.providerState === ProjectAiProviderState.NoDefault) {
    notices.push(ProjectAiNoticeKind.ProviderNoDefault);
  }

  return notices;
};

/*
 * The provider OneUptime AI would use, from POST /ai-chat/providers:
 * `defaultProviderId` is what the project resolves to today (its default
 * provider, else a global one - LlmProviderService.getLLMProviderForProject,
 * which investigations, postmortem drafts and insight triage all use), and
 * `providers` every provider the project could pick.
 */
export const getProjectAiProviderState: (
  answer: unknown,
) => ProjectAiProviderState = (answer: unknown): ProjectAiProviderState => {
  if (!answer || typeof answer !== "object" || Array.isArray(answer)) {
    return ProjectAiProviderState.Unknown;
  }

  const data: Record<string, unknown> = answer as Record<string, unknown>;

  const defaultProviderId: unknown = data["defaultProviderId"];

  if (typeof defaultProviderId === "string" && defaultProviderId.length > 0) {
    return ProjectAiProviderState.Usable;
  }

  const providers: unknown = data["providers"];

  if (!Array.isArray(providers)) {
    return ProjectAiProviderState.Unknown;
  }

  return providers.length > 0
    ? ProjectAiProviderState.NoDefault
    : ProjectAiProviderState.Missing;
};

/*
 * Project.enableAi from a read of the project. The column is NOT NULL
 * DEFAULT true, so only an explicit false is off; a project that could not
 * be read is unknown.
 */
export const getProjectAiState: (
  project: { enableAi?: boolean | undefined } | null,
) => ProjectAiState = (
  project: { enableAi?: boolean | undefined } | null,
): ProjectAiState => {
  if (!project) {
    return ProjectAiState.Unknown;
  }

  return project.enableAi === false ? ProjectAiState.Off : ProjectAiState.On;
};

export interface ProjectAiNoticeContextCopy {
  // Under the Enable AI switch in the notice, while AI is off.
  aiOffDescription: string;
  // Why nothing runs without a provider, after the sentence that says so.
  providerConsequence: string;
}

const AI_OFF_EVENT_PAGE: string = translationKey(
  "OneUptime AI is off for this project, so nothing on this page runs.",
);

export const PROJECT_AI_NOTICE_CONTEXT_COPY: Record<
  ProjectAiNoticeContext,
  ProjectAiNoticeContextCopy
> = {
  [ProjectAiNoticeContext.Incidents]: {
    aiOffDescription: AI_OFF_EVENT_PAGE,
    providerConsequence: translationKey(
      "Until it has one, incidents are not investigated and no postmortems are drafted.",
    ),
  },
  [ProjectAiNoticeContext.Alerts]: {
    aiOffDescription: AI_OFF_EVENT_PAGE,
    providerConsequence: translationKey(
      "Until it has one, alerts are not investigated.",
    ),
  },
  [ProjectAiNoticeContext.Insights]: {
    aiOffDescription: translationKey(
      "OneUptime AI is off for this project. Insights are still found, but none are triaged and no fix pull requests are opened.",
    ),
    /*
     * Not "and no fix pull requests are opened": a trace latency insight's
     * fix is routed without triage, and a fix task can use any provider the
     * project owns, default or not.
     */
    providerConsequence: translationKey(
      "Until it has one, insights are still found, but none are triaged.",
    ),
  },
  [ProjectAiNoticeContext.AiFeatures]: {
    aiOffDescription: AI_OFF_EVENT_PAGE,
    providerConsequence: translationKey(
      "Until it has one, no AI feature in this project can run.",
    ),
  },
  [ProjectAiNoticeContext.ActivityInsights]: {
    aiOffDescription: translationKey(
      "OneUptime AI is off for this project, so nothing new is investigated or fixed, and nothing new shows up on this page.",
    ),
    providerConsequence: translationKey(
      "Until it has one, nothing new is investigated, so nothing new shows up on this page.",
    ),
  },
  [ProjectAiNoticeContext.ExternalMcpServers]: {
    aiOffDescription: translationKey(
      "OneUptime AI is off for this project, so it uses none of these servers.",
    ),
    providerConsequence: translationKey(
      "Until it has one, OneUptime AI uses none of these servers.",
    ),
  },
  [ProjectAiNoticeContext.SecurityEvents]: {
    aiOffDescription: AI_OFF_EVENT_PAGE,
    providerConsequence: translationKey(
      "Until it has one, security cases are not triaged.",
    ),
  },
  [ProjectAiNoticeContext.Profiles]: {
    aiOffDescription: translationKey(
      "OneUptime AI is off for this project. Slow code is still found, but none of it is looked into and no pull requests are opened.",
    ),
    providerConsequence: translationKey(
      "Until it has one, slow code is still found, but none of it is looked into or fixed.",
    ),
  },
  [ProjectAiNoticeContext.Traces]: {
    aiOffDescription: translationKey(
      "OneUptime AI is off for this project. Slow and failing operations are still found, but none are looked into and no pull requests are opened.",
    ),
    providerConsequence: translationKey(
      "Until it has one, slow and failing operations are still found, but none are looked into or fixed.",
    ),
  },
  [ProjectAiNoticeContext.Exceptions]: {
    aiOffDescription: translationKey(
      "OneUptime AI is off for this project. New and rising exceptions are still found, but none are looked into and no pull requests are opened.",
    ),
    providerConsequence: translationKey(
      "Until it has one, new and rising exceptions are still found, but none are looked into or fixed.",
    ),
  },
  [ProjectAiNoticeContext.Metrics]: {
    aiOffDescription: translationKey(
      "OneUptime AI is off for this project. Problems in your metrics are still found, but none are looked into and no pull requests are opened.",
    ),
    providerConsequence: translationKey(
      "Until it has one, problems in your metrics are still found, but none are looked into or fixed.",
    ),
  },
};

export const ProjectAiNoticeCopy: {
  // Under the Enable AI switch in the notice, once it is on.
  aiOnDescription: string;
  providerMissing: string;
  providerNoDefault: string;
  addProviderLink: string;
  chooseDefaultProviderLink: string;
} = {
  aiOnDescription: translationKey("OneUptime AI is on for this project."),
  providerMissing: translationKey(
    "This project has no LLM provider for OneUptime AI to use.",
  ),
  providerNoDefault: translationKey(
    "None of this project's LLM providers is its default, and OneUptime AI uses the default.",
  ),
  addProviderLink: translationKey("Add an LLM provider"),
  chooseDefaultProviderLink: translationKey("Choose a default LLM provider"),
};

// The data-testids of the notices.
export const PROJECT_AI_OFF_NOTICE_TEST_ID: string = "project-ai-off-notice";

export const PROJECT_AI_OFF_SENTENCE_TEST_ID: string =
  "project-ai-off-sentence";

export const PROJECT_AI_PROVIDER_NOTICE_TEST_ID: string =
  "project-ai-provider-notice";

/*
 * Project Settings → AI → AI Features → More settings: the project's own daily
 * limits on OneUptime AI (Common/Types/AI/ProjectAiDailyLimits). "Just like we
 * have more settings for the incident AI page ... daily token limit or daily
 * spend limit (if it is SaaS)" - the maintainer.
 *
 * One card, Daily limits: the token limit everywhere, and the spend limit
 * only where AI is billed (BILLING_ENABLED), since only there is anything
 * spent. Folded, the section names the card - a chip once a limit is set -
 * and says in a sentence what applies and what AI has used today, so the
 * limit is never a number picked blind: "Nothing limits how much OneUptime
 * AI uses each day. Used today: 45,210 tokens." / "At most 200,000 tokens a
 * day. Used today: 12,345 tokens." Once a limit is reached it says that,
 * and until when, instead.
 */
export const PROJECT_AI_ADVANCED_SECTION_TEST_ID: string =
  "project-ai-advanced-section";

// The one card in it, by key, for the folded header.
export const PROJECT_AI_DAILY_LIMITS_CARD_KEY: string = "DailyLimits";

export const ProjectAiDailyLimitsCopy: {
  sectionDescription: string;
  cardTitle: string;
  noLimitSummary: string;
  spendLimitSummary: string;
  reachedSummary: string;
  fieldError: string;
} = {
  sectionDescription: translationKey(
    "Limits on how much OneUptime AI uses across the whole project each day, above the incident and alert limits.",
  ),
  // The same title as the incident and alert pages' daily limits.
  cardTitle: translationKey("Daily limits"),
  noLimitSummary: translationKey(
    "Nothing limits how much OneUptime AI uses each day.",
  ),
  spendLimitSummary: translationKey("At most {{amount}} of AI credits a day."),
  reachedSummary: translationKey(
    "Today's limit is reached, so OneUptime AI is paused until midnight UTC.",
  ),
  fieldError: translationKey(
    "{{field}} must be a whole number from {{min}} to {{max}}. Leave it empty for no limit.",
  ),
};

export const PROJECT_AI_TOKEN_LIMIT_SUMMARY: PluralTemplate = {
  one: "At most {{count}} token a day.",
  other: "At most {{count}} tokens a day.",
};

export const PROJECT_AI_TOKEN_AND_SPEND_LIMIT_SUMMARY: PluralTemplate = {
  one: "At most {{count}} token and {{amount}} of AI credits a day.",
  other: "At most {{count}} tokens and {{amount}} of AI credits a day.",
};

export const PROJECT_AI_USED_TODAY: PluralTemplate = {
  one: "Used today: {{count}} token.",
  other: "Used today: {{count}} tokens.",
};

export const PROJECT_AI_USED_TODAY_WITH_SPEND: PluralTemplate = {
  one: "Used today: {{count}} token and {{amount}} of AI credits.",
  other: "Used today: {{count}} tokens and {{amount}} of AI credits.",
};

/*
 * The limit columns the Daily limits card shows and edits: the spend limit
 * only where AI is billed.
 */
export const getProjectAiDailyLimitColumns: (
  isBillingEnabled: boolean,
) => Array<ProjectAiDailyLimitColumn> = (
  isBillingEnabled: boolean,
): Array<ProjectAiDailyLimitColumn> => {
  return isBillingEnabled
    ? [PROJECT_AI_DAILY_TOKEN_LIMIT_COLUMN, PROJECT_AI_DAILY_SPEND_LIMIT_COLUMN]
    : [PROJECT_AI_DAILY_TOKEN_LIMIT_COLUMN];
};

// The limits a read of the project holds, as this install enforces them.
export const getProjectAiDailyLimitsFromItem: (data: {
  item: Record<string, unknown>;
  isBillingEnabled: boolean;
}) => ProjectAiDailyLimitValues = (data: {
  item: Record<string, unknown>;
  isBillingEnabled: boolean;
}): ProjectAiDailyLimitValues => {
  return ProjectAiDailyLimits.getLimits({
    project: data.item,
    isBillingEnabled: data.isBillingEnabled,
  });
};

/*
 * Today's usage from POST /ai/daily-usage, or null when the answer cannot
 * be read - the sentence then says only what applies.
 */
export const parseProjectAiDailyUsage: (
  answer: unknown,
) => ProjectAiDailyUsage | null = (
  answer: unknown,
): ProjectAiDailyUsage | null => {
  if (!answer || typeof answer !== "object" || Array.isArray(answer)) {
    return null;
  }

  const data: Record<string, unknown> = answer as Record<string, unknown>;
  const usedTokensToday: unknown = data["usedTokensToday"];
  const spentTodayInUSDCents: unknown = data["spentTodayInUSDCents"];

  if (
    typeof usedTokensToday !== "number" ||
    !Number.isFinite(usedTokensToday) ||
    usedTokensToday < 0
  ) {
    return null;
  }

  return {
    usedTokensToday,
    spentTodayInUSDCents:
      typeof spentTodayInUSDCents === "number" &&
      Number.isFinite(spentTodayInUSDCents) &&
      spentTodayInUSDCents > 0
        ? spentTodayInUSDCents
        : 0,
  };
};

// What the folded More settings header lists: the Daily limits card.
export const getProjectAiAdvancedItems: (
  limits: ProjectAiDailyLimitValues | null,
) => Array<FoldedSectionItem> = (
  limits: ProjectAiDailyLimitValues | null,
): Array<FoldedSectionItem> => {
  return [
    foldedSectionItem(ProjectAiDailyLimitsCopy.cardTitle, {
      key: PROJECT_AI_DAILY_LIMITS_CARD_KEY,
      isSet: limits ? ProjectAiDailyLimits.hasLimit(limits) : false,
    }),
  ];
};

/*
 * The line under the folded More settings header, translated: what applies
 * ("Nothing limits how much OneUptime AI uses each day." / "At most 200,000
 * tokens a day."), then what AI used today, or - once a limit is reached -
 * that AI is paused until midnight UTC. Nothing until the card has read: a
 * "nothing limits AI" said before the limits are known could be untrue.
 * Spend is spoken of only where AI is billed.
 */
export const getProjectAiAdvancedSummary: (data: {
  limits: ProjectAiDailyLimitValues | null;
  usage: ProjectAiDailyUsage | null;
  isBillingEnabled: boolean;
  translator: Translator;
}) => string | undefined = (data: {
  limits: ProjectAiDailyLimitValues | null;
  usage: ProjectAiDailyUsage | null;
  isBillingEnabled: boolean;
  translator: Translator;
}): string | undefined => {
  if (!data.limits) {
    return undefined;
  }

  const tokenLimit: number | null = data.limits.tokenLimit;
  const spendLimitInUSD: number | null = data.isBillingEnabled
    ? data.limits.spendLimitInUSD
    : null;

  const sentences: Array<string> = [];

  if (tokenLimit !== null && spendLimitInUSD !== null) {
    sentences.push(
      data.translator.translatePlural(
        PROJECT_AI_TOKEN_AND_SPEND_LIMIT_SUMMARY,
        tokenLimit,
        { amount: ProjectAiDailyLimits.formatUsd(spendLimitInUSD * 100) },
      ),
    );
  } else if (tokenLimit !== null) {
    sentences.push(
      data.translator.translatePlural(
        PROJECT_AI_TOKEN_LIMIT_SUMMARY,
        tokenLimit,
      ),
    );
  } else if (spendLimitInUSD !== null) {
    sentences.push(
      data.translator.translateTemplate(
        ProjectAiDailyLimitsCopy.spendLimitSummary,
        { amount: ProjectAiDailyLimits.formatUsd(spendLimitInUSD * 100) },
      ),
    );
  } else {
    sentences.push(
      data.translator.translateText(ProjectAiDailyLimitsCopy.noLimitSummary) ||
        ProjectAiDailyLimitsCopy.noLimitSummary,
    );
  }

  if (data.usage) {
    const reached: ProjectAiDailyLimit | null =
      ProjectAiDailyLimits.getReachedLimit({
        limits: { tokenLimit, spendLimitInUSD },
        usage: data.usage,
        isSpendCounted: true,
      });

    if (reached) {
      sentences.push(
        data.translator.translateText(
          ProjectAiDailyLimitsCopy.reachedSummary,
        ) || ProjectAiDailyLimitsCopy.reachedSummary,
      );
    } else if (data.isBillingEnabled) {
      sentences.push(
        data.translator.translatePlural(
          PROJECT_AI_USED_TODAY_WITH_SPEND,
          data.usage.usedTokensToday,
          {
            amount: ProjectAiDailyLimits.formatUsd(
              data.usage.spentTodayInUSDCents,
            ),
          },
        ),
      );
    } else {
      sentences.push(
        data.translator.translatePlural(
          PROJECT_AI_USED_TODAY,
          data.usage.usedTokensToday,
        ),
      );
    }
  }

  return sentences.join(" ");
};

// Digits only: what a whole number typed into a limit field looks like.
const WHOLE_NUMBER_TEXT: RegExp = /^\d+$/;

/*
 * Why a value typed into a limit field cannot be saved, translated, or null
 * when it can: empty (no limit), or a whole number within the limit's
 * bounds. The server holds the same rule (ProjectService).
 */
export const getProjectAiDailyLimitFieldError: (data: {
  column: ProjectAiDailyLimitColumn;
  value: unknown;
  fieldTitle: string;
  translator: Translator;
}) => string | null = (data: {
  column: ProjectAiDailyLimitColumn;
  value: unknown;
  fieldTitle: string;
  translator: Translator;
}): string | null => {
  if (
    data.value === null ||
    data.value === undefined ||
    (typeof data.value === "string" && data.value.trim().length === 0)
  ) {
    return null;
  }

  const parsed: number =
    typeof data.value === "number"
      ? data.value
      : typeof data.value === "string" &&
          WHOLE_NUMBER_TEXT.test(data.value.trim())
        ? Number(data.value.trim())
        : Number.NaN;

  const isTokens: boolean = data.column === PROJECT_AI_DAILY_TOKEN_LIMIT_COLUMN;

  if (
    ProjectAiDailyLimits.getWriteError(
      data.column,
      Number.isFinite(parsed) ? parsed : data.value,
    ) === null
  ) {
    return null;
  }

  return data.translator.translateTemplate(
    ProjectAiDailyLimitsCopy.fieldError,
    {
      field: translatableTerm(data.fieldTitle),
      min: data.translator.formatNumber(
        isTokens
          ? MIN_PROJECT_AI_DAILY_TOKEN_LIMIT
          : MIN_PROJECT_AI_DAILY_SPEND_LIMIT_IN_USD,
      ),
      max: data.translator.formatNumber(
        isTokens
          ? MAX_PROJECT_AI_DAILY_TOKEN_LIMIT
          : MAX_PROJECT_AI_DAILY_SPEND_LIMIT_IN_USD,
      ),
    },
  );
};

export default AI_LANE_SWITCHES;
