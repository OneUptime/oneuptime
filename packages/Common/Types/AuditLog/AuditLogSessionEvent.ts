import AuditLogAction from "./AuditLogAction";
import { SIGN_IN_FAILURE_REASON_DESCRIPTIONS } from "./AuditLogSignInFailure";
import { JSONObject, JSONValue } from "../JSON";
import ObjectID from "../ObjectID";
import { SessionEndCause } from "../UserSession/SessionEndCause";
import { DEFAULT_SESSION_IDLE_DAYS } from "../UserSession/SessionLength";
import { SessionSignIn } from "../UserSession/SessionSignIn";
import {
  getInlineSeparator,
  PluralTemplate,
  translationKey,
  Translator,
} from "../Translator";

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
 *   - Sign-In Failed: an attempt to sign in to an account that failed
 *     (issue #6788): no session began, and the entry is about the attempt
 *     (Types/AuditLog/AuditLogSignInFailure).
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
 *
 * A private status page's readers sign in and out too, and their entries
 * have the same shape, in that status page's project alone (issue #6790,
 * Types/AuditLog/AuditLogStatusPageSession).
 */

// The resource of every session entry: the session (UserSession's singular name).
export const AUDIT_LOG_SESSION_RESOURCE_TYPE: string = "User Session";

// What every session entry rolls up to: the person whose session it is.
export const AUDIT_LOG_SESSION_ROOT_RESOURCE_TYPE: string = "User";

// What a session entry is named when the device it signed in from is unknown.
export const AUDIT_LOG_SESSION_UNKNOWN_DEVICE: string = "Unknown device";

/*
 * The actions of the audit log's "Sign-ins and sessions": a session's
 * sign-in and end, and a sign-in that failed. The table and the dialog
 * draw each of them as a sign-in or session entry: in a few words, with
 * its details.
 */
export type SessionAuditLogAction =
  | AuditLogAction.SignIn
  | AuditLogAction.SignInFailed
  | AuditLogAction.SignOut
  | AuditLogAction.SessionTimeout
  | AuditLogAction.SessionRevoked;

export const SESSION_AUDIT_LOG_ACTIONS: ReadonlyArray<SessionAuditLogAction> = [
  AuditLogAction.SignIn,
  AuditLogAction.SignInFailed,
  AuditLogAction.SignOut,
  AuditLogAction.SessionTimeout,
  AuditLogAction.SessionRevoked,
];

// What happened to a session: it signed in, or it ended. A failed sign-in made none.
export type SessionEventAuditLogAction = Exclude<
  SessionAuditLogAction,
  AuditLogAction.SignInFailed
>;

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
) => SessionEventAuditLogAction = (
  cause: SessionEndCause,
): SessionEventAuditLogAction => {
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

/*
 * What an entry says of why a session ended: the words the server stores in
 * the entry, in English, and keys of the Dashboard's locales, which the
 * table and the dialog draw in the reader's language (#8459,
 * getSessionEntryValueInLanguage). Thirty days without use is stored with
 * its number, and read through AUDIT_LOG_SESSION_NOT_USED_FOR.
 */
export const SESSION_END_CAUSE_DESCRIPTIONS: Readonly<
  Record<SessionEndCause, string>
> = {
  [SessionEndCause.SignedOut]: translationKey("Signed out"),
  [SessionEndCause.IdleTimeout]: translationKey("Idle timeout reached"),
  [SessionEndCause.LengthReached]: translationKey("Session length reached"),
  [SessionEndCause.Expired]: `Not used for ${DEFAULT_SESSION_IDLE_DAYS} days`,
  [SessionEndCause.PasswordChanged]: translationKey("Password changed"),
  [SessionEndCause.PasswordReset]: translationKey("Password reset"),
  [SessionEndCause.AccountBlocked]: translationKey(
    "Account blocked by a server admin",
  ),
  [SessionEndCause.TwoFactorRequired]: translationKey(
    "Two-factor authentication required by a server admin",
  ),
  [SessionEndCause.TwoFactorReset]: translationKey(
    "Two-factor authentication reset by a server admin",
  ),
  [SessionEndCause.SignedInWithoutSso]: translationKey(
    "Signed out by a server admin because single sign-on is required",
  ),
  [SessionEndCause.SignInSettingsCleared]: translationKey(
    "Signed out by a server admin who cleared their sign-in settings",
  ),
  [SessionEndCause.Other]: translationKey("Session ended"),
};

/*
 * Why a private status page's reader's session ended when no cause above
 * says it: the status page no longer accepts how it signed in - its SAML or
 * OpenID Connect provider was turned off or deleted, the page now requires
 * single sign-on, or Sign Readers Out After ended it (issue #6790).
 */
export const AUDIT_LOG_SESSION_SIGN_IN_NO_LONGER_ACCEPTED: string =
  translationKey("Sign-in no longer accepted by the status page");

/*
 * Thirty days without use, as the reader's language counts days: what the
 * Expired cause's stored words, with the number in them, are drawn as.
 */
export const AUDIT_LOG_SESSION_NOT_USED_FOR: PluralTemplate = {
  one: translationKey("Not used for {{count}} day"),
  other: translationKey("Not used for {{count}} days"),
};

/*
 * OneUptime's own words a session entry stores for how its person signed in
 * (SignInMethod) and with which second factor (SecondFactor), as keys of
 * the Dashboard's locales (#8459). Google, Microsoft and Vercel are names,
 * drawn as written.
 */
export const AUDIT_LOG_SESSION_SIGN_IN_WORDS: ReadonlyArray<string> = [
  translationKey("Password"),
  translationKey("Sign-in link"),
  translationKey("Passkey"),
  translationKey("SAML single sign-on"),
  translationKey("OpenID Connect single sign-on"),
  translationKey("Authenticator app"),
  translationKey("Security key"),
  translationKey("Backup code"),
];

// What a sign-in's summary says when it stored no way of signing in.
export const AUDIT_LOG_SESSION_SIGNED_IN: string = translationKey("Signed in");

/*
 * How many failed attempts an entry stands for, after why the last one
 * failed, in the table's summary of it: "Wrong password · 37 attempts".
 */
export const AUDIT_LOG_FAILED_SIGN_IN_ATTEMPTS: PluralTemplate = {
  one: translationKey("{{count}} attempt"),
  other: translationKey("{{count}} attempts"),
};

// What a failed sign-in's summary says when it stored no reason.
export const AUDIT_LOG_SIGN_IN_FAILED: string =
  translationKey("Sign-in failed");

/*
 * The fields of a session entry, as its `changes` carry them: each one a
 * { field, newValue } with a text or an ISO 8601 time, in this order, and
 * only when it is known.
 */
export enum AuditLogSessionField {
  /*
   * Why it ended (SESSION_END_CAUSE_DESCRIPTIONS), or why a sign-in failed
   * (SIGN_IN_FAILURE_REASON_DESCRIPTIONS). Not on a sign-in.
   */
  Reason = "reason",
  /*
   * How many failed attempts a Sign-In Failed entry stands for, when it is
   * more than its own: a whole number, as text.
   */
  FailedAttempts = "failedAttempts",
  SignInMethod = "signInMethod",
  // The single sign-on provider's name.
  SsoProvider = "ssoProvider",
  SecondFactor = "secondFactor",
  // The device it signed in from: "Chrome 130 on macOS".
  Device = "device",
  /*
   * The address of the request the entry is about - the sign-in's, the
   * sign-out's - or, for a session OneUptime ended, the last one that
   * session was used from.
   */
  IpAddress = "ipAddress",
  // Where it signed in from, when the operator names the CDN headers that say it.
  Location = "location",
  /*
   * When the first of the failed attempts a Sign-In Failed entry stands for
   * was made: the entry's own time is the last one's.
   */
  FirstFailedAt = "firstFailedAt",
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
  AuditLogSessionField.FailedAttempts,
  AuditLogSessionField.SignInMethod,
  AuditLogSessionField.SsoProvider,
  AuditLogSessionField.SecondFactor,
  AuditLogSessionField.Device,
  AuditLogSessionField.IpAddress,
  AuditLogSessionField.Location,
  AuditLogSessionField.FirstFailedAt,
  AuditLogSessionField.SignedInAt,
  AuditLogSessionField.LastActiveAt,
  AuditLogSessionField.EndedAt,
];

/*
 * What the changes dialog calls each field of a session entry: keys of the
 * Dashboard's locales (this file is one of the extractor's "keys" roots),
 * which the dialog looks up in the reader's language (#8291).
 */
export const AUDIT_LOG_SESSION_FIELD_LABELS: Readonly<
  Record<AuditLogSessionField, string>
> = {
  [AuditLogSessionField.Reason]: translationKey("Reason"),
  [AuditLogSessionField.FailedAttempts]: translationKey("Failed attempts"),
  [AuditLogSessionField.SignInMethod]: translationKey("Signed in with"),
  [AuditLogSessionField.SsoProvider]: translationKey("SSO provider"),
  [AuditLogSessionField.SecondFactor]: translationKey("Second factor"),
  [AuditLogSessionField.Device]: translationKey("Device"),
  [AuditLogSessionField.IpAddress]: translationKey("IP address"),
  [AuditLogSessionField.Location]: translationKey("Location"),
  [AuditLogSessionField.FirstFailedAt]: translationKey("First attempt at"),
  [AuditLogSessionField.SignedInAt]: translationKey("Signed in at"),
  [AuditLogSessionField.LastActiveAt]: translationKey("Last active at"),
  [AuditLogSessionField.EndedAt]: translationKey("Timed out at"),
};

/*
 * What the dialog calls a field of a failed sign-in where a session's word
 * would not do: nobody signed in.
 */
export const AUDIT_LOG_FAILED_SIGN_IN_FIELD_LABELS: Readonly<
  Partial<Record<AuditLogSessionField, string>>
> = {
  [AuditLogSessionField.SignInMethod]: translationKey("Tried to sign in with"),
};

// What the dialog calls a field of an entry with this action, as a key of the locales.
export const getSessionFieldLabel: (data: {
  field: AuditLogSessionField;
  action: string | undefined;
}) => string = (data: {
  field: AuditLogSessionField;
  action: string | undefined;
}): string => {
  if (data.action === AuditLogAction.SignInFailed) {
    const label: string | undefined =
      AUDIT_LOG_FAILED_SIGN_IN_FIELD_LABELS[data.field];

    if (label) {
      return label;
    }
  }

  return AUDIT_LOG_SESSION_FIELD_LABELS[data.field];
};

// The fields whose values are times, which a reader shows in its own zone.
export const AUDIT_LOG_SESSION_TIME_FIELDS: ReadonlyArray<AuditLogSessionField> =
  [
    AuditLogSessionField.FirstFailedAt,
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
  action: SessionEventAuditLogAction;
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
/*
 * Every reason an entry stores in OneUptime's own words: why a session
 * ended - a member's, or a status page reader's - and why a sign-in failed.
 */
export const AUDIT_LOG_SESSION_REASON_WORDS: ReadonlyArray<string> = [
  ...(Object.values(SESSION_END_CAUSE_DESCRIPTIONS) as Array<string>),
  AUDIT_LOG_SESSION_SIGN_IN_NO_LONGER_ACCEPTED,
  ...(Object.values(SIGN_IN_FAILURE_REASON_DESCRIPTIONS) as Array<string>),
];

/*
 * A value a session entry stored, as the reader reads it (#8459): one of
 * OneUptime's own words - why it ended or failed, how they signed in, the
 * second factor - in the reader's language, thirty days without use in its
 * plural forms and digits, a count of failed attempts in the reader's
 * digits; anything else - a device, an address, a place, a provider's name
 * - as recorded. Without a translator, as stored: English, as the server
 * and the export write it.
 */
export const getSessionEntryValueInLanguage: (data: {
  field: AuditLogSessionField;
  value: string;
  translator?: Translator | undefined;
}) => string = (data: {
  field: AuditLogSessionField;
  value: string;
  translator?: Translator | undefined;
}): string => {
  const translator: Translator | undefined = data.translator;

  if (!translator) {
    return data.value;
  }

  // A count of failed attempts, in the reader's digits.
  if (data.field === AuditLogSessionField.FailedAttempts) {
    const count: number = Number(data.value);

    return Number.isSafeInteger(count) && count > 0
      ? translator.formatNumber(count)
      : data.value;
  }

  const isOwnWord: boolean =
    data.field === AuditLogSessionField.Reason
      ? AUDIT_LOG_SESSION_REASON_WORDS.includes(data.value)
      : (data.field === AuditLogSessionField.SignInMethod ||
          data.field === AuditLogSessionField.SecondFactor) &&
        AUDIT_LOG_SESSION_SIGN_IN_WORDS.includes(data.value);

  if (!isOwnWord) {
    return data.value;
  }

  if (data.value === SESSION_END_CAUSE_DESCRIPTIONS[SessionEndCause.Expired]) {
    return translator.translatePlural(
      AUDIT_LOG_SESSION_NOT_USED_FOR,
      DEFAULT_SESSION_IDLE_DAYS,
    );
  }

  return translator.translateText(data.value) || data.value;
};

/*
 * A session entry in a few words: how they signed in (and with which second
 * factor and provider), why the session ended, or why a sign-in failed and
 * - when the entry stands for more than its own attempt - how many attempts
 * ("Wrong password · 37 attempts"). In the reader's language when handed
 * their translator (#8459), each fact set apart as the language sets facts
 * apart (getInlineSeparator); without one, English, as stored.
 */
export const getSessionEntrySummary: (data: {
  action: string | undefined;
  changes: unknown;
  translator?: Translator | undefined;
}) => string = (data: {
  action: string | undefined;
  changes: unknown;
  translator?: Translator | undefined;
}): string => {
  const fields: Map<AuditLogSessionField, string> = readSessionEntryFields(
    data.changes,
  );

  const read: (field: AuditLogSessionField) => string | undefined = (
    field: AuditLogSessionField,
  ): string | undefined => {
    const value: string | undefined = fields.get(field);

    return value
      ? getSessionEntryValueInLanguage({
          field,
          value,
          translator: data.translator,
        })
      : undefined;
  };

  if (data.action === AuditLogAction.SignIn) {
    const method: string | undefined = read(AuditLogSessionField.SignInMethod);

    if (!method) {
      return (
        data.translator?.translateText(AUDIT_LOG_SESSION_SIGNED_IN) ||
        AUDIT_LOG_SESSION_SIGNED_IN
      );
    }

    const secondFactor: string | undefined = read(
      AuditLogSessionField.SecondFactor,
    );
    const provider: string | undefined = read(AuditLogSessionField.SsoProvider);

    let summary: string = method;

    if (secondFactor) {
      summary = `${summary} + ${secondFactor}`;
    }

    if (provider) {
      summary = `${summary}${getInlineSeparator(data.translator?.language)}${provider}`;
    }

    return summary;
  }

  if (data.action === AuditLogAction.SignInFailed) {
    const reason: string =
      read(AuditLogSessionField.Reason) ||
      data.translator?.translateText(AUDIT_LOG_SIGN_IN_FAILED) ||
      AUDIT_LOG_SIGN_IN_FAILED;
    const attempts: number = Number(
      fields.get(AuditLogSessionField.FailedAttempts),
    );

    if (!Number.isSafeInteger(attempts) || attempts < 2) {
      return reason;
    }

    const count: string = data.translator
      ? data.translator.translatePlural(
          AUDIT_LOG_FAILED_SIGN_IN_ATTEMPTS,
          attempts,
        )
      : `${attempts} attempts`;

    return `${reason}${getInlineSeparator(data.translator?.language)}${count}`;
  }

  return (
    read(AuditLogSessionField.Reason) ||
    getSessionEntryValueInLanguage({
      field: AuditLogSessionField.Reason,
      value: SESSION_END_CAUSE_DESCRIPTIONS[SessionEndCause.Other],
      translator: data.translator,
    })
  );
};
