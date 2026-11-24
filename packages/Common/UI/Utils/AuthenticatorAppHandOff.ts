/*
 * HANDS AN ENROLMENT TO THE AUTHENTICATOR APP ON THIS DEVICE (issue #6651).
 *
 * A phone cannot scan its own screen. Its authenticator app - Google
 * Authenticator, Microsoft Authenticator, 1Password, iOS Passwords - takes
 * the otpauth:// URL itself, the one the QR code holds, and opens with the
 * account filled in; the person comes back to the page to type its code.
 * AuthenticatorAppSetupCode offers it on a touch screen, as the mobile app
 * offers it (TwoFactorEnrolmentScreen).
 *
 * Opened by a button's press, never drawn as a link's address: the URL holds
 * the secret, and a link would put it somewhere new. On OneUptime Cloud the
 * sign-in page and the Dashboard load Google Analytics, whose enhanced
 * measurement records the address of every link pressed that leads off the
 * page (an outbound click), and a long press on a link shows its address
 * whole. Setting the location hands the URL to the device and nothing else,
 * and leaves the page as it was. Nothing here logs or measures it.
 *
 * A class of one method, so a test can stand in for the browser leaving.
 */
export default class AuthenticatorAppHandOff {
  public static open(otpauthUrl: string): void {
    window.location.assign(otpauthUrl);
  }
}
