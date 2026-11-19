import {
  getSecondStepEnrolmentChoices,
  SECURITY_KEY_ENROLMENT_OPTIONS_ROUTE,
  SecondStepEnrolmentChoice,
  SIGN_IN_AUTHENTICATOR_APP_NAME,
  SIGN_IN_SECURITY_KEY_NAME,
  VERIFY_SECURITY_KEY_ENROLMENT_ROUTE,
} from "../../../Types/Accounts/SecondStepEnrolment";
import { describe, expect, test } from "@jest/globals";

/*
 * SETTING UP A SECOND STEP AT SIGN-IN (issue #9764): what the sign-in page
 * offers, the routes a security key is set up through, and the names a
 * second step set up there is filed under.
 */

describe("what the sign-in page offers to set up", () => {
  test("an authenticator app first, and a security key where the browser can register one", () => {
    expect(getSecondStepEnrolmentChoices(true)).toEqual([
      SecondStepEnrolmentChoice.AuthenticatorApp,
      SecondStepEnrolmentChoice.SecurityKey,
    ]);
  });

  test("only the authenticator app where it cannot: the page goes straight to it, as it did before", () => {
    expect(getSecondStepEnrolmentChoices(false)).toEqual([
      SecondStepEnrolmentChoice.AuthenticatorApp,
    ]);
  });

  test("never offers the same step twice, and always the app", () => {
    for (const canRegisterSecurityKey of [true, false]) {
      const choices: Array<SecondStepEnrolmentChoice> =
        getSecondStepEnrolmentChoices(canRegisterSecurityKey);

      expect(new Set(choices).size).toBe(choices.length);
      expect(choices).toContain(SecondStepEnrolmentChoice.AuthenticatorApp);
    }
  });
});

describe("the routes a security key is set up through", () => {
  test("are the identity server's, beside /verify-totp-enrolment", () => {
    expect(SECURITY_KEY_ENROLMENT_OPTIONS_ROUTE).toBe(
      "/security-key-enrolment-options",
    );
    expect(VERIFY_SECURITY_KEY_ENROLMENT_ROUTE).toBe(
      "/verify-security-key-enrolment",
    );
  });

  test("are two different routes: the options sign nobody in", () => {
    expect(SECURITY_KEY_ENROLMENT_OPTIONS_ROUTE).not.toBe(
      VERIFY_SECURITY_KEY_ENROLMENT_ROUTE,
    );
  });
});

describe("the names a second step set up at sign-in is filed under", () => {
  test("say what it is, as the profile lists it", () => {
    // The name every authenticator app set up at sign-in has always had.
    expect(SIGN_IN_AUTHENTICATOR_APP_NAME).toBe("Authenticator App");
    expect(SIGN_IN_SECURITY_KEY_NAME).toBe("Security Key");
  });

  test("fit the columns they are kept in (100 characters)", () => {
    expect(SIGN_IN_AUTHENTICATOR_APP_NAME.length).toBeLessThanOrEqual(100);
    expect(SIGN_IN_SECURITY_KEY_NAME.length).toBeLessThanOrEqual(100);
  });
});
