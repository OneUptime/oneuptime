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
 * Settings > Session Length):
 *
 *   - the session length ("Sign people out after"): a session ends once that
 *     long has passed since its sign-in, however active its person is. No
 *     limit by default.
 *   - the idle timeout ("Sign people out after inactivity"): a session ends
 *     once its person has not used OneUptime for that long. 30 days by
 *     default - how long a refresh token lasts anyway - and never longer:
 *     these settings only ever shorten a sign-in.
 *
 * The two apply to every sign-in. SSO sign-ins may have two of their own
 * instead (useSeparateSsoSessionLengths): then the first two apply to the
 * other sign-ins - a password, a passkey, Sign in with Microsoft - and the
 * SSO two to SSO sign-ins. SessionLengths is what applies to each kind.
 *
 * Both are counted by the server, from the session's own facts
 * (SessionFacts): when it signed in, and when its person was last active. A
 * browser says how long its person has not clicked, typed or scrolled when
 * it renews the session; anything else (the mobile app, an older page) is
 * active whenever it renews. The server decides at every renewal and on
 * every request (getSessionEnd), never the browser, and a change applies to
 * the sessions there are: a shorter length signs out everyone it is past.
 *
 * The values live in the GlobalConfig columns below, the lengths in whole
 * minutes. The Enterprise module hands core what they hold (EnterpriseEdition.
 * getUserSessionLengths); without it there are none, and every sign-in lasts
 * as it always has.
 */

// The GlobalConfig columns that hold a length, in minutes.
export type SessionLengthColumn =
  | "sessionLengthInMinutes"
  | "sessionIdleTimeoutInMinutes"
  | "ssoSessionLengthInMinutes"
  | "ssoSessionIdleTimeoutInMinutes";

// Every GlobalConfig column the setting is kept in.
export type SessionLengthSettingColumn =
  | SessionLengthColumn
  | "useSeparateSsoSessionLengths";

export const SESSION_LENGTH_COLUMN: SessionLengthColumn =
  "sessionLengthInMinutes";

export const SESSION_IDLE_TIMEOUT_COLUMN: SessionLengthColumn =
  "sessionIdleTimeoutInMinutes";

export const SSO_SESSION_LENGTH_COLUMN: SessionLengthColumn =
  "ssoSessionLengthInMinutes";

export const SSO_SESSION_IDLE_TIMEOUT_COLUMN: SessionLengthColumn =
  "ssoSessionIdleTimeoutInMinutes";

/*
 * Whether SSO sign-ins have lengths of their own (the two SSO columns). Off
 * (false, the default): every sign-in follows the first two.
 */
export const SEPARATE_SSO_SESSION_LENGTHS_COLUMN: SessionLengthSettingColumn =
  "useSeparateSsoSessionLengths";

export const SESSION_LENGTH_COLUMNS: ReadonlyArray<SessionLengthColumn> = [
  SESSION_LENGTH_COLUMN,
  SESSION_IDLE_TIMEOUT_COLUMN,
  SSO_SESSION_LENGTH_COLUMN,
  SSO_SESSION_IDLE_TIMEOUT_COLUMN,
];

export const SESSION_LENGTH_SETTING_COLUMNS: ReadonlyArray<SessionLengthSettingColumn> =
  [...SESSION_LENGTH_COLUMNS, SEPARATE_SSO_SESSION_LENGTHS_COLUMN];

// Which kind of value a length column holds.
export enum SessionLengthKind {
  // From the sign-in, however active the person is.
  Length = "length",
  // Without use.
  IdleTimeout = "idle-timeout",
}

export const getSessionLengthColumnKind: (
  column: SessionLengthColumn,
) => SessionLengthKind = (column: SessionLengthColumn): SessionLengthKind => {
  return column === SESSION_LENGTH_COLUMN ||
    column === SSO_SESSION_LENGTH_COLUMN
    ? SessionLengthKind.Length
    : SessionLengthKind.IdleTimeout;
};

export const MINUTES_IN_AN_HOUR: number = 60;

export const MINUTES_IN_A_DAY: number = 24 * MINUTES_IN_AN_HOUR;

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
  MINUTES_IN_AN_HOUR,
  4 * MINUTES_IN_AN_HOUR,
  8 * MINUTES_IN_AN_HOUR,
  12 * MINUTES_IN_AN_HOUR,
  MINUTES_IN_A_DAY,
  3 * MINUTES_IN_A_DAY,
  7 * MINUTES_IN_A_DAY,
  14 * MINUTES_IN_A_DAY,
  30 * MINUTES_IN_A_DAY,
  90 * MINUTES_IN_A_DAY,
];

/*
 * The idle timeouts it offers, shortest first: 15 minutes to 14 days. The
 * 30 days of the default is the choice for no idle timeout of its own.
 */
export const SESSION_IDLE_TIMEOUT_CHOICES_IN_MINUTES: ReadonlyArray<number> = [
  15,
  30,
  MINUTES_IN_AN_HOUR,
  2 * MINUTES_IN_AN_HOUR,
  4 * MINUTES_IN_AN_HOUR,
  8 * MINUTES_IN_AN_HOUR,
  12 * MINUTES_IN_AN_HOUR,
  MINUTES_IN_A_DAY,
  3 * MINUTES_IN_A_DAY,
  7 * MINUTES_IN_A_DAY,
  14 * MINUTES_IN_A_DAY,
];

export const SESSION_LENGTH_PROBLEM: string = `A session length must be a whole number of minutes from ${MIN_SESSION_LENGTH_IN_MINUTES} to ${MAX_SESSION_LENGTH_IN_MINUTES} (a year), or empty for no limit.`;

export const SESSION_IDLE_TIMEOUT_PROBLEM: string = `An idle timeout must be a whole number of minutes from ${MIN_SESSION_IDLE_TIMEOUT_IN_MINUTES} to ${MAX_SESSION_IDLE_TIMEOUT_IN_MINUTES} (30 days), or empty for 30 days.`;

export const SEPARATE_SSO_SESSION_LENGTHS_PROBLEM: string =
  "Separate lengths for SSO sign-ins must be true or false.";

// The range a length column takes.
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
 * Why a value written to one of the length columns is refused, or null when
 * it is fine: a whole number of minutes within the column's range, or
 * nothing (null, or not written at all) for the default. A number sent as
 * text ("60") is refused like any other value that is not a number: an
 * unclear value never shortens or lengthens anyone's sign-in.
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
 * Why a value written to useSeparateSsoSessionLengths is refused, or null:
 * a boolean, or nothing (off). On the server a switch reaches this as the
 * boolean the database stores (Types/Database/BooleanColumnValue).
 */
export const getSeparateSsoSessionLengthsProblem: (
  value: unknown,
) => string | null = (value: unknown): string | null => {
  if (value === undefined || value === null || typeof value === "boolean") {
    return null;
  }

  return SEPARATE_SSO_SESSION_LENGTHS_PROBLEM;
};

// Why a value written to any of the setting's columns is refused, or null.
export const getSessionLengthSettingProblem: (
  column: SessionLengthSettingColumn,
  value: unknown,
) => string | null = (
  column: SessionLengthSettingColumn,
  value: unknown,
): string | null => {
  if (column === SEPARATE_SSO_SESSION_LENGTHS_COLUMN) {
    return getSeparateSsoSessionLengthsProblem(value);
  }

  return getSessionLengthProblem(column, value);
};

/*
 * What a length column holds, in minutes, or null for the default. Whatever
 * it holds that could not have been written (see above) reads as the
 * default, so a stray value can never sign anyone out early.
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

// What applies to each kind of sign-in.
export interface SessionLengths {
  // Every sign-in that is not SSO: a password, a passkey, Sign in with Microsoft.
  standard: SessionLengthRule;
  // SSO: a project's SAML or OpenID Connect provider, or the server's.
  sso: SessionLengthRule;
}

export const NO_SESSION_LENGTH_RULE: SessionLengthRule = {
  lengthInMinutes: null,
  idleTimeoutInMinutes: null,
};

export const NO_SESSION_LENGTHS: SessionLengths = {
  standard: NO_SESSION_LENGTH_RULE,
  sso: NO_SESSION_LENGTH_RULE,
};

// The setting as a master admin sets it: what the GlobalConfig columns hold.
export interface SessionLengthSettings {
  sessionLengthInMinutes: number | null;
  sessionIdleTimeoutInMinutes: number | null;
  useSeparateSsoSessionLengths: boolean;
  ssoSessionLengthInMinutes: number | null;
  ssoSessionIdleTimeoutInMinutes: number | null;
}

export const NO_SESSION_LENGTH_SETTINGS: SessionLengthSettings = {
  sessionLengthInMinutes: null,
  sessionIdleTimeoutInMinutes: null,
  useSeparateSsoSessionLengths: false,
  ssoSessionLengthInMinutes: null,
  ssoSessionIdleTimeoutInMinutes: null,
};

/*
 * The setting a GlobalConfig row holds, each column read as above: a length
 * that could not have been written is the default, and the switch is on
 * only when it holds true.
 */
export const readSessionLengthSettings: (
  row: Partial<Record<SessionLengthSettingColumn, unknown>> | null | undefined,
) => SessionLengthSettings = (
  row: Partial<Record<SessionLengthSettingColumn, unknown>> | null | undefined,
): SessionLengthSettings => {
  const read: (column: SessionLengthColumn) => number | null = (
    column: SessionLengthColumn,
  ): number | null => {
    return readSessionLengthValue(column, row ? row[column] : undefined);
  };

  return {
    sessionLengthInMinutes: read(SESSION_LENGTH_COLUMN),
    sessionIdleTimeoutInMinutes: read(SESSION_IDLE_TIMEOUT_COLUMN),
    useSeparateSsoSessionLengths: Boolean(
      row && row[SEPARATE_SSO_SESSION_LENGTHS_COLUMN] === true,
    ),
    ssoSessionLengthInMinutes: read(SSO_SESSION_LENGTH_COLUMN),
    ssoSessionIdleTimeoutInMinutes: read(SSO_SESSION_IDLE_TIMEOUT_COLUMN),
  };
};

/*
 * What a setting applies to each kind of sign-in: its first two to every
 * sign-in, unless SSO sign-ins have their own - then those to SSO sign-ins.
 */
export const toSessionLengths: (
  settings: SessionLengthSettings,
) => SessionLengths = (settings: SessionLengthSettings): SessionLengths => {
  const standard: SessionLengthRule = {
    lengthInMinutes: settings.sessionLengthInMinutes,
    idleTimeoutInMinutes: settings.sessionIdleTimeoutInMinutes,
  };

  return {
    standard: standard,
    sso: settings.useSeparateSsoSessionLengths
      ? {
          lengthInMinutes: settings.ssoSessionLengthInMinutes,
          idleTimeoutInMinutes: settings.ssoSessionIdleTimeoutInMinutes,
        }
      : { ...standard },
  };
};

// The lengths a GlobalConfig row applies (readSessionLengthSettings, then toSessionLengths).
export const readSessionLengths: (
  row: Partial<Record<SessionLengthSettingColumn, unknown>> | null | undefined,
) => SessionLengths = (
  row: Partial<Record<SessionLengthSettingColumn, unknown>> | null | undefined,
): SessionLengths => {
  return toSessionLengths(readSessionLengthSettings(row));
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
  const standard: Record<string, unknown> = asRule(all["standard"]);
  const sso: Record<string, unknown> = asRule(all["sso"]);

  return toSessionLengths(
    readSessionLengthSettings({
      [SESSION_LENGTH_COLUMN]: standard["lengthInMinutes"],
      [SESSION_IDLE_TIMEOUT_COLUMN]: standard["idleTimeoutInMinutes"],
      [SEPARATE_SSO_SESSION_LENGTHS_COLUMN]: true,
      [SSO_SESSION_LENGTH_COLUMN]: sso["lengthInMinutes"],
      [SSO_SESSION_IDLE_TIMEOUT_COLUMN]: sso["idleTimeoutInMinutes"],
    }),
  );
};

// Whether a rule shortens anything: with none, a sign-in lasts as it always has.
export const isSessionLengthRuleSet: (rule: SessionLengthRule) => boolean = (
  rule: SessionLengthRule,
): boolean => {
  return rule.lengthInMinutes !== null || rule.idleTimeoutInMinutes !== null;
};

// Whether any of them is set: with none, every sign-in lasts as it always has.
export const hasSessionLimits: (
  lengths: SessionLengths | null | undefined,
) => boolean = (lengths: SessionLengths | null | undefined): boolean => {
  if (!lengths) {
    return false;
  }

  return [lengths.standard, lengths.sso].some(isSessionLengthRuleSet);
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

  return isSsoSignIn ? all.sso : all.standard;
};

// The idle timeout a rule holds, in minutes: its own, or the 30 days of the default.
export const getIdleTimeoutInMinutes: (rule: SessionLengthRule) => number = (
  rule: SessionLengthRule,
): number => {
  return rule.idleTimeoutInMinutes === null
    ? DEFAULT_SESSION_IDLE_TIMEOUT_IN_MINUTES
    : rule.idleTimeoutInMinutes;
};

/*
 * Whether moving from `before` to `after` shortens how long any kind of
 * sign-in may last - a shorter session length (no limit is the longest) or
 * a shorter idle timeout (the default, 30 days, is the longest) - so that it
 * may end sessions there are now. A change that only lengthens, or keeps,
 * every rule signs nobody out.
 */
export const doesShortenAnySession: (
  before: SessionLengths,
  after: SessionLengths,
) => boolean = (before: SessionLengths, after: SessionLengths): boolean => {
  const lengthOf: (rule: SessionLengthRule) => number = (
    rule: SessionLengthRule,
  ): number => {
    return rule.lengthInMinutes === null
      ? Number.POSITIVE_INFINITY
      : rule.lengthInMinutes;
  };

  return (["standard", "sso"] as const).some(
    (kind: "standard" | "sso"): boolean => {
      return (
        lengthOf(after[kind]) < lengthOf(before[kind]) ||
        getIdleTimeoutInMinutes(after[kind]) <
          getIdleTimeoutInMinutes(before[kind])
      );
    },
  );
};

// Why a session ended, as the server says it: to the browser, which tells its person.
export enum SessionEndReason {
  // As long has passed since its sign-in as the server lets a sign-in last.
  LengthReached = "length-reached",
  // Its person did not use OneUptime for as long as the server allows.
  Inactive = "inactive",
}

export const isSessionEndReason: (
  value: unknown,
) => value is SessionEndReason = (
  value: unknown,
): value is SessionEndReason => {
  return (
    value === SessionEndReason.LengthReached ||
    value === SessionEndReason.Inactive
  );
};

/*
 * Where the Dashboard sends a person whose session the server ended, the
 * sign-in page says why: /accounts/login?sessionEnded=<reason>.
 */
export const SESSION_ENDED_QUERY_PARAM: string = "sessionEnded";

// The reason a sign-in page address names, or null for none it knows.
export const readSessionEndReason: (
  value: unknown,
) => SessionEndReason | null = (value: unknown): SessionEndReason | null => {
  return isSessionEndReason(value) ? value : null;
};

/*
 * The field of a renewal (POST /identity/refresh-token) in which the
 * Dashboard and the Admin Dashboard say how long their person has not
 * clicked, typed or scrolled, in whole seconds.
 */
export const INACTIVE_FOR_IN_SECONDS_FIELD: string = "inactiveForInSeconds";

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
