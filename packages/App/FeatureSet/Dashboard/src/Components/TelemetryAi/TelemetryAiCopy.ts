import AIInsightType from "Common/Types/AI/AIInsightType";
import { AiRuleFix } from "Common/Types/AI/AiRule";
import { getInvestigationRuleWaitMinutes } from "Common/Types/AI/InvestigationRuleWait";
import {
  TELEMETRY_AI_LANES,
  TelemetryAiLane,
  TelemetryAiSwitchColumn,
} from "Common/Types/AI/TelemetryAi";
import {
  TelemetryAiLogKind,
  TelemetryAiLogState,
} from "Common/Types/AI/TelemetryAiActivity";
import IconProp from "Common/Types/Icon/IconProp";
import { RuleCriteriaSubject } from "Common/Types/Rules/RuleCriteriaSubject";
import type { CardSelectOption } from "Common/UI/Components/CardSelect/CardSelect";
import {
  PluralTemplate,
  translatePlural,
  translateText,
  translationKey,
} from "Common/UI/Utils/TranslateTemplate";
import PageMap from "../../Utils/PageMap";
import {
  InvestigationRuleTiming,
  InvestigationRuleTimingCopy,
} from "../AISettings/InvestigationRuleTiming";
import {
  ProjectAiNoticeContext,
  ProjectAiSwitchDefinition,
} from "../AISettings/ProjectAiSettingsCopy";

/*
 * WHAT THE AI SECTION OF A TELEMETRY PRODUCT SAYS - the Profiler's first
 * (Common/Types/AI/TelemetryAi): its Insights, its Logs and its Settings,
 * each lane's words in one place, React-free so the pages, App's tests and
 * the offline browser suite read these exact strings. Every sentence is
 * wrapped in translationKey() so npm run i18n:extract finds it.
 *
 * "Can we have a section for AI, like insights, logs, and settings in the
 * Profiles product? In settings, we can have a rule that is turned on by
 * default, which says, 'Investigate and remediate performance issues
 * automatically.' (or think of a better term)" - the maintainer. The rule
 * on by default is the lane's switch, named for what it does ("Find and
 * fix slow code"), and AI rules under More settings narrow it, in the
 * shape the incidents' have: Match, Investigate, Fix.
 *
 * Traces is the second lane: an AI tab among its tabs, with the same three
 * pages under a side menu of its own. Exceptions, Logs and Metrics add a
 * lane to TelemetryAiLane and their words here; the pages are the lane's.
 */

// The pages of a lane's AI section.
export interface TelemetryAiLanePages {
  insights: PageMap;
  insightView: PageMap;
  logs: PageMap;
  settings: PageMap;
}

export const TELEMETRY_AI_PAGES: Readonly<
  Record<TelemetryAiLane, TelemetryAiLanePages>
> = {
  [TelemetryAiLane.Profile]: {
    insights: PageMap.PROFILES_AI_INSIGHTS,
    insightView: PageMap.PROFILES_AI_INSIGHT_VIEW,
    logs: PageMap.PROFILES_AI_LOGS,
    settings: PageMap.PROFILES_AI_SETTINGS,
  },
  [TelemetryAiLane.Trace]: {
    insights: PageMap.TRACES_AI_INSIGHTS,
    insightView: PageMap.TRACES_AI_INSIGHT_VIEW,
    logs: PageMap.TRACES_AI_LOGS,
    settings: PageMap.TRACES_AI_SETTINGS,
  },
};

export interface TelemetryAiLaneCopy {
  // The Enable AI notice's words for the lane's Settings page.
  noticeContext: ProjectAiNoticeContext;
  // What the rules' conditions are about: "All services".
  ruleCriteriaSubject: RuleCriteriaSubject;

  // Insights.
  insightsIntro: string;
  insightsEmptyTitle: string;
  insightsEmptyDescription: string;
  /*
   * With nothing found while the lane's switch is off: nothing is looked
   * for, so "nothing found" would not be true.
   */
  insightsOffEmptyTitle: string;
  insightsOffEmptyDescription: string;

  // Logs.
  logsIntro: string;
  logsEmptyTitle: string;
  logsEmptyDescription: string;

  // Settings: the switches card and More settings.
  switchesCardDescription: string;
  advancedDescription: string;
  advancedDefaultsSummary: string;
  rulesCardDescription: string;
  noRulesMessage: string;

  // A rule's form.
  ruleNamePlaceholder: string;
  waitDescription: string;
  timing: Record<InvestigationRuleTiming, InvestigationRuleTimingCopy>;
  fixOptionDescriptions: Record<AiRuleFix, string>;
}

/*
 * The switches card's title: what OneUptime AI does on its own, as on the
 * incidents' and alerts' AI settings.
 */
export const TELEMETRY_AI_SWITCHES_CARD_TITLE: string = translationKey(
  "What OneUptime AI does",
);

// The rules card's title, as on every AI settings page.
export const TELEMETRY_AI_RULES_CARD_TITLE: string = translationKey("AI rules");

export const TELEMETRY_AI_LANE_COPY: Readonly<
  Record<TelemetryAiLane, TelemetryAiLaneCopy>
> = {
  [TelemetryAiLane.Profile]: {
    noticeContext: ProjectAiNoticeContext.Profiles,
    ruleCriteriaSubject: RuleCriteriaSubject.Services,

    insightsIntro: translationKey(
      "Every hour OneUptime looks through your services' profiles for your own code that takes a large or growing share of their time, and files what it finds here with the evidence. OneUptime AI looks into each finding and opens a pull request to fix it, as your AI settings say.",
    ),
    insightsEmptyTitle: translationKey("No slow code found"),
    insightsEmptyDescription: translationKey(
      "Every hour OneUptime looks through your services' profiles and files a finding when your own code takes a large or growing share of their time.",
    ),
    insightsOffEmptyTitle: translationKey(
      "OneUptime is not looking for slow code",
    ),
    insightsOffEmptyDescription: translationKey(
      "Turn on 'Find and fix slow code' in AI Settings, and OneUptime looks through your services' profiles every hour.",
    ),

    logsIntro: translationKey(
      "Everything OneUptime AI did with the slow code it found, newest first: each investigation, and each pull request it opened or was asked to open.",
    ),
    logsEmptyTitle: translationKey("Nothing yet"),
    logsEmptyDescription: translationKey(
      "When OneUptime AI looks into slow code or opens a pull request for it, it shows up here.",
    ),

    switchesCardDescription: translationKey(
      "It works on slow code in your profiles on its own. Turn it off if you do not want it to.",
    ),
    advancedDescription: translationKey(
      "Which services' slow code OneUptime AI works on, when, and whether it opens pull requests on its own.",
    ),
    advancedDefaultsSummary: translationKey(
      "OneUptime AI looks into all slow code it finds right away, and opens a pull request for each.",
    ),
    rulesCardDescription: translationKey(
      "With no rule, OneUptime AI looks into all slow code it finds right away, and opens a pull request for each. Add rules to choose which services it works on, when, and how each is fixed.",
    ),
    noRulesMessage: translationKey(
      "No rules. All slow code found is looked into, and a pull request opened for it.",
    ),

    ruleNamePlaceholder: translationKey("Checkout services"),
    waitDescription: translationKey(
      "Counted from when the slow code was first found. When several rules match, the shortest wait decides. At most 1440 (a day).",
    ),
    timing: {
      [InvestigationRuleTiming.RightAway]: {
        title: translationKey("Right away"),
        description: translationKey(
          "OneUptime AI starts as soon as the slow code is found.",
        ),
      },
      [InvestigationRuleTiming.AfterWait]: {
        title: translationKey("Only if still found after a wait"),
        description: translationKey(
          "Slow code that goes away during the wait is not looked into.",
        ),
      },
    },
    fixOptionDescriptions: {
      [AiRuleFix.DoNotFix]: translationKey(
        "OneUptime AI looks into the slow code and writes what it found on the finding. It opens no pull request.",
      ),
      [AiRuleFix.AskFirst]: translationKey(
        "The finding offers the pull request, and someone opens it with one click.",
      ),
      [AiRuleFix.WithoutAsking]: translationKey(
        "OneUptime AI opens the pull request on its own. Nothing is ever merged: your team reviews it.",
      ),
    },
  },
  /*
   * Traces: slow operations, failing operations and missing tracing
   * (Common/Utils/Traces/TraceInsight) - "problems in your traces" where
   * all three are meant, and each by its name where one is. A failing
   * operation's pull request opens on its own only once the investigation
   * finds the code at fault: the Fix step's answer says so.
   */
  [TelemetryAiLane.Trace]: {
    noticeContext: ProjectAiNoticeContext.Traces,
    ruleCriteriaSubject: RuleCriteriaSubject.Services,

    insightsIntro: translationKey(
      "Every hour OneUptime looks through your services' traces for operations that are slow, that fail, or whose traces cannot say why, and files what it finds here with the evidence. OneUptime AI looks into each finding and opens a pull request to fix it, as your AI settings say.",
    ),
    insightsEmptyTitle: translationKey("No slow or failing operations found"),
    insightsEmptyDescription: translationKey(
      "Every hour OneUptime looks through your services' traces and files a finding when an operation is slow, fails, or lacks the tracing to say why.",
    ),
    insightsOffEmptyTitle: translationKey(
      "OneUptime is not looking for slow and failing operations",
    ),
    insightsOffEmptyDescription: translationKey(
      "Turn on 'Find and fix slow and failing operations' in AI Settings, and OneUptime looks through your services' traces every hour.",
    ),

    logsIntro: translationKey(
      "Everything OneUptime AI did with the problems it found in your traces, newest first: each investigation, and each pull request it opened or was asked to open.",
    ),
    logsEmptyTitle: translationKey("Nothing yet"),
    logsEmptyDescription: translationKey(
      "When OneUptime AI looks into a problem in your traces or opens a pull request for it, it shows up here.",
    ),

    switchesCardDescription: translationKey(
      "It works on slow and failing operations in your traces on its own. Turn it off if you do not want it to.",
    ),
    advancedDescription: translationKey(
      "Which services' operations OneUptime AI works on, when, and whether it opens pull requests on its own.",
    ),
    advancedDefaultsSummary: translationKey(
      "OneUptime AI looks into every problem it finds in your traces right away, and opens a pull request for each.",
    ),
    rulesCardDescription: translationKey(
      "With no rule, OneUptime AI looks into every problem it finds in your traces right away, and opens a pull request for each. Add rules to choose which services it works on, when, and how each is fixed.",
    ),
    noRulesMessage: translationKey(
      "No rules. Every problem found in your traces is looked into, and a pull request opened for it.",
    ),

    ruleNamePlaceholder: translationKey("Checkout services"),
    waitDescription: translationKey(
      "Counted from when the problem was first found. When several rules match, the shortest wait decides. At most 1440 (a day).",
    ),
    timing: {
      [InvestigationRuleTiming.RightAway]: {
        title: translationKey("Right away"),
        description: translationKey(
          "OneUptime AI starts as soon as the problem is found.",
        ),
      },
      [InvestigationRuleTiming.AfterWait]: {
        title: translationKey("Only if still found after a wait"),
        description: translationKey(
          "A problem that goes away during the wait is not looked into.",
        ),
      },
    },
    fixOptionDescriptions: {
      [AiRuleFix.DoNotFix]: translationKey(
        "OneUptime AI looks into the problem and writes what it found on the finding. It opens no pull request.",
      ),
      [AiRuleFix.AskFirst]: translationKey(
        "The finding offers the pull request, and someone opens it with one click.",
      ),
      [AiRuleFix.WithoutAsking]: translationKey(
        "OneUptime AI opens the pull request on its own, for a failing operation once it finds the code at fault. Nothing is ever merged.",
      ),
    },
  },
};

/*
 * A lane's AI → Insights: AI Insights' inbox (Pages/AIInsights/Insights),
 * scoped to the lane's own kinds of finding, opened in the lane's own view,
 * in its words, with its own Settings as the way on.
 */
export interface TelemetryAiInsightsScope {
  insightTypes: ReadonlyArray<AIInsightType>;
  viewPage: PageMap;
  settingsPage: PageMap;
  intro: string;
  emptyTitle: string;
  emptyDescription: string;
}

// One object per lane, so the inbox's reads keep their identity.
export const TELEMETRY_AI_INSIGHTS_SCOPES: Readonly<
  Record<TelemetryAiLane, TelemetryAiInsightsScope>
> = {
  [TelemetryAiLane.Profile]: {
    insightTypes: TELEMETRY_AI_LANES[TelemetryAiLane.Profile].insightTypes,
    viewPage: TELEMETRY_AI_PAGES[TelemetryAiLane.Profile].insightView,
    settingsPage: TELEMETRY_AI_PAGES[TelemetryAiLane.Profile].settings,
    intro: TELEMETRY_AI_LANE_COPY[TelemetryAiLane.Profile].insightsIntro,
    emptyTitle:
      TELEMETRY_AI_LANE_COPY[TelemetryAiLane.Profile].insightsEmptyTitle,
    emptyDescription:
      TELEMETRY_AI_LANE_COPY[TelemetryAiLane.Profile].insightsEmptyDescription,
  },
  [TelemetryAiLane.Trace]: {
    insightTypes: TELEMETRY_AI_LANES[TelemetryAiLane.Trace].insightTypes,
    viewPage: TELEMETRY_AI_PAGES[TelemetryAiLane.Trace].insightView,
    settingsPage: TELEMETRY_AI_PAGES[TelemetryAiLane.Trace].settings,
    intro: TELEMETRY_AI_LANE_COPY[TelemetryAiLane.Trace].insightsIntro,
    emptyTitle: TELEMETRY_AI_LANE_COPY[TelemetryAiLane.Trace].insightsEmptyTitle,
    emptyDescription:
      TELEMETRY_AI_LANE_COPY[TelemetryAiLane.Trace].insightsEmptyDescription,
  },
};

/*
 * The same, while the lane's switch is off: its empty state says that
 * nothing is looked for, and the way to turn it on (its AI Settings).
 */
export const TELEMETRY_AI_INSIGHTS_SCOPES_WHILE_OFF: Readonly<
  Record<TelemetryAiLane, TelemetryAiInsightsScope>
> = {
  [TelemetryAiLane.Profile]: {
    ...TELEMETRY_AI_INSIGHTS_SCOPES[TelemetryAiLane.Profile],
    emptyTitle:
      TELEMETRY_AI_LANE_COPY[TelemetryAiLane.Profile].insightsOffEmptyTitle,
    emptyDescription:
      TELEMETRY_AI_LANE_COPY[TelemetryAiLane.Profile]
        .insightsOffEmptyDescription,
  },
  [TelemetryAiLane.Trace]: {
    ...TELEMETRY_AI_INSIGHTS_SCOPES[TelemetryAiLane.Trace],
    emptyTitle:
      TELEMETRY_AI_LANE_COPY[TelemetryAiLane.Trace].insightsOffEmptyTitle,
    emptyDescription:
      TELEMETRY_AI_LANE_COPY[TelemetryAiLane.Trace].insightsOffEmptyDescription,
  },
};

// A lane's inbox scope, as its switch stands: off only once read as off.
export function getTelemetryAiInsightsScope(
  lane: TelemetryAiLane,
  isLaneOff: boolean,
): TelemetryAiInsightsScope {
  return isLaneOff
    ? TELEMETRY_AI_INSIGHTS_SCOPES_WHILE_OFF[lane]
    : TELEMETRY_AI_INSIGHTS_SCOPES[lane];
}

/*
 * Each lane's switch: on for new projects, off for projects made before
 * it. A pull request needs a repository connected in Code (through the
 * GitHub App, or a GitLab, Forgejo or Gitea connection); the switch's note
 * says so.
 */
export const TELEMETRY_AI_SWITCHES: Readonly<
  Record<
    TelemetryAiLane,
    Array<ProjectAiSwitchDefinition<TelemetryAiSwitchColumn>>
  >
> = {
  [TelemetryAiLane.Profile]: [
    {
      column: "enableAutomaticProfileRemediation",
      title: translationKey("Find and fix slow code"),
      description: translationKey(
        "Every hour OneUptime looks through your profiles for slow code. OneUptime AI looks into what it finds and opens a pull request to fix it.",
      ),
      note: translationKey("Needs a repository connected in Code."),
    },
  ],
  [TelemetryAiLane.Trace]: [
    {
      column: "enableAutomaticTraceRemediation",
      title: translationKey("Find and fix slow and failing operations"),
      description: translationKey(
        "Every hour OneUptime looks through your traces for slow and failing operations and missing tracing. OneUptime AI opens a pull request to fix each.",
      ),
      note: translationKey("Needs a repository connected in Code."),
    },
  ],
};

// The Fix step's three answers, in a lane's words: a pull request each.
export const getTelemetryAiFixOptions: (
  lane: TelemetryAiLane,
) => Array<CardSelectOption> = (
  lane: TelemetryAiLane,
): Array<CardSelectOption> => {
  const descriptions: Record<AiRuleFix, string> =
    TELEMETRY_AI_LANE_COPY[lane].fixOptionDescriptions;

  return [
    {
      value: AiRuleFix.DoNotFix,
      title: translationKey("Don't fix"),
      description: descriptions[AiRuleFix.DoNotFix],
      icon: IconProp.Search,
    },
    {
      value: AiRuleFix.AskFirst,
      title: translationKey("Ask before fixing"),
      description: descriptions[AiRuleFix.AskFirst],
      icon: IconProp.HandRaised,
    },
    {
      value: AiRuleFix.WithoutAsking,
      title: translationKey("Fix without asking"),
      description: descriptions[AiRuleFix.WithoutAsking],
      icon: IconProp.Bolt,
    },
  ];
};

/*
 * Why a rule has no Runner field: the code is changed on the Runner the
 * repository picks in Code, the only Runner that is ever handed it.
 */
export const TELEMETRY_AI_RUNNER_HINT: string = translationKey(
  "Pull requests are made on the Runner each repository picks in Code.",
);

export const TELEMETRY_AI_RIGHT_AWAY: string = translationKey("Right away");

const STILL_FOUND_AFTER: PluralTemplate = {
  one: "If still found after {{count}} minute",
  other: "If still found after {{count}} minutes",
};

/*
 * What a rules table says a rule waits for, in the reader's language:
 * "Right away", or "If still found after 60 minutes".
 */
export function describeTelemetryAiRuleTiming(minutes: unknown): string {
  const wait: number = getInvestigationRuleWaitMinutes(minutes);

  if (wait === 0) {
    return translateText(TELEMETRY_AI_RIGHT_AWAY) || TELEMETRY_AI_RIGHT_AWAY;
  }

  return translatePlural(STILL_FOUND_AFTER, wait);
}

// The Settings page's readiness card: what stands between a lane and a pull request.
export const TELEMETRY_AI_READINESS_COPY: {
  title: string;
  connectRepository: string;
  connectRepositoryLink: string;
  ready: PluralTemplate;
  automaticToday: string;
  couldNotRead: string;
} = {
  title: translationKey("Pull requests"),
  connectRepository: translationKey(
    "Connect a repository so OneUptime AI can open pull requests for what it finds.",
  ),
  connectRepositoryLink: translationKey("Connect a repository in Code"),
  ready: {
    one: "OneUptime AI can open pull requests in {{count}} connected repository.",
    other:
      "OneUptime AI can open pull requests in {{count}} connected repositories.",
  },
  automaticToday: translationKey(
    "It opens at most {{max}} on its own each day (UTC): {{today}} so far today.",
  ),
  couldNotRead: translationKey(
    "Could not check whether OneUptime AI can open pull requests.",
  ),
};

// How a log entry is labelled, by what it is.
export const TELEMETRY_AI_LOG_KIND_LABELS: Readonly<
  Record<TelemetryAiLogKind, string>
> = {
  [TelemetryAiLogKind.Investigation]: translationKey("Investigation"),
  [TelemetryAiLogKind.PullRequest]: translationKey("Pull request"),
};

export const TELEMETRY_AI_LOG_KIND_ICONS: Readonly<
  Record<TelemetryAiLogKind, IconProp>
> = {
  [TelemetryAiLogKind.Investigation]: IconProp.Search,
  [TelemetryAiLogKind.PullRequest]: IconProp.Code,
};

// How an entry stands, in a pill.
export const TELEMETRY_AI_LOG_STATE_LABELS: Readonly<
  Record<TelemetryAiLogState, string>
> = {
  [TelemetryAiLogState.Waiting]: translationKey("Waiting to start"),
  [TelemetryAiLogState.Working]: translationKey("In progress"),
  [TelemetryAiLogState.Done]: translationKey("Done"),
  [TelemetryAiLogState.NothingToChange]: translationKey("Nothing to change"),
  [TelemetryAiLogState.WaitingForYou]: translationKey("Waiting for you"),
  [TelemetryAiLogState.Failed]: translationKey("Failed"),
  [TelemetryAiLogState.Stopped]: translationKey("Stopped"),
};

// The pill's colours: a dot and its text, light and dark (Theme.css remaps).
export const TELEMETRY_AI_LOG_STATE_CLASS_NAMES: Readonly<
  Record<TelemetryAiLogState, string>
> = {
  [TelemetryAiLogState.Waiting]: "bg-gray-100 text-gray-700",
  [TelemetryAiLogState.Working]: "bg-indigo-50 text-indigo-700",
  [TelemetryAiLogState.Done]: "bg-green-50 text-green-700",
  [TelemetryAiLogState.NothingToChange]: "bg-gray-100 text-gray-700",
  [TelemetryAiLogState.WaitingForYou]: "bg-amber-50 text-amber-800",
  [TelemetryAiLogState.Failed]: "bg-red-50 text-red-700",
  [TelemetryAiLogState.Stopped]: "bg-gray-100 text-gray-700",
};

// Who an entry was started by.
export const TELEMETRY_AI_LOG_STARTED_BY_ONEUPTIME: string = translationKey(
  "Started by OneUptime",
);

export const TELEMETRY_AI_LOG_ASKED_BY: string =
  translationKey("Asked by {{name}}");

export const TELEMETRY_AI_LOG_OPEN_TASK: string = translationKey("Open task");

export const TELEMETRY_AI_LOGS_SHOWING: PluralTemplate = {
  one: "Showing {{shown}} of {{total}} entry",
  other: "Showing {{shown}} of {{total}} entries",
};

export const TELEMETRY_AI_LOGS_COULD_NOT_LOAD: string = translationKey(
  "Could not load the AI logs: {{error}}",
);

// The data-testids of the section's parts.
export const TELEMETRY_AI_TEST_IDS: {
  switches: string;
  readiness: string;
  readinessConnect: string;
  readinessReady: string;
  advancedSection: string;
  rulesTable: string;
  logs: string;
  logEntry: string;
  logsEmpty: string;
  logsSettings: string;
  logsLoadMore: string;
  runnerHint: string;
} = {
  switches: "telemetry-ai-switches",
  readiness: "telemetry-ai-readiness",
  readinessConnect: "telemetry-ai-readiness-connect",
  readinessReady: "telemetry-ai-readiness-ready",
  advancedSection: "telemetry-ai-advanced-section",
  rulesTable: "telemetry-ai-rules-table",
  logs: "telemetry-ai-logs",
  logEntry: "telemetry-ai-log-entry",
  logsEmpty: "telemetry-ai-logs-empty",
  logsSettings: "telemetry-ai-logs-settings",
  logsLoadMore: "telemetry-ai-logs-load-more",
  runnerHint: "telemetry-ai-runner-hint",
};

// A lane's rules table id: also its saved column preferences' key.
export function getTelemetryAiRulesTableId(lane: TelemetryAiLane): string {
  return `${TELEMETRY_AI_TEST_IDS.rulesTable}-${lane}`;
}
