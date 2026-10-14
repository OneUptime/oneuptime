import {
  capRefreshTokenExpiry,
  getPrivateUserSessionEndsAt,
  getPrivateUserSessionLengthProblem,
  MAX_PRIVATE_USER_SESSION_LENGTH_IN_HOURS,
  PRIVATE_USER_SESSION_IDLE_DAYS,
  PRIVATE_USER_SESSION_LENGTH_CHOICES_IN_HOURS,
  PRIVATE_USER_SESSION_LENGTH_COLUMN,
  PRIVATE_USER_SESSION_LENGTH_PROBLEM,
  readPrivateUserSessionLength,
} from "../../../Types/StatusPage/PrivateUserSessionLength";
import StatusPage from "../../../Models/DatabaseModels/StatusPage";
import { describe, expect, test } from "@jest/globals";

/*
 * Sign Readers Out After (StatusPage.privateUserSessionLengthInHours): a
 * ceiling on how long a private user stays signed in to a private status
 * page, counted from the sign-in, however active they are. These pin the
 * rules every reader of the column shares - what may be written, what a
 * stored value means, when a session ends and when its refresh token has
 * to expire - so the server, the sessions and the dashboard agree.
 */

const HOUR: number = 60 * 60 * 1000;
const DAY: number = 24 * HOUR;
const STARTED_AT: Date = new Date("2026-10-01T08:00:00.000Z");

describe("what Sign Readers Out After may hold", () => {
  test("it is the status page column the model declares", () => {
    expect(PRIVATE_USER_SESSION_LENGTH_COLUMN).toBe(
      "privateUserSessionLengthInHours",
    );
    expect(
      new StatusPage().getTableColumnMetadata(
        PRIVATE_USER_SESSION_LENGTH_COLUMN,
      ),
    ).toBeTruthy();
  });

  test.each([null, undefined])(
    "nothing (%p) is no limit, and fine",
    (value: unknown) => {
      expect(getPrivateUserSessionLengthProblem(value)).toBeNull();
    },
  );

  test.each([1, 4, 12, 24, 720, MAX_PRIVATE_USER_SESSION_LENGTH_IN_HOURS])(
    "%p whole hours is fine",
    (value: number) => {
      expect(getPrivateUserSessionLengthProblem(value)).toBeNull();
    },
  );

  test.each([
    ["zero", 0],
    ["a negative number", -1],
    ["more than a year", MAX_PRIVATE_USER_SESSION_LENGTH_IN_HOURS + 1],
    ["a fraction of an hour", 1.5],
    ["NaN", Number.NaN],
    ["infinity", Number.POSITIVE_INFINITY],
    ["a number written as text", "12"],
    ["an empty string", ""],
    ["a boolean", true],
    ["an object", { hours: 12 }],
  ])(
    "%s is refused, saying what is allowed",
    (_label: string, value: unknown) => {
      expect(getPrivateUserSessionLengthProblem(value)).toBe(
        PRIVATE_USER_SESSION_LENGTH_PROBLEM,
      );
    },
  );

  test("the refusal names the range and how to set no limit", () => {
    expect(PRIVATE_USER_SESSION_LENGTH_PROBLEM).toContain("1 to 8760");
    expect(PRIVATE_USER_SESSION_LENGTH_PROBLEM).toContain("no limit");
  });

  test("a year is the longest", () => {
    expect(MAX_PRIVATE_USER_SESSION_LENGTH_IN_HOURS).toBe(8760);
  });
});

describe("what a stored value means", () => {
  test.each([1, 8, 168, MAX_PRIVATE_USER_SESSION_LENGTH_IN_HOURS])(
    "%p hours reads as itself",
    (value: number) => {
      expect(readPrivateUserSessionLength(value)).toBe(value);
    },
  );

  test.each([
    null,
    undefined,
    0,
    -5,
    MAX_PRIVATE_USER_SESSION_LENGTH_IN_HOURS + 1,
    2.5,
    "12",
  ])(
    "%p reads as no limit, so a stray value never locks anyone out",
    (value: unknown) => {
      expect(readPrivateUserSessionLength(value)).toBeNull();
    },
  );
});

describe("when a session ends", () => {
  test("no limit never ends it", () => {
    expect(
      getPrivateUserSessionEndsAt({
        startedAt: STARTED_AT,
        lengthInHours: null,
      }),
    ).toBeNull();
  });

  test.each([1, 8, 24, 720])(
    "%p hours after it signed in",
    (lengthInHours: number) => {
      expect(
        getPrivateUserSessionEndsAt({
          startedAt: STARTED_AT,
          lengthInHours,
        })!.getTime(),
      ).toBe(STARTED_AT.getTime() + lengthInHours * HOUR);
    },
  );

  test("a value that could not have been written is no limit", () => {
    expect(
      getPrivateUserSessionEndsAt({ startedAt: STARTED_AT, lengthInHours: 0 }),
    ).toBeNull();
  });
});

describe("when a session's refresh token expires", () => {
  const thirtyDaysAfter: (from: Date) => Date = (from: Date): Date => {
    return new Date(from.getTime() + PRIVATE_USER_SESSION_IDLE_DAYS * DAY);
  };

  test("without a limit, it keeps the 30 days it would have", () => {
    const expiresAt: Date = thirtyDaysAfter(STARTED_AT);

    expect(
      capRefreshTokenExpiry({
        expiresAt,
        startedAt: STARTED_AT,
        lengthInHours: null,
      }),
    ).toEqual(expiresAt);
  });

  test("a new session ends by the limit when it comes first", () => {
    const expiresAt: Date = thirtyDaysAfter(STARTED_AT);

    expect(
      capRefreshTokenExpiry({
        expiresAt,
        startedAt: STARTED_AT,
        lengthInHours: 12,
      }).getTime(),
    ).toBe(STARTED_AT.getTime() + 12 * HOUR);
  });

  test("a renewal never takes the session past the end of its limit", () => {
    // Renewed ten days in: 30 more days would go well past the 14-day limit.
    const now: Date = new Date(STARTED_AT.getTime() + 10 * DAY);

    expect(
      capRefreshTokenExpiry({
        expiresAt: thirtyDaysAfter(now),
        startedAt: STARTED_AT,
        lengthInHours: 14 * 24,
      }).getTime(),
    ).toBe(STARTED_AT.getTime() + 14 * DAY);
  });

  test("a limit longer than the 30 days leaves the 30 days", () => {
    const expiresAt: Date = thirtyDaysAfter(STARTED_AT);

    expect(
      capRefreshTokenExpiry({
        expiresAt,
        startedAt: STARTED_AT,
        lengthInHours: MAX_PRIVATE_USER_SESSION_LENGTH_IN_HOURS,
      }),
    ).toEqual(expiresAt);
  });

  test("a limit ending exactly at the 30 days leaves the 30 days", () => {
    const expiresAt: Date = thirtyDaysAfter(STARTED_AT);

    expect(
      capRefreshTokenExpiry({
        expiresAt,
        startedAt: STARTED_AT,
        lengthInHours: PRIVATE_USER_SESSION_IDLE_DAYS * 24,
      }),
    ).toEqual(expiresAt);
  });

  test.each([null, undefined])(
    "a session whose start is unknown (%p) keeps the expiry it would have",
    (startedAt: Date | null | undefined) => {
      const expiresAt: Date = thirtyDaysAfter(STARTED_AT);

      expect(
        capRefreshTokenExpiry({ expiresAt, startedAt, lengthInHours: 1 }),
      ).toEqual(expiresAt);
    },
  );
});

describe("the lengths the dashboard offers", () => {
  test("are shortest first, with no repeats", () => {
    const sorted: Array<number> = [
      ...PRIVATE_USER_SESSION_LENGTH_CHOICES_IN_HOURS,
    ].sort((first: number, second: number): number => {
      return first - second;
    });

    expect([...PRIVATE_USER_SESSION_LENGTH_CHOICES_IN_HOURS]).toEqual(sorted);
    expect(new Set(PRIVATE_USER_SESSION_LENGTH_CHOICES_IN_HOURS).size).toBe(
      PRIVATE_USER_SESSION_LENGTH_CHOICES_IN_HOURS.length,
    );
  });

  test("can each be written", () => {
    for (const hours of PRIVATE_USER_SESSION_LENGTH_CHOICES_IN_HOURS) {
      expect(getPrivateUserSessionLengthProblem(hours)).toBeNull();
    }
  });

  test("cover a working day, a day, a week and the 30 days", () => {
    expect(PRIVATE_USER_SESSION_LENGTH_CHOICES_IN_HOURS).toEqual(
      expect.arrayContaining([8, 24, 168, PRIVATE_USER_SESSION_IDLE_DAYS * 24]),
    );
  });
});
