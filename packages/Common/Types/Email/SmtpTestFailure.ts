import { translationKey } from "../Translator";
import { OtherSystemFailureWords } from "../Exception/OtherSystemFailure";

/*
 * WHY SEND TEST EMAIL DID NOT SEND, IN ONEUPTIME'S WORDS (#7268).
 *
 * A project's SMTP config's Send Test Email (Project Settings > Email >
 * SMTP) says what happened and what to check first, in the reader's
 * language: each message is a key of the Dashboard's locales (this file is
 * a "keys" root of its extractor). The mail server's own answer - "535-5.7.8
 * Username and Password not accepted", Microsoft Graph's error - goes beside
 * it, for the dialog to fold under Details (OtherSystemFailure). Before, a
 * server that signs in with a password answered "Cannot send email. Please
 * check your SMTP config. If you are using Google or Gmail, please dont..."
 * and kept its own answer to itself, and an OAuth config's or Graph's answer
 * trailed the advice after "Error: ".
 *
 * The names are the form's: Hostname, Port, Username, Password, Require TLS
 * (under More fields), the OAuth fields, Transport and From Email. The docs
 * quote each message's first sentence (emails/smtp.md, every language).
 */
export const SMTP_TEST_FAILURES: {
  // A server that signs in with a username and password, or not at all.
  smtp: OtherSystemFailureWords;
  // A server that signs in with OAuth.
  oauth: OtherSystemFailureWords;
  // A config whose Transport is Microsoft Graph.
  microsoftGraph: OtherSystemFailureWords;
} = {
  smtp: {
    whatHappened: "The SMTP server did not take the test email.",
    whatToDo:
      "Check the Hostname, Port, Username and Password. If your server does not offer TLS, turn Require TLS off under More fields, then send the test again.",
    message: translationKey(
      "The SMTP server did not take the test email. Check the Hostname, Port, Username and Password. If your server does not offer TLS, turn Require TLS off under More fields, then send the test again.",
    ),
  },
  oauth: {
    whatHappened:
      "The OAuth sign-in to the mail server failed, so the test email was not sent.",
    whatToDo:
      "Check the OAuth Client ID, OAuth Client Secret, OAuth Token URL and OAuth Scope, and that admin consent was granted. If your Microsoft 365 tenant has SMTP AUTH turned off, set Transport to Microsoft Graph.",
    message: translationKey(
      "The OAuth sign-in to the mail server failed, so the test email was not sent. Check the OAuth Client ID, OAuth Client Secret, OAuth Token URL and OAuth Scope, and that admin consent was granted. If your Microsoft 365 tenant has SMTP AUTH turned off, set Transport to Microsoft Graph.",
    ),
  },
  microsoftGraph: {
    whatHappened: "Microsoft Graph did not take the test email.",
    whatToDo:
      "Check that the app has the Mail.Send application permission with admin consent, that OAuth Scope is https://graph.microsoft.com/.default, and that From Email is a licensed mailbox in your tenant.",
    message: translationKey(
      "Microsoft Graph did not take the test email. Check that the app has the Mail.Send application permission with admin consent, that OAuth Scope is https://graph.microsoft.com/.default, and that From Email is a licensed mailbox in your tenant.",
    ),
  },
};

/*
 * Why the test was refused before anything was sent: a config that is gone
 * (another tab deleted it), one missing what a send needs, a request with no
 * address to send to.
 */
export const SMTP_TEST_REFUSALS: {
  configGone: string;
  configIncomplete: string;
  noAddress: string;
} = {
  configGone: translationKey(
    "This SMTP config is not in this project any more. Reload the page, then send the test again.",
  ),
  configIncomplete: translationKey(
    "This SMTP config is missing a setting it needs to send email. Edit it and fill in its server settings, then send the test again.",
  ),
  noAddress: translationKey(
    "Enter the email address to send the test email to.",
  ),
};
