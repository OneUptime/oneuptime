import UserOverrideEdit, {
  USER_OVERRIDE_ENDED_REFUSAL,
  USER_OVERRIDE_END_IN_PAST_REFUSAL,
  USER_OVERRIDE_STARTED_REFUSAL,
  USER_OVERRIDE_START_IN_PAST_REFUSAL,
  UserOverrideSavedTimes,
  UserOverrideTimesChange,
} from "../../../Types/OnCallDutyPolicy/UserOverrideEdit";
import { describe, expect, test } from "@jest/globals";

/*
 * WHAT AN EDIT OF A USER OVERRIDE MAY CHANGE (issue #7631): who covers,
 * until it ends; when it starts, until it starts; when it ends, until it
 * ends - and a moved time never before the current minute. One that has
 * ended stays as it was. A time sent back as it is, to the minute, is no
 * change: the pickers hold minutes, and an override may be saved to the
 * second.
 */

// Half a minute into 12:00.
const NOW: Date = new Date("2026-11-13T12:00:30.000Z");

// "08:00:45" today, or a whole time, in UTC.
const at: (time: string) => Date = (time: string): Date => {
  return new Date(time.includes("T") ? `${time}Z` : `2026-11-13T${time}Z`);
};

const saved: (from: string, until: string) => UserOverrideSavedTimes = (
  from: string,
  until: string,
): UserOverrideSavedTimes => {
  return { startsAt: at(from), endsAt: at(until) };
};

const refusalOf: (
  times: UserOverrideSavedTimes,
  change: UserOverrideTimesChange,
) => string | null = (
  times: UserOverrideSavedTimes,
  change: UserOverrideTimesChange,
): string | null => {
  return UserOverrideEdit.getRefusal({
    saved: times,
    change: change,
    now: NOW,
  });
};

// Tomorrow 9 to 5; under way since 8:00:45 this morning, until 8 tonight; yesterday 9 to 5.
const UPCOMING: UserOverrideSavedTimes = saved(
  "2026-11-14T09:00:00",
  "2026-11-14T17:00:00",
);
const RUNNING: UserOverrideSavedTimes = saved("08:00:45", "20:00:00");
const ENDED: UserOverrideSavedTimes = saved(
  "2026-11-12T09:00:00",
  "2026-11-12T17:00:00",
);

describe("where an override is", () => {
  test("it has ended once its end has come, this very moment included", () => {
    expect(UserOverrideEdit.hasEnded(ENDED, NOW)).toBe(true);
    expect(UserOverrideEdit.hasEnded(saved("08:00:00", "12:00:30"), NOW)).toBe(
      true,
    );
    expect(UserOverrideEdit.hasEnded(saved("08:00:00", "12:00:31"), NOW)).toBe(
      false,
    );
  });

  test("it has started once its start has come, this very moment included", () => {
    expect(UserOverrideEdit.hasStarted(RUNNING, NOW)).toBe(true);
    expect(
      UserOverrideEdit.hasStarted(saved("12:00:30", "20:00:00"), NOW),
    ).toBe(true);
    expect(UserOverrideEdit.hasStarted(UPCOMING, NOW)).toBe(false);
  });

  test("two times in the same minute are one, as a picker holds them", () => {
    expect(
      UserOverrideEdit.isSameMinute(at("12:00:00"), at("12:00:59.999")),
    ).toBe(true);
    expect(UserOverrideEdit.isSameMinute(at("12:00:59"), at("12:01:00"))).toBe(
      false,
    );
  });

  test("the times an edit moves: only those not the saved ones, to the minute", () => {
    expect(
      UserOverrideEdit.getMovedTimes(RUNNING, {
        startsAt: at("08:00:00"),
        endsAt: at("20:00:00"),
      }),
    ).toEqual({});
    expect(
      UserOverrideEdit.getMovedTimes(RUNNING, {
        startsAt: at("08:00:00"),
        endsAt: at("21:00:00"),
      }),
    ).toEqual({ endsAt: at("21:00:00") });
    expect(UserOverrideEdit.getMovedTimes(RUNNING, {})).toEqual({});
  });
});

describe("an override that has not started", () => {
  test("its start moves later, or earlier down to this minute", () => {
    expect(refusalOf(UPCOMING, { startsAt: at("2026-11-14T10:00:00") })).toBe(
      null,
    );
    expect(refusalOf(UPCOMING, { startsAt: at("12:00:00") })).toBe(null);
  });

  test("its start never moves to before this minute", () => {
    expect(refusalOf(UPCOMING, { startsAt: at("11:59:00") })).toBe(
      USER_OVERRIDE_START_IN_PAST_REFUSAL,
    );
  });

  test("its end moves, and who covers changes", () => {
    expect(refusalOf(UPCOMING, { endsAt: at("2026-11-15T17:00:00") })).toBe(
      null,
    );
    expect(refusalOf(UPCOMING, {})).toBe(null);
  });

  test("its end never moves to the past", () => {
    expect(refusalOf(UPCOMING, { endsAt: at("11:00:00") })).toBe(
      USER_OVERRIDE_END_IN_PAST_REFUSAL,
    );
  });
});

describe("an override under way", () => {
  test("its start never moves: pages already went by it", () => {
    expect(refusalOf(RUNNING, { startsAt: at("15:00:00") })).toBe(
      USER_OVERRIDE_STARTED_REFUSAL,
    );
    expect(refusalOf(RUNNING, { startsAt: at("07:00:00") })).toBe(
      USER_OVERRIDE_STARTED_REFUSAL,
    );
  });

  test("its start sent back as the picker shows it - the minute of a start saved to the second - is no move", () => {
    expect(refusalOf(RUNNING, { startsAt: at("08:00:00") })).toBe(null);
  });

  test("its end moves later, or sooner down to now, to end it now", () => {
    expect(refusalOf(RUNNING, { endsAt: at("22:00:00") })).toBe(null);
    expect(refusalOf(RUNNING, { endsAt: at("12:00:00") })).toBe(null);
  });

  test("its end never moves to before this minute", () => {
    expect(refusalOf(RUNNING, { endsAt: at("11:59:59") })).toBe(
      USER_OVERRIDE_END_IN_PAST_REFUSAL,
    );
  });

  test("who covers changes", () => {
    expect(refusalOf(RUNNING, {})).toBe(null);
  });
});

describe("an override that has ended", () => {
  test("nothing about it changes, not even who covers", () => {
    expect(refusalOf(ENDED, {})).toBe(USER_OVERRIDE_ENDED_REFUSAL);
    expect(refusalOf(ENDED, { endsAt: at("2026-11-14T17:00:00") })).toBe(
      USER_OVERRIDE_ENDED_REFUSAL,
    );
    expect(refusalOf(ENDED, { startsAt: ENDED.startsAt })).toBe(
      USER_OVERRIDE_ENDED_REFUSAL,
    );
  });

  test("one that ends this very moment has ended", () => {
    expect(refusalOf(saved("08:00:00", "12:00:30"), {})).toBe(
      USER_OVERRIDE_ENDED_REFUSAL,
    );
  });
});

describe("what the refusals say", () => {
  test("each says what can still be done", () => {
    expect(USER_OVERRIDE_ENDED_REFUSAL).toBe(
      "This override has already ended, so it can't be changed. Add a new override instead.",
    );
    expect(USER_OVERRIDE_STARTED_REFUSAL).toBe(
      "This override has already started, so when it starts can't be changed. You can still change when it ends, or who covers.",
    );
    expect(USER_OVERRIDE_START_IN_PAST_REFUSAL).toBe(
      "An override can't be moved to start in the past. Pick a start from now on.",
    );
    expect(USER_OVERRIDE_END_IN_PAST_REFUSAL).toBe(
      "An override can't be moved to end in the past. To end it now, pick the current time.",
    );
  });
});
