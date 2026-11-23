import {
  SecurityCaseAiActionKind,
  SecurityCaseAiActionStatus,
} from "../../../Types/SecurityCase/SecurityCaseAi";
import { SecurityCaseAiHoldOutcome } from "../../../Types/SecurityCase/SecurityCaseAiHold";
import {
  SecurityCaseAiDigestActionRow,
  SecurityCaseAiDigestCaseRow,
  SecurityCaseAiWeeklyDigestNumbers,
  computeSecurityCaseAiWeeklyDigest,
  getMedianMinutes,
} from "../../../Utils/SecurityCase/SecurityCaseAiWeeklyDigest";
import { describe, expect, test } from "@jest/globals";

/*
 * "WHAT ONEUPTIME AI DID ON SECURITY CASES THIS WEEK" (#10353): the digest's
 * numbers, over one week, by when each thing happened in it.
 */

const WEEK_START: Date = new Date("2026-11-16T08:00:00.000Z");
const WEEK_END: Date = new Date("2026-11-23T08:00:00.000Z");

// A moment in the week, in hours after it starts.
function inWeek(hours: number, minutes: number = 0): Date {
  return new Date(
    WEEK_START.getTime() + hours * 60 * 60 * 1000 + minutes * 60 * 1000,
  );
}

const BEFORE_WEEK: Date = new Date("2026-11-10T08:00:00.000Z");

function digest(data: {
  cases?: Array<SecurityCaseAiDigestCaseRow>;
  actions?: Array<SecurityCaseAiDigestActionRow>;
}): SecurityCaseAiWeeklyDigestNumbers {
  return computeSecurityCaseAiWeeklyDigest({
    cases: data.cases || [],
    actions: data.actions || [],
    weekStart: WEEK_START,
    weekEnd: WEEK_END,
  });
}

describe("a week OneUptime AI did nothing", () => {
  test("has nothing to say, so no digest is sent", () => {
    expect(digest({})).toEqual({
      casesHeld: 0,
      casesResolvedWithoutPerson: 0,
      casesHandedToPeople: 0,
      casesStoppedByPerson: 0,
      casesContained: 0,
      medianTimeToContainInMinutes: null,
      blocksMade: 0,
      blocksLifted: 0,
      approvalsAsked: 0,
      approvalsAnswered: 0,
      medianApprovalWaitInMinutes: null,
      undoneByPeople: 0,
      hasActivity: false,
    });
  });

  test("what happened before the week, or at its very end, is not counted", () => {
    const numbers: SecurityCaseAiWeeklyDigestNumbers = digest({
      cases: [
        {
          createdAt: BEFORE_WEEK,
          aiHoldOutcome: SecurityCaseAiHoldOutcome.Resolved,
          aiHoldEndedAt: BEFORE_WEEK,
        },
        {
          createdAt: WEEK_END,
          aiHoldOutcome: SecurityCaseAiHoldOutcome.Resolved,
          aiHoldEndedAt: WEEK_END,
        },
      ],
      actions: [
        {
          kind: SecurityCaseAiActionKind.BlockAddress,
          status: SecurityCaseAiActionStatus.Done,
          doneAt: BEFORE_WEEK,
        },
      ],
    });

    expect(numbers.hasActivity).toBe(false);
    expect(numbers.casesHeld).toBe(0);
    expect(numbers.blocksMade).toBe(0);
  });
});

describe("the cases it responded first to", () => {
  test("are counted by how each hold ended: resolved, handed to people, stopped by a person", () => {
    const numbers: SecurityCaseAiWeeklyDigestNumbers = digest({
      cases: [
        {
          createdAt: inWeek(1),
          aiHoldOutcome: SecurityCaseAiHoldOutcome.Resolved,
          aiHoldEndedAt: inWeek(1, 2),
        },
        {
          createdAt: inWeek(2),
          aiHoldOutcome: SecurityCaseAiHoldOutcome.Resolved,
          aiHoldEndedAt: inWeek(2, 3),
        },
        {
          createdAt: inWeek(3),
          aiHoldOutcome: SecurityCaseAiHoldOutcome.NeedsApproval,
          aiHoldEndedAt: inWeek(3, 1),
        },
        {
          createdAt: inWeek(4),
          aiHoldOutcome: SecurityCaseAiHoldOutcome.TimeRanOut,
          aiHoldEndedAt: inWeek(4, 10),
        },
        {
          createdAt: inWeek(5),
          aiHoldOutcome: SecurityCaseAiHoldOutcome.PageNow,
          aiHoldEndedAt: inWeek(5, 1),
        },
        {
          createdAt: inWeek(6),
          aiHoldOutcome: SecurityCaseAiHoldOutcome.TakenByPerson,
          aiHoldEndedAt: inWeek(6, 4),
        },
        // Still held: no end to count yet.
        {
          createdAt: inWeek(7),
          aiHoldOutcome: SecurityCaseAiHoldOutcome.Holding,
          aiHoldEndedAt: null,
        },
      ],
    });

    expect(numbers.casesHeld).toBe(6);
    expect(numbers.casesResolvedWithoutPerson).toBe(2);
    expect(numbers.casesHandedToPeople).toBe(2);
    expect(numbers.casesStoppedByPerson).toBe(2);
    expect(numbers.hasActivity).toBe(true);
  });
});

describe("time to contain", () => {
  test("is the median, over the cases OneUptime AI worked that were contained this week", () => {
    const numbers: SecurityCaseAiWeeklyDigestNumbers = digest({
      cases: [
        { createdAt: inWeek(1), aiTookCaseAt: inWeek(1), containedAt: inWeek(1, 2) },
        { createdAt: inWeek(2), aiTookCaseAt: inWeek(2), containedAt: inWeek(2, 4) },
        { createdAt: inWeek(3), aiTookCaseAt: inWeek(3), containedAt: inWeek(3, 30) },
        // A case nobody let OneUptime AI work is not its time to contain.
        { createdAt: inWeek(4), containedAt: inWeek(4, 1) },
        // Contained before the week.
        {
          createdAt: BEFORE_WEEK,
          aiTookCaseAt: BEFORE_WEEK,
          containedAt: BEFORE_WEEK,
        },
      ],
    });

    expect(numbers.casesContained).toBe(3);
    expect(numbers.medianTimeToContainInMinutes).toBe(4);
  });
});

describe("blocks", () => {
  test("made, and lifted again by a person or by OneUptime AI dismissing a case", () => {
    const numbers: SecurityCaseAiWeeklyDigestNumbers = digest({
      actions: [
        {
          kind: SecurityCaseAiActionKind.BlockAddress,
          status: SecurityCaseAiActionStatus.Done,
          doneAt: inWeek(1),
        },
        // Made, then a person lifted it: made and lifted.
        {
          kind: SecurityCaseAiActionKind.BlockAddress,
          status: SecurityCaseAiActionStatus.Undone,
          doneAt: inWeek(2),
          undoneAt: inWeek(3),
        },
        // Asked, never made.
        {
          kind: SecurityCaseAiActionKind.BlockAddress,
          status: SecurityCaseAiActionStatus.Asked,
          askedAt: inWeek(4),
        },
        {
          kind: SecurityCaseAiActionKind.LiftBlock,
          status: SecurityCaseAiActionStatus.Done,
          doneAt: inWeek(5),
        },
      ],
    });

    expect(numbers.blocksMade).toBe(2);
    expect(numbers.blocksLifted).toBe(2);
  });
});

describe("approvals", () => {
  test("asked of people, how many they answered, and their median wait", () => {
    const numbers: SecurityCaseAiWeeklyDigestNumbers = digest({
      actions: [
        {
          kind: SecurityCaseAiActionKind.BlockAddress,
          status: SecurityCaseAiActionStatus.Done,
          askedAt: inWeek(1),
          decidedAt: inWeek(1, 6),
          doneAt: inWeek(1, 6),
        },
        {
          kind: SecurityCaseAiActionKind.ContainAccount,
          status: SecurityCaseAiActionStatus.Declined,
          askedAt: inWeek(2),
          decidedAt: inWeek(2, 20),
        },
        {
          kind: SecurityCaseAiActionKind.CloseCase,
          status: SecurityCaseAiActionStatus.Asked,
          askedAt: inWeek(3),
        },
      ],
    });

    expect(numbers.approvalsAsked).toBe(3);
    expect(numbers.approvalsAnswered).toBe(2);
    expect(numbers.medianApprovalWaitInMinutes).toBe(13);
  });
});

describe("what a person undid", () => {
  test("is counted when it was undone, a hand-off never", () => {
    const numbers: SecurityCaseAiWeeklyDigestNumbers = digest({
      actions: [
        {
          kind: SecurityCaseAiActionKind.ContainHost,
          status: SecurityCaseAiActionStatus.Undone,
          doneAt: BEFORE_WEEK,
          undoneAt: inWeek(10),
        },
        {
          kind: SecurityCaseAiActionKind.CloseCase,
          status: SecurityCaseAiActionStatus.Undone,
          doneAt: inWeek(11),
          undoneAt: inWeek(12),
        },
        {
          kind: SecurityCaseAiActionKind.ContainAccount,
          status: SecurityCaseAiActionStatus.Undone,
          undoneAt: BEFORE_WEEK,
        },
      ],
    });

    expect(numbers.undoneByPeople).toBe(2);
    expect(numbers.hasActivity).toBe(true);
  });
});

describe("the median", () => {
  test("of an odd and an even count, in whole minutes; none for nothing", () => {
    const MINUTE: number = 60 * 1000;

    expect(getMedianMinutes([])).toBe(null);
    expect(getMedianMinutes([3 * MINUTE, 1 * MINUTE, 2 * MINUTE])).toBe(2);
    expect(getMedianMinutes([1 * MINUTE, 4 * MINUTE])).toBe(3);
  });
});
