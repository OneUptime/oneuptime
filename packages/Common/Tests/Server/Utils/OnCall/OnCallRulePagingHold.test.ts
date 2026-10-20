import OnCallRulePagingHoldUtil, {
  OnCallRulePagingHold,
  OnCallRulePagingHolds,
  OnCallRuleWhenToPageSettings,
} from "../../../../Server/Utils/OnCall/OnCallRulePagingHold";
import logger from "../../../../Server/Utils/Logger";
import OnCallRuleWhenToPage from "../../../../Types/OnCallDutyPolicy/OnCallRuleWhenToPage";
import RestrictionTimes, {
  RestrictionType,
} from "../../../../Types/OnCallDutyPolicy/RestrictionTimes";
import WorkingHours from "../../../../Types/OnCallDutyPolicy/WorkingHours";
import { afterEach, describe, expect, jest, test } from "@jest/globals";
import moment from "moment-timezone";

/*
 * WHEN THE POLICIES AN ON-CALL RULE ADDS MAY PAGE.
 *
 * A rule that pages right away holds nothing. A rule that pages only during
 * working hours holds what it starts outside them until they begin, and
 * says so in the words the run shows; inside them it pages right away. Two
 * rules that page one policy for a record: right away wins, and of two that
 * wait, the one whose hours begin first.
 */

const LONDON: string = "Europe/London";

function at(wallClock: string, timezone: string = LONDON): Date {
  return moment.tz(wallClock, "YYYY-MM-DD HH:mm", timezone).toDate();
}

// A daily window, typed on a winter day.
function daily(from: string, to: string, timezone: string): RestrictionTimes {
  const hours: RestrictionTimes = new RestrictionTimes();
  hours.restictionType = RestrictionType.Daily;
  hours.dayRestrictionTimes = {
    startTime: at(`2026-01-15 ${from}`, timezone),
    endTime: at(`2026-01-15 ${to}`, timezone),
  };
  return hours;
}

function rightAway(): OnCallRuleWhenToPageSettings {
  return { whenToPage: OnCallRuleWhenToPage.RightAway };
}

function workingHours(
  from: string = "09:00",
  to: string = "17:00",
  timezone: string = LONDON,
): OnCallRuleWhenToPageSettings {
  return {
    whenToPage: OnCallRuleWhenToPage.WorkingHours,
    workingHours: daily(from, to, timezone),
    workingHoursTimezone: timezone,
  };
}

afterEach(() => {
  jest.restoreAllMocks();
});

describe("the hold one rule puts on its policies", () => {
  const night: Date = at("2026-10-20 02:00");

  test("a rule that pages right away holds nothing", () => {
    expect(OnCallRulePagingHoldUtil.getHold(rightAway(), night)).toBeNull();
  });

  test("a rule that says nothing about when it pages - one saved before it could - holds nothing", () => {
    expect(OnCallRulePagingHoldUtil.getHold({}, night)).toBeNull();
  });

  test("a working-hours rule at night holds its policies until the morning, and says so", () => {
    const hold: OnCallRulePagingHold | null = OnCallRulePagingHoldUtil.getHold(
      workingHours(),
      night,
    );

    expect(hold?.pagingStartsAt).toEqual(at("2026-10-20 09:00"));
    expect(hold?.waitingStatusMessage).toBe(
      "Waiting for working hours: paging starts at 09:00 (Europe/London).",
    );
  });

  test("on a Friday night, the message names the Monday", () => {
    const hold: OnCallRulePagingHold | null = OnCallRulePagingHoldUtil.getHold(
      {
        whenToPage: OnCallRuleWhenToPage.WorkingHours,
        workingHours: WorkingHours.getDefaultHours({
          timezone: LONDON,
          now: at("2026-10-23 12:00"),
        }),
        workingHoursTimezone: LONDON,
      },
      at("2026-10-23 22:00"),
    );

    expect(hold?.pagingStartsAt).toEqual(at("2026-10-26 09:00"));
    expect(hold?.waitingStatusMessage).toBe(
      "Waiting for working hours: paging starts at 09:00 on Mon, Oct 26 (Europe/London).",
    );
  });

  test("a working-hours rule inside its hours pages right away", () => {
    expect(
      OnCallRulePagingHoldUtil.getHold(workingHours(), at("2026-10-20 11:00")),
    ).toBeNull();
  });

  test("tells the moment in the rule's own time zone", () => {
    const hold: OnCallRulePagingHold | null = OnCallRulePagingHoldUtil.getHold(
      workingHours("09:00", "17:00", "America/New_York"),
      new Date("2026-10-20T06:00:00Z"),
    );

    expect(hold?.pagingStartsAt.toISOString()).toBe("2026-10-20T13:00:00.000Z");
    expect(hold?.waitingStatusMessage).toBe(
      "Waiting for working hours: paging starts at 09:00 (America/New_York).",
    );
  });

  test.each([
    [
      "with no hours",
      {
        whenToPage: OnCallRuleWhenToPage.WorkingHours,
        workingHoursTimezone: LONDON,
      },
    ],
    ["whose window ends where it starts", workingHours("09:00", "09:00")],
    [
      "in a time zone OneUptime does not know",
      {
        whenToPage: OnCallRuleWhenToPage.WorkingHours,
        workingHours: daily("09:00", "17:00", LONDON),
        workingHoursTimezone: "Nowhere/Nothing",
      },
    ],
  ] as Array<[string, OnCallRuleWhenToPageSettings]>)(
    "a working-hours rule %s pages right away, rather than never, and the log says why",
    (_name: string, rule: OnCallRuleWhenToPageSettings) => {
      const warn: jest.SpiedFunction<typeof logger.warn> = jest
        .spyOn(logger, "warn")
        .mockImplementation((() => {
          return undefined;
        }) as never);

      expect(OnCallRulePagingHoldUtil.getHold(rule, night)).toBeNull();
      expect(warn).toHaveBeenCalledTimes(1);
      expect(String(warn.mock.calls[0]![0])).toContain("Paging right away.");
    },
  );
});

describe("two rules that page one policy", () => {
  const morning: OnCallRulePagingHold = {
    pagingStartsAt: at("2026-10-20 09:00"),
    waitingStatusMessage: "morning",
  };
  const afternoon: OnCallRulePagingHold = {
    pagingStartsAt: at("2026-10-20 13:00"),
    waitingStatusMessage: "afternoon",
  };

  test("right away wins, whichever comes first", () => {
    expect(OnCallRulePagingHoldUtil.getEarliest(null, morning)).toBeNull();
    expect(OnCallRulePagingHoldUtil.getEarliest(morning, null)).toBeNull();
  });

  test("of two that wait, the one whose hours begin first", () => {
    expect(OnCallRulePagingHoldUtil.getEarliest(afternoon, morning)).toBe(
      morning,
    );
    expect(OnCallRulePagingHoldUtil.getEarliest(morning, afternoon)).toBe(
      morning,
    );
  });
});

describe("the holds of a record's rules", () => {
  const night: Date = at("2026-10-20 02:00");

  test("a policy only a working-hours rule pages is held", () => {
    const holds: OnCallRulePagingHolds = new OnCallRulePagingHolds(night);
    holds.addRule(workingHours(), ["policy-a"]);

    expect([...holds.getHolds(["policy-a"]).keys()]).toEqual(["policy-a"]);
  });

  test("a policy a right-away rule pages too pages right away, in either order", () => {
    const first: OnCallRulePagingHolds = new OnCallRulePagingHolds(night);
    first.addRule(workingHours(), ["policy-a"]);
    first.addRule(rightAway(), ["policy-a"]);

    const second: OnCallRulePagingHolds = new OnCallRulePagingHolds(night);
    second.addRule(rightAway(), ["policy-a"]);
    second.addRule(workingHours(), ["policy-a"]);

    expect(first.getHolds(["policy-a"]).size).toBe(0);
    expect(second.getHolds(["policy-a"]).size).toBe(0);
  });

  test("of two working-hours rules, the one whose hours begin first holds the policy", () => {
    const holds: OnCallRulePagingHolds = new OnCallRulePagingHolds(night);
    holds.addRule(workingHours("10:00", "18:00"), ["policy-a"]);
    holds.addRule(workingHours("07:00", "15:00"), ["policy-a"]);

    expect(
      holds.getHolds(["policy-a"]).get("policy-a")?.pagingStartsAt,
    ).toEqual(at("2026-10-20 07:00"));
  });

  test("each policy is held by the rules that page it, not by the others'", () => {
    const holds: OnCallRulePagingHolds = new OnCallRulePagingHolds(night);
    holds.addRule(workingHours(), ["policy-a", "policy-b"]);
    holds.addRule(rightAway(), ["policy-b"]);

    expect([...holds.getHolds(["policy-a", "policy-b"]).keys()]).toEqual([
      "policy-a",
    ]);
  });

  test("only the policies the rules added are held: one the record had pages as it always has", () => {
    const holds: OnCallRulePagingHolds = new OnCallRulePagingHolds(night);
    holds.addRule(workingHours(), ["policy-a", "policy-b"]);

    // policy-b was the record's before its rules ran.
    expect([...holds.getHolds(["policy-a"]).keys()]).toEqual(["policy-a"]);
  });
});
