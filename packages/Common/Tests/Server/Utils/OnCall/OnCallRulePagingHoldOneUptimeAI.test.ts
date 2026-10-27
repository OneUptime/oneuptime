import OnCallRulePagingHoldUtil, {
  ON_CALL_RULE_WHEN_TO_PAGE_SELECT,
  OnCallRulePagingHold,
  OnCallRulePagingHolds,
  OnCallRuleWhenToPageSettings,
} from "../../../../Server/Utils/OnCall/OnCallRulePagingHold";
import { isOnCallPolicyRunWaitingForOneUptimeAI } from "../../../../Types/OnCallDutyPolicy/OnCallDutyPolicyRunWait";
import OnCallRuleWhenToPage from "../../../../Types/OnCallDutyPolicy/OnCallRuleWhenToPage";
import RestrictionTimes, {
  RestrictionType,
} from "../../../../Types/OnCallDutyPolicy/RestrictionTimes";
import { describe, expect, jest, test } from "@jest/globals";
import moment from "moment-timezone";

jest.mock("../../../../Server/Utils/Logger");

/*
 * AN ON-CALL RULE SET TO AFTER ONEUPTIME AI (OnCallPolicyAiHold).
 *
 * For a record OneUptime AI may respond first to, the rule holds its
 * policies for its hold time, saying OneUptime AI holds them; for any other
 * record - or with nothing said about the record, as for an episode - it
 * pages right away. Beside other rules on the same policy, right away still
 * wins, and of two holds the one that ends first.
 */

const LONDON: string = "Europe/London";
const NIGHT: Date = moment.tz("2026-10-20 02:00", LONDON).toDate();

function aiRule(
  aiHoldTimeInMinutes?: number | null | undefined,
): OnCallRuleWhenToPageSettings {
  return {
    whenToPage: OnCallRuleWhenToPage.AfterOneUptimeAI,
    aiHoldTimeInMinutes: aiHoldTimeInMinutes,
  };
}

function workingHours(): OnCallRuleWhenToPageSettings {
  const hours: RestrictionTimes = new RestrictionTimes();
  hours.restictionType = RestrictionType.Daily;
  hours.dayRestrictionTimes = {
    startTime: moment.tz("2026-01-15 09:00", LONDON).toDate(),
    endTime: moment.tz("2026-01-15 17:00", LONDON).toDate(),
  };

  return {
    whenToPage: OnCallRuleWhenToPage.WorkingHours,
    workingHours: hours,
    workingHoursTimezone: LONDON,
  };
}

function minutesAfter(hold: OnCallRulePagingHold, now: Date): number {
  return (hold.pagingStartsAt.getTime() - now.getTime()) / 60000;
}

describe("the hold an After OneUptime AI rule puts on its policies", () => {
  test("for a record AI may respond first to, it holds for the rule's hold time, as OneUptime AI's hold", () => {
    const hold: OnCallRulePagingHold | null = OnCallRulePagingHoldUtil.getHold(
      aiRule(7),
      NIGHT,
      { canHold: true },
    );

    expect(hold).not.toBeNull();
    expect(minutesAfter(hold!, NIGHT)).toBe(7);
    expect(hold!.isAiHold).toBe(true);
    expect(
      isOnCallPolicyRunWaitingForOneUptimeAI(hold!.waitingStatusMessage),
    ).toBe(true);
  });

  test("a rule that names no hold time holds for 10 minutes", () => {
    for (const minutes of [undefined, null]) {
      const hold: OnCallRulePagingHold | null =
        OnCallRulePagingHoldUtil.getHold(aiRule(minutes), NIGHT, {
          canHold: true,
        });

      expect(minutesAfter(hold!, NIGHT)).toBe(10);
    }
  });

  test("a hold time saved out of bounds is read within them", () => {
    expect(
      minutesAfter(
        OnCallRulePagingHoldUtil.getHold(aiRule(500), NIGHT, {
          canHold: true,
        })!,
        NIGHT,
      ),
    ).toBe(30);
    expect(
      minutesAfter(
        OnCallRulePagingHoldUtil.getHold(aiRule(0), NIGHT, { canHold: true })!,
        NIGHT,
      ),
    ).toBe(1);
  });

  test("for a record AI may not respond first to, it pages right away", () => {
    expect(
      OnCallRulePagingHoldUtil.getHold(aiRule(10), NIGHT, { canHold: false }),
    ).toBeNull();
  });

  test("with nothing said about the record - an episode's rule - it pages right away", () => {
    expect(OnCallRulePagingHoldUtil.getHold(aiRule(10), NIGHT)).toBeNull();
  });

  test("the hold does not depend on working hours: it holds day and night", () => {
    const noon: Date = moment.tz("2026-10-20 12:00", LONDON).toDate();

    expect(
      minutesAfter(
        OnCallRulePagingHoldUtil.getHold(aiRule(5), noon, { canHold: true })!,
        noon,
      ),
    ).toBe(5);
  });

  test("a working-hours rule's hold is never taken for OneUptime AI's", () => {
    const hold: OnCallRulePagingHold | null = OnCallRulePagingHoldUtil.getHold(
      workingHours(),
      NIGHT,
      { canHold: true },
    );

    expect(hold).not.toBeNull();
    expect(hold!.isAiHold).toBeFalsy();
    expect(
      isOnCallPolicyRunWaitingForOneUptimeAI(hold!.waitingStatusMessage),
    ).toBe(false);
  });

  test("a rule engine reads the hold time with the rest of when a rule pages", () => {
    expect(ON_CALL_RULE_WHEN_TO_PAGE_SELECT.aiHoldTimeInMinutes).toBe(true);
  });
});

describe("whether a rule pages its policies now, for a record that changed", () => {
  test("an After OneUptime AI rule never counts: what it holds starts when AI hands it off", () => {
    expect(OnCallRulePagingHoldUtil.isPagingNow(aiRule(10), NIGHT)).toBe(false);
  });

  test("a rule that pages right away does, and a working-hours rule outside its hours does not", () => {
    expect(
      OnCallRulePagingHoldUtil.isPagingNow(
        { whenToPage: OnCallRuleWhenToPage.RightAway },
        NIGHT,
      ),
    ).toBe(true);
    expect(OnCallRulePagingHoldUtil.isPagingNow(workingHours(), NIGHT)).toBe(
      false,
    );
  });
});

describe("two rules that page one policy for a record", () => {
  const POLICY: string = "6a000000-0000-4000-8000-0000000000a1";

  test("a rule that pages right away beside an AI rule: right away wins", () => {
    const holds: OnCallRulePagingHolds = new OnCallRulePagingHolds(NIGHT);
    holds.addRule(aiRule(10), [POLICY], { canHold: true });
    holds.addRule({ whenToPage: OnCallRuleWhenToPage.RightAway }, [POLICY], {
      canHold: true,
    });

    expect(holds.getHolds([POLICY]).size).toBe(0);
  });

  test("an AI rule beside a working-hours rule at night: the hold that ends first, AI's", () => {
    const holds: OnCallRulePagingHolds = new OnCallRulePagingHolds(NIGHT);
    holds.addRule(workingHours(), [POLICY], { canHold: true });
    holds.addRule(aiRule(10), [POLICY], { canHold: true });

    const hold: OnCallRulePagingHold | undefined = holds
      .getHolds([POLICY])
      .get(POLICY);

    expect(hold?.isAiHold).toBe(true);
    expect(minutesAfter(hold!, NIGHT)).toBe(10);
  });

  test("an AI rule for a record AI may not take, beside a working-hours rule: it pages right away", () => {
    const holds: OnCallRulePagingHolds = new OnCallRulePagingHolds(NIGHT);
    holds.addRule(workingHours(), [POLICY], { canHold: false });
    holds.addRule(aiRule(10), [POLICY], { canHold: false });

    expect(holds.getHolds([POLICY]).size).toBe(0);
  });

  test("a policy the record had already is never held, AI rule or not", () => {
    const holds: OnCallRulePagingHolds = new OnCallRulePagingHolds(NIGHT);
    holds.addRule(aiRule(10), [POLICY], { canHold: true });

    expect(holds.getHolds([]).size).toBe(0);
  });
});
