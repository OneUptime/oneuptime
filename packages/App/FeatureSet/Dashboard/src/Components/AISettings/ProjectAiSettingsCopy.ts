import { translationKey } from "Common/UI/Utils/TranslateTemplate";

/*
 * What the project's AI settings pages say, in one place: Incidents →
 * Settings → AI, Alerts → Settings → AI, AI → Insights → Settings and
 * Project Settings → AI Features.
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
 * how much may run each day - is folded under Advanced, whose folded line
 * says what the defaults do. Two things are said only when they are true:
 * that Enable AI is off (with the switch that turns it on), and that the
 * project has no LLM provider OneUptime AI can use.
 *
 * Nothing here changes what the columns hold, their defaults, the API or
 * Terraform: new projects still start with every AI behaviour on
 * (ProjectService's NEW_PROJECT_AI_DEFAULT_COLUMNS), and Enable AI is still
 * the project's only AI switch.
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

// The Project columns behind the incident and alert pages' switches.
export type AiLaneSwitchColumn =
  | "enableAutomaticIncidentInvestigation"
  | "enableAutomaticPostmortemDraft"
  | "enableAutomaticIncidentCodeFixes"
  | "enableIncidentInstrumentationFixTasks"
  | "enableAutomaticAlertInvestigation"
  | "enableAutomaticAlertCodeFixes"
  | "enableAlertInstrumentationFixTasks";

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
}

// The data-testid of a project AI switch, wherever it is drawn.
export const getProjectAiSwitchTestId: (column: string) => string = (
  column: string,
): string => {
  return `ai-switch-${column}`;
};

/*
 * The fix pull request switches read the same for incidents and alerts:
 * both follow an investigation, whichever kind it was.
 */
const CODE_FIX_TITLE: string = translationKey(
  "Open a fix pull request when an investigation finds a code change",
);
const CODE_FIX_DESCRIPTION: string = translationKey(
  "When an investigation is confident the cause is in your code, OneUptime AI opens a pull request with the fix for your team to review. Nothing is merged automatically.",
);
const CODE_FIX_NOTE: string = translationKey(
  "Needs a repository connected through the GitHub App and a Runner that can fix code.",
);
const TELEMETRY_FIX_TITLE: string = translationKey(
  "Open a pull request that adds missing telemetry",
);
const TELEMETRY_FIX_DESCRIPTION: string = translationKey(
  "When an investigation cannot find the cause because logs, traces or metrics are missing, OneUptime AI opens a pull request that adds them, for your team to review.",
);
const GITHUB_APP_NOTE: string = translationKey(
  "Needs a repository connected through the GitHub App.",
);

/*
 * The switches of each lane's page, in the order they are drawn: what
 * OneUptime AI does on its own as incidents (or alerts) happen.
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
    {
      column: "enableAutomaticPostmortemDraft",
      title: translationKey("Draft a postmortem when an incident resolves"),
      description: translationKey(
        "OneUptime AI writes a draft from the incident's timeline and telemetry for your team to review. It never replaces a postmortem that already exists.",
      ),
    },
    {
      column: "enableAutomaticIncidentCodeFixes",
      title: CODE_FIX_TITLE,
      description: CODE_FIX_DESCRIPTION,
      note: CODE_FIX_NOTE,
    },
    {
      column: "enableIncidentInstrumentationFixTasks",
      title: TELEMETRY_FIX_TITLE,
      description: TELEMETRY_FIX_DESCRIPTION,
      note: GITHUB_APP_NOTE,
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
    {
      column: "enableAutomaticAlertCodeFixes",
      title: CODE_FIX_TITLE,
      description: CODE_FIX_DESCRIPTION,
      note: CODE_FIX_NOTE,
    },
    {
      column: "enableAlertInstrumentationFixTasks",
      title: TELEMETRY_FIX_TITLE,
      description: TELEMETRY_FIX_DESCRIPTION,
      note: GITHUB_APP_NOTE,
    },
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

// The three cards under Advanced, each a question with its own Edit.
export enum AiLaneAdvancedCard {
  // Minimum severity and re-investigation cooldown.
  WhichAreInvestigated = "WhichAreInvestigated",
  // How many run at once, and for how long.
  InvestigationLimits = "InvestigationLimits",
  // Tokens and fix pull requests per day.
  DailyLimits = "DailyLimits",
}

export const AI_LANE_ADVANCED_CARDS: Array<AiLaneAdvancedCard> = [
  AiLaneAdvancedCard.WhichAreInvestigated,
  AiLaneAdvancedCard.InvestigationLimits,
  AiLaneAdvancedCard.DailyLimits,
];

// Which of a lane's Advanced columns each card holds.
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
 * the card read it (null when nothing is set), and which cards have read.
 */
export interface AiLaneAdvancedState {
  values: Record<string, unknown>;
  loadedCards: Array<AiLaneAdvancedCard>;
}

export const EMPTY_AI_LANE_ADVANCED_STATE: AiLaneAdvancedState = {
  values: {},
  loadedCards: [],
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

// Whether anything under a lane's Advanced is set: its "Configured" badge.
export const isAiLaneAdvancedConfigured: (
  lane: AiLane,
  state: AiLaneAdvancedState,
) => boolean = (lane: AiLane, state: AiLaneAdvancedState): boolean => {
  return Object.values(AI_LANE_ADVANCED_COLUMNS[lane]).some(
    (column: string): boolean => {
      return isAiLaneAdvancedValueSet(state.values[column]);
    },
  );
};

export interface AiLanePageCopy {
  // The switches card.
  switchesCardTitle: string;
  switchesCardDescription: string;
  // The Advanced section.
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
      "Which incidents are investigated, and limits on investigations and on AI work each day.",
    ),
    advancedDefaultsSummary: translationKey(
      "Every incident is investigated, whatever its severity, and nothing limits how much OneUptime AI does.",
    ),
  },
  [AiLane.Alert]: {
    switchesCardTitle: SWITCHES_CARD_TITLE,
    switchesCardDescription: translationKey(
      "It works on alerts on its own. Turn off anything you do not want it to do.",
    ),
    advancedDescription: translationKey(
      "Which alerts are investigated, and limits on investigations and on AI work each day.",
    ),
    advancedDefaultsSummary: translationKey(
      "Every alert is investigated, whatever its severity, and nothing limits how much OneUptime AI does.",
    ),
  },
};

/*
 * The line under the folded Advanced header: what the defaults do, once
 * every card has read and none holds anything. Nothing until then - a
 * "nothing limits AI" read before the limits are known could be untrue -
 * and nothing while a limit is set, when the header says "Configured" and
 * the description says what is in there.
 */
export const getAiLaneAdvancedSummary: (
  lane: AiLane,
  state: AiLaneAdvancedState,
) => string | undefined = (
  lane: AiLane,
  state: AiLaneAdvancedState,
): string | undefined => {
  const hasEveryCardRead: boolean = AI_LANE_ADVANCED_CARDS.every(
    (card: AiLaneAdvancedCard): boolean => {
      return state.loadedCards.includes(card);
    },
  );

  if (!hasEveryCardRead || isAiLaneAdvancedConfigured(lane, state)) {
    return undefined;
  }

  return AI_LANE_PAGE_COPY[lane].advancedDefaultsSummary;
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
      "Every 15 minutes, OneUptime checks your logs, exceptions, traces and metrics for spikes, new errors, slowdowns and drift, and files what it finds as an insight. With an LLM provider, OneUptime AI also triages each new insight.",
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
    note: GITHUB_APP_NOTE,
  },
  {
    column: "autoArchiveNonActionableExceptions",
    title: translationKey("Archive exceptions that are expected"),
    description: translationKey(
      "When OneUptime AI finds that an exception is expected, such as a refused sign-in or a plan limit, it archives it so it stops showing as unresolved. You can bring it back from the Archived tab.",
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
 * Project Settings → AI Features: Enable AI, the project's one AI switch.
 * Turning it off stops every AI feature at once, so it asks first.
 */
export type EnableAiColumn = "enableAi";

export const ENABLE_AI_COLUMN: EnableAiColumn = "enableAi";

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
  switchDescription: translationKey(
    "The master switch. When off, every AI feature in this project stops: Ask AI, investigations, postmortem drafts, auto-remediation and AI commands on Runners. Auto-remediation and AI commands on Runners need no other project switch.",
  ),
  turnOffConfirmTitle: translationKey("Turn off AI for this project?"),
  turnOffConfirmDescription: translationKey(
    "Every AI feature in this project stops at once: Ask AI, investigations, postmortem drafts, fix pull requests, insight triage, auto-remediation and AI commands on Runners. Each one keeps its own setting, so turning AI back on brings back what was on.",
  ),
  turnOffConfirmButton: translationKey("Turn off AI"),
  whoCanTurnOn: translationKey(
    "A project owner or someone with Manage Billing can turn AI on in Project Settings → AI Features.",
  ),
};

// The data-testid of the Enable AI switch on Project Settings → AI Features.
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
  // Project Settings → AI Features, where Enable AI is the page itself.
  AiFeatures = "AiFeatures",
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

export default AI_LANE_SWITCHES;
