/*
 * AI RESULTS (issue #6800): what OneUptime AI's work came to for a project,
 * in outcomes rather than activity - the pages it kept from waking people,
 * the fixes it verified, and the root causes people confirmed - week by
 * week, so a team can see whether it is getting better.
 *
 * Read on the server (Server/Utils/AI/Outcomes/AiOutcomesReader) behind the
 * caller's own read access: a part the caller may not read is null and the
 * page leaves it out. Every number comes with what it is out of, so a page
 * never says "12 pages avoided" without "of 40 held".
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
  // Null: the caller may read neither incidents nor alerts.
  rootCauses: AiOutcomesRootCauses | null;
  // AI_OUTCOMES_WEEK_COUNT weeks, oldest first.
  weeks: Array<AiOutcomesWeek>;
  // A kind of row reached AI_OUTCOMES_SCAN_LIMIT: the newest were counted.
  isPartial: boolean;
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
