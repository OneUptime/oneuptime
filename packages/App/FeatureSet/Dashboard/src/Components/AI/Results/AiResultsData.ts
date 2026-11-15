import {
  countsInReaderDigits,
  describeTrendDate,
} from "../ActivityInsights/AiActivityInsightsData";
import {
  AI_OUTCOMES_SCAN_LIMIT,
  AiOutcomes,
  AiOutcomesPages,
  AiOutcomesPullRequestFixes,
  AiOutcomesRemediationFixes,
  AiOutcomesRootCauses,
  AiOutcomesWeek,
  getCheckedFixCount,
  getFixesBeingCheckedCount,
  getHeldPageCount,
  getJudgedRootCauseCount,
  getUncheckableFixCount,
  getVerifiedFixCount,
} from "Common/Types/AI/AiOutcomes";
import { JSONObject } from "Common/Types/JSON";
import {
  getGlobalTranslator,
  PluralTemplate,
  TemplateValues,
  translatePlural as translatePluralAsGiven,
  translateTemplate as translateTemplateAsGiven,
  translationKey,
  Translator,
} from "Common/UI/Utils/TranslateTemplate";

/*
 * THE AI RESULTS PAGE'S WORDS AND NUMBERS (Settings → AI → AI Results,
 * issue #6800): what OneUptime AI's work came to over the last 12 weeks, in
 * three cards, each one question a team asks of it.
 *
 *   1. Pages Avoided - did it keep people from being woken? Of the pages an
 *      incident or alert rule held while OneUptime AI worked, how many ended
 *      with its fix, before anyone was paged; how the others ended.
 *   2. Fixes Verified - did its fixes work? Of the fixes it ran and the fix
 *      pull requests it opened whose check finished, how many worked.
 *   3. Root Causes Confirmed - was it right? Of the investigations that were
 *      judged, by a responder on the AI card or against the root cause
 *      written when the incident was resolved, how many found it.
 *
 * Each card says its number out of what it counts ("12 of 40"), never a
 * bare count; shows the 12 weeks one bar a week, so a team sees whether it
 * is getting better; and breaks the number down. A card with nothing to
 * count yet says, in words, how it starts. A part the reader may not read
 * (Types/AI/AiOutcomes: null) is no card at all.
 *
 * Import-clean (Common types and the translation helpers only), so the
 * suites read it without a browser.
 */

export const AI_RESULTS_EMPTY_STATE_ID: string = "ai-results-empty";

export const AI_RESULTS_EMPTY_TITLE: string =
  translationKey("No AI results yet");

export const AI_RESULTS_EMPTY_DESCRIPTION: string = translationKey(
  "When OneUptime AI holds a page, runs a fix or finishes an investigation, what came of it shows up here, week by week.",
);

// Every part is one the reader may not read.
export const AI_RESULTS_NOT_READABLE_TITLE: string = translationKey(
  "No AI results you can see",
);

export const AI_RESULTS_NOT_READABLE_DESCRIPTION: string = translationKey(
  "These results count incidents, alerts, on-call pages and fixes, and your role cannot read any of them. A project admin can give you access.",
);

export const AI_RESULTS_LOAD_ERROR: string = translationKey(
  "Could not load AI results.",
);

export const AI_RESULTS_UNREADABLE_RESPONSE: string = translationKey(
  "The server returned AI results this page cannot read.",
);

// The weeks a card's line under its bars sums, and the weeks before them.
export const AI_RESULTS_RECENT_WEEK_COUNT: number = 4;

/*
 * EVERY COUNT IN THE READER'S DIGITS (AiActivityInsightsData's rule): each
 * sentence of the page is filled through these two, so every number among
 * its values is written as the reader's language writes numbers.
 */
function translateTemplate(template: string, values?: TemplateValues): string {
  return translateTemplateAsGiven(template, countsInReaderDigits(values));
}

function translatePlural(
  template: PluralTemplate,
  count: number,
  values?: TemplateValues,
): string {
  return translatePluralAsGiven(template, count, countsInReaderDigits(values));
}

function formatCount(
  value: number,
  translator: Translator = getGlobalTranslator(),
): string {
  return translator.formatNumber(value);
}

/*
 * ---------------------------------------------------------------------------
 * Reading the server's answer.
 * ---------------------------------------------------------------------------
 */

const PAGE_KEYS: ReadonlyArray<keyof AiOutcomesPages> = [
  "resolvedByAi",
  "recoveredOnItsOwn",
  "handledByPerson",
  "handedOff",
  "holdTimeRanOut",
  "pageNowPressed",
  "holding",
];

const REMEDIATION_FIX_KEYS: ReadonlyArray<keyof AiOutcomesRemediationFixes> = [
  "verified",
  "failed",
  "pending",
  "skipped",
];

const PULL_REQUEST_FIX_KEYS: ReadonlyArray<keyof AiOutcomesPullRequestFixes> = [
  "verified",
  "regressed",
  "watching",
  "awaitingDeploy",
  "unverifiable",
];

const ROOT_CAUSE_KEYS: ReadonlyArray<keyof AiOutcomesRootCauses> = [
  "confirmed",
  "partial",
  "wrong",
  "judgedByPeople",
  "completed",
];

const WEEK_COUNT_KEYS: ReadonlyArray<keyof Omit<AiOutcomesWeek, "weekStart">> =
  [
    "pagesAvoided",
    "pagesHeld",
    "fixesVerified",
    "fixesChecked",
    "rootCausesConfirmed",
    "rootCausesJudged",
  ];

// A week's first day as the server writes it: YYYY-MM-DD.
const WEEK_START_REGEX: RegExp = /^\d{4}-\d{2}-\d{2}$/;

// The most weeks a page draws: a year's.
const MOST_WEEKS: number = 53;

function isObject(value: unknown): value is JSONObject {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isCount(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

function isDateText(value: unknown): value is string {
  return typeof value === "string" && !Number.isNaN(new Date(value).getTime());
}

/*
 * One part's counts; null for a part the reader may not read (sent as null,
 * or not sent at all); undefined for one this page cannot read.
 */
function parseCounts<T>(
  value: unknown,
  keys: ReadonlyArray<string>,
): T | null | undefined {
  if (value === null || value === undefined) {
    return null;
  }

  if (!isObject(value)) {
    return undefined;
  }

  const counts: Record<string, number> = {};

  for (const key of keys) {
    const count: unknown = value[key];

    if (!isCount(count)) {
      return undefined;
    }

    counts[key] = count;
  }

  return counts as unknown as T;
}

function parseWeek(value: unknown): AiOutcomesWeek | null {
  if (!isObject(value)) {
    return null;
  }

  const weekStart: unknown = value["weekStart"];

  if (typeof weekStart !== "string" || !WEEK_START_REGEX.test(weekStart)) {
    return null;
  }

  const counts: Omit<AiOutcomesWeek, "weekStart"> | null | undefined =
    parseCounts<Omit<AiOutcomesWeek, "weekStart">>(value, WEEK_COUNT_KEYS);

  return counts ? { weekStart, ...counts } : null;
}

// The server's AiOutcomes, or null when it is not something this page can draw.
export function parseAiOutcomes(data: unknown): AiOutcomes | null {
  if (!isObject(data)) {
    return null;
  }

  if (!isDateText(data["windowStart"]) || !isDateText(data["windowEnd"])) {
    return null;
  }

  const pages: AiOutcomesPages | null | undefined =
    parseCounts<AiOutcomesPages>(data["pages"], PAGE_KEYS);
  const remediationFixes: AiOutcomesRemediationFixes | null | undefined =
    parseCounts<AiOutcomesRemediationFixes>(
      data["remediationFixes"],
      REMEDIATION_FIX_KEYS,
    );
  const pullRequestFixes: AiOutcomesPullRequestFixes | null | undefined =
    parseCounts<AiOutcomesPullRequestFixes>(
      data["pullRequestFixes"],
      PULL_REQUEST_FIX_KEYS,
    );
  const rootCauses: AiOutcomesRootCauses | null | undefined =
    parseCounts<AiOutcomesRootCauses>(data["rootCauses"], ROOT_CAUSE_KEYS);

  if (
    pages === undefined ||
    remediationFixes === undefined ||
    pullRequestFixes === undefined ||
    rootCauses === undefined
  ) {
    return null;
  }

  const weeksValue: unknown = data["weeks"];

  if (
    !Array.isArray(weeksValue) ||
    weeksValue.length === 0 ||
    weeksValue.length > MOST_WEEKS
  ) {
    return null;
  }

  const weeks: Array<AiOutcomesWeek> = [];

  for (const weekValue of weeksValue) {
    const week: AiOutcomesWeek | null = parseWeek(weekValue);

    if (!week) {
      return null;
    }

    weeks.push(week);
  }

  return {
    windowStart: data["windowStart"] as string,
    windowEnd: data["windowEnd"] as string,
    pages,
    remediationFixes,
    pullRequestFixes,
    rootCauses,
    weeks,
    isPartial: data["isPartial"] === true,
  };
}

// Whether the reader may read any part at all.
export function canReadAnyAiResults(outcomes: AiOutcomes): boolean {
  return Boolean(
    outcomes.pages ||
      outcomes.remediationFixes ||
      outcomes.pullRequestFixes ||
      outcomes.rootCauses,
  );
}

/*
 * Whether there is anything to show: a page held (finished or not), a fix
 * run or opened, an investigation finished.
 */
export function hasAiResults(outcomes: AiOutcomes): boolean {
  const pagesHeld: number = outcomes.pages
    ? getHeldPageCount(outcomes.pages) + outcomes.pages.holding
    : 0;

  const fixes: number =
    sumOf(outcomes.remediationFixes, REMEDIATION_FIX_KEYS) +
    sumOf(outcomes.pullRequestFixes, PULL_REQUEST_FIX_KEYS);

  const investigations: number = outcomes.rootCauses
    ? outcomes.rootCauses.completed
    : 0;

  return pagesHeld + fixes + investigations > 0;
}

function sumOf<T>(counts: T | null, keys: ReadonlyArray<keyof T>): number {
  if (!counts) {
    return 0;
  }

  return keys.reduce((sum: number, key: keyof T): number => {
    return sum + (counts[key] as unknown as number);
  }, 0);
}

/*
 * ---------------------------------------------------------------------------
 * The cards.
 * ---------------------------------------------------------------------------
 */

export enum AiResultsCardKind {
  PagesAvoided = "pages-avoided",
  FixesVerified = "fixes-verified",
  RootCausesConfirmed = "root-causes-confirmed",
}

// One piece of a card's bar: an outcome and how many ended so.
export interface AiResultsSegment {
  // A translation key, translated where it is drawn.
  label: string;
  value: number;
  // A Tailwind background class, as StackedProgressBar takes it.
  color: string;
}

export interface AiResultsBreakdown {
  // Over the bar, for a card with more than one (a translation key).
  title?: string | undefined;
  segments: Array<AiResultsSegment>;
}

// A count beside the bar: "Still held", "Judged by a responder".
export interface AiResultsFact {
  // A translation key, translated where it is drawn.
  label: string;
  value: number;
}

export interface AiResultsWeekBar {
  weekStart: string;
  // What went well that week, and what it is out of.
  value: number;
  total: number;
  // The bar's hover and screen-reader words, translated.
  description: string;
}

/*
 * What a week's bar is made of, named under the bars: its green part, and
 * the whole bar. Translation keys, translated where they are drawn.
 */
export interface AiResultsWeekLegend {
  value: string;
  total: string;
}

export interface AiResultsCard {
  kind: AiResultsCardKind;
  // Translation keys, translated where they are drawn.
  title: string;
  description: string;
  // The card's number, and what it is out of.
  value: number;
  total: number;
  /*
   * The card's number in a sentence, {{value}} drawn large where the
   * reader's language puts it and {{count}} the total (TranslatedSentence).
   */
  headline: PluralTemplate;
  // With nothing to count yet (total 0): how it starts, translated.
  startNotes: Array<string>;
  breakdowns: Array<AiResultsBreakdown>;
  facts: Array<AiResultsFact>;
  weeks: Array<AiResultsWeekBar>;
  weekLegend: AiResultsWeekLegend;
  // The line under the bars: the last weeks against the weeks before, translated.
  recentWeeks: string;
}

/*
 * Colours of an outcome, the same on every card: green for what OneUptime
 * AI got right, red for what it got wrong, amber for half of it, blue for
 * what is still being checked, grey for what nothing could check.
 *
 * The quiet parts - a fix waiting for a deploy, a page that recovered on
 * its own - are a mid-tone at half strength: pale on a light card and dim
 * on a dark one, so in both themes they stay behind the parts that matter.
 * A light tint (sky-200) would be the brightest part of a dark card.
 */
const COLOR_WORKED: string = "bg-emerald-500";
const COLOR_DID_NOT_WORK: string = "bg-rose-500";
const COLOR_IN_BETWEEN: string = "bg-amber-400";
const COLOR_CHECKING: string = "bg-sky-400";
const COLOR_WAITING: string = "bg-sky-500/50";
const COLOR_NOT_CHECKED: string = "bg-gray-300";

/*
 * A held page that ended without OneUptime AI's fix: nobody was paged
 * (teal, indigo), or people were (amber to red, the later the warmer).
 */
const COLOR_RECOVERED: string = "bg-teal-500/50";
const COLOR_HANDLED_BY_PERSON: string = "bg-indigo-400";
const COLOR_HANDED_OFF: string = "bg-amber-400";
const COLOR_HOLD_TIME_RAN_OUT: string = "bg-orange-500";
const COLOR_PAGE_NOW_PRESSED: string = "bg-rose-500";

// Pages Avoided --------------------------------------------------------------

export const PAGES_AVOIDED_TITLE: string = translationKey("Pages Avoided");

export const PAGES_AVOIDED_DESCRIPTION: string = translationKey(
  "Pages held while OneUptime AI worked on the incident or alert, over the last 12 weeks, and how each one ended.",
);

/*
 * The headlines are plain literals, which the extractor reads as one
 * count-dependent sentence; translationKey() on each form would also make
 * the "one" form a key of its own.
 */
export const PAGES_AVOIDED_HEADLINE: PluralTemplate = {
  one: "{{value}} of {{count}} held page ended with OneUptime AI's fix, before anyone was paged.",
  other:
    "{{value}} of {{count}} held pages ended with OneUptime AI's fix, before anyone was paged.",
};

export const PAGE_OUTCOME_LABELS: Record<
  Exclude<keyof AiOutcomesPages, "holding">,
  string
> = {
  resolvedByAi: translationKey("Resolved by OneUptime AI"),
  recoveredOnItsOwn: translationKey("Recovered on its own"),
  handledByPerson: translationKey("Handled by a person while held"),
  handedOff: translationKey("Paged: OneUptime AI handed it off"),
  holdTimeRanOut: translationKey("Paged: the hold time ran out"),
  pageNowPressed: translationKey("Paged: someone pressed Page now"),
};

export const STILL_HELD_LABEL: string = translationKey("Still held");

export const PAGES_WEEK_LEGEND: AiResultsWeekLegend = {
  value: PAGE_OUTCOME_LABELS.resolvedByAi,
  total: translationKey("All held pages"),
};

function getPagesCard(
  pages: AiOutcomesPages,
  weeks: Array<AiOutcomesWeek>,
): AiResultsCard {
  const total: number = getHeldPageCount(pages);
  const startNotes: Array<string> = [];

  if (total === 0) {
    if (pages.holding > 0) {
      startNotes.push(
        translatePlural(
          {
            one: "{{count}} page is held right now while OneUptime AI works on it. How it ends will show up here.",
            other:
              "{{count}} pages are held right now while OneUptime AI works on them. How they end will show up here.",
          },
          pages.holding,
        ),
      );
    } else {
      startNotes.push(
        translateTemplate(
          "No held pages yet. When an incident or alert rule waits for OneUptime AI before it pages, how each held page ends shows up here.",
        ),
      );
    }
  }

  return {
    kind: AiResultsCardKind.PagesAvoided,
    title: PAGES_AVOIDED_TITLE,
    description: PAGES_AVOIDED_DESCRIPTION,
    value: pages.resolvedByAi,
    total,
    headline: PAGES_AVOIDED_HEADLINE,
    startNotes,
    breakdowns:
      total > 0
        ? [
            {
              segments: [
                {
                  label: PAGE_OUTCOME_LABELS.resolvedByAi,
                  value: pages.resolvedByAi,
                  color: COLOR_WORKED,
                },
                {
                  label: PAGE_OUTCOME_LABELS.recoveredOnItsOwn,
                  value: pages.recoveredOnItsOwn,
                  color: COLOR_RECOVERED,
                },
                {
                  label: PAGE_OUTCOME_LABELS.handledByPerson,
                  value: pages.handledByPerson,
                  color: COLOR_HANDLED_BY_PERSON,
                },
                {
                  label: PAGE_OUTCOME_LABELS.handedOff,
                  value: pages.handedOff,
                  color: COLOR_HANDED_OFF,
                },
                {
                  label: PAGE_OUTCOME_LABELS.holdTimeRanOut,
                  value: pages.holdTimeRanOut,
                  color: COLOR_HOLD_TIME_RAN_OUT,
                },
                {
                  label: PAGE_OUTCOME_LABELS.pageNowPressed,
                  value: pages.pageNowPressed,
                  color: COLOR_PAGE_NOW_PRESSED,
                },
              ],
            },
          ]
        : [],
    facts:
      total > 0 && pages.holding > 0
        ? [{ label: STILL_HELD_LABEL, value: pages.holding }]
        : [],
    weekLegend: PAGES_WEEK_LEGEND,
    weeks: weeks.map((week: AiOutcomesWeek): AiResultsWeekBar => {
      return {
        weekStart: week.weekStart,
        value: week.pagesAvoided,
        total: week.pagesHeld,
        description:
          week.pagesHeld > 0
            ? translatePlural(
                {
                  one: "Week of {{date}}: {{value}} of {{count}} held page ended with OneUptime AI's fix",
                  other:
                    "Week of {{date}}: {{value}} of {{count}} held pages ended with OneUptime AI's fix",
                },
                week.pagesHeld,
                {
                  date: describeTrendDate(week.weekStart),
                  value: formatCount(week.pagesAvoided),
                },
              )
            : translateTemplate("Week of {{date}}: no held pages", {
                date: describeTrendDate(week.weekStart),
              }),
      };
    }),
    recentWeeks: describeRecentWeeks(weeks, (week: AiOutcomesWeek) => {
      return { value: week.pagesAvoided, total: week.pagesHeld };
    }),
  };
}

// Fixes Verified -------------------------------------------------------------

export const FIXES_VERIFIED_TITLE: string = translationKey("Fixes Verified");

export const FIXES_VERIFIED_DESCRIPTION: string = translationKey(
  "Fixes OneUptime AI ran and fix pull requests it opened over the last 12 weeks, checked against what happened next.",
);

export const FIXES_VERIFIED_HEADLINE: PluralTemplate = {
  one: "{{value}} of {{count}} checked fix worked.",
  other: "{{value}} of {{count}} checked fixes worked.",
};

export const REMEDIATION_FIXES_TITLE: string = translationKey(
  "Fixes OneUptime AI ran",
);

export const PULL_REQUEST_FIXES_TITLE: string =
  translationKey("Fix pull requests");

// The words the fixes' own pages use (IncidentAlertAiLogs, ExceptionAIAssistance).
export const REMEDIATION_FIX_LABELS: Record<
  keyof AiOutcomesRemediationFixes,
  string
> = {
  verified: translationKey("It worked: the problem cleared"),
  failed: translationKey("It did not fix the problem"),
  pending: translationKey("Checking whether it worked"),
  skipped: translationKey("Not verified: nothing to check it against"),
};

export const PULL_REQUEST_FIX_LABELS: Record<
  keyof AiOutcomesPullRequestFixes,
  string
> = {
  verified: translationKey("Fixed in production"),
  regressed: translationKey("Still happening after the fix"),
  watching: translationKey("Deployed, watching in production"),
  awaitingDeploy: translationKey("Merged, waiting for a deploy"),
  unverifiable: translationKey("Not verified in production"),
};

export const FIXES_WEEK_LEGEND: AiResultsWeekLegend = {
  value: translationKey("Fixes that worked"),
  total: translationKey("All checked fixes"),
};

function getFixesCard(
  outcomes: AiOutcomes,
  weeks: Array<AiOutcomesWeek>,
): AiResultsCard {
  const total: number = getCheckedFixCount(outcomes);
  const beingChecked: number = getFixesBeingCheckedCount(outcomes);
  const uncheckable: number = getUncheckableFixCount(outcomes);
  const startNotes: Array<string> = [];

  /*
   * With none checked: the fixes still being checked, and the ones nothing
   * could check, each said; "No checked fixes yet" only when there were no
   * fixes at all.
   */
  if (total === 0) {
    if (beingChecked > 0) {
      startNotes.push(
        translatePlural(
          {
            one: "{{count}} fix is still being checked. Whether it worked will show up here.",
            other:
              "{{count}} fixes are still being checked. Whether they worked will show up here.",
          },
          beingChecked,
        ),
      );
    }

    if (uncheckable > 0) {
      startNotes.push(
        translatePlural(
          {
            one: "{{count}} fix could not be checked: there was nothing to check it against.",
            other:
              "{{count}} fixes could not be checked: there was nothing to check them against.",
          },
          uncheckable,
        ),
      );
    }

    if (startNotes.length === 0) {
      startNotes.push(
        translateTemplate(
          "No checked fixes yet. When OneUptime AI runs a fix, or a fix pull request it opened reaches production, whether it worked shows up here.",
        ),
      );
    }
  }

  const breakdowns: Array<AiResultsBreakdown> = [];
  const remediation: AiOutcomesRemediationFixes | null =
    outcomes.remediationFixes;
  const pullRequests: AiOutcomesPullRequestFixes | null =
    outcomes.pullRequestFixes;

  // Both kinds titled once there are both; one kind is the card's own.
  const hasRemediation: boolean = sumOf(remediation, REMEDIATION_FIX_KEYS) > 0;
  const hasPullRequests: boolean =
    sumOf(pullRequests, PULL_REQUEST_FIX_KEYS) > 0;
  const titled: boolean = hasRemediation && hasPullRequests;

  if (remediation && hasRemediation) {
    breakdowns.push({
      title: titled ? REMEDIATION_FIXES_TITLE : undefined,
      segments: [
        {
          label: REMEDIATION_FIX_LABELS.verified,
          value: remediation.verified,
          color: COLOR_WORKED,
        },
        {
          label: REMEDIATION_FIX_LABELS.failed,
          value: remediation.failed,
          color: COLOR_DID_NOT_WORK,
        },
        {
          label: REMEDIATION_FIX_LABELS.pending,
          value: remediation.pending,
          color: COLOR_CHECKING,
        },
        {
          label: REMEDIATION_FIX_LABELS.skipped,
          value: remediation.skipped,
          color: COLOR_NOT_CHECKED,
        },
      ],
    });
  }

  if (pullRequests && hasPullRequests) {
    breakdowns.push({
      title: titled ? PULL_REQUEST_FIXES_TITLE : undefined,
      segments: [
        {
          label: PULL_REQUEST_FIX_LABELS.verified,
          value: pullRequests.verified,
          color: COLOR_WORKED,
        },
        {
          label: PULL_REQUEST_FIX_LABELS.regressed,
          value: pullRequests.regressed,
          color: COLOR_DID_NOT_WORK,
        },
        {
          label: PULL_REQUEST_FIX_LABELS.watching,
          value: pullRequests.watching,
          color: COLOR_CHECKING,
        },
        {
          label: PULL_REQUEST_FIX_LABELS.awaitingDeploy,
          value: pullRequests.awaitingDeploy,
          color: COLOR_WAITING,
        },
        {
          label: PULL_REQUEST_FIX_LABELS.unverifiable,
          value: pullRequests.unverifiable,
          color: COLOR_NOT_CHECKED,
        },
      ],
    });
  }

  return {
    kind: AiResultsCardKind.FixesVerified,
    title: FIXES_VERIFIED_TITLE,
    description: FIXES_VERIFIED_DESCRIPTION,
    value: getVerifiedFixCount(outcomes),
    total,
    headline: FIXES_VERIFIED_HEADLINE,
    startNotes,
    // With nothing checked, the start notes say it all.
    breakdowns: total > 0 ? breakdowns : [],
    facts: [],
    weekLegend: FIXES_WEEK_LEGEND,
    weeks: weeks.map((week: AiOutcomesWeek): AiResultsWeekBar => {
      return {
        weekStart: week.weekStart,
        value: week.fixesVerified,
        total: week.fixesChecked,
        description:
          week.fixesChecked > 0
            ? translatePlural(
                {
                  one: "Week of {{date}}: {{value}} of {{count}} checked fix worked",
                  other:
                    "Week of {{date}}: {{value}} of {{count}} checked fixes worked",
                },
                week.fixesChecked,
                {
                  date: describeTrendDate(week.weekStart),
                  value: formatCount(week.fixesVerified),
                },
              )
            : translateTemplate("Week of {{date}}: no checked fixes", {
                date: describeTrendDate(week.weekStart),
              }),
      };
    }),
    recentWeeks: describeRecentWeeks(weeks, (week: AiOutcomesWeek) => {
      return { value: week.fixesVerified, total: week.fixesChecked };
    }),
  };
}

// Root Causes Confirmed ------------------------------------------------------

export const ROOT_CAUSES_CONFIRMED_TITLE: string = translationKey(
  "Root Causes Confirmed",
);

export const ROOT_CAUSES_CONFIRMED_DESCRIPTION: string = translationKey(
  "Investigations OneUptime AI finished over the last 12 weeks, judged by a responder or against the root cause written when the incident was resolved.",
);

export const ROOT_CAUSES_CONFIRMED_HEADLINE: PluralTemplate = {
  one: "{{value}} of {{count}} judged investigation found the right root cause.",
  other:
    "{{value}} of {{count}} judged investigations found the right root cause.",
};

export const ROOT_CAUSE_LABELS: Record<
  "confirmed" | "partial" | "wrong",
  string
> = {
  confirmed: translationKey("Found the root cause"),
  partial: translationKey("Partly right"),
  wrong: translationKey("Missed the root cause"),
};

/*
 * Beside the bar: how the card's investigations came to be judged, and the
 * finished ones not judged yet - together, every investigation it finished.
 */
export const ROOT_CAUSE_FACT_LABELS: Record<
  "judgedByPeople" | "graded" | "notJudged",
  string
> = {
  judgedByPeople: translationKey("Judged by a responder"),
  graded: translationKey("Graded against the incident's root cause"),
  notJudged: translationKey("Not judged yet"),
};

export const ROOT_CAUSES_WEEK_LEGEND: AiResultsWeekLegend = {
  value: ROOT_CAUSE_LABELS.confirmed,
  total: translationKey("All judged investigations"),
};

// How an investigation comes to be judged, for a card with none judged yet.
export const ROOT_CAUSES_HOW_JUDGED: string = translationKey(
  "An investigation is judged when a responder confirms or rejects it on its AI card, or when someone writes the root cause as they resolve its incident.",
);

function getRootCausesCard(
  rootCauses: AiOutcomesRootCauses,
  weeks: Array<AiOutcomesWeek>,
): AiResultsCard {
  const total: number = getJudgedRootCauseCount(rootCauses);
  const startNotes: Array<string> = [];

  if (total === 0) {
    startNotes.push(
      rootCauses.completed > 0
        ? translatePlural(
            {
              one: "OneUptime AI finished {{count}} investigation, and it has not been judged yet.",
              other:
                "OneUptime AI finished {{count}} investigations, and none has been judged yet.",
            },
            rootCauses.completed,
          )
        : translateTemplate("No judged investigations yet."),
      translateTemplate(ROOT_CAUSES_HOW_JUDGED),
    );
  }

  return {
    kind: AiResultsCardKind.RootCausesConfirmed,
    title: ROOT_CAUSES_CONFIRMED_TITLE,
    description: ROOT_CAUSES_CONFIRMED_DESCRIPTION,
    value: rootCauses.confirmed,
    total,
    headline: ROOT_CAUSES_CONFIRMED_HEADLINE,
    startNotes,
    breakdowns:
      total > 0
        ? [
            {
              segments: [
                {
                  label: ROOT_CAUSE_LABELS.confirmed,
                  value: rootCauses.confirmed,
                  color: COLOR_WORKED,
                },
                {
                  label: ROOT_CAUSE_LABELS.partial,
                  value: rootCauses.partial,
                  color: COLOR_IN_BETWEEN,
                },
                {
                  label: ROOT_CAUSE_LABELS.wrong,
                  value: rootCauses.wrong,
                  color: COLOR_DID_NOT_WORK,
                },
              ],
            },
          ]
        : [],
    facts:
      total > 0
        ? [
            {
              label: ROOT_CAUSE_FACT_LABELS.judgedByPeople,
              value: rootCauses.judgedByPeople,
            },
            {
              label: ROOT_CAUSE_FACT_LABELS.graded,
              value: Math.max(0, total - rootCauses.judgedByPeople),
            },
            {
              label: ROOT_CAUSE_FACT_LABELS.notJudged,
              value: Math.max(0, rootCauses.completed - total),
            },
          ]
        : [],
    weekLegend: ROOT_CAUSES_WEEK_LEGEND,
    weeks: weeks.map((week: AiOutcomesWeek): AiResultsWeekBar => {
      return {
        weekStart: week.weekStart,
        value: week.rootCausesConfirmed,
        total: week.rootCausesJudged,
        description:
          week.rootCausesJudged > 0
            ? translatePlural(
                {
                  one: "Week of {{date}}: {{value}} of {{count}} judged investigation found the right root cause",
                  other:
                    "Week of {{date}}: {{value}} of {{count}} judged investigations found the right root cause",
                },
                week.rootCausesJudged,
                {
                  date: describeTrendDate(week.weekStart),
                  value: formatCount(week.rootCausesConfirmed),
                },
              )
            : translateTemplate("Week of {{date}}: no judged investigations", {
                date: describeTrendDate(week.weekStart),
              }),
      };
    }),
    recentWeeks: describeRecentWeeks(weeks, (week: AiOutcomesWeek) => {
      return { value: week.rootCausesConfirmed, total: week.rootCausesJudged };
    }),
  };
}

/*
 * The line under a card's bars: its last AI_RESULTS_RECENT_WEEK_COUNT
 * weeks against the ones before, each "N of M" - whether it is getting
 * better, in the card's own terms.
 */
export function describeRecentWeeks(
  weeks: Array<AiOutcomesWeek>,
  pick: (week: AiOutcomesWeek) => { value: number; total: number },
): string {
  const sum: (from: number, to: number) => { value: number; total: number } = (
    from: number,
    to: number,
  ): { value: number; total: number } => {
    return weeks.slice(Math.max(0, from), Math.max(0, to)).reduce(
      (
        sums: { value: number; total: number },
        week: AiOutcomesWeek,
      ): { value: number; total: number } => {
        const picked: { value: number; total: number } = pick(week);
        return {
          value: sums.value + picked.value,
          total: sums.total + picked.total,
        };
      },
      { value: 0, total: 0 },
    );
  };

  const recent: { value: number; total: number } = sum(
    weeks.length - AI_RESULTS_RECENT_WEEK_COUNT,
    weeks.length,
  );
  const before: { value: number; total: number } = sum(
    weeks.length - 2 * AI_RESULTS_RECENT_WEEK_COUNT,
    weeks.length - AI_RESULTS_RECENT_WEEK_COUNT,
  );

  const recentText: string =
    recent.total > 0
      ? translateTemplate("Last {{weeks}} weeks: {{value}} of {{total}}.", {
          weeks: AI_RESULTS_RECENT_WEEK_COUNT,
          value: formatCount(recent.value),
          total: formatCount(recent.total),
        })
      : translateTemplate("Last {{weeks}} weeks: none yet.", {
          weeks: AI_RESULTS_RECENT_WEEK_COUNT,
        });

  const beforeText: string =
    before.total > 0
      ? translateTemplate(
          "The {{weeks}} weeks before: {{value}} of {{total}}.",
          {
            weeks: AI_RESULTS_RECENT_WEEK_COUNT,
            value: formatCount(before.value),
            total: formatCount(before.total),
          },
        )
      : translateTemplate("The {{weeks}} weeks before: none.", {
          weeks: AI_RESULTS_RECENT_WEEK_COUNT,
        });

  return `${recentText} ${beforeText}`;
}

// The cards the reader may read, in the page's order.
export function getAiResultsCards(outcomes: AiOutcomes): Array<AiResultsCard> {
  const cards: Array<AiResultsCard> = [];

  if (outcomes.pages) {
    cards.push(getPagesCard(outcomes.pages, outcomes.weeks));
  }

  if (outcomes.remediationFixes || outcomes.pullRequestFixes) {
    cards.push(getFixesCard(outcomes, outcomes.weeks));
  }

  if (outcomes.rootCauses) {
    cards.push(getRootCausesCard(outcomes.rootCauses, outcomes.weeks));
  }

  return cards;
}

// The line under the cards: the 12 weeks they count, in the reader's calendar.
export function describeAiResultsWindow(outcomes: AiOutcomes): string {
  const first: AiOutcomesWeek | undefined = outcomes.weeks[0];

  return translateTemplate(
    "Counted from {{start}} to today. Each week counts the work OneUptime AI started that week, however long its check took.",
    {
      start: first
        ? describeTrendDate(first.weekStart)
        : describeTrendDate(outcomes.windowStart.substring(0, 10)),
    },
  );
}

// Over the cards when a kind reached the server's limit.
export function describeAiResultsPartial(): string {
  return translateTemplate(
    "There was more than this page counts: each number counts the newest {{limit}} of its kind.",
    { limit: formatCount(AI_OUTCOMES_SCAN_LIMIT) },
  );
}
