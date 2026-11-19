import {
  CLEAR_LOCAL_SIGN_IN_ACTION,
  CLEAR_MASTER_ADMIN_SIGN_IN_NOT_CONFIRMED_MESSAGE,
  CLEAR_OWN_SIGN_IN_MESSAGE,
  CLEAR_SAVED_SIGN_IN_SETTINGS_NEEDS_SSO_REQUIRED_MESSAGE,
  CLEAR_SAVED_SIGN_IN_SETTINGS_ROUTE,
  hasLocalSignInSettings,
  LocalSignInSettings,
  NO_LOCAL_SIGN_IN_SETTINGS,
  readClearLocalSignInAnswer,
  readClearSavedSignInSettingsAnswer,
  readLocalSignInSettings,
  readSavedSignInSettingsAnswer,
  SAVED_SIGN_IN_SETTINGS_ROUTE,
} from "../../../Types/SSO/LocalSignInClearing";
import { describe, expect, test } from "@jest/globals";

/*
 * CLEARING THE SIGN-IN SETTINGS PEOPLE SAVED IN ONEUPTIME (issue #9762), as
 * the Admin Dashboard reads it: the routes it asks, whether a person has
 * anything to clear, and the answers - which a broken or forged reply must
 * never turn into a count, or a "cleared", that did not happen.
 */

const EVERYTHING: LocalSignInSettings = {
  hasPassword: true,
  isTwoFactorAuthEnabled: true,
  authenticatorAppCount: 2,
  passkeyAndSecurityKeyCount: 1,
  backupCodeCount: 10,
};

describe("the routes", () => {
  test("are the ones the Admin Dashboard asks, under the API", () => {
    expect(CLEAR_LOCAL_SIGN_IN_ACTION).toBe("clear-local-sign-in");
    expect(SAVED_SIGN_IN_SETTINGS_ROUTE).toBe(
      "/global-config/saved-sign-in-settings",
    );
    expect(CLEAR_SAVED_SIGN_IN_SETTINGS_ROUTE).toBe(
      "/global-config/saved-sign-in-settings/clear",
    );
  });
});

describe("hasLocalSignInSettings", () => {
  test("nothing saved is nothing to clear", () => {
    expect(hasLocalSignInSettings(NO_LOCAL_SIGN_IN_SETTINGS)).toBe(false);
  });

  test.each([
    ["a password", { hasPassword: true }],
    ["two-factor authentication on", { isTwoFactorAuthEnabled: true }],
    ["an authenticator app", { authenticatorAppCount: 1 }],
    ["a passkey or a security key", { passkeyAndSecurityKeyCount: 1 }],
    ["a backup code", { backupCodeCount: 1 }],
  ])(
    "%s alone is something to clear",
    (_label: string, part: Partial<LocalSignInSettings>) => {
      expect(
        hasLocalSignInSettings({ ...NO_LOCAL_SIGN_IN_SETTINGS, ...part }),
      ).toBe(true);
    },
  );
});

describe("readLocalSignInSettings", () => {
  test("reads what a person had", () => {
    expect(readLocalSignInSettings({ ...EVERYTHING })).toEqual(EVERYTHING);
    expect(readLocalSignInSettings({ ...NO_LOCAL_SIGN_IN_SETTINGS })).toEqual(
      NO_LOCAL_SIGN_IN_SETTINGS,
    );
  });

  test.each([
    ["nothing", undefined],
    ["null", null],
    ["a list", [EVERYTHING]],
    ["a string", "everything"],
    ["a flag that is a string", { ...EVERYTHING, hasPassword: "true" }],
    ["a count that is negative", { ...EVERYTHING, backupCodeCount: -1 }],
    [
      "a count that is not whole",
      { ...EVERYTHING, authenticatorAppCount: 1.5 },
    ],
    [
      "a count that is a string",
      { ...EVERYTHING, passkeyAndSecurityKeyCount: "1" },
    ],
    ["a missing switch", { ...EVERYTHING, isTwoFactorAuthEnabled: undefined }],
  ])("%s is no answer", (_label: string, value: unknown) => {
    expect(readLocalSignInSettings(value)).toBeNull();
  });
});

describe("readClearLocalSignInAnswer", () => {
  test("reads what a clear removed and how many sessions it ended", () => {
    expect(
      readClearLocalSignInAnswer({ cleared: EVERYTHING, sessionsEnded: 3 }),
    ).toEqual({ cleared: EVERYTHING, sessionsEnded: 3 });
  });

  test.each([
    ["nothing", null],
    ["no settings", { sessionsEnded: 3 }],
    ["broken settings", { cleared: { hasPassword: true }, sessionsEnded: 0 }],
    ["no session count", { cleared: EVERYTHING }],
    [
      "a session count that is a string",
      { cleared: EVERYTHING, sessionsEnded: "3" },
    ],
    ["a list", [{ cleared: EVERYTHING, sessionsEnded: 3 }]],
  ])("%s is no answer", (_label: string, value: unknown) => {
    expect(readClearLocalSignInAnswer(value)).toBeNull();
  });
});

describe("the Require SSO card's answers", () => {
  test("its count is read when it is a whole number of people", () => {
    expect(readSavedSignInSettingsAnswer({ peopleCount: 0 })).toEqual({
      peopleCount: 0,
    });
    expect(readSavedSignInSettingsAnswer({ peopleCount: 41 })).toEqual({
      peopleCount: 41,
    });
  });

  test("its clear is read when it is a whole number of people", () => {
    expect(readClearSavedSignInSettingsAnswer({ peopleCleared: 7 })).toEqual({
      peopleCleared: 7,
    });
  });

  test.each([
    [null],
    [[]],
    [{}],
    [{ peopleCount: "3" }],
    [{ peopleCount: -1 }],
    [{ peopleCount: 2.5 }],
  ])("anything else is no count: %j", (answer: unknown) => {
    expect(readSavedSignInSettingsAnswer(answer)).toBeNull();
  });

  test.each([
    [null],
    [{}],
    [{ peopleCleared: "7" }],
    [{ peopleCleared: -2 }],
    [{ peopleCount: 7 }],
  ])("anything else is no clear: %j", (answer: unknown) => {
    expect(readClearSavedSignInSettingsAnswer(answer)).toBeNull();
  });
});

describe("the refusals", () => {
  test.each([
    CLEAR_SAVED_SIGN_IN_SETTINGS_NEEDS_SSO_REQUIRED_MESSAGE,
    CLEAR_MASTER_ADMIN_SIGN_IN_NOT_CONFIRMED_MESSAGE,
    CLEAR_OWN_SIGN_IN_MESSAGE,
  ])("each is a sentence that says what to do: %s", (message: string) => {
    expect(message).toMatch(/^[A-Z].*\.$/);
    expect(message.length).toBeLessThanOrEqual(200);
  });

  test("each is its own", () => {
    expect(
      new Set([
        CLEAR_SAVED_SIGN_IN_SETTINGS_NEEDS_SSO_REQUIRED_MESSAGE,
        CLEAR_MASTER_ADMIN_SIGN_IN_NOT_CONFIRMED_MESSAGE,
        CLEAR_OWN_SIGN_IN_MESSAGE,
      ]).size,
    ).toBe(3);
  });

  test("clearing while SSO is not required names the switch that must be on first", () => {
    expect(CLEAR_SAVED_SIGN_IN_SETTINGS_NEEDS_SSO_REQUIRED_MESSAGE).toContain(
      "Require SSO to Sign In",
    );
  });

  test("clearing your own says where your own settings are", () => {
    expect(CLEAR_OWN_SIGN_IN_MESSAGE).toContain("User Profile");
  });
});
