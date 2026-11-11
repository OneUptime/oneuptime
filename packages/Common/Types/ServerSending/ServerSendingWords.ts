/*
 * WHAT PEOPLE ARE TOLD WHEN THE SERVER CANNOT SEND EMAIL.
 *
 * Each sentence says what did not happen and who can fix it, in the words of
 * the person reading it - never an SMTP phrase. A project's owner reads why
 * an email was not sent in the project's Notification Logs; someone locked
 * out reads who can let them in; a master admin reads where to set email up.
 *
 * Pure, with no Node or browser APIs: the server, the Dashboard, the Accounts
 * pages and their tests all read the same words (ServerSendingStatus says
 * where the server stands).
 */

/*
 * Why an email the server had to send through its own settings was not
 * sent, while those settings are missing or incomplete: the Email Log row a
 * project's owners read, the on-call log, and the error the sender throws.
 */
export const SERVER_EMAIL_NOT_SET_UP_MESSAGE: string =
  "This server has no email set up, so this email was not sent. Ask your server's admin to set up email.";

/*
 * What "Forgot password" answers while the server cannot send email: the
 * same for every address, so it says nothing about who has an account.
 */
export const PASSWORD_RESET_CANNOT_BE_EMAILED_MESSAGE: string =
  "This server cannot send email yet, so it cannot email you a link to reset your password. Ask your server's admin to reset your password.";

// What asking for a sign-in link answers while the server cannot send email.
export const SIGN_IN_LINK_CANNOT_BE_EMAILED_MESSAGE: string =
  "This server cannot send email yet, so it cannot email you a sign-in link. Sign in with your password, or ask your server's admin to let you in.";

/*
 * What an invited person who signs up without their invitation link is told
 * while the server cannot send email: the link that finishes signing up
 * would have been emailed to them.
 */
export const REGISTRATION_LINK_CANNOT_BE_EMAILED_MESSAGE: string =
  "This server cannot send email yet, so it cannot email you a link to finish signing up. Ask the person who invited you for your invitation link, or ask your server's admin.";

/*
 * What the Email Log rows written before these words said, word for word:
 * read back, each is shown in the words above (toProjectEmailLogMessage).
 */
export const LEGACY_SERVER_EMAIL_NOT_SET_UP_MESSAGES: ReadonlyArray<string> = [
  "Email is configured to use SMTP, but SMTP settings are not configured.",
  "Global SMTP Config not found",
  "Global Config not found",
  "Email is configured to use Sendgrid, but Sendgrid Settings is not configured.",
  "Email is configured to use Sendgrid, but Sendgrid API key is not configured.",
  "Email is configured to use Sendgrid, but Sendgrid From Email is not configured.",
  "Email is configured to use Sendgrid, but Sendgrid From Name is not configured.",
  "Sendgrid Config not found",
  "Sendgrid API key not configured",
  "Sendgrid From Email not configured",
  "Sendgrid From Name not configured",
];

/*
 * The endings the server's own email settings used to refuse a send with
 * (Notification/Config: a setting left blank, "Please set this in the Admin
 * Dashboard: <address>"). Only the server's settings are refused this way.
 */
const LEGACY_ADMIN_DASHBOARD_SETTING_PHRASES: ReadonlyArray<string> = [
  "Please set this in the Admin Dashboard",
  "Please set it in the Admin Dashboard, under Settings > Emails",
];

export default class ServerSendingWords {
  /*
   * Whether a stored status message says the server's own email settings
   * are missing or incomplete, in any words it has ever said it in.
   */
  public static isServerEmailNotSetUpMessage(
    message: string | null | undefined,
  ): boolean {
    const text: string = (message || "").trim();

    if (!text) {
      return false;
    }

    if (text === SERVER_EMAIL_NOT_SET_UP_MESSAGE) {
      return true;
    }

    if (LEGACY_SERVER_EMAIL_NOT_SET_UP_MESSAGES.includes(text)) {
      return true;
    }

    return LEGACY_ADMIN_DASHBOARD_SETTING_PHRASES.some(
      (phrase: string): boolean => {
        return text.includes(phrase);
      },
    );
  }

  /*
   * An Email Log row's status message as a project's owners read it: a
   * failure because the server has no email set up reads as such, whatever
   * words the row was written in. Anything else is shown as it is.
   */
  public static toProjectEmailLogMessage(
    message: string | null | undefined,
  ): string {
    if (ServerSendingWords.isServerEmailNotSetUpMessage(message)) {
      return SERVER_EMAIL_NOT_SET_UP_MESSAGE;
    }

    return message || "";
  }
}
