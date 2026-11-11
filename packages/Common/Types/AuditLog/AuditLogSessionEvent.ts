import AuditLogAction from "./AuditLogAction";
import { JSONObject, JSONValue } from "../JSON";
import ObjectID from "../ObjectID";
import { SessionEndCause } from "../UserSession/SessionEndCause";
import { DEFAULT_SESSION_IDLE_DAYS } from "../UserSession/SessionLength";
import { SessionSignIn } from "../UserSession/SessionSignIn";

/*
 * PEOPLE'S SESSIONS IN THE AUDIT LOG (issue #6762).
 *
 * The audit log records who changed what - and, as compliance reviews ask
 * of it too, who signed in, how and from where, and how each session ended:
 *
 *   - Sign In: a session started, by any way into OneUptime - a password or
 *     a sign-in link with the account's second factor, a passkey, Google,
 *     Microsoft, Vercel, or a SAML or OpenID Connect provider.
 *   - Sign Out: its person signed out.
 *   - Session Timeout: OneUptime ended it on time - the server's idle
 *     timeout or session length, or 30 days without use.
 *   - Session Revoked: OneUptime ended it because something changed - the
 *     password, a blocked account, two factor authentication reset or
 *     required by a server admin.
 *
 * WHERE: in every project the person is a member of (they accepted an
 * invitation to one of its teams) that records audit logs. A sign-in is to
 * OneUptime, and so to each of their projects at once. Recorded whether or
 * not the project stores system events, like everything a person does: a
 * session is theirs, whoever or whatever ended it.
 *
 * WHAT AN ENTRY SAYS:
 *
 *   - its resource is the session itself: a User Session, by the session's
 *     id - so a session's sign-in and its end share an id - named by the
 *     device it signed in from ("Chrome 130 on macOS"), and rolling up to
 *     its person (User, by their id);
 *   - its actor is the person whose session it is, so filtering the audit
 *     log by their email shows every sign-in and session end of theirs;
 *   - its fields (`changes`) say how and from where it signed in, and why
 *     and when it ended (AuditLogSessionField).
 *
 * Nothing a client wrote reaches an entry, and nothing secret: the device is
 * described only in words OneUptime spells out (UserAgentDevice), as the
 * security emails describe it, and an entry never carries a token or the
 * raw User-Agent. A project's own SSO provider is named only in that
 * project's audit log (SessionSignIn.ssoProjectId).
 */

// The resource of every session entry: the session (UserSession's singular name).
export const AUDIT_LOG_SESSION_RESOURCE_TYPE: string = "User Session";

// What every session entry rolls up to: the person whose session it is.
export const AUDIT_LOG_SESSION_ROOT_RESOURCE_TYPE: string = "User";

// What a session entry is named when the device it signed in from is unknown.
export const AUDIT_LOG_SESSION_UNKNOWN_DEVICE: string = "Unknown device";

export type SessionAuditLogAction =
  | AuditLogAction.SignIn
  | AuditLogAction.SignOut
  | AuditLogAction.SessionTimeout
  | AuditLogAction.SessionRevoked;

export const SESSION_AUDIT_LOG_ACTIONS: ReadonlyArray<SessionAuditLogAction> = [
  AuditLogAction.SignIn,
  AuditLogAction.SignOut,
  AuditLogAction.SessionTimeout,
  AuditLogAction.SessionRevoked,
];

export const isSessionAuditLogAction: (
  action: unknown,
) => action is SessionAuditLogAction = (
  action: unknown,
): action is SessionAuditLogAction => {
  return (
    typeof action === "string" &&
    (SESSION_AUDIT_LOG_ACTIONS as ReadonlyArray<string>).includes(action)
  );
};

// The action a session's end is recorded as.
export const getSessionEndAuditLogAction: (
  cause: SessionEndCause,
) => SessionAuditLogAction = (
  cause: SessionEndCause,
): SessionAuditLogAction => {
  switch (cause) {
    case SessionEndCause.SignedOut:
      return AuditLogAction.SignOut;
    case SessionEndCause.IdleTimeout:
    case SessionEndCause.LengthReached:
    case SessionEndCause.Expired:
      return AuditLogAction.SessionTimeout;
    default:
      return AuditLogAction.SessionRevoked;
  }
};

// What an entry says of why a session ended.
export const SESSION_END_CAUSE_DESCRIPTIONS: Readonly<
  Record<SessionEndCause, string>
> = {
  [SessionEndCause.SignedOut]: "Signed out",
  [SessionEndCause.IdleTimeout]: "Idle timeout reached",
  [SessionEndCause.LengthReached]: "Session length reached",
  [SessionEndCause.Expired]: `Not used for ${DEFAULT_SESSION_IDLE_DAYS} days`,
  [SessionEndCause.PasswordChanged]: "Password changed",
  [SessionEndCause.PasswordReset]: "Password reset",
  [SessionEndCause.AccountBlocked]: "Account blocked by a server admin",
  [SessionEndCause.TwoFactorRequired]:
    "Two-factor authentication required by a server admin",
  [SessionEndCause.TwoFactorReset]:
    "Two-factor authentication reset by a server admin",
  [SessionEndCause.Other]: "Session ended",
};

/*
 * The fields of a session entry, as its `changes` carry them: each one a
 * { field, newValue } with a text or an ISO 8601 time, in this order, and
 * only when it is known.
 */
export enum AuditLogSessionField {
  // Why it ended: SESSION_END_CAUSE_DESCRIPTIONS. Not on a sign-in.
  Reason = "reason",
  SignInMethod = "signInMethod",
  // The single sign-on provider's name.
  SsoProvider = "ssoProvider",
  SecondFactor = "secondFactor",
  // The device it signed in from: "Chrome 130 on macOS".
  Device = "device",
  /*
   * The address of the request the entry is about - the sign-in's, the
   * sign-out's - or, for a session OneUptime ended, the last one it was
   * used from.
   */
  IpAddress = "ipAddress",
  // Where it signed in from, when the operator names the CDN headers that say it.
  Location = "location",
  // When it signed in. Not on a sign-in: the entry's own time says it.
  SignedInAt = "signedInAt",
  // When its person last used it, as OneUptime knew.
  LastActiveAt = "lastActiveAt",
  /*
   * When it timed out: the moment its idle timeout, session length or
   * refresh token ran out, which can be before the moment OneUptime
   * noticed and recorded it.
   */
  EndedAt = "endedAt",
}

export const AUDIT_LOG_SESSION_FIELDS: ReadonlyArray<AuditLogSessionField> = [
  AuditLogSessionField.Reason,
  AuditLogSessionField.SignInMethod,
  AuditLogSessionField.SsoProvider,
  AuditLogSessionField.SecondFactor,
  AuditLogSessionField.Device,
  AuditLogSessionField.IpAddress,
  AuditLogSessionField.Location,
  AuditLogSessionField.SignedInAt,
  AuditLogSessionField.LastActiveAt,
  AuditLogSessionField.EndedAt,
];

export const AUDIT_LOG_SESSION_FIELD_LABELS: Readonly<
  Record<AuditLogSessionField, string>
> = {
  [AuditLogSessionField.Reason]: "Reason",
  [AuditLogSessionField.SignInMethod]: "Signed in with",
  [AuditLogSessionField.SsoProvider]: "SSO provider",
  [AuditLogSessionField.SecondFactor]: "Second factor",
  [AuditLogSessionField.Device]: "Device",
  [AuditLogSessionField.IpAddress]: "IP address",
  [AuditLogSessionField.Location]: "Location",
  [AuditLogSessionField.SignedInAt]: "Signed in at",
  [AuditLogSessionField.LastActiveAt]: "Last active at",
  [AuditLogSessionField.EndedAt]: "Timed out at",
};

// The fields whose values are times, which a reader shows in its own zone.
export const AUDIT_LOG_SESSION_TIME_FIELDS: ReadonlyArray<AuditLogSessionField> =
  [
    AuditLogSessionField.SignedInAt,
    AuditLogSessionField.LastActiveAt,
    AuditLogSessionField.EndedAt,
  ];

/*
 * One session event, as core hands it to the audit log recorder
 * (AuditLogService.recordSessionEvents): which session, whose, what
 * happened, and what is known of how and where.
 */
export interface SessionAuditEvent {
  action: SessionAuditLogAction;
  userId: ObjectID;
  sessionId: ObjectID;
  // How it signed in, or null when the session does not say.
  signIn?: SessionSignIn | null | undefined;
  device?: string | undefined;
  ipAddress?: string | undefined;
  location?: string | undefined;
  signedInAt?: Date | undefined;
  lastActiveAt?: Date | undefined;
  // When it ran out, for a timeout.
  endedAt?: Date | undefined;
  // Why it ended. Not on a sign-in.
  endCause?: SessionEndCause | undefined;
}

/*
 * The text fields of a session entry, by field, as its `changes` hold them:
 * a change of a field this file names, with a text value. Anything else an
 * entry holds is left out.
 */
export const readSessionEntryFields: (
  changes: unknown,
) => Map<AuditLogSessionField, string> = (
  changes: unknown,
): Map<AuditLogSessionField, string> => {
  const fields: Map<AuditLogSessionField, string> = new Map();

  if (!Array.isArray(changes)) {
    return fields;
  }

  for (const change of changes) {
    if (!change || typeof change !== "object" || Array.isArray(change)) {
      continue;
    }

    const field: JSONValue | undefined = (change as JSONObject)["field"];
    const value: JSONValue | undefined = (change as JSONObject)["newValue"];

    if (
      typeof field !== "string" ||
      !(AUDIT_LOG_SESSION_FIELDS as ReadonlyArray<string>).includes(field) ||
      typeof value !== "string" ||
      value.trim().length === 0
    ) {
      continue;
    }

    fields.set(field as AuditLogSessionField, value);
  }

  return fields;
};

/*
 * A session entry in a few words, for the audit log's table: how it signed
 * in ("Password + Authenticator app", "SAML single sign-on · Okta"), or why
 * it ended ("Idle timeout reached").
 */
export const getSessionEntrySummary: (data: {
  action: string | undefined;
  changes: unknown;
}) => string = (data: {
  action: string | undefined;
  changes: unknown;
}): string => {
  const fields: Map<AuditLogSessionField, string> = readSessionEntryFields(
    data.changes,
  );

  if (data.action === AuditLogAction.SignIn) {
    const method: string | undefined = fields.get(
      AuditLogSessionField.SignInMethod,
    );

    if (!method) {
      return "Signed in";
    }

    const secondFactor: string | undefined = fields.get(
      AuditLogSessionField.SecondFactor,
    );
    const provider: string | undefined = fields.get(
      AuditLogSessionField.SsoProvider,
    );

    let summary: string = method;

    if (secondFactor) {
      summary = `${summary} + ${secondFactor}`;
    }

    if (provider) {
      summary = `${summary} · ${provider}`;
    }

    return summary;
  }

  return (
    fields.get(AuditLogSessionField.Reason) ||
    SESSION_END_CAUSE_DESCRIPTIONS[SessionEndCause.Other]
  );
};
