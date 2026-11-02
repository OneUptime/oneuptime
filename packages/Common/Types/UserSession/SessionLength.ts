/*
 * HOW LONG A SIGN-IN TO ONEUPTIME LASTS.
 *
 * Signing in to the Dashboard, the Admin Dashboard or the mobile app starts a
 * session (UserSession): with a password or a passkey, with Sign in with
 * Microsoft, or through single sign-on - a project's SAML or OpenID Connect
 * provider, or the server's own. The session's access token lasts 15 minutes
 * and is renewed with its refresh token, which lasts 30 days and starts the
 * 30 days again at every renewal, so someone who opens OneUptime at least
 * once a month stays signed in for good. That is how every sign-in lasts on
 * the Community Edition, and on the Enterprise Edition while nothing here is
 * set.
 *
 * The Enterprise Edition lets a master admin shorten it (Admin Dashboard >
 * Settings > Session Length), for SSO sign-ins and for every other sign-in
 * each (SessionLengths):
 *
 *   - the session length ("Sign people out after"): a session ends once that
 *     long has passed since its sign-in, however active its person is. None
 *     by default.
 *   - the idle timeout ("Sign people out after inactivity"): a session ends
 *     once its person has not used OneUptime for that long. 30 days by
 *     default - how long a refresh token lasts anyway - and never longer:
 *     these settings only ever shorten a sign-in.
 *
 * Both are counted by the server, from the session's own facts
 * (SessionFacts): when it signed in, and when its person was last active. A
 * browser says how long its person has not clicked, typed or scrolled when
 * it renews the session; anything else (the mobile app, an older page) is
 * active whenever it renews. The server decides at every renewal and on
 * every request (getSessionEnd), never the browser, and a change applies to
 * the sessions there are: a shorter length signs out everyone it is past.
 *
 * The values are whole minutes in the GlobalConfig columns below. The
 * Enterprise module hands core what they hold (EnterpriseEdition.
 * getUserSessionLengths); without it there are none, and every sign-in lasts
 * as it always has.
 */

// The GlobalConfig columns that hold them, in minutes.
export type SessionLengthColumn =
  | "sessionLengthInMinutes"
  | "sessionIdleTimeoutInMinutes"
  | "ssoSessionLengthInMinutes"
  | "ssoSessionIdleTimeoutInMinutes";

export const SESSION_LENGTH_COLUMN: SessionLengthColumn =
  "sessionLengthInMinutes";

export const SESSION_IDLE_TIMEOUT_COLUMN: SessionLengthColumn =
  "sessionIdleTimeoutInMinutes";

export const SSO_SESSION_LENGTH_COLUMN: SessionLengthColumn =
  "ssoSessionLengthInMinutes";

export const SSO_SESSION_IDLE_TIMEOUT_COLUMN: SessionLengthColumn =
  "ssoSessionIdleTimeoutInMinutes";

export const SESSION_LENGTH_COLUMNS: ReadonlyArray<SessionLengthColumn> = [
  SESSION_LENGTH_COLUMN,
  SESSION_IDLE_TIMEOUT_COLUMN,
  SSO_SESSION_LENGTH_COLUMN,
  SSO_SESSION_IDLE_TIMEOUT_COLUMN,
];

// Which kind of value a column holds.
export enum SessionLengthKind {
  // From the sign-in, however active the person is.
  Length = "length",
  // Without use.
  IdleTimeout = "idle-timeout",
}

export const getSessionLengthColumnKind: (
  column: SessionLengthColumn,
) => SessionLengthKind = (column: SessionLengthColumn): SessionLengthKind => {
  return column === SESSION_LENGTH_COLUMN || column === SSO_SESSION_LENGTH_COLUMN
    ? SessionLengthKind.Length
    : SessionLengthKind.IdleTimeout;
};

export const MINUTES_IN_A_DAY: number = 24 * 60;

// The shortest either may be: fifteen minutes, one access token's life.
export const MIN_SESSION_LENGTH_IN_MINUTES: number = 15;

export const MIN_SESSION_IDLE_TIMEOUT_IN_MINUTES: number = 15;

// The longest a session length may be: a year.
export const MAX_SESSION_LENGTH_IN_MINUTES: number = 365 * MINUTES_IN_A_DAY;

/*
 * How long a session stays signed in without use when nothing shortens it:
 * its refresh token's lifetime (UserSessionService), started again at
 * every renewal. The idle timeout may be no longer.
 */
export const DEFAULT_SESSION_IDLE_DAYS: number = 30;

export const DEFAULT_SESSION_IDLE_TIMEOUT_IN_MINUTES: number =
  DEFAULT_SESSION_IDLE_DAYS * MINUTES_IN_A_DAY;

export const MAX_SESSION_IDLE_TIMEOUT_IN_MINUTES: number =
  DEFAULT_SESSION_IDLE_TIMEOUT_IN_MINUTES;

// The lengths the Admin Dashboard offers, shortest first: 1 hour to 90 days.
export const SESSION_LENGTH_CHOICES_IN_MINUTES: ReadonlyArray<number> = [
  60,
  4 * 60,
  8 * 60,
  12 * 60,
  MINUTES_IN_A_DAY,
  3 * MINUTES_IN_A_DAY,
  7 * MINUTES_IN_A_DAY,
  14 * MINUTES_IN_A_DAY,
  30 * MINUTES_IN_A_DAY,
  90 * MINUTES_IN_A_DAY,
];

// The idle timeouts it offers, shortest first: 15 minutes to the 30 days of the default.
export const SESSION_IDLE_TIMEOUT_CHOICES_IN_MINUTES: ReadonlyArray<number> = [
  15,
  30,
  60,
  2 * 60,
  4 * 60,
  8 * 60,
  12 * 60,
  MINUTES_IN_A_DAY,
  3 * MINUTES_IN_A_DAY,
  7 * MINUTES_IN_A_DAY,
  14 * MINUTES_IN_A_DAY,
  DEFAULT_SESSION_IDLE_TIMEOUT_IN_MINUTES,
];

export const SESSION_LENGTH_PROBLEM: string = `A session length must be a whole number of minutes from ${MIN_SESSION_LENGTH_IN_MINUTES} to ${MAX_SESSION_LENGTH_IN_MINUTES} (a year), or empty for no limit.`;

export const SESSION_IDLE_TIMEOUT_PROBLEM: string = `An idle timeout must be a whole number of minutes from ${MIN_SESSION_IDLE_TIMEOUT_IN_MINUTES} to ${MAX_SESSION_IDLE_TIMEOUT_IN_MINUTES} (30 days), or empty for 30 days.`;

// The range a column takes.
export const getSessionLengthRange: (column: SessionLengthColumn) => {
  min: number;
  max: number;
} = (column: SessionLengthColumn): { min: number; max: number } => {
  return getSessionLengthColumnKind(column) === SessionLengthKind.Length
    ? { min: MIN_SESSION_LENGTH_IN_MINUTES, max: MAX_SESSION_LENGTH_IN_MINUTES }
    : {
        min: MIN_SESSION_IDLE_TIMEOUT_IN_MINUTES,
        max: MAX_SESSION_IDLE_TIMEOUT_IN_MINUTES,
      };
};

/*
 * Why a value written to one of the columns is refused, or null when it is
 * fine: a whole number of minutes within the column's range, or nothing
 * (null, or not written at all) for the default. A number sent as text
 * ("60") is refused like any other value that is not a number: an unclear
 * value never shortens or lengthens anyone's sign-in.
 */
export const getSessionLengthProblem: (
  column: SessionLengthColumn,
  value: unknown,
) => string | null = (
  column: SessionLengthColumn,
  value: unknown,
): string | null => {
  if (value === undefined || value === null) {
    return null;
  }

  const range: { min: number; max: number } = getSessionLengthRange(column);

  if (
    typeof value !== "number" ||
    !Number.isInteger(value) ||
    value < range.min ||
    value > range.max
  ) {
    return getSessionLengthColumnKind(column) === SessionLengthKind.Length
      ? SESSION_LENGTH_PROBLEM
      : SESSION_IDLE_TIMEOUT_PROBLEM;
  }

  return null;
};

/*
 * What a column holds, in minutes, or null for the default. Whatever it
 * holds that could not have been written (see above) reads as the default,
 * so a stray value can never sign anyone out early.
 */
export const readSessionLengthValue: (
  column: SessionLengthColumn,
  value: unknown,
) => number | null = (
  column: SessionLengthColumn,
  value: unknown,
): number | null => {
  if (value === undefined || value === null) {
    return null;
  }

  return getSessionLengthProblem(column, value) === null
    ? (value as number)
    : null;
};

// One kind of sign-in's lengths.
export interface SessionLengthRule {
  // Minutes from the sign-in, or null for no limit.
  lengthInMinutes: number | null;
  // Minutes without use, or null for the default (30 days).
  idleTimeoutInMinutes: number | null;
}

export interface SessionLengths {
  // Every sign-in that is not SSO: a password, a passkey, Sign in with Microsoft.
  password: SessionLengthRule;
  // SSO: a project's SAML or OpenID Connect provider, or the server's.
  sso: SessionLengthRule;
}

export const NO_SESSION_LENGTHS: SessionLengths = {
  password: { lengthInMinutes: null, idleTimeoutInMinutes: null },
  sso: { lengthInMinutes: null, idleTimeoutInMinutes: null },
};

// The lengths a GlobalConfig row holds (each column read as above).
export const readSessionLengths: (
  row: Partial<Record<SessionLengthColumn, unknown>> | null | undefined,
) => SessionLengths = (
  row: Partial<Record<SessionLengthColumn, unknown>> | null | undefined,
): SessionLengths => {
  const read: (column: SessionLengthColumn) => number | null = (
    column: SessionLengthColumn,
  ): number | null => {
    return readSessionLengthValue(column, row ? row[column] : undefined);
  };

  return {
    password: {
      lengthInMinutes: read(SESSION_LENGTH_COLUMN),
      idleTimeoutInMinutes: read(SESSION_IDLE_TIMEOUT_COLUMN),
    },
    sso: {
      lengthInMinutes: read(SSO_SESSION_LENGTH_COLUMN),
      idleTimeoutInMinutes: read(SSO_SESSION_IDLE_TIMEOUT_COLUMN),
    },
  };
};

/*
 * The same lengths, each one read again: what a caller hands over can hold
 * nothing that a column could not.
 */
export const sanitizeSessionLengths: (lengths: unknown) => SessionLengths = (
  lengths: unknown,
): SessionLengths => {
  const asRule: (value: unknown) => Record<string, unknown> = (
    value: unknown,
  ): Record<string, unknown> => {
    return value && typeof value === "object"
      ? (value as Record<string, unknown>)
      : {};
  };

  const all: Record<string, unknown> = asRule(lengths);
  const password: Record<string, unknown> = asRule(all["password"]);
  const sso: Record<string, unknown> = asRule(all["sso"]);

  return readSessionLengths({
    [SESSION_LENGTH_COLUMN]: password["lengthInMinutes"],
    [SESSION_IDLE_TIMEOUT_COLUMN]: password["idleTimeoutInMinutes"],
    [SSO_SESSION_LENGTH_COLUMN]: sso["lengthInMinutes"],
    [SSO_SESSION_IDLE_TIMEOUT_COLUMN]: sso["idleTimeoutInMinutes"],
  });
};

// Whether any of them is set: with none, every sign-in lasts as it always has.
export const hasSessionLimits: (
  lengths: SessionLengths | null | undefined,
) => boolean = (lengths: SessionLengths | null | undefined): boolean => {
  if (!lengths) {
    return false;
  }

  return [lengths.password, lengths.sso].some(
    (rule: SessionLengthRule): boolean => {
      return rule.lengthInMinutes !== null || rule.idleTimeoutInMinutes !== null;
    },
  );
};

// The rule for one session's kind of sign-in.
export const getSessionLengthRule: (
  lengths: SessionLengths | null | undefined,
  isSsoSignIn: boolean,
) => SessionLengthRule = (
  lengths: SessionLengths | null | undefined,
  isSsoSignIn: boolean,
): SessionLengthRule => {
  const all: SessionLengths = lengths || NO_SESSION_LENGTHS;

  return isSsoSignIn ? all.sso : all.password;
};

// The idle timeout a rule holds, in minutes: its own, or the 30 days of the default.
export const getIdleTimeoutInMinutes: (rule: SessionLengthRule) => number = (
  rule: SessionLengthRule,
): number => {
  return rule.idleTimeoutInMinutes === null
    ? DEFAULT_SESSION_IDLE_TIMEOUT_IN_MINUTES
    : rule.idleTimeoutInMinutes;
};

// Why a session ended, as the server says it: to the browser, which tells its person.
export enum SessionEndReason {
  // As long has passed since its sign-in as the server lets a sign-in last.
  LengthReached = "length-reached",
  // Its person did not use OneUptime for as long as the server allows.
  Inactive = "inactive",
}

export const isSessionEndReason: (value: unknown) => value is SessionEndReason =
  (value: unknown): value is SessionEndReason => {
    return (
      value === SessionEndReason.LengthReached ||
      value === SessionEndReason.Inactive
    );
  };

// What a session's end is decided from.
export interface SessionFacts {
  // When it signed in (UserSession.createdAt).
  signedInAt: Date;
  // When its person was last active (UserSession.lastActiveAt).
  lastActiveAt: Date;
  // Whether it is an SSO sign-in.
  isSsoSignIn: boolean;
}

export interface SessionEnd {
  endsAt: Date;
  reason: SessionEndReason;
}

const MS_IN_A_MINUTE: number = 60 * 1000;

/*
 * When a session ends, and why, under the lengths (null: none set): the
 * sooner of its sign-in plus its kind's length, and its last activity plus
 * its kind's idle timeout. Where both fall at the same moment, the length
 * is the reason: it is the one no activity could have moved.
 */
export const getSessionEnd: (
  facts: SessionFacts,
  lengths: SessionLengths | null | undefined,
) => SessionEnd = (
  facts: SessionFacts,
  lengths: SessionLengths | null | undefined,
): SessionEnd => {
  const rule: SessionLengthRule = getSessionLengthRule(
    lengths,
    facts.isSsoSignIn,
  );

  const idleEndsAtMs: number =
    facts.lastActiveAt.getTime() +
    getIdleTimeoutInMinutes(rule) * MS_IN_A_MINUTE;

  if (rule.lengthInMinutes !== null) {
    const lengthEndsAtMs: number =
      facts.signedInAt.getTime() + rule.lengthInMinutes * MS_IN_A_MINUTE;

    if (lengthEndsAtMs <= idleEndsAtMs) {
      return {
        endsAt: new Date(lengthEndsAtMs),
        reason: SessionEndReason.LengthReached,
      };
    }
  }

  return {
    endsAt: new Date(idleEndsAtMs),
    reason: SessionEndReason.Inactive,
  };
};

// Whether a session has ended by `now`, and why, or null while it has not.
export const getSessionEndReachedBy: (
  facts: SessionFacts,
  lengths: SessionLengths | null | undefined,
  now: Date,
) => SessionEndReason | null = (
  facts: SessionFacts,
  lengths: SessionLengths | null | undefined,
  now: Date,
): SessionEndReason | null => {
  const end: SessionEnd = getSessionEnd(facts, lengths);

  return end.endsAt.getTime() <= now.getTime() ? end.reason : null;
};

/*
 * The most a browser's report of how long its person has not used
 * OneUptime is taken as: a report past it is no report. Anything longer has
 * passed every idle timeout anyway.
 */
export const MAX_REPORTED_INACTIVITY_IN_SECONDS: number =
  MAX_SESSION_IDLE_TIMEOUT_IN_MINUTES * 60 * 2;

/*
 * How long a renewal says its person has not used OneUptime, in seconds,
 * or null when it says nothing usable: a whole, non-negative number of
 * seconds, no more than MAX_REPORTED_INACTIVITY_IN_SECONDS.
 */
export const readReportedInactivityInSeconds: (
  value: unknown,
) => number | null = (value: unknown): number | null => {
  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    value < 0 ||
    value > MAX_REPORTED_INACTIVITY_IN_SECONDS
  ) {
    return null;
  }

  return Math.floor(value);
};

/*
 * When a session's person was last active, as a renewal at `now` says it:
 * `now` less what the browser reports - never before what the session knew
 * already, never after `now`. Without a report, the renewal is the
 * activity.
 */
export const getActivityAtRenewal: (data: {
  storedLastActiveAt: Date;
  reportedInactivityInSeconds: number | null;
  now: Date;
}) => Date = (data: {
  storedLastActiveAt: Date;
  reportedInactivityInSeconds: number | null;
  now: Date;
}): Date => {
  if (data.reportedInactivityInSeconds === null) {
    return data.now;
  }

  const reportedMs: number =
    data.now.getTime() - data.reportedInactivityInSeconds * 1000;

  return new Date(
    Math.min(
      data.now.getTime(),
      Math.max(data.storedLastActiveAt.getTime(), reportedMs),
    ),
  );
};
