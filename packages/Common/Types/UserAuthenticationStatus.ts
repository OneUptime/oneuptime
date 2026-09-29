import TwoFactorAuthStatus from "./TwoFactorAuthStatus";

/**
 * What an operator needs to know about how one user can sign in, with nothing
 * secret in it.
 *
 * `hasPassword` is a boolean rather than the column itself for a specific
 * reason: the password column holds a scrypt digest, and a master admin
 * bypasses column read permissions, so "just select it in the UI" would put
 * every user's password hash in a browser's network tab. The only fact the
 * Admin Dashboard needs is whether one is set at all.
 *
 * This lives in Common/Types rather than beside the service that builds it so
 * that the page rendering it and the endpoint producing it are typed against
 * the same declaration -- a renamed field then fails to compile instead of
 * quietly rendering `undefined`.
 */
export default interface UserAuthenticationStatus {
  // Can this user sign in with a password at all, or are they SSO-only?
  hasPassword: boolean;

  isEmailVerified: boolean;

  /*
   * Read from User.enableTwoFactorAuth, NOT the similarly named
   * User.twoFactorAuthEnabled. Both columns exist; only `enableTwoFactorAuth`
   * is the one login consults and the one the rest of the product writes.
   * `twoFactorAuthEnabled` is a vestige of the initial migration that nothing
   * reads -- reporting it here would tell an operator "2FA off" about a user
   * who very much has it on.
   */
  isTwoFactorAuthEnabled: boolean;

  /*
   * The requirement and the configuration folded into one value, because
   * neither answers the operator's question alone. `isTwoFactorAuthEnabled`
   * above is the raw flag; this is what the page actually renders, and the
   * distinction it adds -- required with nothing set up yet, versus required
   * and configured -- is the whole reason the admin page exists.
   */
  twoFactorAuthStatus: TwoFactorAuthStatus;

  /*
   * How many authenticators the user has actually finished setting up, across
   * TOTP apps and security keys together. Counted with `isVerified: true`, so
   * an abandoned QR scan does not read as a working factor.
   */
  verifiedTwoFactorAuthMethodCount: number;

  /*
   * How many single-use backup codes the user has left.
   *
   * Deliberately NOT folded into `verifiedTwoFactorAuthMethodCount`, and the
   * separation is the operator's whole decision. The count above answers "can
   * they sign in at all today"; this one answers "can they get themselves back
   * in without me". An operator looking at a lost-phone ticket needs both: a
   * user with codes left should be told to use one, and only a user with none
   * needs the reset button -- which signs them out everywhere and marches them
   * through enrolment.
   *
   * Zero is the normal reading for an account that never generated any, not an
   * error state.
   */
  unusedTwoFactorBackupCodeCount: number;

  // Is there an unexpired password-reset link outstanding for this user?
  hasPendingPasswordResetLink: boolean;
}
