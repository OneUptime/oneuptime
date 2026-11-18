import { describe, expect, test } from "@jest/globals";
import {
  OVERRIDE_CONFLICT_WHAT_TO_DO,
  OVERRIDE_ENDED_REFUSAL,
  OVERRIDE_ENDS_BEFORE_START_REFUSAL,
  OVERRIDE_END_IN_PAST_REFUSAL,
  OVERRIDE_END_NOW_ENDS_THIS_MINUTE_REFUSAL,
  OVERRIDE_END_NOW_NOT_STARTED_REFUSAL,
  OVERRIDE_STARTED_REFUSAL,
  OVERRIDE_START_IN_PAST_REFUSAL,
  getEditRefusal,
  getEndNow,
  getEndNowRefusal,
  isOverlapRefusal,
  isUnderWay,
  pickConflict,
  type OverrideSavedTimes,
  type OverrideScopeTimes,
} from "./overrideEdit";

/*
 * WHAT AN EDIT OF A USER OVERRIDE MAY CHANGE, ON THE PHONE (#7897).
 *
 * The app's copy of the dashboard's rule, checked here by what it does;
 * Common's UserOverrideEditMobileParity holds it to the server's rule case
 * for case, and its refusals word for word.
 */

// Half a minute into noon.
const NOW: Date = new Date("2026-11-13T12:00:30.000Z");

const at: (time: string) => Date = (time: string): Date => {
  return new Date(`2026-11-13T${time}.000Z`);
};

const UPCOMING: OverrideSavedTimes = {
  startsAt: new Date("2026-11-14T09:00:00.000Z"),
  endsAt: new Date("2026-11-14T17:00:00.000Z"),
};

const RUNNING: OverrideSavedTimes = {
  startsAt: at("08:00:45"),
  endsAt: at("20:00:00"),
};

const ENDED: OverrideSavedTimes = {
  startsAt: new Date("2026-11-12T09:00:00.000Z"),
  endsAt: new Date("2026-11-12T17:00:00.000Z"),
};

describe("an override that has not started", () => {
  test("its start moves later, or to this minute, and its end with it", () => {
    expect(
      getEditRefusal({
        saved: UPCOMING,
        change: { startsAt: at("12:00:00") },
        now: NOW,
      }),
    ).toBeNull();
    expect(
      getEditRefusal({
        saved: UPCOMING,
        change: {
          startsAt: new Date("2026-11-14T10:00:00.000Z"),
          endsAt: new Date("2026-11-14T20:00:00.000Z"),
        },
        now: NOW,
      }),
    ).toBeNull();
  });

  test("its start never moves to the past", () => {
    expect(
      getEditRefusal({
        saved: UPCOMING,
        change: { startsAt: at("11:59:00") },
        now: NOW,
      }),
    ).toBe(OVERRIDE_START_IN_PAST_REFUSAL);
  });

  test("its end never comes before its start", () => {
    expect(
      getEditRefusal({
        saved: UPCOMING,
        change: { endsAt: new Date("2026-11-14T08:00:00.000Z") },
        now: NOW,
      }),
    ).toBe(OVERRIDE_ENDS_BEFORE_START_REFUSAL);
  });

  test("End Now has nothing to end: it is called off by deleting it", () => {
    expect(getEndNow(UPCOMING, NOW)).toBeNull();
    expect(getEndNowRefusal(UPCOMING, NOW)).toBe(
      OVERRIDE_END_NOW_NOT_STARTED_REFUSAL,
    );
  });
});

describe("an override under way", () => {
  test("its start never moves; sent back to the minute it is no move", () => {
    expect(
      getEditRefusal({
        saved: RUNNING,
        change: { startsAt: at("09:00:00") },
        now: NOW,
      }),
    ).toBe(OVERRIDE_STARTED_REFUSAL);
    expect(
      getEditRefusal({
        saved: RUNNING,
        change: { startsAt: at("08:00:00") },
        now: NOW,
      }),
    ).toBeNull();
  });

  test("its end moves later, or down to now - never to the past", () => {
    expect(
      getEditRefusal({
        saved: RUNNING,
        change: { endsAt: at("23:00:00") },
        now: NOW,
      }),
    ).toBeNull();
    expect(
      getEditRefusal({
        saved: RUNNING,
        change: { endsAt: at("12:00:00") },
        now: NOW,
      }),
    ).toBeNull();
    expect(
      getEditRefusal({
        saved: RUNNING,
        change: { endsAt: at("11:59:00") },
        now: NOW,
      }),
    ).toBe(OVERRIDE_END_IN_PAST_REFUSAL);
  });

  test("End Now ends it at the start of this minute, or at now for one started in it", () => {
    expect(isUnderWay(RUNNING, NOW)).toBe(true);
    expect(getEndNow(RUNNING, NOW)?.toISOString()).toBe(
      "2026-11-13T12:00:00.000Z",
    );
    expect(
      getEndNow({ startsAt: at("12:00:10"), endsAt: at("18:00:00") }, NOW),
    ).toEqual(NOW);
  });

  test("End Now has nothing left to end for one that ends within the minute", () => {
    const endsThisMinute: OverrideSavedTimes = {
      startsAt: at("09:00:00"),
      endsAt: at("12:00:50"),
    };

    expect(getEndNow(endsThisMinute, NOW)).toBeNull();
    expect(getEndNowRefusal(endsThisMinute, NOW)).toBe(
      OVERRIDE_END_NOW_ENDS_THIS_MINUTE_REFUSAL,
    );
  });
});

describe("an override that has ended", () => {
  test("nothing about it changes, and End Now has nothing to end", () => {
    expect(getEditRefusal({ saved: ENDED, change: {}, now: NOW })).toBe(
      OVERRIDE_ENDED_REFUSAL,
    );
    expect(getEndNow(ENDED, NOW)).toBeNull();
    expect(getEndNowRefusal(ENDED, NOW)).toBe(OVERRIDE_ENDED_REFUSAL);
  });
});

describe("an overlap", () => {
  test("is told by the server's words of what to do", () => {
    expect(
      isOverlapRefusal(
        `Ada is already covered by Priya on every policy from Nov 13 to Nov 14. ${OVERRIDE_CONFLICT_WHAT_TO_DO}`,
      ),
    ).toBe(true);
    expect(isOverlapRefusal(OVERRIDE_ENDED_REFUSAL)).toBe(false);
  });

  const candidate: OverrideScopeTimes = {
    id: "this",
    overrideUserId: "ada",
    routeAlertsToUserId: "priya",
    onCallDutyPolicyId: null,
    startsAt: at("12:00:00"),
    endsAt: at("18:00:00"),
  };

  test("names the override of the same person, in the same scope, at the same time", () => {
    const others: Array<OverrideScopeTimes> = [
      { ...candidate, id: "this" },
      { ...candidate, id: "kim", overrideUserId: "kim" },
      { ...candidate, id: "policy", onCallDutyPolicyId: "payments" },
      {
        ...candidate,
        id: "after",
        startsAt: at("18:00:00"),
        endsAt: at("20:00:00"),
      },
      {
        ...candidate,
        id: "inside",
        startsAt: at("13:00:00"),
        endsAt: at("14:00:00"),
      },
    ];

    expect(pickConflict(candidate, others)?.id).toBe("inside");
  });

  test("of several, the one used first: one that names who covers over a skip, then the one that starts first", () => {
    expect(
      pickConflict(candidate, [
        {
          ...candidate,
          id: "skip-early",
          routeAlertsToUserId: null,
          startsAt: at("11:00:00"),
          endsAt: at("13:00:00"),
        },
        {
          ...candidate,
          id: "cover-late",
          startsAt: at("15:00:00"),
          endsAt: at("16:00:00"),
        },
        {
          ...candidate,
          id: "cover-early",
          startsAt: at("13:00:00"),
          endsAt: at("16:00:00"),
        },
      ])?.id,
    ).toBe("cover-early");
  });

  test("none when nothing overlaps", () => {
    expect(pickConflict(candidate, [])).toBeNull();
  });
});
