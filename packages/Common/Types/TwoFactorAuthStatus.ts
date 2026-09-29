/**
 * Where one user stands on two factor authentication, as one value.
 *
 * The three states are DERIVED, never stored. `User.enableTwoFactorAuth` says
 * whether the account is required to use two factor auth; the rows in
 * `UserTotpAuth` / `UserWebAuthn` say whether anything has actually been set
 * up. Neither answers the operator's question on its own, and the pair is easy
 * to render wrongly -- "Two Factor Auth: Yes" for an account that has the
 * requirement switched on but no authenticator behind it is precisely the
 * user who cannot sign in unaided.
 *
 * A second column recording the same thing was considered and rejected: two
 * flags that must agree can disagree, and every write path would have to
 * remember to move both. `enableTwoFactorAuth` is already the only flag the
 * login handler reads, so it stays the single source of truth and this enum is
 * computed from it.
 *
 * The members are machine values, deliberately not display strings. The labels
 * an operator sees ("Enabled - Pending Setup" and friends) are i18n keys
 * resolved in the browser, so a translation can change without changing what
 * crosses the wire.
 */
enum TwoFactorAuthStatus {
  /*
   * The account is not required to use two factor auth. It may still have
   * authenticators set up voluntarily -- they simply are not asked for.
   */
  NotEnabled = "NotEnabled",

  /*
   * Required, but nothing is set up yet. The user is sent through enrolment
   * the next time they sign in and cannot get past it. This is the state an
   * admin creates by turning the requirement on, and the state a "Reset MFA"
   * leaves a mandated account in.
   */
  EnabledPendingSetup = "EnabledPendingSetup",

  // Required, and at least one verified authenticator exists.
  EnabledConfigured = "EnabledConfigured",
}

export default TwoFactorAuthStatus;
