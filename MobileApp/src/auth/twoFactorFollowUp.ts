/**
 * What has to happen after a second factor is accepted, but before the app is
 * allowed to navigate into the dashboard.
 *
 * The server has already signed the user in by the time this is consulted --
 * the tokens are stored. What is left is whether there is one more screen the
 * user must see, and there are exactly two reasons there might be. Both are
 * about recovery codes, and both are the reason OneUptime issue #3382 existed:
 *
 *  - the enrolment MINTED a set. Those strings are in that one response and
 *    nowhere else, ever -- the server keeps keyed digests -- so navigating away
 *    from them destroys them. They get a screen, and the screen does not let
 *    go until the user says they have saved them.
 *
 *  - the account has NO recovery route. That is everybody who set two factor
 *    auth up before codes existed and everybody an admin has just reset: one
 *    lost handset away from a support ticket, and never told. The offer is
 *    made at the one moment they are demonstrably thinking about their second
 *    factor, and it is skippable, because a prompt that could wedge a
 *    completed sign-in would be worse than the problem it is solving.
 *
 * Kept as a pure function, away from the screens, because it is the same
 * decision on four different paths -- the authenticator code, the recovery
 * code, the forced enrolment, and the code generated from the offer itself --
 * and each path knows "does this account have codes" differently. Deciding it
 * inline four times is how one of them ends up wrong and nobody notices, since
 * every wrong answer here is silent: the user is simply signed in, and finds
 * out months later at the sign-in they cannot complete.
 */
export type TwoFactorFollowUp = "show-codes" | "offer-codes" | "signed-in";

export function decideTwoFactorFollowUp(data: {
  /* How many codes this response is carrying, in plaintext. */
  mintedCodeCount: number;

  /*
   * Whether we POSITIVELY KNOW the account has no recovery codes.
   *
   * Positively. "Unknown" must arrive here as false: the server omits the
   * count when it could not read it, and treating that as "none" would tell a
   * user holding ten printed codes that they have none, on the strength of a
   * transient database fault.
   */
  accountHasNoCodes: boolean;

  /*
   * Whether this handset was recently told to stop asking this account. The
   * offer is a nudge, not a gate; asked on every sign-in for the life of the
   * account it is a toll.
   */
  offerRecentlySkipped: boolean;
}): TwoFactorFollowUp {
  /*
   * Codes in hand come first, unconditionally. Not even a suppressed offer may
   * take precedence: this is the only moment they exist.
   */
  if (data.mintedCodeCount > 0) {
    return "show-codes";
  }

  if (data.accountHasNoCodes && !data.offerRecentlySkipped) {
    return "offer-codes";
  }

  return "signed-in";
}
