/*
 * A LINK TO SET THE FIRST PASSWORD OF AN ACCOUNT SOMEBODY ELSE CREATED (#9139).
 *
 * A master admin who creates a user in the Admin Dashboard (Users > Create
 * User) does not have to make up a password and pass it on: OneUptime emails
 * the new user a link to choose their own. It is the password reset link
 * with another page and other words, and nothing else:
 *
 *   - the same token: a random UUID from the CSPRNG, stored only as its hash
 *     in User.resetPasswordToken, so a new reset or set-password link
 *     replaces it, a new email address or password ends it, and it works once
 *     (UserService.sendPasswordResetLink);
 *   - redeemed by the same endpoint, POST /identity/reset-password, which
 *     holds it to the one password rule (Types/Password), clears it and marks
 *     the address verified - there is no second way to set a password;
 *   - a token route (Common/UI/Utils/SensitiveUrlToken): the token leaves the
 *     address bar before anything else on the page reads it.
 *
 * What differs is what the account has: an account with no password yet gets
 * this link - "set your password", for SET_PASSWORD_LINK_EXPIRY_DAYS, since a
 * new person may not open their mail the same day - and an account with one
 * gets the reset link, for a day. The server decides, from the account, never
 * from the caller.
 *
 * Pure, with no Node or browser APIs: the server, the Accounts page and the
 * Admin Dashboard read the same numbers.
 */

// How long a set-password link works.
export const SET_PASSWORD_LINK_EXPIRY_DAYS: number = 7;

// The Accounts page each link opens: /accounts/<route>/<token>.
export const SET_PASSWORD_PAGE_ROUTE: string = "/set-password";
export const RESET_PASSWORD_PAGE_ROUTE: string = "/reset-password";

/*
 * What a master admin is told when they ask for a set-password link to copy
 * for an account that has a password already: handing them a link to set it
 * would be a way round "Password Changed" for an account that is in use.
 */
export const SET_PASSWORD_LINK_HAS_PASSWORD_MESSAGE: string =
  "This user already has a password, so there is no set-password link to copy. Send them a password reset link from their Authentication page instead.";

/*
 * What a master admin is told when the server cannot send email at all, so
 * the link is not even made: what did not happen, then what to do.
 */
export const SET_PASSWORD_LINK_CANNOT_BE_EMAILED_MESSAGE: string =
  "This server cannot send email yet. Set up email under Settings > Emails.";

export const PASSWORD_RESET_LINK_CANNOT_BE_EMAILED_MESSAGE: string =
  "This server cannot send email yet, so no password reset link was emailed. Set up email under Settings > Emails, or set their password yourself.";
