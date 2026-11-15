import { describe, expect, test } from "@jest/globals";
import ServerSendingWords, {
  LEGACY_SERVER_EMAIL_NOT_SET_UP_MESSAGES,
  PASSWORD_RESET_CANNOT_BE_EMAILED_MESSAGE,
  REGISTRATION_LINK_CANNOT_BE_EMAILED_MESSAGE,
  SERVER_EMAIL_NOT_SET_UP_MESSAGE,
  SIGN_IN_LINK_CANNOT_BE_EMAILED_MESSAGE,
} from "../../../Types/ServerSending/ServerSendingWords";

/*
 * WHAT PEOPLE ARE TOLD WHEN THE SERVER CANNOT SEND EMAIL (#6825).
 *
 * A project's owner reads why an email was not sent in their Notification
 * Logs - "This server has no email set up" and who can fix it - never an
 * SMTP phrase, whatever words the row was written in. Someone locked out
 * reads who can let them in. None of it names an account, a setting or a
 * mail server.
 */

const SENTENCES: Array<string> = [
  SERVER_EMAIL_NOT_SET_UP_MESSAGE,
  PASSWORD_RESET_CANNOT_BE_EMAILED_MESSAGE,
  SIGN_IN_LINK_CANNOT_BE_EMAILED_MESSAGE,
  REGISTRATION_LINK_CANNOT_BE_EMAILED_MESSAGE,
];

describe("the words", () => {
  test.each(SENTENCES)("%p names who can fix it", (sentence: string) => {
    expect(sentence).toContain("server's admin");
  });

  test.each(SENTENCES)(
    "%p says nothing an SMTP person would say",
    (sentence: string) => {
      expect(sentence).not.toMatch(/SMTP|SendGrid|config|Admin Dashboard/i);
    },
  );

  test("a project owner's log row says the email was not sent, and why", () => {
    expect(SERVER_EMAIL_NOT_SET_UP_MESSAGE).toBe(
      "This server has no email set up, so this email was not sent. Ask your server's admin to set up email.",
    );
  });

  test("the sign-in pages' words speak of the server, never of an account", () => {
    for (const sentence of [
      PASSWORD_RESET_CANNOT_BE_EMAILED_MESSAGE,
      SIGN_IN_LINK_CANNOT_BE_EMAILED_MESSAGE,
      REGISTRATION_LINK_CANNOT_BE_EMAILED_MESSAGE,
    ]) {
      expect(sentence.startsWith("This server cannot send email yet")).toBe(
        true,
      );
      expect(sentence).not.toMatch(/no account|not registered|exists/i);
    }
  });
});

describe("a stored status message, as a project's owners read it", () => {
  test.each([...LEGACY_SERVER_EMAIL_NOT_SET_UP_MESSAGES])(
    "the old words %p read as the server having no email set up",
    (stored: string) => {
      expect(ServerSendingWords.isServerEmailNotSetUpMessage(stored)).toBe(
        true,
      );
      expect(ServerSendingWords.toProjectEmailLogMessage(stored)).toBe(
        SERVER_EMAIL_NOT_SET_UP_MESSAGE,
      );
    },
  );

  test.each([
    "Global SMTP From Email not found. Please set this in the Admin Dashboard: https://oneuptime.example.com/admin",
    "SMTP Host not found. Please set this in the Admin Dashboard: http://localhost/admin",
    "SMTP OAuth Scope not found. Please set this in the Admin Dashboard: http://localhost/admin",
    // OAuth over SMTP without the mailbox it signs in as (#7833).
    "SMTP Username not found. Please set this in the Admin Dashboard: http://localhost/admin",
    "Email is configured to use Amazon SES, but its Access Key ID is not set. Please set it in the Admin Dashboard, under Settings > Emails: http://localhost/admin",
    `  ${SERVER_EMAIL_NOT_SET_UP_MESSAGE}  `,
  ])("the server's settings refusing %p read the same", (stored: string) => {
    expect(ServerSendingWords.toProjectEmailLogMessage(stored)).toBe(
      SERVER_EMAIL_NOT_SET_UP_MESSAGE,
    );
  });

  test.each([
    "Email sent successfully.",
    "Email failed to send. Unexpected socket close. This could mean various things, such as your SMTP server is unreachble.",
    "535 5.7.8 Username and Password not accepted",
    "SendGrid needs an API Key.",
  ])("anything else - %p - is shown as it is", (stored: string) => {
    expect(ServerSendingWords.isServerEmailNotSetUpMessage(stored)).toBe(false);
    expect(ServerSendingWords.toProjectEmailLogMessage(stored)).toBe(stored);
  });

  test.each([null, undefined, ""])(
    "%p is nothing to say",
    (stored: string | null | undefined) => {
      expect(ServerSendingWords.isServerEmailNotSetUpMessage(stored)).toBe(
        false,
      );
      expect(ServerSendingWords.toProjectEmailLogMessage(stored)).toBe("");
    },
  );
});
