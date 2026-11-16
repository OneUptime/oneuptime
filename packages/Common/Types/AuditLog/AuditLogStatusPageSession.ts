import AuditLogAction from "./AuditLogAction";
import {
  AUDIT_LOG_SESSION_SIGN_IN_NO_LONGER_ACCEPTED,
  SESSION_END_CAUSE_DESCRIPTIONS,
  SessionEventAuditLogAction,
} from "./AuditLogSessionEvent";
import ObjectID from "../ObjectID";
import { SessionEndCause } from "../UserSession/SessionEndCause";
import { SessionSignIn } from "../UserSession/SessionSignIn";

/*
 * A PRIVATE STATUS PAGE'S READERS' SESSIONS IN THE AUDIT LOG (issue #6790).
 *
 * The readers of a private status page (StatusPagePrivateUser) sign in -
 * with a password, a sign-in link, or the status page's SAML or OpenID
 * Connect provider - and their sessions end (StatusPagePrivateUserSession).
 * A project with a customer-only status page may want to know which reader
 * signed in, when and from where, and the audit log records it as it
 * records its members' sessions (Types/AuditLog/AuditLogSessionEvent):
 *
 *   - Sign In: a reader's session began - signing in with a password or a
 *     link, or exchanging the code the page's SSO provider handed over;
 *   - Sign Out: the reader signed out;
 *   - Session Revoked: OneUptime ended it - a new password, or the page no
 *     longer accepts how it signed in (its provider was turned off or
 *     deleted, the page now requires SSO, or a shorter Sign Readers Out
 *     After ended it).
 *
 * A session that simply runs out - its refresh token's 30 days without
 * use, or Sign Readers Out After - is refused at its next refresh without
 * being ended, so no entry says when; one ended as run out reads as a
 * Session Timeout.
 *
 * WHERE: in the status page's project only - a reader is no member of any
 * other - and on the status page's own Audit Logs page: each entry rolls up
 * to the status page. Recorded whether or not the project stores system
 * events, as a member's sessions are.
 *
 * WHAT AN ENTRY SAYS:
 *
 *   - its resource is the session: a Status Page Private User Session, by
 *     its id, named by the device it signed in from, rolling up to the
 *     Status Page;
 *   - its actor is the reader, by the email they sign in with: a reader is
 *     no OneUptime user, so the entry names no user id, and its actor type
 *     says it is a reader (AUDIT_LOG_STATUS_PAGE_READER_ACTOR_TYPE);
 *   - its fields are a session entry's: how and from where, and why and
 *     when it ended.
 *
 * Nothing the reader typed reaches an entry but their address, and never a
 * password, a link's token, a login code or a refresh token.
 */

// The resource of every reader's session entry: the session (its model's singular name).
export const AUDIT_LOG_STATUS_PAGE_SESSION_RESOURCE_TYPE: string =
  "Status Page Private User Session";

// What every reader's session entry rolls up to: the status page.
export const AUDIT_LOG_STATUS_PAGE_SESSION_ROOT_RESOURCE_TYPE: string =
  "Status Page";

/*
 * The actor type of a reader's entries: a reader is no OneUptime user, and
 * the audit log's Actor column says what they are (the dashboard's actor
 * type words).
 */
export const AUDIT_LOG_STATUS_PAGE_READER_ACTOR_TYPE: string =
  "StatusPagePrivateUser";

/*
 * The words a reader's session is revoked with
 * (StatusPagePrivateUserSession.revokedReason), which its end in the audit
 * log is read from (readStatusPageSessionEnd).
 */
export const STATUS_PAGE_SESSION_SIGNED_OUT_REASON: string = "User logged out";
export const STATUS_PAGE_SESSION_PASSWORD_CHANGED_REASON: string =
  "Password changed";
export const STATUS_PAGE_SESSION_REFRESH_TOKEN_EXPIRED_REASON: string =
  "Refresh token expired";
export const STATUS_PAGE_SESSION_SIGN_IN_NO_LONGER_ACCEPTED_REASON: string =
  "Its sign-in is no longer accepted by the status page";

// How a reader's session ended, as its entry says it.
export interface StatusPageSessionEnd {
  action: SessionEventAuditLogAction;
  // The entry's Reason: OneUptime's words (AUDIT_LOG_SESSION_REASON_WORDS).
  reason: string;
}

/*
 * How a reader's session ended, from the words it was revoked with: a
 * sign-out, a refresh token that ran out (a timeout), a new password or a
 * sign-in the page no longer accepts (revoked); anything else is revoked,
 * as a session that ended.
 */
export const readStatusPageSessionEnd: (
  revokedReason: unknown,
) => StatusPageSessionEnd = (revokedReason: unknown): StatusPageSessionEnd => {
  switch (revokedReason) {
    case STATUS_PAGE_SESSION_SIGNED_OUT_REASON:
      return {
        action: AuditLogAction.SignOut,
        reason: SESSION_END_CAUSE_DESCRIPTIONS[SessionEndCause.SignedOut],
      };
    case STATUS_PAGE_SESSION_REFRESH_TOKEN_EXPIRED_REASON:
      return {
        action: AuditLogAction.SessionTimeout,
        reason: SESSION_END_CAUSE_DESCRIPTIONS[SessionEndCause.Expired],
      };
    case STATUS_PAGE_SESSION_PASSWORD_CHANGED_REASON:
      return {
        action: AuditLogAction.SessionRevoked,
        reason: SESSION_END_CAUSE_DESCRIPTIONS[SessionEndCause.PasswordChanged],
      };
    case STATUS_PAGE_SESSION_SIGN_IN_NO_LONGER_ACCEPTED_REASON:
      return {
        action: AuditLogAction.SessionRevoked,
        reason: AUDIT_LOG_SESSION_SIGN_IN_NO_LONGER_ACCEPTED,
      };
    default:
      return {
        action: AuditLogAction.SessionRevoked,
        reason: SESSION_END_CAUSE_DESCRIPTIONS[SessionEndCause.Other],
      };
  }
};

/*
 * One event of a reader's session, as core hands it to the audit log
 * recorder (AuditLogService.recordStatusPageSessionEvents).
 */
export interface StatusPageSessionAuditEvent {
  action: SessionEventAuditLogAction;
  sessionId: ObjectID;
  // The status page's project: the one project the entry is filed in.
  projectId: ObjectID;
  statusPageId: ObjectID;
  // The reader, by the address they sign in with.
  readerEmail?: string | undefined;
  // How it signed in, or null when the session does not say.
  signIn?: SessionSignIn | null | undefined;
  device?: string | undefined;
  ipAddress?: string | undefined;
  location?: string | undefined;
  signedInAt?: Date | undefined;
  lastActiveAt?: Date | undefined;
  // Why it ended (readStatusPageSessionEnd). Not on a sign-in.
  endReason?: string | undefined;
}
