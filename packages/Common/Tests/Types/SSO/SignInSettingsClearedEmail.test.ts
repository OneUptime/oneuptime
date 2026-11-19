import { getServerTranslator } from "../../../Server/Utils/ServerTranslation";
import Dictionary from "../../../Types/Dictionary";
import {
  LocalSignInSettings,
  NO_LOCAL_SIGN_IN_SETTINGS,
} from "../../../Types/SSO/LocalSignInClearing";
import {
  getSignInSettingsClearedEmailVariables,
  getSignInSettingsClearedSubject,
  getSsoProviderNamesForEmail,
  MAX_EMAIL_SSO_PROVIDER_NAMES,
  SignInAfterClearing,
  SignInSettingsClearedBy,
  SignInSettingsClearedEmailData,
  SSO_PROVIDER_NAME_SEPARATOR,
} from "../../../Types/SSO/SignInSettingsClearedEmail";
import { describe, expect, test } from "@jest/globals";

/*
 * WHAT THE EMAIL ABOUT CLEARED SIGN-IN SETTINGS SAYS (#9818, #9820).
 *
 * The template (Notification/Templates/SignInSettingsCleared.hbs) shows a
 * row only for what its variables say, so these are what decide what a
 * person is told: who cleared them, by role; exactly what was removed, a
 * row for each thing they had and nothing for what they did not; and one
 * way to sign in now. Nothing in them is about anybody else.
 */

const EVERYTHING: LocalSignInSettings = {
  hasPassword: true,
  isTwoFactorAuthEnabled: true,
  authenticatorAppCount: 2,
  passkeyAndSecurityKeyCount: 3,
  backupCodeCount: 8,
};

const URLS: {
  signInUrl: string;
  ssoSignInUrl: string;
  forgotPasswordUrl: string;
} = {
  signInUrl: "https://oneuptime.example.com/accounts/login",
  ssoSignInUrl: "https://oneuptime.example.com/accounts/sso",
  forgotPasswordUrl: "https://oneuptime.example.com/accounts/forgot-password",
};

const serverAdminData: (
  overrides?: Partial<SignInSettingsClearedEmailData>,
) => SignInSettingsClearedEmailData = (
  overrides?: Partial<SignInSettingsClearedEmailData>,
): SignInSettingsClearedEmailData => {
  return {
    clearedBy: SignInSettingsClearedBy.ServerAdmin,
    cleared: EVERYTHING,
    signIn: SignInAfterClearing.SingleSignOn,
    ssoProviderNames: ["Okta"],
    clearedAt: "Nov 19, 2026, 10:42 AM UTC",
    productName: "OneUptime",
    ...URLS,
    ...overrides,
  } as SignInSettingsClearedEmailData;
};

describe("the subject", () => {
  test("names the product the installation goes by, in English", () => {
    expect(
      getSignInSettingsClearedSubject(getServerTranslator("en"), "Acme Ops"),
    ).toBe("Your Acme Ops sign-in settings were cleared");
  });

  test("is written in the reader's language, the product's name as it is", () => {
    const german: string = getSignInSettingsClearedSubject(
      getServerTranslator("de"),
      "OneUptime",
    );

    expect(german).toContain("OneUptime");
    expect(german).not.toBe("Your OneUptime sign-in settings were cleared");
  });

  test("every language the server writes in words it, keeping the product's name", () => {
    for (const language of [
      "de",
      "fr",
      "es",
      "it",
      "pt",
      "nl",
      "da",
      "no",
      "sv",
      "ru",
      "ja",
      "ko",
      "zh-CN",
      "zh-TW",
      "hi",
      "fa",
      "ar",
    ]) {
      const subject: string = getSignInSettingsClearedSubject(
        getServerTranslator(language),
        "OneUptime",
      );

      expect(subject).toContain("OneUptime");
      expect(subject).not.toBe("Your OneUptime sign-in settings were cleared");
    }
  });
});

describe("the providers' names in the email", () => {
  test("are set apart with a dot, in the order given", () => {
    expect(getSsoProviderNamesForEmail(["Okta", "Azure AD"])).toBe(
      `Okta${SSO_PROVIDER_NAME_SEPARATOR}Azure AD`,
    );
  });

  test("are trimmed, each once whatever its case, and never empty", () => {
    expect(
      getSsoProviderNamesForEmail([" Okta ", "", "okta", "  ", "Google"]),
    ).toBe(`Okta${SSO_PROVIDER_NAME_SEPARATOR}Google`);
  });

  test("are at most MAX_EMAIL_SSO_PROVIDER_NAMES", () => {
    const names: Array<string> = Array.from(
      { length: MAX_EMAIL_SSO_PROVIDER_NAMES + 5 },
      (_value: unknown, index: number): string => {
        return `Provider ${index}`;
      },
    );

    expect(
      getSsoProviderNamesForEmail(names).split(SSO_PROVIDER_NAME_SEPARATOR),
    ).toHaveLength(MAX_EMAIL_SSO_PROVIDER_NAMES);
  });

  test("none is nothing", () => {
    expect(getSsoProviderNamesForEmail([])).toBe("");
  });
});

describe("the template's variables", () => {
  test("a server admin's clear says so, and names no project", () => {
    const vars: Dictionary<string> =
      getSignInSettingsClearedEmailVariables(serverAdminData());

    expect(vars["clearedByServerAdmin"]).toBe("true");
    expect(vars["clearedByProjectOwner"]).toBeUndefined();
    expect(vars["projectName"]).toBeUndefined();
  });

  test("a project owner's clear names the project, never a server admin", () => {
    const vars: Dictionary<string> = getSignInSettingsClearedEmailVariables({
      ...serverAdminData(),
      clearedBy: SignInSettingsClearedBy.ProjectOwner,
      projectName: "  Acme Production  ",
    });

    expect(vars["clearedByProjectOwner"]).toBe("true");
    expect(vars["projectName"]).toBe("Acme Production");
    expect(vars["clearedByServerAdmin"]).toBeUndefined();
  });

  test("a project owner's clear is never called a server admin's, even with a blank name", () => {
    const vars: Dictionary<string> = getSignInSettingsClearedEmailVariables({
      ...serverAdminData(),
      clearedBy: SignInSettingsClearedBy.ProjectOwner,
      projectName: "   ",
    });

    expect(vars["clearedByProjectOwner"]).toBe("true");
    expect(vars["clearedByServerAdmin"]).toBeUndefined();
  });

  test("a row for each thing that was removed, with its count", () => {
    const vars: Dictionary<string> =
      getSignInSettingsClearedEmailVariables(serverAdminData());

    expect(vars["removedPassword"]).toBe("true");
    expect(vars["removedPasskeyCount"]).toBe("3");
    expect(vars["removedAuthenticatorAppCount"]).toBe("2");
    expect(vars["removedBackupCodeCount"]).toBe("8");
    expect(vars["turnedOffTwoFactorAuth"]).toBe("true");
  });

  test("no row for what the person did not have", () => {
    const vars: Dictionary<string> = getSignInSettingsClearedEmailVariables(
      serverAdminData({
        cleared: {
          ...NO_LOCAL_SIGN_IN_SETTINGS,
          passkeyAndSecurityKeyCount: 1,
        },
      }),
    );

    expect(vars["removedPasskeyCount"]).toBe("1");
    expect(vars["removedPassword"]).toBeUndefined();
    expect(vars["removedAuthenticatorAppCount"]).toBeUndefined();
    expect(vars["removedBackupCodeCount"]).toBeUndefined();
    expect(vars["turnedOffTwoFactorAuth"]).toBeUndefined();
  });

  test("signing in with SSO names the providers and the SSO sign-in page, not Forgot password", () => {
    const vars: Dictionary<string> = getSignInSettingsClearedEmailVariables(
      serverAdminData({ ssoProviderNames: ["Okta", "Azure AD"] }),
    );

    expect(vars["signsInWithSso"]).toBe("true");
    expect(vars["ssoProviderNames"]).toBe(
      `Okta${SSO_PROVIDER_NAME_SEPARATOR}Azure AD`,
    );
    expect(vars["ssoSignInUrl"]).toBe(URLS.ssoSignInUrl);
    expect(vars["setsNewPassword"]).toBeUndefined();
    expect(vars["signInWayUnknown"]).toBeUndefined();
    expect(vars["forgotPasswordUrl"]).toBeUndefined();
  });

  test("signing in with SSO through providers whose names are unknown leaves the row out", () => {
    const vars: Dictionary<string> = getSignInSettingsClearedEmailVariables(
      serverAdminData({ ssoProviderNames: [] }),
    );

    expect(vars["signsInWithSso"]).toBe("true");
    expect(vars["ssoProviderNames"]).toBeUndefined();
  });

  test("with nothing managing their sign-in, the way back is a new password", () => {
    const vars: Dictionary<string> = getSignInSettingsClearedEmailVariables(
      serverAdminData({
        signIn: SignInAfterClearing.ForgotPassword,
        ssoProviderNames: ["Okta"],
      }),
    );

    expect(vars["setsNewPassword"]).toBe("true");
    expect(vars["forgotPasswordUrl"]).toBe(URLS.forgotPasswordUrl);
    expect(vars["signsInWithSso"]).toBeUndefined();
    expect(vars["ssoProviderNames"]).toBeUndefined();
    expect(vars["signInWayUnknown"]).toBeUndefined();
  });

  test("when it could not be read, both ways are named", () => {
    const vars: Dictionary<string> = getSignInSettingsClearedEmailVariables(
      serverAdminData({ signIn: SignInAfterClearing.Unknown }),
    );

    expect(vars["signInWayUnknown"]).toBe("true");
    expect(vars["forgotPasswordUrl"]).toBe(URLS.forgotPasswordUrl);
    expect(vars["signsInWithSso"]).toBeUndefined();
    expect(vars["setsNewPassword"]).toBeUndefined();
  });

  test("holds when it was cleared and where to sign in, and nothing about anybody else", () => {
    const vars: Dictionary<string> =
      getSignInSettingsClearedEmailVariables(serverAdminData());

    expect(vars["clearedAt"]).toBe("Nov 19, 2026, 10:42 AM UTC");
    expect(vars["signInUrl"]).toBe(URLS.signInUrl);
    expect(vars["productName"]).toBe("OneUptime");

    // Only these names: no list of people, no count of them, no actor.
    expect(Object.keys(vars).sort()).toEqual(
      [
        "clearedAt",
        "clearedByServerAdmin",
        "productName",
        "removedAuthenticatorAppCount",
        "removedBackupCodeCount",
        "removedPasskeyCount",
        "removedPassword",
        "signInUrl",
        "signsInWithSso",
        "ssoProviderNames",
        "ssoSignInUrl",
        "turnedOffTwoFactorAuth",
      ].sort(),
    );
  });
});
