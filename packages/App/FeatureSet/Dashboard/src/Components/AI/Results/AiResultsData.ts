import {
  countsInReaderDigits,
  describeTrendDate,
} from "../ActivityInsights/AiActivityInsightsData";
import {
  AI_OUTCOMES_SCAN_LIMIT,
  AI_OUTCOMES_UNKNOWN_MODEL,
  AiOutcomes,
  AiOutcomesDataSecurity,
  AiOutcomesDataSecurityChanges,
  AiOutcomesDataSecurityKind,
  AiOutcomesDataSecurityProposals,
  AiOutcomesIssueVerdicts,
  AiOutcomesModelChange,
  AiOutcomesModelResult,
  AiOutcomesModels,
  AiOutcomesPages,
  AiOutcomesPart,
  AiOutcomesPullRequestFixes,
  AiOutcomesPullRequestFixKind,
  AiOutcomesRemediationFixes,
  AiOutcomesRootCauses,
  AiOutcomesWeek,
  getCheckedFixCount,
  getDataSecurityChangesMadeCount,
  getDataSecurityProposalsDecidedCount,
  getFixesBeingCheckedCount,
  getHeldPageCount,
  getJudgedRootCauseCount,
  getUncheckableFixCount,
  getVerifiedFixCount,
} from "Common/Types/AI/AiOutcomes";
import {
  DataSecurityAiProposalKind,
  isDataSecurityAiProposalKind,
} from "Common/Types/DataSecurity/DataSecurityAi";
import FixProductionCheck, {
  FixProductionCheckHelper,
} from "Common/Types/AI/FixProductionCheck";
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
 * four cards, each one question a team asks of it.
 *
 *   1. Pages Avoided - did it keep people from being woken? Of the pages an
 *      incident or alert rule held while OneUptime AI worked, how many ended
 *      with its fix, before anyone was paged; how the others ended.
 *   2. Fixes Verified - did its fixes work? Of the fixes it ran and the fix
 *      pull requests it opened whose check finished, how many worked.
 *   3. Root Causes Confirmed - was it right? Of the investigations that were
 *      judged, by a responder on the AI card or against the root cause
 *      written when the incident or alert was resolved, how many found it.
 *   4. Data Security - did its changes for Data Security issues work (#10364)?
 *      Of the changes it made, how many the issue's own check proved; what
 *      came of the others, what your team did with its proposals, how many
 *      issues it analyzed, and how long an issue took to pass its check.
 *
 * Each card says its number out of what it counts ("12 of 40"), never a
 * bare count; shows the 12 weeks one bar a week, so a team sees whether it
 * is getting better; and breaks the number down. A card with nothing to
 * count yet says, in words, how it starts. A part the reader may not read
 * (Types/AI/AiOutcomes: null) is no card at all.
 *
 * Each part of a breakdown opens the records it counts (#7768:
 * AiResultsRecordsData). Root Causes Confirmed and Fixes Verified also say
 * how each model OneUptime AI ran on did, once more than one did, and the
 * weeks mark where its investigations moved to another model (#7762).
 *
 * Import-clean (Common types and the translation helpers only), so the
 * suites read it without a browser.
 */

export const AI_RESULTS_EMPTY_STATE_ID: string = "ai-results-empty";

export const AI_RESULTS_EMPTY_TITLE: string =
  translationKey("No AI results yet");

export const AI_RESULTS_EMPTY_DESCRIPTION: string = translationKey(
  "When OneUptime AI holds a page, runs a fix, finishes an investigation or works on a Data Security issue, what came of it shows up here, week by week.",
);

// Every part is one the reader may not read.
export const AI_RESULTS_NOT_READABLE_TITLE: string = translationKey(
  "No AI results you can see",
);

export const AI_RESULTS_NOT_READABLE_DESCRIPTION: string = translationKey(
  "Your role cannot read the incidents, alerts, on-call pages, fixes or Data Security issues these results count. A Project Admin can give you access.",
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

const DATA_SECURITY_CHANGE_KEYS: ReadonlyArray<
  keyof AiOutcomesDataSecurityChanges
> = ["proven", "waiting", "undone", "failed"];

const DATA_SECURITY_PROPOSAL_KEYS: ReadonlyArray<
  keyof AiOutcomesDataSecurityProposals
> = ["approved", "dismissed"];

const WEEK_COUNT_KEYS: ReadonlyArray<keyof Omit<AiOutcomesWeek, "weekStart">> =
  [
    "pagesAvoided",
    "pagesHeld",
    "fixesVerified",
    "fixesChecked",
    "rootCausesConfirmed",
    "rootCausesJudged",
    "dataSecurityChangesProven",
    "dataSecurityChangesMade",
  ];

// OneUptime AI's verdicts on Data Security issues (#10369).
const ISSUE_VERDICT_KEYS: ReadonlyArray<keyof AiOutcomesIssueVerdicts> = [
  "agreed",
  "disagreed",
  "waiting",
  "cannotTell",
  "real",
  "likelyByDesign",
  "likelyWrongFinding",
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
  // A server of the release before counts no verdicts (#10369).
  const verdictsAgreed: unknown = value["verdictsAgreed"];
  const verdictsDecided: unknown = value["verdictsDecided"];

  return counts
    ? {
        weekStart,
        ...counts,
        verdictsAgreed: isCount(verdictsAgreed) ? verdictsAgreed : 0,
        verdictsDecided: isCount(verdictsDecided) ? verdictsDecided : 0,
      }
    : null;
}

// One model's results, or null for one this page cannot read.
function parseModelResult(value: unknown): AiOutcomesModelResult | null {
  if (!isObject(value)) {
    return null;
  }

  const modelName: unknown = value["modelName"];

  if (
    typeof modelName !== "string" ||
    !isCount(value["value"]) ||
    !isCount(value["total"]) ||
    value["value"] > value["total"]
  ) {
    return null;
  }

  return { modelName, value: value["value"], total: value["total"] };
}

function parseModelResults(
  value: unknown,
): Array<AiOutcomesModelResult> | null {
  if (!Array.isArray(value)) {
    return null;
  }

  const results: Array<AiOutcomesModelResult> = [];

  for (const item of value) {
    const result: AiOutcomesModelResult | null = parseModelResult(item);

    if (!result) {
      return null;
    }

    results.push(result);
  }

  return results;
}

/*
 * The models part (#7762): null when the reader may not see models, or
 * when the server sent something this page cannot read - the cards still
 * draw, without their By model.
 */
function parseModels(value: unknown): AiOutcomesModels | null {
  if (!isObject(value)) {
    return null;
  }

  const rootCauses: Array<AiOutcomesModelResult> | null = parseModelResults(
    value["rootCauses"],
  );
  const fixes: Array<AiOutcomesModelResult> | null = parseModelResults(
    value["fixes"],
  );
  const changesValue: unknown = value["changes"];

  if (!rootCauses || !fixes || !Array.isArray(changesValue)) {
    return null;
  }

  const changes: Array<AiOutcomesModelChange> = [];

  for (const change of changesValue) {
    if (
      !isObject(change) ||
      typeof change["weekStart"] !== "string" ||
      !WEEK_START_REGEX.test(change["weekStart"]) ||
      typeof change["modelName"] !== "string" ||
      !change["modelName"]
    ) {
      return null;
    }

    changes.push({
      weekStart: change["weekStart"],
      modelName: change["modelName"],
    });
  }

  return { rootCauses, fixes, changes };
}

// One kind's counts (#10364), or null for one this page cannot read.
function parseDataSecurityKind(
  value: unknown,
): AiOutcomesDataSecurityKind | null {
  if (!isObject(value) || typeof value["kind"] !== "string") {
    return null;
  }

  const kind: string = value["kind"].trim();
  const counts:
    | (AiOutcomesDataSecurityChanges & AiOutcomesDataSecurityProposals)
    | null
    | undefined = parseCounts<
    AiOutcomesDataSecurityChanges & AiOutcomesDataSecurityProposals
  >(value, [...DATA_SECURITY_CHANGE_KEYS, ...DATA_SECURITY_PROPOSAL_KEYS]);

  return kind && counts ? { kind, ...counts } : null;
}

/*
 * The Data Security part (#10364): null when the reader may not read it
 * (sent as null, or not sent at all); undefined for one this page cannot
 * read, which refuses the whole answer, as the other parts do.
 */
function parseDataSecurity(
  value: unknown,
): AiOutcomesDataSecurity | null | undefined {
  if (value === null || value === undefined) {
    return null;
  }

  if (!isObject(value)) {
    return undefined;
  }

  const changes: AiOutcomesDataSecurityChanges | null | undefined =
    parseCounts<AiOutcomesDataSecurityChanges>(
      value["changes"],
      DATA_SECURITY_CHANGE_KEYS,
    );
  const proposals: AiOutcomesDataSecurityProposals | null | undefined =
    parseCounts<AiOutcomesDataSecurityProposals>(
      value["proposals"],
      DATA_SECURITY_PROPOSAL_KEYS,
    );
  const issuesAnalyzed: unknown = value["issuesAnalyzed"];
  const median: unknown = value["medianMinutesToCheckPassed"];
  const kindsValue: unknown = value["kinds"];

  if (
    !changes ||
    !proposals ||
    (issuesAnalyzed !== null && !isCount(issuesAnalyzed)) ||
    (median !== null && !isCount(median)) ||
    !isCount(value["issuesCheckPassed"]) ||
    !Array.isArray(kindsValue)
  ) {
    return undefined;
  }

  const kinds: Array<AiOutcomesDataSecurityKind> = [];

  for (const kindValue of kindsValue) {
    const kind: AiOutcomesDataSecurityKind | null =
      parseDataSecurityKind(kindValue);

    if (!kind) {
      return undefined;
    }

    kinds.push(kind);
  }

  return {
    issuesAnalyzed: issuesAnalyzed as number | null,
    changes,
    proposals,
    kinds,
    medianMinutesToCheckPassed: median as number | null,
    issuesCheckPassed: value["issuesCheckPassed"],
  };
}

/*
 * The fix pull requests by what production watched each for (#10368):
 * each kind read on its own, and one of the wrong shape left out. None
 * from a server of the release before.
 */
function parsePullRequestFixKinds(
  value: unknown,
): Array<AiOutcomesPullRequestFixKind> | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }

  const kinds: Array<AiOutcomesPullRequestFixKind> = [];

  for (const item of value) {
    if (!isObject(item) || typeof item["check"] !== "string") {
      continue;
    }

    const counts: AiOutcomesPullRequestFixes | null | undefined =
      parseCounts<AiOutcomesPullRequestFixes>(item, PULL_REQUEST_FIX_KEYS);

    if (counts) {
      kinds.push({ check: item["check"], ...counts });
    }
  }

  return kinds;
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
  const dataSecurity: AiOutcomesDataSecurity | null | undefined =
    parseDataSecurity(data["dataSecurity"]);
  const issueVerdicts: AiOutcomesIssueVerdicts | null | undefined =
    parseCounts<AiOutcomesIssueVerdicts>(
      data["issueVerdicts"],
      ISSUE_VERDICT_KEYS,
    );

  if (
    pages === undefined ||
    remediationFixes === undefined ||
    pullRequestFixes === undefined ||
    rootCauses === undefined ||
    dataSecurity === undefined ||
    issueVerdicts === undefined
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
    // By kind (#10368), from a server that counts them.
    ...(Array.isArray(data["pullRequestFixKinds"])
      ? {
          pullRequestFixKinds: parsePullRequestFixKinds(
            data["pullRequestFixKinds"],
          ),
        }
      : {}),
    rootCauses,
    dataSecurity,
    // A server that counts no verdicts sends none: nothing to draw, not zeros.
    ...(data["issueVerdicts"] === undefined ? {} : { issueVerdicts }),
    models: parseModels(data["models"]),
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
      outcomes.rootCauses ||
      outcomes.dataSecurity ||
      outcomes.issueVerdicts,
  );
}

// The Data Security issues OneUptime AI gave a verdict on in the window (#10369).
export function getAnalyzedIssueCount(
  verdicts: AiOutcomesIssueVerdicts | null | undefined,
): number {
  return verdicts
    ? verdicts.real +
        verdicts.likelyByDesign +
        verdicts.likelyWrongFinding +
        verdicts.cannotTell
    : 0;
}

/*
 * Whether there is anything to show: a page held (finished or not), a fix
 * run or opened, an investigation finished, a Data Security issue analyzed,
 * a change made or tried for one, a proposal dismissed.
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

  const dataSecurity: AiOutcomesDataSecurity | null = outcomes.dataSecurity;
  const dataSecurityWork: number = dataSecurity
    ? (dataSecurity.issuesAnalyzed || 0) +
      sumOf(dataSecurity.changes, DATA_SECURITY_CHANGE_KEYS) +
      dataSecurity.proposals.dismissed
    : 0;

  return (
    pagesHeld +
      fixes +
      investigations +
      dataSecurityWork +
      getAnalyzedIssueCount(outcomes.issueVerdicts) >
    0
  );
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
  DataSecurity = "data-security",
  VerdictsAgreed = "verdicts-agreed",
}

// One piece of a card's bar: an outcome and how many ended so.
export interface AiResultsSegment {
  // A translation key, translated where it is drawn.
  label: string;
  value: number;
  // A Tailwind background class, as StackedProgressBar takes it.
  color: string;
  // The records it counts, which its legend entry opens (#7768).
  records: AiResultsRecordsTarget;
}

// What a part of a breakdown counts: its part and outcome (AiOutcomesRecords).
export interface AiResultsRecordsTarget {
  part: AiOutcomesPart;
  outcome: string;
}

/*
 * One model's line under By model (#7762): its name as the provider named
 * it, or null for work done before OneUptime recorded models, and how it
 * did - what went well out of what was counted.
 */
export interface AiResultsModelRow {
  modelName: string | null;
  value: number;
  total: number;
}

export interface AiResultsByModel {
  rows: Array<AiResultsModelRow>;
  // Under the heading, how the card counts by model (a translation key).
  note?: string | undefined;
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
  /*
   * The value is a duration in whole minutes, drawn as one ("3 d 5 h"),
   * not a count: how long a Data Security issue took to pass its check.
   */
  isDurationInMinutes?: boolean | undefined;
  // The records it counts, which it opens as a breakdown's part does (#7768).
  records?: AiResultsRecordsTarget | undefined;
}

/*
 * One kind of change's line under By kind (#10364): its name, a translation
 * key or a kind this build does not know as it is stored, and how it did -
 * what worked out of what was made.
 */
export interface AiResultsKindRow {
  kind: string;
  label: string;
  value: number;
  total: number;
  /*
   * The label is a translation key, looked up where it is drawn: a kind
   * this build knows. A kind it does not is named as it is stored.
   */
  isLabelKey?: boolean | undefined;
}

export interface AiResultsByKind {
  rows: Array<AiResultsKindRow>;
}

export interface AiResultsWeekBar {
  weekStart: string;
  // What went well that week, and what it is out of.
  value: number;
  total: number;
  // The bar's hover and screen-reader words, translated.
  description: string;
  /*
   * When most of the week's investigations moved to another model (#7762):
   * the change in words, translated. The bar is marked.
   */
  modelChange?: string | undefined;
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
  /*
   * How each model did, once more than one ran in the window (#7762); null
   * otherwise, and for a card that is not counted by model.
   */
  byModel: AiResultsByModel | null;
  /*
   * How each kind of change did, once more than one kind was made in the
   * window (#10364); null otherwise, and for a card not counted by kind.
   */
  byKind: AiResultsByKind | null;
  // The weeks marked as a change of model, said in words, translated.
  modelChanges: Array<string>;
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
  changes: Array<AiOutcomesModelChange>,
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
                  records: {
                    part: AiOutcomesPart.Pages,
                    outcome: "resolvedByAi",
                  },
                },
                {
                  label: PAGE_OUTCOME_LABELS.recoveredOnItsOwn,
                  value: pages.recoveredOnItsOwn,
                  color: COLOR_RECOVERED,
                  records: {
                    part: AiOutcomesPart.Pages,
                    outcome: "recoveredOnItsOwn",
                  },
                },
                {
                  label: PAGE_OUTCOME_LABELS.handledByPerson,
                  value: pages.handledByPerson,
                  color: COLOR_HANDLED_BY_PERSON,
                  records: {
                    part: AiOutcomesPart.Pages,
                    outcome: "handledByPerson",
                  },
                },
                {
                  label: PAGE_OUTCOME_LABELS.handedOff,
                  value: pages.handedOff,
                  color: COLOR_HANDED_OFF,
                  records: {
                    part: AiOutcomesPart.Pages,
                    outcome: "handedOff",
                  },
                },
                {
                  label: PAGE_OUTCOME_LABELS.holdTimeRanOut,
                  value: pages.holdTimeRanOut,
                  color: COLOR_HOLD_TIME_RAN_OUT,
                  records: {
                    part: AiOutcomesPart.Pages,
                    outcome: "holdTimeRanOut",
                  },
                },
                {
                  label: PAGE_OUTCOME_LABELS.pageNowPressed,
                  value: pages.pageNowPressed,
                  color: COLOR_PAGE_NOW_PRESSED,
                  records: {
                    part: AiOutcomesPart.Pages,
                    outcome: "pageNowPressed",
                  },
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
    byModel: null,
    byKind: null,
    modelChanges: describeModelChanges(getDrawnChanges(changes, weeks)),
    weeks: markModelChanges(
      changes,
      weeks,
      (week: AiOutcomesWeek): AiResultsWeekBar => {
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
      },
    ),
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

/*
 * What each kind of fix pull request is called under By kind (#10368):
 * by what production watched it for - a Data Security leak fixed in code,
 * a store fixed in its infrastructure code, beside the others.
 */
export const PULL_REQUEST_FIX_KIND_LABELS: Record<FixProductionCheck, string> =
  {
    [FixProductionCheck.Exception]: translationKey("Exceptions fixed"),
    [FixProductionCheck.Performance]: translationKey(
      "Slow operations made faster",
    ),
    [FixProductionCheck.Recurrence]: translationKey("Root causes fixed"),
    [FixProductionCheck.Telemetry]: translationKey("Telemetry added"),
    [FixProductionCheck.TelemetryLeak]: translationKey(
      "Telemetry leaks fixed in code",
    ),
    [FixProductionCheck.StoreConfiguration]: translationKey(
      "Stores fixed in infrastructure code",
    ),
  };

/*
 * The fix pull requests by kind: what worked of what was checked, once more
 * than one kind was checked, or any Data Security fix was - so a team sees
 * its leaks fixed in code apart from its other fixes. Null otherwise.
 */
export function getPullRequestFixesByKind(
  kinds: ReadonlyArray<AiOutcomesPullRequestFixKind> | null | undefined,
): AiResultsByKind | null {
  const checked: Array<AiOutcomesPullRequestFixKind> = (kinds || []).filter(
    (kind: AiOutcomesPullRequestFixKind): boolean => {
      return kind.verified + kind.regressed > 0;
    },
  );
  const hasDataSecurity: boolean = checked.some(
    (kind: AiOutcomesPullRequestFixKind): boolean => {
      return FixProductionCheckHelper.isDataSecurityCheck(
        FixProductionCheckHelper.fromDatabaseValue(kind.check),
      );
    },
  );

  if (checked.length === 0 || (checked.length < 2 && !hasDataSecurity)) {
    return null;
  }

  return {
    rows: checked.map(
      (kind: AiOutcomesPullRequestFixKind): AiResultsKindRow => {
        const check: FixProductionCheck | undefined =
          FixProductionCheckHelper.fromDatabaseValue(kind.check);

        return {
          kind: kind.check,
          label: check ? PULL_REQUEST_FIX_KIND_LABELS[check] : kind.check,
          value: kind.verified,
          total: kind.verified + kind.regressed,
          isLabelKey: Boolean(check),
        };
      },
    ),
  };
}

function getFixesCard(
  outcomes: AiOutcomes,
  weeks: Array<AiOutcomesWeek>,
  changes: Array<AiOutcomesModelChange>,
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
          records: {
            part: AiOutcomesPart.RemediationFixes,
            outcome: "verified",
          },
        },
        {
          label: REMEDIATION_FIX_LABELS.failed,
          value: remediation.failed,
          color: COLOR_DID_NOT_WORK,
          records: {
            part: AiOutcomesPart.RemediationFixes,
            outcome: "failed",
          },
        },
        {
          label: REMEDIATION_FIX_LABELS.pending,
          value: remediation.pending,
          color: COLOR_CHECKING,
          records: {
            part: AiOutcomesPart.RemediationFixes,
            outcome: "pending",
          },
        },
        {
          label: REMEDIATION_FIX_LABELS.skipped,
          value: remediation.skipped,
          color: COLOR_NOT_CHECKED,
          records: {
            part: AiOutcomesPart.RemediationFixes,
            outcome: "skipped",
          },
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
          records: {
            part: AiOutcomesPart.PullRequestFixes,
            outcome: "verified",
          },
        },
        {
          label: PULL_REQUEST_FIX_LABELS.regressed,
          value: pullRequests.regressed,
          color: COLOR_DID_NOT_WORK,
          records: {
            part: AiOutcomesPart.PullRequestFixes,
            outcome: "regressed",
          },
        },
        {
          label: PULL_REQUEST_FIX_LABELS.watching,
          value: pullRequests.watching,
          color: COLOR_CHECKING,
          records: {
            part: AiOutcomesPart.PullRequestFixes,
            outcome: "watching",
          },
        },
        {
          label: PULL_REQUEST_FIX_LABELS.awaitingDeploy,
          value: pullRequests.awaitingDeploy,
          color: COLOR_WAITING,
          records: {
            part: AiOutcomesPart.PullRequestFixes,
            outcome: "awaitingDeploy",
          },
        },
        {
          label: PULL_REQUEST_FIX_LABELS.unverifiable,
          value: pullRequests.unverifiable,
          color: COLOR_NOT_CHECKED,
          records: {
            part: AiOutcomesPart.PullRequestFixes,
            outcome: "unverifiable",
          },
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
    byModel:
      total > 0
        ? getByModel(outcomes.models?.fixes, FIXES_BY_MODEL_NOTE)
        : null,
    // The fix pull requests by kind: Data Security's leaks and stores among them (#10368).
    byKind: total > 0 ? getPullRequestFixesByKind(outcomes.pullRequestFixKinds) : null,
    modelChanges: describeModelChanges(getDrawnChanges(changes, weeks)),
    weeks: markModelChanges(
      changes,
      weeks,
      (week: AiOutcomesWeek): AiResultsWeekBar => {
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
      },
    ),
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
  "Investigations OneUptime AI finished over the last 12 weeks, judged by a responder or against the root cause written when the incident or alert was resolved.",
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
  graded: translationKey("Graded against the root cause people wrote"),
  notJudged: translationKey("Not judged yet"),
};

export const ROOT_CAUSES_WEEK_LEGEND: AiResultsWeekLegend = {
  value: ROOT_CAUSE_LABELS.confirmed,
  total: translationKey("All judged investigations"),
};

// How an investigation comes to be judged, for a card with none judged yet.
export const ROOT_CAUSES_HOW_JUDGED: string = translationKey(
  "An investigation is judged when a responder confirms or rejects it on its AI card, or when someone writes the root cause as they resolve its incident or alert.",
);

function getRootCausesCard(
  rootCauses: AiOutcomesRootCauses,
  weeks: Array<AiOutcomesWeek>,
  models: AiOutcomesModels | null,
): AiResultsCard {
  const changes: Array<AiOutcomesModelChange> = models?.changes || [];
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
                  records: {
                    part: AiOutcomesPart.RootCauses,
                    outcome: "confirmed",
                  },
                },
                {
                  label: ROOT_CAUSE_LABELS.partial,
                  value: rootCauses.partial,
                  color: COLOR_IN_BETWEEN,
                  records: {
                    part: AiOutcomesPart.RootCauses,
                    outcome: "partial",
                  },
                },
                {
                  label: ROOT_CAUSE_LABELS.wrong,
                  value: rootCauses.wrong,
                  color: COLOR_DID_NOT_WORK,
                  records: {
                    part: AiOutcomesPart.RootCauses,
                    outcome: "wrong",
                  },
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
    byModel: total > 0 ? getByModel(models?.rootCauses) : null,
    byKind: null,
    modelChanges: describeModelChanges(getDrawnChanges(changes, weeks)),
    weeks: markModelChanges(
      changes,
      weeks,
      (week: AiOutcomesWeek): AiResultsWeekBar => {
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
              : translateTemplate(
                  "Week of {{date}}: no judged investigations",
                  {
                    date: describeTrendDate(week.weekStart),
                  },
                ),
        };
      },
    ),
    recentWeeks: describeRecentWeeks(weeks, (week: AiOutcomesWeek) => {
      return { value: week.rootCausesConfirmed, total: week.rootCausesJudged };
    }),
  };
}

// Data Security (#10364) -----------------------------------------------------

export const DATA_SECURITY_TITLE: string = translationKey("Data Security");

export const DATA_SECURITY_DESCRIPTION: string = translationKey(
  "Changes OneUptime AI made for your Data Security issues over the last 12 weeks, whether each issue's own check then passed, and what your team did with its proposals.",
);

export const DATA_SECURITY_HEADLINE: PluralTemplate = {
  one: "{{value}} of {{count}} change OneUptime AI made worked.",
  other: "{{value}} of {{count}} changes OneUptime AI made worked.",
};

// The card's two bars, titled once both are drawn.
export const DATA_SECURITY_CHANGES_TITLE: string = translationKey(
  "Changes OneUptime AI made",
);

export const DATA_SECURITY_PROPOSALS_TITLE: string = translationKey(
  "Proposals your team decided on",
);

/*
 * What came of a change, in the words the Data Security pages use: the
 * issue's own check decides whether it worked, never OneUptime AI's word.
 */
export const DATA_SECURITY_CHANGE_LABELS: Record<
  keyof AiOutcomesDataSecurityChanges,
  string
> = {
  proven: translationKey("It worked: the issue's check passed"),
  waiting: translationKey("Waiting for the issue's check to pass"),
  undone: translationKey("Undone by a person"),
  failed: translationKey("Could not be made: nothing changed"),
};

export const DATA_SECURITY_PROPOSAL_LABELS: Record<
  keyof AiOutcomesDataSecurityProposals,
  string
> = {
  approved: translationKey("Approved"),
  dismissed: translationKey("Dismissed"),
};

// Beside the bars: the issues it analyzed, and how long an issue took.
export const DATA_SECURITY_FACT_LABELS: Record<
  "issuesAnalyzed" | "timeToCheckPassed",
  string
> = {
  issuesAnalyzed: translationKey("Issues OneUptime AI analyzed"),
  timeToCheckPassed: translationKey(
    "Median time from an issue opening to its check passing",
  ),
};

export const DATA_SECURITY_WEEK_LEGEND: AiResultsWeekLegend = {
  value: translationKey("Changes that worked"),
  total: translationKey("All changes made"),
};

// How a change comes to count, for a card with none made yet.
export const DATA_SECURITY_HOW_CHANGES_COUNT: string = translationKey(
  "When OneUptime AI makes a change for a Data Security issue, on its own or once your team approves it, whether the issue's own check then passes shows up here.",
);

// What each kind of change is called (DataSecurityAiProposalKind).
export const DATA_SECURITY_KIND_LABELS: Record<
  DataSecurityAiProposalKind,
  string
> = {
  [DataSecurityAiProposalKind.ScrubTelemetry]: translationKey("Scrub rules"),
  // Owners for stores that had none, and the owner rules that keep them (#10374).
  [DataSecurityAiProposalKind.SetStoreOwners]: translationKey("Store owners"),
  [DataSecurityAiProposalKind.CreateOwnerRule]: translationKey("Owner rules"),
  // One fix for a group of issues one mistake made (#10370), in code or in its cloud.
  [DataSecurityAiProposalKind.FixIssueGroupInCode]: translationKey(
    "Pull requests for a cause",
  ),
  [DataSecurityAiProposalKind.FixIssueGroupInCloud]: translationKey(
    "Cloud changes for a cause",
  ),
};

export const BY_KIND_TITLE: string = translationKey("By kind");

/*
 * A kind of change as the page names it: a translation key, or a kind this
 * build does not know as it is stored.
 */
export function getDataSecurityKindLabel(kind: string): string {
  return isDataSecurityAiProposalKind(kind)
    ? DATA_SECURITY_KIND_LABELS[kind]
    : kind;
}

/*
 * The card's By kind: every kind with a change made, the most first, and
 * what worked of each - shown once at least two kinds were made in the
 * window, since one kind alone compares with nothing.
 */
export function getByKind(
  kinds: Array<AiOutcomesDataSecurityKind>,
): AiResultsByKind | null {
  const rows: Array<AiResultsKindRow> = kinds
    .filter((kind: AiOutcomesDataSecurityKind): boolean => {
      return getDataSecurityChangesMadeCount(kind) > 0;
    })
    .map((kind: AiOutcomesDataSecurityKind): AiResultsKindRow => {
      return {
        kind: kind.kind,
        label: getDataSecurityKindLabel(kind.kind),
        value: kind.proven,
        total: getDataSecurityChangesMadeCount(kind),
      };
    });

  return rows.length >= 2 ? { rows } : null;
}

function getDataSecurityCard(
  dataSecurity: AiOutcomesDataSecurity,
  weeks: Array<AiOutcomesWeek>,
  changes: Array<AiOutcomesModelChange>,
): AiResultsCard {
  const made: number = getDataSecurityChangesMadeCount(dataSecurity.changes);
  const decided: number = getDataSecurityProposalsDecidedCount(
    dataSecurity.proposals,
  );
  const startNotes: Array<string> = [];

  /*
   * With no change made: the issues it analyzed and the changes it could
   * not make, each said, else that none was made; then how one comes to
   * count.
   */
  if (made === 0) {
    if (dataSecurity.issuesAnalyzed) {
      startNotes.push(
        translatePlural(
          {
            one: "OneUptime AI analyzed {{count}} Data Security issue.",
            other: "OneUptime AI analyzed {{count}} Data Security issues.",
          },
          dataSecurity.issuesAnalyzed,
        ),
      );
    }

    if (dataSecurity.changes.failed > 0) {
      startNotes.push(
        translatePlural(
          {
            one: "{{count}} change could not be made, and nothing changed.",
            other: "{{count}} changes could not be made, and nothing changed.",
          },
          dataSecurity.changes.failed,
        ),
      );
    }

    if (startNotes.length === 0) {
      startNotes.push(translateTemplate("No changes made yet."));
    }

    startNotes.push(translateTemplate(DATA_SECURITY_HOW_CHANGES_COUNT));
  }

  // Both bars titled once there are both; the changes alone are the card's own.
  const titled: boolean = decided > 0;
  const breakdowns: Array<AiResultsBreakdown> = [
    {
      title: titled ? DATA_SECURITY_CHANGES_TITLE : undefined,
      segments: [
        {
          label: DATA_SECURITY_CHANGE_LABELS.proven,
          value: dataSecurity.changes.proven,
          color: COLOR_WORKED,
          records: {
            part: AiOutcomesPart.DataSecurityChanges,
            outcome: "proven",
          },
        },
        {
          label: DATA_SECURITY_CHANGE_LABELS.waiting,
          value: dataSecurity.changes.waiting,
          color: COLOR_CHECKING,
          records: {
            part: AiOutcomesPart.DataSecurityChanges,
            outcome: "waiting",
          },
        },
        {
          label: DATA_SECURITY_CHANGE_LABELS.undone,
          value: dataSecurity.changes.undone,
          color: COLOR_HANDLED_BY_PERSON,
          records: {
            part: AiOutcomesPart.DataSecurityChanges,
            outcome: "undone",
          },
        },
        {
          label: DATA_SECURITY_CHANGE_LABELS.failed,
          value: dataSecurity.changes.failed,
          color: COLOR_DID_NOT_WORK,
          records: {
            part: AiOutcomesPart.DataSecurityChanges,
            outcome: "failed",
          },
        },
      ],
    },
  ];

  if (titled) {
    breakdowns.push({
      title: DATA_SECURITY_PROPOSALS_TITLE,
      segments: [
        {
          label: DATA_SECURITY_PROPOSAL_LABELS.approved,
          value: dataSecurity.proposals.approved,
          color: COLOR_WORKED,
          records: {
            part: AiOutcomesPart.DataSecurityProposals,
            outcome: "approved",
          },
        },
        {
          label: DATA_SECURITY_PROPOSAL_LABELS.dismissed,
          value: dataSecurity.proposals.dismissed,
          color: COLOR_DID_NOT_WORK,
          records: {
            part: AiOutcomesPart.DataSecurityProposals,
            outcome: "dismissed",
          },
        },
      ],
    });
  }

  const facts: Array<AiResultsFact> = [];

  if (dataSecurity.issuesAnalyzed !== null) {
    facts.push({
      label: DATA_SECURITY_FACT_LABELS.issuesAnalyzed,
      value: dataSecurity.issuesAnalyzed,
      ...(dataSecurity.issuesAnalyzed > 0
        ? {
            records: {
              part: AiOutcomesPart.DataSecurityAnalyses,
              outcome: "analyzed",
            },
          }
        : {}),
    });
  }

  if (dataSecurity.medianMinutesToCheckPassed !== null) {
    facts.push({
      label: DATA_SECURITY_FACT_LABELS.timeToCheckPassed,
      value: dataSecurity.medianMinutesToCheckPassed,
      isDurationInMinutes: true,
    });
  }

  return {
    kind: AiResultsCardKind.DataSecurity,
    title: DATA_SECURITY_TITLE,
    description: DATA_SECURITY_DESCRIPTION,
    value: dataSecurity.changes.proven,
    total: made,
    headline: DATA_SECURITY_HEADLINE,
    startNotes,
    // With no change made, the start notes say it all.
    breakdowns: made > 0 ? breakdowns : [],
    facts: made > 0 ? facts : [],
    weekLegend: DATA_SECURITY_WEEK_LEGEND,
    byModel: null,
    byKind: made > 0 ? getByKind(dataSecurity.kinds) : null,
    modelChanges: describeModelChanges(getDrawnChanges(changes, weeks)),
    weeks: markModelChanges(
      changes,
      weeks,
      (week: AiOutcomesWeek): AiResultsWeekBar => {
        return {
          weekStart: week.weekStart,
          value: week.dataSecurityChangesProven,
          total: week.dataSecurityChangesMade,
          description:
            week.dataSecurityChangesMade > 0
              ? translatePlural(
                  {
                    one: "Week of {{date}}: {{value}} of {{count}} change OneUptime AI made worked",
                    other:
                      "Week of {{date}}: {{value}} of {{count}} changes OneUptime AI made worked",
                  },
                  week.dataSecurityChangesMade,
                  {
                    date: describeTrendDate(week.weekStart),
                    value: formatCount(week.dataSecurityChangesProven),
                  },
                )
              : translateTemplate("Week of {{date}}: no changes made", {
                  date: describeTrendDate(week.weekStart),
                }),
        };
      },
    ),
    recentWeeks: describeRecentWeeks(weeks, (week: AiOutcomesWeek) => {
      return {
        value: week.dataSecurityChangesProven,
        total: week.dataSecurityChangesMade,
      };
    }),
  };
}

// Data Security verdicts (#10369) -------------------------------------------

export const VERDICTS_AGREED_TITLE: string = translationKey("Verdicts Agreed");

export const VERDICTS_AGREED_DESCRIPTION: string = translationKey(
  "Data Security issues OneUptime AI analyzed over the last 12 weeks, and whether what people decided agreed with its verdict.",
);

export const VERDICTS_AGREED_HEADLINE: PluralTemplate = {
  one: "{{value}} of {{count}} decided issue went the way OneUptime AI's verdict said.",
  other:
    "{{value}} of {{count}} decided issues went the way OneUptime AI's verdict said.",
};

export const VERDICT_OUTCOME_LABELS: Record<"agreed" | "disagreed", string> = {
  agreed: translationKey("Went as its verdict said"),
  disagreed: translationKey("Went the other way"),
};

/*
 * Beside the bar: the verdicts it gave, and the analyzed issues nobody has
 * decided on yet.
 */
export const VERDICT_FACT_LABELS: Record<
  "real" | "likelyByDesign" | "likelyWrongFinding" | "cannotTell" | "waiting",
  string
> = {
  real: translationKey("Said real"),
  likelyByDesign: translationKey("Said likely by design"),
  likelyWrongFinding: translationKey("Said likely a wrong finding"),
  cannotTell: translationKey("Could not tell"),
  waiting: translationKey("Not decided yet"),
};

export const VERDICTS_WEEK_LEGEND: AiResultsWeekLegend = {
  value: VERDICT_OUTCOME_LABELS.agreed,
  total: translationKey("All decided issues"),
};

// How an analyzed issue comes to count, for a card with none decided yet.
export const VERDICTS_HOW_DECIDED: string = translationKey(
  "An issue counts once it is decided: fixed, its risk accepted, or marked not an issue.",
);

function getVerdictsCard(
  verdicts: AiOutcomesIssueVerdicts,
  weeks: Array<AiOutcomesWeek>,
): AiResultsCard {
  const total: number = verdicts.agreed + verdicts.disagreed;
  const analyzed: number = getAnalyzedIssueCount(verdicts);
  const startNotes: Array<string> = [];

  if (total === 0) {
    startNotes.push(
      analyzed > 0
        ? translatePlural(
            {
              one: "OneUptime AI analyzed {{count}} Data Security issue, and nobody has decided on it yet.",
              other:
                "OneUptime AI analyzed {{count}} Data Security issues, and none has been decided yet.",
            },
            analyzed,
          )
        : translateTemplate("No analyzed Data Security issues yet."),
      translateTemplate(VERDICTS_HOW_DECIDED),
    );
  }

  return {
    kind: AiResultsCardKind.VerdictsAgreed,
    title: VERDICTS_AGREED_TITLE,
    description: VERDICTS_AGREED_DESCRIPTION,
    value: verdicts.agreed,
    total,
    headline: VERDICTS_AGREED_HEADLINE,
    startNotes,
    breakdowns:
      total > 0
        ? [
            {
              segments: [
                {
                  label: VERDICT_OUTCOME_LABELS.agreed,
                  value: verdicts.agreed,
                  color: COLOR_WORKED,
                  records: {
                    part: AiOutcomesPart.IssueVerdicts,
                    outcome: "agreed",
                  },
                },
                {
                  label: VERDICT_OUTCOME_LABELS.disagreed,
                  value: verdicts.disagreed,
                  color: COLOR_DID_NOT_WORK,
                  records: {
                    part: AiOutcomesPart.IssueVerdicts,
                    outcome: "disagreed",
                  },
                },
              ],
            },
          ]
        : [],
    facts:
      analyzed > 0
        ? [
            { label: VERDICT_FACT_LABELS.real, value: verdicts.real },
            {
              label: VERDICT_FACT_LABELS.likelyByDesign,
              value: verdicts.likelyByDesign,
            },
            {
              label: VERDICT_FACT_LABELS.likelyWrongFinding,
              value: verdicts.likelyWrongFinding,
            },
            /*
             * Beside the bar, what it leaves out opens what it counts too:
             * the issues it could not tell about, and the ones nobody
             * decided yet.
             */
            {
              label: VERDICT_FACT_LABELS.cannotTell,
              value: verdicts.cannotTell,
              records: {
                part: AiOutcomesPart.IssueVerdicts,
                outcome: "cannotTell",
              },
            },
            {
              label: VERDICT_FACT_LABELS.waiting,
              value: verdicts.waiting,
              records: {
                part: AiOutcomesPart.IssueVerdicts,
                outcome: "waiting",
              },
            },
          ]
        : [],
    weekLegend: VERDICTS_WEEK_LEGEND,
    byModel: null,
    byKind: null,
    modelChanges: [],
    weeks: weeks.map((week: AiOutcomesWeek): AiResultsWeekBar => {
      const value: number = week.verdictsAgreed || 0;
      const decided: number = week.verdictsDecided || 0;

      return {
        weekStart: week.weekStart,
        value,
        total: decided,
        description:
          decided > 0
            ? translatePlural(
                {
                  one: "Week of {{date}}: {{value}} of {{count}} decided issue went as its verdict said",
                  other:
                    "Week of {{date}}: {{value}} of {{count}} decided issues went as their verdicts said",
                },
                decided,
                {
                  date: describeTrendDate(week.weekStart),
                  value: formatCount(value),
                },
              )
            : translateTemplate("Week of {{date}}: no decided issues", {
                date: describeTrendDate(week.weekStart),
              }),
      };
    }),
    recentWeeks: describeRecentWeeks(weeks, (week: AiOutcomesWeek) => {
      return {
        value: week.verdictsAgreed || 0,
        total: week.verdictsDecided || 0,
      };
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

// By model and changes of model (#7762) --------------------------------------

export const BY_MODEL_TITLE: string = translationKey("By model");

// The line of investigations, or fixes, done before models were recorded.
export const UNKNOWN_MODEL_LABEL: string = translationKey("Model not recorded");

// A model's line: what went well out of what was counted.
export const MODEL_RESULT_TEMPLATE: string = translationKey(
  "{{value}} of {{total}}",
);

export const FIXES_BY_MODEL_NOTE: string = translationKey(
  "Each fix counts under the model of the investigation it came from.",
);

// The mark on a week's bar, named under the bars.
export const MODEL_CHANGE_LEGEND: string = translationKey(
  "Investigations moved to another model",
);

export const MODEL_CHANGE_TEMPLATE: string = translationKey(
  "From the week of {{date}}, most investigations ran on {{model}}.",
);

/*
 * A card's By model: every model with something counted, the most counted
 * first and work done before models were recorded last - shown once at
 * least two models ran in the window, since one model alone compares with
 * nothing.
 */
export function getByModel(
  results: Array<AiOutcomesModelResult> | undefined,
  note?: string | undefined,
): AiResultsByModel | null {
  const rows: Array<AiResultsModelRow> = (results || [])
    .filter((result: AiOutcomesModelResult): boolean => {
      return result.total > 0;
    })
    .map((result: AiOutcomesModelResult): AiResultsModelRow => {
      return {
        modelName:
          result.modelName === AI_OUTCOMES_UNKNOWN_MODEL
            ? null
            : result.modelName,
        value: result.value,
        total: result.total,
      };
    });

  const knownModels: number = rows.filter((row: AiResultsModelRow): boolean => {
    return row.modelName !== null;
  }).length;

  if (knownModels < 2) {
    return null;
  }

  return { rows, ...(note ? { note } : {}) };
}

// A model's line in the reader's words: "23 of 27".
export function describeModelResult(
  row: AiResultsModelRow,
  translator: Translator = getGlobalTranslator(),
): string {
  return translator.translateTemplate(MODEL_RESULT_TEMPLATE, {
    value: translator.formatNumber(row.value),
    total: translator.formatNumber(row.total),
  });
}

// A kind of change's line, as a model's is: "9 of 12" (#10364).
export function describeKindResult(
  row: AiResultsKindRow,
  translator: Translator = getGlobalTranslator(),
): string {
  return translator.translateTemplate(MODEL_RESULT_TEMPLATE, {
    value: translator.formatNumber(row.value),
    total: translator.formatNumber(row.total),
  });
}

// Each change of model in words, oldest first, translated.
export function describeModelChanges(
  changes: Array<AiOutcomesModelChange>,
): Array<string> {
  return changes.map((change: AiOutcomesModelChange): string => {
    return translateTemplate(MODEL_CHANGE_TEMPLATE, {
      date: describeTrendDate(change.weekStart),
      model: change.modelName,
    });
  });
}

// The changes on the weeks a card draws: the others have no bar to mark.
function getDrawnChanges(
  changes: Array<AiOutcomesModelChange>,
  weeks: Array<AiOutcomesWeek>,
): Array<AiOutcomesModelChange> {
  return changes.filter((change: AiOutcomesModelChange): boolean => {
    return weeks.some((week: AiOutcomesWeek): boolean => {
      return week.weekStart === change.weekStart;
    });
  });
}

// A card's week bars, the weeks investigations changed model marked.
function markModelChanges(
  changes: Array<AiOutcomesModelChange>,
  weeks: Array<AiOutcomesWeek>,
  toBar: (week: AiOutcomesWeek) => AiResultsWeekBar,
): Array<AiResultsWeekBar> {
  return weeks.map((week: AiOutcomesWeek): AiResultsWeekBar => {
    const bar: AiResultsWeekBar = toBar(week);
    const change: AiOutcomesModelChange | undefined = changes.find(
      (candidate: AiOutcomesModelChange): boolean => {
        return candidate.weekStart === week.weekStart;
      },
    );

    return change
      ? { ...bar, modelChange: describeModelChanges([change])[0]! }
      : bar;
  });
}

// The cards the reader may read, in the page's order.
export function getAiResultsCards(outcomes: AiOutcomes): Array<AiResultsCard> {
  const cards: Array<AiResultsCard> = [];
  // The weeks investigations changed model mark every card's weeks (#7762).
  const changes: Array<AiOutcomesModelChange> = outcomes.models?.changes || [];

  if (outcomes.pages) {
    cards.push(getPagesCard(outcomes.pages, outcomes.weeks, changes));
  }

  if (outcomes.remediationFixes || outcomes.pullRequestFixes) {
    cards.push(getFixesCard(outcomes, outcomes.weeks, changes));
  }

  if (outcomes.rootCauses) {
    cards.push(
      getRootCausesCard(outcomes.rootCauses, outcomes.weeks, outcomes.models),
    );
  }

  if (outcomes.dataSecurity) {
    cards.push(
      getDataSecurityCard(outcomes.dataSecurity, outcomes.weeks, changes),
    );
  }

  if (outcomes.issueVerdicts) {
    cards.push(getVerdictsCard(outcomes.issueVerdicts, outcomes.weeks));
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
