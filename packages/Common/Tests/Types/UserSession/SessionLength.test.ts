import GlobalConfig from "../../../Models/DatabaseModels/GlobalConfig";
import TableColumnType from "../../../Types/Database/TableColumnType";
import {
  DEFAULT_SESSION_IDLE_DAYS,
  DEFAULT_SESSION_IDLE_TIMEOUT_IN_MINUTES,
  doesShortenAnySession,
  getActivityAtRenewal,
  getIdleTimeoutInMinutes,
  getSeparateSsoSessionLengthsProblem,
  getSessionEnd,
  getSessionEndReachedBy,
  getSessionLengthColumnKind,
  getSessionLengthProblem,
  getSessionLengthRange,
  getSessionLengthRule,
  getSessionLengthSettingProblem,
  hasSessionLimits,
  INACTIVE_FOR_IN_SECONDS_FIELD,
  isSessionEndReason,
  isSessionLengthRuleSet,
  MAX_REPORTED_INACTIVITY_IN_SECONDS,
  MAX_SESSION_IDLE_TIMEOUT_IN_MINUTES,
  MAX_SESSION_LENGTH_IN_MINUTES,
  MIN_SESSION_IDLE_TIMEOUT_IN_MINUTES,
  MIN_SESSION_LENGTH_IN_MINUTES,
  NO_SESSION_LENGTH_SETTINGS,
  NO_SESSION_LENGTHS,
  readReportedInactivityInSeconds,
  readSessionEndReason,
  readSessionLengths,
  readSessionLengthSettings,
  readSessionLengthValue,
  sanitizeSessionLengths,
  SEPARATE_SSO_SESSION_LENGTHS_COLUMN,
  SEPARATE_SSO_SESSION_LENGTHS_PROBLEM,
  SESSION_ENDED_QUERY_PARAM,
  SESSION_IDLE_TIMEOUT_CHOICES_IN_MINUTES,
  SESSION_IDLE_TIMEOUT_COLUMN,
  SESSION_IDLE_TIMEOUT_PROBLEM,
  SESSION_LENGTH_CHOICES_IN_MINUTES,
  SESSION_LENGTH_COLUMN,
  SESSION_LENGTH_COLUMNS,
  SESSION_LENGTH_PROBLEM,
  SESSION_LENGTH_SETTING_COLUMNS,
  SessionEndReason,
  SessionFacts,
  SessionLengthColumn,
  SessionLengthKind,
  SessionLengths,
  SessionLengthSettingColumn,
  SessionLengthSettings,
  SSO_SESSION_IDLE_TIMEOUT_COLUMN,
  SSO_SESSION_LENGTH_COLUMN,
  toSessionLengths,
} from "../../../Types/UserSession/SessionLength";
import { describe, expect, test } from "@jest/globals";

/*
 * HOW LONG A SIGN-IN LASTS (Types/UserSession/SessionLength.ts): the rules
 * every reader of the server's session lengths shares - what a master
 * admin may write, what the columns mean (one rule for every sign-in, SSO
 * sign-ins' own when they have them), when a session ends and why, and
 * what a renewal makes of a browser's report of inactivity - so the
 * sign-in routes, the renewal, every request, the realtime socket, the
 * sweep after a change and the Admin Dashboard agree.
 */

const MINUTE: number = 60 * 1000;
const HOUR: number = 60 * MINUTE;
const DAY: number = 24 * HOUR;
const SIGNED_IN_AT: Date = new Date("2026-11-02T08:00:00.000Z");

const lengths: (
  standard: { length?: number | null; idle?: number | null },
  sso?: { length?: number | null; idle?: number | null },
) => SessionLengths = (
  standard: { length?: number | null; idle?: number | null },
  sso?: { length?: number | null; idle?: number | null },
): SessionLengths => {
  const ssoRule: { length?: number | null; idle?: number | null } =
    sso || standard;

  return {
    standard: {
      lengthInMinutes: standard.length ?? null,
      idleTimeoutInMinutes: standard.idle ?? null,
    },
    sso: {
      lengthInMinutes: ssoRule.length ?? null,
      idleTimeoutInMinutes: ssoRule.idle ?? null,
    },
  };
};

const facts: (overrides?: Partial<SessionFacts>) => SessionFacts = (
  overrides?: Partial<SessionFacts>,
): SessionFacts => {
  return {
    signedInAt: SIGNED_IN_AT,
    lastActiveAt: SIGNED_IN_AT,
    isSsoSignIn: false,
    ...(overrides || {}),
  };
};

describe("the columns the setting is kept in", () => {
  test("are the GlobalConfig model's own, of the types they are read as", () => {
    const model: GlobalConfig = new GlobalConfig();

    for (const column of SESSION_LENGTH_COLUMNS) {
      expect({
        column,
        type: model.getTableColumnMetadata(column)?.type,
      }).toEqual({ column, type: TableColumnType.Number });
    }

    expect(
      model.getTableColumnMetadata(SEPARATE_SSO_SESSION_LENGTHS_COLUMN)?.type,
    ).toBe(TableColumnType.Boolean);
    expect(
      model.getTableColumnMetadata(SEPARATE_SSO_SESSION_LENGTHS_COLUMN)
        ?.defaultValue,
    ).toBe(false);
  });

  test("the five, in the order the page and the preview send them", () => {
    expect([...SESSION_LENGTH_SETTING_COLUMNS]).toEqual([
      "sessionLengthInMinutes",
      "sessionIdleTimeoutInMinutes",
      "ssoSessionLengthInMinutes",
      "ssoSessionIdleTimeoutInMinutes",
      "useSeparateSsoSessionLengths",
    ]);
  });

  test.each([
    [SESSION_LENGTH_COLUMN, SessionLengthKind.Length],
    [SSO_SESSION_LENGTH_COLUMN, SessionLengthKind.Length],
    [SESSION_IDLE_TIMEOUT_COLUMN, SessionLengthKind.IdleTimeout],
    [SSO_SESSION_IDLE_TIMEOUT_COLUMN, SessionLengthKind.IdleTimeout],
  ])(
    "%s holds a %s",
    (column: SessionLengthColumn, kind: SessionLengthKind) => {
      expect(getSessionLengthColumnKind(column)).toBe(kind);
    },
  );

  test("a session length runs from 15 minutes to a year, an idle timeout from 15 minutes to 30 days", () => {
    expect(MIN_SESSION_LENGTH_IN_MINUTES).toBe(15);
    expect(MAX_SESSION_LENGTH_IN_MINUTES).toBe(365 * 24 * 60);
    expect(MIN_SESSION_IDLE_TIMEOUT_IN_MINUTES).toBe(15);
    expect(MAX_SESSION_IDLE_TIMEOUT_IN_MINUTES).toBe(30 * 24 * 60);
    expect(DEFAULT_SESSION_IDLE_DAYS).toBe(30);
    expect(DEFAULT_SESSION_IDLE_TIMEOUT_IN_MINUTES).toBe(
      MAX_SESSION_IDLE_TIMEOUT_IN_MINUTES,
    );
    expect(getSessionLengthRange(SESSION_LENGTH_COLUMN)).toEqual({
      min: 15,
      max: MAX_SESSION_LENGTH_IN_MINUTES,
    });
    expect(getSessionLengthRange(SSO_SESSION_IDLE_TIMEOUT_COLUMN)).toEqual({
      min: 15,
      max: MAX_SESSION_IDLE_TIMEOUT_IN_MINUTES,
    });
  });
});

describe("what a write may hold", () => {
  test.each(
    SESSION_LENGTH_COLUMNS.flatMap((column: SessionLengthColumn) => {
      return [
        [column, null],
        [column, undefined],
      ];
    }),
  )(
    "%s: nothing (%p) is the default, and fine",
    (column: SessionLengthColumn, value: unknown) => {
      expect(getSessionLengthProblem(column, value)).toBeNull();
    },
  );

  test.each([15, 60, 480, 1440, 43200])(
    "a session length of %p whole minutes is fine",
    (value: number) => {
      expect(getSessionLengthProblem(SESSION_LENGTH_COLUMN, value)).toBeNull();
      expect(
        getSessionLengthProblem(SSO_SESSION_LENGTH_COLUMN, value),
      ).toBeNull();
    },
  );

  test("a year is the longest session length, and also fine", () => {
    expect(
      getSessionLengthProblem(
        SESSION_LENGTH_COLUMN,
        MAX_SESSION_LENGTH_IN_MINUTES,
      ),
    ).toBeNull();
    expect(
      getSessionLengthProblem(
        SESSION_LENGTH_COLUMN,
        MAX_SESSION_LENGTH_IN_MINUTES + 1,
      ),
    ).toBe(SESSION_LENGTH_PROBLEM);
  });

  test("30 days is the longest idle timeout: a day more is refused", () => {
    expect(
      getSessionLengthProblem(
        SESSION_IDLE_TIMEOUT_COLUMN,
        MAX_SESSION_IDLE_TIMEOUT_IN_MINUTES,
      ),
    ).toBeNull();
    expect(
      getSessionLengthProblem(
        SESSION_IDLE_TIMEOUT_COLUMN,
        MAX_SESSION_IDLE_TIMEOUT_IN_MINUTES + 1,
      ),
    ).toBe(SESSION_IDLE_TIMEOUT_PROBLEM);
    // A session length may be longer than any idle timeout.
    expect(
      getSessionLengthProblem(
        SESSION_LENGTH_COLUMN,
        MAX_SESSION_IDLE_TIMEOUT_IN_MINUTES + 1,
      ),
    ).toBeNull();
  });

  test.each([
    ["shorter than an access token lives", 14],
    ["zero", 0],
    ["negative", -60],
    ["a fraction of a minute", 60.5],
    ["NaN", Number.NaN],
    ["infinity", Number.POSITIVE_INFINITY],
    ["a number written as text", "60"],
    ["a boolean", true],
    ["an object", { minutes: 60 }],
    ["an array", [60]],
  ])(
    "%s is refused, with what a length may be",
    (_label: string, value: unknown) => {
      expect(getSessionLengthProblem(SESSION_LENGTH_COLUMN, value)).toBe(
        SESSION_LENGTH_PROBLEM,
      );
      expect(
        getSessionLengthProblem(SSO_SESSION_IDLE_TIMEOUT_COLUMN, value),
      ).toBe(SESSION_IDLE_TIMEOUT_PROBLEM);
    },
  );

  test("the refusals say the range and what empty means", () => {
    expect(SESSION_LENGTH_PROBLEM).toContain("15");
    expect(SESSION_LENGTH_PROBLEM).toContain("525600");
    expect(SESSION_LENGTH_PROBLEM).toContain("empty for no limit");
    expect(SESSION_IDLE_TIMEOUT_PROBLEM).toContain("43200");
    expect(SESSION_IDLE_TIMEOUT_PROBLEM).toContain("empty for 30 days");
  });

  test.each([true, false, null, undefined])(
    "the SSO switch takes %p",
    (value: unknown) => {
      expect(getSeparateSsoSessionLengthsProblem(value)).toBeNull();
      expect(
        getSessionLengthSettingProblem(
          SEPARATE_SSO_SESSION_LENGTHS_COLUMN,
          value,
        ),
      ).toBeNull();
    },
  );

  test.each(["true", 1, 0, {}, "on"])(
    "and refuses %p, which is no boolean",
    (value: unknown) => {
      expect(getSeparateSsoSessionLengthsProblem(value)).toBe(
        SEPARATE_SSO_SESSION_LENGTHS_PROBLEM,
      );
    },
  );

  test("getSessionLengthSettingProblem asks each length column its own rule", () => {
    expect(
      getSessionLengthSettingProblem(SESSION_IDLE_TIMEOUT_COLUMN, 10),
    ).toBe(SESSION_IDLE_TIMEOUT_PROBLEM);
    expect(getSessionLengthSettingProblem(SESSION_LENGTH_COLUMN, 10)).toBe(
      SESSION_LENGTH_PROBLEM,
    );
  });
});

describe("what a stored value means", () => {
  test("a value no write could hold is the default, so a stray value never signs anyone out early", () => {
    for (const value of [14, "60", -1, 1.5, Number.NaN, true]) {
      expect(readSessionLengthValue(SESSION_LENGTH_COLUMN, value)).toBeNull();
    }

    expect(readSessionLengthValue(SESSION_LENGTH_COLUMN, 120)).toBe(120);
    expect(readSessionLengthValue(SESSION_IDLE_TIMEOUT_COLUMN, 50000)).toBe(
      null,
    );
  });

  test("an empty row, or none at all, is no setting", () => {
    expect(readSessionLengthSettings(null)).toEqual(NO_SESSION_LENGTH_SETTINGS);
    expect(readSessionLengthSettings(undefined)).toEqual(
      NO_SESSION_LENGTH_SETTINGS,
    );
    expect(readSessionLengthSettings({})).toEqual(NO_SESSION_LENGTH_SETTINGS);
    expect(readSessionLengths(null)).toEqual(NO_SESSION_LENGTHS);
  });

  test("the SSO switch is on only when it holds true", () => {
    for (const value of [false, null, undefined, "true", 1]) {
      expect(
        readSessionLengthSettings({ useSeparateSsoSessionLengths: value })
          .useSeparateSsoSessionLengths,
      ).toBe(false);
    }

    expect(
      readSessionLengthSettings({ useSeparateSsoSessionLengths: true })
        .useSeparateSsoSessionLengths,
    ).toBe(true);
  });

  test("with the switch off, SSO sign-ins follow the lengths every sign-in follows, whatever the SSO columns hold", () => {
    const row: Partial<Record<SessionLengthSettingColumn, unknown>> = {
      sessionLengthInMinutes: 480,
      sessionIdleTimeoutInMinutes: 30,
      useSeparateSsoSessionLengths: false,
      ssoSessionLengthInMinutes: 60,
      ssoSessionIdleTimeoutInMinutes: 15,
    };

    expect(readSessionLengths(row)).toEqual({
      standard: { lengthInMinutes: 480, idleTimeoutInMinutes: 30 },
      sso: { lengthInMinutes: 480, idleTimeoutInMinutes: 30 },
    });
  });

  test("with the switch on, SSO sign-ins follow the SSO columns - empty ones too", () => {
    expect(
      readSessionLengths({
        sessionLengthInMinutes: 480,
        sessionIdleTimeoutInMinutes: 30,
        useSeparateSsoSessionLengths: true,
        ssoSessionLengthInMinutes: null,
        ssoSessionIdleTimeoutInMinutes: 120,
      }),
    ).toEqual({
      standard: { lengthInMinutes: 480, idleTimeoutInMinutes: 30 },
      sso: { lengthInMinutes: null, idleTimeoutInMinutes: 120 },
    });
  });

  test("toSessionLengths never hands out the standard rule object for SSO to change", () => {
    const settings: SessionLengthSettings = {
      ...NO_SESSION_LENGTH_SETTINGS,
      sessionLengthInMinutes: 60,
    };
    const result: SessionLengths = toSessionLengths(settings);

    expect(result.sso).toEqual(result.standard);
    expect(result.sso).not.toBe(result.standard);
  });

  test("sanitizeSessionLengths reads every value again, so a module can hand core nothing a column could not hold", () => {
    expect(
      sanitizeSessionLengths({
        standard: { lengthInMinutes: 60, idleTimeoutInMinutes: "30" },
        sso: { lengthInMinutes: 5, idleTimeoutInMinutes: 120 },
      }),
    ).toEqual({
      standard: { lengthInMinutes: 60, idleTimeoutInMinutes: null },
      sso: { lengthInMinutes: null, idleTimeoutInMinutes: 120 },
    });

    for (const value of [null, undefined, "lengths", 42, []]) {
      expect(sanitizeSessionLengths(value)).toEqual(NO_SESSION_LENGTHS);
    }
  });

  test("a rule is set when either of its lengths is", () => {
    expect(
      isSessionLengthRuleSet({
        lengthInMinutes: null,
        idleTimeoutInMinutes: null,
      }),
    ).toBe(false);
    expect(
      isSessionLengthRuleSet({
        lengthInMinutes: 60,
        idleTimeoutInMinutes: null,
      }),
    ).toBe(true);
    expect(
      isSessionLengthRuleSet({
        lengthInMinutes: null,
        idleTimeoutInMinutes: 15,
      }),
    ).toBe(true);
  });

  test("lengths limit sign-ins when any rule is set, of either kind", () => {
    expect(hasSessionLimits(null)).toBe(false);
    expect(hasSessionLimits(undefined)).toBe(false);
    expect(hasSessionLimits(NO_SESSION_LENGTHS)).toBe(false);
    expect(hasSessionLimits(lengths({ length: 60 }, {}))).toBe(true);
    expect(hasSessionLimits(lengths({}, { idle: 30 }))).toBe(true);
  });

  test("each kind of sign-in has its rule, and nothing set is no rule", () => {
    const set: SessionLengths = lengths({ length: 60 }, { idle: 30 });

    expect(getSessionLengthRule(set, false)).toEqual({
      lengthInMinutes: 60,
      idleTimeoutInMinutes: null,
    });
    expect(getSessionLengthRule(set, true)).toEqual({
      lengthInMinutes: null,
      idleTimeoutInMinutes: 30,
    });
    expect(getSessionLengthRule(null, true)).toEqual({
      lengthInMinutes: null,
      idleTimeoutInMinutes: null,
    });
  });

  test("an idle timeout that is not set is the 30 days of a refresh token", () => {
    expect(
      getIdleTimeoutInMinutes({
        lengthInMinutes: null,
        idleTimeoutInMinutes: null,
      }),
    ).toBe(DEFAULT_SESSION_IDLE_TIMEOUT_IN_MINUTES);
    expect(
      getIdleTimeoutInMinutes({
        lengthInMinutes: null,
        idleTimeoutInMinutes: 45,
      }),
    ).toBe(45);
  });
});

describe("when a session ends", () => {
  test("without any lengths, 30 days after its person was last active - as every sign-in always has", () => {
    const end: { endsAt: Date; reason: SessionEndReason } = getSessionEnd(
      facts({ lastActiveAt: new Date(SIGNED_IN_AT.getTime() + DAY) }),
      null,
    );

    expect(end.endsAt.getTime()).toBe(SIGNED_IN_AT.getTime() + DAY + 30 * DAY);
    expect(end.reason).toBe(SessionEndReason.Inactive);
  });

  test("a session length counts from the sign-in, however active the person is", () => {
    const end: { endsAt: Date; reason: SessionEndReason } = getSessionEnd(
      facts({ lastActiveAt: new Date(SIGNED_IN_AT.getTime() + 7 * HOUR) }),
      lengths({ length: 8 * 60 }),
    );

    expect(end).toEqual({
      endsAt: new Date(SIGNED_IN_AT.getTime() + 8 * HOUR),
      reason: SessionEndReason.LengthReached,
    });
  });

  test("an idle timeout counts from the last activity", () => {
    const lastActiveAt: Date = new Date(SIGNED_IN_AT.getTime() + 3 * HOUR);

    expect(
      getSessionEnd(facts({ lastActiveAt }), lengths({ idle: 30 })),
    ).toEqual({
      endsAt: new Date(lastActiveAt.getTime() + 30 * MINUTE),
      reason: SessionEndReason.Inactive,
    });
  });

  test("with both set, the sooner ends it", () => {
    const both: SessionLengths = lengths({ length: 8 * 60, idle: 60 });

    // Active at 7:30: the length's end (8:00) comes before the idle end (8:30).
    expect(
      getSessionEnd(
        facts({ lastActiveAt: new Date(SIGNED_IN_AT.getTime() + 7.5 * HOUR) }),
        both,
      ).reason,
    ).toBe(SessionEndReason.LengthReached);

    // Idle since hour 2: the idle timeout ends it at hour 3, long before the length.
    expect(
      getSessionEnd(
        facts({ lastActiveAt: new Date(SIGNED_IN_AT.getTime() + 2 * HOUR) }),
        both,
      ),
    ).toEqual({
      endsAt: new Date(SIGNED_IN_AT.getTime() + 3 * HOUR),
      reason: SessionEndReason.Inactive,
    });
  });

  test("when both fall at the same moment, the length is the reason: no activity could have moved it", () => {
    const end: { endsAt: Date; reason: SessionEndReason } = getSessionEnd(
      facts({ lastActiveAt: new Date(SIGNED_IN_AT.getTime() + 7 * HOUR) }),
      lengths({ length: 8 * 60, idle: 60 }),
    );

    expect(end.endsAt.getTime()).toBe(SIGNED_IN_AT.getTime() + 8 * HOUR);
    expect(end.reason).toBe(SessionEndReason.LengthReached);
  });

  test("an SSO sign-in follows the SSO rule, every other sign-in the standard one", () => {
    const split: SessionLengths = lengths({ length: 60 }, { length: 12 * 60 });

    expect(getSessionEnd(facts(), split).endsAt.getTime()).toBe(
      SIGNED_IN_AT.getTime() + HOUR,
    );
    expect(
      getSessionEnd(facts({ isSsoSignIn: true }), split).endsAt.getTime(),
    ).toBe(SIGNED_IN_AT.getTime() + 12 * HOUR);
  });

  test("a session has ended at its end exactly, not a millisecond before", () => {
    const rule: SessionLengths = lengths({ length: 60 });
    const endMs: number = SIGNED_IN_AT.getTime() + HOUR;

    expect(getSessionEndReachedBy(facts(), rule, new Date(endMs - 1))).toBe(
      null,
    );
    expect(getSessionEndReachedBy(facts(), rule, new Date(endMs))).toBe(
      SessionEndReason.LengthReached,
    );
    expect(getSessionEndReachedBy(facts(), rule, new Date(endMs + DAY))).toBe(
      SessionEndReason.LengthReached,
    );
  });

  test("an idle session has ended for inactivity", () => {
    expect(
      getSessionEndReachedBy(
        facts(),
        lengths({ idle: 15 }),
        new Date(SIGNED_IN_AT.getTime() + 16 * MINUTE),
      ),
    ).toBe(SessionEndReason.Inactive);
  });
});

describe("what a renewal makes of the browser's report of inactivity", () => {
  test.each([0, 1, 59.9, 3600, MAX_REPORTED_INACTIVITY_IN_SECONDS])(
    "a report of %p seconds is read, in whole seconds",
    (value: number) => {
      expect(readReportedInactivityInSeconds(value)).toBe(Math.floor(value));
    },
  );

  test.each([
    ["negative", -1],
    ["more than two idle timeouts", MAX_REPORTED_INACTIVITY_IN_SECONDS + 1],
    ["NaN", Number.NaN],
    ["infinity", Number.POSITIVE_INFINITY],
    ["text", "120"],
    ["nothing", undefined],
    ["null", null],
    ["an object", { seconds: 5 }],
  ])("%s is no report", (_label: string, value: unknown) => {
    expect(readReportedInactivityInSeconds(value)).toBeNull();
  });

  test("the renewal's field name is the one the Dashboard sends", () => {
    expect(INACTIVE_FOR_IN_SECONDS_FIELD).toBe("inactiveForInSeconds");
  });

  const NOW: Date = new Date("2026-11-02T12:00:00.000Z");

  test("without a report, the renewal itself is the activity", () => {
    expect(
      getActivityAtRenewal({
        storedLastActiveAt: new Date(NOW.getTime() - 5 * HOUR),
        reportedInactivityInSeconds: null,
        now: NOW,
      }),
    ).toEqual(NOW);
  });

  test("with one, the last activity is that long before now", () => {
    expect(
      getActivityAtRenewal({
        storedLastActiveAt: new Date(NOW.getTime() - 5 * HOUR),
        reportedInactivityInSeconds: 600,
        now: NOW,
      }),
    ).toEqual(new Date(NOW.getTime() - 10 * MINUTE));
  });

  test("it never moves before what the session knew already: a stale tab cannot sign out one in use", () => {
    expect(
      getActivityAtRenewal({
        storedLastActiveAt: new Date(NOW.getTime() - 5 * MINUTE),
        reportedInactivityInSeconds: 3 * 60 * 60,
        now: NOW,
      }),
    ).toEqual(new Date(NOW.getTime() - 5 * MINUTE));
  });

  test("and never after now, whatever the session says", () => {
    expect(
      getActivityAtRenewal({
        storedLastActiveAt: new Date(NOW.getTime() + HOUR),
        reportedInactivityInSeconds: 0,
        now: NOW,
      }),
    ).toEqual(NOW);
  });
});

describe("whether a change shortens a sign-in", () => {
  test("a shorter session length or idle timeout of either kind does", () => {
    const before: SessionLengths = lengths({ length: 8 * 60, idle: 60 });

    expect(
      doesShortenAnySession(before, lengths({ length: 4 * 60, idle: 60 })),
    ).toBe(true);
    expect(
      doesShortenAnySession(before, lengths({ length: 8 * 60, idle: 30 })),
    ).toBe(true);
    expect(
      doesShortenAnySession(
        before,
        lengths({ length: 8 * 60, idle: 60 }, { length: 60, idle: 60 }),
      ),
    ).toBe(true);
  });

  test("setting a limit where there was none does", () => {
    expect(
      doesShortenAnySession(NO_SESSION_LENGTHS, lengths({ length: 60 })),
    ).toBe(true);
    expect(
      doesShortenAnySession(NO_SESSION_LENGTHS, lengths({ idle: 60 })),
    ).toBe(true);
  });

  test("a longer one, the same one, or removing one does not", () => {
    const before: SessionLengths = lengths({ length: 60, idle: 15 });

    expect(doesShortenAnySession(before, before)).toBe(false);
    expect(
      doesShortenAnySession(before, lengths({ length: 120, idle: 15 })),
    ).toBe(false);
    expect(doesShortenAnySession(before, NO_SESSION_LENGTHS)).toBe(false);
    // 30 days written out is the default, not a change.
    expect(
      doesShortenAnySession(
        NO_SESSION_LENGTHS,
        lengths({ idle: DEFAULT_SESSION_IDLE_TIMEOUT_IN_MINUTES }),
      ),
    ).toBe(false);
  });
});

describe("why a session ended, as the browser is told", () => {
  test("two reasons, each with the value the sign-in page's address carries", () => {
    expect(SessionEndReason.LengthReached).toBe("length-reached");
    expect(SessionEndReason.Inactive).toBe("inactive");
    expect(SESSION_ENDED_QUERY_PARAM).toBe("sessionEnded");
  });

  test("only those two are reasons", () => {
    expect(isSessionEndReason("length-reached")).toBe(true);
    expect(isSessionEndReason("inactive")).toBe(true);

    for (const value of ["expired", "", null, undefined, 1, "INACTIVE"]) {
      expect(isSessionEndReason(value)).toBe(false);
      expect(readSessionEndReason(value)).toBeNull();
    }

    expect(readSessionEndReason("inactive")).toBe(SessionEndReason.Inactive);
  });
});

describe("the choices the Admin Dashboard offers", () => {
  test("session lengths run from 1 hour to 90 days, shortest first, every one a value a write may hold", () => {
    expect(SESSION_LENGTH_CHOICES_IN_MINUTES[0]).toBe(60);
    expect(
      SESSION_LENGTH_CHOICES_IN_MINUTES[
        SESSION_LENGTH_CHOICES_IN_MINUTES.length - 1
      ],
    ).toBe(90 * 24 * 60);
    expect([...SESSION_LENGTH_CHOICES_IN_MINUTES]).toEqual(
      [...SESSION_LENGTH_CHOICES_IN_MINUTES].sort((a: number, b: number) => {
        return a - b;
      }),
    );

    for (const minutes of SESSION_LENGTH_CHOICES_IN_MINUTES) {
      expect(
        getSessionLengthProblem(SESSION_LENGTH_COLUMN, minutes),
      ).toBeNull();
    }
  });

  test("idle timeouts run from 15 minutes to 14 days, and 30 days is the default rather than a choice of its own", () => {
    expect(SESSION_IDLE_TIMEOUT_CHOICES_IN_MINUTES[0]).toBe(15);
    expect(
      SESSION_IDLE_TIMEOUT_CHOICES_IN_MINUTES[
        SESSION_IDLE_TIMEOUT_CHOICES_IN_MINUTES.length - 1
      ],
    ).toBe(14 * 24 * 60);
    expect(SESSION_IDLE_TIMEOUT_CHOICES_IN_MINUTES).not.toContain(
      DEFAULT_SESSION_IDLE_TIMEOUT_IN_MINUTES,
    );

    for (const minutes of SESSION_IDLE_TIMEOUT_CHOICES_IN_MINUTES) {
      expect(
        getSessionLengthProblem(SESSION_IDLE_TIMEOUT_COLUMN, minutes),
      ).toBeNull();
    }
  });
});
