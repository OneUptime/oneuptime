/*
 * AI RESULTS (issue #6800): what OneUptime AI's work came to for a project,
 * in outcomes rather than activity - the pages it kept from waking people,
 * the fixes it verified, the root causes people confirmed, and the changes
 * it made for Data Security issues that each issue's own check proved
 * (#10364) - week by week, so a team can see whether it is getting better.
 *
 * Read on the server (Server/Utils/AI/Outcomes/AiOutcomesReader) behind the
 * caller's own read access: a part the caller may not read is null and the
 * page leaves it out. Every number comes with what it is out of, so a page
 * never says "12 pages avoided" without "of 40 held". Each number opens the
 * records it counts (AI_OUTCOMES_RECORDS_PATH, #7768), and the investigations
 * and fixes are also counted by the model that ran them (models, #7762).
 */

// The page's call: POST, {}.
export const AI_OUTCOMES_PATH: string = "/ai-activity/outcomes";

// The weeks the page shows, newest last.
export const AI_OUTCOMES_WEEK_COUNT: number = 12;

/*
 * The most rows of each kind the page counts. Reaching it marks the
 * outcomes partial, and the page says its numbers count the newest ones.
 */
export const AI_OUTCOMES_SCAN_LIMIT: number = 5000;

/*
 * How the pages OneUptime AI held ended (OnCallPolicyAiHoldOutcome): the
 * finished ones, by outcome, and the ones still held.
 */
export interface AiOutcomesPages {
  // AI's fix was verified and the record resolved: nobody was paged.
  resolvedByAi: number;
  // The record resolved with no verified AI fix: nobody was paged.
  recoveredOnItsOwn: number;
  // Someone acknowledged or resolved it while it was held.
  handledByPerson: number;
  // AI could not fix it on its own, or its fix did not hold: people were paged.
  handedOff: number;
  holdTimeRanOut: number;
  pageNowPressed: number;
  // Still held while AI works.
  holding: number;
}

// The fixes OneUptime AI ran itself (AutoRemediationSuggestion), by their check.
export interface AiOutcomesRemediationFixes {
  verified: number;
  failed: number;
  // Started; the check is still watching for recovery.
  pending: number;
  // Nothing to check against (a record with no monitor).
  skipped: number;
}

// The fix pull requests OneUptime AI opened (AIAgentTaskPullRequest), by production.
export interface AiOutcomesPullRequestFixes {
  verified: number;
  regressed: number;
  // Merged and deployed; production is still being watched.
  watching: number;
  awaitingDeploy: number;
  // Could not be told from production (no telemetry for the code it changed).
  unverifiable: number;
}

// One kind of fix pull request (FixProductionCheck) and its own counts (#10368).
export interface AiOutcomesPullRequestFixKind
  extends AiOutcomesPullRequestFixes {
  // The check as stored: Exception, TelemetryLeak, or one a newer build knows.
  check: string;
}

/*
 * The investigations people judged: graded against the root cause they
 * wrote when they resolved the incident (AIRun.autoGrade), or judged on the
 * AI card (AIRun.humanVerdict). Each investigation counts once: a person's
 * verdict, when there is one, else its grade.
 */
export interface AiOutcomesRootCauses {
  // A person confirmed it, or (unjudged) its grade was MATCH.
  confirmed: number;
  // Graded PARTIAL, with no verdict.
  partial: number;
  // A person rejected it, or (unjudged) its grade was MISMATCH.
  wrong: number;
  // Of them, how many a person judged (the rest were graded).
  judgedByPeople: number;
  // Investigations completed in the window, judged or not.
  completed: number;
}

/*
 * OneUptime AI's verdicts on Data Security issues (#10369): the issues it
 * analyzed in the window, and whether what people did with each agreed
 * with its verdict (getIssueVerdictOutcome, Server/Utils/AI/Outcomes):
 *
 *   - Real: agreed when the issue was fixed (its check passed) or its risk
 *     accepted; not when it was marked not an issue;
 *   - Likely by design: agreed when its risk was accepted, it was marked not
 *     an issue, or its store marked public by design; not when it was fixed;
 *   - Likely a wrong finding: agreed when it was marked not an issue; not
 *     when it was fixed or its risk accepted;
 *   - Cannot tell makes no claim, and an issue still open waits.
 */
export interface AiOutcomesIssueVerdicts {
  agreed: number;
  disagreed: number;
  // Still open: nobody decided yet.
  waiting: number;
  // OneUptime AI could not tell: no claim to agree with.
  cannotTell: number;
  // Every issue it analyzed, by the verdict it gave.
  real: number;
  likelyByDesign: number;
  likelyWrongFinding: number;
}

/*
 * ---------------------------------------------------------------------------
 * DATA SECURITY (issue #10364).
 * ---------------------------------------------------------------------------
 *
 * What OneUptime AI did about the project's Data Security issues, read from
 * its proposals (DataSecurityAiProposal) and the record of each time it
 * worked on an issue (DataSecurityAiDecision). A proposal counts once it
 * settled, in the week it did: a change in the week it was made (appliedAt),
 * one that could not be made in the week it failed (failedAt), one a person
 * dismissed in the week they did (dismissedAt) - however long the issue's
 * check took to pass after it. A proposal still waiting for a person, or
 * one no longer needed (Expired), is not counted.
 */

// The changes OneUptime AI made, or tried to make, by what came of them.
export interface AiOutcomesDataSecurityChanges {
  /*
   * Made, and the issue's own check passed after it (verifiedAt): proven,
   * never on OneUptime AI's word.
   */
  proven: number;
  // Made, and standing; the issue's check has not passed since.
  waiting: number;
  // Made, then taken back by a person - proven before or not.
  undone: number;
  // Making it failed, and nothing changed.
  failed: number;
}

// What people did with the changes OneUptime AI proposed and waited on them for.
export interface AiOutcomesDataSecurityProposals {
  /*
   * A person approved it (approvedByUserId), and the change was made or
   * making it failed. A change made without asking was approved by nobody.
   */
  approved: number;
  // A person dismissed it, with a reason.
  dismissed: number;
}

// One kind of change (DataSecurityAiProposalKind) and its own counts.
export interface AiOutcomesDataSecurityKind
  extends AiOutcomesDataSecurityChanges,
    AiOutcomesDataSecurityProposals {
  // The kind as stored: ScrubTelemetry, or one a newer build knows.
  kind: string;
}

export interface AiOutcomesDataSecurity {
  /*
   * The issues OneUptime AI analyzed (DataSecurityAiDecision.didAnalyze),
   * each once, in the week of its first analysis in the window. Null: the
   * caller may not read why OneUptime AI acted on an issue.
   */
  issuesAnalyzed: number | null;
  changes: AiOutcomesDataSecurityChanges;
  proposals: AiOutcomesDataSecurityProposals;
  // By kind: every kind with something counted, the most changes first.
  kinds: Array<AiOutcomesDataSecurityKind>;
  /*
   * The median time, in whole minutes, from an issue opening (its
   * firstDetectedAt) to its check first passing after a change counted as
   * proven; null when none was. Each issue counts once, however many of
   * its changes were proven.
   */
  medianMinutesToCheckPassed: number | null;
  // The issues that median is over.
  issuesCheckPassed: number;
}

/*
 * ---------------------------------------------------------------------------
 * LEAKS CAUGHT BEFORE THEY MERGED (issue #10376).
 * ---------------------------------------------------------------------------
 *
 * The cheapest leak to fix is the one that never merges. A pull request's
 * production review posts what its change writes of sensitive data to
 * telemetry, leaves open in a store or adds a column for, and remembers
 * each leak it posts once (ProductionReviewTaskContext.caughtLeaks), with
 * when a later review no longer found it: fixed in the pull request.
 * Against them, the issues Data Security's scans opened after the fact, on
 * the checks those leaks are the early form of
 * (PRODUCTION_REVIEW_LEAK_CHECK_IDS). A leak counts in the week it was
 * first posted; an issue in the week it was first detected.
 */
export interface AiOutcomesLeaks {
  // Caught in a pull request, and gone by a later review of it.
  fixed: number;
  // Caught in a pull request, and still in its latest review.
  open: number;
  // Found after it shipped: an issue a scan opened on one of those checks.
  foundAfter: number;
}

export interface AiOutcomesWeek {
  // The week's first day, YYYY-MM-DD (UTC).
  weekStart: string;
  /*
   * Each counts the work AI started that week - the pages held, the fixes
   * run or opened, the investigations run - however long its check took.
   */
  pagesAvoided: number;
  // Held pages of the week that have finished.
  pagesHeld: number;
  fixesVerified: number;
  // Fixes whose check finished: verified, failed or regressed.
  fixesChecked: number;
  rootCausesConfirmed: number;
  // Investigations judged: confirmed, partial or wrong.
  rootCausesJudged: number;
  /*
   * The changes OneUptime AI made for Data Security issues that week
   * (appliedAt) whose issue's check then passed, and every change it made
   * that week: proven, waiting for the check or undone.
   */
  dataSecurityChangesProven: number;
  dataSecurityChangesMade: number;
  /*
   * Data Security issues OneUptime AI analyzed that week whose verdict what
   * people decided agreed with, of those decided (#10369). A server of the
   * release before sends neither: the Dashboard reads them as none.
   */
  verdictsAgreed: number;
  verdictsDecided: number;
  /*
   * Leaks caught in pull requests that week, and every leak counted that
   * week: those, and the issues scans opened (#10376). A server of the
   * release before sends neither: the Dashboard reads them as none.
   */
  leaksCaught: number;
  leaksCounted: number;
}

/*
 * WHICH MODEL (issue #7762). Every investigation records the model that
 * wrote its answer when it completes (AIRun.modelName): the model of its
 * last call, which wrote the analysis people judged. An investigation that
 * completed before OneUptime recorded it has none, and counts under
 * AI_OUTCOMES_UNKNOWN_MODEL.
 */
export const AI_OUTCOMES_UNKNOWN_MODEL: string = "";

// One model's part of a card: "gpt-5.1: 23 of 27".
export interface AiOutcomesModelResult {
  /*
   * The model as its LLM provider named it, written as is in every
   * language; AI_OUTCOMES_UNKNOWN_MODEL for work done before OneUptime
   * recorded it.
   */
  modelName: string;
  // What went well (confirmed, verified), out of what was counted (judged, checked).
  value: number;
  total: number;
}

/*
 * The week OneUptime AI's investigations started running on a model after
 * another one had run them in the window: what a project's switch of its
 * LLM provider or model looks like in what actually ran, an AI rule's
 * provider included. A model first seen after investigations with none
 * recorded is no change: that is only when OneUptime started recording.
 */
export interface AiOutcomesModelChange {
  // The week's first day, YYYY-MM-DD (UTC), as AiOutcomesWeek writes it.
  weekStart: string;
  modelName: string;
}

export interface AiOutcomesModels {
  // Root Causes Confirmed by the model of each investigation, most judged first.
  rootCauses: Array<AiOutcomesModelResult>;
  /*
   * Fixes Verified, for the fixes that came from an investigation, by its
   * model: the latest investigation of the fix's incident or alert counted
   * on the page that started before the fix did - the one the fix was
   * handed (AI SRE's investigation-first hand-off). Most checked first.
   */
  fixes: Array<AiOutcomesModelResult>;
  // Oldest first.
  changes: Array<AiOutcomesModelChange>;
}

export interface AiOutcomes {
  // The window: AI_OUTCOMES_WEEK_COUNT weeks up to now, ISO 8601.
  windowStart: string;
  windowEnd: string;
  // Null: the caller may not read on-call pages (or the plan has none).
  pages: AiOutcomesPages | null;
  // Null: the caller may not read the fixes AI ran.
  remediationFixes: AiOutcomesRemediationFixes | null;
  // Null: the caller may not read fix pull requests (or the plan has none).
  pullRequestFixes: AiOutcomesPullRequestFixes | null;
  /*
   * The same fix pull requests, by what production watched each for
   * (FixProductionCheck, #10368): an exception's fix, a slow operation's,
   * a telemetry leak fixed in code, a store fixed in its infrastructure
   * code - each kind of fix counted apart. Absent from a server of the
   * release before, and null when pullRequestFixes is.
   */
  pullRequestFixKinds?: Array<AiOutcomesPullRequestFixKind> | null | undefined;
  // Null: the caller may read neither incidents nor alerts.
  rootCauses: AiOutcomesRootCauses | null;
  // Null: the caller may not read OneUptime AI's Data Security proposals.
  dataSecurity: AiOutcomesDataSecurity | null;
  /*
   * Null: the caller may not read the project's AI Logs, where each call's
   * model is listed, so the page names no model (#7762).
   */
  models: AiOutcomesModels | null;
  /*
   * OneUptime AI's verdicts on Data Security issues (#10369). Null: the
   * caller may not read Data Security issues; absent from a server of the
   * release before.
   */
  issueVerdicts?: AiOutcomesIssueVerdicts | null | undefined;
  /*
   * Leaks caught in pull requests, against those the scans found after
   * (#10376). Null: the caller may not read the repositories' reviews, or
   * Data Security's issues; absent from a server of the release before.
   */
  leaks?: AiOutcomesLeaks | null | undefined;
  // AI_OUTCOMES_WEEK_COUNT weeks, oldest first.
  weeks: Array<AiOutcomesWeek>;
  // A kind of row reached AI_OUTCOMES_SCAN_LIMIT: the newest were counted.
  isPartial: boolean;
}

/*
 * ---------------------------------------------------------------------------
 * THE RECORDS BEHIND A NUMBER (issue #7768).
 * ---------------------------------------------------------------------------
 *
 * Each part of a card's breakdown - "Paged: the hold time ran out (4)",
 * "Missed the root cause (15)" - opens the records it counts:
 *
 *   POST /ai-activity/outcomes/records
 *   { part, outcome, windowEnd?, skip? }
 *
 * Read by the same rows, filters and limits as the number (AiOutcomesReader),
 * so it lists exactly what the number counts: only incidents and alerts the
 * reader may read, private ones included, and `total` is the number. A Data
 * Security number lists the issues it counts, each one the reader may read.
 */
export const AI_OUTCOMES_RECORDS_PATH: string = "/ai-activity/outcomes/records";

// The most records one answer lists; `nextSkip` reads the next ones.
export const AI_OUTCOMES_RECORDS_PAGE_SIZE: number = 50;

// How much of an investigation's finding travels with its record.
export const AI_OUTCOMES_RECORDS_TEXT_MAX_LENGTH: number = 300;

export enum AiOutcomesPart {
  Pages = "pages",
  RemediationFixes = "remediationFixes",
  PullRequestFixes = "pullRequestFixes",
  RootCauses = "rootCauses",
  // The Data Security issues OneUptime AI analyzed (#10364).
  DataSecurityAnalyses = "dataSecurityAnalyses",
  // The changes it made, or tried to make, for Data Security issues.
  DataSecurityChanges = "dataSecurityChanges",
  // What people did with the changes it proposed.
  DataSecurityProposals = "dataSecurityProposals",
  // How often what people decided agreed with OneUptime AI's verdict (#10369).
  IssueVerdicts = "issueVerdicts",
  // Leaks caught in pull requests, and the ones the scans found after (#10376).
  Leaks = "leaks",
}

export const AI_OUTCOMES_PARTS: ReadonlyArray<AiOutcomesPart> = [
  AiOutcomesPart.Pages,
  AiOutcomesPart.RemediationFixes,
  AiOutcomesPart.PullRequestFixes,
  AiOutcomesPart.RootCauses,
  AiOutcomesPart.DataSecurityAnalyses,
  AiOutcomesPart.DataSecurityChanges,
  AiOutcomesPart.DataSecurityProposals,
  AiOutcomesPart.IssueVerdicts,
  AiOutcomesPart.Leaks,
];

// The parts of the Data Security card, whose records are Data Security issues.
export const AI_OUTCOMES_DATA_SECURITY_PARTS: ReadonlyArray<AiOutcomesPart> = [
  AiOutcomesPart.DataSecurityAnalyses,
  AiOutcomesPart.DataSecurityChanges,
  AiOutcomesPart.DataSecurityProposals,
];

/*
 * The outcomes of each part, by the key its count has in the part's counts:
 * what a record request may name.
 */
export const AI_OUTCOMES_PAGE_OUTCOMES: ReadonlyArray<keyof AiOutcomesPages> = [
  "resolvedByAi",
  "recoveredOnItsOwn",
  "handledByPerson",
  "handedOff",
  "holdTimeRanOut",
  "pageNowPressed",
  "holding",
];

export const AI_OUTCOMES_REMEDIATION_FIX_OUTCOMES: ReadonlyArray<
  keyof AiOutcomesRemediationFixes
> = ["verified", "failed", "pending", "skipped"];

export const AI_OUTCOMES_PULL_REQUEST_FIX_OUTCOMES: ReadonlyArray<
  keyof AiOutcomesPullRequestFixes
> = ["verified", "regressed", "watching", "awaitingDeploy", "unverifiable"];

// How an investigation was judged: a person's verdict before its grade.
export type AiOutcomesRootCauseOutcome = "confirmed" | "partial" | "wrong";

export const AI_OUTCOMES_ROOT_CAUSE_OUTCOMES: ReadonlyArray<AiOutcomesRootCauseOutcome> =
  ["confirmed", "partial", "wrong"];

// An issue OneUptime AI analyzed: AiOutcomesDataSecurity.issuesAnalyzed.
export type AiOutcomesDataSecurityAnalysisOutcome = "analyzed";

export const AI_OUTCOMES_DATA_SECURITY_ANALYSIS_OUTCOMES: ReadonlyArray<AiOutcomesDataSecurityAnalysisOutcome> =
  ["analyzed"];

export const AI_OUTCOMES_DATA_SECURITY_CHANGE_OUTCOMES: ReadonlyArray<
  keyof AiOutcomesDataSecurityChanges
> = ["proven", "waiting", "undone", "failed"];

export const AI_OUTCOMES_DATA_SECURITY_PROPOSAL_OUTCOMES: ReadonlyArray<
  keyof AiOutcomesDataSecurityProposals
> = ["approved", "dismissed"];

// What became of a Data Security issue OneUptime AI gave a verdict on (#10369).
export type AiOutcomesIssueVerdictOutcome =
  | "agreed"
  | "disagreed"
  | "waiting"
  | "cannotTell";

export const AI_OUTCOMES_ISSUE_VERDICT_OUTCOMES: ReadonlyArray<AiOutcomesIssueVerdictOutcome> =
  ["agreed", "disagreed", "waiting", "cannotTell"];

// Where a leak was counted (#10376): AiOutcomesLeaks' keys.
export const AI_OUTCOMES_LEAK_OUTCOMES: ReadonlyArray<keyof AiOutcomesLeaks> = [
  "fixed",
  "open",
  "foundAfter",
];

export const AI_OUTCOMES_PART_OUTCOMES: Record<
  AiOutcomesPart,
  ReadonlyArray<string>
> = {
  [AiOutcomesPart.Pages]: AI_OUTCOMES_PAGE_OUTCOMES,
  [AiOutcomesPart.RemediationFixes]: AI_OUTCOMES_REMEDIATION_FIX_OUTCOMES,
  [AiOutcomesPart.PullRequestFixes]: AI_OUTCOMES_PULL_REQUEST_FIX_OUTCOMES,
  [AiOutcomesPart.RootCauses]: AI_OUTCOMES_ROOT_CAUSE_OUTCOMES,
  [AiOutcomesPart.DataSecurityAnalyses]:
    AI_OUTCOMES_DATA_SECURITY_ANALYSIS_OUTCOMES,
  [AiOutcomesPart.DataSecurityChanges]:
    AI_OUTCOMES_DATA_SECURITY_CHANGE_OUTCOMES,
  [AiOutcomesPart.DataSecurityProposals]:
    AI_OUTCOMES_DATA_SECURITY_PROPOSAL_OUTCOMES,
  [AiOutcomesPart.IssueVerdicts]: AI_OUTCOMES_ISSUE_VERDICT_OUTCOMES,
  [AiOutcomesPart.Leaks]: AI_OUTCOMES_LEAK_OUTCOMES,
};

export function isAiOutcomesPartOutcome(
  part: AiOutcomesPart,
  outcome: string,
): boolean {
  return AI_OUTCOMES_PART_OUTCOMES[part].includes(outcome);
}

export type AiOutcomesRecordSubjectKind = "incident" | "alert";

// The incident or alert a record was about.
export interface AiOutcomesRecordSubject {
  kind: AiOutcomesRecordSubjectKind;
  id: string;
  title?: string | undefined;
  number?: number | undefined;
  // The number with the project's prefix ("INC-42"), when it has one.
  numberWithPrefix?: string | undefined;
}

// The Data Security issue a record was about (#10364).
export interface AiOutcomesRecordDataSecurityIssue {
  id: string;
  title?: string | undefined;
}

export interface AiOutcomesRecord {
  /*
   * The row's own id: the held page's run, the fix, the pull request, the
   * investigation, the Data Security proposal, or the first analysis of a
   * Data Security issue.
   */
  id: string;
  // ISO: when the work started, the moment its week counts it at.
  at: string;
  /*
   * The incident or alert it was about. A fix pull request about neither
   * (an exception's, say) has none.
   */
  subject?: AiOutcomesRecordSubject | undefined;
  // A Data Security number's record: the issue it was about.
  dataSecurityIssue?: AiOutcomesRecordDataSecurityIssue | undefined;
  /*
   * A change OneUptime AI made, or proposed, for a Data Security issue:
   * what it was, in a line (its proposal's title), and its kind
   * (DataSecurityAiProposalKind).
   */
  proposalTitle?: string | undefined;
  proposalKind?: string | undefined;
  // A fix OneUptime AI ran: its runbook, or what kind of fix it was.
  runbookName?: string | undefined;
  suggestionType?: string | undefined;
  // A fix pull request.
  pullRequestNumber?: number | undefined;
  pullRequestTitle?: string | undefined;
  pullRequestUrl?: string | undefined;
  // An investigation: its one-line finding, and how it was judged.
  summary?: string | undefined;
  humanVerdict?: string | undefined;
  autoGrade?: string | undefined;
  // A Data Security issue: OneUptime AI's verdict, and where the issue stands.
  issueVerdict?: string | undefined;
  issueStatus?: string | undefined;
  /*
   * A leak (#10376): the Data Security check it is the early form of, or
   * the check whose issue a scan opened - DataSecurityCheckCatalog's id.
   */
  checkId?: string | undefined;
}

// Every leak counted: caught in a pull request, or found after (#10376).
export function getLeaksCountedCount(leaks: AiOutcomesLeaks): number {
  return leaks.fixed + leaks.open + leaks.foundAfter;
}

// The leaks caught in pull requests, fixed there or not.
export function getLeaksCaughtCount(leaks: AiOutcomesLeaks): number {
  return leaks.fixed + leaks.open;
}

export interface AiOutcomesRecords {
  part: AiOutcomesPart;
  outcome: string;
  // How many the number counts: the card's number, when nothing changed since.
  total: number;
  // Newest first: one page of them.
  records: Array<AiOutcomesRecord>;
  // Where the next page starts (its request's `skip`); null after the last.
  nextSkip: number | null;
}

// Held pages that finished: every outcome but still holding.
export function getHeldPageCount(pages: AiOutcomesPages): number {
  return (
    pages.resolvedByAi +
    pages.recoveredOnItsOwn +
    pages.handledByPerson +
    pages.handedOff +
    pages.holdTimeRanOut +
    pages.pageNowPressed
  );
}

export function getVerifiedFixCount(outcomes: AiOutcomes): number {
  return (
    (outcomes.remediationFixes?.verified || 0) +
    (outcomes.pullRequestFixes?.verified || 0)
  );
}

// Fixes whose check finished: verified, failed or regressed.
export function getCheckedFixCount(outcomes: AiOutcomes): number {
  return (
    getVerifiedFixCount(outcomes) +
    (outcomes.remediationFixes?.failed || 0) +
    (outcomes.pullRequestFixes?.regressed || 0)
  );
}

// Fixes still being checked: started, or shipped and watched.
export function getFixesBeingCheckedCount(outcomes: AiOutcomes): number {
  return (
    (outcomes.remediationFixes?.pending || 0) +
    (outcomes.pullRequestFixes?.watching || 0) +
    (outcomes.pullRequestFixes?.awaitingDeploy || 0)
  );
}

// Fixes nothing could check.
export function getUncheckableFixCount(outcomes: AiOutcomes): number {
  return (
    (outcomes.remediationFixes?.skipped || 0) +
    (outcomes.pullRequestFixes?.unverifiable || 0)
  );
}

// Investigations judged one way or another.
export function getJudgedRootCauseCount(
  rootCauses: AiOutcomesRootCauses,
): number {
  return rootCauses.confirmed + rootCauses.partial + rootCauses.wrong;
}

/*
 * The changes OneUptime AI made for Data Security issues: proven, waiting
 * for the issue's check, or undone - not the ones it could not make, which
 * changed nothing.
 */
export function getDataSecurityChangesMadeCount(
  changes: AiOutcomesDataSecurityChanges,
): number {
  return changes.proven + changes.waiting + changes.undone;
}

// Proposals a person approved or dismissed.
export function getDataSecurityProposalsDecidedCount(
  proposals: AiOutcomesDataSecurityProposals,
): number {
  return proposals.approved + proposals.dismissed;
}
