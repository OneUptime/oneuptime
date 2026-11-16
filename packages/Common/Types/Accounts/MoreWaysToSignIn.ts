/*
 * Whether this browser left the sign-in page's "More ways to sign in" open
 * (Accounts/src/Components/MoreWaysToSignIn): "true", or nothing. Somebody
 * who signs in with single sign-on, a sign-in link or a passkey opens it once
 * and finds it open from then on. Kept after sign-out (KeptAfterSignOut.ts):
 * the sign-in page reads it when nobody is signed in, and it names nobody.
 */
export const MORE_WAYS_TO_SIGN_IN_OPEN_KEY: string =
  "oneuptime-sign-in-more-ways-open";
