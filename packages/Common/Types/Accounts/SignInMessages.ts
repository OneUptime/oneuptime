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

// A sign-up with an email address that already has an account.
export const getAccountAlreadyExistsMessage: (email: string) => string = (
  email: string,
): string => {
  return `An account with ${email} already exists. Sign in instead, or reset your password if you have forgotten it.`;
};
