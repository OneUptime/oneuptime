import { AiOutcomes, AiOutcomesWeek } from "../../../Types/AI/AiOutcomes";
import { JSONObject } from "../../../Types/JSON";

/*
 * The AI Results suites' outcomes (Settings → AI → AI Results, issue
 * #6800): twelve weeks from Saturday 22 Aug 2026, as the server counts
 * them, whose weeks add up to the parts' totals the way
 * AiOutcomesBuilder's do.
 *
 *   Pages Avoided         17 of 35 held pages, 2 still held
 *   Fixes Verified        11 of 16 checked fixes (7 of 10 run, 4 of 6 PRs)
 *   Root Causes Confirmed 11 of 16 judged, 6 by a responder, 20 finished
 */

export const AI_RESULTS_WEEK_STARTS: Array<string> = [
  "2026-08-22",
  "2026-08-29",
  "2026-09-05",
  "2026-09-12",
  "2026-09-19",
  "2026-09-26",
  "2026-10-03",
  "2026-10-10",
  "2026-10-17",
  "2026-10-24",
  "2026-10-31",
  "2026-11-07",
];

export const PAGES_HELD_BY_WEEK: Array<number> = [
  2, 3, 1, 0, 4, 2, 3, 5, 2, 4, 6, 3,
];
export const PAGES_AVOIDED_BY_WEEK: Array<number> = [
  0, 1, 0, 0, 1, 1, 2, 2, 1, 3, 4, 2,
];
export const FIXES_CHECKED_BY_WEEK: Array<number> = [
  1, 0, 2, 1, 0, 2, 1, 3, 2, 2, 1, 1,
];
export const FIXES_VERIFIED_BY_WEEK: Array<number> = [
  1, 0, 1, 0, 0, 1, 1, 2, 2, 1, 1, 1,
];
export const ROOT_CAUSES_JUDGED_BY_WEEK: Array<number> = [
  0, 1, 1, 2, 1, 0, 2, 1, 3, 2, 2, 1,
];
export const ROOT_CAUSES_CONFIRMED_BY_WEEK: Array<number> = [
  0, 0, 1, 1, 1, 0, 1, 1, 2, 2, 1, 1,
];

export function makeWeeks(
  counts: Partial<
    Record<keyof Omit<AiOutcomesWeek, "weekStart">, Array<number>>
  > = {},
): Array<AiOutcomesWeek> {
  return AI_RESULTS_WEEK_STARTS.map(
    (weekStart: string, index: number): AiOutcomesWeek => {
      return {
        weekStart,
        pagesAvoided: (counts.pagesAvoided || PAGES_AVOIDED_BY_WEEK)[index]!,
        pagesHeld: (counts.pagesHeld || PAGES_HELD_BY_WEEK)[index]!,
        fixesVerified: (counts.fixesVerified || FIXES_VERIFIED_BY_WEEK)[index]!,
        fixesChecked: (counts.fixesChecked || FIXES_CHECKED_BY_WEEK)[index]!,
        rootCausesConfirmed: (counts.rootCausesConfirmed ||
          ROOT_CAUSES_CONFIRMED_BY_WEEK)[index]!,
        rootCausesJudged: (counts.rootCausesJudged ||
          ROOT_CAUSES_JUDGED_BY_WEEK)[index]!,
      };
    },
  );
}

// Twelve weeks of zeros: nothing finished yet.
export function makeQuietWeeks(): Array<AiOutcomesWeek> {
  const zeros: Array<number> = AI_RESULTS_WEEK_STARTS.map((): number => {
    return 0;
  });

  return makeWeeks({
    pagesAvoided: zeros,
    pagesHeld: zeros,
    fixesVerified: zeros,
    fixesChecked: zeros,
    rootCausesConfirmed: zeros,
    rootCausesJudged: zeros,
  });
}

export function makeOutcomes(overrides: Partial<AiOutcomes> = {}): AiOutcomes {
  return {
    windowStart: "2026-08-22T00:00:00.000Z",
    windowEnd: "2026-11-13T15:00:00.000Z",
    pages: {
      resolvedByAi: 17,
      recoveredOnItsOwn: 5,
      handledByPerson: 4,
      handedOff: 6,
      holdTimeRanOut: 2,
      pageNowPressed: 1,
      holding: 2,
    },
    remediationFixes: {
      verified: 7,
      failed: 3,
      pending: 1,
      skipped: 2,
    },
    pullRequestFixes: {
      verified: 4,
      regressed: 2,
      watching: 1,
      awaitingDeploy: 1,
      unverifiable: 1,
    },
    rootCauses: {
      confirmed: 11,
      partial: 2,
      wrong: 3,
      judgedByPeople: 6,
      completed: 20,
    },
    weeks: makeWeeks(),
    isPartial: false,
    ...overrides,
  };
}

// Every part readable, nothing in any of them.
export function makeEmptyOutcomes(
  overrides: Partial<AiOutcomes> = {},
): AiOutcomes {
  return makeOutcomes({
    pages: {
      resolvedByAi: 0,
      recoveredOnItsOwn: 0,
      handledByPerson: 0,
      handedOff: 0,
      holdTimeRanOut: 0,
      pageNowPressed: 0,
      holding: 0,
    },
    remediationFixes: { verified: 0, failed: 0, pending: 0, skipped: 0 },
    pullRequestFixes: {
      verified: 0,
      regressed: 0,
      watching: 0,
      awaitingDeploy: 0,
      unverifiable: 0,
    },
    rootCauses: {
      confirmed: 0,
      partial: 0,
      wrong: 0,
      judgedByPeople: 0,
      completed: 0,
    },
    weeks: makeQuietWeeks(),
    ...overrides,
  });
}

// The outcomes as the server's JSON body carries them.
export function toBody(outcomes: AiOutcomes): JSONObject {
  return JSON.parse(JSON.stringify(outcomes)) as JSONObject;
}
