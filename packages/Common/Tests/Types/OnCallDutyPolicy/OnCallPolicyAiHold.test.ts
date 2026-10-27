import {
  AI_HOLD_TIME_DEFAULT_IN_MINUTES,
  AI_HOLD_TIME_MAX_IN_MINUTES,
  AI_HOLD_TIME_MIN_IN_MINUTES,
  AiHoldHandOffReason,
  OnCallPolicyAiHoldOutcome,
  getAiHoldTimeInMinutes,
  isAiHoldOver,
  isAiHoldPaged,
} from "../../../Types/OnCallDutyPolicy/OnCallPolicyAiHold";
import {
  ON_CALL_POLICY_RUN_STARTED_EARLY_REASON_MAX_LENGTH,
  ON_CALL_POLICY_RUN_WAITING_FOR_ONEUPTIME_AI_MESSAGE_START,
  getOnCallPolicyRunWaitingMessage,
  isOnCallPolicyRunWaitingForOneUptimeAI,
  isOnCallPolicyRunWaitingForWorkingHours,
} from "../../../Types/OnCallDutyPolicy/OnCallDutyPolicyRunWait";
import OnCallRuleWhenToPage from "../../../Types/OnCallDutyPolicy/OnCallRuleWhenToPage";
import { describe, expect, test } from "@jest/globals";

/*
 * ONEUPTIME AI RESPONDS FIRST: what a held run is (OnCallPolicyAiHold).
 *
 * A rule's hold time is whole minutes from 1 to 30, 10 when it names none,
 * however it was written. A held run says it waits for OneUptime AI, and the
 * words it says when AI hands it to people fit the run's column.
 */

describe("the hold time a rule gives", () => {
  test("a rule that names none holds for the default, 10 minutes", () => {
    expect(AI_HOLD_TIME_DEFAULT_IN_MINUTES).toBe(10);
    expect(getAiHoldTimeInMinutes(undefined)).toBe(10);
    expect(getAiHoldTimeInMinutes(null)).toBe(10);
  });

  test("a number that is not one holds for the default", () => {
    expect(getAiHoldTimeInMinutes(Number.NaN)).toBe(10);
    expect(getAiHoldTimeInMinutes(Number.POSITIVE_INFINITY)).toBe(10);
  });

  test("whole minutes within the bounds are kept", () => {
    for (
      let minutes: number = AI_HOLD_TIME_MIN_IN_MINUTES;
      minutes <= AI_HOLD_TIME_MAX_IN_MINUTES;
      minutes++
    ) {
      expect(getAiHoldTimeInMinutes(minutes)).toBe(minutes);
    }
  });

  test("a value written outside the bounds never holds a page longer than 30 minutes, or for nothing", () => {
    expect(getAiHoldTimeInMinutes(0)).toBe(1);
    expect(getAiHoldTimeInMinutes(-5)).toBe(1);
    expect(getAiHoldTimeInMinutes(31)).toBe(30);
    expect(getAiHoldTimeInMinutes(24 * 60)).toBe(30);
  });

  test("a fraction is rounded to whole minutes", () => {
    expect(getAiHoldTimeInMinutes(4.4)).toBe(4);
    expect(getAiHoldTimeInMinutes(4.5)).toBe(5);
    expect(getAiHoldTimeInMinutes(0.2)).toBe(1);
  });
});

describe("how a hold ended", () => {
  test("a run still held is not over", () => {
    expect(isAiHoldOver(OnCallPolicyAiHoldOutcome.Holding)).toBe(false);
    expect(isAiHoldOver(undefined)).toBe(false);
    expect(isAiHoldOver(null)).toBe(false);
  });

  test("every other outcome is an ended hold", () => {
    for (const outcome of Object.values(OnCallPolicyAiHoldOutcome)) {
      if (outcome === OnCallPolicyAiHoldOutcome.Holding) {
        continue;
      }

      expect(isAiHoldOver(outcome)).toBe(true);
    }
  });

  test("handed off, its time run out, and Page now page people; the rest page nobody", () => {
    expect(isAiHoldPaged(OnCallPolicyAiHoldOutcome.HandedOff)).toBe(true);
    expect(isAiHoldPaged(OnCallPolicyAiHoldOutcome.HoldTimeRanOut)).toBe(true);
    expect(isAiHoldPaged(OnCallPolicyAiHoldOutcome.PageNowPressed)).toBe(true);

    expect(isAiHoldPaged(OnCallPolicyAiHoldOutcome.ResolvedByAI)).toBe(false);
    expect(isAiHoldPaged(OnCallPolicyAiHoldOutcome.RecoveredOnItsOwn)).toBe(
      false,
    );
    expect(isAiHoldPaged(OnCallPolicyAiHoldOutcome.HandledByPerson)).toBe(
      false,
    );
    expect(isAiHoldPaged(OnCallPolicyAiHoldOutcome.Holding)).toBe(false);
  });

  test("the stored values never change: they are the database contract", () => {
    expect(Object.values(OnCallPolicyAiHoldOutcome)).toEqual([
      "Holding",
      "Resolved by AI",
      "Recovered on its own",
      "Handled by a person",
      "Handed off",
      "Hold time ran out",
      "Page now pressed",
    ]);
    expect(OnCallRuleWhenToPage.AfterOneUptimeAI).toBe("After OneUptime AI");
  });
});

describe("why OneUptime AI handed a page to people", () => {
  test("an investigation that could not run says why, once, with one full stop", () => {
    expect(
      AiHoldHandOffReason.investigationSkipped({
        recordKind: "incident",
        why: "AI credits ran out.",
      }),
    ).toBe(
      "OneUptime AI could not investigate this incident: AI credits ran out.",
    );

    expect(
      AiHoldHandOffReason.investigationSkipped({
        recordKind: "alert",
        why: "Project AI was turned off at creation...",
      }),
    ).toBe(
      "OneUptime AI could not investigate this alert: Project AI was turned off at creation.",
    );
  });

  test("an investigation that could not run, for no reason it recorded, says only that", () => {
    expect(
      AiHoldHandOffReason.investigationSkipped({
        recordKind: "incident",
        why: "  ",
      }),
    ).toBe("OneUptime AI could not investigate this incident.");
  });

  test("an AI rule's wait says its minutes", () => {
    expect(AiHoldHandOffReason.investigationWaits({ waitMinutes: 1 })).toBe(
      "An AI rule waits 1 minute before OneUptime AI investigates.",
    );
    expect(AiHoldHandOffReason.investigationWaits({ waitMinutes: 15 })).toBe(
      "An AI rule waits 15 minutes before OneUptime AI investigates.",
    );
  });

  test("Page now names who pressed it, or says someone did", () => {
    expect(AiHoldHandOffReason.pageNow({ userName: "Sam Doe" })).toBe(
      "Sam Doe pressed Page now.",
    );
    expect(AiHoldHandOffReason.pageNow({ userName: undefined })).toBe(
      "Someone pressed Page now.",
    );
    expect(AiHoldHandOffReason.pageNow({ userName: "  " })).toBe(
      "Someone pressed Page now.",
    );
  });

  test("each switch, rule and guard says what changed", () => {
    expect(AiHoldHandOffReason.noFixToRun()).toBe(
      "OneUptime AI found no fix it may run on its own.",
    );
    expect(AiHoldHandOffReason.fixNeedsApproval()).toBe(
      "OneUptime AI's fix needs a person to approve it.",
    );
    expect(AiHoldHandOffReason.fixDidNotHold()).toBe(
      "OneUptime AI's fix did not bring the monitors back.",
    );
    expect(AiHoldHandOffReason.noMonitorToCheck()).toBe(
      "OneUptime AI has no monitor to check its fix against.",
    );
    expect(AiHoldHandOffReason.aiTurnedOff()).toBe(
      "OneUptime AI was turned off for this project.",
    );
    expect(
      AiHoldHandOffReason.automaticFixingTurnedOff({ recordKind: "alert" }),
    ).toBe("Fixing new alerts automatically was turned off.");
    expect(AiHoldHandOffReason.ruleChanged()).toBe(
      "The on-call rule no longer lets OneUptime AI respond first.",
    );
    expect(
      AiHoldHandOffReason.outage({ recordCount: 4, windowMinutes: 5 }),
    ).toBe(
      "4 alerts and incidents opened within 5 minutes, which looks like an outage.",
    );
    expect(
      AiHoldHandOffReason.highestSeverity({ recordKind: "incident" }),
    ).toBe("The incident now has the project's highest severity.");
  });

  test("every reason fits the column a run keeps it in", () => {
    const reasons: Array<string> = [
      AiHoldHandOffReason.investigationSkipped({
        recordKind: "incident",
        why: "x".repeat(400),
      }),
      AiHoldHandOffReason.noFixToRun(),
      AiHoldHandOffReason.fixNeedsApproval(),
      AiHoldHandOffReason.fixDidNotHold(),
      AiHoldHandOffReason.noMonitorToCheck(),
      AiHoldHandOffReason.pageNow({ userName: "A".repeat(100) }),
      AiHoldHandOffReason.outage({ recordCount: 1000, windowMinutes: 5 }),
    ];

    for (const reason of reasons) {
      expect(reason.length).toBeLessThanOrEqual(
        ON_CALL_POLICY_RUN_STARTED_EARLY_REASON_MAX_LENGTH,
      );
    }
  });
});

describe("what a held run says while it waits", () => {
  const now: Date = new Date("2026-10-20T02:00:00Z");
  const pagingStartsAt: Date = new Date("2026-10-20T02:10:00Z");

  test("it says OneUptime AI holds it, when paging starts, and that AI may resolve it first", () => {
    const message: string = getOnCallPolicyRunWaitingMessage({
      pagingStartsAt: pagingStartsAt,
      timezone: "UTC",
      now: now,
      isWaitingForWorkingHours: false,
      isWaitingForOneUptimeAI: true,
    });

    expect(
      message.startsWith(
        ON_CALL_POLICY_RUN_WAITING_FOR_ONEUPTIME_AI_MESSAGE_START,
      ),
    ).toBe(true);
    expect(message).toContain("Paging starts");
    expect(message).toContain("02:10");
    expect(message.endsWith("unless it resolves this.")).toBe(true);
  });

  test("a held run is told apart from one waiting for working hours, by how its message starts", () => {
    const aiMessage: string = getOnCallPolicyRunWaitingMessage({
      pagingStartsAt: pagingStartsAt,
      now: now,
      isWaitingForWorkingHours: false,
      isWaitingForOneUptimeAI: true,
    });
    const hoursMessage: string = getOnCallPolicyRunWaitingMessage({
      pagingStartsAt: pagingStartsAt,
      now: now,
      isWaitingForWorkingHours: true,
    });

    expect(isOnCallPolicyRunWaitingForOneUptimeAI(aiMessage)).toBe(true);
    expect(isOnCallPolicyRunWaitingForWorkingHours(aiMessage)).toBe(false);
    expect(isOnCallPolicyRunWaitingForOneUptimeAI(hoursMessage)).toBe(false);
    expect(isOnCallPolicyRunWaitingForOneUptimeAI(undefined)).toBe(false);
    expect(isOnCallPolicyRunWaitingForOneUptimeAI(null)).toBe(false);
  });

  test("the words of every other wait are as they were", () => {
    expect(
      getOnCallPolicyRunWaitingMessage({
        pagingStartsAt: pagingStartsAt,
        timezone: "UTC",
        now: now,
        isWaitingForWorkingHours: false,
      }).startsWith("Waiting. Paging starts"),
    ).toBe(true);
    expect(
      getOnCallPolicyRunWaitingMessage({
        pagingStartsAt: pagingStartsAt,
        timezone: "UTC",
        now: now,
        isWaitingForWorkingHours: true,
      }).startsWith("Waiting for working hours. Paging starts"),
    ).toBe(true);
  });
});
