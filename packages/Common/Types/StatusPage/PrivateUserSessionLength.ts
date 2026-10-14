/*
 * HOW LONG A READER STAYS SIGNED IN TO A PRIVATE STATUS PAGE.
 *
 * A reader signed in to a private status page - a private user, with a
 * password or through the page's SAML or OIDC provider - holds a session.
 * Its access token lasts 15 minutes and every request reads the session
 * again; its refresh token lasts 30 days and every refresh starts the 30
 * days again, so a reader who opens the page once a month stays signed in
 * for good. Nothing else ends it: not the identity provider, which is asked
 * only at sign-in.
 *
 * "Sign readers out after" (StatusPage.privateUserSessionLengthInHours)
 * puts a ceiling on that: a session ends once that many hours have passed
 * since its sign-in, however active the reader is, and the reader signs in
 * again - with SSO, through the identity provider, which decides afresh. It
 * is counted from the session's sign-in (its createdAt), by the database's
 * clock, the clock the session's own times are kept by:
 *
 *   - every read of the page asks it (StatusPageService.hasReadAccess,
 *     through StatusPagePrivateUserSessionService.addSignInRule), so a
 *     session past it is refused at its next request;
 *   - a refresh and a login code ask it too (doesSignInStillCount), so it
 *     is never renewed past it;
 *   - and a session is issued or renewed with its refresh token expiring by
 *     then at the latest (capRefreshTokenExpiry), so the browser drops it on
 *     time.
 *
 * Changing it applies to the sessions there are: shortening it signs out,
 * at their next request, everyone signed in for longer than the new length.
 * Empty (null), the default, is no ceiling.
 */

// The status page column that holds it.
export type PrivateUserSessionLengthColumn = "privateUserSessionLengthInHours";

export const PRIVATE_USER_SESSION_LENGTH_COLUMN: PrivateUserSessionLengthColumn =
  "privateUserSessionLengthInHours";

// The longest it may be: a year.
export const MAX_PRIVATE_USER_SESSION_LENGTH_IN_HOURS: number = 24 * 365;

/*
 * How long a session stays signed in without the ceiling, while it is used
 * at least that often: its refresh token's lifetime, renewed at every
 * refresh (StatusPagePrivateUserSessionService).
 */
export const PRIVATE_USER_SESSION_IDLE_DAYS: number = 30;

// The lengths the dashboard offers, in hours, shortest first.
export const PRIVATE_USER_SESSION_LENGTH_CHOICES_IN_HOURS: ReadonlyArray<number> =
  [1, 4, 8, 12, 24, 72, 168, 336, 720];

export const PRIVATE_USER_SESSION_LENGTH_PROBLEM: string = `Sign readers out after must be a whole number of hours from 1 to ${MAX_PRIVATE_USER_SESSION_LENGTH_IN_HOURS}, or left empty for no limit.`;

/*
 * Why a value written to the column is refused, or null when it is fine:
 * a whole number of hours within the range, or nothing (null, or not
 * written at all) for no limit. A number sent as text ("12") is refused like
 * any other value that is not a number: an unclear value never shortens or
 * lengthens anyone's session.
 */
export const getPrivateUserSessionLengthProblem: (
  value: unknown,
) => string | null = (value: unknown): string | null => {
  if (value === undefined || value === null) {
    return null;
  }

  if (
    typeof value !== "number" ||
    !Number.isInteger(value) ||
    value < 1 ||
    value > MAX_PRIVATE_USER_SESSION_LENGTH_IN_HOURS
  ) {
    return PRIVATE_USER_SESSION_LENGTH_PROBLEM;
  }

  return null;
};

/*
 * The ceiling a page holds, in hours, or null for none. Whatever the column
 * holds that could not have been written (see above) reads as none, so a
 * stray value can never lock a reader out.
 */
export const readPrivateUserSessionLength: (value: unknown) => number | null = (
  value: unknown,
): number | null => {
  if (value === undefined || value === null) {
    return null;
  }

  return getPrivateUserSessionLengthProblem(value) === null
    ? (value as number)
    : null;
};

// When a session that began at `startedAt` ends, or null with no ceiling.
export const getPrivateUserSessionEndsAt: (data: {
  startedAt: Date;
  lengthInHours: unknown;
}) => Date | null = (data: {
  startedAt: Date;
  lengthInHours: unknown;
}): Date | null => {
  const lengthInHours: number | null = readPrivateUserSessionLength(
    data.lengthInHours,
  );

  if (lengthInHours === null) {
    return null;
  }

  return new Date(data.startedAt.getTime() + lengthInHours * 60 * 60 * 1000);
};

/*
 * The refresh token's expiry for a session being issued or renewed: the one
 * it would have (`expiresAt`, 30 days from now), or the end of the session
 * if that comes first. A session whose start is unknown keeps the expiry it
 * would have; the reads above still end it on time.
 */
export const capRefreshTokenExpiry: (data: {
  expiresAt: Date;
  startedAt: Date | null | undefined;
  lengthInHours: unknown;
}) => Date = (data: {
  expiresAt: Date;
  startedAt: Date | null | undefined;
  lengthInHours: unknown;
}): Date => {
  if (!data.startedAt) {
    return data.expiresAt;
  }

  const endsAt: Date | null = getPrivateUserSessionEndsAt({
    startedAt: data.startedAt,
    lengthInHours: data.lengthInHours,
  });

  if (!endsAt || endsAt.getTime() >= data.expiresAt.getTime()) {
    return data.expiresAt;
  }

  return endsAt;
};
