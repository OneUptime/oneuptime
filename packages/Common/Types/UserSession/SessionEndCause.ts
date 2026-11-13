/*
 * WHY A SESSION ENDED.
 *
 * A session ends when its person signs out; when it times out - the
 * server's session lengths end it (an idle timeout or a session length a
 * master admin set, Types/UserSession/SessionLength.ts), or its refresh
 * token runs out after 30 days without use; or when OneUptime revokes it -
 * a new password, a blocked account, two factor authentication reset or
 * required by a server admin.
 *
 * Each cause is revoked with the words sessions have always been revoked
 * with (UserSession.revokedReason, a ShortText column): a refresh that comes
 * after the end reads them to say why (UserSessionService.
 * getSessionLengthEndReason), and the audit log reads them to say how a
 * session ended (Types/AuditLog/AuditLogSessionEvent, issue #6762). Every
 * revocation names its cause by these words, so neither has to guess.
 */
export enum SessionEndCause {
  SignedOut = "SignedOut",
  IdleTimeout = "IdleTimeout",
  LengthReached = "LengthReached",
  // Its refresh token ran out: nobody used the session for 30 days.
  Expired = "Expired",
  PasswordChanged = "PasswordChanged",
  PasswordReset = "PasswordReset",
  AccountBlocked = "AccountBlocked",
  TwoFactorRequired = "TwoFactorRequired",
  TwoFactorReset = "TwoFactorReset",
  // A revocation that names none of the causes above.
  Other = "Other",
}

export type NamedSessionEndCause = Exclude<
  SessionEndCause,
  SessionEndCause.Other
>;

/*
 * The revokedReason each cause is kept with. Short on purpose: the column
 * holds 100 characters, and a reason too long for it would fail the write
 * that ends the session.
 */
export const SESSION_END_CAUSE_REVOKED_REASONS: Readonly<
  Record<NamedSessionEndCause, string>
> = {
  [SessionEndCause.SignedOut]: "User logout",
  [SessionEndCause.IdleTimeout]: "Idle timeout reached",
  [SessionEndCause.LengthReached]: "Session length reached",
  [SessionEndCause.Expired]: "Refresh token expired",
  [SessionEndCause.PasswordChanged]: "Password changed",
  [SessionEndCause.PasswordReset]: "Password reset",
  [SessionEndCause.AccountBlocked]: "User blocked",
  [SessionEndCause.TwoFactorRequired]: "Two factor auth required by admin",
  [SessionEndCause.TwoFactorReset]: "Two factor auth reset by admin",
};

// The words a session revoked for `cause` is kept with.
export const getSessionEndCauseRevokedReason: (
  cause: NamedSessionEndCause,
) => string = (cause: NamedSessionEndCause): string => {
  return SESSION_END_CAUSE_REVOKED_REASONS[cause];
};

/*
 * The cause a revokedReason names, or Other for one that names none of
 * them: no reason at all, or one written some other way.
 */
export const readSessionEndCause: (
  revokedReason: unknown,
) => SessionEndCause = (revokedReason: unknown): SessionEndCause => {
  if (typeof revokedReason !== "string") {
    return SessionEndCause.Other;
  }

  for (const cause of Object.keys(
    SESSION_END_CAUSE_REVOKED_REASONS,
  ) as Array<NamedSessionEndCause>) {
    if (SESSION_END_CAUSE_REVOKED_REASONS[cause] === revokedReason) {
      return cause;
    }
  }

  return SessionEndCause.Other;
};

// Whether a cause is a timeout: OneUptime's own end of a session nobody ended.
export const isSessionTimeoutCause: (cause: SessionEndCause) => boolean = (
  cause: SessionEndCause,
): boolean => {
  return (
    cause === SessionEndCause.IdleTimeout ||
    cause === SessionEndCause.LengthReached ||
    cause === SessionEndCause.Expired
  );
};
