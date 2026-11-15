import { describe, expect, test } from "@jest/globals";
import {
  AI_OUTCOMES_PATH,
  AI_OUTCOMES_SCAN_LIMIT,
  AI_OUTCOMES_WEEK_COUNT,
  AiOutcomes,
  AiOutcomesPages,
  AiOutcomesPullRequestFixes,
  AiOutcomesRemediationFixes,
  getCheckedFixCount,
  getFixesBeingCheckedCount,
  getHeldPageCount,
  getJudgedRootCauseCount,
  getUncheckableFixCount,
  getVerifiedFixCount,
} from "../../../Types/AI/AiOutcomes";

/*
 * The AI Results page's shared shape (issue #6800): the totals it shows
 * come from these helpers, so each one is held here - and every fix lands
 * in exactly one of checked, being checked or uncheckable, so the page's
 * "N of M" never loses or double counts one.
 */

const PAGES: AiOutcomesPages = {
  resolvedByAi: 1,
  recoveredOnItsOwn: 2,
  handledByPerson: 4,
  handedOff: 8,
  holdTimeRanOut: 16,
  pageNowPressed: 32,
  holding: 64,
};

const REMEDIATION_FIXES: AiOutcomesRemediationFixes = {
  verified: 1,
  failed: 2,
  pending: 4,
  skipped: 8,
};

const PULL_REQUEST_FIXES: AiOutcomesPullRequestFixes = {
  verified: 16,
  regressed: 32,
  watching: 64,
  awaitingDeploy: 128,
  unverifiable: 256,
};

function outcomes(overrides: Partial<AiOutcomes> = {}): AiOutcomes {
  return {
    windowStart: "2026-08-22T00:00:00.000Z",
    windowEnd: "2026-11-13T15:00:00.000Z",
    pages: null,
    remediationFixes: null,
    pullRequestFixes: null,
    rootCauses: null,
    weeks: [],
    isPartial: false,
    ...overrides,
  };
}

describe("the page's call and its limits", () => {
  test("POST /ai-activity/outcomes, twelve weeks, at most 5000 rows of a kind", () => {
    expect(AI_OUTCOMES_PATH).toBe("/ai-activity/outcomes");
    expect(AI_OUTCOMES_WEEK_COUNT).toBe(12);
    expect(AI_OUTCOMES_SCAN_LIMIT).toBe(5000);
  });
});

describe("getHeldPageCount", () => {
  test("every finished outcome, and not the pages still held", () => {
    // 1 + 2 + 4 + 8 + 16 + 32: every bit but holding's 64.
    expect(getHeldPageCount(PAGES)).toBe(63);
  });

  test("pages still held only: none finished", () => {
    expect(
      getHeldPageCount({
        resolvedByAi: 0,
        recoveredOnItsOwn: 0,
        handledByPerson: 0,
        handedOff: 0,
        holdTimeRanOut: 0,
        pageNowPressed: 0,
        holding: 9,
      }),
    ).toBe(0);
  });
});

describe("fix counts", () => {
  test("verified: both kinds' verified", () => {
    expect(
      getVerifiedFixCount(
        outcomes({
          remediationFixes: REMEDIATION_FIXES,
          pullRequestFixes: PULL_REQUEST_FIXES,
        }),
      ),
    ).toBe(17);
  });

  test("checked: verified, failed and regressed", () => {
    expect(
      getCheckedFixCount(
        outcomes({
          remediationFixes: REMEDIATION_FIXES,
          pullRequestFixes: PULL_REQUEST_FIXES,
        }),
      ),
    ).toBe(1 + 2 + 16 + 32);
  });

  test("being checked: pending, watching and awaiting deploy", () => {
    expect(
      getFixesBeingCheckedCount(
        outcomes({
          remediationFixes: REMEDIATION_FIXES,
          pullRequestFixes: PULL_REQUEST_FIXES,
        }),
      ),
    ).toBe(4 + 64 + 128);
  });

  test("uncheckable: skipped and unverifiable", () => {
    expect(
      getUncheckableFixCount(
        outcomes({
          remediationFixes: REMEDIATION_FIXES,
          pullRequestFixes: PULL_REQUEST_FIXES,
        }),
      ),
    ).toBe(8 + 256);
  });

  test("every fix lands in exactly one of checked, being checked or uncheckable", () => {
    const both: AiOutcomes = outcomes({
      remediationFixes: REMEDIATION_FIXES,
      pullRequestFixes: PULL_REQUEST_FIXES,
    });

    // Every bit from 1 to 256 once: 511.
    expect(
      getCheckedFixCount(both) +
        getFixesBeingCheckedCount(both) +
        getUncheckableFixCount(both),
    ).toBe(511);
  });

  test.each([
    ["only the fixes AI ran", REMEDIATION_FIXES, null, [1, 3, 4, 8]],
    [
      "only the fix pull requests",
      null,
      PULL_REQUEST_FIXES,
      [16, 48, 192, 256],
    ],
    ["neither", null, null, [0, 0, 0, 0]],
  ] as Array<
    [
      string,
      AiOutcomesRemediationFixes | null,
      AiOutcomesPullRequestFixes | null,
      Array<number>,
    ]
  >)(
    "%s readable: the other kind counts as none",
    (
      _name: string,
      remediationFixes: AiOutcomesRemediationFixes | null,
      pullRequestFixes: AiOutcomesPullRequestFixes | null,
      expected: Array<number>,
    ) => {
      const readable: AiOutcomes = outcomes({
        remediationFixes,
        pullRequestFixes,
      });

      expect([
        getVerifiedFixCount(readable),
        getCheckedFixCount(readable),
        getFixesBeingCheckedCount(readable),
        getUncheckableFixCount(readable),
      ]).toEqual(expected);
    },
  );
});

describe("getJudgedRootCauseCount", () => {
  test("confirmed, partly right and wrong - not the unjudged, and people's judgements are already among them", () => {
    expect(
      getJudgedRootCauseCount({
        confirmed: 3,
        partial: 5,
        wrong: 7,
        judgedByPeople: 9,
        completed: 100,
      }),
    ).toBe(15);
  });
});
