import { describe, expect, test } from "@jest/globals";
import ObjectID from "../../../Types/ObjectID";
import { JSONObject } from "../../../Types/JSON";
import {
  isSecondFactor,
  isSignInMethod,
  isSingleSignOnMethod,
  MAX_SESSION_SIGN_IN_TEXT_LENGTH,
  readSessionSignIn,
  readSessionSignInOrigin,
  readSessionSignInText,
  SecondFactor,
  SECOND_FACTOR_KEY,
  SessionSignIn,
  SIGN_IN_DEVICE_KEY,
  SIGN_IN_LOCATION_KEY,
  SIGN_IN_METHOD_KEY,
  SignInMethod,
  SSO_PROJECT_ID_KEY,
  SSO_PROVIDER_NAME_KEY,
  toSessionSignInInfo,
} from "../../../Types/UserSession/SessionSignIn";

/*
 * How a session was signed in, and from where, as the session keeps it
 * (issue #6762): written once, at sign-in, into UserSession.additionalInfo,
 * and read back for the audit log's entry about the sign-in and again for
 * the one about its end. Whatever a row holds that could not have been
 * written reads as nothing, so a stray value never reaches an entry.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);

describe("the sign-in methods and second factors", () => {
  test("are the audit log's words, as an entry carries them", () => {
    expect(Object.values(SignInMethod)).toEqual([
      "Password",
      "Sign-in link",
      "Passkey",
      "Google",
      "Microsoft",
      "Vercel",
      "SAML single sign-on",
      "OpenID Connect single sign-on",
    ]);
    expect(Object.values(SecondFactor)).toEqual([
      "Authenticator app",
      "Security key",
      "Backup code",
    ]);
  });

  /*
   * Google, Microsoft and Vercel sign-ins kept these very words in
   * additionalInfo.signInMethod before the other sign-ins were named, so a
   * session they made yesterday still says how it signed in.
   */
  test("keep the words Google, Microsoft and Vercel sign-ins already kept", () => {
    expect(SIGN_IN_METHOD_KEY).toBe("signInMethod");

    for (const kept of ["Google", "Microsoft", "Vercel"]) {
      expect(readSessionSignIn({ signInMethod: kept })).toEqual({
        method: kept,
      });
    }
  });

  test("know their own values, and nothing else", () => {
    expect(isSignInMethod(SignInMethod.Passkey)).toBe(true);
    expect(isSignInMethod("Telepathy")).toBe(false);
    expect(isSignInMethod(undefined)).toBe(false);
    expect(isSignInMethod(7)).toBe(false);

    expect(isSecondFactor(SecondFactor.BackupCode)).toBe(true);
    expect(isSecondFactor("SMS")).toBe(false);
    expect(isSecondFactor(null)).toBe(false);
  });

  test("single sign-on is SAML and OpenID Connect only", () => {
    expect(
      Object.values(SignInMethod).filter((method: SignInMethod): boolean => {
        return isSingleSignOnMethod(method);
      }),
    ).toEqual([SignInMethod.Saml, SignInMethod.OpenIdConnect]);
  });
});

describe("what a session keeps", () => {
  test("a password sign-in with its second factor, and where it came from", () => {
    expect(
      toSessionSignInInfo({
        signIn: {
          method: SignInMethod.Password,
          secondFactor: SecondFactor.AuthenticatorApp,
        },
        origin: { device: "Chrome 130 on macOS", location: "Berlin, Germany" },
      }),
    ).toEqual({
      [SIGN_IN_METHOD_KEY]: "Password",
      [SECOND_FACTOR_KEY]: "Authenticator app",
      [SIGN_IN_DEVICE_KEY]: "Chrome 130 on macOS",
      [SIGN_IN_LOCATION_KEY]: "Berlin, Germany",
    });
  });

  test("a project's single sign-on keeps its provider and its project", () => {
    expect(
      toSessionSignInInfo({
        signIn: {
          method: SignInMethod.Saml,
          ssoProviderName: "Acme Okta",
          ssoProjectId: PROJECT_ID,
        },
      }),
    ).toEqual({
      [SIGN_IN_METHOD_KEY]: "SAML single sign-on",
      [SSO_PROVIDER_NAME_KEY]: "Acme Okta",
      // The key project SAML and OIDC sign-ins have always kept it under.
      [SSO_PROJECT_ID_KEY]: PROJECT_ID.toString(),
    });
    expect(SSO_PROJECT_ID_KEY).toBe("projectId");
  });

  test("the server's own provider keeps its name and no project", () => {
    expect(
      toSessionSignInInfo({
        signIn: {
          method: SignInMethod.OpenIdConnect,
          ssoProviderName: "Company Entra ID",
        },
      }),
    ).toEqual({
      [SIGN_IN_METHOD_KEY]: "OpenID Connect single sign-on",
      [SSO_PROVIDER_NAME_KEY]: "Company Entra ID",
    });
  });

  test("a provider or a project is never kept for a sign-in that is not single sign-on", () => {
    expect(
      toSessionSignInInfo({
        signIn: {
          method: SignInMethod.Google,
          ssoProviderName: "Not a provider",
          ssoProjectId: PROJECT_ID,
        },
      }),
    ).toEqual({ [SIGN_IN_METHOD_KEY]: "Google" });
  });

  test("nothing, when nothing is known", () => {
    expect(toSessionSignInInfo({})).toEqual({});
    expect(
      toSessionSignInInfo({ origin: { device: "", location: "   " } }),
    ).toEqual({});
  });

  test("a method or a second factor it does not know is not kept", () => {
    expect(
      toSessionSignInInfo({
        signIn: {
          method: "Carrier pigeon" as SignInMethod,
          secondFactor: SecondFactor.SecurityKey,
        },
      }),
    ).toEqual({});
    expect(
      toSessionSignInInfo({
        signIn: {
          method: SignInMethod.Password,
          secondFactor: "SMS" as SecondFactor,
        },
      }),
    ).toEqual({ [SIGN_IN_METHOD_KEY]: "Password" });
  });
});

describe("a text a session keeps", () => {
  test("is one trimmed line", () => {
    expect(readSessionSignInText("  Chrome 130\non\tmacOS \r\n")).toBe(
      "Chrome 130 on macOS",
    );
  });

  test("is cut to its length", () => {
    const long: string = "x".repeat(MAX_SESSION_SIGN_IN_TEXT_LENGTH + 50);

    expect(readSessionSignInText(long)).toHaveLength(
      MAX_SESSION_SIGN_IN_TEXT_LENGTH,
    );
  });

  /*
   * A megabyte on one line is read only as far as it is kept: the reader
   * slices before it looks for line breaks (Docs/notifications/README.md,
   * "Megabyte-long values").
   */
  test("of megabytes is cut without reading it all", () => {
    const huge: string = "y".repeat(4 * 1024 * 1024);

    expect(readSessionSignInText(huge)).toBe(
      "y".repeat(MAX_SESSION_SIGN_IN_TEXT_LENGTH),
    );
  });

  test("is nothing when it is not text, or is blank", () => {
    expect(readSessionSignInText(undefined)).toBeUndefined();
    expect(readSessionSignInText(null)).toBeUndefined();
    expect(readSessionSignInText(42)).toBeUndefined();
    expect(readSessionSignInText({ name: "x" })).toBeUndefined();
    expect(readSessionSignInText(" \n\t ")).toBeUndefined();
  });
});

describe("reading how a session signed in", () => {
  test("reads back what it kept, round trip", () => {
    const signIn: SessionSignIn = {
      method: SignInMethod.OpenIdConnect,
      ssoProviderName: "Acme Okta",
      ssoProjectId: PROJECT_ID,
    };

    const read: SessionSignIn | null = readSessionSignIn(
      toSessionSignInInfo({ signIn }),
    );

    expect(read?.method).toBe(SignInMethod.OpenIdConnect);
    expect(read?.ssoProviderName).toBe("Acme Okta");
    expect(read?.ssoProjectId?.toString()).toBe(PROJECT_ID.toString());
  });

  test("a second factor is read with its sign-in", () => {
    expect(
      readSessionSignIn({
        [SIGN_IN_METHOD_KEY]: SignInMethod.SignInLink,
        [SECOND_FACTOR_KEY]: SecondFactor.BackupCode,
      }),
    ).toEqual({
      method: SignInMethod.SignInLink,
      secondFactor: SecondFactor.BackupCode,
    });
  });

  test("a session that does not say reads as null", () => {
    expect(readSessionSignIn(undefined)).toBeNull();
    expect(readSessionSignIn(null)).toBeNull();
    expect(readSessionSignIn({})).toBeNull();
    expect(readSessionSignIn({ isGlobalLogin: true })).toBeNull();
    expect(readSessionSignIn([SignInMethod.Password])).toBeNull();
    expect(readSessionSignIn({ signInMethod: "Magic" })).toBeNull();
  });

  /*
   * A project SAML sign-in made before the sign-ins were named kept its
   * project and nothing else: it does not say whether it was SAML or
   * OpenID Connect, so it says nothing rather than guess.
   */
  test("an older single sign-on that kept only its project reads as null", () => {
    expect(
      readSessionSignIn({
        isGlobalLogin: false,
        projectId: PROJECT_ID.toString(),
      }),
    ).toBeNull();
  });

  test("a project that is not an id, or a provider that is not text, is left out", () => {
    const info: JSONObject = {
      [SIGN_IN_METHOD_KEY]: SignInMethod.Saml,
      [SSO_PROVIDER_NAME_KEY]: { name: "Okta" },
      [SSO_PROJECT_ID_KEY]: "not-a-project",
    };

    expect(readSessionSignIn(info)).toEqual({ method: SignInMethod.Saml });
  });

  test("a provider and a project are read for single sign-on only", () => {
    expect(
      readSessionSignIn({
        [SIGN_IN_METHOD_KEY]: SignInMethod.Password,
        [SSO_PROVIDER_NAME_KEY]: "Okta",
        [SSO_PROJECT_ID_KEY]: PROJECT_ID.toString(),
      }),
    ).toEqual({ method: SignInMethod.Password });
  });
});

describe("reading where a session signed in from", () => {
  test("reads back the device and the place it kept", () => {
    expect(
      readSessionSignInOrigin(
        toSessionSignInInfo({
          origin: {
            device: "Safari 18 on iPhone",
            location: "Lisbon, Portugal",
          },
        }),
      ),
    ).toEqual({ device: "Safari 18 on iPhone", location: "Lisbon, Portugal" });
  });

  test("says nothing it does not know", () => {
    expect(readSessionSignInOrigin(undefined)).toEqual({});
    expect(readSessionSignInOrigin({ signInDevice: 12 })).toEqual({});
    expect(readSessionSignInOrigin({ signInLocation: "" })).toEqual({});
  });
});
