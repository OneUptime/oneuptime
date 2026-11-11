import AuditLogAction from "Common/Types/AuditLog/AuditLogAction";
import {
  AUDIT_LOG_SESSION_UNKNOWN_DEVICE,
  AuditLogSessionField,
  SESSION_END_CAUSE_DESCRIPTIONS,
  SessionAuditEvent,
} from "Common/Types/AuditLog/AuditLogSessionEvent";
import { JSONArray } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import {
  isSingleSignOnMethod,
  readSessionSignInText,
} from "Common/Types/UserSession/SessionSignIn";

/*
 * WHAT ONE PROJECT'S ENTRY ABOUT A SESSION SAYS (issue #6762).
 *
 * The recorder files a session event in every project its person is a
 * member of (AuditLogRecorder.recordSessionEvents); these decide what each
 * of those entries says, in the order Common/Types/AuditLog/
 * AuditLogSessionEvent names the fields:
 *
 *   - why it ended (not on a sign-in), how it signed in and the second
 *     factor it proved, the device, the address and the place;
 *   - on an end, when it signed in, when it was last used and - for a
 *     timeout - when it ran out;
 *   - a project's own SSO provider only in that project's entry: another
 *     project's admins learn that the person signed in with single sign-on,
 *     never which other project they belong to or what its provider is
 *     called. The server's own providers are named everywhere.
 *
 * Each value is text - a time is ISO 8601 - so the dialog, the API and an
 * export read it alike, and a field with nothing to say is left out.
 */

/*
 * One field's value as an entry carries it, or null when there is nothing
 * to carry: a time as ISO 8601, a text on one line and short.
 */
const toFieldValue: (
  value: string | Date | null | undefined,
) => string | null = (
  value: string | Date | null | undefined,
): string | null => {
  if (value === null || value === undefined) {
    return null;
  }

  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value.toISOString();
  }

  return readSessionSignInText(value) || null;
};

// The fields of `projectId`'s entry about a session event, in their order.
export const getSessionEntryChanges: (data: {
  event: SessionAuditEvent;
  projectId: ObjectID;
}) => JSONArray = (data: {
  event: SessionAuditEvent;
  projectId: ObjectID;
}): JSONArray => {
  const changes: JSONArray = [];
  const event: SessionAuditEvent = data.event;
  const isSignIn: boolean = event.action === AuditLogAction.SignIn;

  const add: (
    field: AuditLogSessionField,
    value: string | Date | null | undefined,
  ) => void = (
    field: AuditLogSessionField,
    value: string | Date | null | undefined,
  ): void => {
    const newValue: string | null = toFieldValue(value);

    if (newValue !== null) {
      changes.push({ field: field, newValue: newValue });
    }
  };

  if (!isSignIn && event.endCause) {
    add(
      AuditLogSessionField.Reason,
      SESSION_END_CAUSE_DESCRIPTIONS[event.endCause],
    );
  }

  if (event.signIn) {
    add(AuditLogSessionField.SignInMethod, event.signIn.method);

    if (
      isSingleSignOnMethod(event.signIn.method) &&
      isProviderNamedIn({
        ssoProjectId: event.signIn.ssoProjectId,
        projectId: data.projectId,
      })
    ) {
      add(AuditLogSessionField.SsoProvider, event.signIn.ssoProviderName);
    }

    add(AuditLogSessionField.SecondFactor, event.signIn.secondFactor);
  }

  add(AuditLogSessionField.Device, event.device);
  add(AuditLogSessionField.IpAddress, event.ipAddress);
  add(AuditLogSessionField.Location, event.location);

  if (!isSignIn) {
    add(AuditLogSessionField.SignedInAt, event.signedInAt);
    add(AuditLogSessionField.LastActiveAt, event.lastActiveAt);
    add(AuditLogSessionField.EndedAt, event.endedAt);
  }

  return changes;
};

/*
 * Whether `projectId`'s entry names the provider: one of the server's own
 * (no project), or the project's own.
 */
export const isProviderNamedIn: (data: {
  ssoProjectId: ObjectID | undefined;
  projectId: ObjectID;
}) => boolean = (data: {
  ssoProjectId: ObjectID | undefined;
  projectId: ObjectID;
}): boolean => {
  if (!data.ssoProjectId) {
    return true;
  }

  return (
    data.ssoProjectId.toString().toLowerCase() ===
    data.projectId.toString().toLowerCase()
  );
};

// What a session entry is named: the device it signed in from.
export const getSessionEntryResourceName: (
  event: SessionAuditEvent,
) => string = (event: SessionAuditEvent): string => {
  return (
    readSessionSignInText(event.device) || AUDIT_LOG_SESSION_UNKNOWN_DEVICE
  );
};
