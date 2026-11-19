/*
 * SETTING UP A SECOND STEP AT SIGN-IN (issue #9764).
 *
 * An account that is required to use two-factor authentication with
 * nothing set up behind it - a master admin's Require Two Factor Auth or
 * Reset Two Factor Auth, or an account switched on before #9726 - is walked
 * through setting up a second step when it signs in with its password or an
 * emailed link (/identity/login answers `twoFactorEnrolmentRequired`). It
 * picks one, as the profile's own setup offers:
 *
 *   - an authenticator app: scan the QR code /login sent and enter its code
 *     (POST /identity/verify-totp-enrolment);
 *   - a security key: a USB or NFC key, or the phone's or computer's own
 *     fingerprint, face or screen lock, registered with the browser's prompt
 *     as the profile's Add Security Key does - its options from POST
 *     /identity/security-key-enrolment-options, the key's answer to POST
 *     /identity/verify-security-key-enrolment.
 *
 * Either one signs the person in only once it works, with the backup codes a
 * first second step comes with, shown once. There is no session before that:
 * every one of these requests carries the email and password again (or the
 * sign-in link's token), and the server checks it, the account's block, the
 * server's SSO requirement and the address's verification again, exactly as
 * /login does. Each is refused unless the account is required to use
 * two-factor authentication, has no second step set up yet, and is not one
 * whose sign-in single sign-on manages (Types/SSO/SsoManagedSignIn): an
 * enrolment is only ever the completion of a requirement the server
 * imposed, never a way for whoever holds the password to add a factor of
 * their own to an account that has one. A key is registered for the account
 * the password proves, under the challenge made for that account, and for
 * no other.
 */

// Under the identity server's address (IDENTITY_URL).
export const SECURITY_KEY_ENROLMENT_OPTIONS_ROUTE: string =
  "/security-key-enrolment-options";

export const VERIFY_SECURITY_KEY_ENROLMENT_ROUTE: string =
  "/verify-security-key-enrolment";

/*
 * The names a second step set up at sign-in is filed under: nobody types
 * one there - they are finishing a sign-in, not browsing their settings -
 * and the profile lists it by this name, which they can change there.
 */
export const SIGN_IN_AUTHENTICATOR_APP_NAME: string = "Authenticator App";
export const SIGN_IN_SECURITY_KEY_NAME: string = "Security Key";

// The second steps the sign-in page offers to set up.
export enum SecondStepEnrolmentChoice {
  AuthenticatorApp = "AuthenticatorApp",
  SecurityKey = "SecurityKey",
}

/*
 * What the sign-in page offers, in order: the authenticator app always,
 * and a security key where this browser can register one - a secure page
 * in a browser with WebAuthn. With only the app to offer, the page goes
 * straight to it, as it did before #9764.
 */
export const getSecondStepEnrolmentChoices: (
  canRegisterSecurityKey: boolean,
) => Array<SecondStepEnrolmentChoice> = (
  canRegisterSecurityKey: boolean,
): Array<SecondStepEnrolmentChoice> => {
  return canRegisterSecurityKey
    ? [
        SecondStepEnrolmentChoice.AuthenticatorApp,
        SecondStepEnrolmentChoice.SecurityKey,
      ]
    : [SecondStepEnrolmentChoice.AuthenticatorApp];
};
