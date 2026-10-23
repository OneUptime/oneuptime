import { formatRelativeTime } from "../Home/HomeRelativeTime";
import PageMap from "../../Utils/PageMap";
import {
  SecurityPipelineStage,
  SecurityPipelineStageKey,
  SecuritySetupStatus,
  countSecuritySources,
  getSecurityPipelineStages,
  hasSecuritySources,
} from "./SecuritySetupModel";
import IconProp from "Common/Types/Icon/IconProp";
import {
  PluralTemplate,
  Translator,
  translationKey,
} from "Common/UI/Utils/TranslateTemplate";

/*
 * THE TOP OF THE SECURITY OVERVIEW, decided in one place.
 *
 * One card, drawn the way Home draws the top of a project (ProjectHealth):
 * a band that says in a sentence what the reader should know first - what
 * needs someone, that every open case is picked up, that nothing is watched
 * yet, or that all is quiet - and under it the pipeline, one cell per part
 * of Security (sources, detections, cases, playbooks), each with its figure
 * and a status line that says whether that part is fine, needs a look, or
 * is not set up yet and where to set it up.
 *
 * Everything here comes from the two reads the Overview already makes: the
 * overview's figures (SecurityCaseApi.getOverview) and how Security is set
 * up (getSetupStatus). Nothing is fetched per cell.
 *
 * React-free, so every combination is pinned in a plain test. The words are
 * English translation keys and plural templates, looked up where they are
 * drawn (translateSecurityOverviewText), so a language switch re-renders
 * them.
 */

/*
 * How a part of the strip or the band reads: the product's colours for "fine",
 * "needs a look", "urgent", "in hand" and "not set up yet", as Home uses them.
 */
export enum SecurityStatusTone {
  // Urgent: an open case nobody has picked up, a critical or high case.
  Danger = "danger",
  // Needs a look: a step waiting for an approval, a source gone quiet.
  Warning = "warning",
  // In hand: every open case is someone's.
  Info = "info",
  // Fine.
  Success = "success",
  // Neither good nor bad news, or not set up yet.
  Neutral = "neutral",
}

/*
 * A sentence of the card: fixed, count-dependent, with values, or with a
 * time since ("Last event 3 days ago") written in the reader's language.
 */
export type SecurityOverviewText =
  | { text: string }
  | { plural: PluralTemplate; count: number }
  | { template: string; values: { [key: string]: string | number } }
  | { template: string; since: Date; now: Date };

/*
 * What the Overview knows about the queue, from its overview read: the open
 * cases, how many of them are urgent, whose they are, and the playbook
 * steps held for an approval.
 */
export interface SecurityOverviewQueue {
  openCases: number;
  criticalOpenCases: number;
  highOpenCases: number;
  myOpenCases: number;
  unassignedOpenCases: number;
  runsWaitingForApproval: number;
}

/*
 * ---------------------------------------------------------------------------
 * The band
 * ---------------------------------------------------------------------------
 */

export enum SecurityHeadlineKind {
  // Something waits for a person: your cases, cases nobody has, a held step.
  NeedsAttention = "needs-attention",
  // Cases are open, and every one of them is someone else's.
  InHand = "in-hand",
  /*
   * Nothing open, and nothing can open a case: no connection, and no rule
   * or threat intel feed reading your logs (isSecurityWatching).
   */
  NotSetUp = "not-set-up",
  // Nothing open, nothing waiting, and Security is watching.
  Quiet = "quiet",
}

export enum SecurityHeadlineAction {
  None = "none",
  // Send a test attack: see a case open, for whoever wants to.
  TestAttack = "test-attack",
  // Set up Security: Get started again, after it was put away.
  SetUp = "set-up",
}

export enum SecurityAttentionKey {
  Mine = "mine",
  Unassigned = "unassigned",
  Approvals = "approvals",
}

/*
 * One thing that waits for a person, as a link to the page that lists
 * exactly what it counts. The label is a plural without the count, which
 * the link draws on its own, bolder.
 */
export interface SecurityAttentionItem {
  key: SecurityAttentionKey;
  icon: IconProp;
  count: number;
  label: PluralTemplate;
  page: PageMap;
  tone: SecurityStatusTone;
}

export interface SecurityHeadline {
  kind: SecurityHeadlineKind;
  tone: SecurityStatusTone;
  icon: IconProp;
  title: string;
  // Under the title; the attention links take its place when there are some.
  summary: SecurityOverviewText | null;
  items: Array<SecurityAttentionItem>;
  action: SecurityHeadlineAction;
}

export const NEEDS_ATTENTION_TITLE: string = translationKey("Needs attention");

export const IN_HAND_TITLE: string = translationKey(
  "Every open case is picked up",
);

export const IN_HAND_SUMMARY: string = translationKey(
  "Each one is assigned, and no playbook step is waiting for an approval.",
);

// Home's words for the same moment: "Nothing is being monitored yet".
export const NOT_SET_UP_TITLE: string = translationKey(
  "Nothing is being watched for threats yet",
);

export const NOT_SET_UP_SUMMARY: string = translationKey(
  "Turn on what most teams need in one click: your logs as a source, the recommended detection rules and a playbook that enriches every new case.",
);

// The not-watched band's button: Get started again.
export const SET_UP_SECURITY: string = translationKey("Set up Security");

export const QUIET_TITLE: string = translationKey("All quiet");

// With a playbook on, the band can say what runs when a case opens.
export const QUIET_SUMMARY: string = translationKey(
  "No open case and nothing waiting for an approval. When a rule finds a threat, its case opens here and your playbooks run on it.",
);

export const QUIET_SUMMARY_WITHOUT_PLAYBOOKS: string = translationKey(
  "No open case and nothing waiting for an approval. When a rule finds a threat, its case opens here.",
);

/*
 * Quiet, but the sources have sent nothing for a day: said beside "All
 * quiet", so a silence that may be a source that stopped is not read as a
 * clean bill of health. The pipeline's Sources cell says it in amber.
 */
export const QUIET_SUMMARY_SOURCES_SILENT: string = translationKey(
  "No open case and nothing waiting for an approval, but the last security event arrived {{time}}.",
);

// What the list of things waiting for a person is called, for a screen reader.
export const ATTENTION_LIST_LABEL: string = translationKey(
  "What needs someone now",
);

export const MY_OPEN_CASES_LABEL: PluralTemplate = {
  one: "open case assigned to you",
  other: "open cases assigned to you",
};

export const UNASSIGNED_OPEN_CASES_LABEL: PluralTemplate = {
  one: "open case nobody has picked up",
  other: "open cases nobody has picked up",
};

export const STEPS_WAITING_LABEL: PluralTemplate = {
  one: "playbook step waiting for approval",
  other: "playbook steps waiting for approval",
};

/*
 * The three things that can wait for a person, in the order the docs name
 * them: the cases that are yours, the ones nobody has picked up, and the
 * playbook steps held for an approval. Only those with something to count
 * are offered.
 */
export function getSecurityAttentionItems(
  queue: SecurityOverviewQueue,
): Array<SecurityAttentionItem> {
  const items: Array<SecurityAttentionItem> = [
    {
      key: SecurityAttentionKey.Mine,
      icon: IconProp.User,
      count: queue.myOpenCases,
      label: MY_OPEN_CASES_LABEL,
      page: PageMap.SECURITY_CASES_ASSIGNED_TO_ME,
      tone: SecurityStatusTone.Info,
    },
    {
      key: SecurityAttentionKey.Unassigned,
      icon: IconProp.Inbox,
      count: queue.unassignedOpenCases,
      label: UNASSIGNED_OPEN_CASES_LABEL,
      page: PageMap.SECURITY_CASES_UNASSIGNED,
      tone: SecurityStatusTone.Danger,
    },
    {
      key: SecurityAttentionKey.Approvals,
      icon: IconProp.PauseCircle,
      count: queue.runsWaitingForApproval,
      label: STEPS_WAITING_LABEL,
      page: PageMap.SECURITY_PLAYBOOK_RUNS_WAITING_FOR_APPROVAL,
      tone: SecurityStatusTone.Warning,
    },
  ];

  return items.filter((item: SecurityAttentionItem): boolean => {
    return item.count > 0;
  });
}

/*
 * Whether anything can open a case: a connected product - its alerts open
 * cases from High up by default (the connection's Open Cases From
 * Severity), with or without a rule of OneUptime's - or your logs, with a
 * rule or a threat intel feed to find threats in them. Without either,
 * "All quiet" would read as though something were looking and had found
 * nothing.
 */
export function isSecurityWatching(status: SecuritySetupStatus): boolean {
  return (
    status.connections > 0 ||
    (status.logsSourceEnabled &&
      (status.enabledRules > 0 || status.threatIntelFeeds > 0))
  );
}

/*
 * What the band says, most pressing first: what waits for a person, then
 * cases that are open but in hand, then - with nothing open - that nothing
 * is watched yet, or that all is quiet. Without the set-up figures (a read
 * that failed) the band says what the overview alone can tell.
 */
export function getSecurityHeadline(data: {
  queue: SecurityOverviewQueue;
  status: SecuritySetupStatus | null;
  // What "the last security event arrived 3 days ago" counts from.
  now: Date;
}): SecurityHeadline {
  const { queue, status, now } = data;
  const items: Array<SecurityAttentionItem> = getSecurityAttentionItems(queue);

  if (items.length > 0) {
    /*
     * Red only while a critical or high case is open, as Home keeps red
     * for incidents; amber for everything else that waits for a person.
     */
    const isUrgent: boolean = queue.criticalOpenCases + queue.highOpenCases > 0;

    return {
      kind: SecurityHeadlineKind.NeedsAttention,
      tone: isUrgent ? SecurityStatusTone.Danger : SecurityStatusTone.Warning,
      icon: IconProp.ShieldExclamation,
      title: NEEDS_ATTENTION_TITLE,
      summary: null,
      items,
      action: SecurityHeadlineAction.None,
    };
  }

  if (queue.openCases > 0) {
    return {
      kind: SecurityHeadlineKind.InHand,
      tone: SecurityStatusTone.Info,
      icon: IconProp.UserGroup,
      title: IN_HAND_TITLE,
      summary: { text: IN_HAND_SUMMARY },
      items: [],
      action: SecurityHeadlineAction.None,
    };
  }

  /*
   * "All quiet" over nothing that can open a case would read as though
   * something were looking and had found nothing - the wrong impression for
   * a project nothing watches. Say so, and offer the setup.
   */
  if (status && !isSecurityWatching(status)) {
    return {
      kind: SecurityHeadlineKind.NotSetUp,
      tone: SecurityStatusTone.Neutral,
      icon: IconProp.EyeSlash,
      title: NOT_SET_UP_TITLE,
      summary: { text: NOT_SET_UP_SUMMARY },
      items: [],
      action: SecurityHeadlineAction.SetUp,
    };
  }

  return {
    kind: SecurityHeadlineKind.Quiet,
    tone: SecurityStatusTone.Success,
    icon: IconProp.ShieldCheck,
    title: QUIET_TITLE,
    summary: getQuietSummary(status, now),
    items: [],
    action: SecurityHeadlineAction.TestAttack,
  };
}

/*
 * What "All quiet" adds: that the sources have gone silent, when they have;
 * otherwise what happens when a rule finds a threat - "your playbooks run on
 * it" only when there is one to run.
 */
function getQuietSummary(
  status: SecuritySetupStatus | null,
  now: Date,
): SecurityOverviewText {
  if (status && isSecuritySourceSilent(status, now) && status.lastEventAt) {
    return {
      template: QUIET_SUMMARY_SOURCES_SILENT,
      since: status.lastEventAt,
      now,
    };
  }

  return {
    text:
      status && status.enabledPlaybooks > 0
        ? QUIET_SUMMARY
        : QUIET_SUMMARY_WITHOUT_PLAYBOOKS,
  };
}

/*
 * ---------------------------------------------------------------------------
 * The pipeline's cells
 * ---------------------------------------------------------------------------
 */

export interface SecurityStageView {
  key: SecurityPipelineStageKey;
  title: string;
  icon: IconProp;
  // Where the cell opens: the part's page, or where to set it up.
  page: PageMap;
  isReady: boolean;
  figure: SecurityOverviewText;
  figureTone: SecurityStatusTone;
  status: SecurityOverviewText | null;
  statusIcon: IconProp;
  statusTone: SecurityStatusTone;
}

export const NOT_SET_UP_FIGURE: string = translationKey("Not set up");

/*
 * What a part not set up asks for, as the status line under "Not set up" -
 * the cell opens where it is done.
 */
export const SET_UP_SOURCES: string = translationKey("Connect a source");
export const SET_UP_DETECTIONS: string = translationKey("Turn on rules");
export const SET_UP_PLAYBOOKS: string = translationKey("Add a playbook");

export const NO_EVENTS_YET: string = translationKey("No events yet");
export const LAST_EVENT: string = translationKey("Last event {{time}}");
export const RECOMMENDED_ON: string = translationKey(
  "{{on}} of {{total}} recommended",
);
export const NONE_OPEN: string = translationKey("None open");
export const ALL_CLEAR: string = translationKey("All clear");
export const URGENT_OPEN_CASES: string = translationKey(
  "{{critical}} critical · {{high}} high",
);
export const NONE_URGENT: string = translationKey("None critical or high");
export const NOTHING_WAITING: string = translationKey("Nothing waiting");

// The figures under each part, in words that agree with the number.
export const SOURCES_FIGURE: PluralTemplate = {
  one: "{{count}} source",
  other: "{{count}} sources",
};

export const EVENTS_IN_24_HOURS: PluralTemplate = {
  one: "{{count}} event in 24 hours",
  other: "{{count}} events in 24 hours",
};

export const RULES_ON_FIGURE: PluralTemplate = {
  one: "{{count}} rule on",
  other: "{{count}} rules on",
};

export const OPEN_CASES_FIGURE: PluralTemplate = {
  one: "{{count}} open case",
  other: "{{count}} open cases",
};

export const PLAYBOOKS_ON_FIGURE: PluralTemplate = {
  one: "{{count}} playbook on",
  other: "{{count}} playbooks on",
};

// Short enough for one line beside the side menu; the band says it in full.
export const STEPS_TO_APPROVE: PluralTemplate = {
  one: "{{count}} step to approve",
  other: "{{count}} steps to approve",
};

export const SIEM_DESTINATIONS: PluralTemplate = {
  one: "Security events are also sent to {{count}} SIEM.",
  other: "Security events are also sent to {{count}} SIEMs.",
};

// The set-up figures could not be read: said in the pipeline's place.
export const STATUS_READ_FAILED: string = translationKey(
  "We could not load how Security is set up.",
);

// The overview could not be read at all: the page's place.
export const OVERVIEW_READ_FAILED_TITLE: string = translationKey(
  "We could not load the Security overview",
);

// How long a source may send nothing before the strip says it has gone quiet.
export const QUIET_SOURCE_AFTER_IN_MS: number = 24 * 60 * 60 * 1000;

/*
 * Sources that sent something once and nothing for a day since: worth a
 * look, since a connection that stopped looks just like a quiet week. A
 * source that never sent anything is not "gone quiet" - nothing arrived yet.
 */
export function isSecuritySourceSilent(
  status: SecuritySetupStatus,
  now: Date,
): boolean {
  return (
    hasSecuritySources(status) &&
    status.eventsLast24Hours === 0 &&
    status.lastEventAt !== null &&
    now.getTime() - status.lastEventAt.getTime() >= QUIET_SOURCE_AFTER_IN_MS
  );
}

/*
 * Where a part not set up is set up. Detections open the Rule Library, where
 * rules are added; the others open their own page, which offers the same.
 */
const SET_UP_PAGES: Record<SecurityPipelineStageKey, PageMap> = {
  [SecurityPipelineStageKey.Sources]: PageMap.SECURITY_EVENTS_CONNECTIONS,
  [SecurityPipelineStageKey.Detections]: PageMap.SECURITY_EVENTS_RULE_LIBRARY,
  [SecurityPipelineStageKey.Cases]: PageMap.SECURITY_CASES,
  [SecurityPipelineStageKey.Playbooks]: PageMap.SECURITY_PLAYBOOKS,
};

const SET_UP_WORDS: Record<SecurityPipelineStageKey, string> = {
  [SecurityPipelineStageKey.Sources]: SET_UP_SOURCES,
  [SecurityPipelineStageKey.Detections]: SET_UP_DETECTIONS,
  [SecurityPipelineStageKey.Cases]: "",
  [SecurityPipelineStageKey.Playbooks]: SET_UP_PLAYBOOKS,
};

interface StageFigures {
  figure: SecurityOverviewText;
  figureTone: SecurityStatusTone;
  status: SecurityOverviewText | null;
  statusIcon: IconProp;
  statusTone: SecurityStatusTone;
}

/*
 * Sources: how many, and whether they still send. A source that sent
 * something today says how much; one that has sent nothing for a day says
 * when it last did, in amber - a connection that stopped is worth a look;
 * one that never sent anything says so, without alarm.
 */
function getSourcesFigures(
  status: SecuritySetupStatus,
  now: Date,
): StageFigures {
  const figure: SecurityOverviewText = {
    plural: SOURCES_FIGURE,
    count: countSecuritySources(status),
  };

  if (status.eventsLast24Hours > 0) {
    return {
      figure,
      figureTone: SecurityStatusTone.Success,
      status: {
        plural: EVENTS_IN_24_HOURS,
        count: status.eventsLast24Hours,
      },
      statusIcon: IconProp.CheckCircle,
      statusTone: SecurityStatusTone.Success,
    };
  }

  if (status.lastEventAt) {
    const isGoneQuiet: boolean = isSecuritySourceSilent(status, now);

    return {
      figure,
      figureTone: SecurityStatusTone.Success,
      status: {
        template: LAST_EVENT,
        // Never "in 2 minutes": a clock ahead of this one reads as now.
        since:
          status.lastEventAt.getTime() > now.getTime()
            ? now
            : status.lastEventAt,
        now,
      },
      statusIcon: isGoneQuiet ? IconProp.SignalSlash : IconProp.Clock,
      statusTone: isGoneQuiet
        ? SecurityStatusTone.Warning
        : SecurityStatusTone.Neutral,
    };
  }

  return {
    figure,
    figureTone: SecurityStatusTone.Success,
    status: { text: NO_EVENTS_YET },
    statusIcon: IconProp.Clock,
    statusTone: SecurityStatusTone.Neutral,
  };
}

/*
 * Detections: the rules that are on, and how many of the recommended ones
 * are among them - all of them reads as fine, fewer as a plain fact.
 */
function getDetectionsFigures(status: SecuritySetupStatus): StageFigures {
  const hasAllRecommended: boolean =
    status.recommendedRules > 0 &&
    status.recommendedRulesOn >= status.recommendedRules;

  return {
    figure: {
      plural: RULES_ON_FIGURE,
      count: status.enabledRules,
    },
    figureTone: SecurityStatusTone.Success,
    status:
      status.recommendedRules > 0
        ? {
            template: RECOMMENDED_ON,
            values: {
              on: Math.min(status.recommendedRulesOn, status.recommendedRules),
              total: status.recommendedRules,
            },
          }
        : null,
    // Fewer than all is a suggestion, not a fault: a bulb, not the stage's own shield.
    statusIcon: hasAllRecommended ? IconProp.CheckCircle : IconProp.LightBulb,
    statusTone: hasAllRecommended
      ? SecurityStatusTone.Success
      : SecurityStatusTone.Neutral,
  };
}

/*
 * Cases: how many are open, and how urgent they are - red with the critical
 * and high ones counted, amber when none of them is, and all clear when
 * none is open.
 */
function getCasesFigures(
  status: SecuritySetupStatus,
  queue: SecurityOverviewQueue,
): StageFigures {
  if (status.openCases === 0) {
    return {
      figure: { text: NONE_OPEN },
      figureTone: SecurityStatusTone.Success,
      status: { text: ALL_CLEAR },
      statusIcon: IconProp.CheckCircle,
      statusTone: SecurityStatusTone.Success,
    };
  }

  const figure: SecurityOverviewText = {
    plural: OPEN_CASES_FIGURE,
    count: status.openCases,
  };

  if (queue.criticalOpenCases + queue.highOpenCases > 0) {
    return {
      figure,
      figureTone: SecurityStatusTone.Danger,
      status: {
        template: URGENT_OPEN_CASES,
        values: {
          critical: queue.criticalOpenCases,
          high: queue.highOpenCases,
        },
      },
      statusIcon: IconProp.Alert,
      statusTone: SecurityStatusTone.Danger,
    };
  }

  return {
    figure,
    figureTone: SecurityStatusTone.Warning,
    status: { text: NONE_URGENT },
    statusIcon: IconProp.ShieldCheck,
    statusTone: SecurityStatusTone.Neutral,
  };
}

/*
 * Playbooks: how many respond, and whether one of their steps is held for
 * an approval.
 */
function getPlaybooksFigures(
  status: SecuritySetupStatus,
  queue: SecurityOverviewQueue,
): StageFigures {
  const figure: SecurityOverviewText = {
    plural: PLAYBOOKS_ON_FIGURE,
    count: status.enabledPlaybooks,
  };

  if (queue.runsWaitingForApproval > 0) {
    return {
      figure,
      figureTone: SecurityStatusTone.Success,
      status: {
        plural: STEPS_TO_APPROVE,
        count: queue.runsWaitingForApproval,
      },
      statusIcon: IconProp.PauseCircle,
      statusTone: SecurityStatusTone.Warning,
    };
  }

  return {
    figure,
    figureTone: SecurityStatusTone.Success,
    status: { text: NOTHING_WAITING },
    statusIcon: IconProp.CheckCircle,
    statusTone: SecurityStatusTone.Success,
  };
}

/*
 * The four cells of the pipeline, left to right in the order Security works:
 * where events come from, what finds threats in them, what needs a person,
 * what responds. A part not set up reads "Not set up" in grey with what to
 * do, and opens where it is done - never an amber card that competes with
 * the band above it.
 */
export function getSecurityStageViews(data: {
  status: SecuritySetupStatus;
  queue: SecurityOverviewQueue;
  now: Date;
}): Array<SecurityStageView> {
  return getSecurityPipelineStages(data.status).map(
    (stage: SecurityPipelineStage): SecurityStageView => {
      const base: Omit<SecurityStageView, keyof StageFigures> = {
        key: stage.key,
        title: stage.title,
        icon: stage.icon,
        page: stage.isReady ? stage.page : SET_UP_PAGES[stage.key],
        isReady: stage.isReady,
      };

      if (!stage.isReady) {
        return {
          ...base,
          figure: { text: NOT_SET_UP_FIGURE },
          figureTone: SecurityStatusTone.Neutral,
          status: { text: SET_UP_WORDS[stage.key] },
          statusIcon: IconProp.Add,
          statusTone: SecurityStatusTone.Neutral,
        };
      }

      return { ...base, ...getStageFigures(stage.key, data) };
    },
  );
}

// The figures of a part that is set up.
function getStageFigures(
  key: SecurityPipelineStageKey,
  data: {
    status: SecuritySetupStatus;
    queue: SecurityOverviewQueue;
    now: Date;
  },
): StageFigures {
  if (key === SecurityPipelineStageKey.Sources) {
    return getSourcesFigures(data.status, data.now);
  }

  if (key === SecurityPipelineStageKey.Detections) {
    return getDetectionsFigures(data.status);
  }

  if (key === SecurityPipelineStageKey.Cases) {
    return getCasesFigures(data.status, data.queue);
  }

  return getPlaybooksFigures(data.status, data.queue);
}

/*
 * ---------------------------------------------------------------------------
 * Words
 * ---------------------------------------------------------------------------
 */

// A sentence of the card, in the reader's language.
export function translateSecurityOverviewText(
  translator: Translator,
  text: SecurityOverviewText,
): string {
  if ("plural" in text) {
    return translator.translatePlural(text.plural, text.count);
  }

  if ("since" in text) {
    return translator.translateTemplate(text.template, {
      time: formatRelativeTime({
        date: text.since,
        now: text.now,
        language: translator.language,
      }),
    });
  }

  if ("values" in text) {
    return translator.translateTemplate(
      text.template,
      formatSecurityOverviewValues(translator, text.values),
    );
  }

  return translator.translateText(text.text) || text.text;
}

/*
 * A template's numbers written the reader's way, as a plural's count is:
 * "1.234" in German, and Persian digits in Persian - never Latin digits in
 * "3 of 20 recommended" beside Persian ones in "8 rules on".
 */
export function formatSecurityOverviewValues(
  translator: Translator,
  values: { [key: string]: string | number },
): { [key: string]: string } {
  const formatted: { [key: string]: string } = {};

  for (const key of Object.keys(values)) {
    const value: string | number = values[key] as string | number;

    formatted[key] =
      typeof value === "number" ? translator.formatNumber(value) : value;
  }

  return formatted;
}
