/*
 * What the sign-up and sign-in routes answer when they refuse (#6836):
 * what happened and what to do next, rather than "Invalid code." or "Invalid
 * two factor auth id.". Shared by the routes (Identity/API/Authentication.ts)
 * and their tests. React-free and server-safe.
 */

export const TWO_FACTOR_MESSAGES: {
  wrongCode: string;
  wrongBackupCode: string;
  authenticatorGone: string;
} = {
  wrongCode:
    "That code is not right. Enter the 6-digit code your authenticator app shows now.",
  /*
   * One answer for a code that does not exist, one already used and one of
   * somebody else's: telling them apart would let a photographed list be
   * checked for the codes still live.
   */
  wrongBackupCode:
    "That backup code is not right, or it was already used. Each backup code works once.",
  authenticatorGone:
    "This authenticator is no longer set up for your account. Go back and sign in again.",
};

// A verify-email link that reached OneUptime without its token.
export const INCOMPLETE_VERIFICATION_LINK_MESSAGE: string =
  "This verification link is incomplete. Open the link from the email again, or sign in to get a new one.";

// A reset-password link that reached OneUptime without its token.
export const INCOMPLETE_RESET_LINK_MESSAGE: string =
  "This password reset link is incomplete. Open the link from the email again, or ask for a new one on the Forgot Password page.";

/*
 * A reset-password link the server turned down, on OneUptime's Reset Password
 * page and a status page's. Each says what happened and what to do next, and
 * the page offers Request a New Link for either (#9123): the server answers
 * with exactly these words, and the page tells them from a refused password
 * by them.
 */
export const RESET_LINK_MESSAGES: {
  invalid: string;
  expired: string;
} = {
  invalid:
    "This password reset link has already been used or is not valid. Ask for a new link.",
  expired:
    "This password reset link has expired. Reset links work for one day. Ask for a new link.",
};

// Whether a refused reset is about the link, which only a new link fixes.
export const isResetLinkRefusal: (message: string) => boolean = (
  message: string,
): boolean => {
  return (
    message === RESET_LINK_MESSAGES.invalid ||
    message === RESET_LINK_MESSAGES.expired ||
    message === INCOMPLETE_RESET_LINK_MESSAGE
  );
};

/*
 * A sign-up with an email address that already has an account - said only
 * by a self-hosted server that cannot email the address (#9816): every
 * other server answers every address alike, and says this in an email to
 * the address instead (Identity's EmailProvedSignUp).
 */
export const getAccountAlreadyExistsMessage: (email: string) => string = (
  email: string,
): string => {
  return `An account with ${email} already exists. Sign in instead, or reset your password if you have forgotten it.`;
};

/*
 * What every sign-up is told while a server's admin has turned sign-up off,
 * whatever the address (#9816). It used to go on for an address with an
 * invitation waiting, which said which addresses had one; that person is
 * emailed their link instead, and these words tell them where to look.
 */
export const SIGN_UP_TURNED_OFF_MESSAGE: string =
  "Sign up is turned off on this OneUptime server. If you were invited, use the link in your invitation email. Otherwise, ask your server's admin to turn it on.";
