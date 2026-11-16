import AuditLogAction from "Common/Types/AuditLog/AuditLogAction";
import {
  AUDIT_LOG_SESSION_UNKNOWN_DEVICE,
  AuditLogSessionField,
  SESSION_END_CAUSE_DESCRIPTIONS,
  SessionAuditEvent,
} from "Common/Types/AuditLog/AuditLogSessionEvent";
import {
  SIGN_IN_FAILURE_REASON_DESCRIPTIONS,
  SignInFailureAuditEvent,
} from "Common/Types/AuditLog/AuditLogSignInFailure";
import { StatusPageSessionAuditEvent } from "Common/Types/AuditLog/AuditLogStatusPageSession";
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
 *
 * A failed sign-in (issue #6788) and a status page reader's session (issue
 * #6790) are entries of the same shape, with the fields below.
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
  ) => void = addTo(changes);

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
  return getDeviceName(event.device);
};

// A device as an entry is named by it, or the words for one that is not known.
export const getDeviceName: (device: string | undefined) => string = (
  device: string | undefined,
): string => {
  return readSessionSignInText(device) || AUDIT_LOG_SESSION_UNKNOWN_DEVICE;
};

/*
 * The fields of `projectId`'s entry about a failed sign-in (issue #6788),
 * in the order the session fields are named: why it failed and how many
 * attempts the entry stands for, how it tried to sign in - a project's
 * own SSO provider named in that project's entry only, as for a sign-in -
 * the device, the address and the place, and when the first of its
 * attempts was made. Never anything the person typed.
 */
export const getSignInFailureEntryChanges: (data: {
  event: SignInFailureAuditEvent;
  projectId: ObjectID;
}) => JSONArray = (data: {
  event: SignInFailureAuditEvent;
  projectId: ObjectID;
}): JSONArray => {
  const changes: JSONArray = [];
  const event: SignInFailureAuditEvent = data.event;
  const add: (
    field: AuditLogSessionField,
    value: string | Date | null | undefined,
  ) => void = addTo(changes);
  const failedAttempts: number = readFailedAttempts(event.failedAttempts);

  add(
    AuditLogSessionField.Reason,
    SIGN_IN_FAILURE_REASON_DESCRIPTIONS[event.reason],
  );

  if (failedAttempts > 1) {
    add(AuditLogSessionField.FailedAttempts, String(failedAttempts));
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
  }

  add(AuditLogSessionField.Device, event.device);
  add(AuditLogSessionField.IpAddress, event.ipAddress);
  add(AuditLogSessionField.Location, event.location);

  if (failedAttempts > 1) {
    add(AuditLogSessionField.FirstFailedAt, event.firstFailedAt);
  }

  return changes;
};

// How many attempts an event stands for: a whole number, at least its own.
export const readFailedAttempts: (value: unknown) => number = (
  value: unknown,
): number => {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 1
    ? value
    : 1;
};

/*
 * The fields of a status page reader's session entry (issue #6790): why it
 * ended (not on a sign-in), how it signed in - the status page's provider
 * named, as the one project the entry is in is its own - the device, the
 * address and the place, and on an end when it signed in and when it was
 * last used.
 */
export const getStatusPageSessionEntryChanges: (
  event: StatusPageSessionAuditEvent,
) => JSONArray = (event: StatusPageSessionAuditEvent): JSONArray => {
  const changes: JSONArray = [];
  const isSignIn: boolean = event.action === AuditLogAction.SignIn;
  const add: (
    field: AuditLogSessionField,
    value: string | Date | null | undefined,
  ) => void = addTo(changes);

  if (!isSignIn) {
    add(AuditLogSessionField.Reason, event.endReason);
  }

  if (event.signIn) {
    add(AuditLogSessionField.SignInMethod, event.signIn.method);

    if (isSingleSignOnMethod(event.signIn.method)) {
      add(AuditLogSessionField.SsoProvider, event.signIn.ssoProviderName);
    }
  }

  add(AuditLogSessionField.Device, event.device);
  add(AuditLogSessionField.IpAddress, event.ipAddress);
  add(AuditLogSessionField.Location, event.location);

  if (!isSignIn) {
    add(AuditLogSessionField.SignedInAt, event.signedInAt);
    add(AuditLogSessionField.LastActiveAt, event.lastActiveAt);
  }

  return changes;
};

// Adds a field to `changes` when it has something to say.
const addTo: (
  changes: JSONArray,
) => (
  field: AuditLogSessionField,
  value: string | Date | null | undefined,
) => void = (
  changes: JSONArray,
): ((
  field: AuditLogSessionField,
  value: string | Date | null | undefined,
) => void) => {
  return (
    field: AuditLogSessionField,
    value: string | Date | null | undefined,
  ): void => {
    const newValue: string | null = toFieldValue(value);

    if (newValue !== null) {
      changes.push({ field: field, newValue: newValue });
    }
  };
};
