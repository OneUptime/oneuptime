import { describe, expect, test } from "@jest/globals";
import {
  DEFAULT_ON_CALL_ACKNOWLEDGEMENT_TIMEOUT_IN_MINUTES,
  MAX_ON_CALL_ACKNOWLEDGEMENT_TIMEOUT_IN_MINUTES,
  MIN_ON_CALL_ACKNOWLEDGEMENT_TIMEOUT_IN_MINUTES,
  ON_CALL_ACKNOWLEDGEMENT_TIMEOUT_MAX_PAGES_AGAIN,
  ON_CALL_ACKNOWLEDGEMENT_TIMEOUT_REFUSAL,
  ON_CALL_PAGE_AGAIN_STATUS_MESSAGE_START,
  describeOnCallAcknowledgementTimeout,
  getOnCallAcknowledgementTimeoutDueAt,
  getOnCallAcknowledgementTimeoutInMinutes,
  getOnCallAcknowledgementTimeoutRefusal,
  getOnCallPageAgainChatReason,
  getOnCallPageAgainPlace,
  getOnCallPageAgainPlaceWithLast,
  getOnCallPageAgainStatusMessage,
  hasOnCallPagesAgainLeft,
  isOnCallAcknowledgementTimeoutDue,
  isOnCallAcknowledgementTimeoutOn,
  isOnCallPageAgainRun,
  isOnCallPageAgainStatusMessage,
} from "../../../Types/OnCallDutyPolicy/OnCallAcknowledgementTimeout";
import {
  ON_CALL_POLICY_RUN_RECORD_HANDLED_MESSAGE_START,
  getOnCallPolicyRunRecordHandledMessage,
  getOnCallPolicyRunRecordResolvedMessage,
} from "../../../Types/OnCallDutyPolicy/OnCallDutyPolicyRunEnding";

/*
 * An on-call policy's acknowledgement timeout (issue #5123): the rule every
 * part of OneUptime reads it by - the API's check, the clock, the worker
 * that pages again, the Dashboard's card - and the words a page again says
 * itself in.
 */

const MINUTE: number = 60 * 1000;

describe("whether a policy pages again, and after how long", () => {
  test("a policy that never set it does not: every policy there is today", () => {
    expect(getOnCallAcknowledgementTimeoutInMinutes({})).toBeNull();
    expect(
      getOnCallAcknowledgementTimeoutInMinutes({
        acknowledgementTimeoutInMinutes: null,
      }),
    ).toBeNull();
    expect(
      getOnCallAcknowledgementTimeoutInMinutes({
        acknowledgementTimeoutInMinutes: undefined,
      }),
    ).toBeNull();
    expect(getOnCallAcknowledgementTimeoutInMinutes(null)).toBeNull();
    expect(getOnCallAcknowledgementTimeoutInMinutes(undefined)).toBeNull();
    expect(isOnCallAcknowledgementTimeoutOn({})).toBe(false);
  });

  test("a stored number of minutes is how long", () => {
    for (const minutes of [5, 15, 30, 60, 90, 1440]) {
      expect(
        getOnCallAcknowledgementTimeoutInMinutes({
          acknowledgementTimeoutInMinutes: minutes,
        }),
      ).toBe(minutes);
      expect(
        isOnCallAcknowledgementTimeoutOn({
          acknowledgementTimeoutInMinutes: minutes,
        }),
      ).toBe(true);
    }
  });

  test("nothing that is not a positive number turns it on", () => {
    for (const value of [0, -1, -30, NaN, Infinity * -1, "", "nope"]) {
      expect({
        value,
        minutes: getOnCallAcknowledgementTimeoutInMinutes({
          acknowledgementTimeoutInMinutes: value as unknown as number,
        }),
      }).toEqual({ value, minutes: null });
    }
  });

  test("a stored value outside the range is read inside it, as whole minutes", () => {
    expect(
      getOnCallAcknowledgementTimeoutInMinutes({
        acknowledgementTimeoutInMinutes: 1,
      }),
    ).toBe(MIN_ON_CALL_ACKNOWLEDGEMENT_TIMEOUT_IN_MINUTES);
    expect(
      getOnCallAcknowledgementTimeoutInMinutes({
        acknowledgementTimeoutInMinutes: 99999,
      }),
    ).toBe(MAX_ON_CALL_ACKNOWLEDGEMENT_TIMEOUT_IN_MINUTES);
    expect(
      getOnCallAcknowledgementTimeoutInMinutes({
        acknowledgementTimeoutInMinutes: 30.9,
      }),
    ).toBe(30);
  });

  test("its range and its default are the ones the docs and the card state", () => {
    expect(MIN_ON_CALL_ACKNOWLEDGEMENT_TIMEOUT_IN_MINUTES).toBe(5);
    expect(MAX_ON_CALL_ACKNOWLEDGEMENT_TIMEOUT_IN_MINUTES).toBe(1440);
    expect(DEFAULT_ON_CALL_ACKNOWLEDGEMENT_TIMEOUT_IN_MINUTES).toBe(30);
    expect(ON_CALL_ACKNOWLEDGEMENT_TIMEOUT_MAX_PAGES_AGAIN).toBe(5);
  });
});

describe("what the API, Terraform and a workflow may write", () => {
  test("null turns it off, and is accepted", () => {
    expect(getOnCallAcknowledgementTimeoutRefusal(null)).toBeNull();
    expect(getOnCallAcknowledgementTimeoutRefusal(undefined)).toBeNull();
  });

  test("a whole number of minutes in range is accepted, as a number or its text", () => {
    for (const value of [5, 6, 30, 120, 1439, 1440, "30", " 45 "]) {
      expect({
        value,
        refusal: getOnCallAcknowledgementTimeoutRefusal(value),
      }).toEqual({ value, refusal: null });
    }
  });

  test("anything else is refused with one sentence that says what is wanted", () => {
    for (const value of [
      0,
      4,
      -5,
      1441,
      30.5,
      "",
      "   ",
      "thirty",
      true,
      false,
      NaN,
      Infinity,
      {},
      [],
      [30],
    ]) {
      expect({
        value,
        refusal: getOnCallAcknowledgementTimeoutRefusal(value),
      }).toEqual({ value, refusal: ON_CALL_ACKNOWLEDGEMENT_TIMEOUT_REFUSAL });
    }
  });

  test("the refusal names the range and how to turn it off", () => {
    expect(ON_CALL_ACKNOWLEDGEMENT_TIMEOUT_REFUSAL).toBe(
      "The acknowledgement timeout is a whole number of minutes from 5 to 1440 (24 hours), or null to turn it off.",
    );
  });
});

describe("when the clock runs out", () => {
  const startedAt: Date = new Date("2026-10-22T02:00:00.000Z");

  test("thirty minutes after it started, to the millisecond", () => {
    expect(
      getOnCallAcknowledgementTimeoutDueAt({
        startedAt: startedAt,
        minutes: 30,
      }).toISOString(),
    ).toBe("2026-10-22T02:30:00.000Z");
  });

  test("not a millisecond early", () => {
    expect(
      isOnCallAcknowledgementTimeoutDue({
        startedAt: startedAt,
        minutes: 30,
        now: new Date(startedAt.getTime() + 30 * MINUTE - 1),
      }),
    ).toBe(false);
  });

  test("at the moment itself, and any time after", () => {
    for (const late of [0, 1, 59 * 1000, 61 * 1000, 7 * 24 * 60 * MINUTE]) {
      expect(
        isOnCallAcknowledgementTimeoutDue({
          startedAt: startedAt,
          minutes: 30,
          now: new Date(startedAt.getTime() + 30 * MINUTE + late),
        }),
      ).toBe(true);
    }
  });

  /*
   * A clock that started part way through a minute runs out part way
   * through one: a worker that ticks at the minute pages again at the first
   * tick after - never at the tick before because whole minutes were
   * compared (the minute-edge trap: getDifferenceInMinutes floors).
   */
  test("by the moment, not by whole minutes, at every second of the minute", () => {
    for (let second: number = 0; second < 60; second++) {
      const started: Date = new Date(Date.UTC(2026, 9, 22, 2, 0, second, 500));
      const tickBefore: Date = new Date(Date.UTC(2026, 9, 22, 2, 30, 0, 0));
      const tickAfter: Date = new Date(Date.UTC(2026, 9, 22, 2, 31, 0, 0));

      expect({
        second,
        before: isOnCallAcknowledgementTimeoutDue({
          startedAt: started,
          minutes: 30,
          now: tickBefore,
        }),
        after: isOnCallAcknowledgementTimeoutDue({
          startedAt: started,
          minutes: 30,
          now: tickAfter,
        }),
      }).toEqual({ second, before: false, after: true });
    }
  });

  test("a clock that reads no moment never runs out", () => {
    expect(
      isOnCallAcknowledgementTimeoutDue({
        startedAt: new Date("not a date"),
        minutes: 30,
        now: new Date(),
      }),
    ).toBe(false);
  });

  test("a clock read back as text runs out as the date it says", () => {
    expect(
      isOnCallAcknowledgementTimeoutDue({
        startedAt: "2026-10-22T02:00:00.000Z" as unknown as Date,
        minutes: 30,
        now: new Date("2026-10-22T02:30:00.000Z"),
      }),
    ).toBe(true);
  });
});

describe("how many times it pages again", () => {
  test("up to five times for one record and policy", () => {
    for (const soFar of [0, 1, 2, 3, 4]) {
      expect({ soFar, left: hasOnCallPagesAgainLeft(soFar) }).toEqual({
        soFar,
        left: true,
      });
    }

    for (const soFar of [5, 6, 50]) {
      expect({ soFar, left: hasOnCallPagesAgainLeft(soFar) }).toEqual({
        soFar,
        left: false,
      });
    }
  });

  test("none so far is the first", () => {
    expect(hasOnCallPagesAgainLeft(null)).toBe(true);
    expect(hasOnCallPagesAgainLeft(undefined)).toBe(true);
  });

  test("a count that cannot be trusted pages nobody again", () => {
    expect(hasOnCallPagesAgainLeft(NaN)).toBe(false);
    expect(hasOnCallPagesAgainLeft(Infinity)).toBe(false);
  });
});

describe("which runs are a page again", () => {
  test("a run with a page again number from 1 is one", () => {
    expect(isOnCallPageAgainRun({ pageAgainNumber: 1 })).toBe(true);
    expect(isOnCallPageAgainRun({ pageAgainNumber: 5 })).toBe(true);
  });

  test("every other run is not: the first run, a direct page, a run from before", () => {
    expect(isOnCallPageAgainRun({})).toBe(false);
    expect(isOnCallPageAgainRun({ pageAgainNumber: null })).toBe(false);
    expect(isOnCallPageAgainRun({ pageAgainNumber: 0 })).toBe(false);
    expect(isOnCallPageAgainRun(null)).toBe(false);
    expect(isOnCallPageAgainRun(undefined)).toBe(false);
    expect(
      isOnCallPageAgainRun({ pageAgainNumber: NaN as unknown as number }),
    ).toBe(false);
  });
});

describe("the words a page again says itself in", () => {
  test("a timeout in words", () => {
    expect(describeOnCallAcknowledgementTimeout(5)).toBe("5 minutes");
    expect(describeOnCallAcknowledgementTimeout(1)).toBe("1 minute");
    expect(describeOnCallAcknowledgementTimeout(30)).toBe("30 minutes");
    expect(describeOnCallAcknowledgementTimeout(60)).toBe("1 hour");
    expect(describeOnCallAcknowledgementTimeout(61)).toBe("1 hour 1 minute");
    expect(describeOnCallAcknowledgementTimeout(90)).toBe("1 hour 30 minutes");
    expect(describeOnCallAcknowledgementTimeout(120)).toBe("2 hours");
    expect(describeOnCallAcknowledgementTimeout(1440)).toBe("24 hours");
  });

  test("which time of how many", () => {
    expect(getOnCallPageAgainPlace(1)).toBe("1 of 5");
    expect(getOnCallPageAgainPlaceWithLast(1)).toBe("1 of 5");
    expect(getOnCallPageAgainPlaceWithLast(4)).toBe("4 of 5");
    expect(getOnCallPageAgainPlaceWithLast(5)).toBe("5 of 5, the last time");
  });

  test("the status message it pages with, and how it is read back", () => {
    const message: string = getOnCallPageAgainStatusMessage({
      pageAgainNumber: 2,
      minutes: 30,
    });

    expect(message).toBe(
      "Paging again (2 of 5): still not resolved 30 minutes after it was acknowledged.",
    );
    expect(message.startsWith(ON_CALL_PAGE_AGAIN_STATUS_MESSAGE_START)).toBe(
      true,
    );
    expect(isOnCallPageAgainStatusMessage(message)).toBe(true);
    expect(
      isOnCallPageAgainStatusMessage("First escalation rule executed..."),
    ).toBe(false);
    expect(isOnCallPageAgainStatusMessage(undefined)).toBe(false);
  });

  test("the line under its chat message's headline", () => {
    expect(getOnCallPageAgainChatReason(1)).toBe(
      "(1 of 5): still not resolved after it was acknowledged.",
    );
    expect(getOnCallPageAgainChatReason(5)).toBe(
      "(5 of 5, the last time): still not resolved after it was acknowledged.",
    );
  });

  /*
   * A page again ends when its record is resolved: its record was
   * acknowledged all along, so "acknowledged or resolved" would not say why.
   * It starts as every handled ending does, so the feed and the run's chat
   * message read it the same way.
   */
  test("how it ends when its record is resolved", () => {
    const resolved: string =
      getOnCallPolicyRunRecordResolvedMessage("incident");

    expect(resolved).toBe("Execution completed because incident is resolved.");
    expect(
      resolved.startsWith(ON_CALL_POLICY_RUN_RECORD_HANDLED_MESSAGE_START),
    ).toBe(true);
    expect(getOnCallPolicyRunRecordHandledMessage("incident")).toBe(
      "Execution completed because incident is acknowledged or resolved.",
    );
  });
});
