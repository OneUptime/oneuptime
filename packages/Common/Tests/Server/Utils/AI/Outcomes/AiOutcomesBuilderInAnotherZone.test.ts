/** @timezone Pacific/Auckland */
import AiOutcomesBuilder from "../../../../../Server/Utils/AI/Outcomes/AiOutcomesBuilder";
import { AiOutcomes, AiOutcomesWeek } from "../../../../../Types/AI/AiOutcomes";
import { OnCallPolicyAiHoldOutcome } from "../../../../../Types/OnCallDutyPolicy/OnCallPolicyAiHold";
import { describe, expect, test } from "@jest/globals";

/*
 * The AI Results window is UTC days whatever zone the server runs in
 * (AiOutcomesBuilder.test.ts holds it in UTC). Auckland is a day ahead of
 * UTC for half of every UTC day, and its clocks went forward on 27 Sep
 * 2026, inside the window - so a server there that read its own clock's
 * day, or counted local days, would open the window a day late or make a
 * week 23 hours short.
 */

const DAY: number = 24 * 60 * 60 * 1000;
const WEEK: number = 7 * DAY;

// 04:00 on Saturday 14 Nov in Auckland; still Friday 13 Nov in UTC.
const NOW: Date = new Date("2026-11-13T15:00:00.000Z");

function currentZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone;
}

function weekStarts(outcomes: AiOutcomes): Array<string> {
  return outcomes.weeks.map((week: AiOutcomesWeek): string => {
    return week.weekStart;
  });
}

describe("AI Results' weeks on a server in Pacific/Auckland", () => {
  test("this file runs in Pacific/Auckland: UTC+13 in November, UTC+12 in August", () => {
    expect(currentZone()).toBe("Pacific/Auckland");
    expect(NOW.getTimezoneOffset()).toBe(-13 * 60);
    expect(new Date("2026-08-22T00:00:00.000Z").getTimezoneOffset()).toBe(
      -12 * 60,
    );
    // Here it is already Saturday the 14th.
    expect(NOW.getDate()).toBe(14);
    expect(NOW.getUTCDate()).toBe(13);
  });

  test("the window opens at UTC midnight of UTC's day, not Auckland's", () => {
    expect(AiOutcomesBuilder.getWindowStart(NOW).toISOString()).toBe(
      "2026-08-22T00:00:00.000Z",
    );
  });

  test.each([
    // Auckland's midnight starting the 14th is 11:00 UTC on the 13th.
    ["2026-11-13T11:00:00.000Z", "2026-08-22T00:00:00.000Z"],
    // UTC's midnight starting the 14th is 13:00 in Auckland.
    ["2026-11-14T00:00:00.000Z", "2026-08-23T00:00:00.000Z"],
    // Just before it.
    ["2026-11-13T23:59:59.999Z", "2026-08-22T00:00:00.000Z"],
  ])("at %s it opens at %s", (now: string, expectedStart: string) => {
    expect(AiOutcomesBuilder.getWindowStart(new Date(now)).toISOString()).toBe(
      expectedStart,
    );
  });

  test("its weeks are UTC Saturdays, seven 24-hour days apart across Auckland's clock change", () => {
    const outcomes: AiOutcomes = AiOutcomesBuilder.build({
      now: NOW,
      pageRows: null,
      remediationRows: null,
      pullRequestRows: null,
      investigationRows: null,
      isPartial: false,
    });

    expect(weekStarts(outcomes)).toEqual([
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
    ]);
    for (let index: number = 1; index < outcomes.weeks.length; index++) {
      expect(
        Date.parse(`${outcomes.weeks[index]!.weekStart}T00:00:00.000Z`) -
          Date.parse(`${outcomes.weeks[index - 1]!.weekStart}T00:00:00.000Z`),
      ).toBe(WEEK);
    }
  });

  test("a page counts in the UTC week it was held in, whatever the date was in Auckland", () => {
    const outcomes: AiOutcomes = AiOutcomesBuilder.build({
      now: NOW,
      pageRows: [
        // 11:00 on 22 Aug in Auckland, but 23:00 on the 21st in UTC: before the window.
        {
          createdAt: new Date("2026-08-21T23:00:00.000Z"),
          outcome: OnCallPolicyAiHoldOutcome.ResolvedByAI,
        },
        // The window's first moment, noon in Auckland.
        {
          createdAt: new Date("2026-08-22T00:00:00.000Z"),
          outcome: OnCallPolicyAiHoldOutcome.ResolvedByAI,
        },
        /*
         * 2026-10-03T05:00Z is 18:00 on Saturday 3 Oct in Auckland (UTC+13
         * since 27 Sep): week 6, which starts on the 3rd in UTC.
         */
        {
          createdAt: new Date("2026-10-03T05:00:00.000Z"),
          outcome: OnCallPolicyAiHoldOutcome.HandedOff,
        },
        /*
         * 2026-10-02T23:59Z is already Saturday 3 Oct in Auckland, but
         * still Friday in UTC: week 5.
         */
        {
          createdAt: new Date("2026-10-02T23:59:00.000Z"),
          outcome: OnCallPolicyAiHoldOutcome.HandedOff,
        },
      ],
      remediationRows: null,
      pullRequestRows: null,
      investigationRows: null,
      isPartial: false,
    });

    expect(
      outcomes.weeks.map((week: AiOutcomesWeek): number => {
        return week.pagesHeld;
      }),
    ).toEqual([1, 0, 0, 0, 0, 1, 1, 0, 0, 0, 0, 0]);
    expect(outcomes.pages!.resolvedByAi).toBe(1);
    expect(outcomes.pages!.handedOff).toBe(2);
    expect(outcomes.windowStart).toBe("2026-08-22T00:00:00.000Z");
    expect(outcomes.windowEnd).toBe("2026-11-13T15:00:00.000Z");
  });
});
