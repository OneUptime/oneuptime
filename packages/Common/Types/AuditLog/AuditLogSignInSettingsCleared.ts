import { AUDIT_LOG_REDACTED_VALUE } from "./AuditLogRedaction";
import { AUDIT_LOG_SESSION_ROOT_RESOURCE_TYPE } from "./AuditLogSessionEvent";
import { JSONArray, JSONObject } from "../JSON";
import ObjectID from "../ObjectID";
import { LocalSignInSettings } from "../SSO/LocalSignInClearing";

/*
 * SOMEONE'S SIGN-IN SETTINGS CLEARED, IN THE AUDIT LOG (issue #9762,
 * Types/SSO/LocalSignInClearing): by a master admin, or by an owner of every
 * project the person is in (#9820, Server/Utils/ProjectSignInClearing).
 *
 * Clearing a person's password, passkeys, security keys, authenticator apps,
 * backup codes and two-factor authentication cannot be undone, so it is
 * recorded where the projects that person works in can see it:
 *
 * WHERE: in every project the person is a member of (an accepted
 * invitation) that records audit logs, as their sessions are, whether or
 * not the project stores system events: a person did it, by hand.
 *
 * WHAT AN ENTRY SAYS:
 *
 *   - its resource is the person: a User, by their id, named by their name
 *     (or their email when they have none), rolling up to themselves;
 *   - its action is an Update of that User, by whoever cleared it - a
 *     master admin, or an owner of every project the person is in - so
 *     filtering the audit log by their email finds every clear they made;
 *   - its fields are what was removed, before and after
 *     (getSignInSettingsClearedChanges): the password as changed, never its
 *     value; two-factor authentication from on to off; and how many
 *     authenticator apps, passkeys and security keys, and backup codes
 *     there were, to none. A field with nothing to remove is left out.
 *
 * Nothing secret reaches an entry: no hash, secret, key or code.
 */

// The resource of every entry: the person whose settings were cleared.
export const AUDIT_LOG_SIGN_IN_SETTINGS_CLEARED_RESOURCE_TYPE: string =
  AUDIT_LOG_SESSION_ROOT_RESOURCE_TYPE;

// The fields of an entry, as its changes name them.
export enum SignInSettingsClearedField {
  Password = "password",
  TwoFactorAuth = "enableTwoFactorAuth",
  AuthenticatorApps = "authenticatorApps",
  PasskeysAndSecurityKeys = "passkeysAndSecurityKeys",
  BackupCodes = "backupCodes",
}

/*
 * One person's settings cleared, as core hands it to the audit log recorder
 * (AuditLogService.recordSignInSettingsCleared).
 */
export interface SignInSettingsClearedAuditEvent {
  // Whose settings were cleared.
  userId: ObjectID;
  // Who cleared them: a master admin, or an owner of all their projects.
  clearedByUserId: ObjectID;
  // What they had, all of which is gone.
  cleared: LocalSignInSettings;
}

// The fields of an entry about one clear, in the order they are listed.
export const getSignInSettingsClearedChanges: (
  cleared: LocalSignInSettings,
) => JSONArray = (cleared: LocalSignInSettings): JSONArray => {
  const changes: Array<JSONObject> = [];

  if (cleared.hasPassword) {
    changes.push({
      field: SignInSettingsClearedField.Password,
      oldValue: AUDIT_LOG_REDACTED_VALUE,
      newValue: null,
    });
  }

  if (cleared.isTwoFactorAuthEnabled) {
    changes.push({
      field: SignInSettingsClearedField.TwoFactorAuth,
      oldValue: true,
      newValue: false,
    });
  }

  const counts: Array<{ field: SignInSettingsClearedField; count: number }> = [
    {
      field: SignInSettingsClearedField.AuthenticatorApps,
      count: cleared.authenticatorAppCount,
    },
    {
      field: SignInSettingsClearedField.PasskeysAndSecurityKeys,
      count: cleared.passkeyAndSecurityKeyCount,
    },
    {
      field: SignInSettingsClearedField.BackupCodes,
      count: cleared.backupCodeCount,
    },
  ];

  for (const entry of counts) {
    if (entry.count > 0) {
      changes.push({
        field: entry.field,
        oldValue: entry.count,
        newValue: 0,
      });
    }
  }

  return changes;
};
