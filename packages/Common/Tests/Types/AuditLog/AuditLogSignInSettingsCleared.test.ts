import User from "../../../Models/DatabaseModels/User";
import { AUDIT_LOG_REDACTED_VALUE } from "../../../Types/AuditLog/AuditLogRedaction";
import {
  AUDIT_LOG_SIGN_IN_SETTINGS_CLEARED_RESOURCE_TYPE,
  getSignInSettingsClearedChanges,
  SignInSettingsClearedField,
} from "../../../Types/AuditLog/AuditLogSignInSettingsCleared";
import { JSONObject } from "../../../Types/JSON";
import {
  LocalSignInSettings,
  NO_LOCAL_SIGN_IN_SETTINGS,
} from "../../../Types/SSO/LocalSignInClearing";
import { describe, expect, test } from "@jest/globals";

/*
 * A MASTER ADMIN CLEARING SOMEONE'S SIGN-IN SETTINGS, IN THE AUDIT LOG
 * (issue #9762): what each project's entry says was removed. Its fields are
 * what was there and is gone - never a value of a password, a secret, a key
 * or a code - and a field with nothing to remove is left out.
 */

const EVERYTHING: LocalSignInSettings = {
  hasPassword: true,
  isTwoFactorAuthEnabled: true,
  authenticatorAppCount: 2,
  passkeyAndSecurityKeyCount: 3,
  backupCodeCount: 9,
};

describe("what an entry about a clear is about", () => {
  test("the person: a User, as the model names itself", () => {
    expect(AUDIT_LOG_SIGN_IN_SETTINGS_CLEARED_RESOURCE_TYPE).toBe(
      new User().singularName,
    );
  });
});

describe("getSignInSettingsClearedChanges", () => {
  test("names everything that was removed, before and after, in one order", () => {
    expect(getSignInSettingsClearedChanges(EVERYTHING)).toEqual([
      {
        field: SignInSettingsClearedField.Password,
        oldValue: AUDIT_LOG_REDACTED_VALUE,
        newValue: null,
      },
      {
        field: SignInSettingsClearedField.TwoFactorAuth,
        oldValue: true,
        newValue: false,
      },
      {
        field: SignInSettingsClearedField.AuthenticatorApps,
        oldValue: 2,
        newValue: 0,
      },
      {
        field: SignInSettingsClearedField.PasskeysAndSecurityKeys,
        oldValue: 3,
        newValue: 0,
      },
      {
        field: SignInSettingsClearedField.BackupCodes,
        oldValue: 9,
        newValue: 0,
      },
    ]);
  });

  test("a clear that removed nothing has nothing to say", () => {
    expect(getSignInSettingsClearedChanges(NO_LOCAL_SIGN_IN_SETTINGS)).toEqual(
      [],
    );
  });

  test.each([
    [
      "a password",
      { hasPassword: true },
      [SignInSettingsClearedField.Password],
    ],
    [
      "two-factor authentication",
      { isTwoFactorAuthEnabled: true },
      [SignInSettingsClearedField.TwoFactorAuth],
    ],
    [
      "authenticator apps",
      { authenticatorAppCount: 1 },
      [SignInSettingsClearedField.AuthenticatorApps],
    ],
    [
      "passkeys and security keys",
      { passkeyAndSecurityKeyCount: 1 },
      [SignInSettingsClearedField.PasskeysAndSecurityKeys],
    ],
    [
      "backup codes",
      { backupCodeCount: 1 },
      [SignInSettingsClearedField.BackupCodes],
    ],
  ])(
    "%s alone is the one field",
    (
      _label: string,
      part: Partial<LocalSignInSettings>,
      fields: Array<SignInSettingsClearedField>,
    ) => {
      expect(
        getSignInSettingsClearedChanges({
          ...NO_LOCAL_SIGN_IN_SETTINGS,
          ...part,
        }).map((change: unknown): unknown => {
          return (change as JSONObject)["field"];
        }),
      ).toEqual(fields);
    },
  );

  test("the password is recorded as changed, never with a value of it", () => {
    const change: JSONObject = getSignInSettingsClearedChanges({
      ...NO_LOCAL_SIGN_IN_SETTINGS,
      hasPassword: true,
    })[0] as JSONObject;

    expect(change["oldValue"]).toBe(AUDIT_LOG_REDACTED_VALUE);
    expect(change["newValue"]).toBeNull();
  });

  test("nothing in an entry is a secret: only counts, switches and the redaction marker", () => {
    for (const change of getSignInSettingsClearedChanges(EVERYTHING)) {
      for (const value of [
        (change as JSONObject)["oldValue"],
        (change as JSONObject)["newValue"],
      ]) {
        expect(
          value === null ||
            typeof value === "number" ||
            typeof value === "boolean" ||
            value === AUDIT_LOG_REDACTED_VALUE,
        ).toBe(true);
      }
    }
  });

  test("the fields that are columns of the person are named as their columns are", () => {
    const user: User = new User();

    expect(user.isTableColumn(SignInSettingsClearedField.Password)).toBe(true);
    expect(user.isTableColumn(SignInSettingsClearedField.TwoFactorAuth)).toBe(
      true,
    );
  });
});
